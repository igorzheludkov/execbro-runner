import { dirname } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import lockfile from "proper-lockfile";

export type SlotRelease = () => Promise<void>;

export async function tryClaimSlot(lockPath: string): Promise<SlotRelease | null> {
    mkdirSync(dirname(lockPath), { recursive: true });
    if (!existsSync(lockPath)) writeFileSync(lockPath, "");
    try {
        const release = await lockfile.lock(lockPath, { stale: 60_000, retries: 0 });
        return async () => { await release(); };
    } catch (e) {
        if ((e as { code?: string }).code === "ELOCKED") return null;
        throw e;
    }
}

/**
 * Atomically claim N slot locks. Walks paths in order; on any failure,
 * releases every lock acquired so far and returns null. On full success,
 * returns the per-path release callbacks in the same order.
 *
 * Empty input returns an empty array (trivial success).
 */
export async function tryClaimSlots(lockPaths: string[]): Promise<SlotRelease[] | null> {
    const releases: SlotRelease[] = [];
    for (const path of lockPaths) {
        const release = await tryClaimSlot(path);
        if (!release) {
            for (const r of releases) await r();
            return null;
        }
        releases.push(release);
    }
    return releases;
}
