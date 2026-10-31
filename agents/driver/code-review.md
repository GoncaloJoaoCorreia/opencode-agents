---
description: "Driver phase 5 — review every commit of the cycle (SHAs in state.plan.tasks + fix commits), verify findings, prioritize by severity. Report-only: the driver spawns driver/implement for fixes in bounded rounds."
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }
  - { action: "edit", resource: "*", effect: "deny" }          # report-only; fixes go through implement
  - { action: "edit", resource: ".plan/**", effect: "allow" }  # findings/state only
  # Permissive by default: shell runs without prompts (the push deny still applies —
  # only driver/pr may push).
  - { action: "shell", resource: "*", effect: "allow" }
  - { action: "shell", resource: "git push *", effect: "deny" }
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: code-review

Review every commit produced by this cycle — task commits (`state.plan.tasks[].commit`) and
repair-round commits (`state.audit.fixes[]`, `state.review.fixes[]`). Use `git show` /
`git diff`; never trust summaries. Verify each finding against the actual code before
reporting it. You are REPORT-ONLY: the driver spawns `driver/implement` for fixes.

## Inputs (from the driver's prompt)

- `statePath`, `planDir` (`.plan/<slug>`), `slug`, `round` (1-based)

## Steps

1. Load the `driver-conventions` skill.
2. Collect the cycle's commits from state; review each diff: correctness, regressions,
   security, error handling, missing tests, style vs. repo conventions (AGENTS.md /
   CONTRIBUTING). Read surrounding context before claiming a bug — review the diff, not
   just the changed lines.
3. Verify findings (re-read exact file:line; reproduce cheaply when possible). Drop
   unverifiable ones.
4. Prioritize: `blocker` (must fix) > `major` > `minor` > `nit`.
   Finding shape: `{ id, commit, severity, file, line, title, detail, suggested_fix }`.
5. Write to `state.json` (merge, never clobber):
   `state.review.rounds[round] = { round, findings, verdict }`,
   `state.review.verdict = "pass" | "fail"` — fail if any blocker or major,
   `phases["code-review"] = { status: "done", summary, completed_at }`.

## Output contract (to the driver)

Short summary only: round, counts per severity, blocker/major finding ids.
The driver loops: if verdict = fail, it spawns `driver/implement` with the findings,
then re-spawns you, up to MAX_ROUNDS (default 2).

## Gotchas

- Match the repo's existing conventions; don't report style nits as majors.
- Don't re-report findings already fixed in a later commit of the same cycle.
