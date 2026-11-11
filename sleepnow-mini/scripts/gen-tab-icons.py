#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 tabBar 图标与锁屏音频封面（纯标准库，无第三方依赖）。

用法：python3 scripts/gen-tab-icons.py

产出：
  assets/tab/<name>.png           未选中态：中性灰描边，深/浅主题下都可见
  assets/tab/<name>-on.png        选中态（浅色主题）：近黑实心
  assets/tab/<name>-on-dark.png   选中态（深色主题）：近白实心
  assets/cover.png                后台音频锁屏封面（300x300 黑白灰）

设计约束与 design-system/MASTER.md 一致：纯灰阶、无渐变、无彩色。
3x 超采样降采样得到抗锯齿边缘；PNG 用 zlib/struct 手写，便于离线重建。
"""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAB_DIR = os.path.join(ROOT, 'assets', 'tab')
S = 3  # 超采样倍率

GRAY = (0x8A, 0x8A, 0x8A, 0xFF)
BLACK = (0x11, 0x11, 0x11, 0xFF)
WHITE = (0xF2, 0xF2, 0xF2, 0xFF)
TRANSPARENT = (0, 0, 0, 0)


def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))


class Canvas:
    def __init__(self, size):
        self.size = size
        self.n = size * S
        self.buf = bytearray(self.n * self.n * 4)

    def _set_raw(self, x, y, color):
        if 0 <= x < self.n and 0 <= y < self.n:
            o = (y * self.n + x) * 4
            self.buf[o:o + 4] = bytes(color)

    def point(self, x, y, r, color):
        self.circle_fill(x, y, r, color)

    def line(self, x0, y0, x1, y1, w, color):
        X0, Y0, X1, Y1, W = (v * S for v in (x0, y0, x1, y1, w))
        lo_x, hi_x = int(min(X0, X1) - W) - 1, int(max(X0, X1) + W) + 2
        lo_y, hi_y = int(min(Y0, Y1) - W) - 1, int(max(Y0, Y1) + W) + 2
        dx, dy = X1 - X0, Y1 - Y0
        l2 = dx * dx + dy * dy or 1
        half = (W / 2) ** 2
        for y in range(max(0, lo_y), min(self.n, hi_y)):
            for x in range(max(0, lo_x), min(self.n, hi_x)):
                t = max(0.0, min(1.0, ((x - X0) * dx + (y - Y0) * dy) / l2))
                d2 = (x - (X0 + t * dx)) ** 2 + (y - (Y0 + t * dy)) ** 2
                if d2 <= half:
                    self._set_raw(x, y, color)

    def rect_fill(self, x0, y0, x1, y1, color):
        for y in range(int(y0 * S), int(y1 * S) + 1):
            for x in range(int(x0 * S), int(x1 * S) + 1):
                self._set_raw(x, y, color)

    def rect_stroke(self, x0, y0, x1, y1, w, color):
        self.line(x0, y0, x1, y0, w, color)
        self.line(x1, y0, x1, y1, w, color)
        self.line(x1, y1, x0, y1, w, color)
        self.line(x0, y1, x0, y0, w, color)

    def circle_fill(self, cx, cy, r, color):
        CX, CY, R = cx * S, cy * S, r * S
        for y in range(int(CY - R) - 1, int(CY + R) + 2):
            for x in range(int(CX - R) - 1, int(CX + R) + 2):
                if (x - CX) ** 2 + (y - CY) ** 2 <= R * R:
                    self._set_raw(x, y, color)

    def circle_stroke(self, cx, cy, r, w, color):
        CX, CY, R, W = cx * S, cy * S, r * S, w * S
        outer, inner = (R + W / 2) ** 2, (R - W / 2) ** 2
        for y in range(int(CY - R - W) - 1, int(CY + R + W) + 2):
            for x in range(int(CX - R - W) - 1, int(CX + R + W) + 2):
                d2 = (x - CX) ** 2 + (y - CY) ** 2
                if inner <= d2 <= outer:
                    self._set_raw(x, y, color)

    def round_rect(self, x0, y0, x1, y1, r, color, w=None):
        if w is None:
            self.rect_fill(x0 + r, y0, x1 - r, y1, color)
            self.rect_fill(x0, y0 + r, x1, y1 - r, color)
            for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r),
                           (x0 + r, y1 - r), (x1 - r, y1 - r)):
                self.circle_fill(cx, cy, r, color)
        else:
            self.line(x0 + r, y0, x1 - r, y0, w, color)
            self.line(x1, y0 + r, x1, y1 - r, w, color)
            self.line(x1 - r, y1, x0 + r, y1, w, color)
            self.line(x0, y1 - r, x0, y0 + r, w, color)
            for cx, cy, a0, a1 in ((x0 + r, y0 + r, 180, 270), (x1 - r, y0 + r, 270, 360),
                                  (x1 - r, y1 - r, 0, 90), (x0 + r, y1 - r, 90, 180)):
                for deg in range(a0, a1 + 1, 3):
                    rad = math.radians(deg)
                    self.point(cx + r * math.cos(rad), cy + r * math.sin(rad), w / 2, color)

    def arc(self, cx, cy, rx, ry, a0, a1, w, color):
        for deg in range(a0, a1 + 1, 2):
            rad = math.radians(deg)
            self.point(cx + rx * math.cos(rad), cy + ry * math.sin(rad), w / 2, color)

    def save(self, path):
        raw = bytearray()
        for y in range(self.size):
            raw.append(0)  # filter type: none
            for x in range(self.size):
                r = g = b = a = 0
                for j in range(S):
                    for i in range(S):
                        o = (((y * S + j) * self.n) + (x * S + i)) * 4
                        p = self.buf[o:o + 4]
                        r += p[0]; g += p[1]; b += p[2]; a += p[3]
                n = S * S
                raw += bytes((r // n, g // n, b // n, a // n))
        ihdr = struct.pack('>IIBBBBB', self.size, self.size, 8, 6, 0, 0, 0)
        png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
               + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))
        with open(path, 'wb') as f:
            f.write(png)
        return len(png)


def draw_icon(name, c, col, selected):
    w = 7.0 if selected else 4.0
    if name == 'home':
        c.line(40, 14, 12, 39, w, col)
        c.line(40, 14, 68, 39, w, col)
        c.line(20, 38, 20, 68, w, col)
        c.line(60, 38, 60, 68, w, col)
        c.line(20, 68, 60, 68, w, col)
        if selected:
            c.rect_fill(34, 50, 46, 68, col)
        else:
            c.line(34, 68, 34, 50, w, col)
            c.line(46, 68, 46, 50, w, col)
            c.line(34, 50, 46, 50, w, col)
    elif name == 'sounds':
        for x, h in ((22, 24), (40, 42), (58, 28)):
            if selected:
                c.rect_fill(x - 5, 40 - h / 2, x + 5, 40 + h / 2, col)
            else:
                c.line(x, 40 - h / 2, x, 40 + h / 2, w, col)
        c.line(14, 62, 67, 62, w, col)
    elif name == 'log':
        for y in (26, 41, 56):
            if selected:
                c.rect_fill(17, y - 6, 29, y + 6, col)
                c.rect_fill(35, y - 4, 65, y + 4, col)
            else:
                c.rect_stroke(17, y - 6, 29, y + 6, w, col)
                c.line(35, y, 65, y, w, col)
    elif name == 'chat':
        if selected:
            c.round_rect(13, 17, 67, 55, 11, col)
            # 气泡尾巴：实心三角
            for yy in range(52, 68):
                span = (68 - yy) * 1.2
                c.line(25, yy, 25 + span, yy, 2, col)
            for x in (28, 40, 52):
                c.circle_fill(x, 36, 3.5, TRANSPARENT)
        else:
            c.round_rect(13, 17, 67, 55, 11, col, w)
            c.line(26, 54, 26, 66, w, col)
            c.line(26, 66, 40, 54, w, col)
            for x in (28, 40, 52):
                c.circle_fill(x, 36, 3, col)
    elif name == 'mine':
        if selected:
            c.circle_fill(40, 28, 13, col)
        else:
            c.circle_stroke(40, 28, 13, w, col)
        c.arc(40, 46, 24, 22, 0, 180, w + 2, col)
        c.line(16, 66, 64, 66, w, col)


def gen_cover():
    size = 300
    c = Canvas(size)
    bg = (0x14, 0x14, 0x14, 0xFF)
    fg = (0xF2, 0xF2, 0xF2, 0xFF)
    c.rect_fill(0, 0, size - 1, size - 1, bg)
    c.circle_stroke(150, 150, 108, 4, fg)
    c.circle_fill(150, 150, 62, fg)
    c.circle_fill(176, 126, 56, bg)  # 挖出弯月
    for x, y, r in ((92, 78, 4), (216, 96, 3), (210, 206, 3), (88, 214, 3)):
        c.circle_fill(x, y, r, fg)
    path = os.path.join(ROOT, 'assets', 'cover.png')
    return path, c.save(path)


def main():
    os.makedirs(TAB_DIR, exist_ok=True)
    made = []
    for name in ('home', 'sounds', 'log', 'chat', 'mine'):
        variants = (
            (name + '.png', GRAY, False),
            (name + '-on.png', BLACK, True),
            (name + '-on-dark.png', WHITE, True),
        )
        for filename, color, selected in variants:
            c = Canvas(81)
            draw_icon(name, c, color, selected)
            path = os.path.join(TAB_DIR, filename)
            made.append((os.path.relpath(path, ROOT), c.save(path)))
    made.append(gen_cover())
    for path, size in made:
        print('  %-38s %6d B' % (path, size))
    print('生成 %d 个资源' % len(made))


if __name__ == '__main__':
    main()
