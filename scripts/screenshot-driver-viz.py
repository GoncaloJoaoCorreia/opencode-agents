#!/usr/bin/env python3
"""Regenerate the README screenshot — a mock terminal-window capture of the driver-viz
sidebar section, matching what the TUI actually renders (see plugins/driver-viz/lib/FlowChart.tsx).

    python3 scripts/screenshot-driver-viz.py

Lives in top-level scripts/ on purpose: the release payload ships only plugins/, and
this generator must NOT be installed into the OpenCode config dir.
Requires: pillow (pip install pillow) and a JetBrains Mono Nerd Font on the system
(covers the braille spinner + box-drawing glyphs).
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


def load_font():
    if not FONT_CANDIDATES:
        sys.exit("no JetBrains Mono/Menlo font found — install a Nerd Font mono")
    path = FONT_CANDIDATES[0]
    kw = {"fontNumber": 0} if path.endswith(".ttc") else {}
    regular = ImageFont.truetype(path, FONT_SIZE * SCALE, **kw)
    bold = None
    if BOLD_CANDIDATES:
        bp = BOLD_CANDIDATES[0]
        bkw = {"fontNumber": 0} if bp.endswith(".ttc") else {}
        bold = ImageFont.truetype(bp, FONT_SIZE * SCALE, **bkw)
    return regular, bold or regular


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
        w = sum((bold if seg[2] else font).getlength(seg[0]) for seg in segs)
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
    title_font = ImageFont.truetype(FONT_CANDIDATES[0], 18 * SCALE, **({"fontNumber": 0} if FONT_CANDIDATES[0].endswith(".ttc") else {}))
    d.text(((PAD_X + 3 * 30 + 16) * SCALE, (BAR_H * SCALE - 18 * SCALE) // 2 - 2 * SCALE), "opencode — ~/repo", font=title_font, fill=MUTED)
    d.line([0, BAR_H * SCALE, width, BAR_H * SCALE], fill=BORDER, width=SCALE)

    # content
    y = BAR_H * SCALE + PAD_Y * SCALE
    for segs in LINES:
        x = PAD_X * SCALE
        for seg in segs:
            text, color, is_bold = seg[0], seg[1], seg[2]
            underline = seg[3] if len(seg) > 3 else False
            f = bold if is_bold else font
            if text:
                d.text((x, y), text, font=f, fill=color)
                if underline:
                    tw = f.getlength(text)
                    uy = y + FONT_SIZE * SCALE + 2 * SCALE
                    d.line([x, uy, x + tw, uy], fill=color, width=SCALE)
            x += f.getlength(text)
        y += LINE_H * SCALE

    img.save(OUT)
    print(f"wrote {OUT} ({img.width}x{img.height})")


if __name__ == "__main__":
    main()
