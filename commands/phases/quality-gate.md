---
description: "Run only the quality-gate phase of the driver cycle (standalone / resume) — args: statePath or slug, plus scope=task|cycle, taskId (when scope=task), round"
agent: driver/quality-gate
subagent: true
---

Run the quality-gate phase.

Arguments: $ARGUMENTS

In the full cycle the driver spawns this phase once per task (`scope=task`, `taskId`, `round`,
scoped per-task `qa.command` unless `params.qa_scope=full`) inside the implement fan-out, and
once at the end (`scope=cycle`, always the full `state.qa.command`). Standalone, pass the same
inputs, e.g.: `/phases/quality-gate ABC-123 scope=cycle round=1`.
