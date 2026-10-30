---
description: Driver phase 6 — run the project's validation (tests/lint/build, from state.qa.command) and record the verdict. Report-only for code; the driver spawns driver/implement for repairs.
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }
  - { action: "edit", resource: "*", effect: "deny" }          # report-only; fixes go through implement
  - { action: "edit", resource: ".plan/**", effect: "allow" }  # results/state only
  - { action: "shell", resource: "*", effect: "ask" }           # the QA command itself needs approval once
  - { action: "shell", resource: "git rev-parse *", effect: "allow" }
  - { action: "shell", resource: "git status *", effect: "allow" }
  - { action: "shell", resource: "git log *", effect: "allow" }
  - { action: "shell", resource: "git push *", effect: "deny" }
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: quality-gate

Run the project's validation and record the verdict. The command comes from
`state.qa.command` (detected in preplan, or a future `--qa` flag). You never edit code —
the driver spawns `driver/implement` for repairs.

## Steps

1. Load the `driver-conventions` skill.
2. If `state.qa.command` is missing, ask the driver/user via `question` (or fail fast in
   non-interactive mode) — do not invent a command.
3. Run it from the repo root with a generous timeout. Capture exit code and the tail of the
   output.
4. On failure, extract the actionable failures (failing tests, lint errors, build errors)
   into `state.qa.failures[]` with file references where available.
5. Write `state.qa = { command, verdict, exit_code, log_excerpt, failures }` and
   `state.phases["quality-gate"] = { status: "done", summary }`.

## Output contract (to the driver)

- Short summary: command, verdict, failure count + the most important failure.
  The driver may run bounded repair rounds via `driver/implement` (TODO `--max-rounds`),
  then re-spawn you.

## Gotchas

- Use a timeout suited to the project; prefer the repo's own CI command if detectable.
- Keep `log_excerpt` short (tail only) — full logs blow up context; write the full log to
  `.plan/<ID>/qa.log` instead and reference it.
