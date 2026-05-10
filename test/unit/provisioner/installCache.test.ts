import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getCachedFingerprint, setCachedFingerprint } from "../../../src/provisioner/installCache.js";

describe("install cache (per-port)", () => {
    let dir: string;
    const originalHome = process.env.EXECBRO_HOME;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-cache-"));
        process.env.EXECBRO_HOME = dir;
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.EXECBRO_HOME;
        else process.env.EXECBRO_HOME = originalHome;
    });

    it("returns null when no fingerprint has been cached for this (device, bundle, port)", () => {
        expect(getCachedFingerprint("UDID-A", "com.x", 8090)).toBeNull();
    });

    it("round-trips a fingerprint per (device, bundle, port)", () => {
        setCachedFingerprint("UDID-A", "com.x", 8090, "fp-port-8090");
        expect(getCachedFingerprint("UDID-A", "com.x", 8090)).toBe("fp-port-8090");
    });

    it("keeps separate entries for different ports on the same device + bundle", () => {
        setCachedFingerprint("UDID-A", "com.x", 8090, "fp-8090");
        setCachedFingerprint("UDID-A", "com.x", 8091, "fp-8091");
        expect(getCachedFingerprint("UDID-A", "com.x", 8090)).toBe("fp-8090");
        expect(getCachedFingerprint("UDID-A", "com.x", 8091)).toBe("fp-8091");
    });

    it("setting a fingerprint for one port does not overwrite another port's entry", () => {
        setCachedFingerprint("UDID-A", "com.x", 8090, "fp-8090");
        setCachedFingerprint("UDID-A", "com.x", 8091, "fp-8091");
        setCachedFingerprint("UDID-A", "com.x", 8090, "fp-8090-v2");
        expect(getCachedFingerprint("UDID-A", "com.x", 8090)).toBe("fp-8090-v2");
        expect(getCachedFingerprint("UDID-A", "com.x", 8091)).toBe("fp-8091");
    });
});
