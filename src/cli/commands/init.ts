import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as readline from "node:readline";
import { listIosDevices, listAndroidDevices, type DiscoveredDevice } from "../devices/discover.js";

export interface BuiltSlot {
    id: number;
    platform: "ios" | "android";
    deviceId: string;
    androidConsolePort?: number;
}

const ANDROID_CONSOLE_PORT_BASE = 5554;
const ANDROID_CONSOLE_PORT_STEP = 2;

/**
 * Build a slot list from discovered iOS sims and Android AVDs. iOS slots
 * come first, in the order returned by discovery; Android slots follow,
 * with `androidConsolePort` auto-assigned starting at 5554 and stepping
 * by 2 (must be even per the Android emulator console protocol).
 */
export function buildSlots(
    iosDevices: DiscoveredDevice[],
    androidDevices: DiscoveredDevice[],
): BuiltSlot[] {
    const slots: BuiltSlot[] = [];
    let nextId = 1;
    for (const dev of iosDevices) {
        slots.push({ id: nextId++, platform: "ios", deviceId: dev.identifier });
    }
    for (let i = 0; i < androidDevices.length; i++) {
        slots.push({
            id: nextId++,
            platform: "android",
            deviceId: androidDevices[i].identifier,
            androidConsolePort: ANDROID_CONSOLE_PORT_BASE + i * ANDROID_CONSOLE_PORT_STEP,
        });
    }
    return slots;
}

/**
 * Merge new slots into an existing parsed config object, replacing the
 * `slots` field while preserving every other top-level entry verbatim.
 * Input is plain JSON (not Zod-parsed), so unknown fields survive — the
 * runtime config-load step is what enforces the strict schema.
 *
 * A rediscovered device (matched by `deviceId`) keeps its existing
 * `enabled` value — otherwise every `init` re-run would silently
 * re-activate a slot the user deliberately disabled. Genuinely new
 * devices get no `enabled` field at all (schema defaults it to `true`).
 */
export function mergeConfig(
    existing: Record<string, unknown>,
    newSlots: BuiltSlot[],
): Record<string, unknown> {
    const oldSlots = Array.isArray(existing.slots) ? existing.slots as Record<string, unknown>[] : [];
    const oldEnabledByDeviceId = new Map(
        oldSlots
            .filter(s => typeof s.enabled === "boolean")
            .map(s => [s.deviceId, s.enabled as boolean]),
    );
    const slots = newSlots.map(slot => {
        const enabled = oldEnabledByDeviceId.get(slot.deviceId);
        return enabled === undefined ? slot : { ...slot, enabled };
    });
    return { ...existing, slots };
}

export interface SlotSummary {
    total: number;
    ios: number;
    android: number;
}

export function summarize(slots: BuiltSlot[]): SlotSummary {
    return slots.reduce<SlotSummary>(
        (acc, s) => {
            acc.total++;
            if (s.platform === "ios") acc.ios++;
            else acc.android++;
            return acc;
        },
        { total: 0, ios: 0, android: 0 },
    );
}

export interface InitOptions {
    yes?: boolean;
}

function execbroRoot(): string {
    return process.env.EXECBRO_HOME ?? join(homedir(), ".execbro");
}

function configPath(): string {
    return join(execbroRoot(), "config.json");
}

async function promptYesNo(question: string): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await new Promise<string>(resolve => rl.question(question, resolve));
        const trimmed = answer.trim();
        if (trimmed.length === 0) return true;
        return !/^n/i.test(trimmed);
    } finally {
        rl.close();
    }
}

function readExistingConfig(path: string): Record<string, unknown> {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf8");
    try {
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        const backup = `${path}.bak`;
        copyFileSync(path, backup);
        console.warn(`existing config.json is not valid JSON; backing it up to ${backup} and starting fresh`);
        return {};
    }
}

function printDiscoveryTable(ios: DiscoveredDevice[], android: DiscoveredDevice[]): void {
    console.log("Discovered devices:");
    for (const d of [...ios, ...android]) {
        const platform = d.platform.padEnd(9);
        const name = d.name.padEnd(30).slice(0, 30);
        const extra = d.platform === "android" && d.runningEmulatorId ? ` (${d.runningEmulatorId})` : "";
        console.log(`  ${platform} ${name} ${d.identifier}${extra}`);
    }
}

export async function runInit(opts: InitOptions): Promise<void> {
    const ios = listIosDevices();
    const android = listAndroidDevices();
    if (ios.length === 0 && android.length === 0) {
        throw new Error("No devices detected. Boot a simulator or create an AVD first.");
    }

    const slots = buildSlots(ios, android);
    const path = configPath();
    const existing = readExistingConfig(path);
    const merged = mergeConfig(existing, slots);

    printDiscoveryTable(ios, android);
    console.log("");
    console.log(`Proposed ${path}:`);
    console.log(JSON.stringify(merged, null, 4));
    console.log("");

    if (!opts.yes) {
        const confirmed = await promptYesNo(`Write to ${path}? [Y/n] `);
        if (!confirmed) {
            console.log("Aborted; nothing written.");
            return;
        }
    }

    mkdirSync(execbroRoot(), { recursive: true });
    writeFileSync(path, JSON.stringify(merged, null, 4) + "\n", "utf8");

    const counts = summarize(slots);
    console.log(`Wrote ${counts.total} slots (${counts.ios} iOS, ${counts.android} Android) to ${path}`);
}
