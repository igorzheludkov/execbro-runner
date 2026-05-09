import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderPrompt } from "../../../src/runner/prompt.js";

describe("renderPrompt", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-test-"));
        mkdirSync(join(dir, "templates"));
        writeFileSync(join(dir, "templates", "agent-preamble.md"), "Sandbox: {{worktreePath}} on port {{metroPort}}\n\n## Your task\n");
        writeFileSync(join(dir, "templates", "verification-suffix.md"), "\n\n## Verify\nDone.");
        process.env.EXECBRO_HOME = dir;
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        delete process.env.EXECBRO_HOME;
    });

    it("composes preamble + user prompt + suffix with substitutions", () => {
        const result = renderPrompt({
            userPrompt: "Fix the login crash.",
            vars: { worktreePath: "/wt", platform: "ios", deviceId: "U", metroPort: 8082, bundleId: "com.x" },
        });
        expect(result).toContain("Sandbox: /wt on port 8082");
        expect(result).toContain("Fix the login crash.");
        expect(result).toContain("## Verify");
        expect(result.indexOf("Sandbox:")).toBeLessThan(result.indexOf("Fix the login"));
        expect(result.indexOf("Fix the login")).toBeLessThan(result.indexOf("## Verify"));
    });

    it("leaves unknown placeholders untouched (warns rather than crashes)", () => {
        writeFileSync(join(dir, "templates", "agent-preamble.md"), "{{unknown}} {{worktreePath}}");
        const result = renderPrompt({
            userPrompt: "x",
            vars: { worktreePath: "/wt", platform: "ios", deviceId: "U", metroPort: 8082, bundleId: "com.x" },
        });
        expect(result).toContain("{{unknown}}");
        expect(result).toContain("/wt");
    });
});
