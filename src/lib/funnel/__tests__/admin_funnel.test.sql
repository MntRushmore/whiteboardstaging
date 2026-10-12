-- admin_funnel() v2 (supabase/migrations/20261012020000_funnel_steps.sql, after
-- 20261009020000_funnel.sql) against a real Postgres: seeded accounts, every stage, the recorded
-- steps and when tracking began, ended trials, the time zone, kids and admins left out, and who
-- may call it. Runs in one transaction that is rolled back, so nothing it seeds is left behind.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 \
--     -f src/lib/funnel/__tests__/admin_funnel.test.sql
--
-- (or RUN_DB_TESTS=1 npx vitest run src/lib/funnel/__tests__/adminFunnel.integration.test.ts)
-- A failed expectation raises, which aborts the run with a non-zero exit.

\set QUIET on
begin;

-- Every seeded account signs up on 2026-09-01 at 15:00 UTC (11:00 in New York, a Tuesday: week of
-- Monday 2026-08-31) and is found again in the report by its own utm_source ('fq_<letter>').
create temp table fq_seed (tag text primary key, id uuid not null default gen_random_uuid()) on commit drop;
insert into fq_seed (tag) values ('a'), ('b'), ('c'), ('d'), ('kid'), ('e'), ('f'), ('g'), ('h'), ('i'), ('j'), ('l'), ('m'), ('n'), ('o'), ('admin');

create temp table fq_before on commit drop as
  select public.admin_funnel('America/New_York') as r;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select s.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'funnel-test-' || s.tag || '-' || s.id || '@example.com',
       jsonb_build_object('terms_version', '2026-10-08'),
       timestamptz '2026-09-01 15:00:00+00', timestamptz '2026-09-01 15:00:00+00'
  from fq_seed s;

-- the sign-up trigger made the profiles; date them and give each its own source
update public.profiles p
   set created_at = timestamptz '2026-09-01 15:00:00+00',
       attribution = jsonb_build_object('firstSeenAt', '2026-09-01T14:00:00Z', 'utmSource', 'FQ_' || s.tag)
  from fq_seed s
 where p.user_id = s.id;

-- a: onboarded, a problem the same day, nothing later
update public.profiles set onboarded_at = timestamptz '2026-09-01 16:00:00+00' where user_id = (select id from fq_seed where tag = 'a');
insert into public.learning_attempts (id, user_id, problem_latex, skill, origin, outcome, started_at)
select gen_random_uuid(), id, '3+4', 'add_within_10', 'starter', 'first_try', timestamptz '2026-09-01 17:00:00+00' from fq_seed where tag = 'a';

-- b: an AI call the next day in New York
insert into public.unlimited_usage (user_id, route, units, created_at)
select id, '/api/live/check', 1, timestamptz '2026-09-02 13:00:00+00' from fq_seed where tag = 'b';

-- c: an AI call at 02:00 UTC on the 2nd, still the 1st (22:00) in New York
insert into public.unlimited_usage (user_id, route, units, created_at)
select id, '/api/live/check', 1, timestamptz '2026-09-02 02:00:00+00' from fq_seed where tag = 'c';

-- d: a grown-up whose kid did a problem 8 days later (the kid's own row is left out of the report)
insert into public.families (parent_id) select id from fq_seed where tag = 'd';
insert into public.family_members (child_id, parent_id) select (select id from fq_seed where tag = 'kid'), (select id from fq_seed where tag = 'd');
insert into public.learning_attempts (id, user_id, problem_latex, skill, origin, outcome, started_at)
select gen_random_uuid(), id, '6\times7', 'times_tables', 'practice', 'with_help', timestamptz '2026-09-09 20:00:00+00' from fq_seed where tag = 'kid';

-- e: Today's practice on day 14 (week 2); f: on day 15 (another day, not week 2)
insert into public.daily_practice (user_id, day, goal, done, stars) select id, date '2026-09-15', 5, 5, 4 from fq_seed where tag = 'e';
insert into public.daily_practice (user_id, day, goal, done, stars) select id, date '2026-09-16', 5, 2, 1 from fq_seed where tag = 'f';

-- g: a trial set to cancel; h: paying; i: a checkout never finished; j: one plan ended, a new one paying
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status, trial_end, cancel_at_period_end)
select 'sub_fq_g', id, 'trialing', timestamptz '2026-09-08 15:00:00+00', true from fq_seed where tag = 'g';
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status)
select 'sub_fq_h', id, 'active' from fq_seed where tag = 'h';
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status)
select 'sub_fq_i', id, 'incomplete' from fq_seed where tag = 'i';
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status, ended_at)
select 'sub_fq_j1', id, 'canceled', timestamptz '2026-09-05 00:00:00+00' from fq_seed where tag = 'j';
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status)
select 'sub_fq_j2', id, 'active' from fq_seed where tag = 'j';

