import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = process.env.EXECBRO_HOME ?? join(homedir(), ".execbro");

export const PATHS = {
    root: ROOT,
    config: join(ROOT, "config.json"),
    templates: join(ROOT, "templates"),
    templateAgentPreamble: join(ROOT, "templates", "agent-preamble.md"),
    templateVerificationSuffix: join(ROOT, "templates", "verification-suffix.md"),
    slots: join(ROOT, "slots"),
    queue: {
        inbox: join(ROOT, "queue", "inbox"),
        running: join(ROOT, "queue", "running"),
        done: join(ROOT, "queue", "done"),
        failed: join(ROOT, "queue", "failed"),
    },
    worktrees: join(ROOT, "worktrees"),
    logs: join(ROOT, "logs"),
};

export function slotLockPath(slotId: number): string {
    return join(PATHS.slots, `slot-${slotId}.lock`);
}

export function worktreePath(taskId: string): string {
    return join(PATHS.worktrees, taskId);
}

export function logPath(taskId: string): string {
    return join(PATHS.logs, `${taskId}.jsonl`);
}
