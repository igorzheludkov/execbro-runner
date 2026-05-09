import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface IsDoneOptions {
    transcriptPath: string;
    idleSec: number;
}

interface AssistantContentBlock {
    type: string;
}

interface TranscriptLine {
    type?: string;
    message?: { role?: string; content?: AssistantContentBlock[] | string };
}

export function isDone(opts: IsDoneOptions): boolean {
    if (!existsSync(opts.transcriptPath)) return false;

    const stat = statSync(opts.transcriptPath);
    const ageSec = Math.max(0, (Date.now() - stat.mtimeMs) / 1000);
    if (ageSec < opts.idleSec) return false;

    const raw = readFileSync(opts.transcriptPath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length === 0) return false;
    let parsed: TranscriptLine;
    try {
        parsed = JSON.parse(lines[lines.length - 1]);
    } catch {
        return false;
    }
    if (parsed.type !== "assistant") return false;
    const content = parsed.message?.content;
    if (!Array.isArray(content)) return true; // text-string content = done
    const hasToolUse = content.some(block => block.type === "tool_use");
    return !hasToolUse;
}

export function findNewestTranscript(projectDir: string, sinceMs: number): string | null {
    if (!existsSync(projectDir)) return null;
    const files = readdirSync(projectDir).filter(n => n.endsWith(".jsonl"));
    let best: { path: string; mtime: number } | null = null;
    for (const name of files) {
        const path = join(projectDir, name);
        const m = statSync(path).mtimeMs;
        if (m < sinceMs) continue;
        if (!best || m > best.mtime) best = { path, mtime: m };
    }
    return best?.path ?? null;
}

export function encodeProjectPath(cwd: string): string {
    return cwd.replace(/\//g, "-");
}
