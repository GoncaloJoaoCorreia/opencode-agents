---
description: Driver phase 1 — collect the spec (Linear issue via the linear-project MCP server, or pasted/file spec), detect+confirm the QA command, check .plan/ is gitignored, and fill in .plan/<SLUG>/state.json
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
- `params` — { phases: [...], worktree: bool }

## Steps

1. Load the `driver-conventions` skill — follow its schemas exactly.
2. **Spec.** If `issueOrSpec` matches `^[A-Z][A-Z0-9]+-[0-9]+$`:
   - Call the Linear MCP tools (`linear-project_get_issue` with `id` = the key,
     `format: "markdown"`; then `linear-project_list_comments` with the returned issue id).
     Check your actual tool list — names are `<server>_<tool>`.
   - If the issue is not found or the server is unreachable, ask via `question`:
     treat the key as a plain slug, or paste the spec?
   - Record `state.spec = { source: "linear", ref: <key>, title, url }`. Keep any excerpt SHORT —
     the full description stays in Linear; later phases re-fetch what they need.
   - Else, if `issueOrSpec` is a path to an existing file: read it,
     `state.spec = { source: "file", ref: <path>, title: <first heading> }`.
   - Else: write the raw spec to `.plan/<slug>/spec.md` and record
     `state.spec = { source: "prompt", ref: slug, spec_file: ".plan/<slug>/spec.md" }`.
     (A file under .plan/ keeps state.json small and gives later phases a stable reference.)
3. **QA command** (only if `"quality-gate"` is in `params.phases`):
   - If `params.qa` is set (driver `--qa "cmd"`): use it directly — `state.qa.command = params.qa`,
     skip detection and the question.
   - Else detect candidates read-only: `package.json` scripts (`test`, `check`, `lint`,
     `typecheck`), `Makefile` (`test`/`check` targets), `.github/workflows/*.yml` test steps.
   - Ask via `question` to confirm: options = detected candidates + "skip quality-gate" + free-form.
     Store the choice in `state.qa.command` (and `state.qa.candidates`).
4. **`.gitignore` check:** read the repo-root `.gitignore`. If it has no `.plan/` entry, append
   `".plan/ is not gitignored in this repo — add it (see the driver's snippets/gitignore.txt)"`
   to `state.warnings`. You may NOT edit files outside `.plan/**`.
5. Merge everything into `state.json` (never clobber existing fields):
   `spec`, `qa`, `warnings`, and `phases.preplan = { status: "done", summary, completed_at }`.

## Output contract (to the driver)

Return a SHORT summary only: slug, spec source, qa command (or "skipped"), warnings.
Do NOT paste the spec or issue body into your reply.

## Gotchas

- You run in the FOREGROUND so `question` works.
- Validate any ID against the pattern before using it in a path.
- Never put the issue key or spec text into a shell command unvalidated/unquoted.
