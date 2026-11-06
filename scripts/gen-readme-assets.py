#!/usr/bin/env python3
"""README visuals for dsh-claude-move — hero banner + boundary/gate structure map.

Outputs (idempotent overwrite):
  docs/assets/dsh-claude-move-hero-{zh,en}-{light,dark}.webp   1440x576
  docs/assets/dsh-claude-move-flow-v5-{light,dark}.svg         1100x660

Hero (Pillow): left column = kicker / title / two value lines / sub / meta /
footer; right side = the plugin's own floating migration panel (real bands:
title + refresh/reset/close, keyword filter, project + session rows with the
shipped status badges, progress + bulk import footer), annotated with three
callouts and the panel's real JSON routes.
  zh panel strings come from client/client.js PANEL_STRINGS.zh; en from .en.

Flow (hand-written SVG): the migration is a *boundary with a gate*, so the
structure is two sides of one write barrier — read-only sources + detect/plan/
preview on the left, the four DSH write surfaces on the right, ctx.approval
straddling the barrier (allowed-once vs zero writes), and the move.json ledger
looping back into preview for idempotent re-runs. Vector only; all flow text is
command/path tokens + English descriptors so one pair serves all five READMEs.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow, plus msyh.ttc / msyhbd.ttc / consola.ttf (hard probe).
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'assets')

FONTS = {
    'cjk': r'C:\Windows\Fonts\msyh.ttc',
    'cjk_bold': r'C:\Windows\Fonts\msyhbd.ttc',
    'mono': r'C:\Windows\Fonts\consola.ttf',
}
for _kind, _path in FONTS.items():
    if not os.path.exists(_path):
        raise SystemExit(f'FATAL: font missing for {_kind}: {_path}')

# --- palette ---------------------------------------------------------------
# Page sides follow the family spec; the panel keeps the real drawer colours
# from client/client.js (the shipped panel is dark in both page skins).
SKIN = {
    'light': dict(bg_from='#f9f6fd', bg_to='#e4eaf8', text='#141419',
                  sub='#4d5261', faint='#8f94a4', accent='#4B67B4',
                  accent2='#16a34a', warn='#bc4c00', pill='#ece7f9',
                  grid='#e4e1ee', shadow=(32, 26, 64),
                  panel='#101827', panel_edge='#24344d', panel_text='#e6eefb',
                  panel_sub='#9fb4d4', panel_faint='#8fa8cc',
                  field='#0b1120', field_edge='#24344d', field_text='#6f83a0',
                  btn='#1c2a42', btn_edge='#2f4466', btn_text='#cfe1f7',
                  badge_edge='#33476a', badge_text='#9fb8da',
                  ok_edge='#2f7d4f', ok_text='#7fd6a2',
                  warn_edge='#a4562f', warn_text='#f0b98a',
                  dirty_edge='#a08b2f', dirty_text='#ecd27e',
                  track='#0b1120', bar='#3f6fae', route='#7db4ff'),
    'dark': dict(bg_from='#131a2a', bg_to='#0c1016', text='#f0f3f9',
                 sub='#a8b1c4', faint='#737b8d', accent='#8496f5',
                 accent2='#3fb950', warn='#d29922', pill='#242d42',
                 grid='#2e374b', shadow=(0, 0, 0),
                 panel='#172238', panel_edge='#3a4f74', panel_text='#e8f0fb',
                 panel_sub='#a9c0dd', panel_faint='#8fa2bd',
                 field='#0d1526', field_edge='#33476a', field_text='#7f93b3',
                 btn='#1f2d47', btn_edge='#3a4f74', btn_text='#d7e6fa',
                 badge_edge='#3a4f74', badge_text='#a9c0dd',
                 ok_edge='#3f8f63', ok_text='#8fe0b4',
                 warn_edge='#9a6a3a', warn_text='#f0c697',
                 dirty_edge='#8a7a35', dirty_text='#ecd27e',
                 track='#0b1120', bar='#5b83c9', route='#8fb4e8'),
}


def hx(value: str) -> tuple[int, int, int]:
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def font(size, kind: str = 'cjk') -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONTS[kind], int(round(size)))


def gradient(w: int, h: int, top: str, bottom: str) -> Image.Image:
    img = Image.new('RGB', (w, h))
    draw = ImageDraw.Draw(img)
    a, b = hx(top), hx(bottom)
    for y in range(h):
        t = (y / max(1, h - 1)) ** 1.12
        draw.line([(0, y), (w, y)],
                  fill=tuple(round(p + (q - p) * t) for p, q in zip(a, b)))
    return img


def glow(img: Image.Image, cx: int, cy: int, radius: int, color,
         alpha: int = 46) -> Image.Image:
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    steps = 11
    for i in range(steps, 0, -1):
        rr = radius * i / steps
        draw.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                     fill=color + (round(alpha * (1 - i / (steps + 1))),))
    return Image.alpha_composite(img.convert('RGBA'),
                                 layer.filter(ImageFilter.GaussianBlur(radius / 5))
                                 ).convert('RGB')


def card(img: Image.Image, box, skin, radius=22, shadow=26,
         fill=None, edge=None, width=2) -> Image.Image:
    x0, y0, x1, y1 = box
    if shadow:
        sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        for i in range(shadow, 0, -2):
            sd.rounded_rectangle(
                [x0 - i // 5, y0 + i // 2, x1 + i // 5, y1 + i],
                radius=radius + i // 5,
                fill=skin['shadow'] + (round(7 * (1 - i / shadow)),))
        img = Image.alpha_composite(
            img.convert('RGBA'), sh.filter(ImageFilter.GaussianBlur(12))
        ).convert('RGB')
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(box, radius=radius,
                           fill=hx(fill or skin['panel']),
                           outline=hx(edge or skin['panel_edge']),
                           width=width)
    return img


def text(draw: ImageDraw.ImageDraw, xy, s: str, f, fill, anchor='ls'):
    draw.text(xy, s, font=f, fill=hx(fill), anchor=anchor)


def fit(s: str, kind: str, start: int, maxw: int, low: int = 12):
    """Largest font size whose rendered width stays inside maxw."""
    probe = ImageDraw.Draw(Image.new('RGB', (8, 8)))
    size = start
    while size > low:
        f = font(size, kind)
        if probe.textlength(s, font=f) <= maxw:
            return f
        size -= 1
    return font(low, kind)


def chip(draw: ImageDraw.ImageDraw, box, label: str, f, fg, bg, edge=None,
         pad=10):
    draw.rounded_rectangle(box, radius=(box[3] - box[1]) // 2, fill=hx(bg),
                           outline=hx(edge) if edge else None, width=1)
    draw.text(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2), label, font=f,
              fill=hx(fg), anchor='mm')


def badge(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, f, fg, edge):
    tw = draw.textlength(label, font=f)
    w = int(tw + 18)
    draw.rounded_rectangle([x, y, x + w, y + 22], radius=11, fill=None,
                           outline=hx(edge), width=1)
    draw.text((x + 9, y + 11), label, font=f, fill=hx(fg), anchor='lm')
    return w


def button(draw: ImageDraw.ImageDraw, box, label: str, f, fg, bg, edge):
    draw.rounded_rectangle(box, radius=8, fill=hx(bg), outline=hx(edge),
                           width=1)
    draw.text(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2), label, font=f,
              fill=hx(fg), anchor='mm')


def folder_icon(draw: ImageDraw.ImageDraw, x: int, y: int, color: str):
    draw.rounded_rectangle([x, y + 3, x + 20, y + 8], radius=2,
                           fill=hx(color))
    draw.rounded_rectangle([x, y + 6, x + 20, y + 17], radius=2,
                           fill=hx(color))


def magnifier(draw: ImageDraw.ImageDraw, x: int, y: int, color: str):
    draw.ellipse([x, y, x + 10, y + 10], outline=hx(color), width=2)
    draw.line([x + 8, y + 8, x + 13, y + 13], fill=hx(color), width=2)


def lock_icon(draw: ImageDraw.ImageDraw, x: int, y: int, color: str):
    draw.arc([x + 4, y, x + 24, y + 22], 180, 360, fill=hx(color), width=2)
    draw.rounded_rectangle([x, y + 10, x + 28, y + 32], radius=4,
                           outline=hx(color), width=2)
    draw.ellipse([x + 12, y + 18, x + 16, y + 22], fill=hx(color))


HERO = {
    'zh': dict(
        kicker='DSH 插件 · 四源迁移向导',
        value=['旧会话搬进来，', '接着上次继续聊。'],
        sub='四源迁移向导 + 会话导入器：只复制、不移动、不删除。',
        meta='会话 · 记忆 · 技能 · CLAUDE.md · 斜杠命令',
        foot='Apache-2.0 · 社区插件，与 DeepSeek 官方无关',
        panel_title='Claude Code 迁移',
        buttons=['刷新', '重置缓存'],
        filter='关键字过滤（标题 / 会话）…',
        projects=[('dsh-web-app', 'git 脏'), ('landing-page', '目录不存在')],
        rows=[
            ('会话列表虚拟滚动', '已导入', 'ok', '42 消息 · 7 工具'),
            ('构建脚本整理', '已导入·有新增', 'ok', '18 消息 · 2 工具'),
            ('接口重试策略', '未导入', 'idle', '26 消息 · 5 工具'),
            ('依赖升级评估', '源缺失', 'warn', '9 消息 · 0 工具'),
        ],
        more='已显示 4/12 个会话，点击加载更多…',
        bulk='批量导入全部',
        cancel='取消',
        status='导入中：7/12 新增，2 追加，0 失败',
        calls=[('项目 / 会话树', '文件夹 · 状态徽章'),
               ('每会话状态', '已导入 · 有新增 · 源缺失'),
               ('批量导入 + 进度', '取消 · 分页 · 重置缓存')],
        call_sub_size=12.5,
        route='/api/claude-move/   index · import · progress · job · reset',
        openbtn='Claude 迁移',
    ),
    'en': dict(
        kicker='DSH plugin · four-source migration',
        value=['Old sessions move in,', 'the conversation continues.'],
        sub='Copy-only wizard + importer: nothing moved, nothing deleted.',
        meta='sessions · memory · skills · CLAUDE.md · commands',
        foot='Apache-2.0 · community plugin, not affiliated with DeepSeek',
        panel_title='Claude Code Migration',
        buttons=['Refresh', 'Reset cache'],
        filter='Filter by keyword (title / session)…',
        projects=[('dsh-web-app', 'git dirty'), ('landing-page', 'directory missing')],
        rows=[
            ('Session list virtual scroll', 'imported', 'ok', '42 msgs · 7 tools'),
            ('Build script cleanup', 'imported · new turns', 'ok', '18 msgs · 2 tools'),
            ('Retry strategy', 'not imported', 'idle', '26 msgs · 5 tools'),
            ('Dependency upgrade', 'source missing', 'warn', '9 msgs · 0 tools'),
        ],
        more='Showing 4/12 sessions — click to load more…',
        bulk='Import everything',
        cancel='Cancel',
        status='Importing: 7/12 new, 2 appended, 0 failed',
        calls=[('Project / session tree', 'folders · status badges'),
               ('Per-session state', 'imported · new · missing'),
               ('Bulk import + progress', 'cancel · paging · reset')],
        call_sub_size=12,
        route='/api/claude-move/   index · import · progress · job · reset',
        openbtn='Claude migration',
    ),
}


def hero(lang: str, skin: str) -> None:
    s = SKIN[skin]
    spec = HERO[lang]
    w, h = 1440, 576
    img = gradient(w, h, s['bg_from'], s['bg_to'])
    img = glow(img, 1210, 40, 420, hx(s['accent']), 30 if skin == 'light' else 44)
    img = glow(img, 120, 560, 300, hx(s['accent2']), 10 if skin == 'light' else 16)
    d = ImageDraw.Draw(img)

    # ---------------- left column ----------------
    m = 64
    fk = font(17, 'cjk_bold')
    kw = d.textlength(spec['kicker'], font=fk)
    d.rounded_rectangle([m, 52, m + kw + 38, 92], radius=20,
                        fill=hx(s['pill']), outline=hx(s['accent']), width=1)
    text(d, (m + 19, 73), spec['kicker'], fk, s['accent'], 'lm')

    ft = fit('dsh-claude-move', 'mono', 70, 566, 48)
    text(d, (m - 2, 200), 'dsh-claude-move', ft, s['text'], 'ls')

    fv = font(36, 'cjk_bold')
    text(d, (m, 264), spec['value'][0], fv, s['text'], 'ls')
    text(d, (m, 312), spec['value'][1], fv, s['text'], 'ls')

    fs = fit(spec['sub'], 'cjk', 21, 560, 15)
    text(d, (m, 364), spec['sub'], fs, s['sub'], 'ls')
    fm = fit(spec['meta'], 'cjk', 18, 560, 13)
    text(d, (m, 412), spec['meta'], fm, s['faint'], 'ls')

    d.line([m, 504, m + 498, 504], fill=hx(s['grid']), width=2)
    ff = fit(spec['foot'], 'cjk', 15, 560, 12)
    text(d, (m, 540), spec['foot'], ff, s['faint'], 'ls')

    # four source chips: the same roots the wizard reads, read-only
    fx = m
    fchip = font(13, 'mono')
    for name in ('claude', 'codex', 'opencode', 'hermes'):
        cw = int(d.textlength(name, font=fchip) + 26)
        d.rounded_rectangle([fx, 446, fx + cw, 478], radius=16,
                            fill=None, outline=hx(s['grid']), width=2)
        text(d, (fx + 13, 462), name, fchip, s['sub'], 'lm')
        fx += cw + 10

    # ---------------- right: the shipped floating panel ----------------
    img = card(img, (664, 40, 1218, 532), s, radius=22)
    d = ImageDraw.Draw(img)
    px0, px1 = 688, 1194

    ftitle = fit(spec['panel_title'], 'cjk_bold', 22, 300, 17)
    text(d, (px0, 78), spec['panel_title'], ftitle, s['panel_text'], 'ls')

    # header buttons: refresh / reset cache / close
    fbtn = fit(spec['buttons'][1], 'cjk', 13, 110, 11)
    close_w, gap = 30, 9
    x = px1 - close_w
    button(d, (x, 58, x + close_w, 90), '', font(13, 'cjk'), s['btn_text'],
           s['btn'], s['btn_edge'])
    cx, cy = x + close_w / 2, 74
    d.line([cx - 5, cy - 5, cx + 5, cy + 5], fill=hx(s['btn_text']), width=2)
    d.line([cx - 5, cy + 5, cx + 5, cy - 5], fill=hx(s['btn_text']), width=2)
    for label in reversed(spec['buttons']):
        bw = int(d.textlength(label, font=fbtn) + 26)
        x -= gap + bw
        button(d, (x, 58, x + bw, 90), label, fbtn, s['btn_text'], s['btn'],
               s['btn_edge'])
    d.line([px0, 100, px1, 100], fill=hx(s['panel_edge']), width=1)

    # filter field
    d.rounded_rectangle([px0, 110, px1, 148], radius=10, fill=hx(s['field']),
                        outline=hx(s['field_edge']), width=1)
    magnifier(d, 702, 119, s['field_text'])
    fflt = fit(spec['filter'], 'cjk', 14, px1 - 748, 11)
    text(d, (730, 129), spec['filter'], fflt, s['field_text'], 'lm')

    y = 160
    for index, (slug, tag) in enumerate(spec['projects']):
        folder_icon(d, px0, y, s['panel_faint'])
        fproj = font(16, 'cjk_bold')
        text(d, (px0 + 28, y + 10), slug, fproj, s['panel_text'], 'lm')
        bx = px0 + 34 + d.textlength(slug, font=fproj)
        tone = 'warn' if tag in ('目录不存在', 'directory missing') else 'dirty'
        badge(d, int(bx), y - 1, tag, font(12, 'cjk'),
              s[f'{tone}_text'], s[f'{tone}_edge'])
        rows = spec['rows'][index * 2:index * 2 + 2]
        y += 24
        for title, status, tone2, meta in rows:
            d.rounded_rectangle([px0, y, px1, y + 44], radius=12,
                                fill=hx(s['btn']), outline=hx(s['panel_edge']),
                                width=1)
            fr = font(15, 'cjk')
            text(d, (px0 + 14, y + 23), title, fr, s['panel_text'], 'ls')
            bx = int(px0 + 22 + d.textlength(title, font=fr))
            if tone2 == 'ok':
                badge(d, bx, y + 11, status, font(12, 'cjk'), s['ok_text'],
                      s['ok_edge'])
            elif tone2 == 'warn':
                badge(d, bx, y + 11, status, font(12, 'cjk'), s['warn_text'],
                      s['warn_edge'])
            else:
                badge(d, bx, y + 11, status, font(12, 'cjk'), s['badge_text'],
                      s['badge_edge'])
            fmeta = font(12, 'cjk')
            text(d, (px1 - 14, y + 23), meta, fmeta, s['panel_faint'], 'rs')
            y += 48
        y += 10

    more_size = fit(spec['more'], 'cjk', 13, px1 - px0 - 20, 11)
    text(d, (px0 + 2, 444), spec['more'], more_size, s['panel_faint'], 'ls')

    # footer: progress + bulk import / cancel + status
    d.line([px0, 458, px1, 458], fill=hx(s['panel_edge']), width=1)
    d.rounded_rectangle([px0, 468, px1, 476], radius=4, fill=hx(s['track']))
    d.rounded_rectangle([px0, 468, px0 + int((px1 - px0) * 0.62), 476],
                        radius=4, fill=hx(s['bar']))
    fbulk = font(14, 'cjk_bold')
    bw = int(d.textlength(spec['bulk'], font=fbulk) + 34)
    button(d, (px0, 488, px0 + bw, 522), spec['bulk'], fbulk, s['btn_text'],
           s['bar'], s['btn_edge'])
    fcancel = font(14, 'cjk')
    cw = int(d.textlength(spec['cancel'], font=fcancel) + 30)
    x2 = px0 + bw + 10
    button(d, (x2, 488, x2 + cw, 522), spec['cancel'], fcancel, s['btn_text'],
           s['btn'], s['btn_edge'])
    fstat = fit(spec['status'], 'cjk', 13, px1 - (x2 + cw) - 20, 11)
    text(d, (x2 + cw + 14, 505), spec['status'], fstat, s['panel_faint'], 'lm')

    # ---------------- callouts ----------------
    fcl = fit(spec['calls'][0][0], 'cjk_bold', 15, 168, 12)
    longest = max((sub for _, sub in spec['calls']), key=len)
    fcs = font(11, 'cjk')
    for size in (spec['call_sub_size'], 12, 11.5, 11):
        if d.textlength(longest, font=font(size, 'cjk')) <= 166:
            fcs = font(size, 'cjk')
            break
    for (label, sub), cy in zip(spec['calls'], (158, 300, 470)):
        d.line([1218, cy, 1236, cy], fill=hx(s['faint']), width=1)
        d.ellipse([1232, cy - 2, 1236, cy + 2], fill=hx(s['accent']))
        text(d, (1242, cy - 6), label, fcl, s['text'], 'ls')
        text(d, (1242, cy + 16), sub, fcs, s['faint'], 'ls')

    # route strip + floating open pill
    froute = font(13, 'mono')
    text(d, (664, 560), spec['route'], froute, s['route'], 'ls')
    fpill = font(14, 'cjk_bold')
    pw = int(d.textlength(spec['openbtn'], font=fpill) + 54)
    x3 = 1404 - pw
    d.rounded_rectangle([x3, 540, 1404, 574], radius=17, fill=hx(s['panel']),
                        outline=hx(s['panel_edge']), width=1)
    d.ellipse([x3 + 14, 551, x3 + 26, 563], fill=hx(s['accent']))
    text(d, (x3 + 34, 557), spec['openbtn'], fpill, s['route'], 'lm')

    img.save(os.path.join(OUT, f'dsh-claude-move-hero-{lang}-{skin}.webp'),
             'WEBP', quality=93, method=6)
    print(f'dsh-claude-move-hero-{lang}-{skin}.webp')


# ---------------------------------------------------------------------------
# Flow: read-only sources | write barrier + approval gate | DSH write surface
# ---------------------------------------------------------------------------
FLOW = {
    'light': dict(bg_a='#f9f6fd', bg_b='#e4eaf8', zone='#f7f5fc',
                  card='#ffffff', edge='#e4e1ee', text='#141419',
                  sub='#4d5261', faint='#8f94a4', accent='#4B67B4',
                  accent2='#16a34a', warn='#bc4c00', pill='#ece7f9',
                  grid='#e7e4f0', shadow='#1b1735', shadow_op='0.10',
                  dot='#eeeaf6'),
    'dark': dict(bg_a='#131a2a', bg_b='#0c1016', zone='#161d2b',
                 card='#1b2231', edge='#2e374b', text='#f0f3f9',
                 sub='#a8b1c4', faint='#737b8d', accent='#8496f5',
                 accent2='#3fb950', warn='#d29922', pill='#242d42',
                 grid='#1e2636', shadow='#000000', shadow_op='0.45',
                 dot='#1b2332'),
}


def esc(value: str) -> str:
    return (value.replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def measure(s: str, size: float, mono: bool = False) -> float:
    probe = ImageDraw.Draw(Image.new('RGB', (8, 8)))
    f = ImageFont.truetype(FONTS['mono' if mono else 'cjk'], int(round(size)))
    return probe.textlength(s, font=f)


class Svg:
    """Tiny SVG writer with width checks against the CJK/mono font metrics."""

    def __init__(self, skin: str):
        self.s = FLOW[skin]
        self.parts: list[str] = []
        self.problems: list[str] = []

    def add(self, *lines: str) -> None:
        self.parts.extend(lines)

    def text(self, x, y, s: str, size: float, fill: str, *, mono=False,
             bold=False, anchor='start', maxw=None, opacity=None):
        if maxw is not None:
            got = measure(s, size, mono)
            if got > maxw + 0.5:
                self.problems.append(
                    f'overflow {got:.0f}>{maxw:.0f}: {s[:56]!r}')
        family = ('ui-monospace, SFMono-Regular, Consolas, monospace' if mono
                  else "ui-sans-serif, system-ui, 'Microsoft YaHei', sans-serif")
        weight = ' font-weight="700"' if bold else ''
        anchor_attr = f' text-anchor="{anchor}"' if anchor != 'start' else ''
        op = f' opacity="{opacity}"' if opacity is not None else ''
        self.parts.append(
            f'<text x="{x}" y="{y}" fill="{fill}" font-family="{family}" '
            f'font-size="{size}"{weight}{anchor_attr}{op}>{esc(s)}</text>')

    def svg(self, w: int, h: int) -> str:
        s = self.s
        head = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="0 0 {w} {h}" role="img" aria-label="dsh-claude-move '
            f'migration boundary: read-only sources, approval gate, DSH write '
            f'surface, idempotent move.json">',
            '<title>dsh-claude-move migration boundary and approval gate</title>',
            '<defs>',
            f'  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{s["bg_a"]}"/>'
            f'<stop offset="1" stop-color="{s["bg_b"]}"/></linearGradient>',
            '  <filter id="soft" x="-40%" y="-40%" width="180%" height="200%">',
            f'    <feDropShadow dx="0" dy="8" stdDeviation="11" '
            f'flood-color="{s["shadow"]}" flood-opacity="{s["shadow_op"]}"/>',
            '  </filter>',
            f'  <pattern id="dots" width="26" height="26" '
            f'patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r="1.2" '
            f'fill="{s["dot"]}"/></pattern>',
            f'  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" '
            f'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0 0 L10 5 L0 10 z" fill="{s["accent"]}"/></marker>',
            f'  <marker id="arrf" viewBox="0 0 10 10" refX="9" refY="5" '
            f'markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">'
            f'<path d="M0 0 L10 5 L0 10 z" fill="{s["faint"]}"/></marker>',
            '</defs>',
            f'<rect width="{w}" height="{h}" fill="url(#bg)"/>',
            f'<rect width="{w}" height="{h}" fill="url(#dots)" opacity=".45"/>',
        ]
        return '\n'.join(head + self.parts + ['</svg>']) + '\n'


def flow_svg(skin: str) -> None:
    s = FLOW[skin]
    g = Svg(skin)
    A, G, W, T, SUB, FNT = (s['accent'], s['accent2'], s['warn'],
                            s['text'], s['sub'], s['faint'])

    # header
    g.text(50, 56, 'dsh-claude-move', 32, T, mono=True, bold=True)
    g.text(50, 84, 'copy-only migration · read-only sources · approval gate · '
                   'idempotent move.json', 15, SUB, maxw=1000)
    g.add(f'<line x1="50" y1="100" x2="1050" y2="100" stroke="{s["edge"]}" '
          f'stroke-width="1.5"/>')

    # write barrier (the two sides of the diagram)
    g.add(f'<line x1="676" y1="108" x2="676" y2="534" stroke="{s["faint"]}" '
          f'stroke-width="1.6" stroke-dasharray="7 7" opacity=".85"/>')
    g.add(f'<text x="694" y="300" transform="rotate(-90 694 300)" '
          f'text-anchor="middle" fill="{FNT}" font-family="ui-monospace, '
          f'SFMono-Regular, Consolas, monospace" font-size="11.5" '
          f'letter-spacing="2">WRITE BARRIER</text>')

    # ---- left: read-only sources ----------------------------------------
    g.add(f'<rect x="44" y="114" width="360" height="252" rx="20" '
          f'fill="{s["zone"]}" stroke="{s["edge"]}" stroke-width="1.5"/>')
    g.text(64, 144, 'READ-ONLY SOURCES', 13.5, A, bold=True, maxw=320)
    g.text(64, 163, 'whitelist only · credentials never read', 11, FNT,
           maxw=320)
    sources = [
        ('claude', '$CLAUDE_CONFIG_DIR | ~/.claude'),
        ('codex', '$CODEX_HOME | ~/.codex'),
        ('opencode', 'XDG data + config / opencode'),
        ('hermes', '$HERMES_HOME | ~/.hermes'),
    ]
    for i, (name, root) in enumerate(sources):
        y = 174 + i * 46
        g.add(f'<rect x="58" y="{y}" width="332" height="42" rx="11" '
              f'fill="{s["card"]}" stroke="{s["edge"]}" stroke-width="1.2"/>')
        g.add(f'<circle cx="72" cy="{y + 21}" r="3.4" fill="{A}"/>')
        g.text(84, y + 18, name, 13.5, T, mono=True, bold=True, maxw=140)
        g.text(84, y + 34, root, 11, FNT, mono=True, maxw=290)

    g.text(64, 390, 'auth.json / state db / logs — not in the whitelist', 11,
           FNT, maxw=330)
    g.text(64, 408, 'claude_scan / import_claude reuse the same lanes', 11,
           FNT, maxw=330)

    # plugin-owned cache (the only write outside DSH surfaces) + loop to preview
    g.add(f'<rect x="44" y="424" width="360" height="110" rx="18" '
          f'fill="{s["card"]}" stroke="{s["edge"]}" stroke-width="1.5"/>')
    g.text(64, 452, '$DSH_HOME/claude-move/', 13.5, A, mono=True, bold=True,
           maxw=320)
    g.text(64, 474, 'move.json · index.json · imports.json', 11, SUB, mono=True,
           maxw=320)
    g.text(64, 494, 'digest + targetDigest → idempotent re-runs', 11, SUB,
           maxw=320)
    g.text(64, 514, 'commands rebuilt from move.json on boot', 11, FNT,
           maxw=320)
    g.add(f'<path d="M404 470 H418 V343 H428" fill="none" stroke="{A}" '
          f'stroke-width="2" stroke-dasharray="5 5" marker-end="url(#arr)" '
          f'opacity=".8"/>')

    # ---- middle: detect → plan → preview --------------------------------
    g.add(f'<path d="M404 150 H428" fill="none" stroke="{A}" stroke-width="2.2" '
          f'marker-end="url(#arr)"/>')

    g.add(f'<rect x="428" y="114" width="220" height="68" rx="16" '
          f'fill="{s["card"]}" stroke="{s["edge"]}" stroke-width="1.5"/>')
    g.text(448, 146, 'move_detect', 14.5, T, mono=True, bold=True, maxw=180)
    g.text(448, 166, '4 sources → detections', 11, SUB, maxw=180)

    g.add(f'<path d="M538 182 V196" stroke="{s["faint"]}" stroke-width="2" '
          f'fill="none" marker-end="url(#arrf)"/>')
    g.add(f'<rect x="428" y="196" width="220" height="78" rx="16" '
          f'fill="{s["card"]}" stroke="{s["edge"]}" stroke-width="1.5"/>')
    g.text(448, 228, 'plan[]', 14.5, T, mono=True, bold=True, maxw=180)
    g.text(448, 248, 'key = source:kind:id', 11, SUB, mono=True, maxw=180)
    g.text(448, 266, '5 kinds · one plan per item', 11, FNT, maxw=180)

    g.add(f'<path d="M538 274 V288" stroke="{s["faint"]}" stroke-width="2" '
          f'fill="none" marker-end="url(#arrf)"/>')
    g.add(f'<rect x="428" y="288" width="220" height="120" rx="16" '
          f'fill="{s["card"]}" stroke="{s["edge"]}" stroke-width="1.5"/>')
    g.text(448, 316, 'move_preview', 14.5, T, mono=True, bold=True, maxw=180)
    g.text(448, 331, 'digest compare · diff', 11, SUB, maxw=180)

    states = [('new', 446, 338, A), ('changed', 502, 338, G),
              ('unchanged', 446, 360, FNT), ('conflict', 542, 360, W),
              ('unsupported', 446, 382, FNT)]
    for label, x, y, color in states:
        width = measure(label, 11, mono=True) + 22
        g.add(f'<rect x="{x}" y="{y}" width="{width:.0f}" height="21" rx="10.5" '
              f'fill="{s["pill"]}" stroke="{color}" stroke-width="1.1"/>')
        g.parts.append(
            f'<text x="{x + 11}" y="{y + 14}" fill="{color}" '
            f'font-family="ui-monospace, SFMono-Regular, Consolas, monospace" '
            f'font-size="11">{label}</text>')

    g.add(f'<path d="M538 408 V420" stroke="{A}" stroke-width="2" fill="none" '
          f'marker-end="url(#arr)"/>')

    # ---- the gate: straddles the barrier --------------------------------
    g.add(f'<rect x="428" y="420" width="276" height="114" rx="18" '
          f'fill="{s["card"]}" stroke="{A}" stroke-width="2.2" '
          f'filter="url(#soft)"/>')
    lock_icon_svg = [
        f'<path d="M640 452 a12 12 0 0 1 24 0" fill="none" stroke="{A}" '
        f'stroke-width="2.4"/>',
        f'<rect x="634" y="452" width="36" height="26" rx="5" fill="none" '
        f'stroke="{A}" stroke-width="2.4"/>',
        f'<circle cx="652" cy="464" r="2.8" fill="{A}"/>',
    ]
    g.add(*lock_icon_svg)
    g.text(448, 450, 'move_run · ctx.approval', 13, T, mono=True, bold=True,
           maxw=182)
    g.text(448, 474, 'allowed-once → apply', 11.5, G, maxw=180)
    g.text(448, 494, 'anything else → not-approved', 11.5, SUB, maxw=180)
    g.text(448, 516, 'zero writes · fail-closed', 11.5, W, bold=True, maxw=180)

    # ---- right: DSH write surface --------------------------------------
    g.add(f'<rect x="828" y="112" width="228" height="296" rx="20" '
          f'fill="{s["zone"]}" stroke="{s["edge"]}" stroke-width="1.5"/>')
    g.text(848, 140, 'DSH WRITE SURFACE', 13, A, bold=True, maxw=188)
    g.text(848, 158, 'create + append only', 11, FNT, maxw=188)
    targets = [
        ('sessions', 'sessionPersistence → claudecode'),
        ('AGENTS.md', 'memory + CLAUDE.md · append'),
        ('skills', '$DSH_HOME/skills · real skills'),
        ('commands', 'ctx.commands · rebuilt on boot'),
    ]
    for i, (name, desc) in enumerate(targets):
        y = 176 + i * 56
        g.add(f'<rect x="842" y="{y}" width="200" height="50" rx="11" '
              f'fill="{s["card"]}" stroke="{s["edge"]}" stroke-width="1.2"/>')
        g.text(856, y + 20, name, 13.5, T, mono=True, bold=True, maxw=172)
        g.text(856, y + 37, desc, 11, SUB, maxw=182)
        # bus branch into this lane
        g.add(f'<path d="M712 {y + 25} H836" fill="none" stroke="{A}" '
              f'stroke-width="2" marker-end="url(#arr)" opacity=".9"/>')

    # gate → bus → four lanes
    g.add(f'<path d="M704 468 H712 V201" fill="none" stroke="{A}" '
          f'stroke-width="2.2"/>')
    g.text(720, 545, 'one approval → four surfaces', 11, SUB, maxw=320)

    # reverse export: DSH sessions can leave again as fresh JSONL
    g.add(f'<path d="M946 408 V418" stroke="{s["faint"]}" stroke-width="2" '
          f'fill="none" marker-end="url(#arrf)"/>')
    g.add(f'<rect x="828" y="420" width="228" height="114" rx="18" '
          f'fill="{s["card"]}" stroke="{s["edge"]}" stroke-width="1.5"/>')
    g.text(848, 448, 'claude_export', 13.5, T, mono=True, bold=True, maxw=188)
    g.text(848, 468, 'new *.jsonl · explicit path', 11, SUB, maxw=188)
    g.text(848, 486, 'default $DSH_HOME/claude-export', 11, FNT, maxw=188)
    g.text(848, 506, 'history can leave again', 11, FNT, maxw=188)

    # ---- footnotes ------------------------------------------------------
    g.text(50, 566, 'copy-only · sources read-only · sessions create + append · '
                    'wizard writes are approval-gated', 11, SUB, maxw=1000)
    g.text(50, 586, 'conflict → skip | overwrite | rename | merge (default skip)'
                    ' · unsupported (hooks, unmapped keys) → report only', 11,
           FNT, maxw=1000)
    g.text(50, 606, 'reverse: claude_export → new *.jsonl (explicit path wins) · '
                    'Apache-2.0 · PerryLink DSH plugin family', 11, FNT,
           maxw=1000)

    if g.problems:
        raise SystemExit('FATAL: flow text overflow:\n  ' + '\n  '.join(
            g.problems))

    path = os.path.join(OUT, f'dsh-claude-move-flow-v5-{skin}.svg')
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(g.svg(1100, 660))
    print(f'dsh-claude-move-flow-v5-{skin}.svg')


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for lang in ('zh', 'en'):
        for skin in ('light', 'dark'):
            hero(lang, skin)
    for skin in ('light', 'dark'):
        flow_svg(skin)


if __name__ == '__main__':
    main()
