-- =============================================================================
-- Board history retention (2026-10-03). Idempotent; replaces the history rule of
-- 20260911000000_init.sql (B3).
--
-- Why. whiteboards_record_snapshot() copied the whole board into whiteboard_snapshots on EVERY
-- data change (a save every 2-10 s while a student draws) and kept the newest 20 per board. A
-- heavy board is 1-4 MB of JSON, 0.7-1.8 MB once TOAST compresses it, so its history alone was
-- 15-35 MB; on the free plan's 500 MB a few dozen such boards fill the database, the project goes
-- read-only, and then every save of every student fails (docs/QA-2026-10-02-reliability.md, N6).
-- The newest of those 20 copies was also always identical to the row itself.
--
-- Who reads the history. Nothing in the app: no restore UI, the autosave's conflict merge works
-- from the client's own dirty sets, account deletion is an FK cascade, storage GC reads only
-- whiteboards.data and board_assets. It is the operator's undo: "my board got wiped / messed up
-- since this morning / since yesterday", restored by hand from SQL (docs/RUNBOOK-supabase.md).
-- What that needs: a state shortly before a disaster, the state a session ended in, and something
-- from each of the last few days. So, per board:
--
-- Recording (AFTER UPDATE OF data, when data changed). The row is the current state; a history row
-- holds the state a write REPLACED (old.version, old.data), so nothing is stored twice and the state
-- a session ended in is kept when the next session starts. A history row is written when
--   * the board has none younger than 10 minutes (so: the first write of every session, then at
--     most one every 10 minutes while the student works), or
--   * the write drops more than half of the board (stored size of new < half of old, old at least
--     16 KB): clearing the board, a mass erase, or a buggy or stale client overwriting it. The state
--     right before it is kept whatever the 10-minute rule says.
-- A brand-new board's empty '{}' is never kept.
--
-- Retention (prune_whiteboard_snapshots, run after each history row is written, i.e. at most a
-- few times an hour per board, and once below for everything already stored). Candidates are
--   * the newest 8, and
--   * the newest of each UTC day for the last 7 days.
-- Taken in order of value (the newest; the newest of each earlier day, most recent first; the
-- rest, newest first), they are kept until the history passes 4 MB of stored (compressed) size,
-- but the first 2 always stay: a heavy board keeps its latest state and the one it had the day
-- before rather than two states ten minutes apart. Everything else is deleted.
--
-- Size (stored, i.e. compressed; docs/QA-2026-10-02-reliability.md "Follow-ups" has the arithmetic).
-- Before: 20 copies of the board, whatever the use: 15 MB for a 0.74 MB board, 35 MB for 1.76 MB.
-- After: at most 15 copies (8 + 7 days), and no more than 4 MB unless 2 copies already pass it:
-- a 0.74 MB board keeps up to 5 (3.7 MB), a 1.76 MB board 2 (3.5 MB), a 30 KB board up to 15
-- (0.45 MB); a board drawn on for 20 minutes once keeps 2. And one history write per 10 minutes of
-- drawing instead of one per save (2-10 s): a fraction of the write I/O.
--
-- Writers. Only this trigger: authenticated loses INSERT on whiteboard_snapshots (the client never
-- wrote it, and a user who could would hold an unbounded store of 8 MB rows, and could plant a row
-- dated in the future that stops their history from being recorded). Owners keep SELECT.
--
-- Objects created or changed here:
--   functions  whiteboards_record_snapshot() [trigger, replaced], prune_whiteboard_snapshots(uuid) [new]
--   grants     whiteboard_snapshots: INSERT revoked from authenticated (SELECT stays)
--   policies   "snapshots: owner insert" dropped
--   rows       existing history pruned to the retention above (one pass over every board)
--
-- Runtime: the one-time prune is one indexed delete per board with history; on a large table it
-- deletes most rows (and their TOAST chunks) in this transaction, seconds to a few minutes, and
-- whiteboard saves wait on it only for boards it is pruning at that moment. Postgres reuses the
-- freed space, but the database's size on disk (what the free plan's 500 MB limit measures) only
-- shrinks after `vacuum (full, analyze) public.whiteboard_snapshots;`, run by hand afterwards
-- (it cannot run inside a migration; it locks the table, so saves wait for the few seconds it takes
-- on the pruned table). docs/RUNBOOK-supabase.md, section 10.1.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Retention: what a board keeps
-- -----------------------------------------------------------------------------
create or replace function public.prune_whiteboard_snapshots(p_whiteboard_id uuid)
returns integer
language sql
security invoker
set search_path = public
as $$
  with ranked as (
    select s.id,
           s.created_at,
           pg_column_size(s.data) as bytes,
           row_number() over (order by s.version desc) as rn,
           row_number() over (partition by (s.created_at at time zone 'utc')::date order by s.version desc) as day_rn
    from public.whiteboard_snapshots s
    where s.whiteboard_id = p_whiteboard_id
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

-- Never through the API for users; the trigger (as its owner) and operators (service role) only.
revoke all on function public.prune_whiteboard_snapshots(uuid) from public, anon, authenticated;
grant execute on function public.prune_whiteboard_snapshots(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2. Recording: which writes leave a history row
-- -----------------------------------------------------------------------------
create or replace function public.whiteboards_record_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- the stored (compressed) size: read from the TOAST pointer, the multi-MB value is not fetched
  old_bytes integer := pg_column_size(old.data);
begin
  if new.data is not distinct from old.data then
    return new;
  end if;
  if old_bytes < 64 then
    if old.data = '{}'::jsonb then
      return new;
    end if;
  end if;
  if exists (
       select 1 from public.whiteboard_snapshots s
       where s.whiteboard_id = old.id and s.created_at > now() - interval '10 minutes'
     )
     and not (old_bytes >= 16384 and pg_column_size(new.data) * 2 < old_bytes) then
    return new;
  end if;

  insert into public.whiteboard_snapshots (whiteboard_id, user_id, version, data)
  values (old.id, old.user_id, old.version, old.data)
  on conflict (whiteboard_id, version) do nothing;

  perform public.prune_whiteboard_snapshots(old.id);
  return new;
end;
$$;

revoke all on function public.whiteboards_record_snapshot() from public, anon, authenticated;

drop trigger if exists whiteboards_record_snapshot on public.whiteboards;
create trigger whiteboards_record_snapshot
  after update of data on public.whiteboards
  for each row execute function public.whiteboards_record_snapshot();

-- -----------------------------------------------------------------------------
-- 3. Only the trigger writes history
-- -----------------------------------------------------------------------------
drop policy if exists "snapshots: owner insert" on public.whiteboard_snapshots;
revoke all on public.whiteboard_snapshots from public, anon, authenticated;
grant select on public.whiteboard_snapshots to authenticated;
grant all on public.whiteboard_snapshots to service_role;

-- -----------------------------------------------------------------------------
-- 4. One-time prune of what the old rule stored
-- -----------------------------------------------------------------------------
do $$
declare
  b uuid;
  removed bigint := 0;
begin
  for b in select distinct whiteboard_id from public.whiteboard_snapshots loop
    removed := removed + public.prune_whiteboard_snapshots(b);
  end loop;
  raise notice 'snapshot retention: % history row(s) pruned', removed;
end;
$$;

notify pgrst, 'reload schema';
