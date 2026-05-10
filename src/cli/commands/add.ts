import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import {
    generateTaskId,
    writeDescriptor,
    type TaskDescriptor,
} from "../../queue/descriptor.js";

export interface AddOptions {
    file: string;
    repo?: string;
    platform?: "ios" | "android" | "both";
    allowDirty?: boolean;
    force?: boolean;
    forceRebuild?: boolean;
}

function execbroRoot(): string {
    return process.env.EXECBRO_HOME ?? join(homedir(), ".execbro");
}

function findGitRoot(start: string): string {
    let dir = resolve(start);
    while (dir !== "/" && !existsSync(join(dir, ".git"))) dir = dirname(dir);
    if (dir === "/") throw new Error(`No git repo found at or above ${start}`);
    return dir;
}

function getCurrentBranch(repo: string): string {
    return execSync("git symbolic-ref --short HEAD", { cwd: repo }).toString().trim();
}

function getDirtyFiles(repo: string): string[] {
    const out = execSync("git status --porcelain", { cwd: repo, encoding: "utf8" });
    return out.split("\n").filter(Boolean).map(line => line.slice(3));
}

function findActiveTasksForPrompt(promptFile: string): { id: string; bucket: string }[] {
    const root = execbroRoot();
    const matches: { id: string; bucket: string }[] = [];
    for (const bucket of ["inbox", "running"]) {
        const dir = join(root, "queue", bucket);
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) {
            if (!name.endsWith(".json")) continue;
            try {
                const desc = JSON.parse(readFileSync(join(dir, name), "utf8"));
                if (desc.promptFile === promptFile) matches.push({ id: desc.id, bucket });
            } catch { /* skip unreadable */ }
        }
    }
    return matches;
}

export async function runAdd(opts: AddOptions): Promise<TaskDescriptor> {
    const promptFile = resolve(opts.file);
    if (!existsSync(promptFile)) throw new Error(`Prompt file not found: ${promptFile}`);

    if (opts.platform && opts.platform !== "ios") {
        throw new Error(`--platform=${opts.platform} is a Phase 2 feature; only ios is supported in Phase 1`);
    }

    const repo = opts.repo ? resolve(opts.repo) : findGitRoot(dirname(promptFile));

    if (!opts.allowDirty) {
        const dirty = getDirtyFiles(repo);
        if (dirty.length > 0) {
            const list = dirty.slice(0, 10).map(f => `  ${f}`).join("\n");
            const more = dirty.length > 10 ? `\n  ...and ${dirty.length - 10} more` : "";
            throw new Error(
                `Repo has uncommitted changes — the worktree would be branched from HEAD and your edits would be invisible to the agent:\n${list}${more}\n\nCommit (or stash) the changes first, or pass --allow-dirty to proceed anyway.`,
            );
        }
    }

    if (!opts.force) {
        const dups = findActiveTasksForPrompt(promptFile);
        if (dups.length > 0) {
            const list = dups.map(d => `  ${d.id} (${d.bucket})`).join("\n");
            throw new Error(
                `A task for this prompt file is already active:\n${list}\n\nCancel it first, wait for it to finish, or pass --force to enqueue anyway.`,
            );
        }
    }

    const baseBranch = getCurrentBranch(repo);
    const id = generateTaskId(promptFile);
    const descriptor: TaskDescriptor = {
        id, promptFile, repo, baseBranch,
        platform: "ios", dependsOn: [],
        createdAt: new Date().toISOString(),
        status: "queued",
        ...(opts.forceRebuild ? { forceRebuild: true } : {}),
    };
    const inboxDir = join(execbroRoot(), "queue", "inbox");
    mkdirSync(inboxDir, { recursive: true });
    writeDescriptor(join(inboxDir, `${id}.json`), descriptor);
    return descriptor;
}
