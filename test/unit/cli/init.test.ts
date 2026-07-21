import type { DiscoveredDevice } from "../../../src/cli/devices/discover.js";
import { buildSlots, mergeConfig, summarize } from "../../../src/cli/commands/init.js";

const ios = (n: string, id: string): DiscoveredDevice => ({
    platform: "ios", name: n, identifier: id, runtime: "iOS 17", booted: false,
});
const android = (n: string): DiscoveredDevice => ({
    platform: "android", name: n, identifier: n, runtime: "AVD", booted: false,
});

describe("buildSlots", () => {
    it("emits one slot per device, ids starting at 1, iOS before Android in input order", () => {
        const slots = buildSlots([ios("iPhone 14", "UDID-A")], [android("Pixel_9")]);
        expect(slots).toEqual([
            { id: 1, platform: "ios", deviceId: "UDID-A" },
            { id: 2, platform: "android", deviceId: "Pixel_9", androidConsolePort: 5554 },
        ]);
    });

    it("auto-assigns even Android console ports starting at 5554", () => {
        const slots = buildSlots([], [android("A"), android("B"), android("C")]);
        expect(slots.map(s => s.androidConsolePort)).toEqual([5554, 5556, 5558]);
    });

    it("does not allocate Android ports when there are no Android devices", () => {
        const slots = buildSlots([ios("iPhone 14", "UDID-A"), ios("iPad", "UDID-B")], []);
        expect(slots).toEqual([
            { id: 1, platform: "ios", deviceId: "UDID-A" },
            { id: 2, platform: "ios", deviceId: "UDID-B" },
        ]);
    });

    it("returns an empty array when no devices are discovered", () => {
        expect(buildSlots([], [])).toEqual([]);
    });

    it("preserves discovery order within each platform", () => {
        const slots = buildSlots(
            [ios("Air", "UDID-1"), ios("14", "UDID-2"), ios("iPad", "UDID-3")],
            [],
        );
        expect(slots.map(s => s.deviceId)).toEqual(["UDID-1", "UDID-2", "UDID-3"]);
    });
});

describe("mergeConfig", () => {
    it("replaces slots, preserves other top-level fields", () => {
        const existing = { pushOnDone: true, slots: [{ id: 99, platform: "ios", deviceId: "OLD" }] };
        const newSlots = [{ id: 1, platform: "ios" as const, deviceId: "NEW" }];
        const merged = mergeConfig(existing, newSlots);
        expect(merged).toEqual({
            pushOnDone: true,
            slots: [{ id: 1, platform: "ios", deviceId: "NEW" }],
        });
    });

    it("works on an empty starting object", () => {
        const newSlots = [{ id: 1, platform: "ios" as const, deviceId: "U" }];
        expect(mergeConfig({}, newSlots)).toEqual({ slots: newSlots });
    });

    it("preserves nested fields like notifications.slackWebhook", () => {
        const existing = {
            notifications: { macos: false, slackWebhook: "https://hooks.example/x" },
            slots: [],
        };
        const merged = mergeConfig(existing, []);
        expect(merged.notifications).toEqual({ macos: false, slackWebhook: "https://hooks.example/x" });
        expect(merged.slots).toEqual([]);
    });

    it("carries a rediscovered device's enabled: false across regeneration", () => {
        const existing = {
            slots: [{ id: 5, platform: "android", deviceId: "Pixel_9", enabled: false }],
        };
        const newSlots = [{ id: 1, platform: "android" as const, deviceId: "Pixel_9" }];
        const merged = mergeConfig(existing, newSlots);
        expect(merged.slots).toEqual([{ id: 1, platform: "android", deviceId: "Pixel_9", enabled: false }]);
    });

    it("carries a rediscovered device's enabled: true across regeneration too (explicit, not just default)", () => {
        const existing = {
            slots: [{ id: 5, platform: "ios", deviceId: "UDID-1", enabled: true }],
        };
        const newSlots = [{ id: 1, platform: "ios" as const, deviceId: "UDID-1" }];
        const merged = mergeConfig(existing, newSlots);
        expect(merged.slots).toEqual([{ id: 1, platform: "ios", deviceId: "UDID-1", enabled: true }]);
    });

    it("does not add an enabled field for a genuinely new device", () => {
        const existing = { slots: [{ id: 5, platform: "ios", deviceId: "OTHER", enabled: false }] };
        const newSlots = [{ id: 1, platform: "ios" as const, deviceId: "BRAND-NEW" }];
        const merged = mergeConfig(existing, newSlots);
        expect(merged.slots).toEqual([{ id: 1, platform: "ios", deviceId: "BRAND-NEW" }]);
    });

    it("ignores an old slot's enabled field when the old config predates it (no enabled key at all)", () => {
        const existing = { slots: [{ id: 5, platform: "ios", deviceId: "UDID-1" }] };
        const newSlots = [{ id: 1, platform: "ios" as const, deviceId: "UDID-1" }];
        const merged = mergeConfig(existing, newSlots);
        expect(merged.slots).toEqual([{ id: 1, platform: "ios", deviceId: "UDID-1" }]);
    });
});

