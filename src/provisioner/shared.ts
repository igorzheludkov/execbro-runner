import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync, execSync } from "node:child_process";

export interface RetryOptions {
    retries: number;
    backoffMs: number;
    label: string;
}

export async function withRetries<T>(
    fn: () => Promise<T>,
    opts: RetryOptions,
): Promise<T> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= opts.retries; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e as Error;
            if (attempt < opts.retries) {
                await new Promise(r => setTimeout(r, opts.backoffMs));
            }
        }
    }
    throw new Error(`${opts.label} failed after ${opts.retries + 1} attempts: ${lastErr?.message}`);
}

export function createWorktree(repo: string, worktreePath: string, branch: string, baseBranch: string): void {
    const r = spawnSync("git", ["worktree", "add", worktreePath, "-b", branch, baseBranch], {
        cwd: repo, encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`git worktree add failed: ${r.stderr}`);
}

export function removeWorktree(repo: string, worktreePath: string): void {
    spawnSync("git", ["worktree", "remove", "--force", worktreePath], { cwd: repo, encoding: "utf8" });
}

export function detectPackageManager(worktreePath: string): "npm" | "yarn" | "pnpm" {
    if (existsSync(join(worktreePath, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(worktreePath, "yarn.lock"))) return "yarn";
    return "npm";
}

export function installDependencies(worktreePath: string): void {
    const pm = detectPackageManager(worktreePath);
    const cmd = pm === "yarn" ? "yarn install --frozen-lockfile" :
                pm === "pnpm" ? "pnpm install --frozen-lockfile" :
                                "npm ci";
    execSync(cmd, { cwd: worktreePath, stdio: "inherit" });
}
