-- =============================================================================
-- Funnel steps (2026-10-12). Idempotent; additive. Needs 20261009020000_funnel.sql.
--
-- The admin Funnel could not see the steps between the welcome and the free trial. On 2026-10-12
-- prod had 39 sign-ups since the paywall, 27 who had opened checkout (only Stripe knew) and 18
-- trials, and nothing in the database said who saw the plan screen, who skipped the tour, or who
-- saw the tutor check a line first: the onboarding's client metrics never left the browser.
--
--   funnel_steps   one row per account and step (src/lib/funnel/steps.ts FUNNEL_STEPS): when it
--                  first and last happened, how many times, and the first time's small details
--                  (`meta`, a flat object). No client access: written only by record_funnel_step(),
--                  read only by the service role (admin_funnel). A Stripe back-fill of the
--                  checkouts opened before this tags its rows meta.source = 'stripe'.
--
--   record_funnel_step(p_step text, p_meta jsonb default null) -> void
--                  the caller's step: inserted the first time (with p_meta), counted after
--                  (`last_at`, `times` capped at 10,000; the first meta is kept). 42501 signed
--                  out; 23514 an unknown step or a meta that is not a small object.
--
--   admin_funnel(p_tz) v2 -> jsonb, as before (20261009020000_funnel.sql) plus:
--       tracking_since              the first recorded step's time, back-filled rows aside (null: none)
--       accounts[].signed_up_at     the sign-up's instant, to the minute (UTC, ISO 8601)
--       accounts[].steps            the FUNNEL_STEPS the account or its kids recorded
--       accounts[].trial_ended      a started plan whose free trial is over: no longer trialing
--                                   (paid, past due, canceled…) or past its trial_end
--       stages                      + plan_shown, checkout_opened (recorded steps); first_problem
--                                   is gone (it counted learning records, which only began on
--                                   2026-10-05, and sat in the wrong place in the chain)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. funnel_steps
-- -----------------------------------------------------------------------------
create table if not exists public.funnel_steps (
  user_id  uuid        not null references auth.users (id) on delete cascade,
  step     text        not null,
  first_at timestamptz not null default now(),
  last_at  timestamptz not null default now(),
  times    integer     not null default 1,
  meta     jsonb,
  primary key (user_id, step)
);

alter table public.funnel_steps drop constraint if exists funnel_steps_step_known;
alter table public.funnel_steps add constraint funnel_steps_step_known check (step in (
  'welcome_shown', 'welcome_skipped', 'welcome_started',
  'tour_problem', 'tour_checked', 'tour_unread', 'tour_helped', 'tour_asked', 'tour_skipped', 'tour_done',
  'plan_shown', 'checkout_opened', 'checkout_returned'
));
alter table public.funnel_steps drop constraint if exists funnel_steps_times_range;
alter table public.funnel_steps add constraint funnel_steps_times_range check (times between 1 and 10000);
alter table public.funnel_steps drop constraint if exists funnel_steps_meta_shape;
alter table public.funnel_steps add constraint funnel_steps_meta_shape
  check (meta is null or (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 1000));

-- the Funnel's "since tracking began" reads the earliest row
create index if not exists funnel_steps_first_at_idx on public.funnel_steps (first_at);

alter table public.funnel_steps enable row level security;
revoke all on public.funnel_steps from public, anon, authenticated;
grant all on public.funnel_steps to service_role;

-- -----------------------------------------------------------------------------
-- 2. record_funnel_step
-- -----------------------------------------------------------------------------
create or replace function public.record_funnel_step(p_step text, p_meta jsonb default null)
returns void
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
  -- the table's checks refuse an unknown step and a meta that is not a small object (23514)
  insert into public.funnel_steps as f (user_id, step, meta)
  values (v_uid, p_step, nullif(p_meta, '{}'::jsonb))
  on conflict (user_id, step) do update
    set last_at = now(),
        times = least(f.times + 1, 10000);
end;
$$;
revoke all on function public.record_funnel_step(text, jsonb) from public, anon;
grant execute on function public.record_funnel_step(text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. admin_funnel v2
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
           ), '[]'::jsonb)
         )
    into v_out;

  return v_out;
end;
$$;
revoke all on function public.admin_funnel(text) from public, anon, authenticated;
grant execute on function public.admin_funnel(text) to service_role;

-- PostgREST caches the schema; the new table and function need a reload.
notify pgrst, 'reload schema';
