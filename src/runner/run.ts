import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as tmux from "./tmux.js";
import { renderPrompt } from "./prompt.js";
import { isDone, findNewestTranscript, encodeProjectPath } from "./doneDetection.js";
import { withRetries, createWorktree, installDependencies } from "../provisioner/shared.js";
import { bootIosSimulator, uninstallApp, startMetro, buildAndInstall } from "../provisioner/ios.js";
import { commitIfDirty, pushBranch, getRemoteUrl, buildBitbucketPrUrl } from "../bitbucket/push.js";
import { notifyMacos } from "../notify/macos.js";
import type { TaskDescriptor } from "../queue/descriptor.js";
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
    config: Config,
): Promise<RunOutcome> {
    const wt = worktreePath(descriptor.id);
    const sessionName = tmux.sessionName(descriptor.id);
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

        log(`provisioning: uninstall app ${bundleId}`);
        uninstallApp(slot.deviceId, bundleId);

        log(`provisioning: start metro on :${slot.metroPort}`);
        await withRetries(async () => startMetro(wt, slot.metroPort, config.readinessTimeouts.metroReadySec, metroSessionName),
            { retries: config.retryProvisioner, backoffMs: 5000, label: "metro" });

        log("provisioning: build & install app");
        await withRetries(async () => buildAndInstall(wt, slot.deviceId, slot.metroPort, bundleId, config.readinessTimeouts.appInstallSec),
            { retries: config.retryProvisioner, backoffMs: 5000, label: "build" });

        // Run agent
        log("starting tmux session for agent");
        tmux.newDetachedSession(sessionName, wt);
        tmux.sendKeys(sessionName, "claude", true);
        await new Promise(r => setTimeout(r, 5000)); // wait for Claude to be ready to receive input

        const userPrompt = readFileSync(descriptor.promptFile, "utf8");
        const composed = renderPrompt({
            userPrompt,
            vars: {
                worktreePath: wt,
                platform: "ios",
                deviceId: slot.deviceId,
                metroPort: slot.metroPort,
                bundleId,
            },
        });
        // Use paste-buffer instead of send-keys so embedded newlines do NOT
        // submit partial messages to Claude Code's TUI.
        tmux.pasteText(sessionName, composed);
        tmux.sendKeys(sessionName, "", true); // Enter to submit

        // Wait for done
        log("waiting for agent to finish");
        const projectDir = join(homedir(), ".claude", "projects", encodeProjectPath(wt));
        const sessionStartMs = Date.now();
        const stuckTimeoutMs = config.stuckTimeoutMinutes * 60 * 1000;
        const idleSec = 60;
        let detectedDone = false;
        while (Date.now() - sessionStartMs < stuckTimeoutMs) {
            await new Promise(r => setTimeout(r, 10_000));
            const transcript = findNewestTranscript(projectDir, sessionStartMs);
            if (transcript && isDone({ transcriptPath: transcript, idleSec })) {
                detectedDone = true;
                break;
            }
        }
        if (!detectedDone) {
            log("stuck timeout reached");
            return { status: "failed", reason: "stuck-timeout" };
        }

        // Push
        log("committing and pushing");
        commitIfDirty(wt, `task: ${descriptor.id}`);
        const remoteUrl = getRemoteUrl(wt);
        pushBranch(wt, `task/${descriptor.id}`);
        const prUrl = buildBitbucketPrUrl({ remoteUrl, sourceBranch: `task/${descriptor.id}`, destBranch: descriptor.baseBranch });
        log(`PR URL: ${prUrl}`);

        if (config.notifications.macos) {
            notifyMacos(`ExecBro task done: ${descriptor.id}`, `Click to open PR: ${prUrl}`);
        }
        return { status: "done" };
    } catch (e) {
        log(`task failed: ${(e as Error).message}`);
        if (config.notifications.macos) {
            notifyMacos(`ExecBro task FAILED: ${descriptor.id}`, (e as Error).message);
        }
        return { status: "failed", reason: (e as Error).message };
    } finally {
        // Phase 1: leave worktree + metro session intact for forensics.
        // Kill the agent's tmux session only.
        tmux.killSession(sessionName);
    }
}
