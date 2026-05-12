import { canScheduleHead } from "../../../src/worker/scheduling.js";
import type { TaskDescriptor } from "../../../src/queue/descriptor.js";

function makeDescriptor(overrides: Partial<TaskDescriptor> = {}): TaskDescriptor {
    return {
        id: "t",
        promptFile: "/p.md",
        repo: "/r",
        baseBranch: "main",
        devices: [{ platform: "ios" }],
        dependsOn: [],
        parallel: false,
        createdAt: "2026-05-12T00:00:00Z",
        status: "queued",
        ...overrides,
    };
}

describe("canScheduleHead", () => {
    it("schedules a serial head when nothing is in-flight", () => {
        const head = makeDescriptor({ parallel: false });
        expect(canScheduleHead(head, { inFlightSlotCount: 0, serialInFlightCount: 0 })).toBe(true);
    });

    it("blocks a serial head when anything is in-flight", () => {
        const head = makeDescriptor({ parallel: false });
        expect(canScheduleHead(head, { inFlightSlotCount: 1, serialInFlightCount: 0 })).toBe(false);
    });

    it("schedules a parallel head alongside other parallel tasks", () => {
        const head = makeDescriptor({ parallel: true });
        expect(canScheduleHead(head, { inFlightSlotCount: 1, serialInFlightCount: 0 })).toBe(true);
    });

    it("blocks a parallel head while a serial task is in-flight", () => {
        const head = makeDescriptor({ parallel: true });
        expect(canScheduleHead(head, { inFlightSlotCount: 1, serialInFlightCount: 1 })).toBe(false);
    });

    it("schedules a parallel head when nothing is in-flight", () => {
        const head = makeDescriptor({ parallel: true });
        expect(canScheduleHead(head, { inFlightSlotCount: 0, serialInFlightCount: 0 })).toBe(true);
    });
});
