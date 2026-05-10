import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderPrompt } from "../../../src/runner/prompt.js";

function setupTemplates(home: string) {
    const tdir = join(home, "templates");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(join(tdir, "agent-preamble.md"),
        "Worktree: {{worktreePath}}\nMetro port: {{metroPort}}\nDevice count: {{deviceCount}}\nDevices:\n{{devices}}\n");
    writeFileSync(join(tdir, "verification-suffix-single.md"),
        "Verify on the single device {{deviceId}} ({{platform}}, {{bundleId}}).");
    writeFileSync(join(tdir, "verification-suffix-multi.md"),
        "Verify the change on each of the {{deviceCount}} devices.");
    writeFileSync(join(tdir, "headless-system-prompt.md"), "system");
    return tdir;
}

describe("renderPrompt", () => {
    let home: string;
    let originalEnv: string | undefined;
    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), "execbro-prompt-"));
        setupTemplates(home);
        originalEnv = process.env.EXECBRO_HOME;
        process.env.EXECBRO_HOME = home;
    });
    afterEach(() => {
        if (originalEnv === undefined) delete process.env.EXECBRO_HOME;
        else process.env.EXECBRO_HOME = originalEnv;
        rmSync(home, { recursive: true, force: true });
    });

    it("renders single-device prompt with platform/deviceId/bundleId substituted", () => {
        const out = renderPrompt({
            userPrompt: "Fix the bug.",
            vars: {
                worktreePath: "/wt",
                metroPort: 8092,
                devices: [{ platform: "ios", deviceId: "UDID-1", bundleId: "com.example.MyApp" }],
            },
        });
        expect(out).toContain("Metro port: 8092");
        expect(out).toContain("Device count: 1");
        expect(out).toContain("- ios on UDID-1 (bundle com.example.MyApp)");
        expect(out).toContain("Verify on the single device UDID-1 (ios, com.example.MyApp).");
        expect(out).toContain("Fix the bug.");
    });

    it("renders multi-device prompt with each device listed and the multi suffix", () => {
        const out = renderPrompt({
            userPrompt: "Make the screen identical on both.",
            vars: {
                worktreePath: "/wt",
                metroPort: 8092,
                devices: [
                    { platform: "ios", deviceId: "UDID-1", bundleId: "com.example.MyApp" },
                    { platform: "android", deviceId: "emulator-5554", bundleId: "com.example.myapp" },
                ],
            },
        });
        expect(out).toContain("Device count: 2");
        expect(out).toContain("- ios on UDID-1 (bundle com.example.MyApp)");
        expect(out).toContain("- android on emulator-5554 (bundle com.example.myapp)");
        expect(out).toContain("Verify the change on each of the 2 devices.");
    });

    it("preserves the user prompt body unchanged", () => {
        const body = "Line one.\n\nLine two.";
        const out = renderPrompt({
            userPrompt: body,
            vars: {
                worktreePath: "/wt",
                metroPort: 8092,
                devices: [{ platform: "ios", deviceId: "U", bundleId: "b" }],
            },
        });
        expect(out).toContain(body);
    });
});
