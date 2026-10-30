---
description: "Drive a full feature development cycle — /driver <ISSUE-KEY-OR-SPEC> [--phases ...] [--worktree] [--max-rounds N] [--qa \"cmd\"] [--force] [--<phase>-variant <name>]"
agent: driver
---

Run the driver cycle.

Usage: /driver <ISSUE-KEY-OR-SPEC> [--phases preplan,plan,...] [--worktree] [--max-rounds N] [--qa "cmd"] [--force] [--<phase>-variant <name>]

Arguments: $ARGUMENTS

Repository root: !`git rev-parse --show-toplevel`
Current branch: !`git branch --show-current`
Dirty files: !`git status --porcelain`

# NOTE: the `!` shell blocks above are static (no $ARGUMENTS inside) — they run outside
# the permission flow, so never interpolate user/issue text into a `!` block.
