## 2026-11-03 — G-21 — [Driver-viz] Improved UI/UX
- What changed: `agents/driver.md` — §7 now persists the final cycle report to `.plan/<slug>/report.md` and records `state.report` via driver-state.py (commit `5bdf50e`); step 5 records `state.session_id` via the built-in `opencode.session_move` no-op (sessionID omitted → returns the current session), null when the tool is missing on older hosts (commit `6a5db31`).
- Commits: `5bdf50e98ff04d239382c721eea33e3bfbe25570`, `6a5db31ebd6bc8e78bfae82307da97a73e80a3bd`, `28c2ec173d049ad42dde82d39a986c691668bfaf`
- Plan: `.plan/G-21/plan.md`

## 2026-11-03 — G-23 — Linear issue attachments - Download failed
- What changed: wired `driver/preplan` and `driver/plan` (linear-source branch) to the installed `save-linear-attachments.py` — persist the full issue body (description + comments) to `.plan/<slug>/spec.md`, eagerly download attachments to `.plan/<slug>/attachments/`, and merge `spec.spec_file` + `spec.attachments[]` into state.json via `driver-state.py`, adding a `state.warnings` entry per failed download (idempotent on plan re-fetch). Linear permission frontmatter blocks kept byte-identical (validate.sh invariant 4).
- Commits: `1d6676ae64e4e892a1a21747edcd5537b8a174f1`
- Plan: `.plan/G-23/plan.md`

## 2026-11-04 — G-24 — Store QA command per repo
- What changed: wired the repo-local `driver.qa` cache into the phase prompts — `agents/driver/preplan.md` step 3 implements the precedence `--qa` flag → cache → `state.qa.command` → detect+ask (persisting flag/confirmed answers via `qa-command.sh set --command-file`, `--force` re-asks, "skip quality-gate" not cached) and `agents/driver/quality-gate.md` falls back to the cache when `state.qa.command` is missing; `agents/driver.md` updated. Review fix R1-F1: the cache read in preplan case 2 is now gated on `params.force` NOT set, so `--force` falls through to detect+ask and updates the cache.
- Commits: `cfdd073268a2fda37f09c1cf5bdb248d5b3641bb`, `50190349ffeb9682f7551373df3402cbf34d5b0f`
- Plan: `.plan/G-24/plan.md`
