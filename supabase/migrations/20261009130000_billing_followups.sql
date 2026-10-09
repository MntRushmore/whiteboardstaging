-- =============================================================================
-- Billing follow-ups (2026-10-09, Phase 2). Idempotent; replaces one function. docs/RUNBOOK-billing.md.
--
--   admin_funnel(p_tz)    same as 20261009020000_funnel.sql, with one fix: `active_subscriptions`,
--                         the basis of the Funnel's MRR (src/lib/funnel/report.ts: active x
--                         UNLIMITED_PLAN.monthlyUsd), counted EVERY 'active' unlimited_subscriptions
--                         row. It now leaves out
--                           - rows linked to nobody (user_id null): a payer whose account is gone, or
--                             a Payment Link opened outside the app (runbook section 11), which are
--                             not an account's revenue until the owner links them; and
--                           - admins' own subscriptions (public.admins): the owner trying the
--                             checkout is not revenue,
--                         as the per-account part of the funnel (`accounts`) already left admins out.
--                         Nothing else changes: the answer has the same keys, so the code reading it
--                         is unchanged.
--
-- Who may call it is unchanged: the service role only. The yearly plan once planned for this
-- timestamp was dropped (owner, 2026-10-09): unlimited_subscriptions.billing_interval
-- (20261009100000_parents_recommend.sql) stays, unused.
-- =============================================================================

-- Same as 20261009020000_funnel.sql except `active_subscriptions` (see above).
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
           -- revenue: linked to an account that is not an admin's (the owner trying the checkout is
           -- not revenue, and a row with nobody is a payer whose account is gone or a link opened
           -- outside the app: section 11 of the runbook, not MRR until it is linked)
           'active_subscriptions', (
             select count(*) from public.unlimited_subscriptions us
              where us.status = 'active' and us.user_id is not null
                and not exists (select 1 from public.admins ad where ad.user_id = us.user_id)),
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

-- PostgREST caches the schema; reload it with the new definition.
notify pgrst, 'reload schema';
