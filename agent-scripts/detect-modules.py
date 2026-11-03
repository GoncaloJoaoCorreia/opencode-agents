#!/usr/bin/env python3
"""detect-modules.py — detect a target repo's module folders and map files to them.

Used by driver/write-history to decide which `<module>/.agent/` folder holds the
history/decisions entries for a set of changed files (G-22).

Usage:
  detect-modules.py [--repo DIR] modules
      Print exactly one JSON object on stdout:
        { "repo": "<abs repo path>", "build_system": "gradle|maven|npm|cargo|fallback",
          "modules": [ { "name": "<dir>", "dir": "<dir relative to repo root>" }, ... ] }
      Build-system detection, first match wins:
        1. gradle — root settings.gradle / settings.gradle.kts `include(...)`
           statements (Groovy and Kotlin DSL); `project(":x").projectDir = file(...)`
           overrides the default dir when present.
        2. maven  — root pom.xml <modules><module>dir</module>...</modules>
           (namespace-agnostic XML parse).
        3. npm    — root package.json `workspaces` (array or { "packages": [...] })
           and/or root pnpm-workspace.yaml `packages:` globs; simple one-level
           globs (`packages/*`) are expanded, `!` negation globs are ignored.
        4. cargo  — root Cargo.toml [workspace] members minus exclude; when
           `members` is absent, top-level dirs containing a Cargo.toml (minus
           exclude) are the default members.
      Fallback when no build system matches: the repo's top-level directories
      (one level deep), PLUS the directories under a root `src/` when one exists
      (one extra level). Hidden dirs (`.git`, `.plan`, `.agent`, ...) are never
      modules; the repo root itself is not a module entry.
  detect-modules.py [--repo DIR] map FILE...
      Print exactly one JSON object mapping each FILE to its module dir:
      the LONGEST detected module dir that is a path-segment prefix of the file
      (nested folders inside a module belong to the module); "." for files at the
      repo root or under no module dir. FILEs may be repo-relative or absolute
      (normalized to repo-relative keys); FILEs outside the repo are an error.

Exit codes: 0 on success (exactly one JSON object / one line on stdout), 2 on
error (bad flag, unreadable repo, file outside repo) with a message on stderr
and EMPTY stdout. `--help` prints usage on stdout, exit 0.

python3 stdlib only; no third-party imports.
"""

import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

PROG = "detect-modules.py"

# Top-level dirs that are never fallback modules even when not hidden.
NEVER_MODULES = {"node_modules"}


def err(msg):
    print(f"{PROG}: {msg}", file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------- gradle ----

def _strip_gradle_comments(text):
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"//[^\n]*", " ", text)
    return text


