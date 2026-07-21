import { selectCandidateSlots } from "../../../src/scheduler/candidates.js";
import type { Slot } from "../../../src/config/schema.js";
import type { TaskDescriptor } from "../../../src/queue/descriptor.js";

function makeSlot(overrides: Partial<Slot> = {}): Slot {
    return {
        id: 1,
        platform: "ios",
        deviceId: "UDID-1",
        enabled: true,
        ...overrides,
    };
}

function makeDescriptor(overrides: Partial<TaskDescriptor> = {}): TaskDescriptor {
    return {
        id: "t",
        promptFile: "/p.md",
        repo: "/r",
        baseBranch: "main",
        devices: [{ platform: "ios" }],
        dependsOn: [],
        parallel: false,
        createdAt: "2026-07-21T00:00:00Z",
        status: "queued",
        ...overrides,
    };
}

const neverBusy = () => null;

describe("selectCandidateSlots", () => {
    it("picks the lowest-id free slot for a single-platform request", () => {
        const slots = [makeSlot({ id: 2, deviceId: "B" }), makeSlot({ id: 1, deviceId: "A" })];
        const result = selectCandidateSlots(slots, makeDescriptor(), new Set(), neverBusy);
        expect(result.satisfied).toBe(true);
        expect(result.candidates.map(s => s.id)).toEqual([1]);
    });

    it("is not satisfied when there are no slots for the requested platform", () => {
        const slots = [makeSlot({ id: 1, platform: "android", deviceId: "A" })];
        const result = selectCandidateSlots(slots, makeDescriptor({ devices: [{ platform: "ios" }] }), new Set(), neverBusy);
        expect(result.satisfied).toBe(false);
        expect(result.candidates).toEqual([]);
    });

    it("satisfies a mixed-platform request from separate slots", () => {
        const slots = [
            makeSlot({ id: 1, platform: "ios", deviceId: "A" }),
            makeSlot({ id: 2, platform: "android", deviceId: "B" }),
        ];
        const descriptor = makeDescriptor({ devices: [{ platform: "ios" }, { platform: "android" }] });
        const result = selectCandidateSlots(slots, descriptor, new Set(), neverBusy);
        expect(result.satisfied).toBe(true);
        expect(result.candidates.map(s => s.id).sort()).toEqual([1, 2]);
    });

    describe("enabled: false", () => {
        it("always skips a disabled slot, hopping to the next enabled one", () => {
            const slots = [
                makeSlot({ id: 1, deviceId: "A", enabled: false }),
                makeSlot({ id: 2, deviceId: "B", enabled: true }),
            ];
            const result = selectCandidateSlots(slots, makeDescriptor(), new Set(), neverBusy);
            expect(result.candidates.map(s => s.id)).toEqual([2]);
        });

        it("is not satisfied when the only matching slot is disabled", () => {
            const slots = [makeSlot({ id: 1, deviceId: "A", enabled: false })];
            const result = selectCandidateSlots(slots, makeDescriptor(), new Set(), neverBusy);
            expect(result.satisfied).toBe(false);
        });

        it("forceDevice does NOT bypass enabled: false — disabling is deliberate, not a busy heuristic", () => {
            const slots = [makeSlot({ id: 1, deviceId: "A", enabled: false })];
            const result = selectCandidateSlots(
                slots, makeDescriptor({ forceDevice: true }), new Set(), neverBusy,
            );
            expect(result.satisfied).toBe(false);
        });
    });

    describe("in-flight slots", () => {
        it("skips a slot already claimed by another in-flight task", () => {
            const slots = [
                makeSlot({ id: 1, deviceId: "A" }),
                makeSlot({ id: 2, deviceId: "B" }),
            ];
            const result = selectCandidateSlots(slots, makeDescriptor(), new Set([1]), neverBusy);
            expect(result.candidates.map(s => s.id)).toEqual([2]);
        });
    });

    describe("device pinning (descriptor.devices[].deviceId)", () => {
        it("only considers the pinned deviceId for that platform", () => {
            const slots = [
                makeSlot({ id: 1, platform: "android", deviceId: "Pixel_9" }),
                makeSlot({ id: 2, platform: "android", deviceId: "Medium_Phone" }),
            ];
            const descriptor = makeDescriptor({ devices: [{ platform: "android", deviceId: "Medium_Phone" }] });
            const result = selectCandidateSlots(slots, descriptor, new Set(), neverBusy);
            expect(result.candidates.map(s => s.id)).toEqual([2]);
        });

        it("is not satisfied when the pinned deviceId isn't configured", () => {
            const slots = [makeSlot({ id: 1, platform: "android", deviceId: "Pixel_9" })];
            const descriptor = makeDescriptor({ devices: [{ platform: "android", deviceId: "Nonexistent" }] });
            const result = selectCandidateSlots(slots, descriptor, new Set(), neverBusy);
            expect(result.satisfied).toBe(false);
        });

        it("is not bypassed by forceDevice — pinning and forcing are independent", () => {
            const slots = [
                makeSlot({ id: 1, platform: "android", deviceId: "Pixel_9" }),
                makeSlot({ id: 2, platform: "android", deviceId: "Medium_Phone" }),
            ];
            const descriptor = makeDescriptor({
                devices: [{ platform: "android", deviceId: "Medium_Phone" }],
                forceDevice: true,
            });
            const result = selectCandidateSlots(slots, descriptor, new Set(), neverBusy);
            expect(result.candidates.map(s => s.id)).toEqual([2]);
        });
    });

    describe("busy check + forceDevice", () => {
        it("skips a slot the busy check flags, by default", () => {
            const slots = [
                makeSlot({ id: 1, deviceId: "A" }),
                makeSlot({ id: 2, deviceId: "B" }),
            ];
            const isBusy = (slot: Slot) => (slot.id === 1 ? "app currently running" : null);
            const result = selectCandidateSlots(slots, makeDescriptor(), new Set(), isBusy);
            expect(result.candidates.map(s => s.id)).toEqual([2]);
        });

        it("logs the skip reason", () => {
            const slots = [makeSlot({ id: 1, deviceId: "A" }), makeSlot({ id: 2, deviceId: "B" })];
            const isBusy = (slot: Slot) => (slot.id === 1 ? "app currently running" : null);
            const messages: string[] = [];
            selectCandidateSlots(slots, makeDescriptor(), new Set(), isBusy, msg => messages.push(msg));
            expect(messages.some(m => m.includes("app currently running"))).toBe(true);
        });

        it("forceDevice: true bypasses the busy check", () => {
            const slots = [makeSlot({ id: 1, deviceId: "A" })];
            const isBusy = () => "app currently running";
            const result = selectCandidateSlots(
                slots, makeDescriptor({ forceDevice: true }), new Set(), isBusy,
            );
            expect(result.satisfied).toBe(true);
            expect(result.candidates.map(s => s.id)).toEqual([1]);
        });

        it("is not satisfied when every candidate is busy and forceDevice is unset", () => {
            const slots = [makeSlot({ id: 1, deviceId: "A" }), makeSlot({ id: 2, deviceId: "B" })];
            const isBusy = () => "paired with another Metro";
            const result = selectCandidateSlots(slots, makeDescriptor(), new Set(), isBusy);
            expect(result.satisfied).toBe(false);
        });
    });
});