describe("summarize", () => {
    it("counts iOS and Android slots", () => {
        const slots = [
            { id: 1, platform: "ios" as const, deviceId: "A" },
            { id: 2, platform: "ios" as const, deviceId: "B" },
            { id: 3, platform: "android" as const, deviceId: "P", androidConsolePort: 5554 },
        ];
        expect(summarize(slots)).toEqual({ total: 3, ios: 2, android: 1 });
    });

    it("returns zeros for empty input", () => {
        expect(summarize([])).toEqual({ total: 0, ios: 0, android: 0 });
    });
});

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "../../../src/cli/commands/init.js";
import * as discover from "../../../src/cli/devices/discover.js";

describe("runInit", () => {
    let home: string;
    let originalEnv: string | undefined;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), "execbro-init-"));
        originalEnv = process.env.EXECBRO_HOME;
        process.env.EXECBRO_HOME = home;
    });

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.EXECBRO_HOME;
        else process.env.EXECBRO_HOME = originalEnv;
        rmSync(home, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    it("writes a fresh config when --yes is passed and no existing config is present", async () => {
        jest.spyOn(discover, "listIosDevices").mockReturnValue([
            { platform: "ios", name: "iPhone 14", identifier: "UDID-1", runtime: "iOS 17", booted: false },
        ]);
        jest.spyOn(discover, "listAndroidDevices").mockReturnValue([
            { platform: "android", name: "Pixel_9", identifier: "Pixel_9", runtime: "AVD", booted: false },
        ]);

        await runInit({ yes: true });

        const path = join(home, "config.json");
        expect(existsSync(path)).toBe(true);
        const written = JSON.parse(readFileSync(path, "utf8"));
        expect(written.slots).toEqual([
            { id: 1, platform: "ios", deviceId: "UDID-1" },
            { id: 2, platform: "android", deviceId: "Pixel_9", androidConsolePort: 5554 },
        ]);
    });

    it("preserves existing top-level fields when merging", async () => {
        writeFileSync(
            join(home, "config.json"),
            JSON.stringify({
                pushOnDone: true,
                notifications: { macos: false, slackWebhook: null },
                slots: [{ id: 99, platform: "ios", deviceId: "STALE" }],
            }, null, 4),
        );
        jest.spyOn(discover, "listIosDevices").mockReturnValue([
            { platform: "ios", name: "iPhone 14", identifier: "UDID-1", runtime: "iOS 17", booted: false },
        ]);
        jest.spyOn(discover, "listAndroidDevices").mockReturnValue([]);

        await runInit({ yes: true });

        const written = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
        expect(written.pushOnDone).toBe(true);
        expect(written.notifications).toEqual({ macos: false, slackWebhook: null });
        expect(written.slots).toEqual([{ id: 1, platform: "ios", deviceId: "UDID-1" }]);
    });

    it("throws when no devices are detected", async () => {
        jest.spyOn(discover, "listIosDevices").mockReturnValue([]);
        jest.spyOn(discover, "listAndroidDevices").mockReturnValue([]);
        await expect(runInit({ yes: true })).rejects.toThrow(/no devices detected/i);
    });

    it("backs up an unparseable existing config and proceeds with a fresh merge base", async () => {
        writeFileSync(join(home, "config.json"), "{ this is not json");
        jest.spyOn(discover, "listIosDevices").mockReturnValue([
            { platform: "ios", name: "iPhone", identifier: "U", runtime: "iOS 17", booted: false },
        ]);
        jest.spyOn(discover, "listAndroidDevices").mockReturnValue([]);

        await runInit({ yes: true });

        expect(existsSync(join(home, "config.json.bak"))).toBe(true);
        const written = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
        expect(written.slots).toHaveLength(1);
    });
});
