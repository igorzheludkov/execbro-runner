import { spawnSync, execSync } from "node:child_process";

export interface BuildPrUrlInput {
    remoteUrl: string;
    sourceBranch: string;
    destBranch: string;
}

/**
 * Build a "create new pull request" URL for the host inferred from the
 * remote URL. Returns null when the host isn't recognized — callers should
 * still surface the local commit + branch name to the human.
 */
export function buildPrUrl(input: BuildPrUrlInput): string | null {
    const bb = input.remoteUrl.match(/bitbucket\.org[:/]([^/]+)\/([^/]+?)(\.git)?$/);
    if (bb) {
        const [, workspace, repo] = bb;
        return `https://bitbucket.org/${workspace}/${repo}/pull-requests/new?source=${input.sourceBranch}&dest=${input.destBranch}`;
    }
    const gh = input.remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/);
    if (gh) {
        const [, owner, repo] = gh;
        return `https://github.com/${owner}/${repo}/compare/${input.destBranch}...${input.sourceBranch}?expand=1`;
    }
    return null;
}

export function commitIfDirty(worktreePath: string, message: string): void {
    const status = execSync("git status --porcelain", { cwd: worktreePath, encoding: "utf8" });
    if (status.trim() === "") return;
    execSync("git add -A", { cwd: worktreePath });
    execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: worktreePath });
}

export function pushBranch(worktreePath: string, branch: string): void {
    const r = spawnSync("git", ["push", "-u", "origin", branch], { cwd: worktreePath, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git push failed: ${r.stderr}`);
}

export function getRemoteUrl(worktreePath: string): string {
    return execSync("git remote get-url origin", { cwd: worktreePath, encoding: "utf8" }).trim();
}
