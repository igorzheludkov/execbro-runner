import { spawnSync } from "node:child_process";

function tmux(args: string[]): { code: number; stdout: string; stderr: string } {
    const result = spawnSync("tmux", args, { encoding: "utf8" });
    return {
        code: result.status ?? -1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
    };
}

export function sessionExists(name: string): boolean {
    const r = tmux(["has-session", "-t", name]);
    return r.code === 0;
}

export function newDetachedSession(name: string, cwd: string): void {
    if (sessionExists(name)) throw new Error(`tmux session already exists: ${name}`);
    const r = tmux(["new-session", "-d", "-s", name, "-c", cwd]);
    if (r.code !== 0) throw new Error(`tmux new-session failed: ${r.stderr}`);
}

export function sendKeys(name: string, text: string, pressEnter: boolean): void {
    const args = ["send-keys", "-t", name, text];
    if (pressEnter) args.push("Enter");
    const r = tmux(args);
    if (r.code !== 0) throw new Error(`tmux send-keys failed: ${r.stderr}`);
}

/**
 * Paste a multi-line string as a single message into the tmux session.
 * Uses load-buffer + paste-buffer with -p (bracketed paste mode) so the
 * receiving app sees a single paste event rather than a stream of
 * keystrokes. Without -p, Claude Code's TUI interprets each embedded
 * newline as Enter, which mangles or prematurely submits the prompt.
 *
 * Caller is responsible for sending Enter afterwards to actually submit.
 */
export function pasteText(name: string, text: string): void {
    const buf = `execbro-paste-${Date.now()}`;
    const load = spawnSync("tmux", ["load-buffer", "-b", buf, "-"], { input: text, encoding: "utf8" });
    if (load.status !== 0) throw new Error(`tmux load-buffer failed: ${load.stderr}`);
    const paste = tmux(["paste-buffer", "-p", "-b", buf, "-t", name]);
    if (paste.code !== 0) throw new Error(`tmux paste-buffer failed: ${paste.stderr}`);
    tmux(["delete-buffer", "-b", buf]);
}

export function killSession(name: string): void {
    if (sessionExists(name)) tmux(["kill-session", "-t", name]);
}

export function sessionName(taskId: string): string {
    return `execbro-${taskId}`;
}

/**
 * Send a single Enter key to a session. Use this instead of
 * `sendKeys(name, "", true)` when there's no preceding text — empty-string
 * args are an error-prone tmux usage. Notably, after a bracketed paste,
 * Claude Code's TUI sometimes drops the first Enter; combine this with
 * the retry helper in submitPrompt.ts.
 */
export function pressEnter(name: string): void {
    const r = tmux(["send-keys", "-t", name, "Enter"]);
    if (r.code !== 0) throw new Error(`tmux send-keys Enter failed: ${r.stderr}`);
}

/** Capture the visible content of a pane as a string. */
export function capturePane(name: string): string {
    const r = tmux(["capture-pane", "-t", name, "-p"]);
    if (r.code !== 0) throw new Error(`tmux capture-pane failed: ${r.stderr}`);
    return r.stdout;
}
