export interface PollOptions {
    timeoutMs: number;
    intervalMs: number;
    label?: string;
}

export async function pollUntil<T>(
    probe: () => Promise<T | null>,
    opts: PollOptions,
): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < opts.timeoutMs) {
        const result = await probe();
        if (result !== null && result !== undefined) return result;
        await new Promise(r => setTimeout(r, opts.intervalMs));
    }
    const label = opts.label ?? "operation";
    throw new Error(`Polling for ${label} timed out after ${opts.timeoutMs}ms`);
}
