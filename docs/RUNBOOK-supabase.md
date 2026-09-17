# Runbook: rebuild the Supabase backend from scratch

Target: a working backend (Postgres + Auth + Storage) for Agathon Classroom in under 30 minutes, starting from no project. Everything schema-related is in `supabase/migrations/20260911000000_init.sql`; everything else is a dashboard setting listed here. Env var meanings: `.env.example`. Architecture and security model: `docs/ARCHITECTURE.md`.

Prereqs: Node 22+, `npx supabase --version` >= 2.x (bundled, no global install), the `vercel` CLI logged in, an account that owns the Supabase org. No local Postgres tools are required.

## 1. Create the project (dashboard, ~3 min)

1. <https://supabase.com/dashboard/new> -> **New project**.
2. Name: `agathon-classroom` (anything; the *ref* in the URL is what matters). Region: the one closest to the Vercel function region (default `iad1` -> `us-east-1`). Plan: Free works; Pro is needed for daily backups / PITR (section 10).
3. **Database password**: click *Generate*, store it in the team password manager as `supabase/<ref>/db-password`. It is only needed for `supabase link`, `pg_dump` and direct `psql`; the app never uses it. It can be reset later under *Project Settings -> Database* without affecting the app.
4. Wait for "Project is ready" (~2 min). Note from *Project Settings -> API*: **Project URL** `https://<ref>.supabase.co` and the **anon / publishable** key. The **service_role / secret** key stays in the dashboard; nothing in this repo reads it today.

## 2. Link the repo and push the schema (~3 min)

```bash
npx supabase login                         # opens browser; or export SUPABASE_ACCESS_TOKEN=sbp_...
npx supabase link --project-ref <ref>      # prompts for the DB password (or SUPABASE_DB_PASSWORD=...)
# expected: "Finished supabase link."
npm run db:push                            # = supabase db push
# expected:
#   Connecting to remote database...
#   Do you want to push these migrations to the remote database?
#    • 20260911000000_init.sql
#   [Y/n] y
#   Applying migration 20260911000000_init.sql...
#   Finished supabase db push.
```

What the migration creates (idempotent, safe to re-run):

