---
description: Driver phase 1 — validate inputs (Linear issue or spec, git repo), ask the user for anything missing, write .plan/<ID>/state.json
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }   # nesting depth 1: the driver owns fan-out
  - { action: "edit", resource: "*", effect: "deny" }
  - { action: "edit", resource: ".plan/**", effect: "allow" } # this phase only writes the state file
  - { action: "shell", resource: "*", effect: "ask" }
  - { action: "shell", resource: "git rev-parse *", effect: "allow" }
  - { action: "shell", resource: "git status *", effect: "allow" }
  - { action: "shell", resource: "git log *", effect: "allow" }
  - { action: "shell", resource: "git branch *", effect: "allow" }
  - { action: "shell", resource: "git push *", effect: "deny" }
  # Linear MCP tools. TODO: replace "linear" with your MCP server name (action = <server>_<tool>)
  # and narrow to the read-only tools. Write-back (comment on issue, status change) is a
  # future opt-in flag — keep write tools unapproved until then.
  - { action: "linear_*", resource: "*", effect: "ask" }
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: preplan

Validate that everything later phases need is present, then create the cycle's state file.
Change nothing else.

## Inputs (from the driver's prompt)

- repo root, current branch
- issue key (e.g. `ABC-123`) or raw spec (pasted text / file path)
- plan dir `.plan/<ISSUE-ID>/`, params (requested phases, ...)

## Steps

1. Load the `driver-conventions` skill — follow its state.json schema exactly.
2. Validate the issue ID against `^[A-Z][A-Z0-9]+-[0-9]+$` BEFORE using it in any path.
   Reject anything else outright (path traversal).
3. Confirm the operating directory is a git repo (`git rev-parse --is-inside-work-tree`).
   If not, ask the user with the `question` tool how to proceed — do not guess.
4. If the argument is a Linear issue key: fetch the issue via the Linear MCP tools
   (discover exact tool names at runtime; calls need approval). Record title, description,
   acceptance criteria, and URL in `state.spec`.
5. Otherwise record the raw spec as `state.spec = { source: "prompt" | "file", ... }`.
6. TODO: detect the project's validation command (package.json scripts / Makefile / CI
   workflow) into `state.qa.command` — or ask the user via `question` (becomes `--qa` later).
7. Warn if `.plan/` is not in the target repo's `.gitignore` (read-only check; you may not
   edit outside `.plan/**` — record the warning in state and in your summary).
8. Write `.plan/<ISSUE-ID>/state.json` (create dirs). Set every `phases.*.status = "pending"`.

## Output contract (to the driver)

- Update `state.json`: `phases.preplan = { status: "done", summary, ... }`.
- Return a SHORT summary: issue id, spec source, plan dir, qa command, warnings.
  Do NOT paste the full spec into your reply — it lives in state / Linear.

## Gotchas

- You are spawned in the FOREGROUND so the `question` tool works. In headless
  `opencode run` (TODO: `--non-interactive`), fail fast with a clear "missing input: X"
  instead of asking.
- If `state.json` already exists for this issue: do not overwrite — merge/resume and say what exists.
- Never put the issue ID or spec text into a shell command unvalidated/unquoted.
