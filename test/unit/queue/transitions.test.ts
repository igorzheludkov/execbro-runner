import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { moveDescriptor, listDescriptors } from "../../../src/queue/transitions.js";

describe("moveDescriptor", () => {
    let dir: string;
    let inbox: string;
    let running: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-test-"));
        inbox = join(dir, "inbox");
        running = join(dir, "running");
        mkdirSync(inbox);
        mkdirSync(running);
    });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("moves a file from one dir to another", () => {
        const src = join(inbox, "task-1.json");
        const dst = join(running, "task-1.json");
        writeFileSync(src, "{}");
        moveDescriptor(src, dst);
        expect(existsSync(src)).toBe(false);
        expect(existsSync(dst)).toBe(true);
        expect(readFileSync(dst, "utf8")).toBe("{}");
    });

    it("throws if source does not exist", () => {
        expect(() => moveDescriptor(join(inbox, "nope.json"), join(running, "nope.json")))
            .toThrow();
    });
});

describe("listDescriptors", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-test-"));
        writeFileSync(join(dir, "a.json"), JSON.stringify({
            id: "a", promptFile: "/p", repo: "/r", baseBranch: "main",
            platform: "ios", dependsOn: [], createdAt: "2026-05-09T01:00:00Z", status: "queued",
        }));
        writeFileSync(join(dir, "b.json"), JSON.stringify({
            id: "b", promptFile: "/p", repo: "/r", baseBranch: "main",
            platform: "ios", dependsOn: [], createdAt: "2026-05-09T02:00:00Z", status: "queued",
        }));
        writeFileSync(join(dir, "ignored.txt"), "not json");
    });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("returns descriptors sorted by createdAt ascending", () => {
        const list = listDescriptors(dir);
        expect(list.map(d => d.id)).toEqual(["a", "b"]);
    });

    it("ignores non-json files", () => {
        const list = listDescriptors(dir);
        expect(list).toHaveLength(2);
    });
});
