# AGENTS.md — opencode-agents

Personal library of OpenCode v2 agents/commands/skills plus one TUI plugin. Ships the
**driver** (`/driver`) — a multi-phase feature-cycle orchestrator — and **driver-viz**, a
TUI-only plugin that renders the live phase flow chart of the current driver run in the
sidebar. There is no build or lint here; this repo is pure config/markdown plus
`install.sh`. Tests + validation run in CI on every PR (`.github/workflows/test.yml`:
`scripts/validate.sh` for agent declarations + `scripts/validate-driver-viz.sh` for the
plugin, both including the agent-scripts unit suite).

## Install / verify

- `./install.sh` is dual-mode and auto-detects: inside this checkout (`.git/` + `agents/`
  next to the script) it installs by **copying from source** — nothing is built. Run
  standalone (e.g. `curl …/install.sh | sh`, where `$0` is not a file) it downloads the
  latest GitHub release payload and installs from that. Flags: `--source` / `--release`
  force a mode, `--dest DIR` overrides the target (default
  `${XDG_CONFIG_HOME:-~/.config}/opencode`), `--no-plugin` skips the driver-viz plugin
  (and removes a previously installed copy via manifest cleanup). **Re-run `./install.sh`
  after every edit here** — OpenCode reloads config automatically, no restart.
- **Prerequisite check:** `install.sh` hard-fails before installing (and before downloading
  in `--release` mode) when `python3` cannot execute or `git` is missing — the shipped
  `agent-scripts/` need both. Optional tools (a forge CLI `gh`/`glab`/`forgejo-cli`,
  `shellcheck`) only produce a warning when absent.
- **Release assets convention:** each GitHub release carries exactly `opencode-agents.tar.gz`
  (one top-level `opencode-agents/` dir with `agents/ commands/ skills/ snippets/
  agent-scripts/ plugins/ install.sh LICENSE`) and `SHA256SUMS` (sha256sum format). The installer fetches them
  unauthenticated from `releases/latest/download/` (the repo is public). **Releases are cut
  by the Release workflow (see Releases below), which builds and uploads these assets** —
  don't hand-upload them; v0.1 was seeded manually before the workflow existed.
- Each install writes `opencode-agents.version` + `opencode-agents.manifest` into the
  config dir; the manifest drives stale-file cleanup on reinstall. Installs only touch
  `agents/ commands/ skills/ agent-scripts/ plugins/` (plugins/ only without
  `--no-plugin`) + those two meta files.
- **`.agent/` and `__pycache__/` inside the payload dirs are excluded** from the release
  tarball and the install (manifest list + `rm -rf` after the copy). This repo is itself a
  driver target, so it has `agents/.agent/`, `skills/.agent/`, … — OpenCode discovers
  `agents/**/*.md` recursively, so an installed `agents/.agent/*.md` would register as
  agents (`.agent/history`, `.agent/decisions`). `scripts/validate.sh` regression-tests
  the exclusion by running `install.sh --source` into a temp dir; release.yml's self-test
  asserts it on the downloaded payload. Re-running `./install.sh` also cleans previously
  installed copies via the manifest stale-file loop.
