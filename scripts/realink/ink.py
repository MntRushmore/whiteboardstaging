"""Load kid strokes (draw shapes without meta.live) + tutor ink from a de-identified board; cluster into attempts; render."""
import json, math, os
from PIL import Image, ImageDraw

def _abs(store, v):
    x, y = v.get("x", 0), v.get("y", 0); p = v.get("parentId", "")
    while p.startswith("shape:") and p in store:
        par = store[p]; x += par.get("x", 0); y += par.get("y", 0); p = par.get("parentId", "")
    return x, y, p

def strokes(path):
    d = json.load(open(path)); store = d["store"]; kid, tutor = [], []
    for k, v in store.items():
        if v.get("typeName") != "shape" or v["type"] != "draw": continue
        ox, oy, page = _abs(store, v); s = v["props"].get("scale", 1); r = v.get("rotation", 0)
        cr, sr = math.cos(r), math.sin(r); m = v.get("meta") or {}
        for seg in v["props"]["segments"]:
            pts = [(ox + (p["x"]*cr - p["y"]*sr)*s, oy + (p["x"]*sr + p["y"]*cr)*s, p.get("z", .5)) for p in seg["points"]]
            if not pts: continue
            rec = {"id": k, "page": page, "index": v.get("index", ""), "t": m.get("t"), "t1": m.get("t1"), "pts": pts,
                   "w": {"s": 2, "m": 3.5, "l": 5, "xl": 10}.get(v["props"].get("size"), 3.5) * s, "pen": v["props"].get("isPen")}
            (tutor if "live" in m else kid).append(rec)
    return d, kid, tutor

def bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; return min(xs), min(ys), max(xs), max(ys)

def order(kid):
    return sorted(kid, key=lambda s: (s["t"] if s["t"] is not None else float("inf"), s["index"]))

def cluster(kid, gap=1.4):
    """Union strokes whose boxes, grown by gap x the page's median glyph height, touch. Per page."""
    out = []
    for page in sorted({s["page"] for s in kid}):
        ss = [s for s in kid if s["page"] == page]
        hs = sorted(max(8, bbox(s["pts"])[3]-bbox(s["pts"])[1]) for s in ss); h = hs[len(hs)//2]
        pad = gap*h*0.5; boxes = [bbox(s["pts"]) for s in ss]; par = list(range(len(ss)))
        def f(i):
            while par[i] != i: par[i] = par[par[i]]; i = par[i]
            return i
        for i in range(len(ss)):
            a = boxes[i]
            for j in range(i+1, len(ss)):
                b = boxes[j]
                if a[0]-pad <= b[2]+pad and b[0]-pad <= a[2]+pad and a[1]-pad*0.6 <= b[3]+pad*0.6 and b[1]-pad*0.6 <= a[3]+pad*0.6:
                    par[f(i)] = f(j)
        groups = {}
        for i, s in enumerate(ss): groups.setdefault(f(i), []).append(s)
        for g in groups.values(): out.append({"page": page, "strokes": order(g), "glyph": h})
    return out

def render(strokes_, tutor=(), size=520, margin=20, label=None):
    pts = [p for s in strokes_ for p in s["pts"]]; x0, y0, x1, y1 = bbox(pts)
    pg = {s["page"] for s in strokes_}
    tb = [s for s in tutor if s["page"] in pg and any(x0-200 <= p[0] <= x1+200 and y0-150 <= p[1] <= y1+150 for p in s["pts"][::4])]
    sc = min((size-2*margin)/max(1, x1-x0), (size-2*margin)/max(1, y1-y0), 2.0)
    W = int((x1-x0)*sc+2*margin); H = int((y1-y0)*sc+2*margin) + (18 if label else 0)
    im = Image.new("RGB", (max(W, 160), H), "white"); dr = ImageDraw.Draw(im)
    T = lambda p: ((p[0]-x0)*sc+margin, (p[1]-y0)*sc+margin)
    for s in tb:
        q = [T(p) for p in s["pts"]]; dr.line(q, fill=(170, 200, 255), width=max(1, int(s["w"]*sc*0.6)))
    for s in strokes_:
        q = [T(p) for p in s["pts"]]
        if len(q) == 1: q = q*2
        dr.line(q, fill="black", width=max(2, int(s["w"]*sc*0.7)), joint="curve")
    if label: dr.text((4, H-16), label, fill=(200, 0, 0))
    return im
