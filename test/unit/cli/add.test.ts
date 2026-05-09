import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { runAdd } from "../../../src/cli/commands/add.js";

describe("runAdd", () => {
    let homeDir: string;
    let repoDir: string;
    let promptPath: string;

    beforeEach(() => {
        homeDir = mkdtempSync(join(tmpdir(), "execbro-home-"));
        repoDir = mkdtempSync(join(tmpdir(), "execbro-repo-"));
        execSync("git init -b main", { cwd: repoDir });
        execSync('git config user.email "t@t.t"', { cwd: repoDir });
        execSync('git config user.name "T"', { cwd: repoDir });
        writeFileSync(join(repoDir, "README.md"), "x");
        execSync("git add . && git commit -m init", { cwd: repoDir });
        promptPath = join(repoDir, "task.md");
        writeFileSync(promptPath, "Fix the login crash.");
        process.env.EXECBRO_HOME = homeDir;
    });
    afterEach(() => {
        rmSync(homeDir, { recursive: true, force: true });
        rmSync(repoDir, { recursive: true, force: true });
        delete process.env.EXECBRO_HOME;
    });

    it("writes a descriptor to inbox/", async () => {
        await runAdd({ file: promptPath });
        const inbox = join(homeDir, "queue", "inbox");
        const files = readdirSync(inbox);
        expect(files).toHaveLength(1);
        const desc = JSON.parse(readFileSync(join(inbox, files[0]), "utf8"));
        expect(desc.promptFile).toBe(promptPath);
        expect(desc.repo).toBe(repoDir);
        expect(desc.baseBranch).toBe("main");
        expect(desc.mode).toBe("tmux");
        expect(desc.platform).toBe("ios");
        expect(desc.status).toBe("queued");
    });

    it("rejects --mode=headless in Phase 1", async () => {
        await expect(runAdd({ file: promptPath, mode: "headless" }))
            .rejects.toThrow(/phase 2/i);
    });

    it("throws if the prompt file does not exist", async () => {
        await expect(runAdd({ file: "/no/such/file.md" }))
            .rejects.toThrow(/not found/i);
    });
});
