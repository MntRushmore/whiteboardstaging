"""One-off bank tidy (SAT v2 end-to-end run, 2026-10-23): step maths written `a,, b` (two commas where one
separator was meant: SwiftMath sets both), a bare `or` between two roots (SwiftMath sets it as the letters
o·r), and a why that does not start with its verb (the note reads "Looks like you …").

  `a,, b`        ->  `a, b`     (two relations side by side; `\\quad`, `\\Rightarrow` and `\\text` are not in
                                  the SwiftMath-safe subset, src/lib/sat/lint.ts SAFE_COMMANDS)
  `a  or  b`     ->  `a, b`
  "Sign slip …"  ->  "Made a sign slip …"

Run: python3 -I scripts/sat/fix-step-glitches.py [--write]   (prints every change; --write rewrites
data/sat/bank.json in its own format)."""
import json, re, sys
path = "data/sat/bank.json"
bank = json.load(open(path))
changes = []
def fix_math(m):
    out = re.sub(r"\s*,\s*,\s*", ", ", m)
    out = re.sub(r"\s+or\s+", ", ", out) if re.search(r"(?<![a-zA-Z\\{])or(?![a-zA-Z])", out) else out
    return out
for q in bank:
    for i, st in enumerate(q["solution"]["steps"]):
        m = st.get("math")
        if m is None:
            continue
        f = fix_math(m)
        if f != m:
            changes.append((q["id"], i, m, f))
            st["math"] = f
    for st in q["solution"].get("desmos_steps") or []:
        m = st.get("math")
        if m and fix_math(m) != m:
            changes.append((q["id"], "desmos", m, fix_math(m)))
            st["math"] = fix_math(m)
    for c in q.get("common_wrong") or []:
        if c.get("why", "").startswith("Sign slip"):
            new = "Made a sign slip" + c["why"][len("Sign slip"):]
            changes.append((q["id"], "why", c["why"], new))
            c["why"] = new
for c in changes:
    print(c)
print(len(changes), "changes")
if "--write" in sys.argv:
    with open(path, "w") as f:
        json.dump(bank, f, indent=1, ensure_ascii=False)
        f.write("\n")
