-- =============================================================================
-- Learning record (2026-10-04). Idempotent; additive (nothing else changes).
--
-- One row per problem a student works on a board: what the problem was, the skill it practises,
-- how it went, the mistakes seen, the help used and the time spent. It is the `AttemptRecord` of
-- src/lib/learning/contracts.ts in snake_case. The board's attempt tracker writes it through
-- src/lib/learning/store.ts with the student's own JWT, upserting by `id` as the attempt goes on,
-- so a row is always the attempt's latest state. The Progress page and the tutor's learner hint
-- read it back (own rows, the last 120 days). There are no parent accounts: a parent looks at the
-- Progress page on the child's account.
--
-- Who may do what. RLS on; anon has nothing. `authenticated` may select, insert, update and delete
-- its own rows only. A write must also point only at the writer's own things: `board_id` null or a
-- board they own (like board_assets, 20260917000000_rls_hardening.sql), and `parent_id` null or one
-- of their own attempts. The owner and the id never change: `user_id` has no update grant, and the
-- trigger refuses a changed `id` (the id keeps its update grant only because PostgREST's upsert
-- writes `SET id = EXCLUDED.id`, which is the same value). `created_at` and `updated_at` have no
-- grant either: the trigger stamps both with the server's clock.
--
-- Ids come from the board (uuid v4, made when the attempt starts), so `id` has no default. The
-- board can then refer to an attempt before it has been saved: "Now you try" links its problem to
-- the attempt it follows (`parent_id`).
--
-- Lists and formats. `skill` is a format, not a list (lower-case snake_case, as SKILLS in
-- contracts.ts names them), for the same reason as profiles.terms_version
-- (20261003010000_signup_consent.sql): adding a skill is then a code change only. The other value
-- sets are lists, each a copy of the code's: `course` of COURSE_IDS (profiles_course_known), `origin`
-- of ATTEMPT_ORIGINS, `outcome` of OUTCOMES, and the keys of `mistakes` of MISTAKE_KINDS
-- (src/lib/learning/hint.ts). A new value in one of those needs a migration that replaces the
-- constraint (or learning_mistakes_valid()), applied BEFORE the code that writes it; until then
-- such a row is refused (23514), and the store reports it as "invalid".
--
-- Times. `started_at` and `finished_at` are the device's clock. A value before 2026-01-01 is
-- refused by a check, and one more than a day ahead of the server by the trigger: "a day from now"
-- moves, and a CHECK constraint is assumed to give the same answer for the same row forever.
--
-- Size. Each count is a smallint (the tracker clamps to LEARNING_LIMITS.maxCount), active time is
-- at most 4 hours (LEARNING_LIMITS.maxActiveMs), the problem at most 500 characters, `mistakes` at
-- most 512 bytes. Each account holds at most 100,000 attempts (learning_attempts_enforce_cap()):
-- 6 years of a student doing 40 problems every day. It is there to stop a runaway client or an
-- abuser from filling the database, not to limit students. It is checked once per INSERT statement,
-- for the accounts it inserted rows for, by counting that account's index entries up to the cap
-- (an upsert that only updates counts nothing). Past the cap a new attempt is refused (23514,
-- hint learning_attempts_cap) and updates of existing ones still work.
--
-- Deletion. A row goes with its account (ON DELETE CASCADE from auth.users, so delete_own_account()
-- and the dashboard both take it; there is no delete guard). Deleting a board keeps its attempts
-- with `board_id` set null (the student's progress is not the board), and deleting an attempt
-- leaves the attempts that followed it with `parent_id` null. Both foreign keys have an index, so
-- deleting a board or an account never scans the whole table.
--
-- Personal data: a child's maths problems and how they went. Never sold, never used to train
-- models (the Privacy Policy, src/app/(platform)/privacy/page.tsx, says so).
--
-- Deploy order: any time, before or after the code. Without the table the store answers
-- "unavailable": the board records nothing and the Progress page shows an empty record.
--
-- Supabase's default privileges grant ALL on every new public table and function to anon,
-- authenticated and service_role, so each object revokes first and grants exactly what is used.
--
-- Objects:
--   table       learning_attempts
--   constraints learning_attempts_problem_len, learning_attempts_skill_format,
--               learning_attempts_course_known, learning_attempts_origin_known,
--               learning_attempts_outcome_known, learning_attempts_counts_range,
--               learning_attempts_mistakes_valid, learning_attempts_active_ms_range,
--               learning_attempts_started_at_min, learning_attempts_finished_at_min,
--               learning_attempts_not_own_parent
--   indexes     learning_attempts_user_started_idx (user_id, started_at desc),
--               learning_attempts_board_idx (board_id, partial),
--               learning_attempts_parent_idx (parent_id, partial)
--   functions   learning_mistakes_valid(jsonb) [immutable, used by the check],
--               learning_attempt_is_own(uuid) [security definer, used by the write policies],
--               learning_attempts_before_write() [trigger], learning_attempts_enforce_cap() [trigger]
--   triggers    learning_attempts_before_write (BEFORE INSERT OR UPDATE, each row),
--               learning_attempts_cap (AFTER INSERT, each statement)
--   policies    "learning_attempts: owner select" / "owner insert" / "owner update" / "owner delete"
--   grants      authenticated: select, delete; insert and update on the columns the store writes
--               (insert also user_id, update never); service_role: all
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The mistakes check: an object of MISTAKE_KINDS -> whole counts 0..9999
-- -----------------------------------------------------------------------------
-- A function because a CHECK cannot hold a subquery over jsonb_each. Immutable: it reads nothing
-- but its argument. The value must be a plain integer literal ("3", never "3.0" or "3e0"), as
-- JSON.stringify writes one, and the whole object at most 512 bytes of text (the 11 kinds at 9999
-- each are about 230).
create or replace function public.learning_mistakes_valid(p_mistakes jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  v jsonb;
begin
  if p_mistakes is null or jsonb_typeof(p_mistakes) is distinct from 'object' or octet_length(p_mistakes::text) > 512 then
    return false;
  end if;
  for k, v in select e.key, e.value from jsonb_each(p_mistakes) e loop
    if k not in ('sign', 'arithmetic', 'distribution', 'both_sides', 'combining_terms', 'inverse_operation',
                 'fractions', 'exponents', 'algebra', 'units', 'concept')
       or jsonb_typeof(v) <> 'number'
       or v::text !~ '^(0|[1-9][0-9]{0,3})$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
-- A CHECK runs its function with the writer's privileges, so the writers need EXECUTE. It is pure
-- and reveals nothing, so being callable as an RPC is harmless.
revoke all on function public.learning_mistakes_valid(jsonb) from public, anon, authenticated;
grant execute on function public.learning_mistakes_valid(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. The table
-- -----------------------------------------------------------------------------
create table if not exists public.learning_attempts (
  id                uuid        primary key,
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  board_id          uuid        references public.whiteboards (id) on delete set null,
  problem_latex     text        not null,
  skill             text        not null,
  course            text,
  origin            text        not null,
  parent_id         uuid        references public.learning_attempts (id) on delete set null,
  outcome           text        not null,
  lines_written     smallint    not null default 0,
  lines_right       smallint    not null default 0,
  lines_ringed      smallint    not null default 0,
  hints             smallint    not null default 0,
  tutor_steps       smallint    not null default 0,
  solves            smallint    not null default 0,
  asks              smallint    not null default 0,
  mistakes          jsonb       not null default '{}'::jsonb,
  active_ms         integer     not null default 0,
  started_at        timestamptz not null,
  finished_at       timestamptz,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint learning_attempts_problem_len check (char_length(problem_latex) between 1 and 500),
  constraint learning_attempts_skill_format check (skill ~ '^[a-z0-9_]{1,40}$'),
  constraint learning_attempts_course_known
    check (course is null or course in ('algebra1', 'geometry', 'algebra2', 'precalc_calc', 'other')),
  constraint learning_attempts_origin_known
    check (origin in ('student', 'tutor_problem', 'starter', 'now_you_try', 'practice', 'teach')),
  constraint learning_attempts_outcome_known
    check (outcome in ('in_progress', 'first_try', 'self_corrected', 'with_help', 'tutor_solved', 'unfinished')),
  constraint learning_attempts_counts_range check (
    lines_written between 0 and 32767 and lines_right between 0 and 32767 and lines_ringed between 0 and 32767
    and hints between 0 and 32767 and tutor_steps between 0 and 32767 and solves between 0 and 32767
    and asks between 0 and 32767
  ),
  constraint learning_attempts_mistakes_valid check (public.learning_mistakes_valid(mistakes)),
  constraint learning_attempts_active_ms_range check (active_ms between 0 and 14400000),
  constraint learning_attempts_started_at_min check (started_at >= timestamptz '2026-01-01 00:00:00+00'),
  constraint learning_attempts_finished_at_min
    check (finished_at is null or finished_at >= timestamptz '2026-01-01 00:00:00+00'),
  constraint learning_attempts_not_own_parent check (parent_id is null or parent_id <> id)
);

-- The Progress page's and the learner hint's read: own rows, newest first, the last 120 days.
create index if not exists learning_attempts_user_started_idx on public.learning_attempts (user_id, started_at desc);
-- The foreign keys' ON DELETE SET NULL looks rows up by these: without them, deleting one board (or
-- one attempt, as an account's deletion does thousands of times) would scan the whole table.
create index if not exists learning_attempts_board_idx on public.learning_attempts (board_id) where board_id is not null;
create index if not exists learning_attempts_parent_idx on public.learning_attempts (parent_id) where parent_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Server time, a fixed owner and id, and no start time from the future
-- -----------------------------------------------------------------------------
create or replace function public.learning_attempts_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- user_id has no update grant; this also holds for the service role.
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
      raise exception 'a learning attempt''s id and owner never change'
        using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();

  -- Checked on insert and when the value changes, never on an unrelated update of an old row.
  if new.started_at > now() + interval '1 day'
     and (tg_op = 'INSERT' or new.started_at is distinct from old.started_at) then
    raise exception 'learning_attempts.started_at is more than a day in the future (%)', new.started_at
      using errcode = '23514', constraint = 'learning_attempts_started_at_max',
            hint = 'The device clock is probably wrong.';
  end if;
  if new.finished_at is not null and new.finished_at > now() + interval '1 day'
     and (tg_op = 'INSERT' or new.finished_at is distinct from old.finished_at) then
    raise exception 'learning_attempts.finished_at is more than a day in the future (%)', new.finished_at
      using errcode = '23514', constraint = 'learning_attempts_finished_at_max',
            hint = 'The device clock is probably wrong.';
  end if;
  return new;
end;
$$;
-- Triggers fire whatever the caller's EXECUTE privilege; nobody calls these directly.
revoke all on function public.learning_attempts_before_write() from public, anon, authenticated;

drop trigger if exists learning_attempts_before_write on public.learning_attempts;
create trigger learning_attempts_before_write
  before insert or update on public.learning_attempts
  for each row execute function public.learning_attempts_before_write();

-- -----------------------------------------------------------------------------
-- 4. At most 100,000 attempts per account
-- -----------------------------------------------------------------------------
-- Security invoker: a user's own rows are all RLS lets it count, and they are the only rows it can
-- insert. The count stops at the cap + 1 and walks only that account's index entries.
create or replace function public.learning_attempts_enforce_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c_cap constant integer := 100000;
  v_user uuid;
begin
  for v_user in select distinct n.user_id from new_attempts n loop
    if (select count(*) from (select 1 from public.learning_attempts a where a.user_id = v_user limit c_cap + 1) s) > c_cap then
      raise exception 'this account''s learning record is full (at most % attempts)', c_cap
        using errcode = '23514', hint = 'learning_attempts_cap';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.learning_attempts_enforce_cap() from public, anon, authenticated;

drop trigger if exists learning_attempts_cap on public.learning_attempts;
create trigger learning_attempts_cap
  after insert on public.learning_attempts
  referencing new table as new_attempts
  for each statement execute function public.learning_attempts_enforce_cap();

-- -----------------------------------------------------------------------------
-- 5. Row Level Security: own rows, pointing only at own boards and own attempts
-- -----------------------------------------------------------------------------
alter table public.learning_attempts enable row level security;

-- Is this attempt the caller's? The write policies ask it about `parent_id`. A policy cannot read
-- its own table in a subquery (Postgres refuses: "infinite recursion detected in policy"), so this
-- runs as the table's owner, past RLS, and answers only about the caller's own rows: it tells a
-- user nothing about anyone else's. Stable, so it sees the rows as they were when the statement
-- began: a parent and its child in ONE insert fail, and the store writes parents first.
create or replace function public.learning_attempt_is_own(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.learning_attempts a where a.id = p_id and a.user_id = auth.uid());
$$;
-- A policy runs its functions with the writer's privileges, so the writers need EXECUTE.
revoke all on function public.learning_attempt_is_own(uuid) from public, anon, authenticated;
grant execute on function public.learning_attempt_is_own(uuid) to authenticated, service_role;

-- The write policies qualify the row's own columns with the table name, so a subquery's columns
-- never shadow them.
drop policy if exists "learning_attempts: owner select" on public.learning_attempts;
create policy "learning_attempts: owner select"
  on public.learning_attempts for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "learning_attempts: owner insert" on public.learning_attempts;
create policy "learning_attempts: owner insert"
  on public.learning_attempts for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (learning_attempts.board_id is null
         or exists (select 1 from public.whiteboards w
                    where w.id = learning_attempts.board_id and w.user_id = (select auth.uid())))
    and (learning_attempts.parent_id is null or public.learning_attempt_is_own(learning_attempts.parent_id))
  );

drop policy if exists "learning_attempts: owner update" on public.learning_attempts;
create policy "learning_attempts: owner update"
  on public.learning_attempts for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (learning_attempts.board_id is null
         or exists (select 1 from public.whiteboards w
                    where w.id = learning_attempts.board_id and w.user_id = (select auth.uid())))
    and (learning_attempts.parent_id is null or public.learning_attempt_is_own(learning_attempts.parent_id))
  );

drop policy if exists "learning_attempts: owner delete" on public.learning_attempts;
create policy "learning_attempts: owner delete"
  on public.learning_attempts for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 6. Privileges: anon nothing; authenticated exactly what the store uses
-- -----------------------------------------------------------------------------
revoke all on public.learning_attempts from public, anon, authenticated;
grant select, delete on public.learning_attempts to authenticated;
grant insert (
  id, user_id, board_id, problem_latex, skill, course, origin, parent_id, outcome,
  lines_written, lines_right, lines_ringed, hints, tutor_steps, solves, asks,
  mistakes, active_ms, started_at, finished_at
) on public.learning_attempts to authenticated;
grant update (
  id, board_id, problem_latex, skill, course, origin, parent_id, outcome,
  lines_written, lines_right, lines_ringed, hints, tutor_steps, solves, asks,
  mistakes, active_ms, started_at, finished_at
) on public.learning_attempts to authenticated;
grant all on public.learning_attempts to service_role;

notify pgrst, 'reload schema';
