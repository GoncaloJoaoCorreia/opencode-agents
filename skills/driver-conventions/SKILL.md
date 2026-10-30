---
name: Driver Conventions
description: "Contracts shared by all driver phases (the `driver` orchestrator and `driver/*` subagents, /driver and /phases/* commands) — state.json schema, plan manifest schema, commit message format, history/decisions file format, slug/branch/worktree policy, Linear usage, phase-summary contract. Load this FIRST in every driver phase."
---

# Driver conventions

Every driver phase loads this skill first. Single source of truth for the files phases
exchange. If you change a format here, update the schemas in `references/` too.

## 0. Run policy (driver pre-flight)

- Run `/driver` from the repo root (the driver moves its session there if needed —
  permission rules like `.plan/**` are Location-relative).
- Slug (= `issue_id`) always matches `^[A-Z][A-Z0-9]+-[0-9]+$`. From a Linear key it is the
  key itself; for a raw spec the driver asks the user for one. **Validate before any path use.**
- Plan dir is `.plan/<slug>/` at the repo root; `.plan/` is gitignored in the target repo.
- Dirty tree at start → the driver asks (default: abort).
- Branch: on `main`/`master`/`develop`/`dev` the driver creates `feat/<slug>`.
- `--worktree`: the driver creates a git worktree named `<slug>` and moves its session into
  it before spawning any phase.
- Linear: MCP server `linear-project` (https://mcp.linear.app/mcp), READ-ONLY:
  `get_issue` / `list_comments` etc. may be called (they ask for approval); all
  create/update/save/delete tools are denied.
- Flags: `--phases`, `--worktree`, `--max-rounds N`, `--qa "cmd"`, `--force`,
  `--<phase>-variant <name>` — parsed by the driver into `state.params`; on resume, newly
  passed flags win. `--force` re-runs all requested phases even if `done`.
- LIMITATION: the driver requires an interactive client — the driver and preplan use the
  `question` tool, so headless `opencode run` is not supported.
- After the plan phase, the driver asks the user to approve the plan before implement runs
  (Proceed / Revise / Abort).

## 1. State file — `.plan/<slug>/state.json`

Written by the driver (initial skeleton), filled by preplan, read+updated by every phase.
Schema: `references/state.schema.json`. Key rules:

- Never delete information — append/merge. Re-runs resume from this file.
- Summaries are SHORT (a few lines). Big content lives in files under `.plan/<slug>/`
  (`spec.md`, `plan.md`, `manifest.json`, `tasks/*.md`, `qa.log`), referenced by path.
- `phases.<name> = { status: pending|running|done|failed|skipped, summary, started_at, completed_at }`.
- `plan.tasks[] = { id, title, file, status: pending|done|skipped, commit }`.

## 2. Plan artifacts — `.plan/<slug>/`

- `spec.md` — the raw spec when it didn't come from Linear.
- `plan.md` — human-readable plan.
- `manifest.json` — machine-readable plan. Schema: `references/manifest.schema.json`.
  Per task: `id` (slug), `title`, `file` (`tasks/<id>.md`), `depends_on`, `files` (globs the
  implement phase may stage), `acceptance_criteria[]` with `verification`:
  `{ type: "command", command }` or `{ type: "manual", instructions }`. spec-audit executes
  these — make them concrete and runnable.
- `tasks/<task-id>.md` — one detailed file per task; implement works from these.

## 3. Commit messages (implement phase; write-history docs commit)

Conventional commits, scope REQUIRED (= module):

```
<type>(<module>): <subject>

<body>

Driver-Task: <task-id>
Refs: <ISSUE-ID>
```

- Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`.
- One commit per task. Stage only the task's `files` globs. Never push. No sign-off required.
- write-history's own commit: `docs(driver): record history/decisions for <ISSUE-ID>`,
  staging only `agent/...` paths.

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

- Module mapping (confirmed default): first path segment of the changed files under `src/`,
  else the first segment, else `core`.
- One history entry per module per cycle (group the cycle's commits), not one per commit.

## 5. Phase-summary contract (phase → driver)

Each phase returns to the driver ONLY: phase name, status, a 3–10 line summary, and key ids
(task ids, commit SHAs, failing criterion ids, finding ids). The driver writes it into
`state.json`. Never return file contents wholesale.

## 6. Security / hygiene

- Validate slugs before path use; never interpolate untrusted text (issue titles, spec
  bodies) into shell commands or into `!` blocks of command templates.
- Phases never push; only `driver/implement` commits code, only `driver/write-history`
  commits `agent/` changes.
- Phases never spawn subagents (nesting depth is 1) — the driver owns all loops and fan-out.
- The `question` tool works in foreground children; the driver is interactive-only
  (headless `opencode run` is not supported).
