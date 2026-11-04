## 2026-11-03 — G-21 — [Driver-viz] Improved UI/UX
- What changed: `skills/driver-conventions/SKILL.md` §1 documents `state.session_id` (recorded at driver step 5 via the built-in `opencode.session_move` no-op, null fallback on older hosts) and `state.report` (driver §7 cycle report); `references/state.schema.json` gains both fields additively — no fields removed (commits `5bdf50e`, `6a5db31`).
- Commits: `5bdf50e98ff04d239382c721eea33e3bfbe25570`, `6a5db31ebd6bc8e78bfae82307da97a73e80a3bd`, `28c2ec173d049ad42dde82d39a986c691668bfaf`
- Plan: `.plan/G-21/plan.md`

## 2026-11-03 — G-23 — Linear issue attachments - Download failed
- What changed: `driver-conventions` SKILL.md §1/§2/§8 now document the `spec.spec_file` + `spec.attachments[]` state fields and the `save-linear-attachments.py` invocation contract (single-line JSON stdout, exit 0/2, `--urls-file`, `--help`); `references/state.schema.json` gains `spec.attachments` additively (no fields removed).
- Commits: `1d6676ae64e4e892a1a21747edcd5537b8a174f1`
- Plan: `.plan/G-23/plan.md`

## 2026-11-04 — G-24 — Store QA command per repo
- What changed: `skills/driver-conventions/SKILL.md` gains §7.3 (driver.qa cache semantics: precedence, `--force` re-ask, skip not cached, manual override/clear) and the §8 entry for `qa-command.sh` (get/set, JSON stdout, exit 0/2); `references/state.schema.json` gains `qa.source` (`flag|cache|state|asked`) additively — no fields removed.
- Commits: `cfdd073268a2fda37f09c1cf5bdb248d5b3641bb`
- Plan: `.plan/G-24/plan.md`

## 2026-11-04 — G-31 — Optimisation - History/Decisions records
- What changed: `skills/driver-conventions/SKILL.md` §4 encodes the restraint rule for history/decisions entries and §8 gains the `agent-context-check.py` contract (fixed 2,000 estimated-token limit per file, exit 0 with ok:false on over-limit, exit 2 on misuse).
- Commits: `086910077d75f2ee186e5959e5f31d727d209cb5`, `b7f14fe7eb2c8a5a9b536091e568c115c0dd33d6`
- Plan: `.plan/G-31/plan.md`
