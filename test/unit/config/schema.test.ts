import { ConfigSchema } from "../../../src/config/schema.js";

describe("ConfigSchema", () => {
    it("accepts a valid Phase 2 iOS-only config (no slot.metroPort)", () => {
        const valid = {
            slots: [{ id: 1, platform: "ios", deviceId: "ABC-123-UDID" }],
            metroPortRange: { from: 8090, to: 8099 },
            shutdownDeviceAfterTask: false,
            stuckTimeoutMinutes: 30,
            retryProvisioner: 2,
            readinessTimeouts: { deviceBootSec: 120, metroReadySec: 60, appInstallSec: 300 },
            notifications: { macos: true, slackWebhook: null },
        };
        expect(() => ConfigSchema.parse(valid)).not.toThrow();
    });

    it("rejects a config with no slots", () => {
        expect(() => ConfigSchema.parse({ slots: [] })).toThrow();
    });

    it("rejects a slot with platform other than ios/android", () => {
        const invalid = {
            slots: [{ id: 1, platform: "windows", deviceId: "x" }],
        };
        expect(() => ConfigSchema.parse(invalid)).toThrow();
    });

    it("applies defaults when optional fields are omitted (incl. metroPortRange)", () => {
        const minimal = {
            slots: [{ id: 1, platform: "ios", deviceId: "X" }],
        };
        const parsed = ConfigSchema.parse(minimal);
        expect(parsed.retryProvisioner).toBe(2);
        expect(parsed.readinessTimeouts.deviceBootSec).toBe(120);
        expect(parsed.metroPortRange).toEqual({ from: 8090, to: 8099 });
    });

    it("accepts a legacy slot with metroPort (kept for back-compat; ignored at runtime)", () => {
        const legacy = {
            slots: [{ id: 1, platform: "ios", deviceId: "X", metroPort: 8082 }],
        };
        expect(() => ConfigSchema.parse(legacy)).not.toThrow();
    });

    it("rejects an inverted metroPortRange (from > to)", () => {
        const bad = {
            slots: [{ id: 1, platform: "ios", deviceId: "X" }],
            metroPortRange: { from: 8099, to: 8090 },
        };
        expect(() => ConfigSchema.parse(bad)).toThrow();
    });

    it("rejects metroPortRange ports outside 1024..65535", () => {
        const bad = {
            slots: [{ id: 1, platform: "ios", deviceId: "X" }],
            metroPortRange: { from: 80, to: 90 },
        };
        expect(() => ConfigSchema.parse(bad)).toThrow();
    });

    it("defaults a slot's enabled to true when omitted (every existing config.json keeps working)", () => {
        const parsed = ConfigSchema.parse({
            slots: [{ id: 1, platform: "ios", deviceId: "X" }],
        });
        expect(parsed.slots[0].enabled).toBe(true);
    });

    it("preserves an explicit enabled: false", () => {
        const parsed = ConfigSchema.parse({
            slots: [{ id: 1, platform: "android", deviceId: "Pixel_9", enabled: false }],
        });
        expect(parsed.slots[0].enabled).toBe(false);
    });

    it("rejects a non-boolean enabled", () => {
        const bad = {
            slots: [{ id: 1, platform: "ios", deviceId: "X", enabled: "no" }],
        };
        expect(() => ConfigSchema.parse(bad)).toThrow();
    });
});
