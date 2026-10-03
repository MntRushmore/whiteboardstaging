-- =============================================================================
-- Ink (2026-10-02). Idempotent; replaces the monthly credits of
-- 20260917020000_accounts_billing.sql and the plans of 20260928110000_paid_plans.sql.
--
-- Ink is the unit now. 1 ink = 1 old credit (ROUTE_COSTS in src/lib/server/billing.ts are
-- unchanged). Ink never expires and never resets: a student gets 300 starter ink ONCE when
-- the account is made, buys more in packs (one-time Stripe payments), and every AI action
-- spends some. Drawing on your own costs nothing. There are no plans or subscriptions any
-- more: plus and pro are deactivated and every profile is moved to 'free' (the row stays
-- because profiles.plan_id references it).
--
--   balance = all ink granted (starter, purchases, manual grants, refund reversals)
--           - all ink used (usage_events, the same ledger as before)
--
-- The balance is STORED (profiles.ink_balance, CHECK >= 0) and kept by triggers on the two
-- ledgers, in the same transaction as the ledger row that changes it:
--   ink_grants   AFTER INSERT  -> balance += units   (units are signed: a refund is negative)
--   usage_events AFTER INSERT  -> balance -= units   (consume_credits)
--   usage_events AFTER DELETE  -> balance += units   (refund_ink_for gives a failed call back)
-- A ledger row for a user without a profile row creates that row first, so no row can land
-- without moving the balance.
-- Why stored and not lock-and-sum: the ledger is all-time now. A summing balance would read
-- every row a student ever wrote (one per handwriting read, thousands a month) on every paid
-- call, forever; the stored balance is one row. Parallel spends still serialise:
-- consume_credits() locks the caller's profiles row FOR UPDATE before it reads the balance, so
-- two requests can never both spend the last ink, and the CHECK makes a negative balance
-- impossible even for a buggy writer (the statement fails instead). Because the triggers do
-- the bookkeeping, an operator's plain `insert into ink_grants` keeps the balance right too.
-- Ledger rows are append-only: corrections are new rows (negative units). Triggers refuse edits
-- to units/user_id, and refuse DELETES from usage_events, ink_grants, ink_purchases and profiles
-- (which holds the stored balance) with two exceptions: the account is being deleted (its
-- auth.users row is gone when the cascade arrives), and refund_ink_for() deleting a failed call's
-- usage row (it sets agathon.ink_refund for its own statement). Chosen over adjusting the balance
-- in a delete trigger: a deleted usage row would mint ink, a deleted grant or purchase would
-- erase history and an idempotency key, a deleted profile would come back with a zero balance,
-- and no legitimate path needs any of them. Rows the ledgers held before this migration
-- (monthly-credit history) are not counted: they were never seen by the triggers.
--
-- Starter ink: handle_new_user() grants 300 after it creates the profile (one 'starter' row per
-- user, enforced by a partial unique index; a failure is logged and never blocks sign-up, and
-- consume_credits() / the summaries grant a missing one on first use). Existing accounts (the
-- beta) get ONE starter grant of max(300, what they had left this month under the old rules),
-- so nobody loses ink they could see the day before.
--
-- Purchases: ink_purchases records each paid Checkout Session once (UNIQUE
-- checkout_session_id, so a replayed or duplicate webhook never grants twice) and the
-- 'purchase' grant that came with it. Only when the money covers the pack (the session's amount,
-- in USD, at least the pack's price): an underpaid, unpriced or free session, an unknown pack, an
-- account deleted before the webhook, or an Agathon checkout the webhook cannot match to a user
-- is recorded in ink_checkout_reviews with NO ink (service role only), for the owner to resolve. A refund (charge.refunded) reverses the refunded share of
-- the pack's ink, but at most what is still unspent: the balance never goes negative, and the
-- purchase row records what was reversed (refunded_ink) and what had already been spent
-- (refund_unrecovered_ink). Repeated refund events only act on the increase of the cumulative
-- refunded amount, so a replay reverses nothing.
--
-- RPCs keep the names and argument signatures src/lib/server/billing.ts and main's client call:
--   consume_credits(p_route, p_units, p_request_id?, p_model?) -> { ok, remaining, reason }
--     reason stays 'insufficient_credits' (an internal string; the HTTP error is ink_empty)
--   refund_credits(p_request_id)  NO LONGER executable by users: a user who could refund their
--                        own request ids (every 2xx returns one) could get any call's ink back.
--                        Failed calls are refunded by the server with refund_ink_for (service role).
--   credit_summary()  -> the old keys, consistent (monthly_credits 0, granted = lifetime ink
--                        granted, used = lifetime ink used, remaining = balance), plus balance
--   usage_by_day(p_time_zone, p_days?)  same columns (credits = ink); p_days null = this UTC
--                        month as before, else the last p_days calendar days in p_time_zone
--   ink_summary()     -> { balance, granted, purchased, refunded, used, starter, starter_at,
--                          purchases, last_purchase }  (the ink UI reads this one)
-- Service role only (the API's refunds, the billing webhook, the runbook):
--   refund_ink_for(user, request_id), grant_ink_purchase(...), reverse_ink_purchase(...),
--   record_ink_checkout_review(...), resolve_ink_checkout_review(review_id, user?, pack?, note?),
--   grant_ink(user, units, reason)
--
-- Objects created or changed here:
--   tables     ink_packs (catalogue, seeded), ink_grants, ink_purchases, ink_checkout_reviews
--   columns    profiles.ink_balance
--   functions  ink_starter_amount(), ensure_ink_account(uuid), ink_ledger_grant() [trigger],
--              ink_ledger_usage() [trigger], ink_ledger_immutable() [trigger],
--              ink_ledger_guard_delete() [trigger], ink_summary_of(uuid), ink_summary(),
--              refund_ink_for(uuid,text), grant_ink(uuid,int,text),
--              record_ink_checkout_review(text,text,text,text,text,text,int,text,text,text),
--              grant_ink_purchase(uuid,text,text,text,text,int,text,text,text),
--              reverse_ink_purchase(text,int,int,boolean),
--              resolve_ink_checkout_review(bigint,uuid,text,text)
--   replaced   handle_new_user(), credit_balance(uuid), credit_summary(), consume_credits(...),
--              refund_credits(text) (users lose execute), usage_by_day(text) -> usage_by_day(text, integer)
--   triggers   ink_grants_apply, ink_grants_immutable, ink_grants_guard_delete,
--              ink_purchases_guard_delete, profiles_guard_delete, usage_events_apply_insert,
--              usage_events_apply_delete, usage_events_guard_delete, usage_events_immutable
--   rows       plans plus/pro deactivated; profiles moved to 'free'; one starter grant per
--              existing account
--
-- Supabase's default privileges grant ALL on every new public table/function to anon,
-- authenticated and service_role, so each object revokes first and then grants exactly what
-- the client uses. docs/RUNBOOK-billing.md is the operator side (packs, prices, manual grants,
-- refunds, going live).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ink_packs (catalogue; readable by every signed-in user, never writable via the API)
-- -----------------------------------------------------------------------------
create table if not exists public.ink_packs (
  id          text    primary key,
  name        text    not null check (char_length(name) between 1 and 40),
  ink         integer not null check (ink > 0),
  price_cents integer not null check (price_cents > 0),
  sort        integer not null default 0,
  active      boolean not null default true,
  constraint ink_packs_id_format check (id ~ '^[a-z][a-z0-9_-]{0,31}$')
);

-- The owner's prices (2026-10-02), USD. Two places hold them and must agree: this seed (what the
-- app shows and grants) and PACKS at the top of scripts/stripe-setup.mjs (what Stripe charges);
-- src/__tests__/stripeSetup.test.ts pins the two together. Re-applied on every run.
insert into public.ink_packs (id, name, ink, price_cents, sort, active) values
  ('small',  'Small',  1000,  500,  1, true),
  ('medium', 'Medium', 5000,  2000, 2, true),
  ('large',  'Large',  14000, 5000, 3, true)
on conflict (id) do update
  set name        = excluded.name,
      ink         = excluded.ink,
      price_cents = excluded.price_cents,
      sort        = excluded.sort,
      active      = excluded.active;

alter table public.ink_packs enable row level security;

-- Inactive packs stay readable: purchase history names the pack that was bought.
drop policy if exists "ink_packs: authenticated select" on public.ink_packs;
create policy "ink_packs: authenticated select"
  on public.ink_packs for select
  to authenticated
  using (true);

revoke all on public.ink_packs from public, anon, authenticated;
grant select on public.ink_packs to authenticated;
grant all on public.ink_packs to service_role;

-- -----------------------------------------------------------------------------
-- 2. profiles.ink_balance (the stored balance; users can read it, never write it)
-- -----------------------------------------------------------------------------
-- The column-level grant from 20260917020000 (update (display_name) only) already keeps it out
-- of reach: PATCH {ink_balance} fails with 42501.
alter table public.profiles add column if not exists ink_balance integer not null default 0;
alter table public.profiles drop constraint if exists profiles_ink_balance_nonnegative;
alter table public.profiles add constraint profiles_ink_balance_nonnegative check (ink_balance >= 0);

-- -----------------------------------------------------------------------------
-- 3. ink_purchases (one row per paid Checkout Session; service role writes, owner reads)
-- -----------------------------------------------------------------------------
create table if not exists public.ink_purchases (
  id                     bigint      generated always as identity primary key,
  user_id                uuid        not null references auth.users (id) on delete cascade,
  pack_id                text        not null references public.ink_packs (id),
  ink                    integer     not null check (ink > 0),            -- the pack's ink when bought
  amount_cents           integer     not null check (amount_cents >= 0),  -- what Stripe charged
  currency               text        not null default 'usd' check (char_length(currency) between 3 and 8),
  checkout_session_id    text        not null check (char_length(checkout_session_id) between 1 and 255),
  payment_intent_id      text        check (payment_intent_id is null or char_length(payment_intent_id) <= 255),
  customer_id            text        check (customer_id is null or char_length(customer_id) <= 255),
  status                 text        not null default 'paid' check (status in ('paid', 'partially_refunded', 'refunded')),
  refunded_cents         integer     not null default 0 check (refunded_cents >= 0),
  refunded_ink           integer     not null default 0 check (refunded_ink >= 0),           -- ink actually taken back
  refund_unrecovered_ink integer     not null default 0 check (refund_unrecovered_ink >= 0), -- already spent when refunded
  refunded_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- The idempotency key: a Checkout Session pays for exactly one pack, once.
create unique index if not exists ink_purchases_checkout_session_key on public.ink_purchases (checkout_session_id);
-- How charge.refunded finds the purchase.
create unique index if not exists ink_purchases_payment_intent_key
  on public.ink_purchases (payment_intent_id) where payment_intent_id is not null;
create index if not exists ink_purchases_user_created_idx on public.ink_purchases (user_id, created_at desc);

drop trigger if exists ink_purchases_set_updated_at on public.ink_purchases;
create trigger ink_purchases_set_updated_at
  before update on public.ink_purchases
  for each row execute function public.set_updated_at();

alter table public.ink_purchases enable row level security;

drop policy if exists "ink_purchases: owner select" on public.ink_purchases;
create policy "ink_purchases: owner select"
  on public.ink_purchases for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.ink_purchases from public, anon, authenticated;
grant select on public.ink_purchases to authenticated;
grant all on public.ink_purchases to service_role;

-- -----------------------------------------------------------------------------
-- 4. ink_grants (every ink that came in, all-time; service role / functions write, owner reads)
-- -----------------------------------------------------------------------------
create table if not exists public.ink_grants (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  units       integer     not null check (units <> 0),   -- negative: a refund reversal or a correction
  kind        text        not null check (kind in ('starter', 'purchase', 'refund', 'manual')),
  purchase_id bigint      references public.ink_purchases (id) on delete cascade,
  reason      text        check (reason is null or char_length(reason) <= 200),
  created_at  timestamptz not null default now(),
  constraint ink_grants_purchase_link check ((kind in ('purchase', 'refund')) = (purchase_id is not null)),
  constraint ink_grants_sign check (
    (kind in ('starter', 'purchase') and units > 0) or (kind = 'refund' and units < 0) or kind = 'manual'
  )
);

create index if not exists ink_grants_user_created_idx on public.ink_grants (user_id, created_at desc);
-- One starter per account (the sign-up trigger, the beta backfill and the self-heal all insert
-- with `on conflict do nothing` against this), and one purchase grant per purchase.
create unique index if not exists ink_grants_one_starter on public.ink_grants (user_id) where kind = 'starter';
create unique index if not exists ink_grants_one_per_purchase on public.ink_grants (purchase_id) where kind = 'purchase';

alter table public.ink_grants enable row level security;

drop policy if exists "ink_grants: owner select" on public.ink_grants;
create policy "ink_grants: owner select"
  on public.ink_grants for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.ink_grants from public, anon, authenticated;
grant select on public.ink_grants to authenticated;
grant all on public.ink_grants to service_role;

-- -----------------------------------------------------------------------------
-- 5. The balance triggers and the ledger guards
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so the bookkeeping happens whoever writes the ledger (a definer RPC, the
-- service role, an operator in the SQL editor). A ledger row for a user without a profile row
-- creates it first (a sign-up whose profile insert failed), so a row can never land without
-- moving the balance.
create or replace function public.ink_ledger_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.user_id) on conflict (user_id) do nothing;
  update public.profiles set ink_balance = ink_balance + new.units where user_id = new.user_id;
  return null;
end;
$$;
revoke all on function public.ink_ledger_grant() from public, anon, authenticated;

create or replace function public.ink_ledger_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (user_id) values (new.user_id) on conflict (user_id) do nothing;
    update public.profiles set ink_balance = ink_balance - new.units where user_id = new.user_id;
  else
    -- Only refund_ink_for() and an account deletion's cascade get here (ink_ledger_guard_delete):
    -- the refunded call's ink comes back. In the cascade the profile may already be gone.
    update public.profiles set ink_balance = ink_balance + old.units where user_id = old.user_id;
  end if;
  return null;
end;
$$;
revoke all on function public.ink_ledger_usage() from public, anon, authenticated;

-- Append-only: who and how much never change once written (fixing a mistake is a new row).
create or replace function public.ink_ledger_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id or new.units is distinct from old.units then
    raise exception 'ink ledger rows are append-only: insert a correction instead' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.ink_ledger_immutable() from public, anon, authenticated;

-- No deletes from the ledgers, the purchases or the profiles, by anyone, with two exceptions: the
-- account is being deleted (its auth.users row is already gone when the cascade reaches these
-- tables), and refund_ink_for() giving a failed call's usage row back (it sets agathon.ink_refund
-- for its own statement). A deleted usage row would otherwise mint ink, a deleted grant or
-- purchase would leave the balance as it was (and a purchase's idempotency key gone), and a
-- deleted profile would come back (ensure_ink_account) with a zero balance.
create or replace function public.ink_ledger_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  if tg_table_name = 'usage_events' and current_setting('agathon.ink_refund', true) = 'on' then
    return old;
  end if;
  raise exception '% rows cannot be deleted (the ink balance depends on them): insert a correction, or delete the account', tg_table_name
    using errcode = '42501';
end;
$$;
revoke all on function public.ink_ledger_guard_delete() from public, anon, authenticated;

drop trigger if exists ink_grants_apply on public.ink_grants;
create trigger ink_grants_apply
  after insert on public.ink_grants
  for each row execute function public.ink_ledger_grant();

drop trigger if exists ink_grants_immutable on public.ink_grants;
create trigger ink_grants_immutable
  before update on public.ink_grants
  for each row execute function public.ink_ledger_immutable();

drop trigger if exists ink_grants_guard_delete on public.ink_grants;
create trigger ink_grants_guard_delete
  before delete on public.ink_grants
  for each row execute function public.ink_ledger_guard_delete();

drop trigger if exists ink_purchases_guard_delete on public.ink_purchases;
create trigger ink_purchases_guard_delete
  before delete on public.ink_purchases
  for each row execute function public.ink_ledger_guard_delete();

drop trigger if exists profiles_guard_delete on public.profiles;
create trigger profiles_guard_delete
  before delete on public.profiles
  for each row execute function public.ink_ledger_guard_delete();

drop trigger if exists usage_events_apply_insert on public.usage_events;
create trigger usage_events_apply_insert
  after insert on public.usage_events
  for each row execute function public.ink_ledger_usage();

drop trigger if exists usage_events_apply_delete on public.usage_events;
create trigger usage_events_apply_delete
  after delete on public.usage_events
  for each row execute function public.ink_ledger_usage();

drop trigger if exists usage_events_guard_delete on public.usage_events;
create trigger usage_events_guard_delete
  before delete on public.usage_events
  for each row execute function public.ink_ledger_guard_delete();

drop trigger if exists usage_events_immutable on public.usage_events;
create trigger usage_events_immutable
  before update on public.usage_events
  for each row execute function public.ink_ledger_immutable();

-- -----------------------------------------------------------------------------
-- 6. Starter ink and the account self-heal
-- -----------------------------------------------------------------------------
create or replace function public.ink_starter_amount()
returns integer
language sql
immutable
set search_path = public
as $$ select 300 $$;
revoke all on function public.ink_starter_amount() from public, anon, authenticated;

-- Internal: make sure the user has a profile and their starter ink. Does nothing for a user that
-- no longer exists (a deleted account's still-valid JWT). Cheap when both exist: two index reads.
create or replace function public.ensure_ink_account(p_uid uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_uid is null then
    return;
  end if;
  insert into public.profiles (user_id)
  select u.id from auth.users u where u.id = p_uid
  on conflict (user_id) do nothing;

  if exists (select 1 from public.profiles where user_id = p_uid)
     and not exists (select 1 from public.ink_grants where user_id = p_uid and kind = 'starter') then
    insert into public.ink_grants (user_id, units, kind, reason)
    values (p_uid, public.ink_starter_amount(), 'starter', 'Starter ink')
    on conflict (user_id) where kind = 'starter' do nothing;
  end if;
end;
$$;
revoke all on function public.ensure_ink_account(uuid) from public, anon, authenticated;

-- The sign-up trigger: the profile, then the starter ink. Each step has its own exception block,
-- so neither can block a sign-up (the self-heal above catches up on first use).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.profiles (user_id, display_name)
    values (
      new.id,
      nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''), 80), '')
    )
    on conflict (user_id) do nothing;
  exception when others then
    raise warning 'handle_new_user: could not create profile for %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  begin
    insert into public.ink_grants (user_id, units, kind, reason)
    values (new.id, public.ink_starter_amount(), 'starter', 'Starter ink')
    on conflict (user_id) where kind = 'starter' do nothing;
  exception when others then
    raise warning 'handle_new_user: could not grant starter ink to %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. No more plans or subscriptions; the beta's carry-over
