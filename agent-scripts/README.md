# agent-scripts

Unit-tested automation scripts for the routine "by hand" driver tasks, usable on
any system with minimal prerequisites. Shipped in the release payload and
installed to:

```
${XDG_CONFIG_HOME:-$HOME/.config}/opencode/agent-scripts/
```

## Prerequisites

- POSIX `sh` and `git` (assumed present)
- `python3` (hard prerequisite for `driver-state.py`; the installer hard-fails
  without it)
- No `jq`, no third-party Python packages — both scripts are stdlib/POSIX only.

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

## Tests

```
sh agent-scripts/tests/run-tests.sh
```

Runs `tests/test-detect-forge.sh` (scratch git repos in `mktemp -d` + stub CLI
executables first on PATH: known-host map, URL forms, probe order, cache
semantics, `--no-cache`, error paths, single-JSON-line stdout) and
`tests/test-driver-state.py` (unittest in tmp dirs: validate, set/get/push/merge
round-trips, never-delete merge, slug/path guard, atomicity, error paths), plus
`sh -n` / `py_compile` syntax checks. Exits non-zero on any failure; prints
`ok: detect-forge tests` / `ok: driver-state tests` per suite.
