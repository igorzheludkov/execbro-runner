#!/usr/bin/env node
import { Command } from "commander";
import { runAdd } from "./commands/add.js";
import { runList } from "./commands/list.js";
import { runShow } from "./commands/show.js";
import { runDevices } from "./commands/devices.js";
import { runClean } from "./commands/clean.js";
import { runInit } from "./commands/init.js";

const program = new Command();
program.name("execbro-task").description("Enqueue and inspect ExecBro autonomous tasks");

program
    .command("add <file>")
    .description("Enqueue a task from a markdown file")
    .option("--repo <path>", "Repo root (default: auto-detect from file)")
    .option("--devices <list>", "Comma-separated platforms: ios | android | ios,android | ios,ios | ... (default: ios)")
    .option("--force", "Enqueue even if a task with the same prompt file is already active")
    .option("--force-rebuild", "Force a full app rebuild even when the native fingerprint hasn't changed")
    .option("--parallel", "Allow this task to run alongside other parallel tasks (default: serial — task runs alone)")
    .option("--device <name>", "Pin to one specific device's deviceId from config.json, instead of letting the scheduler pick the first free/enabled one (only valid when --devices selects a single platform)")
    .option("--force-device", "Bypass the busy-device check (app process running / paired with another Metro) for this task's device(s) — use when you know a device is actually free despite the heuristic. Does not bypass a disabled (enabled: false) slot.")
    .action(async (file: string, opts: { repo?: string; devices?: string; force?: boolean; forceRebuild?: boolean; parallel?: boolean; device?: string; forceDevice?: boolean }) => {
        try {
            const desc = await runAdd({
                file,
                repo: opts.repo,
                devices: opts.devices,
                force: opts.force,
                forceRebuild: opts.forceRebuild,
                parallel: opts.parallel,
                device: opts.device,
                forceDevice: opts.forceDevice,
            });
            console.log(`Enqueued ${desc.id} ${desc.parallel ? "[parallel]" : "[serial]"}`);
            console.log(`  repo: ${desc.repo}`);
            console.log(`  base: ${desc.baseBranch}`);
            console.log(`  devices: ${desc.devices.map(d => d.platform).join(",")}`);
        } catch (e) {
            console.error(`Error: ${(e as Error).message}`);
            process.exit(1);
        }
    });

program.command("list").description("List all tasks by status").action(runList);
program.command("show <id>").description("Show a task descriptor and log path").action(runShow);
program
    .command("devices")
    .description("List available iOS sims and Android AVDs (annotated with config.json state), or enable/disable a configured slot")
    .option("--enable <name>", "Mark a configured device slot active (available for scheduling) — name is the slot's deviceId")
    .option("--disable <name>", "Mark a configured device slot inactive — kept in config.json but never scheduled, e.g. to reserve it for manual use")
    .action(async (opts: { enable?: string; disable?: string }) => {
        try {
            await runDevices(opts);
        } catch (e) {
            console.error(`Error: ${(e as Error).message}`);
            process.exit(1);
        }
    });

program
    .command("init")
    .description("Auto-detect simulators / emulators and write ~/.execbro/config.json")
    .option("--yes", "Skip the confirmation prompt (non-interactive)")
    .action(async (opts: { yes?: boolean }) => {
        try {
            await runInit({ yes: opts.yes });
        } catch (e) {
            console.error(`Error: ${(e as Error).message}`);
            process.exit(1);
        }
    });

program
    .command("clean [id]")
    .description("Remove a task's descriptor, worktree, and log. Provide an id, or use --all-failed / --all-done / --all-running")
    .option("--all-failed", "Clean all tasks in the failed/ bucket")
    .option("--all-done", "Clean all tasks in the done/ bucket")
    .option("--all-running", "Stop and remove every task in the running/ bucket (kills tmux sessions, deletes worktrees, signal files, and descriptors). Restart execbro-worker afterwards.")
    .option("--force", "Allow cleaning queued/running tasks by id (use with caution)")
    .action(async (id: string | undefined, opts: { allFailed?: boolean; allDone?: boolean; allRunning?: boolean; force?: boolean }) => {
        try {
            await runClean({ id, allFailed: opts.allFailed, allDone: opts.allDone, allRunning: opts.allRunning, force: opts.force });
        } catch (e) {
            console.error(`Error: ${(e as Error).message}`);
            process.exit(1);
        }
    });

program.parseAsync().catch(e => { console.error(e); process.exit(1); });
