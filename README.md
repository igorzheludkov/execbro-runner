# execbro-runner

Queue-based autonomous task runner for React Native apps. You drop a prompt file describing what you want done, and a background daemon spins up an isolated sandbox (git worktree + iOS simulator or Android emulator + Metro), runs Claude Code inside tmux to do the work, has the agent verify the change live on the device via the [ExecBro](https://github.com/igorzheludkov/react-native-ai-devtools) MCP server, then pushes the resulting branch to Bitbucket so you can open a PR.

Think of it as: **"fire-and-forget Claude Code runs for your React Native app, with real device verification baked in."**

- Spec: [`~/rn-devtools/docs/devtools-core/specs/2026-05-09-autonomous-task-runner-design.md`](../docs/devtools-core/specs/2026-05-09-autonomous-task-runner-design.md)
- Plan: [`~/rn-devtools/docs/devtools-core/plans/2026-05-09-autonomous-task-runner-phase-1.md`](../docs/devtools-core/plans/2026-05-09-autonomous-task-runner-phase-1.md)
- Smoke test checklist: [`SMOKE_TEST.md`](SMOKE_TEST.md)

## Why this exists

Running Claude Code by hand on a React Native app means babysitting it: starting Metro, picking a simulator, watching it work, then reminding it to actually exercise the UI before declaring victory. This runner automates all of that so you can queue up several tasks and walk away.

Each task gets its own:
- git worktree (so concurrent tasks don't stomp on each other's files)
- iOS simulator UDID or Android emulator (so they don't fight over the same device)
- Metro port (so bundlers don't collide)
- tmux session (so you can attach and watch any one of them live)

The agent is given a composed prompt: a **preamble** that tells it about its sandbox and the ExecBro tools available, the **user's task**, and a **verification suffix** that forces it to reload the app, take a screenshot, exercise the affected flow, and check logs before signaling done. If verification can't be done (e.g. needs auth credentials), the agent is instructed to say so explicitly rather than fake success.

When the agent commits, the runner pushes the branch to Bitbucket and fires a macOS notification with the PR URL.

## Status

**Phase 1 — code complete, awaiting first end-to-end smoke test.**

Scope: iOS and Android, tmux mode only, single slot, push to Bitbucket.

Phase 2 (not implemented): both-platform tasks, headless mode, init wizard, failure artifact bundles, Slack notifications, task dependencies, multi-slot scheduler. Phase 2 also requires upstream changes in [`react-native-ai-devtools`](../react-native-ai-devtools) — see the plan's "Phase 2 prerequisites" section.

## Runtime requirements

- macOS with Xcode (for `xcrun simctl`) for iOS tasks
- Android SDK with `adb` and `emulator` on `PATH` for Android tasks
- Node ≥ 18
- `tmux` on `PATH`
- `claude` (Claude Code CLI) on `PATH` and authenticated
- A target React Native app whose `package.json` declares `"execbro": { "iosBundleId": "...", "androidPackage": "..." }` (set the field for whichever platform(s) you'll run)
- A Bitbucket remote on the target repo (for the push step)

## Quick start

```bash
npm install
npm run build
npm link                       # one-time: puts execbro-task and execbro-worker on your PATH

execbro-task devices           # list available sims, pick a UDID
# write ~/.execbro/config.json (see SMOKE_TEST.md step 2)

execbro-worker &               # start the daemon
execbro-task add /path/to/task.md   # enqueue a task (a markdown file with the prompt)
execbro-task list              # check status
execbro-task show <id>         # inspect one task
```

To uninstall the global symlinks: `npm unlink -g` from this directory.

A task file is just a markdown prompt — the same kind of thing you'd paste into Claude Code interactively. Example:

```markdown
Add a pull-to-refresh to the orders screen. The list lives in
src/screens/Orders.tsx and is backed by the `useOrders` hook.
```

## How a task flows through the system

1. `execbro-task add foo.md` writes a JSON descriptor to `~/.execbro/queue/inbox/`.
2. `execbro-worker` (watching the inbox) sees the new descriptor and tries to claim a slot via `flock`.
3. The **provisioner** creates a worktree at `~/.execbro/worktrees/<task-id>`, runs `npm install`, boots the assigned iOS simulator or Android emulator, and waits for Metro to come up on the assigned port.
4. The **runner** composes the prompt (preamble + user task + verification suffix), starts a tmux session, and launches `claude` inside it with the ExecBro MCP server pre-configured to talk to this task's Metro.
5. The runner tails the transcript looking for done-signal patterns.
6. On done: the **bitbucket** module pushes the branch and composes a PR URL; the **notify** module fires a macOS notification.

You can `tmux attach -t execbro-<task-id>` at any time to watch the agent live.

## Architecture

Two binaries communicate through plain files in `~/.execbro/`:

- **`execbro-task`** — intake CLI (`add`, `list`, `show`, `devices`). Writes JSON descriptors to `~/.execbro/queue/inbox/`.
- **`execbro-worker`** — long-running daemon. Watches the inbox, claims a slot via `flock`, provisions a sandbox (worktree + sim + Metro port), runs Claude Code in tmux with a composed prompt (preamble + user task + verification suffix), tails the transcript to detect done, and pushes the resulting branch to Bitbucket.

Per-task state is isolated by:

- A separate git worktree at `~/.execbro/worktrees/<task-id>`
- A dedicated iOS simulator UDID or Android emulator (per slot)
- A dedicated Metro port (per slot)
- A dedicated tmux session (`execbro-<task-id>` for the agent, `execbro-metro-<task-id>` for Metro)

## Layout

```
src/
    cli/             # execbro-task entrypoint and subcommands
    config/          # paths, zod schema, loader
    queue/           # descriptor type, atomic transitions
    scheduler/       # lockfile-based slot allocation
    provisioner/     # readiness polling, worktree, npm install, iOS- and Android-specific steps
    runner/          # prompt composition, tmux helpers, done detection, per-task orchestration
    bitbucket/       # branch push, PR URL composition
    notify/          # macOS notifications
    worker/          # execbro-worker daemon entrypoint
templates/           # default agent-preamble.md and verification-suffix.md
test/unit/           # Jest tests (40 tests, 11 suites)
```

## Testing

```bash
npm test                # all unit tests (40)
npm run test:unit       # same as `test` for now (no integration suite yet)
```

Integration verification is the manual `SMOKE_TEST.md` flow.

## Serial vs parallel tasks

By default each task runs **serial**: it waits until nothing else is running,
then runs alone. To let a task run alongside other parallel tasks, pass
`--parallel` when enqueueing it:

```bash
execbro-task add prompts/refactor.md --parallel
```

Parallel tasks may overlap with other parallel tasks (subject to free slots
and Metro ports). A serial task acts as an implicit barrier: parallel tasks
queued behind it wait until it finishes.

## Project conventions

- TypeScript ESM, Node ≥ 18.
- Jest with `--experimental-vm-modules`. ts-jest preset.
- Zod for runtime config/descriptor validation.
- TDD for pure-logic modules (config, queue, scheduler, readiness, prompt, done detection, retry helper, Bitbucket URL). Shell-out modules (provisioner, tmux, runner orchestration, worker daemon) are validated by the smoke test.
