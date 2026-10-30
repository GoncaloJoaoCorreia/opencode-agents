# AGENTS.md — opencode-agents

Personal library of OpenCode v2 agents/commands/skills. Currently ships one thing: the
**driver** (`/driver`) — a multi-phase feature-cycle orchestrator. There is no build, test,
lint, or CI here; this repo is pure config/markdown plus `install.sh`.

## Install / verify

- `./install.sh` copies `agents/`, `commands/`, `skills/` into `~/.config/opencode/`.
  **Re-run it after every edit here** — OpenCode reloads config automatically, no restart.
- Install is **copy-based on purpose** (`cp -RL`): do NOT symlink these dirs into
  `~/.config/opencode/` or `.opencode/` — OpenCode's discovery skips symlinked agent files
  (e.g. the `agents/driver/plan-thorough.md` symlink placeholder won't register).
- Sanity check after changes: `opencode debug agents` should list `driver` and `driver/*`.

## Layout

```
agents/driver.md            # primary orchestrator (id: driver) — phase registry + VARIANTS table live here
agents/driver/*.md          # phase subagents (driver/preplan, driver/plan, driver/implement, ...)
commands/driver.md          # /driver entry point (static `!` shell blocks — see gotchas)
commands/phases/*.md        # standalone /phases/<phase> wrappers (subagent: true)
skills/driver-conventions/  # THE single source of truth for all shared contracts
snippets/                   # opencode.jsonc bits + .gitignore snippet (.plan/) for target repos
install.sh                  # global copy-based installer
```

## Contracts — one source of truth

All file formats (`.plan/<slug>/state.json`, `manifest.json`, commit messages, history
files, slug/branch/worktree policy) are defined in `skills/driver-conventions/SKILL.md`
with JSON schemas in `skills/driver-conventions/references/`. **If you change a format,
update the schemas too**, and keep README.md's summary in sync.

## Extension points

- **New phase**: add `agents/driver/<phase>.md`, `commands/phases/<phase>.md`, and a row
  in the phase registry in `agents/driver.md` (section 6).
- **New variant of a phase**: row in the VARIANTS table in `agents/driver.md`; replace the
  `plan-thorough.md` symlink with a real agent file (same output contract) when needed.
- **New `/driver` flag**: parse it in section 1 of `agents/driver.md`, store in `state.params`.

## Gotchas (hard-earned — do not rediscover)

- Slug regex is `^[A-Z][A-Z0-9]+-[0-9]+$`; validate before ANY path use; quote everything.
- Never interpolate untrusted text (issue titles, specs, `$ARGUMENTS`) into shell commands
  or into `!` blocks of command templates — `!` blocks run outside the permission flow.
  `commands/driver.md`'s `!` blocks are static on purpose.
- Agent permissions are scoped to `driver` / `driver/*` only; `git push` is denied
  everywhere. Only `driver/implement` commits code; only `driver/write-history` commits
  `agent/`. Subagent nesting depth is 1 by default → the driver owns all loops/fan-out;
  phases must not spawn subagents and must be spawned in the foreground (`question` tool
  needs an interactive client — headless `opencode run` is NOT supported by the driver).
- Phase agents deliberately set no `model:` — they inherit the session's model (user picks
  via `/models`).
- `.plan/` is scratch and gitignored in target repos; `agent/` is committed there.
