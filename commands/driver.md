---
description: Drive a full feature development cycle for an issue/spec (preplan → plan → implement → spec-audit → code-review → quality-gate → write-history)
agent: driver
---

Run the driver cycle.

Arguments: $ARGUMENTS

Repository root: !`git rev-parse --show-toplevel`
Current branch: !`git branch --show-current`
Git status: !`git status --short`

# NOTE: shell blocks above are static (no $ARGUMENTS inside) — they run outside the
# permission flow, so never interpolate user/issue text into a `!` block.
