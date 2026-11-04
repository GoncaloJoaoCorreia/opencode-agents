## 2026-11-04 — G-29 — Linear MCP prerequisite check is user-level only and warn-only
- Context: install.sh gained a new prerequisite check for the Linear MCP server (`linear-project`), which the driver needs read-only. This repo also has a repo-level `opencode.jsonc`, so the check had to decide which config locations count.
- Options considered: (a) count repo-level `opencode.jsonc` as well; (b) check only user-level config (`${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json` / `opencode.jsonc`); (c) hard-fail the install when the server is missing.
- Decision: warn-only check at user level only — a repo-level `opencode.jsonc` does not count, and the warning text points to both locations.
- Rationale: the driver runs with the user's config, so only user-level config guarantees the MCP server is actually loaded; warning instead of failing keeps installs non-fatal for users who never run the driver; mentioning both paths covers repo-level-only users.
- Consequences: repo-level-only users see a spurious but non-fatal warning; no install ever fails because of the Linear check.
