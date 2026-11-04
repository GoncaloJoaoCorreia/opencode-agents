#!/usr/bin/env python3
"""Unit tests for agent-context-check.py. Runs the script via subprocess in tmp dirs."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "agent-context-check.py")


def run(*args, cwd=None):
    return subprocess.run(
        [sys.executable, SCRIPT, *args], capture_output=True, text=True, cwd=cwd
    )


class RepoTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def w(self, relpath, content=b""):
        p = os.path.join(self.repo, relpath)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        mode = "wb" if isinstance(content, bytes) else "w"
        with open(p, mode) as f:
            f.write(content)
        return p

    def mkdir(self, relpath):
        os.makedirs(os.path.join(self.repo, relpath), exist_ok=True)

    def check(self, *extra):
        r = run("--repo", self.repo, *extra)
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = r.stdout.splitlines()
        self.assertEqual(len(lines), 1, f"stdout must be a single JSON line: {r.stdout!r}")
        return json.loads(lines[0])


class TestScriptItself(unittest.TestCase):
    def test_executable_with_shebang(self):
        self.assertTrue(os.access(SCRIPT, os.X_OK), "script must be executable")
        with open(SCRIPT, encoding="utf-8") as f:
            self.assertTrue(f.readline().startswith("#!"), "missing shebang")

    def test_help_exit_0_stdout(self):
        r = run("--help")
        self.assertEqual(r.returncode, 0)
        self.assertIn("usage", r.stdout.lower())
        self.assertEqual(r.stderr, "")

    def test_bad_flag_is_error(self):
        r = run("--bogus")
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")
        self.assertNotEqual(r.stderr, "")

    def test_unreadable_repo_is_error(self):
        missing = os.path.join(tempfile.gettempdir(), "agent-context-check-no-such-dir")
        r = run("--repo", missing)
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")
        self.assertNotEqual(r.stderr, "")


class TestScan(RepoTestCase):
    def test_empty_repo(self):
        out = self.check()
        self.assertEqual(out["limit_tokens"], 2000)
        self.assertEqual(out["files"], [])
        self.assertEqual(out["over_limit"], [])
        self.assertTrue(out["ok"])
        self.assertIn(out["repo"], {os.path.abspath(self.repo), os.path.realpath(self.repo)})

    def test_default_repo_is_cwd(self):
        self.w(".agent/history.md", "hello\n")
        r = run(cwd=self.repo)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual([f["path"] for f in out["files"]], [".agent/history.md"])

    def test_under_limit(self):
        self.w(".agent/history.md", "hello\n")  # 6 bytes
        out = self.check()
        self.assertTrue(out["ok"])
        self.assertEqual(out["over_limit"], [])
        self.assertEqual(len(out["files"]), 1)
        f = out["files"][0]
        self.assertEqual(f["path"], ".agent/history.md")
        self.assertEqual(f["lines"], 1)
        self.assertEqual(f["bytes"], 6)
        self.assertEqual(f["tokens_est"], 2)  # ceil(6/4)
        self.assertFalse(f["over_limit"])

    def test_boundary_exactly_2000_not_over(self):
        self.w(".agent/history.md", b"x" * 8000)  # ceil(8000/4) == 2000
        out = self.check()
        self.assertEqual(out["files"][0]["tokens_est"], 2000)
        self.assertFalse(out["files"][0]["over_limit"])
        self.assertTrue(out["ok"])
        self.assertEqual(out["over_limit"], [])

    def test_boundary_8001_bytes_is_over(self):
        self.w(".agent/history.md", b"x" * 8001)  # ceil(8001/4) == 2001
        r = run("--repo", self.repo)
        self.assertEqual(r.returncode, 0, r.stderr)  # over-limit is data, not an error
        out = json.loads(r.stdout)
        self.assertEqual(out["files"][0]["tokens_est"], 2001)
        self.assertTrue(out["files"][0]["over_limit"])
        self.assertFalse(out["ok"])
        self.assertEqual(out["over_limit"], [".agent/history.md"])

    def test_over_limit_9000_bytes_exit_0_ok_false(self):
        self.w(".agent/history.md", b"x" * 9000)
        r = run("--repo", self.repo)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('"ok": false', r.stdout)
        out = json.loads(r.stdout)
        self.assertEqual(out["files"][0]["tokens_est"], 2250)
        self.assertFalse(out["ok"])

    def test_ceil_rounding(self):
        for n, expected in ((1, 1), (4, 1), (5, 2), (7, 2), (9, 3)):
            with self.subTest(n=n):
                repo = tempfile.mkdtemp()
                try:
                    p = os.path.join(repo, ".agent", "decisions.md")
                    os.makedirs(os.path.dirname(p))
                    with open(p, "wb") as f:
                        f.write(b"x" * n)
                    out = json.loads(run("--repo", repo).stdout)
                    self.assertEqual(out["files"][0]["tokens_est"], expected)
                finally:
                    import shutil
                    shutil.rmtree(repo)

    def test_lines_count(self):
        self.w(".agent/decisions.md", "a\nb\nc")  # no trailing newline
        out = self.check()
        self.assertEqual(out["files"][0]["lines"], 3)

    def test_nested_modules_and_sort_order(self):
        self.w("z/.agent/history.md", "z\n")
        self.w("a/.agent/decisions.md", "a\n")
        self.w(".agent/history.md", "r\n")
        self.w("b/c/.agent/history.md", "b\n")
        out = self.check()
        self.assertEqual(
            [f["path"] for f in out["files"]],
            [".agent/history.md", "a/.agent/decisions.md", "b/c/.agent/history.md",
             "z/.agent/history.md"],
        )
        self.assertTrue(out["ok"])

    def test_excluded_dirs_are_not_scanned(self):
        big = b"x" * 9000
        for rel in (
            ".git/.agent/history.md",
            ".plan/G-1/.agent/history.md",
            "node_modules/m/.agent/decisions.md",
            "__pycache__/.agent/history.md",
            ".hidden/.agent/history.md",
            "sub/.git/.agent/history.md",
        ):
            self.w(rel, big)
        self.w(".agent/history.md", "small\n")
        out = self.check()
        self.assertEqual([f["path"] for f in out["files"]], [".agent/history.md"])
        self.assertTrue(out["ok"])
        self.assertEqual(out["over_limit"], [])

    def test_only_history_and_decisions_scanned(self):
        self.w(".agent/other.md", b"x" * 9000)
        self.w(".agent/history.md", "ok\n")
        out = self.check()
        self.assertEqual([f["path"] for f in out["files"]], [".agent/history.md"])

    def test_unreadable_file_skipped_with_stderr_note(self):
        # a broken symlink named history.md is listed as a file but open() fails
        # with an OSError — portable way to simulate an unreadable file
        self.mkdir(".agent")
        os.symlink("no-such-target", os.path.join(self.repo, ".agent", "history.md"))
        r = run("--repo", self.repo)
        self.assertEqual(r.returncode, 0)
        self.assertNotEqual(r.stderr, "")
        out = json.loads(r.stdout)
        self.assertEqual(out["files"], [])
        self.assertTrue(out["ok"])

    def test_over_limit_consistency(self):
        self.w("a/.agent/history.md", b"x" * 9000)
        self.w("b/.agent/decisions.md", "fine\n")
        out = self.check()
        self.assertEqual(
            out["over_limit"], [f["path"] for f in out["files"] if f["over_limit"]]
        )
        self.assertEqual(out["over_limit"], ["a/.agent/history.md"])
        self.assertFalse(out["ok"])


if __name__ == "__main__":
    unittest.main()
