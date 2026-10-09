-- =============================================================================
-- The growth funnel (2026-10-09, "kids come back"). Idempotent; additive. Needs
-- 20261009000000_kids_come_back.sql (profiles.heard_from / attribution, daily_practice,
-- family_members) and 20261005000000_admin.sql (admins).
--
-- 66 sign-ups, 14 trials and $0 MRR, with no idea which channel works or where people drop off.
-- The admin console's Funnel page (GET /api/admin/funnel, src/lib/server/adminConsole/funnel.ts)
-- reads every account's progress through ONE call, so the page costs one round trip however many
-- rows the tables hold (PostgREST cannot aggregate, and reading the rows would stop at its caps).
--
--   admin_funnel(p_tz) -> jsonb
--     {
--       time_zone, generated_at,
--       active_subscriptions   unlimited_subscriptions with status 'active' (MRR = this × the price)
--       kid_profiles           family_members rows: kids, left out of everything below
--       accounts: [ { week, source, stages, canceled } ]   one per grown-up / solo account
--     }
--   One entry per profile that is neither a kid (family_members.child_id) nor an admin (admins).
--   No user ids, names or emails: the page shows counts only.
--     week      the Monday of the sign-up week, YYYY-MM-DD, in p_tz
--     source    heard_from, else 'utm:' || utm_source, else the referrer's origin, else 'unknown'
--     stages    the FUNNEL_STAGES reached (src/lib/funnel/contracts.ts):
--       signed_up        every account
--       onboarded        profiles.onboarded_at is set
--       first_problem    any learning_attempts row (the account's or its kids')
--       trial_started    an unlimited_subscriptions row that got past checkout (any status but
--                        incomplete / incomplete_expired)
--       came_back_day2   activity on a later local day (p_tz) than the sign-up's
--       came_back_week2  activity 7 to 14 local days after the sign-up's day
--       paid             a subscription whose status is 'active'
--     canceled  a trial or plan set to cancel, or ended, with nothing live left (trialing, active
--               or past_due and not set to cancel)
--   Activity is any learning_attempts, usage_events, unlimited_usage or daily_practice row of the
--   account or of its kids: a family's funnel is the grown-up's account, and the kids do the work.
--   p_tz is an IANA zone name (the admin's browser's), 'America/New_York' when null or empty;
--   an unknown one raises 22023.
--
-- Who may call it: the service role only (SECURITY DEFINER, revoked from everyone else), like the
-- console's other functions. admin_funnel_active() is its helper, service role only too.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Any activity of these accounts on a local day in [p_from, p_to) (p_to null: no end)
-- -----------------------------------------------------------------------------
create or replace function public.admin_funnel_active(p_ids uuid[], p_from date, p_to date, p_tz text)
returns boolean
language sql
stable
set search_path = public
as $$
  -- local midnights as instants: each table is probed by its (user_id, time) index
  with b as (
    select (p_from::timestamp at time zone p_tz) as t_from,
           case when p_to is null then null else (p_to::timestamp at time zone p_tz) end as t_to
  )
  select
    exists (select 1 from public.learning_attempts la, b
             where la.user_id = any (p_ids) and la.started_at >= b.t_from and (b.t_to is null or la.started_at < b.t_to))
    or exists (select 1 from public.usage_events ue, b
                where ue.user_id = any (p_ids) and ue.created_at >= b.t_from and (b.t_to is null or ue.created_at < b.t_to))
    or exists (select 1 from public.unlimited_usage uu, b
                where uu.user_id = any (p_ids) and uu.created_at >= b.t_from and (b.t_to is null or uu.created_at < b.t_to))
    -- daily_practice.day is already the student's local day
    or exists (select 1 from public.daily_practice dp
                where dp.user_id = any (p_ids) and dp.day >= p_from and (p_to is null or dp.day < p_to));
$$;
revoke all on function public.admin_funnel_active(uuid[], date, date, text) from public, anon, authenticated;
grant execute on function public.admin_funnel_active(uuid[], date, date, text) to service_role;

-- -----------------------------------------------------------------------------
-- 2. admin_funnel
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
           case
             when a.heard_from is not null then a.heard_from
             when nullif(btrim(a.attribution ->> 'utmSource'), '') is not null
               then 'utm:' || left(lower(btrim(a.attribution ->> 'utmSource')), 80)
             when btrim(a.attribution ->> 'referrer') ~* '^https?://[^/?#[:space:]]+$'
               then left(lower(btrim(a.attribution ->> 'referrer')), 200)
             else 'unknown'
           end as source,
           a.onboarded_at is not null as onboarded,
           exists (select 1 from public.learning_attempts la where la.user_id = any (a.ids)) as first_problem,
           coalesce(s.started, false) as trial_started,
           public.admin_funnel_active(a.ids, a.d0 + 1, null, v_tz) as day2,
           public.admin_funnel_active(a.ids, a.d0 + 7, a.d0 + 15, v_tz) as week2,
           coalesce(s.paid, false) as paid,
           coalesce(s.started and s.cancel_seen and not s.live, false) as canceled
      from accounts a
      left join subs s on s.user_id = a.user_id
  )
  select jsonb_build_object(
           'time_zone', v_tz,
           'generated_at', now(),
           'active_subscriptions', (select count(*) from public.unlimited_subscriptions us where us.status = 'active'),
           'kid_profiles', (select count(*) from people where is_kid),
           'accounts', coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'week', to_char(date_trunc('week', f.d0)::date, 'YYYY-MM-DD'),
                        'source', f.source,
                        'stages', to_jsonb(array_remove(array[
                          'signed_up',
                          case when f.onboarded then 'onboarded' end,
                          case when f.first_problem then 'first_problem' end,
                          case when f.trial_started then 'trial_started' end,
                          case when f.day2 then 'came_back_day2' end,
                          case when f.week2 then 'came_back_week2' end,
                          case when f.paid then 'paid' end
                        ], null)),
                        'canceled', f.canceled
                      )
                      order by f.d0
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

-- PostgREST caches the schema; the new functions need a reload.
notify pgrst, 'reload schema';
