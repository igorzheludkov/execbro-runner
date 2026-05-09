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
 * Uses load-buffer + paste-buffer so that embedded newlines do NOT act as
 * Enter in Claude Code's TUI. Caller is responsible for sending Enter
 * afterwards if the target app needs a separate submit keypress.
 */
export function pasteText(name: string, text: string): void {
    const buf = `execbro-paste-${Date.now()}`;
    const load = spawnSync("tmux", ["load-buffer", "-b", buf, "-"], { input: text, encoding: "utf8" });
    if (load.status !== 0) throw new Error(`tmux load-buffer failed: ${load.stderr}`);
    const paste = tmux(["paste-buffer", "-b", buf, "-t", name]);
    if (paste.code !== 0) throw new Error(`tmux paste-buffer failed: ${paste.stderr}`);
    tmux(["delete-buffer", "-b", buf]);
}

export function killSession(name: string): void {
    if (sessionExists(name)) tmux(["kill-session", "-t", name]);
}

export function sessionName(taskId: string): string {
    return `execbro-${taskId}`;
}
