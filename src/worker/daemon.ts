#!/usr/bin/env node
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import chokidar from "chokidar";
import { loadConfig } from "../config/loader.js";
import { PATHS, slotLockPath, portLockPath } from "../config/paths.js";
import { tryClaimSlot } from "../scheduler/slots.js";
import { claimPortFromRange } from "../scheduler/ports.js";
import { listDescriptors, moveDescriptor } from "../queue/transitions.js";
import { writeDescriptor } from "../queue/descriptor.js";
import { runTask } from "../runner/run.js";
import type { Config } from "../config/schema.js";

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

let busy = false;

async function tryRunNext(config: Config): Promise<void> {
    if (busy) return;
    if (!existsSync(PATHS.queue.inbox)) return;
    const queued = listDescriptors(PATHS.queue.inbox);
    if (queued.length === 0) return;

    // Phase 1: only iOS, only single slot. Find an iOS slot that's free.
    const iosSlot = config.slots.find(s => s.platform === "ios");
    if (!iosSlot) {
        console.error("No iOS slot configured");
        return;
    }
    const slotRelease = await tryClaimSlot(slotLockPath(iosSlot.id));
    if (!slotRelease) return;

    busy = true;
    const descriptor = queued[0];
    const inboxPath = join(PATHS.queue.inbox, `${descriptor.id}.json`);
    const runningPath = join(PATHS.queue.running, `${descriptor.id}.json`);
    descriptor.status = "running";
    writeDescriptor(inboxPath, descriptor);
    moveDescriptor(inboxPath, runningPath);

    console.log(`[worker] picked up ${descriptor.id} on slot ${iosSlot.id}`);

    const portClaim = await claimPortFromRange(config.metroPortRange, portLockPath);
    let outcome: { status: "done" | "failed"; reason?: string };
    if (!portClaim) {
        const reason = `provisioner:no-free-port (range ${config.metroPortRange.from}-${config.metroPortRange.to})`;
        console.error(`[worker] ${descriptor.id}: ${reason}`);
        outcome = { status: "failed", reason };
    } else {
        console.log(`[worker] ${descriptor.id} assigned Metro port ${portClaim.port}`);
        try {
            outcome = await runTask(descriptor, iosSlot, portClaim.port, config);
        } catch (e) {
            outcome = { status: "failed", reason: (e as Error).message };
        }
        await portClaim.release();
    }

    descriptor.status = outcome.status;
    writeDescriptor(runningPath, descriptor);
    const finalDir = outcome.status === "done" ? PATHS.queue.done : PATHS.queue.failed;
    moveDescriptor(runningPath, join(finalDir, `${descriptor.id}.json`));
    await slotRelease();
    busy = false;
    console.log(`[worker] ${descriptor.id} → ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}`);

    // Immediately attempt the next one.
    void tryRunNext(config);
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
