import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDevices } from "../../../src/cli/commands/devices.js";

describe("runDevices --enable / --disable", () => {
    let homeDir: string;
    let configPath: string;

    beforeEach(() => {
        homeDir = mkdtempSync(join(tmpdir(), "execbro-home-"));
        process.env.EXECBRO_HOME = homeDir;
        configPath = join(homeDir, "config.json");
    });
    afterEach(() => {
        rmSync(homeDir, { recursive: true, force: true });
        delete process.env.EXECBRO_HOME;
    });

    function writeConfig(config: Record<string, unknown>) {
        mkdirSync(homeDir, { recursive: true });
        writeFileSync(configPath, JSON.stringify(config, null, 4));
    }

    it("throws when no config.json exists yet", async () => {
        await expect(runDevices({ disable: "Medium_Phone" }))
            .rejects.toThrow(/run "execbro-task init" first/i);
    });

    it("throws when the named device isn't in any slot", async () => {
        writeConfig({ slots: [{ id: 1, platform: "android", deviceId: "Pixel_9" }] });
        await expect(runDevices({ disable: "Nonexistent" }))
            .rejects.toThrow(/no slot with deviceId "Nonexistent"/i);
    });

    it("--disable sets enabled: false on the matching slot, leaving other fields untouched", async () => {
        writeConfig({
            pushOnDone: true,
            slots: [
                { id: 1, platform: "android", deviceId: "Medium_Phone", androidConsolePort: 5554 },
                { id: 2, platform: "android", deviceId: "Pixel_9", androidConsolePort: 5556 },
            ],
        });
        await runDevices({ disable: "Pixel_9" });
        const written = JSON.parse(readFileSync(configPath, "utf8"));
        expect(written.pushOnDone).toBe(true);
        expect(written.slots).toEqual([
            { id: 1, platform: "android", deviceId: "Medium_Phone", androidConsolePort: 5554 },
            { id: 2, platform: "android", deviceId: "Pixel_9", androidConsolePort: 5556, enabled: false },
        ]);
    });

    it("--enable sets enabled: true on the matching slot", async () => {
        writeConfig({
            slots: [{ id: 1, platform: "android", deviceId: "Pixel_9", enabled: false }],
        });
        await runDevices({ enable: "Pixel_9" });
        const written = JSON.parse(readFileSync(configPath, "utf8"));
        expect(written.slots[0].enabled).toBe(true);
    });
});
