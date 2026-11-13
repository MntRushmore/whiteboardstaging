#!/usr/bin/env python3
"""The school demo's picture-tutor scripts (docs/DEMO-VIDEOS.md): a fluent writer's hand on the real
board, for Debug's PictureDemoPlayer (`-pictureDemo <script.json>`).

The hand is a single-line font (EMS Readability Italic, SIL OFL, from Inkscape's svg_fonts; kept on
this Mac, never in the repo: --font), laid out in the page's units (1600 × 900) with a writer's
variation: each glyph a little up or down and bigger or smaller, the line drifting, the pen wobbling,
and a writer's pace (quick inside a letter, a breath between words). `{3/8}` is a stacked fraction.
Nothing here is anyone's real handwriting.

    demo-pen.py --font <EMSReadabilityItalic.svg> --out <dir> [ids…]
"""
import argparse, html, json, math, os, random, re

# MARK: - the font


def load_font(path):
    s = open(path).read()
    fadv = float(re.search(r'<font [^>]*horiz-adv-x="([\d.]+)"', s).group(1))
    glyphs = {}
    for m in re.finditer(r"<glyph ([^>]*)/>", s):
        a = m.group(1)
        u = re.search(r'unicode="([^"]*)"', a)
        if not u:
            continue
        ch = html.unescape(u.group(1))
        adv = re.search(r'horiz-adv-x="([-\d.]+)"', a)
        d = re.search(r' d="([^"]*)"', a)
        strokes, cur, cmd = [], None, None
        if d:
            toks = re.findall(r"[A-Za-z]|-?[\d.]+(?:[eE]-?\d+)?", d.group(1))
            i = 0
            while i < len(toks):
                t = toks[i]
                if t.isalpha():
                    cmd = t
                    i += 1
                    continue
                if cmd == "M":
                    cur = [(float(toks[i]), float(toks[i + 1]))]
                    strokes.append(cur)
                    i += 2
                    cmd = "L"
                elif cmd == "L":
                    cur.append((float(toks[i]), float(toks[i + 1])))
                    i += 2
                elif cmd == "C":
                    p0 = cur[-1]
                    p1, p2, p3 = [(float(toks[i + 2 * j]), float(toks[i + 2 * j + 1])) for j in range(3)]
                    i += 6
                    for k in range(1, 9):
                        u_, v = k / 8, 1 - k / 8
                        cur.append(tuple(v ** 3 * p0[c] + 3 * v * v * u_ * p1[c] + 3 * v * u_ * u_ * p2[c] + u_ ** 3 * p3[c] for c in range(2)))
                else:
                    i += 1
        glyphs[ch] = (float(adv.group(1)) if adv else fadv, strokes)
    return glyphs


# MARK: - a writer's hand


