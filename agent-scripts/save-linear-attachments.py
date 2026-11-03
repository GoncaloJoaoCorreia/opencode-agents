#!/usr/bin/env python3
"""save-linear-attachments.py — eagerly download Linear-hosted attachment URLs.

Linear serves issue attachments as short-lived signed uploads.linear.app URLs
that expire ("Download failed" when the link is re-opened later). This script
scans a fetched issue's markdown for those URLs, downloads them eagerly into a
local attachments dir, and rewrites the markdown to local `attachments/...`
links — the mechanism behind persisting `.plan/<slug>/spec.md` with working
attachment links (G-23).

Usage:
  save-linear-attachments.py --markdown FILE --out DIR --spec-out FILE
      [--urls-file FILE] [--url URL ...] [--allowed-hosts H1,H2] [--refresh] [--help]

  --markdown FILE        fetched issue markdown (description and/or comments) to
                         scan; must be readable, else exit 2
  --out DIR              attachment output dir (e.g. .plan/<slug>/attachments);
                         created when missing
  --spec-out FILE        where the rewritten markdown is written
  --urls-file FILE       JSON file with extra URLs: an array of strings or
                         { "url": ..., "title": ... } objects (issue.attachments[]
                         is passed this way so no untrusted text is ever
                         interpolated into a shell command by callers)
  --url URL              repeatable extra URL (convenience/tests)
  --allowed-hosts H1,H2  comma-separated host allowlist, default
                         uploads.linear.app; URLs on other hosts land in
                         skipped[] with reason host-not-allowed and are NOT
                         rewritten
  --refresh              re-download even when the local file already exists;
                         default is skip-if-exists (reason exists, the link is
                         still rewritten) for idempotent resume

URL extraction:
  - <linear-image>{...}</linear-image> blocks -> the embedded JSON's attrs.src
    (and attrs.title as filename hint); malformed JSON blocks land in skipped[]
    with reason unparseable and are left unchanged
  - standard markdown images ![alt](URL); only http/https URLs are candidates

Download / rewrite:
  - urllib.request with a 30s timeout and a plain User-Agent; content is written
    as raw bytes as received
  - local name = sanitized title / URL basename ([A-Za-z0-9._-] only, path
    traversal stripped); the extension is derived from the Content-Type when the
    name has none (fallback .bin); name collisions get -2, -3, ... suffixes
  - the full URL incl. query/signature is what gets downloaded; the local name
    comes from the title/basename, not the query
  - each successfully downloaded (or already existing) URL is replaced
    everywhere in the markdown with the relative link attachments/<name>;
    failed or skipped URLs keep the original remote URL; duplicate URLs in one
    markdown are downloaded once and every occurrence is rewritten

Output: exactly ONE JSON object on one line on stdout (diagnostics on stderr):
  { "spec_out": "...", "attachments_dir": "...",
    "downloaded": [ { "url": "...", "local": "attachments/image.png", "title": "image.png" } ],
    "skipped":    [ { "url": "...", "reason": "exists|host-not-allowed|unparseable|scheme-not-allowed" } ],
    "failed":     [ { "url": "...", "error": "..." } ] }

Exit codes: 0 whenever the inputs are readable (per-file failures live in
failed[] and never abort), 2 on misuse (unknown flag, unreadable --markdown /
--urls-file, unusable --out) with a message on stderr and EMPTY stdout.
--help prints usage on stdout, exit 0.

python3 stdlib only; no third-party imports.
"""

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request

PROG = "save-linear-attachments.py"
DEFAULT_ALLOWED_HOSTS = "uploads.linear.app"
LINK_PREFIX = "attachments/"  # fixed relative-link prefix in the rewritten markdown
TIMEOUT = 30  # seconds
USER_AGENT = "save-linear-attachments.py/1.0 (opencode-agents)"
MAX_NAME = 80  # cap for the sanitized base name

# Content-Type -> extension when the sanitized name has none.
CTYPE_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "image/x-icon": ".ico",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/json": ".json",
    "application/octet-stream": ".bin",
    "text/plain": ".txt",
    "text/html": ".html",
    "text/csv": ".csv",
    "video/mp4": ".mp4",
}

