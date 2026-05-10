import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claimPortFromRange } from "../../../src/scheduler/ports.js";

describe("claimPortFromRange", () => {
    let dir: string;
    const lockPath = (port: number) => join(dir, "ports", `port-${port}.lock`);

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "execbro-ports-"));
        mkdirSync(join(dir, "ports"));
    });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("claims the lowest port in the range when nothing is locked", async () => {
        const claim = await claimPortFromRange({ from: 8090, to: 8092 }, lockPath);
        expect(claim).not.toBeNull();
        expect(claim!.port).toBe(8090);
        await claim!.release();
    });

    it("skips a locked port and claims the next free one", async () => {
        const first = await claimPortFromRange({ from: 8090, to: 8092 }, lockPath);
        expect(first!.port).toBe(8090);

        const second = await claimPortFromRange({ from: 8090, to: 8092 }, lockPath);
        expect(second!.port).toBe(8091);

        await first!.release();
        await second!.release();
    });

    it("returns null when every port in the range is locked", async () => {
        const a = await claimPortFromRange({ from: 8090, to: 8091 }, lockPath);
        const b = await claimPortFromRange({ from: 8090, to: 8091 }, lockPath);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        const c = await claimPortFromRange({ from: 8090, to: 8091 }, lockPath);
        expect(c).toBeNull();
        await a!.release();
        await b!.release();
    });

    it("allows re-claim of the same port after release", async () => {
        const a = await claimPortFromRange({ from: 8090, to: 8090 }, lockPath);
        expect(a!.port).toBe(8090);
        await a!.release();
        const b = await claimPortFromRange({ from: 8090, to: 8090 }, lockPath);
        expect(b!.port).toBe(8090);
        await b!.release();
    });
});
