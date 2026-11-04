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
# symlinked agent files, so never symlink agents/ commands/ skills/ agent-scripts/
# plugins/ into the config dir. Each install writes opencode-agents.version and
# opencode-agents.manifest into the target; the manifest drives stale-file cleanup on
# reinstall. Nothing outside agents/ commands/ skills/ agent-scripts/ plugins/
# (unless --no-plugin) and those two meta files is ever touched. .agent/ dirs inside
# the payload (this repo's own driver history) and __pycache__/ are EXCLUDED from the
# manifest and the install: OpenCode discovers agents/**/*.md recursively, so an
# installed agents/.agent/*.md would be registered as agents (".agent/history" etc.).
# plugins/driver-viz is
# auto-discovered by OpenCode from <config>/plugins/driver-viz/ — no cli.json edit
# needed. agent-scripts/ holds the driver helper scripts (detect-forge.sh,
# detect-modules.py, driver-state.py, save-linear-attachments.py, qa-command.sh) that
# the driver agents call from <config>/agent-scripts/.
#
# Prerequisites (checked before anything is installed, in both modes): POSIX sh, git
# and python3 are REQUIRED (the installed agent-scripts/ need them) — the install
# hard-fails with a clear message when python3 cannot run or git is missing. A forge
# CLI (gh/glab/forgejo-cli) and shellcheck are optional and only produce a warning.
set -eu
unset CDPATH  # keep `cd` output clean when resolving SCRIPT_DIR below

REPO="GoncaloJoaoCorreia/opencode-agents"
RELEASE_BASE="https://github.com/${REPO}/releases/latest/download"
API_LATEST="https://api.github.com/repos/${REPO}/releases/latest"

MODE="auto"
DEST="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
INSTALL_PLUGIN=1
# filled by install_payload, consumed by the success tail block below
INSTALLED_VERSION=""
INSTALLED_COMPONENTS=""

usage() {
  cat <<EOF
opencode-agents installer

Usage: install.sh [--source|--release] [--dest DIR] [--no-plugin] [-h|--help]

  --source     install from the local checkout this script lives in (auto-detected
               when .git/ and agents/ sit next to the script)
  --release    download + checksum-verify the latest GitHub release payload, then
               install from it (default when run standalone, e.g. via curl | sh)
  --dest DIR   install target (default: \${XDG_CONFIG_HOME:-~/.config}/opencode)
  --no-plugin  skip the driver-viz TUI plugin (agents/ commands/ skills/
               agent-scripts/ only); also removes a previously installed copy

Installs: agents/ commands/ skills/ agent-scripts/ and (unless --no-plugin)
plugins/ into the target dir.
Requirements: POSIX sh, git and python3 (hard prerequisite — the install fails
without them); gh/glab/forgejo-cli are optional (only the driver's pr phase
needs one).
EOF
}

# check_prereqs — hard-fail on missing required tools, warn on optional ones.
# Runs in BOTH modes before anything is installed or downloaded (fail fast).
check_prereqs() {
  # python3 must actually EXECUTE (a broken stub on PATH must fail), not just exist
  if ! python3 --version >/dev/null 2>&1; then
    echo "install.sh: python3 is required (agent-scripts/driver-state.py and detect-modules.py need it) but could not be executed" >&2
    echo "  install python3 (e.g. 'brew install python3', 'apt install python3', ...) and re-run" >&2
    exit 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    echo "install.sh: git is required (agent-scripts/detect-forge.sh reads the origin remote with it)" >&2
    echo "  install git and re-run" >&2
    exit 1
  fi
  # optional: a forge CLI is only needed by the driver's pr phase (it degrades
  # gracefully without one), shellcheck only for local linting
  if ! command -v gh >/dev/null 2>&1 && ! command -v glab >/dev/null 2>&1 \
     && ! command -v forgejo-cli >/dev/null 2>&1 && ! command -v fj >/dev/null 2>&1; then
    echo "install.sh: note: no forge CLI (gh/glab/forgejo-cli) found — optional; the driver's pr phase will skip pushing/opening the PR without one" >&2
  fi
  # optional: the driver reads Linear issues through the linear-project MCP server —
  # warn (never fail) when it is not configured at user level; a repo-level
  # opencode.jsonc also works at runtime
  user_cfg="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  if ! grep -qs 'linear-project\|mcp\.linear\.app' "$user_cfg/opencode.json" "$user_cfg/opencode.jsonc" 2>/dev/null; then
    echo "install.sh: warning: no Linear MCP server (linear-project) in your user-level OpenCode config ($user_cfg/opencode.json / opencode.jsonc)" >&2
    echo "  the driver needs it to read Linear issues — add it to your user-level or repo-level opencode config:" >&2
    echo '  { "mcp": { "linear-project": { "type": "remote", "url": "https://mcp.linear.app/mcp", "enabled": true } } }' >&2
  fi
  if ! command -v shellcheck >/dev/null 2>&1; then
    echo "install.sh: note: shellcheck not found — optional (skipped in scripts/validate.sh)" >&2
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source)    MODE="source" ;;
    --release)   MODE="release" ;;
    --dest)      DEST="$2"; shift ;;
    --no-plugin) INSTALL_PLUGIN=0 ;;
    -h|--help)   usage; exit 0 ;;
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

# prerequisites first — fail fast in both modes (in --release mode: before any
# download; the shipped agent-scripts/ need python3 + git at install time)
check_prereqs

