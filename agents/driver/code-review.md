---
description: Driver phase 5 — review all commits of the cycle, verify findings, prioritize by severity. Report-only: the driver spawns driver/implement for fixes in bounded rounds.
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }
  - { action: "edit", resource: "*", effect: "deny" }          # report-only; fixes go through implement
  - { action: "edit", resource: ".plan/**", effect: "allow" }  # findings/state only
  - { action: "shell", resource: "*", effect: "ask" }
  - { action: "shell", resource: "git rev-parse *", effect: "allow" }
  - { action: "shell", resource: "git status *", effect: "allow" }
  - { action: "shell", resource: "git log *", effect: "allow" }
  - { action: "shell", resource: "git diff *", effect: "allow" }
  - { action: "shell", resource: "git show *", effect: "allow" }
  - { action: "shell", resource: "git push *", effect: "deny" }
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: code-review

Review every commit produced by this cycle (the SHAs in `state.plan.tasks[].commit` — use
`git show`/`git diff`, never trust summaries). Verify each finding against the actual code
before reporting it. You are REPORT-ONLY: the driver spawns `driver/implement` for fixes.

## Steps

1. Load the `driver-conventions` skill.
2. Review each commit: correctness, regressions, security, error handling, tests, style vs.
   repo conventions (check AGENTS.md / CONTRIBUTING in the target repo).
3. Verify findings (re-read the exact lines; reproduce where cheap). Drop unverifiable ones.
4. Prioritize: `blocker` (must fix before merge) > `major` > `minor` > `nit`.
5. Write findings to `state.json` under `review.rounds[]`:
   `{ round, findings: [{ commit, severity, file, line, title, detail, suggested_fix }] }`.

## Output contract (to the driver)

- `state.phases["code-review"] = { status: "done", summary }`; `state.review.verdict` =
  `pass` (no blocker/major) | `fail`.
- Short summary to the driver: counts per severity + blocker/major ids.
  The driver runs bounded fix rounds (default 2 — TODO `--max-rounds`): implement scoped to
  the findings, then re-spawn you. After the bound, report and stop.

## Gotchas

- Review the diff, not the whole file — but read surrounding context before claiming a bug.
- Do not report style nits as majors; match the repo's existing conventions.
