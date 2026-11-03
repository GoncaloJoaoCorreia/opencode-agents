#!/bin/sh
# Unit tests for detect-forge.sh. Uses mktemp -d scratch git repos and stub CLI
# executables placed first on PATH. Requires: POSIX sh, git, python3.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/../detect-forge.sh"

command -v git >/dev/null 2>&1 || { echo "FAIL: git is required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: python3 is required" >&2; exit 1; }
[ -x "$SCRIPT" ] || { echo "FAIL: $SCRIPT missing or not executable" >&2; exit 1; }

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

# field <json-on-stdin> <key> — print a JSON field ("null" for JSON null)
field() {
  python3 -c 'import json,sys
d = json.loads(sys.stdin.read())
v = d[sys.argv[1]]
print("null" if v is None else v)' "$1"
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

N=0
REPO=""
new_repo() { # $1 = origin remote url; sets REPO
  N=$((N + 1))
  REPO="$WORK/repo$N"
  mkdir -p "$REPO"
  git -C "$REPO" init -q
  git -C "$REPO" remote add origin "$1"
}

# --- minimal PATH with no forge CLIs (git/sh/tr/sed/basename/timeout only) ----
MINBIN="$WORK/minbin"
mkdir -p "$MINBIN"
for t in git sh tr sed basename cat timeout; do
  p=$(command -v "$t" 2>/dev/null) && ln -s "$p" "$MINBIN/$t"
done

# --- stub dir with only a working gh -----------------------------------------
STUB_GH="$WORK/stub-gh"
mkdir -p "$STUB_GH"
cat > "$STUB_GH/gh" <<'EOF'
#!/bin/sh
case "$1 $2" in
  "auth status") exit 0 ;;
  "api user") exit 0 ;;
esac
exit 1
EOF
chmod +x "$STUB_GH/gh"

# --- stub dir with a FAILING glab (writes $MARKER) + a working gh -------------
STUB_ORDER="$WORK/stub-order"
mkdir -p "$STUB_ORDER"
cat > "$STUB_ORDER/glab" <<'EOF'
#!/bin/sh
: > "$MARKER"
exit 1
EOF
cat > "$STUB_ORDER/gh" <<'EOF'
#!/bin/sh
case "$1 $2" in
  "auth status") exit 0 ;;
  "api user") exit 0 ;;
esac
exit 1
EOF
chmod +x "$STUB_ORDER/glab" "$STUB_ORDER/gh"

# === known SaaS hosts (no CLI probing needed) ===
new_repo "https://github.com/foo/bar.git"
out=$("$SCRIPT" --repo "$REPO" --no-cache) || bad "github.com run exits 0"
f=$(printf '%s' "$out" | field forge); h=$(printf '%s' "$out" | field host); s=$(printf '%s' "$out" | field source)
[ "$f" = "github" ] && [ "$h" = "github.com" ] && [ "$s" = "probe" ] \
  && ok "https github.com -> forge=github host=github.com source=probe" \
  || bad "github.com mapping (forge=$f host=$h source=$s)"

out=$("$SCRIPT" --repo "$REPO" --remote-url "https://gitlab.com/foo/bar.git" --no-cache)
f=$(printf '%s' "$out" | field forge)
[ "$f" = "gitlab" ] && ok "gitlab.com -> gitlab" || bad "gitlab.com (forge=$f)"

out=$("$SCRIPT" --repo "$REPO" --remote-url "https://codeberg.org/foo/bar.git" --no-cache)
f=$(printf '%s' "$out" | field forge)
[ "$f" = "forgejo" ] && ok "codeberg.org -> forgejo" || bad "codeberg.org (forge=$f)"

# === ssh URL forms parse to the same host ===
out=$("$SCRIPT" --repo "$REPO" --remote-url "git@github.com:foo/bar.git" --no-cache)
h=$(printf '%s' "$out" | field host); f=$(printf '%s' "$out" | field forge)
[ "$h" = "github.com" ] && [ "$f" = "github" ] && ok "scp-like git@github.com:... -> host github.com" || bad "scp-like host (h=$h f=$f)"

out=$("$SCRIPT" --repo "$REPO" --remote-url "ssh://git@gitlab.com:2222/foo/bar.git" --no-cache)
h=$(printf '%s' "$out" | field host); f=$(printf '%s' "$out" | field forge)
[ "$h" = "gitlab.com" ] && [ "$f" = "gitlab" ] && ok "ssh:// with port -> host gitlab.com" || bad "ssh:// port host (h=$h f=$f)"

# === custom host + working gh stub -> github, cli=gh, cache written ===
new_repo "git@git.example.com:foo/bar.git"
out=$(PATH="$STUB_GH:$MINBIN" "$SCRIPT" --repo "$REPO")
f=$(printf '%s' "$out" | field forge); c=$(printf '%s' "$out" | field cli); s=$(printf '%s' "$out" | field source)
cached=$(git -C "$REPO" config --get driver.forge 2>/dev/null || true)
[ "$f" = "github" ] && [ "$c" = "gh" ] && [ "$s" = "probe" ] && [ "$cached" = "github" ] \
  && ok "custom host + stub gh -> github/cli=gh/source=probe, cache written" \
  || bad "custom-host gh probe (f=$f c=$c s=$s cached=$cached)"

