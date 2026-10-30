#!/bin/sh
# Installs the driver agents/commands/skills into the global OpenCode config (copy, not symlink).
# Re-run after editing this repo. OpenCode picks up config changes automatically — no restart.
set -eu

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

for d in agents commands skills; do
  mkdir -p "$DEST/$d"
  # -L dereferences symlinks (e.g. the plan-thorough variant placeholder), so the
  # installed copy is a real file that stays in sync with its target on re-install.
  cp -RL "$SRC/$d/." "$DEST/$d/"
  echo "installed $d/ -> $DEST/$d/"
done

echo
echo "Next steps:"
echo "  1. Make sure your Linear MCP server is configured globally: opencode mcp list"
echo "  2. Add '.plan/' to the .gitignore of every repo you run the driver in (see snippets/gitignore.txt)"
echo "  3. Pick a model/variant with /models — all driver phases inherit the session model"
