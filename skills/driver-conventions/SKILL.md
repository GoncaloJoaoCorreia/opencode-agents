---
name: driver-conventions
description: Contracts shared by all driver phases (the `driver` orchestrator and `driver/*` subagents, /driver and /phases/* commands): state.json schema, plan manifest schema, commit message format, history/decisions file format, issue-ID validation, phase-summary contract. Load this FIRST in every driver phase.
---

# Driver conventions

Every driver phase loads this skill first. It is the single source of truth for the files
phases exchange. If you change a format here, update the schemas in `references/` too.

## 1. State file — `.plan/<ISSUE-ID>/state.json`

Written by preplan, read + updated by every phase, read by the driver. Schema:
`references/state.schema.json`. Key rules:

- `issue_id` must match `^[A-Z][A-Z0-9]+-[0-9]+$` — **validate before using it in any path**
  (path traversal).
- `phases.<name> = { status: pending|running|done|failed|skipped, summary, started_at, completed_at }`.
- `plan.tasks[] = { id, title, file, status: pending|done|skipped, commit }`.
- Never delete information — append/merge. Re-runs resume from this file.
- Summaries are SHORT (a few lines). Big content lives in files under `.plan/`, referenced
  by path. `.plan/` is gitignored in the target repo.

## 2. Plan artifacts — `.plan/<ISSUE-ID>/`

- `plan.md` — human-readable plan.
- `manifest.json` — machine-readable plan. Schema: `references/manifest.schema.json`.
  Per task: `id` (slug), `title`, `file` (`tasks/<id>.md`), `depends_on`, `files` (globs the
  implement phase may stage), `acceptance_criteria[]` with `verification`:
  `{ type: "command", command }` or `{ type: "manual", instructions }`. spec-audit executes
  these — make them concrete and runnable.
- `tasks/<task-id>.md` — one detailed file per task.

## 3. Commit messages (implement phase only)

Conventional commits: `<type>(<scope>): <subject>`, scope = module. Body as needed. Trailers:

```
Driver-Task: <task-id>
Refs: <ISSUE-ID>
```

One commit per task. Stage only the task's `files` globs. Never push.
TODO: confirm the allowed `type` list and whether `Signed-off-by` is required.

## 4. History & decisions (write-history phase; committed in the target repo)

- `agent/<module>/history.md` — append-only. Entry template:

  ```md
  ## 2026-10-30 — ABC-123 — Short title
  - What changed: ...
  - Commits: `abc1234`, `def5678`
  - Plan: `.plan/ABC-123/plan.md`
  ```

- `agent/<module>/decisions.md` — append-only, only for real decisions:

  ```md
  ## 2026-10-30 — ABC-123 — Chose X over Y
  - Context: ...
  - Options considered: ...
  - Decision: ...
  - Rationale: ...
  - Consequences: ...
  ```

- Module mapping (TODO: confirm per target repo). Default rule: module = first path segment
  of the changed files under `src/`, else the first segment, else `core`.
- One history entry per module per cycle (group the cycle's commits), not one per commit.

## 5. Phase-summary contract (phase → driver)

Each phase returns to the driver ONLY: phase name, status, a 3–10 line summary, and key ids
(task ids, commit SHAs, failing criterion ids, finding ids). The driver writes it into
`state.json`. Never return file contents wholesale.

## 6. Security / hygiene

- Validate issue IDs before path use; never interpolate untrusted text (issue titles, spec
  bodies) into shell commands or into `!` blocks of command templates.
- Phases never push; only `driver/implement` commits.
- Phases never spawn subagents (nesting depth is 1) — the driver owns all loops and fan-out.
- The `question` tool works in foreground children; in headless `opencode run`, fail fast
  on missing input instead of asking.
