import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { listIosDevices, listAndroidDevices } from "../devices/discover.js";

export interface DevicesOptions {
    enable?: string;
    disable?: string;
}

function execbroRoot(): string {
    return process.env.EXECBRO_HOME ?? join(homedir(), ".execbro");
}

function configPath(): string {
    return join(execbroRoot(), "config.json");
}

interface RawSlot {
    id: number;
    deviceId: string;
    enabled?: boolean;
    [key: string]: unknown;
}

/**
 * Toggle `enabled` on one configured slot, matched by `deviceId` (the AVD
 * name for Android, the UDID for iOS — same identifier config.json already
 * uses). Reads/writes config.json as plain JSON, same style as
 * `cli/commands/init.ts`'s merge step, so an unrelated field or a value
 * outside the current schema round-trips untouched.
 */
function setSlotEnabled(deviceId: string, enabled: boolean): void {
    const path = configPath();
    if (!existsSync(path)) {
        throw new Error(`No config found at ${path} — run "execbro-task init" first.`);
    }
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const slots: RawSlot[] = Array.isArray(parsed.slots) ? parsed.slots : [];
    const slot = slots.find(s => s.deviceId === deviceId);
    if (!slot) {
        const known = slots.map(s => s.deviceId).join(", ") || "(none configured)";
        throw new Error(
            `No slot with deviceId "${deviceId}" in ${path}. Configured: ${known}. ` +
            `Run "execbro-task devices" to see discoverable names, or "execbro-task init" to (re)generate slots.`,
        );
    }
    slot.enabled = enabled;
    writeFileSync(path, JSON.stringify(parsed, null, 4) + "\n", "utf8");
    console.log(
        `${enabled ? "Enabled" : "Disabled"} slot ${slot.id} (${deviceId}). ` +
        `Restart execbro-worker to pick up the change — config.json is only read at startup.`,
    );
}

export async function runDevices(opts: DevicesOptions = {}): Promise<void> {
    if (opts.enable) return setSlotEnabled(opts.enable, true);
    if (opts.disable) return setSlotEnabled(opts.disable, false);

    const ios = listIosDevices();
    const android = listAndroidDevices();
    const all = [...ios, ...android];

    const path = configPath();
    const configuredByDeviceId = new Map<string, boolean>();
    if (existsSync(path)) {
        try {
            const slots: RawSlot[] = JSON.parse(readFileSync(path, "utf8"))?.slots ?? [];
            for (const s of slots) configuredByDeviceId.set(s.deviceId, s.enabled !== false);
        } catch { /* malformed config — just skip the CONFIG column's annotations */ }
    }

    console.log("PLATFORM  NAME                          IDENTIFIER                              RUNTIME              BOOTED  CONFIG");
    for (const d of all) {
        const name = d.name.padEnd(30).slice(0, 30);
        const id = d.identifier.padEnd(38).slice(0, 38);
        const runtime = d.runtime.padEnd(20).slice(0, 20);
        const booted = (d.booted
            ? `yes${d.runningEmulatorId ? ` (${d.runningEmulatorId})` : ""}`
            : "no"
        ).padEnd(7);
        const configState = configuredByDeviceId.has(d.identifier)
            ? (configuredByDeviceId.get(d.identifier) ? "enabled" : "disabled")
            : "-";
        console.log(`${d.platform.padEnd(9)} ${name} ${id} ${runtime} ${booted} ${configState}`);
    }
}
