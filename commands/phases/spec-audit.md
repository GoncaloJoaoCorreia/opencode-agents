---
description: "Run only the spec-audit phase of the driver cycle (standalone / resume) — args: statePath or slug, plus scope=task|cycle, taskId (when scope=task), round"
agent: driver/spec-audit
subagent: true
---

Run the spec-audit phase.

Arguments: $ARGUMENTS

In the full cycle the driver spawns this phase once per task (`scope=task`, `taskId`, `round`)
inside the implement fan-out, and once at the end (`scope=cycle`). Standalone, pass the same
inputs, e.g.: `/phases/spec-audit ABC-123 scope=cycle round=1`.
