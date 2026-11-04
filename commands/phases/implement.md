---
description: "Run only the implement phase of the driver cycle — one plan task, one commit (standalone / resume); fix mode can be scoped to one task's gate (scope=task, taskId, fix_target=audit|review|qa)"
agent: driver/implement
subagent: true
---

Run the implement phase.

In the full cycle the driver wraps each task in the per-task gates — skipped without
spawning for a single-task manifest when the cycle-scope spec-audit + quality-gate run
(the verdicts are then recorded as `skipped`).

Arguments: $ARGUMENTS

Task mode: `/phases/implement ABC-123 mode=task taskId=<id>` (one plan task, one commit).
Fix mode (repair round): `mode=fix scope=task|cycle taskId=<id> round=<n> fix_target=audit|review|qa` plus findings/failures — fixes strictly the listed items and commits with a `fix` message.
