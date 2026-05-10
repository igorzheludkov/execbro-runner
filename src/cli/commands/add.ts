import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import {
    generateTaskId,
    writeDescriptor,
    type TaskDescriptor,
    type DeviceDecl,
} from "../../queue/descriptor.js";

export interface AddOptions {
    file: string;
    repo?: string;
    devices?: string;
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

function parseDevices(raw: string | undefined): DeviceDecl[] {
    const list = (raw ?? "ios").split(",").map(s => s.trim()).filter(Boolean);
    if (list.length === 0) throw new Error(`--devices must list at least one platform`);
    return list.map(token => {
        if (token !== "ios" && token !== "android") {
            throw new Error(`--devices entry "${token}" is not "ios" or "android"`);
        }
        return { platform: token };
    });
}

export async function runAdd(opts: AddOptions): Promise<TaskDescriptor> {
    const promptFile = resolve(opts.file);
    if (!existsSync(promptFile)) throw new Error(`Prompt file not found: ${promptFile}`);

    const devices = parseDevices(opts.devices);
    const repo = opts.repo ? resolve(opts.repo) : findGitRoot(dirname(promptFile));

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
        devices, dependsOn: [],
        createdAt: new Date().toISOString(),
        status: "queued",
        ...(opts.forceRebuild ? { forceRebuild: true } : {}),
    };
    const inboxDir = join(execbroRoot(), "queue", "inbox");
    mkdirSync(inboxDir, { recursive: true });
    writeDescriptor(join(inboxDir, `${id}.json`), descriptor);
    return descriptor;
}
