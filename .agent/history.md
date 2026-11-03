## 2026-11-03 — G-21 — [Driver-viz] Improved UI/UX
- What changed: `AGENTS.md` + `README.md` driver-viz sections updated — session-scoped run display (`state.session_id`), sidebar UI/UX (⏱ elapsed timer, clickable [Open Plan]/[Open report] + palette commands, completion block with total time / best-effort tokens / +A -D), and the cycle report persisted to `.plan/<slug>/report.md`; screenshot regeneration still deferred (cosmetic).
- Commits: `5bdf50e98ff04d239382c721eea33e3bfbe25570`, `6a5db31ebd6bc8e78bfae82307da97a73e80a3bd`, `28c2ec173d049ad42dde82d39a986c691668bfaf`
- Plan: `.plan/G-21/plan.md`

## 2026-11-03 — G-23 — Linear issue attachments - Download failed
- What changed: repo-root wiring for eager Linear attachment download — `install.sh` ships the new `agent-scripts/save-linear-attachments.py` (payload dirs, manifest, stale-file cleanup), `.github/workflows/release.yml` release self-test covers it, and `README.md` + `AGENTS.md` document the new agent-script and the preplan/plan attachment flow.
- Commits: `1d6676ae64e4e892a1a21747edcd5537b8a174f1`
- Plan: `.plan/G-23/plan.md`
