-- =============================================================================
-- Go-live gaps (2026-10-04). Idempotent; additive to 20261003020000_unlimited.sql and
-- 20261003030000_email_log.sql. Four things the first paying families need:
--
-- 1. A checkout reference instead of the user id (security). The Unlimited Payment Link carried
--    `client_reference_id=<user id>`, and the webhook linked the subscription to whoever that named.
--    Anyone who knew another account's id (it is not a secret: it travels in URLs and logs) could
--    open the link with their own card and put a plan on the VICTIM's account: delete_own_account()
--    then refuses while the plan would charge again, and only the attacker can cancel it (the
--    customer portal signs in by the checkout's email). Now every profile has a random
--    `checkout_ref`, readable only by its owner (profiles' owner-select policy; never writable: the
--    client may update display_name alone), the app sends THAT as client_reference_id, and
--    link_unlimited_checkout() takes only a ref and resolves it to the user here. A user id sent as
--    the ref links nobody (it is recorded for the owner, as any unusable checkout is). Ink packs
--    keep taking the user id: a pack bought for someone else is a gift, harmless.
--
-- 2. One free week per account (billing). Every checkout through the Payment Link starts a new
--    7-day trial, so an account could cancel and start again forever without paying. Now a
--    `trialing` subscription grants Unlimited only when it is that account's FIRST Unlimited
--    subscription (no earlier row of theirs that ever started: anything but 'incomplete_expired').
--    A later trial still runs in Stripe (the card is charged when it ends, as the checkout said),
--    but help spends ink until it turns `active`. The trade-off, accepted by the owner: a returning
--    subscriber who starts again pays in ink for that week. The Terms already say free weeks may be
--    limited to one per person, family or card. ink_summary().unlimited says so with
--    `repeat_trial: true`, so the account page explains it instead of showing a payment problem.
--
-- 3. The payer's email (billing emails). The free-week emails go to the person who pays, not the
--    Agathon account (often a child's). Stripe gives it only on the checkout
--    (`customer_details.email`), so the checkout's writer stores it on the subscription row:
--    `unlimited_subscriptions.payer_email`. RLS is unchanged (the account reads its own row; nobody
--    else). When the account is deleted the row loses its user (ON DELETE SET NULL) and, through
--    the trigger below, its payer_email too: the row kept for the owner names nobody.
--
-- 4. Retention of Stripe payloads (privacy). billing_events kept every Agathon event's full payload
--    (the payer's name, email, address, card brand and last four digits) forever. Now
--    purge_billing_event_payloads() blanks payloads older than billing_event_payload_retention()
--    (90 days, ONE constant: change it here, in a new migration), keeping the event's id, type and
--    time (the log the webhook's idempotency notes rely on). The nightly cron calls it
--    (GET /api/admin/gc, src/lib/server/storageGc.ts).
--
-- Objects created or changed here:
--   columns    profiles.checkout_ref (uuid, not null, unique, random),
--              unlimited_subscriptions.payer_email (text, nullable)
--   functions  unlimited_earlier_plan(uuid, bigint) [new, internal],
--              has_unlimited(uuid) [replaced: a repeat trial is not Unlimited],
--              unlimited_state_of(uuid) [replaced: + repeat_trial, checkout_ref],
--              link_unlimited_checkout(text, uuid, text, text, boolean) [DROPPED] ->
--              link_unlimited_checkout(text, uuid, text, text, boolean, text) [new: a checkout ref,
--              not a user id, and the payer's email],
--              unlimited_subscriptions_forget_payer() [trigger], billing_event_payload_retention(),
--              purge_billing_event_payloads() [new, service role]
--
-- Deploy order: TOGETHER with the code (docs/RUNBOOK-billing.md section 12). The webhook's new
-- code calls link_unlimited_checkout(p_checkout_ref, ..., p_payer_email): on a database without
-- this migration it fails (500, Stripe retries for 3 days). The old code against this database
-- fails the same way for an Unlimited checkout (p_user_id is gone, on purpose), so apply the
-- migration, then deploy at once; ink packs, spending and everything else work across both orders.
--
-- Supabase's default privileges grant ALL on every new public function to anon, authenticated and
-- service_role, so each function revokes first and grants exactly what is used.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles.checkout_ref: the account's own checkout reference
-- -----------------------------------------------------------------------------
-- A volatile default fills every existing profile with its own value (a one-time table rewrite; the
-- table is one small row per account).
alter table public.profiles add column if not exists checkout_ref uuid not null default gen_random_uuid();
create unique index if not exists profiles_checkout_ref_key on public.profiles (checkout_ref);
-- Readable by its owner through the table-level `grant select` and the owner-select policy (and
-- in ink_summary().unlimited); never writable by the client, whose only column grant on profiles
-- is update (display_name) (20260917020000_accounts_billing.sql). scripts/verify-rls.mjs checks
-- both: another account cannot read it, and its owner cannot change it.

-- -----------------------------------------------------------------------------
-- 2. unlimited_subscriptions.payer_email, forgotten with the account
-- -----------------------------------------------------------------------------
alter table public.unlimited_subscriptions add column if not exists payer_email text;
alter table public.unlimited_subscriptions drop constraint if exists unlimited_subscriptions_payer_email_len;
alter table public.unlimited_subscriptions add constraint unlimited_subscriptions_payer_email_len
  check (payer_email is null or char_length(payer_email) between 3 and 320);

-- The FK's ON DELETE SET NULL is an UPDATE of this table, so a BEFORE UPDATE trigger sees the
-- account go and drops the payer's email with it.
create or replace function public.unlimited_subscriptions_forget_payer()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is null and old.user_id is not null then
    new.payer_email := null;
  end if;
  return new;
end;
$$;
revoke all on function public.unlimited_subscriptions_forget_payer() from public, anon, authenticated;

drop trigger if exists unlimited_subscriptions_forget_payer on public.unlimited_subscriptions;
create trigger unlimited_subscriptions_forget_payer
  before update of user_id on public.unlimited_subscriptions
  for each row execute function public.unlimited_subscriptions_forget_payer();

-- -----------------------------------------------------------------------------
-- 3. One free week per account
-- -----------------------------------------------------------------------------
-- Internal: did this account have an Unlimited subscription before row p_id (any that started:
-- a checkout whose subscription expired unpaid, 'incomplete_expired', never did)? Rows are created
-- when the webhook first hears of a subscription, so `id` is the order the plans were started in.
create or replace function public.unlimited_earlier_plan(p_uid uuid, p_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.unlimited_subscriptions o
    where o.user_id = p_uid
      and o.id < p_id
      and o.status is distinct from 'incomplete_expired'
  )
$$;
revoke all on function public.unlimited_earlier_plan(uuid, bigint) from public, anon, authenticated;

-- Same as 20261003020000_unlimited.sql, except that `trialing` counts only on the account's first
-- plan. `active` always counts: a repeat subscriber who pays has the plan.
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
      and (s.status = 'active'
           or (s.status = 'trialing' and not public.unlimited_earlier_plan(p_uid, s.id)))
      and (
        coalesce(s.current_period_end, s.trial_end) is null
        or coalesce(s.current_period_end, s.trial_end) + public.unlimited_grace() > now()
      )
  )
$$;
revoke all on function public.has_unlimited(uuid) from public, anon, authenticated;

-- Same as 20261003020000_unlimited.sql plus two keys:
--   repeat_trial  the row shown is a free week on a second (or later) plan: help spends ink
--                 until it turns active (the client says so instead of "payment problem")
--   checkout_ref  the account's checkout reference, for the Unlimited Payment Link's
--                 client_reference_id (src/lib/billing/unlimited.ts); with or without a row
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
begin
  select pr.checkout_ref into v_ref from public.profiles pr where pr.user_id = p_uid;

  select s.* into v_row
  from public.unlimited_subscriptions s
  where s.user_id = p_uid
  order by
    ((s.status = 'active'
      or (s.status = 'trialing' and not public.unlimited_earlier_plan(p_uid, s.id)))
     and (coalesce(s.current_period_end, s.trial_end) is null
          or coalesce(s.current_period_end, s.trial_end) + public.unlimited_grace() > now())) desc nulls last,
    s.updated_at desc,
    s.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'none', 'unlimited', false, 'trial_end', null, 'current_period_end', null,
      'cancel_at_period_end', false, 'cancel_at', null, 'repeat_trial', false, 'checkout_ref', v_ref
    );
  end if;
  return jsonb_build_object(
    'status',               v_row.status,
    'unlimited',            public.has_unlimited(p_uid),
    'trial_end',            v_row.trial_end,
    'current_period_end',   v_row.current_period_end,
    'cancel_at_period_end', v_row.cancel_at_period_end,
    'cancel_at',            v_row.cancel_at,
    'repeat_trial',         coalesce(v_row.status = 'trialing' and public.unlimited_earlier_plan(p_uid, v_row.id), false),
    'checkout_ref',         v_ref
  );
end;
$$;
revoke all on function public.unlimited_state_of(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. The checkout's writer: a checkout reference, and the payer's email
-- -----------------------------------------------------------------------------
-- Same as 20261003020000_unlimited.sql, except:
--  - p_checkout_ref replaces p_user_id: the user is the profile whose checkout_ref it is. A ref
--    that matches no profile (a user id, a deleted account, anything made up) links nobody and
--    answers no_account: true; the row is still recorded for the owner (section 11 of the runbook).
--  - p_payer_email: the checkout's `customer_details.email`, stored once (first wins, like the
--    other columns), for the plan's emails.
-- The old signature is dropped so nothing can still link by user id.
drop function if exists public.link_unlimited_checkout(text, uuid, text, text, boolean);

create or replace function public.link_unlimited_checkout(
  p_subscription_id     text,
  p_checkout_ref        uuid,
  p_customer_id         text default null,
  p_checkout_session_id text default null,
  p_livemode            boolean default null,
  p_payer_email         text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_email text := nullif(left(btrim(coalesce(p_payer_email, '')), 320), '');
  v_row public.unlimited_subscriptions%rowtype;
begin
  if p_subscription_id is null or char_length(p_subscription_id) < 1 or char_length(p_subscription_id) > 255 then
    raise exception 'p_subscription_id must be 1..255 characters' using errcode = '22023';
  end if;
  if p_checkout_ref is not null then
    select pr.user_id into v_user from public.profiles pr where pr.checkout_ref = p_checkout_ref;
  end if;
  if v_email is not null and (char_length(v_email) < 3 or position('@' in v_email) = 0) then
    v_email := null;
  end if;

  insert into public.unlimited_subscriptions as s (
    stripe_subscription_id, user_id, stripe_customer_id, checkout_session_id, livemode, linked_at, payer_email
  )
  values (
    p_subscription_id, v_user, nullif(left(p_customer_id, 255), ''), nullif(left(p_checkout_session_id, 255), ''),
    p_livemode, case when v_user is not null then now() end, v_email
  )
  on conflict (stripe_subscription_id) do update
    set user_id             = coalesce(s.user_id, excluded.user_id),
        linked_at           = coalesce(s.linked_at, excluded.linked_at),
        stripe_customer_id  = coalesce(s.stripe_customer_id, excluded.stripe_customer_id),
        checkout_session_id = coalesce(s.checkout_session_id, excluded.checkout_session_id),
        livemode            = coalesce(s.livemode, excluded.livemode),
        payer_email         = coalesce(s.payer_email, excluded.payer_email)
  returning s.* into v_row;

  return jsonb_build_object(
    'linked',     v_user is not null and v_row.user_id = v_user,
    'user_id',    v_row.user_id,
    'no_account', p_checkout_ref is not null and v_user is null,
    'conflict',   v_user is not null and v_row.user_id is distinct from v_user,
    'status',     v_row.status,
    'unlimited',  coalesce(public.has_unlimited(v_row.user_id), false)
  );
end;
$$;
revoke all on function public.link_unlimited_checkout(text, uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.link_unlimited_checkout(text, uuid, text, text, boolean, text) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Stripe payloads are kept 90 days
-- -----------------------------------------------------------------------------
-- The ONE constant (the Privacy Policy states it; legalPages.test.tsx reads it from here).
create or replace function public.billing_event_payload_retention()
returns interval
language sql
immutable
set search_path = public
as $$ select interval '90 days' $$;
revoke all on function public.billing_event_payload_retention() from public, anon, authenticated;

-- Blank the payloads older than the retention; the rows (id, type, received_at) stay. Answers how
-- many were blanked. Service role only (the nightly cron); idempotent.
create or replace function public.purge_billing_event_payloads()
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with purged as (
    update public.billing_events
       set payload = null
     where payload is not null
       and received_at < now() - public.billing_event_payload_retention()
    returning 1
  )
  select count(*)::integer from purged
$$;
revoke all on function public.purge_billing_event_payloads() from public, anon, authenticated;
grant execute on function public.purge_billing_event_payloads() to service_role;

-- PostgREST caches the schema; the new columns and RPCs need a reload.
notify pgrst, 'reload schema';
