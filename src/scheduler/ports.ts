import { tryClaimSlot, type SlotRelease } from "./slots.js";

export interface PortRange {
    from: number;
    to: number;
}

export interface PortClaim {
    port: number;
    release: SlotRelease;
}

export async function claimPortFromRange(
    range: PortRange,
    lockPathFor: (port: number) => string,
): Promise<PortClaim | null> {
    for (let port = range.from; port <= range.to; port++) {
        const release = await tryClaimSlot(lockPathFor(port));
        if (release) return { port, release };
    }
    return null;
}
