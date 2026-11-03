#!/bin/sh
# detect-forge.sh — detect the git forge of a repo's origin remote.
#
# Mirrors skills/driver-conventions/SKILL.md §7.1 exactly (parity with the
# inline logic in agents/driver/preplan.md step 4 / agents/driver/pr.md step 3):
#   precedence: --forge flag > cached `git config driver.forge` > probe
#   known SaaS hosts map directly: github.com -> github, gitlab.com -> gitlab,
#     codeberg.org -> forgejo
#   custom host: probe installed CLIs in order glab -> forgejo-cli/fj -> gh;
#     the first that is installed, authenticated AND answers its user API wins
#   only probe successes are cached; failures are NOT cached
#
# Prints exactly one JSON object on stdout (diagnostics go to stderr):
#   { "url": "...", "host": "...", "forge": "github|gitlab|forgejo|unknown",
#     "cli": "gh|glab|fj|null", "source": "flag|cache|probe" }
#
# Flags:
#   --forge github|gitlab|forgejo   use this forge (source=flag); persisted to
#                                   repo-local `git config driver.forge`
#   --remote-url <url>              override `git remote get-url origin`
#   --repo <dir>                    git repo to use (default: current directory)
#   --no-cache                      do NOT read AND do NOT write the driver.forge
#                                   cache (pure probe; also suppresses the
#                                   --forge persist)
#   --help                          usage on stdout, exit 0
#
# Exit codes: 0 = JSON emitted on stdout (forge may be "unknown" — that is a
# valid result); 2 = error (unknown flag, unreadable repo, no origin remote)
# with a message on stderr and empty stdout.
#
# Requires: POSIX sh, git. No jq — JSON is emitted with printf.

set -u

PROG=$(basename "$0")

usage() {
  cat <<EOF
usage: $PROG [--forge github|gitlab|forgejo] [--remote-url URL] [--repo DIR] [--no-cache]

Detect the forge of a git repo's origin remote and print one JSON object on
stdout: { "url": "...", "host": "...", "forge": "github|gitlab|forgejo|unknown",
"cli": "gh|glab|fj|null", "source": "flag|cache|probe" }

Options:
  --forge FORGE    use FORGE (github|gitlab|forgejo), source=flag; persisted to
                   repo-local 'git config driver.forge' (unless --no-cache)
  --remote-url URL override 'git remote get-url origin' (testability)
  --repo DIR       git repo to read remote/config from (default: cwd)
  --no-cache       neither read nor write the driver.forge cache (pure probe)
  --help           show this help on stdout, exit 0

Exit codes: 0 = JSON on stdout (forge may be "unknown"); 2 = error, message on
stderr, stdout stays empty.
EOF
}

die() {
  echo "$PROG: $1" >&2
  exit 2
}

# --- argument parsing --------------------------------------------------------

FORGE_FLAG=""
REMOTE_URL=""
REPO="."
NO_CACHE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --forge)
      [ $# -ge 2 ] || die "--forge needs a value"
      FORGE_FLAG=$2; shift 2 ;;
    --forge=*)
      FORGE_FLAG=${1#--forge=}; shift ;;
    --remote-url)
      [ $# -ge 2 ] || die "--remote-url needs a value"
      REMOTE_URL=$2; shift 2 ;;
    --remote-url=*)
      REMOTE_URL=${1#--remote-url=}; shift ;;
    --repo)
      [ $# -ge 2 ] || die "--repo needs a value"
      REPO=$2; shift 2 ;;
    --repo=*)
      REPO=${1#--repo=}; shift ;;
    --no-cache)
      NO_CACHE=1; shift ;;
    --help|-h)
      usage; exit 0 ;;
    *)
      echo "$PROG: unknown flag: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

valid_forge() {
  case "$1" in
    github|gitlab|forgejo) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -n "$FORGE_FLAG" ] && ! valid_forge "$FORGE_FLAG"; then
  die "invalid --forge value: $FORGE_FLAG (want github|gitlab|forgejo)"
fi

# --- repo + remote url -------------------------------------------------------

git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repo: $REPO"

if [ -n "$REMOTE_URL" ]; then
  URL=$REMOTE_URL
else
  URL=$(git -C "$REPO" remote get-url origin 2>/dev/null) \
    || die "no origin remote in $REPO (pass --remote-url)"
fi