- Install is **copy-based on purpose** (`cp -RL`): do NOT symlink these dirs into
  `~/.config/opencode/` or `.opencode/` — OpenCode's discovery skips symlinked agent files
  (e.g. the `agents/driver/plan-thorough.md` symlink placeholder won't register).
- The plugin lands in `<config>/plugins/driver-viz/` where OpenCode **auto-discovers** it
  (no `cli.json` edit needed). It is TUI-only: `package.json` maps `exports["./tui"]` to
  `tui.tsx`; `@opencode/plugin/tui`, `@opentui/*` and `solid-js` are resolved by the host at
  runtime, so there is no build step and no `node_modules` to install.
- Sanity check after changes: `opencode debug agents` should list `driver` and `driver/*`
  (after installing; smoke-test with a throwaway `XDG_CONFIG_HOME` first).

## Layout

```
agents/driver.md            # primary orchestrator (id: driver) — phase registry + VARIANTS table live here
agents/driver/*.md          # phase subagents (driver/preplan, driver/plan, driver/implement, ...)
commands/driver.md          # /driver entry point (static `!` shell blocks — see gotchas)
commands/phases/*.md        # standalone /phases/<phase> wrappers (subagent: true)
skills/driver-conventions/  # THE single source of truth for all shared contracts
agent-scripts/              # shipped helper scripts the driver agents call from <config>/agent-scripts/
                            #   (detect-forge.sh = forge detection, detect-modules.py = module detection,
                            #    driver-state.py = atomic state.json access, save-linear-attachments.py =
                            #    eager Linear attachment download (G-23), qa-command.sh = repo-local
                            #    QA-command cache driver.qa (G-24), agent-context-check.py = .agent
                            #    context-length check over history/decisions.md (G-31);
                            #    tests in agent-scripts/tests/, gated by scripts/validate.sh)
snippets/                   # opencode.jsonc bits + .gitignore snippet (.plan/) for target repos
docs/                       # repo-only docs (NOT in the release payload): driver-viz-sidebar.png = the README screenshot
plugins/driver-viz/         # TUI-only plugin: animated sidebar flow chart of the current run
  tui.tsx                   #   entrypoint (Plugin.define, sidebar.content slot, keymap, fs watch)
  lib/phases.ts             #   phase registry mirror of agents/driver.md §6 (validate-driver-viz.sh enforces sync)
  lib/state.ts              #   .plan/<slug>/state.json scanning + pure derivations (unit-tested)
  lib/theme.ts              #   defensive theme-token resolution with fallbacks
  lib/FlowChart.tsx         #   the stepper component (spinner + pulsing connector)
  test/state.test.ts        #   node --test (node >= 22.18 strips types; no build)
scripts/validate.sh         # pre-release validation of agent/command/skill declarations — CI + local
scripts/validate-driver-viz.sh  # driver-viz plugin checks + node --test + render snapshots — CI + local
scripts/driver-viz-render-test/  # headless bun render/snapshot tests for the plugin (kept out of
                                  # plugins/ so the release payload never ships its node_modules)
scripts/screenshot-driver-viz.py  # regenerates docs/driver-viz-sidebar.png (kept out of plugins/ so the
                                  # release payload never ships it — see "driver-viz plugin" below)
.github/workflows/release.yml  # manual release pipeline (see Releases)
install.sh                  # dual-mode installer (source checkout vs checksum-verified release)
```

## driver-viz plugin

Reads `.plan/<slug>/state.json` at the repo root of the session's location (so `--worktree`
runs show up — the driver moves the session into the worktree) via `fs.watch` + a 1s poll,
and renders the 8-phase stepper in `sidebar.content`: `✓/✗/⊘/○` for done/failed/skipped/
pending, a braille spinner + pulsing connector on the running phase, per-task dots under
implement, PR link in the header. Session-scoped: only runs whose `state.session_id`
matches the current session's ID (sidebar.content slot input `sessionID`, fallback
`ui.router.current()`) are shown, a newly started run of this session is switched to
immediately, and `/driver-viz` (palette "Driver: show next run") cycles only this
session's runs; when no run matches (e.g. all runs have `session_id: null` from an older
driver) the most recent run is shown. Hidden when the repo has no `.plan/`.
The sidebar also shows an elapsed-time counter (`⏱`, from the earliest
`phases.*.started_at`) in the header while a phase is running, a clickable `[Open Plan]`
on the Plan row once the plan phase is done (plus the palette command "Driver: open
plan") that opens `.plan/<slug>/plan.md` with the system default app (`open`/`xdg-open`
via `node:child_process`, errors to a toast), and a completion block below the task
graph once every phase is done/skipped: total time, best-effort token count from the
session record, `+A -D` lines changed (`git diff --numstat` merge-base..HEAD, omitted on
git failure), and a clickable `[Open report]` when `.plan/<slug>/report.md` exists
(written by the driver at cycle end, driver §7; palette fallback "Driver: open report").
At most one phase renders as running (`effectiveStatuses` in `lib/state.ts` — later
running phases show pending, so Audit is only in progress for run-scoped audit runs),
the spinner/connector use a guaranteed non-white `spinner` tint (`lib/theme.ts`), and
the Implement subtask dots are colored per task state with an animated in-progress dot
(`taskIndicators`).
Option `animate: false` (cli.json plugins object form) disables animation. Slug dirs are
validated against `^[A-Z][A-Z0-9]*-[0-9]+$` before any path use; unreadable state.json renders
as "unreadable" instead of crashing. Theme colors resolve defensively (custom themes may
omit tokens). Change a phase name/order in `agents/driver.md` §6 → update
`plugins/driver-viz/lib/phases.ts` — `scripts/validate-driver-viz.sh` fails otherwise.
README screenshot: `docs/driver-viz-sidebar.png` (embedded in README.md). Regenerate after
layout changes with `python3 scripts/screenshot-driver-viz.py` — needs `pillow` and a
JetBrains Mono Nerd Font installed (glyph coverage for the braille spinner). The generator
lives in top-level `scripts/`, not under `plugins/`, so it is never shipped in the release
payload or installed into the config dir.

### driver-viz render snapshot tests

`scripts/driver-viz-render-test/` renders the real `plugins/driver-viz/lib/FlowChart.tsx`
headlessly and snapshots the frame: it runs under **bun** (OpenTUI's native render lib only
loads under bun, not node), transforms the plugin's `.tsx` with the same
`@opentui/solid/bun-plugin` OpenCode uses (see `preload.ts`), mounts `DriverSection` with
`testRender` from `@opentui/solid`, freezes `Date.now`, uses fixed run fixtures in the OS
temp dir (outside any git repo, so the `+A/-D` line deterministically omits), and compares
`captureSpans()` (styled frame: text + fg/bg/attributes, serialized as
`<fg=..;bg=..;attrs>text</>`) against committed `snapshots/*.snap` — so snapshots cover the
entire render including styling. `PREVIEW=1 bun run test` prints the scenarios as ANSI to
the terminal to eyeball styling changes. A render throw fails the
scenario — this harness is what caught the nested-`<text>` crash
("TextNodeRenderable only accepts strings…"). `scripts/validate-driver-viz.sh` runs it when
`bun` is on PATH (CI: `test.yml` installs bun via `setup-bun`; without bun the section
skips). The harness lives in top-level `scripts/` so the release payload and the installed
config dir never get its `node_modules` (only `bun.lock` is committed, deps are pinned).