-- -----------------------------------------------------------------------------
update public.plans set active = false where id in ('plus', 'pro') and active;

-- Every account that exists when this runs gets one starter grant of max(300, what it had left
-- this month under the monthly rules above). Computed before anyone is moved off a paid plan, so
-- a plan set by hand still carries its allowance over. A re-run grants nothing new: the starter
-- index turns every insert for an account that has one into a no-op.
insert into public.profiles (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

with month as (
  select period_start, period_end from public.credit_period()
),
left_this_month as (
  select
    pr.user_id,
    greatest(
      0,
      coalesce(pl.monthly_credits, 0)
      + coalesce((select sum(g.units) from public.credit_grants g, month m
                   where g.user_id = pr.user_id and g.created_at >= m.period_start and g.created_at < m.period_end), 0)
      - coalesce((select sum(e.units) from public.usage_events e, month m
                   where e.user_id = pr.user_id and e.created_at >= m.period_start and e.created_at < m.period_end), 0)
    )::integer as remaining
  from public.profiles pr
  left join public.plans pl on pl.id = pr.plan_id
)
insert into public.ink_grants (user_id, units, kind, reason)
select l.user_id, greatest(public.ink_starter_amount(), l.remaining), 'starter', 'Starter ink (carried over from the beta)'
from left_this_month l
where not exists (select 1 from public.ink_grants g where g.user_id = l.user_id and g.kind = 'starter')
on conflict (user_id) where kind = 'starter' do nothing;

update public.profiles set plan_id = 'free' where plan_id <> 'free';

-- -----------------------------------------------------------------------------
-- 8. Summaries
-- -----------------------------------------------------------------------------
-- Internal: the ink picture for one user. `used` is derived (granted - balance), which is exact
-- for everything the triggers have seen and costs one aggregate over the (few) grant rows.
create or replace function public.ink_summary_of(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_granted integer;
  v_purchased integer;
  v_refunded integer;
  v_starter integer;
  v_starter_at timestamptz;
  v_purchases integer;
  v_last jsonb;
begin
  select pr.ink_balance into v_balance from public.profiles pr where pr.user_id = p_uid;

  select
    coalesce(sum(g.units), 0)::integer,
    coalesce(sum(g.units) filter (where g.kind = 'purchase'), 0)::integer,
    coalesce(-sum(g.units) filter (where g.kind = 'refund'), 0)::integer,
    coalesce(sum(g.units) filter (where g.kind = 'starter'), 0)::integer,
    min(g.created_at) filter (where g.kind = 'starter')
  into v_granted, v_purchased, v_refunded, v_starter, v_starter_at
  from public.ink_grants g
  where g.user_id = p_uid;

  select count(*)::integer into v_purchases from public.ink_purchases p where p.user_id = p_uid;

  select jsonb_build_object(
           'id', p.id,
           'pack_id', p.pack_id,
           'pack_name', coalesce(k.name, p.pack_id),
           'ink', p.ink,
           'amount_cents', p.amount_cents,
           'currency', p.currency,
           'status', p.status,
           'refunded_ink', p.refunded_ink,
           'created_at', p.created_at
         )
    into v_last
  from public.ink_purchases p
  left join public.ink_packs k on k.id = p.pack_id
  where p.user_id = p_uid
  order by p.created_at desc, p.id desc
  limit 1;

  v_balance := coalesce(v_balance, 0);
  return jsonb_build_object(
    'balance',       v_balance,
    'granted',       v_granted,
    'purchased',     v_purchased,
    'refunded',      v_refunded,
    'used',          greatest(0, v_granted - v_balance),
    'starter',       v_starter,
    'starter_at',    v_starter_at,
    'purchases',     v_purchases,
    'last_purchase', v_last
  );
end;
$$;
revoke all on function public.ink_summary_of(uuid) from public, anon, authenticated;

-- RPC: POST /rest/v1/rpc/ink_summary  (as the user). Volatile because it may grant a missing
-- starter (the self-heal); PostgREST runs it in a read-write transaction (supabase-js POSTs).
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
  return public.ink_summary_of(v_uid);
end;
$$;
revoke all on function public.ink_summary() from public, anon;
grant execute on function public.ink_summary() to authenticated;

-- Internal, kept for the callers that knew the monthly shape: the same keys as before, made
-- consistent for ink (monthly_credits 0, granted and used all-time, remaining = balance, so
-- remaining = monthly_credits + granted - used still holds), plus `balance`.
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
  v_status text;
  v_paid_until timestamptz;
  v_ink jsonb;
begin
  select period_start, period_end into v_start, v_end from public.credit_period();

  select p.id, p.name, pr.billing_status, pr.current_period_end
    into v_plan_id, v_plan_name, v_status, v_paid_until
  from public.profiles pr
  join public.plans p on p.id = pr.plan_id
  where pr.user_id = p_uid;

  if v_plan_id is null then
    select p.id, p.name into v_plan_id, v_plan_name from public.plans p where p.id = 'free';
  end if;

  v_ink := public.ink_summary_of(p_uid);
  return jsonb_build_object(
    'plan_id',            v_plan_id,
    'plan_name',          v_plan_name,
    'monthly_credits',    0,
    'used',               (v_ink ->> 'used')::integer,
    'granted',            (v_ink ->> 'granted')::integer,
    'remaining',          (v_ink ->> 'balance')::integer,
    'balance',            (v_ink ->> 'balance')::integer,
    'period_start',       v_start,
    'period_end',         v_end,
    'billing_status',     v_status,
    'current_period_end', v_paid_until
  );
end;
$$;
revoke all on function public.credit_balance(uuid) from public, anon, authenticated;

-- RPC: POST /rest/v1/rpc/credit_summary  (as the user). The pre-ink shape; see credit_balance.
create or replace function public.credit_summary()
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
  return public.credit_balance(v_uid);
end;
$$;
revoke all on function public.credit_summary() from public, anon;
grant execute on function public.credit_summary() to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Spending (as the user) and giving a failed call back (service role)
-- -----------------------------------------------------------------------------
-- RPC: POST /rest/v1/rpc/consume_credits {p_route, p_units, p_request_id?, p_model?}
-- The profile row is locked FOR UPDATE before the balance is read, so parallel calls for one
-- user serialise and can never spend the same ink twice. Short: {ok:false} and NOTHING written.
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

  if v_balance < p_units then
    return jsonb_build_object('ok', false, 'remaining', v_balance, 'reason', 'insufficient_credits');
  end if;

  -- The usage_events_apply_insert trigger takes the ink off the balance.
  insert into public.usage_events (user_id, route, units, model, request_id)
  values (v_uid, p_route, p_units, left(p_model, 200), left(p_request_id, 100));

  return jsonb_build_object('ok', true, 'remaining', v_balance - p_units, 'reason', null);
end;
$$;
revoke all on function public.consume_credits(text, integer, text, text) from public, anon;
grant execute on function public.consume_credits(text, integer, text, text) to authenticated;

-- Giving a failed call's ink back: SERVICE ROLE ONLY. The route that charged calls it (with the
-- user requireUser verified) when the provider call then failed. It used to be callable by the
-- user (refund_credits), and every 2xx carries its X-Request-Id, so a user could get the ink of
-- any successful call back within 15 minutes and never run out. Deletes that user's usage rows for
-- the request id younger than 15 minutes; the delete trigger puts the ink back. Idempotent.
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

  select pr.ink_balance into v_balance from public.profiles pr where pr.user_id = p_user_id;
  return jsonb_build_object('refunded', v_refunded, 'remaining', coalesce(v_balance, 0));
end;
$$;
revoke all on function public.refund_ink_for(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_ink_for(uuid, text) to service_role;

-- The old user-callable refund: no longer executable by users (see refund_ink_for). Kept, with
-- the same signature, so older code gets a permission error rather than a missing function; its
-- body only ever acts on the caller.
create or replace function public.refund_credits(p_request_id text)
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
  return public.refund_ink_for(v_uid, p_request_id);
end;
$$;
revoke all on function public.refund_credits(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. Purchases, refunds and manual grants (service role only)
-- -----------------------------------------------------------------------------
-- Agathon checkouts that were paid (or claimed paid) but could not be granted automatically:
-- no or a bad client_reference_id (the Payment Link opened outside the app), no or an unknown
-- pack, an account deleted before the webhook, or an amount that does not cover the pack (a
-- promotion code, a wrong currency, nothing paid at all). One row per Checkout Session; only ever
-- Agathon's own sessions (tagged app=agathon-classroom), never another app's on the shared Stripe
-- account. Service role only: the owner resolves them by hand (docs/RUNBOOK-billing.md).
create table if not exists public.ink_checkout_reviews (
  id                  bigint      generated always as identity primary key,
  checkout_session_id text        not null check (char_length(checkout_session_id) between 1 and 255),
  reason              text        not null check (char_length(reason) between 1 and 300),
  status              text        not null default 'open' check (status in ('open', 'resolved', 'refunded')),
  user_id             uuid        references auth.users (id) on delete set null,   -- when the reference named a real user
  client_reference_id text        check (client_reference_id is null or char_length(client_reference_id) <= 255),
  pack_id             text        check (pack_id is null or char_length(pack_id) <= 64),
  payment_intent_id   text        check (payment_intent_id is null or char_length(payment_intent_id) <= 255),
  customer_id         text        check (customer_id is null or char_length(customer_id) <= 255),
  customer_email      text        check (customer_email is null or char_length(customer_email) <= 320),
  amount_cents        integer,
  currency            text        check (currency is null or char_length(currency) <= 8),
  event_id            text        check (event_id is null or char_length(event_id) <= 200),
  note                text        check (note is null or char_length(note) <= 500),
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);

create unique index if not exists ink_checkout_reviews_session_key on public.ink_checkout_reviews (checkout_session_id);
create index if not exists ink_checkout_reviews_payment_intent_idx
  on public.ink_checkout_reviews (payment_intent_id) where payment_intent_id is not null;

alter table public.ink_checkout_reviews enable row level security;
revoke all on public.ink_checkout_reviews from public, anon, authenticated;
grant all on public.ink_checkout_reviews to service_role;

-- Record a checkout for review (idempotent on the session id). The webhook calls it for an
-- Agathon session it cannot map (no user, no pack); grant_ink_purchase calls it for the rest.
create or replace function public.record_ink_checkout_review(
  p_checkout_session_id text,
  p_reason              text,
  p_client_reference_id text default null,
  p_pack_id             text default null,
  p_payment_intent_id   text default null,
  p_customer_id         text default null,
  p_amount_cents        integer default null,
  p_currency            text default null,
  p_customer_email      text default null,
  p_event_id            text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_id bigint;
  v_ref text := nullif(lower(btrim(coalesce(p_client_reference_id, ''))), '');
begin
  if p_checkout_session_id is null or char_length(p_checkout_session_id) < 1 or char_length(p_checkout_session_id) > 255 then
    raise exception 'p_checkout_session_id must be 1..255 characters' using errcode = '22023';
  end if;
  if v_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select u.id into v_user from auth.users u where u.id = v_ref::uuid;
  end if;

  insert into public.ink_checkout_reviews (
    checkout_session_id, reason, user_id, client_reference_id, pack_id, payment_intent_id,
    customer_id, customer_email, amount_cents, currency, event_id
  )
  values (
    p_checkout_session_id, left(coalesce(nullif(p_reason, ''), 'unknown'), 300), v_user, left(p_client_reference_id, 255),
    left(p_pack_id, 64), nullif(left(p_payment_intent_id, 255), ''), nullif(left(p_customer_id, 255), ''),
    nullif(left(p_customer_email, 320), ''), p_amount_cents, nullif(left(lower(p_currency), 8), ''), left(p_event_id, 200)
  )
  on conflict (checkout_session_id) do nothing
  returning id into v_id;

  if v_id is null then
    select r.id into v_id from public.ink_checkout_reviews r where r.checkout_session_id = p_checkout_session_id;
    return jsonb_build_object('recorded', false, 'duplicate', true, 'review_id', v_id);
  end if;
  return jsonb_build_object('recorded', true, 'duplicate', false, 'review_id', v_id);
end;
$$;
revoke all on function public.record_ink_checkout_review(text, text, text, text, text, text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.record_ink_checkout_review(text, text, text, text, text, text, integer, text, text, text) to service_role;

-- The billing webhook, for a paid Checkout Session. Idempotent on the session id: a second call
-- for the same session grants nothing and answers duplicate:true (so the webhook can call it again
-- for a redelivered event). The money has to cover the pack: `p_amount_cents` in `p_currency`
-- (the session's amount_total, or its currency_conversion source amount under Adaptive Pricing)
-- must be at least the pack's price in USD. Anything that cannot be granted (an underpaid or
-- unpriced session, an unknown pack, a user that no longer exists) is recorded in
-- ink_checkout_reviews with NO ink, and answered review:true. A deactivated pack is still honoured
-- (the customer paid for it).
drop function if exists public.grant_ink_purchase(uuid, text, text, text, text, integer, text);

create or replace function public.grant_ink_purchase(
  p_user_id             uuid,
  p_pack_id             text,
  p_checkout_session_id text,
  p_payment_intent_id   text default null,
  p_customer_id         text default null,
  p_amount_cents        integer default null,
  p_currency            text default null,
  p_customer_email      text default null,
  p_event_id            text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_pack public.ink_packs%rowtype;
  v_purchase_id bigint;
  v_balance integer;
  v_reason text;
  v_review jsonb;
  v_currency text := lower(nullif(btrim(coalesce(p_currency, '')), ''));
begin
  if p_checkout_session_id is null or char_length(p_checkout_session_id) < 1 or char_length(p_checkout_session_id) > 255 then
    raise exception 'p_checkout_session_id must be 1..255 characters' using errcode = '22023';
  end if;

  -- Already handled: granted once, or already waiting for review.
  select p.id into v_purchase_id from public.ink_purchases p where p.checkout_session_id = p_checkout_session_id;
  if v_purchase_id is not null then
    select pr.ink_balance into v_balance from public.profiles pr where pr.user_id = p_user_id;
    return jsonb_build_object('granted', 0, 'duplicate', true, 'purchase_id', v_purchase_id, 'balance', v_balance);
  end if;
  if exists (select 1 from public.ink_checkout_reviews r where r.checkout_session_id = p_checkout_session_id) then
    return jsonb_build_object('granted', 0, 'duplicate', true, 'review', true);
  end if;

  select * into v_pack from public.ink_packs where id = p_pack_id;
  if not found then
    v_reason := format('unknown pack %s', coalesce(p_pack_id, '(none)'));
  elsif p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    v_reason := 'no account for this user (deleted before the webhook?)';
  elsif p_amount_cents is null or v_currency is null then
    v_reason := 'no amount on the session';
  elsif v_currency <> 'usd' then
    v_reason := format('paid in %s; packs are priced in usd', v_currency);
  elsif p_amount_cents < v_pack.price_cents then
    v_reason := format('paid %s cents for the %s pack, priced %s cents', p_amount_cents, v_pack.id, v_pack.price_cents);
  end if;

  if v_reason is not null then
    v_review := public.record_ink_checkout_review(
      p_checkout_session_id, v_reason, p_user_id::text, p_pack_id, p_payment_intent_id,
      p_customer_id, p_amount_cents, v_currency, p_customer_email, p_event_id
    );
    return jsonb_build_object('granted', 0, 'duplicate', false, 'review', true, 'reason', v_reason, 'review_id', v_review ->> 'review_id');
  end if;

  perform public.ensure_ink_account(p_user_id);
  perform 1 from public.profiles pr where pr.user_id = p_user_id for update;

  insert into public.ink_purchases (user_id, pack_id, ink, amount_cents, currency, checkout_session_id, payment_intent_id, customer_id)
  values (
    p_user_id,
    v_pack.id,
    v_pack.ink,
    p_amount_cents,
    v_currency,
    p_checkout_session_id,
    nullif(p_payment_intent_id, ''),
    nullif(p_customer_id, '')
  )
  on conflict (checkout_session_id) do nothing
  returning id into v_purchase_id;

  if v_purchase_id is null then
    -- a concurrent delivery of the same session won the insert
    select p.id into v_purchase_id from public.ink_purchases p where p.checkout_session_id = p_checkout_session_id;
    select pr.ink_balance into v_balance from public.profiles pr where pr.user_id = p_user_id;
    return jsonb_build_object('granted', 0, 'duplicate', true, 'purchase_id', v_purchase_id, 'balance', v_balance);
  end if;

  insert into public.ink_grants (user_id, units, kind, purchase_id, reason)
  values (p_user_id, v_pack.ink, 'purchase', v_purchase_id, left(format('%s pack', v_pack.name), 200));

  select pr.ink_balance into v_balance from public.profiles pr where pr.user_id = p_user_id;
  return jsonb_build_object('granted', v_pack.ink, 'duplicate', false, 'purchase_id', v_purchase_id, 'balance', v_balance);
end;
$$;
revoke all on function public.grant_ink_purchase(uuid, text, text, text, text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.grant_ink_purchase(uuid, text, text, text, text, integer, text, text, text) to service_role;

-- The billing webhook, for charge.refunded. `p_amount_refunded_cents` is Stripe's CUMULATIVE
-- refunded amount for the charge; only its increase since the last call is acted on, so a replay
-- or a later partial refund never reverses twice. The share of the pack's ink that the refund
-- covers is taken back, capped at the current balance (ink already spent stays spent and is
-- recorded as refund_unrecovered_ink). found:false when no purchase has that payment intent.
create or replace function public.reverse_ink_purchase(
  p_payment_intent_id     text,
  p_amount_refunded_cents integer,
  p_charge_amount_cents   integer default null,
  p_fully_refunded        boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_purchase public.ink_purchases%rowtype;
  v_pack_name text;
  v_base integer;
  v_cum integer;
  v_target integer;
  v_owed integer;
  v_balance integer;
  v_reversed integer;
  v_status text;
begin
  if p_payment_intent_id is null or char_length(p_payment_intent_id) < 1 or char_length(p_payment_intent_id) > 255 then
    raise exception 'p_payment_intent_id must be 1..255 characters' using errcode = '22023';
  end if;

  select * into v_purchase from public.ink_purchases where payment_intent_id = p_payment_intent_id for update;
  if not found then
    -- A checkout waiting for review granted no ink: nothing to take back, but the review row
    -- should say the money went back.
    update public.ink_checkout_reviews
       set status = 'refunded', resolved_at = coalesce(resolved_at, now())
     where payment_intent_id = p_payment_intent_id and status <> 'refunded';
    if found or exists (select 1 from public.ink_checkout_reviews r where r.payment_intent_id = p_payment_intent_id) then
      return jsonb_build_object('found', true, 'review', true, 'reversed', 0, 'requested', 0);
    end if;
    -- Not (yet) a purchase: the webhook decides whether to wait for its grant (a tagged charge)
    -- or ignore it (someone else's payment).
    return jsonb_build_object('found', false, 'reversed', 0);
  end if;

  select pr.ink_balance into v_balance from public.profiles pr where pr.user_id = v_purchase.user_id for update;
  v_balance := coalesce(v_balance, 0);

  v_base := coalesce(nullif(v_purchase.amount_cents, 0), nullif(p_charge_amount_cents, 0), 0);
  v_cum := case
             when coalesce(p_fully_refunded, false) or v_base = 0 then v_base
             else least(greatest(coalesce(p_amount_refunded_cents, 0), 0), v_base)
           end;

  -- Nothing new: the cumulative refund has not grown (a replay, or a refund.updated echo). A
  -- free purchase (100 % discount) has no amount to compare, so its status decides.
  if (v_base = 0 and v_purchase.status = 'refunded') or (v_base > 0 and v_cum <= v_purchase.refunded_cents) then
    return jsonb_build_object(
      'found', true, 'duplicate', true, 'reversed', 0, 'requested', 0, 'unrecovered', 0,
      'balance', v_balance, 'status', v_purchase.status, 'purchase_id', v_purchase.id, 'user_id', v_purchase.user_id
    );
  end if;

  -- Ink the refunds so far stand for, minus what earlier refund events already asked for.
  v_target := case when v_base = 0 or v_cum >= v_base then v_purchase.ink
                   else round(v_purchase.ink::numeric * v_cum / v_base)::integer end;
  v_owed := greatest(0, v_target - v_purchase.refunded_ink - v_purchase.refund_unrecovered_ink);
  v_reversed := least(v_owed, v_balance);
  v_status := case when v_base = 0 or v_cum >= v_base then 'refunded' else 'partially_refunded' end;

  if v_reversed > 0 then
    select k.name into v_pack_name from public.ink_packs k where k.id = v_purchase.pack_id;
    insert into public.ink_grants (user_id, units, kind, purchase_id, reason)
    values (v_purchase.user_id, -v_reversed, 'refund', v_purchase.id,
            left(format('Refund of %s pack', coalesce(v_pack_name, v_purchase.pack_id)), 200));
  end if;

  update public.ink_purchases
     set refunded_cents = v_cum,
         refunded_ink = refunded_ink + v_reversed,
         refund_unrecovered_ink = refund_unrecovered_ink + (v_owed - v_reversed),
         status = v_status,
         refunded_at = now()
   where id = v_purchase.id;

  return jsonb_build_object(
    'found', true, 'duplicate', false, 'reversed', v_reversed, 'requested', v_owed,
    'unrecovered', v_owed - v_reversed, 'balance', v_balance - v_reversed, 'status', v_status,
    'purchase_id', v_purchase.id, 'user_id', v_purchase.user_id
  );
end;
$$;
revoke all on function public.reverse_ink_purchase(text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.reverse_ink_purchase(text, integer, integer, boolean) to service_role;

-- The owner's way out of the review queue (docs/RUNBOOK-billing.md): turn an open review into a
-- real purchase (so a later charge.refunded finds it and takes the ink back like any other), for
-- the review's user and pack unless others are named (a checkout opened outside the app names
-- nobody). The amount recorded is what was actually paid. Each review resolves once; a session
-- that already has a purchase is refused. Service role (and postgres) only.
create or replace function public.resolve_ink_checkout_review(
  p_review_id bigint,
  p_user_id   uuid default null,
  p_pack_id   text default null,
  p_note      text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_review public.ink_checkout_reviews%rowtype;
  v_user uuid;
  v_pack public.ink_packs%rowtype;
  v_purchase_id bigint;
  v_balance integer;
begin
  select * into v_review from public.ink_checkout_reviews where id = p_review_id for update;
  if not found then
    raise exception 'no checkout review %', p_review_id using errcode = '22023';
  end if;
  if v_review.status <> 'open' then
    raise exception 'checkout review % is already %', p_review_id, v_review.status using errcode = '22023';
  end if;
  v_user := coalesce(p_user_id, v_review.user_id);
  if v_user is null or not exists (select 1 from auth.users u where u.id = v_user) then
    raise exception 'checkout review %: name the account to grant (p_user_id)', p_review_id using errcode = '22023';
  end if;
  select * into v_pack from public.ink_packs where id = coalesce(p_pack_id, v_review.pack_id);
  if not found then
    raise exception 'checkout review %: name a pack that exists (p_pack_id)', p_review_id using errcode = '22023';
  end if;
  if exists (select 1 from public.ink_purchases p where p.checkout_session_id = v_review.checkout_session_id) then
    raise exception 'checkout session % already has a purchase', v_review.checkout_session_id using errcode = '23505';
  end if;

  perform public.ensure_ink_account(v_user);
  perform 1 from public.profiles pr where pr.user_id = v_user for update;

  insert into public.ink_purchases (user_id, pack_id, ink, amount_cents, currency, checkout_session_id, payment_intent_id, customer_id)
  values (
    v_user, v_pack.id, v_pack.ink, greatest(coalesce(v_review.amount_cents, 0), 0), coalesce(v_review.currency, 'usd'),
    v_review.checkout_session_id, v_review.payment_intent_id, v_review.customer_id
  )
  returning id into v_purchase_id;

  insert into public.ink_grants (user_id, units, kind, purchase_id, reason)
  values (v_user, v_pack.ink, 'purchase', v_purchase_id, left(format('%s pack (review #%s)', v_pack.name, p_review_id), 200));

  update public.ink_checkout_reviews
     set status = 'resolved', resolved_at = now(), user_id = v_user,
         note = left(coalesce(nullif(p_note, ''), note), 500)
   where id = p_review_id;

  select pr.ink_balance into v_balance from public.profiles pr where pr.user_id = v_user;
  return jsonb_build_object('granted', v_pack.ink, 'purchase_id', v_purchase_id, 'user_id', v_user, 'balance', v_balance);
end;
$$;
revoke all on function public.resolve_ink_checkout_review(bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_ink_checkout_review(bigint, uuid, text, text) to service_role;

-- Manual grants and corrections (runbook): `select public.grant_ink('<uuid>', 500, 'outage apology');`
-- A negative correction takes at most the current balance (never below zero); `granted` says how
-- much actually moved. Creates the profile (and its starter) when missing.
create or replace function public.grant_ink(p_user_id uuid, p_units integer, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_units integer;
begin
  if p_user_id is null or p_units is null or p_units = 0 then
    raise exception 'grant_ink needs a user and a non-zero number of ink' using errcode = '22023';
  end if;
  perform public.ensure_ink_account(p_user_id);
  select pr.ink_balance into v_balance from public.profiles pr where pr.user_id = p_user_id for update;
  if not found then
    raise exception 'no account for user %', p_user_id using errcode = 'P0002';
  end if;
  v_units := case when p_units < 0 then -least(-p_units, v_balance) else p_units end;
  if v_units <> 0 then
    insert into public.ink_grants (user_id, units, kind, reason)
    values (p_user_id, v_units, 'manual', left(coalesce(nullif(p_reason, ''), 'Manual grant'), 200));
  end if;
  return jsonb_build_object('granted', v_units, 'balance', v_balance + v_units);
end;
$$;
revoke all on function public.grant_ink(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.grant_ink(uuid, integer, text) to service_role;

-- -----------------------------------------------------------------------------
-- 11. usage_by_day: an optional rolling window for the ink account page
-- -----------------------------------------------------------------------------
-- Same columns as 20260927000000_usage_by_day.sql (credits = ink). p_days null keeps the old
-- window (this UTC calendar month); 1..366 = the last p_days calendar days in p_time_zone,
-- today included. Still SECURITY INVOKER: the usage_events owner policy decides the rows.
-- The one-argument version is dropped so PostgREST has one candidate for {p_time_zone}.
drop function if exists public.usage_by_day(text);

create or replace function public.usage_by_day(p_time_zone text default 'UTC', p_days integer default null)
returns table (day date, route text, events integer, credits integer)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_zone text := coalesce(nullif(p_time_zone, ''), 'UTC');
  v_from timestamptz;
  v_to timestamptz;
begin
  -- An unknown zone raises 22023 (HTTP 400) here, even when there are no rows to group.
  perform now() at time zone v_zone;
  if p_days is null then
    v_from := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
    v_to := (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc';
  elsif p_days < 1 or p_days > 366 then
    raise exception 'p_days must be between 1 and 366' using errcode = '22023';
  else
    v_from := (((now() at time zone v_zone)::date - (p_days - 1))::timestamp) at time zone v_zone;
    v_to := 'infinity'::timestamptz;
  end if;

  return query
  select
    (e.created_at at time zone v_zone)::date as day,
    e.route,
    count(*)::integer     as events,
    sum(e.units)::integer as credits
  from public.usage_events e
  where e.user_id = (select auth.uid())
    and e.created_at >= v_from
    and e.created_at < v_to
  group by 1, 2
  order by 1 desc, 4 desc, 2;
end;
$$;
revoke all on function public.usage_by_day(text, integer) from public, anon;
grant execute on function public.usage_by_day(text, integer) to authenticated;

-- PostgREST caches the schema; the new tables, column and RPCs need a reload.
notify pgrst, 'reload schema';
