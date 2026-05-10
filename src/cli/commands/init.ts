import type { DiscoveredDevice } from "../devices/discover.js";

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
 */
export function mergeConfig(
    existing: Record<string, unknown>,
    newSlots: BuiltSlot[],
): Record<string, unknown> {
    return { ...existing, slots: newSlots };
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