class Hand:
    def __init__(self, glyphs, seed, size=62, speed=720):
        self.g = glyphs
        self.rng = random.Random(seed)
        self.size = size
        self.speed = speed  # page units a second while the pen moves

    def u(self, a, b):
        return self.rng.uniform(a, b)

    def glyph(self, ch, x, base, size, drift):
        """One glyph's strokes (page units, y down) at pen position x on `base`; returns (strokes, advance)."""
        ch = {"−": "-", "’": "'"}.get(ch, ch)
        if ch not in self.g and ch == "×":
            return self.times(x, base, size, drift)
        adv, st = self.g.get(ch) or self.g.get("?")
        k = size / 1000.0 * self.u(0.96, 1.04)
        dy = self.u(-0.012, 0.012) * size
        rot = math.radians(self.u(-1.2, 1.2))
        c, s = math.cos(rot), math.sin(rot)
        cx = adv * k / 2
        out = []
        for stroke in st:
            pts = []
            for px, py in stroke:
                X, Y = px * k - cx, -py * k
                X, Y = X * c - Y * s, X * s + Y * c
                pts.append((x + cx + X, base + dy + drift(x) + Y))
            out.append(pts)
        return out, adv * size / 1000.0

    def times(self, x, base, size, drift):
        """× drawn as two short crossing strokes, at the height of a minus."""
        w = size * 0.42
        cy = base - size * 0.27 + drift(x)
        h = w * 0.5
        x0 = x + size * 0.08
        st = [[(x0, cy - h), (x0 + h * 2, cy + h)], [(x0 + h * 2, cy - h), (x0, cy + h)]]
        return st, w + size * 0.16

    def text(self, text, x, y, size=None):
        """A line of text, its baseline at y. `{a/b}` is a stacked fraction. Returns a list of
        (strokes, kind) groups in writing order: kind is 'glyph' or 'space' (for the pace)."""
        size = size or self.size
        slope = math.tan(math.radians(self.u(-0.5, 0.5)))
        phase = self.u(0, 6.28)
        drift = lambda px: (px - x) * slope + math.sin((px - x) / (size * 6) + phase) * size * 0.03
        out = []
        pen = x
        for tok in re.findall(r"\{[^}]*\}|.", text):
            if tok.startswith("{"):
                num, den = tok[1:-1].split("/")
                fs = size * 0.78
                wn = sum(self.g.get(ch, (0, []))[0] for ch in num) * fs / 1000
                wd = sum(self.g.get(ch, (0, []))[0] for ch in den) * fs / 1000
                w = max(wn, wd) + fs * 0.25
                mid = y - size * 0.32
                # the numerator, the bar, the denominator (as written)
                for part, width, base in ((num, wn, mid - size * 0.12), (None, w, mid), (den, wd, mid + size * 0.72)):
                    if part is None:
                        b = mid + self.u(-1.5, 1.5)
                        out.append(([[(pen + self.u(-2, 2), b), (pen + w + self.u(-2, 2), b + self.u(-2, 2))]], "glyph"))
                        continue
                    px = pen + (w - width) / 2
                    for ch in part:
                        st, adv = self.glyph(ch, px, base, fs, drift)
                        out.append((st, "glyph"))
                        px += adv
                pen += w + size * 0.12
                continue
            if tok == " ":
                pen += self.g[" "][0] * size / 1000 * self.u(0.68, 0.82)
                out.append(([], "space"))
                continue
            st, adv = self.glyph(tok, pen, y, size, drift)
            out.append((st, "glyph"))
            pen += adv
        return out, pen - x

    def width(self, text, size=None):
        size = size or self.size
        state = self.rng.getstate()
        _, w = self.text(text, 0, 0, size)
        self.rng.setstate(state)
        return w

    def wobble(self, pts):
        """Resampled every ~2.5 units, with a slow, small wobble: a pen, not a plotter."""
        out = []
        for a, b in zip(pts, pts[1:]):
            n = max(1, int(math.dist(a, b) / 2.5))
            for i in range(n):
                t = i / n
                out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        out.append(pts[-1])
        if len(out) < 2:
            out.append((out[0][0] + 0.8, out[0][1] + 0.8))
        ph1, ph2 = self.u(0, 6.28), self.u(0, 6.28)
        amp = self.size * 0.006
        return [(px + amp * math.sin(i * 0.21 + ph1), py + amp * math.sin(i * 0.17 + ph2)) for i, (px, py) in enumerate(out)]

    def step(self, groups, pace=1.0):
        """A `write` step: strokes, the pause before each and how long each takes (ms)."""
        strokes, pauses, durs = [], [], []
        gap = 0.0
        first = True
        for st, kind in groups:
            if kind == "space":
                gap += self.u(170, 300)
                continue
            for j, s in enumerate(st):
                pts = self.wobble(s)
                length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
                pause = 0 if first else (self.u(35, 80) if j > 0 else self.u(60, 130)) + gap
                gap = 0
                first = False
                strokes.append([[round(p[0], 1), round(p[1], 1)] for p in pts])
                pauses.append(round(pause * pace))
                durs.append(round(max(55, length / self.speed * 1000 * self.u(0.85, 1.15)) * pace))
        return {"write": strokes, "pauses": pauses, "durs": durs}

    def line(self, text, x, y, size=None, pace=1.0):
        groups, _ = self.text(text, x, y, size)
        return self.step(groups, pace)

    def shape(self, polylines, pace=1.0):
        """Hand-drawn lines (an arrow, an underline): each polyline a stroke."""
        return self.step([([p for p in polylines], "glyph")], pace)


