#!/usr/bin/env python3
"""Pull inked boards' tldraw stores from prod (read-only), de-identified on arrival:
board/user ids -> random ids; titles, previews, emails never fetched; text shapes' text dropped."""
import json, os, secrets, subprocess, sys
P = os.path.join(os.path.dirname(__file__), "pq.py")
def q(sql): return json.loads(subprocess.check_output([P, sql]))
CLS = """case when u.email ilike 'qa-%' or u.email ilike '%+qa%' then 'qa' when u.email ilike '%demo%' then 'demo'
 when u.email ilike '%agathon.app' or exists (select 1 from public.admins a where a.user_id = u.id) then 'staff' else 'real' end"""
ids = q(f"""select w.id, {CLS} cls from public.whiteboards w join auth.users u on u.id=w.user_id
 where w.deleted_at is null and exists (select 1 from jsonb_each(w.data->'document'->'store') e where e.value->>'type'='draw')""")
users = q(f"select w.id, w.user_id from public.whiteboards w where w.deleted_at is null")
umap, uid_of = {}, {r["id"]: r["user_id"] for r in users}
os.makedirs("boards", exist_ok=True)
index = []
for i in range(0, len(ids), 15):
    chunk = ids[i:i+15]
    lst = ",".join(f"'{r['id']}'" for r in chunk)
    rows = q(f"""select w.id, w.created_at, w.updated_at, (select jsonb_object_agg(e.key, e.value) from jsonb_each(w.data->'document'->'store') e
      where e.value->>'typeName' in ('shape','page') ) store from public.whiteboards w where w.id in ({lst})""")
    cls = {r["id"]: r["cls"] for r in chunk}
    for r in rows:
        bid = "b" + secrets.token_hex(4)
        u = uid_of[r["id"]]; umap.setdefault(u, "u" + secrets.token_hex(3))
        store = r["store"] or {}
        for k, v in store.items():
            if v.get("typeName") == "shape":
                props = v.get("props", {})
                for key in ("text", "richText", "url", "name"):
                    if key in props: props[key] = "<dropped>"
                v.pop("parentId", None) if False else None
        json.dump({"case": bid, "user": umap[u], "cls": cls[r["id"]], "created": r["created_at"], "updated": r["updated_at"], "store": store},
                  open(f"boards/{bid}.json", "w"))
        index.append({"case": bid, "user": umap[u], "cls": cls[r["id"]], "shapes": len(store)})
    print(f"{min(i+15,len(ids))}/{len(ids)}", file=sys.stderr)
json.dump(index, open("boards/index.json", "w"), indent=1)
print(len(index), "boards,", len(umap), "users")
