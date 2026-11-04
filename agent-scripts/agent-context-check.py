#!/usr/bin/env python3
"""agent-context-check.py — check .agent/{history,decisions}.md files against a token limit.

Used by driver/write-history to surface over-long `.agent` history/decisions files as
non-fatal warnings (G-31): the context a phase loads from these files should stay
bounded, but an over-limit file must never break a cycle.

Usage:
  agent-context-check.py [--repo DIR] [--help]

Scans ALL `.agent/history.md` and `.agent/decisions.md` files in the target repo
(default: cwd), so files grown over previous cycles are caught too. Hidden dirs
(`.git`, `.plan`, ...) are never descended into — except `.agent` itself — and
`node_modules/` / `__pycache__/` are pruned as well.

Prints exactly one JSON object (one line) on stdout:
  { "repo": "/abs/repo", "limit_tokens": 2000,
    "files": [ { "path": "agents/.agent/history.md", "lines": 9, "bytes": 1234,
                 "tokens_est": 309, "over_limit": false }, ... ],
    "over_limit": ["<repo-relative path>", ...],
    "ok": true }

- `files` is sorted by `path` (repo-relative, forward slashes); `over_limit` is the
  subset of `files` with `over_limit: true`; `ok` = no file over the limit.
- `tokens_est` = ceil(bytes / 4); a file is over the limit when `tokens_est` > 2000
  (exactly 2000 is NOT over). The limit is a fixed constant — no override flag.
- Empty repo (no `.agent` files): `files: []`, `over_limit: []`, `ok": true`, exit 0.
- An unreadable individual file is skipped with a stderr note; it does not affect `ok`.

Exit codes: 0 = JSON on stdout (also when over-limit — over-limit is data, `"ok": false`,
never an error); 2 = misuse / unknown flag / unreadable `--repo` (message + usage on
stderr, EMPTY stdout). `--help` prints usage on stdout, exit 0.

Read-only and idempotent: never writes anything. python3 stdlib only.
"""

import argparse
import json
import math
import os
import sys

PROG = "agent-context-check.py"

# Fixed limit: estimated tokens per .agent file (estimate = ceil(bytes/4)).
# No override flag on purpose — the constant lives here and is reported as
# `limit_tokens` in the JSON output.
LIMIT_TOKENS = 2000
BYTES_PER_TOKEN = 4

AGENT_DIR = ".agent"
SCANNED_FILES = ("history.md", "decisions.md")
PRUNE_DIRS = {"node_modules", "__pycache__"}


def find_agent_files(repo):
    """Return all .agent/{history,decisions}.md paths under repo (unsorted)."""
    found = []
    for root, dirs, files in os.walk(repo):  # top-down, symlinks not followed
        dirs[:] = [
            d for d in dirs
            if d not in PRUNE_DIRS
            and not (d.startswith(".") and d != AGENT_DIR)
        ]
        if os.path.basename(root) == AGENT_DIR:
            for name in SCANNED_FILES:
                if name in files:
                    found.append(os.path.join(root, name))
    return found


def scan(repo):
    """Scan repo and build the JSON output object."""
    files = []
    for path in find_agent_files(repo):
        rel = os.path.relpath(path, repo).replace(os.sep, "/")
        try:
            with open(path, "rb") as f:
                raw = f.read()
        except OSError as e:
            print(f"{PROG}: skipping unreadable file {rel}: {e}", file=sys.stderr)
            continue
        tokens_est = math.ceil(len(raw) / BYTES_PER_TOKEN)
        files.append({
            "path": rel,
            "lines": len(raw.decode("utf-8", errors="replace").splitlines()),
            "bytes": len(raw),
            "tokens_est": tokens_est,
            "over_limit": tokens_est > LIMIT_TOKENS,
        })
    files.sort(key=lambda e: e["path"])
    over_limit = [e["path"] for e in files if e["over_limit"]]
    return {
        "repo": repo,
        "limit_tokens": LIMIT_TOKENS,
        "files": files,
        "over_limit": over_limit,
        "ok": not over_limit,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog=PROG,
        description=(
            f"Check all .agent/{{history,decisions}}.md files in a repo against a fixed "
            f"{LIMIT_TOKENS}-estimated-token per-file limit (ceil(bytes/{BYTES_PER_TOKEN})); "
            "prints exactly one JSON object on stdout."
        ),
    )
    ap.add_argument("--repo", metavar="DIR", default=None,
                    help="target repo root (default: cwd)")
    args = ap.parse_args(argv)
    repo = os.path.abspath(args.repo or os.getcwd())
    if not os.path.isdir(repo):
        print(f"{PROG}: repo not found or not a directory: {args.repo}", file=sys.stderr)
        ap.print_usage(sys.stderr)
        return 2
    print(json.dumps(scan(repo)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
