import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { jest } from "@jest/globals";
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

describe("loadConfigFromPath legacy field warnings", () => {
    let dir: string;
    let warnSpy: ReturnType<typeof jest.spyOn>;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-loader-"));
        warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        warnSpy.mockRestore();
    });

    it("warns once when a slot still carries a legacy metroPort field", () => {
        const path = join(dir, "config.json");
        writeFileSync(path, JSON.stringify({
            slots: [{ id: 1, platform: "ios", deviceId: "X", metroPort: 8082 }],
        }));
        loadConfigFromPath(path);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect((warnSpy.mock.calls[0]?.[0] as string)).toContain("slot.metroPort is deprecated");
    });

    it("does not warn when slots have no legacy metroPort", () => {
        const path = join(dir, "config.json");
        writeFileSync(path, JSON.stringify({
            slots: [{ id: 1, platform: "ios", deviceId: "X" }],
        }));
        loadConfigFromPath(path);
        expect(warnSpy).not.toHaveBeenCalled();
    });
});
