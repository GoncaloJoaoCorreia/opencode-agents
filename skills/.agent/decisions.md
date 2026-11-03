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
