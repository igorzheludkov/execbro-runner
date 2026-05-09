import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfigFromPath } from "../../../src/config/loader.js";

describe("loadConfigFromPath", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-test-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("loads and validates a valid config file", () => {
        const path = join(dir, "config.json");
        writeFileSync(path, JSON.stringify({
            slots: [{ id: 1, platform: "ios", deviceId: "X", metroPort: 8082 }],
        }));
        const config = loadConfigFromPath(path);
        expect(config.slots).toHaveLength(1);
        expect(config.retryProvisioner).toBe(2);
    });

    it("throws a clear error if the file does not exist", () => {
        expect(() => loadConfigFromPath(join(dir, "missing.json"))).toThrow(/not found/i);
    });

    it("throws a clear error if the file contains invalid JSON", () => {
        const path = join(dir, "config.json");
        writeFileSync(path, "{ not json");
        expect(() => loadConfigFromPath(path)).toThrow(/invalid json/i);
    });

    it("throws a clear error if validation fails", () => {
        const path = join(dir, "config.json");
        writeFileSync(path, JSON.stringify({ slots: [] }));
        expect(() => loadConfigFromPath(path)).toThrow(/at least 1/i);
    });
});
