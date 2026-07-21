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
        promptPath = join(repoDir, "task.md");
        writeFileSync(promptPath, "Fix the login crash.");
        execSync("git add . && git commit -m init", { cwd: repoDir });
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
        expect(desc.devices).toEqual([{ platform: "ios" }]);
        expect(desc.status).toBe("queued");
    });

    it("throws if the prompt file does not exist", async () => {
        await expect(runAdd({ file: "/no/such/file.md" }))
            .rejects.toThrow(/not found/i);
    });

    it("succeeds when the repo has uncommitted changes (worktree branches from HEAD; WIP is intentionally not carried over)", async () => {
        writeFileSync(join(repoDir, "README.md"), "modified");
        const desc = await runAdd({ file: promptPath });
        expect(desc.status).toBe("queued");
    });

    it("succeeds when an untracked file exists in the repo", async () => {
        writeFileSync(join(repoDir, "untracked.txt"), "x");
        const desc = await runAdd({ file: promptPath });
        expect(desc.status).toBe("queued");
    });

    it("blocks when a task with the same prompt file is already in inbox", async () => {
        await runAdd({ file: promptPath });
        await new Promise(r => setTimeout(r, 1100)); // ensure different timestamp id
        await expect(runAdd({ file: promptPath }))
            .rejects.toThrow(/already active/i);
    });

    it("--force bypasses the duplicate check", async () => {
        await runAdd({ file: promptPath });
        await new Promise(r => setTimeout(r, 1100));
        const second = await runAdd({ file: promptPath, force: true });
        expect(second.status).toBe("queued");
    });

    it("defaults parallel to false when --parallel is not passed", async () => {
        await runAdd({ file: promptPath });
        const inbox = join(homeDir, "queue", "inbox");
        const files = readdirSync(inbox);
        const desc = JSON.parse(readFileSync(join(inbox, files[0]), "utf8"));
        expect(desc.parallel).toBe(false);
    });

    it("sets parallel to true when --parallel is passed", async () => {
        await runAdd({ file: promptPath, parallel: true });
        const inbox = join(homeDir, "queue", "inbox");
        const files = readdirSync(inbox);
        const desc = JSON.parse(readFileSync(join(inbox, files[0]), "utf8"));
        expect(desc.parallel).toBe(true);
    });

    it("--device pins the deviceId on the single requested platform", async () => {
        const desc = await runAdd({ file: promptPath, devices: "android", device: "Medium_Phone" });
        expect(desc.devices).toEqual([{ platform: "android", deviceId: "Medium_Phone" }]);
    });

    it("--device rejects a multi-platform --devices list (ambiguous which platform it pins)", async () => {
        await expect(runAdd({ file: promptPath, devices: "ios,android", device: "Medium_Phone" }))
            .rejects.toThrow(/--device pins one specific device/i);
    });

    it("omits forceDevice from the descriptor when --force-device is not passed", async () => {
        const desc = await runAdd({ file: promptPath });
        expect(desc.forceDevice).toBeUndefined();
    });

    it("--force-device sets forceDevice: true on the descriptor", async () => {
        const desc = await runAdd({ file: promptPath, forceDevice: true });
        expect(desc.forceDevice).toBe(true);
    });
});
