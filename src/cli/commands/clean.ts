import { existsSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { readDescriptor } from "../../queue/descriptor.js";
import type { TaskDescriptor } from "../../queue/descriptor.js";

export interface CleanOptions {
    id?: string;
    allFailed?: boolean;
    allDone?: boolean;
    allRunning?: boolean;
    force?: boolean;
}

interface QueueLocation {
    descriptorPath: string;
    bucket: "inbox" | "running" | "done" | "failed";
    descriptor: TaskDescriptor;
}

function execbroRoot(): string {
    return process.env.EXECBRO_HOME ?? join(homedir(), ".execbro");
}

function bucketDir(bucket: "inbox" | "running" | "done" | "failed"): string {
    return join(execbroRoot(), "queue", bucket);
}

function worktreePath(taskId: string): string {
    return join(execbroRoot(), "worktrees", taskId);
}

function logPath(taskId: string): string {
    return join(execbroRoot(), "logs", `${taskId}.jsonl`);
}

function findTask(id: string): QueueLocation | null {
    for (const bucket of ["inbox", "running", "done", "failed"] as const) {
        const path = join(bucketDir(bucket), `${id}.json`);
        if (existsSync(path)) {
            return { descriptorPath: path, bucket, descriptor: readDescriptor(path) };
        }
    }
    return null;
}

function listTasksInBucket(bucket: "inbox" | "running" | "done" | "failed"): QueueLocation[] {
    const dir = bucketDir(bucket);
    if (!existsSync(dir)) return [];
    const out: QueueLocation[] = [];
    for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        const path = join(dir, name);
        try {
            out.push({ descriptorPath: path, bucket, descriptor: readDescriptor(path) });
        } catch { /* skip unreadable */ }
    }
    return out;
}

function removeWorktreeAndDir(repo: string, taskId: string): void {
    const wt = worktreePath(taskId);
    // Try git worktree remove first so the source repo's registry is updated.
    if (existsSync(repo) && existsSync(join(repo, ".git"))) {
        spawnSync("git", ["-C", repo, "worktree", "remove", "--force", wt], { encoding: "utf8" });
        spawnSync("git", ["-C", repo, "worktree", "prune"], { encoding: "utf8" });
    }
    // If the directory still exists (worktree wasn't tracked, or repo gone), nuke it.
    if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
}

function killOrphanTmuxSessions(taskId: string): void {
    for (const name of [`execbro-${taskId}`, `execbro-metro-${taskId}`]) {
        const has = spawnSync("tmux", ["has-session", "-t", name], { encoding: "utf8" });
        if (has.status === 0) {
            spawnSync("tmux", ["kill-session", "-t", name], { encoding: "utf8" });
        }
    }
}

function cleanOne(loc: QueueLocation): void {
    const id = loc.descriptor.id;
    killOrphanTmuxSessions(id);
    removeWorktreeAndDir(loc.descriptor.repo, id);
    if (existsSync(logPath(id))) unlinkSync(logPath(id));
    unlinkSync(loc.descriptorPath);
    console.log(`cleaned ${id} (${loc.bucket})`);
}

export async function runClean(opts: CleanOptions): Promise<void> {
    const flagCount = [opts.id, opts.allFailed, opts.allDone, opts.allRunning].filter(Boolean).length;
    if (flagCount === 0) {
        throw new Error("Specify a task id, --all-failed, --all-done, or --all-running");
    }
    if (flagCount > 1) {
        throw new Error("Specify only one of: <id>, --all-failed, --all-done, --all-running");
    }

    let targets: QueueLocation[] = [];
    let bypassActiveCheck = false;
    if (opts.id) {
        const loc = findTask(opts.id);
        if (!loc) throw new Error(`Task not found: ${opts.id}`);
        targets = [loc];
    } else if (opts.allFailed) {
        targets = listTasksInBucket("failed");
    } else if (opts.allDone) {
        targets = listTasksInBucket("done");
    } else if (opts.allRunning) {
        targets = listTasksInBucket("running");
        bypassActiveCheck = true; // explicit intent — no --force needed
    }

    if (!opts.force && !bypassActiveCheck) {
        const active = targets.filter(t => t.bucket === "inbox" || t.bucket === "running");
        if (active.length > 0) {
            throw new Error(
                `Refusing to clean active tasks (use --force to override):\n` +
                active.map(a => `  ${a.descriptor.id} (${a.bucket})`).join("\n"),
            );
        }
    }

    if (targets.length === 0) {
        console.log("Nothing to clean.");
        return;
    }

    for (const t of targets) cleanOne(t);
    console.log(`\nDone. Cleaned ${targets.length} task(s).`);
    if (opts.allRunning) {
        console.log("Note: if execbro-worker is currently running, restart it — its in-memory wait loop won't notice the cleanup.");
    }
}
