import type { DiscoveredDevice } from "../../../../src/cli/devices/discover.js";
import { listIosDevices, listAndroidDevices } from "../../../../src/cli/devices/discover.js";

describe("discover.ts module surface", () => {
    it("exports listIosDevices as a callable function", () => {
        expect(typeof listIosDevices).toBe("function");
    });

    it("exports listAndroidDevices as a callable function", () => {
        expect(typeof listAndroidDevices).toBe("function");
    });

    it("DiscoveredDevice type has the expected shape (compile-time check)", () => {
        const sample: DiscoveredDevice = {
            platform: "ios",
            name: "iPhone 15",
            identifier: "ABC-123",
            runtime: "iOS 17.0",
            booted: false,
        };
        expect(sample.platform).toBe("ios");
    });
});
