import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverIosBundleId } from "../../../src/provisioner/ios.js";

function makePbxproj(bundleIds: string[]): string {
    const targets = bundleIds.map((id, i) => `
        ${i}D${i}D${i}D${i} /* Debug */ = {
            isa = XCBuildConfiguration;
            buildSettings = {
                PRODUCT_BUNDLE_IDENTIFIER = "${id}";
            };
        };`).join("\n");
    return `// !$*UTF8*$!
{
    archiveVersion = 1;
    objects = {
${targets}
    };
}`;
}

describe("discoverIosBundleId", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-bundleid-"));
        mkdirSync(join(dir, "ios", "MyApp.xcodeproj"), { recursive: true });
    });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("returns the single distinct bundle id when only one target exists", () => {
        writeFileSync(
            join(dir, "ios", "MyApp.xcodeproj", "project.pbxproj"),
            makePbxproj(["com.example.MyApp", "com.example.MyApp"]),
        );
        expect(discoverIosBundleId(dir)).toBe("com.example.MyApp");
    });

    it("filters out test target and returns main target", () => {
        writeFileSync(
            join(dir, "ios", "MyApp.xcodeproj", "project.pbxproj"),
            makePbxproj(["com.example.MyApp", "com.example.MyApp.tests"]),
        );
        expect(discoverIosBundleId(dir)).toBe("com.example.MyApp");
    });

    it("filters out notification service extension", () => {
        writeFileSync(
            join(dir, "ios", "MyApp.xcodeproj", "project.pbxproj"),
            makePbxproj(["com.example.MyApp", "com.example.MyApp.NotificationService"]),
        );
        expect(discoverIosBundleId(dir)).toBe("com.example.MyApp");
    });

    it("filters out widget and watchkitapp suffixes", () => {
        writeFileSync(
            join(dir, "ios", "MyApp.xcodeproj", "project.pbxproj"),
            makePbxproj([
                "com.example.MyApp",
                "com.example.MyApp.widget",
                "com.example.MyApp.watchkitapp",
            ]),
        );
        expect(discoverIosBundleId(dir)).toBe("com.example.MyApp");
    });

    it("falls back to package.json execbro.iosBundleId when autodetect is ambiguous", () => {
        writeFileSync(
            join(dir, "ios", "MyApp.xcodeproj", "project.pbxproj"),
            makePbxproj(["com.example.A", "com.example.B"]),
        );
        writeFileSync(
            join(dir, "package.json"),
            JSON.stringify({ execbro: { iosBundleId: "com.example.Override" } }),
        );
        expect(discoverIosBundleId(dir)).toBe("com.example.Override");
    });

    it("falls back to package.json when there is no xcodeproj", () => {
        rmSync(join(dir, "ios", "MyApp.xcodeproj"), { recursive: true });
        writeFileSync(
            join(dir, "package.json"),
            JSON.stringify({ execbro: { iosBundleId: "com.example.NoXcode" } }),
        );
        expect(discoverIosBundleId(dir)).toBe("com.example.NoXcode");
    });

    it("throws when neither autodetect nor fallback resolves", () => {
        writeFileSync(
            join(dir, "ios", "MyApp.xcodeproj", "project.pbxproj"),
            makePbxproj([]),
        );
        writeFileSync(join(dir, "package.json"), JSON.stringify({}));
        expect(() => discoverIosBundleId(dir)).toThrow(/iOS bundle id/i);
    });
});
