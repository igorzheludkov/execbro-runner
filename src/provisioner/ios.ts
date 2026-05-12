import { spawnSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pollUntil } from "./readiness.js";
import * as tmux from "../runner/tmux.js";

const TEST_OR_EXT_SUFFIXES = [
    ".tests", ".testing", "tests",
    ".widget", ".watchkitapp", ".notificationservice",
];

function isMainTargetBundleId(bundleId: string): boolean {
    const lower = bundleId.toLowerCase();
    return !TEST_OR_EXT_SUFFIXES.some(suffix => lower.endsWith(suffix.toLowerCase()));
}

function findSingleXcodeProj(worktreePath: string): string | null {
    const iosDir = join(worktreePath, "ios");
    if (!existsSync(iosDir)) return null;
    const candidates = readdirSync(iosDir).filter(name => name.endsWith(".xcodeproj"));
    if (candidates.length !== 1) return null;
    const pbx = join(iosDir, candidates[0], "project.pbxproj");
    return existsSync(pbx) ? pbx : null;
}

function readExplicitIosBundleId(worktreePath: string): string | null {
    const pkgPath = join(worktreePath, "package.json");
    if (!existsSync(pkgPath)) return null;
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        const id = pkg?.execbro?.iosBundleId;
        return typeof id === "string" && id.length > 0 ? id : null;
    } catch {
        return null;
    }
}

/**
 * Discover the main app's iOS bundle identifier.
 *
 *   1. Glob ios/*.xcodeproj/project.pbxproj. If exactly one match, regex
 *      every PRODUCT_BUNDLE_IDENTIFIER value, drop test/widget/extension
 *      suffixes, and return the single remaining distinct value.
 *   2. Fall back to package.json: execbro.iosBundleId.
 *   3. Throw with a clear error if neither path resolves.
 */
export function discoverIosBundleId(worktreePath: string): string {
    const pbxPath = findSingleXcodeProj(worktreePath);
    let autodetectError = "no ios/*.xcodeproj found";
    if (pbxPath) {
        const text = readFileSync(pbxPath, "utf8");
        const matches = [...text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";\s]+)"?\s*;/g)];
        const distinct = [...new Set(matches.map(m => m[1]))].filter(isMainTargetBundleId);
        if (distinct.length === 1) return distinct[0];
        autodetectError = distinct.length === 0
            ? `no main-target PRODUCT_BUNDLE_IDENTIFIER found in ${pbxPath}`
            : `multiple main-target candidates in ${pbxPath}: ${distinct.join(", ")}`;
    }
    const explicit = readExplicitIosBundleId(worktreePath);
    if (explicit) return explicit;
    throw new Error(
        `Could not determine iOS bundle id. Autodetect: ${autodetectError}. ` +
        `Set "execbro.iosBundleId" in package.json to override.`,
    );
}

export interface IosProvisionInput {
    udid: string;
    metroPort: number;
    worktreePath: string;
    bundleId: string;
    timeouts: { deviceBootSec: number; metroReadySec: number; appInstallSec: number };
    metroSessionName: string; // e.g. execbro-metro-<taskId>
}

// Cache of UDID → simulator display name. The list is stable across a
// worker's lifetime (slots are config-pinned UDIDs), so one fetch is
// enough; we re-run simctl only on cache miss.
let simNameCache: Map<string, string> | null = null;

/**
 * Resolve an iOS simulator UDID to its display name (e.g. "iPhone Air").
 *
 * Used by the slot picker to compare against Metro's `/json` endpoint,
 * which reports the sim by name rather than UDID. Returns null when
 * simctl is unavailable or the UDID isn't found — caller treats null as
 * "can't tell, don't over-skip".
 */
