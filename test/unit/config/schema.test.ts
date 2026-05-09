import { ConfigSchema } from "../../../src/config/schema.js";

describe("ConfigSchema", () => {
    it("accepts a valid Phase 1 iOS-only config", () => {
        const valid = {
            slots: [
                { id: 1, platform: "ios", deviceId: "ABC-123-UDID", metroPort: 8082 },
            ],
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

    it("rejects a slot with platform other than ios in Phase 1", () => {
        const invalid = {
            slots: [{ id: 1, platform: "windows", deviceId: "x", metroPort: 8082 }],
        };
        expect(() => ConfigSchema.parse(invalid)).toThrow();
    });

    it("applies defaults when optional fields are omitted", () => {
        const minimal = {
            slots: [{ id: 1, platform: "ios", deviceId: "X", metroPort: 8082 }],
        };
        const parsed = ConfigSchema.parse(minimal);
        expect(parsed.retryProvisioner).toBe(2);
        expect(parsed.readinessTimeouts.deviceBootSec).toBe(120);
    });
});
