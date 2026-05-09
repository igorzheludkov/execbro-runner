import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isDone } from "../../../src/runner/doneDetection.js";

describe("isDone", () => {
    let dir: string;
    let path: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-test-"));
        path = join(dir, "session.jsonl");
    });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("returns false if file does not exist", () => {
        expect(isDone({ transcriptPath: path, idleSec: 0 })).toBe(false);
    });

    it("returns false if last line is a user message", () => {
        writeFileSync(path, JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }) + "\n");
        expect(isDone({ transcriptPath: path, idleSec: 0 })).toBe(false);
    });

    it("returns false if last assistant message contains a tool_use block", () => {
        writeFileSync(path, JSON.stringify({
            type: "assistant",
            message: { role: "assistant", content: [{ type: "tool_use", name: "x", input: {} }] },
        }) + "\n");
        expect(isDone({ transcriptPath: path, idleSec: 0 })).toBe(false);
    });

    it("returns true if last assistant message is text-only and idle time exceeded", () => {
        writeFileSync(path, JSON.stringify({
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text: "all done" }] },
        }) + "\n");
        expect(isDone({ transcriptPath: path, idleSec: 0 })).toBe(true);
    });

    it("returns false if last assistant message is text-only but file modified recently and idle window not yet passed", () => {
        writeFileSync(path, JSON.stringify({
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text: "all done" }] },
        }) + "\n");
        expect(isDone({ transcriptPath: path, idleSec: 60 })).toBe(false);
    });
});
