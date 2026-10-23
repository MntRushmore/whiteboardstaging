-- =============================================================================
-- SAT mode v2: the mistake deck and the bank's teaching notes (2026-10-23, docs/SAT-V2.md).
-- Idempotent; additive to 20261022000000_sat_mode.sql, 20261022010000_sat_anonymous.sql and
-- 20261022020000_sat_anonymous_guard_grant.sql. LOCAL ONLY until the owner OKs production.
--
--   sat_questions      two new optional columns, both written only by the bank load
--                      (scripts/sat/upsert.ts) and passed through unchanged by GET /api/sat/next:
--                        nudge         rung 1 of Help me's ladder: one short question or pointer,
--                                      at most 120 characters, never the answer;
--                        common_wrong  spr only: 0–3 likely wrong grid-ins and the mistake behind
--                                      each ([{"answer":"-1/2","why":"…"}]).
--                      The other two notes live inside the existing jsonb: `choices[].why` (a wrong
--                      choice's mistake) and `solution.desmos_steps`. Lengths are checked by the
--                      contract (src/lib/sat/contracts.ts); the database only checks the shape.
--   sat_reviews        the mistake deck, one row per (student, question). A miss schedules the
--                      question for tomorrow (step 1); getting it right when it is due moves it to
--                      step 2, due 3 days later; right again when that is due clears it
--                      (`cleared_at`). A miss on a review goes back to step 1. Days are the
--                      student's own (POST /api/sat/attempts computes `due_on` from their `tz`).
--                      Owner-only: select, insert, update (the schedule's columns only) and delete
--                      their own rows. Written by POST /api/sat/attempts with the student's own token.
--                      At most one row per live question per student (the primary key), so the
--                      table cannot grow past the bank.
--
-- Anonymous SAT sessions: anonymous_request_guard() (the PostgREST pre-request check) is replaced to
-- add `/sat_reviews` to what an anonymous token may write; nothing else about it changes.
--
-- Objects:
--   columns     sat_questions.nudge, sat_questions.common_wrong (+ checks sat_questions_nudge_len,
--               sat_questions_common_wrong_shape)
--   tables      sat_reviews
--   indexes     sat_reviews_due_idx
--   functions   sat_reviews_touch() [trigger]; anonymous_request_guard() (replaced)
--   policies    "sat_reviews: owner select" / "owner insert" / "owner update" / "owner delete"
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. sat_questions: the nudge and the common wrong grid-ins
-- -----------------------------------------------------------------------------
alter table public.sat_questions add column if not exists nudge text;
alter table public.sat_questions add column if not exists common_wrong jsonb;

alter table public.sat_questions drop constraint if exists sat_questions_nudge_len;
alter table public.sat_questions add constraint sat_questions_nudge_len
  check (nudge is null or char_length(nudge) between 1 and 120);

alter table public.sat_questions drop constraint if exists sat_questions_common_wrong_shape;
alter table public.sat_questions add constraint sat_questions_common_wrong_shape
  check (common_wrong is null or (format = 'spr' and jsonb_typeof(common_wrong) = 'array' and jsonb_array_length(common_wrong) <= 3));

-- -----------------------------------------------------------------------------
-- 2. sat_reviews: the mistake deck
-- -----------------------------------------------------------------------------
create table if not exists public.sat_reviews (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  question_id  text        not null references public.sat_questions (id),
  -- the student's own date the question is next due
  due_on       date        not null,
  -- 1 = the 1-day review, 2 = the 3-day review
  step         smallint    not null default 1,
  -- set when the 3-day review is answered right; a later miss schedules it again
  cleared_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, question_id),
  constraint sat_reviews_step_known check (step in (1, 2))
);

-- "what is due for this student today" (GET /api/sat/next, GET /api/sat/progress)
create index if not exists sat_reviews_due_idx on public.sat_reviews (user_id, due_on) where cleared_at is null;

alter table public.sat_reviews enable row level security;
revoke all on public.sat_reviews from public, anon, authenticated;
grant select, delete on public.sat_reviews to authenticated;
-- the columns the route writes; the owner and the question of a row never change
grant insert (user_id, question_id, due_on, step, cleared_at) on public.sat_reviews to authenticated;
grant update (due_on, step, cleared_at) on public.sat_reviews to authenticated;
grant all on public.sat_reviews to service_role;

drop policy if exists "sat_reviews: owner select" on public.sat_reviews;
create policy "sat_reviews: owner select"
  on public.sat_reviews for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "sat_reviews: owner insert" on public.sat_reviews;
create policy "sat_reviews: owner insert"
  on public.sat_reviews for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "sat_reviews: owner update" on public.sat_reviews;
create policy "sat_reviews: owner update"
  on public.sat_reviews for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "sat_reviews: owner delete" on public.sat_reviews;
create policy "sat_reviews: owner delete"
  on public.sat_reviews for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.sat_reviews_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.sat_reviews_touch() from public, anon, authenticated;

drop trigger if exists sat_reviews_touch on public.sat_reviews;
create trigger sat_reviews_touch
  before update on public.sat_reviews
  for each row execute function public.sat_reviews_touch();

-- -----------------------------------------------------------------------------
-- 3. Anonymous SAT sessions may write their mistake deck
-- -----------------------------------------------------------------------------
-- As 20261022010000_sat_anonymous.sql, with `/sat_reviews` added to the write allow-list.
create or replace function public.anonymous_request_guard()
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_method text := upper(coalesce(current_setting('request.method', true), ''));
  v_path text := coalesce(current_setting('request.path', true), '');
begin
  if not public.jwt_is_anonymous() then
    return;
  end if;
  -- reads: RLS already keeps them to the user's own rows (and live SAT questions)
  if v_method in ('GET', 'HEAD', 'OPTIONS') and v_path not like '/rpc/%' then
    return;
  end if;
  if v_path in (
    '/sat_attempts', '/sat_reviews', '/whiteboards', '/board_assets', '/user_settings',
    '/rpc/rate_limit_hit', '/rpc/rate_limit_spend', '/rpc/sat_tutor_access', '/rpc/sat_tutor_spend',
    '/rpc/delete_own_account'
  ) then
    return;
  end if;
  raise sqlstate 'PT403' using message = 'This needs an account: SAT practice is all that works without one.', hint = 'anonymous';
end;
$$;
revoke all on function public.anonymous_request_guard() from public, anon;
grant execute on function public.anonymous_request_guard() to anon, authenticated, service_role;
-- (20261022020000: the guard runs as the request's role, anon included)
grant execute on function public.jwt_is_anonymous() to anon;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
