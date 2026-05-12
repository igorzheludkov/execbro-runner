#!/usr/bin/env node
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import chokidar from "chokidar";
import { loadConfig } from "../config/loader.js";
import { PATHS, slotLockPath, portLockPath } from "../config/paths.js";
import { tryClaimSlots, type SlotRelease } from "../scheduler/slots.js";
import { claimPortFromRange } from "../scheduler/ports.js";
import { listDescriptors, moveDescriptor } from "../queue/transitions.js";
import { writeDescriptor, type TaskDescriptor } from "../queue/descriptor.js";
import { runTask } from "../runner/run.js";
import { discoverIosBundleId, getSimNameByUdid } from "../provisioner/ios.js";
import { discoverAndroidPackageName } from "../provisioner/android.js";
import { isAppRunningIos, isAppRunningAndroid } from "../provisioner/installCache.js";
import { findDevicesInUseByOtherMetros, rangeOf } from "../scheduler/metroProbe.js";
import type { Config, Slot } from "../config/schema.js";

function ensureDirs(): void {
    mkdirSync(PATHS.queue.inbox, { recursive: true });
    mkdirSync(PATHS.queue.running, { recursive: true });
    mkdirSync(PATHS.queue.done, { recursive: true });
    mkdirSync(PATHS.queue.failed, { recursive: true });
    mkdirSync(PATHS.slots, { recursive: true });
    mkdirSync(PATHS.ports, { recursive: true });
    mkdirSync(PATHS.worktrees, { recursive: true });
    mkdirSync(PATHS.logs, { recursive: true });
}

const inFlightSlotIds = new Set<number>();

interface ScheduleAttempt {
    descriptor: TaskDescriptor;
    slots: Slot[];
    slotReleases: SlotRelease[];
}

async function tryScheduleHead(config: Config): Promise<ScheduleAttempt | null> {
    if (!existsSync(PATHS.queue.inbox)) return null;
    const queued = listDescriptors(PATHS.queue.inbox)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (queued.length === 0) return null;

    const descriptor = queued[0];
    // Strict FIFO: dependsOn must be satisfied; otherwise STOP.
    if (descriptor.dependsOn.length > 0) {
        const doneIds = new Set(listDescriptors(PATHS.queue.done).map(d => d.id));
        if (!descriptor.dependsOn.every(id => doneIds.has(id))) return null;
    }

    // Group required platforms.
    const counts = { ios: 0, android: 0 };
    for (const dev of descriptor.devices) counts[dev.platform]++;

    // Pre-detect bundle ids from the source repo so we can probe each
    // candidate slot for "is the dev currently using THIS app on this
    // device" — autodetect reads static project files, no worktree needed.
    // Tolerate detection failure (fall back to "no probe" → pick by id).
    let iosBundleId: string | null = null;
    let androidPackageName: string | null = null;
    if (counts.ios > 0) {
        try { iosBundleId = discoverIosBundleId(descriptor.repo); } catch { /* defer to runTask */ }
    }
    if (counts.android > 0) {
        try { androidPackageName = discoverAndroidPackageName(descriptor.repo); } catch { /* defer */ }
    }

    // Discover which devices are currently paired with another Metro on
    // this host (the dev's manual session, a concurrent runner task, etc.).
    // Returned set holds device names as Metro reports them: "emulator-NNNN"
    // for Android, the simulator's display name (e.g. "iPhone Air") for iOS.
    const devicesPairedElsewhere = await findDevicesInUseByOtherMetros(
        new Set(),
        rangeOf(config.metroPortRange),
    );

    // Walk config slots in id order; pick the first free slot per platform
    // that isn't currently in use. "In use" = paired with another Metro OR
    // running the target app's process. The picker hops to the next free
    // slot, so a dev's primary device is automatically left alone.
    const candidates: Slot[] = [];
    const want = { ios: counts.ios, android: counts.android };
    for (const slot of config.slots.slice().sort((a, b) => a.id - b.id)) {
        if (inFlightSlotIds.has(slot.id)) continue;
        if (slot.platform === "ios" && want.ios > 0) {
            const simName = getSimNameByUdid(slot.deviceId);
            if (simName && devicesPairedElsewhere.has(simName)) {
                console.log(`[worker] skipping iOS slot ${slot.id} (${simName}): paired with another Metro`);
                continue;
            }
            if (iosBundleId && isAppRunningIos(slot.deviceId, iosBundleId)) {
                console.log(`[worker] skipping iOS slot ${slot.id} (${slot.deviceId}): ${iosBundleId} is currently running`);
                continue;
            }
            candidates.push(slot); want.ios--;
        } else if (slot.platform === "android" && want.android > 0) {
            const adbId = slot.androidConsolePort != null ? `emulator-${slot.androidConsolePort}` : slot.deviceId;
            if (devicesPairedElsewhere.has(adbId)) {
                console.log(`[worker] skipping Android slot ${slot.id} (${adbId}): paired with another Metro`);
                continue;
            }
            if (androidPackageName && isAppRunningAndroid(adbId, androidPackageName)) {
                console.log(`[worker] skipping Android slot ${slot.id} (${slot.deviceId}): ${androidPackageName} is currently running`);
                continue;
            }
            candidates.push(slot); want.android--;
        }
    }
    if (want.ios !== 0 || want.android !== 0) return null;

    const slotReleases = await tryClaimSlots(candidates.map(s => slotLockPath(s.id)));
    if (!slotReleases) return null;

    for (const s of candidates) inFlightSlotIds.add(s.id);
    return { descriptor, slots: candidates, slotReleases };
}

