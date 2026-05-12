import type { TaskDescriptor } from "../queue/descriptor.js";

export interface InFlightState {
    inFlightSlotCount: number;
    serialInFlightCount: number;
}

/**
 * Decide whether the FIFO head of the queue may be scheduled given the
 * current in-flight state.
 *
 * Rules:
 *  - A serial task (`parallel === false`) only starts when nothing is in-flight.
 *  - A parallel task may start alongside other parallel tasks, but waits if
 *    any serial task is currently in-flight.
 */
export function canScheduleHead(head: TaskDescriptor, state: InFlightState): boolean {
    if (!head.parallel) return state.inFlightSlotCount === 0;
    return state.serialInFlightCount === 0;
}
