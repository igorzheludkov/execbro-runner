import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tryClaimSlot } from "../../../src/scheduler/slots.js";

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
