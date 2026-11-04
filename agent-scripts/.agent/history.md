## 2026-11-03 — G-23 — Linear issue attachments - Download failed
- What changed: added `agent-scripts/save-linear-attachments.py` — eagerly downloads Linear-hosted attachment URLs extracted from issue markdown into `.plan/<slug>/attachments/`, rewrites them to local `attachments/` links, prints a single-line JSON result (`downloaded[]`/`failed[]`), exit 0/2 + `--help` contract per driver-conventions §8; plus a 28-test unittest suite (local http.server stub) wired into `agent-scripts/tests/run-tests.sh` and README contract docs. Suite green (`sh agent-scripts/tests/run-tests.sh`).
- Commits: `b79c23832f2926bdbd34bd189b236e39d5eeb2ca`
- Plan: `.plan/G-23/plan.md`

## 2026-11-04 — G-24 — Store QA command per repo
- What changed: added `agent-scripts/qa-command.sh` owning the repo-local `git config driver.qa` cache — `get` prints one JSON line (`{command|null, source:cache}`), `set` validates (non-empty, single-line, ≤4096 chars, one trailing newline trimmed) and persists, exit 0/2 contract mirroring `detect-forge.sh`; 33-assertion suite in `agent-scripts/tests/test-qa-command.sh` wired into `run-tests.sh`; README contract docs. Suite green.
- Commits: `07180716ed0cec3dda814668cf8d13382354ce8b`
- Plan: `.plan/G-24/plan.md`