# === probe order: failing glab tried first (marker), gh wins ===
new_repo "git@git.example.com:foo/bar.git"
out=$(PATH="$STUB_ORDER:$MINBIN" MARKER="$WORK/marker" "$SCRIPT" --repo "$REPO")
f=$(printf '%s' "$out" | field forge)
if [ "$f" = "github" ] && [ -f "$WORK/marker" ]; then
  ok "probe order glab-first observable, gh wins (forge=$f)"
else
  bad "probe order (forge=$f marker=$([ -f "$WORK/marker" ] && echo yes || echo no))"
fi

# === no CLI at all on custom host -> unknown, exit 0, cache NOT written ===
new_repo "git@git.example.com:foo/bar.git"
if out=$(PATH="$MINBIN" "$SCRIPT" --repo "$REPO" --no-cache 2>"$WORK/warn"); then
  f=$(printf '%s' "$out" | field forge); s=$(printf '%s' "$out" | field source)
  cached=$(git -C "$REPO" config --get driver.forge 2>/dev/null || true)
  if [ "$f" = "unknown" ] && [ "$s" = "probe" ] && [ -z "$cached" ] && [ -s "$WORK/warn" ]; then
    ok "no CLI on custom host -> forge=unknown exit=0, no cache, stderr warning"
  else
    bad "unknown-forge path (f=$f s=$s cached=$cached)"
  fi
else
  bad "unknown forge must still exit 0"
fi

# === --forge flag: source=flag + persisted ===
new_repo "https://github.com/foo/bar.git"
out=$("$SCRIPT" --repo "$REPO" --forge gitlab --remote-url "https://gitlab.com/foo/bar.git")
f=$(printf '%s' "$out" | field forge); s=$(printf '%s' "$out" | field source)
cached=$(git -C "$REPO" config --get driver.forge 2>/dev/null || true)
[ "$f" = "gitlab" ] && [ "$s" = "flag" ] && [ "$cached" = "gitlab" ] \
  && ok "--forge gitlab -> source=flag, cache persisted" \
  || bad "--forge flag (f=$f s=$s cached=$cached)"

# === cache hit: no CLIs on PATH, still gitlab from cache ===
out=$(PATH="$MINBIN" "$SCRIPT" --repo "$REPO")
f=$(printf '%s' "$out" | field forge); s=$(printf '%s' "$out" | field source); c=$(printf '%s' "$out" | field cli)
[ "$f" = "gitlab" ] && [ "$s" = "cache" ] && [ "$c" = "null" ] \
  && ok "cache hit without CLIs -> gitlab/cache/cli=null" \
  || bad "cache hit (f=$f s=$s c=$c)"

# === --no-cache: no cache read (github URL wins over cached gitlab), no write ===
out=$("$SCRIPT" --repo "$REPO" --no-cache --remote-url "https://github.com/foo/bar.git")
f=$(printf '%s' "$out" | field forge)
cached=$(git -C "$REPO" config --get driver.forge 2>/dev/null || true)
[ "$f" = "github" ] && [ "$cached" = "gitlab" ] \
  && ok "--no-cache ignores cache read and leaves cache unwritten" \
  || bad "--no-cache (f=$f cached=$cached)"

# === --no-cache + custom host probe: cache NOT written ===
new_repo "git@git.example.com:foo/bar.git"
out=$(PATH="$STUB_GH:$MINBIN" "$SCRIPT" --repo "$REPO" --no-cache)
f=$(printf '%s' "$out" | field forge)
cached=$(git -C "$REPO" config --get driver.forge 2>/dev/null || true)
[ "$f" = "github" ] && [ -z "$cached" ] \
  && ok "--no-cache probe success does not write cache" \
  || bad "--no-cache probe write (f=$f cached=$cached)"

# === --bogus: non-zero exit, usage on stderr, empty stdout ===
if out=$("$SCRIPT" --bogus 2>"$WORK/err"); then
  bad "--bogus must exit non-zero"
else
  ok "--bogus exits non-zero"
fi
[ -z "$out" ] && ok "--bogus keeps stdout empty" || bad "--bogus stdout not empty: $out"
[ -s "$WORK/err" ] && ok "--bogus prints usage on stderr" || bad "--bogus stderr empty"

# === --help: exit 0, usage on stdout ===
if "$SCRIPT" --help >"$WORK/help"; then
  [ -s "$WORK/help" ] && ok "--help exit 0 with usage on stdout" || bad "--help stdout empty"
else
  bad "--help must exit 0"
fi

# === stdout is a single parseable JSON line ===
new_repo "https://github.com/foo/bar.git"
out=$("$SCRIPT" --repo "$REPO" --no-cache)
if printf '%s' "$out" | python3 -c 'import json,sys; json.loads(sys.stdin.read())' 2>/dev/null \
   && [ "$out" = "$(printf '%s' "$out" | sed -n '1p')" ]; then
  ok "stdout is one parseable JSON line"
else
  bad "stdout not a single JSON line: $out"
fi

echo "detect-forge tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
