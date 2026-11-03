#!/usr/bin/env python3
"""Unit tests for driver-state.py. Runs the script via subprocess in tmp dirs."""

import glob
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "driver-state.py")


def run(*args):
    return subprocess.run(
        [sys.executable, SCRIPT, *args], capture_output=True, text=True
    )


def minimal_state():
    return {
        "version": 1,
        "issue_id": "G-20",
        "repo_root": "/tmp/repo",
        "plan_dir": ".plan/G-20",
        "branch": "feat/G-20",
        "created_at": "2026-11-03T16:25:23Z",
        "params": {"skip": []},
        "phases": {"preplan": {"status": "done"}},
        "plan": {"manifest": ".plan/G-20/manifest.json", "tasks": []},
        "warnings": ["w1", "w2"],
    }


class DriverStateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.plan_dir = os.path.join(self.dir, ".plan", "G-20")
        os.makedirs(self.plan_dir)
        self.state = os.path.join(self.plan_dir, "state.json")
        self.write_state(minimal_state())

    def tearDown(self):
        self.tmp.cleanup()

    def write_state(self, obj, plan=".plan/G-20"):
        d = os.path.join(self.dir, plan)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "state.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(obj, f)
        return p

    def read_state(self, path=None):
        with open(path or self.state, "r", encoding="utf-8") as f:
            return json.load(f)

    # --- validate -----------------------------------------------------------

    def test_validate_ok(self):
        r = run("validate", "G-20", self.state)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("ok", r.stdout)

    def test_validate_rejects_bad_slugs(self):
        for slug in ["../evil", "g-20", "G-20/../../x", "G20", "", "A-", "a-1"]:
            r = run("validate", slug, self.state)
            self.assertNotEqual(r.returncode, 0, f"slug {slug!r} must be rejected")
            self.assertEqual(r.stdout, "")
            self.assertTrue(r.stderr.strip())

    def test_validate_rejects_missing_keys(self):
        state = minimal_state()
        del state["phases"]
        p = self.write_state(state)
        r = run("validate", "G-20", p)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("phases", r.stderr)

    def test_validate_rejects_invalid_json(self):
        with open(self.state, "w", encoding="utf-8") as f:
            f.write("{not json")
        r = run("validate", "G-20", self.state)
        self.assertNotEqual(r.returncode, 0)

    def test_validate_rejects_non_object(self):
        p = self.write_state([1, 2, 3])
        r = run("validate", "G-20", p)
        self.assertNotEqual(r.returncode, 0)

    # --- set / get ----------------------------------------------------------

    def test_set_get_roundtrip_nested_creation(self):
        r = run("set", self.state, "phases.implement.status", '"done"')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("ok: set phases.implement.status", r.stdout)
        r = run("get", self.state, "phases.implement.status")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), '"done"')
        # pre-existing sibling untouched
        r = run("get", self.state, "phases.preplan.status")
        self.assertEqual(r.stdout.strip(), '"done"')

    def test_set_overwrites_and_creates_deep(self):
        run("set", self.state, "a.b.c", "[1, 2]")
        r = run("get", self.state, "a.b.c.1")
        self.assertEqual(r.stdout.strip(), "2")

    def test_push_appends_and_creates_array(self):
        r = run("push", self.state, "implement.runs", '{"mode": "task"}')
        self.assertEqual(r.returncode, 0, r.stderr)
        run("push", self.state, "implement.runs", '{"mode": "fix"}')
        r = run("get", self.state, "implement.runs.0.mode")
        self.assertEqual(r.stdout.strip(), '"task"')
        r = run("get", self.state, "implement.runs.1.mode")
        self.assertEqual(r.stdout.strip(), '"fix"')

    def test_get_numeric_index_into_existing_array(self):
        run("push", self.state, "plan.tasks", '{"id": "agent-scripts"}')
        r = run("get", self.state, "plan.tasks.0.id")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), '"agent-scripts"')

    # --- merge --------------------------------------------------------------

    def test_merge_deep_merges_and_never_deletes(self):
        patch = os.path.join(self.dir, "patch.json")
        with open(patch, "w", encoding="utf-8") as f:
            json.dump({"plan": {"tasks": []}, "phases": {"implement": {"status": "done"}}}, f)
        r = run("merge", self.state, patch)
        self.assertEqual(r.returncode, 0, r.stderr)
        data = self.read_state()
        self.assertEqual(data["plan"]["tasks"], [])
        self.assertEqual(data["plan"]["manifest"], ".plan/G-20/manifest.json")  # kept
        self.assertEqual(data["phases"]["implement"]["status"], "done")  # merged in
        self.assertEqual(data["phases"]["preplan"]["status"], "done")  # kept
        self.assertEqual(data["warnings"], ["w1", "w2"])  # untouched

    def test_merge_scalar_and_array_replace(self):
        patch = os.path.join(self.dir, "patch.json")
        with open(patch, "w", encoding="utf-8") as f:
            json.dump({"version": 2, "warnings": ["only"]}, f)
        run("merge", self.state, patch)
        data = self.read_state()
        self.assertEqual(data["version"], 2)
        self.assertEqual(data["warnings"], ["only"])

    # --- path-traversal guard -------------------------------------------------

    def test_bad_plan_slug_path_rejected(self):
        bad = self.write_state(minimal_state(), plan=".plan/bad_slug")
        r = run("set", bad, "phases.plan.status", '"done"')
        self.assertNotEqual(r.returncode, 0)
        self.assertTrue(r.stderr.strip())
        patch = os.path.join(self.dir, "patch.json")
        with open(patch, "w", encoding="utf-8") as f:
            json.dump({"x": 1}, f)
        r = run("merge", bad, patch)
        self.assertNotEqual(r.returncode, 0)
        # file untouched
        self.assertEqual(self.read_state(bad), minimal_state())

    # --- atomicity ------------------------------------------------------------

    def test_atomic_write_leaves_no_tmp_files(self):
        run("set", self.state, "phases.plan.status", '"done"')
        leftovers = glob.glob(os.path.join(self.plan_dir, "*.tmp-*"))
        self.assertEqual(leftovers, [])
        # original file was replaced (still valid JSON with the new key)
        self.assertEqual(self.read_state()["phases"]["plan"]["status"], "done")

    # --- error paths ------------------------------------------------------------

    def test_missing_file(self):
        r = run("get", os.path.join(self.dir, "nope.json"), "version")
        self.assertNotEqual(r.returncode, 0)
        self.assertTrue(r.stderr.strip())

    def test_invalid_json_value_arg(self):
        r = run("set", self.state, "phases.plan.status", "not-json{")
        self.assertNotEqual(r.returncode, 0)
        self.assertTrue(r.stderr.strip())

    def test_get_missing_path_exit_1(self):
        r = run("get", self.state, "plan.tasks.5.id")
        self.assertEqual(r.returncode, 1)
        self.assertTrue(r.stderr.strip())
        r = run("get", self.state, "does.not.exist")
        self.assertEqual(r.returncode, 1)

    def test_help(self):
        r = run("--help")
        self.assertEqual(r.returncode, 0)
        self.assertIn("usage", r.stdout)
        r = run("bogus-command")
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