def parse_gradle_settings(path):
    """Return the module dirs declared via include(...) in a settings file."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = _strip_gradle_comments(f.read())
    except OSError:
        return []
    # project(":x").projectDir = file("custom/dir") overrides (trivial form only)
    project_dirs = {}
    for m in re.finditer(
        r"project\s*\(\s*[\"']([^\"']+)[\"']\s*\)\s*\.\s*projectDir\s*=\s*"
        r"(?:file\s*\(\s*)?[\"']([^\"']+)[\"']",
        text,
    ):
        project_dirs[m.group(1)] = m.group(2)
    includes = []
    for m in re.finditer(r"\binclude\b", text):
        rest = text[m.end():]
        i = 0
        while i < len(rest) and rest[i].isspace():
            i += 1
        if i < len(rest) and rest[i] == "(":  # Kotlin DSL: include("a", "b")
            depth, j, buf = 1, i + 1, []
            while j < len(rest) and depth:
                c = rest[j]
                if c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
                if depth:
                    buf.append(c)
                j += 1
            snippet = "".join(buf)
        else:  # Groovy: include 'a', 'b'  (rest of the line)
            nl = rest.find("\n")
            snippet = rest if nl == -1 else rest[:nl]
        includes.extend(q.group(1) for q in re.finditer(r"[\"']([^\"']+)[\"']", snippet))
    dirs, seen = [], set()
    for inc in includes:
        norm = inc if inc.startswith(":") else ":" + inc
        d = project_dirs.get(norm)
        if d is None:
            d = inc.lstrip(":").replace(":", "/")
        d = d.strip().strip("/")
        if d and d not in seen:
            seen.add(d)
            dirs.append(d)
    return dirs


# ----------------------------------------------------------------- maven ----

def parse_maven_pom(path):
    """Return <module> dirs from a root pom.xml (namespace-agnostic), or []."""
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        return []

    def local(tag):
        return tag.rsplit("}", 1)[-1]

    dirs, seen = [], set()
    for el in root.iter():
        if local(el.tag) != "modules":
            continue
        for child in el:
            if local(child.tag) == "module" and child.text:
                d = child.text.strip().strip("/")
                if d and d not in seen:
                    seen.add(d)
                    dirs.append(d)
    return dirs


# ------------------------------------------------------------------- npm ----

def _pnpm_packages(path):
    """Minimal YAML-subset read of pnpm-workspace.yaml `packages:` entries."""
    out = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError:
        return out
    in_packages = False
    for line in lines:
        if re.match(r"^packages\s*:\s*(#.*)?$", line):
            in_packages = True
            continue
        if not in_packages:
            continue
        m = re.match(r"^\s*-\s*['\"]?([^'\"\s#]+)['\"]?\s*(#.*)?$", line)
        if m:
            out.append(m.group(1))
            continue
        stripped = line.strip()
        if stripped and not line[0].isspace():
            in_packages = False  # a new top-level key ends the list
    return out


def parse_npm_workspaces(repo):
    """Return raw workspace globs from package.json and/or pnpm-workspace.yaml."""
    globs = []
    pj = os.path.join(repo, "package.json")
    if os.path.isfile(pj):
        try:
            with open(pj, encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            data = None
        if isinstance(data, dict):
            ws = data.get("workspaces")
            if isinstance(ws, list):
                globs.extend(str(x) for x in ws)
            elif isinstance(ws, dict) and isinstance(ws.get("packages"), list):
                globs.extend(str(x) for x in ws["packages"])
    pnpm = os.path.join(repo, "pnpm-workspace.yaml")
    if os.path.isfile(pnpm):
        globs.extend(_pnpm_packages(pnpm))
    return globs


def expand_workspace_globs(repo, globs):
    """Expand workspace globs to module dirs; `*` expands one level, `!` ignored."""
    dirs, seen = [], set()
    for g in globs:
        g = str(g).strip().strip("/")
        if not g or g.startswith("!"):
            continue  # negation globs are ignored (documented choice)
        if "*" in g:
            base = g.split("*", 1)[0].rstrip("/")
            parent = os.path.join(repo, base) if base else repo
            if not os.path.isdir(parent):
                continue
            for entry in sorted(os.scandir(parent), key=lambda e: e.name):
                if entry.name.startswith("."):
                    continue
                if entry.is_dir(follow_symlinks=False):
                    d = f"{base}/{entry.name}" if base else entry.name
                    if d not in seen:
                        seen.add(d)
                        dirs.append(d)
        else:
            if g not in seen:
                seen.add(g)
                dirs.append(g)
    return dirs


# ----------------------------------------------------------------- cargo ----

def _toml_array_items(val):
    s = val.strip()
    if s.startswith("["):
        s = s[1:]
    if s.endswith("]"):
        s = s[:-1]
    items = []
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        if len(part) >= 2 and part[0] in "\"'" and part[-1] == part[0]:
            part = part[1:-1]
        items.append(part)
    return items


def parse_cargo_workspace(path, repo):
    """Return [workspace] member dirs from a Cargo.toml, or None if no [workspace]."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            raw_lines = f.read().splitlines()
    except OSError:
        return None
    section = None
    workspace_seen = False
    entries = {}
    pending_key, pending_val = None, ""

    def close_pending():
        nonlocal pending_key, pending_val
        if pending_key is not None:
            entries.setdefault(pending_key, []).extend(_toml_array_items(pending_val))
            pending_key, pending_val = None, ""

    for raw in raw_lines:
        line = raw.split("#", 1)[0].rstrip()  # minimal TOML subset: strip comments
        if pending_key is not None:
            pending_val += " " + line.strip()
            if pending_val.count("[") <= pending_val.count("]"):
                close_pending()
            continue
        stripped = line.strip()
        if not stripped:
            continue
        m = re.match(r"^\[([^\]]+)\]$", stripped)
        if m:
            section = m.group(1).strip()
            if section == "workspace":
                workspace_seen = True
            continue
        if section != "workspace":
            continue
        m = re.match(r"^([A-Za-z0-9_-]+)\s*=\s*(.*)$", stripped)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if val.startswith("[") and val.count("[") > val.count("]"):
            pending_key, pending_val = key, val  # multi-line array
        elif val.startswith("["):
            entries.setdefault(key, []).extend(_toml_array_items(val))
    close_pending()
    if not workspace_seen:
        return None
    exclude = set(entries.get("exclude", []))
    members = entries.get("members")
    if members is None:
        # default members: top-level dirs containing a Cargo.toml, minus exclude
        members = []
        for entry in sorted(os.scandir(repo), key=lambda e: e.name):
            if entry.name.startswith("."):
                continue
            if entry.is_dir(follow_symlinks=False) and os.path.isfile(
                os.path.join(repo, entry.name, "Cargo.toml")
            ):
                members.append(entry.name)
    dirs, seen = [], set()
    for m in members:
        m = str(m).strip().strip("/")
        if not m or m == "." or m in exclude or m in seen:
            continue
        seen.add(m)
        dirs.append(m)
    return dirs


