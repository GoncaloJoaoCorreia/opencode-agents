# agent-scripts

Unit-tested automation scripts for the routine "by hand" driver tasks, usable on
any system with minimal prerequisites. Shipped in the release payload and
installed to:

```
${XDG_CONFIG_HOME:-$HOME/.config}/opencode/agent-scripts/
```

## Prerequisites

- POSIX `sh` and `git` (assumed present)
- `python3` (hard prerequisite for `driver-state.py`, `detect-modules.py`,
  `save-linear-attachments.py` and `agent-context-check.py`; the installer
  hard-fails without it)
- No `jq`, no third-party Python packages — all scripts are stdlib/POSIX only.

## detect-forge.sh

Detects the forge of a git repo's origin remote. POSIX sh, executable. Mirrors
`skills/driver-conventions/SKILL.md` §7.1 exactly:

- precedence: `--forge` flag → cached `git config driver.forge` → probe
- known SaaS hosts map directly: `github.com` → github, `gitlab.com` → gitlab,
  `codeberg.org` → forgejo
- custom hosts probe installed CLIs in order `glab` → `forgejo-cli`/`fj` → `gh`;
  the first that is installed, authenticated and answers its user API wins
  (probes wrapped in `timeout 10` when `timeout` exists)
- only probe successes are cached repo-locally (`git config driver.forge`,
  never committed); failures are not cached

### Invocation

```
detect-forge.sh [--forge github|gitlab|forgejo] [--remote-url URL] [--repo DIR] [--no-cache]
```

- `--forge FORGE` — use FORGE with `source: "flag"` and persist it to
  `git config driver.forge` (repo-local)
- `--remote-url URL` — override `git remote get-url origin` (testability)
- `--repo DIR` — git repo to read remote/config from (default: cwd)
- `--no-cache` — do NOT read AND do NOT write the `driver.forge` cache (pure
  probe; also suppresses the `--forge` persist)
- `--help` — usage on stdout, exit 0

### Output contract

Exactly one JSON object on stdout (diagnostics on stderr only):

```json
{ "url": "...", "host": "...", "forge": "github|gitlab|forgejo|unknown", "cli": "gh|glab|fj|null", "source": "flag|cache|probe" }
```

`cli` is the winning forge's binary via `command -v` (`fj` = forgejo-cli,
whichever binary name exists), else `null`. URL/host are parsed from
https/ssh/scp-like remote forms (ports and `.git` suffixes handled) and
control-char-stripped; JSON emitted with `printf` (no jq).

### Exit codes

- `0` — JSON emitted on stdout; `"forge": "unknown"` is a valid result (custom
  host, no CLI identified) and is NOT cached; a warning naming the host goes to
  stderr
- `2` — error (unknown flag, unreadable repo, missing origin remote): message +
  usage on stderr, stdout stays empty (pure JSON on success paths only)

## driver-state.py

Safe, atomic access to a driver state file `.plan/<slug>/state.json`
(python3 stdlib only, executable, shebang `#!/usr/bin/env python3`). All
state.json updates by the driver phases go through this script — never
hand-edited — so the merge-never-clobber contract holds.

### Invocation

```
driver-state.py validate <slug> <state.json>
driver-state.py get <state.json> <dot.path>
driver-state.py set <state.json> <dot.path> <json-value>
driver-state.py push <state.json> <dot.path> <json-value>
driver-state.py merge <state.json> <patch.json>
```

- `validate` — slug must match `^[A-Z][A-Z0-9]*-[0-9]+$`; the state file must
  parse as a JSON object with the required top-level keys (`version`,
  `issue_id`, `repo_root`, `plan_dir`, `branch`, `created_at`, `params`,
  `phases`); prints `ok`, exit 0
- `get` — prints the JSON value at the dotted path; numeric segments index
  arrays (`plan.tasks.0.id`); exit 1 when the path is missing
- `set` — deep-set (creates intermediate objects); value is parsed as JSON, so
  `set s phases.plan.status '"done"'` works
- `push` — appends one element to the array at the path (created when missing)
- `merge` — deep merge of a patch file: objects merge recursively, any
  non-object value (scalar, array) REPLACES the target; never deletes keys

### Safety contract

- Path guard: when the state path matches `.plan/<segment>/state.json`, the
  `<segment>` must match the slug regex — rejected otherwise (path-traversal
  guard)
- Atomic writes: `<state>.tmp-<pid>` in the same directory, then `os.replace`;
  never truncates in place; no `.tmp-` files remain after success
