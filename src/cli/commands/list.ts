import { existsSync } from "node:fs";
import { PATHS } from "../../config/paths.js";
import { listDescriptors } from "../../queue/transitions.js";
import type { TaskDescriptor } from "../../queue/descriptor.js";

export async function runList(): Promise<void> {
    const buckets: [string, string][] = [
        ["queued", PATHS.queue.inbox],
        ["running", PATHS.queue.running],
        ["done", PATHS.queue.done],
        ["failed", PATHS.queue.failed],
    ];
    for (const [label, dir] of buckets) {
        if (!existsSync(dir)) continue;
        const list: TaskDescriptor[] = listDescriptors(dir);
        console.log(`\n${label.toUpperCase()} (${list.length})`);
        for (const d of list) {
            const port = d.assignedMetroPort ? `  port=${d.assignedMetroPort}` : "";
            const session = d.claudeSessionId ? `  session=${d.claudeSessionId}` : "";
            console.log(`  ${d.id}  [${d.platform}]${port}${session}  ${d.repo}`);
        }
    }
}
