import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { renderPrompt, type DeviceVar } from "./prompt.js";
import { runHeadlessAgent } from "./headless.js";
import { withRetries, createWorktree, installDependencies } from "../provisioner/shared.js";
import {
    bootIosSimulator,
    uninstallApp as uninstallIos,
    startMetro, stopMetro,
    buildAndInstall as buildIos,
    installIosPods,
    launchApp as launchIos,
    setBundlerLocation as setIosBundlerLocation,
    discoverIosBundleId,
    readBundlerLocation as readIosBundlerLocation,
} from "../provisioner/ios.js";
import {
    bootAndroidEmulator,
    uninstallApp as uninstallAndroid,
    buildAndInstall as buildAndroid,
    launchApp as launchAndroid,
    setBundlerLocation as setAndroidBundlerLocation,
    discoverAndroidPackageName,
    readReverseTunnelHostPorts,
} from "../provisioner/android.js";
import { nativeFingerprint } from "../provisioner/nativeFingerprint.js";
import {
    getCachedFingerprint, setCachedFingerprint,
    isAppInstalledIos, isAppInstalledAndroid,
    isAppRunningIos, isAppRunningAndroid,
} from "../provisioner/installCache.js";
import { commitIfDirty, pushBranch, getRemoteUrl, buildPrUrl } from "../git/push.js";
import { notifyMacos } from "../notify/macos.js";
import { writeDescriptor, type TaskDescriptor } from "../queue/descriptor.js";
import type { Config, Slot } from "../config/schema.js";
import { PATHS, worktreePath, logPath } from "../config/paths.js";

export interface RunOutcome {
    status: "done" | "failed";
    reason?: string;
}

interface ResolvedDevice {
    slot: Slot;
    bundleId: string;
    // ID for adb / xcrun / RN CLI. iOS: same as slot.deviceId (UDID).
    // Android: emulator-${androidConsolePort} — slot.deviceId there is the AVD name.
    adbDeviceId: string;
}

interface RebuildPlan {
    rd: ResolvedDevice;
    needsRebuild: boolean;
    reason: string;
}

function resolveDevices(slots: Slot[], wt: string): ResolvedDevice[] {
    let iosBundleId: string | null = null;
    let androidPackageName: string | null = null;
    return slots.map(slot => {
        if (slot.platform === "ios") {
            if (!iosBundleId) iosBundleId = discoverIosBundleId(wt);
            return { slot, bundleId: iosBundleId, adbDeviceId: slot.deviceId };
        } else {
            if (!androidPackageName) androidPackageName = discoverAndroidPackageName(wt);
            const port = slot.androidConsolePort;
            if (!port) throw new Error(`android slot ${slot.id} missing androidConsolePort`);
            return { slot, bundleId: androidPackageName, adbDeviceId: `emulator-${port}` };
        }
    });
}

function isAppInstalled(rd: ResolvedDevice, log: (msg: string) => void): boolean {
    const onFailure = (msg: string) =>
        log(`[${rd.slot.platform}/${rd.slot.deviceId}] isAppInstalled probe failed (treating as not installed): ${msg}`);
    return rd.slot.platform === "ios"
        ? isAppInstalledIos(rd.adbDeviceId, rd.bundleId, onFailure)
        : isAppInstalledAndroid(rd.adbDeviceId, rd.bundleId, undefined, onFailure);
}

function parseHostPort(loc: string): number | null {
    const m = loc.match(/:(\d+)/);
    return m ? Number(m[1]) : null;
}

function isMetroLive(port: number): boolean {
    const r = spawnSync("curl", ["-sf", `http://localhost:${port}/status`], { encoding: "utf8", timeout: 2000 });
    return r.status === 0;
}

type BusyReason =
    | { kind: "metro"; port: number }
    | { kind: "running" };

/**
 * Returns a busy reason if the device is currently in use by another
 * workflow — either paired with a different live Metro, or running the
 * app process right now. Otherwise null.
 *
 * The slot picker also probes "is the app running" at scheduling time,
 * but a dev can launch the app between slot assignment and provisioning;
 * this runtime check catches that case so we don't stomp.
 */
