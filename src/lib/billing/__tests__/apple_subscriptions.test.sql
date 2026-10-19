-- Agathon Unlimited through Apple (supabase/migrations/20261017200000_apple_subscriptions.sql)
-- against a real Postgres: apply_apple_subscription()'s linking and ordering, the plan reaching the
-- family, the referral following an Apple plan, the deletion rule, and who may call what. Runs in
-- one transaction that is rolled back, so nothing is left behind.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 \
--     -f src/lib/billing/__tests__/apple_subscriptions.test.sql
--
-- (or RUN_DB_TESTS=1 npx vitest run src/lib/billing/__tests__/appleSubscriptions.integration.test.ts)
-- A failed expectation raises, which aborts the run with a non-zero exit.

\set QUIET on
begin;

create temp table ap_seed (tag text primary key, id uuid not null default gen_random_uuid()) on commit drop;
insert into ap_seed (tag) values ('grownup'), ('kid'), ('other'), ('referrer'), ('stripe'), ('solo');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select s.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'apple-test-' || s.tag || '-' || s.id || '@example.com',
       jsonb_build_object('terms_version', '2026-10-08'), now(), now()
  from ap_seed s;
insert into public.families (parent_id) select id from ap_seed where tag = 'grownup';
insert into public.family_members (parent_id, child_id)
select (select id from ap_seed where tag = 'grownup'), (select id from ap_seed where tag = 'kid');
insert into public.referrals (referrer_id, referred_id, code, status)
select (select id from ap_seed where tag = 'referrer'), (select id from ap_seed where tag = 'grownup'), 'BCDFGHJK', 'signed_up';

select id as grownup from ap_seed where tag = 'grownup' \gset
select id as kid from ap_seed where tag = 'kid' \gset
select id as other from ap_seed where tag = 'other' \gset
select id as stripe_user from ap_seed where tag = 'stripe' \gset
select id as solo from ap_seed where tag = 'solo' \gset
select checkout_ref as grownup_ref from public.profiles where user_id = :'grownup' \gset
select checkout_ref as kid_ref from public.profiles where user_id = :'kid' \gset

create or replace function pg_temp.ap_expect(p_what text, p_got anyelement, p_want anyelement) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'apple subscriptions test failed: %: got %, want %', p_what, p_got, p_want;
  end if;
end;
$$;

-- An Apple payload as the server maps it: (original id, status, as-of time, token, caller, ...).
create or replace function pg_temp.ap_apply(
  p_otid text, p_status text, p_at timestamptz, p_token uuid default null, p_claim uuid default null,
  p_trial_end timestamptz default null, p_period_end timestamptz default null, p_cancel boolean default null,
  p_ended timestamptz default null, p_env text default 'Sandbox'
) returns jsonb language sql as $$
  select public.apply_apple_subscription(
    p_original_transaction_id => p_otid, p_environment => p_env, p_product_id => 'app.agathon.unlimited.monthly',
    p_status => p_status, p_event_at => p_at, p_app_account_token => p_token, p_claim_user => p_claim,
    p_transaction_id => p_otid || '-' || extract(epoch from p_at)::bigint, p_trial_end => p_trial_end,
    p_current_period_end => p_period_end, p_cancel_at_period_end => p_cancel, p_canceled_at => p_ended,
    p_ended_at => p_ended, p_price_milliunits => 24990, p_currency => 'USD')
$$;

-- 1. SUBSCRIBED (INITIAL_BUY) in the free trial, from a notification: linked to the token's account
do $$
declare
  v_t0 timestamptz := now();
  v jsonb;
  r public.unlimited_subscriptions%rowtype;
