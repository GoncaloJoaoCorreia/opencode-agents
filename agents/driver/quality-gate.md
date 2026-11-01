---
description: Driver phase 6 — run the project's validation (tests/lint/build, from state.qa.command) and record the verdict. Report-only for code; the driver spawns driver/implement for repairs.
mode: subagent
# NOTE: no `model:` on purpose — inherits the session's model/variant.
permissions:
  - { action: "subagent", resource: "*", effect: "deny" }
  - { action: "edit", resource: "*", effect: "deny" }          # report-only; fixes go through implement
  - { action: "edit", resource: ".plan/**", effect: "allow" }  # results/state only
  # Permissive by default: shell runs without prompts (the push deny still applies —
  # only driver/pr may push).
  - { action: "shell", resource: "*", effect: "allow" }
  - { action: "shell", resource: "git push *", effect: "deny" }
  - { action: "skill", resource: "driver-conventions", effect: "allow" }
---

# Phase: quality-gate

Run the project's validation and record the verdict. The command comes from
`state.qa.command` (detected in preplan, or pinned via the driver's `--qa "cmd"` flag).
You never edit code — the driver spawns `driver/implement` for repairs in bounded rounds.

## Steps

1. Load the `driver-conventions` skill.
2. If `state.qa.command` is missing: ask the user via `question` — do not invent a command.
   If no interactive client is available (question cannot be answered), mark the phase
   `skipped` with summary "no qa.command and no interactive client to ask — skipped"
   instead of blocking the cycle.
3. Run it from the repo root with a generous timeout. Capture exit code and the tail of the
   output.
4. On failure, extract the actionable failures (failing tests, lint errors, build errors)
   into `state.qa.failures[]` in the schema shape `{ title, file?, line?, excerpt }`.
5. Write `state.qa = { command, verdict, exit_code, log, log_excerpt, failures }` — `log` is
   the PATH to the full log (`.plan/<slug>/qa.log`), `log_excerpt` the short tail kept inline —
   and `state.phases["quality-gate"] = { status: "done", summary }`.

## Output contract (to the driver)

- Short summary: command, verdict, failure count + the most important failure.
  The driver runs bounded repair rounds (same loop as spec-audit/code-review): spawn
  `driver/implement` with `failures: state.qa.failures` (`mode: "fix"`), then re-spawn you,
  up to `params.max_rounds ?? 2` (params arrive in your prompt).

## Gotchas

- Use a timeout suited to the project; prefer the repo's own CI command if detectable.
- Keep `log_excerpt` short (tail only) — full logs blow up context; write the full log to
  `.plan/<slug>/qa.log`, store its path in `state.qa.log`, and reference it.
- Validate the `slug` against `^[A-Z][A-Z0-9]+-[0-9]+$` before any path use.
