## 2026-11-03 — G-21 — [Driver-viz] Improved UI/UX
- What changed: `AGENTS.md` + `README.md` driver-viz sections updated — session-scoped run display (`state.session_id`), sidebar UI/UX (⏱ elapsed timer, clickable [Open Plan]/[Open report] + palette commands, completion block with total time / best-effort tokens / +A -D), and the cycle report persisted to `.plan/<slug>/report.md`; screenshot regeneration still deferred (cosmetic).
- Commits: `5bdf50e98ff04d239382c721eea33e3bfbe25570`, `6a5db31ebd6bc8e78bfae82307da97a73e80a3bd`, `28c2ec173d049ad42dde82d39a986c691668bfaf`
- Plan: `.plan/G-21/plan.md`

## 2026-11-03 — G-23 — Linear issue attachments - Download failed
- What changed: repo-root wiring for eager Linear attachment download — `install.sh` ships the new `agent-scripts/save-linear-attachments.py` (payload dirs, manifest, stale-file cleanup), `.github/workflows/release.yml` release self-test covers it, and `README.md` + `AGENTS.md` document the new agent-script and the preplan/plan attachment flow.
- Commits: `1d6676ae64e4e892a1a21747edcd5537b8a174f1`
- Plan: `.plan/G-23/plan.md`

## 2026-11-04 — G-24 — Store QA command per repo
- What changed: repo-root wiring for the per-repo QA-command cache — `install.sh` ships the new `agent-scripts/qa-command.sh` (payload dirs, manifest, stale-file cleanup), `.github/workflows/release.yml` release self-test covers it, and `README.md` + `AGENTS.md` document the repo-local `git config driver.qa` cache and the new agent-script per the §8 mandate.
- Commits: `cfdd073268a2fda37f09c1cf5bdb248d5b3641bb`
- Plan: `.plan/G-24/plan.md`

## 2026-11-04 — G-29 — install.sh messaging rework (concise output)
- What changed: `install.sh` user-facing output condensed — concise success block (version + Components line, no paths/`->` arrows), 2-step Next steps (`.plan/` gitignore hint + `/driver ABC-123`), warn-only user-level Linear MCP check in `check_prereqs`, stale removals tallied into a single line, shortened `--release` progress lines. Task gates green: audit pass (8/8 ACs), QA pass; cycle audit/review/QA all pass.
- Commits: `69c22dcdc72f7ef9bb51d51ce7e602009b2264b0`
- Plan: `.plan/G-29/plan.md`

## 2026-11-04 — G-31 — Optimisation - History/Decisions records
- What changed: repo-root wiring for the new `agent-context-check.py` agent-script — `install.sh` ships it (payload dirs, manifest, stale-file cleanup), `.github/workflows/release.yml` release self-test covers it, `README.md`/`AGENTS.md` document the write-history restraint guidance and the non-fatal context-length warning.
- Commits: `086910077d75f2ee186e5959e5f31d727d209cb5`, `b7f14fe7eb2c8a5a9b536091e568c115c0dd33d6`
- Plan: `.plan/G-31/plan.md`

## 2026-11-04 — G-30 — Subtask audit and QA steps - conditional skip
- What changed: `README.md` driver documentation now states that the per-task spec-audit/quality-gate are skipped for a single-task manifest when the cycle-scope gates run.
- Commits: `2461233175a0735a0094e0d41f8e7a5ef81fce7b`
- Plan: `.plan/G-30/plan.md`
