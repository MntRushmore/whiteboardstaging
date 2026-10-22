-- =============================================================================
-- SAT mode (2026-10-22, docs/SAT-MODE.md). Idempotent; additive (nothing else changes).
-- LOCAL ONLY until the owner OKs production.
--
-- The iPad's SAT practice: our own bank of original SAT-style math questions, each student's
-- answers, and the free tutor's daily passes. Free forever: questions, the board, the answer check
-- and the written solution. The live tutor is free for SAT_FREE_TUTOR_PER_DAY questions a day
-- (default 5, src/lib/env.ts); Agathon Unlimited lifts the cap.
--
-- Profiles. A profile in this app is its own auth user (a kid profile is a server-made account,
-- 20261009010000_family_plan.sql), so `profile_id` is the signed-in account, `auth.uid()`, as
-- `user_id` is everywhere else. sat_attempts carries both, as the contract names them, and both
-- are the caller: `user_id` is the row's owner for RLS, `profile_id` who answered. The plan is read
-- through has_unlimited(), which already follows a kid to their grown-up's plan.
--
--   sat_questions      the bank. `id` `<domain>-<skill-slug>-<nnnn>`, stable forever. Loaded only by
--                      the service role (scripts/sat/upsert.ts); signed-in users read `live` rows
--                      only. `draft` (failed a check) and `retired` rows are never seen by the app.
--                      Questions are retired, never deleted: an answered question is referenced by
--                      sat_attempts (no cascade, so a delete that would lose a student's record fails).
--   sat_attempts       one row per answer a student checks. Owner-only: select, insert and delete
--                      their own rows; no update. Written by POST /api/sat/attempts with the
--                      student's own token, which recomputes `correct` from the bank's answer.
--                      At most 2,000 a day per account (sat_attempts_enforce_cap): far beyond a
--                      student, there to stop a runaway client.
--   sat_tutor_passes   one row per free tutor question used on a day, `(profile_id, question_id,
--                      day)`. `day` is the student's own date (the client sends its time zone).
--                      Owner select only; written by sat_take_tutor_pass() (service role).
--
-- Functions:
--   sat_take_tutor_pass(profile, question, day, cap)  service role only (POST /api/sat/tutor). One
--                      transaction under a per-profile advisory lock, so parallel calls cannot pass
--                      the cap: the same question on the same day is already allowed (idempotent,
--                      no second pass); otherwise Unlimited, or fewer than `cap` passes that day,
--                      takes one. Answers {allowed, used_today, cap, unlimited}. The cap is an
--                      argument because it is an env var on the server; a user cannot call this.
--   sat_tutor_access()  authenticated, read-only, about the caller only: {unlimited, remaining}
--                      (GET /api/sat/progress's `today.unlimited`). `remaining` is the ink the caller
--                      would spend (a kid's is their grown-up's).
--   sat_tutor_spend(question, units)  authenticated, about the caller only. The live routes call it
--                      when a request carries `sat_question_id` (enforceInk, src/lib/server/billing.ts):
--                      {unlimited, allowed, reason, remaining}. Unlimited: nothing is written and the
--                      route charges consume_credits as usual (no ink, the fair-use count). Otherwise
--                      the call is allowed, spending no ink, only when the caller has a pass for that
--                      question "today" and the pass has room for `units` more: one pass lets through
--                      at most 200 ink-priced units of live calls (a question worked hard takes well
--                      under 100), so a pass cannot be stretched into a free day of tutoring on other
--                      boards. "Today" is a pass whose day is today somewhere on Earth right now
--                      (UTC-12 .. UTC+14), because the live calls send no time zone: at most a day's
--                      slack, for a question already passed. Refusals: `no_pass`, `pass_used_up`.
--                      A user can only ever add to their own pass's count.
--
-- Supabase's default privileges grant ALL on every new public table and function to anon,
-- authenticated and service_role, so each object revokes first and grants exactly what is used.
--
-- Objects:
--   tables      sat_questions, sat_attempts, sat_tutor_passes
--   indexes     sat_questions_pick_idx, sat_attempts_user_created_idx,
--               sat_attempts_question_idx, sat_tutor_passes_day_idx
--   functions   sat_attempts_enforce_cap() [trigger], sat_take_tutor_pass(uuid, text, date, int),
--               sat_tutor_access(), sat_tutor_spend(text, int)
--   policies    "sat_questions: read live", "sat_attempts: owner select" / "owner insert" /
--               "owner delete", "sat_tutor_passes: owner select"
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. sat_questions
-- -----------------------------------------------------------------------------
create table if not exists public.sat_questions (
  id          text        primary key,
  domain      text        not null,
  skill       text        not null,
  difficulty  smallint    not null,
  format      text        not null,
  stem        text        not null,
  figure      jsonb,
  choices     jsonb,
  answer      jsonb       not null,
  solution    jsonb       not null,
  status      text        not null default 'draft',
  version     integer     not null default 1,
  created_at  timestamptz not null default now(),
  constraint sat_questions_id_format check (id ~ '^(algebra|advanced_math|psda|geometry_trig)-[a-z0-9]+(-[a-z0-9]+)*-[0-9]{4}$'),
  constraint sat_questions_id_domain check (split_part(id, '-', 1) = domain),
  -- the skills of docs/SAT-MODE.md, exactly as written there (SAT_SKILLS in src/lib/sat/contracts.ts)
  constraint sat_questions_skill_known check ((domain, skill) in (
    ('algebra', 'linear equations in one variable'),
    ('algebra', 'linear equations in two variables'),
    ('algebra', 'linear functions'),
    ('algebra', 'systems of two linear equations'),
    ('algebra', 'linear inequalities'),
    ('advanced_math', 'equivalent expressions'),
    ('advanced_math', 'nonlinear equations and systems'),
    ('advanced_math', 'nonlinear functions'),
    ('psda', 'ratios, rates, proportions, units'),
    ('psda', 'percentages'),
    ('psda', 'one-variable data (distributions, centre, spread)'),
    ('psda', 'two-variable data (models, scatterplots)'),
    ('psda', 'probability'),
    ('psda', 'inference from samples and margin of error'),
    ('psda', 'evaluating statistical claims'),
    ('geometry_trig', 'area and volume'),
    ('geometry_trig', 'lines, angles, triangles'),
    ('geometry_trig', 'right triangles and trigonometry'),
    ('geometry_trig', 'circles')
  )),
  constraint sat_questions_difficulty_range check (difficulty between 1 and 3),
  constraint sat_questions_status_known check (status in ('live', 'draft', 'retired')),
  constraint sat_questions_version_min check (version >= 1),
  constraint sat_questions_stem_len check (char_length(stem) between 1 and 4000),
  constraint sat_questions_figure_shape check (
    figure is null or (jsonb_typeof(figure) = 'object' and figure ->> 'kind' in ('table', 'plot', 'shape') and octet_length(figure::text) <= 16384)
  ),
  constraint sat_questions_solution_shape check (
    jsonb_typeof(solution) = 'object' and jsonb_typeof(solution -> 'steps') = 'array'
    and jsonb_array_length(solution -> 'steps') between 1 and 8
  ),
  -- mcq: four choices and one key among them; spr: no choices, at least one accepted form
  constraint sat_questions_format_shape check (
    (format = 'mcq' and jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) = 4
       and answer ->> 'key' in ('A', 'B', 'C', 'D'))
    or (format = 'spr' and choices is null and jsonb_typeof(answer -> 'accepted') = 'array'
       and jsonb_array_length(answer -> 'accepted') between 1 and 12)
  )
);

-- GET /api/sat/next reads the live bank's metadata by domain / skill / difficulty
create index if not exists sat_questions_pick_idx on public.sat_questions (status, domain, skill, difficulty);

alter table public.sat_questions enable row level security;
revoke all on public.sat_questions from public, anon, authenticated;
grant select on public.sat_questions to authenticated;
grant all on public.sat_questions to service_role;

drop policy if exists "sat_questions: read live" on public.sat_questions;
create policy "sat_questions: read live"
  on public.sat_questions for select to authenticated
  using (status = 'live');

-- -----------------------------------------------------------------------------
-- 2. sat_attempts
-- -----------------------------------------------------------------------------
create table if not exists public.sat_attempts (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  question_id  text        not null references public.sat_questions (id),
  chosen       text        not null,
  correct      boolean     not null,
  used_tutor   boolean     not null default false,
  seconds      integer     not null default 0,
  created_at   timestamptz not null default now(),
  constraint sat_attempts_chosen_len check (char_length(chosen) between 1 and 12),
  constraint sat_attempts_seconds_range check (seconds between 0 and 86400),
  constraint sat_attempts_profile_is_user check (profile_id = user_id)
);

create index if not exists sat_attempts_user_created_idx on public.sat_attempts (user_id, created_at desc);
create index if not exists sat_attempts_question_idx on public.sat_attempts (question_id);

alter table public.sat_attempts enable row level security;
revoke all on public.sat_attempts from public, anon, authenticated;
grant select, delete on public.sat_attempts to authenticated;
-- the columns the route writes; `id` and `created_at` are the server's
grant insert (user_id, profile_id, question_id, chosen, correct, used_tutor, seconds) on public.sat_attempts to authenticated;
grant all on public.sat_attempts to service_role;

drop policy if exists "sat_attempts: owner select" on public.sat_attempts;
create policy "sat_attempts: owner select"
  on public.sat_attempts for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "sat_attempts: owner insert" on public.sat_attempts;
create policy "sat_attempts: owner insert"
  on public.sat_attempts for insert to authenticated
  with check (user_id = auth.uid() and profile_id = auth.uid());

drop policy if exists "sat_attempts: owner delete" on public.sat_attempts;
create policy "sat_attempts: owner delete"
  on public.sat_attempts for delete to authenticated
  using (user_id = auth.uid());

-- At most 2,000 answers a day per account, counted on the index (user_id, created_at).
create or replace function public.sat_attempts_enforce_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from (
        select 1 from public.sat_attempts a
        where a.user_id = new.user_id and a.created_at > now() - interval '24 hours'
        limit 2001) c) >= 2000 then
    raise exception 'too many SAT answers today' using errcode = '23514', hint = 'sat_attempts_cap';
  end if;
  return new;
