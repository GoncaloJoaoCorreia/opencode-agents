#!/bin/sh
# qa-command.sh — own the repo-local QA-command cache `git config driver.qa` (G-24).
#
# The same pattern as detect-forge.sh owning `git config driver.forge`: this
# script is purely the cache MECHANISM (read `get` / persist `set`) for the
# confirmed QA command of a repo, so later /driver runs in the same repo don't
# have to ask the user again. Candidate detection and the precedence chain
# (--qa flag > cache > state > detect+ask) stay in agents/driver/preplan.md;
# the cache key lives in repo-local git config and is never committed.
#
# Prints exactly one JSON object on stdout (diagnostics go to stderr):
#   get: { "command": "<cmd>" | null, "source": "cache" }
#   set: { "command": "<cmd>", "source": "set" }
# `command` is null when `driver.qa` is unset (get always exits 0 then).
#
# Usage:
#   qa-command.sh get [--repo DIR]
#   qa-command.sh set [--repo DIR] (--command-file FILE | --command "STR")
#   qa-command.sh --help
#
# Flags:
#   --repo DIR           git repo to read/write config in (default: current
#                        directory); DIR must itself be a git repo (root or
#                        worktree — it must contain a .git entry; a plain
#                        subdirectory of a repo is rejected)
#   --command "STR"      the QA command to persist (exactly one of --command /
#                        --command-file)
#   --command-file FILE  read the QA command from FILE (primary input path for
#                        agents — command text is written to a file under
#                        .plan/<slug>/, never passed as argv by callers);
#                        exactly one trailing newline is trimmed
#   --help, -h           usage on stdout, exit 0
#
# Command validation (set): after trimming at most one trailing newline the
# command must be non-empty, single-line (no \n, \r, or any other control
# char) and at most 4096 chars. Any violation → exit 2, empty stdout, and the
# cache is NOT written.
#
# Exit codes: 0 = JSON emitted on stdout (get with an unset driver.qa prints
# "command": null and still exits 0); 2 = error (unknown flag/subcommand, not
# a git repo, missing/unreadable --command-file, both or neither of
# --command/--command-file, invalid command) with a message on stderr and
# EMPTY stdout.
#
# Requires: POSIX sh, git. No jq — JSON is emitted with printf + json_str.

set -u

PROG=$(basename "$0")

usage() {
  cat <<EOF
usage: $PROG get [--repo DIR]
       $PROG set [--repo DIR] (--command-file FILE | --command "STR")

Read (get) or persist (set) the repo-local QA-command cache 'git config
driver.qa' (never committed). Prints exactly one JSON object on stdout:
  get: { "command": "<cmd>" | null, "source": "cache" }
  set: { "command": "<cmd>", "source": "set" }

Options:
  get              print the cached command (null when driver.qa is unset), exit 0
  set              validate + persist the command to 'git config driver.qa'
  --repo DIR       git repo to use (default: cwd); DIR must itself be a git
                   repo (root/worktree with a .git entry), not a subdirectory
  --command STR    the command to persist (exactly one of --command/--command-file)
  --command-file FILE  read the command from FILE (one trailing newline trimmed)
  --help, -h       show this help on stdout, exit 0

Set validation: non-empty, single-line (no control chars), <= 4096 chars;
violations exit 2 with empty stdout and do not write the cache.

Exit codes: 0 = JSON on stdout; 2 = error, message + usage on stderr, stdout
stays empty.
EOF
}

die() {
  echo "$PROG: $1" >&2
  exit 2
}

# json_str <s> — minimal JSON string escaping: strip control chars/newlines,
# escape backslash and double quote. No jq needed.
json_str() {
  printf '%s' "$1" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# --- subcommand ----------------------------------------------------------------

[ $# -ge 1 ] || { usage >&2; die "missing subcommand (get|set)"; }

case "$1" in
  get|set)
    SUB=$1; shift ;;
  --help|-h)
    usage; exit 0 ;;
  *)
    echo "$PROG: unknown subcommand/flag: $1" >&2
    usage >&2
    exit 2 ;;
