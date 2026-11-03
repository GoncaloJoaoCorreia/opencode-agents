#!/usr/bin/env python3
"""Unit tests for save-linear-attachments.py.

Runs the script via subprocess in tmp dirs against a local http.server stub on
127.0.0.1 (ephemeral port) — NO external network is touched.
"""

import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "save-linear-attachments.py")
HOST = "127.0.0.1"


def run(*args):
    return subprocess.run(
        [sys.executable, SCRIPT, *args], capture_output=True, text=True
    )


class StubServer:
    """http.server on 127.0.0.1 with an ephemeral port; counts hits per path."""

    def __init__(self, files):
        # files: { path: (content_type, body bytes) }
        self.files = files
        self.hits = {}
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                path = self.path.split("?")[0]
                outer.hits[path] = outer.hits.get(path, 0) + 1
                if path in outer.files:
                    ctype, body = outer.files[path]
                    self.send_response(200)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()

            def log_message(self, *args):
                pass

        self.httpd = http.server.HTTPServer((HOST, 0), Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def url(self, path):
        return f"http://{HOST}:{self.port}{path}"

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)


def dead_url():
    """A http://127.0.0.1 URL on a closed port (connection refused)."""
    s = socket.socket()
    s.bind((HOST, 0))
    port = s.getsockname()[1]
    s.close()
    return f"http://{HOST}:{port}/gone.png"


class ScriptTestCase(unittest.TestCase):
    def test_executable_with_shebang(self):
        self.assertTrue(os.access(SCRIPT, os.X_OK), "script must be executable")
        with open(SCRIPT, encoding="utf-8") as f:
            self.assertEqual(f.readline().strip(), "#!/usr/bin/env python3")

    def test_help_exit_0_stdout(self):
        r = run("--help")
        self.assertEqual(r.returncode, 0)
        self.assertIn("usage", r.stdout.lower())
        self.assertEqual(r.stderr, "")

    def test_unknown_flag_exit_2_empty_stdout(self):
        r = run("--definitely-not-a-flag")
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")
        self.assertNotEqual(r.stderr, "")

    def test_missing_required_flag_exit_2(self):
        r = run("--markdown", "x.md")
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")


class AttachmentsTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = self.tmp.name
        self.server = StubServer({
            "/img/photo.png": ("image/png", b"\x89PNG\r\n\x1a\nphoto-bytes"),
            "/img/logo": ("image/png", b"logo-bytes"),
            "/a/photo.png": ("image/png", b"photo-a"),
            "/b/photo.png": ("image/png", b"photo-b"),
            "/doc/file.pdf": ("application/pdf", b"%PDF-1.4 fake"),
            "/data/blob": ("application/octet-stream", b"\x00\x01\x02\xff"),
        })
        self.addCleanup(self.server.stop)

    def w(self, relpath, content):
        p = os.path.join(self.dir, relpath)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        mode = "wb" if isinstance(content, bytes) else "w"
        with open(p, mode) as f:
            f.write(content)
        return p

    def invoke(self, markdown, extra_args=(), in_name="in.md"):
        """Run the script; assert exit 0 + single-line JSON stdout; return
        (parsed_json, spec_out_path, out_dir_path, spec_out_bytes)."""
        md = self.w(in_name, markdown)
        out_dir = os.path.join(self.dir, "attachments")
        spec_out = os.path.join(self.dir, "spec.md")
        r = run("--markdown", md, "--out", out_dir, "--spec-out", spec_out,
                "--allowed-hosts", HOST, *extra_args)
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = r.stdout.splitlines()
        self.assertEqual(len(lines), 1, f"stdout must be a single JSON line: {r.stdout!r}")
        with open(spec_out, "rb") as f:
            spec_bytes = f.read()
        return json.loads(lines[0]), spec_out, out_dir, spec_bytes

    # ---------------------------------------------------------- extraction --

    def test_linear_image_extraction_download_and_rewrite(self):
        url = self.server.url("/img/photo.png") + "?signature=abc123"
        md = f'<linear-image>{{"attrs": {{"src": "{url}", "title": "My Photo!.png"}}}}</linear-image>'
        out, spec_out, out_dir, spec_bytes = self.invoke(md)
        self.assertEqual(out["failed"], [])
        self.assertEqual(len(out["downloaded"]), 1)
        d = out["downloaded"][0]
        self.assertEqual(d["url"], url)  # full URL incl. query is recorded/downloaded
        self.assertEqual(d["local"], "attachments/My_Photo_.png")  # sanitized title hint
        self.assertEqual(d["title"], "My_Photo_.png")
        self.assertIn(b'"src": "attachments/My_Photo_.png"', spec_bytes)
        self.assertNotIn(url.encode(), spec_bytes)
        with open(os.path.join(out_dir, "My_Photo_.png"), "rb") as f:
            self.assertEqual(f.read(), b"\x89PNG\r\n\x1a\nphoto-bytes")
        self.assertEqual(self.server.hits.get("/img/photo.png"), 1)

    def test_markdown_image_extraction(self):
        url = self.server.url("/img/photo.png")
        out, _, _, spec_bytes = self.invoke(f"before ![alt text]({url}) after")
        self.assertEqual(len(out["downloaded"]), 1)
        self.assertEqual(out["downloaded"][0]["local"], "attachments/photo.png")
        self.assertIn(b"![alt text](attachments/photo.png)", spec_bytes)

    def test_duplicate_url_downloaded_once_rewritten_everywhere(self):
        url = self.server.url("/img/photo.png")
        md = f"![one]({url})\n![two]({url})\n[link]({url})\n"
        out, _, _, spec_bytes = self.invoke(md)
        self.assertEqual(len(out["downloaded"]), 1)
        self.assertEqual(self.server.hits.get("/img/photo.png"), 1)
        self.assertEqual(spec_bytes.count(b"attachments/photo.png"), 3)
        self.assertNotIn(url.encode(), spec_bytes)

    def test_query_string_downloaded_but_name_from_basename(self):
        url = self.server.url("/img/photo.png") + "?signature=xyz&expires=1"
        out, _, out_dir, _ = self.invoke(f"![x]({url})")
        self.assertEqual(out["downloaded"][0]["local"], "attachments/photo.png")
        self.assertEqual(self.server.hits.get("/img/photo.png"), 1)
        self.assertTrue(os.path.isfile(os.path.join(out_dir, "photo.png")))

    def test_malformed_linear_image_skipped_unparseable_never_crashes(self):
        url = self.server.url("/img/photo.png")
        md = '<linear-image>{not valid json</linear-image>\n![ok](%s)' % url
        out, _, _, spec_bytes = self.invoke(md)
        self.assertEqual(out["failed"], [])
        self.assertEqual(len(out["downloaded"]), 1)
        reasons = [s["reason"] for s in out["skipped"]]
        self.assertIn("unparseable", reasons)
        self.assertIn(b"<linear-image>{not valid json</linear-image>", spec_bytes)

    def test_empty_markdown_empty_arrays_spec_out_is_copy(self):
        out, spec_out, _, spec_bytes = self.invoke("")
        self.assertEqual(out["downloaded"], [])
        self.assertEqual(out["skipped"], [])
        self.assertEqual(out["failed"], [])
        self.assertEqual(spec_bytes, b"")

    def test_non_http_scheme_not_rewritten(self):
        out, _, _, spec_bytes = self.invoke("![x](mailto:a@b.c)")
        self.assertEqual(out["downloaded"], [])
        self.assertEqual([s["reason"] for s in out["skipped"]], ["scheme-not-allowed"])
        self.assertIn(b"mailto:a@b.c", spec_bytes)

    # ----------------------------------------------------------- allowlist ---

    def test_host_not_allowed_skipped_and_kept_remote(self):
        url = "http://example.com/evil.png"
        out, _, _, spec_bytes = self.invoke(f"![x]({url})")
        self.assertEqual(out["downloaded"], [])
        self.assertEqual(out["failed"], [])
        self.assertEqual(out["skipped"], [{"url": url, "reason": "host-not-allowed"}])
        self.assertIn(url.encode(), spec_bytes)

    def test_default_allowed_hosts_is_uploads_linear_app(self):
        # no --allowed-hosts: a 127.0.0.1 URL must be skipped host-not-allowed
        md = self.w("in2.md", f"![x]({self.server.url('/img/photo.png')})")
        r = run("--markdown", md, "--out", os.path.join(self.dir, "att2"),
                "--spec-out", os.path.join(self.dir, "spec2.md"))
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual([s["reason"] for s in out["skipped"]], ["host-not-allowed"])
        self.assertEqual(self.server.hits, {})

    # ------------------------------------------------------- naming/ext ------

    def test_filename_sanitize_and_dedupe_collision(self):
        url_a = self.server.url("/a/photo.png")
        url_b = self.server.url("/b/photo.png")
        md = f"![a]({url_a})\n![b]({url_b})"
        out, _, out_dir, spec_bytes = self.invoke(md)
        locals_ = sorted(d["local"] for d in out["downloaded"])
        self.assertEqual(locals_, ["attachments/photo-2.png", "attachments/photo.png"])
        self.assertIn(b"attachments/photo.png", spec_bytes)
        self.assertIn(b"attachments/photo-2.png", spec_bytes)
        self.assertTrue(os.path.isfile(os.path.join(out_dir, "photo.png")))
        self.assertTrue(os.path.isfile(os.path.join(out_dir, "photo-2.png")))

    def test_title_hint_path_traversal_stripped(self):
        url = self.server.url("/img/photo.png")
        md = ('<linear-image>{"attrs": {"src": "%s", "title": "../../etc/passwd"}}'
              "</linear-image>" % url)
        out, _, out_dir, _ = self.invoke(md)
        # basename of the title is "passwd", sanitized; no traversal in the name
        name = out["downloaded"][0]["title"]
        self.assertNotIn("..", name)
        self.assertNotIn("/", name)
        self.assertTrue(os.path.isfile(os.path.join(out_dir, name)))

    def test_content_type_extension_when_name_has_none(self):
        url = self.server.url("/img/logo")
        out, _, out_dir, _ = self.invoke(f"![logo]({url})")
        self.assertEqual(out["downloaded"][0]["local"], "attachments/logo.png")
        with open(os.path.join(out_dir, "logo.png"), "rb") as f:
            self.assertEqual(f.read(), b"logo-bytes")

    def test_binary_content_written_as_received_with_bin_ext(self):
        url = self.server.url("/data/blob")
        out, _, out_dir, _ = self.invoke(f"![blob]({url})")
        self.assertEqual(out["downloaded"][0]["local"], "attachments/blob.bin")
        with open(os.path.join(out_dir, "blob.bin"), "rb") as f:
            self.assertEqual(f.read(), b"\x00\x01\x02\xff")

    # ------------------------------------------------------- skip / refresh --

    def test_skip_if_exists_vs_refresh(self):
        url = self.server.url("/img/photo.png")
        md = f"![x]({url})"
        out1, _, _, spec1 = self.invoke(md)
        self.assertEqual(len(out1["downloaded"]), 1)
        self.assertEqual(self.server.hits.get("/img/photo.png"), 1)

        # second run: skip-if-exists, link still rewritten, no new hit
        out2, _, _, spec2 = self.invoke(md, in_name="in2.md")
        self.assertEqual(out2["downloaded"], [])
        self.assertEqual(out2["skipped"], [{"url": url, "reason": "exists"}])
        self.assertEqual(self.server.hits.get("/img/photo.png"), 1)
        self.assertIn(b"attachments/photo.png", spec2)

        # --refresh: re-download
        out3, _, _, _ = self.invoke(md, extra_args=["--refresh"], in_name="in3.md")
        self.assertEqual(len(out3["downloaded"]), 1)
        self.assertEqual(out3["skipped"], [])
        self.assertEqual(self.server.hits.get("/img/photo.png"), 2)

    def test_skip_if_exists_with_content_type_ext(self):
        url = self.server.url("/img/logo")  # saved as logo.png on the first run
        md = f"![x]({url})"
        self.invoke(md)
        self.assertEqual(self.server.hits.get("/img/logo"), 1)
        out2, _, _, spec2 = self.invoke(md, in_name="in2.md")
        self.assertEqual(out2["skipped"], [{"url": url, "reason": "exists"}])
        self.assertIn(b"attachments/logo.png", spec2)
        self.assertEqual(self.server.hits.get("/img/logo"), 1)

    # ------------------------------------------------------------- failures --

    def test_failed_download_404_keeps_remote_url_and_lands_in_failed(self):
        url = self.server.url("/missing.png")
        out, _, _, spec_bytes = self.invoke(f"![x]({url})")
        self.assertEqual(out["downloaded"], [])
        self.assertEqual(out["skipped"], [])
        self.assertEqual(len(out["failed"]), 1)
        self.assertEqual(out["failed"][0]["url"], url)
        self.assertIn("404", out["failed"][0]["error"])
        self.assertIn(url.encode(), spec_bytes)  # remote URL kept

    def test_failed_download_connection_refused_exit_0(self):
        url = dead_url()
        out, _, _, spec_bytes = self.invoke(f"![x]({url})")
        self.assertEqual(len(out["failed"]), 1)
        self.assertEqual(out["failed"][0]["url"], url)
        self.assertIn(url.encode(), spec_bytes)

    # ------------------------------------------------------------ extra URLs --

    def test_urls_file_strings_and_objects(self):
        photo = self.server.url("/img/photo.png")
        pdf = self.server.url("/doc/file.pdf")
        urls_file = self.w("urls.json", json.dumps([
            photo,
            {"url": pdf, "title": "My Doc.PDF"},
        ]))
        out, _, out_dir, spec_bytes = self.invoke("no urls here\n",
                                                   extra_args=["--urls-file", urls_file])
        self.assertEqual(out["failed"], [])
        by_url = {d["url"]: d for d in out["downloaded"]}
        self.assertEqual(by_url[photo]["local"], "attachments/photo.png")
        self.assertEqual(by_url[pdf]["local"], "attachments/My_Doc.PDF")
        self.assertTrue(os.path.isfile(os.path.join(out_dir, "My_Doc.PDF")))
        self.assertEqual(spec_bytes, b"no urls here\n")  # nothing to rewrite

    def test_url_flag_repeatable(self):
        photo = self.server.url("/img/photo.png")
        pdf = self.server.url("/doc/file.pdf")
        out, _, _, _ = self.invoke("", extra_args=["--url", photo, "--url", pdf])
        self.assertEqual(sorted(d["local"] for d in out["downloaded"]),
                         ["attachments/file.pdf", "attachments/photo.png"])

    def test_urls_file_url_also_in_markdown_rewritten(self):
        photo = self.server.url("/img/photo.png")
        urls_file = self.w("urls.json", json.dumps([photo]))
        out, _, _, spec_bytes = self.invoke(f"![x]({photo})",
                                            extra_args=["--urls-file", urls_file])
        self.assertEqual(len(out["downloaded"]), 1)  # downloaded once
        self.assertIn(b"attachments/photo.png", spec_bytes)

    # ------------------------------------------------------------ misuse -----

    def test_unreadable_markdown_exit_2_empty_stdout(self):
        r = run("--markdown", os.path.join(self.dir, "nope.md"),
                "--out", os.path.join(self.dir, "a"),
                "--spec-out", os.path.join(self.dir, "s.md"))
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")
        self.assertNotEqual(r.stderr, "")

    def test_out_is_a_file_exit_2(self):
        md = self.w("in.md", "hi")
        out_file = self.w("outfile", "not a dir")
        r = run("--markdown", md, "--out", out_file,
                "--spec-out", os.path.join(self.dir, "s.md"))
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")

    def test_invalid_urls_file_exit_2(self):
        md = self.w("in.md", "hi")
        bad = self.w("bad.json", "{not json")
        r = run("--markdown", md, "--out", os.path.join(self.dir, "a"),
                "--spec-out", os.path.join(self.dir, "s.md"),
                "--urls-file", bad)
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")

    def test_out_dir_created_when_missing(self):
        url = self.server.url("/img/photo.png")
        out_dir = os.path.join(self.dir, "deep", "nested", "attachments")
        md = self.w("in.md", f"![x]({url})")
        r = run("--markdown", md, "--out", out_dir,
                "--spec-out", os.path.join(self.dir, "s.md"),
                "--allowed-hosts", HOST)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(out_dir, "photo.png")))


if __name__ == "__main__":
    unittest.main()
