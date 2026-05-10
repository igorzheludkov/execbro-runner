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
    await pollUntil(async () => {
        const wait = spawnSync("adb", ["-s", deviceId, "wait-for-device"], { encoding: "utf8", timeout: 5000 });
        if (wait.status !== 0) return null;
        const r = spawnSync("adb", ["-s", deviceId, "shell", "getprop", "sys.boot_completed"], {
            encoding: "utf8", timeout: 5000,
        });
        if (r.status !== 0) return null;
        return parseBootCompleted(r.stdout) ? true : null;
    }, { timeoutMs: timeoutSec * 1000, intervalMs: 2000, label: `android boot ${avdName}` });
}

export function uninstallApp(deviceId: string, packageName: string): void {
    spawnSync("adb", ["-s", deviceId, "uninstall", packageName], { encoding: "utf8" });
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
