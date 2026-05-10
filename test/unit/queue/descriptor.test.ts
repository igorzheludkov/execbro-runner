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
    it("validates a headless ios descriptor", () => {
        const d = {
            id: "2026-05-09-143022-fix-login",
            promptFile: "/abs/path/plan.md",
            repo: "/abs/path/repo",
            baseBranch: "main",
            platform: "ios",
            dependsOn: [],
            createdAt: "2026-05-09T14:30:22Z",
            status: "queued",
        };
        expect(() => DescriptorSchema.parse(d)).not.toThrow();
    });

    it("accepts a descriptor with claudeSessionId set", () => {
        const parsed = DescriptorSchema.parse({
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            platform: "ios", dependsOn: [],
            createdAt: "2026-05-10T00:00:00Z", status: "running",
            claudeSessionId: "6999810d-ed0e-43a0-879f-d4b4ff46953b",
        });
        expect(parsed.claudeSessionId).toBe("6999810d-ed0e-43a0-879f-d4b4ff46953b");
    });

    it("accepts a descriptor without claudeSessionId (optional field)", () => {
        const parsed = DescriptorSchema.parse({
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            platform: "ios", dependsOn: [],
            createdAt: "2026-05-10T00:00:00Z", status: "queued",
        });
        expect(parsed.claudeSessionId).toBeUndefined();
    });

    it("rejects a descriptor that still carries the removed mode field", () => {
        expect(() => DescriptorSchema.parse({
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            mode: "tmux",
            platform: "ios", dependsOn: [],
            createdAt: "2026-05-10T00:00:00Z", status: "queued",
        })).toThrow();
    });

    it("accepts a descriptor with assignedMetroPort set", () => {
        const parsed = DescriptorSchema.parse({
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            platform: "ios", dependsOn: [],
            createdAt: "2026-05-10T00:00:00Z", status: "running",
            assignedMetroPort: 8092,
        });
        expect(parsed.assignedMetroPort).toBe(8092);
    });

    it("rejects assignedMetroPort that is not an integer port", () => {
        expect(() => DescriptorSchema.parse({
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            platform: "ios", dependsOn: [],
            createdAt: "2026-05-10T00:00:00Z", status: "running",
            assignedMetroPort: 80,
        })).toThrow();
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
            platform: "ios" as const, dependsOn: [],
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
            platform: "ios" as const, dependsOn: [],
            createdAt: "x", status: "queued" as const,
        };
        const path = join(dir, "x.json");
        writeDescriptor(path, d);
        const raw = readFileSync(path, "utf8");
        expect(raw).toContain("\n  \"id\":");
    });
});
