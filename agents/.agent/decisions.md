## 2026-11-03 — G-21 — Session-scoped runs via built-in host APIs (no custom tool)
- Context: driver-viz must show only the current session's driver runs; the session ID was not previously recorded in state.json, and anomalyco/opencode#12324 proposed a custom-tool workaround.
- Options considered: (a) custom tool/plugin workaround per anomalyco/opencode#12324; (b) record `state.session_id` at driver step 5 via the built-in `opencode.session_move` no-op on OpenCode v2.2.5, and filter plugin-side by the sidebar.content slot-input sessionID (fallback `ui.router.current()`), with null/loose fallbacks.
- Decision: (b) — built-in host APIs only, verified against the installed OpenCode v2.2.5; `state.session_id` is null when the tool is missing, and the plugin falls back to the unfiltered most-recent run when the ID is unknown or no scanned run matches.
- Rationale: nothing custom to maintain or break across host versions; both APIs verified present on v2.2.5; degradation is display-only (previous most-recent-run behavior) instead of crashing on older or changed hosts.
- Consequences: `state.json` gains `session_id` (schema + SKILL.md updated additively); the mechanism breaks only if BOTH host APIs change; runs written by older drivers (session_id null) remain visible via the fallback.

## 2026-11-03 — G-21 — Persist the final cycle report to .plan/<slug>/report.md
- Context: a driver cycle used to end with no durable, human-readable artifact of what happened, and the sidebar had nothing to link as [Open report].
- Options considered: (a) report only in chat / phase summaries; (b) driver §7 writes `.plan/<slug>/report.md` at cycle end and records `state.report` via driver-state.py, with the plugin showing [Open report] only when the file exists.
- Decision: (b).
- Rationale: `.plan/` is gitignored scratch, so persisting there is free; `state.report` gives the machine-readable pointer; making the plugin action conditional means older runs without report.md simply don't show it.
- Consequences: SKILL.md §1 + `references/state.schema.json` document `state.report` additively; the file itself is written at cycle end, so the cycle-scope audit verifies the mechanism (driver §7 + schema + SKILL.md + plugin action), not the file, while the cycle is still running.

## 2026-11-04 — G-24 — QA-command precedence: --qa flag > cache > state > detect+ask; --force re-asks
- Context: on resume the cache (`git config driver.qa`) and a stale `state.qa.command` can disagree; `--force` must be able to re-ask; the "skip quality-gate" choice must not pin future runs.
- Options considered: (a) state always wins on resume; (b) cache wins over state on resume (state-only resume backfills the cache), `--qa` flag beats the cache, `--force` re-asks and updates the cache, skip never cached; (c) cache the skip choice too.
- Decision: (b). Review round 1 found R1-F1 (major): the initial implementation ran the cache read unconditionally, so `--force` with a populated cache never re-asked; fixed in `50190349` by gating the preplan cache read on `params.force` NOT set (re-verified fixed in review round 2, verdict pass).
- Rationale: the cache is the freshest user-confirmed source per repo (mirrors `driver.forge`); `--force` semantically means "re-run even when done", so it must also bypass the cache; not caching the skip keeps quality-gate optional per run.
- Consequences: `state.qa.source` records where the command came from (`flag|cache|state|asked`); quality-gate's cache fallback only triggers when `state.qa.command` is missing and never overrides a state command.
