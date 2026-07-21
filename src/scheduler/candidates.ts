import type { Slot } from "../config/schema.js";
import type { TaskDescriptor } from "../queue/descriptor.js";

export interface SelectCandidatesResult {
    candidates: Slot[];
    satisfied: boolean;
}

/**
 * Pick slot candidates for a task's device requirements, walking
 * `slots` in ascending `id` order (so a dev's primary/lowest-id device is
 * favored, and the picker hops to the next one when it's unavailable).
 *
 * A slot is skipped — not merely deprioritized — when:
 *  - it's disabled (`slot.enabled === false`), a deliberate exclusion that
 *    `descriptor.forceDevice` does NOT override
 *  - it's already claimed by another in-flight task (`inFlightSlotIds`)
 *  - the task pins a specific device for this platform
 *    (`descriptor.devices[].deviceId`) and this slot isn't it
 *  - `isBusy(slot)` reports a reason and the task hasn't set `forceDevice`
 *
 * `isBusy` should encapsulate the adb/Metro "is someone already using
 * this" probes — passed in as a callback so this selection logic stays
 * pure and unit-testable without shelling out to adb/xcrun/curl.
 *
 * Returns `satisfied: false` (with a possibly-empty/partial `candidates`
 * list) when there aren't enough eligible slots for every requested
 * platform — callers should treat that as "try again later", not use
 * the partial candidate list.
 */
export function selectCandidateSlots(
    slots: Slot[],
    descriptor: TaskDescriptor,
    inFlightSlotIds: ReadonlySet<number>,
    isBusy: (slot: Slot) => string | null,
    log: (msg: string) => void = () => {},
): SelectCandidatesResult {
    const want = { ios: 0, android: 0 };
    for (const dev of descriptor.devices) want[dev.platform]++;

    const pinnedDeviceId: Partial<Record<"ios" | "android", string>> = {};
    for (const dev of descriptor.devices) {
        if (dev.deviceId) pinnedDeviceId[dev.platform] = dev.deviceId;
    }

    const candidates: Slot[] = [];
    for (const slot of slots.slice().sort((a, b) => a.id - b.id)) {
        if (slot.enabled === false) continue;
        if (inFlightSlotIds.has(slot.id)) continue;
        if (want[slot.platform] <= 0) continue;

        const pinned = pinnedDeviceId[slot.platform];
        if (pinned && slot.deviceId !== pinned) continue;

        if (!descriptor.forceDevice) {
            const reason = isBusy(slot);
            if (reason) {
                log(`[worker] skipping ${slot.platform} slot ${slot.id} (${slot.deviceId}): ${reason}`);
                continue;
            }
        }

        candidates.push(slot);
        want[slot.platform]--;
    }

    return { candidates, satisfied: want.ios === 0 && want.android === 0 };
}
