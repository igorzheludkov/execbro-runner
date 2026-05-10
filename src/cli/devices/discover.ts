import { execSync } from "node:child_process";

export interface DiscoveredDevice {
    platform: "ios" | "android";
    name: string;
    identifier: string;
    runtime: string;
    booted: boolean;
    /** For Android, the running emulator slot identifier (e.g. "emulator-5554") when booted. Undefined for iOS or unbooted Android. */
    runningEmulatorId?: string;
}

export function listIosDevices(): DiscoveredDevice[] {
    let raw: string;
    try {
        raw = execSync("xcrun simctl list devices --json", { stdio: ["pipe", "pipe", "ignore"] }).toString();
    } catch {
        return []; // Xcode tools not installed
    }
    const data = JSON.parse(raw) as {
        devices: Record<string, Array<{ name: string; udid: string; state: string; isAvailable: boolean }>>;
    };
    const out: DiscoveredDevice[] = [];
    for (const [runtime, devices] of Object.entries(data.devices)) {
        const runtimeShort = runtime.replace("com.apple.CoreSimulator.SimRuntime.", "").replace(/-/g, " ");
        for (const dev of devices) {
            if (!dev.isAvailable) continue;
            out.push({
                platform: "ios",
                name: dev.name,
                identifier: dev.udid,
                runtime: runtimeShort,
                booted: dev.state === "Booted",
            });
        }
    }
    return out;
}

export function listAndroidDevices(): DiscoveredDevice[] {
    let avds: string[] = [];
    try {
        avds = execSync("emulator -list-avds", { stdio: ["pipe", "pipe", "ignore"] })
            .toString().split("\n").map(s => s.trim()).filter(Boolean);
    } catch {
        return [];
    }
    const runningMap = new Map<string, string>();
    try {
        const adb = execSync("adb devices -l", { stdio: ["pipe", "pipe", "ignore"] }).toString();
        for (const line of adb.split("\n").slice(1)) {
            const m = line.match(/^(emulator-\d+)\s+device.*?model:(\S+)/);
            if (m) runningMap.set(m[2], m[1]);
        }
    } catch { /* adb not available */ }
    return avds.map(name => ({
        platform: "android" as const,
        name,
        identifier: name,
        runtime: "AVD",
        booted: runningMap.has(name),
        runningEmulatorId: runningMap.get(name),
    }));
}
