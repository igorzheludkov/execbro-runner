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