- `set`/`push`/`merge` require an existing valid JSON object (the driver
  writes the skeleton) and print a short confirmation (`ok: set <path>`) —
  never the whole state file
- `--help` → usage on stdout, exit 0; misuse / invalid JSON / missing file →
  stderr + exit 2 (`get` on a missing path exits 1)

## detect-modules.py

Detects a target repo's module folders and maps changed files to them — the
mechanism behind the per-module `.agent/` history layout
(`skills/driver-conventions/SKILL.md` §4; called by `driver/write-history`).
python3 stdlib only, executable, shebang `#!/usr/bin/env python3`.

### Invocation

```
detect-modules.py [--repo DIR] modules
detect-modules.py [--repo DIR] map FILE...
```

- `--repo DIR` — target repo root (default: cwd)
- `modules` — print the detected build system + module dirs as one JSON object
- `map FILE...` — map each FILE (repo-relative or absolute) to its module dir;
  FILEs outside the repo are an error
- `--help` — usage on stdout, exit 0

### Output contract

Exactly one JSON object (one line) on stdout (diagnostics on stderr only):

```json
{ "repo": "/abs/repo", "build_system": "gradle|maven|npm|cargo|fallback", "modules": [ { "name": "module1", "dir": "module1" } ] }
```

for `modules`, and

```json
{ "module1/SomeFile.ts": "module1", "README.md": "." }
```

for `map` — the LONGEST detected module dir that is a path-segment prefix of the
file wins (nested folders inside a module belong to the module); `"."` = repo
root or under no module dir.

Build-system detection, first match wins: **Gradle** (root `settings.gradle` /
`settings.gradle.kts` `include(...)` statements, incl.
`project(":x").projectDir = file(...)` overrides) → **Maven** (root `pom.xml`
`<modules><module>...`) → **npm-family** (root `package.json` `workspaces` array
or `{ "packages": [...] }` and/or root `pnpm-workspace.yaml` `packages:` globs) →
**Cargo** (root `Cargo.toml` `[workspace]` members minus exclude). Fallback when
no build system matches: the repo's top-level directories (one level deep), PLUS
the directories under a root `src/` when one exists (one extra level, never
deeper). Hidden dirs (`.git`, `.plan`, `.agent`, …) are never modules; the repo
root itself is not a module entry.

### Exit codes

- `0` — exactly one JSON object on stdout
- `2` — error (unknown flag, unreadable repo, file outside repo): message on
  stderr, stdout stays EMPTY (pure JSON on success paths only)

## save-linear-attachments.py