end;
$$;
revoke all on function public.sat_attempts_enforce_cap() from public, anon, authenticated;

drop trigger if exists sat_attempts_cap on public.sat_attempts;
create trigger sat_attempts_cap
  before insert on public.sat_attempts
  for each row execute function public.sat_attempts_enforce_cap();

-- -----------------------------------------------------------------------------
-- 3. sat_tutor_passes
-- -----------------------------------------------------------------------------
create table if not exists public.sat_tutor_passes (
  profile_id   uuid        not null references auth.users (id) on delete cascade,
  question_id  text        not null references public.sat_questions (id),
  day          date        not null,
  -- the ink-priced live calls this pass has let through (sat_tutor_spend; at most 200)
  units        integer     not null default 0,
  created_at   timestamptz not null default now(),
  primary key (profile_id, question_id, day),
  constraint sat_tutor_passes_units_range check (units between 0 and 100000)
);
alter table public.sat_tutor_passes add column if not exists units integer not null default 0;

-- "how many passes did this profile use on this day"
create index if not exists sat_tutor_passes_day_idx on public.sat_tutor_passes (profile_id, day);

alter table public.sat_tutor_passes enable row level security;
revoke all on public.sat_tutor_passes from public, anon, authenticated;
grant select on public.sat_tutor_passes to authenticated;
grant all on public.sat_tutor_passes to service_role;

