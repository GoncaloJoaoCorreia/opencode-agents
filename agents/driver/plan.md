---
description: Driver phase 2 — turn the spec / Linear issue into a detailed plan under .plan/<ID>/ (plan.md, manifest.json, tasks/*.md with verifiable acceptance criteria)
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }
  - { action: "edit", resource: "*", effect: "deny" }
  - { action: "edit", resource: ".plan/**", effect: "allow" } # plans are the only thing this phase writes
  - { action: "shell", resource: "*", effect: "ask" }
  - { action: "shell", resource: "git rev-parse *", effect: "allow" }
  - { action: "shell", resource: "git status *", effect: "allow" }
  - { action: "shell", resource: "git log *", effect: "allow" }
  - { action: "shell", resource: "git branch *", effect: "allow" }
  - { action: "shell", resource: "git push *", effect: "deny" }
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: plan

Read `state.json` (written by preplan) and the spec (Linear issue or pasted text), explore
the codebase, and produce the plan artifacts.

## Outputs (write ONLY under `.plan/<ISSUE-ID>/`)

- `plan.md` — human-readable plan: context, approach, task breakdown, risks, acceptance
  criteria overview.
- `manifest.json` — machine-readable plan (schema: `driver-conventions` skill,
  `references/manifest.schema.json`). Per task: `id` (slug), `title`, `depends_on`,
  `files` (globs the implement phase may touch), and `acceptance_criteria[]`, each with a
  `verification` — spec-audit executes these, so prefer `verification.type: "command"`
  with the exact command.
- `tasks/<task-id>.md` — one detailed file per task; the implement agent works from these.

## Rules

- One commit per task later → tasks must be independently committable and ordered by `depends_on`.
- Keep acceptance criteria concrete and verifiable.
- EXTENSION POINT (variants of sub-steps): if you are a variant agent (e.g.
  `driver/plan-thorough`, selected via `--plan-variant thorough`), keep this exact output
  contract — later phases must not care which variant produced the plan.

## Output contract (to the driver)

- `state.json`: `phases.plan = { status, summary }`; `plan.manifest` path;
  `plan.tasks[] = [{ id, title, file, status: "pending" }]`.
- Short summary to the driver: task count, areas touched, notable risks. No full plan text
  in the reply.
