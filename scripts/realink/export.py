"""labels.txt + boards -> bench/cases.json: each labeled attempt's strokes in writing order, scaled so a kid's
glyph is ~52 page units (the iPad page's rule pitch is 80), relative to the attempt's top-left, with real
timing where the board kept it (t/t1) and a kid's pace where it didn't. Local only (children's ink)."""
import sys, json, re, os; sys.path.insert(0, "tools"); import ink
idx = {a["id"]: a for a in json.load(open("attempts.json"))}
cases, cur = [], None
for raw in open("labels.txt"):
    line = raw.rstrip("\n")
    if not line.strip() or line.startswith("#"): continue
    if not line.startswith(" "):
        parts = [p.strip() for p in line.split("|")]
        cur = None
        if parts[1] == "-": continue
        cur = {"id": parts[0], "grade": parts[1], "category": parts[2], "solved": parts[3] == "solved",
               "tags": parts[4].split(",") if len(parts) > 4 and parts[4] else [], "lines": []}
        cases.append(cur); continue
    if cur is None: continue
    parts = [p.strip() for p in line.strip().split("|")]
    rows, latex, expect = parts[0], parts[1], parts[2]
    value = parts[3] if len(parts) > 3 else None
    cur["lines"].append({"rows": rows, "latex": latex, "expect": expect, "value": value})
def spoken(l): return re.sub(r"\s+", " ", l.replace("\\qquad", " ").replace("\\quad", " ")).strip()
cache = {}
def board(case):
    if case not in cache: cache.clear(); cache[case] = ink.strokes(f"boards/{case}.json")
    return cache[case]
out = []
for c in cases:
    a = idx[c["id"]]; d, kid, tutor = board(a["case"])
    def segs(att, row_ids):
        page = idx[att]["page"]; return [s for s in kid if s["page"] == page and s["id"] in row_ids]
    # every stroke of the attempt (and of any attempt a line borrows from)
    own_ids = {i for r in a["lines"] for i in r}
    all_strokes = segs(c["id"], own_ids)
    bb = ink.bbox([p for s in all_strokes for p in s["pts"]])
    line_of = {}
    for k, L in enumerate(c["lines"]):
        spec = L["rows"]; src = c["id"]
        m = re.match(r"^(a\d+):(.*)$", spec)
        if m:
            src = a["case"] + "_" + m.group(1); spec = m.group(2)
            extra = segs(src, {i for r in idx[src]["lines"] for i in r})
            all_strokes += [s for s in extra if id(s) not in {id(t) for t in all_strokes}]
        abb = ink.bbox([p for s in segs(src, {i for r in idx[src]["lines"] for i in r}) for p in s["pts"]])
        for item in spec.split(","):
            xr = None
            if "@" in item:
                item, rng = item.split("@"); x0, x1 = map(float, rng.split("-")); xr = (x0, x1)
            r = int(item)
            for s in segs(src, set(idx[src]["lines"][r])):
                sb = ink.bbox(s["pts"]); cx = ((sb[0]+sb[2])/2 - abb[0]) / max(1, abb[2]-abb[0])
                if xr and not (xr[0] <= cx <= xr[1]): continue
                line_of[id(s)] = k
    all_strokes = ink.order(all_strokes)
    bb = ink.bbox([p for s in all_strokes for p in s["pts"]])
    hs = sorted(ink.bbox(s["pts"])[3]-ink.bbox(s["pts"])[1] for s in all_strokes); H = max(8, hs[(len(hs)*2)//3])
    W, Ht = bb[2]-bb[0], bb[3]-bb[1]
    s = 52.0 / H
    if W*s > 1050: s = 1050.0 / W
    if Ht*s > 520: s = max(520.0 / Ht, 30.0 / H)
    timed = all(t["t"] is not None for t in all_strokes)
    strokes, prev_end, prev_line = [], None, None
    for t in all_strokes:
        k = line_of.get(id(t), -1)
        if timed:
            dt = 0 if prev_end is None else min(5000, max(60, t["t"] - prev_end)); dur = min(3000, max(40, (t["t1"] or t["t"]) - t["t"]))
            prev_end = t["t1"] or t["t"]
        else:
            dt = 0 if prev_line is None else (250 if k == prev_line and k != -1 else 1200); dur = 300
        prev_line = k
        strokes.append({"x": [round((p[0]-bb[0])*s, 1) for p in t["pts"]], "y": [round((p[1]-bb[1])*s, 1) for p in t["pts"]],
                        "dt": round(dt), "dur": round(dur), "line": k})
    lines = [{"latex": spoken(L["latex"]), "expect": L["expect"], "value": L["value"]} for L in c["lines"]]
    for k, L in enumerate(lines):
        if not any(st["line"] == k for st in strokes): print("EMPTY LINE", c["id"], k, L["latex"])
    out.append({"id": c["id"], "grade": c["grade"], "category": c["category"], "tags": c["tags"], "timed": timed,
                "problem": a["problem"] or None, "solved": c["solved"], "lines": lines, "strokes": strokes,
                "scale": round(s, 3), "size": [round(W*s), round(Ht*s)]})
os.makedirs("bench", exist_ok=True)
json.dump(out, open("bench/cases.json", "w"))
import collections
print(len(out), "cases;", sum(len(c["lines"]) for c in out), "lines;", collections.Counter(l["expect"] for c in out for l in c["lines"]))
print("grades", collections.Counter(c["grade"] for c in out)); print("cats", collections.Counter(c["category"] for c in out))
print("multi-line", sum(1 for c in out if len(c["lines"]) > 1), "timed", sum(c["timed"] for c in out), "with problem", sum(1 for c in out if c["problem"]))
print("users", len({idx[c['id']]['user'] for c in out}))
