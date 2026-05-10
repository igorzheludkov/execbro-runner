import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
} from "../provisioner/ios.js";
import {
    bootAndroidEmulator,
    uninstallApp as uninstallAndroid,
    buildAndInstall as buildAndroid,
    launchApp as launchAndroid,
    setBundlerLocation as setAndroidBundlerLocation,
    discoverAndroidPackageName,
} from "../provisioner/android.js";
import { nativeFingerprint } from "../provisioner/nativeFingerprint.js";
import {
    getCachedFingerprint, setCachedFingerprint,
    isAppInstalledIos, isAppInstalledAndroid,
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
}

function resolveDevices(slots: Slot[], wt: string): ResolvedDevice[] {
    let iosBundleId: string | null = null;
    let androidPackageName: string | null = null;
    return slots.map(slot => {
        if (slot.platform === "ios") {
            if (!iosBundleId) iosBundleId = discoverIosBundleId(wt);
            return { slot, bundleId: iosBundleId };
        } else {
            if (!androidPackageName) androidPackageName = discoverAndroidPackageName(wt);
            return { slot, bundleId: androidPackageName };
        }
    });
}

function isAppInstalled(slot: Slot, bundleId: string): boolean {
    return slot.platform === "ios"
        ? isAppInstalledIos(slot.deviceId, bundleId)
        : isAppInstalledAndroid(slot.deviceId, bundleId);
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

async function provisionDevice(
    rd: ResolvedDevice,
    wt: string,
    metroPort: number,
    fingerprint: string,
    forceRebuild: boolean,
    config: Config,
    log: (msg: string) => void,
): Promise<void> {
    const { slot, bundleId } = rd;
    const cachedFp = getCachedFingerprint(slot.deviceId, bundleId);
    const installed = isAppInstalled(slot, bundleId);
    const canSkipBuild = !forceRebuild && installed && cachedFp === fingerprint;

    if (canSkipBuild) {
        log(`[${slot.platform}/${slot.deviceId}] cache hit (${fingerprint.slice(0, 12)}); skipping rebuild`);
    } else {
        const reason = forceRebuild ? "forceRebuild=true"
            : !installed ? "app not installed"
            : !cachedFp ? "no cached fingerprint"
            : "native fingerprint changed";
        log(`[${slot.platform}/${slot.deviceId}] rebuild required (${reason})`);

        if (slot.platform === "ios") {
            uninstallIos(slot.deviceId, bundleId);
            await withRetries(async () => installIosPods(wt),
                { retries: config.retryProvisioner, backoffMs: 5000, label: `pod install ${slot.deviceId}` });
            await withRetries(async () => buildIos(wt, slot.deviceId, metroPort, bundleId, config.readinessTimeouts.appInstallSec),
                { retries: config.retryProvisioner, backoffMs: 5000, label: `build ios ${slot.deviceId}` });
        } else {
            uninstallAndroid(slot.deviceId, bundleId);
            await withRetries(async () => buildAndroid(wt, slot.deviceId, metroPort, bundleId, config.readinessTimeouts.appInstallSec),
                { retries: config.retryProvisioner, backoffMs: 5000, label: `build android ${slot.deviceId}` });
        }
        setCachedFingerprint(slot.deviceId, bundleId, fingerprint);
    }

    log(`[${slot.platform}/${slot.deviceId}] pointing at metro :${metroPort}`);
    if (slot.platform === "ios") {
        setIosBundlerLocation(slot.deviceId, bundleId, metroPort);
        launchIos(slot.deviceId, bundleId);
    } else {
        setAndroidBundlerLocation(slot.deviceId, metroPort);
        launchAndroid(slot.deviceId, bundleId);
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

        const fingerprint = nativeFingerprint(wt);
        const forceRebuild = descriptor.forceRebuild ?? false;

        await Promise.all(resolved.map(rd =>
            provisionDevice(rd, wt, assignedMetroPort, fingerprint, forceRebuild, config, log),
        ));

        const userPrompt = readFileSync(descriptor.promptFile, "utf8");
        const promptDevices: DeviceVar[] = resolved.map(rd => ({
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
            for (const rd of resolved) {
                lines.push(`  - ${rd.slot.platform} on ${rd.slot.deviceId} (slot ${rd.slot.id})`);
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
