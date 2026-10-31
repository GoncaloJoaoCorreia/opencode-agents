---
description: "Driver phase 8 — push the cycle branch and open (or update) a pull request against the repo's default branch (fallback: main) via the gh CLI. Short, review-guidance-focused description following the repo's PR template when one exists. The ONLY agent allowed to push."
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }   # nesting depth 1: the driver owns fan-out
  - { action: "edit", resource: "*", effect: "deny" }
  - { action: "edit", resource: ".plan/**", effect: "allow" } # records PR info in state.json + pr-body.md
  # Permissive shell by default — and unlike every other driver agent, the `*` allow
  # below INCLUDES `git push *` and `gh *`: this phase exists to push + open the PR.
  # Do NOT copy this file's shell rules into other agents.
  - { action: "shell", resource: "*", effect: "allow" }
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: pr

Push the cycle's branch and open (or update) a pull request. You are the ONLY driver
phase allowed to push — every other agent hard-denies `git push *`.

## Inputs (from the driver's prompt)

- `statePath` (absolute path to `.plan/<slug>/state.json`), `slug`, `repoRoot`, `branch`, `params`

## Steps

1. Load the `driver-conventions` skill — PR conventions live in its §7.
2. Read `state.json`: `spec` (title), `plan.tasks[]` (commit SHAs), `plan.risks`,
   `audit`/`review`/`qa` verdicts, `phases` statuses.
3. **Preconditions:**
   - Remote must be GitHub: `git remote get-url origin` contains `github.com` (https or
     ssh form). If not → set `phases.pr = { status: "skipped", summary: "non-GitHub remote — push and open the PR manually" }` and stop.
   - `gh auth status` must succeed; if not → `status: "failed"`, summary: "gh CLI not authenticated — run `gh auth login`".
   - Head branch = `state.branch` (fallback: `git branch --show-current`). Validate the
     slug/branch before any path or shell use; quote everything.
4. **Base branch:** `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`;
   on any failure fall back to `main`. If head == base → mark `skipped` ("nothing to PR — head is the base branch") and stop.
5. **Idempotency:** `gh pr list --head "<head>" --state open --json number -q '.[0].number'`
   — if a PR for this head branch already exists, UPDATE it (step 8) instead of creating
   a duplicate.
6. **Push:** `git push -u origin "<head>"` (never `--force`, never push to the base branch).
7. **Title (conventional-commit style):**
   - Collect task commit subjects: `git show -s --format=%s <sha>` for each
     `state.plan.tasks[].commit` (skip entries without a commit).
   - If the first subject already matches `^[a-z]+(\([^)]+\))?!?: `, use it verbatim.
   - Else synthesize `<type>(<module>): <short>`: type = most frequent commit type among
     those subjects (default `feat`), module = most frequent scope (default `core`),
     short = `state.spec.title` truncated to ~60 chars (default: the slug).
   - Sanitize before any shell use: strip newlines/quotes; allow only
     `[A-Za-z0-9 .,:;()/+_!-]`; otherwise fall back to the slug as the whole title.
     Never interpolate unvalidated text into a shell command.
8. **Body — SHORT and review-focused:**
   - Template: check the target repo for `.github/PULL_REQUEST_TEMPLATE.md`,
     `.github/PULL_REQUEST_TEMPLATE/*.md` (first alphabetically if several),
     `docs/PULL_REQUEST_TEMPLATE.md`, root `PULL_REQUEST_TEMPLATE.md`. If one exists,
     keep its section headings and fill each section briefly.
   - Regardless of template, include (add these headings if the template lacks them):
     **Summary** (2–5 bullets from the plan tasks), **How to review** (which commits/files
     to look at first — riskiest first, one line each), **How to verify**
     (`state.qa.command` + audit/review verdicts + manual checks), **Risks & assumptions**
     (from `plan.md` Risks and its `## Assumptions` section).
   - Write the body to `.plan/<slug>/pr-body.md` and pass it via `--body-file`
     (never inline untrusted text in a shell command).
   - Create: `gh pr create --base <base> --head <head> --title "<title>" --body-file .plan/<slug>/pr-body.md`
     Update existing: `gh pr edit <n> --title "<title>" --body-file .plan/<slug>/pr-body.md`
   - Get the URL: `gh pr view <n-or-head> --json url -q .url`.
9. Merge into `state.json` (never clobber): `pr = { number, url, base, head, title }`,
   `phases.pr = { status: "done", summary, completed_at }`.

## Output contract (to the driver)

Short summary only: PR number + URL (or why skipped/failed), base branch, title.
Do NOT paste the PR body.

## Gotchas

- You are the only agent allowed to push — never `--force`, never push to the base branch.
- Uncommitted working-tree changes outside `.plan/` are NOT pushed; note that in the summary.
- If `gh pr create` fails because a PR already exists, fall back to `gh pr edit`.
- Validate the slug against `^[A-Z][A-Z0-9]+-[0-9]+$` before any path use; quote everything.
