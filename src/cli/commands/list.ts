import { existsSync } from "node:fs";
import { PATHS } from "../../config/paths.js";
import { listDescriptors } from "../../queue/transitions.js";
import type { TaskDescriptor } from "../../queue/descriptor.js";

function formatDevices(d: TaskDescriptor): string {
    return `[${d.devices.map(dev => dev.platform).join(",")}]`;
}

function formatSlots(d: TaskDescriptor): string {
    if (!d.assignedSlotIds || d.assignedSlotIds.length === 0) return "";
    return `  slots=${d.assignedSlotIds.join(",")}`;
}

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
            const mode = d.parallel ? "[parallel]" : "[serial]";
            const port = d.assignedMetroPort ? `  port=${d.assignedMetroPort}` : "";
            const session = d.claudeSessionId ? `  session=${d.claudeSessionId}` : "";
            console.log(`  ${d.id}  ${mode}  ${formatDevices(d)}${formatSlots(d)}${port}${session}  ${d.repo}`);
        }
    }
}