| Kind | Objects |
| --- | --- |
| Tables (all RLS on, no `anon` grants) | `whiteboards`, `whiteboard_snapshots`, `board_assets`, `user_settings`, `bug_reports`, `trainers`, `training_samples` |
| Functions | `set_updated_at()`, `is_trainer()` (security definer), `whiteboards_bump_version()`, `whiteboards_record_snapshot()` |
| Triggers | `updated_at` on whiteboards/user_settings/training_samples; `version` bump + copy into `whiteboard_snapshots` (last 20) on every `whiteboards.data` change |
| Policies | owner-only CRUD keyed on `auth.uid()`; `bug_reports` insert-only; trainer tables/objects gated by `is_trainer()` |
| Storage | bucket `board-assets` (public read, 15 MB, image/*) and `training-data` (private, 10 MB, image/png) + `storage.objects` policies scoped to `<uid>/...` folders |
| Seed | `trainers` row for `rushilchopra123@gmail.com` (no-op until that user signs up) |

If `db push` says "no migrations to apply" on a brand-new project, the `supabase_migrations` table was created earlier; run `npx supabase migration repair --status reverted 20260911000000` then push again.

## 3. Auth settings that are NOT in the migration (dashboard, ~5 min)

Under **Authentication**:

| Setting | Value | Why |
| --- | --- | --- |
| URL Configuration -> Site URL | `https://whiteboard.rushilchopra.com` (production origin) | Base for links in emails and the default redirect. |
| URL Configuration -> Redirect URLs | `https://whiteboard.rushilchopra.com/**`, `https://*.whiteboard.rushilchopra.com/**`, `https://whiteboardstaging-*.vercel.app/**`, `http://localhost:3000/**`, `http://127.0.0.1:3000/**` | Every origin that runs the app. Wildcards are allowed. Local mirror: `supabase/config.toml [auth]`. |
| Sign In / Providers -> Email -> Confirm email | **Off** for private cohorts; On only after custom SMTP is configured | The built-in SMTP sends ~2 emails/hour and only to team members, so confirmations lock students out. The local stack also runs with `enable_confirmations = false`. |
| Sign In / Providers -> Email -> Minimum password length | 8 | Local default is 6; the login form accepts either. |
| Sign In / Providers -> Allow new users to sign up | On while onboarding a cohort, then **Off** | Turning it off is the "private cohort" switch: existing accounts keep working, `/signup` returns `signup_disabled`. |
| Sign In / Providers -> Email/password provider | On (only provider used) | No OAuth providers are configured in code. |
| Rate Limits | keep defaults (30 sign-in/sign-up per 5 min/IP, 150 token refreshes per 5 min/IP, 2 emails/hour without SMTP) | Raise only after seeing `429` from `/auth/v1/token` in the Auth logs. |

## 4. Storage sanity (dashboard -> Storage, ~1 min)

Expected after `db push` (also visible with `select id, public, file_size_limit, allowed_mime_types from storage.buckets;` in the SQL editor):

| Bucket | Public | Limit | MIME | Write path |
| --- | --- | --- | --- | --- |
| `board-assets` | yes | 15 MB | png/jpeg/webp/gif/svg | `<uid>/<boardId>/...` owner only |
| `training-data` | no | 10 MB | png | `<uid>/<sampleId>/...` trainers only |

The project-wide upload cap (*Storage -> Settings*) must be >= 15 MB (Free plan default is 50 MB). Do not toggle `board-assets` private: tldraw and the AI routes fetch assets by plain public URL.

## 5. Environment variables on Vercel (~5 min)

The app needs the same two Supabase values in all three Vercel environments. `vercel env add` takes one environment per call and reads the value from stdin:

```bash
URL="https://<ref>.supabase.co"; ANON="<anon key>"
for env in production preview development; do
  printf '%s' "$URL"  | vercel env add NEXT_PUBLIC_SUPABASE_URL      "$env"
  printf '%s' "$ANON" | vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY "$env"
done
vercel env ls                        # expect both names listed 3x
vercel env pull .env.local           # optional: sync development values locally
```

Also required: `OPENROUTER_API_KEY` (all envs). Optional: `OPENAI_API_KEY`, `MATHPIX_APP_ID`/`MATHPIX_APP_KEY`, `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_LIVE_MATH`, `LIVE_MODEL_*`, `LOG_LEVEL`, `NEXT_PUBLIC_LOG_LEVEL`. Do **not** add `SUPABASE_SERVICE_ROLE_KEY` to Vercel unless you enable billing: the only route that reads it is `POST /api/billing/webhook` (section 13), everything else runs with the caller's JWT. Never add the `# ─── Scripts and tests` keys from `.env.example` (`BASE_URL`, `SMOKE_*`, `RUN_DB_TESTS`, `VERIFY_EMAIL_DOMAIN`). Redeploy (`vercel --prod`) after changing env vars; existing deployments keep their old values.

Check the result with `npm run env:check` (`node scripts/check-vercel-env.mjs`): it runs the read-only `vercel env ls`, classifies every key by its `.env.example` section, and exits 1 on a missing required key, a deployed scripts-only key, or a Vercel key that `.env.example` does not document. `--env Preview` limits it to one environment, `--json` prints the report as JSON, `--from <file>` reads saved `vercel env ls` output (CI uses `src/__tests__/fixtures/vercel-env-ls.txt`). The current per-environment state and the exact `vercel env add` commands are in `docs/GO-LIVE.md` section 2.

## 6. Trainer allow-list (SQL editor, after the trainer has signed up once)

```sql
insert into public.trainers (user_id)
select id from auth.users where lower(email) = lower('trainer@example.com')
on conflict do nothing;
-- verify
select u.email from public.trainers t join auth.users u on u.id = t.user_id;
```

Remove with `delete from public.trainers where user_id = (select id from auth.users where email = '...');`. `/train` checks `is_trainer()` server-side via RLS, so no deploy is needed.

## 7. Verify (~3 min)

```bash
curl -s https://<ref>.supabase.co/auth/v1/health          # {"version":"v2.x","name":"GoTrue",...}
npm run db:verify                                         # scripts/verify-rls.mjs: RLS on every table, anon has no grants, buckets + policies present
RUN_DB_TESTS=1 npm test                                   # DB integration tests (skipped without the flag)
node scripts/live-smoke.mjs                               # against a dev server; SMOKE_SKIP_LLM=1 avoids OpenRouter spend
```

`db:verify` and the DB tests read `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the environment or `.env.local`; point them at the local stack unless you intend to create rows in production. Then do the manual first-run checks in `docs/GO-LIVE.md` section 5.

## 8. Local stack

```bash
npx supabase start                    # needs Docker; ~1 min first time
npx supabase status -o env            # API_URL, ANON_KEY, DB_URL, MAILPIT_URL (http://127.0.0.1:54324 shows auth emails)
curl -s http://127.0.0.1:54321/auth/v1/health
npm run db:reset                      # drop + re-apply all migrations + supabase/seed.sql
npm run db:seed                       # re-run seed data only (test users, sample board)
npx supabase stop                     # keeps data; add --no-backup to wipe volumes
```

`.env.example` already contains the local URL and demo anon key, so `cp .env.example .env.local` plus an OpenRouter key is a working local setup. Local auth settings live in `supabase/config.toml [auth]` and mirror section 3 (confirmations off, signups on, localhost redirect URLs).

## 9. Key rotation

| Key | Where | Impact |
| --- | --- | --- |
| anon / publishable | *Project Settings -> API Keys -> Create new / Revoke* | Update `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel (section 5) and redeploy, then revoke the old key. Sessions survive: user JWTs are signed by the JWT secret, not the anon key. |
| service_role / secret | same page | Used by `scripts/offload-assets.mjs` (one-off admin migration, run from an operator's machine) and, once billing is enabled, by `POST /api/billing/webhook` (section 13). Rotate freely; re-export `SUPABASE_SERVICE_ROLE_KEY` before the next script run and update the Vercel Production variable + redeploy if the webhook is live. |
| JWT secret / signing key | *Project Settings -> JWT Keys* | Invalidates every user session and every legacy `anon`/`service_role` JWT-style key at once. Do it in a maintenance window: rotate, copy the new anon key to Vercel, redeploy, tell users to sign in again. Prefer the newer `sb_publishable_...` key, which is not derived from the JWT secret. |
| DB password | *Project Settings -> Database -> Reset* | Only affects `supabase link`, `pg_dump`, `psql`. Re-run `npx supabase link` afterwards. |

## 10. Backups and restore drill

- **Plan note.** Free: no automatic backups. Pro: daily backups retained 7 days; **PITR** is a paid add-on (Pro + compute >= Small) with 2-minute granularity. Turn PITR on before the first real cohort; a lost `whiteboards` table is unrecoverable otherwise.
- **Manual dump (no local Postgres tools needed):**
  ```bash
  npx supabase db dump --linked -f backups/schema-$(date +%F).sql               # roles/schema
  npx supabase db dump --linked --data-only -f backups/data-$(date +%F).sql     # public.* + storage metadata rows
  ```
  With `pg_dump` installed: `pg_dump "postgresql://postgres:<db-password>@db.<ref>.supabase.co:5432/postgres" --schema=public --no-owner --no-privileges -Fc -f backups/full-$(date +%F).dump`. Dumps contain student work: encrypt at rest, never commit.
- **Storage objects** are not in a DB dump. Copy them with `npx supabase storage cp -r ss:///board-assets ./backups/board-assets --linked` (experimental) or from the dashboard.
- **Restore drill (do this once per quarter, ~15 min):** create a throwaway project (section 1), `npx supabase link --project-ref <new-ref>`, `npm run db:push`, then load data with `npx supabase db query --linked -f backups/data-<date>.sql` (or `psql "$DB_URL" -f ...`). Point a local `.env.local` at the new project, sign in as a test user, open a restored board. Delete the throwaway project when done. Note: `auth.users` rows are included in `--data-only` dumps; user passwords remain valid because hashes are copied.

## 11. Troubleshooting

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `PGRST303` / `JWT expired` right after sign-in | Clock skew between the client machine and Supabase, or a token from another project | Sync the OS clock (NTP); sign out/in; check `NEXT_PUBLIC_SUPABASE_URL` matches the project that issued the token. |
| `57014 canceling statement due to statement timeout` on save | `whiteboards.data` row is multi-MB (legacy base64 images); PostgREST `authenticated` timeout is 8 s | Run `node scripts/offload-assets.mjs --board <id>` (section 12) to move the inline images to the `board-assets` bucket. Do not raise the role timeout. |
| `23514 ... violates check constraint "whiteboards_data_size"` on save | Snapshot is over the 8 MB cap (`20260917010000_snapshot_size_cap.sql`) - a legacy board with big base64 images, or a client bypassing the 4 MB soft limit | Same fix: `node scripts/offload-assets.mjs --board <id>`; the constraint only checks new tuples, so the board loads fine and saves again once its assets are URLs. |
| `42501 permission denied for table ...` | Missing `grant ... to authenticated` (or the table was created outside the migration) | Re-run `npm run db:push` (idempotent) or paste the init migration into the SQL editor. `anon` is denied on purpose. |
| `42P01 relation "public.whiteboards" does not exist` | Migration never ran on this project | Section 2. |
| Storage upload -> `403` / `new row violates row-level security policy` | Object path does not start with the caller's `auth.uid()`, caller is not in `trainers` (training-data), wrong MIME type, or bucket missing | Check the path prefix, the trainer row (section 6), and `select * from storage.buckets`. |
| Storage upload -> `413` / `Payload too large` | Over the bucket or project cap | 15 MB (`board-assets`) / 10 MB (`training-data`); *Storage -> Settings* global cap. |
| `/api/*` returns `401 unauthorized` everywhere | Session expired, or the Vercel env points at a different project than the browser | Section 5; redeploy after env changes. |
| Sign-up succeeds but user cannot sign in | Email confirmations are on without SMTP | Section 3: turn confirmations off or configure SMTP; confirm the user manually under *Authentication -> Users*. |
| `supabase link` fails with `SASL auth` / `password authentication failed` | Wrong DB password | Reset it (*Project Settings -> Database*) and link again. |
| `npx supabase start` fails | Docker not running or ports 54321-54329 busy | Start Docker; `npx supabase stop --no-backup`; retry. |

## 12. Assets: storage, migration of old boards, garbage collection

**Where images live.** Every image on a board (pasted, AI-generated, sticker, PDF page, worksheet) is an object in the public bucket `board-assets` at `<uid>/<boardId>/<assetId>.<ext>`, registered in `public.board_assets`, and referenced from `whiteboards.data` by its public URL `<SUPABASE_URL>/storage/v1/object/public/board-assets/<path>` (`docs/ARCHITECTURE.md` flow 2b). Snapshot columns are capped at 8 MB by check constraints (`whiteboards_data_size`, `whiteboard_snapshots_data_size`, `training_samples_tldraw_snapshot_size`); the client stops autosaving at 4 MB (`SNAPSHOT_LIMITS` in `scripts/lib/snapshotAssets.mjs`).

**Migrating boards saved before the offload shipped (once per project, ~5 min + upload time).** Those rows still embed `data:` URLs. Run the admin script with the service role; it never runs without it because it writes into every user's folder and bypasses RLS:

```bash
# cloud project: copy the service_role key from Project Settings -> API Keys for this shell only
export NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service_role key>          # never put this in .env.local that gets committed / deployed
node scripts/offload-assets.mjs --dry-run                     # lists every board with inline assets, before/after bytes, no writes
node scripts/offload-assets.mjs                               # uploads (upsert), registers board_assets rows, rewrites src, saves with id+version
node scripts/offload-assets.mjs --board <uuid>                # one board, e.g. after a 57014 / 23514 report
node scripts/offload-assets.mjs --limit 50 --page-size 10     # batch on a big project; rerun until "0 offloaded" - the script is idempotent

# local stack
eval "$(npx supabase status -o env | sed 's/^/export /')"
NEXT_PUBLIC_SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY node scripts/offload-assets.mjs --dry-run
```

Expected output per board: `board <id> (v3): 2 inline asset(s), 5.31 MB -> 12.4 KB`, one `uploaded <path>` line per asset, `saved board <id>`, then a summary `scanned N board(s): X offloaded, Y without inline assets, Z failed`. Exit code is `1` if any board failed (the row is left untouched when an upload or registry insert fails; a `version` conflict with a live client is re-read and retried 3 times), `2` for a configuration error. Boards saved by the new client are skipped as "without inline assets". Order of operations when a project already has oversized rows: `npm run db:push` first (the constraint is added `NOT VALID`, so existing rows do not block it; `validate constraint` will fail on such a project - rerun the migration file's `validate` statements after the script), then the script, then deploy the client.

**Garbage collection.** Storage objects have no FK, so three things leave orphans behind: deleting a board (cascades `board_assets`, not the files), removing an image from a board without deleting it (tldraw's `remove()` is best effort), and an upload whose registry insert failed. Three layers reclaim them, all sharing one planner (`scripts/lib/storageGc.mjs`, unit-tested in `src/__tests__/storageGc.test.ts`):

*Definition of an orphan.* An object in `board-assets` that is at least **24 h old** (so an upload racing its own registry insert / autosave is never collected) and is neither in `board_assets.object_path` nor the `props.src` of any asset record inside `whiteboards.data` (URL suffix match on `/board-assets/<path>`, so boards saved before the registry existed are safe). An object in `training-data` is an orphan when no `training_samples.before_url` / `after_full_url` names it (paths or full URLs both count). Anything in any other bucket is never touched.

1. **On board delete (client).** The dashboard's delete (`src/app/page.tsx` -> `deleteBoardWithAssets` in `src/lib/assets/deleteBoard.ts`) reads the board's `board_assets.object_path` rows, deletes the `whiteboards` row, then calls `storage.from('board-assets').remove(paths)` in batches of 100 as the signed-in user (the `board-assets: owner delete own folder` policy authorises it). Object removal is best effort: a failure shows up as the toast "Whiteboard deleted, but some images could not be removed" plus a `console.warn`, and the nightly GC finishes the job. The row is deleted first so a failed delete never leaves a live board pointing at missing images.

2. **Operator script** (service role; refuses to run without it):

   ```bash
   # cloud: export NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for this shell only (never into a committed / deployed .env)
   node scripts/gc-storage.mjs                        # dry run (default): table of orphans per bucket + totals, deletes nothing
   node scripts/gc-storage.mjs --apply                # delete them in batches of 100 (DELETE /storage/v1/object/<bucket> {"prefixes":[...]})
   node scripts/gc-storage.mjs --bucket training-data --min-age-hours 72 --dry-run
   node scripts/gc-storage.mjs --min-age-hours 0 --apply   # e.g. right after a cohort clean-up; 0 collects everything unreferenced
   node scripts/gc-storage.mjs --json                 # machine-readable summary

   # local stack
   eval "$(npx supabase status -o env | sed 's/^/export /')"
   NEXT_PUBLIC_SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY node scripts/gc-storage.mjs --dry-run
   ```

   It lists every bucket level by level through the Storage API (`POST /storage/v1/object/list/<bucket>`, paginated), pages through `board_assets`, `whiteboards.data` and `training_samples` with PostgREST, prints one line per orphan (`BUCKET OBJECT SIZE CREATED REASON`) and a summary `scanned N object(s) in board-assets, training-data: X orphan(s) (Y MB) deleted - X deleted, Z failed (min age 24 h)`. Exit code `0` when nothing failed (or dry run), `1` when a delete batch failed or a listing errored (it stops before deleting anything if the reference set could not be loaded), `2` for usage / missing service role.

3. **Nightly cron** (`vercel.json` -> `"crons": [{ "path": "/api/admin/gc", "schedule": "0 4 * * *" }]`, i.e. 04:00 UTC). `GET|POST /api/admin/gc` (`src/app/api/admin/gc/route.ts`, `src/lib/server/storageGc.ts`) runs the same plan with the service role. It is public in the routes registry with reason "Vercel cron; requires Authorization: Bearer CRON_SECRET": Vercel attaches `Authorization: Bearer <CRON_SECRET>` automatically once the `CRON_SECRET` env var exists on the project; the route compares it in constant time and answers `401 unauthorized` otherwise, `503 feature_unavailable` when `CRON_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` is unset, `429` above 10 requests/min per IP, `500 internal_error` when a listing fails. Response: `{ scanned, orphans, deleted, bytes, dryRun, failed, buckets }`; the same numbers are logged as `storage gc summary` (module `storage-gc`) with `durationMs`, and failed batches as `storage gc: some deletes failed`. **The nightly cron collects.** Vercel requests the bare path with the `vercel-cron/1.0` user agent and an `x-vercel-cron-schedule` header (both documented), and the route treats that as `dryRun=0`; the same URL fetched by hand reports only, so an operator poking at it cannot delete by accident. Overrides: `?dryRun=1` pauses collection (set it on the cron path), `?dryRun=0` forces it for a manual call. Verify a run in the Vercel logs (`storage gc summary`, `dryRun: false`). `maxDuration` is 60 s; a project with tens of thousands of objects should prefer the script. Set both variables in Vercel before deploying:

   ```bash
   openssl rand -hex 24 | vercel env add CRON_SECRET production            # any random string (>= 16 chars)
   printf '%s' "<service_role key>" | vercel env add SUPABASE_SERVICE_ROLE_KEY production
   # trigger once by hand (dry run) and read the JSON:
   curl -sS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/admin/gc | jq
   ```

Do **not** `delete from storage.objects` in SQL: storage-api >= 1.7x installs a `BEFORE DELETE` trigger (`storage.protect_delete`) that rejects it with `42501 Direct deletion from storage tables is not allowed`, because removing the row leaves the file itself behind in the backing store. Every layer above goes through the Storage API. For an ad-hoc look without running anything, the SQL below matches what the planner does (minus the age and snapshot-src checks):

```sql
-- objects in board-assets that no registry row references
select o.name, o.created_at, (o.metadata->>'size')::bigint as bytes
from storage.objects o
left join public.board_assets a on a.object_path = o.name
where o.bucket_id = 'board-assets' and a.id is null
order by o.created_at;

-- registry rows whose object is gone (should be empty; the client registers after a successful upload)
select a.object_path from public.board_assets a
left join storage.objects o on o.bucket_id = 'board-assets' and o.name = a.object_path
where o.id is null;
```

## 13. Accounts & billing

Migration `supabase/migrations/20260917020000_accounts_billing.sql` (idempotent; `npm run db:push`). Credits are the unit: every user is on a plan with a monthly allowance, and for the current **UTC calendar month**

```
remaining = plans.monthly_credits + sum(credit_grants.units this month) - sum(usage_events.units this month)   (clamped at 0)
```

Nothing resets or rolls over; the window simply moves on the 1st at 00:00 UTC. Metering runs *as the user*: the API routes call `consume_credits()` with the caller's own JWT, so a user can only ever spend their own balance and nothing reachable with a user token can add credits or change a plan.

**What the migration creates**

| Kind | Objects |
| --- | --- |
| Tables (RLS on, no `anon` grants) | `plans` (catalogue; `select` for authenticated), `profiles` (one per `auth.users` row; owner `select`, owner `update` of **`display_name` only** via a column-level grant, so `PATCH {plan_id}` fails with `42501`), `usage_events` (spent credits; owner `select` only), `credit_grants` (extra credits; owner `select` only), `billing_events` (webhook idempotency log; **no** authenticated access, service role only) |
| Functions (`security definer`, `set search_path = public`, `execute` only for `authenticated`) | `credit_summary()` -> `{plan_id, plan_name, monthly_credits, used, granted, remaining, period_start, period_end}`; `consume_credits(p_route, p_units, p_request_id?, p_model?)` -> `{ok, remaining, reason}` (locks the caller's `profiles` row `FOR UPDATE`, so parallel calls serialize; `ok:false, reason:'insufficient_credits'` writes nothing; `p_units` must be 1..1000, else `400`); `delete_own_account()` -> deletes the caller's `auth.users` row (cascades below). Internal, not callable by users: `credit_period()`, `credit_balance(uuid)`, `handle_new_user()` |
| Triggers | `on_auth_user_created` (`auth.users` AFTER INSERT -> `profiles` row with `plan_id='free'`; never blocks sign-up - a failure is logged as a warning and `consume_credits()` creates the missing row on first use); `profiles_set_updated_at` |
| Seed | `plans` rows `free` (300 credits, $0), `plus` (3,000, $9.00), `pro` (12,000, $29.00) - **placeholders**, re-applied with `on conflict do update` on every migration run |
| Backfill | a `profiles` row for every pre-existing user |

The per-route cost (credits per call) is defined in the server code next to the route registry (see the routes table in `docs/ARCHITECTURE.md`); the database only records what it is told in `usage_events.units`. Verify the whole thing with `npm run db:verify` (checks named `plans:`, `profiles:`, `usage_events:`, `credit_grants:`, `billing_events:`, `credit_summary:`, `consume_credits:`, `delete_own_account:`) and `RUN_DB_TESTS=1 npx vitest run src/__tests__/db-billing.integration.test.ts` (month window, 10-way concurrency, deletion cascade).

**Change the plan numbers** (SQL editor; takes effect on the next `credit_summary()` / `consume_credits()` call, no deploy):

```sql
update public.plans set monthly_credits = 500, price_cents = 0 where id = 'free';
update public.plans set monthly_credits = 5000, price_cents = 1200, features = '["5,000 credits / month","Worksheets"]' where id = 'plus';
update public.plans set active = false where id = 'pro';      -- hide from the pricing UI; existing subscribers keep it
select id, name, monthly_credits, price_cents, active from public.plans order by sort;
```

Keep the migration's seed in sync when you change numbers permanently (it re-applies on every `db push`; otherwise the next push reverts your UPDATE). New plan ids must match `^[a-z][a-z0-9_-]{0,31}$`.

**Grant credits to a user by hand** (a refund, a classroom pilot, a bug apology). Grants count for the month of their `created_at`, so a grant made today is gone on the 1st:

```sql
insert into public.credit_grants (user_id, units, reason)
select id, 500, 'pilot cohort 2026-09' from auth.users where lower(email) = lower('student@example.com');
-- negative units are allowed for corrections
insert into public.credit_grants (user_id, units, reason) values ('<uuid>', -100, 'double-counted refund');
-- what the student now sees (as postgres you cannot call credit_summary(); use the internal helper)
select public.credit_balance((select id from auth.users where email = 'student@example.com'));
```

**Set a user's plan by hand** (comped account, or the webhook missed an event):

```sql
update public.profiles
set plan_id = 'plus', billing_status = 'comped', current_period_end = null
where user_id = (select id from auth.users where lower(email) = lower('student@example.com'));
select u.email, p.plan_id, p.billing_status, p.billing_customer_id, p.current_period_end
from public.profiles p join auth.users u on u.id = p.user_id where u.email = 'student@example.com';
```

**How the webhook updates it.** `POST /api/billing/webhook` verifies the provider signature (`STRIPE_WEBHOOK_SECRET`) and then, with `SUPABASE_SERVICE_ROLE_KEY` (the only route that uses it; add it to Vercel *Production* only, as a sensitive variable, when you enable billing), does two writes: `insert into billing_events (id, type, payload)` keyed by the provider's event id (`on conflict do nothing`; a duplicate delivery is dropped there) and `update profiles set plan_id, billing_customer_id, billing_subscription_id, billing_status, current_period_end where user_id = ...` (the user id travels in the checkout session's `client_reference_id` / subscription metadata). Without both env vars the route answers `503 feature_unavailable` and nothing changes. `BILLING_ENFORCE=0` makes the API routes skip `consume_credits()` entirely (dev/staging escape hatch; never in production). Checkout / portal links come from `NEXT_PUBLIC_BILLING_LINKS`; without it the pricing UI shows the plans with disabled buttons. Inspect what arrived with `select id, type, received_at from public.billing_events order by received_at desc limit 20;`.

**Usage questions**

```sql
-- this month's spend per user
select u.email, sum(e.units) as credits, count(*) as calls
from public.usage_events e join auth.users u on u.id = e.user_id
where e.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
group by u.email order by credits desc;
-- most expensive routes this month
select route, sum(units) as credits, count(*) as calls from public.usage_events
where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
group by route order by credits desc;
```

`usage_events` is append-only and grows with every AI call (one row per call, ~100 bytes). Prune rows older than the retention you want (`delete from public.usage_events where created_at < now() - interval '13 months';`) - only the current month is ever consulted for balances.

**Account deletion and storage garbage collection.** `delete_own_account()` deletes the caller's `auth.users` row. That cascades (`on delete cascade`) to `profiles`, `whiteboards` (-> `whiteboard_snapshots`, `board_assets`), `user_settings`, `trainers`, `training_samples`, `usage_events` and `credit_grants`; `bug_reports` keeps its rows with `user_id = null`; Auth removes identities, sessions and refresh tokens itself. The user's JWT stays signature-valid until it expires, but every table is empty for it and `consume_credits()` answers `403 account not found`.

Storage objects are **not** removed by the RPC: `storage.objects` has no FK to `auth.users`, and the Storage trigger described in section 12 rejects direct row deletes because the file behind the row would stay in the backing store. So: (1) the client does this itself — `src/components/account/DangerZone.tsx` calls `deleteOwnAccount()` from `src/lib/billing/deleteAccount.ts`, which reads its own `board_assets.object_path` rows and calls `storage.from('board-assets').remove(paths)` *before* the RPC (the owner-delete policy allows it; a Storage failure is logged and does not block the deletion; `training-data` has no delete policy on purpose), and (2) the operator runs this after deletions, because `board-assets` is a public bucket and an orphaned image stays reachable by URL until it is removed:

```sql
-- objects whose owner folder (<uid>/...) no longer matches an existing user
select o.bucket_id, o.name, o.created_at
from storage.objects o
where o.bucket_id in ('board-assets', 'training-data')
  and not exists (select 1 from auth.users u where u.id::text = (storage.foldername(o.name))[1])
order by o.bucket_id, o.name;
```

then delete them through the Storage API with the service role (never via SQL):

```bash
curl -X DELETE "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/board-assets" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"prefixes":["<uid>/<boardId>/<assetId>.png", "..."]}'
```

`src/__tests__/db-billing.integration.test.ts` exercises exactly this sequence (delete account -> object still served -> service-role API delete -> 404). Wiring the query above into the nightly GC job from section 12 is the intended follow-up.

### 13.1 Refunds and database-backed rate limits

Migration `supabase/migrations/20260917030000_refunds_ratelimit.sql` (idempotent; `npm run db:push`). Two more `security definer` RPCs, `execute` for `authenticated` only (anon gets `42501` / HTTP 401), both keyed on `auth.uid()`:

| RPC | Returns | What it does |
| --- | --- | --- |
| `refund_credits(p_request_id text)` | `{refunded, remaining}` | Deletes the caller's **own** `usage_events` rows with that `request_id` whose `created_at` is within the last **15 minutes**, then returns `refunded` (credits removed, i.e. the sum of `units`; `0` when nothing matched) and the new `remaining` from the normal balance logic. Takes the same `profiles` row lock as `consume_credits()`, so a refund and a spend for one user never interleave. Idempotent: calling it twice refunds `0` the second time. Another user's request id, an unknown id and a row older than 15 minutes all return `refunded: 0` and touch nothing. `p_request_id` must be 1..100 characters (else `400`). The API routes call it when the upstream provider fails *after* the charge; the 15-minute cap means a request id can never be replayed later to erase spend |
| `rate_limit_hit(p_bucket text, p_limit int, p_window_ms int)` | `{allowed, remaining, retry_after_ms, backend: 'db'}` | Fixed window aligned to the Unix epoch (`window_start = now - now mod p_window_ms`), counter row `(user_id, bucket, window_start)` in `public.rate_limit_counters`, incremented with one atomic `insert ... on conflict do update`. `allowed = hits <= p_limit`; `remaining = max(0, p_limit - hits)`; `retry_after_ms` is the time until the window ends when denied and `0` when allowed. Parallel calls serialise on the row, so 20 simultaneous hits with `p_limit = 10` allow exactly 10 (integration-tested). Limits: `p_bucket` 1..100 chars, `p_limit` 1..1,000,000, `p_window_ms` 1..86,400,000 (else `400`) |

`rate_limit_counters` (`user_id uuid, bucket text, window_start timestamptz, hits int, expires_at timestamptz`, PK `(user_id, bucket, window_start)`) has RLS enabled with **no policies and no grants** for `anon` or `authenticated`: users reach it through the function only (`GET /rest/v1/rate_limit_counters` -> `403`). It is not a ledger: `expires_at = window_start + 2 * window`, every call deletes the caller's expired rows for that bucket, and about 2% of calls sweep every expired row of every user, so the table stays at roughly `active users x buckets x 2` rows. There is deliberately no FK to `auth.users` (rows age out within two windows anyway, and a deleted user's still-valid JWT must not turn a rate-limit check into a constraint error). Compared with the in-memory limiter in `src/lib/server/rate-limit.ts` (per server instance, so the effective limit is `limit x instances`), this one is global; the `backend` field tells the route which implementation answered.

Verify with `npm run db:verify` (checks named `refund_credits:`, `rate_limit_hit:`, `rate_limit_counters:`; the "row older than 15 minutes" case needs `SUPABASE_SERVICE_ROLE_KEY` to plant a back-dated row and is reported as skipped otherwise) and `RUN_DB_TESTS=1 npx vitest run src/__tests__/db-billing.integration.test.ts` (refund idempotency, foreign/stale ids, 1-second window rollover and cleanup, 20-way concurrency).

**Operator questions**

```sql
-- who is being throttled right now (live windows only)
select u.email, c.bucket, c.hits, c.window_start, c.expires_at
from public.rate_limit_counters c join auth.users u on u.id = c.user_id
where c.expires_at > now() order by c.hits desc limit 50;

-- reset one user's counters (they get a fresh window immediately)
delete from public.rate_limit_counters
where user_id = (select id from auth.users where lower(email) = lower('student@example.com'));

-- refunds are deletions, so "how much was refunded" is not in the ledger; look at the API logs
-- (event `credits refunded`, fields route/requestId/refunded). Manual make-goods stay in credit_grants:
insert into public.credit_grants (user_id, units, reason) values ('<uuid>', 25, 'refund: provider outage 2026-09-17');

-- a request id that was charged but not refunded (e.g. to decide on a manual grant)
select user_id, route, units, model, created_at from public.usage_events where request_id = '<request id>';
```

`rate_limit_counters` can be truncated at any time (`truncate public.rate_limit_counters;`) - the only effect is that everyone gets a fresh window.
