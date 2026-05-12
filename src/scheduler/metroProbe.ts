// Discover which simulators/emulators on this host are currently paired
// with a Metro instance. Used by the slot picker to skip devices that
// the user (or another concurrent runner task) is already using, so a
// new task hops to the next free device instead of stomping the running
// dev session.
//
// Each Metro instance exposes its connected JS runtime targets at
// `/json` (Chrome DevTools target list). The `deviceName` on each entry
// identifies the device that registered the runtime: `emulator-NNNN`
// for Android emulators, the simulator's display name (e.g.
// "iPhone Air") for iOS sims. Caller maps slot IDs to those names.

const COMMON_METRO_PORTS = [8081, 8082, 19000, 19001, 19002];

interface MetroJsonEntry {
    deviceName?: string;
}

/**
 * Returns the set of `deviceName`s currently connected to any Metro on
 * this host whose port is NOT in `excludePorts`. `extraPortsToScan` lets
 * the worker include its own `metroPortRange` so concurrent tasks on
 * sibling ports are also detected.
 */
export async function findDevicesInUseByOtherMetros(
    excludePorts: Set<number>,
    extraPortsToScan: number[] = [],
): Promise<Set<string>> {
    const result = new Set<string>();
    const ports = new Set<number>([...COMMON_METRO_PORTS, ...extraPortsToScan]);
    for (const port of ports) {
        if (excludePorts.has(port)) continue;
        try {
            const r = await fetch(`http://localhost:${port}/json`, {
                signal: AbortSignal.timeout(2000),
            });
            if (!r.ok) continue;
            const list = await r.json() as MetroJsonEntry[];
            for (const entry of list) {
                if (entry?.deviceName) result.add(entry.deviceName);
            }
        } catch {
            // Port not Metro / unreachable / JSON parse failure — treat as no info.
        }
    }
    return result;
}

export function rangeOf(range: { from: number; to: number }): number[] {
    const out: number[] = [];
    for (let p = range.from; p <= range.to; p++) out.push(p);
    return out;
}
