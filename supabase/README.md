# Supabase

Schema lives in `supabase/migrations/*.sql` and `config.toml` configures the local stack. Both are committed; `.temp/` and `.branches/` are not.

- Local: `npx supabase start` (needs Docker), then `npm run db:reset` applies every migration from scratch and prints the local URL/anon key for `.env.local`.
- New migration: `npx supabase migration new <name>`, edit the generated file, then `npm run db:reset` to verify it applies cleanly.
- Remote: `npx supabase link --project-ref <ref>` once, then `npm run db:push` applies pending migrations to the linked project.
- Migrations are idempotent (`create ... if not exists`, `drop policy if exists`), so re-running the init file in the SQL editor is safe.
- Never edit an already-pushed migration; add a new one.
