import { spawnSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pollUntil } from "./readiness.js";
import * as tmux from "../runner/tmux.js";

export interface IosProvisionInput {
    udid: string;
    metroPort: number;
    worktreePath: string;
    bundleId: string;
    timeouts: { deviceBootSec: number; metroReadySec: number; appInstallSec: number };
    metroSessionName: string; // e.g. execbro-metro-<taskId>
}

export async function bootIosSimulator(udid: string, timeoutSec: number): Promise<void> {
    spawnSync("xcrun", ["simctl", "boot", udid], { encoding: "utf8" });
    // simctl boot returns 0 even if already booted; bootstatus blocks until ready.
    await pollUntil(async () => {
        const r = spawnSync("xcrun", ["simctl", "bootstatus", udid], { encoding: "utf8", timeout: 5000 });
        if (r.status === 0) return true;
        return null;
    }, { timeoutMs: timeoutSec * 1000, intervalMs: 2000, label: `ios sim boot ${udid}` });
}

export function uninstallApp(udid: string, bundleId: string): void {
    spawnSync("xcrun", ["simctl", "uninstall", udid, bundleId], { encoding: "utf8" });
    // Ignore failure; app may not be installed.
}

function killProcessOnPort(port: number): void {
    // lsof -ti :<port> prints just the PID(s); kill them. Best-effort.
    const r = spawnSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" });
    const pids = r.stdout.split("\n").map(s => s.trim()).filter(Boolean);
    for (const pid of pids) {
        spawnSync("kill", ["-9", pid], { encoding: "utf8" });
    }
}

export async function startMetro(
    worktreePath: string,
    port: number,
    timeoutSec: number,
    metroSessionName: string,
): Promise<void> {
    if (tmux.sessionExists(metroSessionName)) tmux.killSession(metroSessionName);
    // Belt-and-suspenders: free the port if a zombie process is still holding it
    // (stale Metro from a previous failed run, etc.).
    killProcessOnPort(port);
    tmux.newDetachedSession(metroSessionName, worktreePath);
    tmux.sendKeys(
        metroSessionName,
        `RCT_METRO_PORT=${port} npx react-native start --port ${port} --reset-cache`,
        true,
    );
    await pollUntil(async () => {
        try {
            const r = spawnSync("curl", ["-sf", `http://localhost:${port}/status`], { encoding: "utf8" });
            return r.status === 0 ? true : null;
        } catch { return null; }
    }, { timeoutMs: timeoutSec * 1000, intervalMs: 2000, label: `metro ready on :${port}` });
}

export function stopMetro(metroSessionName: string, port: number): void {
    if (tmux.sessionExists(metroSessionName)) tmux.killSession(metroSessionName);
    // Tmux kill doesn't always reap the child Metro process cleanly.
    killProcessOnPort(port);
}

/**
 * Run `pod install` (via bundler if Gemfile present) inside the worktree's ios/ dir.
 * No-op if there's no ios/ or no Podfile (e.g. Expo managed workflow).
 *
 * Modern RN templates use bundler, so we detect ios/Gemfile or repo-root Gemfile
 * and prefer `bundle exec pod install`. Falls back to bare `pod install`.
 */
export function installIosPods(worktreePath: string): void {
    const iosDir = join(worktreePath, "ios");
    if (!existsSync(iosDir)) return;
    if (!existsSync(join(iosDir, "Podfile"))) return;

    const useBundler =
        existsSync(join(worktreePath, "Gemfile")) ||
        existsSync(join(iosDir, "Gemfile"));

    if (useBundler) {
        // Ensure gems are installed before invoking bundler.
        execSync("bundle install", { cwd: worktreePath, stdio: "inherit" });
        execSync("bundle exec pod install", { cwd: iosDir, stdio: "inherit" });
    } else {
        execSync("pod install", { cwd: iosDir, stdio: "inherit" });
    }
}

export async function buildAndInstall(
    worktreePath: string,
    udid: string,
    metroPort: number,
    bundleId: string,
    timeoutSec: number,
): Promise<void> {
    // --no-packager: we already started Metro on metroPort; otherwise the CLI
    // detects the existing Metro and prompts interactively for an alternate port,
    // which hangs forever in non-interactive mode.
    execSync(`RCT_METRO_PORT=${metroPort} npx react-native run-ios --udid ${udid} --no-packager`, {
        cwd: worktreePath, stdio: "inherit",
    });
    await pollUntil(async () => {
        const r = spawnSync("xcrun", ["simctl", "listapps", udid], { encoding: "utf8" });
        return r.stdout.includes(bundleId) ? true : null;
    }, { timeoutMs: timeoutSec * 1000, intervalMs: 2000, label: `app install ${bundleId}` });
}
