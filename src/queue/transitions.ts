import { readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { readDescriptor, type TaskDescriptor } from "./descriptor.js";

export function moveDescriptor(srcPath: string, dstPath: string): void {
    renameSync(srcPath, dstPath);
}

export function listDescriptors(dir: string): TaskDescriptor[] {
    const entries = readdirSync(dir).filter(name => name.endsWith(".json"));
    const descriptors = entries.map(name => readDescriptor(join(dir, name)));
    descriptors.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return descriptors;
}
