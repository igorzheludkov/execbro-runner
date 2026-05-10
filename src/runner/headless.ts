import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { extractSessionId } from "./sessionId.js";

export interface RunHeadlessAgentOptions {
    prompt: string;
    systemPrompt: string;
    cwd: string;
    logPath: string;
    onSessionId?: (sessionId: string) => void;
    /** Injected for tests; defaults to node:child_process.spawn. */
    spawn?: (command: string, args: string[], opts: SpawnOptions) => ChildProcess;
}

export interface RunHeadlessAgentResult {
    exitCode: number;
    sessionId: string | null;
}

export async function runHeadlessAgent(opts: RunHeadlessAgentOptions): Promise<RunHeadlessAgentResult> {
    const args = [
        "-p", opts.prompt,
        "--dangerously-skip-permissions",
        "--output-format", "stream-json",
        "--append-system-prompt", opts.systemPrompt,
    ];
    const spawnFn = opts.spawn ?? nodeSpawn;
    const child = spawnFn("claude", args, {
        cwd: opts.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
    });

    const logStream = createWriteStream(opts.logPath, { flags: "a" });
    let sessionId: string | null = null;

    if (!child.stdout) throw new Error("spawned child has no stdout pipe");
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line: string) => {
        logStream.write(line + "\n");
        if (sessionId) return;
        const id = extractSessionId(line);
        if (id) {
            sessionId = id;
            opts.onSessionId?.(id);
        }
    });

    const exitCodePromise = new Promise<number>(resolve => {
        child.on("exit", (code: number | null) => resolve(code ?? -1));
    });
    const linesClosed = new Promise<void>(resolve => lines.on("close", () => resolve()));
    const [exitCode] = await Promise.all([exitCodePromise, linesClosed]);
    await new Promise<void>(resolve => logStream.end(resolve));
    return { exitCode, sessionId };
}