-- l: told us (TikTok), which wins over its utm; m: only a referrer
update public.profiles set heard_from = 'tiktok' where user_id = (select id from fq_seed where tag = 'l');
update public.profiles set attribution = '{"firstSeenAt":"2026-09-01T14:00:00Z","referrer":"https://www.Example-FQ.com"}'::jsonb
 where user_id = (select id from fq_seed where tag = 'm');

-- n: recorded steps (skipped the welcome, saw the plan, opened checkout); the kid of d recorded a
-- checked line, which counts for d; o: only a checkout the Stripe back-fill found, which neither
-- starts tracking nor does the admin's own step
insert into public.funnel_steps (user_id, step, first_at, last_at, times, meta)
select s.id, x.step, timestamptz '2026-09-01 16:00:00+00', timestamptz '2026-09-01 16:05:00+00', 1, null
  from fq_seed s, (values ('welcome_shown'), ('welcome_skipped'), ('plan_shown'), ('checkout_opened')) as x (step)
 where s.tag = 'n';
insert into public.funnel_steps (user_id, step, first_at, meta)
select id, 'tour_checked', timestamptz '2026-09-02 16:00:00+00', '{"mark":"check"}'::jsonb from fq_seed where tag = 'kid';
insert into public.funnel_steps (user_id, step, first_at, last_at, times, meta)
select id, 'checkout_opened', timestamptz '2026-08-01 00:00:00+00', timestamptz '2026-08-01 00:10:00+00', 2, '{"source":"stripe"}'::jsonb from fq_seed where tag = 'o';
insert into public.funnel_steps (user_id, step, first_at)
select id, 'plan_shown', timestamptz '2026-07-01 00:00:00+00' from fq_seed where tag = 'admin';

-- an admin is left out
insert into public.admins (user_id) select id from fq_seed where tag = 'admin';

create temp table fq_after on commit drop as
  select public.admin_funnel('America/New_York') as r, public.admin_funnel('UTC') as r_utc;

create or replace function pg_temp.fq_entry(p jsonb, p_source text) returns jsonb language sql as $$
  select e from jsonb_array_elements(p -> 'accounts') e where e ->> 'source' = p_source
$$;

-- an entry's stages, whether it was canceled, and whether its trial is over
create or replace function pg_temp.fq_plan(p jsonb, p_source text) returns jsonb language sql as $$
  select jsonb_build_object('stages', e -> 'stages', 'canceled', e -> 'canceled', 'trial_ended', e -> 'trial_ended')
    from jsonb_array_elements(p -> 'accounts') e where e ->> 'source' = p_source
$$;

create or replace function pg_temp.fq_expect(p_what text, p_got jsonb, p_want jsonb) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'admin_funnel test failed: %: got %, want %', p_what, p_got, p_want;
  end if;
end;
$$;

do $$
declare
  r jsonb := (select fa.r from fq_after fa);
  u jsonb := (select fa.r_utc from fq_after fa);
  b jsonb := (select fb.r from fq_before fb);
  e jsonb;
