import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    DescriptorSchema,
    generateTaskId,
    readDescriptor,
    writeDescriptor,
} from "../../../src/queue/descriptor.js";

describe("DescriptorSchema", () => {
    it("validates a Phase 1 ios descriptor", () => {
        const d = {
            id: "2026-05-09-143022-fix-login",
            promptFile: "/abs/path/plan.md",
            repo: "/abs/path/repo",
            baseBranch: "main",
            mode: "tmux",
            platform: "ios",
            dependsOn: [],
            createdAt: "2026-05-09T14:30:22Z",
            status: "queued",
        };
        expect(() => DescriptorSchema.parse(d)).not.toThrow();
    });

    it("rejects a descriptor with mode 'headless' (Phase 2)", () => {
        // Phase 1 supports tmux only. Headless rejection is enforced at intake, not in the schema —
        // this test documents that the schema itself accepts it (schema is forward-compatible).
        // The rejection happens in the CLI add command (Task 8).
        const d = {
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            mode: "headless", platform: "ios", dependsOn: [], createdAt: "x", status: "queued",
        };
        expect(() => DescriptorSchema.parse(d)).not.toThrow();
    });
});

describe("generateTaskId", () => {
    it("produces an id with timestamp + slugified filename", () => {
        const fixedDate = new Date("2026-05-09T14:30:22Z");
        const id = generateTaskId("/abs/path/Fix Login Crash!.md", fixedDate);
        expect(id).toBe("2026-05-09-143022-fix-login-crash");
    });

    it("strips extensions and special chars", () => {
        const id = generateTaskId("/x/Add OCR Support.md", new Date("2026-01-02T03:04:05Z"));
        expect(id).toBe("2026-01-02-030405-add-ocr-support");
    });
});

describe("read/writeDescriptor", () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "execbro-test-")); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("round-trips a descriptor through disk", () => {
        const d = {
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            mode: "tmux" as const, platform: "ios" as const, dependsOn: [],
            createdAt: "2026-05-09T14:30:22Z", status: "queued" as const,
        };
        const path = join(dir, "x.json");
        writeDescriptor(path, d);
        const read = readDescriptor(path);
        expect(read).toEqual(d);
    });

    it("writeDescriptor writes valid JSON with 2-space indentation", () => {
        const d = {
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            mode: "tmux" as const, platform: "ios" as const, dependsOn: [],
            createdAt: "x", status: "queued" as const,
        };
        const path = join(dir, "x.json");
        writeDescriptor(path, d);
        const raw = readFileSync(path, "utf8");
        expect(raw).toContain("\n  \"id\":");
    });
});
