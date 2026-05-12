# execbro-runner

> ⚠️ **Early-alpha proof of concept.** APIs, config schema, CLI flags, and internal behavior will change without notice between versions. Don't depend on it in anything you can't afford to re-wire. Feedback and bug reports are welcome.

Queue-based autonomous task runner for React Native apps. Drop in a markdown prompt, and a background daemon spins up an isolated sandbox (git worktree + iOS simulator or Android emulator + Metro), runs Claude Code headlessly against it, has the agent verify the change live on the device via the [ExecBro](https://github.com/igorzheludkov/react-native-ai-devtools) MCP server, then optionally pushes the resulting branch and surfaces a PR URL.

**Fire-and-forget Claude Code runs for your React Native app, with real device verification baked in.**

## Why this exists

Running Claude Code by hand on a React Native app means babysitting it: starting Metro, picking a simulator, watching it work, then reminding it to actually exercise the UI before declaring victory. This runner automates all of that so you can queue up several tasks and walk away.

Each task gets its own:
- git worktree (so concurrent tasks don't stomp on each other's files)
- iOS simulator UDID or Android emulator (so they don't fight over the same device)
- Metro port (so bundlers don't collide)
- headless Claude session you can resume with `claude --resume <session-id>` if you need to inspect or take over

The agent runs under a composed prompt: a **preamble** describing its sandbox and the ExecBro tools available, the **user's task**, and a **verification suffix** that forces it to reload the app, take a screenshot, exercise the affected flow, and check logs before signaling done. When the agent commits, the runner can push the branch and fire a macOS notification with the PR URL.

## Requirements

- macOS with Xcode (for `xcrun simctl`) for iOS tasks
- Android SDK with `adb` and `emulator` on `PATH` for Android tasks
- Node ≥ 18
- `claude` (Claude Code CLI) on `PATH` and authenticated
- A target React Native app — `iosBundleId` and `androidPackageName` are auto-discovered from the native projects, but you can override them with `"execbro": { "iosBundleId": "...", "androidPackageName": "..." }` in `package.json`
- A GitHub or Bitbucket remote on the target repo if you want auto-push and a PR URL (opt-in via `pushOnDone`)

## Install

```bash
npm install
npm run build
npm link    # puts execbro-task and execbro-worker on your PATH
```

To uninstall the global symlinks: `npm unlink -g` from this directory.

## Usage

**1. Generate the config.** `init` discovers your booted simulators and Android AVDs and writes them as slots into `~/.execbro/config.json`:

```bash
execbro-task init           # interactive — shows the proposed config and asks to confirm
execbro-task init --yes     # non-interactive — write without confirmation
```

Re-run it any time you add or remove devices; it merges new slots in and preserves your other config fields. If you need to inspect what's available without writing the file, use `execbro-task devices`.

**2. Start the daemon** in a terminal you can leave running:

```bash
execbro-worker
```

**3. Write a task file.** It's just a markdown prompt — the same thing you'd paste into Claude Code interactively:

```markdown
Add a pull-to-refresh to the orders screen. The list lives in
src/screens/Orders.tsx and is backed by the `useOrders` hook.
```

**4. Enqueue it.** The repo is auto-detected from the prompt file's git root:

```bash
execbro-task add prompts/pull-to-refresh.md                 # default: iOS
execbro-task add prompts/foo.md --devices android           # Android
execbro-task add prompts/foo.md --devices ios,android       # both
execbro-task add prompts/foo.md --parallel                  # let it run alongside other parallel tasks
```

**5. Check progress:**

```bash
execbro-task list                       # all tasks and their status
execbro-task show <id>                  # descriptor + log path + session id
tail -f ~/.execbro/logs/<id>.log        # follow the agent's transcript live
cd ~/.execbro/worktrees/<id> && claude --resume <session-id>   # attach interactively
```

If `pushOnDone` is enabled in your config, the finished branch is pushed and you'll get a macOS notification with a PR URL (GitHub or Bitbucket).

**6. Clean up** when you're done with a task:

```bash
execbro-task clean <id>          # one task
execbro-task clean --all-done    # everything in the done bucket
execbro-task clean --all-failed  # everything in the failed bucket
execbro-task clean --all-running # stop and remove running tasks (then restart execbro-worker)
```

### Serial vs parallel tasks

By default each task runs **serial**: it waits until nothing else is running, then runs alone. Pass `--parallel` to let a task run alongside other parallel tasks (subject to free slots and Metro ports). A serial task acts as an implicit barrier: parallel tasks queued behind it wait until it finishes.

## How a task flows through the system

1. `execbro-task add foo.md` writes a JSON descriptor to `~/.execbro/queue/inbox/`.
2. `execbro-worker` sees it and claims a slot via `flock`.
3. The **provisioner** creates a worktree at `~/.execbro/worktrees/<task-id>`, runs `npm install` (and `pod install` if needed), boots the assigned iOS simulator or Android emulator, installs the app, and waits for Metro to come up.
4. The **runner** composes the prompt and launches `claude` headlessly in the worktree with the ExecBro MCP server pre-configured to talk to this task's Metro. The session id is recorded so you can `--resume` it.
5. The runner streams the transcript to `~/.execbro/logs/<id>.log` and waits for the agent to exit.
6. On success: the agent's commit is on `task/<id>`. If `pushOnDone` is set, the branch is pushed and a PR URL is composed; a macOS notification fires either way.

## Testing

```bash
npm test
```
