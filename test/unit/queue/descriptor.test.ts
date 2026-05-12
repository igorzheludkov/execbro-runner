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
    it("validates a single-device ios descriptor", () => {
        const d = {
            id: "2026-05-10-100000-fix-x",
            promptFile: "/abs/path/plan.md",
            repo: "/abs/path/repo",
            baseBranch: "main",
            devices: [{ platform: "ios" }],
            dependsOn: [],
            createdAt: "2026-05-10T10:00:00Z",
            status: "queued",
        };
        expect(() => DescriptorSchema.parse(d)).not.toThrow();
    });

    it("validates a multi-device descriptor with mixed platforms", () => {
        const d = {
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            devices: [{ platform: "ios" }, { platform: "android" }],
            dependsOn: [],
            createdAt: "2026-05-10T10:00:00Z", status: "queued",
        };
        expect(() => DescriptorSchema.parse(d)).not.toThrow();
    });

    it("validates a same-platform pair", () => {
        const d = {
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            devices: [{ platform: "ios" }, { platform: "ios" }],
            dependsOn: [],
            createdAt: "2026-05-10T10:00:00Z", status: "queued",
        };
        expect(() => DescriptorSchema.parse(d)).not.toThrow();
    });

    it("rejects an empty devices array", () => {
        expect(() => DescriptorSchema.parse({
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            devices: [],
            dependsOn: [],
            createdAt: "2026-05-10T10:00:00Z", status: "queued",
        })).toThrow();
    });

    it("rejects a descriptor that still carries the legacy platform field", () => {
        expect(() => DescriptorSchema.parse({
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            platform: "ios",
            dependsOn: [],
            createdAt: "2026-05-10T10:00:00Z", status: "queued",
        })).toThrow();
    });

    it("accepts assignedSlotIds when present", () => {
        const parsed = DescriptorSchema.parse({
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            devices: [{ platform: "ios" }, { platform: "android" }],
            dependsOn: [],
            createdAt: "2026-05-10T10:00:00Z", status: "running",
            assignedSlotIds: [1, 2],
        });
        expect(parsed.assignedSlotIds).toEqual([1, 2]);
    });

    it("accepts assignedMetroPort when present", () => {
        const parsed = DescriptorSchema.parse({
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            devices: [{ platform: "ios" }],
            dependsOn: [],
            createdAt: "2026-05-10T10:00:00Z", status: "running",
            assignedMetroPort: 8092,
        });
        expect(parsed.assignedMetroPort).toBe(8092);
    });

    it("rejects assignedMetroPort that is not a valid port", () => {
        expect(() => DescriptorSchema.parse({
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            devices: [{ platform: "ios" }],
            dependsOn: [],
            createdAt: "2026-05-10T10:00:00Z", status: "running",
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

describe("parallel field", () => {
    const base = {
        id: "t1", promptFile: "/p.md", repo: "/r", baseBranch: "main",
        devices: [{ platform: "ios" }], dependsOn: [],
        createdAt: "2026-05-12T00:00:00Z", status: "queued",
    };

    it("defaults to false when omitted", () => {
        const parsed = DescriptorSchema.parse(base);
        expect(parsed.parallel).toBe(false);
    });

    it("accepts true", () => {
        const parsed = DescriptorSchema.parse({ ...base, parallel: true });
        expect(parsed.parallel).toBe(true);
    });

    it("rejects non-boolean", () => {
        expect(() => DescriptorSchema.parse({ ...base, parallel: "yes" })).toThrow();
        expect(() => DescriptorSchema.parse({ ...base, parallel: 1 })).toThrow();
    });
});

describe("read/writeDescriptor", () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "execbro-test-")); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("round-trips a descriptor through disk", () => {
        const d = {
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            devices: [{ platform: "ios" as const }],
            dependsOn: [],
            parallel: false,
            createdAt: "2026-05-10T10:00:00Z", status: "queued" as const,
        };
        const path = join(dir, "x.json");
        writeDescriptor(path, d);
        const read = readDescriptor(path);
        expect(read).toEqual(d);
    });

    it("writeDescriptor writes valid JSON with 2-space indentation", () => {
        const d = {
            id: "x", promptFile: "/p", repo: "/r", baseBranch: "main",
            devices: [{ platform: "ios" as const }],
            dependsOn: [],
            parallel: false,
            createdAt: "x", status: "queued" as const,
        };
        const path = join(dir, "x.json");
        writeDescriptor(path, d);
        const raw = readFileSync(path, "utf8");
        expect(raw).toContain("\n  \"id\":");
    });
});
