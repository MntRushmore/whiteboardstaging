"""SAT v2 end to end, check 6: no nudge gives the answer away. For every live question with a nudge,
the answer (the right choice's text, or every accepted grid-in form) is looked for in the nudge as a
whole number/expression; a hit that the stem does not already state is a leak, listed for review.
Reads the LOCAL bank: python3 -I scripts/sat/e2e/nudges.py (psql on 127.0.0.1:54322)."""
import json, re, subprocess, os
env = dict(os.environ, PGPASSWORD="postgres")
rows = json.loads(subprocess.check_output(["psql", "-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "postgres", "-Atc",
  "select json_agg(json_build_object('id',id,'format',format,'stem',stem,'choices',choices,'answer',answer,'nudge',nudge)) from sat_questions where status='live' and nudge is not null"], env=env))
def norm(s):
    s = s.replace("$", "").replace("\\dfrac", "\\frac").replace(" ", "")
    s = re.sub(r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"\1/\2", s)
    return s.replace("{", "").replace("}", "").replace("\\left", "").replace("\\right", "")
def tokens(s):
    return set(re.findall(r"-?\d+(?:\.\d+)?(?:/\d+)?", norm(s)))
leaks, checked = [], 0
for q in rows:
    checked += 1
    if q["format"] == "mcq":
        key = q["answer"]["key"]
        ans = [c["text"] for c in q["choices"] if c["key"] == key]
    else:
        ans = q["answer"]["accepted"]
    nud, stem = norm(q["nudge"]), norm(q["stem"])
    for a in ans:
        na = norm(a)
        if not na:
            continue
        numeric = re.fullmatch(r"-?\.?\d+(?:\.\d+)?(?:/\d+)?", na)
        if numeric:
            hit = na in tokens(q["nudge"]) and na not in tokens(q["stem"])
        else:
            hit = len(na) >= 3 and na in nud and na not in stem
        if hit:
            leaks.append((q["id"], a, q["nudge"]))
print(f"{checked} nudges checked, {len(leaks)} possible leaks")
for l in leaks:
    print(" ", l)
