import { withRetries } from "../../../src/provisioner/shared.js";

describe("withRetries", () => {
    it("returns the result on first success", async () => {
        let calls = 0;
        const r = await withRetries(async () => { calls++; return 42; }, { retries: 2, backoffMs: 1, label: "x" });
        expect(r).toBe(42);
        expect(calls).toBe(1);
    });

    it("retries up to N times then throws", async () => {
        let calls = 0;
        await expect(withRetries(async () => { calls++; throw new Error("boom"); }, { retries: 2, backoffMs: 1, label: "x" }))
            .rejects.toThrow(/x.*boom/i);
        expect(calls).toBe(3); // initial + 2 retries
    });

    it("succeeds on the second attempt", async () => {
        let calls = 0;
        const r = await withRetries(async () => {
            calls++;
            if (calls === 1) throw new Error("boom");
            return "ok";
        }, { retries: 2, backoffMs: 1, label: "x" });
        expect(r).toBe("ok");
        expect(calls).toBe(2);
    });
});