function findBusyReason(rd: ResolvedDevice, ourPort: number): BusyReason | null {
    if (rd.slot.platform === "ios") {
        if (isAppRunningIos(rd.adbDeviceId, rd.bundleId)) return { kind: "running" };
        const loc = readIosBundlerLocation(rd.adbDeviceId, rd.bundleId);
        if (loc) {
            const port = parseHostPort(loc);
            if (port != null && port !== ourPort && isMetroLive(port)) return { kind: "metro", port };
        }
        return null;
    }
    if (isAppRunningAndroid(rd.adbDeviceId, rd.bundleId)) return { kind: "running" };
    for (const p of readReverseTunnelHostPorts(rd.adbDeviceId)) {
        if (p !== ourPort && isMetroLive(p)) return { kind: "metro", port: p };
    }
    return null;
}

async function bootDevice(slot: Slot, timeoutSec: number): Promise<void> {
    if (slot.platform === "ios") {
        await bootIosSimulator(slot.deviceId, timeoutSec);
    } else {
        const consolePort = slot.androidConsolePort;
        if (!consolePort) throw new Error(`android slot ${slot.id} missing androidConsolePort`);
        await bootAndroidEmulator(slot.deviceId, consolePort, timeoutSec);
    }
}

function planRebuild(rd: ResolvedDevice, fingerprint: string, forceRebuild: boolean, log: (msg: string) => void): RebuildPlan {
    // Cache stays keyed on slot.deviceId (AVD name on Android) — stable across re-inits
    // that may reshuffle console-port assignments.
    const cachedFp = getCachedFingerprint(rd.slot.deviceId, rd.bundleId);
    const installed = isAppInstalled(rd, log);
    const needsRebuild = forceRebuild || !installed || cachedFp !== fingerprint;
    const reason = forceRebuild ? "forceRebuild=true"
        : !installed ? "app not installed"
        : !cachedFp ? "no cached fingerprint"
        : "native fingerprint changed";
    return { rd, needsRebuild, reason };
}

async function provisionDevice(
    plan: RebuildPlan,
    wt: string,
    metroPort: number,
    fingerprint: string,
    config: Config,
    log: (msg: string) => void,
): Promise<void> {
    const { rd, needsRebuild, reason } = plan;
    const { slot, bundleId, adbDeviceId } = rd;

    if (!needsRebuild) {
        log(`[${slot.platform}/${slot.deviceId}] cache hit (${fingerprint.slice(0, 12)}); skipping rebuild`);
    } else {
        log(`[${slot.platform}/${slot.deviceId}] rebuild required (${reason})`);

        if (slot.platform === "ios") {
            uninstallIos(adbDeviceId, bundleId);
            // pod install runs once per worktree at the runTask level (shared
            // across all iOS slots — running it concurrently would race on
            // ios/Pods/, ios/Podfile.lock, and vendor/bundle/).
            await withRetries(async () => buildIos(wt, adbDeviceId, metroPort, bundleId, config.readinessTimeouts.appInstallSec),
                { retries: config.retryProvisioner, backoffMs: 5000, label: `build ios ${slot.deviceId}` });
        } else {
            uninstallAndroid(adbDeviceId, bundleId);
            await withRetries(async () => buildAndroid(wt, adbDeviceId, metroPort, bundleId, config.readinessTimeouts.appInstallSec, slot.deviceId),
                { retries: config.retryProvisioner, backoffMs: 5000, label: `build android ${slot.deviceId}` });
        }
        setCachedFingerprint(slot.deviceId, bundleId, fingerprint);
    }

    log(`[${slot.platform}/${slot.deviceId}] pointing at metro :${metroPort}`);
    if (slot.platform === "ios") {
        setIosBundlerLocation(adbDeviceId, bundleId, metroPort);
        launchIos(adbDeviceId, bundleId, wt, metroPort);
    } else {
        setAndroidBundlerLocation(adbDeviceId, metroPort);
        launchAndroid(adbDeviceId, bundleId, wt, metroPort);
    }
}

