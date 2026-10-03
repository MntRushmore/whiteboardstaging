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
-- What that needs: the state right before a disaster, the state a session ended in, and something
-- from each of the last few days. So, per board:
--
-- Recording (AFTER UPDATE OF data, when data changed). The row is the current state; a history row
-- holds the state a write REPLACED (old.version, old.data), so nothing is stored twice and the state
-- a session ended in is kept when the next session starts. A history row is written when
--   * the write drops more than half of the board (stored size of new < half of old, old at least
--     16 KB): clearing the board, a mass erase, or a buggy or stale client overwriting it. The state
--     right before it is kept whatever the 10-minute rule says, marked reason = 'pre_drop'; or
--   * the board has no history row younger than 10 minutes (so: the first write of every session,
--     then at most one every 10 minutes while the student works), reason = 'interval'.
-- A brand-new board's empty '{}' is never kept. A failure here never fails the student's save: it
-- is logged as a warning and the save goes through without a history row.
--
-- Retention (prune_whiteboard_snapshots, run after each history row is written, i.e. at most a
-- few times an hour per board, and once below for everything already stored). "Newest" is by id
-- (insertion order), not version.
--   * Guaranteed: the newest 3 'pre_drop' copies of the last 7 days, outside the size budget (a
--     wiped board's previous state survives the saves that follow, however big it was).
--   * The rest compete: candidates are the newest 8 and the newest of each UTC day for the last 7
--     days. Taken in order of value (the newest; the newest of each earlier day, most recent first;
--     the rest, newest first) they are kept until they pass 4 MB of stored (compressed) size, but
--     the first 2 always stay: a heavy board keeps its latest state and the one it had the day
--     before rather than two states ten minutes apart. Everything else is deleted.
--
-- Size (stored, i.e. compressed; docs/QA-2026-10-02-reliability.md "Follow-ups" has the arithmetic).
-- Before: 20 copies of the board, whatever the use: 15 MB for a 0.74 MB board, 35 MB for 1.76 MB.
-- After: no more than 4 MB of ordinary history unless 2 copies already pass it (a 0.74 MB board
-- keeps up to 5, 3.7 MB; a 1.76 MB board 2, 3.5 MB; a 30 KB board up to 15, 0.45 MB; a board drawn
-- on for 20 minutes once, 2), plus up to 3 pre-wipe copies for a week after a board was wiped. And
-- one history write per 10 minutes of drawing instead of one per save (2-10 s).
--
-- Writers. Only this trigger: authenticated loses INSERT on whiteboard_snapshots (the client never
-- wrote it, and a user who could would hold an unbounded store of 8 MB rows, and could plant a row
-- dated in the future that stops their history from being recorded). Owners keep SELECT. Rows
-- users could plant until now (dated in the future, or a version the board never reached) are
-- deleted by the one-time pass.
--
-- Objects created or changed here:
--   columns    whiteboard_snapshots.reason ('interval' | 'pre_drop', default 'interval')
--   functions  whiteboards_record_snapshot() [trigger function, replaced; the trigger itself is
--              unchanged], prune_whiteboard_snapshots(uuid) [new]
--   grants     whiteboard_snapshots: INSERT revoked from authenticated (SELECT stays)
--   policies   "snapshots: owner insert" dropped
--   rows       existing history pruned to the retention above (one set-based pass)
--
-- Locks and runtime. The one-time prune runs FIRST, as plain DELETEs: they lock only the rows they
-- delete, so board loads and saves carry on (a save whose old trigger prunes the same rows waits
-- for this transaction). On a large table that is seconds to a few minutes. The DDL comes after
-- it and is kept small: the column (a constant default, so no table rewrite), the function bodies
-- (no table lock), the grants and the policy. The column and the policy need a brief exclusive
-- lock on whiteboard_snapshots, held until the commit right after them; during it, saves that
-- write history wait. lock_timeout (5 s) makes the migration fail rather than queue every save
-- behind a lock it cannot get; just run it again. Postgres reuses the freed space, but the
-- database's size on disk (what the free plan's 500 MB limit measures) only shrinks after
-- `vacuum (full, analyze) public.whiteboard_snapshots;`, run by hand afterwards (it cannot run
-- inside a migration, and it locks the table while it runs). docs/RUNBOOK-supabase.md, 10.1.
-- =============================================================================

