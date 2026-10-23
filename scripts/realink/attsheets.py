import sys, json, os; sys.path.insert(0, "tools"); import ink
from PIL import Image, ImageDraw, ImageFont
COLORS = [(0,0,0),(210,30,30),(20,130,20),(40,90,230),(160,0,160),(210,120,0),(0,150,150),(120,80,40),(110,110,110),(220,0,120)]
idx = json.load(open("attempts.json")); TILE = 600; os.makedirs("asheets", exist_ok=True)
try: font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 15)
except Exception: font = None
cache = {}
def tile(a):
    if a["case"] not in cache:
        cache.clear(); cache[a["case"]] = ink.strokes(f"boards/{a['case']}.json")
    d, kid, tutor = cache[a["case"]]; byid = {}
    for s in kid:
        if s["page"] == a["page"]: byid.setdefault(s["id"], []).append(s)
    ls = [[seg for i in l for seg in byid.get(i, [])] for l in a["lines"]]
    pts = [p for l in ls for s in l for p in s["pts"]]; x0, y0, x1, y1 = ink.bbox(pts)
    sc = min((TILE-60)/max(1, x1-x0), (TILE-90)/max(1, y1-y0), 2.5)
    im = Image.new("RGB", (TILE, TILE), "white"); dr = ImageDraw.Draw(im)
    T = lambda p: ((p[0]-x0)*sc+40, (p[1]-y0)*sc+60)
    for s in tutor:
        if s["page"] == a["page"] and any(x0-150 <= p[0] <= x1+150 and y0-120 <= p[1] <= y1+120 for p in s["pts"][::3]):
            dr.line([T(p) for p in s["pts"]], fill=(205, 205, 205), width=2)
    for k, l in enumerate(ls):
        col = COLORS[k % len(COLORS)]
        for s in l:
            q = [T(p) for p in s["pts"]]; dr.line(q if len(q) > 1 else q*2, fill=col, width=max(2, int(2.2*min(sc, 1.6))))
        ys = [p[1] for s in l for p in s["pts"]]
        dr.text((4, (min(ys)-y0)*sc+60), f"L{k}", fill=col, font=font)
    dr.rectangle([0, 0, TILE, 44], fill=(245, 245, 245))
    dr.text((4, 2), f"{a['id']}  n={a['n']}{' timed' if a['timed'] else ''}", fill=(200, 0, 0), font=font)
    dr.text((4, 22), ("P: " + " ; ".join(a["problem"]))[:80] if a["problem"] else "P: (own)", fill=(0, 0, 160), font=font)
    dr.rectangle([0, 0, TILE-1, TILE-1], outline=(150, 150, 150))
    return im
for k in range(0, len(idx), 4):
    sh = Image.new("RGB", (2*TILE, 2*TILE), (230, 230, 230))
    for j, a in enumerate(idx[k:k+4]): sh.paste(tile(a), ((j % 2)*TILE, (j//2)*TILE))
    sh.save(f"asheets/{k//4:03d}.png")
print("sheets", (len(idx)+3)//4)
