---
description: "Drive a full feature development cycle — /driver <ISSUE-KEY-OR-SPEC> [--phases ...] [--worktree] [--max-rounds N] [--qa \"cmd\"] [--qa-scope scoped|full] [--force] [--draft] [--<phase>-variant <name>]"
agent: driver
---

Run the driver cycle. Every implement task is wrapped in a per-task spec-audit +
quality-gate (scope=task) before the next task starts. `--qa-scope scoped` (default) runs each task's
manifest `qa.command` in the per-task gate; `--qa-scope full` runs the full QA command per
task (the cycle-scope run always uses the full command).

Usage: /driver <ISSUE-KEY-OR-SPEC> [--phases preplan,plan,...] [--worktree] [--max-rounds N] [--qa "cmd"] [--qa-scope scoped|full] [--force] [--draft] [--<phase>-variant <name>]

Arguments: $ARGUMENTS

Repository root: !`git rev-parse --show-toplevel`
Current branch: !`git branch --show-current`
Dirty files: !`git status --porcelain`

# NOTE: the `!` shell blocks above are static (no $ARGUMENTS inside) — they run outside
# the permission flow, so never interpolate user/issue text into a `!` block.
