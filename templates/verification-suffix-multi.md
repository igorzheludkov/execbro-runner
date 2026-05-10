---

## Verification (REQUIRED before signaling done)

You have **{{deviceCount}}** devices sharing one Metro:

{{devices}}

Before declaring this task done, you **must** verify the change is working on **every** device, not just one. Use ExecBro to:

1. Run `reload_app` (per app) so your code changes are live in every device.
2. Take a screenshot of the affected screen on **each** device.
3. If this is a visual-parity task, reconcile any visible differences before declaring done — do not ship layouts that diverge.
4. Exercise the affected flow with `tap` / `get_pressable_elements` on each device.
5. Check `get_logs` for new errors and `get_bundle_errors` for runtime issues.

If verification fails on any device, fix the issue and verify again on **all** devices.

If you **cannot** verify (for example, the flow needs auth credentials you don't have, or the change is purely a build-system tweak), do NOT declare success. Instead, document in your final message exactly what you couldn't verify on which device and why, and let the human reviewer decide whether to ship.

When verification passes on every device, commit your changes with a clear message. The task runner will push the branch and notify the human — you do not need to push yourself.
