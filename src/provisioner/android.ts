import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn as nodeSpawn, spawnSync, execSync } from "node:child_process";
import { pollUntil } from "./readiness.js";

function readExplicitAndroidPackageName(worktreePath: string): string | null {
    const pkgPath = join(worktreePath, "package.json");
    if (!existsSync(pkgPath)) return null;
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        const id = pkg?.execbro?.androidPackageName;
        return typeof id === "string" && id.length > 0 ? id : null;
    } catch {
        return null;
    }
}

/**
 * Discover the Android application id from android/app/build.gradle, falling
 * back to package.json: execbro.androidPackageName.
 */
export function discoverAndroidPackageName(worktreePath: string): string {
    const gradlePath = join(worktreePath, "android", "app", "build.gradle");
    let autodetectError = `no ${gradlePath}`;
    if (existsSync(gradlePath)) {
        const text = readFileSync(gradlePath, "utf8");
        const m = text.match(/applicationId\s+["']([^"']+)["']/);
        if (m) return m[1];
        autodetectError = `applicationId not found in ${gradlePath}`;
    }
    const explicit = readExplicitAndroidPackageName(worktreePath);
    if (explicit) return explicit;
    throw new Error(
        `Could not determine Android package name. Autodetect: ${autodetectError}. ` +
        `Set "execbro.androidPackageName" in package.json to override.`,
    );
}

export function adbReverseCommand(deviceId: string, port: number): string[] {
    return ["-s", deviceId, "reverse", `tcp:${port}`, `tcp:${port}`];
}

export function adbLaunchCommand(deviceId: string, packageName: string): string[] {
    return [
        "-s", deviceId, "shell", "am", "start",
        "-n", `${packageName}/.MainActivity`,
    ];
}

export function parseBootCompleted(stdout: string): boolean {
    return stdout.trim() === "1";
}

/**
 * Boot an Android emulator on the given AVD + console port and wait for
 * boot completion. The emulator is launched detached so it survives this
 * process; teardown is handled by the runner's optional shutdown step.
 */
export async function bootAndroidEmulator(
    avdName: string,
    consolePort: number,
    timeoutSec: number,
): Promise<void> {
    const deviceId = `emulator-${consolePort}`;
    nodeSpawn(
        "emulator",
        ["-avd", avdName, "-port", String(consolePort), "-no-window", "-no-snapshot-load"],
        { detached: true, stdio: "ignore" },
    ).unref();
    // Phase 1: kernel + adb readiness. `sys.boot_completed=1` means the
    // kernel booted, but does NOT mean ActivityManagerService and Package
    // ManagerService are accepting requests yet. Proceeding here would
    // commonly hit "Too early to start activity" from `am start` and a
    // hung `pm list packages` later in the flow.
    await pollUntil(async () => {
        const wait = spawnSync("adb", ["-s", deviceId, "wait-for-device"], { encoding: "utf8", timeout: 5000 });
        if (wait.status !== 0) return null;
        const r = spawnSync("adb", ["-s", deviceId, "shell", "getprop", "sys.boot_completed"], {
            encoding: "utf8", timeout: 5000,
        });
        if (r.status !== 0) return null;
        return parseBootCompleted(r.stdout) ? true : null;
    }, { timeoutMs: timeoutSec * 1000, intervalMs: 2000, label: `android boot ${avdName}` });
    // Phase 2: services readiness. PMS is up when `pm path android`
    // returns a path; AMS is up when `am get-current-user` returns cleanly.
    await pollUntil(async () => {
        const pm = spawnSync(
            "adb", ["-s", deviceId, "shell", "pm", "path", "android"],
            { encoding: "utf8", timeout: 5000 },
        );
        if (pm.status !== 0 || !pm.stdout.includes("package:")) return null;
        const am = spawnSync(
            "adb", ["-s", deviceId, "shell", "am", "get-current-user"],
            { encoding: "utf8", timeout: 5000 },
        );
        if (am.status !== 0) return null;
        return true;
    }, { timeoutMs: timeoutSec * 1000, intervalMs: 2000, label: `android services ready ${avdName}` });
}

export function uninstallApp(deviceId: string, packageName: string): void {
    // 30s timeout: adb uninstall can wedge on slow / mid-boot devices and
    // would otherwise block the Node event loop (spawnSync is synchronous),
    // serializing parallel provisioning across slots.
    spawnSync("adb", ["-s", deviceId, "uninstall", packageName], { encoding: "utf8", timeout: 30_000 });
}

/**
 * Return host ports currently `adb reverse`-forwarded into this emulator.
 * RN dev mode requires a tcp reverse from device→host on the Metro port,
 * so existing forwards identify the Metro instance(s) the emulator is
 * already paired with. `adb reverse --list` lines look like:
 *   emulator-5554 tcp:8081 tcp:8081
 * We pull the host-side port (the second `tcp:N`).
 */
export function readReverseTunnelHostPorts(deviceId: string): number[] {
    // 10s timeout: adb can hang when a device is unreachable or in offline state.
    const r = spawnSync("adb", ["-s", deviceId, "reverse", "--list"], { encoding: "utf8", timeout: 10_000 });
    if (r.status !== 0) return [];
    const ports: number[] = [];
    for (const line of r.stdout.split("\n")) {
        const m = line.match(/\btcp:\d+\s+tcp:(\d+)\b/);
        if (m) ports.push(Number(m[1]));
    }
    return ports;
}

/**
 * Point the running app at our Metro on `port`. On Android this is a host
 * port forward via adb reverse — Metro stays accessible at localhost:<port>
 * inside the emulator's network namespace.
 */
export function setBundlerLocation(deviceId: string, port: number): void {
    const r = spawnSync("adb", adbReverseCommand(deviceId, port), { encoding: "utf8" });
    if (r.status !== 0) {
        throw new Error(`adb reverse failed for ${deviceId}: ${r.stderr.trim() || r.stdout.trim()}`);
    }
}

export function launchApp(deviceId: string, packageName: string): void {
    const r = spawnSync("adb", adbLaunchCommand(deviceId, packageName), { encoding: "utf8" });
    if (r.status !== 0) {
        throw new Error(`adb shell am start failed for ${packageName}: ${r.stderr.trim() || r.stdout.trim()}`);
    }
}

/**
 * Build & install the Android app via @react-native-community/cli, then
 * poll `pm list packages` until the package shows up. `--no-packager`
 * mirrors the iOS flow: we already started Metro on `port`.
 */
export async function buildAndInstall(
    worktreePath: string,
    deviceId: string,
    metroPort: number,
    packageName: string,
    timeoutSec: number,
): Promise<void> {
    execSync(
        `RCT_METRO_PORT=${metroPort} npx react-native run-android --deviceId ${deviceId} --no-packager`,
        { cwd: worktreePath, stdio: "inherit" },
    );
    await pollUntil(async () => {
        const r = spawnSync("adb", ["-s", deviceId, "shell", "pm", "list", "packages"], { encoding: "utf8" });
        if (r.status !== 0) return null;
        return r.stdout.split("\n").map(l => l.trim()).includes(`package:${packageName}`) ? true : null;
    }, { timeoutMs: timeoutSec * 1000, intervalMs: 2000, label: `android install ${packageName}` });
}
