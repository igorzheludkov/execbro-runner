import { execSync } from "node:child_process";

interface Device {
    platform: "ios" | "android";
    name: string;
    identifier: string;
    runtime: string;
    booted: boolean;
    extra?: string;
}

function listIosDevices(): Device[] {
    const raw = execSync("xcrun simctl list devices --json").toString();
    const data = JSON.parse(raw) as { devices: Record<string, Array<{
        name: string; udid: string; state: string; isAvailable: boolean;
    }>> };
    const out: Device[] = [];
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

function listAndroidDevices(): Device[] {
    let avds: string[] = [];
    try {
        avds = execSync("emulator -list-avds", { stdio: ["pipe", "pipe", "ignore"] })
            .toString().split("\n").map(s => s.trim()).filter(Boolean);
    } catch {
        return []; // Android tools not installed — silently skip in Phase 1
    }
    const runningMap = new Map<string, string>();
    try {
        const adb = execSync("adb devices -l", { stdio: ["pipe", "pipe", "ignore"] }).toString();
        for (const line of adb.split("\n").slice(1)) {
            const m = line.match(/^(emulator-\d+)\s+device.*?model:(\S+)/);
            if (m) runningMap.set(m[2].replace(/_/g, "_"), m[1]);
        }
    } catch { /* adb not available */ }
    return avds.map(name => ({
        platform: "android" as const,
        name,
        identifier: name,
        runtime: "AVD",
        booted: runningMap.has(name),
        extra: runningMap.get(name),
    }));
}

export async function runDevices(): Promise<void> {
    const ios = listIosDevices();
    const android = listAndroidDevices();
    const all = [...ios, ...android];
    console.log("PLATFORM  NAME                          IDENTIFIER                              RUNTIME              BOOTED");
    for (const d of all) {
        const name = d.name.padEnd(30).slice(0, 30);
        const id = d.identifier.padEnd(38).slice(0, 38);
        const runtime = d.runtime.padEnd(20).slice(0, 20);
        const booted = d.booted ? `yes${d.extra ? ` (${d.extra})` : ""}` : "no";
        console.log(`${d.platform.padEnd(9)} ${name} ${id} ${runtime} ${booted}`);
    }
}
