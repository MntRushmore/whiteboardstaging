-- =============================================================================
-- Usage by day (2026-09-27). Idempotent; additive to 20260917020000_accounts_billing.sql.
--
-- The account page summarises this month's spend by day and by kind of work. A busy
-- student writes thousands of usage_events rows a month (one per handwriting read),
-- far more than the page should download to add up in the browser, so the database
-- does the grouping:
--
--   usage_by_day(p_time_zone) -> setof { day date, route text, events int, credits int }
--     One row per (day, route) for the CURRENT credit period - the same UTC calendar
--     month credit_balance() counts, so the rows add up to credit_summary().used.
--     `day` is the calendar date in p_time_zone (an IANA name from the browser, e.g.
--     'America/New_York'), so "today" on the page is the student's today. An unknown
--     zone raises 22023 (HTTP 400); the client then asks again in 'UTC'.
--     Newest day first; within a day, most credits first.
--
-- SECURITY INVOKER on purpose: unlike the RPCs that write the ledger, this one only
-- reads it, so it runs as the caller and the existing "usage_events: owner select"
-- policy decides which rows it sees. The explicit user_id filter below is for the
-- (user_id, created_at) index, not the guarantee. `anon` gets no execute.
--
-- Objects created here:
--   functions  usage_by_day(text)
-- =============================================================================

create or replace function public.usage_by_day(p_time_zone text default 'UTC')
returns table (day date, route text, events integer, credits integer)
language sql
stable
security invoker
set search_path = public
as $$
  -- The period is credit_period()'s expression, inlined: credit_period() is not
  -- executable by `authenticated`, and this function runs as the caller.
  select
    (e.created_at at time zone coalesce(nullif(p_time_zone, ''), 'UTC'))::date as day,
    e.route,
    count(*)::integer    as events,
    sum(e.units)::integer as credits
  from public.usage_events e
  where e.user_id = (select auth.uid())
    and e.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
    and e.created_at <  ((date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc')
  group by 1, 2
  order by 1 desc, 4 desc, 2;
$$;
revoke all on function public.usage_by_day(text) from public, anon;
grant execute on function public.usage_by_day(text) to authenticated;

-- PostgREST caches the schema; the new RPC needs a reload.
notify pgrst, 'reload schema';
