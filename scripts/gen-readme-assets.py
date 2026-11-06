#!/usr/bin/env python3
"""Generate README image assets for dsh-claude-move (docs/assets/).

Outputs (idempotent overwrite):
  dsh-claude-move-flow-light.svg / dsh-claude-move-flow-dark.svg
      Hero migration-flow diagram. Two hand-written SVG files (vector — never
      rasterized to webp). Text inside is command-surface tokens only
      (~/.claude, claude_scan, import_claude, sessionPersistence, move_run,
      claude_export, ...), so all five README languages share the same pair.

No evidence chart is produced: this repository ships no benchmark/measurement
data. Pillow and the CJK font probe stay in place so that adding such a chart
later fails loud instead of rendering tofu boxes.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (pip install pillow)
"""
from __future__ import annotations

import os
import sys

# Pillow is imported for the shared palette/font contract with the rest of the
# PerryLink family; this repository currently has no raster asset to draw.
from PIL import ImageFont  # noqa: F401  (kept for the evidence chart path)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
ORANGE = {"light": "#bc4c00", "dark": "#d29922"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}

# --- CJK font probe: Chinese must never render as tofu boxes ----------------
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",      # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",    # SimHei
    r"C:\Windows\Fonts\Deng.ttf",      # DengXian
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
if FONT_PATH is None:
    sys.exit("FATAL: no CJK font found (looked for msyh.ttc, simhei.ttf, "
             "Deng.ttf, Noto Sans CJK, PingFang). Refusing to render Chinese "
             "as tofu boxes; install one of the probed fonts and re-run.")

# ---------------------------------------------------------------------------
# Hero migration-flow SVG (light + dark)
# ---------------------------------------------------------------------------
# Row 1: the session import path. Row 2: the four-source wizard path.
# Every label is a real command / event / config token from this repository.
ROW1 = [
    ("~/.claude", "read-only"),
    ("claude_scan", "index · cache"),
    ("import_claude", "copy-only · incremental"),
    ("sessionPersistence", "create + append"),
    ("claudecode", "workspace"),
]
ROW2 = [
    ("/move", "one-shot wizard"),
    ("move_detect", "4 sources"),
    ("move_preview", "new | changed | conflict"),
    ("move_run", "approval-gated · move.json"),
    ("AGENTS.md", "skills · commands"),
]
FOOT1 = ("claude_export → *.jsonl · memory → systemPrompt · "
         "skills → ctx.skills · commands → ctx.commands")
FOOT2 = ("source files read-only · sessions create + append only · "
         "wizard writes approval-gated")


def _arrow(x: int, y: int, length: int, color: str) -> list[str]:
    ax = x + 6
    return [
        f'<path d="M{ax} {y}h{length - 12}" stroke="{color}" stroke-width="3"/>',
        f'<path d="M{ax + length - 14} {y - 7}l10 7-10 7" fill="none" '
        f'stroke="{color}" stroke-width="3" stroke-linecap="round" '
        f'stroke-linejoin="round"/>',
    ]


def _row(nodes, y: int, skin: str) -> list[str]:
    s = SKIN[skin]
    parts: list[str] = []
    w, gap, nw, nh = 1200, 45, 180, 92
    for i, (label, sub) in enumerate(nodes):
        x = 60 + i * (nw + gap)
        accent = GREEN[skin] if i in (0, len(nodes) - 1) else (
            FAMILY if 1 <= i <= 2 else s["border"])
        parts.append(
            f'<rect x="{x}" y="{y}" width="{nw}" height="{nh}" rx="14" '
            f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y + 38}" fill="{s["text"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="15" font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y + 62}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="11">{sub}</text>')
        if i < len(nodes) - 1:
            parts.extend(_arrow(x + nw, y + nh // 2, gap, s["sub"]))
    return parts


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    w, h = 1200, 460
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" '
        f'aria-label="dsh-claude-move migration flow">',
        '<title>dsh-claude-move migration flow</title>',
        f'<rect width="{w}" height="{h}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="60" y="58" fill="{s["text"]}" font-family="ui-sans-serif,'
        f'system-ui,sans-serif" font-size="30" font-weight="700">'
        f'dsh-claude-move</text>',
        f'<text x="60" y="90" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="15">~/.claude · ~/.codex · ~/.opencode · '
        f'~/.hermes → DeepSeek Harness</text>',
        f'<line x1="60" y1="112" x2="1140" y2="112" stroke="{s["border"]}"/>',
    ]
    parts.extend(_row(ROW1, 140, skin))
    parts.extend(_row(ROW2, 290, skin))
    parts.append(
        f'<line x1="60" y1="398" x2="1140" y2="398" '
        f'stroke="{s["border"]}" stroke-dasharray="4 6"/>')
    parts.append(
        f'<text x="60" y="424" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="13">{FOOT1}</text>')
    parts.append(
        f'<text x="60" y="448" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="12">{FOOT2}</text>')
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        with open(os.path.join(OUT, f"dsh-claude-move-flow-{skin}.svg"),
                  "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    print("wrote 2 SVG flow assets to docs/assets/ "
          "(no evidence chart: this repository ships no benchmark data)")


if __name__ == "__main__":
    main()
