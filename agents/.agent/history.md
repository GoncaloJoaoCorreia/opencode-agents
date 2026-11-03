## 2026-11-03 — G-21 — [Driver-viz] Improved UI/UX
- What changed: `agents/driver.md` — §7 now persists the final cycle report to `.plan/<slug>/report.md` and records `state.report` via driver-state.py (commit `5bdf50e`); step 5 records `state.session_id` via the built-in `opencode.session_move` no-op (sessionID omitted → returns the current session), null when the tool is missing on older hosts (commit `6a5db31`).
- Commits: `5bdf50e98ff04d239382c721eea33e3bfbe25570`, `6a5db31ebd6bc8e78bfae82307da97a73e80a3bd`, `28c2ec173d049ad42dde82d39a986c691668bfaf`
- Plan: `.plan/G-21/plan.md`