begin
  v := pg_temp.ap_apply('2000000101', 'trialing', v_t0, (select checkout_ref from public.profiles p join ap_seed s on s.id = p.user_id where s.tag = 'grownup'),
                        p_trial_end => v_t0 + interval '7 days', p_period_end => v_t0 + interval '7 days', p_cancel => false);
  perform pg_temp.ap_expect('first notification applied', v ->> 'applied', 'true');
  perform pg_temp.ap_expect('first notification linked', v ->> 'linked', 'true');
  perform pg_temp.ap_expect('first notification grants Unlimited', v ->> 'unlimited', 'true');
  select * into r from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101';
  perform pg_temp.ap_expect('row is the grown-up''s', r.user_id, (select id from ap_seed where tag = 'grownup'));
  perform pg_temp.ap_expect('provider', r.provider, 'apple');
  perform pg_temp.ap_expect('original transaction id', r.apple_original_transaction_id, '2000000101');
  perform pg_temp.ap_expect('a Sandbox row is not live', r.livemode, false);
  perform pg_temp.ap_expect('trial end', r.trial_end, v_t0 + interval '7 days');
  perform pg_temp.ap_expect('price kept for the reminder', r.apple_price_milliunits, 24990::bigint);
  perform pg_temp.ap_expect('token kept', r.apple_app_account_token, (select checkout_ref from public.profiles p join ap_seed s on s.id = p.user_id where s.tag = 'grownup'));
  perform pg_temp.ap_expect('grown-up has Unlimited', public.has_unlimited((select id from ap_seed where tag = 'grownup')), true);
  perform pg_temp.ap_expect('the kid is covered by the family plan', public.has_unlimited((select id from ap_seed where tag = 'kid')), true);
  perform pg_temp.ap_expect('the kid''s summary shows the grown-up''s Apple plan',
                            public.unlimited_state_of((select id from ap_seed where tag = 'kid')) ->> 'provider', 'apple');
  perform pg_temp.ap_expect('the kid''s summary is trialing',
                            public.unlimited_state_of((select id from ap_seed where tag = 'kid')) ->> 'status', 'trialing');
  perform pg_temp.ap_expect('referral follows the Apple trial', (select status from public.referrals where referred_id = (select id from ap_seed where tag = 'grownup')), 'trialing');

  -- 2. an OLDER payload arriving late changes nothing (the ordering rule)
  v := pg_temp.ap_apply('2000000101', 'canceled', v_t0 - interval '1 hour', p_ended => v_t0 - interval '1 hour');
  perform pg_temp.ap_expect('older payload is stale', v ->> 'stale', 'true');
  perform pg_temp.ap_expect('older payload did not apply', (select status from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'), 'trialing');

  -- 3. the same payload again (a redelivery) is applied again, harmlessly
  v := pg_temp.ap_apply('2000000101', 'trialing', v_t0, p_trial_end => v_t0 + interval '7 days', p_period_end => v_t0 + interval '7 days');
  perform pg_temp.ap_expect('same-time payload applies again', v ->> 'applied', 'true');
  perform pg_temp.ap_expect('cancel flag kept when the payload does not say', (select cancel_at_period_end from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'), false);
  perform pg_temp.ap_expect('one row per subscription', (select count(*) from public.unlimited_subscriptions where apple_original_transaction_id = '2000000101'), 1::bigint);

  -- 4. DID_CHANGE_RENEWAL_STATUS (AUTO_RENEW_DISABLED): set to cancel, still Unlimited until the end
  v := pg_temp.ap_apply('2000000101', 'trialing', v_t0 + interval '1 hour', p_period_end => v_t0 + interval '7 days', p_cancel => true);
  perform pg_temp.ap_expect('auto-renew off -> cancel at period end', (select cancel_at_period_end from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'), true);
  perform pg_temp.ap_expect('still Unlimited while set to cancel', public.has_unlimited((select id from ap_seed where tag = 'grownup')), true);
  perform pg_temp.ap_expect('trial end kept from the first period', (select trial_end from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'), v_t0 + interval '7 days');
  v := pg_temp.ap_apply('2000000101', 'trialing', v_t0 + interval '2 hours', p_period_end => v_t0 + interval '7 days', p_cancel => false);

  -- 5. DID_RENEW: active; the referral is paid
  v := pg_temp.ap_apply('2000000101', 'active', v_t0 + interval '7 days', p_period_end => v_t0 + interval '37 days', p_cancel => false);
  perform pg_temp.ap_expect('renewed', (select status from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'), 'active');
  perform pg_temp.ap_expect('referral paid on an Apple renewal', (select status from public.referrals where referred_id = (select id from ap_seed where tag = 'grownup')), 'paid');
  perform pg_temp.ap_expect('trial end still kept after the renewal', (select trial_end from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'), v_t0 + interval '7 days');

  -- 6. DID_FAIL_TO_RENEW (billing retry) -> past_due: no Unlimited; the referral goes back
  v := pg_temp.ap_apply('2000000101', 'past_due', v_t0 + interval '37 days', p_period_end => v_t0 + interval '37 days');
  perform pg_temp.ap_expect('billing retry is not Unlimited', public.has_unlimited((select id from ap_seed where tag = 'grownup')), false);
  perform pg_temp.ap_expect('referral back to trialing on a failed charge', (select status from public.referrals where referred_id = (select id from ap_seed where tag = 'grownup')), 'trialing');

  -- 7. EXPIRED -> canceled
  v := pg_temp.ap_apply('2000000101', 'canceled', v_t0 + interval '50 days', p_period_end => v_t0 + interval '37 days', p_ended => v_t0 + interval '50 days');
  perform pg_temp.ap_expect('expired', (select status from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'), 'canceled');
  perform pg_temp.ap_expect('expired is not Unlimited', public.has_unlimited((select id from ap_seed where tag = 'kid')), false);

  -- 8. resubscribe (SUBSCRIBED/RESUBSCRIBE, same original id): canceled is not final for Apple
  v := pg_temp.ap_apply('2000000101', 'active', v_t0 + interval '60 days', p_period_end => v_t0 + interval '90 days', p_cancel => false);
  perform pg_temp.ap_expect('resubscribed', (select status from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'), 'active');
  perform pg_temp.ap_expect('resubscribed is Unlimited', public.has_unlimited((select id from ap_seed where tag = 'grownup')), true);
  perform pg_temp.ap_expect('ended_at cleared on resubscribe', (select ended_at from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'), null::timestamptz);

  -- 9. REFUND: canceled, ended at the revocation
  v := pg_temp.ap_apply('2000000101', 'canceled', v_t0 + interval '61 days', p_period_end => v_t0 + interval '90 days', p_ended => v_t0 + interval '61 days');
  perform pg_temp.ap_expect('refunded', (select status from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'), 'canceled');
  perform pg_temp.ap_expect('refunded is not Unlimited', public.has_unlimited((select id from ap_seed where tag = 'grownup')), false);
end;
$$;

-- 10. the transaction route's claims: the token decides, and a mismatch writes nothing
do $$
declare
  v_t0 timestamptz := now();
  v jsonb;
  v_g uuid := (select id from ap_seed where tag = 'grownup');
  v_k uuid := (select id from ap_seed where tag = 'kid');
  v_o uuid := (select id from ap_seed where tag = 'other');
  v_gref uuid := (select checkout_ref from public.profiles where user_id = (select id from ap_seed where tag = 'grownup'));
  v_kref uuid := (select checkout_ref from public.profiles where user_id = (select id from ap_seed where tag = 'kid'));
begin
  -- another account posting the grown-up's purchase: refused, nothing written
  v := pg_temp.ap_apply('2000000202', 'trialing', v_t0, v_gref, v_o, p_period_end => v_t0 + interval '7 days');
  perform pg_temp.ap_expect('token mismatch refused', v ->> 'refused', 'account_mismatch');
  perform pg_temp.ap_expect('token mismatch wrote nothing', (select count(*) from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000202'), 0::bigint);
  -- a token nobody has (an account deleted, a made-up token): refused for a caller
  v := pg_temp.ap_apply('2000000202', 'trialing', v_t0, gen_random_uuid(), v_o, p_period_end => v_t0 + interval '7 days');
  perform pg_temp.ap_expect('unknown token refused', v ->> 'refused', 'account_unknown');
  -- the kid's session forwarding the grown-up's purchase (a family iPad): allowed, the grown-up's
  v := pg_temp.ap_apply('2000000202', 'trialing', v_t0, v_gref, v_k, p_trial_end => v_t0 + interval '7 days', p_period_end => v_t0 + interval '7 days');
  perform pg_temp.ap_expect('kid forwards the family purchase', v ->> 'applied', 'true');
  perform pg_temp.ap_expect('linked to the grown-up, not the kid', (select user_id from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000202'), v_g);
  -- a purchase made with the kid's own token still lands on the grown-up (the plan is the family's)
  v := pg_temp.ap_apply('2000000303', 'trialing', v_t0, v_kref, p_period_end => v_t0 + interval '7 days');
  perform pg_temp.ap_expect('kid token links the grown-up', (select user_id from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000303'), v_g);
  -- no token (an offer code redeemed in the App Store): the caller's family takes it, first link wins
  v := pg_temp.ap_apply('2000000404', 'active', v_t0, null, v_o, p_period_end => v_t0 + interval '30 days');
  perform pg_temp.ap_expect('no token -> the caller', (select user_id from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000404'), v_o);
  v := pg_temp.ap_apply('2000000404', 'canceled', v_t0 + interval '1 hour', null, v_g, p_ended => v_t0);
  perform pg_temp.ap_expect('another family cannot take it over', v ->> 'conflict', 'true');
  perform pg_temp.ap_expect('and wrote nothing', (select status from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000404'), 'active');
  -- a notification with no usable token: recorded, linked to nobody, grants nothing
  v := pg_temp.ap_apply('2000000505', 'active', v_t0, gen_random_uuid(), p_period_end => v_t0 + interval '30 days');
  perform pg_temp.ap_expect('unlinked row recorded', (select user_id is null from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000505'), true);
  perform pg_temp.ap_expect('unlinked row grants nothing', v ->> 'unlimited', 'false');
  -- Xcode's local testing reuses ids after its transactions are deleted: another token there is a new purchase
  v := pg_temp.ap_apply('0', 'trialing', v_t0, v_gref, v_g, p_period_end => v_t0 + interval '7 days', p_env => 'Xcode');
  v := pg_temp.ap_apply('0', 'trialing', v_t0 - interval '1 day', (select checkout_ref from public.profiles where user_id = v_o), v_o, p_period_end => v_t0 + interval '6 days', p_env => 'Xcode');
  perform pg_temp.ap_expect('a reused Xcode id with another token starts over', v ->> 'applied', 'true');
  perform pg_temp.ap_expect('and is the new buyer''s', (select user_id from public.unlimited_subscriptions where stripe_subscription_id = 'apple:0'), v_o);
  -- Production rows are live
  v := pg_temp.ap_apply('2000000606', 'trialing', v_t0, null, v_o, p_period_end => v_t0 + interval '7 days', p_env => 'Production');
  perform pg_temp.ap_expect('a Production row is live', (select livemode from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000606'), true);
  -- never for Sandbox or Production rows: there an original id is one subscription for good
  v := pg_temp.ap_apply('2000000606', 'trialing', v_t0, v_gref, v_g, p_period_end => v_t0 + interval '7 days', p_env => 'Production');
  perform pg_temp.ap_expect('a Production row is not taken over', v ->> 'conflict', 'true');
end;
$$;

-- 11. one free trial per account, whichever store: a second plan's trial grants nothing
do $$
declare
  v_t0 timestamptz := now();
  v_s uuid := (select id from ap_seed where tag = 'stripe');
  v_sref uuid := (select checkout_ref from public.profiles where user_id = (select id from ap_seed where tag = 'stripe'));
begin
  insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status, ended_at)
  values ('sub_apple_test_earlier', v_s, 'canceled', v_t0 - interval '30 days');
  perform pg_temp.ap_apply('2000000707', 'trialing', v_t0, v_sref, p_trial_end => v_t0 + interval '7 days', p_period_end => v_t0 + interval '7 days');
  perform pg_temp.ap_expect('a returning subscriber''s Apple trial is not Unlimited', public.has_unlimited(v_s), false);
  perform pg_temp.ap_expect('and the summary says repeat_trial', public.unlimited_state_of(v_s) ->> 'repeat_trial', 'true');
end;
$$;

-- 12. the shape guard: a Stripe writer cannot make an Apple-looking row, nor an Apple row Stripe fields
do $$
begin
  begin
    perform public.apply_unlimited_subscription('apple:999', 'cus_x', 'active');
    raise exception 'apple subscriptions test failed: a Stripe writer made an apple: row';
  exception when check_violation then null;
  end;
  begin
    insert into public.unlimited_subscriptions (stripe_subscription_id, provider, apple_original_transaction_id, stripe_customer_id)
    values ('apple:998', 'apple', '998', 'cus_x');
    raise exception 'apple subscriptions test failed: an Apple row took a Stripe customer';
  exception when check_violation then null;
  end;
  begin
    perform pg_temp.ap_apply('bad id!', 'active', now());
    raise exception 'apple subscriptions test failed: a bad original transaction id was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform pg_temp.ap_apply('2000000808', 'active', now(), p_env => 'Staging');
    raise exception 'apple subscriptions test failed: an unknown environment was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

-- 13. who may call it: the service role only
do $$
begin
  perform pg_temp.ap_expect('authenticated cannot apply', has_function_privilege('authenticated',
    'public.apply_apple_subscription(text, text, text, text, timestamptz, uuid, uuid, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, bigint, text)', 'execute'), false);
  perform pg_temp.ap_expect('anon cannot apply', has_function_privilege('anon',
    'public.apply_apple_subscription(text, text, text, text, timestamptz, uuid, uuid, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, bigint, text)', 'execute'), false);
  perform pg_temp.ap_expect('service role applies', has_function_privilege('service_role',
    'public.apply_apple_subscription(text, text, text, text, timestamptz, uuid, uuid, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, bigint, text)', 'execute'), true);
end;
$$;

-- 14. deletion: an Apple plan that would charge again does not block (we cannot cancel it); a Stripe one does
select pg_temp.ap_apply('2000000909', 'active', now(), (select checkout_ref from public.profiles where user_id = :'solo'),
                        p_period_end => now() + interval '30 days', p_cancel => false) \gset ignored_
select set_config('request.jwt.claims', json_build_object('sub', :'solo', 'role', 'authenticated')::text, true) \gset ignored_
set local role authenticated;
select public.delete_own_account();
reset role;
do $$
begin
  perform pg_temp.ap_expect('the account with an Apple plan is gone', (select count(*) from auth.users where id = (select id from ap_seed where tag = 'solo')), 0::bigint);
  perform pg_temp.ap_expect('its Apple row stays, linked to nobody', (select user_id is null from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000909'), true);
end;
$$;

-- the grown-up with an Apple plan (active again below): deleting takes the kid's account too
select pg_temp.ap_apply('2000000101', 'active', now() + interval '100 days', p_period_end => now() + interval '130 days', p_cancel => false) \gset ignored_
select set_config('request.jwt.claims', json_build_object('sub', :'grownup', 'role', 'authenticated')::text, true) \gset ignored_
set local role authenticated;
select public.delete_own_account();
reset role;
do $$
begin
  perform pg_temp.ap_expect('the grown-up is gone', (select count(*) from auth.users where id = (select id from ap_seed where tag = 'grownup')), 0::bigint);
  perform pg_temp.ap_expect('and the kid with them', (select count(*) from auth.users where id = (select id from ap_seed where tag = 'kid')), 0::bigint);
  perform pg_temp.ap_expect('their Apple rows stay for the owner, linked to nobody',
    (select count(*) from public.unlimited_subscriptions where stripe_subscription_id in ('apple:2000000101', 'apple:2000000202', 'apple:2000000303') and user_id is null), 3::bigint);
end;
$$;

-- a later notification for a deleted family's subscription links nobody
do $$
declare v jsonb;
begin
  v := pg_temp.ap_apply('2000000101', 'active', now() + interval '200 days', (select apple_app_account_token from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'),
                        p_period_end => now() + interval '230 days');
  perform pg_temp.ap_expect('no account, no link', (select user_id is null from public.unlimited_subscriptions where stripe_subscription_id = 'apple:2000000101'), true);
end;
$$;

-- a Stripe plan that would charge again still blocks
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status, trial_end)
values ('sub_apple_test_stripe_block', :'other', 'trialing', now() + interval '7 days');
select set_config('request.jwt.claims', json_build_object('sub', :'other', 'role', 'authenticated')::text, true) \gset ignored_
set local role authenticated;
do $$
begin
  begin
    perform public.delete_own_account();
    raise exception 'apple subscriptions test failed: a charging Stripe plan did not block deletion';
  exception when raise_exception then
    if sqlerrm not like 'Cancel Agathon Unlimited%' then raise; end if;
  end;
end;
$$;
reset role;

select 'apple_subscriptions: all expectations met' as result;
rollback;
