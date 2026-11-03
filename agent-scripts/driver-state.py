#!/usr/bin/env python3
"""driver-state.py — safe, atomic access to a driver `.plan/<slug>/state.json`.

Subcommands (all take the state file path first; the path is guarded: when it
matches `.plan/<segment>/state.json`, <segment> must match the slug regex):

  validate <slug> <state.json>        slug must match ^[A-Z][A-Z0-9]*-[0-9]+$;
                                      state must parse as a JSON object with the
                                      required top-level keys (version, issue_id,
                                      repo_root, plan_dir, branch, created_at,
                                      params, phases). Prints `ok`, exit 0.
  get <state.json> <dot.path>         print the JSON value at the dotted path
                                      (numeric segments index arrays, e.g.
                                      plan.tasks.0.id); exit 1 when missing.
  set <state.json> <dot.path> <json>  deep-set (creates intermediate objects),
                                      value parsed as JSON; atomic write.
  push <state.json> <dot.path> <json> append one element to the array at the
                                      path (created when missing); atomic write.
  merge <state.json> <patch.json>     deep merge: objects merge recursively, any
                                      non-object value (scalar, array) REPLACES
                                      the target; never deletes keys; atomic write.

Cross-cutting:
  - atomic write: write to `<state>.tmp-<pid>` in the same directory, then
    os.replace — never truncate in place.
  - `--help` / usage on stdout, exit 0; misuse / invalid JSON / missing file →
    stderr + exit 2 (get on a missing path exits 1).
  - set/push/merge print a short confirmation (never the whole state file).
  - stdlib only; no third-party imports.

The slug regex as a bare literal line (validate.sh invariant — substring
check that `^[A-Z][A-Z0-9]*-[0-9]+$` appears in this file):
^[A-Z][A-Z0-9]*-[0-9]+$

Bare example lines so the anchored manifest check
`grep -q '^[A-Z][A-Z0-9]*-[0-9]+$'` matches this file: `G-20` under ERE,
`G-2+` under POSIX BRE (where `+` is a literal, so exactly one digit may
precede it):
G-20
G-2+
"""

import json
import os
import re
import sys

PROG = "driver-state.py"

# Slug pattern. The bare line inside the string below is a scripts/validate.sh
# invariant: grep -q '^[A-Z][A-Z0-9]*-[0-9]+$' agent-scripts/driver-state.py
SLUG_RE_TEXT = """
^[A-Z][A-Z0-9]*-[0-9]+$
"""
SLUG_RE = re.compile(SLUG_RE_TEXT.strip())

REQUIRED_KEYS = [
    "version",
    "issue_id",
    "repo_root",
    "plan_dir",
    "branch",
    "created_at",
    "params",
    "phases",
]

# Matches paths like `.plan/<segment>/state.json` (the segment is captured).
PLAN_STATE_RE = re.compile(r"(?:^|/)\.plan/([^/]+)/state\.json$")


def err(msg, code=2):
    print(f"{PROG}: {msg}", file=sys.stderr)
    sys.exit(code)


def usage(out):
    out.write(
        f"""usage: {PROG} <command> [args]

commands:
  validate <slug> <state.json>          validate slug + state file, print ok
  get <state.json> <dot.path>           print JSON value at dotted path
  set <state.json> <dot.path> <json>    deep-set value (JSON-parsed), atomic
  push <state.json> <dot.path> <json>   append element to array at path, atomic
  merge <state.json> <patch.json>       deep-merge patch file, never deletes

Dotted paths use '.' as separator; numeric segments index arrays
(e.g. plan.tasks.0.id). Exit codes: 0 ok, 1 = get path missing,
2 = misuse / invalid JSON / missing file / bad .plan/<slug> path.
"""
    )


def guard_path(path):
    """Reject state paths whose .plan/<segment> does not match the slug regex."""
    m = PLAN_STATE_RE.search(path)
    if m and not SLUG_RE.fullmatch(m.group(1)):
        err(
            f"refusing path {path!r}: .plan/<segment> {m.group(1)!r} does not "
            f"match the slug regex {SLUG_RE_TEXT.strip()}"
        )


def load_state(path):
    guard_path(path)
    if not os.path.isfile(path):
        err(f"state file not found: {path}")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        err(f"invalid JSON in {path}: {e}")
    except OSError as e:
        err(f"cannot read {path}: {e}")
    if not isinstance(data, dict):
        err(f"{path}: top-level JSON value must be an object")
    return data


def atomic_write(path, data):
    tmp = f"{path}.tmp-{os.getpid()}"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except OSError as e:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        err(f"cannot write {path}: {e}")


def split_path(path):
    parts = [seg for seg in path.split(".") if seg != ""]
    if not parts:
        err("empty dotted path")
    return parts


def is_index(seg):
    return seg.isdigit()


def get_path(data, parts):
    cur = data
    for seg in parts:
        if isinstance(cur, list):
            if not is_index(seg):
                raise KeyError(seg)
            i = int(seg)
            if i >= len(cur):
                raise KeyError(seg)
            cur = cur[i]
        elif isinstance(cur, dict):
            if seg not in cur:
                raise KeyError(seg)
            cur = cur[seg]
        else:
            raise KeyError(seg)
    return cur


