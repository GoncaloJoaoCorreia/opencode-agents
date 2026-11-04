#!/bin/sh
# Unit tests for qa-command.sh. Uses mktemp -d scratch git repos and python3
# for JSON assertions. Requires: POSIX sh, git, python3.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/../qa-command.sh"

command -v git >/dev/null 2>&1 || { echo "FAIL: git is required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: python3 is required" >&2; exit 1; }
[ -x "$SCRIPT" ] || { echo "FAIL: $SCRIPT missing or not executable" >&2; exit 1; }

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

# field <key> — read one JSON object from stdin, print the field ("null" for null)
field() {
  python3 -c 'import json,sys
d = json.loads(sys.stdin.read())
v = d[sys.argv[1]]
print("null" if v is None else v)' "$1"
}

# run_fail <desc> -- cmd... — assert exit 2, empty stdout, non-empty stderr
run_fail() {
  _desc=$1; shift
  _out=$("$@" 2>"$WORK/err"); _rc=$?
  if [ "$_rc" -eq 2 ] && [ -z "$_out" ] && [ -s "$WORK/err" ]; then
    ok "$_desc"
  else
    bad "$_desc (rc=$_rc stdout='$_out' stderr='$(cat "$WORK/err")')"
  fi
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

REPO="$WORK/repo"
NOTREPO="$WORK/notrepo"
mkdir -p "$REPO" "$NOTREPO"
git -C "$REPO" init -q

cache_get() { git -C "$REPO" config --get driver.qa 2>/dev/null || true; }
cache_unset() { [ -z "$(cache_get)" ]; }

# === 1. get on a fresh repo: exit 0, one JSON line, command null, source cache ===
out=$("$SCRIPT" get --repo "$REPO") || bad "get on fresh repo must exit 0"
c=$(printf '%s' "$out" | field command); s=$(printf '%s' "$out" | field source)
[ "$c" = "null" ] && [ "$s" = "cache" ] \
  && ok "get fresh repo -> command=null source=cache" \
  || bad "get fresh repo (command=$c source=$s)"

# === 2. set --command-file with a nasty string: round-trip + JSON stdout ===
NASTY='echo "a $b" && make test `date` | tee "out.log"'
printf '%s\n' "$NASTY" > "$WORK/nasty.txt"
out=$("$SCRIPT" set --repo "$REPO" --command-file "$WORK/nasty.txt") \
  || bad "set --command-file must exit 0"
git -C "$REPO" config --get driver.qa > "$WORK/got.txt"
printf '%s\n' "$NASTY" > "$WORK/want.txt"
cmp -s "$WORK/got.txt" "$WORK/want.txt" \
  && ok "git config driver.qa round-trips the nasty string byte-identical" \
  || bad "git config round-trip mismatch"
c=$(printf '%s' "$out" | field command); s=$(printf '%s' "$out" | field source)
[ "$c" = "$NASTY" ] && [ "$s" = "set" ] \
  && ok "set stdout echoes command, source=set" \
  || bad "set stdout (command=$c source=$s)"
got=$("$SCRIPT" get --repo "$REPO" | field command)
[ "$got" = "$NASTY" ] \
  && ok "get returns the nasty string as escaped single-line JSON" \
  || bad "get after nasty set (got=$got)"

# === 3. set --command "..." round-trip ===
NASTY2='sh -c "echo hi && echo bye" $HOME `id -u`'
"$SCRIPT" set --repo "$REPO" --command "$NASTY2" >/dev/null \
  || bad "set --command must exit 0"
[ "$(cache_get)" = "$NASTY2" ] \
  && ok "set --command round-trips through git config" \
  || bad "set --command round-trip (got='$(cache_get)')"

# === 4. get after set: command matches, source == cache ===
out=$("$SCRIPT" get --repo "$REPO")
c=$(printf '%s' "$out" | field command); s=$(printf '%s' "$out" | field source)
[ "$c" = "$NASTY2" ] && [ "$s" = "cache" ] \
  && ok "get after set -> command matches, source=cache" \
  || bad "get after set (command=$c source=$s)"

# === 5. empty command file: exit 2, empty stdout, cache not written ===
git -C "$REPO" config --unset driver.qa 2>/dev/null || true
: > "$WORK/empty.txt"
run_fail "empty command file -> exit 2, empty stdout" \
  "$SCRIPT" set --repo "$REPO" --command-file "$WORK/empty.txt"
cache_unset && ok "cache still unset after empty command" || bad "cache written despite empty command"

# === 6. multi-line command file (a\nb): exit 2, cache not written ===
printf 'a\nb\n' > "$WORK/multi.txt"
run_fail "multi-line command file -> exit 2" \
  "$SCRIPT" set --repo "$REPO" --command-file "$WORK/multi.txt"
cache_unset && ok "cache not written after multi-line" || bad "cache written despite multi-line"

# === 7. oversized command (>4096 chars): exit 2 ===
python3 -c 'print("x" * 5000)' > "$WORK/big.txt"
run_fail "command > 4096 chars -> exit 2" \
  "$SCRIPT" set --repo "$REPO" --command-file "$WORK/big.txt"
cache_unset && ok "cache not written after oversized command" || bad "cache written despite oversized command"
# boundary: exactly 4096 chars is accepted
python3 -c 'print("x" * 4096)' > "$WORK/max.txt"
"$SCRIPT" set --repo "$REPO" --command-file "$WORK/max.txt" >/dev/null \
  && [ "$(cache_get)" = "$(python3 -c 'print("x" * 4096)')" ] \
  && ok "exactly 4096 chars accepted" || bad "4096-char boundary"
git -C "$REPO" config --unset driver.qa 2>/dev/null || true

# === 8. command containing \r: exit 2 ===
printf 'a\rb\n' > "$WORK/cr.txt"
run_fail "CR in command file -> exit 2" \
  "$SCRIPT" set --repo "$REPO" --command-file "$WORK/cr.txt"
run_fail "CR via --command -> exit 2" \
  "$SCRIPT" set --repo "$REPO" --command "$(printf 'a\rb')"
cache_unset && ok "cache not written after CR command" || bad "cache written despite CR"

# === 9. both --command and --command-file: exit 2 ===
run_fail "both --command and --command-file -> exit 2" \
  "$SCRIPT" set --repo "$REPO" --command 'a' --command-file "$WORK/multi.txt"

# === 10. neither --command nor --command-file: exit 2 ===
run_fail "neither --command nor --command-file -> exit 2" \
  "$SCRIPT" set --repo "$REPO"

# === 10b. empty --command string: exit 2 ===
run_fail "empty --command -> exit 2" "$SCRIPT" set --repo "$REPO" --command ''

# === 10c. missing/unreadable --command-file: exit 2 ===
run_fail "missing --command-file -> exit 2" \
  "$SCRIPT" set --repo "$REPO" --command-file "$WORK/does-not-exist.txt"

# === 11. --repo pointing at a non-repo dir: exit 2, empty stdout (get + set) ===
run_fail "get --repo non-repo -> exit 2, empty stdout" "$SCRIPT" get --repo "$NOTREPO"
run_fail "set --repo non-repo -> exit 2, empty stdout" \
  "$SCRIPT" set --repo "$NOTREPO" --command 'make test'
# a plain SUBDIRECTORY of a repo is not a repo either (git would resolve the
# parent's .git upward)
SUBDIR="$REPO/subdir"
mkdir -p "$SUBDIR"
run_fail "get --repo subdir-of-repo -> exit 2, empty stdout" "$SCRIPT" get --repo "$SUBDIR"
run_fail "set --repo subdir-of-repo -> exit 2, empty stdout" \
  "$SCRIPT" set --repo "$SUBDIR" --command 'make test'
# a linked worktree (has a .git FILE) is accepted
if git -C "$REPO" worktree add -q "$WORK/wt" 2>/dev/null; then
  out=$("$SCRIPT" get --repo "$WORK/wt") \
    && ok "linked worktree root accepted as repo (get exits 0)" \
    || bad "worktree root rejected"
else
  echo "skip: git worktree add unavailable"
fi

# === 12. unknown flag / unknown subcommand: exit 2, empty stdout ===
run_fail "unknown flag -> exit 2, empty stdout" "$SCRIPT" get --repo "$REPO" --bogus
run_fail "unknown subcommand -> exit 2, empty stdout" "$SCRIPT" frobnicate

# === 13. --help: exit 0, usage on stdout ===
if "$SCRIPT" --help > "$WORK/help" 2>/dev/null; then
  [ -s "$WORK/help" ] && ok "--help exit 0 with usage on stdout" || bad "--help stdout empty"
else
  bad "--help must exit 0"
fi
if "$SCRIPT" -h > "$WORK/help2" 2>/dev/null; then
  [ -s "$WORK/help2" ] && ok "-h exit 0 with usage on stdout" || bad "-h stdout empty"
else
  bad "-h must exit 0"
fi

# === 14. success stdout is exactly one line and parses as JSON ===
out=$("$SCRIPT" get --repo "$REPO")
if printf '%s' "$out" | python3 -c 'import json,sys; json.loads(sys.stdin.read())' 2>/dev/null \
   && [ "$out" = "$(printf '%s' "$out" | sed -n '1p')" ]; then
  ok "get stdout is one parseable JSON line"
else
  bad "get stdout not a single JSON line: $out"
fi
out=$("$SCRIPT" set --repo "$REPO" --command 'make test')
if printf '%s' "$out" | python3 -c 'import json,sys; json.loads(sys.stdin.read())' 2>/dev/null \
   && [ "$out" = "$(printf '%s' "$out" | sed -n '1p')" ]; then
  ok "set stdout is one parseable JSON line"
else
  bad "set stdout not a single JSON line: $out"
fi

# === 15. trailing newline handling: one trimmed, two = multi-line -> exit 2 ===
printf 'make test\n' > "$WORK/one.txt"
"$SCRIPT" set --repo "$REPO" --command-file "$WORK/one.txt" >/dev/null \
  && [ "$(cache_get)" = "make test" ] \
  && ok "single trailing newline in --command-file is trimmed" \
  || bad "single trailing newline (got='$(cache_get)')"
printf 'make test\n\n' > "$WORK/two.txt"
run_fail "double trailing newline -> multi-line -> exit 2" \
  "$SCRIPT" set --repo "$REPO" --command-file "$WORK/two.txt"

echo "qa-command tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
