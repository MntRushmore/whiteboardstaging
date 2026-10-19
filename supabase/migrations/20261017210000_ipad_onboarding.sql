-- =============================================================================
-- The iPad app's onboarding (2026-10-17, docs/ONBOARDING.md). Idempotent; re-running it is safe.
-- On top of 20261013030000_free_board_step.sql (and 20261009040000_family_hardening.sql,
-- 20261003020000_unlimited.sql, 20261013020000_start_steps.sql). Independent of the billing lane's
-- 20261017200000_apple_subscriptions.sql: nothing here touches apply_apple_subscription,
-- unlimited_state_of or delete_own_account.
--
-- 1. App Attest, so the app can call the routes used BEFORE the account (POST /api/try/check,
--    /api/try/help, /api/start/step) without a session. src/lib/server/appAttest.
--   app_attest_challenges  one row per challenge POST /api/app/attest/challenge hands out: the
--                          challenge (base64url of 32 random bytes) and when it expires (5 minutes).
--                          Used up by a registration (`delete … returning`, so exactly once); expired
--                          rows are cleared as new ones are made. No client access.
--   app_attest_keys        one row per attested key (POST /api/app/attest/register): the key id
--                          (standard base64 of the 32-byte id), its public key (SPKI PEM), the last
--                          counter seen (an assertion is good only above it; moved by a conditional
--                          update), development or production (the aaguid), Apple's receipt
--                          (base64; kept for a later fraud check), made and last used. Not tied to an
--                          account: nothing about a person. No client access.
--   Both: RLS on and no policies; revoked from public, anon and authenticated; the service role only.
--
-- 2. "Not now" on the trial (the owner's decision, docs/ONBOARDING.md bottom): a grown-up without
--    the plan may add their FIRST kid (src/lib/family/server/service.ts addKid; a second kid still
--    needs the plan), and that kid's AI calls on the free board must be paid for. The rule, in SQL:
--
--      A KID WHOSE FAMILY HAS NO UNLIMITED SPENDS THE GROWN-UP'S INK.
--
--    Why this is the safest choice:
--     - no ink is ever minted: kids still get no starter of their own (handle_new_user,
--       ensure_ink_account, unchanged), so the family's AI is bounded by the ONE starter grant its
--       real sign-up got, however many kids it adds, removes or re-adds;
--     - a kid never spends ink of their own (a kid made some other way that holds ink still cannot
--       use it), and nothing is pooled: the grown-up's balance is the one number, as on the web;
--     - the order of locks is the one the Unlimited branch already uses (own profile row, then the
--       grown-up's), so a family's parallel calls serialise and cannot deadlock, and the balance is
--       read under the lock it is spent under;
--     - with the plan nothing changes (fair use per family, counted on the grown-up).
--   consume_credits(...)   same as 20261009040000_family_hardening.sql, except the kid block: a kid
--                          (plan_owner_of(uid) <> uid) without the family's Unlimited no longer gets
--                          `plan_required` straight away. It locks the grown-up's profile row, checks
--                          the GROWN-UP's balance, and writes the usage_events row on the grown-up
--                          (the usage_events_apply_insert trigger takes the ink off the grown-up's
--                          balance). Out of ink it answers `insufficient_credits` with the grown-up's
--                          balance as `remaining` and `plan_required: true` (the plan is the way to
--                          more), and writes nothing.
--   refund_ink_for(...)    same as 20261009040000_family_hardening.sql, except that it also takes the
--                          plan owner's profile lock (after the caller's: consume_credits' order) and
--                          finds the refunded call's usage_events row on the plan owner too, so a
--                          kid's failed call gives the ink back to the grown-up. `remaining` is the
--                          plan owner's balance for a kid (what the kid spends from).
--   ink_summary()          same as 20261003020000_unlimited.sql, except that for a kid without the
--                          family's Unlimited the balance reported is the one the kid can spend, the
--                          grown-up's: `balance`, `granted`, `used`, `starter` and `starter_at` are
--                          the grown-up's (so the free board's "ink ran out" end works for the kid,
--                          and so does read aloud's starter window), and `family_ink: true` says so.
--                          The purchase fields stay the kid's own (none): a grown-up's purchases are
--                          not shown to a kid.
--
-- 3. The iPad onboarding's new steps (src/lib/start/contracts.ts START_EVENTS):
--   start_steps_event_known  + start_handoff_kid, start_handoff_grownup, start_gate,
--                          start_trial_shown, start_trial_started, start_trial_pending,
--                          start_trial_declined, start_pin_set, start_kid_added, start_first_board.
--                          The ones after the account go through record_start_step by journey id,
--                          which already joins a new row of a linked journey to its account.
--
-- Supabase's default privileges grant ALL on every new public function to anon, authenticated and
-- service_role, so each function revokes first and grants exactly what is used (as before: only
-- consume_credits and ink_summary to authenticated, refund_ink_for to the service role).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. App Attest
-- -----------------------------------------------------------------------------
create table if not exists public.app_attest_challenges (
  challenge  text        primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.app_attest_challenges drop constraint if exists app_attest_challenges_shape;
alter table public.app_attest_challenges add constraint app_attest_challenges_shape check (challenge ~ '^[A-Za-z0-9_-]{43}$');
create index if not exists app_attest_challenges_expires_idx on public.app_attest_challenges (expires_at);

alter table public.app_attest_challenges enable row level security;
revoke all on public.app_attest_challenges from public, anon, authenticated;
grant all on public.app_attest_challenges to service_role;

create table if not exists public.app_attest_keys (
  key_id       text        primary key,
  public_key   text        not null,
  sign_count   bigint      not null default 0,
  environment  text        not null,
  receipt      text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.app_attest_keys drop constraint if exists app_attest_keys_key_id_shape;
alter table public.app_attest_keys add constraint app_attest_keys_key_id_shape check (key_id ~ '^[A-Za-z0-9+/]{43}=$');
alter table public.app_attest_keys drop constraint if exists app_attest_keys_public_key_shape;
alter table public.app_attest_keys add constraint app_attest_keys_public_key_shape check (public_key like '-----BEGIN PUBLIC KEY-----%' and octet_length(public_key) <= 1000);
alter table public.app_attest_keys drop constraint if exists app_attest_keys_sign_count_range;
alter table public.app_attest_keys add constraint app_attest_keys_sign_count_range check (sign_count between 0 and 4294967295);
alter table public.app_attest_keys drop constraint if exists app_attest_keys_environment_known;
alter table public.app_attest_keys add constraint app_attest_keys_environment_known check (environment in ('development', 'production'));
alter table public.app_attest_keys drop constraint if exists app_attest_keys_receipt_size;
alter table public.app_attest_keys add constraint app_attest_keys_receipt_size check (receipt is null or octet_length(receipt) <= 65536);

alter table public.app_attest_keys enable row level security;
revoke all on public.app_attest_keys from public, anon, authenticated;
grant all on public.app_attest_keys to service_role;

-- -----------------------------------------------------------------------------
-- 2. "Not now": a kid without the plan spends the grown-up's ink
-- -----------------------------------------------------------------------------
-- Same as 20261009040000_family_hardening.sql, except the kid block after the Unlimited branch
-- (see the header).
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
  v_owner uuid;
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

  -- The account whose plan this caller uses: a kid's grown-up, else the caller.
  v_owner := public.plan_owner_of(v_uid);

  if public.has_unlimited(v_uid) then
    -- The family's fair use is one count: a kid's call waits for the grown-up's row too (always
    -- own row first, then the grown-up's, so two calls cannot deadlock).
    if v_owner <> v_uid then
      perform 1 from public.profiles pr where pr.user_id = v_owner for update;
    end if;

    -- This request id is already recorded (a lecture minute's later ticks): free, not counted again.
    if v_request is not null
       and exists (select 1 from public.unlimited_usage u where u.user_id = v_owner and u.request_id = v_request) then
      return jsonb_build_object('ok', true, 'remaining', v_balance, 'reason', null, 'unlimited', true);
    end if;

    select count(*)::integer, min(u.created_at) into v_used, v_oldest
    from public.unlimited_usage u
    where u.user_id = v_owner and u.created_at > now() - interval '24 hours';

    if v_used >= public.unlimited_fair_use_per_day() then
      -- A slot frees when the oldest action of the window turns 24 hours old.
      return jsonb_build_object(
        'ok', false, 'remaining', v_balance, 'reason', 'fair_use', 'unlimited', true,
        'retry_after_ms', greatest(1000, least(86400000, ceil(extract(epoch from (v_oldest + interval '24 hours' - now())) * 1000)))::integer
      );
    end if;

    insert into public.unlimited_usage (user_id, route, units, model, request_id)
    values (v_owner, p_route, p_units, left(p_model, 200), v_request)
    on conflict (user_id, request_id) where request_id is not null do nothing;

    return jsonb_build_object('ok', true, 'remaining', v_balance, 'reason', null, 'unlimited', true);
  end if;

  -- A kid without the family's Unlimited spends the GROWN-UP's ink, never ink of their own (the free
  -- board after "Not now"): the grown-up's row is locked after the kid's own (the order above), the
  -- balance is read under that lock, and the usage row is written on the grown-up (the
  -- usage_events_apply_insert trigger takes the ink off the grown-up's balance).
  if v_owner <> v_uid then
    select pr.ink_balance into v_balance
    from public.profiles pr
    where pr.user_id = v_owner
    for update;

    if not found or v_balance < p_units then
      return jsonb_build_object('ok', false, 'remaining', coalesce(v_balance, 0), 'reason', 'insufficient_credits', 'plan_required', true);
    end if;

    insert into public.usage_events (user_id, route, units, model, request_id)
    values (v_owner, p_route, p_units, left(p_model, 200), v_request);

    return jsonb_build_object('ok', true, 'remaining', v_balance - p_units, 'reason', null);
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

-- Same as 20261009040000_family_hardening.sql, except the v_owner lines: the plan owner's profile
-- is locked too (after the caller's), the refunded call's usage_events row may be on the plan owner
-- (a kid's call on the free board), and `remaining` is the plan owner's balance.
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
  v_owner uuid;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;
  if p_request_id is null or char_length(p_request_id) < 1 or char_length(p_request_id) > 100 then
    raise exception 'p_request_id must be 1..100 characters' using errcode = '22023';
  end if;

  -- Same locks consume_credits() takes, in its order, so a refund and a spend for one family serialise.
  perform 1 from public.profiles pr where pr.user_id = p_user_id for update;
  v_owner := public.plan_owner_of(p_user_id);
  if v_owner <> p_user_id then
    perform 1 from public.profiles pr where pr.user_id = v_owner for update;
  end if;

  -- The one path allowed to delete usage rows (ink_ledger_guard_delete), for this statement only.
  perform set_config('agathon.ink_refund', 'on', true);
  with gone as (
    delete from public.usage_events u
    where u.user_id in (p_user_id, v_owner)
      and u.request_id = p_request_id
      and u.created_at > now() - interval '15 minutes'
    returning u.units
  )
  select coalesce(sum(units), 0)::integer into v_refunded from gone;
  perform set_config('agathon.ink_refund', 'off', true);

  delete from public.unlimited_usage u
  where u.user_id in (p_user_id, v_owner)
    and u.request_id = p_request_id
    and u.created_at > now() - interval '15 minutes';

  select pr.ink_balance into v_balance from public.profiles pr where pr.user_id = v_owner;
  return jsonb_build_object('refunded', v_refunded, 'remaining', coalesce(v_balance, 0));
end;
$$;
revoke all on function public.refund_ink_for(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_ink_for(uuid, text) to service_role;

-- Same as 20261003020000_unlimited.sql, except the v_owner lines: a kid without the family's
-- Unlimited is shown the ink they can spend, the grown-up's (see the header).
create or replace function public.ink_summary()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_family jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  perform public.ensure_ink_account(v_uid);
  v_owner := public.plan_owner_of(v_uid);
  if v_owner <> v_uid and not public.has_unlimited(v_uid) then
    v_family := public.ink_summary_of(v_owner);
    return public.ink_summary_of(v_uid)
      || jsonb_build_object(
           'balance',    v_family -> 'balance',
           'granted',    v_family -> 'granted',
           'used',       v_family -> 'used',
           'starter',    v_family -> 'starter',
           'starter_at', v_family -> 'starter_at',
           'family_ink', true
         )
      || jsonb_build_object('unlimited', public.unlimited_state_of(v_uid));
  end if;
  return public.ink_summary_of(v_uid) || jsonb_build_object('unlimited', public.unlimited_state_of(v_uid));
end;
$$;
revoke all on function public.ink_summary() from public, anon;
grant execute on function public.ink_summary() to authenticated;

-- -----------------------------------------------------------------------------
-- 3. The iPad onboarding's steps
-- -----------------------------------------------------------------------------
alter table public.start_steps drop constraint if exists start_steps_event_known;
alter table public.start_steps add constraint start_steps_event_known check (event in (
  'start_shown', 'start_who', 'start_name', 'start_grade', 'start_focus', 'start_proof',
  'start_try_shown', 'start_try_checked', 'start_plan', 'start_account_shown',
  'start_handoff', 'start_handoff_opened', 'start_account',
  'start_handoff_kid', 'start_handoff_grownup', 'start_gate',
  'start_trial_shown', 'start_trial_started', 'start_trial_pending', 'start_trial_declined',
  'start_pin_set', 'start_kid_added', 'start_first_board'
));

-- PostgREST caches the schema; the new tables and changed functions need a reload.
notify pgrst, 'reload schema';
