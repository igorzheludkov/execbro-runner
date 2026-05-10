import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runClean } from "../../../src/cli/commands/clean.js";

function writeDescriptor(dir: string, id: string, status: string = "failed"): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({
        id, promptFile: "/p", repo: "/r", baseBranch: "main",
        platform: "ios", dependsOn: [],
        createdAt: "2026-05-09T01:00:00Z", status,
    }));
}

describe("runClean", () => {
    let homeDir: string;

    beforeEach(() => {
        homeDir = mkdtempSync(join(tmpdir(), "execbro-clean-"));
        process.env.EXECBRO_HOME = homeDir;
    });
    afterEach(() => {
        rmSync(homeDir, { recursive: true, force: true });
        delete process.env.EXECBRO_HOME;
    });

    it("removes a task's descriptor, worktree dir, and log", async () => {
        const id = "task-1";
        writeDescriptor(join(homeDir, "queue", "failed"), id);
        const wt = join(homeDir, "worktrees", id);
        mkdirSync(wt, { recursive: true });
        writeFileSync(join(wt, "marker"), "x");
        const log = join(homeDir, "logs", `${id}.jsonl`);
        mkdirSync(join(homeDir, "logs"));
        writeFileSync(log, "{}");

        await runClean({ id });

        expect(existsSync(join(homeDir, "queue", "failed", `${id}.json`))).toBe(false);
        expect(existsSync(wt)).toBe(false);
        expect(existsSync(log)).toBe(false);
    });

    it("--all-failed cleans every task in the failed bucket", async () => {
        for (const id of ["a", "b", "c"]) writeDescriptor(join(homeDir, "queue", "failed"), id);
        await runClean({ allFailed: true });
        expect(readdirSync(join(homeDir, "queue", "failed"))).toHaveLength(0);
    });

    it("throws when no target is specified", async () => {
        await expect(runClean({})).rejects.toThrow(/specify/i);
    });

    it("throws when more than one target flag is specified", async () => {
        await expect(runClean({ allFailed: true, allDone: true })).rejects.toThrow(/only one/i);
    });

    it("throws when the id does not exist", async () => {
        await expect(runClean({ id: "no-such-id" })).rejects.toThrow(/not found/i);
    });

    it("refuses to clean queued tasks without --force", async () => {
        const id = "active-1";
        const inboxDescriptor = JSON.stringify({
            id, promptFile: "/p", repo: "/r", baseBranch: "main",
            platform: "ios", dependsOn: [],
            createdAt: "2026-05-09T01:00:00Z", status: "queued",
        });
        mkdirSync(join(homeDir, "queue", "inbox"), { recursive: true });
        writeFileSync(join(homeDir, "queue", "inbox", `${id}.json`), inboxDescriptor);
        await expect(runClean({ id })).rejects.toThrow(/active/i);
    });

    it("--force allows cleaning queued tasks", async () => {
        const id = "active-1";
        const inboxDescriptor = JSON.stringify({
            id, promptFile: "/p", repo: "/r", baseBranch: "main",
            platform: "ios", dependsOn: [],
            createdAt: "2026-05-09T01:00:00Z", status: "queued",
        });
        mkdirSync(join(homeDir, "queue", "inbox"), { recursive: true });
        writeFileSync(join(homeDir, "queue", "inbox", `${id}.json`), inboxDescriptor);
        await runClean({ id, force: true });
        expect(existsSync(join(homeDir, "queue", "inbox", `${id}.json`))).toBe(false);
    });

    it("--all-running stops every running task and removes its descriptor, worktree, log, and signal file", async () => {
        const ids = ["run-a", "run-b"];
        for (const id of ids) {
            writeDescriptor(join(homeDir, "queue", "running"), id, "running");
            mkdirSync(join(homeDir, "worktrees", id), { recursive: true });
            mkdirSync(join(homeDir, "logs"), { recursive: true });
            writeFileSync(join(homeDir, "logs", `${id}.jsonl`), "{}");
            writeFileSync(join(homeDir, "queue", "running", `${id}.signal`),
                JSON.stringify({ id, signaledAt: "now" }));
        }

        await runClean({ allRunning: true });

        for (const id of ids) {
            expect(existsSync(join(homeDir, "queue", "running", `${id}.json`))).toBe(false);
            expect(existsSync(join(homeDir, "queue", "running", `${id}.signal`))).toBe(false);
            expect(existsSync(join(homeDir, "worktrees", id))).toBe(false);
            expect(existsSync(join(homeDir, "logs", `${id}.jsonl`))).toBe(false);
        }
    });

    it("--all-running does not require --force", async () => {
        writeDescriptor(join(homeDir, "queue", "running"), "active-x", "running");
        mkdirSync(join(homeDir, "worktrees", "active-x"), { recursive: true });
        await expect(runClean({ allRunning: true })).resolves.toBeUndefined();
    });

    it("--all-running with no running tasks is a no-op", async () => {
        mkdirSync(join(homeDir, "queue", "running"), { recursive: true });
        await expect(runClean({ allRunning: true })).resolves.toBeUndefined();
    });
});
