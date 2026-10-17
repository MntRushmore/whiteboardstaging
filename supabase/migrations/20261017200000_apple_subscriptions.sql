-- =============================================================================
-- Agathon Unlimited through Apple in-app purchase (2026-10-17, the iPad app's Phase 5).
-- Idempotent; additive to 20261003020000_unlimited.sql, 20261003040000_go_live_gaps.sql and
-- 20261009010000_family_plan.sql. docs/IPAD-NATIVE.md "Money", docs/RUNBOOK-billing.md section 16.
--
-- The iPad app sells the same plan with StoreKit 2: one auto-renewing monthly subscription
-- (`app.agathon.unlimited.monthly`) with a 7-day free trial (Apple's introductory offer). Existing
-- Stripe subscribers keep their plan. An Apple subscription is recorded in the SAME table as a
-- Stripe one, so has_unlimited(), consume_credits() (ink and fair use), the family plan, the
-- referrals trigger, the emails and the admin's money all read it unchanged.
--
-- The schema choice. One row per Apple subscription, keyed by Apple's `originalTransactionId`
-- (stable across renewals, a lapse and a resubscribe in the same subscription group), stored as
-- `stripe_subscription_id = 'apple:<originalTransactionId>'` plus a `provider` column and the
-- Apple fields below. Why the existing id column and not a new nullable key:
--   - every reader keys on it: the unique index the writers upsert on, email_log's ref (the free
--     trial's reminder and nudges, once per subscription), the admin console, admin_referrals(),
--     scripts/verify-rls.mjs. A new key would have made each of them handle a null id;
--   - it stays NOT NULL and unique, and the prefix cannot collide: Stripe's ids are `sub_…`;
--   - the CHECK below ties the two together (provider 'apple' <=> the id is exactly
--     'apple:' || apple_original_transaction_id), so neither can drift, and a Stripe writer can never
--     create an Apple-looking row (apply_unlimited_subscription() inserts with provider 'stripe').
-- The column keeps its old name: renaming it would break every deployed reader at once.
--
-- New columns on unlimited_subscriptions (all null on Stripe rows):
--   provider                       'stripe' (default) | 'apple'
--   apple_original_transaction_id  Apple's originalTransactionId
--   apple_environment              'Production' | 'Sandbox' | 'Xcode' | 'LocalTesting'. livemode is
--                                  set from it (true only for Production): App Review and TestFlight
--                                  buy in the Sandbox against the production server, and those rows
--                                  must grant the plan (or review fails) but are not revenue.
--   apple_product_id               the product (app.agathon.unlimited.monthly)
--   apple_app_account_token        the purchase's appAccountToken: the buyer's profiles.checkout_ref
--   apple_latest_transaction_id    the newest transaction applied (a renewal's id)
--   apple_price_milliunits, apple_currency   what Apple will charge next (renewalPrice), else the
--                                  last price paid; the trial reminder says it in the buyer's money
--
-- Functions:
--   apply_apple_subscription(...) -> jsonb   (service role: the two Apple routes)
--       Records an Apple subscription's state, already mapped to the table's statuses by the server
--       (src/lib/server/apple/state.ts: subscribed -> active, in the free trial -> trialing, billing
--       retry and billing grace period -> past_due, expired -> canceled, refunded or revoked ->
--       canceled with ended_at). Like apply_unlimited_subscription(): one row per subscription,
--       whichever writer comes first; a state is applied only when its as-of time (`p_event_at`, the
--       App Store's signedDate) is not older than the one the row holds, so a late or replayed older
--       payload never overwrites a newer state; same-time payloads are applied again (idempotent).
--       Unlike Stripe, `canceled` is NOT final: an expired Apple subscription that the person buys
--       again comes back with the same originalTransactionId, newer.
--       Who it belongs to: the account whose checkout_ref is the purchase's appAccountToken, through
--       plan_owner_of() (a kid's token lands on their grown-up: the plan is the family's). First
--       link wins. `p_claim_user` is the signed-in caller of POST /api/billing/apple/transaction:
--         - with a token, the caller must be in the token's family, else NOTHING is written and the
--           answer says refused 'account_mismatch' ('account_unknown' when no account has the token);
--         - without a token (an offer code redeemed in the App Store), the row goes to the caller's
--           family when nobody has it yet;
--         - a row already linked to another family answers conflict, and nothing is written.
--       The notifications route passes no caller: it links by the token alone.
--   unlimited_state_of(uid)  same as 20261009010000_family_plan.sql plus `provider` ('stripe' |
--       'apple' | null without a row), so the app sends a grown-up to the right place to manage
--       the plan (Apple's subscriptions sheet, or the web).
--   delete_own_account()     same as 20261009010000_family_plan.sql, except that an Apple
--       subscription does not block deletion: we cannot cancel it (only the person can, in Settings),
--       so refusing would trap them. The app tells the grown-up to cancel in Settings first; the row
--       stays, linked to nobody, as for Stripe.
--
-- Unchanged and still right for Apple rows (scripts/verify + apple_subscriptions.test.sql check them):
--   has_unlimited(), unlimited_earlier_plan() (one free trial per account, whichever store),
--   consume_credits() and fair use, refund_ink_for(), referrals_follow_plan() (fires on status and
--   user_id, whatever the provider), unlimited_subscriptions_forget_payer(), admin_referrals().
--
-- Deploy order: BEFORE the code that calls apply_apple_subscription (the iPad billing routes). The
-- deployed code is fine on it: nothing writes provider 'apple' until those routes exist, and the
-- replaced functions answer the same for every Stripe row.
--
-- Supabase's default privileges grant ALL on every new public function to anon, authenticated and
-- service_role, so each function revokes first and then grants exactly what is used.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The Apple columns
-- -----------------------------------------------------------------------------
alter table public.unlimited_subscriptions
  add column if not exists provider text not null default 'stripe',
  add column if not exists apple_original_transaction_id text,
  add column if not exists apple_environment text,
  add column if not exists apple_product_id text,
  add column if not exists apple_app_account_token uuid,
  add column if not exists apple_latest_transaction_id text,
  add column if not exists apple_price_milliunits bigint,
  add column if not exists apple_currency text;

alter table public.unlimited_subscriptions drop constraint if exists unlimited_subscriptions_provider_check;
alter table public.unlimited_subscriptions add constraint unlimited_subscriptions_provider_check
  check (provider in ('stripe', 'apple'));

alter table public.unlimited_subscriptions drop constraint if exists unlimited_subscriptions_apple_environment_check;
alter table public.unlimited_subscriptions add constraint unlimited_subscriptions_apple_environment_check
  check (apple_environment is null or apple_environment in ('Production', 'Sandbox', 'Xcode', 'LocalTesting'));

alter table public.unlimited_subscriptions drop constraint if exists unlimited_subscriptions_apple_lengths;
alter table public.unlimited_subscriptions add constraint unlimited_subscriptions_apple_lengths
  check (
    (apple_original_transaction_id is null or apple_original_transaction_id ~ '^[0-9A-Za-z._-]{1,64}$')
    and (apple_product_id is null or char_length(apple_product_id) between 1 and 255)
    and (apple_latest_transaction_id is null or char_length(apple_latest_transaction_id) between 1 and 64)
    and (apple_price_milliunits is null or apple_price_milliunits >= 0)
    and (apple_currency is null or apple_currency ~ '^[A-Z]{3}$')
  );

-- The provider and the id agree (see the header): an Apple row's id is exactly 'apple:' || its
-- original transaction id and carries no Stripe fields; a Stripe row has no Apple id.
alter table public.unlimited_subscriptions drop constraint if exists unlimited_subscriptions_provider_shape;
alter table public.unlimited_subscriptions add constraint unlimited_subscriptions_provider_shape
  check (
    (provider = 'stripe'
      and stripe_subscription_id not like 'apple:%'
      and apple_original_transaction_id is null
      and apple_environment is null)
    or
    (provider = 'apple'
      and apple_original_transaction_id is not null
      and stripe_subscription_id = 'apple:' || apple_original_transaction_id
      and stripe_customer_id is null
      and checkout_session_id is null)
  );

-- -----------------------------------------------------------------------------
-- 2. apply_apple_subscription (service role: src/lib/server/apple/store.ts)
-- -----------------------------------------------------------------------------
create or replace function public.apply_apple_subscription(
  p_original_transaction_id text,
  p_environment             text,
  p_product_id              text,
  p_status                  text,
  p_event_at                timestamptz,
  p_app_account_token       uuid        default null,
  p_claim_user              uuid        default null,
  p_transaction_id          text        default null,
  p_trial_end               timestamptz default null,
  p_current_period_end      timestamptz default null,
  p_cancel_at_period_end    boolean     default null,
  p_canceled_at             timestamptz default null,
  p_ended_at                timestamptz default null,
  p_price_milliunits        bigint      default null,
  p_currency                text        default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_key text;
  v_token_user uuid;
  v_token_owner uuid;
  v_claim_owner uuid;
  v_link uuid;
  v_row public.unlimited_subscriptions%rowtype;
  v_linked_now boolean := false;
begin
  if p_original_transaction_id is null or p_original_transaction_id !~ '^[0-9A-Za-z._-]{1,64}$' then
    raise exception 'p_original_transaction_id must be 1..64 letters, digits, dots, dashes or underscores' using errcode = '22023';
  end if;
  if p_environment is null or p_environment not in ('Production', 'Sandbox', 'Xcode', 'LocalTesting') then
    raise exception 'unknown App Store environment %', coalesce(p_environment, '(null)') using errcode = '22023';
  end if;
  if p_product_id is null or char_length(p_product_id) < 1 or char_length(p_product_id) > 255 then
    raise exception 'p_product_id must be 1..255 characters' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused') then
    raise exception 'unknown subscription status %', coalesce(p_status, '(null)') using errcode = '22023';
  end if;
  if p_event_at is null then
    raise exception 'p_event_at is required (the App Store''s signedDate)' using errcode = '22023';
  end if;
  if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
    raise exception 'p_currency must be an ISO 4217 code' using errcode = '22023';
  end if;

  v_key := 'apple:' || p_original_transaction_id;

  -- Whose purchase: the account whose checkout reference is the token, and that account's family.
  if p_app_account_token is not null then
    select pr.user_id into v_token_user from public.profiles pr where pr.checkout_ref = p_app_account_token;
    if v_token_user is not null then
      v_token_owner := public.plan_owner_of(v_token_user);
    end if;
  end if;

  if p_claim_user is not null then
    v_claim_owner := public.plan_owner_of(p_claim_user);
    if p_app_account_token is not null and v_token_owner is null then
      return jsonb_build_object('applied', false, 'stale', false, 'refused', 'account_unknown', 'conflict', false,
                                'linked', false, 'user_id', null, 'status', null, 'unlimited', false);
    end if;
    if p_app_account_token is not null and v_token_owner is distinct from v_claim_owner then
      return jsonb_build_object('applied', false, 'stale', false, 'refused', 'account_mismatch', 'conflict', false,
                                'linked', false, 'user_id', null, 'status', null, 'unlimited', false);
    end if;
    v_link := v_claim_owner;
  else
    v_link := v_token_owner;
  end if;

  -- The row, whichever writer came first; then locked, so two writers for it serialise.
  insert into public.unlimited_subscriptions (
    stripe_subscription_id, provider, apple_original_transaction_id, apple_environment, apple_product_id, livemode
  )
  values (v_key, 'apple', p_original_transaction_id, p_environment, p_product_id, p_environment = 'Production')
  on conflict (stripe_subscription_id) do nothing;
  select * into v_row from public.unlimited_subscriptions where stripe_subscription_id = v_key for update;

  -- A caller can only write a row that is, or becomes, their family's.
  if p_claim_user is not null and v_row.user_id is not null and v_row.user_id is distinct from v_link then
    return jsonb_build_object('applied', false, 'stale', false, 'refused', null, 'conflict', true,
                              'linked', false, 'user_id', null, 'status', v_row.status, 'unlimited', false);
  end if;

  -- First link wins (a notification for a row already linked keeps its family).
  if v_row.user_id is null and v_link is not null then
    update public.unlimited_subscriptions
       set user_id = v_link, linked_at = coalesce(linked_at, now())
     where id = v_row.id
    returning * into v_row;
    v_linked_now := true;
  end if;
  if v_row.apple_app_account_token is null and p_app_account_token is not null then
    update public.unlimited_subscriptions set apple_app_account_token = p_app_account_token where id = v_row.id
    returning * into v_row;
  end if;

  -- An older payload than the one the row holds changes nothing (the link above still stands).
  if v_row.status_event_at is not null and p_event_at < v_row.status_event_at then
    return jsonb_build_object(
      'applied', false, 'stale', true, 'refused', null, 'conflict', false,
      'linked', v_linked_now, 'user_id', v_row.user_id, 'status', v_row.status,
      'unlimited', coalesce(public.has_unlimited(v_row.user_id), false)
    );
  end if;

  update public.unlimited_subscriptions
     set status                      = p_status,
         -- the first period's trial end is kept once known: a renewal's transaction is not a trial
         trial_end                   = coalesce(p_trial_end, trial_end),
         current_period_end          = p_current_period_end,
         -- null: this payload does not say (a transaction without its renewal info)
         cancel_at_period_end        = coalesce(p_cancel_at_period_end, cancel_at_period_end),
         cancel_at                   = null,
         canceled_at                 = p_canceled_at,
         ended_at                    = p_ended_at,
         apple_environment           = p_environment,
         apple_product_id            = p_product_id,
         apple_latest_transaction_id = coalesce(nullif(left(p_transaction_id, 64), ''), apple_latest_transaction_id),
         apple_price_milliunits      = coalesce(p_price_milliunits, apple_price_milliunits),
         apple_currency              = coalesce(p_currency, apple_currency),
         livemode                    = p_environment = 'Production',
         status_event_at             = p_event_at
   where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'applied', true, 'stale', false, 'refused', null, 'conflict', false,
    'linked', v_linked_now, 'user_id', v_row.user_id, 'status', v_row.status,
    'unlimited', coalesce(public.has_unlimited(v_row.user_id), false)
  );
end;
$$;
revoke all on function public.apply_apple_subscription(text, text, text, text, timestamptz, uuid, uuid, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, bigint, text) from public, anon, authenticated;
grant execute on function public.apply_apple_subscription(text, text, text, text, timestamptz, uuid, uuid, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, bigint, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. unlimited_state_of: + provider
-- -----------------------------------------------------------------------------
-- Same as 20261009010000_family_plan.sql plus `provider`, the shown row's store (null without one).
create or replace function public.unlimited_state_of(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.unlimited_subscriptions%rowtype;
  v_ref uuid;
  v_owner uuid := public.plan_owner_of(p_uid);
begin
  select pr.checkout_ref into v_ref from public.profiles pr where pr.user_id = p_uid;

  select s.* into v_row
  from public.unlimited_subscriptions s
  where s.user_id = v_owner
  order by
    ((s.status = 'active'
      or (s.status = 'trialing' and not public.unlimited_earlier_plan(v_owner, s.id)))
     and (coalesce(s.current_period_end, s.trial_end) is null
          or coalesce(s.current_period_end, s.trial_end) + public.unlimited_grace() > now())) desc nulls last,
    s.updated_at desc,
    s.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'none', 'unlimited', false, 'trial_end', null, 'current_period_end', null,
      'cancel_at_period_end', false, 'cancel_at', null, 'repeat_trial', false, 'checkout_ref', v_ref,
      'provider', null
    );
  end if;
  return jsonb_build_object(
    'status',               v_row.status,
    'unlimited',            public.has_unlimited(p_uid),
    'trial_end',            v_row.trial_end,
    'current_period_end',   v_row.current_period_end,
    'cancel_at_period_end', v_row.cancel_at_period_end,
    'cancel_at',            v_row.cancel_at,
    'repeat_trial',         coalesce(v_row.status = 'trialing' and public.unlimited_earlier_plan(v_owner, v_row.id), false),
    'checkout_ref',         v_ref,
    'provider',             v_row.provider
  );
end;
$$;
revoke all on function public.unlimited_state_of(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. delete_own_account: an Apple subscription does not block
-- -----------------------------------------------------------------------------
-- Same as 20261009010000_family_plan.sql, except `s.provider = 'stripe'` in the refusal (see the
-- header). src/lib/billing/deleteAccount.ts (assertNoChargingPlan) checks the same rule first.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.family_members m where m.child_id = v_uid) then
    raise exception 'Ask your grown-up to remove this profile.'
      using errcode = 'P0001', hint = 'family_kid';
  end if;
  if exists (
    select 1 from public.unlimited_subscriptions s
    where s.user_id = v_uid
      and s.provider = 'stripe'
      and s.status in ('trialing', 'active', 'past_due', 'unpaid')
      and not s.cancel_at_period_end
      and s.cancel_at is null
  ) then
    raise exception 'Cancel Agathon Unlimited before deleting your account, so you are not charged again.'
      using errcode = 'P0001', hint = 'unlimited_active';
  end if;
  -- The kids' accounts first: each kid's boards, learning record and the rest cascade from their
  -- auth user. (Their saved images are removed by DELETE /api/family before this is called.)
  delete from auth.users u
  where u.id in (select m.child_id from public.family_members m where m.parent_id = v_uid);
  delete from auth.users where id = v_uid;
end;
$$;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- PostgREST caches the schema; the new columns and RPC need a reload.
notify pgrst, 'reload schema';
