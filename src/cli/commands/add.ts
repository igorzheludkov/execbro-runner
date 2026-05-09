import { existsSync, mkdirSync } from "node:fs";
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
    mode?: "tmux" | "headless";
    platform?: "ios" | "android" | "both";
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

export async function runAdd(opts: AddOptions): Promise<TaskDescriptor> {
    const promptFile = resolve(opts.file);
    if (!existsSync(promptFile)) throw new Error(`Prompt file not found: ${promptFile}`);

    if (opts.mode === "headless") {
        throw new Error("--mode=headless is a Phase 2 feature; only tmux mode is supported in Phase 1");
    }
    if (opts.platform && opts.platform !== "ios") {
        throw new Error(`--platform=${opts.platform} is a Phase 2 feature; only ios is supported in Phase 1`);
    }

    const repo = opts.repo ? resolve(opts.repo) : findGitRoot(dirname(promptFile));
    const baseBranch = getCurrentBranch(repo);
    const id = generateTaskId(promptFile);
    const descriptor: TaskDescriptor = {
        id, promptFile, repo, baseBranch,
        mode: "tmux", platform: "ios", dependsOn: [],
        createdAt: new Date().toISOString(),
        status: "queued",
    };
    const inboxDir = join(execbroRoot(), "queue", "inbox");
    mkdirSync(inboxDir, { recursive: true });
    writeDescriptor(join(inboxDir, `${id}.json`), descriptor);
    return descriptor;
}