if command -v shasum >/dev/null 2>&1; then
  SHA_CHECK="shasum -a 256 -c"     # macOS
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_CHECK="sha256sum -c"          # Linux
else
  echo "install.sh: need shasum (macOS) or sha256sum (Linux) for checksum verification" >&2
  exit 1
fi

# install_payload <payload-root> <version>
# payload-root = directory containing agents/ commands/ skills/ (plugins/ and
# agent-scripts/ optional — old tarballs predate them)
install_payload() {
  payload="$1"
  version="$2"
  want_scripts=0
  for d in agents commands skills agent-scripts; do
    if [ -d "$payload/$d" ]; then
      if [ "$d" = "agent-scripts" ]; then
        want_scripts=1
      fi
    elif [ "$d" = "agent-scripts" ]; then
      # old release tarballs predate agent-scripts/ — skip with a note, don't fail
      echo "install.sh: payload has no agent-scripts/ — skipping (old release predates it)"
    else
      echo "install.sh: payload is missing $d/ (looked in $payload)" >&2
      exit 1
    fi
  done

  # the driver-viz plugin payload is optional (old tarballs predate it); --no-plugin
  # skips it, and the manifest cleanup below then removes a previously installed copy
  want_plugins=0
  if [ "$INSTALL_PLUGIN" = "1" ]; then
    if [ -d "$payload/plugins" ]; then
      want_plugins=1
    else
      echo "install.sh: payload has no plugins/ — skipping driver-viz (--no-plugin silences this)"
    fi
  fi

  mkdir -p "$DEST"
  new_list="$DEST/.opencode-agents.manifest.tmp"
  old_manifest="$DEST/opencode-agents.manifest"

  dirs="agents commands skills"
  if [ "$want_scripts" = "1" ]; then
    dirs="$dirs agent-scripts"
  fi
  if [ "$want_plugins" = "1" ]; then
    dirs="$dirs plugins"
  fi
  # -L so symlinked placeholder agents (plan-thorough.md) are listed too.
  # Exclude .agent/ (driver history — would be discovered as agents) and __pycache__/
  # shellcheck disable=SC2086  # $dirs is an intentional word list
  (cd "$payload" && find -L $dirs -type f ! -path '*/.agent/*' ! -path '*/__pycache__/*' | LC_ALL=C sort) > "$new_list"

  # manifest-based clean: remove previously installed files that no longer exist upstream
  if [ -f "$old_manifest" ]; then
    stale_n=0
    while IFS= read -r f; do
      case "$f" in
        agents/*|commands/*|skills/*|agent-scripts/*|plugins/*) ;;
        *) continue ;;
      esac
      if ! grep -qxF "$f" "$new_list"; then
        rm -f "$DEST/$f"
        stale_n=$((stale_n + 1))
      fi
    done < "$old_manifest"
    if [ "$stale_n" -gt 0 ]; then
      echo "removed $stale_n stale file(s) from a previous install"
    fi
  fi

  for d in agents commands skills; do
    mkdir -p "$DEST/$d"
    # -L dereferences symlinks (plan-thorough.md placeholder) into real installed files
    cp -RL "$payload/$d/." "$DEST/$d/"
  done
  if [ "$want_scripts" = "1" ]; then
    mkdir -p "$DEST/agent-scripts"
    cp -RL "$payload/agent-scripts/." "$DEST/agent-scripts/"
    # defensive: the exec bit should survive cp, but make sure the scripts run
    find "$DEST/agent-scripts" -type f \( -name '*.sh' -o -name '*.py' \) -exec chmod +x {} +
  fi
  if [ "$want_plugins" = "1" ]; then
    mkdir -p "$DEST/plugins"
    cp -RL "$payload/plugins/." "$DEST/plugins/"
  fi

  # strip driver-history + bytecode dirs that cp -RL carried along: OpenCode
  # discovers agents/**/*.md recursively, so an installed .agent/*.md would be
  # registered as an agent. Also cleans leftover empty dirs from older installs
  # (the stale-file loop above already rm -f's the manifest-listed files in them).
  # shellcheck disable=SC2086  # $dirs is an intentional word list
  for d in $dirs; do
    rm -rf "$DEST/$d/.agent" "$DEST/$d/__pycache__"
  done

  mv "$new_list" "$old_manifest"
  printf '%s\n' "$version" > "$DEST/opencode-agents.version"
  # record what was installed (not where) for the success tail block
  INSTALLED_VERSION="$version"
  components="agents/ commands/ skills/"
  if [ "$want_scripts" = "1" ]; then
    components="$components agent-scripts/"
  fi
  if [ "$want_plugins" = "1" ]; then
    components="$components driver-viz plugin"
  fi
  INSTALLED_COMPONENTS="$components"
}

source_mode() {
  if [ ! -d "$SCRIPT_DIR/agents" ] || [ ! -d "$SCRIPT_DIR/commands" ] || [ ! -d "$SCRIPT_DIR/skills" ] || [ ! -d "$SCRIPT_DIR/agent-scripts" ]; then
    echo "install.sh: --source but no agents/ commands/ skills/ agent-scripts/ next to $0" >&2
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
  echo "downloaded latest release payload"
  version=$(curl -fsSL "$API_LATEST" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$version" ] || version="latest"

  echo "verifying checksum"
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
echo "Installed opencode-agents $INSTALLED_VERSION"
echo "Components: $INSTALLED_COMPONENTS"
echo
echo "Next steps:"
echo "  1. Add '.plan/' to the .gitignore of every repo you run /driver in (see snippets/gitignore.txt)"
echo "  2. Get started from a repo root in OpenCode: /driver ABC-123"
