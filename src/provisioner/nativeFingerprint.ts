import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const EXCLUDED_DIRS = new Set([
    "node_modules", "build", "Pods", "DerivedData", ".gradle", ".idea",
    "xcuserdata", "Build", ".cxx",
]);

const LOCKFILES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "ios/Podfile.lock"];

function* walk(dir: string, root: string): Generator<string> {
    if (!existsSync(dir)) return;
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    entries.sort();
    for (const name of entries) {
        if (EXCLUDED_DIRS.has(name)) continue;
        const path = join(dir, name);
        let st;
        try {
            st = statSync(path);
        } catch {
            continue;
        }
        if (st.isDirectory()) {
            yield* walk(path, root);
        } else if (st.isFile()) {
            yield relative(root, path);
        }
    }
}

function hashFile(path: string): string {
    const h = createHash("sha256");
    h.update(readFileSync(path));
    return h.digest("hex");
}

/**
 * Compute a stable fingerprint of the worktree's native side. Identical
 * fingerprints across two worktrees mean a rebuild is not necessary —
 * Metro will pick up any JS-only differences via reload_app.
 *
 * Inputs:
 *   - all files under ios/ and android/, excluding build artifacts
 *   - package.json
 *   - any lockfile present at the repo root or ios/Podfile.lock
 */
export function nativeFingerprint(worktreePath: string): string {
    const h = createHash("sha256");
    const parts: string[] = [];

    for (const nativeDir of ["ios", "android"]) {
        const dir = join(worktreePath, nativeDir);
        for (const rel of walk(dir, worktreePath)) {
            parts.push(`${rel}\0${hashFile(join(worktreePath, rel))}`);
        }
    }

    const pkgPath = join(worktreePath, "package.json");
    if (existsSync(pkgPath)) {
        parts.push(`package.json\0${hashFile(pkgPath)}`);
    }

    for (const lock of LOCKFILES) {
        const path = join(worktreePath, lock);
        if (existsSync(path)) parts.push(`${lock}\0${hashFile(path)}`);
    }

    parts.sort();
    h.update(parts.join("\n"));
    return h.digest("hex");
}
