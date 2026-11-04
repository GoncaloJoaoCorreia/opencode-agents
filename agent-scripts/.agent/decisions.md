## 2026-11-03 — G-23 — Download only Linear-hosted attachment URLs, failures never fatal
- Context: Linear issue bodies can link arbitrary external URLs; an eager downloader must not become an SSRF/arbitrary-fetch vector, and untrusted Linear text must never reach a shell command.
- Options considered: (a) download every URL found in the markdown; (b) allowlist of Linear hosts only (default `uploads.linear.app` + API attachment URLs), external links left untouched, overridable via `--allowed-hosts`; (c) (b) plus a download size cap.
- Decision: (b) without a size cap. URLs are passed via `--urls-file` (JSON under `.plan/`), never argv interpolation. Per-file failures are recorded (`failed[]` in the script JSON + `state.warnings`), never fatal; failed files keep their original URL.
- Rationale: attachments are Linear-CDN-hosted, so a host allowlist removes the SSRF surface while external links stay as-is; output lands in gitignored `.plan/` scratch, so a size cap adds little; failure-tolerant semantics keep a flaky CDN or expired signature from aborting the run.
- Consequences: the host allowlist is checked on the initial URL only — not re-checked on HTTP redirects (review nit R1-F1), accepted as low risk because redirect targets are controlled by Linear's CDN and output is gitignored scratch; if embedded signatures are stale at fetch time, implement falls back to fresh `linear-project` `get_attachment`/`extract_images` MCP URLs.

## 2026-11-04 — G-24 — qa-command.sh owns the driver.qa cache; only single-line commands cacheable
- Context: G-24 needs a per-repo QA-command cache mirroring the `driver.forge` cache (G-20); commands containing quotes/metachars must round-trip through git config + JSON stdout, and multi-line commands cannot live in a single git-config value.
- Options considered: (a) inline the git-config read/write in the preplan/quality-gate prompts; (b) a shipped, unit-tested `agent-scripts/qa-command.sh` with get/set + validation + single-line JSON stdout + exit 0/2 (the §8 mechanism mandate, same pattern as detect-forge.sh); (c) cache any command string including multi-line.
- Decision: (b) with strict validation — only non-empty, single-line, ≤4096-char commands are cacheable; `set` rejects multi-line input with exit 2; script exit 2 (not a repo / misuse) is surfaced, never swallowed.
- Rationale: the agent-scripts mandate keeps mechanical logic out of prompts; strict validation keeps the cache a single git-config value that round-trips safely through JSON stdout; old installs without the script fail clearly ("agent-scripts not installed — re-run install.sh").
- Consequences: multi-line QA commands cannot be cached per repo (rejected at `set` time; the run still works via `state.qa.command`); `driver.qa` lives in repo-local `.git/config`, never committed, shared across linked worktrees unless `extensions.worktreeConfig` — same caveat as `driver.forge`.

## 2026-11-04 — G-31 — Fixed 2,000 estimated-token limit per .agent file, no override flag
- Context: the context-length warning needed a size limit; the estimate ceil(bytes/4) is a heuristic and the result is data, never a gate.
- Options considered: (a) configurable limit via a flag; (b) fixed 2,000 estimated tokens per file as a constant reported in the JSON output.
- Decision: (b) — fixed limit, no override flag.
- Rationale: a per-run knob for an advisory warning adds complexity nobody asked for; since the result is never fatal, a wrong limit cannot break a cycle.
- Consequences: tuning the limit later requires a code change; over-limit is exit 0 with ok:false plus the over-limit paths, exit 2 only on misuse/unreadable repo.
