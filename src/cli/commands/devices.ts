import { listIosDevices, listAndroidDevices } from "../devices/discover.js";

export async function runDevices(): Promise<void> {
    const ios = listIosDevices();
    const android = listAndroidDevices();
    const all = [...ios, ...android];
    console.log("PLATFORM  NAME                          IDENTIFIER                              RUNTIME              BOOTED");
    for (const d of all) {
        const name = d.name.padEnd(30).slice(0, 30);
        const id = d.identifier.padEnd(38).slice(0, 38);
        const runtime = d.runtime.padEnd(20).slice(0, 20);
        const booted = d.booted
            ? `yes${d.runningEmulatorId ? ` (${d.runningEmulatorId})` : ""}`
            : "no";
        console.log(`${d.platform.padEnd(9)} ${name} ${id} ${runtime} ${booted}`);
    }
}