Eagerly downloads Linear-hosted attachment URLs found in a fetched issue's
markdown and rewrites the markdown to local links — Linear serves attachments
as short-lived signed `uploads.linear.app` URLs that expire ("Download
failed"), so the driver persists `.plan/<slug>/spec.md` with the links already
rewritten to local `attachments/...` files (G-23). python3 stdlib only,
executable, shebang `#!/usr/bin/env python3`.

### Invocation

```
save-linear-attachments.py --markdown FILE --out DIR --spec-out FILE
    [--urls-file FILE] [--url URL ...] [--allowed-hosts H1,H2] [--refresh] [--help]
```

- `--markdown FILE` — fetched issue markdown (description and/or comments) to
  scan; must be readable, else exit 2
- `--out DIR` — attachment output dir (e.g. `.plan/<slug>/attachments`);
  created when missing
- `--spec-out FILE` — where the rewritten markdown is written
- `--urls-file FILE` — JSON file with extra URLs: an array of strings or
  `{ "url": ..., "title": ... }` objects (this is how `issue.attachments[]` is
  passed, so no untrusted text is ever interpolated into a shell command by
  callers)
- `--url URL` — repeatable extra URL (convenience/tests)
- `--allowed-hosts H1,H2` — comma-separated host allowlist, default
  `uploads.linear.app`; URLs on other hosts land in `skipped[]` with reason
  `host-not-allowed` and are NOT rewritten
- `--refresh` — re-download even when the local file already exists; default is
  skip-if-exists (reason `exists`, the link is still rewritten) for idempotent
  resume
- `--help` — usage on stdout, exit 0

### URL extraction, download and rewrite

- `<linear-image>{...}</linear-image>` blocks → the embedded JSON's `attrs.src`
  (and `attrs.title` as filename hint); malformed JSON blocks land in
  `skipped[]` with reason `unparseable` and are left unchanged
- standard markdown images `![alt](URL)`; only http/https URLs are candidates
- download via `urllib.request` with a 30s timeout and a plain User-Agent;
  content is written as raw bytes as received
- local name = sanitized title / URL basename (`[A-Za-z0-9._-]` only, path
  traversal stripped); the extension is derived from the Content-Type when the
  name has none (fallback `.bin`); name collisions get `-2`, `-3`, … suffixes
- the full URL incl. query/signature is what gets downloaded; the local name
  comes from the title/basename, not the query
- each successfully downloaded (or already existing) URL is replaced
  everywhere in the markdown with the relative link `attachments/<name>`;
  failed or skipped URLs keep the original remote URL; duplicate URLs in one
  markdown are downloaded once and every occurrence is rewritten

### Output contract

Exactly one JSON object (one line) on stdout (diagnostics on stderr only):

```json
{ "spec_out": "...", "attachments_dir": "...",
  "downloaded": [ { "url": "...", "local": "attachments/image.png", "title": "image.png" } ],
  "skipped":    [ { "url": "...", "reason": "exists|host-not-allowed|unparseable|scheme-not-allowed" } ],
  "failed":     [ { "url": "...", "error": "..." } ] }
```

### Exit codes

- `0` — whenever the inputs are readable; per-file failures live in `failed[]`
  and never abort (failed URLs keep their remote URL in the rewritten markdown)
- `2` — misuse (unknown flag, unreadable `--markdown` / `--urls-file`, unusable
  `--out`): message on stderr, stdout stays EMPTY (pure JSON on success paths
  only)

## qa-command.sh

Owns the repo-local QA-command cache `git config driver.qa` (G-24) — the same
pattern as `detect-forge.sh` owning `driver.forge`. It is purely the cache
mechanism (read + persist) for the confirmed QA command of a repo, so later
`/driver` runs in the same repo don't have to ask again; candidate detection
and the precedence chain (`--qa` flag → cache → state → detect+ask) stay in
`agents/driver/preplan.md`. The key lives in repo-local git config and is never
committed. POSIX sh, executable.

### Invocation

```
qa-command.sh get [--repo DIR]
qa-command.sh set [--repo DIR] (--command-file FILE | --command "STR")
qa-command.sh --help
```

- `get` — print the cached command; `command` is `null` when `driver.qa` is
  unset (still exit 0)
- `set` — validate + persist the command with `git config driver.qa "<cmd>"`
  (single-valued: replaces any previous value)
- `--repo DIR` — git repo to read/write config in (default: cwd); DIR must
  itself be a git repo (root or worktree — it must contain a `.git` entry; a
  plain subdirectory of a repo is rejected because git would resolve the
  parent's `.git`)
- `--command STR` — the command to persist; exactly one of `--command` /
  `--command-file` must be passed
- `--command-file FILE` — read the command from FILE (the primary input path
  for agents: command text is written to a file under `.plan/<slug>/`, never
  passed as argv by callers); at most one trailing newline is trimmed
- `--help`, `-h` — usage on stdout, exit 0

### Output contract

Exactly one JSON object (one line) on stdout (diagnostics on stderr only):

```json
{ "command": "<cmd>" | null, "source": "cache" }
```

for `get` (`"source": "set"` for `set`). `command` is `null` when `driver.qa`
is unset. JSON is emitted with `printf` + a `json_str` escaper (control chars
stripped, backslash and double quote escaped) — no jq.

### Validation rules (set)

After trimming at most one trailing newline, the command must be non-empty,
single-line (no `\n`, `\r`, or any other control char) and at most 4096 chars.
Any violation → exit 2, empty stdout, and the cache is NOT written. Metachars
(quotes, `$`, backticks, `&&`, `|`) survive both `git config` storage and the
JSON escaping byte-identical.

### Exit codes

- `0` — JSON on stdout (`get` with an unset `driver.qa` prints `"command":
  null` and still exits 0)
- `2` — error (unknown flag/subcommand, not a git repo, missing/unreadable
  `--command-file`, both or neither of `--command`/`--command-file`, invalid
  command): message + usage on stderr, stdout stays EMPTY

## agent-context-check.py

Context-length check over a target repo's `.agent` records (G-31): scans ALL
`.agent/history.md` and `.agent/decisions.md` files — the payload write-history
appends to, so files grown over previous cycles are caught too — and reports which
of them exceed a fixed estimated-token limit. `driver/write-history` runs the
INSTALLED script after its docs commit and pushes one `state.warnings[]` entry per
over-limit file: flagged, never fatal (the docs commit and the `done` status are
unaffected). python3 stdlib only, executable, shebang `#!/usr/bin/env python3`,
read-only (never writes, idempotent — safe on every write-history invocation).

### Invocation

```
agent-context-check.py [--repo DIR] [--help]
```

- `--repo DIR` — target repo root (default: cwd); must be a readable directory
- `--help` — usage on stdout, exit 0

### Scan scope

- every `.agent/history.md` and `.agent/decisions.md` at any depth (`.agent` dirs
  themselves ARE scanned)
- pruned: `.git/`, `.plan/`, every other hidden dir (except `.agent` itself),
  `node_modules/`, `__pycache__/` — a `.agent` inside them is never scanned
- an unreadable individual file is skipped with a stderr note and does not affect
  `ok`

### Output contract

Exactly one JSON object (one line) on stdout (diagnostics on stderr only):

```json
{ "repo": "/abs/repo", "limit_tokens": 2000,
  "files": [ { "path": "agents/.agent/history.md", "lines": 9, "bytes": 1234, "tokens_est": 309, "over_limit": false } ],
  "over_limit": ["<repo-relative path>", ...],
  "ok": true }
```

- `files` sorted by `path` (repo-relative, forward slashes); `over_limit` = the
  subset of `files` with `over_limit: true`; `ok` = no file over the limit
- `tokens_est` = `ceil(bytes / 4)`; a file is `over_limit` when
  `tokens_est > limit_tokens` — exactly 2,000 is NOT over (8,000 bytes → 2,000
  tokens → ok; 8,001 bytes → over)
- the limit is the fixed constant `2000`, reported as `limit_tokens` — there is
  NO override flag (tuning requires a code change)
- empty repo (no `.agent` files): `files: []`, `over_limit: []`, `ok": true`, exit 0

### Exit codes

- `0` — JSON on stdout, INCLUDING when over-limit: over-limit is data
  (`"ok": false` + the `over_limit` paths), never an error
- `2` — misuse / unknown flag / unreadable `--repo`: message + usage on stderr,
  stdout stays EMPTY (pure JSON on success paths only)

## Tests

```
sh agent-scripts/tests/run-tests.sh
```

Runs `tests/test-detect-forge.sh` (scratch git repos in `mktemp -d` + stub CLI
executables first on PATH: known-host map, URL forms, probe order, cache
semantics, `--no-cache`, error paths, single-JSON-line stdout),
`tests/test-driver-state.py` (unittest in tmp dirs: validate, set/get/push/merge
round-trips, never-delete merge, slug/path guard, atomicity, error paths), and
`tests/test-detect-modules.py` (unittest with fixture repos: Gradle/Maven/npm/
Cargo detection + precedence order, fallback depth rule incl. the `src/` extra
level, root-file and nested-file mapping, CLI contract, exit codes 0/2 with empty
stdout on error), `tests/test-save-linear-attachments.py` (unittest with a
local `http.server` stub on `127.0.0.1`, ephemeral port — no external network:
`<linear-image>` and markdown-image extraction, host allowlist, download +
rewrite to `attachments/...` links, filename sanitize/dedupe, Content-Type
extensions, skip-if-exists vs `--refresh`, failed downloads keeping the remote
URL, `--urls-file` with strings and `{url,title}` objects, single-line JSON
stdout, exit codes 0/2, `--help`), `tests/test-qa-command.sh` (scratch git
repos in `mktemp -d`: get on fresh/set round-trips incl. metachars, cache
unset cases, empty/multi-line/CR/oversized command rejection, both/neither
flag errors, non-repo `--repo`, unknown flags, `--help`, single-JSON-line
stdout, trailing-newline trimming), `tests/test-agent-context-check.py`
(unittest with fixture repos in tmp dirs: under/over limit + the exactly-2000
boundary (8,000 bytes not over, 8,001 over), `ceil(bytes/4)` rounding, nested
module `.agent` dirs, `.git`/`.plan`/`node_modules`/`__pycache__`/hidden-dir
exclusion, empty repo, sort order, repo-relative paths, lines/bytes counts,
unreadable-file skip with stderr note, single-line JSON stdout, exit 0 with
over-limit (`"ok": false`) / exit 2 misuse+unreadable repo / `--help`), plus
`sh -n` / `py_compile` syntax checks.
Exits non-zero on any failure; prints `ok: detect-forge tests` /
`ok: driver-state tests` / `ok: detect-modules tests` /
`ok: save-linear-attachments tests` / `ok: qa-command tests` /
`ok: agent-context-check tests` per suite.
