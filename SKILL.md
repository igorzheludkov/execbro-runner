---
name: execbro-runner
description: Use ONLY for React Native / mobile (iOS / Android) work — the runner provisions simulators, emulators, and Metro, so it is not applicable to web, backend, or non-mobile projects. Use when the user wants to enqueue, run, inspect, or clean up autonomous Claude Code tasks for a React Native app via the execbro-runner CLI — covers `execbro-task` (add/list/show/clean/init/devices) and `execbro-worker` daemon. Trigger on phrases like "queue a task", "run this prompt autonomously", "enqueue", "task runner", "background agent run", or any mention of `execbro-task` / `execbro-worker`.
---

# execbro-runner

## Scope

**React Native / mobile only.** The runner provisions iOS simulators or Android emulators, boots Metro, and installs an RN app. It has no meaning for web, backend, CLI, or other non-mobile codebases — do not suggest it for those. If the target repo is not a React Native app, stop and tell the user.

## Overview

`execbro-runner` is a queue-based runner that launches headless Claude Code sessions against a React Native app in an isolated sandbox (git worktree + simulator/emulator + Metro). Two binaries:

- `execbro-task` — enqueue, inspect, clean tasks
- `execbro-worker` — long-running daemon that picks tasks off the queue

State lives under `~/.execbro/` (override with `EXECBRO_HOME`):
- `~/.execbro/config.json` — device slots, `pushOnDone`, etc.
- `~/.execbro/queue/{inbox,running,done,failed}/<id>.json` — task descriptors
- `~/.execbro/worktrees/<id>/` — isolated git worktree per task
- `~/.execbro/logs/<id>.log` — streamed agent transcript

## When to use

- User asks to "queue / enqueue / fire-and-forget / run autonomously" a prompt against a RN app
- User mentions `execbro-task`, `execbro-worker`, or `~/.execbro/`
- User wants to inspect or clean up previously queued tasks

Do NOT use for interactive Claude Code sessions in the current workspace — the runner is specifically for spawning isolated background sessions.

## Prerequisites (verify before first use)

- `execbro-task` and `execbro-worker` on `PATH` (run `which execbro-task`)
- `claude` CLI authenticated
- `~/.execbro/config.json` exists (else run `execbro-task init`)
- `execbro-worker` is running in some terminal — otherwise tasks sit in `inbox/` forever

## Quick reference

| Goal | Command |
|------|---------|
| Generate / refresh config from booted devices | `execbro-task init` (add `--yes` to skip prompt) |
| List discoverable simulators/AVDs without writing config | `execbro-task devices` |
| Start the daemon | `execbro-worker` (leave running; tail it for daemon logs) |
| Enqueue iOS task (default) | `execbro-task add <prompt.md>` |
| Enqueue Android | `execbro-task add <prompt.md> --devices android` |
| Enqueue both platforms | `execbro-task add <prompt.md> --devices ios,android` |
| Allow concurrent run | add `--parallel` |
| Force re-enqueue when an active task already exists for the prompt | `--force` |
| Force native rebuild | `--forceRebuild` |
| Override auto-detected repo | `--repo <path>` |
| List all tasks + status | `execbro-task list` |
| Show one task descriptor | `execbro-task show <id>` |
| Follow live transcript | `tail -f ~/.execbro/logs/<id>.log` |
| Attach interactively | `cd ~/.execbro/worktrees/<id> && claude --resume <session-id>` |
| Clean one task | `execbro-task clean <id>` |
| Clean all done / failed / running | `execbro-task clean --all-done` / `--all-failed` / `--all-running` |

After `clean --all-running`, restart `execbro-worker`.

## Workflow

1. **Confirm daemon is up.** If not, tell the user to run `execbro-worker` in a spare terminal — don't background it from the assistant unless they explicitly ask.
2. **Write the prompt as a markdown file** inside (or under) the target RN repo. Plain prose, same style as an interactive Claude Code prompt. Don't add verification scaffolding — the runner appends a verification suffix automatically (reload app, screenshot, exercise flow, check logs).
3. **Enqueue with `execbro-task add <file>`**. The repo is auto-detected from the prompt file's git root; pass `--repo` only if that fails.
4. **Surface the task id** returned by `add` so the user can `show`/`tail`/`resume` it.
5. **Don't poll in a loop.** If the user wants progress, point them at `execbro-task list` or `tail -f ~/.execbro/logs/<id>.log`. The daemon fires a macOS notification on completion.

## Serial vs parallel

Default is **serial**: task waits for everything else to finish, then runs alone. Serial tasks are an implicit barrier — parallel tasks queued behind them wait. Use `--parallel` only when:
- the user explicitly asks for concurrency, AND
- you're confident there's a free device slot + Metro port in the config

When in doubt, leave it serial.

## Common mistakes

- **Enqueuing without the worker running.** Task sits in `inbox/` silently. Always check the daemon is up.
- **Editing files in `~/.execbro/worktrees/<id>/` while the agent runs.** That's the agent's sandbox — don't touch it. If the user wants to take over, `claude --resume <session-id>` inside the worktree.
- **Using `--force` reflexively.** `add` refuses by default if an active task exists for the same prompt file; that's a guard, not a bug. Only `--force` when the user actually wants a duplicate run.
- **Assuming `pushOnDone` is on.** It's opt-in via `~/.execbro/config.json`. If the user expects a PR URL, check the config first.
- **Treating it like a sync API.** `add` returns immediately. The task is queued, not done.
- **Running `execbro-task` from a non-git directory and passing no `--repo`.** Auto-detect needs a `.git` somewhere up the tree from the prompt file.

## Inspecting failures

1. `execbro-task show <id>` — descriptor (status, devices, session id, bucket)
2. `~/.execbro/logs/<id>.log` — full transcript
3. Worktree at `~/.execbro/worktrees/<id>/` — agent's working tree (read-only mindset)
4. `claude --resume <session-id>` from inside the worktree to interrogate the agent state directly

## Notes

- This package is **early-alpha** (per its README). CLI flags and config schema may change — verify with `execbro-task <cmd> --help` if behavior surprises you.
- The runner pre-configures the ExecBro MCP server pointed at the task's Metro, so the headless agent has device/log/network tools without extra setup.