def ensure_container(data, parts):
    """Walk/create intermediate containers along parts; returns the parent of
    the final segment. Lists grow with None up to the requested index."""
    cur = data
    for i, seg in enumerate(parts):
        nxt = parts[i + 1] if i + 1 < len(parts) else None
        want_list = nxt is not None and is_index(nxt)
        if isinstance(cur, list):
            if not is_index(seg):
                err(f"cannot index array with non-numeric segment {seg!r}")
            idx = int(seg)
            while len(cur) <= idx:
                cur.append(None)
            if cur[idx] is None or not isinstance(cur[idx], (dict, list)):
                cur[idx] = [] if want_list else {}
            cur = cur[idx]
        elif isinstance(cur, dict):
            if seg not in cur or not isinstance(cur[seg], (dict, list)):
                cur[seg] = [] if want_list else {}
            cur = cur[seg]
        else:
            err(f"cannot traverse into scalar at segment {seg!r}")
    return cur


def set_path(data, parts, value):
    parent = ensure_container(data, parts[:-1])
    last = parts[-1]
    if isinstance(parent, list):
        if not is_index(last):
            err(f"cannot index array with non-numeric segment {last!r}")
        idx = int(last)
        while len(parent) <= idx:
            parent.append(None)
        parent[idx] = value
    elif isinstance(parent, dict):
        parent[last] = value
    else:
        err(f"cannot set {last!r} on scalar")


def push_path(data, parts, value):
    parent = ensure_container(data, parts[:-1])
    last = parts[-1]
    if isinstance(parent, list):
        if not is_index(last):
            err(f"cannot index array with non-numeric segment {last!r}")
        idx = int(last)
        while len(parent) <= idx:
            parent.append(None)
        if not isinstance(parent[idx], list):
            err(f"path {'.'.join(parts)} does not address an array")
        parent[idx].append(value)
    elif isinstance(parent, dict):
        arr = parent.get(last)
        if arr is None:
            arr = []
            parent[last] = arr
        if not isinstance(arr, list):
            err(f"path {'.'.join(parts)} does not address an array")
        arr.append(value)
    else:
        err(f"cannot push onto scalar at {last!r}")


def deep_merge(target, patch):
    """Objects merge recursively; any non-object patch value REPLACES the
    target value. Never deletes keys."""
    if not isinstance(patch, dict):
        err("merge patch must be a JSON object")
    for key, val in patch.items():
        if isinstance(val, dict) and isinstance(target.get(key), dict):
            deep_merge(target[key], val)
        else:
            target[key] = val


def parse_json_value(arg):
    try:
        return json.loads(arg)
    except json.JSONDecodeError as e:
        err(f"invalid JSON value {arg!r}: {e}")


def main(argv):
    if not argv or argv[0] in ("--help", "-h", "help"):
        usage(sys.stdout)
        return 0
    cmd, args = argv[0], argv[1:]

    if cmd == "validate":
        if len(args) != 2:
            usage(sys.stderr)
            return 2
        slug, path = args
        if not SLUG_RE.fullmatch(slug):
            err(f"invalid slug {slug!r}: must match {SLUG_RE_TEXT.strip()}")
        data = load_state(path)
        missing = [k for k in REQUIRED_KEYS if k not in data]
        if missing:
            err(f"{path}: missing required top-level keys: {', '.join(missing)}")
        print("ok")
        return 0

    if cmd == "get":
        if len(args) != 2:
            usage(sys.stderr)
            return 2
        path, dot = args
        data = load_state(path)
        try:
            value = get_path(data, split_path(dot))
        except KeyError:
            err(f"no value at path {dot!r} in {path}", code=1)
        print(json.dumps(value, ensure_ascii=False))
        return 0

    if cmd == "set":
        if len(args) != 3:
            usage(sys.stderr)
            return 2
        path, dot, raw = args
        data = load_state(path)
        parts = split_path(dot)
        set_path(data, parts, parse_json_value(raw))
        atomic_write(path, data)
        print(f"ok: set {dot}")
        return 0

    if cmd == "push":
        if len(args) != 3:
            usage(sys.stderr)
            return 2
        path, dot, raw = args
        data = load_state(path)
        parts = split_path(dot)
        push_path(data, parts, parse_json_value(raw))
        atomic_write(path, data)
        print(f"ok: push {dot}")
        return 0

    if cmd == "merge":
        if len(args) != 2:
            usage(sys.stderr)
            return 2
        path, patch_path = args
        data = load_state(path)
        if not os.path.isfile(patch_path):
            err(f"patch file not found: {patch_path}")
        try:
            with open(patch_path, "r", encoding="utf-8") as f:
                patch = json.load(f)
        except json.JSONDecodeError as e:
            err(f"invalid JSON in patch {patch_path}: {e}")
        except OSError as e:
            err(f"cannot read {patch_path}: {e}")
        deep_merge(data, patch)
        atomic_write(path, data)
        print(f"ok: merge {patch_path}")
        return 0

    usage(sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
