import { spawnSync } from "node:child_process";

export function notifyMacos(title: string, message: string): void {
    const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
    spawnSync("osascript", ["-e", script], { encoding: "utf8" });
}
