# opencode-agents

A personal library of [OpenCode v2](https://opencode.ai/v2/docs/) agents, commands and skills.

It currently ships one thing: the **driver** — `/driver` runs an entire feature cycle
(plan → implement → audit → review → QA → history) for you. Each phase runs as its own
subagent with a fresh context window, coordinated through a state file, so no single
conversation ever has to hold the whole cycle.

```
/driver ABC-123
   │
   ▼
 preplan → plan → implement ×N → spec-audit → code-review → quality-gate → write-history
```

## Quick start

```sh
curl -fsSL https://raw.githubusercontent.com/GoncaloJoaoCorreia/opencode-agents/main/install.sh | sh
```

The installer downloads the latest GitHub release payload (`opencode-agents.tar.gz`),
verifies it against the release's `SHA256SUMS`, and installs `agents/`, `commands/`,
`skills/` into `~/.config/opencode/` (or `$XDG_CONFIG_HOME/opencode`). OpenCode reloads
config automatically — no restart needed.

Working in a local checkout of this repo? Run `./install.sh` there instead — it detects the
checkout and installs straight from source (same copy-based install; nothing is built).
Re-run it after pulling changes.

### Install details

- **Latest release only.** Each install stamps `opencode-agents.version` and writes
  `opencode-agents.manifest` into the config dir; the manifest lets reinstalls remove files
  that were deleted upstream. Installs only ever touch `agents/`, `commands/`, `skills/`
  and those two meta files.
- **Copy-based on purpose** (OpenCode's discovery skips symlinked agent files) — don't
  symlink the directories yourself; see [AGENTS.md](AGENTS.md) for details.
- Releases are cut with the manual **Release** workflow on GitHub (semver tag
  auto-incremented from the latest, validated repo, checksummed assets attached).
- **The repo is currently private**, so the plain one-liner needs the repo to be public.
  While private, fetch the installer through the API with a token instead:

  ```sh
  curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github.raw" \
    https://api.github.com/repos/GoncaloJoaoCorreia/opencode-agents/contents/install.sh | sh
  ```

  (The installer then downloads the release payload via the GitHub API using the same
  token, or via `gh` if authenticated.)

Before your first run, in the repo you want to work on:

1. Configure the Linear MCP server in that repo's `opencode.jsonc` (the driver reads issues
   through it, read-only):

   ```jsonc
   { "mcp": { "linear-project": { "type": "remote", "url": "https://mcp.linear.app/mcp", "enabled": true } } }
   ```

2. Add `.plan/` to that repo's `.gitignore` (ready-made line in `snippets/gitignore.txt`).
3. Pick a model (and variant) with `/models` — all driver phases inherit your session model.

Then, from the repo root:

```text
/driver ABC-123        # full cycle for a Linear issue
```

## What a run does

| Phase | Run standalone | What happens |
|---|---|---|
| preplan | `/phases/preplan` | Fetches the Linear issue (or takes a pasted/file spec), picks the QA command, checks the repo setup, writes `.plan/<slug>/state.json` |
| plan | `/phases/plan` | Explores the code and writes `.plan/<slug>/plan.md` + `manifest.json` + `tasks/*.md` — you get asked to approve the plan before anything is built |
| implement | `/phases/implement` | One plan task per commit, in dependency order (`feat`/`fix`/… with module scope) |
| spec-audit | `/phases/spec-audit` | Verifies every acceptance criterion against the actual code/commits (runs the plan's verification commands) |
| code-review | `/phases/code-review` | Reviews the cycle's commits, findings prioritized blocker → nit |
| quality-gate | `/phases/quality-gate` | Runs the project's test/lint/build command and records the verdict |
| write-history | `/phases/write-history` | Appends `agent/<module>/history.md` + `decisions.md` and commits them |

Audit and review never edit code — when they find something, the driver sends `implement`
back with just those findings, in bounded repair rounds. If anything fails, the driver
asks you whether to retry, skip, or abort. Re-running `/driver` resumes from
`.plan/<slug>/state.json` instead of starting over.

Pre-flight: you must be in a git repo (the session moves to the repo root if needed); a
dirty working tree pauses the run; on `main`/`master`/`develop`/`dev` the driver creates a
`feat/<slug>` branch for you.

## Usage

```text
/driver ABC-123                                  # full cycle, fetches the Linear issue
/driver "add rate limiting to the API"           # raw spec — the driver asks for a slug (e.g. ABC-123)
/driver ABC-123 --phases plan,implement          # only some phases (progress is kept, so this resumes)
/driver ABC-123 --worktree                       # whole cycle inside a new git worktree named ABC-123
/driver ABC-123 --max-rounds 3 --qa "npm test"   # cap repair rounds, pin the QA command
/driver ABC-123 --force                          # re-run the requested phases even if already done
/driver ABC-123 --plan-variant thorough          # use a variant implementation of a phase
/phases/spec-audit ABC-123                       # run a single phase standalone
```

| Flag | Effect |
|---|---|
| `--phases a,b,...` | Run only these phases (default: all) |
| `--worktree` | Run the cycle in a new git worktree named after the slug |
| `--max-rounds N` | Max audit/review/qa repair rounds (default 2) |
| `--qa "cmd"` | QA command override (otherwise auto-detected and confirmed with you) |
| `--force` | Re-run the requested phases even if marked done |
| `--<phase>-variant <name>` | Swap in a variant implementation of a phase |

## What lands in your repo

- **`.plan/<slug>/`** — scratch, gitignored: `state.json` (cycle state), `spec.md`,
  `plan.md`, `manifest.json`, `tasks/*.md`, `qa.log`.
- **Commits** — one per plan task, conventional format with the module as scope
  (`feat(auth): ...`) plus `Driver-Task:` / `Refs:` trailers. The driver never pushes.
- **`agent/<module>/history.md` and `decisions.md`** — committed by the final phase as a
  `docs(driver): ...` commit. Module = first path segment of the changed files under
  `src/` (else first segment, else `core`).
- **Branch** — `feat/<slug>`, created automatically on protected branches.

## Requirements & limitations

- **Interactive TUI only.** The driver asks questions along the way (slug, plan approval,
  QA command, retries), so headless `opencode run` is not supported.
- **Linear is used read-only** (`get_issue`, `list_comments`, …); the driver never comments
  on or updates issues.
- All phases inherit your session's model/variant (`/models`).
- Optional: OpenCode's built-in `/goal "<objective>"` can wrap a driver session — the
  driver is idempotent via `state.json`, so repeated goal rounds just resume. (`/goal` is a
  TUI command and isn't available in headless `opencode run`.)

## Hacking on this library

The repo layout, file-format contracts (`.plan/<slug>/state.json`, `manifest.json`, commit
and history formats — single source of truth in `skills/driver-conventions/SKILL.md` with
JSON schemas beside it), extension points, and hard-won gotchas are documented in
[AGENTS.md](AGENTS.md).
