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
- `~/.execbro/config.json` — device slots, `pushOnDone`, etc. **Loaded once at `execbro-worker` startup and never re-read** — any edit (via `init` or by hand) requires killing and restarting the worker process, or it's silently ignored for the rest of that daemon's life.
- `~/.execbro/queue/{inbox,running,done,failed}/<id>.json` — task descriptors
- `~/.execbro/worktrees/<id>/` — isolated git worktree per task, on a new branch `task/<id>`
- `~/.execbro/logs/<id>.jsonl` — the full agent transcript (raw stream-json, one event per line — NOT a plain-text `.log`)
- `~/.execbro/templates/` — `agent-preamble.md`, `verification-suffix-single.md`, `verification-suffix-multi.md`, `headless-system-prompt.md`. Auto-copied from the package's own `templates/` dir on first render (resolved via the module's own real file location, so this works correctly even through a Homebrew/npm-link symlinked global install). If you're on a build that predates this fix and see `ENOENT ... agent-preamble.md`, copy the missing file(s) from `<execbro-runner install dir>/templates/` by hand as a one-off workaround.

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
- **Expo managed-workflow apps**: supported, but check two things first, since the repo won't have a committed `android/app/build.gradle` for autodetection to read:
  - `package.json` has `"execbro": { "androidPackageName": "<your.app.id>" }` (the runner's own error message tells you this and the exact key when it's missing — read the applicationId out of your locally-generated `android/app/build.gradle`, or Android Studio / `app.json`'s `android.package`)
  - `app.json` (`expo.scheme`) or `app.config.js`/`.ts` (a `scheme: '...'` literal) declares a URL scheme — needed so a rebuilt/relaunched app can be pointed straight at the task's Metro instance instead of stalling on the Expo dev-client's "Development servers" picker screen

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
| Force native rebuild | `--force-rebuild` |
| Pin to one specific device (only valid with a single-platform `--devices`) | `--device <name>` (the slot's `deviceId` — AVD name for Android, UDID for iOS) |
| Bypass the busy-device heuristics for this task | `--force-device` (does not bypass a disabled slot) |
| Override auto-detected repo | `--repo <path>` |
| List all tasks + status | `execbro-task list` |
| Show one task descriptor | `execbro-task show <id>` |
| Follow live transcript | `tail -f ~/.execbro/logs/<id>.jsonl` (raw stream-json — pipe through `jq` or grep for `"type":"text"` / `"result"` to read it) |
| Attach interactively | `cd ~/.execbro/worktrees/<id> && claude --resume <session-id>` |
| Clean one task | `execbro-task clean <id>` |
| Clean all done / failed / running | `execbro-task clean --all-done` / `--all-failed` / `--all-running` |
| Reserve a device for manual use without removing it from config | `execbro-task devices --disable <name>` (re-activate with `--enable <name>`) |

**Any of the following require killing and restarting `execbro-worker`** — it loads `config.json` once at startup and only reacts to *new* files landing in `queue/inbox/` (no polling loop, no re-check timer):
- After `clean --all-running`
- After editing `~/.execbro/config.json` (by hand, via `execbro-task init`, or via `execbro-task devices --enable`/`--disable`) — e.g. adding/removing a device slot, or toggling one active/inactive
- After rebuilding the runner's own source (`npm run build` inside the `execbro-runner` package, if you're patching the tool itself)

### Dedicating / reserving devices

A slot's `enabled` field (default `true`) controls whether the scheduler will ever pick it — a slot with `enabled: false` stays listed in `config.json` (and in `execbro-task devices`' output, annotated in a CONFIG column) but is never scheduled. Toggle it with `execbro-task devices --disable <name>` / `--enable <name>`, or by hand in `config.json`. This is the way to "keep the Pixel devices configured but never touch them" without deleting their slots — disable everything except the one device you want automation to use. `execbro-task init` preserves each rediscovered device's `enabled` value across a regeneration, so re-running `init` won't silently re-activate something you disabled.

For a one-off pin instead of a standing config change, `execbro-task add --device <name>` restricts a single task to one specific slot (only valid when `--devices` resolves to exactly one platform) — it does not disable anything, just narrows that task's own candidate search to the named device.

## Workflow