set local lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. One-time prune of what the old rule stored (before any DDL)
-- -----------------------------------------------------------------------------
-- Rows a user could plant through the old INSERT grant: dated in the future, or a version the
-- board never reached (the trigger only ever recorded versions up to the board's own).
delete from public.whiteboard_snapshots s
where s.created_at > now() + interval '1 minute'
   or s.version > (select w.version from public.whiteboards w where w.id = s.whiteboard_id);

-- Every board at once: the newest 8 and each day's newest for 7 days, by value within 4 MB, at
-- least 2 (the old rule recorded no pre-drop copies, so none are guaranteed here). Only on the first
-- run: once the reason column exists the trigger keeps history pruned, and this pass would not
-- know to spare the pre-drop copies.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'whiteboard_snapshots' and column_name = 'reason'
  ) then
    return;
  end if;
with ranked as (
  select s.id,
         s.whiteboard_id,
         s.created_at,
         pg_column_size(s.data) as bytes,
         row_number() over (partition by s.whiteboard_id order by s.id desc) as rn,
         row_number() over (partition by s.whiteboard_id, (s.created_at at time zone 'utc')::date order by s.id desc) as day_rn
  from public.whiteboard_snapshots s
),
candidates as (
  select id,
         whiteboard_id,
         bytes,
         row_number() over (
           partition by whiteboard_id
           order by case when rn = 1 then 0 when day_rn = 1 and created_at >= now() - interval '7 days' then 1 else 2 end, rn
         ) as pri
  from ranked
  where rn <= 8 or (day_rn = 1 and created_at >= now() - interval '7 days')
),
kept as (
  select id
  from (select id, pri, sum(bytes) over (partition by whiteboard_id order by pri) as running from candidates) c
  where c.pri <= 2 or c.running <= 4194304
)
delete from public.whiteboard_snapshots s
where not exists (select 1 from kept k where k.id = s.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Why a copy was taken
-- -----------------------------------------------------------------------------
alter table public.whiteboard_snapshots
  add column if not exists reason text not null default 'interval';
alter table public.whiteboard_snapshots
  drop constraint if exists whiteboard_snapshots_reason;
alter table public.whiteboard_snapshots
  add constraint whiteboard_snapshots_reason check (reason in ('interval', 'pre_drop')) not valid;

-- -----------------------------------------------------------------------------
-- 3. Retention: what a board keeps
-- -----------------------------------------------------------------------------
create or replace function public.prune_whiteboard_snapshots(p_whiteboard_id uuid)
returns integer
language sql
security invoker
set search_path = public
as $$
  with board as (
    select s.id, s.created_at, s.reason, pg_column_size(s.data) as bytes
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

-- Never through the API for users; the trigger (as its owner) and operators (service role) only.
revoke all on function public.prune_whiteboard_snapshots(uuid) from public, anon, authenticated;
grant execute on function public.prune_whiteboard_snapshots(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Recording: which writes leave a history row (the trigger from the init migration calls it)
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
  why text;
begin
  if new.data is not distinct from old.data then
    return new;
  end if;
  if old_bytes < 64 then
    if old.data = '{}'::jsonb then
      return new;
    end if;
  end if;
  if old_bytes >= 16384 and pg_column_size(new.data) * 2 < old_bytes then
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
    insert into public.whiteboard_snapshots (whiteboard_id, user_id, version, data, reason)
    values (old.id, old.user_id, old.version, old.data, why)
    on conflict (whiteboard_id, version) do nothing;
    perform public.prune_whiteboard_snapshots(old.id);
  exception when others then
    raise warning 'whiteboards_record_snapshot: no history row for board % (version %): % (%)', old.id, old.version, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.whiteboards_record_snapshot() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Only the trigger writes history
-- -----------------------------------------------------------------------------
revoke all on public.whiteboard_snapshots from public, anon, authenticated;
grant select on public.whiteboard_snapshots to authenticated;
grant all on public.whiteboard_snapshots to service_role;
drop policy if exists "snapshots: owner insert" on public.whiteboard_snapshots;

notify pgrst, 'reload schema';
