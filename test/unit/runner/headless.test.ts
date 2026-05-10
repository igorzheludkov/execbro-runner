import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runHeadlessAgent } from "../../../src/runner/headless.js";

function makeFakeChild(stdoutLines: string[], exitCode: number) {
    const child = new EventEmitter() as EventEmitter & { stdout: Readable; kill: (sig?: string) => void };
    child.stdout = Readable.from(stdoutLines.map(l => l + "\n"));
    child.kill = () => { /* no-op for tests */ };
    setImmediate(() => child.emit("exit", exitCode));
    return child;
}

describe("runHeadlessAgent", () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "execbro-h-")); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("captures the session id from the first stream-json event and writes the log", async () => {
        const logPath = join(dir, "log.jsonl");
        const captured: string[] = [];
        const fakeSpawn = (_cmd: string, _args: string[], _opts: object) =>
            makeFakeChild([
                JSON.stringify({ type: "system", subtype: "init", session_id: "sess-aaa" }),
                JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
            ], 0) as never;

        const result = await runHeadlessAgent({
            prompt: "do x",
            systemPrompt: "you are autonomous",
            cwd: dir,
            logPath,
            onSessionId: id => captured.push(id),
            spawn: fakeSpawn,
        });

        expect(result).toEqual({ exitCode: 0, sessionId: "sess-aaa" });
        expect(captured).toEqual(["sess-aaa"]);
        expect(readFileSync(logPath, "utf8")).toContain("sess-aaa");
    });

    it("returns exitCode > 0 and still surfaces sessionId when the agent fails", async () => {
        const logPath = join(dir, "log.jsonl");
        const fakeSpawn = (_cmd: string, _args: string[], _opts: object) =>
            makeFakeChild([
                JSON.stringify({ type: "system", subtype: "init", session_id: "sess-bbb" }),
            ], 2) as never;

        const result = await runHeadlessAgent({
            prompt: "p", systemPrompt: "s", cwd: dir, logPath, spawn: fakeSpawn,
        });
        expect(result).toEqual({ exitCode: 2, sessionId: "sess-bbb" });
    });

    it("returns sessionId=null if the agent exits before emitting one", async () => {
        const logPath = join(dir, "log.jsonl");
        const fakeSpawn = (_cmd: string, _args: string[], _opts: object) =>
            makeFakeChild([], 1) as never;
        const result = await runHeadlessAgent({
            prompt: "p", systemPrompt: "s", cwd: dir, logPath, spawn: fakeSpawn,
        });
        expect(result).toEqual({ exitCode: 1, sessionId: null });
    });

    it("invokes onSessionId exactly once even if multiple events carry session_id", async () => {
        const logPath = join(dir, "log.jsonl");
        const captured: string[] = [];
        const fakeSpawn = (_cmd: string, _args: string[], _opts: object) =>
            makeFakeChild([
                JSON.stringify({ type: "system", session_id: "sess-ccc" }),
                JSON.stringify({ type: "assistant", session_id: "sess-ccc" }),
            ], 0) as never;
        await runHeadlessAgent({
            prompt: "p", systemPrompt: "s", cwd: dir, logPath,
            onSessionId: id => captured.push(id),
            spawn: fakeSpawn,
        });
        expect(captured).toEqual(["sess-ccc"]);
    });
});
