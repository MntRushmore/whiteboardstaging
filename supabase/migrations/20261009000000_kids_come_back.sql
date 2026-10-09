-- =============================================================================
-- Kids come back (2026-10-09). Idempotent; additive. docs/KIDS-COME-BACK.md has the plan.
--
-- Prod on 2026-10-08: most students practise primary-school arithmetic, few come back a second day,
-- and nobody knows where sign-ups come from. This adds the shared schema of the build that answers
-- it; each part's own functions come in its own migration (20261009010000_* and later):
--
--   profiles.grade         0..8 (0 = Kindergarten), null for a high-school course or not chosen
--                          (src/lib/learning/grades.ts). Written by save_onboarding (v2) or, for a
--                          kid profile, by the /api/family routes (service role).
--   profiles.heard_from    "How did you hear about Agathon?" (src/lib/funnel/contracts.ts HEARD_FROM),
--                          written once by save_onboarding (v2).
--   profiles.attribution   where the account first arrived from (utm_*, referrer origin, landing
--                          path, ?ref=): a JSON object of at most 2,000 bytes, written once by
--                          save_attribution(). Never read by the client for anything but itself.
--   profiles.avatar        a profile picture id (src/lib/family/contracts.ts AVATARS).
--   daily_practice         one row per student per local day: Today's practice
--                          (src/lib/daily/contracts.ts). Read by its owner; written only by
--                          save_daily_practice(), whose counts only go up.
--   families               a grown-up with kid profiles, and their PIN's hash. No client access at
--                          all: the /api/family routes use the service role.
--   family_members         one row per kid: the kid's user id and their grown-up. The grown-up and
--                          the kid each read their own rows; no client writes.
--
-- Functions:
--   save_onboarding(p_course, p_complete, p_grade, p_heard_from) -> { course, grade, heard_from,
--     onboarded_at }   v2 of 20260928100000_onboarding.sql's: a call with only the first two
--     arguments behaves as before. p_grade 0..8 sets the grade; a high-school course (anything
--     but 'other') given without a grade clears it. p_heard_from is kept only the first time.
--   save_attribution(p jsonb) -> boolean   stores the account's attribution if it has none yet.
--   save_daily_practice(p_day, p_board_id, p_goal, p_done, p_stars) -> row as jsonb
--     upserts the caller's row for p_day, which must be within a day of the server's date (time
--     zones; no back-filling a streak). done and stars only ever go up; completed_at is stamped
--     when done reaches goal. p_board_id, when given, must be the caller's own board.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Profile columns
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists grade smallint;
alter table public.profiles add column if not exists heard_from text;
alter table public.profiles add column if not exists attribution jsonb;
alter table public.profiles add column if not exists avatar text;

alter table public.profiles drop constraint if exists profiles_grade_range;
alter table public.profiles add constraint profiles_grade_range check (grade is null or grade between 0 and 8);

alter table public.profiles drop constraint if exists profiles_heard_from_known;
alter table public.profiles add constraint profiles_heard_from_known
  check (heard_from is null or heard_from in ('friend', 'school', 'tiktok', 'instagram', 'youtube', 'x', 'search', 'other'));

alter table public.profiles drop constraint if exists profiles_attribution_shape;
alter table public.profiles add constraint profiles_attribution_shape
  check (attribution is null or (jsonb_typeof(attribution) = 'object' and octet_length(attribution::text) <= 2000));

alter table public.profiles drop constraint if exists profiles_avatar_shape;
alter table public.profiles add constraint profiles_avatar_shape check (avatar is null or avatar ~ '^[a-z]{1,24}$');

-- -----------------------------------------------------------------------------
-- 2. save_onboarding v2
-- -----------------------------------------------------------------------------
drop function if exists public.save_onboarding(text, boolean);

