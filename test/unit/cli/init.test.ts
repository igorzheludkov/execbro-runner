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
