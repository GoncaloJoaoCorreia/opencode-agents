# AGENTS.md — opencode-agents

Personal library of OpenCode v2 agents/commands/skills. Currently ships one thing: the
**driver** (`/driver`) — a multi-phase feature-cycle orchestrator. There is no build, test,
lint, or CI here; this repo is pure config/markdown plus `install.sh`.

## Install / verify

- `./install.sh` is dual-mode and auto-detects: inside this checkout (`.git/` + `agents/`
  next to the script) it installs by **copying from source** — nothing is built. Run
  standalone (e.g. `curl …/install.sh | sh`, where `$0` is not a file) it downloads the
  latest GitHub release payload and installs from that. Flags: `--source` / `--release`
  force a mode, `--dest DIR` overrides the target (default
  `${XDG_CONFIG_HOME:-~/.config}/opencode`). **Re-run `./install.sh` after every edit
  here** — OpenCode reloads config automatically, no restart.
- **Release assets convention:** each GitHub release carries exactly `opencode-agents.tar.gz`
  (one top-level `opencode-agents/` dir with `agents/ commands/ skills/ snippets/
  install.sh LICENSE`) and `SHA256SUMS` (sha256sum format). The installer fetches them
  unauthenticated from `releases/latest/download/` (the repo is public). **Releases are cut
  by the Release workflow (see Releases below), which builds and uploads these assets** —
  don't hand-upload them; v0.1 was seeded manually before the workflow existed.
- Each install writes `opencode-agents.version` + `opencode-agents.manifest` into the
  config dir; the manifest drives stale-file cleanup on reinstall. Installs only touch
  `agents/ commands/ skills/` + those two meta files.
- Install is **copy-based on purpose** (`cp -RL`): do NOT symlink these dirs into
  `~/.config/opencode/` or `.opencode/` — OpenCode's discovery skips symlinked agent files
  (e.g. the `agents/driver/plan-thorough.md` symlink placeholder won't register).
- Sanity check after changes: `opencode debug agents` should list `driver` and `driver/*`
  (after installing; smoke-test with a throwaway `XDG_CONFIG_HOME` first).

## Layout

```
agents/driver.md            # primary orchestrator (id: driver) — phase registry + VARIANTS table live here
agents/driver/*.md          # phase subagents (driver/preplan, driver/plan, driver/implement, ...)
commands/driver.md          # /driver entry point (static `!` shell blocks — see gotchas)
commands/phases/*.md        # standalone /phases/<phase> wrappers (subagent: true)
skills/driver-conventions/  # THE single source of truth for all shared contracts
snippets/                   # opencode.jsonc bits + .gitignore snippet (.plan/) for target repos
scripts/validate.sh         # pre-release validation (frontmatter, schemas, cross-refs) — CI + local
.github/workflows/release.yml  # manual release pipeline (see Releases)
install.sh                  # dual-mode installer (source checkout vs checksum-verified release)
```

## Releases

- Cut a release with the manual **Release** workflow (`.github/workflows/release.yml`,
  "Run workflow" button on `main`). Optional `version` input (`vX.Y.Z` or `X.Y.Z`; must be
  new and greater than the latest tag); empty = auto patch-bump of the latest `v*` tag
  (`v0.1` normalizes to `v0.1.0` → next `v0.1.1`; no tags → `v0.1.0`).
- The workflow: runs `scripts/validate.sh` → tags + pushes `main` → builds
  `opencode-agents.tar.gz` + `SHA256SUMS` (the asset convention install.sh expects) →
  creates the GitHub release with an auto changelog → self-tests (download, checksum,
  diff vs checkout, `install.sh --release` into a temp dir).
- Run `./scripts/validate.sh` locally before pushing release-relevant changes.
- The workflow operates on remote `main` — commit + push first, or the release ships
  stale content.

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
  everywhere EXCEPT `driver/pr` (the PR phase owns pushing). Only `driver/implement`
  commits code; only `driver/write-history` commits `agent/`. Subagent nesting depth is 1 by default → the driver owns all loops/fan-out;
  phases must not spawn subagents and must be spawned in the foreground (`question` tool
  needs an interactive client — headless `opencode run` is NOT supported by the driver).
- Shell is permissive by default in all driver agents (`shell *: allow`, no prompts).
  Safety comes from the `deny` rules (push outside `driver/pr`, subagent spawning, edit
  scopes, Linear writes) plus agent discipline — still never interpolate untrusted text
  into shell commands.
- Phase agents deliberately set no `model:` — they inherit the session's model (user picks
  via `/models`).
- `.plan/` is scratch and gitignored in target repos; `agent/` is committed there.
