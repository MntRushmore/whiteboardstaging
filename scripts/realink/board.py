"""The scoreboard: corrected oracle + real reads (89 real pace + 119 fast), split by device, exact ids."""
import json, sys; sys.path.insert(0, "tools"); import score
L = sys.argv[1]; dev = json.load(open("bench/devices.json"))
real = set(open("runs/ids-real.txt").read().split(",")); fast = set(open("runs/ids-fast.txt").read().split(","))
def ok(c):
    se = c.get("solvedExpected")
    return all(score.line_ok(l) for l in c["lines"]) and not c["strayRings"] and (se is None or se == c["solvedGot"])
def tally(cs):
    out = {}
    for c in cs:
        d = dev[c["id"]]; out.setdefault(d, [0, 0]); out[d][0] += 1; out[d][1] += ok(c)
    n = sum(v[0] for v in out.values()); k = sum(v[1] for v in out.values())
    return f"ALL {k}/{n}={100*k/max(n,1):.1f}%  " + "  ".join(f"{d} {v[1]}/{v[0]}={100*v[1]/v[0]:.1f}%" for d, v in sorted(out.items(), key=lambda x: x[0] != "PEN"))
o = score.relabel(json.load(open(f"runs/oracle-{L}-cases.json")))
r = [c for c in score.relabel(json.load(open(f"runs/replay-real-{L}-cases.json"))) if c["id"] in real]
f = [c for c in score.relabel(json.load(open(f"runs/replay-fast-{L}-cases.json"))) if c["id"] in fast]
print(f"[{L}] PERFECT READS (oracle, 208): " + tally(o))
print(f"[{L}] REAL READS (all 208):        " + tally(r + f))
print(f"[{L}]   real pace (89):             " + tally(r))
print(f"[{L}]   fast pace (119):            " + tally(f))
rings = sum(1 for c in o + r + f for l in c["lines"] if l["expect"] != "ring" and "ring" in l["marks"])
print(f"[{L}] rings on right work: oracle {sum(1 for c in o for l in c['lines'] if l['expect']!='ring' and 'ring' in l['marks'])}, real {sum(1 for c in r+f for l in c['lines'] if l['expect']!='ring' and 'ring' in l['marks'])}; strays ringed real {sum(c['strayRings'] for c in r+f)}")
print(f"[{L}] \"?\" on right work: oracle {sum(1 for c in o for l in c['lines'] if l['expect']!='ring' and 'question' in l['marks'])}, real {sum(1 for c in r+f for l in c['lines'] if l['expect']!='ring' and 'question' in l['marks'])}")
