import { extractSessionId } from "../../../src/runner/sessionId.js";

describe("extractSessionId", () => {
    it("returns the session_id from a stream-json system event", () => {
        const line = JSON.stringify({ type: "system", subtype: "init", session_id: "abc-123" });
        expect(extractSessionId(line)).toBe("abc-123");
    });

    it("accepts the camelCase variant (sessionId)", () => {
        const line = JSON.stringify({ type: "assistant", sessionId: "xyz-456" });
        expect(extractSessionId(line)).toBe("xyz-456");
    });

    it("returns null for a line that has neither key", () => {
        const line = JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 100 });
        expect(extractSessionId(line)).toBeNull();
    });

    it("returns null for malformed JSON without throwing", () => {
        expect(extractSessionId("not json {{{")).toBeNull();
    });

    it("returns null for an empty line", () => {
        expect(extractSessionId("")).toBeNull();
    });
});
