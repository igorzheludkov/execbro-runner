import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getCachedFingerprint, setCachedFingerprint, isAppInstalledAndroid } from "../../../src/provisioner/installCache.js";

describe("install cache", () => {
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

    it("returns null when no fingerprint has been cached", () => {
        expect(getCachedFingerprint("UDID-A", "com.x")).toBeNull();
    });

    it("round-trips a fingerprint per (device, bundle)", () => {
        setCachedFingerprint("UDID-A", "com.x", "fp-1");
        expect(getCachedFingerprint("UDID-A", "com.x")).toBe("fp-1");
    });

    it("keeps separate entries for different bundles on the same device", () => {
        setCachedFingerprint("UDID-A", "com.x", "fp-x");
        setCachedFingerprint("UDID-A", "com.y", "fp-y");
        expect(getCachedFingerprint("UDID-A", "com.x")).toBe("fp-x");
        expect(getCachedFingerprint("UDID-A", "com.y")).toBe("fp-y");
    });

    it("overwriting one entry leaves siblings intact", () => {
        setCachedFingerprint("UDID-A", "com.x", "fp-x1");
        setCachedFingerprint("UDID-A", "com.y", "fp-y");
        setCachedFingerprint("UDID-A", "com.x", "fp-x2");
        expect(getCachedFingerprint("UDID-A", "com.x")).toBe("fp-x2");
        expect(getCachedFingerprint("UDID-A", "com.y")).toBe("fp-y");
    });

    it("is independent of the Metro port (cache hits across port changes for the same code)", () => {
        // The cache is keyed by (deviceId, bundleId) only; the assigned
        // Metro port is set per-launch via NSUserDefaults and does not
        // affect the binary, so the same cached entry serves every port.
        setCachedFingerprint("UDID-A", "com.x", "fp-1");
        // Subsequent task on the same code, different port, looks up the
        // same entry — the runner does not pass a port to these calls.
        expect(getCachedFingerprint("UDID-A", "com.x")).toBe("fp-1");
    });
});

describe("isAppInstalledAndroid", () => {
    it("returns true when pm list packages output contains the package", () => {
        const fakeSpawn = jest.fn().mockReturnValue({
            status: 0,
            stdout: "package:com.android.systemui\npackage:com.example.myapp\npackage:com.android.chrome\n",
            stderr: "",
        });
        expect(isAppInstalledAndroid("emulator-5554", "com.example.myapp", fakeSpawn as never)).toBe(true);
    });

    it("returns false when output does not contain the package", () => {
        const fakeSpawn = jest.fn().mockReturnValue({
            status: 0,
            stdout: "package:com.android.systemui\npackage:com.android.chrome\n",
            stderr: "",
        });
        expect(isAppInstalledAndroid("emulator-5554", "com.example.myapp", fakeSpawn as never)).toBe(false);
    });

    it("returns false when adb fails", () => {
        const fakeSpawn = jest.fn().mockReturnValue({ status: 1, stdout: "", stderr: "no devices" });
        expect(isAppInstalledAndroid("emulator-5554", "com.example.myapp", fakeSpawn as never)).toBe(false);
    });

    it("only matches whole package names (not substrings)", () => {
        const fakeSpawn = jest.fn().mockReturnValue({
            status: 0,
            stdout: "package:com.example.myapp.test\npackage:com.example.myapp2\n",
            stderr: "",
        });
        expect(isAppInstalledAndroid("emulator-5554", "com.example.myapp", fakeSpawn as never)).toBe(false);
    });
});