export function getSimNameByUdid(udid: string): string | null {
    if (simNameCache && simNameCache.has(udid)) return simNameCache.get(udid)!;
    const r = spawnSync(
        "xcrun",
        ["simctl", "list", "devices", "--json"],
        { encoding: "utf8", timeout: 10_000 },
    );
    if (r.status !== 0) return simNameCache?.get(udid) ?? null;
    try {
        const data = JSON.parse(r.stdout) as {
            devices: Record<string, Array<{ udid: string; name: string }>>;
        };
        const map = new Map<string, string>();
        for (const list of Object.values(data.devices)) {
            for (const d of list) map.set(d.udid, d.name);
        }
        simNameCache = map;
        return map.get(udid) ?? null;
    } catch {
        return null;
    }
}

export async function bootIosSimulator(udid: string, timeoutSec: number): Promise<void> {
    spawnSync("xcrun", ["simctl", "boot", udid], { encoding: "utf8" });
    // simctl boot returns 0 even if already booted; bootstatus blocks until ready.
    await pollUntil(async () => {
        const r = spawnSync("xcrun", ["simctl", "bootstatus", udid], { encoding: "utf8", timeout: 5000 });
        if (r.status === 0) return true;
        return null;
    }, { timeoutMs: timeoutSec * 1000, intervalMs: 2000, label: `ios sim boot ${udid}` });
}

export function uninstallApp(udid: string, bundleId: string): void {
    // 30s timeout: simctl uninstall can wedge if the app is mid-launch or the
    // sim is in a transitional state, blocking the entire Node event loop
    // (and therefore other slots' parallel provisioning) since spawnSync is
    // strictly synchronous. Failure (incl. timeout) is ignored — the worst
    // case is the subsequent install replaces a leftover binary, which is fine.
    spawnSync("xcrun", ["simctl", "uninstall", udid, bundleId], { encoding: "utf8", timeout: 30_000 });
}

/**
 * Read the bundler location the installed app is currently pinned to, via
 * NSUserDefaults RCT_jsLocation. Returns null if the key isn't set (app
 * never opened or default Metro target) or if the read fails (app not
 * installed). The returned string is whatever the app wrote — typically
 * `localhost:<port>`.
 */
export function readBundlerLocation(udid: string, bundleId: string): string | null {
    // 10s timeout: simctl spawn can wedge if the sim is mid-boot/reboot/frozen,
    // and the runner has no way to recover from an uncapped spawn — treat
    // hangs as "no known bundler location" and proceed.
    const r = spawnSync(
        "xcrun",
        ["simctl", "spawn", udid, "defaults", "read", bundleId, "RCT_jsLocation"],
        { encoding: "utf8", timeout: 10_000 },
    );
    if (r.status !== 0) return null;
    const v = r.stdout.trim();
    return v || null;
}

/**
 * Tell the app's RCTBundleURLProvider where Metro is. RN sim debug builds
 * default to localhost:8081 unless NSUserDefaults `RCT_jsLocation` overrides
 * it (this is the same key the dev menu's "Configure Bundler" sets). Build-
 * time `RCT_METRO_PORT` does NOT change this default for sim builds, so
 * pointing the app at a non-default Metro port has to happen at runtime via
 * the app's preferences domain.
 *
 * Writes are scoped to `<bundleId>`, persisted in the simulator's
 * preferences DB, and picked up on the next launch.
 */
export function setBundlerLocation(udid: string, bundleId: string, metroPort: number): void {
    const r = spawnSync(
        "xcrun",
        ["simctl", "spawn", udid, "defaults", "write", bundleId, "RCT_jsLocation", `localhost:${metroPort}`],
        { encoding: "utf8" },
    );
    if (r.status !== 0) {
        throw new Error(`failed to write RCT_jsLocation for ${bundleId}: ${r.stderr.trim() || r.stdout.trim()}`);
    }
}

/**
 * Launch the app on the sim. Idempotent — if the app is already running,
 * `simctl launch` terminates it first then relaunches, so we always end
 * up with a fresh process. Caller is responsible for `setBundlerLocation`
 * before launching when running on a non-default Metro port.
 */
