-- =============================================================================
-- The Training Center (2026-10-20). Idempotent; additive (nothing else changes).
--
-- An admin-only area of the native iPad app where the owner brute-tests the tutor with real maths:
-- a bench (problems the app writes in a generated hand, at a kid's pace, through the real Live
-- routes) or the Pencil (his own handwriting). The Live calls themselves are the server's
-- (src/lib/server/training.ts: admins only, no ink); these two tables keep what the app learned.
--
--   training_runs   one row per bench or Pencil session: what it targeted (`target`, e.g. a grade
--                   and topic), the app build, its settings (`config`), how it went (`status`,
--                   `totals`), when it finished, a note.
--   training_cases  one row per problem tried in a run: the problem and what was expected, the
--                   lines written and their strokes, what the tutor read (`reads`), pass or fail, the
--                   calls made and how long they took (`calls`, `ms`), a snapshot of the page, and
--                   `regression` + `fixture`: a case the owner marks as one the app's tests must keep
--                   passing, its fixture pulled into the iOS test suite by
--                   `npm run training:fixtures` (scripts/training-fixtures.mjs).
--
-- Who may do what. Admins only (`public.admins`, 20261005000000_admin.sql), through their own token:
-- one policy per table, for every command, `using (is_admin())` and `with check (is_admin() and
-- created_by = auth.uid())`. So an admin reads, updates and deletes every admin's rows, and every
-- row an admin writes is their own. A signed-in student reads nothing and writes nothing; anon has
-- no privilege at all; the service role (the fixtures script) bypasses RLS. Two rules the policy
-- cannot state, kept by the trigger training_rows_guard():
--   - a case belongs to a run of its own owner (its run's created_by = its created_by), so a run's
--     cases are one admin's session, never mixed with another's;
--   - nobody's row changes hands: created_by never changes on update (with the policy, an admin
--     updates only their own rows; they may still delete anyone's).
-- A case's run is an admin's because the policy only ever let an admin write it. Removing someone
-- from admins hides their rows from them at once (is_admin() is false); the rows stay for the others.
--
-- Personal data. Admins' own handwriting only (strokes, page snapshots, what the tutor read of it)
-- and the problems they chose; never a student's or a kid's data: nothing here reads or links a
-- board, a profile or a family. created_by cascades: deleting an admin's account deletes their
-- runs and cases. No retention job: an admin deletes a run (its cases go with it) in the app.
--
-- Size. A case's strokes, reads, lines and fixture are capped at 2 MB each (pg_column_size), its
-- snapshot at 600,000 characters (a downscaled page image as base64 text), so a runaway client
-- cannot fill the database with one row.
--
-- Deploy order: before the iPad build that writes these tables. Until they exist the app keeps its
-- results on the iPad (a missing table answers 404 there), and nothing on the server reads them.
--
-- Supabase's default privileges grant ALL on every new public table and function to anon,
-- authenticated and service_role, so each object revokes first and grants exactly what is used.
--
-- Objects:
--   tables      training_runs, training_cases
--   constraints (inline) kind, status, target, app_build, note lengths; training_cases_*_size caps
--   indexes     training_runs_created_at_idx (created_at desc), training_runs_created_by_idx,
--               training_cases_run_idx (run_id, created_at), training_cases_regression_idx
--               (created_at desc, partial: regression), training_cases_created_by_idx
--   functions   training_rows_guard() [trigger]
--   triggers    training_runs_guard (BEFORE UPDATE OF created_by), training_cases_guard (BEFORE
--               INSERT OR UPDATE OF run_id, created_by), training_cases_set_updated_at
--   policies    "training_runs: admins", "training_cases: admins" (authenticated, for all)
--   grants      authenticated: select, insert, update, delete on both; service_role: all
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. training_runs: one bench or Pencil session
-- -----------------------------------------------------------------------------
create table if not exists public.training_runs (
  id          uuid        primary key default gen_random_uuid(),
  created_by  uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  finished_at timestamptz,
  kind        text        not null check (kind in ('bench', 'pencil')),
  -- `budget`: the run stopped because a budget ran out
  status     text        not null default 'running' check (status in ('running', 'done', 'stopped', 'budget', 'failed')),
  target      text        not null check (char_length(target) between 1 and 200),
  app_build   text        check (app_build is null or char_length(app_build) <= 80),
  config      jsonb       not null default '{}',
  totals      jsonb       not null default '{}',
  note        text        check (note is null or char_length(note) <= 2000)
);

-- The app's list of runs, newest first.
create index if not exists training_runs_created_at_idx on public.training_runs (created_at desc);
-- Deleting an account cascades here: without this, every account deletion scans the table.
create index if not exists training_runs_created_by_idx on public.training_runs (created_by);

-- -----------------------------------------------------------------------------
-- 2. training_cases: one problem tried in a run
-- -----------------------------------------------------------------------------
create table if not exists public.training_cases (
  id         uuid        primary key default gen_random_uuid(),
  run_id     uuid        not null references public.training_runs (id) on delete cascade,
  created_by uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind       text        not null check (kind in ('bench', 'pencil')),
  case_key   text        not null check (char_length(case_key) between 1 and 120),
  category   text        not null check (char_length(category) between 1 and 60),
  grade      text        check (grade is null or char_length(grade) <= 20),
  topic      text        check (topic is null or char_length(topic) <= 60),
  -- the hand it was written in (a generated hand's name, or the owner's own)
  hand       text        not null check (char_length(hand) between 1 and 60),
  problem    jsonb       not null default '[]',
  expected   jsonb       not null default '[]',
  lines      jsonb       not null default '[]',
  strokes    jsonb       not null default '[]',
  reads      jsonb       not null default '[]',
  -- null until judged
  pass       boolean,
  calls      jsonb       not null default '{}',
  ms         integer     check (ms is null or ms >= 0),
  snapshot   text        check (snapshot is null or char_length(snapshot) <= 600000),
  regression boolean     not null default false,
  fixture    jsonb,
  note       text        check (note is null or char_length(note) <= 2000),
  constraint training_cases_strokes_size check (pg_column_size(strokes) <= 2000000),
  constraint training_cases_reads_size check (pg_column_size(reads) <= 2000000),
  constraint training_cases_lines_size check (pg_column_size(lines) <= 2000000),
  constraint training_cases_fixture_size check (fixture is null or pg_column_size(fixture) <= 2000000)
);

-- A run's cases in the order they were tried.
create index if not exists training_cases_run_idx on public.training_cases (run_id, created_at);
-- The regression set (the fixtures script, the app's regression list), newest first.
create index if not exists training_cases_regression_idx on public.training_cases (created_at desc) where regression;
-- Deleting an account cascades here too.
create index if not exists training_cases_created_by_idx on public.training_cases (created_by);

-- -----------------------------------------------------------------------------
-- 3. The guard: a case is its run's owner's, and no row changes hands
-- -----------------------------------------------------------------------------
-- Security invoker on purpose: an admin sees every run (the policy below), so the run is found when
-- it exists; a non-admin sees none, and is refused here or by the policy either way. The service
-- role bypasses RLS and is held to the same rule.
create or replace function public.training_rows_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
    raise exception 'a training row keeps its owner (created_by cannot change)' using errcode = '42501';
  end if;
  if tg_table_name = 'training_cases' and not exists (
    select 1 from public.training_runs r where r.id = new.run_id and r.created_by = new.created_by
  ) then
    raise exception 'a training case belongs to a run of its own owner' using errcode = '23503';
  end if;
  return new;
end;
$$;
-- Trigger functions are never called through the API, and triggers fire regardless of EXECUTE.
revoke all on function public.training_rows_guard() from public, anon, authenticated;

drop trigger if exists training_runs_guard on public.training_runs;
create trigger training_runs_guard
  before update of created_by on public.training_runs
  for each row execute function public.training_rows_guard();

drop trigger if exists training_cases_guard on public.training_cases;
create trigger training_cases_guard
  before insert or update of run_id, created_by on public.training_cases
  for each row execute function public.training_rows_guard();

drop trigger if exists training_cases_set_updated_at on public.training_cases;
create trigger training_cases_set_updated_at
  before update on public.training_cases
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. RLS and grants: admins only, each writing as themselves
-- -----------------------------------------------------------------------------
alter table public.training_runs enable row level security;
alter table public.training_cases enable row level security;

drop policy if exists "training_runs: admins" on public.training_runs;
create policy "training_runs: admins"
  on public.training_runs for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()) and created_by = (select auth.uid()));

drop policy if exists "training_cases: admins" on public.training_cases;
create policy "training_cases: admins"
  on public.training_cases for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()) and created_by = (select auth.uid()));

revoke all on public.training_runs from public, anon, authenticated;
revoke all on public.training_cases from public, anon, authenticated;
grant select, insert, update, delete on public.training_runs to authenticated;
grant select, insert, update, delete on public.training_cases to authenticated;
grant all on public.training_runs to service_role;
grant all on public.training_cases to service_role;

-- PostgREST caches the schema; the new tables need a reload.
notify pgrst, 'reload schema';
