#!/usr/bin/env node
import { Command } from "commander";
import { runAdd } from "./commands/add.js";

const program = new Command();
program.name("execbro-task").description("Enqueue and inspect ExecBro autonomous tasks");

program
    .command("add <file>")
    .description("Enqueue a task from a markdown file")
    .option("--repo <path>", "Repo root (default: auto-detect from file)")
    .option("--mode <mode>", "Execution mode: tmux | headless (Phase 1: tmux only)")
    .option("--platform <platform>", "ios | android | both (Phase 1: ios only)")
    .action(async (file: string, opts: { repo?: string; mode?: string; platform?: string }) => {
        try {
            const desc = await runAdd({
                file,
                repo: opts.repo,
                mode: opts.mode as "tmux" | "headless" | undefined,
                platform: opts.platform as "ios" | "android" | "both" | undefined,
            });
            console.log(`Enqueued ${desc.id}`);
            console.log(`  repo: ${desc.repo}`);
            console.log(`  base: ${desc.baseBranch}`);
        } catch (e) {
            console.error(`Error: ${(e as Error).message}`);
            process.exit(1);
        }
    });

program.parseAsync().catch(e => { console.error(e); process.exit(1); });
