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

Also required: `OPENROUTER_API_KEY` (all envs). Optional: `OPENAI_API_KEY`, `MATHPIX_APP_ID`/`MATHPIX_APP_KEY`, `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_LIVE_MATH`, `LIVE_MODEL_*`, `LOG_LEVEL`, `NEXT_PUBLIC_LOG_LEVEL`. Do **not** add `SUPABASE_SERVICE_ROLE_KEY` to Vercel: no route reads it. Redeploy (`vercel --prod`) after changing env vars; existing deployments keep their old values.

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
| service_role / secret | same page | Nothing in this repo uses it; rotate freely. If a future admin job uses it, rotate it there too. |
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
| `57014 canceling statement due to statement timeout` on save | `whiteboards.data` row is multi-MB (base64 images); PostgREST `authenticated` timeout is 8 s | Delete large pasted images from the board; long-term fix is the `board-assets` offload (`docs/ARCHITECTURE.md`). Do not raise the role timeout. |
| `42501 permission denied for table ...` | Missing `grant ... to authenticated` (or the table was created outside the migration) | Re-run `npm run db:push` (idempotent) or paste the init migration into the SQL editor. `anon` is denied on purpose. |
| `42P01 relation "public.whiteboards" does not exist` | Migration never ran on this project | Section 2. |
| Storage upload -> `403` / `new row violates row-level security policy` | Object path does not start with the caller's `auth.uid()`, caller is not in `trainers` (training-data), wrong MIME type, or bucket missing | Check the path prefix, the trainer row (section 6), and `select * from storage.buckets`. |
| Storage upload -> `413` / `Payload too large` | Over the bucket or project cap | 15 MB (`board-assets`) / 10 MB (`training-data`); *Storage -> Settings* global cap. |
| `/api/*` returns `401 unauthorized` everywhere | Session expired, or the Vercel env points at a different project than the browser | Section 5; redeploy after env changes. |
| Sign-up succeeds but user cannot sign in | Email confirmations are on without SMTP | Section 3: turn confirmations off or configure SMTP; confirm the user manually under *Authentication -> Users*. |
| `supabase link` fails with `SASL auth` / `password authentication failed` | Wrong DB password | Reset it (*Project Settings -> Database*) and link again. |
| `npx supabase start` fails | Docker not running or ports 54321-54329 busy | Start Docker; `npx supabase stop --no-backup`; retry. |
