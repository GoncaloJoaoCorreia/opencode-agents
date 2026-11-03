---
description: Driver phase 1 — collect the spec (Linear issue via the linear-project MCP server, or pasted/file spec), detect+confirm the QA command, detect and cache the git forge (github/gitlab/forgejo via gh/glab/forgejo-cli), check .plan/ is gitignored, and fill in .plan/<SLUG>/state.json
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }   # nesting depth 1: the driver owns fan-out
  - { action: "edit", resource: "*", effect: "deny" }
  - { action: "edit", resource: ".plan/**", effect: "allow" } # this phase only writes under .plan/
  # Permissive by default: shell runs without prompts (the push deny still applies —
  # only driver/pr may push).
  - { action: "shell", resource: "*", effect: "allow" }
  - { action: "shell", resource: "git push *", effect: "deny" }
  # Linear MCP — server name "linear-project" (https://mcp.linear.app/mcp) in the target
  # repo's opencode.jsonc. Action names sanitize unsupported chars to "_", so cover both
  # "linear-project_*" and "linear_project_*". READ-ONLY: read calls are allowed without
  # prompting; the write tools are hard-denied. Linear is read-only for the driver, permanently.
  - { action: "linear-project_*", resource: "*", effect: "allow" }
  - { action: "linear_project_*", resource: "*", effect: "allow" }
  - { action: "linear-project_create_*", resource: "*", effect: "deny" }
  - { action: "linear-project_update_*", resource: "*", effect: "deny" }
  - { action: "linear-project_save_*", resource: "*", effect: "deny" }
  - { action: "linear-project_delete_*", resource: "*", effect: "deny" }
  - { action: "linear_project_create_*", resource: "*", effect: "deny" }
  - { action: "linear_project_update_*", resource: "*", effect: "deny" }
  - { action: "linear_project_save_*", resource: "*", effect: "deny" }
  - { action: "linear_project_delete_*", resource: "*", effect: "deny" }
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: preplan

The driver has already: parsed args, resolved the slug, handled `--worktree`, run git
pre-flight (repo check, dirty-tree question, `feat/<slug>` branch on protected branches),
and written the initial `.plan/<slug>/state.json` with all phases `pending`.
Your job: fill in the spec, the QA command, and warnings — then mark preplan done.

## Inputs (from the driver's prompt)

- `statePath` — absolute path to `.plan/<slug>/state.json`
- `slug`, `issueOrSpec` (Linear key or raw spec), `repoRoot`, `branch`
- `params` — { phases: [...] | undefined, skip: [...] | undefined, worktree: bool, forge: "auto"|"github"|"gitlab"|"forgejo" | undefined }

## Steps

1. Load the `driver-conventions` skill — follow its schemas exactly.
2. **Spec.** If `issueOrSpec` matches `^[A-Z][A-Z0-9]*-[0-9]+$`:
   - Call the Linear MCP tools (`linear-project_get_issue` with `id` = the key,
     `format: "markdown"`; then `linear-project_list_comments` with the returned issue id).
     Check your actual tool list — names are `<server>_<tool>`.
   - If the issue is not found or the server is unreachable, record WHY first —
     `state.spec.error = "issue not found"` or `"linear server unreachable: <error>"` —
     then ask via `question`: treat the key as a plain slug, or paste the spec?
   - Persist the full fetched issue and eagerly download its Linear-hosted attachments
     (G-23: signed uploads.linear.app URLs expire minutes after the fetch, so links kept
     only in Linear die with "Download failed"). `planDir=".plan/<slug>"` (same as
     `$(dirname "$statePath")`):
     - Write the fetched issue description + comments to `$planDir/issue.md` with the
       edit tool (`.plan/**` is allowed) — never via shell interpolation of issue text.
     - Write `issue.attachments[]` (url/title pairs) as a JSON array to
       `$planDir/attachment-urls.json` — URLs travel via `--urls-file`, never via argv.
     - Run the installed script; define the scripts dir defensively and fail clearly when
       it is missing, exactly like step 4 does for detect-forge.sh:
       `SCRIPTS="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/agent-scripts"` — if
       `[ ! -x "$SCRIPTS/save-linear-attachments.py" ]`, stop with "agent-scripts not
       installed — re-run install.sh". Then run
       `"$SCRIPTS/save-linear-attachments.py" --markdown "$planDir/issue.md" --out "$planDir/attachments" --spec-out "$planDir/spec.md" --urls-file "$planDir/attachment-urls.json"`
       (quote everything) and capture the single-line JSON stdout. On a non-zero exit,
       surface the script's stderr and exit code to the driver and stop — never swallow
       them (exit 0 with per-file failures in `failed[]` is a valid result; exit 2 is an
       error with empty stdout). The script writes the rewritten markdown to
       `$planDir/spec.md`: downloaded URLs become local `attachments/...` links, failed or
       skipped URLs keep the original remote URL.
     - Merge the result into state via `driver-state.py` (§8): save the captured stdout to
       `$planDir/attachments-result.json`, then build `$planDir/spec-attachments.patch.json`
       from that file with a short python3-stdlib snippet (no jq — pass only FILE PATHS as
       arguments, never the JSON content, into a command) emitting
       `{ "spec": { "spec_file": ".plan/<slug>/spec.md", "attachments": [ ... ] } }`, where
       `attachments[]` combines the script's `downloaded[]` / `skipped[]` / `failed[]`
       into `{ url, local?, title?, status: "downloaded"|"skipped"|"failed", error? }`
       entries; then
       `"$SCRIPTS/driver-state.py" merge "$statePath" "$planDir/spec-attachments.patch.json"`.
       Have the same snippet write one JSON string per `failed[]` entry to
       `$planDir/attachment-warnings.jsonl` —
       `attachment download failed for <slug>: <url> (<error>) — the original (possibly
       expired) link is kept in spec.md` — and push each line as a warning:
       `while IFS= read -r w; do "$SCRIPTS/driver-state.py" push "$statePath" warnings "$w"; done < "$planDir/attachment-warnings.jsonl"`
       (each line is a complete JSON string read from the file — no untrusted text is
       interpolated into a command).
   - Record `state.spec = { source: "linear", ref: <key>, title, url }` (merge, never
     clobber — the merge above already added `spec_file`/`attachments`). Keep any excerpt
     SHORT; the full description + comments now live in `.plan/<slug>/spec.md`, and later
     phases read that file instead of re-fetching.
   - Else, if `issueOrSpec` is a path to an existing file: read it,
     `state.spec = { source: "file", ref: <path>, title: <first heading> }`.
   - Else: write the raw spec to `.plan/<slug>/spec.md` and record
     `state.spec = { source: "prompt", ref: slug, spec_file: ".plan/<slug>/spec.md" }`.
     (A file under .plan/ keeps state.json small and gives later phases a stable reference.)
