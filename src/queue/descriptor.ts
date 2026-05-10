import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { z } from "zod";

export const DescriptorSchema = z.object({
    id: z.string().min(1),
    promptFile: z.string().min(1),
    repo: z.string().min(1),
    baseBranch: z.string().min(1),
    platform: z.enum(["ios", "android", "both"]),
    dependsOn: z.array(z.string()),
    createdAt: z.string(),
    status: z.enum(["queued", "running", "done", "failed"]),
    forceRebuild: z.boolean().optional(),
    claudeSessionId: z.string().optional(),
}).strict();

export type TaskDescriptor = z.infer<typeof DescriptorSchema>;

function pad(n: number): string {
    return n.toString().padStart(2, "0");
}

export function generateTaskId(promptFilePath: string, now: Date = new Date()): string {
    const base = basename(promptFilePath, extname(promptFilePath));
    const slug = base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const ts = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
    return `${ts}-${slug}`;
}

export function readDescriptor(path: string): TaskDescriptor {
    const raw = readFileSync(path, "utf8");
    return DescriptorSchema.parse(JSON.parse(raw));
}

export function writeDescriptor(path: string, descriptor: TaskDescriptor): void {
    writeFileSync(path, JSON.stringify(descriptor, null, 2), "utf8");
}
