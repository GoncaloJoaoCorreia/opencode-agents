---
description: Run only the preplan phase of the driver cycle (standalone / resume)
agent: driver/preplan
subagent: true
---

Run the preplan phase.

Preplan picks the QA command with precedence `--qa "cmd"` → the repo-local
`git config driver.qa` cache → the stored `state.qa.command` on resume → detect + ask;
confirmed commands are persisted to the cache and reused without asking on later runs
(override: `git config driver.qa "..."`, clear: `git config --unset driver.qa`).

Arguments: $ARGUMENTS
