-- =============================================================================
-- RLS hardening (2026-09-17). Idempotent; additive to 20260911000000_init.sql.
--
-- Found by scripts/verify-rls.mjs against a fresh local stack:
--
--  1. Table privileges. Supabase's default privileges grant ALL on every new
--     public table to anon, authenticated and service_role. The init migration
--     revoked anon but only *added* grants for authenticated, so authenticated
--     kept DELETE/TRUNCATE/TRIGGER/REFERENCES on every table (e.g. DELETE and
--     SELECT on bug_reports, DELETE on user_settings). RLS still filtered rows,
--     but least privilege should not depend on that. Reset each table to the
--     exact set the client uses.
--
--  2. board_assets allowed any authenticated user to register an asset row
--     against ANOTHER user's board (policy only checked user_id = auth.uid()).
--     Inserts/updates now also require owning the referenced whiteboard.
--
--  3. board-assets storage UPDATE policy had no WITH CHECK, so an owner could
--     move an object into someone else's folder. Added.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Privileges: anon gets nothing, authenticated gets exactly what the app uses.
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

revoke all on public.whiteboards from authenticated;
grant select, insert, update, delete on public.whiteboards to authenticated;

revoke all on public.user_settings from authenticated;
grant select, insert, update on public.user_settings to authenticated;

revoke all on public.bug_reports from authenticated;
grant insert on public.bug_reports to authenticated;

revoke all on public.trainers from authenticated;
grant select on public.trainers to authenticated;

revoke all on public.training_samples from authenticated;
grant select, insert on public.training_samples to authenticated;

revoke all on public.whiteboard_snapshots from authenticated;
grant select, insert on public.whiteboard_snapshots to authenticated;

revoke all on public.board_assets from authenticated;
grant select, insert, update, delete on public.board_assets to authenticated;

-- Trigger functions are never called through the API (PostgREST refuses
-- `returns trigger`), and triggers fire regardless of EXECUTE privilege.
revoke all on function public.set_updated_at()              from public, anon, authenticated;
revoke all on function public.whiteboards_bump_version()    from public, anon, authenticated;
revoke all on function public.whiteboards_record_snapshot() from public, anon, authenticated;

-- is_trainer() stays callable by authenticated (used inside policies).
revoke all on function public.is_trainer() from public, anon;
grant execute on function public.is_trainer() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. board_assets: split the single FOR ALL policy; writes require board ownership.
-- -----------------------------------------------------------------------------
drop policy if exists "board_assets: owner all" on public.board_assets;

drop policy if exists "board_assets: owner select" on public.board_assets;
create policy "board_assets: owner select"
  on public.board_assets for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "board_assets: owner insert" on public.board_assets;
create policy "board_assets: owner insert"
  on public.board_assets for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.whiteboards w
                where w.id = whiteboard_id and w.user_id = (select auth.uid()))
  );

drop policy if exists "board_assets: owner update" on public.board_assets;
create policy "board_assets: owner update"
  on public.board_assets for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.whiteboards w
                where w.id = whiteboard_id and w.user_id = (select auth.uid()))
  );

drop policy if exists "board_assets: owner delete" on public.board_assets;
create policy "board_assets: owner delete"
  on public.board_assets for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 3. Storage: owners may only rename/move objects within their own folder.
-- -----------------------------------------------------------------------------
drop policy if exists "board-assets: owner update own folder" on storage.objects;
create policy "board-assets: owner update own folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'board-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'board-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- PostgREST caches the schema; privileges are checked live but reload anyway.
notify pgrst, 'reload schema';
