## 2026-11-03 — G-23 — Linear issue attachments - Download failed
- What changed: wired `driver/preplan` and `driver/plan` (linear-source branch) to the installed `save-linear-attachments.py` — persist the full issue body (description + comments) to `.plan/<slug>/spec.md`, eagerly download attachments to `.plan/<slug>/attachments/`, and merge `spec.spec_file` + `spec.attachments[]` into state.json via `driver-state.py`, adding a `state.warnings` entry per failed download (idempotent on plan re-fetch). Linear permission frontmatter blocks kept byte-identical (validate.sh invariant 4).
- Commits: `1d6676ae64e4e892a1a21747edcd5537b8a174f1`
- Plan: `.plan/G-23/plan.md`
