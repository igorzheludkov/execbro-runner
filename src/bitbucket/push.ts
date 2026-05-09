import { spawnSync, execSync } from "node:child_process";

export interface BuildPrUrlInput {
    remoteUrl: string;
    sourceBranch: string;
    destBranch: string;
}

export function buildBitbucketPrUrl(input: BuildPrUrlInput): string {
    const m = input.remoteUrl.match(/bitbucket\.org[:/]([^/]+)\/([^/]+?)(\.git)?$/);
    if (!m) throw new Error(`Not a Bitbucket remote URL: ${input.remoteUrl}`);
    const [, workspace, repo] = m;
    return `https://bitbucket.org/${workspace}/${repo}/pull-requests/new?source=${input.sourceBranch}&dest=${input.destBranch}`;
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
