interface MaybeSession {
    session_id?: unknown;
    sessionId?: unknown;
}

export function extractSessionId(line: string): string | null {
    if (!line) return null;
    let parsed: MaybeSession;
    try { parsed = JSON.parse(line) as MaybeSession; } catch { return null; }
    const v = parsed.session_id ?? parsed.sessionId;
    return typeof v === "string" && v.length > 0 ? v : null;
}
