#!/bin/sh
# opencode-agents installer — one script, two modes (auto-detected):
#
#   source  (default inside a local checkout): the script sits next to .git/ and agents/,
#           so it installs by COPYING from the checkout. Nothing is built or compiled.
#
#   release (standalone, e.g. `curl -fsSL <raw-url>/install.sh | sh`): downloads the
#           latest GitHub release payload (opencode-agents.tar.gz + SHA256SUMS from
#           releases/latest/download/), verifies the checksum, and installs from that.
#
# Usage: install.sh [--source|--release] [--dest DIR] [-h|--help]
#
# Install target: --dest DIR, else ${XDG_CONFIG_HOME:-~/.config}/opencode.
# The install is COPY-based on purpose (cp -RL): OpenCode's discovery does not follow
# symlinked agent files, so never symlink agents/ commands/ skills/ into the config dir.
# Each install writes opencode-agents.version and opencode-agents.manifest into the
# target; the manifest drives stale-file cleanup on reinstall. Nothing outside
# agents/ commands/ skills/ and those two meta files is ever touched.
set -eu
unset CDPATH  # keep `cd` output clean when resolving SCRIPT_DIR below

REPO="GoncaloJoaoCorreia/opencode-agents"
RELEASE_BASE="https://github.com/${REPO}/releases/latest/download"
API_LATEST="https://api.github.com/repos/${REPO}/releases/latest"

MODE="auto"
DEST="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

usage() {
  cat <<EOF
opencode-agents installer

Usage: install.sh [--source|--release] [--dest DIR] [-h|--help]

  --source     install from the local checkout this script lives in (auto-detected
               when .git/ and agents/ sit next to the script)
  --release    download + checksum-verify the latest GitHub release payload, then
               install from it (default when run standalone, e.g. via curl | sh)
  --dest DIR   install target (default: \${XDG_CONFIG_HOME:-~/.config}/opencode)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source)  MODE="source" ;;
    --release) MODE="release" ;;
    --dest)    DEST="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# When piped (`curl ... | sh`), $0 is "sh" — not a file — so auto-detect falls to release mode.
SCRIPT_DIR=""
if [ -f "$0" ]; then
  SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
fi
if [ "$MODE" = "auto" ]; then
  if [ -n "$SCRIPT_DIR" ] && [ -d "$SCRIPT_DIR/.git" ] && [ -d "$SCRIPT_DIR/agents" ]; then
    MODE="source"
  else
    MODE="release"
  fi
fi

if command -v shasum >/dev/null 2>&1; then
  SHA_CHECK="shasum -a 256 -c"     # macOS
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_CHECK="sha256sum -c"          # Linux
else
  echo "install.sh: need shasum (macOS) or sha256sum (Linux) for checksum verification" >&2
  exit 1
fi

# install_payload <payload-root> <version>
# payload-root = directory containing agents/ commands/ skills/
install_payload() {
  payload="$1"
  version="$2"
  for d in agents commands skills; do
    if [ ! -d "$payload/$d" ]; then
      echo "install.sh: payload is missing $d/ (looked in $payload)" >&2
      exit 1
    fi
  done

  mkdir -p "$DEST"
  new_list="$DEST/.opencode-agents.manifest.tmp"
  old_manifest="$DEST/opencode-agents.manifest"

  # -L so symlinked placeholder agents (plan-thorough.md) are listed too
  (cd "$payload" && find -L agents commands skills -type f | LC_ALL=C sort) > "$new_list"

  # manifest-based clean: remove previously installed files that no longer exist upstream
  if [ -f "$old_manifest" ]; then
    while IFS= read -r f; do
      case "$f" in
        agents/*|commands/*|skills/*) ;;
        *) continue ;;
      esac
      if ! grep -qxF "$f" "$new_list"; then
        rm -f "$DEST/$f"
        echo "removed stale $f"
      fi
    done < "$old_manifest"
  fi

  for d in agents commands skills; do
    mkdir -p "$DEST/$d"
    # -L dereferences symlinks (plan-thorough.md placeholder) into real installed files
    cp -RL "$payload/$d/." "$DEST/$d/"
  done

  mv "$new_list" "$old_manifest"
  printf '%s\n' "$version" > "$DEST/opencode-agents.version"
  echo "installed opencode-agents $version -> $DEST"
}

source_mode() {
  if [ ! -d "$SCRIPT_DIR/agents" ] || [ ! -d "$SCRIPT_DIR/commands" ] || [ ! -d "$SCRIPT_DIR/skills" ]; then
    echo "install.sh: --source but no agents/ commands/ skills/ next to $0" >&2
    exit 1
  fi
  version="unknown"
  if [ -d "$SCRIPT_DIR/.git" ] && command -v git >/dev/null 2>&1; then
    version=$(git -C "$SCRIPT_DIR" describe --tags --always --dirty 2>/dev/null || echo unknown)
  fi
  install_payload "$SCRIPT_DIR" "$version"
}

release_mode() {
  command -v curl >/dev/null 2>&1 || { echo "install.sh: curl is required in release mode" >&2; exit 1; }
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT INT TERM

  # Public repo: the plain download URLs work unauthenticated — no gh/token needed.
  if ! curl -fsSL "$RELEASE_BASE/opencode-agents.tar.gz" -o "$TMP/opencode-agents.tar.gz" 2>/dev/null \
     || ! curl -fsSL "$RELEASE_BASE/SHA256SUMS" -o "$TMP/SHA256SUMS" 2>/dev/null; then
    echo "install.sh: could not download the latest release payload from $RELEASE_BASE" >&2
    echo "  (no release published yet, or a network problem) — see https://github.com/$REPO/releases" >&2
    exit 1
  fi
  echo "downloaded latest release payload from $RELEASE_BASE"
  version=$(curl -fsSL "$API_LATEST" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$version" ] || version="latest"

  echo "verifying checksum ..."
  # shellcheck disable=SC2086  # SHA_CHECK intentionally unquoted (two words)
  if ! (cd "$TMP" && $SHA_CHECK SHA256SUMS); then
    echo "install.sh: checksum verification FAILED — refusing to install" >&2
    exit 1
  fi

  tar -xzf "$TMP/opencode-agents.tar.gz" -C "$TMP"
  agents_dir=$(find "$TMP" -type d -name agents | head -n 1)
  if [ -z "$agents_dir" ]; then
    echo "install.sh: tarball does not contain an agents/ directory" >&2
    exit 1
  fi
  payload=$(dirname "$agents_dir")

  install_payload "$payload" "$version"
}

case "$MODE" in
  source)  source_mode ;;
  release) release_mode ;;
esac

echo
echo "Next steps:"
echo "  1. Make sure the Linear MCP server is configured in your target repo's opencode.jsonc:"
echo "     \"mcp\": { \"linear-project\": { \"type\": \"remote\", \"url\": \"https://mcp.linear.app/mcp\", \"enabled\": true } }"
echo "  2. Add '.plan/' to the .gitignore of every repo you run the driver in (snippets/gitignore.txt in this repo)"
echo "  3. Pick a model/variant with /models — all driver phases inherit the session model"
