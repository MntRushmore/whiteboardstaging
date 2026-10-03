-- =============================================================================
-- board-assets: nobody lists another account's folder (security audit, 2026-10-03). Idempotent.
--
-- The bug. 20260911000000_init.sql gave the PUBLIC bucket `board-assets` a SELECT policy on
-- storage.objects for the `public` role (anon included) with no folder condition:
--     create policy "board-assets: public read" on storage.objects for select to public
--       using (bucket_id = 'board-assets');
-- A public bucket does not need it to serve files: GET /storage/v1/object/public/<bucket>/<path>
-- (what `getPublicUrl` returns and every <img src> and AI route uses) is answered by Storage
-- without RLS. The only thing the policy added was the LIST and authenticated-download API for
-- everyone, so anyone with the anon key (it is in the page source) could call
--     POST /storage/v1/object/list/board-assets  {"prefix": ""}
-- and get every user's id (the top-level folders), then every board id and file name under each,
-- and so download every photo and page a student ever put on a board. A user id is also all an
-- attacker needs to aim a Payment Link checkout at someone else's account
-- (`client_reference_id`), so the listing was the first step of that too.
--
-- The fix. The broad policy goes; an owner may still read (list, download through the API, and
-- the SELECT that DELETE ... RETURNING and upsert need) their OWN folder, the same folder rule as
-- the insert/update/delete policies. Public URLs keep working unchanged.
-- scripts/lib/rlsChecks.mjs (checkStorage) proves both: anon and another user list nothing, the
-- public URL still answers 200, the owner can still list and delete.
-- =============================================================================

drop policy if exists "board-assets: public read" on storage.objects;

drop policy if exists "board-assets: owner select own folder" on storage.objects;
create policy "board-assets: owner select own folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'board-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
