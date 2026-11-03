## 2026-11-03 — G-21 — [Driver-viz] Improved UI/UX
- What changed: `skills/driver-conventions/SKILL.md` §1 documents `state.session_id` (recorded at driver step 5 via the built-in `opencode.session_move` no-op, null fallback on older hosts) and `state.report` (driver §7 cycle report); `references/state.schema.json` gains both fields additively — no fields removed (commits `5bdf50e`, `6a5db31`).
- Commits: `5bdf50e98ff04d239382c721eea33e3bfbe25570`, `6a5db31ebd6bc8e78bfae82307da97a73e80a3bd`, `28c2ec173d049ad42dde82d39a986c691668bfaf`
- Plan: `.plan/G-21/plan.md`
