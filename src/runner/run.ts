import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { renderPrompt } from "./prompt.js";
import { runHeadlessAgent } from "./headless.js";
import { withRetries, createWorktree, installDependencies } from "../provisioner/shared.js";
import { bootIosSimulator, uninstallApp, startMetro, stopMetro, buildAndInstall, installIosPods, launchApp } from "../provisioner/ios.js";
import { nativeFingerprint } from "../provisioner/nativeFingerprint.js";
import { getCachedFingerprint, setCachedFingerprint, isAppInstalledIos } from "../provisioner/installCache.js";
import { commitIfDirty, pushBranch, getRemoteUrl, buildPrUrl } from "../git/push.js";
import { notifyMacos } from "../notify/macos.js";
import { writeDescriptor, type TaskDescriptor } from "../queue/descriptor.js";
import type { Config, Slot } from "../config/schema.js";
import { PATHS, worktreePath, logPath } from "../config/paths.js";

export interface RunOutcome {
    status: "done" | "failed";
    reason?: string;
}

async function readBundleId(wtPath: string): Promise<string> {
    // Phase 1: read from package.json's "execbro": { "iosBundleId": "..." } field.
    // Phase 2 will discover this from the Xcode project / Podfile automatically.
    const pkgRaw = readFileSync(join(wtPath, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);
    const bundleId = pkg?.execbro?.iosBundleId;
    if (!bundleId) throw new Error("package.json must contain execbro.iosBundleId for Phase 1");
    return bundleId;
}

export async function runTask(
    descriptor: TaskDescriptor,
    slot: Slot,
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
        // Provision
        log("provisioning: worktree");
        await withRetries(async () => createWorktree(descriptor.repo, wt, `task/${descriptor.id}`, descriptor.baseBranch),
            { retries: config.retryProvisioner, backoffMs: 5000, label: "worktree" });
        log("provisioning: install deps");
        await withRetries(async () => installDependencies(wt),
            { retries: config.retryProvisioner, backoffMs: 5000, label: "install" });

        const bundleId = await readBundleId(wt);

        log(`provisioning: boot ios sim ${slot.deviceId}`);
        await withRetries(async () => bootIosSimulator(slot.deviceId, config.readinessTimeouts.deviceBootSec),
            { retries: config.retryProvisioner, backoffMs: 5000, label: "sim boot" });

        log(`provisioning: start metro on :${assignedMetroPort}`);
        await withRetries(async () => startMetro(wt, assignedMetroPort, config.readinessTimeouts.metroReadySec, metroSessionName),
            { retries: config.retryProvisioner, backoffMs: 5000, label: "metro" });

        descriptor.assignedMetroPort = assignedMetroPort;
        writeDescriptor(join(PATHS.queue.running, `${descriptor.id}.json`), descriptor);
        log(`metro ready on :${assignedMetroPort}`);

        const fingerprint = nativeFingerprint(wt, assignedMetroPort);
        const cachedFp = getCachedFingerprint(slot.deviceId, bundleId, assignedMetroPort);
        const installed = isAppInstalledIos(slot.deviceId, bundleId);
        const forceRebuild = descriptor.forceRebuild ?? false;
        const canSkipBuild = !forceRebuild && installed && cachedFp === fingerprint;

        if (canSkipBuild) {
            log(`skipping rebuild: app already installed and native fingerprint matches (${fingerprint.slice(0, 12)})`);
        } else {
            const reason = forceRebuild ? "forceRebuild=true"
                : !installed ? "app not installed"
                : !cachedFp ? "no cached fingerprint"
                : "native fingerprint changed";
            log(`provisioning: rebuild required (${reason})`);
            log(`provisioning: uninstall app ${bundleId}`);
            uninstallApp(slot.deviceId, bundleId);
            log("provisioning: pod install");
            await withRetries(async () => installIosPods(wt),
                { retries: config.retryProvisioner, backoffMs: 5000, label: "pod install" });
            log("provisioning: build & install app");
            await withRetries(async () => buildAndInstall(wt, slot.deviceId, assignedMetroPort, bundleId, config.readinessTimeouts.appInstallSec),
                { retries: config.retryProvisioner, backoffMs: 5000, label: "build" });
            setCachedFingerprint(slot.deviceId, bundleId, assignedMetroPort, fingerprint);
        }

        // Always launch — simctl launch is idempotent and brings the app to
        // the foreground whether we just installed it or skipped the rebuild.
        // The app expects Metro on whatever port was baked in at build time
        // (8081 by default — see the launchApp doc comment for the Phase 2
        // implications).
        log(`launching app ${bundleId}`);
        launchApp(slot.deviceId, bundleId);

        // Run agent (headless)
        const userPrompt = readFileSync(descriptor.promptFile, "utf8");
        const composed = renderPrompt({
            userPrompt,
            vars: {
                worktreePath: wt,
                platform: "ios",
                deviceId: slot.deviceId,
                metroPort: assignedMetroPort,
                bundleId,
            },
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

        // Commit (always) + push (optional)
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

        if (sessionId) {
            log(`resume any time: cd ${wt} && claude --resume ${sessionId}`);
        }

        if (config.notifications.macos) {
            const lines: string[] = [`Metro: :${assignedMetroPort}`];
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
        // Headless runner spawns no extra side processes besides Metro,
        // which still runs in its own tmux session for the worker's lifetime.
        stopMetro(metroSessionName, assignedMetroPort);
    }
}
