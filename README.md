# execbro-runner

Autonomous task runner for ExecBro. Phase 1 implementation.

- Spec: [`~/rn-devtools/docs/devtools-core/specs/2026-05-09-autonomous-task-runner-design.md`](../docs/devtools-core/specs/2026-05-09-autonomous-task-runner-design.md)
- Plan: [`~/rn-devtools/docs/devtools-core/plans/2026-05-09-autonomous-task-runner-phase-1.md`](../docs/devtools-core/plans/2026-05-09-autonomous-task-runner-phase-1.md)
- Smoke test checklist: [`SMOKE_TEST.md`](SMOKE_TEST.md)

## Status

**Phase 1 — code complete, awaiting first end-to-end smoke test.**

Scope: iOS only, tmux mode only, single slot, push to Bitbucket.

Phase 2 (not implemented): Android, both-platform tasks, headless mode, init wizard, failure artifact bundles, Slack notifications, task dependencies, multi-slot scheduler. Phase 2 also requires upstream changes in [`react-native-ai-devtools`](../react-native-ai-devtools) — see the plan's "Phase 2 prerequisites" section.

## Runtime requirements

- macOS with Xcode (for `xcrun simctl`)
- Node ≥ 18
- `tmux` on `PATH`
- `claude` (Claude Code CLI) on `PATH` and authenticated
- A target React Native app whose `package.json` declares `"execbro": { "iosBundleId": "..." }`

## Quick start

```bash
npm install
npm run build
npm link                       # one-time: puts execbro-task and execbro-worker on your PATH

execbro-task devices           # list available sims, pick a UDID
# write ~/.execbro/config.json (see SMOKE_TEST.md step 2)

execbro-worker &               # start the daemon
execbro-task add /path/to/task.md   # enqueue a task
execbro-task list              # check status
execbro-task show <id>         # inspect one task
```

To uninstall the global symlinks: `npm unlink -g` from this directory.

## Architecture

Two binaries communicate through plain files in `~/.execbro/`:

- **`execbro-task`** — intake CLI (`add`, `list`, `show`, `devices`). Writes JSON descriptors to `~/.execbro/queue/inbox/`.
- **`execbro-worker`** — long-running daemon. Watches the inbox, claims a slot via `flock`, provisions a sandbox (worktree + sim + Metro port), runs Claude Code in tmux with a composed prompt (preamble + user task + verification suffix), tails the transcript to detect done, and pushes the resulting branch to Bitbucket.

Per-task state is isolated by:

- A separate git worktree at `~/.execbro/worktrees/<task-id>`
- A dedicated iOS simulator UDID (per slot)
- A dedicated Metro port (per slot)
- A dedicated tmux session (`execbro-<task-id>` for the agent, `execbro-metro-<task-id>` for Metro)

## Layout

```
src/
    cli/             # execbro-task entrypoint and subcommands
    config/          # paths, zod schema, loader
    queue/           # descriptor type, atomic transitions
    scheduler/       # lockfile-based slot allocation
    provisioner/     # readiness polling, worktree, npm install, iOS-specific steps
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