drop policy if exists "sat_tutor_passes: owner select" on public.sat_tutor_passes;
create policy "sat_tutor_passes: owner select"
  on public.sat_tutor_passes for select to authenticated
  using (profile_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 4. sat_take_tutor_pass (service role: POST /api/sat/tutor)
-- -----------------------------------------------------------------------------
create or replace function public.sat_take_tutor_pass(
  p_profile_id  uuid,
  p_question_id text,
  p_day         date,
  p_cap         integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_unlimited boolean;
  v_used integer;
  v_allowed boolean;
begin
  if p_profile_id is null then
    raise exception 'profile required' using errcode = '22023';
  end if;
  if p_cap is null or p_cap < 0 or p_cap > 1000 then
    raise exception 'cap out of range' using errcode = '22023';
  end if;
  -- the student's own date: within a day of the server's (UTC-12 .. UTC+14)
  if p_day is null or p_day < current_date - 1 or p_day > current_date + 1 then
    raise exception 'day out of range' using errcode = '22023';
  end if;
  if not exists (select 1 from public.sat_questions q where q.id = p_question_id and q.status = 'live') then
    raise exception 'question not found' using errcode = 'P0002';
  end if;

  -- one profile's passes are taken one at a time, so the cap holds under parallel calls
  perform pg_advisory_xact_lock(hashtextextended('sat_tutor_pass:' || p_profile_id::text, 0));

  v_unlimited := coalesce(public.has_unlimited(p_profile_id), false);

  if exists (select 1 from public.sat_tutor_passes t
             where t.profile_id = p_profile_id and t.question_id = p_question_id and t.day = p_day) then
    v_allowed := true;
  else
    select count(*)::integer into v_used
    from public.sat_tutor_passes t where t.profile_id = p_profile_id and t.day = p_day;
    v_allowed := v_unlimited or v_used < p_cap;
    if v_allowed then
      insert into public.sat_tutor_passes (profile_id, question_id, day)
      values (p_profile_id, p_question_id, p_day)
      on conflict do nothing;
    end if;
  end if;

  select count(*)::integer into v_used
  from public.sat_tutor_passes t where t.profile_id = p_profile_id and t.day = p_day;

  return jsonb_build_object('allowed', v_allowed, 'used_today', v_used, 'cap', p_cap, 'unlimited', v_unlimited);
end;
$$;
revoke all on function public.sat_take_tutor_pass(uuid, text, date, integer) from public, anon, authenticated;
grant execute on function public.sat_take_tutor_pass(uuid, text, date, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 5. sat_tutor_access (authenticated: GET /api/sat/progress)
-- -----------------------------------------------------------------------------
drop function if exists public.sat_tutor_access(text);
create or replace function public.sat_tutor_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_remaining integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select coalesce(pr.ink_balance, 0) into v_remaining
  from public.profiles pr where pr.user_id = public.plan_owner_of(v_uid);
  return jsonb_build_object('unlimited', coalesce(public.has_unlimited(v_uid), false), 'remaining', coalesce(v_remaining, 0));
end;
$$;
revoke all on function public.sat_tutor_access() from public, anon, authenticated;
grant execute on function public.sat_tutor_access() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. sat_tutor_spend (authenticated: the live routes' SAT gate)
-- -----------------------------------------------------------------------------
create or replace function public.sat_tutor_spend(p_question_id text, p_units integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_remaining integer;
  v_unlimited boolean;
  v_found boolean;
  v_spent boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_units is null or p_units < 1 or p_units > 1000 then
    raise exception 'p_units must be between 1 and 1000' using errcode = '22023';
  end if;
  select coalesce(pr.ink_balance, 0) into v_remaining
  from public.profiles pr where pr.user_id = public.plan_owner_of(v_uid);
  v_remaining := coalesce(v_remaining, 0);
  v_unlimited := coalesce(public.has_unlimited(v_uid), false);
  if v_unlimited then
    return jsonb_build_object('unlimited', true, 'allowed', true, 'reason', null, 'remaining', v_remaining);
  end if;

  -- today's pass for this question (today somewhere on Earth), with room for these units
  with today as (
    select t.ctid from public.sat_tutor_passes t
    where t.profile_id = v_uid and t.question_id = p_question_id
      and t.day between (now() at time zone 'Etc/GMT+12')::date and (now() at time zone 'Etc/GMT-14')::date
    order by t.day desc
    limit 1
    for update
  )
  update public.sat_tutor_passes t set units = t.units + p_units
  from today
  where t.ctid = today.ctid and t.units + p_units <= 200
  returning true into v_spent;

  if coalesce(v_spent, false) then
    return jsonb_build_object('unlimited', false, 'allowed', true, 'reason', null, 'remaining', v_remaining);
  end if;
  select exists (
    select 1 from public.sat_tutor_passes t
    where t.profile_id = v_uid and t.question_id = p_question_id
      and t.day between (now() at time zone 'Etc/GMT+12')::date and (now() at time zone 'Etc/GMT-14')::date
  ) into v_found;
  return jsonb_build_object('unlimited', false, 'allowed', false,
    'reason', case when v_found then 'pass_used_up' else 'no_pass' end, 'remaining', v_remaining);
end;
$$;
revoke all on function public.sat_tutor_spend(text, integer) from public, anon, authenticated;
grant execute on function public.sat_tutor_spend(text, integer) to authenticated, service_role;