begin
  perform pg_temp.fq_expect('a: onboarded; a same-day problem is no stage any more', pg_temp.fq_entry(r, 'utm:fq_a') -> 'stages', '["signed_up","onboarded"]');
  perform pg_temp.fq_expect('a: week (Monday), sign-up to the minute, no steps, no trial',
    pg_temp.fq_entry(r, 'utm:fq_a') - 'stages' - 'source',
    '{"week":"2026-08-31","signed_up_at":"2026-09-01T15:00Z","steps":[],"trial_ended":false,"canceled":false}');
  perform pg_temp.fq_expect('b: came back the next local day', pg_temp.fq_entry(r, 'utm:fq_b') -> 'stages', '["signed_up","came_back_day2"]');
  perform pg_temp.fq_expect('c: same local day in New York', pg_temp.fq_entry(r, 'utm:fq_c') -> 'stages', '["signed_up"]');
  perform pg_temp.fq_expect('c: the next day in UTC', pg_temp.fq_entry(u, 'utm:fq_c') -> 'stages', '["signed_up","came_back_day2"]');
  perform pg_temp.fq_expect('d: the kid''s problem counts for the family', pg_temp.fq_entry(r, 'utm:fq_d') -> 'stages', '["signed_up","came_back_day2","came_back_week2"]');
  perform pg_temp.fq_expect('d: and so does the kid''s recorded step', pg_temp.fq_entry(r, 'utm:fq_d') -> 'steps', '["tour_checked"]');
  perform pg_temp.fq_expect('kid: not an account of its own', pg_temp.fq_entry(r, 'utm:fq_kid'), null);
  perform pg_temp.fq_expect('kid: counted apart', to_jsonb((r ->> 'kid_profiles')::int - (b ->> 'kid_profiles')::int), '1');
  perform pg_temp.fq_expect('e: practice on day 14 is week 2', pg_temp.fq_entry(r, 'utm:fq_e') -> 'stages', '["signed_up","came_back_day2","came_back_week2"]');
  perform pg_temp.fq_expect('f: practice on day 15 is not', pg_temp.fq_entry(r, 'utm:fq_f') -> 'stages', '["signed_up","came_back_day2"]');
  perform pg_temp.fq_expect('g: trial set to cancel, past its trial end', pg_temp.fq_plan(r, 'utm:fq_g'), '{"stages":["signed_up","trial_started"],"canceled":true,"trial_ended":true}');
  perform pg_temp.fq_expect('h: paying, so the trial is over', pg_temp.fq_plan(r, 'utm:fq_h'), '{"stages":["signed_up","trial_started","paid"],"canceled":false,"trial_ended":true}');
  perform pg_temp.fq_expect('i: checkout never finished', pg_temp.fq_plan(r, 'utm:fq_i'), '{"stages":["signed_up"],"canceled":false,"trial_ended":false}');
  perform pg_temp.fq_expect('j: ended once, paying now', pg_temp.fq_plan(r, 'utm:fq_j'), '{"stages":["signed_up","trial_started","paid"],"canceled":false,"trial_ended":true}');
  perform pg_temp.fq_expect('n: the plan screen and checkout from its steps', pg_temp.fq_entry(r, 'utm:fq_n') -> 'stages', '["signed_up","plan_shown","checkout_opened"]');
  perform pg_temp.fq_expect('n: its steps, in name order', pg_temp.fq_entry(r, 'utm:fq_n') -> 'steps', '["checkout_opened","plan_shown","welcome_shown","welcome_skipped"]');
  perform pg_temp.fq_expect('o: a back-filled checkout counts', pg_temp.fq_entry(r, 'utm:fq_o') -> 'stages', '["signed_up","checkout_opened"]');
  perform pg_temp.fq_expect('tracking began with n''s first step (not the back-fill''s, not the admin''s)',
    to_jsonb((r ->> 'tracking_since')::timestamptz = least(coalesce((b ->> 'tracking_since')::timestamptz, 'infinity'), timestamptz '2026-09-01 16:00:00+00')),
    'true');
  perform pg_temp.fq_expect('l: heard_from wins over utm', pg_temp.fq_entry(r, 'utm:fq_l'), null);
  perform pg_temp.fq_expect('l: counted under tiktok',
    to_jsonb((select count(*) from jsonb_array_elements(r -> 'accounts') x where x ->> 'source' = 'tiktok')
           - (select count(*) from jsonb_array_elements(b -> 'accounts') x where x ->> 'source' = 'tiktok')), '1');
  perform pg_temp.fq_expect('m: the referrer origin, lower case', pg_temp.fq_entry(r, 'https://www.example-fq.com') -> 'stages', '["signed_up"]');
  perform pg_temp.fq_expect('admin: left out', pg_temp.fq_entry(r, 'utm:fq_admin'), null);
  perform pg_temp.fq_expect('accounts: 14 more (16 seeded, less the kid and the admin)',
    to_jsonb(jsonb_array_length(r -> 'accounts') - jsonb_array_length(b -> 'accounts')), '14');
  perform pg_temp.fq_expect('active subscriptions: h and j', to_jsonb((r ->> 'active_subscriptions')::int - (b ->> 'active_subscriptions')::int), '2');
  perform pg_temp.fq_expect('time zone named', r -> 'time_zone', '"America/New_York"');
  perform pg_temp.fq_expect('empty zone is New York', public.admin_funnel('') -> 'time_zone', '"America/New_York"');

  begin
    perform public.admin_funnel('Mars/Olympus');
    raise exception 'admin_funnel test failed: an unknown zone was accepted';
  exception when invalid_parameter_value then
    null;
  end;
end;
$$;

-- Nobody but the service role may call it (or its helper).
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    begin
      execute format('set local role %I', role_name);
      perform public.admin_funnel('UTC');
      raise exception 'admin_funnel test failed: % could call admin_funnel', role_name;
    exception when insufficient_privilege then
      null;
    end;
    reset role;
    begin
      execute format('set local role %I', role_name);
      perform public.admin_funnel_active(array[gen_random_uuid()], current_date, null, 'UTC');
      raise exception 'admin_funnel test failed: % could call admin_funnel_active', role_name;
    exception when insufficient_privilege then
      null;
    end;
    reset role;
  end loop;
  set local role service_role;
  perform public.admin_funnel('UTC');
  reset role;
end;
$$;

\echo admin_funnel: all expectations met
rollback;
