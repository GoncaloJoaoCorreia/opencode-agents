#!/usr/bin/env python3
"""Unit tests for detect-modules.py. Runs the script via subprocess in tmp dirs."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "detect-modules.py")


def run(*args):
    return subprocess.run(
        [sys.executable, SCRIPT, *args], capture_output=True, text=True
    )


class RepoTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def w(self, relpath, content=""):
        p = os.path.join(self.repo, relpath)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
        return p

    def mkdir(self, relpath):
        os.makedirs(os.path.join(self.repo, relpath), exist_ok=True)

    def modules(self, *extra):
        r = run("--repo", self.repo, "modules", *extra)
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = r.stdout.splitlines()
        self.assertEqual(len(lines), 1, f"stdout must be a single JSON line: {r.stdout!r}")
        return json.loads(lines[0])

    def dirs(self, *extra):
        out = self.modules(*extra)
        return out["build_system"], [m["dir"] for m in out["modules"]]

    def map(self, *files):
        r = run("--repo", self.repo, "map", *files)
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

    def test_no_args_is_error(self):
        r = run()
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")
        self.assertNotEqual(r.stderr, "")

    def test_bad_flag_is_error(self):
        r = run("--bogus", "modules")
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")
        self.assertNotEqual(r.stderr, "")

    def test_missing_repo_is_error(self):
        r = run("--repo", "/nonexistent/path/xyz", "modules")
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")
        self.assertNotEqual(r.stderr, "")

    def test_map_without_files_is_error(self):
        r = run("--repo", os.getcwd(), "map")
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")


class TestGradle(RepoTestCase):
    def test_groovy_includes_with_comments(self):
        self.w("settings.gradle", """
            // root comment mentioning include 'fake'
            rootProject.name = 'demo'
            /* block comment include 'alsofake' */
            include 'module1', 'module2'
            include 'solo'
        """)
        build, dirs = self.dirs()
        self.assertEqual(build, "gradle")
        self.assertEqual(dirs, ["module1", "module2", "solo"])

    def test_kotlin_dsl_includes(self):
        self.w("settings.gradle.kts", """
            // include("fake")
            rootProject.name = "demo"
            include("app", "core")
            include(":lib")
        """)
        build, dirs = self.dirs()
        self.assertEqual(build, "gradle")
        self.assertEqual(dirs, ["app", "core", "lib"])

    def test_project_dir_override(self):
        self.w("settings.gradle", """
            include ':app', ':core'
            project(':app').projectDir = file('apps/app')
        """)
        build, dirs = self.dirs()
        self.assertEqual(build, "gradle")
        self.assertEqual(dirs, ["apps/app", "core"])

    def test_nested_include_and_map(self):
        self.w("settings.gradle", "include ':a:b'\n")
        self.mkdir("a/b/moreCodeFolder")
        self.w("a/b/moreCodeFolder/x.ts", "// code\n")
        self.w("README.md", "# demo\n")
        build, dirs = self.dirs()
        self.assertEqual(build, "gradle")
        self.assertEqual(dirs, ["a/b"])
        m = self.map("a/b/moreCodeFolder/x.ts", "README.md")
        self.assertEqual(m, {"a/b/moreCodeFolder/x.ts": "a/b", "README.md": "."})

    def test_settings_without_includes_yields_empty_modules(self):
        self.w("settings.gradle", "rootProject.name = 'single'\n")
        build, dirs = self.dirs()
        self.assertEqual(build, "gradle")
        self.assertEqual(dirs, [])
        m = self.map("README.md")
        self.assertEqual(m, {"README.md": "."})


class TestMaven(RepoTestCase):
    POM = """<?xml version="1.0"?>
    <project xmlns="http://maven.apache.org/POM/4.0.0">
      <modules>
        <module>module1</module>
        <module>sub/dir</module>
      </modules>
    </project>
    """

    def test_pom_modules_incl_nested_path(self):
        self.w("pom.xml", self.POM)
        build, dirs = self.dirs()
        self.assertEqual(build, "maven")
        self.assertEqual(dirs, ["module1", "sub/dir"])
        m = self.map("sub/dir/x.java", "module1/Y.java", "pom.xml")
        self.assertEqual(m, {"sub/dir/x.java": "sub/dir", "module1/Y.java": "module1", "pom.xml": "."})

    def test_pom_without_modules_falls_through(self):
        self.w("pom.xml", "<project><groupId>x</groupId></project>")
        self.mkdir("module1")
        build, dirs = self.dirs()
        self.assertEqual(build, "fallback")
        self.assertEqual(dirs, ["module1"])


class TestNpm(RepoTestCase):
    def test_workspaces_array(self):
        self.w("package.json", json.dumps({"workspaces": ["packages/a", "packages/b"]}))
        self.mkdir("packages/a")
        self.mkdir("packages/b")
        build, dirs = self.dirs()
        self.assertEqual(build, "npm")
        self.assertEqual(dirs, ["packages/a", "packages/b"])

    def test_workspaces_object_with_glob(self):
        self.w("package.json", json.dumps({"workspaces": {"packages": ["libs/*"]}}))
        self.mkdir("libs/x")
        self.mkdir("libs/y")
        self.mkdir("libs/.hidden")
        build, dirs = self.dirs()
        self.assertEqual(build, "npm")
        self.assertEqual(dirs, ["libs/x", "libs/y"])

    def test_pnpm_workspace_yaml(self):
        self.w("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n  - apps/core\n")
        self.mkdir("packages/one")
        self.mkdir("apps/core")
        build, dirs = self.dirs()
        self.assertEqual(build, "npm")
        self.assertEqual(dirs, ["apps/core", "packages/one"])

    def test_negation_globs_ignored(self):
        self.w("package.json", json.dumps({"workspaces": ["packages/*", "!packages/secret"]}))
        self.mkdir("packages/secret")
        self.mkdir("packages/open")
        build, dirs = self.dirs()
        self.assertEqual(build, "npm")
        self.assertEqual(dirs, ["packages/open", "packages/secret"])

    def test_package_json_without_workspaces_falls_through(self):
        self.w("package.json", json.dumps({"name": "x"}))
        self.mkdir("module1")
        build, dirs = self.dirs()
        self.assertEqual(build, "fallback")
        self.assertEqual(dirs, ["module1"])


class TestCargo(RepoTestCase):
    def test_workspace_members_minus_exclude(self):
        self.w("Cargo.toml", """
            [package]
            name = "root"

            [workspace]
            members = [
              "crates/a",
              "crates/b",
            ]
            exclude = ["crates/b"]
        """)
        build, dirs = self.dirs()
        self.assertEqual(build, "cargo")
        self.assertEqual(dirs, ["crates/a"])

    def test_default_members_without_members_key(self):
        self.w("Cargo.toml", '[workspace]\nexclude = ["crate-b"]\n')
        self.mkdir("crate-a")
        self.w("crate-a/Cargo.toml", "[package]\nname = 'a'\n")
        self.mkdir("crate-b")
        self.w("crate-b/Cargo.toml", "[package]\nname = 'b'\n")
        self.mkdir("not-a-crate")
        build, dirs = self.dirs()
        self.assertEqual(build, "cargo")
        self.assertEqual(dirs, ["crate-a"])

    def test_cargo_toml_without_workspace_falls_through(self):
        self.w("Cargo.toml", "[package]\nname = 'single'\n")
        self.mkdir("module1")
        build, dirs = self.dirs()
        self.assertEqual(build, "fallback")
        self.assertEqual(dirs, ["module1"])


class TestFallback(RepoTestCase):
    def test_top_level_dirs_only_hidden_excluded(self):
        self.mkdir("module1")
        self.mkdir("module2")
        self.mkdir(".git")
        self.mkdir(".plan")
        self.mkdir(".agent")
        self.w("README.md", "# x\n")
        build, dirs = self.dirs()
        self.assertEqual(build, "fallback")
        self.assertEqual(dirs, ["module1", "module2"])

    def test_src_extra_level(self):
        self.mkdir("module1")
        self.mkdir("src/core")
        self.mkdir("src/util")
        self.w("src/README.md", "not a module\n")
        build, dirs = self.dirs()
        self.assertEqual(build, "fallback")
        self.assertEqual(dirs, ["module1", "src", "src/core", "src/util"])

    def test_src_present_but_no_subdirs(self):
        self.mkdir("module1")
        self.w("src/main.ts", "// file only, no subdir\n")
        build, dirs = self.dirs()
        self.assertEqual(build, "fallback")
        self.assertEqual(dirs, ["module1", "src"])

    def test_no_dirs_at_all(self):
        self.w("README.md", "# x\n")
        build, dirs = self.dirs()
        self.assertEqual(build, "fallback")
        self.assertEqual(dirs, [])
        m = self.map("README.md", "docs/x.md")
        self.assertEqual(m, {"README.md": ".", "docs/x.md": "."})


class TestMap(RepoTestCase):
    def test_dms4_smoke_longest_prefix_and_root(self):
        # mirrors manifest criterion dms-4
        self.mkdir("module1/moreCodeFolder")
        self.mkdir("src/core")
        self.w("module1/moreCodeFolder/x.ts", "")
        self.w("src/core/a.ts", "")
        self.w("README.md", "")
        m = self.map("module1/moreCodeFolder/x.ts", "src/core/a.ts", "README.md")
        self.assertEqual(m["module1/moreCodeFolder/x.ts"], "module1")
        self.assertEqual(m["src/core/a.ts"], "src/core")
        self.assertEqual(m["README.md"], ".")

    def test_absolute_paths_normalized(self):
        self.mkdir("module1/moreCodeFolder")
        self.w("module1/moreCodeFolder/x.ts", "")
        self.w("README.md", "")
        m = self.map(
            os.path.join(self.repo, "module1/moreCodeFolder/x.ts"),
            os.path.join(self.repo, "README.md"),
        )
        self.assertEqual(m, {"module1/moreCodeFolder/x.ts": "module1", "README.md": "."})

    def test_file_outside_repo_is_error(self):
        outside = os.path.join(self.repo, "..", "outside.txt")
        with open(os.path.abspath(outside), "w") as f:
            f.write("x")
        r = run("--repo", self.repo, "map", os.path.abspath(outside))
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")
        self.assertNotEqual(r.stderr, "")

    def test_dot_slash_and_duplicate_seps_normalized(self):
        self.mkdir("module1")
        self.w("module1/x.ts", "")
        m = self.map("./module1//x.ts")
        self.assertEqual(m, {"module1/x.ts": "module1"})


class TestPrecedence(RepoTestCase):
    def test_gradle_beats_npm(self):
        self.w("settings.gradle", "include 'gradle-mod'\n")
        self.w("package.json", json.dumps({"workspaces": ["npm-mod"]}))
        build, dirs = self.dirs()
        self.assertEqual(build, "gradle")
        self.assertEqual(dirs, ["gradle-mod"])

    def test_maven_beats_npm(self):
        self.w("pom.xml", TestMaven.POM)
        self.w("package.json", json.dumps({"workspaces": ["npm-mod"]}))
        build, dirs = self.dirs()
        self.assertEqual(build, "maven")
        self.assertEqual(dirs, ["module1", "sub/dir"])

    def test_npm_beats_cargo(self):
        self.w("package.json", json.dumps({"workspaces": ["pkg/a"]}))
        self.w("Cargo.toml", '[workspace]\nmembers = ["crate-a"]\n')
        build, dirs = self.dirs()
        self.assertEqual(build, "npm")
        self.assertEqual(dirs, ["pkg/a"])


class TestModulesOutputShape(RepoTestCase):
    def test_modules_object_shape(self):
        self.mkdir("module1")
        out = self.modules()
        self.assertEqual(out["repo"], os.path.abspath(self.repo))
        self.assertEqual(out["build_system"], "fallback")
        self.assertEqual(out["modules"], [{"name": "module1", "dir": "module1"}])


if __name__ == "__main__":
    unittest.main()
