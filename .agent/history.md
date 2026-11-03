## 2026-11-03 — G-23 — Linear issue attachments - Download failed
- What changed: repo-root wiring for eager Linear attachment download — `install.sh` ships the new `agent-scripts/save-linear-attachments.py` (payload dirs, manifest, stale-file cleanup), `.github/workflows/release.yml` release self-test covers it, and `README.md` + `AGENTS.md` document the new agent-script and the preplan/plan attachment flow.
- Commits: `1d6676ae64e4e892a1a21747edcd5537b8a174f1`
- Plan: `.plan/G-23/plan.md`
