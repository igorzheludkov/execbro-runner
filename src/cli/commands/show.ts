import { existsSync } from "node:fs";
import { join } from "node:path";
import { PATHS, logPath } from "../../config/paths.js";
import { readDescriptor } from "../../queue/descriptor.js";

const BUCKETS = [PATHS.queue.inbox, PATHS.queue.running, PATHS.queue.done, PATHS.queue.failed];

export async function runShow(id: string): Promise<void> {
    for (const bucket of BUCKETS) {
        const path = join(bucket, `${id}.json`);
        if (existsSync(path)) {
            const d = readDescriptor(path);
            console.log(JSON.stringify(d, null, 2));
            console.log(`\nLog: ${logPath(id)} ${existsSync(logPath(id)) ? "(exists)" : "(not yet)"}`);
            return;
        }
    }
    console.error(`Task not found: ${id}`);
    process.exit(1);
}
