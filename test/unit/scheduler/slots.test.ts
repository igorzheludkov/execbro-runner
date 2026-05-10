import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tryClaimSlot, tryClaimSlots } from "../../../src/scheduler/slots.js";

describe("tryClaimSlot", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-test-"));
        mkdirSync(join(dir, "slots"));
    });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("returns a release function on first claim", async () => {
        const release = await tryClaimSlot(join(dir, "slots", "slot-1.lock"));
        expect(typeof release).toBe("function");
        await release!();
    });

    it("returns null when slot is already claimed by another holder", async () => {
        const path = join(dir, "slots", "slot-1.lock");
        const release = await tryClaimSlot(path);
        expect(release).not.toBeNull();
        const second = await tryClaimSlot(path);
        expect(second).toBeNull();
        await release!();
    });

    it("allows re-claim after release", async () => {
        const path = join(dir, "slots", "slot-1.lock");
        const r1 = await tryClaimSlot(path);
        await r1!();
        const r2 = await tryClaimSlot(path);
        expect(r2).not.toBeNull();
        await r2!();
    });
});

describe("tryClaimSlots", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-test-"));
        mkdirSync(join(dir, "slots"));
    });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("returns release functions for all slots when all are free", async () => {
        const paths = [
            join(dir, "slots", "slot-1.lock"),
            join(dir, "slots", "slot-2.lock"),
        ];
        const releases = await tryClaimSlots(paths);
        expect(releases).not.toBeNull();
        expect(releases!.length).toBe(2);
        for (const r of releases!) await r();
    });

    it("returns null and releases partial claims when any lock is taken", async () => {
        const paths = [
            join(dir, "slots", "slot-1.lock"),
            join(dir, "slots", "slot-2.lock"),
        ];
        const heldByOther = await tryClaimSlot(paths[1]);
        expect(heldByOther).not.toBeNull();
        const result = await tryClaimSlots(paths);
        expect(result).toBeNull();
        // slot-1 should be free again — verify by reclaiming.
        const reclaim1 = await tryClaimSlot(paths[0]);
        expect(reclaim1).not.toBeNull();
        await reclaim1!();
        await heldByOther!();
    });

    it("handles single-element input", async () => {
        const releases = await tryClaimSlots([join(dir, "slots", "slot-1.lock")]);
        expect(releases).not.toBeNull();
        expect(releases!.length).toBe(1);
        await releases![0]();
    });

    it("handles empty input by returning an empty array", async () => {
        const releases = await tryClaimSlots([]);
        expect(releases).toEqual([]);
    });
});
