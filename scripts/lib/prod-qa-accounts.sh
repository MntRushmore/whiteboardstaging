#!/bin/bash
# The production QA runs' throwaway accounts (scripts/ios-prod-qa.sh, scripts/ios-device-onboarding.sh):
# who they are, deleting one as itself, and checking nothing of it is left. Only ever for
# `qa-ipad-…@agathon.app` (refused otherwise). Reads production with SELECTs through the Supabase
# Management API (the CLI's token in the Keychain); deletes only through the account's own session
# (the app's way: DELETE /api/family for the kids' pictures, then rpc delete_own_account).
#
#   prod-qa-accounts.sh ids     <email>              the grown-up's id and their kids' ids, one per line
#   prod-qa-accounts.sh delete  <email> <password>   signs in as it and deletes it (a no-op if it's gone)
#   prod-qa-accounts.sh verify  <id>…                every public table and storage: rows left for these ids
set -u
REF=sgolkponjdkphndosrea
API=https://www.agathon.app
SUPABASE=https://$REF.supabase.co
ANON=$(sed -n 's/.*supabaseAnonKey: "\(eyJ[^"]*\)".*/\1/p' "$(dirname "$0")/../../ios/Packages/AgathonKit/Sources/AgathonKit/Environment/AgathonEnvironment.swift" | head -1)

qa_only() {
  [[ "$1" =~ ^qa-ipad-[a-z0-9-]+@agathon\.app$ ]] || { echo "refused: $1 is not a qa-ipad-…@agathon.app account" >&2; exit 2; }
}

# A read-only SQL query on production (the Management API), as JSON rows.
sql() {
  local token
  token=$(security find-generic-password -s "Supabase CLI" -w) || { echo "no Supabase CLI token in the Keychain" >&2; exit 3; }
  curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1], "read_only": True}))' "$1")"
}

case "${1:-}" in
ids)
  qa_only "$2"
  sql "select u.id::text as id from auth.users u where u.email = '$2'
       union all select m.child_id::text from family_members m join auth.users u on u.id = m.parent_id where u.email = '$2'" |
    python3 -c 'import json,sys; [print(r["id"]) for r in json.load(sys.stdin)]'
  ;;
delete)
  qa_only "$2"
  TOKEN=$(curl -s -X POST "$SUPABASE/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1], "password": sys.argv[2]}))' "$2" "$3")" |
    python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_token",""))')
  if [ -z "$TOKEN" ]; then echo "$2: no such account (or not this password): nothing to delete"; exit 0; fi
  echo "$2: DELETE /api/family (the kids' pictures) → $(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/api/family" -H "Authorization: Bearer $TOKEN")"
  echo "$2: rpc delete_own_account → $(curl -s -o /dev/null -w '%{http_code}' -X POST "$SUPABASE/rest/v1/rpc/delete_own_account" -H "apikey: $ANON" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}')"
  ;;
verify)
  shift
  [ $# -gt 0 ] || { echo "verify: no ids" >&2; exit 2; }
  IDS=$(printf "'%s'," "$@"); IDS="(${IDS%,})"
  for id in "$@"; do [[ "$id" =~ ^[0-9a-f-]{36}$ ]] || { echo "verify: $id is not a uuid" >&2; exit 2; }; done
  # every public base table with a user column, and the account itself and its storage
  Q=$(sql "select c.table_name, c.column_name from information_schema.columns c join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
           where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
             and c.column_name in ('user_id','parent_id','child_id','owner_id','kid_id') order by 1, 2" |
    python3 -c "
import json,sys
rows=json.load(sys.stdin)
parts=[\"select 'auth.users' as t, count(*) as n from auth.users where id::text in $IDS\",
       \"select 'storage.objects (board-assets)' as t, count(*) as n from storage.objects where bucket_id = 'board-assets' and split_part(name, '/', 1) in $IDS\"]
for r in rows:
    parts.append(\"select 'public.%s.%s' as t, count(*) as n from public.%s where %s::text in $IDS\" % (r['table_name'], r['column_name'], r['table_name'], r['column_name']))
print(' union all '.join(parts))
")
  sql "$Q" | python3 -c '
import json,sys
rows=json.load(sys.stdin)
if isinstance(rows, dict): print(rows); sys.exit(1)
# rate_limit_counters: a route hit counts per window, gone at their expires_at (minutes; a day for
# kid adds): not the account data
expiring=lambda r: r["t"].startswith("public.rate_limit_counters")
left=[r for r in rows if int(r["n"])>0 and not expiring(r)]
for r in rows:
    n=int(r["n"])
    print(("ok   " if n==0 else "EXPIRES " if expiring(r) else "LEFT ")+r["t"]+" "+str(n))
print("rows left: %d table(s)" % len(left))
'
  ;;
*)
  sed -n 2,12p "$0"; exit 2 ;;
esac
