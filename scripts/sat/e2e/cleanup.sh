#!/bin/bash
# Removes the SAT end-to-end run's test users from the LOCAL stack (never production): every
# sat-e2e-*@example.com and sat-upgrade-*@example.com account (AnonymousUpgradeTests), and the
# anonymous users made since $SINCE (an ISO time; the run's own: the shared stack had none before it).
# Through the Auth admin API, so each user's rows go with it (on delete cascade).
#   SINCE='2026-10-23 18:39:00+00' scripts/sat/e2e/cleanup.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")/../../.."
URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-)
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
case "$URL" in http://127.0.0.1*|http://localhost*) ;; *) echo "local stack only: $URL" >&2; exit 1 ;; esac
SINCE=${SINCE:?set SINCE to the run start}
IDS=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select id from auth.users where email like 'sat-e2e-%@example.com' or email like 'sat-upgrade-%@example.com' or (is_anonymous and created_at >= '$SINCE')")
n=0
for id in $IDS; do
  n=$((n + 1))
  if [ "${1:-}" = "--dry-run" ]; then echo "would delete $id"; continue; fi
  code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$URL/auth/v1/admin/users/$id" -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
  echo "$id $code"
done
echo "$n users"
