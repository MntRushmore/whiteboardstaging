-- =============================================================================
-- First-run onboarding (2026-09-28). Idempotent; additive to 20260917020000_accounts_billing.sql.
--
-- A new student sees a short welcome on the boards home (what the product does, their
-- course, Start), then a guided first board: the tutor writes one starter problem from
-- that course and three coach marks show the pen, the help modes and Ask. Two facts are
-- kept on the student's own profile:
--
--   profiles.course        the course chosen in the welcome ('algebra1', 'geometry',
--                          'algebra2', 'precalc_calc', 'other'), null until chosen
--   profiles.onboarded_at  when the welcome + tour were finished or skipped; null = not yet
--
-- The welcome shows only while onboarded_at is null AND the student has no boards.
-- Every profile that exists when this migration first runs is backfilled with
-- onboarded_at = created_at: accounts made before onboarding shipped are never shown it.
-- The backfill runs only when this file adds the column, so re-running it never marks a
-- newer student as onboarded.
--
-- Writes go through one RPC, never a column grant (a user may still update display_name
-- and nothing else on profiles, so a later `revoke ... grant update (display_name)` in
-- another migration cannot silently widen or drop this path):
--
--   save_onboarding(p_course text default null, p_complete boolean default false)
--     -> { course, onboarded_at }
--     SECURITY DEFINER, acting on auth.uid() only. p_course (when given) must be one of
--     the five ids above, else 22023 (HTTP 400). p_complete stamps onboarded_at = now()
--     once (a second call keeps the first time). Creates a missing profile row first,
--     like consume_credits. anon cannot execute it.
--
-- Objects created here:
--   columns    profiles.course, profiles.onboarded_at
--   constraint profiles_course_known
--   functions  save_onboarding(text, boolean)
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarded_at'
  ) then
    alter table public.profiles add column onboarded_at timestamptz;
    -- Everyone who already has an account: never forced into the welcome.
    update public.profiles set onboarded_at = created_at where onboarded_at is null;
  end if;
end;
$$;

alter table public.profiles add column if not exists course text;

alter table public.profiles drop constraint if exists profiles_course_known;
alter table public.profiles add constraint profiles_course_known
  check (course is null or course in ('algebra1', 'geometry', 'algebra2', 'precalc_calc', 'other'));

-- RPC: POST /rest/v1/rpc/save_onboarding  (as the user)
create or replace function public.save_onboarding(p_course text default null, p_complete boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_course text;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_course is not null and p_course not in ('algebra1', 'geometry', 'algebra2', 'precalc_calc', 'other') then
    raise exception 'unknown course' using errcode = '22023';
  end if;

  -- Self-heal a missing profile (sign-up trigger failed) - only for a user that still exists.
  insert into public.profiles (user_id)
  select u.id from auth.users u where u.id = v_uid
  on conflict (user_id) do nothing;

  update public.profiles
     set course = coalesce(p_course, course),
         onboarded_at = case when coalesce(p_complete, false) then coalesce(onboarded_at, now()) else onboarded_at end
   where user_id = v_uid
  returning course, onboarded_at into v_course, v_at;

  if not found then
    raise exception 'account not found' using errcode = '42501';
  end if;

  return jsonb_build_object('course', v_course, 'onboarded_at', v_at);
end;
$$;
revoke all on function public.save_onboarding(text, boolean) from public, anon;
grant execute on function public.save_onboarding(text, boolean) to authenticated;

-- PostgREST caches the schema; the new columns and RPC need a reload.
notify pgrst, 'reload schema';
