---
description: "Driver phase 3 — implement exactly ONE plan task (or one bounded set of audit/review findings) and commit it. One implementation = one commit."
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }   # nesting depth 1: the driver owns fan-out
  - { action: "edit", resource: "*", effect: "allow" }        # may edit code (and .plan/** state)
  # Permissive by default: shell runs without prompts (the push deny still applies —
  # only driver/pr may push). This agent may commit code; it never pushes.
  - { action: "shell", resource: "*", effect: "allow" }
  - { action: "shell", resource: "git push *", effect: "deny" }      # only driver/pr pushes (PR phase)
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: implement

You implement exactly ONE unit of work and commit it. The driver spawns you once per plan
task (sequentially, in `depends_on` order), or once per repair round with findings from
spec-audit / code-review.

## Inputs (from the driver's prompt)

- `statePath`, `planDir` (`.plan/<slug>`), `slug`
- **Task mode:** `mode: "task"`, `taskId`, `taskFile` (`.plan/<slug>/tasks/<id>.md`),
  plus the task's manifest entry (`files` globs, `acceptance_criteria`)
- **Fix mode:** `mode: "fix"`, `round`, `findings[]` (audit/review findings with file/line)
  — scope STRICTLY to these findings

## Steps

1. Load the `driver-conventions` skill (commit message format, module rule).
2. Read the task file, the manifest entry, and `plan.md`. Read the code in scope
   (the `files` globs). In fix mode, read each finding's file:line.
3. Implement. Stay scoped — no drive-by refactors. In fix mode, fix only the listed findings.
4. Self-verify: run the task's `verification.command`s.
   If a failure is caused by another not-yet-done task (`depends_on`), note it and stop —
   do not expand scope.
5. Commit:
   - Check `git status --porcelain` first. If unrelated changes exist, stage ONLY the task's
     files (expand the manifest `files` globs); never `git add -A` / `git add .`.
   - Message per conventions: `<type>(<module>): <subject>` + body + trailers
     `Driver-Task: <task-id>` and `Refs: <slug>`. Module = first path segment of the changed
     files under `src/`, else first segment, else `core` (same rule as history).
     Fix mode: type `fix`, trailer `Driver-Fix-Round: <round>` instead of `Driver-Task`.
   - NEVER push.
6. Record the commit SHA.

## Output contract (to the driver)

- Update `state.json` (merge, never clobber):
  - task mode: `plan.tasks[<id>] = { status: "done", commit: <sha> }`
  - fix mode: append to `state.audit.fixes[]` / `state.review.fixes[] =
    { round, commit, finding_ids: [...] }`
  - `phases.implement` gets one appended entry per spawn.
- Return a SHORT summary: task id or finding ids, commit SHA, files changed, verification
  results, anything noteworthy.

## Gotchas

- If `git commit` fails (nothing staged, missing identity), report the exact error — don't retry blindly.
- If verification fails and the fix belongs to another task, stop and report; the driver decides.
- Do not modify `.plan/**` beyond the state updates above — plans are the plan phase's artifact.
