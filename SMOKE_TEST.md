# Phase 1 End-to-End Smoke Test

This is the manual verification that the autonomous task runner actually works end-to-end. It must be run by a human because it requires a real React Native app, a real Bitbucket remote, a booted iOS simulator, and a working Claude Code CLI installation — none of which can be spun up by an automated subagent.

If anything fails, fix iteratively and commit the fixes; the worker, runner, provisioner, etc. are still being shaken down on real hardware.

---

## Prerequisites

- macOS with Xcode + Simulator installed (`xcrun simctl list devices` works)
- `tmux` installed (`brew install tmux` if missing)
- `claude` (Claude Code CLI) on `PATH` and authenticated
- A React Native app repo:
    - With a `package.json` containing an `"execbro": { "iosBundleId": "<your.bundle.id>" }` field
    - With `origin` set to a Bitbucket remote (`git@bitbucket.org:workspace/repo.git` or `https://bitbucket.org/...`)
    - Buildable on iOS via `npx react-native run-ios`

## Step 0 — Install the CLI binaries on your PATH (one-time)

```bash
cd ~/rn-devtools/execbro-runner
npm install
npm run build
npm link
```

`npm link` symlinks `execbro-task` and `execbro-worker` into your global node bin (`/opt/homebrew/bin/` on Apple Silicon, `/usr/local/bin/` on Intel). Verify:

```bash
which execbro-task   # should print a path
execbro-task --help  # should print the usage
```

If you ever rebuild (`npm run build`), the link still points at the same files — no re-link needed.

To uninstall: `cd ~/rn-devtools/execbro-runner && npm unlink -g`.

## Step 1 — Find your iOS simulator UDID

```bash
execbro-task devices
```

Pick a row whose runtime matches the app's deployment target. Copy its UDID (the long hyphenated string in the IDENTIFIER column).

---

## Step 2 — Write a config

```bash
mkdir -p ~/.execbro
cat > ~/.execbro/config.json <<EOF
{
    "slots": [
        { "id": 1, "platform": "ios", "deviceId": "<paste-udid-here>", "metroPort": 8081 }
    ]
}
EOF
```

> **Why 8081?** RN's Metro port is baked into the iOS binary at build time, not read from runtime env, so the app expects whatever port was set during build. 8081 is RN's default — easy match. Phase 2 (parallel slots) will revisit this with port-aware rebuilds. If you have a manual Metro running on 8081, kill it first (`lsof -ti :8081 | xargs kill`).

## Step 3 — Write a tiny task

```bash
cat > /tmp/test-task.md <<EOF
Read the README of this project and write a one-paragraph summary into a new file called SUMMARY.md at the repo root. Then commit it.
EOF
```

This is intentionally trivial — the goal is to validate the loop, not the agent's coding skill.

## Step 4 — Start the worker (terminal 1)

```bash
execbro-worker
```

Expected first log line: `[worker] started, 1 slot(s) configured`.

## Step 5 — Enqueue the task (terminal 2)

```bash
cd <your-rn-app-repo>
execbro-task add /tmp/test-task.md
```

Expected: `Enqueued <task-id>` plus repo and base branch lines.

## Step 6 — Watch the loop (terminal 3)

```bash
execbro-task list
tmux ls
tail -f ~/.execbro/logs/<task-id>.jsonl
```

You should see the worker:

1. Move the descriptor from `inbox/` to `running/`
2. Create a worktree at `~/.execbro/worktrees/<task-id>`
3. Boot the simulator (visible if Simulator.app is open)
4. Start a Metro tmux session (`execbro-metro-<task-id>`)
5. Build and install the app
6. Open `execbro-<task-id>` tmux session running Claude Code
7. Paste the prompt (preamble + your task + verification suffix) into Claude

Attach to inspect mid-run:

```bash
tmux attach -t execbro-<task-id>
# Ctrl-b d to detach without killing
```

When the agent finishes, the worker should:

8. Commit any uncommitted work
9. Push `task/<task-id>` to Bitbucket
10. Show a macOS notification with the PR URL
11. Move the descriptor to `done/`

## Step 7 — Document any issues found and fix iteratively

Common issues to expect on first run:

- Claude Code session not ready before prompt is sent → bump the 5s sleep in [`src/runner/run.ts`](src/runner/run.ts).
- Bundle ID mismatch → fix the `execbro.iosBundleId` field in your app's `package.json`.
- Metro port collision → kill existing Metro on 8082 (`lsof -i :8082`) or change the port in `~/.execbro/config.json`.
- iOS sim already booted in the wrong state → `xcrun simctl shutdown <UDID>` then re-run.
- `git push` fails because Bitbucket SSH isn't set up → run `git push -u origin task/<id>` manually from the worktree to verify your auth.
- Worker doesn't kick off when descriptor lands → `ls ~/.execbro/queue/inbox/` confirms the file is there; check `chokidar` output in worker terminal.

## Step 8 — Commit fixes

After the loop works end-to-end at least once:

```bash
cd ~/rn-devtools/execbro-runner
git add -A
git commit -m "fix(phase-1): smoke-test fixes from end-to-end run"
```

## What success looks like

You can `git log` on the new `task/<task-id>` branch in your RN app repo and see at least one commit by the agent. You can click the PR URL from the notification and land in the Bitbucket "Create pull request" page with source and dest branches pre-filled. You can `cat ~/.execbro/queue/done/<task-id>.json` and see `"status": "done"`.

That's Phase 1 working.

## Multi-device scenarios (added 2026-05-10)

Prerequisite: `~/.execbro/config.json` has at least 2 iOS slots **and** 1 Android slot configured (hand-edit if `init` hasn't been re-run with the multi-device wizard yet).

### Scenario A — Concurrent single-device tasks (iOS + Android in parallel)

1. Boot one iOS sim and one Android emulator (or let provisioning boot them).
2. Enqueue an iOS-only task: `execbro-task add path/to/ios-plan.md --devices ios`.
3. Within 30s, enqueue an Android-only task: `execbro-task add path/to/android-plan.md --devices android`.
4. **Expected:** `execbro-task list` shows both tasks in `RUNNING`, with different `slots=` and different `port=` values. The worker log shows two interleaved `picked up <id>` lines.

### Scenario B — Two devices on shared Metro (visual parity)

1. Enqueue: `execbro-task add path/to/parity-plan.md --devices ios,android`.
2. **Expected:**
    - `execbro-task list` shows `[ios,android]` and `slots=1,2` (or whichever slot ids).
    - Worker log shows ONE Metro start, then `boot 2 device(s) in parallel`, then both apps registering with Metro on the same port.
    - Agent preamble (peek at the JSONL log under `~/.execbro/logs/<id>.jsonl`) shows both devices listed under `Devices:` with the multi-device verification suffix.

### Scenario C — FIFO blocking on insufficient slots

1. With config of (1 iOS + 1 Android), enqueue first: `execbro-task add multi.md --devices ios,ios` (needs 2 iOS slots).
2. Then enqueue: `execbro-task add solo.md --devices ios`.
3. **Expected:** Both tasks sit in `QUEUED`. Worker is idle (no `picked up` lines). This is the strict-FIFO trade-off — the head-of-queue task can't claim 2 iOS slots, and the younger single-iOS task is NOT allowed to skip ahead.
4. Cleanup: `execbro-task clean <multi-id>` — the second task should now run.
