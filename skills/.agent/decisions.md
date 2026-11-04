## 2026-11-03 — G-21 — Contract for state.session_id and state.report
- Context: driver-viz session-scoping needs the current session ID in state.json, and cycle-end reporting needs a machine-readable pointer to the persisted report; both fields had to be added without breaking older state files.
- Options considered: (a) keep both out of state and scrape them from the session/host at render time; (b) add `session_id` (driver step 5, built-in `opencode.session_move` no-op, null when the tool is missing) and `report` (driver §7 writes `.plan/<slug>/report.md`) as additive state fields documented in SKILL.md §1 + state.schema.json.
- Decision: (b) — additive fields only; the schema allows additional properties and both fields were declared explicitly.
- Rationale: state.json is the single exchange format between driver and phases; recording the session ID once at run start is cheaper and more reliable than host-scraping at render time, and `state.report` lets any consumer locate the cycle report without convention guessing.
- Consequences: older state files without these fields remain valid (plugin falls back to most-recent-run; [Open report] hidden when report.md absent); the driver is the only writer of both fields.

## 2026-11-03 — G-23 — Persist spec.md and attachments metadata for linear sources
- Context: before G-23, `source: "linear"` specs lived only in the Linear MCP; attachment signed URLs expired before use ("Download failed").
- Options considered: (a) fetch attachments lazily via MCP at point of use; (b) at spec-fetch time in preplan/plan, persist the full issue body to `.plan/<slug>/spec.md` and eagerly download attachments to `.plan/<slug>/attachments/`, rewriting successful downloads to local links and recording `spec.spec_file` + `spec.attachments[]` in state.json.
- Decision: (b) — eager download at fetch time; idempotent resume (skip-if-exists unless `--refresh`); spec.md regenerated from the fresh fetch.
- Rationale: signed URLs are valid at fetch time, so eager download is reliable; `state.schema.json` allows additional properties and `spec.attachments` was added explicitly, keeping the change additive and schema-compatible.
- Consequences: `state.spec` gains `spec_file` + `attachments[]` (schema + SKILL.md updated); implement can fall back to fresh MCP `get_attachment`/`extract_images` URLs if a stored signature is stale; `.plan/` remains gitignored scratch.

## 2026-11-04 — G-24 — Additive qa.source field; cache-wins-on-resume pinned in the skill contract
- Context: the per-repo QA cache needs a machine-readable record of where `state.qa.command` came from, and resume behavior when cache and state disagree had to be pinned in the single source of truth (SKILL.md).
- Options considered: (a) keep the source implicit (re-derive from git config at read time); (b) add `qa.source` (`flag|cache|state|asked`) to `state.qa`, declared explicitly in `state.schema.json` + SKILL.md §1/§7.3, with the rule that on resume the cache wins and overwrites state (state-only resume backfills the cache).
- Decision: (b) — additive only; the schema allows additional properties and `qa.source` was declared explicitly, no fields removed.
- Rationale: state.json is the exchange format between phases; recording the source once per run makes preplan/quality-gate summaries and debugging unambiguous without shelling out to git config.
- Consequences: older state files without `qa.source` remain valid; when cache and `state.qa.command` disagree on resume the cache wins and overwrites state, and a state-only resume backfills the cache.

## 2026-11-04 — G-30 — Single-task manifests reuse the "skipped" verdict and skip per-task gates only when the cycle gates run
- Context: with a one-task manifest the per-task spec-audit + quality-gate duplicated the cycle-scope runs of the same phases; the fan-out had to decide when skipping is safe and how to record it without breaking resume or driver-viz.
- Options considered: (a) keep per-task gates always on (status quo; pure duplication for single-task runs); (b) skip the per-task gate iff the manifest has exactly one task AND both cycle-scope spec-audit and quality-gate are in the effective run set (params.phases, default all 8, minus params.skip, not already skipped in state), recording audit/qa as "skipped" without spawning; (c) introduce a new verdict value for the skip.
- Decision: (b) — verdicts reuse the existing "skipped" value (same as --skip): no audit.rounds[]/qa.runs[] task-scope entries, the task is marked done on commit; restricted runs (--phases/--skip) keep the per-task gate; applies in both qa_scope modes.
- Rationale: no coverage is lost (cycle spec-audit re-verifies task-scope criteria, cycle quality-gate always runs the full state.qa.command); reusing "skipped" needs no state.schema type change and driver-viz already renders it as done; deriving the decision from the immutable manifest makes resume behave identically.
- Consequences: driver-viz unchanged; known minor doc inconsistency (review R1-F1, warning only, pre-existing for --skip): the SKILL.md done-rule sentence still requires audit "pass" while the skip sets "skipped" — agents/driver.md carries the correct rule.