esac

# --- argument parsing ----------------------------------------------------------

REPO="."
CMD=""
CMD_FILE=""
CMD_GIVEN=0
FILE_GIVEN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      [ $# -ge 2 ] || die "--repo needs a value"
      REPO=$2; shift 2 ;;
    --repo=*)
      REPO=${1#--repo=}; shift ;;
    --command)
      [ $# -ge 2 ] || die "--command needs a value"
      CMD=$2; CMD_GIVEN=1; shift 2 ;;
    --command=*)
      CMD=${1#--command=}; CMD_GIVEN=1; shift ;;
    --command-file)
      [ $# -ge 2 ] || die "--command-file needs a value"
      CMD_FILE=$2; FILE_GIVEN=1; shift 2 ;;
    --command-file=*)
      CMD_FILE=${1#--command-file=}; FILE_GIVEN=1; shift ;;
    --help|-h)
      usage; exit 0 ;;
    *)
      echo "$PROG: unknown flag: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

if [ "$SUB" = "get" ] && { [ "$CMD_GIVEN" -eq 1 ] || [ "$FILE_GIVEN" -eq 1 ]; }; then
  die "--command/--command-file are only valid with set"
fi

# --- repo check ------------------------------------------------------------------
# DIR must itself be a git repo (root or linked worktree, i.e. contain a .git
# entry) — `git -C <subdir> rev-parse` would happily resolve the PARENT repo's
# .git, so the .git entry is checked explicitly and a plain subdirectory of a
# repo is rejected.

[ -e "$REPO/.git" ] || die "not a git repo: $REPO"
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repo: $REPO"

# --- get -------------------------------------------------------------------------

if [ "$SUB" = "get" ]; then
  CACHED=$(git -C "$REPO" config --get driver.qa 2>/dev/null || true)
  if [ -n "$CACHED" ]; then
    printf '{ "command": "%s", "source": "cache" }\n' "$(json_str "$CACHED")"
  else
    printf '{ "command": null, "source": "cache" }\n'
  fi
  exit 0
fi

# --- set -------------------------------------------------------------------------

if [ "$CMD_GIVEN" -eq 1 ] && [ "$FILE_GIVEN" -eq 1 ]; then
  die "pass exactly one of --command / --command-file"
fi
if [ "$CMD_GIVEN" -eq 0 ] && [ "$FILE_GIVEN" -eq 0 ]; then
  die "pass exactly one of --command / --command-file"
fi

if [ "$FILE_GIVEN" -eq 1 ]; then
  { [ -f "$CMD_FILE" ] && [ -r "$CMD_FILE" ]; } || die "unreadable --command-file: $CMD_FILE"
  # read the file verbatim (sentinel x keeps trailing newlines from being
  # stripped by the command substitution)
  CMD=$(cat "$CMD_FILE" 2>/dev/null; printf x) || die "cannot read --command-file: $CMD_FILE"
  CMD=${CMD%x}
fi

# trim at most one trailing newline
NL='
'
case "$CMD" in
  *"$NL") CMD=${CMD%"$NL"} ;;
esac

# validation: non-empty, <= 4096 chars, single-line (no control chars at all)
[ -n "$CMD" ] || die "command must be non-empty"
[ "${#CMD}" -le 4096 ] || die "command is longer than 4096 chars"
CLEAN=$(printf '%s' "$CMD" | tr -d '\000-\037\177'; printf x)
CLEAN=${CLEAN%x}
[ "$CMD" = "$CLEAN" ] || die "command must be single-line without control characters"

# persist (single-valued: replaces any previous value); the command is only
# ever used as a quoted shell variable, never interpolated into a command
git -C "$REPO" config driver.qa "$CMD" || die "failed to write driver.qa in $REPO"

printf '{ "command": "%s", "source": "set" }\n' "$(json_str "$CMD")"
exit 0
