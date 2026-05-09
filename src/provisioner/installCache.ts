import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

function execbroRoot(): string {
    return process.env.EXECBRO_HOME ?? join(homedir(), ".execbro");
}

function cachePath(): string {
    return join(execbroRoot(), "cache", "installed.json");
}

function key(deviceId: string, bundleId: string): string {
    return `${deviceId}::${bundleId}`;
}

function readCache(): Record<string, string> {
    const path = cachePath();
    if (!existsSync(path)) return {};
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return {};
    }
}

function writeCache(cache: Record<string, string>): void {
    const path = cachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache, null, 2), "utf8");
}

export function getCachedFingerprint(deviceId: string, bundleId: string): string | null {
    return readCache()[key(deviceId, bundleId)] ?? null;
}

export function setCachedFingerprint(deviceId: string, bundleId: string, fingerprint: string): void {
    const cache = readCache();
    cache[key(deviceId, bundleId)] = fingerprint;
    writeCache(cache);
}

export function isAppInstalledIos(udid: string, bundleId: string): boolean {
    const r = spawnSync("xcrun", ["simctl", "listapps", udid], { encoding: "utf8" });
    if (r.status !== 0) return false;
    return r.stdout.includes(bundleId);
}