1. **Confirm daemon is up.** If not, tell the user to run `execbro-worker` in a spare terminal — don't background it from the assistant unless they explicitly ask.
2. **Write the prompt as a markdown file** inside (or under) the target RN repo. Plain prose, same style as an interactive Claude Code prompt. Don't add verification scaffolding — the runner appends a verification suffix automatically (reload app, screenshot, exercise flow, check logs).
3. **Enqueue with `execbro-task add <file>`**. The repo is auto-detected from the prompt file's git root; pass `--repo` only if that fails.
4. **Surface the task id** returned by `add` so the user can `show`/`tail`/`resume` it.
5. **Don't poll in a loop.** If the user wants progress, point them at `execbro-task list` or `tail -f ~/.execbro/logs/<id>.jsonl`. The daemon fires a macOS notification on completion.

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
- **Assuming a freed-up device retroactively un-fails a failed task.** A task that already failed with "paired with other metros; nothing to provision" or similar is *gone* from the runnable queue (moved to `failed/`) — freeing the device afterward does nothing on its own. You must `execbro-task clean <id>` and `execbro-task add` again. (A task still sitting *unstarted* in `inbox/` is different — see below.)

## Devices reported as "busy" — diagnosis and override

Before assigning a device, the worker skips any device it believes the user (or another concurrent task) is already using, to avoid stomping a manual dev session — this is deliberate, not a bug. Two independent checks, both adb/Metro-based:

1. **App process already running** on the device (`adb shell pidof <packageName>` / `xcrun simctl spawn <udid> launchctl list`).
2. **Device already paired with a different Metro** on the host — detected by hitting `/json` on common Metro ports (8081, 8082, 19000-19002, plus the worker's own configured range) and checking for the device's name in the connected-runtimes list. This shows up as `adb reverse --list` having a `tcp:8081` (or similar) entry pointing at someone else's live Metro.

**If you know the device is actually free**, `execbro-task add --force-device` bypasses both checks for that task — no manual adb needed. (It does not bypass a disabled, `enabled: false` slot — that exclusion is deliberate, not a busy heuristic, and stays in force regardless.)

**If the device genuinely is busy and you want to free it**, override manually: `adb -s <deviceId> shell am force-stop <packageName>` (Android) or `xcrun simctl terminate <udid> <bundleId>` (iOS) for the first check; `adb -s <deviceId> reverse --remove tcp:<port>` for the second (only removes the tunnel — does **not** touch the other Metro process itself, so a manual `expo start`/`react-native start` session you have running stays untouched).

After either fix, the device is only re-evaluated once the worker either restarts (config-loaded-once, re-emits "add" for anything already in `inbox/`) or a new task is enqueued (which re-checks the current head-of-queue first, even if that new task itself can't run yet). If the blocked task already moved to `failed/`, `clean` + re-`add` it; if it's still `queued`, a worker restart alone is enough — no need to clean/re-add.

## Inspecting failures

1. `execbro-task show <id>` — descriptor (status, devices, session id, bucket)
2. `~/.execbro/logs/<id>.jsonl` — full transcript (stream-json; `tail -c 30000 <file>` before reading in full, it gets large)
3. Worktree at `~/.execbro/worktrees/<id>/` — agent's working tree (read-only mindset)
4. `claude --resume <session-id>` from inside the worktree to interrogate the agent state directly
5. If a task fails during provisioning (before "starting headless agent" appears in the worker's own log/terminal output), the problem is environmental, not the prompt — check the worker's stdout for the exact provisioning step it died on (installing deps / booting device / starting Metro / build & install / device busy) rather than assuming the task descriptor or prompt is at fault.

## Notes

- This package is **early-alpha** (per its README). CLI flags and config schema may change — verify with `execbro-task <cmd> --help` if behavior surprises you.
- The runner pre-configures the ExecBro MCP server pointed at the task's Metro, so the headless agent has device/log/network tools without extra setup.
- **Expo managed-workflow support (added 2026-07-21):** `startMetro`/`buildAndInstall`/`launchApp` all branch on Expo detection (an `expo` dependency in `package.json`) and use `expo start` / `expo run:android`/`run:ios` / a `exp+<scheme>://expo-development-client/?url=...` deep link respectively, instead of assuming `@react-native-community/cli`. If a task fails with `react-native depends on @react-native-community/cli` anywhere in the worker log, or the app launches into a "Development servers" picker screen instead of connecting to the task's Metro, that's this detection failing or the app's scheme not being found — see the Prerequisites checklist above.
- **Device enable/disable, `--device`, `--force-device` (added 2026-07-21):** see "Dedicating / reserving devices" and "Devices reported as busy" above.
- **No dependency/batch orchestration yet.** The task scheduler does support a `dependsOn` field on the descriptor (a dependent task is held in `inbox/` until its deps are in `done/`) — but no CLI flag on `execbro-task add` sets it today, and even with it set, a dependent task's worktree still forks from the *original* base branch, not its upstream's resulting commits (no auto-merge/auto-rebase). For a batch of tasks with real interdependencies, either wait for each to land and merge into a shared branch manually before enqueuing the next, or don't use the runner for that batch — see `limitations.md` in this repo for the full analysis.
