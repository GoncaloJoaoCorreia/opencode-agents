## 2026-11-03 — G-23 — Persist spec.md and attachments metadata for linear sources
- Context: before G-23, `source: "linear"` specs lived only in the Linear MCP; attachment signed URLs expired before use ("Download failed").
- Options considered: (a) fetch attachments lazily via MCP at point of use; (b) at spec-fetch time in preplan/plan, persist the full issue body to `.plan/<slug>/spec.md` and eagerly download attachments to `.plan/<slug>/attachments/`, rewriting successful downloads to local links and recording `spec.spec_file` + `spec.attachments[]` in state.json.
- Decision: (b) — eager download at fetch time; idempotent resume (skip-if-exists unless `--refresh`); spec.md regenerated from the fresh fetch.
- Rationale: signed URLs are valid at fetch time, so eager download is reliable; `state.schema.json` allows additional properties and `spec.attachments` was added explicitly, keeping the change additive and schema-compatible.
- Consequences: `state.spec` gains `spec_file` + `attachments[]` (schema + SKILL.md updated); implement can fall back to fresh MCP `get_attachment`/`extract_images` URLs if a stored signature is stale; `.plan/` remains gitignored scratch.
