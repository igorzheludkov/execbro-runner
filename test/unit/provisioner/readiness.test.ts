import { pollUntil } from "../../../src/provisioner/readiness.js";

describe("pollUntil", () => {
    it("returns the value when predicate eventually returns true", async () => {
        let calls = 0;
        const result = await pollUntil(
            async () => { calls++; return calls >= 3 ? "ready" : null; },
            { timeoutMs: 1000, intervalMs: 10 },
        );
        expect(result).toBe("ready");
        expect(calls).toBeGreaterThanOrEqual(3);
    });

    it("throws after timeout", async () => {
        await expect(pollUntil(
            async () => null,
            { timeoutMs: 100, intervalMs: 20 },
        )).rejects.toThrow(/timed out/i);
    });

    it("includes the optional label in the timeout error", async () => {
        await expect(pollUntil(
            async () => null,
            { timeoutMs: 50, intervalMs: 10, label: "sim boot" },
        )).rejects.toThrow(/sim boot/);
    });
});
