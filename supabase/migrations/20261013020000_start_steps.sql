-- =============================================================================
-- The new onboarding's steps before the account (2026-10-13). Idempotent; additive. Needs
-- 20261012020000_funnel_steps.sql (admin_funnel v2) and 20261005000000_admin.sql (admins).
--
-- /start (docs/START-FLOW.md, src/lib/start/contracts.ts) asks who is there, the grade and a few
-- more things, lets the visitor try the board and shows the plan, all BEFORE the account. The admin
-- Funnel's steps began at "Signed up", so nothing said where families stop before it. These steps
-- are counted anonymously, by journey: a random id the device keeps in localStorage. Never an IP,
-- never the name, and of the answers only what START_EVENTS notes (the role, the grade or course,
-- how many skills, whether the try was solved). Nothing that says where the visitor came from.
--
--   start_steps     one row per journey and event (START_EVENTS): when it first and last happened,
--                   how many times (capped at 10,000), the first time's small details (`meta`, a
--                   flat object of at most 500 bytes), and the account the journey led to
--                   (`user_id`: null until linked, null again if that account is deleted). No client
--                   access: written only by the two functions below, read only by the service role.
--
--   record_start_step(p_journey uuid, p_event text, p_meta jsonb default null) -> void
--                   the SERVICE ROLE's (POST /api/start/step calls it once its own checks and limits
--                   pass): the journey's event is inserted the first time (with p_meta), counted
--                   after (`last_at`, `times`; the first meta is kept). A new row of a journey that
--                   is already linked joins the same account. 23514 an unknown event, a meta that is
--                   not a small flat object, or start_account (only linking records it); 22023 no
--                   journey.
--
--   link_start_journey(p_journey uuid) -> boolean
--                   the SIGNED-IN user's, once the account is made (src/lib/start/record.ts
--                   `linkStartJourney`): the journey's rows with no account become the caller's,
--                   and start_account is recorded (true). Never another user's: a journey with a row
--                   linked to someone else is left as it is (false), and so is a journey with no rows
--                   at all (false: nothing to link, and nobody can make up journeys this way).
--                   42501 signed out.
--
--   admin_funnel(p_tz) v3 -> jsonb, as v2 (20261012020000_funnel_steps.sql) plus:
--       start.since        60 days ago, to the minute (UTC, ISO 8601): the journeys below began after it
--       start.journeys[]   { first_at, events, n }: n journeys that began in the same minute (UTC,
--                          ISO 8601, like accounts[].signed_up_at) and recorded the same events (in
--                          name order). No ids. A journey with a row linked to an admin is left out.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. start_steps
-- -----------------------------------------------------------------------------
create table if not exists public.start_steps (
  journey_id uuid        not null,
  event      text        not null,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  times      integer     not null default 1,
  meta       jsonb,
  user_id    uuid        references auth.users (id) on delete set null,
  primary key (journey_id, event)
);

