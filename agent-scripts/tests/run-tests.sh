#!/bin/sh
# Runs the agent-scripts unit suites plus syntax checks for both scripts.
# Hard prerequisites (fail loudly when absent): POSIX sh, git, python3.
# Usage (from the repo root): sh agent-scripts/tests/run-tests.sh
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)

command -v python3 >/dev/null 2>&1 || { echo "FAIL: python3 is required" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "FAIL: git is required" >&2; exit 1; }

echo "== syntax checks =="
sh -n "$ROOT/detect-forge.sh"
echo "ok: sh -n detect-forge.sh"
python3 -m py_compile "$ROOT/driver-state.py"
echo "ok: py_compile driver-state.py"
python3 -m py_compile "$ROOT/detect-modules.py"
echo "ok: py_compile detect-modules.py"

echo "== detect-forge tests =="
sh "$HERE/test-detect-forge.sh"
echo "ok: detect-forge tests"

echo "== driver-state tests =="
python3 "$HERE/test-driver-state.py"
echo "ok: driver-state tests"

echo "== detect-modules tests =="
python3 "$HERE/test-detect-modules.py"
echo "ok: detect-modules tests"

echo "== all agent-scripts tests passed =="
