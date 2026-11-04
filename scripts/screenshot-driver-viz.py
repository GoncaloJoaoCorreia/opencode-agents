#!/usr/bin/env python3
"""Regenerate the README screenshot — a mock terminal-window capture of the driver-viz
sidebar section, matching what the TUI actually renders (see plugins/driver-viz/lib/FlowChart.tsx).

    python3 scripts/screenshot-driver-viz.py

Lives in top-level scripts/ on purpose: the release payload ships only plugins/, and
this generator must NOT be installed into the OpenCode config dir.
Requires: pillow (pip install pillow) and a JetBrains Mono Nerd Font on the system
(covers the braille spinner + box-drawing glyphs). Glyphs missing from the primary
font (e.g. U+25D0-U+25D3, which the Nerd Font mono lacks) fall back per character to
Menlo / Apple Symbols / Apple Color Emoji, so nothing renders as a .notdef tofu box.
Output: docs/driver-viz-sidebar.png (referenced from README.md; docs/ is NOT part of
the release payload either).
"""
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "docs", "driver-viz-sidebar.png"))

# palette = the hex fallbacks in lib/theme.ts (GitHub-dark-ish)
BG = "#0d1117"
PANEL = "#161b22"
BAR = "#21262d"
BASE = "#e6edf3"
MUTED = "#8b949e"
ACCENT = "#58a6ff"
SUCCESS = "#3fb950"
WARNING = "#d29922"
ERROR = "#f85149"
BORDER = "#30363d"
DOT_R, DOT_Y, DOT_G = "#ff5f57", "#febc2e", "#28c840"

FONT_SIZE = 26
LINE_H = 36
PAD_X = 28
PAD_Y = 22
BAR_H = 44
SCALE = 2  # render at 2x for crispness

FONT_CANDIDATES = glob.glob(os.path.expanduser("~/Library/Fonts/JetBrainsMono*NerdFontMono-Regular.ttf")) + \
    glob.glob("/System/Library/Fonts/Menlo.ttc")
BOLD_CANDIDATES = glob.glob(os.path.expanduser("~/Library/Fonts/JetBrainsMono*NerdFontMono-SemiBold.ttf")) + \
    glob.glob(os.path.expanduser("~/Library/Fonts/JetBrainsMono*NerdFontMono-ExtraBold.ttf"))
# Per-glyph fallback fonts, consulted in order after the primary candidates when a
# font's cmap lacks a codepoint: JetBrains Mono Nerd Font has braille (U+2800+) but
# no U+25D0-U+25D3, Menlo covers the half-circle dots, Apple Color Emoji is the only
# macOS font with U+23F1 (⏱).
FALLBACK_CANDIDATES = glob.glob("/System/Library/Fonts/Menlo.ttc") + \
    glob.glob("/System/Library/Fonts/Apple Symbols.ttf") + \
    glob.glob("/System/Library/Fonts/Supplemental/Arial Unicode.ttf") + \
    glob.glob("/System/Library/Fonts/Apple Color Emoji.ttc")

NOTDEF = "\uffff"  # Unicode noncharacter — never in a cmap; renders as the .notdef box


def _truetype(path, size):
    return ImageFont.truetype(path, size, index=0) if path.endswith(".ttc") else ImageFont.truetype(path, size)


def _glyph_bytes(font, ch):
    img = Image.new("L", (4 * font.size, 4 * font.size), 0)
    ImageDraw.Draw(img).text((font.size, font.size), ch, font=font, fill=255)
    return img.tobytes()


class FontSet:
    """An ordered list of fonts at one size with per-glyph fallback: each character
    is drawn with the first font whose cmap covers it (a missing glyph renders as
    the .notdef box, byte-identical to the unmappable U+FFFF noncharacter), so
    symbols absent from the primary mono font never come out as tofu."""

    def __init__(self, size, primaries, fallbacks):
        self.fonts = []
        seen = set()
        for path in list(primaries) + list(fallbacks):
            if path not in seen and os.path.exists(path):
                seen.add(path)
                self.fonts.append(_truetype(path, size))
        if not self.fonts:
            sys.exit("no usable font found — install a JetBrains Mono Nerd Font (Menlo also works)")
        self._cache = {}

    @property
    def primary(self):
        return self.fonts[0]

    def font_for(self, ch):
        for f in self.fonts:
            key = (id(f), ch)
            hit = self._cache.get(key)
            if hit is None:
                hit = _glyph_bytes(f, ch) != _glyph_bytes(f, NOTDEF)
                self._cache[key] = hit
            if hit:
                return f
        return self.primary

    def runs(self, text):
        """Split text into (font, run) pairs so per-glyph fallback keeps advances correct."""
        out = []
        i = 0
        while i < len(text):
            f = self.font_for(text[i])
            j = i + 1
            while j < len(text) and self.font_for(text[j]) is f:
                j += 1
            out.append((f, text[i:j]))
            i = j
        return out

    def length(self, text):
        return sum(f.getlength(run) for f, run in self.runs(text))