alter table public.start_steps drop constraint if exists start_steps_event_known;
alter table public.start_steps add constraint start_steps_event_known check (event in (
  'start_shown', 'start_who', 'start_name', 'start_grade', 'start_focus', 'start_proof',
  'start_try_shown', 'start_try_checked', 'start_plan', 'start_account_shown',
  'start_handoff', 'start_handoff_opened', 'start_account'
));
alter table public.start_steps drop constraint if exists start_steps_times_range;
alter table public.start_steps add constraint start_steps_times_range check (times between 1 and 10000);
-- a flat object: no value inside it is an object or a list ('strict', or a list's items are read instead)
alter table public.start_steps drop constraint if exists start_steps_meta_shape;
alter table public.start_steps add constraint start_steps_meta_shape check (
  meta is null or (
    jsonb_typeof(meta) = 'object'
    and octet_length(meta::text) <= 500
    and not jsonb_path_exists(meta, 'strict $.* ? (@.type() == "object" || @.type() == "array")')
  )
);

-- the Funnel reads the last 60 days; an account's deletion sets its rows' user_id null
create index if not exists start_steps_first_at_idx on public.start_steps (first_at);
create index if not exists start_steps_user_idx on public.start_steps (user_id) where user_id is not null;

alter table public.start_steps enable row level security;
revoke all on public.start_steps from public, anon, authenticated;
grant all on public.start_steps to service_role;

-- -----------------------------------------------------------------------------
-- 2. record_start_step (the service role's)
-- -----------------------------------------------------------------------------
create or replace function public.record_start_step(p_journey uuid, p_event text, p_meta jsonb default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_journey is null then
    raise exception 'a journey is required' using errcode = '22023';
  end if;
  if p_event = 'start_account' then
    raise exception 'start_account is recorded by link_start_journey' using errcode = '23514';
  end if;
  -- the table's checks refuse an unknown event and a meta that is not a small flat object (23514)
  insert into public.start_steps as s (journey_id, event, meta, user_id)
  values (
    p_journey,
    p_event,
    case when p_meta is null or p_meta = 'null'::jsonb or p_meta = '{}'::jsonb then null else p_meta end,
    (select l.user_id from public.start_steps l where l.journey_id = p_journey and l.user_id is not null limit 1)
  )
  on conflict (journey_id, event) do update
    set last_at = now(),
        times = least(s.times + 1, 10000);
end;
$$;
revoke all on function public.record_start_step(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_start_step(uuid, text, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 3. link_start_journey (the signed-in user's)
-- -----------------------------------------------------------------------------
create or replace function public.link_start_journey(p_journey uuid)
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
  if p_journey is null then
    return false;
  end if;
  -- one link at a time per journey; none for a journey nobody recorded
  perform 1 from public.start_steps s where s.journey_id = p_journey for update;
  if not found then
    return false;
  end if;
  if exists (select 1 from public.start_steps s where s.journey_id = p_journey and s.user_id is not null and s.user_id <> v_uid) then
    return false;
  end if;
  update public.start_steps s set user_id = v_uid where s.journey_id = p_journey and s.user_id is null;
  insert into public.start_steps as s (journey_id, event, user_id)
  values (p_journey, 'start_account', v_uid)
  on conflict (journey_id, event) do update
    set last_at = now(),
        times = least(s.times + 1, 10000);
  return true;
end;
$$;
revoke all on function public.link_start_journey(uuid) from public, anon;
grant execute on function public.link_start_journey(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. admin_funnel v3: v2, plus `start`
-- -----------------------------------------------------------------------------
create or replace function public.admin_funnel(p_tz text default 'America/New_York')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := coalesce(nullif(btrim(p_tz), ''), 'America/New_York');
  v_start_since timestamptz := now() - interval '60 days';
  v_out jsonb;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;

  with people as (
    select p.user_id,
           p.created_at,
           p.onboarded_at,
           p.heard_from,
           p.attribution,
           (p.created_at at time zone v_tz)::date as d0,
           exists (select 1 from public.family_members fm where fm.child_id = p.user_id) as is_kid,
           exists (select 1 from public.admins ad where ad.user_id = p.user_id) as is_admin
      from public.profiles p
  ),
  accounts as (
    select pe.*,
           array(select pe.user_id union all select fm.child_id from public.family_members fm where fm.parent_id = pe.user_id) as ids
      from people pe
     where not pe.is_kid and not pe.is_admin
  ),
  subs as (
    select s.user_id,
           bool_or(s.status is null or s.status not in ('incomplete', 'incomplete_expired')) as started,
           bool_or(s.status = 'active') as paid,
           bool_or(
             (s.status is null or s.status not in ('incomplete', 'incomplete_expired'))
             and (coalesce(s.status, 'trialing') <> 'trialing' or coalesce(s.trial_end <= now(), false))
           ) as trial_over,
           bool_or(
             s.status in ('canceled', 'unpaid')
             or s.ended_at is not null
             or (s.status in ('trialing', 'active', 'past_due') and (s.cancel_at_period_end or s.cancel_at is not null))
           ) as cancel_seen,
           bool_or(
             s.status in ('trialing', 'active', 'past_due') and not s.cancel_at_period_end and s.cancel_at is null and s.ended_at is null
           ) as live
      from public.unlimited_subscriptions s
     where s.user_id is not null
     group by s.user_id
  ),
  flags as (
    select a.d0,
           a.created_at,
           case
             when a.heard_from is not null then a.heard_from
             when nullif(btrim(a.attribution ->> 'utmSource'), '') is not null
               then 'utm:' || left(lower(btrim(a.attribution ->> 'utmSource')), 80)
             when btrim(a.attribution ->> 'referrer') ~* '^https?://[^/?#[:space:]]+$'
               then left(lower(btrim(a.attribution ->> 'referrer')), 200)
             else 'unknown'
           end as source,
           a.onboarded_at is not null as onboarded,
           array(select distinct fs.step from public.funnel_steps fs where fs.user_id = any (a.ids) order by fs.step) as steps,
           coalesce(s.started, false) as trial_started,
           public.admin_funnel_active(a.ids, a.d0 + 1, null, v_tz) as day2,
           public.admin_funnel_active(a.ids, a.d0 + 7, a.d0 + 15, v_tz) as week2,
           coalesce(s.paid, false) as paid,
           coalesce(s.trial_over, false) as trial_ended,
           coalesce(s.started and s.cancel_seen and not s.live, false) as canceled
      from accounts a
      left join subs s on s.user_id = a.user_id
  ),
  -- the steps before the account: one row per journey of the last 60 days (no id kept past here)
  journeys as (
    select date_trunc('minute', min(st.first_at) at time zone 'UTC') as first_at,
           array_agg(st.event order by st.event) as events
      from public.start_steps st
      left join public.admins ad on ad.user_id = st.user_id
     group by st.journey_id
    having min(st.first_at) >= v_start_since
       and count(ad.user_id) = 0
  ),
  journey_groups as (
    select to_char(j.first_at, 'YYYY-MM-DD"T"HH24:MI"Z"') as first_at, j.events, count(*) as n
      from journeys j
     group by j.first_at, j.events
  )
  select jsonb_build_object(
           'time_zone', v_tz,
           'generated_at', now(),
           'tracking_since', (
             select min(fs.first_at)
               from public.funnel_steps fs
              where coalesce(fs.meta ->> 'source', '') <> 'stripe'
                and not exists (select 1 from public.admins ad where ad.user_id = fs.user_id)
           ),
           'active_subscriptions', (select count(*) from public.unlimited_subscriptions us where us.status = 'active'),
           'kid_profiles', (select count(*) from people where is_kid),
           'accounts', coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'week', to_char(date_trunc('week', f.d0)::date, 'YYYY-MM-DD'),
                        'signed_up_at', to_char(date_trunc('minute', f.created_at at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI"Z"'),
                        'source', f.source,
                        'stages', to_jsonb(array_remove(array[
                          'signed_up',
                          case when f.onboarded then 'onboarded' end,
                          case when 'plan_shown' = any (f.steps) then 'plan_shown' end,
                          case when 'checkout_opened' = any (f.steps) then 'checkout_opened' end,
                          case when f.trial_started then 'trial_started' end,
                          case when f.day2 then 'came_back_day2' end,
                          case when f.week2 then 'came_back_week2' end,
                          case when f.paid then 'paid' end
                        ], null)),
                        'steps', to_jsonb(f.steps),
                        'trial_ended', f.trial_ended,
                        'canceled', f.canceled
                      )
                      order by f.created_at
                    )
               from flags f
           ), '[]'::jsonb),
           'start', jsonb_build_object(
             'since', to_char(date_trunc('minute', v_start_since at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI"Z"'),
             'journeys', coalesce((
               select jsonb_agg(jsonb_build_object('first_at', g.first_at, 'events', to_jsonb(g.events), 'n', g.n) order by g.first_at, g.events)
                 from journey_groups g
             ), '[]'::jsonb)
           )
         )
    into v_out;

  return v_out;
end;
$$;
revoke all on function public.admin_funnel(text) from public, anon, authenticated;
grant execute on function public.admin_funnel(text) to service_role;

-- PostgREST caches the schema; the new table and functions need a reload.
notify pgrst, 'reload schema';