**Regenerating snapshots — only after an INTENTIONAL UI change** (glyphs, layout, labels,
status rendering in `FlowChart.tsx` / `tui.tsx`):

```
cd scripts/driver-viz-render-test
UPDATE_SNAPSHOTS=1 bun run test    # writes snapshots/*.snap
```

Then `git diff snapshots/` and review every changed line before committing. Never
regenerate to silence a crash or an unexpected diff — fix the code (or the structural
guard in `validate-driver-viz.sh`) instead. Note the snapshots exercise the pinned npm
`@opentui/*` version, which proxies — but does not exactly match — the version embedded in
the OpenCode binary.

## Releases

- Cut a release with the manual **Release** workflow (`.github/workflows/release.yml`,
  "Run workflow" button on `main`). Optional `version` input (`vX.Y.Z` or `X.Y.Z`; must be
  new and greater than the latest tag); empty = auto patch-bump of the latest `v*` tag
  (`v0.1` normalizes to `v0.1.0` → next `v0.1.1`; no tags → `v0.1.0`).
- The workflow: runs `scripts/validate.sh` (agent declarations) + `scripts/validate-driver-viz.sh`
  (plugin) → tags + pushes `main` → builds
  `opencode-agents.tar.gz` + `SHA256SUMS` (the asset convention install.sh expects) →
  creates the GitHub release with an auto changelog → self-tests (download, checksum,
  diff vs checkout, `install.sh --release` into a temp dir).
- Run `./scripts/validate.sh` and `./scripts/validate-driver-viz.sh` locally before pushing
  release-relevant changes.
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
- **New forge support** (pr phase): extend the detection + cache contract and the per-forge
  command table in `skills/driver-conventions/SKILL.md` §7, the dispatch in
  `agents/driver/pr.md`, the detection step in `agents/driver/preplan.md`, and
  `state.remote` / `params.forge` / `state.pr.forge` in
  `skills/driver-conventions/references/state.schema.json`. The detected forge is cached
  repo-locally in `git config driver.forge` (never committed).
- **New agent-script**: add it under `agent-scripts/` with unit tests in
  `agent-scripts/tests/` (wired into `run-tests.sh`), and mirror it in `install.sh`
  (payload dirs + manifest + stale-cleanup case), `scripts/validate.sh` (asset list +
  syntax/tests section), `.github/workflows/release.yml` (payload `cp` + self-test
  `diff`), plus README/AGENTS.md and an invocation/exit-code entry in
  `skills/driver-conventions/SKILL.md` §8.

## Gotchas (hard-earned — do not rediscover)

- Slug regex is `^[A-Z][A-Z0-9]*-[0-9]+$`; validate before ANY path use; quote everything.
- Never interpolate untrusted text (issue titles, specs, `$ARGUMENTS`) into shell commands
  or into `!` blocks of command templates — `!` blocks run outside the permission flow.
  `commands/driver.md`'s `!` blocks are static on purpose.
- Agent permissions are scoped to `driver` / `driver/*` only; `git push` is denied
  everywhere EXCEPT `driver/pr` (the PR phase owns pushing). Only `driver/implement`
  commits code; only `driver/write-history` commits `.agent/`. Subagent nesting depth is 1 by default → the driver owns all loops/fan-out;
  phases must not spawn subagents and must be spawned in the foreground (`question` tool
  needs an interactive client — headless `opencode run` is NOT supported by the driver).
- Shell is permissive by default in all driver agents (`shell *: allow`, no prompts).
  Safety comes from the `deny` rules (push outside `driver/pr`, subagent spawning, edit
  scopes, Linear writes) plus agent discipline — still never interpolate untrusted text
  into shell commands.
- Phase agents deliberately set no `model:` — they inherit the session's model (user picks
  via `/models`).
- `.plan/` is scratch and gitignored in target repos; `.agent/` (per-module history/decisions) is committed there.
- Don't re-implement routine, scriptable logic inside agent prompts (inline shell/python
  in `agents/*.md`). If a phase needs mechanical, repeated work — git/forge probing, JSON
  merges of `state.json`, looping over files, parsing command output — put it in a
  shipped, unit-tested `agent-scripts/` script and call that from the prompt instead.
  Precedent: `detect-forge.sh` + `driver-state.py` (G-20 / PR #1), `detect-modules.py`
  (G-22); the mechanism and the
  mandate live in `skills/driver-conventions/SKILL.md` §8. Inline logic in a prompt is
  only for one-off, phase-specific steps.
