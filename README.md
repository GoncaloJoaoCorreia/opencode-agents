# opencode-agents

A personal library of [OpenCode v2](https://opencode.ai/v2/docs/) agents, commands and skills.

Currently shipped: the **driver** — an orchestrated, multi-phase feature development cycle.

## The driver

`/driver` conducts an entire feature cycle. Each phase runs as its own subagent with a fresh
context window; phases coordinate through a state file, and the driver (primary agent) keeps
only short summaries — so no single context ever holds the whole cycle.

```
/driver ABC-123 [--phases preplan,plan,...] [--worktree]
   │
   ▼
┌─────────┐ ┌──────┐ ┌───────────────┐ ┌────────────┐ ┌─────────────┐ ┌──────────────┐ ┌───────────────┐
│ preplan │→│ plan │→│ implement ×N  │→│ spec-audit │→│ code-review │→│ quality-gate │→│ write-history │
└─────────┘ └──────┘ └───────────────┘ └────────────┘ └─────────────┘ └──────────────┘ └───────────────┘
```

| Phase | Agent ID | Standalone command | Does |
|---|---|---|---|
| preplan | `driver/preplan` | `/phases/preplan` | fills spec (Linear issue via `linear-project` MCP, or prompt/file → `.plan/<slug>/spec.md`), detects+confirms QA command, warns if `.plan/` not gitignored, writes state |
| plan | `driver/plan` | `/phases/plan` | writes `.plan/<slug>/plan.md` + `manifest.json` + `tasks/*.md` with verifiable acceptance criteria |
| implement | `driver/implement` | `/phases/implement` | spawned once per plan task by the driver; one conventional commit per task |
| spec-audit | `driver/spec-audit` | `/phases/spec-audit` | verifies acceptance criteria (runs `verification.command`s); report-only |
| code-review | `driver/code-review` | `/phases/code-review` | reviews the cycle's commits, severity-prioritized; report-only |
| quality-gate | `driver/quality-gate` | `/phases/quality-gate` | runs `state.qa.command`, records verdict + failures |
| write-history | `driver/write-history` | `/phases/write-history` | appends `agent/<module>/{history,decisions}.md` and commits them (`docs(driver): ...`) |

The driver owns all loops and fan-out (subtask implementations, audit/review repair rounds)
because subagent nesting depth defaults to 1. Audit/review stay read-only; the driver spawns
`driver/implement` again to apply fixes in bounded rounds.

## Install

```sh
./install.sh
```

Copies `agents/`, `commands/`, `skills/` into `~/.config/opencode/` (global, copy-based —
re-run after editing this repo). OpenCode reloads config automatically, no restart needed.
Note: `cp -RL` dereferences symlinks on purpose — the `plan-thorough` variant placeholder is
a symlink in this repo, and OpenCode's discovery does not follow symlinked agent *files*
(verified: `opencode debug agents` skips them). So install through this script; don't
symlink `.opencode/` into a project directly or the variant won't register.

Prerequisites:

- Linear MCP server configured (e.g. in the target repo's `opencode.jsonc`):
  `"mcp": { "linear-project": { "type": "remote", "url": "https://mcp.linear.app/mcp", "enabled": true } }`
  — the driver uses it read-only (`get_issue`, `list_comments`, …).
- In every repo you run the driver in, add `.plan/` to `.gitignore` (see `snippets/gitignore.txt`).
  `.plan/` is scratch and gitignored; `agent/` is committed.
- Pick a model + variant with `/models` before running — all driver agents inherit the session model.

## Usage

```text
/driver ABC-123                            # full cycle, fetches the Linear issue
/driver "add rate limiting to the API"     # raw spec — driver asks for a slug (e.g. ABC-123)
/driver ABC-123 --phases plan,implement    # only some phases; state.json keeps progress, so this resumes
/driver ABC-123 --worktree                 # whole cycle inside a new git worktree named ABC-123
/driver ABC-123 --max-rounds 3 --qa "npm test" --force   # cap repair rounds, pin QA cmd, re-run done phases
/driver ABC-123 --plan-variant thorough    # variant implementation of a phase (once the agent exists)
/phases/spec-audit ABC-123                 # run a single phase standalone
```

Flags (parsed by the driver into `state.params`; on resume, new flags win): `--phases`,
`--worktree`, `--max-rounds N` (default 2), `--qa "cmd"`, `--force` (re-runs all requested
phases), `--<phase>-variant <name>` (resolved via the VARIANTS table).

Limitation: the driver needs an interactive client (it and preplan use the `question` tool);
headless `opencode run` is not supported.

Driver pre-flight: must run from a git repo (session moves to repo root if needed); dirty tree
→ asks (default abort); on `main`/`master`/`develop`/`dev` it creates `feat/<slug>`.

Optional: OpenCode's built-in `/goal "<objective>"` (merged in anomalyco/opencode#59437) can wrap
a driver session — the driver is idempotent via `state.json`, so repeated goal rounds just resume
and eventually no-op. Note `/goal` is a TUI command and is not available in headless `opencode run`.

## Layout

```
agents/driver.md            # primary orchestrator agent (id: driver)
agents/driver/*.md          # phase subagents (ids: driver/preplan, driver/plan, ...)
commands/driver.md          # /driver entry point
commands/phases/*.md        # /phases/<phase> standalone wrappers (subagent: true)
skills/driver-conventions/  # shared contracts: state.json + manifest schemas, commit msg format, history format, run policy
snippets/                   # optional opencode.jsonc bits + .gitignore snippet for target repos
install.sh                  # global copy-based installer
```

## Contracts & decisions (locked in)

All file formats and policies live in `skills/driver-conventions/SKILL.md` — single source of
truth, loaded first by every phase. Highlights:

- Slug = `issue_id`, pattern `^[A-Z][A-Z0-9]+-[0-9]+$`, validated before any path use.
- Commits: conventional, scope (module) required, types `feat|fix|chore|docs|refactor|test|perf|ci|build`,
  trailers `Driver-Task:` + `Refs:`. One commit per task; only `implement` commits code,
  only `write-history` commits `agent/` (`docs(driver): ...`). Never push.
- Module for history files = first path segment of changed files under `src/`, else first segment, else `core`.
- QA command: preplan auto-detects (package.json scripts / Makefile / CI workflow) and confirms via `question`.
- Linear MCP: read-only; write tools denied in the phase agents' permissions.
- Interactive-only: headless `opencode run` is not supported (the driver relies on the
  `question` tool).

## Extension points

- **New phase**: add `agents/driver/<phase>.md`, `commands/phases/<phase>.md`, and a row in the
  phase registry in `agents/driver.md`.
- **Variants of a sub-step**: a row in the driver's VARIANTS table maps a
  `--<phase>-variant <name>` flag to an agent ID. `plan-thorough` is currently a symlink to
  `plan.md` — a placeholder showing the mechanism; replace it with a real agent file (same
  output contract) when an actual variant is needed.
- **New driver flags**: parse them in section 1 of `agents/driver.md` and record in `state.params`.

## Gotchas (do not skip)

- No built-in cross-phase state: `.plan/<slug>/state.json` IS the handoff. Phases return short
  summaries; big artifacts live in files under `.plan/` referenced by path.
- Subagent nesting depth is 1 by default (`experimental.subagent_depth` raises it) — hence driver-owned loops.
- The `question` tool needs an interactive client: phases are spawned in the foreground.
- Permissions are scoped to `driver` / `driver/*` agents only — nothing global is touched.
  `git push` is denied everywhere.
- Model availability is project-scoped; phases deliberately set no `model` and inherit the session's.
- `!` shell blocks in command templates run outside the permission flow — they are static in
  `commands/driver.md` on purpose; never add `$ARGUMENTS` to one.
