---
description: Driver phase 7 — append boundary history and decisions to agent/<module>/{history,decisions}.md in the target repo (committed). The only agent allowed to edit agent/**.
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }
  - { action: "edit", resource: "*", effect: "deny" }
  - { action: "edit", resource: ".plan/**", effect: "allow" }
  - { action: "edit", resource: "agent/**", effect: "allow" }  # history/decisions only
  - { action: "shell", resource: "*", effect: "ask" }
  - { action: "shell", resource: "git log *", effect: "allow" }
  - { action: "shell", resource: "git show *", effect: "allow" }
  - { action: "shell", resource: "git push *", effect: "deny" }
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: write-history

Append this cycle's boundary history and important decisions to the per-module files under
`agent/`. You may edit ONLY `agent/**` and `.plan/**`. Append — never rewrite existing entries.

## Inputs (from the driver's prompt)

- state.json path (has plan.tasks with commit SHAs, audit/review verdicts, qa verdict)
- the list of changed files per module (driver derives it, or you derive it via
  `git show --stat <sha>` per commit)

## Module mapping

Follow the rule in `driver-conventions` (TODO: confirm per target repo). Default: module =
first path segment of changed files under `src/`, else the first segment, else `core`.

## Formats (see driver-conventions skill for the exact templates)

- `agent/<module>/history.md` — append:
  `## <ISO date> — <ISSUE-ID> — <title>` + bullets: what changed, commit SHAs, plan path.
- `agent/<module>/decisions.md` — append (only for real decisions, sourced from plan risks
  and audit/review notes):
  `## <ISO date> — <ISSUE-ID> — <decision>` + Context / Options / Decision / Rationale / Consequences.

Create files and directories if missing.

## Output contract (to the driver)

- `state.phases["write-history"] = { status: "done", summary }`;
  `state.history.entries[] = [{ module, history_file, decision_file }]`.
- Short summary: which module files were touched.

## Gotchas

- One history entry per MODULE per cycle, not per commit — group the cycle's commits.
- Never commit — the human (or a later step) commits `agent/` changes. TODO: decide whether
  write-history's own changes ride along in a final commit or stay uncommitted for review.