def load_font():
    if not FONT_CANDIDATES:
        sys.exit("no JetBrains Mono/Menlo font found — install a Nerd Font mono")
    regular = FontSet(FONT_SIZE * SCALE, FONT_CANDIDATES, FALLBACK_CANDIDATES)
    bold = FontSet(FONT_SIZE * SCALE, BOLD_CANDIDATES + FONT_CANDIDATES, FALLBACK_CANDIDATES)
    return regular, bold


# (text, color, bold[, underline]) segments per line — mirrors a live run: implement
# running, quality-gate skipped via --skip, two runs in the repo, tasks 2/3 done.
# The [Open Plan] affordance uses the palette's link style: muted + underline.
LINES = [
    [("smoke", BASE, False), ("  +", MUTED, False)],
    [("▼ MCP", MUTED, False)],
    [("  • linear-project", MUTED, False), ("   Connected", SUCCESS, False)],
    [("", BASE, False)],
    [("◆ DRIVER ", ACCENT, True), ("ABC-123", MUTED, False), ("  ⏱ 12m34s", MUTED, False), ("  1/2", MUTED, False)],
    [("✓ ", SUCCESS, False), ("Preplan", BASE, False)],
    [("│", BORDER, False)],
    [("✓ ", SUCCESS, False), ("Plan", BASE, False), ("  ", MUTED, False), ("[", MUTED, False), ("Open Plan", MUTED, False, True), ("]", MUTED, False)],
    [("│", BORDER, False)],
    [("⠋ ", ACCENT, True), ("Implement", BASE, True), ("  2/3", MUTED, False)],
    [("  ", MUTED, False), ("●●", SUCCESS, False), ("◐", ACCENT, False)],
    [("┃", ACCENT, False)],
    [("▸ ", ACCENT, False), ("Audit", MUTED, False)],
    [("│", BORDER, False)],
    [("○ ", MUTED, False), ("Review", MUTED, False)],
    [("│", BORDER, False)],
    [("⊘ ", MUTED, False), ("QA", MUTED, False)],
    [("│", BORDER, False)],
    [("○ ", MUTED, False), ("PR", MUTED, False)],
]


def main():
    font, bold = load_font()
    # measure
    max_w = 0
    for segs in LINES:
        w = sum((bold if seg[2] else font).length(seg[0]) for seg in segs)
        max_w = max(max_w, w)
    width = int(max_w) + PAD_X * 2 * SCALE
    height = BAR_H * SCALE + PAD_Y * SCALE * 2 + LINE_H * SCALE * len(LINES)

    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)

    # title bar
    d.rectangle([0, 0, width, BAR_H * SCALE], fill=BAR)
    for i, c in enumerate((DOT_R, DOT_Y, DOT_G)):
        cx = (PAD_X + i * 30) * SCALE
        cy = (BAR_H * SCALE) // 2
        r = 7 * SCALE
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
    title_font = _truetype(FONT_CANDIDATES[0], 18 * SCALE)
    d.text(((PAD_X + 3 * 30 + 16) * SCALE, (BAR_H * SCALE - 18 * SCALE) // 2 - 2 * SCALE), "opencode — ~/repo", font=title_font, fill=MUTED)
    d.line([0, BAR_H * SCALE, width, BAR_H * SCALE], fill=BORDER, width=SCALE)

    # content
    y = BAR_H * SCALE + PAD_Y * SCALE
    for segs in LINES:
        x = PAD_X * SCALE
        for seg in segs:
            text, color, is_bold = seg[0], seg[1], seg[2]
            underline = seg[3] if len(seg) > 3 else False
            fs = bold if is_bold else font
            if text:
                for f, run in fs.runs(text):
                    d.text((x, y), run, font=f, fill=color)
                    x += f.getlength(run)
                if underline:
                    tw = fs.length(text)
                    uy = y + FONT_SIZE * SCALE + 2 * SCALE
                    d.line([x - tw, uy, x, uy], fill=color, width=SCALE)
        y += LINE_H * SCALE

    img.save(OUT)
    print(f"wrote {OUT} ({img.width}x{img.height})")


if __name__ == "__main__":
    main()