def arrow(x0, y0, x1, y1, head=16):
    a = math.atan2(y1 - y0, x1 - x0)
    l = (x1 - head * math.cos(a - 0.5), y1 - head * math.sin(a - 0.5))
    r = (x1 - head * math.cos(a + 0.5), y1 - head * math.sin(a + 0.5))
    mid = ((x0 + x1) / 2 + (y1 - y0) * 0.08, (y0 + y1) / 2 - (x1 - x0) * 0.08)
    return [[(x0, y0), mid, (x1, y1)], [l, (x1, y1), r]]


# MARK: - the clips


def clips(font):
    def H(seed, size=60):
        return Hand(font, seed, size=size)

    out = {}

    # 1. Grade 3–4: fractions of a pizza — the engine draws the pizza
    h = H(11)
    out["p1-pizza"] = {
        "title": "Grade 3 · Fractions of a pizza",
        "steps": [
            {"auto": False},
            {"mark": "write"},
            h.line("Maya ate {3/8} of a pizza.", 110, 170),
            {"pause": 0.5},
            h.line("How much of the pizza is left?", 110, 285),
            {"pause": 0.6},
            h.line("Can you draw it?", 110, 385),
            {"mark": "written"},
            {"pause": 0.8},
            {"tap": "picture.drawNow"},
            {"mark": "drawNow"},
            {"waitFor": "ghost", "timeout": 60},
            {"mark": "ghost"},
            {"pause": 2.5},
            {"tap": "picture.accept"},
            {"mark": "accept"},
            {"pause": 2.0},
            {"auto": True},
            {"mark": "answer"},
            h.line("{8/8} − {3/8} = {5/8}", 120, 600, size=64),
            {"pause": 0.4},
            h.line("{5/8} is left", 120, 760, size=60),
            {"mark": "answered"},
            {"waitFor": "tick", "timeout": 30},
            {"mark": "tick"},
            {"pause": 2.5},
        ],
    }

    # 3. Grade 4: an area model for 34 × 6
    h = H(23, size=64)
    out["p3-area"] = {
        "title": "Grade 4 · An area model for 34 × 6",
        "steps": [
            {"auto": False},
            {"mark": "write"},
            h.line("34 × 6 = ?", 120, 180, size=72),
            {"pause": 0.6},
            h.line("Show me with an area model", 120, 300),
            {"mark": "written"},
            {"pause": 0.8},
            {"tap": "picture.drawNow"},
            {"mark": "drawNow"},
            {"waitFor": "ghost", "timeout": 60},
            {"mark": "ghost"},
            {"pause": 2.5},
            {"tap": "picture.accept"},
            {"mark": "accept"},
            {"pause": 2.0},
            {"auto": True},
            {"mark": "answer"},
            h.line("180 + 24 = 204", 120, 640, size=70),
            {"mark": "answered"},
            {"waitFor": "tick", "timeout": 30},
            {"mark": "tick"},
            {"pause": 2.5},
        ],
    }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("ids", nargs="*")
    a = ap.parse_args()
    font = load_font(a.font)
    os.makedirs(a.out, exist_ok=True)
    for cid, spec in clips(font).items():
        if a.ids and cid not in a.ids:
            continue
        spec = {"id": cid, **spec}
        with open(os.path.join(a.out, f"{cid}.json"), "w") as f:
            json.dump(spec, f)
        n = sum(len(s.get("write", [])) for s in spec["steps"])
        print(f"{cid}: {n} strokes")


if __name__ == "__main__":
    main()