export function launchApp(udid: string, bundleId: string): void {
    spawnSync("xcrun", ["simctl", "terminate", udid, bundleId], { encoding: "utf8" });
    const r = spawnSync("xcrun", ["simctl", "launch", udid, bundleId], { encoding: "utf8" });
    if (r.status !== 0) {
        throw new Error(`simctl launch ${bundleId} failed: ${r.stderr.trim() || r.stdout.trim()}`);
    }
}

function killProcessOnPort(port: number): void {
    // lsof -ti :<port> prints just the PID(s); kill them. Best-effort.
    const r = spawnSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" });
    const pids = r.stdout.split("\n").map(s => s.trim()).filter(Boolean);
    for (const pid of pids) {
        spawnSync("kill", ["-9", pid], { encoding: "utf8" });
    }
}

export async function startMetro(
    worktreePath: string,
    port: number,
    timeoutSec: number,
    metroSessionName: string,
): Promise<void> {
    if (tmux.sessionExists(metroSessionName)) tmux.killSession(metroSessionName);
    // Belt-and-suspenders: free the port if a zombie process is still holding it
    // (stale Metro from a previous failed run, etc.).
    killProcessOnPort(port);
    tmux.newDetachedSession(metroSessionName, worktreePath);
    tmux.sendKeys(
        metroSessionName,
        `RCT_METRO_PORT=${port} npx react-native start --port ${port} --reset-cache`,
        true,
    );
    await pollUntil(async () => {
        try {
            const r = spawnSync("curl", ["-sf", `http://localhost:${port}/status`], { encoding: "utf8" });
            return r.status === 0 ? true : null;
        } catch { return null; }
    }, { timeoutMs: timeoutSec * 1000, intervalMs: 2000, label: `metro ready on :${port}` });
}

export function stopMetro(metroSessionName: string, port: number): void {
    if (tmux.sessionExists(metroSessionName)) tmux.killSession(metroSessionName);
    // Tmux kill doesn't always reap the child Metro process cleanly.
    killProcessOnPort(port);
}

/**
 * Run `pod install` (via bundler if Gemfile present) inside the worktree's ios/ dir.
 * No-op if there's no ios/ or no Podfile (e.g. Expo managed workflow).
 *
 * Modern RN templates use bundler, so we detect ios/Gemfile or repo-root Gemfile
 * and prefer `bundle exec pod install`. Falls back to bare `pod install`.
 */
export function installIosPods(worktreePath: string): void {
    const iosDir = join(worktreePath, "ios");
    if (!existsSync(iosDir)) return;
    if (!existsSync(join(iosDir, "Podfile"))) return;

    const useBundler =
        existsSync(join(worktreePath, "Gemfile")) ||
        existsSync(join(iosDir, "Gemfile"));

    if (useBundler) {
        // Ensure gems are installed before invoking bundler.
        execSync("bundle install", { cwd: worktreePath, stdio: "inherit" });
        execSync("bundle exec pod install", { cwd: iosDir, stdio: "inherit" });
    } else {
        execSync("pod install", { cwd: iosDir, stdio: "inherit" });
    }
}

export async function buildAndInstall(
    worktreePath: string,
    udid: string,
    metroPort: number,
    bundleId: string,
    timeoutSec: number,
): Promise<void> {
    // --no-packager: we already started Metro on metroPort; otherwise the CLI
    // detects the existing Metro and prompts interactively for an alternate port,
    // which hangs forever in non-interactive mode.
    execSync(`RCT_METRO_PORT=${metroPort} npx react-native run-ios --udid ${udid} --no-packager`, {
        cwd: worktreePath, stdio: "inherit",
    });
    await pollUntil(async () => {
        const r = spawnSync("xcrun", ["simctl", "listapps", udid], { encoding: "utf8" });
        return r.stdout.includes(bundleId) ? true : null;
    }, { timeoutMs: timeoutSec * 1000, intervalMs: 2000, label: `app install ${bundleId}` });
}
