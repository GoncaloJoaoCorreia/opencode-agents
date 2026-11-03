---
name: Driver Conventions
description: "Contracts shared by all driver phases (the `driver` orchestrator and `driver/*` subagents, /driver and /phases/* commands) — state.json schema, plan manifest schema, commit message format, history/decisions file format, slug/branch/worktree policy, Linear usage, installed agent scripts (detect-forge.sh, detect-modules.py, driver-state.py — §8), forge detection (gh/glab/forgejo-cli) + PR/MR conventions, phase-summary contract. Load this FIRST in every driver phase."
---

# Driver conventions

Every driver phase loads this skill first. Single source of truth for the files phases
exchange. If you change a format here, update the schemas in `references/` too.

## 0. Run policy (driver pre-flight)

- Run `/driver` from the repo root (the driver moves its session there if needed —
  permission rules like `.plan/**` are Location-relative).
- Slug (= `issue_id`) always matches `^[A-Z][A-Z0-9]*-[0-9]+$`. From a Linear key it is the
  key itself; for a raw spec the driver asks the user for one. **Validate before any path use.**
- Plan dir is `.plan/<slug>/` at the repo root; `.plan/` is gitignored in the target repo.
- Dirty tree at start → the driver asks (default: abort).
- Branch: on `main`/`master`/`develop`/`dev` the driver creates `feat/<slug>`.
- Final phase `pr` (phase 8, in the default phase list) pushes the cycle branch and
  opens/updates a PR/MR via the forge CLI (`gh` for GitHub, `glab` for GitLab,
  `forgejo-cli` for Forgejo) against the repo's default branch (fallback `main`) —
  see §7. It is the ONLY phase allowed to push.
- `--worktree`: the driver creates a git worktree named `<slug>` and moves its session into
  it before spawning any phase.
