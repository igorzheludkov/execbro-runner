#!/usr/bin/env node
import { Command } from "commander";
import { runAdd } from "./commands/add.js";
import { runList } from "./commands/list.js";
import { runShow } from "./commands/show.js";
import { runDevices } from "./commands/devices.js";

const program = new Command();
program.name("execbro-task").description("Enqueue and inspect ExecBro autonomous tasks");

program
    .command("add <file>")
    .description("Enqueue a task from a markdown file")
    .option("--repo <path>", "Repo root (default: auto-detect from file)")
    .option("--mode <mode>", "Execution mode: tmux | headless (Phase 1: tmux only)")
    .option("--platform <platform>", "ios | android | both (Phase 1: ios only)")
    .option("--allow-dirty", "Skip the uncommitted-changes check on the target repo")
    .option("--force", "Enqueue even if a task with the same prompt file is already active")
    .action(async (file: string, opts: { repo?: string; mode?: string; platform?: string; allowDirty?: boolean; force?: boolean }) => {
        try {
            const desc = await runAdd({
                file,
                repo: opts.repo,
                mode: opts.mode as "tmux" | "headless" | undefined,
                platform: opts.platform as "ios" | "android" | "both" | undefined,
                allowDirty: opts.allowDirty,
                force: opts.force,
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

program.parseAsync().catch(e => { console.error(e); process.exit(1); });