3. **QA command** (only if `"quality-gate"` is in the effective run set — `params.phases`
   when set, else all phases MINUS `params.skip`; with `--skip quality-gate` there is
   nothing to detect, so skip this step entirely and leave `phases["quality-gate"].status`
   = `"skipped"` for the driver):
   - If `params.qa` is set (driver `--qa "cmd"`): use it directly — `state.qa.command = params.qa`,
     skip detection and the question.
   - Else if `state.qa.command` already exists (resume) and `params.force` is NOT set: keep the
     stored command — skip detection and the question. Only re-ask when forced or when missing.
   - Else detect candidates read-only: `package.json` scripts (`test`, `check`, `lint`,
     `typecheck`), `Makefile` (`test`/`check` targets), CI test steps in
     `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.forgejo/workflows/*.yml` and
     `.gitea/workflows/*.yml`.
   - Ask via `question` to confirm: options = detected candidates + "skip quality-gate" + free-form.
     Store the choice in `state.qa.command` (and `state.qa.candidates`). Choosing
     "skip quality-gate" also sets `phases["quality-gate"].status = "skipped"` immediately,
     so the driver does not have to infer it.
4. **Forge detection + cache** (fills `state.remote`; the pr phase consumes it).
   Semantics: driver-conventions §7.1 — the MECHANISM is the installed script
   `agent-scripts/detect-forge.sh` (driver-conventions §8); do NOT re-implement the
   detection inline. Define the scripts dir defensively and fail clearly when missing:
   `SCRIPTS="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/agent-scripts"` — if
   `[ ! -x "$SCRIPTS/detect-forge.sh" ]`, stop with "agent-scripts not installed — re-run
   install.sh".
   - Run `"$SCRIPTS/detect-forge.sh" --repo "$repoRoot"`, plus `--forge "$params.forge"`
     when `params.forge` is a concrete forge (not `auto`) — the script itself persists the
     flag to repo-local `git config driver.forge`. Flag → cache → probe precedence, the
     known-host map, the glab → forgejo-cli/fj → gh probe order, the CLI resolution and
     cache-only-successes are all INSIDE the script (§7.1 semantics).
   - Capture the single JSON object on stdout:
     `{ "url", "host", "forge", "cli", "source" }`. On a non-zero exit, surface the
     script's stderr and exit code to the driver and stop — never swallow them
     (exit 0 with `forge: "unknown"` is a valid result; exit 2 is an error with empty
     stdout and a diagnostic on stderr).
   - Merge the result into `state.remote` via `driver-state.py` (§8): the script's stdout
     is pure single-line JSON, so
     `printf '{"remote": %s}\n' "$json" > "$(dirname "$statePath")/remote.patch.json"` is
     safe, then
     `"$SCRIPTS/driver-state.py" merge "$statePath" "$(dirname "$statePath")/remote.patch.json"`.
     Quote everything.
   - Failure-warning behavior: when the returned `forge` is `"unknown"`, append a warning
     to `state.warnings` via `driver-state.py push "$statePath" warnings '<json-string>'`
     (a single-quoted JSON literal — no interpolation; the script printed the host on
     stderr): "could not identify the forge of the origin host — pass --forge, or
     authenticate the matching CLI; the pr phase will skip". The script does NOT cache
     failures, so a later `glab auth login` etc. fixes the next run without `--forge`.
   - You may still NOT edit files outside `.plan/**` (the `git config` writes happen
     inside the script).
5. **`.gitignore` check:** read the repo-root `.gitignore`. If it has no `.plan/` entry, append
   `".plan/ is not gitignored in this repo — add it (see the driver's snippets/gitignore.txt)"`
   to `state.warnings` — but ONLY if that exact string is not already present (dedupe on re-runs).
   You may NOT edit files outside `.plan/**`.
6. Merge everything into `state.json` (never clobber existing fields) via the installed
   `driver-state.py` (driver-conventions §8): write the patch (`spec`, `qa`, `remote`,
   `warnings`, and `phases.preplan = { status: "done", summary, completed_at }`) to a JSON
   file under `.plan/<slug>/` and run
   `"$SCRIPTS/driver-state.py" merge "$statePath" <patch.json>` — or use `set`/`push` for
   individual paths. Hand-editing is only the documented fallback when the installed
   scripts are missing (old install).

## Output contract (to the driver)

Return a SHORT summary only: slug, spec source, qa command (or "skipped"), detected forge
+ cli + source (flag/cache/probe), warnings.
Do NOT paste the spec or issue body into your reply.

## Gotchas

- You run in the FOREGROUND so `question` works.
- Validate any ID against the pattern before using it in a path.
- Never put the issue key or spec text into a shell command unvalidated/unquoted.
