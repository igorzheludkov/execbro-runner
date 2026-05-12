import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

function execbroRoot(): string {
    return process.env.EXECBRO_HOME ?? join(homedir(), ".execbro");
}

function cachePath(): string {
    return join(execbroRoot(), "cache", "installed.json");
}

function key(deviceId: string, bundleId: string): string {
    return `${deviceId}::${bundleId}`;
}

function readCache(): Record<string, string> {
    const path = cachePath();
    if (!existsSync(path)) return {};
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return {};
    }
}

function writeCache(cache: Record<string, string>): void {
    const path = cachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache, null, 2), "utf8");
}

export function getCachedFingerprint(deviceId: string, bundleId: string): string | null {
    return readCache()[key(deviceId, bundleId)] ?? null;
}

export function setCachedFingerprint(deviceId: string, bundleId: string, fingerprint: string): void {
    const cache = readCache();
    cache[key(deviceId, bundleId)] = fingerprint;
    writeCache(cache);
}

/**
 * `onProbeFailure`, when given, is invoked with a one-line diagnostic if
 * the underlying CLI returns non-zero. The check still resolves to false
 * (the app is not provably installed), but the caller now learns *why*
 * the probe failed instead of silently treating it as a clean negative —
 * which previously made flaky/transitional sim states look like
 * cache-misses and triggered redundant rebuilds.
 */
export function isAppInstalledIos(
    udid: string,
    bundleId: string,
    onProbeFailure?: (msg: string) => void,
): boolean {
    // 10s timeout: simctl listapps occasionally wedges on flaky/transitional sims.
    // r.status === null on timeout (process killed by SIGTERM); we surface that
    // distinctly so the diagnostic line says "timeout" rather than "exit null".
    const r = spawnSync("xcrun", ["simctl", "listapps", udid], { encoding: "utf8", timeout: 10_000 });
    if (r.status !== 0) {
        const reason = r.status === null
            ? `simctl listapps ${udid} timed out after 10s`
            : `simctl listapps ${udid} exit ${r.status}${r.stderr ? `: ${r.stderr.trim()}` : ""}`;
        onProbeFailure?.(reason);
        return false;
    }
    return r.stdout.includes(bundleId);
}

type SpawnSyncFn = typeof spawnSync;

/**
 * Returns true iff `adb -s <id> shell pm list packages` lists the exact
 * package name. Lines have the shape `package:<id>`, and substrings of
 * other package names must NOT match — `com.example.myapp` is not
 * present in a system that only has `com.example.myapp.test`.
 *
 * `spawnFnInjected` is for tests; production passes nothing and the real
 * spawnSync is used. `onProbeFailure` is the same diagnostic hook as
 * isAppInstalledIos — see that function for the rationale.
 */
export function isAppInstalledAndroid(
    deviceId: string,
    packageName: string,
    spawnFnInjected?: SpawnSyncFn,
    onProbeFailure?: (msg: string) => void,
): boolean {
    const spawnFn = spawnFnInjected ?? spawnSync;
    // 10s timeout: adb shell can hang on offline/zombie devices.
    const r = spawnFn(
        "adb",
        ["-s", deviceId, "shell", "pm", "list", "packages"],
        { encoding: "utf8", timeout: 10_000 },
    );
    if (r.status !== 0) {
        const reason = r.status === null
            ? `adb pm list packages on ${deviceId} timed out after 10s`
            : `adb pm list packages on ${deviceId} exit ${r.status}${r.stderr ? `: ${String(r.stderr).trim()}` : ""}`;
        onProbeFailure?.(reason);
        return false;
    }
    const lines = String(r.stdout).split("\n").map(l => l.trim());
    return lines.includes(`package:${packageName}`);
}

/**
 * Returns true iff the app is currently running on the iOS sim, by checking
 * `simctl spawn <udid> launchctl list` for the bundle id.
 *
 * Running ≠ paired with a Metro: even if the user's app connects to the
 * default Metro on :8081 (no `RCT_jsLocation` written), the process is
 * present in launchctl. This makes the slot picker / busy probe robust to
 * the common "I'm using this sim manually" case where the dev started the
 * app via Xcode or `react-native run-ios` without the dev menu's Configure
 * Bundler step.
 *
 * Returns false on any failure (incl. timeout or sim not booted) — the
 * caller treats that as "no evidence app is running".
 */
export function isAppRunningIos(udid: string, bundleId: string): boolean {
    const r = spawnSync(
        "xcrun",
        ["simctl", "spawn", udid, "launchctl", "list"],
        { encoding: "utf8", timeout: 10_000 },
    );
    if (r.status !== 0) return false;
    return r.stdout.includes(bundleId);
}

/**
 * Returns true iff the app process is currently running on the Android
 * device, by checking `pidof <packageName>`. Returns false on any failure
 * (offline device, timeout) — caller treats as "no evidence".
 */
export function isAppRunningAndroid(
    deviceId: string,
    packageName: string,
    spawnFnInjected?: SpawnSyncFn,
): boolean {
    const spawnFn = spawnFnInjected ?? spawnSync;
    const r = spawnFn(
        "adb",
        ["-s", deviceId, "shell", "pidof", packageName],
        { encoding: "utf8", timeout: 10_000 },
    );
    if (r.status !== 0) return false;
    return String(r.stdout).trim().length > 0;
}
