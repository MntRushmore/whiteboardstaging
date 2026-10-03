-- =============================================================================
-- Agathon Unlimited (2026-10-03). Idempotent; additive to 20261002000000_ink.sql.
--
-- A $25-a-month subscription with a 7-day free trial ("the beta week"), sold through a Stripe
-- subscription Payment Link (scripts/stripe-setup.mjs) whose card is taken up front. While a
-- user's subscription is `trialing` or `active`, help spends NO ink: consume_credits() answers
-- ok without touching the balance, and a fair-use cap applies instead. Ink packs stay for
-- everyone else; nothing about ink changes for a user without the plan.
--
-- The subscription row. Stripe events arrive in any order and only `checkout.session.completed`
-- carries our user id (`client_reference_id`), so a row is keyed by the Stripe subscription id
-- and its user_id is NULLABLE: `customer.subscription.created` may create it with nobody, and the
-- checkout links it later (or the other way round). Both writers are service-role RPCs the billing
-- webhook calls (src/app/api/billing/webhook):
--   link_unlimited_checkout(...)      the checkout: who the subscription belongs to. First link
--                                     wins; a user id that is not an account links nobody.
--   apply_unlimited_subscription(...) a customer.subscription.* event: status, trial end, period
--                                     end, cancellation. Ordered by the event's `created` time,
--                                     so an older event that arrives late never overwrites a
--                                     newer one; `canceled` / `incomplete_expired` are final in
--                                     Stripe, so nothing un-cancels a row.
-- Each is idempotent: a redelivered event writes the same values again.
--
-- Account deletion. user_id is ON DELETE SET NULL, not cascade: the row is what tells the owner a
-- Stripe subscription exists for an account that is gone (Stripe still holds the customer; we
-- have no server key to cancel it). Without a user it grants nothing to anyone, and it carries no
-- personal data (Stripe ids, status, dates). delete_own_account() now REFUSES while the caller has
-- a subscription that will charge again (trialing / active / past_due / unpaid and not set to
-- cancel): the student's grown-up cancels it in the customer portal first, and the account page
-- says so before the RPC is ever called (src/components/account/DangerZone.tsx).
--
-- Who has Unlimited: has_unlimited(uid) = a row of theirs in `trialing` or `active` whose period
-- (current_period_end, else trial_end) has not ended more than unlimited_grace() ago. The grace
-- (3 days, Stripe's own retry window for a failed webhook delivery) covers a renewal whose
-- `customer.subscription.updated` is late; past it, help spends ink again and the account page
-- reads the plan as a payment problem (the portal shows the truth). `past_due` is NOT unlimited:
-- a failed renewal falls back to ink (owner's call: the plan is paid for, or it is not).
--
-- Fair use. Each AI action a subscriber takes is recorded in unlimited_usage (route, the ink it
-- would have cost, request id): no balance moves. Over unlimited_fair_use_per_day() actions in
-- the last 24 hours (rolling, not a calendar day), consume_credits() answers
-- {ok: false, reason: 'fair_use', retry_after_ms} and the route answers 429 rate_limited, as for
-- any rate limit (src/lib/server/billing.ts), never 402 out-of-ink. A request id already recorded
-- is free and not counted again: lecture mode asks for its minute's charge under one id on every
-- tick of that minute (src/app/api/live/lecture/route.ts), and counting each tick would use the
-- day's allowance ten times over. Why not rate_limit_hit(): it cannot tell a repeat request id
-- from a new one, it cannot give a failed call its count back, and this table is also the record
-- of what subscribers actually use, which the price has to cover. To change the cap, replace
-- unlimited_fair_use_per_day() in a new migration: no deploy needed.
--
-- Refunds of failed calls. refund_ink_for() (service role) still gives back only the ink a call
-- spent: a subscriber's call spent none (no usage_events row), so its refund returns 0 and can
-- never mint ink. It now also removes that call's unlimited_usage row, so a failed call does not
-- count toward fair use (the same 15-minute window as ink refunds).
--
-- The client reads the plan through ink_summary(), which gains one key, so a page makes one
-- request for both (src/lib/billing/useInkSummary.ts, useUnlimited.ts):
--   unlimited: { status, unlimited, trial_end, current_period_end, cancel_at_period_end, cancel_at }
-- status is Stripe's ('trialing', 'active', 'past_due', 'canceled', ...), null while the checkout
-- has linked the row but no subscription event has arrived yet, or 'none' without a row;
-- `unlimited` is has_unlimited() (the server's answer, grace included).
--
-- Objects created or changed here:
--   tables     unlimited_subscriptions, unlimited_usage
--   functions  unlimited_fair_use_per_day(), unlimited_grace(), has_unlimited(uuid),
--              unlimited_state_of(uuid), link_unlimited_checkout(text,uuid,text,text,boolean),
--              apply_unlimited_subscription(text,text,text,text,timestamptz,timestamptz,boolean,
--              timestamptz,timestamptz,timestamptz,boolean,timestamptz)
--   replaced   ink_summary() (adds `unlimited`), consume_credits(text,int,text,text) (the
--              Unlimited branch), refund_ink_for(uuid,text) (also unlimited_usage),
--              delete_own_account() (refuses while a subscription will charge again)
--
-- Deploy order: BEFORE the code that sells the plan (docs/RUNBOOK-billing.md section 10). The
-- current code is fine on it: nobody has a subscription until the Payment Link is live, so
-- consume_credits(), refund_ink_for() and delete_own_account() behave exactly as before, and
-- ink_summary()'s extra key is ignored by the old client.
--
-- Supabase's default privileges grant ALL on every new public table/function to anon,
-- authenticated and service_role, so each object revokes first and then grants exactly what the
-- client uses.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. unlimited_subscriptions (one row per Stripe subscription; service role writes, owner reads)
-- -----------------------------------------------------------------------------
create table if not exists public.unlimited_subscriptions (
  id                     bigint      generated always as identity primary key,
  stripe_subscription_id text        not null check (char_length(stripe_subscription_id) between 1 and 255),
  -- null until the checkout links it (or for good, when the Payment Link was opened outside the
  -- app, or the account was deleted)
  user_id                uuid        references auth.users (id) on delete set null,
  stripe_customer_id     text        check (stripe_customer_id is null or char_length(stripe_customer_id) <= 255),
  checkout_session_id    text        check (checkout_session_id is null or char_length(checkout_session_id) <= 255),
  -- Stripe's subscription status; null until the first customer.subscription.* event arrives
  status                 text        check (status is null or status in (
                                       'incomplete', 'incomplete_expired', 'trialing', 'active',
                                       'past_due', 'canceled', 'unpaid', 'paused')),
  price_id               text        check (price_id is null or char_length(price_id) <= 255),
  trial_end              timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean     not null default false,
  cancel_at              timestamptz,
  canceled_at            timestamptz,
  ended_at               timestamptz,
  livemode               boolean,
  -- the `created` time of the Stripe event whose state the row holds (orders late deliveries)
  status_event_at        timestamptz,
  linked_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- The idempotency key: one row per Stripe subscription, whichever event arrives first.
create unique index if not exists unlimited_subscriptions_subscription_key on public.unlimited_subscriptions (stripe_subscription_id);
create index if not exists unlimited_subscriptions_user_idx on public.unlimited_subscriptions (user_id) where user_id is not null;

drop trigger if exists unlimited_subscriptions_set_updated_at on public.unlimited_subscriptions;
create trigger unlimited_subscriptions_set_updated_at
  before update on public.unlimited_subscriptions
  for each row execute function public.set_updated_at();

alter table public.unlimited_subscriptions enable row level security;

drop policy if exists "unlimited_subscriptions: owner select" on public.unlimited_subscriptions;
create policy "unlimited_subscriptions: owner select"
  on public.unlimited_subscriptions for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No client writes: a user who could insert or update a row could give themselves the plan.
revoke all on public.unlimited_subscriptions from public, anon, authenticated;
grant select on public.unlimited_subscriptions to authenticated;
grant all on public.unlimited_subscriptions to service_role;

-- -----------------------------------------------------------------------------
-- 2. unlimited_usage (what a subscriber's help would have cost; consume_credits writes, owner reads)
-- -----------------------------------------------------------------------------
create table if not exists public.unlimited_usage (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  route       text        not null check (char_length(route) between 1 and 100),
  units       integer     not null check (units > 0),   -- the ink the action would have cost
  model       text        check (model is null or char_length(model) <= 200),
  request_id  text        check (request_id is null or char_length(request_id) <= 100),
  created_at  timestamptz not null default now()
);

-- The fair-use count (the caller's rows of the last 24 hours) and the per-request dedupe.
create index if not exists unlimited_usage_user_created_idx on public.unlimited_usage (user_id, created_at desc);
create unique index if not exists unlimited_usage_user_request_key on public.unlimited_usage (user_id, request_id) where request_id is not null;

alter table public.unlimited_usage enable row level security;

drop policy if exists "unlimited_usage: owner select" on public.unlimited_usage;
create policy "unlimited_usage: owner select"
  on public.unlimited_usage for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.unlimited_usage from public, anon, authenticated;
grant select on public.unlimited_usage to authenticated;
grant all on public.unlimited_usage to service_role;

-- -----------------------------------------------------------------------------
-- 3. The plan's constants and who has it
-- -----------------------------------------------------------------------------
-- The fair-use cap: AI actions per rolling 24 hours (each read, check, solve, chat message,
-- lecture minute, drawing counts one). About eight hours of steady work; nobody doing homework
-- meets it. ONE constant: change it here (a new migration), nowhere else.
create or replace function public.unlimited_fair_use_per_day()
returns integer
language sql
immutable
set search_path = public
as $$ select 1500 $$;
revoke all on function public.unlimited_fair_use_per_day() from public, anon, authenticated;

-- How long after its period end a trialing/active row still counts (a late renewal event).
create or replace function public.unlimited_grace()
returns interval
language sql
immutable
set search_path = public
as $$ select interval '3 days' $$;
revoke all on function public.unlimited_grace() from public, anon, authenticated;

-- Internal (consume_credits, the summary): not executable by users, so nobody can ask about
-- another account's plan.
create or replace function public.has_unlimited(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null and exists (
    select 1
    from public.unlimited_subscriptions s
    where s.user_id = p_uid
      and s.status in ('trialing', 'active')
      and (
        coalesce(s.current_period_end, s.trial_end) is null
        or coalesce(s.current_period_end, s.trial_end) + public.unlimited_grace() > now()
      )
  )
$$;
revoke all on function public.has_unlimited(uuid) from public, anon, authenticated;

-- Internal: the plan as the account page shows it. With several rows (a cancelled plan, then a
-- new one), the one that grants Unlimited wins, else the latest.
create or replace function public.unlimited_state_of(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.unlimited_subscriptions%rowtype;
begin
  select s.* into v_row
  from public.unlimited_subscriptions s
  where s.user_id = p_uid
  order by
    (s.status in ('trialing', 'active')
      and (coalesce(s.current_period_end, s.trial_end) is null
           or coalesce(s.current_period_end, s.trial_end) + public.unlimited_grace() > now())) desc nulls last,
    s.updated_at desc,
    s.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'none', 'unlimited', false, 'trial_end', null, 'current_period_end', null,
      'cancel_at_period_end', false, 'cancel_at', null
    );
  end if;
  return jsonb_build_object(
    'status',               v_row.status,
    'unlimited',            public.has_unlimited(p_uid),
    'trial_end',            v_row.trial_end,
    'current_period_end',   v_row.current_period_end,
    'cancel_at_period_end', v_row.cancel_at_period_end,
    'cancel_at',            v_row.cancel_at
  );
end;
$$;
revoke all on function public.unlimited_state_of(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. ink_summary() carries the plan
-- -----------------------------------------------------------------------------
-- Same as 20261002000000_ink.sql plus the `unlimited` key (one request for the ink meter, the
-- account page and useUnlimited).
create or replace function public.ink_summary()
returns jsonb
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
  perform public.ensure_ink_account(v_uid);
  return public.ink_summary_of(v_uid) || jsonb_build_object('unlimited', public.unlimited_state_of(v_uid));
end;
$$;
revoke all on function public.ink_summary() from public, anon;
grant execute on function public.ink_summary() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Spending: nothing while the plan is on, a fair-use cap instead
-- -----------------------------------------------------------------------------
-- Same as 20261002000000_ink.sql (validation, the profile lock, the refusal without writes) plus
-- the Unlimited branch after the lock, so a subscriber's parallel calls serialise too and the cap
-- is exact. The answer gains `unlimited: true` for a subscriber (remaining = the untouched
-- balance), and `reason: 'fair_use'` with `retry_after_ms` over the cap.
create or replace function public.consume_credits(
  p_route      text,
  p_units      integer,
  p_request_id text default null,
  p_model      text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer;
  v_request text := left(p_request_id, 100);
  v_used integer;
  v_oldest timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_units is null or p_units < 1 or p_units > 1000 then
    raise exception 'p_units must be between 1 and 1000' using errcode = '22023';
  end if;
  if p_route is null or char_length(p_route) < 1 or char_length(p_route) > 100 then
    raise exception 'p_route must be 1..100 characters' using errcode = '22023';
  end if;

  perform public.ensure_ink_account(v_uid);

  select pr.ink_balance into v_balance
  from public.profiles pr
  where pr.user_id = v_uid
  for update;

  if not found then
    raise exception 'account not found' using errcode = '42501';
  end if;

  if public.has_unlimited(v_uid) then
    -- This request id is already recorded (a lecture minute's later ticks): free, not counted again.
    if v_request is not null
       and exists (select 1 from public.unlimited_usage u where u.user_id = v_uid and u.request_id = v_request) then
      return jsonb_build_object('ok', true, 'remaining', v_balance, 'reason', null, 'unlimited', true);
    end if;

    select count(*)::integer, min(u.created_at) into v_used, v_oldest
    from public.unlimited_usage u
    where u.user_id = v_uid and u.created_at > now() - interval '24 hours';

    if v_used >= public.unlimited_fair_use_per_day() then
      -- A slot frees when the oldest action of the window turns 24 hours old.
      return jsonb_build_object(
        'ok', false, 'remaining', v_balance, 'reason', 'fair_use', 'unlimited', true,
        'retry_after_ms', greatest(1000, least(86400000, ceil(extract(epoch from (v_oldest + interval '24 hours' - now())) * 1000)))::integer
      );
    end if;

    insert into public.unlimited_usage (user_id, route, units, model, request_id)
    values (v_uid, p_route, p_units, left(p_model, 200), v_request)
    on conflict (user_id, request_id) where request_id is not null do nothing;

    return jsonb_build_object('ok', true, 'remaining', v_balance, 'reason', null, 'unlimited', true);
  end if;

  if v_balance < p_units then
    return jsonb_build_object('ok', false, 'remaining', v_balance, 'reason', 'insufficient_credits');
  end if;

  -- The usage_events_apply_insert trigger takes the ink off the balance.
  insert into public.usage_events (user_id, route, units, model, request_id)
  values (v_uid, p_route, p_units, left(p_model, 200), v_request);

  return jsonb_build_object('ok', true, 'remaining', v_balance - p_units, 'reason', null);
end;
$$;
revoke all on function public.consume_credits(text, integer, text, text) from public, anon;
grant execute on function public.consume_credits(text, integer, text, text) to authenticated;

-- Same as 20261002000000_ink.sql (the ink part is unchanged: only usage_events rows give ink back,
-- and a subscriber's call wrote none), plus: the call's unlimited_usage row goes too, so a failed
-- call does not count toward fair use. `refunded` stays the ink given back.
create or replace function public.refund_ink_for(p_user_id uuid, p_request_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_refunded integer := 0;
  v_balance integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;
  if p_request_id is null or char_length(p_request_id) < 1 or char_length(p_request_id) > 100 then
    raise exception 'p_request_id must be 1..100 characters' using errcode = '22023';
  end if;

  -- Same lock consume_credits() takes, so a refund and a spend for one user serialise.
  perform 1 from public.profiles pr where pr.user_id = p_user_id for update;

  -- The one path allowed to delete usage rows (ink_ledger_guard_delete), for this statement only.
  perform set_config('agathon.ink_refund', 'on', true);
  with gone as (
    delete from public.usage_events u
    where u.user_id = p_user_id
      and u.request_id = p_request_id
      and u.created_at > now() - interval '15 minutes'
    returning u.units
  )
  select coalesce(sum(units), 0)::integer into v_refunded from gone;
  perform set_config('agathon.ink_refund', 'off', true);

  delete from public.unlimited_usage u
  where u.user_id = p_user_id
    and u.request_id = p_request_id
    and u.created_at > now() - interval '15 minutes';

  select pr.ink_balance into v_balance from public.profiles pr where pr.user_id = p_user_id;
  return jsonb_build_object('refunded', v_refunded, 'remaining', coalesce(v_balance, 0));
end;
$$;
revoke all on function public.refund_ink_for(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_ink_for(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 6. The webhook's writers (service role only)
-- -----------------------------------------------------------------------------
-- checkout.session.completed (mode subscription): the subscription belongs to the user in
-- client_reference_id. Creates the row when the subscription's own event has not arrived yet.
-- First link wins: a row already linked keeps its user (`conflict: true` when another was named).
-- A user id that is not an account (deleted before the webhook, or none: a Payment Link opened
-- outside the app) links nobody, and the owner links it by hand (docs/RUNBOOK-billing.md).
create or replace function public.link_unlimited_checkout(
  p_subscription_id     text,
  p_user_id             uuid,
  p_customer_id         text default null,
  p_checkout_session_id text default null,
  p_livemode            boolean default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_row public.unlimited_subscriptions%rowtype;
begin
  if p_subscription_id is null or char_length(p_subscription_id) < 1 or char_length(p_subscription_id) > 255 then
    raise exception 'p_subscription_id must be 1..255 characters' using errcode = '22023';
  end if;
  if p_user_id is not null then
    select u.id into v_user from auth.users u where u.id = p_user_id;
  end if;

  insert into public.unlimited_subscriptions as s (
    stripe_subscription_id, user_id, stripe_customer_id, checkout_session_id, livemode, linked_at
  )
  values (
    p_subscription_id, v_user, nullif(left(p_customer_id, 255), ''), nullif(left(p_checkout_session_id, 255), ''),
    p_livemode, case when v_user is not null then now() end
  )
  on conflict (stripe_subscription_id) do update
    set user_id             = coalesce(s.user_id, excluded.user_id),
        linked_at           = coalesce(s.linked_at, excluded.linked_at),
        stripe_customer_id  = coalesce(s.stripe_customer_id, excluded.stripe_customer_id),
        checkout_session_id = coalesce(s.checkout_session_id, excluded.checkout_session_id),
        livemode            = coalesce(s.livemode, excluded.livemode)
  returning s.* into v_row;

  return jsonb_build_object(
    'linked',     v_user is not null and v_row.user_id = v_user,
    'user_id',    v_row.user_id,
    'no_account', p_user_id is not null and v_user is null,
    'conflict',   v_user is not null and v_row.user_id is distinct from v_user,
    'status',     v_row.status,
    'unlimited',  coalesce(public.has_unlimited(v_row.user_id), false)
  );
end;
$$;
revoke all on function public.link_unlimited_checkout(text, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.link_unlimited_checkout(text, uuid, text, text, boolean) to service_role;

-- customer.subscription.created / updated / deleted: the subscription's state. Creates the row
-- (with nobody) when the checkout has not linked it yet. Applied only when the event is not older
-- than the one the row already holds (`p_event_at` is the event's `created`; null = now), and never
-- out of a final state: a late `created` cannot revive a `deleted`. Answers stale:true for a skip.
create or replace function public.apply_unlimited_subscription(
  p_subscription_id      text,
  p_customer_id          text,
  p_status               text,
  p_price_id             text default null,
  p_trial_end            timestamptz default null,
  p_current_period_end   timestamptz default null,
  p_cancel_at_period_end boolean default false,
  p_cancel_at            timestamptz default null,
  p_canceled_at          timestamptz default null,
  p_ended_at             timestamptz default null,
  p_livemode             boolean default null,
  p_event_at             timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.unlimited_subscriptions%rowtype;
  v_event_at timestamptz := coalesce(p_event_at, now());
  v_final constant text[] := array['canceled', 'incomplete_expired'];
begin
  if p_subscription_id is null or char_length(p_subscription_id) < 1 or char_length(p_subscription_id) > 255 then
    raise exception 'p_subscription_id must be 1..255 characters' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused') then
    raise exception 'unknown subscription status %', coalesce(p_status, '(null)') using errcode = '22023';
  end if;

  -- The row, whichever event came first; then locked, so two deliveries for it serialise.
  insert into public.unlimited_subscriptions (stripe_subscription_id) values (p_subscription_id)
  on conflict (stripe_subscription_id) do nothing;
  select * into v_row from public.unlimited_subscriptions where stripe_subscription_id = p_subscription_id for update;

  if (v_row.status = any (v_final) and not (p_status = any (v_final)))
     or (v_row.status_event_at is not null and v_event_at < v_row.status_event_at) then
    return jsonb_build_object(
      'applied', false, 'stale', true, 'user_id', v_row.user_id, 'status', v_row.status,
      'unlimited', coalesce(public.has_unlimited(v_row.user_id), false)
    );
  end if;

  update public.unlimited_subscriptions
     set status               = p_status,
         stripe_customer_id   = coalesce(stripe_customer_id, nullif(left(p_customer_id, 255), '')),
         price_id             = coalesce(nullif(left(p_price_id, 255), ''), price_id),
         trial_end            = p_trial_end,
         current_period_end   = p_current_period_end,
         cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
         cancel_at            = p_cancel_at,
         canceled_at          = p_canceled_at,
         ended_at             = p_ended_at,
         livemode             = coalesce(p_livemode, livemode),
         status_event_at      = v_event_at
   where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'applied', true, 'stale', false, 'user_id', v_row.user_id, 'status', v_row.status,
    'unlimited', coalesce(public.has_unlimited(v_row.user_id), false)
  );
end;
$$;
revoke all on function public.apply_unlimited_subscription(text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, timestamptz, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_unlimited_subscription(text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, timestamptz, boolean, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 7. Account deletion waits for the plan to be cancelled
-- -----------------------------------------------------------------------------
-- Same as 20260917020000_accounts_billing.sql, plus the refusal: with no server key nothing here
-- can cancel a Stripe subscription, so deleting the account first would leave a grown-up's card
-- being charged for an account that no longer exists. A plan set to cancel (cancel_at_period_end
-- or cancel_at), ended, paused or never started does not block. The client checks the same rule
-- first and sends the user to the portal; this is the backstop. PostgREST answers 400 with
-- {code: 'P0001', hint: 'unlimited_active'}.
create or replace function public.delete_own_account()
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
  if exists (
    select 1 from public.unlimited_subscriptions s
    where s.user_id = v_uid
      and s.status in ('trialing', 'active', 'past_due', 'unpaid')
      and not s.cancel_at_period_end
      and s.cancel_at is null
  ) then
    raise exception 'Cancel Agathon Unlimited before deleting your account, so you are not charged again.'
      using errcode = 'P0001', hint = 'unlimited_active';
  end if;
  delete from auth.users where id = v_uid;
end;
$$;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- PostgREST caches the schema; the new tables and RPCs need a reload.
notify pgrst, 'reload schema';
