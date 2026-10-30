# opencode-agents

A personal library of [OpenCode v2](https://opencode.ai/v2/docs/) agents, commands and skills.

Currently shipped: the **driver** — an orchestrated, multi-phase feature development cycle.

## The driver

`/driver` conducts an entire feature cycle. Each phase runs as its own subagent with a fresh
context window; phases coordinate through a state file, and the driver (primary agent) keeps
only short summaries — so no single context ever holds the whole cycle.

```
/driver ABC-123 [--phases preplan,plan,...]
   │
   ▼
┌─────────┐ ┌──────┐ ┌───────────────┐ ┌────────────┐ ┌─────────────┐ ┌──────────────┐ ┌───────────────┐
│ preplan │→│ plan │→│ implement ×N  │→│ spec-audit │→│ code-review │→│ quality-gate │→│ write-history │
└─────────┘ └──────┘ └───────────────┘ └────────────┘ └─────────────┘ └──────────────┘ └───────────────┘
```

| Phase | Agent ID | Standalone command | Does |
|---|---|---|---|
| preplan | `driver/preplan` | `/phases/preplan` | validates inputs (Linear issue / spec, git repo), asks if missing, writes `.plan/<ID>/state.json` |
| plan | `driver/plan` | `/phases/plan` | writes `.plan/<ID>/plan.md` + `manifest.json` + `tasks/*.md` |
| implement | `driver/implement` | `/phases/implement` | spawned once per plan task; one commit per task |
| spec-audit | `driver/spec-audit` | `/phases/spec-audit` | verifies acceptance criteria; report-only |
| code-review | `driver/code-review` | `/phases/code-review` | reviews the cycle's commits; report-only, prioritized |
| quality-gate | `driver/quality-gate` | `/phases/quality-gate` | runs the project's validation command |
| write-history | `driver/write-history` | `/phases/write-history` | appends `agent/<module>/history.md` + `decisions.md` |

The driver owns all loops and fan-out (implementation subtasks, audit/review repair rounds)
because subagent nesting depth defaults to 1. Audit/review stay read-only; the driver spawns
`driver/implement` again to apply fixes in bounded rounds.

## Install

```sh
./install.sh
```

Copies `agents/`, `commands/`, `skills/` into `~/.config/opencode/` (global, copy-based —
re-run after editing this repo). OpenCode reloads config automatically, no restart needed.

Prerequisites:

- A Linear MCP server configured globally (`opencode mcp list`) — preplan reads issues through it.
- In every repo you run the driver in, add `.plan/` to `.gitignore` (see `snippets/gitignore.txt`).
  `.plan/` is scratch and gitignored; `agent/` is committed.
- Pick a model + variant with `/models` before running — all driver agents inherit the session model.

## Usage

```text
/driver ABC-123                          # full cycle
/driver ABC-123 --phases plan,implement  # only some phases; state.json keeps progress, so this resumes
/phases/spec-audit ABC-123               # run a single phase standalone
```

Optional: OpenCode's built-in `/goal "<objective>"` (merged in anomalyco/opencode#59437) can wrap
a driver session — the driver is idempotent via `state.json`, so repeated goal rounds just resume
and eventually no-op. Note `/goal` is a TUI command and is not available in headless `opencode run`.

## Layout

```
agents/driver.md            # primary orchestrator agent (id: driver)
agents/driver/*.md          # phase subagents (ids: driver/preplan, driver/plan, ...)
commands/driver.md          # /driver entry point
commands/phases/*.md        # /phases/<phase> standalone wrappers (subagent: true)
skills/driver-conventions/  # shared contracts: state.json + manifest schemas, commit msg format, history format
snippets/                   # optional opencode.jsonc bits + .gitignore snippet for target repos
install.sh                  # global copy-based installer
```

## Contracts

All file formats exchanged between phases are defined in `skills/driver-conventions/SKILL.md`
(with JSON schemas in its `references/`). It is the single source of truth — every phase loads
the skill first.

## Extension points

- **New phase**: add `agents/driver/<phase>.md`, `commands/phases/<phase>.md`, and a row in the
  phase registry in `agents/driver.md`.
- **Variants of a sub-step**: add e.g. `agents/driver/plan-thorough.md` with the same output
  contract, plus a row in the driver's VARIANTS table; a future `--<phase>-variant <name>` flag
  selects it. Variants must keep the contract identical so later phases don't care which ran.
- **New driver flags**: parse them in the argument-parsing section of `agents/driver.md` and
  record them under `state.json` `params`.

## Gotchas (do not skip)

- There is no built-in cross-phase state: `.plan/<ID>/state.json` IS the handoff. Phases return
  short summaries to the driver; big artifacts live in files under `.plan/` and are referenced by path.
- Validate issue IDs (`^[A-Z][A-Z0-9]+-[0-9]+$`) before using them in any path — path traversal.
- Never interpolate arguments or spec text into `!` shell blocks in command templates — those run
  outside the permission flow. Use the `shell` tool with validated, quoted values instead.
- Subagent nesting depth is 1 by default (`experimental.subagent_depth` raises it) — hence driver-owned loops.
- The `question` tool needs an interactive client: the driver spawns phases in the foreground.
  In headless `opencode run`, preplan must fail fast on missing input instead of asking.
- Permissions are scoped to the `driver` / `driver/*` agents only — nothing global is touched.
  `git push` is denied everywhere; only `driver/implement` commits.
- Model availability is project-scoped (credentials don't carry across projects); phases
  deliberately set no `model` and inherit the session's.