LINEAR_IMAGE_RE = re.compile(r"<linear-image>(.*?)</linear-image>", re.S)
MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)")


def err(msg):
    print(f"{PROG}: {msg}", file=sys.stderr)
    sys.exit(2)


def sanitize_name(name):
    """Sanitize a title/URL basename to [A-Za-z0-9._-] (path traversal stripped)."""
    name = (name or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    name = name.lstrip(".")
    while ".." in name:
        name = name.replace("..", ".")
    if len(name) > MAX_NAME:
        stem, ext = os.path.splitext(name)
        name = stem[: max(1, MAX_NAME - len(ext))] + ext
    return name or "attachment"


def ext_for_content_type(ctype):
    ctype = (ctype or "").split(";")[0].strip().lower()
    return CTYPE_EXT.get(ctype, ".bin")


def host_allowed(host, allowed):
    host = (host or "").lower()
    for entry in allowed:
        if entry.startswith("*."):
            if host.endswith(entry[1:]):
                return True
        elif host == entry:
            return True
    return False


def extract_from_markdown(text):
    """Return (candidates, unparseable_blocks).

    candidates: ordered dict url -> title hint (None when unknown); markdown
    URLs come first (in order of appearance), <linear-image> hints win on dupes.
    """
    candidates = {}
    unparseable = []
    for m in LINEAR_IMAGE_RE.finditer(text):
        block = m.group(1).strip()
        try:
            data = json.loads(block)
        except ValueError:
            unparseable.append(block[:200])
            continue
        attrs = data.get("attrs") if isinstance(data, dict) else None
        src = attrs.get("src") if isinstance(attrs, dict) else None
        if isinstance(src, str) and src:
            title = attrs.get("title")
            if src not in candidates:
                candidates[src] = title if isinstance(title, str) else None
        else:
            unparseable.append(block[:200])
    for m in MD_IMAGE_RE.finditer(text):
        url = m.group(1).strip().strip("<>")
        if url and url not in candidates:
            candidates[url] = None
    return candidates, unparseable


def find_existing(out_dir, base, claimed, url):
    """Return the existing local name for this URL (skip-if-exists), or None.

    Matches the exact base name first, then `base.<ext>` files (the Content-Type
    extension added on a previous run). Names already claimed by a different
    URL in this run are not reused.
    """
    exact = os.path.join(out_dir, base)
    if os.path.isfile(exact) and claimed.get(base) in (None, url):
        return base
    prefix = base + "."
    try:
        entries = sorted(os.listdir(out_dir))
    except OSError:
        return None
    for entry in entries:
        if entry.startswith(prefix) and claimed.get(entry) in (None, url):
            if os.path.isfile(os.path.join(out_dir, entry)):
                return entry
    return None


def process_url(url, title_hint, out_dir, allowed, refresh, claimed):
    """Download (or skip) one URL. Returns (status, local_name, detail).

    status: "downloaded" | "skipped" | "failed"; local_name is the file name in
    out_dir (None unless downloaded or skipped-exists); detail is the skip
    reason or the error message.
    """
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return "skipped", None, "scheme-not-allowed"
    if not host_allowed(parts.hostname, allowed):
        return "skipped", None, "host-not-allowed"
    base = sanitize_name(title_hint or os.path.basename(parts.path) or "attachment")
    if not refresh:
        existing = find_existing(out_dir, base, claimed, url)
        if existing is not None:
            claimed[existing] = url
            return "skipped", existing, "exists"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = resp.read()
            ctype = resp.headers.get("Content-Type", "")
    except Exception as e:  # per-file failure — never abort the run
        return "failed", None, f"{type(e).__name__}: {e}"
    name = base
    if not os.path.splitext(name)[1]:
        name += ext_for_content_type(ctype)
    stem, ext = os.path.splitext(name)
    n = 1
    while name in claimed and claimed[name] != url:  # collision -> -2, -3, ...
        n += 1
        name = f"{stem}-{n}{ext}"
    claimed[name] = url
    try:
        with open(os.path.join(out_dir, name), "wb") as f:
            f.write(data)
    except OSError as e:
        return "failed", None, f"write error: {e}"
    return "downloaded", name, None


def read_urls_file(path):
    """Return [(url, title)] from a JSON array of strings / {url,title} objects."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        err(f"cannot read --urls-file {path}: {e}")
    if not isinstance(data, list):
        err(f"--urls-file must contain a JSON array: {path}")
    out = []
    for item in data:
        if isinstance(item, str):
            out.append((item, None))
        elif isinstance(item, dict) and isinstance(item.get("url"), str):
            title = item.get("title")
            out.append((item["url"], title if isinstance(title, str) else None))
        else:
            err(f"--urls-file entries must be strings or {{\"url\", \"title\"}} objects: {path}")
    return out


def build_parser():
    ap = argparse.ArgumentParser(
        prog=PROG,
        description="Eagerly download Linear-hosted attachment URLs from a markdown "
                    "file and rewrite them to local attachments/ links (JSON on stdout).",
    )
    ap.add_argument("--markdown", metavar="FILE", required=True,
                    help="fetched issue markdown to scan")
    ap.add_argument("--out", metavar="DIR", required=True,
                    help="attachment output dir (created when missing)")
    ap.add_argument("--spec-out", metavar="FILE", required=True,
                    help="where the rewritten markdown is written")
    ap.add_argument("--urls-file", metavar="FILE", default=None,
                    help="JSON file with extra URLs (array of strings or {url,title} objects)")
    ap.add_argument("--url", metavar="URL", action="append", default=[],
                    help="extra URL (repeatable)")
    ap.add_argument("--allowed-hosts", metavar="H1,H2", default=DEFAULT_ALLOWED_HOSTS,
                    help="comma-separated host allowlist (default: %(default)s)")
    ap.add_argument("--refresh", action="store_true",
                    help="re-download even when the local file already exists")
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)

    try:
        with open(args.markdown, "rb") as f:
            raw = f.read()
    except OSError as e:
        err(f"cannot read --markdown {args.markdown}: {e}")
    text = raw.decode("utf-8", errors="surrogateescape")

    out_dir = args.out
    if os.path.exists(out_dir) and not os.path.isdir(out_dir):
        err(f"--out exists but is not a directory: {out_dir}")
    try:
        os.makedirs(out_dir, exist_ok=True)
    except OSError as e:
        err(f"cannot create --out {out_dir}: {e}")

    allowed = [h.strip().lower() for h in args.allowed_hosts.split(",") if h.strip()]

    candidates, unparseable = extract_from_markdown(text)
    for url, title in read_urls_file(args.urls_file) if args.urls_file else []:
        if url not in candidates:
            candidates[url] = title
    for url in args.url:
        if url not in candidates:
            candidates[url] = None

    downloaded, skipped, failed = [], [], []
    rewrite = {}  # url -> local relative link
    claimed = {}  # local file name -> url (collision dedupe within this run)

    for url, title_hint in candidates.items():
        status, name, detail = process_url(url, title_hint, out_dir, allowed,
                                           args.refresh, claimed)
        if status == "downloaded":
            downloaded.append({"url": url, "local": LINK_PREFIX + name, "title": name})
            rewrite[url] = LINK_PREFIX + name
        elif status == "skipped":
            skipped.append({"url": url, "reason": detail})
            if detail == "exists":
                rewrite[url] = LINK_PREFIX + name
        else:
            failed.append({"url": url, "error": detail})
    for block in unparseable:
        skipped.append({"url": "", "reason": "unparseable", "block": block})

    # Replace longer URLs first so a URL that is a prefix of another cannot
    # partially rewrite it.
    for url in sorted(rewrite, key=len, reverse=True):
        text = text.replace(url, rewrite[url])

    try:
        with open(args.spec_out, "wb") as f:
            f.write(text.encode("utf-8", errors="surrogateescape"))
    except OSError as e:
        err(f"cannot write --spec-out {args.spec_out}: {e}")

    out = {
        "spec_out": args.spec_out,
        "attachments_dir": args.out,
        "downloaded": downloaded,
        "skipped": skipped,
        "failed": failed,
    }
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
