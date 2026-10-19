-- =============================================================================
-- The iPad app's board document (2026-10-17; docs/IPAD-NATIVE.md, docs/BOARD-FORMAT.md). Idempotent.
--
-- What. The native iPad app keeps a board in Agathon's own format ("agathon.board", schema 1: a flat
-- table of typed records with compact ink), not tldraw's. It lives in a new column next to the
-- tldraw `data`, in the same row, so RLS, the owner, the title, the thumbnail, the version, the
-- cascade on delete and the history are all the row's as before.
--
--   doc          jsonb    the Agathon document, written by the app; null until the app first saves
--   doc_schema   integer  doc's `schema`, kept by the trigger (a reader refuses a newer schema)
--   doc_version  bigint   the row `version` the doc was last written at, kept by the trigger
--
-- Which one is the board. `doc` is the board when it is current: `doc is not null and
-- doc_version = version` (`doc_current` in admin_board_rows). Any write that changes `data` bumps
-- `version` without touching `doc_version`, so a doc is current exactly when nothing has written
-- `data` since. Readers go through src/lib/boards/agathonDoc.ts `loadBoardSnapshot(row)`.
--
-- The app never writes `data`: an old web board is converted in the app the first time it opens
-- there and the tldraw original stays in `data`, untouched. The web never overwrites an iPad board:
-- the board page opens a board whose doc is current read-only, and this migration's guard refuses
-- a write that changes `data` once the row has a `doc` (errcode P0001, message
-- 'board_edited_on_ipad'), so a web tab left open since before, or a stale cached client, cannot
-- replace the iPad's work. (The escape hatch for an operator: a statement that changes `doc` too,
-- e.g. `set doc = null, data = …`, is allowed.)
--
-- Version and history. The version trigger now bumps `version` when `data` OR `doc` changes, and
-- the history trigger keeps the doc a write replaced with the same rule and retention as `data`
-- (20261003000000_snapshot_retention.sql): a row when the board has none younger than 10 minutes
-- ('interval') or when the write drops more than half of the document ('pre_drop'). A doc history
-- row stores only the doc (its `data` is null: the frozen tldraw original is still in the row);
-- the first doc of a board replaces nothing and is not kept. whiteboard_snapshots.data becomes
-- nullable for that; every row still has a `data` or a `doc`. The retention counts both columns.
--
-- Size. `doc` has the same 8 MB cap as `data` (whiteboards_doc_size, whiteboard_snapshots_doc_size);
-- the app refuses to save above 4 MB as the web does (the format is ~7x smaller than tldraw's).
--
-- Objects created or changed here:
--   columns     whiteboards.doc, .doc_schema, .doc_version; whiteboard_snapshots.doc, .doc_schema;
--               whiteboard_snapshots.data drops NOT NULL
--   constraints whiteboards_doc_size, whiteboards_doc_format, whiteboard_snapshots_doc_size,
--               whiteboard_snapshots_has_document
--   functions   whiteboards_bump_version() [replaced: doc too, doc_version/doc_schema, the guard],
--               whiteboards_record_snapshot() [replaced: doc history], prune_whiteboard_snapshots(uuid)
--               [replaced: counts doc bytes]
--   triggers    whiteboards_bump_version: BEFORE INSERT OR UPDATE OF data, doc, doc_schema, doc_version
--               whiteboards_record_snapshot: AFTER UPDATE OF data, doc
--   views       admin_board_rows: size_bytes counts doc; new columns doc_version, doc_schema, doc_current
--   RLS         unchanged (same row, same policies, same grants)
--
-- Locks. The columns are nullable with no default (no table rewrite). Validating the new size
-- constraint scans the table under SHARE UPDATE EXCLUSIVE (reads and saves carry on). The trigger
-- swaps take a brief exclusive lock on whiteboards; lock_timeout makes the migration fail rather
-- than queue every save behind it (run it again).
-- =============================================================================

set local lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.whiteboards add column if not exists doc jsonb;
alter table public.whiteboards add column if not exists doc_schema integer;
alter table public.whiteboards add column if not exists doc_version bigint;

alter table public.whiteboards drop constraint if exists whiteboards_doc_size;
alter table public.whiteboards
  add constraint whiteboards_doc_size check (doc is null or octet_length(doc::text) <= 8388608) not valid;
alter table public.whiteboards validate constraint whiteboards_doc_size;

-- an Agathon document's envelope (docs/BOARD-FORMAT.md, "The envelope"); the records are the app's
alter table public.whiteboards drop constraint if exists whiteboards_doc_format;
alter table public.whiteboards
  add constraint whiteboards_doc_format check (
    doc is null or (
      jsonb_typeof(doc) = 'object'
      and doc->>'format' = 'agathon.board'
      and jsonb_typeof(doc->'schema') = 'number'
      and jsonb_typeof(doc->'records') = 'object'
    )
  ) not valid;
alter table public.whiteboards validate constraint whiteboards_doc_format;

alter table public.whiteboard_snapshots add column if not exists doc jsonb;
alter table public.whiteboard_snapshots add column if not exists doc_schema integer;
alter table public.whiteboard_snapshots alter column data drop not null;

alter table public.whiteboard_snapshots drop constraint if exists whiteboard_snapshots_doc_size;
alter table public.whiteboard_snapshots
  add constraint whiteboard_snapshots_doc_size check (doc is null or octet_length(doc::text) <= 8388608) not valid;
alter table public.whiteboard_snapshots validate constraint whiteboard_snapshots_doc_size;

alter table public.whiteboard_snapshots drop constraint if exists whiteboard_snapshots_has_document;
alter table public.whiteboard_snapshots
  add constraint whiteboard_snapshots_has_document check (data is not null or doc is not null) not valid;
alter table public.whiteboard_snapshots validate constraint whiteboard_snapshots_has_document;

-- -----------------------------------------------------------------------------
-- 2. Version: data or doc; doc_version and doc_schema; the web never overwrites an iPad board
-- -----------------------------------------------------------------------------
create or replace function public.whiteboards_bump_version()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- never what the client sent: derived from the doc
    if new.doc is not null then
      new.doc_version := new.version;
      new.doc_schema := (new.doc->>'schema')::integer;
    else
      new.doc_version := null;
      new.doc_schema := null;
    end if;
    return new;
  end if;

  -- Once the iPad app keeps the board (a doc), its tldraw `data` is frozen: a write that changes
  -- `data` alone is a web client that does not know (a tab open since before). Refused, so it can
  -- never replace the iPad's work. Changing `doc` in the same statement is the operator's way out.
  if old.doc is not null and new.data is distinct from old.data and new.doc is not distinct from old.doc then
    raise exception using
      errcode = 'P0001',
      message = 'board_edited_on_ipad',
      hint = 'This board is kept by the iPad app (whiteboards.doc); its tldraw data is read-only.';
  end if;

  if new.data is distinct from old.data or new.doc is distinct from old.doc then
    new.version := old.version + 1;
  end if;
  if new.doc is distinct from old.doc then
    new.doc_version := case when new.doc is null then null else new.version end;
    new.doc_schema := case when new.doc is null then null else (new.doc->>'schema')::integer end;
  else
    new.doc_version := old.doc_version;
    new.doc_schema := old.doc_schema;
  end if;
  return new;
end;
$$;

revoke all on function public.whiteboards_bump_version() from public, anon, authenticated;

drop trigger if exists whiteboards_bump_version on public.whiteboards;
create trigger whiteboards_bump_version
  before insert or update of data, doc, doc_schema, doc_version on public.whiteboards
  for each row execute function public.whiteboards_bump_version();

-- -----------------------------------------------------------------------------
-- 3. Retention: both columns count
-- -----------------------------------------------------------------------------
create or replace function public.prune_whiteboard_snapshots(p_whiteboard_id uuid)
returns integer
language sql
security invoker
set search_path = public
as $$
  with board as (
    select s.id, s.created_at, s.reason,
           coalesce(pg_column_size(s.data), 0) + coalesce(pg_column_size(s.doc), 0) as bytes
    from public.whiteboard_snapshots s
    where s.whiteboard_id = p_whiteboard_id
  ),
  guaranteed as (
    -- the state before a wipe: a week, at most 3, outside the budget
    select id from board
    where reason = 'pre_drop' and created_at >= now() - interval '7 days'
    order by id desc
    limit 3
  ),
  ranked as (
    select b.id,
           b.created_at,
           b.bytes,
           row_number() over (order by b.id desc) as rn,
           row_number() over (partition by (b.created_at at time zone 'utc')::date order by b.id desc) as day_rn
    from board b
    where b.id not in (select id from guaranteed)
  ),
  candidates as (
    -- in order of value: the newest, then the newest of each earlier day, then the rest
    select id,
           bytes,
           row_number() over (
             order by case when rn = 1 then 0 when day_rn = 1 and created_at >= now() - interval '7 days' then 1 else 2 end, rn
           ) as pri
    from ranked
    where rn <= 8 or (day_rn = 1 and created_at >= now() - interval '7 days')
  ),
  kept as (
    select id from guaranteed
    union all
    select id
    from (select id, pri, sum(bytes) over (order by pri) as running from candidates) c
    where c.pri <= 2 or c.running <= 4194304
  ),
  gone as (
    delete from public.whiteboard_snapshots s
    where s.whiteboard_id = p_whiteboard_id
      and s.id not in (select id from kept)
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.prune_whiteboard_snapshots(uuid) from public, anon, authenticated;
grant execute on function public.prune_whiteboard_snapshots(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. History: the doc a write replaced, by the same rule as data
-- -----------------------------------------------------------------------------
create or replace function public.whiteboards_record_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  data_changed boolean := new.data is distinct from old.data;
  doc_changed boolean := new.doc is distinct from old.doc;
  -- stored (compressed) sizes, read from the TOAST pointer: the multi-MB values are not fetched
  old_bytes integer;
  new_bytes integer;
  why text;
begin
  if not data_changed and not doc_changed then
    return new;
  end if;
  if doc_changed then
    -- the board's first doc (converted from `data`, which stays in the row) replaces nothing
    if old.doc is null then
      return new;
    end if;
    old_bytes := pg_column_size(old.doc);
    new_bytes := coalesce(pg_column_size(new.doc), 0);
  else
    old_bytes := pg_column_size(old.data);
    if old_bytes < 64 then
      if old.data = '{}'::jsonb then
        return new;
      end if;
    end if;
    new_bytes := pg_column_size(new.data);
  end if;

  if old_bytes >= 16384 and new_bytes * 2 < old_bytes then
    why := 'pre_drop';
  elsif not exists (
    select 1 from public.whiteboard_snapshots s
    where s.whiteboard_id = old.id and s.created_at > now() - interval '10 minutes'
  ) then
    why := 'interval';
  else
    return new;
  end if;

  -- History is a safety net: if it cannot be written, the student's save still goes through.
  begin
    insert into public.whiteboard_snapshots (whiteboard_id, user_id, version, data, doc, doc_schema, reason)
    values (
      old.id, old.user_id, old.version,
      case when data_changed then old.data end,
      case when doc_changed then old.doc end,
      case when doc_changed then old.doc_schema end,
      why
    )
    on conflict (whiteboard_id, version) do nothing;
    perform public.prune_whiteboard_snapshots(old.id);
  exception when others then
    raise warning 'whiteboards_record_snapshot: no history row for board % (version %): % (%)', old.id, old.version, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.whiteboards_record_snapshot() from public, anon, authenticated;

drop trigger if exists whiteboards_record_snapshot on public.whiteboards;
create trigger whiteboards_record_snapshot
  after update of data, doc on public.whiteboards
  for each row execute function public.whiteboards_record_snapshot();

-- -----------------------------------------------------------------------------
-- 5. The console's rows: the doc's size, and which column is the board
-- -----------------------------------------------------------------------------
create or replace view public.admin_board_rows
with (security_invoker = true)
as
select
  w.id,
  w.user_id,
  w.title,
  w.preview,
  w.created_at,
  w.updated_at,
  w.version,
  w.deleted_at,
  (pg_column_size(w.data) + coalesce(pg_column_size(w.doc), 0))::bigint as size_bytes,
  (select count(*) from public.learning_attempts la where la.board_id = w.id)::integer as attempts,
  w.doc_version,
  w.doc_schema,
  (w.doc is not null and w.doc_version = w.version) as doc_current
from public.whiteboards w;

revoke all on public.admin_board_rows from public, anon, authenticated;
grant select on public.admin_board_rows to service_role;

notify pgrst, 'reload schema';
