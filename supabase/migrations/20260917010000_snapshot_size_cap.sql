-- Snapshot size cap: 8 MB (8388608 bytes) on every column that stores a tldraw
-- snapshot. Matches SNAPSHOT_LIMITS.dbBytes in scripts/lib/snapshotAssets.mjs
-- (the client refuses to autosave above SNAPSHOT_LIMITS.hardBytes = 4 MB, so a
-- healthy client never gets near this; the constraint is the backstop against
-- base64 images being written straight into a row).
--
-- Idempotent: each constraint is dropped and re-added. Added NOT VALID and then
-- validated in a separate statement so a pre-existing oversized row does not
-- make the migration fail; such rows simply cannot be UPDATEd (the check applies
-- to new tuples) until `node scripts/offload-assets.mjs` has moved their inline
-- assets to the board-assets bucket. Run the offload script BEFORE deploying a
-- client that saves to those boards again (docs/RUNBOOK-supabase.md, Assets).
--
-- Note: `alter table ... validate constraint` fails when a row already violates
-- the cap. On a database with oversized rows, run the offload script first and
-- then re-run this file (or just the validate statements) - the add ... not
-- valid part has already taken effect and blocks new oversized writes.

alter table public.whiteboards
  drop constraint if exists whiteboards_data_size;
alter table public.whiteboards
  add constraint whiteboards_data_size
  check (octet_length(data::text) <= 8388608) not valid;
alter table public.whiteboards
  validate constraint whiteboards_data_size;

alter table public.whiteboard_snapshots
  drop constraint if exists whiteboard_snapshots_data_size;
alter table public.whiteboard_snapshots
  add constraint whiteboard_snapshots_data_size
  check (octet_length(data::text) <= 8388608) not valid;
alter table public.whiteboard_snapshots
  validate constraint whiteboard_snapshots_data_size;

alter table public.training_samples
  drop constraint if exists training_samples_tldraw_snapshot_size;
alter table public.training_samples
  add constraint training_samples_tldraw_snapshot_size
  check (octet_length(tldraw_snapshot::text) <= 8388608) not valid;
alter table public.training_samples
  validate constraint training_samples_tldraw_snapshot_size;