async function runScheduled(attempt: ScheduleAttempt, config: Config): Promise<void> {
    const { descriptor, slots, slotReleases } = attempt;
    const inboxPath = join(PATHS.queue.inbox, `${descriptor.id}.json`);
    const runningPath = join(PATHS.queue.running, `${descriptor.id}.json`);
    descriptor.status = "running";
    descriptor.assignedSlotIds = slots.map(s => s.id);
    writeDescriptor(inboxPath, descriptor);
    moveDescriptor(inboxPath, runningPath);
    console.log(`[worker] picked up ${descriptor.id} on slots ${slots.map(s => s.id).join(",")}`);

    const portClaim = await claimPortFromRange(config.metroPortRange, portLockPath);
    let outcome: { status: "done" | "failed"; reason?: string };
    if (!portClaim) {
        const reason = `provisioner:no-free-port (range ${config.metroPortRange.from}-${config.metroPortRange.to})`;
        console.error(`[worker] ${descriptor.id}: ${reason}`);
        outcome = { status: "failed", reason };
    } else {
        console.log(`[worker] ${descriptor.id} assigned Metro port ${portClaim.port}`);
        try {
            outcome = await runTask(descriptor, slots, portClaim.port, config);
        } catch (e) {
            outcome = { status: "failed", reason: (e as Error).message };
        }
        await portClaim.release();
    }

    descriptor.status = outcome.status;
    writeDescriptor(runningPath, descriptor);
    const finalDir = outcome.status === "done" ? PATHS.queue.done : PATHS.queue.failed;
    moveDescriptor(runningPath, join(finalDir, `${descriptor.id}.json`));
    for (const release of slotReleases) await release();
    for (const s of slots) inFlightSlotIds.delete(s.id);
    console.log(`[worker] ${descriptor.id} → ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}`);

    void tryRunNext(config);
}

async function tryRunNext(config: Config): Promise<void> {
    // Loop until the head-of-queue task can no longer be scheduled.
    while (true) {
        const attempt = await tryScheduleHead(config);
        if (!attempt) return;
        // Fire-and-forget so the next iteration can attempt the next-oldest task
        // with whatever slots remain free.
        void runScheduled(attempt, config);
    }
}

async function main(): Promise<void> {
    ensureDirs();
    const config = loadConfig();
    console.log(`[worker] started, ${config.slots.length} slot(s) configured, Metro ports ${config.metroPortRange.from}-${config.metroPortRange.to}`);

    const watcher = chokidar.watch(PATHS.queue.inbox, { ignoreInitial: false, depth: 0 });
    watcher.on("add", () => { void tryRunNext(config); });

    process.on("SIGINT", async () => { await watcher.close(); process.exit(0); });
}

main().catch(e => { console.error(e); process.exit(1); });
