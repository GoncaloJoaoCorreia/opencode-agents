---
description: Driver phase 7 — append boundary history and decisions to each module's .agent/{history,decisions}.md in the target repo (repo-root .agent/ for root-level files), then commit those changes as a docs commit. Records only what is worth future reference (boundary history + important decisions). The only agent allowed to edit .agent/**.
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }
  - { action: "edit", resource: "*", effect: "deny" }
  - { action: "edit", resource: ".plan/**", effect: "allow" }
  - { action: "edit", resource: ".agent/**", effect: "allow" }  # history/decisions only
  # Permissive by default: shell runs without prompts (the push deny still applies —
  # only driver/pr may push). This phase commits ONLY .agent/ changes (docs commit).
  - { action: "shell", resource: "*", effect: "allow" }
  - { action: "shell", resource: "git push *", effect: "deny" }
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: write-history

Append this cycle's boundary history and important decisions to the per-module
`.agent/` folders, then commit those changes. You may edit ONLY `.agent/**` and
`.plan/**`. Append — never rewrite existing entries.

## Inputs (from the driver's prompt)

- `statePath` (has plan.tasks with commit SHAs, audit/review/qa verdicts, spec)
- the list of modules touched (derive via `git show --stat <sha>` per commit + detect-modules.py)

## Module mapping (G-22: script-driven, replaces the old first-path-segment rule)

Module dirs come from the INSTALLED agent script
(`SCRIPTS="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/agent-scripts"`, driver-conventions
§8):

1. If `"$SCRIPTS/detect-modules.py"` is missing or not executable → stop with
   "agent-scripts not installed — re-run install.sh".
2. For each cycle commit, collect its changed files
   (`git diff-tree --no-commit-id --name-only -r <sha>`), then map them:
   `"$SCRIPTS/detect-modules.py" --repo <repoRoot> map <files...>` → one JSON object
   `{ "<file>": "<module dir or .>" }` — the longest module-dir prefix wins, `.` =
   repo root. The script detects module dirs from the repo's build system, first
   match wins: Gradle → Maven → npm-family → Cargo; fallback: top-level dirs, plus
   `src/*` when a root `src/` exists (one extra level, never deeper).

## Steps

1. Load the `driver-conventions` skill (exact entry templates).
2. Group this cycle's commits (`state.plan.tasks[].commit`) by module dir via
   `git show --stat` + the `map` call above. Files mapping to `.` → repo-root `.agent/`
   (module name `root` in the history entry).
3. For each module dir, append to `<module-dir>/.agent/history.md`:
   `## <ISO date> — <ISSUE-ID> — <title>` + bullets: what changed, commit SHAs, plan path.
   Append to `<module-dir>/.agent/decisions.md` ONLY for real decisions (from plan risks
   and audit/review notes): Context / Options / Decision / Rationale / Consequences.
   Create dirs/files if missing. One history entry per module per cycle (group the commits).
   **Restraint** — history/decisions only ever hold what is worth future reference:
   - Rationales belong in `decisions.md` — never in `history.md`.
   - History entries avoid `implementation details` unless they matter for the
     history itself.
   - Append nothing when nothing is worth recording this cycle.
4. Commit the history changes: `git add` ONLY the touched `.agent/...` paths, then
   `git commit -m "docs(driver): record history/decisions for <ISSUE-ID>"`.
   NEVER push (only the pr phase pushes). Never stage anything outside `.agent/`.
   If there is nothing to commit (no entries), skip the commit.
5. Update `state.json` via the installed `driver-state.py`
   (`SCRIPTS` as above, driver-conventions §8 — `set`/`push`/`merge`, never clobber;
   hand-editing only as the documented fallback when the scripts are missing):
   `phases["write-history"] = { status: "done", summary }`,
   `history.entries[] = [{ module, agent_dir, history_file, decision_file, commit }]`
   (`history_file` = `<agent_dir>/.agent/history.md`, `agent_dir` = module dir, `"."`
   for the repo root), and record the docs commit SHA.
6. Context-length check (non-fatal, G-31): run the INSTALLED
   `"$SCRIPTS/agent-context-check.py" --repo <repoRoot>` and capture its single-line
   JSON stdout into a file under `.plan/<slug>/` (e.g. `context-check.json`).
   - If the script is missing or not executable (old install) → push ONE
     `state.warnings` entry via `"$SCRIPTS/driver-state.py" push "$statePath" warnings '<json>'`
     ("agent-context-check.py not in installed agent-scripts — context-length check
     skipped; re-run install.sh") and continue. This is the ONE script where a missing
     install degrades to a warning + continue instead of the §8 hard-stop, because the
     warning must never break a cycle (`driver-state.py` / `detect-modules.py` keep the
     hard-stop).
   - Otherwise extract `over_limit` with python3 (never jq) and, for each over-limit
     path, write the warning-entry JSON to its own file under `.plan/<slug>/` and push
     it with `"$SCRIPTS/driver-state.py" push "$statePath" warnings "$(cat <entry-file>)"`
     — never interpolate the file names into a shell command. Each entry names the
     repo-relative path and its estimated tokens over the 2,000 limit.
   - Name the over-limit paths in the phase summary. The check NEVER fails the phase
     and NEVER blocks the docs commit: over-limit is data (the script exits 0 with
     `"ok": false`; exit 2 means misuse/unreadable repo — surface its stderr but still
     continue).

## Output contract (to the driver)

Short summary: module `.agent/` files touched + docs commit SHA (or "nothing to commit"),
plus any over-limit `.agent` paths flagged by `agent-context-check.py` (from
`state.warnings`).

## Gotchas

- Slug guard: build `.plan/<slug>/` paths only after validating the slug against
  `^[A-Z][A-Z0-9]*-[0-9]+$` (driver-conventions §0) — never interpolate an unvalidated
  slug into a path or shell command.
- If `git commit` fails (e.g. nothing staged), do not force it — report and leave changes uncommitted.
- Never stage files outside `.agent/`.
