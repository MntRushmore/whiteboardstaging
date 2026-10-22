"""Attempts = kid ink in a tutor problem cell (+ the problem), else loose spatial clusters. Lines split by vertical bands."""
import sys, glob, json, math, os; sys.path.insert(0, "tools"); import ink
from PIL import Image, ImageDraw
COLORS = [(0,0,0),(200,30,30),(20,120,20),(30,60,200),(160,0,160),(200,120,0),(0,150,150),(120,80,40),(90,90,90),(220,0,120)]
def lines_of(ss):
    """Rows: tall glyphs band first (vertical overlap), then flat/small strokes (=, -, dots, bars) join the nearest row."""
    bb = {id(s): ink.bbox(s["pts"]) for s in ss}
    hs = sorted(bb[id(s)][3]-bb[id(s)][1] for s in ss); H = max(10, hs[(len(hs)*2)//3])
    tall = [s for s in ss if bb[id(s)][3]-bb[id(s)][1] >= 0.45*H]; small = [s for s in ss if s not in tall]
    rows = []
    for s in sorted(tall, key=lambda s: (bb[id(s)][1]+bb[id(s)][3])/2):
        b = bb[id(s)]; best = None
        for r in rows:
            ov = min(b[3], r["y1"]) - max(b[1], r["y0"]); sm = min(b[3]-b[1], r["y1"]-r["y0"])
            if ov >= 0.4*max(1, sm): best = r; break
        if best: best["s"].append(s); best["y0"] = min(best["y0"], b[1]) if b[3]-b[1] < 2.2*H else best["y0"]; best["y1"] = max(best["y1"], b[3]) if b[3]-b[1] < 2.2*H else best["y1"]
        else: rows.append({"y0": b[1], "y1": b[3], "s": [s]})
    for s in small:
        b = bb[id(s)]; cy = (b[1]+b[3])/2; best, bd = None, 1e9
        for r in rows:
            dd = 0 if r["y0"] <= cy <= r["y1"] else min(abs(cy-r["y0"]), abs(cy-r["y1"]))
            if dd < bd: best, bd = r, dd
        if best and bd <= 0.6*H: best["s"].append(s)
        else: rows.append({"y0": b[1], "y1": b[3], "s": [s]})
    rows.sort(key=lambda r: r["y0"]); return [ink.order(r["s"]) for r in rows]
out = []
for f in sorted(glob.glob("boards/b*.json")):
    d, kid, tutor = ink.strokes(f); store = d["store"]
    if not kid: continue
    cells = {}
    for s in tutor:
        cp = (store[s["id"]].get("meta") or {}).get("chatProblem")
        if isinstance(cp, dict) and "cell" in cp:
            c = cp["cell"]; cells.setdefault((s["page"], c["x"], c["y"], c["w"], c["h"]), cp.get("lines") or [])
    used = set(); n = 0
    for (page, x, y, w, h), prob in cells.items():
        ss = [s for s in kid if s["page"] == page and s["id"] not in used and x <= (ink.bbox(s["pts"])[0]+ink.bbox(s["pts"])[2])/2 <= x+w and y <= (ink.bbox(s["pts"])[1]+ink.bbox(s["pts"])[3])/2 <= y+h]
        if len(ss) < 2: continue
        used |= {s["id"] for s in ss}
        out.append({"id": f"{d['case']}_a{n}", "case": d["case"], "user": d["user"], "page": page, "problem": prob, "cell": [x, y, w, h], "strokes": ss}); n += 1
    rest = [s for s in kid if s["id"] not in used]
    for c in ink.cluster(rest, gap=3.0) if rest else []:
        if len(c["strokes"]) < 3: continue
        out.append({"id": f"{d['case']}_a{n}", "case": d["case"], "user": d["user"], "page": c["page"], "problem": None, "cell": None, "strokes": c["strokes"]}); n += 1
idx = []
os.makedirs("att", exist_ok=True)
for a in out:
    ls = lines_of(a["strokes"]); a["lines"] = [[s["id"] for s in l] for l in ls]
    idx.append({k: a[k] for k in ("id", "case", "user", "page", "problem", "cell", "lines")} | {"n": len(a["strokes"]), "timed": all(s["t"] is not None for s in a["strokes"])})
json.dump(idx, open("attempts.json", "w"), indent=0)
print(len(idx), "attempts;", sum(1 for a in idx if a["problem"]), "with a tutor problem;", sum(1 for a in idx if len(a["lines"]) >= 2), "multi-line")