create or replace function public.save_onboarding(
  p_course text default null,
  p_complete boolean default false,
  p_grade int default null,
  p_heard_from text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course text;
  v_grade smallint;
  v_heard text;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_course is not null and p_course not in ('algebra1', 'geometry', 'algebra2', 'precalc_calc', 'other') then
    raise exception 'unknown course' using errcode = '22023';
  end if;
  if p_grade is not null and (p_grade < 0 or p_grade > 8) then
    raise exception 'unknown grade' using errcode = '22023';
  end if;
  if p_heard_from is not null and p_heard_from not in ('friend', 'school', 'tiktok', 'instagram', 'youtube', 'x', 'search', 'other') then
    raise exception 'unknown source' using errcode = '22023';
  end if;

  -- Self-heal a missing profile (sign-up trigger failed) - only for a user that still exists.
  insert into public.profiles (user_id)
  select u.id from auth.users u where u.id = v_uid
  on conflict (user_id) do nothing;

  update public.profiles
     set course = coalesce(p_course, course),
         grade = case
                   when p_grade is not null then p_grade::smallint
                   when p_course is not null and p_course <> 'other' then null
                   else grade
                 end,
         heard_from = coalesce(heard_from, p_heard_from),
         onboarded_at = case when coalesce(p_complete, false) then coalesce(onboarded_at, now()) else onboarded_at end
   where user_id = v_uid
  returning course, grade, heard_from, onboarded_at into v_course, v_grade, v_heard, v_at;

  if not found then
    raise exception 'account not found' using errcode = '42501';
  end if;

  return jsonb_build_object('course', v_course, 'grade', v_grade, 'heard_from', v_heard, 'onboarded_at', v_at);
end;
$$;
revoke all on function public.save_onboarding(text, boolean, int, text) from public, anon;
grant execute on function public.save_onboarding(text, boolean, int, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. save_attribution
-- -----------------------------------------------------------------------------
create or replace function public.save_attribution(p jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 2000 then
    raise exception 'bad attribution' using errcode = '22023';
  end if;
  update public.profiles set attribution = p where user_id = v_uid and attribution is null;
  return found;
end;
$$;
revoke all on function public.save_attribution(jsonb) from public, anon;
grant execute on function public.save_attribution(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. daily_practice
-- -----------------------------------------------------------------------------
create table if not exists public.daily_practice (
  user_id      uuid not null references auth.users (id) on delete cascade,
  day          date not null,
  board_id     uuid references public.whiteboards (id) on delete set null,
  goal         smallint not null default 5 check (goal between 1 and 20),
  done         smallint not null default 0 check (done between 0 and 100),
  stars        smallint not null default 0 check (stars between 0 and 100),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists daily_practice_board_idx on public.daily_practice (board_id) where board_id is not null;

alter table public.daily_practice enable row level security;
revoke all on public.daily_practice from public, anon, authenticated;
grant select on public.daily_practice to authenticated;
grant all on public.daily_practice to service_role;

drop policy if exists "daily_practice: owner select" on public.daily_practice;
create policy "daily_practice: owner select"
  on public.daily_practice for select to authenticated
  using (user_id = auth.uid());

create or replace function public.save_daily_practice(
  p_day date,
  p_board_id uuid default null,
  p_goal int default 5,
  p_done int default 0,
  p_stars int default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.daily_practice%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_day is null or p_day < current_date - 1 or p_day > current_date + 1 then
    raise exception 'day out of range' using errcode = '22023';
  end if;
  if p_goal is null or p_goal < 1 or p_goal > 20 or coalesce(p_done, 0) < 0 or coalesce(p_stars, 0) < 0 then
    raise exception 'bad counts' using errcode = '22023';
  end if;
  if p_board_id is not null and not exists (select 1 from public.whiteboards w where w.id = p_board_id and w.user_id = v_uid) then
    raise exception 'not your board' using errcode = '42501';
  end if;

  insert into public.daily_practice as d (user_id, day, board_id, goal, done, stars, completed_at)
  values (
    v_uid, p_day, p_board_id, p_goal::smallint,
    least(coalesce(p_done, 0), 100)::smallint,
    least(coalesce(p_stars, 0), 100)::smallint,
    case when coalesce(p_done, 0) >= p_goal then now() end
  )
  on conflict (user_id, day) do update
     set board_id = coalesce(d.board_id, excluded.board_id),
         done = greatest(d.done, excluded.done),
         stars = greatest(d.stars, excluded.stars),
         completed_at = coalesce(d.completed_at, case when greatest(d.done, excluded.done) >= d.goal then now() end),
         updated_at = now()
  returning d.* into v_row;

  return jsonb_build_object(
    'day', v_row.day, 'board_id', v_row.board_id, 'goal', v_row.goal, 'done', v_row.done,
    'stars', v_row.stars, 'completed_at', v_row.completed_at
  );
end;
$$;
revoke all on function public.save_daily_practice(date, uuid, int, int, int) from public, anon;
grant execute on function public.save_daily_practice(date, uuid, int, int, int) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. families
-- -----------------------------------------------------------------------------
create table if not exists public.families (
  parent_id  uuid primary key references auth.users (id) on delete cascade,
  -- the server's scrypt hash of the 4-digit PIN (src/lib/family); null until the grown-up sets one
  -- (required before the first kid is added)
  pin_hash   text,
  pin_set_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.families enable row level security;
revoke all on public.families from public, anon, authenticated;
grant all on public.families to service_role;

create table if not exists public.family_members (
  child_id   uuid primary key references auth.users (id) on delete cascade,
  parent_id  uuid not null references public.families (parent_id) on delete cascade,
  created_at timestamptz not null default now(),
  check (child_id <> parent_id)
);
create index if not exists family_members_parent_idx on public.family_members (parent_id);

alter table public.family_members enable row level security;
revoke all on public.family_members from public, anon, authenticated;
grant select on public.family_members to authenticated;
grant all on public.family_members to service_role;

drop policy if exists "family_members: parent or child select" on public.family_members;
create policy "family_members: parent or child select"
  on public.family_members for select to authenticated
  using (parent_id = auth.uid() or child_id = auth.uid());

-- PostgREST caches the schema; the new columns, tables and RPCs need a reload.
notify pgrst, 'reload schema';