# --------------------------------------------------------------- fallback ----

def fallback_modules(repo):
    """Top-level dirs (one level), plus src/* when a root src/ exists."""
    dirs = []

    def scan(parent, prefix):
        try:
            entries = sorted(os.scandir(parent), key=lambda e: e.name)
        except OSError:
            return
        for entry in entries:
            if not entry.is_dir(follow_symlinks=False):  # symlinks not followed
                continue
            if entry.name.startswith(".") or entry.name in NEVER_MODULES:
                continue
            dirs.append(prefix + entry.name)

    scan(repo, "")
    src = os.path.join(repo, "src")
    if os.path.isdir(src) and not os.path.islink(src):
        scan(src, "src/")
    return dirs


# --------------------------------------------------------------- detect ------

def detect(repo):
    """Return (build_system, [module dirs]) — first matching build system wins."""
    for name in ("settings.gradle", "settings.gradle.kts"):
        p = os.path.join(repo, name)
        if os.path.isfile(p):
            return "gradle", sorted(set(parse_gradle_settings(p)))
    pom = os.path.join(repo, "pom.xml")
    if os.path.isfile(pom):
        mods = parse_maven_pom(pom)
        if mods:
            return "maven", sorted(set(mods))
    globs = parse_npm_workspaces(repo)
    if globs:
        dirs = expand_workspace_globs(repo, globs)
        if dirs:
            return "npm", sorted(set(dirs))
    cargo = os.path.join(repo, "Cargo.toml")
    if os.path.isfile(cargo):
        mods = parse_cargo_workspace(cargo, repo)
        if mods is not None:
            return "cargo", sorted(set(mods))
    return "fallback", fallback_modules(repo)


# ------------------------------------------------------------------ map ------

def to_repo_rel(repo, f):
    """Normalize a FILE arg (relative or absolute) to a repo-relative /-path."""
    p = f if os.path.isabs(f) else os.path.join(repo, f)
    p = os.path.normpath(p)
    rel = os.path.relpath(p, repo)
    if rel.startswith(".."):
        err(f"file outside repo: {f}")
    return rel.replace(os.sep, "/")


def map_files(repo, module_dirs, files):
    out = {}
    for f in files:
        rel = to_repo_rel(repo, f)
        best = "."
        for d in module_dirs:
            if rel == d or rel.startswith(d + "/"):
                if best == "." or len(d) > len(best):
                    best = d  # longest prefix wins
        out[rel] = best
    return out


# ------------------------------------------------------------------ cli ------

def build_parser():
    common = argparse.ArgumentParser(add_help=False)
    # default=SUPPRESS: an unset subcommand-level --repo leaves the main-level value
    # intact; if --repo is given at both levels, the subcommand's value wins
    common.add_argument("--repo", metavar="DIR", default=argparse.SUPPRESS,
                        help="target repo root (default: cwd)")
    ap = argparse.ArgumentParser(
        prog=PROG,
        description="Detect a repo's module folders and map files to them (JSON on stdout).",
        parents=[],
    )
    ap.add_argument("--repo", metavar="DIR", default=None,
                    help="target repo root (default: cwd)")
    sub = ap.add_subparsers(dest="command", required=True)
    sub.add_parser("modules", parents=[common],
                   help="print build system + module dirs as one JSON object")
    mp = sub.add_parser("map", parents=[common],
                        help="map FILEs to module dirs as one JSON object")
    mp.add_argument("files", nargs="+", metavar="FILE")
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    repo = os.path.abspath(args.repo or os.getcwd())
    if not os.path.isdir(repo):
        err(f"repo not found or not a directory: {args.repo}")
    build_system, module_dirs = detect(repo)
    if args.command == "modules":
        out = {
            "repo": repo,
            "build_system": build_system,
            "modules": [{"name": d, "dir": d} for d in module_dirs],
        }
    else:
        out = map_files(repo, module_dirs, args.files)
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
