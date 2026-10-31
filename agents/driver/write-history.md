---
description: Driver phase 7 — append boundary history and decisions to agent/<module>/{history,decisions}.md in the target repo, then commit those changes as a docs commit. The only agent allowed to edit agent/**.
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }
  - { action: "edit", resource: "*", effect: "deny" }
  - { action: "edit", resource: ".plan/**", effect: "allow" }
  - { action: "edit", resource: "agent/**", effect: "allow" }  # history/decisions only
  # Permissive by default: shell runs without prompts (the push deny still applies —
  # only driver/pr may push). This phase commits ONLY agent/ changes (docs commit).
  - { action: "shell", resource: "*", effect: "allow" }
  - { action: "shell", resource: "git push *", effect: "deny" }
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: write-history

Append this cycle's boundary history and important decisions to the per-module files under
`agent/`, then commit those changes. You may edit ONLY `agent/**` and `.plan/**`. Append —
never rewrite existing entries.

## Inputs (from the driver's prompt)

- `statePath` (has plan.tasks with commit SHAs, audit/review/qa verdicts, spec)
- the list of modules touched (driver derives them, or derive via `git show --stat <sha>` per commit)

## Module mapping (confirmed default rule)

module = first path segment of the changed files under `src/`, else the first segment,
else `core`.

## Steps

1. Load the `driver-conventions` skill (exact entry templates).
2. Group this cycle's commits (`state.plan.tasks[].commit`) by module via `git show --stat`.
3. For each module, append to `agent/<module>/history.md`:
   `## <ISO date> — <ISSUE-ID> — <title>` + bullets: what changed, commit SHAs, plan path.
   Append to `agent/<module>/decisions.md` ONLY for real decisions (from plan risks and
   audit/review notes): Context / Options / Decision / Rationale / Consequences.
   Create files/dirs if missing. One history entry per module per cycle (group the commits).
4. Commit the history changes: `git add agent/...` (only those paths) then
   `git commit -m "docs(driver): record history/decisions for <ISSUE-ID>"`.
   NEVER push (only the pr phase pushes). If there is nothing to commit (no entries), skip the commit.
5. Update `state.json`: `phases["write-history"] = { status: "done", summary }`,
   `history.entries[] = [{ module, history_file, decision_file, commit }]`, and record the
   docs commit SHA.

## Output contract (to the driver)

Short summary: module files touched + docs commit SHA (or "nothing to commit").

## Gotchas

- If `git commit` fails (e.g. nothing staged), do not force it — report and leave changes uncommitted.
- Never stage files outside `agent/`.
