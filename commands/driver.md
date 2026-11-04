---
description: "Drive a full feature development cycle — /driver <ISSUE-KEY-OR-SPEC> [--phases ...] [--skip ...] [--worktree] [--max-rounds N] [--qa \"cmd\"] [--qa-scope scoped|full] [--force] [--draft] [--forge auto|github|gitlab|forgejo] [--<phase>-variant <name>]"
agent: driver
---

Run the driver cycle. Every implement task is wrapped in a per-task spec-audit +
quality-gate (scope=task) before the next task starts — except for a single-task manifest
when the cycle-scope spec-audit + quality-gate are in the run set: then the per-task gates
are not spawned and the verdicts are recorded as `skipped` (the cycle-scope runs cover the
only task). `--qa-scope scoped` (default) runs each task's
manifest `qa.command` in the per-task gate; `--qa-scope full` runs the full QA command per
task (the cycle-scope run always uses the full command).

The confirmed QA command is cached per repo in `git config driver.qa` (via the installed
`agent-scripts/qa-command.sh`) and reused on later runs without asking — override with
`--qa "cmd"` or `git config driver.qa "..."`, clear with `git config --unset driver.qa`.

Usage: /driver <ISSUE-KEY-OR-SPEC> [--phases preplan,plan,...] [--skip a,b,...] [--worktree] [--max-rounds N] [--qa "cmd"] [--qa-scope scoped|full] [--force] [--draft] [--forge auto|github|gitlab|forgejo] [--<phase>-variant <name>]

`--skip a,b,...` marks the named phases as skipped (never run, incl. their per-task gates) — mutually exclusive with `--phases`. On a fresh run, `preplan`/`plan` may not be skipped.

Arguments: $ARGUMENTS

Repository root: !`git rev-parse --show-toplevel`
Current branch: !`git branch --show-current`
Dirty files: !`git status --porcelain`

# NOTE: the `!` shell blocks above are static (no $ARGUMENTS inside) — they run outside
# the permission flow, so never interpolate user/issue text into a `!` block.
