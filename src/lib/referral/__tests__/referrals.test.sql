-- Referrals (supabase/migrations/20261009110000_referrals.sql and 20261009140000_referral_hardening.sql)
-- against a real Postgres: codes, the referral recorded when a new account's attribution is saved
-- (and every refusal: self, kids, old accounts, accounts that already have a plan or were made more
-- than a day before the save, unknown codes), the status following the friend's plan (back to
-- trialing when the first charge fails, never touching a rewarded or void one), the ref leaving the
-- friend's attribution when the referral is voided or deleted, the referrer's summary, the admin's
-- list and buttons (a reward only once the friend's plan is active and settled) with their audit
-- rows, and who may call what. Runs in one transaction that is rolled back, so nothing it seeds is
-- left behind.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 \
--     -f src/lib/referral/__tests__/referrals.test.sql
--
-- (or RUN_DB_TESTS=1 npx vitest run src/lib/referral/__tests__/referrals.integration.test.ts)
-- A failed expectation raises, which aborts the run with a non-zero exit.
--
-- now() is the transaction's start for the whole run, so it is when every code here is made: the
-- "new" accounts are dated a minute after it and the "old" ones a day or more before. Time passing
-- (a payment settling, a code made days ago) is written into the rows as postgres.

\set QUIET on
\set ON_ERROR_STOP on
begin;
-- the expectations' empty rows are not worth printing (errors still are)
\o /dev/null

select gen_random_uuid() as a_id, gen_random_uuid() as b_id, gen_random_uuid() as c_id, gen_random_uuid() as d_id,
       gen_random_uuid() as e_id, gen_random_uuid() as f_id, gen_random_uuid() as g_id, gen_random_uuid() as k_id,
       gen_random_uuid() as x_id, gen_random_uuid() as h_id, gen_random_uuid() as j_id, gen_random_uuid() as r_id,
       gen_random_uuid() as w_id
\gset

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email,
       jsonb_build_object('terms_version', '2026-10-08'), v.at, v.at
  from (values
    -- A: the referrer, an old account
    (:'a_id', 'referral-test-a-' || :'a_id' || '@example.com', now() - interval '30 days'),
    -- B, D, E, G, J: new accounts; C: made the day before A's code
    (:'b_id', 'referral-test-b-' || :'b_id' || '@example.com', now() + interval '1 minute'),
    (:'c_id', 'referral-test-c-' || :'c_id' || '@example.com', now() - interval '1 day'),
    (:'d_id', 'referral-test-d-' || :'d_id' || '@example.com', now() + interval '1 minute'),
    (:'e_id', 'referral-test-e-' || :'e_id' || '@example.com', now() + interval '1 minute'),
    -- F: a kid address with no family row (yet)
    (:'f_id', 'kid-' || :'f_id' || '@kids.agathon.app', now() + interval '1 minute'),
    (:'g_id', 'referral-test-g-' || :'g_id' || '@example.com', now() + interval '1 minute'),
    (:'j_id', 'referral-test-j-' || :'j_id' || '@example.com', now() + interval '1 minute'),
    -- K: A's own kid profile, made after the code
    (:'k_id', 'referral-test-k-' || :'k_id' || '@example.com', now() + interval '1 minute'),
    -- X: the admin who marks rewards
    (:'x_id', 'referral-test-x-' || :'x_id' || '@example.com', now() - interval '30 days'),
    -- R: a second referrer, whose code is dated 10 days back below; H: made 2 days ago (after R's
    -- code, but long before its attribution is saved); W: R's new friend
    (:'r_id', 'referral-test-r-' || :'r_id' || '@example.com', now() - interval '30 days'),
    (:'h_id', 'referral-test-h-' || :'h_id' || '@example.com', now() - interval '2 days'),
    (:'w_id', 'referral-test-w-' || :'w_id' || '@example.com', now() + interval '1 minute')
  ) as v(id, email, at);

insert into public.families (parent_id) values (:'a_id');
insert into public.family_members (child_id, parent_id) values (:'k_id', :'a_id');

create or replace function pg_temp.rt_expect(p_what text, p_got jsonb, p_want jsonb) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'referrals test failed: %: got %, want %', p_what, p_got, p_want;
  end if;
end;
$$;

-- Runs p_sql as whoever the session is now; answers 'ok', or the error's state, and its hint when
-- it is one of ours (a snake_case word: family_kid, referral_state, referral_unsettled, not_found).
create or replace function pg_temp.rt_try(p_sql text) returns text language plpgsql as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || case when v_hint ~ '^[a-z_]+$' then ':' || v_hint else '' end;
end;
$$;

-- One referral's status and whether it is dated paid; null when there is none.
create or replace function pg_temp.rt_ref(p_uid uuid) returns jsonb language sql as $$
  select jsonb_build_object('status', r.status, 'paid', r.paid_at is not null) from public.referrals r where r.referred_id = p_uid
$$;

-- The account's attribution's ref, or null.
create or replace function pg_temp.rt_attr_ref(p_uid uuid) returns jsonb language sql as $$
  select coalesce(p.attribution -> 'ref', 'null'::jsonb) from public.profiles p where p.user_id = p_uid
$$;

-- -----------------------------------------------------------------------------
-- A's code
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'a_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.my_referral_code() as a_code \gset
select public.my_referral_code() as a_code_again \gset
select public.referral_summary() as a_summary0 \gset
reset role;

select pg_temp.rt_expect('a: 8 characters, no vowels, no look-alikes', to_jsonb(:'a_code' ~ '^[BCDFGHJKMNPQRSTVWXYZ2-9]{8}$'), 'true');
select pg_temp.rt_expect('a: the same code every time', to_jsonb(:'a_code' = :'a_code_again'), 'true');
select pg_temp.rt_expect('a: the code is on the profile, dated', to_jsonb((select referral_code = :'a_code' and referral_code_at = now() from public.profiles where user_id = :'a_id')), 'true');
select pg_temp.rt_expect('a: the summary before anyone joined', :'a_summary0'::jsonb,
  jsonb_build_object('code', :'a_code', 'signed_up', 0, 'paid', 0, 'months_earned', 0, 'months_pending', 0));

-- R's code, made 10 days ago (H and W were both made after it)
select set_config('request.jwt.claims', json_build_object('sub', :'r_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.my_referral_code() as r_code \gset
reset role;
update public.profiles set referral_code_at = now() - interval '10 days' where user_id = :'r_id';

-- -----------------------------------------------------------------------------
-- Recording, through save_attribution as each account
-- -----------------------------------------------------------------------------
-- B: a new account with A's code, typed in lower case with spaces
select set_config('request.jwt.claims', json_build_object('sub', :'b_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.save_attribution(jsonb_build_object('firstSeenAt', '2026-10-09T00:00:00Z', 'utmSource', 'friend', 'ref', ' ' || lower(:'a_code') || ' ')) as b_saved \gset
select public.save_attribution(jsonb_build_object('firstSeenAt', '2026-10-09T00:00:00Z', 'ref', :'a_code')) as b_saved_again \gset
select count(*) as b_sees from public.referrals \gset
select attribution as b_attr from public.profiles where user_id = :'b_id' \gset
reset role;
select pg_temp.rt_expect('b: saved once', to_jsonb(:'b_saved'::boolean and not :'b_saved_again'::boolean), 'true');
select pg_temp.rt_expect('b: a referral from A, signed up', (select jsonb_build_object('referrer', referrer_id, 'code', code, 'status', status, 'paid_at', paid_at) from public.referrals where referred_id = :'b_id'),
  jsonb_build_object('referrer', :'a_id', 'code', :'a_code', 'status', 'signed_up', 'paid_at', null));
select pg_temp.rt_expect('b: the ref kept, as the code', :'b_attr'::jsonb - 'firstSeenAt', jsonb_build_object('utmSource', 'friend', 'ref', :'a_code'));
select pg_temp.rt_expect('b: the referred account reads no referral rows', to_jsonb(:'b_sees'::int), '0');

-- A: their own code (self-referral), on their own account
select set_config('request.jwt.claims', json_build_object('sub', :'a_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.save_attribution(jsonb_build_object('firstSeenAt', '2026-10-09T00:00:00Z', 'ref', :'a_code')) as ignored \gset
reset role;
select pg_temp.rt_expect('self: no referral', to_jsonb((select count(*) from public.referrals where referred_id = :'a_id')), '0');
select pg_temp.rt_expect('self: the ref dropped, the rest kept', (select attribution from public.profiles where user_id = :'a_id'), '{"firstSeenAt":"2026-10-09T00:00:00Z"}');

-- C (made before the code), K (A's kid), F (a kid address), E (an unknown code, then garbage)
select set_config('request.jwt.claims', json_build_object('sub', :'c_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.save_attribution(jsonb_build_object('firstSeenAt', '2026-10-09T00:00:00Z', 'ref', :'a_code')) as ignored \gset
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'k_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.save_attribution(jsonb_build_object('firstSeenAt', '2026-10-09T00:00:00Z', 'ref', :'a_code')) as ignored \gset
select pg_temp.rt_try('select public.my_referral_code()') as k_code_try \gset
select pg_temp.rt_try('select public.referral_summary()') as k_summary_try \gset
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.save_attribution(jsonb_build_object('firstSeenAt', '2026-10-09T00:00:00Z', 'ref', :'a_code')) as ignored \gset
select pg_temp.rt_try('select public.my_referral_code()') as f_code_try \gset
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'e_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.save_attribution('{"firstSeenAt":"2026-10-09T00:00:00Z","ref":"ZZZZZZZZ"}'::jsonb) as ignored \gset
reset role;

select pg_temp.rt_expect('old account: no referral', to_jsonb((select count(*) from public.referrals where referred_id = :'c_id')), '0');
select pg_temp.rt_expect('old account: ref dropped', (select attribution ? 'ref' from public.profiles where user_id = :'c_id')::text::jsonb, 'false');
select pg_temp.rt_expect('own kid: no referral', to_jsonb((select count(*) from public.referrals where referred_id = :'k_id')), '0');
select pg_temp.rt_expect('own kid: no code (42501 family_kid)', to_jsonb(:'k_code_try'::text), '"42501:family_kid"');
select pg_temp.rt_expect('own kid: no summary', to_jsonb(:'k_summary_try'::text), '"42501:family_kid"');
select pg_temp.rt_expect('kid address: no referral', to_jsonb((select count(*) from public.referrals where referred_id = :'f_id')), '0');
select pg_temp.rt_expect('kid address: no code', to_jsonb(:'f_code_try'::text), '"42501:family_kid"');
select pg_temp.rt_expect('unknown code: no referral, ref dropped', (select jsonb_build_object('n', (select count(*) from public.referrals where referred_id = :'e_id'), 'ref', attribution ? 'ref') from public.profiles where user_id = :'e_id'), '{"n":0,"ref":false}');

-- E's attribution is set now: a second save (another code) changes nothing
update public.profiles set attribution = jsonb_build_object('firstSeenAt', 'x', 'ref', :'a_code') where user_id = :'e_id';
select pg_temp.rt_expect('a later attribution change records nothing', to_jsonb((select count(*) from public.referrals where referred_id = :'e_id')), '0');

-- Late attach. G: a new account that already has a plan (here a paying one) when its attribution
-- is saved; H: an account made 2 days before the save, after R's code. Neither is recorded (it was
-- not the invite that brought them), and neither keeps the ref (no friend's free-month link).
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status) values ('sub_reftest_g', :'g_id', 'active');
select set_config('request.jwt.claims', json_build_object('sub', :'g_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.save_attribution(jsonb_build_object('firstSeenAt', '2026-10-09T00:00:00Z', 'ref', :'a_code')) as g_saved \gset
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'h_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.save_attribution(jsonb_build_object('firstSeenAt', '2026-10-09T00:00:00Z', 'utmSource', 'friend', 'ref', :'r_code')) as h_saved \gset
reset role;
select pg_temp.rt_expect('late attach, already has a plan: saved, no referral, ref stripped',
  jsonb_build_object('saved', :'g_saved'::boolean, 'referral', pg_temp.rt_ref(:'g_id'), 'ref', pg_temp.rt_attr_ref(:'g_id')),
  '{"saved":true,"referral":null,"ref":null}');
select pg_temp.rt_expect('late attach, made 2 days before the save: no referral, ref stripped, the rest kept',
  jsonb_build_object('saved', :'h_saved'::boolean, 'referral', pg_temp.rt_ref(:'h_id'), 'attribution', (select attribution - 'firstSeenAt' from public.profiles where user_id = :'h_id')),
  '{"saved":true,"referral":null,"attribution":{"utmSource":"friend"}}');

-- W: a new account with R's code is recorded (the code itself is fine; H was too late)
select set_config('request.jwt.claims', json_build_object('sub', :'w_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.save_attribution(jsonb_build_object('firstSeenAt', '2026-10-09T00:00:00Z', 'ref', :'r_code')) as ignored \gset
reset role;
select pg_temp.rt_expect('w: R''s new friend is recorded, ref kept', jsonb_build_object('referral', pg_temp.rt_ref(:'w_id'), 'ref', pg_temp.rt_attr_ref(:'w_id')),
  jsonb_build_object('referral', jsonb_build_object('status', 'signed_up', 'paid', false), 'ref', :'r_code'));

-- D: the checkout links later (a row with no user first); J: a friend whose plan starts active
select set_config('request.jwt.claims', json_build_object('sub', :'d_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.save_attribution(jsonb_build_object('firstSeenAt', '2026-10-09T00:00:00Z', 'ref', :'a_code')) as ignored \gset
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'j_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.save_attribution(jsonb_build_object('firstSeenAt', '2026-10-09T00:00:00Z', 'ref', :'a_code')) as ignored \gset
reset role;

-- -----------------------------------------------------------------------------
-- Following the friend's plan
-- -----------------------------------------------------------------------------
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status) values ('sub_reftest_b', :'b_id', 'trialing');
select pg_temp.rt_expect('b: trialing', pg_temp.rt_ref(:'b_id'), '{"status":"trialing","paid":false}');
-- the trial ends: Stripe says 'active' about an hour before it tries the first charge
update public.unlimited_subscriptions set status = 'active' where stripe_subscription_id = 'sub_reftest_b';
select pg_temp.rt_expect('b: active, so paid, dated', pg_temp.rt_ref(:'b_id'), '{"status":"paid","paid":true}');
update public.unlimited_subscriptions set status = 'trialing' where stripe_subscription_id = 'sub_reftest_b';
select pg_temp.rt_expect('b: a trial again is not a step back', pg_temp.rt_ref(:'b_id'), '{"status":"paid","paid":true}');
-- the first charge is declined
update public.unlimited_subscriptions set status = 'past_due' where stripe_subscription_id = 'sub_reftest_b';
select pg_temp.rt_expect('b: paid, then past_due: back to trialing, undated', pg_temp.rt_ref(:'b_id'), '{"status":"trialing","paid":false}');
-- a retry is paid
update public.unlimited_subscriptions set status = 'active' where stripe_subscription_id = 'sub_reftest_b';
select pg_temp.rt_expect('b: active again: paid again, dated anew', pg_temp.rt_ref(:'b_id'), '{"status":"paid","paid":true}');
-- an old plan of B's, ended, written late: B's active plan keeps the referral paid
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status) values ('sub_reftest_b_old', :'b_id', 'canceled');
select pg_temp.rt_expect('b: another plan ending does not undo an active one', pg_temp.rt_ref(:'b_id'), '{"status":"paid","paid":true}');

-- every failing or stopped status undoes 'paid'
do $$
declare
  v_uid uuid := (select referred_id from public.referrals r join auth.users u on u.id = r.referred_id where u.email like 'referral-test-j-%');
  v_status text;
  v_got text;
begin
  insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status) values ('sub_reftest_j', v_uid, 'trialing');
  foreach v_status in array array['past_due', 'unpaid', 'canceled', 'incomplete_expired', 'paused'] loop
    update public.unlimited_subscriptions set status = 'active' where stripe_subscription_id = 'sub_reftest_j';
    update public.unlimited_subscriptions set status = v_status where stripe_subscription_id = 'sub_reftest_j';
    select r.status || ':' || (r.paid_at is not null)::text into v_got from public.referrals r where r.referred_id = v_uid;
    if v_got is distinct from 'trialing:false' then
      raise exception 'referrals test failed: j: paid, then %: got %, want trialing:false', v_status, v_got;
    end if;
  end loop;
  -- J's plan ends up active, its trial having ended a day ago
  update public.unlimited_subscriptions set status = 'active', trial_end = now() - interval '1 day' where stripe_subscription_id = 'sub_reftest_j';
end;
$$;
select pg_temp.rt_expect('j: active: paid', pg_temp.rt_ref(:'j_id'), '{"status":"paid","paid":true}');

insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status) values ('sub_reftest_d', null, 'trialing');
select pg_temp.rt_expect('d: an unlinked plan moves nothing', (select to_jsonb(status) from public.referrals where referred_id = :'d_id'), '"signed_up"');
update public.unlimited_subscriptions set user_id = :'d_id' where stripe_subscription_id = 'sub_reftest_d';
select pg_temp.rt_expect('d: linked, trialing', (select to_jsonb(status) from public.referrals where referred_id = :'d_id'), '"trialing"');

-- the referrer's own plan (the customer the credit goes to)
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, payer_email)
values ('sub_reftest_a', :'a_id', 'active', 'cus_reftest_a', 'payer-a@example.com');
select pg_temp.rt_expect('a: their own plan is not a referral', to_jsonb((select count(*) from public.referrals where referred_id = :'a_id')), '0');

-- -----------------------------------------------------------------------------
-- What A reads, and what nobody may write
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'a_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.referral_summary() as a_summary1 \gset
select count(*) as a_rows from public.referrals \gset
select pg_temp.rt_try('select referred_id from public.referrals') as a_referred_try \gset
select pg_temp.rt_try(format('insert into public.referrals (referrer_id, referred_id, code) values (%L, %L, %L)', :'a_id', :'c_id', :'a_code')) as a_insert_try \gset
select pg_temp.rt_try(format('update public.referrals set status = %L', 'rewarded')) as a_update_try \gset
select pg_temp.rt_try('delete from public.referrals') as a_delete_try \gset
select pg_temp.rt_try(format('update public.profiles set referral_code = %L where user_id = %L', 'BCDFGHJK', :'a_id')) as a_code_write_try \gset
select pg_temp.rt_try('select public.admin_referrals(10)') as a_admin_try \gset
select pg_temp.rt_try(format('select public.admin_referral_mark(1, %L, %L)', 'rewarded', :'a_id')) as a_mark_try \gset
select pg_temp.rt_try(format('select public.referral_code_for(%L)', :'b_id')) as a_code_for_try \gset
select pg_temp.rt_try('select public.referral_new_code()') as a_new_code_try \gset
select pg_temp.rt_try(format('select public.referral_is_kid(%L)', :'k_id')) as a_is_kid_try \gset
select pg_temp.rt_try(format('select public.referral_plan_status(%L)', :'b_id')) as a_plan_try \gset
select pg_temp.rt_try('select public.referral_entry(1)') as a_entry_try \gset
reset role;
set local role anon;
select pg_temp.rt_try('select public.my_referral_code()') as anon_code_try \gset
select pg_temp.rt_try('select public.referral_summary()') as anon_summary_try \gset
select pg_temp.rt_try('select id from public.referrals') as anon_read_try \gset
reset role;

select pg_temp.rt_expect('a: summary (B paid, D trialing, J paid)', :'a_summary1'::jsonb,
  jsonb_build_object('code', :'a_code', 'signed_up', 3, 'paid', 2, 'months_earned', 0, 'months_pending', 2));
select pg_temp.rt_expect('a: reads their 3 rows', to_jsonb(:'a_rows'::int), '3');
select pg_temp.rt_expect('a: never the referred account''s id', to_jsonb(:'a_referred_try'::text), '"42501"');
select pg_temp.rt_expect('a: no insert', to_jsonb(:'a_insert_try'::text), '"42501"');
select pg_temp.rt_expect('a: no update', to_jsonb(:'a_update_try'::text), '"42501"');
select pg_temp.rt_expect('a: no delete', to_jsonb(:'a_delete_try'::text), '"42501"');
select pg_temp.rt_expect('a: cannot write their code', to_jsonb(:'a_code_write_try'::text), '"42501"');
select pg_temp.rt_expect('a: no admin_referrals', to_jsonb(:'a_admin_try'::text), '"42501"');
select pg_temp.rt_expect('a: no admin_referral_mark', to_jsonb(:'a_mark_try'::text), '"42501"');
select pg_temp.rt_expect('a: no referral_code_for', to_jsonb(:'a_code_for_try'::text), '"42501"');
select pg_temp.rt_expect('a: no referral_new_code', to_jsonb(:'a_new_code_try'::text), '"42501"');
select pg_temp.rt_expect('a: no referral_is_kid', to_jsonb(:'a_is_kid_try'::text), '"42501"');
select pg_temp.rt_expect('a: no referral_plan_status', to_jsonb(:'a_plan_try'::text), '"42501"');
select pg_temp.rt_expect('a: no referral_entry', to_jsonb(:'a_entry_try'::text), '"42501"');
select pg_temp.rt_expect('anon: no code', to_jsonb(:'anon_code_try'::text), '"42501"');
select pg_temp.rt_expect('anon: no summary', to_jsonb(:'anon_summary_try'::text), '"42501"');
select pg_temp.rt_expect('anon: no rows', to_jsonb(:'anon_read_try'::text), '"42501"');
select pg_temp.rt_expect('internal: no client may call referrals_strip_ref',
  to_jsonb((select has_function_privilege('authenticated', 'public.referrals_strip_ref()', 'execute') or has_function_privilege('anon', 'public.referrals_strip_ref()', 'execute'))), 'false');

-- -----------------------------------------------------------------------------
-- The admin's list and buttons (service role)
-- -----------------------------------------------------------------------------
select id as b_ref from public.referrals where referred_id = :'b_id' \gset
select id as d_ref from public.referrals where referred_id = :'d_id' \gset
select id as j_ref from public.referrals where referred_id = :'j_id' \gset
select pg_temp.rt_expect('d: the ref is there before the void', pg_temp.rt_attr_ref(:'d_id'), to_jsonb(:'a_code'::text));
set local role service_role;
select public.admin_referrals(1000) as list \gset
-- B was paid a moment ago: its first charge may still fail
select pg_temp.rt_try(format('select public.admin_referral_mark(%s, %L, %L)', :'b_ref', 'rewarded', :'x_id')) as b_early_try \gset
reset role;
-- four days pass
update public.referrals set paid_at = now() - interval '4 days' where id = :'b_ref';
set local role service_role;
select public.admin_referral_mark(:'b_ref', 'rewarded', :'x_id') as marked \gset
select pg_temp.rt_try(format('select public.admin_referral_mark(%s, %L, %L)', :'b_ref', 'rewarded', :'x_id')) as again_try \gset
select pg_temp.rt_try(format('select public.admin_referral_mark(%s, %L, %L)', :'b_ref', 'void', :'x_id')) as void_rewarded_try \gset
select pg_temp.rt_try(format('select public.admin_referral_mark(%s, %L, %L)', :'d_ref', 'rewarded', :'x_id')) as reward_trialing_try \gset
select pg_temp.rt_try(format('select public.admin_referral_mark(%s, %L, %L)', :'d_ref', 'paid', :'x_id')) as bad_status_try \gset
select pg_temp.rt_try(format('select public.admin_referral_mark(%s, %L, %L)', -1, 'void', :'x_id')) as missing_try \gset
select public.admin_referral_mark(:'d_ref', 'void', :'x_id') as voided \gset
select pg_temp.rt_try('select public.admin_referrals(0)') as bad_limit_try \gset
reset role;

select pg_temp.rt_expect('list: B with both emails, A''s Stripe customer and payer email, B''s active plan',
  (select e - 'created_at' - 'updated_at' - 'paid_at' - 'id'
          || jsonb_build_object('referrer', (e -> 'referrer') - 'created_at', 'referred', (e -> 'referred') - 'created_at')
     from jsonb_array_elements(:'list'::jsonb -> 'referrals') e where (e -> 'referred' ->> 'id') = :'b_id'),
  jsonb_build_object(
    'code', :'a_code', 'status', 'paid', 'rewarded_at', null, 'rewarded_by_email', null,
    'referrer', jsonb_build_object('id', :'a_id', 'email', 'referral-test-a-' || :'a_id' || '@example.com', 'customer_id', 'cus_reftest_a', 'payer_email', 'payer-a@example.com'),
    'referred', jsonb_build_object('id', :'b_id', 'email', 'referral-test-b-' || :'b_id' || '@example.com', 'payer_email', null, 'plan_status', 'active', 'trial_end', null)));
select pg_temp.rt_expect('list: J''s plan and its trial end',
  (select (e -> 'referred') - 'id' - 'email' - 'created_at' - 'payer_email' from jsonb_array_elements(:'list'::jsonb -> 'referrals') e where (e -> 'referred' ->> 'id') = :'j_id'),
  jsonb_build_object('plan_status', 'active', 'trial_end', to_jsonb(now() - interval '1 day')));
select pg_temp.rt_expect('list: newest first (same time: the later row first), not truncated',
  jsonb_build_object('truncated', :'list'::jsonb -> 'truncated',
    'ids', (select jsonb_agg((e ->> 'id')::bigint order by ord) from jsonb_array_elements(:'list'::jsonb -> 'referrals') with ordinality x(e, ord) where (e -> 'referrer' ->> 'id') = :'a_id')),
  jsonb_build_object('truncated', false,
    'ids', (select jsonb_agg(id order by id desc) from public.referrals where referrer_id = :'a_id')));
select pg_temp.rt_expect('mark: not while the first payment may still fail', to_jsonb(:'b_early_try'::text), '"P0001:referral_unsettled"');
select pg_temp.rt_expect('mark: rewarded, by X, dated', jsonb_build_object('status', :'marked'::jsonb ->> 'status', 'by', :'marked'::jsonb ->> 'rewarded_by_email', 'at', (:'marked'::jsonb ->> 'rewarded_at') is not null),
  jsonb_build_object('status', 'rewarded', 'by', 'referral-test-x-' || :'x_id' || '@example.com', 'at', true));
select pg_temp.rt_expect('mark: rewarded_by stored', (select to_jsonb(rewarded_by) from public.referrals where id = :'b_ref'), to_jsonb(:'x_id'::uuid));
select pg_temp.rt_expect('mark: audited (the refused tries left nothing)', (select jsonb_agg(jsonb_build_object('action', action, 'kind', target_kind, 'meta', meta) order by id) from public.admin_audit where admin_id = :'x_id'),
  '[{"action":"referral.reward","kind":"referral","meta":{"from":"paid","to":"rewarded"}},{"action":"referral.void","kind":"referral","meta":{"from":"trialing","to":"void"}}]');
select pg_temp.rt_expect('mark: rewarded is final', to_jsonb(:'again_try'::text), '"P0001:referral_state"');
select pg_temp.rt_expect('mark: a reward is not voided', to_jsonb(:'void_rewarded_try'::text), '"P0001:referral_state"');
select pg_temp.rt_expect('mark: a trial is not rewarded', to_jsonb(:'reward_trialing_try'::text), '"P0001:referral_state"');
select pg_temp.rt_expect('mark: only rewarded or void', to_jsonb(:'bad_status_try'::text), '"22023"');
select pg_temp.rt_expect('mark: no such referral', to_jsonb(:'missing_try'::text), '"P0002:not_found"');
select pg_temp.rt_expect('void: D', to_jsonb(:'voided'::jsonb ->> 'status'), '"void"');
select pg_temp.rt_expect('void: D''s ref leaves its attribution (no free-month link), the rest stays',
  (select jsonb_build_object('ref', attribution ? 'ref', 'firstSeenAt', attribution ->> 'firstSeenAt') from public.profiles where user_id = :'d_id'),
  '{"ref":false,"firstSeenAt":"2026-10-09T00:00:00Z"}');
select pg_temp.rt_expect('list: a bad limit', to_jsonb(:'bad_limit_try'::text), '"22023"');

-- rewarded stays rewarded: B's plan failing now changes nothing
update public.unlimited_subscriptions set status = 'past_due' where stripe_subscription_id = 'sub_reftest_b';
select pg_temp.rt_expect('b: rewarded, then past_due: still rewarded', (select jsonb_build_object('status', status, 'paid', paid_at is not null, 'rewarded', rewarded_at is not null) from public.referrals where id = :'b_ref'),
  '{"status":"rewarded","paid":true,"rewarded":true}');
-- void is final too: D's plan going active leaves it void
update public.unlimited_subscriptions set status = 'active' where stripe_subscription_id = 'sub_reftest_d';
select pg_temp.rt_expect('d: void stays void', (select to_jsonb(status) from public.referrals where referred_id = :'d_id'), '"void"');

-- J: paid 5 days ago, but its trial ended only a day ago: the later of the two counts
update public.referrals set paid_at = now() - interval '5 days' where id = :'j_ref';
set local role service_role;
select pg_temp.rt_try(format('select public.admin_referral_mark(%s, %L, %L)', :'j_ref', 'rewarded', :'x_id')) as j_trial_try \gset
reset role;
-- the trial ended 4 days ago, but the plan is in a trial again (not active): still nothing owed
update public.unlimited_subscriptions set trial_end = now() - interval '4 days', status = 'trialing' where stripe_subscription_id = 'sub_reftest_j';
set local role service_role;
select pg_temp.rt_try(format('select public.admin_referral_mark(%s, %L, %L)', :'j_ref', 'rewarded', :'x_id')) as j_plan_try \gset
reset role;
select pg_temp.rt_ref(:'j_id') as j_plan_ref \gset
-- then it is canceled: back to trialing, so not rewardable at all
update public.unlimited_subscriptions set status = 'canceled' where stripe_subscription_id = 'sub_reftest_j';
set local role service_role;
select pg_temp.rt_try(format('select public.admin_referral_mark(%s, %L, %L)', :'j_ref', 'rewarded', :'x_id')) as j_canceled_try \gset
reset role;
select pg_temp.rt_expect('mark: not before 3 days past the trial end', to_jsonb(:'j_trial_try'::text), '"P0001:referral_unsettled"');
select pg_temp.rt_expect('mark: not while the friend''s plan is not active', jsonb_build_object('try', :'j_plan_try'::text, 'referral', :'j_plan_ref'::jsonb),
  '{"try":"P0001:referral_unsettled","referral":{"status":"paid","paid":true}}');
select pg_temp.rt_expect('mark: a canceled plan''s referral is back to trialing, not rewardable', jsonb_build_object('try', :'j_canceled_try'::text, 'referral', pg_temp.rt_ref(:'j_id')),
  '{"try":"P0001:referral_state","referral":{"status":"trialing","paid":false}}');

select set_config('request.jwt.claims', json_build_object('sub', :'a_id', 'role', 'authenticated')::text, true) is not null as ok \gset
set local role authenticated;
select public.referral_summary() as a_summary2 \gset
reset role;
select pg_temp.rt_expect('a: 1 free month earned, none on its way (J back to trialing), D left out', :'a_summary2'::jsonb,
  jsonb_build_object('code', :'a_code', 'signed_up', 2, 'paid', 1, 'months_earned', 1, 'months_pending', 0));

-- -----------------------------------------------------------------------------
-- A deleted referral takes the friend's ref too: R deletes their account (the cascade)
-- -----------------------------------------------------------------------------
delete from auth.users where id = :'r_id';
select pg_temp.rt_expect('r deleted: W''s referral is gone, and so is W''s ref', jsonb_build_object('referral', pg_temp.rt_ref(:'w_id'), 'ref', pg_temp.rt_attr_ref(:'w_id')),
  '{"referral":null,"ref":null}');

\o
\echo referrals: all expectations met
rollback;
