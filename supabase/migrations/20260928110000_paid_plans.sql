-- =============================================================================
-- Paid plans (2026-09-28). Idempotent; additive to 20260917020000_accounts_billing.sql.
--
-- Checkout is live (Stripe Payment Links, docs/RUNBOOK-billing.md), so the pilot allowance
-- from 20260917040000_pilot_free_credits.sql ends:
--
--   free   300 credits / month, $0      (was 1,000 during the pilot)
--   plus   3,000 credits / month, $9    (unchanged)
--   pro    12,000 credits / month, $29  (unchanged)
--
-- The paid prices are PLACEHOLDERS the owner may still change. Two places hold them and must
-- agree: this table (what the app shows and meters) and the PLANS config at the top of
-- scripts/stripe-setup.mjs (what Stripe charges). src/__tests__/stripeSetup.test.ts pins the two
-- together. To change a price later: edit both, run the script (it creates a new Stripe price and
-- Payment Link and prints the new env values), and UPDATE public.plans as in the runbook.
--
-- Balances are computed per calendar month from the plan, so the new free allowance applies to
-- everyone at once. credit_grants are not touched: a user keeps any extra credits (or
-- corrections) already granted for this month.
--
-- Also: credit_balance() / credit_summary() now carry the subscription state the account page
-- shows (renewal date, "cancels on …") and polls after checkout, so one RPC answers both:
--   billing_status      profiles.billing_status: Stripe's subscription status ('active',
--                       'past_due', 'canceled', ...), 'canceling' while a cancellation is
--                       scheduled for the period end (set by the webhook), or null (never paid)
--   current_period_end  profiles.current_period_end: when the paid period renews, or ends
--                       when billing_status = 'canceling'. Not to be confused with
--                       period_end, the end of the CREDIT month (the 1st, UTC).
-- Both are the caller's own profile columns, already readable by them through RLS.
--
-- Objects changed here:
--   rows       plans (free, plus, pro)
--   functions  credit_balance(uuid)  (two keys added; signature, grants and callers unchanged)
-- =============================================================================

update public.plans
   set monthly_credits = 300,
       features = '["300 credits / month", "All AI tutor modes", "Realtime math checking"]'::jsonb
 where id = 'free';

update public.plans
   set monthly_credits = 3000,
       price_cents = 900
 where id = 'plus';

update public.plans
   set monthly_credits = 12000,
       price_cents = 2900
 where id = 'pro';

-- Same body as 20260917020000_accounts_billing.sql plus billing_status / current_period_end.
create or replace function public.credit_balance(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
  v_plan_id text;
  v_plan_name text;
  v_monthly integer;
  v_used integer;
  v_granted integer;
  v_status text;
  v_paid_until timestamptz;
begin
  select period_start, period_end into v_start, v_end from public.credit_period();

  select p.id, p.name, p.monthly_credits, pr.billing_status, pr.current_period_end
    into v_plan_id, v_plan_name, v_monthly, v_status, v_paid_until
  from public.profiles pr
  join public.plans p on p.id = pr.plan_id
  where pr.user_id = p_uid;

  if v_plan_id is null then
    select p.id, p.name, p.monthly_credits into v_plan_id, v_plan_name, v_monthly
    from public.plans p where p.id = 'free';
  end if;

  select coalesce(sum(u.units), 0)::integer into v_used
  from public.usage_events u
  where u.user_id = p_uid and u.created_at >= v_start and u.created_at < v_end;

  select coalesce(sum(g.units), 0)::integer into v_granted
  from public.credit_grants g
  where g.user_id = p_uid and g.created_at >= v_start and g.created_at < v_end;

  return jsonb_build_object(
    'plan_id',            v_plan_id,
    'plan_name',          v_plan_name,
    'monthly_credits',    coalesce(v_monthly, 0),
    'used',               v_used,
    'granted',            v_granted,
    'remaining',          greatest(0, coalesce(v_monthly, 0) + v_granted - v_used),
    'period_start',       v_start,
    'period_end',         v_end,
    'billing_status',     v_status,
    'current_period_end', v_paid_until
  );
end;
$$;
revoke all on function public.credit_balance(uuid) from public, anon, authenticated;

-- PostgREST caches the schema; the changed function needs a reload.
notify pgrst, 'reload schema';
