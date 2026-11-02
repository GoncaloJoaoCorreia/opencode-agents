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
- Final phase `pr` (phase 8, in the default phase list) pushes the cycle branch and
  opens/updates a PR via the `gh` CLI against the repo's default branch (fallback `main`)
  — see §7. It is the ONLY phase allowed to push.
- `--worktree`: the driver creates a git worktree named `<slug>` and moves its session into
  it before spawning any phase.
- Linear: MCP server `linear-project` (https://mcp.linear.app/mcp), READ-ONLY:
  `get_issue` / `list_comments` etc. may be called without prompting; all
  create/update/save/delete tools are hard-denied.
- Flags: `--phases`, `--skip`, `--worktree`, `--max-rounds N`, `--qa "cmd"`,
  `--qa-scope scoped|full`, `--force`, `--draft`, `--<phase>-variant <name>` — parsed by the
  driver into `state.params`; on resume, newly passed flags win. `--force` re-runs all
  requested phases even if `done`. `--draft` opens the PR as a draft (pr phase only).
  `--qa-scope` sets `params.qa_scope` (default `"scoped"`). `--skip a,b,...` stores
  `params.skip[]` and marks those phases `status: "skipped"` — they are never spawned,
  including their per-task gate spawns inside the implement fan-out (`--skip spec-audit` /
  `--skip quality-gate` ⇒ per-task `audit`/`qa` verdicts become `"skipped"`). `--skip` is
  mutually exclusive with `--phases` (error if both). On a fresh run (no state.json),
  `preplan`/`plan` may not be skipped (hard error); on resume any phase may be skipped, but
  a skipped phase's outputs must already exist or the next phase that needs them stops with
  an error. `--force` never un-skips.
- LIMITATION: the driver requires an interactive client — the driver and preplan use the
  `question` tool, so headless `opencode run` is not supported.
- After the plan phase, the driver asks the user to approve the plan before implement runs
  (Proceed / Revise / Abort) — the question surfaces `plan.md`'s `## Assumptions` and open
  questions so unfounded assumptions get vetoed up front. The plan phase asks clarifying
  questions eagerly via `question` and never assumes silently.

## 1. State file — `.plan/<slug>/state.json`

Written by the driver (initial skeleton), filled by preplan, read+updated by every phase.
Schema: `references/state.schema.json`. Key rules:

- Never delete information — append/merge. Re-runs resume from this file.
- Summaries are SHORT (a few lines). Big content lives in files under `.plan/<slug>/`
  (`spec.md`, `plan.md`, `manifest.json`, `tasks/*.md`, `qa.log`,
  `audit-round-<n>.md`), referenced by path — never inline evidence or log tails beyond a
  short excerpt.
- `phases.<name> = { status: pending|running|done|failed|skipped, summary, started_at, completed_at }`.
  `skipped` is set by `--skip` (`params.skip[]`) or by preplan's "skip quality-gate" choice.
  This is ONE aggregate entry per phase. Per-spawn records go elsewhere:
  `implement.runs[] = { mode: task|fix, task_id?, round?, commit, summary?, at }`.
- `plan.tasks[] = { id, title, file, status: pending|done|skipped, commit, audit?, qa? }` —
  `audit`/`qa` are the per-task gate verdicts (pass|fail|skipped), set by the
  per-task gate (always on).
- `plan.assumptions[]` / `plan.open_questions[]` — string mirrors of `plan.md`'s
  `## Assumptions` section and open questions, so the driver's approval gate can surface
  them without reading the file.
- `audit.fixes[]` / `review.fixes[]` — repair commits the driver spawned via implement in
  fix mode. `audit.fixes[]` entries carry `scope: "task"|"cycle"` + `task_id?`;
  `review.fixes[]` are always cycle-scope: `{ round, commit, finding_ids[] }`.
- `qa.log` = path to the full log (`.plan/<slug>/qa.log`); `qa.log_excerpt` = short tail
  kept inline; `qa.failures[] = { title, file?, line?, excerpt }`.
- **Per-task gating (always on):**
  the driver's implement fan-out wraps each task before moving to the next:
  `implement` (mode=task, one commit) → `spec-audit` (`scope: "task"`, `task_id`) with
  bounded fix rounds → `quality-gate` (`scope: "task"`, `task_id`) with bounded fix rounds.
  A task becomes `done` only with `commit` set AND `audit: "pass"` AND `qa: "pass"|"skipped"`
  (per-task verdicts are stored on the `plan.tasks[]` entry). After ALL tasks, spec-audit and
  quality-gate run once more with `scope: "cycle"` — the cycle quality-gate always runs the
  full `state.qa.command`. `params.max_rounds` bounds the repair rounds of EACH gate.
- `audit.rounds[]` entries carry `scope` + `task_id?`; `round` is 1-based per (scope, task).
  Task-scope evidence goes to `.plan/<slug>/audit-<task-id>-round-<n>.md`, cycle-scope to
  `.plan/<slug>/audit-round-<n>.md`.
- Finding ids are scope-prefixed and stable across rounds: `T<task-id>-R<round>-F<n>` (task
  scope, e.g. `Tlogin-R1-F2`) and `C-R<round>-F<n>` (cycle scope, e.g. `C-R2-F3`).
- `qa.runs[]` records per-task quality-gate runs:
  `{ scope: "task", task_id, round, command, verdict: pass|fail|skipped, exit_code?, log, failures? }`
  — `verdict: "skipped"` when `params.qa_scope` is `"scoped"` and the task declares no
  `qa.command` in the manifest (never run the full suite per task in scoped mode). The
  cycle-scope run keeps the top-level `qa.*` fields. `qa.fixes[] =
  { scope, task_id?, round, commit, failure_ids[] }` for quality-gate repair commits.

## 2. Plan artifacts — `.plan/<slug>/`

- `spec.md` — the raw spec when it didn't come from Linear.
- `plan.md` — human-readable plan.
- `manifest.json` — machine-readable plan. Schema: `references/manifest.schema.json`.
  Per task: `id` (slug), `title`, `file` (`tasks/<id>.md`), `depends_on`, `files` (globs the
  implement phase may stage), optional `qa: { command, description? }` — the scoped command
  the per-task quality-gate runs when `params.qa_scope` is `"scoped"` (omit it when no
  meaningful scoped command exists; the per-task gate then records `qa: "skipped"` and the
  full `state.qa.command` runs at cycle scope), and `acceptance_criteria[]` with
  `verification`: `{ type: "command", command }` or `{ type: "manual", instructions }`.
  Each criterion may set `scope: "task"` (default — verified right after the owning task's
  commit) or `scope: "cycle"` (integration-level criterion, verified only in the end-of-cycle
  `scope: "cycle"` audit; skipped in task scope). spec-audit executes the `command`
  verifications — make them concrete and runnable.
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
- One commit per task. Stage only the task's `files` globs. Never push (the `pr` phase owns pushing). No sign-off required.
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

### Verdict semantics (spec-audit, code-review)

Both phases use the SAME rule, and `verdict` stays a two-value enum (`pass` | `fail`):

- `verdict = "fail"` iff at least one finding has `status: "fail"` AND severity
  `blocker` or `major`. The verdict is computed per round within its scope: in
  `scope: "task"` only that task's findings count; `state.audit.verdict` always reflects the
  latest cycle-scope round.
- Findings with severity `minor` (spec-audit) or `minor`/`nit` (code-review) that fail are
  recorded in `findings` and surfaced in the phase summary as warnings — they do NOT set
  `verdict = "fail"`.
- Finding ids are stable across rounds and scope-prefixed: `T<task-id>-R<round>-F<sequence>`
  in task scope, `C-R<round>-F<sequence>` in cycle scope (e.g. `Tlogin-R1-F2`, `C-R2-F3`), so
  fix-mode implement spawns and later re-verification can reference them. Rounds > 1
  re-verify prior findings of the same (scope, task) (fixed / still failing) and report only
  new findings as new. code-review stays cycle-scope only: `R<round>-F<n>`.

## 6. Security / hygiene

- Validate slugs before path use; never interpolate untrusted text (issue titles, spec
  bodies) into shell commands or into `!` blocks of command templates.
- Only `driver/pr` pushes (PR phase); every other phase never pushes. Only
  `driver/implement` commits code, only `driver/write-history` commits `agent/` changes.
- Phases never spawn subagents (nesting depth is 1) — the driver owns all loops and fan-out.
- The `question` tool works in foreground children; the driver is interactive-only
  (headless `opencode run` is not supported).

## 7. Pull requests (pr phase)

- `driver/pr` (phase 8, default) is the ONLY agent allowed `git push`: it runs
  `git push -u origin <branch>` (never `--force`) and then opens or updates the PR with
  the `gh` CLI. If a PR for the head branch already exists, `gh pr edit` it (idempotent
  resume) — never create a duplicate. With `--draft` (`params.draft: true`) the PR is
  created via `gh pr create --draft` and `state.pr.draft` is set to true.
- Base branch: repo default via `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`,
  fallback `main`. Head = `state.branch`.
- Title: conventional-commit style, capped at 72 chars. Reuse the first task-commit
  subject if it already matches `<type>(<scope>): ...`; otherwise synthesize from the
  dominant commit type/scope + `state.spec.title` (fallback: the slug). Sanitize/validate
  before any shell use — never interpolate unvalidated text into a shell command.
- Body: follow the target repo's PR template when one exists (`.github/PULL_REQUEST_TEMPLATE.md`,
  `.github/PULL_REQUEST_TEMPLATE/*.md`, `docs/PULL_REQUEST_TEMPLATE.md`, root
  `PULL_REQUEST_TEMPLATE.md`); keep it SHORT and review-focused — Summary, How to review
  (riskiest files/commits first), How to verify (`state.qa.command` + audit/review
  verdicts), Risks & assumptions (from `plan.md`). Write it to `.plan/<slug>/pr-body.md`
  and pass via `--body-file`.
- Non-GitHub remote or unauthenticated `gh` → mark the phase `skipped`/`failed` with a
  clear summary; never push anywhere else.
- Record `state.pr = { number, url, base, head, title }` in `state.json`.
