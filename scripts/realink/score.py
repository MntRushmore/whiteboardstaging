"""Teacher-right scoring + failure causes for a real-ink run (cases.json from RealInkBenchTests)."""
import json, sys, collections
def line_ok(l):
    m = set(l["marks"]); e = l["expect"]
    if "ring" in m and e != "ring": return False
    if "question" in m and e != "ring": return False
    if e == "tick": return "tick" in m
    if e == "ring": return "ring" in m
    return True  # calm / quiet: no ring, no "?"
def cause(l):
    m = set(l["marks"]); e = l["expect"]; read = l.get("read"); rr = l.get("readRight")
    merged = (l.get("why") or "").startswith("Taken together"); split = l["pieces"] > 1
    readc = "unread" if read is None else ("merged" if merged else ("split" if split else ("read-right" if rr else "misread")))
    if "ring" in m and e != "ring": kind = "ring-on-right"
    elif "question" in m and e != "ring": kind = "?-on-right"
    elif e == "tick": kind = "no-tick"
    elif e == "ring": kind = "missed-slip" + ("(asked)" if "Asked" in (l.get("why") or "") else "(held)" if "Never checked" in (l.get("why") or "") else "")
    else: kind = "other"
    return kind, readc
import os
_LABELS = {c["id"]: c for c in json.load(open(os.path.join(os.path.dirname(__file__), "..", "bench", "cases.json")))}
def relabel(cs):
    """the current labels' solved (a run keeps the labels it ran with)"""
    for c in cs:
        if c.get("solvedExpected") is not None and c["id"] in _LABELS: c["solvedExpected"] = _LABELS[c["id"]]["solved"]
    return cs
def score(path, only=None):
    cs = relabel(json.load(open(path)))
    if only: cs = [c for c in cs if c["id"] in only]
    ok = 0; causes = collections.Counter(); bycase = []
    for c in cs:
        se = c.get("solvedExpected")
        lines_ok = all(line_ok(l) for l in c["lines"]) and not c["strayRings"]
        solved_ok = se is None or se == c["solvedGot"]
        if lines_ok and solved_ok: ok += 1; continue
        cc = [cause(l) for l in c["lines"] if not line_ok(l)]
        if c["strayRings"]: cc.append(("ring-on-stray", "-"))
        if lines_ok and not solved_ok: cc.append(("solved-mismatch", "exp" + str(se)))
        for k in cc: causes[k] += 1
        bycase.append((c["id"], c["tags"][:3], cc))
    return len(cs), ok, causes, bycase
if __name__ == "__main__":
    n, ok, causes, bycase = score(sys.argv[1], set(json.load(open(sys.argv[2]))) if len(sys.argv) > 2 else None)
    print(f"{sys.argv[1]}: teacher-right {ok}/{n} = {100*ok/n:.1f}%")
    for (k, r), v in causes.most_common(): print(f"  {v:3d}  {k:16s} {r}")
    if "-v" in sys.argv[3:]:
        for b in bycase: print("   ", b)

def by_device(path, devices, only=None):
    """teacher-right split by input device: {device: (n, ok)}"""
    cs = relabel(json.load(open(path)))
    if only: cs = [c for c in cs if c["id"] in only]
    out = collections.defaultdict(lambda: [0, 0])
    for c in cs:
        se = c.get("solvedExpected")
        ok = all(line_ok(l) for l in c["lines"]) and not c["strayRings"] and (se is None or se == c["solvedGot"])
        d = devices.get(c["id"], "?"); out[d][0] += 1; out[d][1] += ok
    return dict(out)
