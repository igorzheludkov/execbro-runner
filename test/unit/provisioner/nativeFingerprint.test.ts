import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nativeFingerprint } from "../../../src/provisioner/nativeFingerprint.js";

describe("nativeFingerprint", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-fp-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("returns the same hash for identical inputs", () => {
        mkdirSync(join(dir, "ios"));
        writeFileSync(join(dir, "ios", "AppDelegate.swift"), "// app delegate");
        writeFileSync(join(dir, "package.json"), '{"name":"x"}');
        const a = nativeFingerprint(dir);
        const b = nativeFingerprint(dir);
        expect(a).toBe(b);
    });

    it("changes when a file in ios/ changes", () => {
        mkdirSync(join(dir, "ios"));
        writeFileSync(join(dir, "ios", "AppDelegate.swift"), "// v1");
        writeFileSync(join(dir, "package.json"), '{"name":"x"}');
        const a = nativeFingerprint(dir);
        writeFileSync(join(dir, "ios", "AppDelegate.swift"), "// v2");
        const b = nativeFingerprint(dir);
        expect(a).not.toBe(b);
    });

    it("changes when package.json changes", () => {
        writeFileSync(join(dir, "package.json"), '{"name":"x","dependencies":{"a":"1"}}');
        const a = nativeFingerprint(dir);
        writeFileSync(join(dir, "package.json"), '{"name":"x","dependencies":{"a":"2"}}');
        const b = nativeFingerprint(dir);
        expect(a).not.toBe(b);
    });

    it("ignores excluded directories like node_modules and Pods", () => {
        mkdirSync(join(dir, "ios"));
        writeFileSync(join(dir, "ios", "AppDelegate.swift"), "// app");
        const a = nativeFingerprint(dir);

        mkdirSync(join(dir, "node_modules"));
        writeFileSync(join(dir, "node_modules", "junk"), "x");
        mkdirSync(join(dir, "ios", "Pods"));
        writeFileSync(join(dir, "ios", "Pods", "junk"), "x");
        mkdirSync(join(dir, "ios", "build"));
        writeFileSync(join(dir, "ios", "build", "junk"), "x");

        const b = nativeFingerprint(dir);
        expect(a).toBe(b);
    });

    it("changes when Podfile.lock changes", () => {
        mkdirSync(join(dir, "ios"));
        writeFileSync(join(dir, "ios", "Podfile.lock"), "PODS:\n  - A (1.0)");
        const a = nativeFingerprint(dir);
        writeFileSync(join(dir, "ios", "Podfile.lock"), "PODS:\n  - A (2.0)");
        const b = nativeFingerprint(dir);
        expect(a).not.toBe(b);
    });

    it("is independent of the assigned Metro port (same code → same fingerprint regardless of port)", () => {
        mkdirSync(join(dir, "ios"));
        writeFileSync(join(dir, "ios", "AppDelegate.swift"), "// app");
        writeFileSync(join(dir, "package.json"), '{"name":"x"}');
        const a = nativeFingerprint(dir);
        // The function takes no port argument; this test exists to lock in
        // that behaviour after the per-port keying revert.
        const b = nativeFingerprint(dir);
        expect(a).toBe(b);
    });
});