export async function runTask(
    descriptor: TaskDescriptor,
    slots: Slot[],
    assignedMetroPort: number,
    config: Config,
): Promise<RunOutcome> {
    const wt = worktreePath(descriptor.id);
    const metroSessionName = `execbro-metro-${descriptor.id}`;
    mkdirSync(PATHS.logs, { recursive: true });
    const log = (msg: string) => {
        const line = `${new Date().toISOString()} ${msg}\n`;
        writeFileSync(logPath(descriptor.id), line, { flag: "a" });
        console.log(`[${descriptor.id}] ${msg}`);
    };

    try {
        log("provisioning: worktree");
        await withRetries(async () => createWorktree(descriptor.repo, wt, `task/${descriptor.id}`, descriptor.baseBranch),
            { retries: config.retryProvisioner, backoffMs: 5000, label: "worktree" });
        log("provisioning: install deps");
        await withRetries(async () => installDependencies(wt),
            { retries: config.retryProvisioner, backoffMs: 5000, label: "install" });

        const resolved = resolveDevices(slots, wt);

        log(`provisioning: boot ${resolved.length} device(s) in parallel`);
        await Promise.all(resolved.map(rd =>
            withRetries(async () => bootDevice(rd.slot, config.readinessTimeouts.deviceBootSec),
                { retries: config.retryProvisioner, backoffMs: 5000, label: `boot ${rd.slot.platform} ${rd.slot.deviceId}` }),
        ));

        log(`provisioning: start metro on :${assignedMetroPort}`);
        await withRetries(async () => startMetro(wt, assignedMetroPort, config.readinessTimeouts.metroReadySec, metroSessionName),
            { retries: config.retryProvisioner, backoffMs: 5000, label: "metro" });

        descriptor.assignedMetroPort = assignedMetroPort;
        writeDescriptor(join(PATHS.queue.running, `${descriptor.id}.json`), descriptor);
        log(`metro ready on :${assignedMetroPort}`);

        log(`probing ${resolved.length} device(s) for in-use state`);
        const busyMap = resolved.map(rd => {
            log(`  [${rd.slot.platform}/${rd.slot.deviceId}] busy probe`);
            const reason = findBusyReason(rd, assignedMetroPort);
            const summary = reason == null
                ? "free"
                : reason.kind === "running"
                    ? "app currently running"
                    : `paired with :${reason.port}`;
            log(`  [${rd.slot.platform}/${rd.slot.deviceId}] busy probe done (${summary})`);
            return { rd, reason };
        });
        const skipped = busyMap.filter((x): x is { rd: ResolvedDevice; reason: BusyReason } => x.reason != null);
        const active = busyMap.filter(x => x.reason == null).map(x => x.rd);

        for (const s of skipped) {
            const why = s.reason.kind === "running"
                ? "app currently running"
                : `busy with metro on :${s.reason.port}`;
            log(`[${s.rd.slot.platform}/${s.rd.slot.deviceId}] ${why} — skipping`);
        }
        if (active.length === 0) {
            throw new Error(
                `all ${resolved.length} configured device(s) are paired with other metros; nothing to provision`,
            );
        }

        log("computing native fingerprint");
        const fingerprint = nativeFingerprint(wt);
        log(`fingerprint: ${fingerprint.slice(0, 12)}`);
        const forceRebuild = descriptor.forceRebuild ?? false;

        log("planning rebuilds");
        const plans = active.map(rd => planRebuild(rd, fingerprint, forceRebuild, log));

        if (plans.some(p => p.rd.slot.platform === "ios" && p.needsRebuild)) {
            log("provisioning: pod install (shared across iOS slots)");
            await withRetries(async () => installIosPods(wt),
                { retries: config.retryProvisioner, backoffMs: 5000, label: "pod install" });
        }

        await Promise.all(plans.map(p =>
            provisionDevice(p, wt, assignedMetroPort, fingerprint, config, log),
        ));

        const userPrompt = readFileSync(descriptor.promptFile, "utf8");
        const promptDevices: DeviceVar[] = active.map(rd => ({
            platform: rd.slot.platform,
            deviceId: rd.slot.deviceId,
            bundleId: rd.bundleId,
        }));
        const composed = renderPrompt({
            userPrompt,
            vars: { worktreePath: wt, metroPort: assignedMetroPort, devices: promptDevices },
        });
        const headlessSystemPrompt = readFileSync(
            join(PATHS.templates, "headless-system-prompt.md"), "utf8",
        );

        log("starting headless agent");
        const headlessLog = logPath(descriptor.id);
        const { exitCode, sessionId } = await runHeadlessAgent({
            prompt: composed,
            systemPrompt: headlessSystemPrompt,
            cwd: wt,
            logPath: headlessLog,
            onSessionId: id => {
                descriptor.claudeSessionId = id;
                writeDescriptor(join(PATHS.queue.running, `${descriptor.id}.json`), descriptor);
                log(`session started: ${id}`);
                log(`resume any time: cd ${wt} && claude --resume ${id}`);
            },
        });

        if (exitCode !== 0) {
            const reason = sessionId
                ? `agent exited ${exitCode} (resume: cd ${wt} && claude --resume ${sessionId})`
                : `agent exited ${exitCode} before emitting a session id`;
            log(reason);
            if (config.notifications.macos) {
                notifyMacos(`ExecBro task FAILED: ${descriptor.id}`, `on :${assignedMetroPort} — ${reason}`);
            }
            return { status: "failed", reason };
        }

        log("committing");
        commitIfDirty(wt, `task: ${descriptor.id}`);
        const branchName = `task/${descriptor.id}`;

        let prUrl: string | null = null;
        if (config.pushOnDone) {
            log(`pushing ${branchName}`);
            try {
                pushBranch(wt, branchName);
                const remoteUrl = getRemoteUrl(wt);
                prUrl = buildPrUrl({ remoteUrl, sourceBranch: branchName, destBranch: descriptor.baseBranch });
                if (prUrl) log(`PR URL: ${prUrl}`);
                else log(`pushed (host not recognized — open a PR manually for branch ${branchName})`);
            } catch (e) {
                log(`push failed (commit kept locally): ${(e as Error).message}`);
                log(`to push manually: cd ${wt} && git push -u origin ${branchName}`);
            }
        } else {
            log(`pushOnDone=false — branch committed locally: ${branchName}`);
            log(`to push manually: cd ${wt} && git push -u origin ${branchName}`);
        }

        if (sessionId) log(`resume any time: cd ${wt} && claude --resume ${sessionId}`);

        if (config.notifications.macos) {
            const lines: string[] = [`Metro: :${assignedMetroPort}`, "Devices:"];
            for (const rd of active) {
                lines.push(`  - ${rd.slot.platform} on ${rd.slot.deviceId} (slot ${rd.slot.id})`);
            }
            if (skipped.length > 0) {
                lines.push(`Skipped (busy): ${skipped.map(s => s.rd.slot.deviceId).join(", ")}`);
            }
            if (prUrl) lines.push(`PR: ${prUrl}`);
            else if (config.pushOnDone) lines.push(`Branch: ${branchName} (open PR manually)`);
            else lines.push(`Branch: ${branchName} (not pushed)`);
            if (sessionId) lines.push(`Resume: claude --resume ${sessionId}`);
            notifyMacos(`ExecBro task done: ${descriptor.id}`, lines.join("\n"));
        }
        return { status: "done" };
    } catch (e) {
        log(`task failed: ${(e as Error).message}`);
        if (config.notifications.macos) {
            notifyMacos(`ExecBro task FAILED: ${descriptor.id}`, `on :${assignedMetroPort} — ${(e as Error).message}`);
        }
        return { status: "failed", reason: (e as Error).message };
    } finally {
        stopMetro(metroSessionName, assignedMetroPort);
    }
}
