#!/usr/bin/env node
import { Command } from "commander";
import { runAdd } from "./commands/add.js";
import { runList } from "./commands/list.js";
import { runShow } from "./commands/show.js";
import { runDevices } from "./commands/devices.js";
import { runClean } from "./commands/clean.js";

const program = new Command();
program.name("execbro-task").description("Enqueue and inspect ExecBro autonomous tasks");

program
    .command("add <file>")
    .description("Enqueue a task from a markdown file")
    .option("--repo <path>", "Repo root (default: auto-detect from file)")
    .option("--platform <platform>", "ios | android | both (Phase 1: ios only)")
    .option("--allow-dirty", "Skip the uncommitted-changes check on the target repo")
    .option("--force", "Enqueue even if a task with the same prompt file is already active")
    .option("--force-rebuild", "Force a full app rebuild even when the native fingerprint hasn't changed")
    .action(async (file: string, opts: { repo?: string; platform?: string; allowDirty?: boolean; force?: boolean; forceRebuild?: boolean }) => {
        try {
            const desc = await runAdd({
                file,
                repo: opts.repo,
                platform: opts.platform as "ios" | "android" | "both" | undefined,
                allowDirty: opts.allowDirty,
                force: opts.force,
                forceRebuild: opts.forceRebuild,
            });
            console.log(`Enqueued ${desc.id}`);
            console.log(`  repo: ${desc.repo}`);
            console.log(`  base: ${desc.baseBranch}`);
        } catch (e) {
            console.error(`Error: ${(e as Error).message}`);
            process.exit(1);
        }
    });

program.command("list").description("List all tasks by status").action(runList);
program.command("show <id>").description("Show a task descriptor and log path").action(runShow);
program.command("devices").description("List available iOS sims and Android AVDs").action(runDevices);

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
