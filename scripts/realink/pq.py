#!/usr/bin/env python3
"""Real-ink bench (docs/REAL-INK-BENCH.md): run from ~/whiteboardstaging/agathon-corpus, never inside a repo.
Read-only prod query helper. Usage: pq.py "select ..." (prints JSON). Refuses non-SELECT."""
import json, os, re, subprocess, sys, urllib.request
sql = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
if not re.match(r"^\s*(select|with)\b", sql, re.I) or re.search(r"\b(insert|update|delete|drop|alter|truncate|grant|create)\b", sql, re.I):
    sys.exit("read-only: SELECT/WITH only")
tok = subprocess.check_output(["security", "find-generic-password", "-s", "Supabase CLI", "-w"]).decode().strip()
req = urllib.request.Request("https://api.supabase.com/v1/projects/sgolkponjdkphndosrea/database/query",
    data=json.dumps({"query": sql, "read_only": True}).encode(),
    headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, method="POST")
try:
    print(json.dumps(json.loads(urllib.request.urlopen(req, timeout=180).read())))
except urllib.error.HTTPError as e:
    sys.exit(e.read().decode()[:500])
