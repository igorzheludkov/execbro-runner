import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function readExplicitAndroidPackageName(worktreePath: string): string | null {
    const pkgPath = join(worktreePath, "package.json");
    if (!existsSync(pkgPath)) return null;
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        const id = pkg?.execbro?.androidPackageName;
        return typeof id === "string" && id.length > 0 ? id : null;
    } catch {
        return null;
    }
}

/**
 * Discover the Android application id from android/app/build.gradle, falling
 * back to package.json: execbro.androidPackageName.
 */
export function discoverAndroidPackageName(worktreePath: string): string {
    const gradlePath = join(worktreePath, "android", "app", "build.gradle");
    let autodetectError = `no ${gradlePath}`;
    if (existsSync(gradlePath)) {
        const text = readFileSync(gradlePath, "utf8");
        const m = text.match(/applicationId\s+["']([^"']+)["']/);
        if (m) return m[1];
        autodetectError = `applicationId not found in ${gradlePath}`;
    }
    const explicit = readExplicitAndroidPackageName(worktreePath);
    if (explicit) return explicit;
    throw new Error(
        `Could not determine Android package name. Autodetect: ${autodetectError}. ` +
        `Set "execbro.androidPackageName" in package.json to override.`,
    );
}