# --- host parsing ------------------------------------------------------------
# Handles https://[user@]host[:port]/path, ssh://git@host[:port]/path and
# scp-like git@host:path forms.

parse_host() {
  _url=$1
  case "$_url" in
    *://*)
      _rest=${_url#*://}   # strip scheme
      _rest=${_rest#*@}    # strip user@
      _host=${_rest%%/*}   # cut at first / (path)
      _host=${_host%%:*}   # cut at : (port)
      ;;
    *)
      _rest=${_url#*@}     # scp-like git@host:owner/repo.git
      _host=${_rest%%:*}
      ;;
  esac
  printf '%s' "$_host"
}

HOST=$(parse_host "$URL")

# --- helpers -----------------------------------------------------------------

# json_str <s> — minimal JSON string escaping for the url/host fields: strip
# control chars/newlines, escape backslash and double quote. No jq needed.
json_str() {
  printf '%s' "$1" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# cli_for_forge <forge> — resolve the winning forge's CLI via command -v
# ("fj" = forgejo-cli, whichever binary name exists), else "null".
cli_for_forge() {
  case "$1" in
    github)  if command -v gh >/dev/null 2>&1; then echo gh; else echo null; fi ;;
    gitlab)  if command -v glab >/dev/null 2>&1; then echo glab; else echo null; fi ;;
    forgejo) if command -v forgejo-cli >/dev/null 2>&1 || command -v fj >/dev/null 2>&1; then echo fj; else echo null; fi ;;
    *) echo null ;;
  esac
}

# probe_cli <bin> — true when <bin> is installed, authenticated and answers its
# user API. Wrapped in `timeout 10` when timeout exists (harness safety); a
# probe against the wrong forge fails fast on its own.
probe_cli() {
  _bin=$1
  command -v "$_bin" >/dev/null 2>&1 || return 1
  if command -v timeout >/dev/null 2>&1; then
    timeout 10 "$_bin" auth status >/dev/null 2>&1 \
      && timeout 10 "$_bin" api user >/dev/null 2>&1
  else
    "$_bin" auth status >/dev/null 2>&1 && "$_bin" api user >/dev/null 2>&1
  fi
}

fj_binary() {
  if command -v forgejo-cli >/dev/null 2>&1; then echo forgejo-cli
  elif command -v fj >/dev/null 2>&1; then echo fj
  fi
}

# --- detection: flag > cache > probe ------------------------------------------

FORGE=""
SOURCE=""

if [ -n "$FORGE_FLAG" ]; then
  FORGE=$FORGE_FLAG
  SOURCE=flag
  if [ "$NO_CACHE" -eq 0 ]; then
    git -C "$REPO" config driver.forge "$FORGE"
  fi
elif [ "$NO_CACHE" -eq 0 ]; then
  CACHED=$(git -C "$REPO" config --get driver.forge 2>/dev/null || true)
  if valid_forge "$CACHED"; then
    FORGE=$CACHED
    SOURCE=cache
  fi
fi

if [ -z "$FORGE" ]; then
  # probe
  case "$HOST" in
    github.com)   FORGE=github ;;
    gitlab.com)   FORGE=gitlab ;;
    codeberg.org) FORGE=forgejo ;;
    *)
      if probe_cli glab; then
        FORGE=gitlab
      else
        FJBIN=$(fj_binary)
        if [ -n "$FJBIN" ] && probe_cli "$FJBIN"; then
          FORGE=forgejo
        elif probe_cli gh; then
          FORGE=github
        else
          FORGE=unknown
        fi
      fi
      ;;
  esac
  SOURCE=probe
  if [ "$FORGE" != unknown ]; then
    if [ "$NO_CACHE" -eq 0 ]; then
      git -C "$REPO" config driver.forge "$FORGE"
    fi
  else
    echo "$PROG: warning: could not identify the forge of host '$HOST' — pass --forge, or authenticate the matching CLI (e.g. glab auth login) so the next run can probe it" >&2
  fi
fi

CLI=$(cli_for_forge "$FORGE")
case "$CLI" in
  null) CLI_JSON=null ;;
  *)    CLI_JSON="\"$CLI\"" ;;
esac

printf '{ "url": "%s", "host": "%s", "forge": "%s", "cli": %s, "source": "%s" }\n' \
  "$(json_str "$URL")" "$(json_str "$HOST")" "$FORGE" "$CLI_JSON" "$SOURCE"
exit 0
