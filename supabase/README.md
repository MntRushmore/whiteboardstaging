# Supabase

Schema lives in `supabase/migrations/*.sql`; `config.toml` configures the **local** stack only (cloud Auth/Storage settings are dashboard-side and are listed in [`docs/RUNBOOK-supabase.md`](../docs/RUNBOOK-supabase.md), which is the single source of truth for creating, verifying, backing up and restoring the cloud project). `.temp/` and `.branches/` are not committed.

## Local

```bash
npx supabase start          # needs Docker; then `npx supabase status -o env` for URL/keys
npm run db:reset            # drop + apply every migration from scratch + seed.sql
npm run db:seed             # re-run seed data only
npm run db:verify           # scripts/verify-rls.mjs: RLS, grants, buckets, policies
RUN_DB_TESTS=1 npm test     # DB integration tests (skipped without the flag)
```

`.env.example` already holds the local URL and demo anon key. The `[auth]` block in `config.toml` mirrors the dashboard settings from the runbook (confirmations off, signups on, `localhost:3000` and `127.0.0.1:3000` redirect URLs).

## Migrations

- New migration: `npx supabase migration new <name>`, edit the generated file, then `npm run db:reset` to prove it applies cleanly from zero.
- Migrations are idempotent (`create ... if not exists`, `drop policy if exists`), so re-running the init file in the SQL editor is safe.
- Never edit an already-pushed migration; add a new one.
- Remote: `npx supabase link --project-ref <ref>` once, then `npm run db:push` applies pending migrations (runbook section 2 explains what the init migration creates).
