import { spawnSync, execSync } from "node:child_process";
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

export async function startMetro(
    worktreePath: string,
    port: number,
    timeoutSec: number,
    metroSessionName: string,
): Promise<void> {
    if (tmux.sessionExists(metroSessionName)) tmux.killSession(metroSessionName);
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

export async function buildAndInstall(
    worktreePath: string,
    udid: string,
    metroPort: number,
    bundleId: string,
    timeoutSec: number,
): Promise<void> {
    execSync(`RCT_METRO_PORT=${metroPort} npx react-native run-ios --udid ${udid}`, {
        cwd: worktreePath, stdio: "inherit",
    });
    await pollUntil(async () => {
        const r = spawnSync("xcrun", ["simctl", "listapps", udid], { encoding: "utf8" });
        return r.stdout.includes(bundleId) ? true : null;
    }, { timeoutMs: timeoutSec * 1000, intervalMs: 2000, label: `app install ${bundleId}` });
}
