
---

## Verification (REQUIRED before signaling done)

Before declaring this task done, you **must** verify the change is working in the running app, not just that the code compiles or unit tests pass. Use ExecBro to:

1. Run `reload_app` so your code changes are live in the simulator.
2. Take a screenshot to confirm the UI is in the expected state.
3. Exercise the affected flow with `tap` / `get_pressable_elements`.
4. Check `get_logs` for new errors and `get_bundle_errors` for runtime issues.

If verification fails, fix the issue and verify again.

If you **cannot** verify (for example, the flow needs auth credentials you don't have, or the change is purely a build-system tweak), do NOT declare success. Instead, document in your final message exactly what you couldn't verify and why, and let the human reviewer decide whether to ship.

When verification passes, commit your changes with a clear message. The task runner will push the branch to Bitbucket and notify the human — you do not need to push yourself.