- Linear: MCP server `linear-project` (https://mcp.linear.app/mcp), READ-ONLY:
  `get_issue` / `list_comments` etc. may be called without prompting; all
  create/update/save/delete tools are hard-denied.
- Flags: `--phases`, `--skip`, `--worktree`, `--max-rounds N`, `--qa "cmd"`,
  `--qa-scope scoped|full`, `--force`, `--draft`, `--forge auto|github|gitlab|forgejo`,
  `--<phase>-variant <name>` — parsed by the driver into `state.params`; on resume, newly
  passed flags win. `--force` re-runs all requested phases even if `done`. `--draft` opens
  the PR/MR as a draft (pr phase only). `--forge` overrides forge detection for the pr
  phase; a concrete value is persisted to `git config driver.forge` (§7.1).
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

- Never delete information — append/merge (every update goes through the installed
  `driver-state.py` — see §8). Re-runs resume from this file.
- Summaries are SHORT (a few lines). Big content lives in files under `.plan/<slug>/`
  (`spec.md`, `plan.md`, `manifest.json`, `tasks/*.md`, `qa.log`,
  `audit-round-<n>.md`), referenced by path — never inline evidence or log tails beyond a
  short excerpt.
- `phases.<name> = { status: pending|running|done|failed|skipped, summary, started_at, completed_at }`.
  `skipped` is set by `--skip` (`params.skip[]`) or by preplan's "skip quality-gate" choice.
  This is ONE aggregate entry per phase. Per-spawn records go elsewhere:
  `implement.runs[] = { mode: task|fix, task_id?, round?, commit, summary?, at }`.
- `remote = { url, host, forge: github|gitlab|forgejo|unknown, cli: gh|glab|fj|null, source: flag|cache|probe }`
  — filled by preplan (origin remote + detected forge); the pr phase uses it to pick the
  forge CLI. The forge is cached repo-locally in `git config driver.forge` (§7.1).
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
  staging only `.agent/...` paths.

## 4. History & decisions (write-history phase; committed in the target repo)

- `<module-dir>/.agent/history.md` — append-only. Entry template:

  ```md
  ## 2026-10-30 — ABC-123 — Short title
  - What changed: ...
  - Commits: `abc1234`, `def5678`
  - Plan: `.plan/ABC-123/plan.md`
  ```

- `<module-dir>/.agent/decisions.md` — append-only, only for real decisions:

  ```md
  ## 2026-10-30 — ABC-123 — Chose X over Y
  - Context: ...
  - Options considered: ...
  - Decision: ...
  - Rationale: ...
  - Consequences: ...
  ```

- Repo-root-level changes (commits whose changed files are all at the repo root) go to
  the repo-root `.agent/history.md` / `.agent/decisions.md`.
- Module mapping (G-22): run the INSTALLED `agent-scripts/detect-modules.py` (§8) —
  `detect-modules.py --repo <repoRoot> map <changed-files...>` prints one JSON object
  mapping each file to its module dir; the LONGEST module dir that is a path-segment
  prefix of the file wins (files nested inside a module belong to that module), and
  files at the repo root or under no module map to `"."` (root `.agent/`). The script
  detects module dirs from the repo's build system, first match wins: Gradle
  (`settings.gradle(.kts)` includes) → Maven (root `pom.xml` `<modules>`) → npm-family
  (root `package.json` workspaces / `pnpm-workspace.yaml`) → Cargo (`Cargo.toml`
  `[workspace]` members); fallback when none matches: the repo's top-level directories
  (one level deep), plus the directories under a root `src/` when one exists (one
  extra level, never deeper). This script-driven detection REPLACES the old
  "first path segment of the changed files under `src/`, else the first segment, else
  `core`" rule.
- One history entry per module per cycle (group the cycle's commits), not one per commit.
- Legacy root-level `agent/` history folders in target repos (from older cycles) are
  left untouched — append-only there too, no migration.

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
  `driver/implement` commits code, only `driver/write-history` commits `.agent/` changes.
- Phases never spawn subagents (nesting depth is 1) — the driver owns all loops and fan-out.
- The `question` tool works in foreground children; the driver is interactive-only
  (headless `opencode run` is not supported).

## 7. Forge detection & pull requests (pr phase)

### 7.1 Forge detection + cache (preplan fills `state.remote`)

- `state.remote = { url, host, forge, cli, source }` — `url` = `git remote get-url origin`,
  `host` parsed from the https/ssh remote URL, `forge` = `github|gitlab|forgejo|unknown`,
  `cli` = `gh|glab|fj|null` (`fj` = forgejo-cli, whichever binary name exists),
  `source` = `flag|cache|probe`.
- Precedence in preplan (first match wins): `--forge <concrete>` (`params.forge`,
  `source: "flag"`, persisted via `git config driver.forge <forge>`) → cached
  `git config --get driver.forge` (`source: "cache"`, no probing, no CLI auth needed) →
  probe (`source: "probe"`).
- Probe: known SaaS hosts map directly (`github.com` → github, `gitlab.com` → gitlab,
  `codeberg.org` → forgejo). Custom hosts are probed in order glab → forgejo-cli → gh:
  `<cli> auth status` && `<cli> api user`; the first CLI that is installed, authenticated
  and answers identifies the forge (a probe against the wrong forge fails fast). Success
  is persisted to `git config driver.forge`; failure is NOT cached (`forge: "unknown"` +
  warning), so authenticating the right CLI later fixes the next run without `--forge`.
  `--forge auto` = ignore the cache, re-probe, overwrite it.
- The cache lives in repo-local git config: never committed, shared across linked
  worktrees by default (unless the repo sets `extensions.worktreeConfig` — then `--forge`
  is the reliable override). Manual override/clear: `git config driver.forge <forge>` /
  `git config --unset driver.forge`.
- The pr phase re-derives the forge when `state.remote` is missing (resume with preplan
  skipped): `state.remote.forge` → `params.forge` → `git config driver.forge` → host map.
- Mechanism: preplan and pr do NOT implement the detection inline — they call the installed
  `agent-scripts/detect-forge.sh` and merge its JSON into `state.remote` (see §8).
  §7.1 above remains the SEMANTICS (the contract); §8 is the MECHANISM.

### 7.2 PR/MR conventions (pr phase)

- `driver/pr` (phase 8, default) is the ONLY agent allowed `git push`: it runs
  `git push -u origin <branch>` (never `--force`) and then opens or updates the PR/MR with
  the forge CLI. If one for the head branch already exists, EDIT it (idempotent resume) —
  never create a duplicate. With `--draft` (`params.draft: true`) it is created with the
  CLI's `--draft` flag and `state.pr.draft` is set to true.
- Base branch: github via `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`;
  gitlab/forgejo via `git symbolic-ref --short refs/remotes/origin/HEAD` (strip `origin/`).
  Fallback `main`. Head = `state.branch`.
- Title: conventional-commit style, capped at 72 chars. Reuse the first task-commit
  subject if it already matches `<type>(<scope>): ...`; otherwise synthesize from the
  dominant commit type/scope + `state.spec.title` (fallback: the slug). Sanitize/validate
  before any shell use — never interpolate unvalidated text into a shell command.
- Body: follow the target repo's PR/MR template when one exists — github:
  `.github/PULL_REQUEST_TEMPLATE.md`, `.github/PULL_REQUEST_TEMPLATE/*.md`,
  `docs/PULL_REQUEST_TEMPLATE.md`, root `PULL_REQUEST_TEMPLATE.md`; gitlab:
  `.gitlab/merge_request_templates/*.md`, root `MERGE_REQUEST_TEMPLATE.md`; forgejo:
  `.gitea/merge_request_templates/*.md` or `.forgejo/merge_request_templates/*.md`, root
  `MERGE_REQUEST_TEMPLATE.md`. Keep it SHORT and review-focused — Summary, How to review
  (riskiest files/commits first), How to verify (`state.qa.command` + audit/review
  verdicts), Risks & assumptions (from `plan.md`). Write it to `.plan/<slug>/pr-body.md`
  and pass via the CLI's body-file flag (`--body-file` for gh/forgejo-cli,
  `--description-file` for glab).
- Command table (titles/bodies sanitized and passed via flags, never inlined):

  | | github (`gh`) | gitlab (`glab`) | forgejo (`forgejo-cli` / `fj`) |
  |---|---|---|---|
  | auth check | `gh auth status` | `glab auth status` | `fj auth status` |
  | list open by head | `gh pr list --head <head> --state open --json number -q '.[0].number'` | `glab mr list --source-branch <head> --state opened --json iid -q '.[0].iid'` | `fj pr list --head <head> --state open --json number -q '.[0].number'` |
  | create | `gh pr create --base <base> --head <head> --title <t> --body-file <f> [--draft]` | `glab mr create --yes --target-branch <base> --source-branch <head> --title <t> --description-file <f> [--draft]` | `fj pr create --base <base> --head <head> --title <t> --body-file <f> [--draft]` |
  | update | `gh pr edit <n> --title <t> --body-file <f>` | `glab mr edit <iid> --title <t> --description-file <f>` | `fj pr edit <n> --title <t> --body-file <f>` |
  | url | `gh pr view <n> --json url -q .url` | `glab mr view <iid> --output json -q .web_url` | `fj pr view <n> --json url -q .url` |

- Unknown forge, or the forge's CLI missing/unauthenticated → mark the phase
  `skipped`/`failed` with a clear summary; never push anywhere else.
- Record `state.pr = { number, url, base, head, title, draft, forge, cli }` in `state.json`.

## 8. Agent scripts (installed payload — the mechanism behind §1 state writes and §7.1 forge detection)

`install.sh` ships the repo's `agent-scripts/` directory into the config dir, so every phase
addresses the scripts at the INSTALLED path — never the repo path:

```sh
SCRIPTS="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/agent-scripts"
```

If `"$SCRIPTS/detect-forge.sh"` / `"$SCRIPTS/detect-modules.py"` /
`"$SCRIPTS/driver-state.py"` is missing or not executable,
stop with a clear "agent-scripts not installed — re-run install.sh" error. Prerequisites:
POSIX sh, git, python3 — `install.sh` hard-fails without python3/git.

- **`detect-forge.sh`** — forge detection. §7.1 stays the SEMANTICS (the contract); this
  script is the MECHANISM. Invocation:
  `"$SCRIPTS/detect-forge.sh" --repo "$repoRoot" [--forge github|gitlab|forgejo] [--remote-url URL] [--no-cache]`
  - Prints exactly ONE JSON object on stdout:
    `{ "url": "...", "host": "...", "forge": "github|gitlab|forgejo|unknown", "cli": "gh|glab|fj|null", "source": "flag|cache|probe" }`.
  - Flags: `--forge <concrete>` (source=flag; the script persists it to repo-local
    `git config driver.forge` itself), `--remote-url <url>` (testability), `--repo <dir>`,
    `--no-cache` (neither read nor write the cache), `--help`.
  - Exit codes: `0` = JSON on stdout (`forge` may be `"unknown"` — a valid result);
    `2` = error (unknown flag, not a git repo, no origin remote) with a message on stderr
    and EMPTY stdout.
  - Precedence flag → cache → probe, the known-host map (github.com/gitlab.com/codeberg.org),
    the glab → forgejo-cli/fj → gh probe order, the CLI resolution and cache-only-successes
    are all implemented INSIDE the script (§7.1 parity). Agents call it and merge the JSON
    into `state.remote` — wrap the captured stdout
    (`printf '{"remote": %s}\n' "$json" > patch.json`, then `driver-state.py merge`) — and
    must NOT re-implement the detection inline.
- **`driver-state.py`** — safe, atomic `.plan/<slug>/state.json` access; the MECHANISM for
  the §1 merge/never-clobber contract. Subcommands (state file path first; a path matching
  `.plan/<segment>/state.json` is rejected unless `<segment>` matches the slug regex
  `^[A-Z][A-Z0-9]*-[0-9]+$`):
  - `validate <slug> <state.json>` — slug regex + required top-level keys; prints `ok`, exit 0.
  - `get <state.json> <dot.path>` — print the JSON value at the dotted path (numeric
    segments index arrays, e.g. `plan.tasks.0.id`); exit 1 when missing.
  - `set <state.json> <dot.path> <json>` — deep-set a JSON-parsed value (creates
    intermediate objects); atomic write.
  - `push <state.json> <dot.path> <json>` — append one JSON element to the array at the path.
  - `merge <state.json> <patch.json>` — deep-merge a patch FILE: objects merge recursively,
    any non-object value (scalar, array) REPLACES the target, keys are NEVER deleted;
    atomic write (tmp file + rename).
  - Exit codes: `0` ok, `1` = `get` path missing, `2` = misuse / invalid JSON / missing
    file / bad `.plan/<slug>` path — always with a stderr message.
- **`detect-modules.py`** — module detection + file→module mapping; the MECHANISM behind
  the §4 history layout (write-history calls it — agents must NOT re-implement the
  detection inline). python3 stdlib only. Invocation:
  `"$SCRIPTS/detect-modules.py" [--repo DIR] modules` and
  `"$SCRIPTS/detect-modules.py" [--repo DIR] map FILE...`
  - Prints exactly ONE JSON object (one line) on stdout:
    `modules` → `{ "repo": "<abs path>", "build_system": "gradle|maven|npm|cargo|fallback", "modules": [ { "name": "<dir>", "dir": "<dir>" }, ... ] }`;
    `map` → `{ "<file repo-relative>": "<module dir or .>" }` — the longest module-dir
    prefix wins, `"."` = repo root / under no module dir. FILEs may be repo-relative or
    absolute; files outside the repo are an error.
  - Build-system detection, first match wins: Gradle → Maven → npm-family → Cargo;
    fallback = top-level dirs plus `src/*` when a root `src/` exists (never deeper).
  - Exit codes: `0` = one JSON object on stdout; `2` = error (bad flag, unreadable repo,
    file outside repo) with a message on stderr and EMPTY stdout. `--help` → usage on
    stdout, exit 0.
- **Mandate:** ALL `state.json` updates in EVERY phase go through these subcommands, e.g.
  `driver-state.py merge "$statePath" patch.json`,
  `driver-state.py push "$statePath" implement.runs "$entryJson"`,
  `driver-state.py set "$statePath" phases.implement.status '"done"'`.
  Pass JSON values as SINGLE-QUOTED arguments — never interpolate untrusted text into a
  shell command; write patch objects to a temp file under `.plan/<slug>/` for `merge`.
  Hand-editing `state.json` is only a documented FALLBACK when the installed scripts are
  missing (old install) — and even then the slug regex + §1 schema must hold.
- **Error handling rule:** the scripts' stderr and exit codes must be surfaced to the
  driver/user, never swallowed; stdout JSON is safe to consume.
