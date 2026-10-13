-- admin_funnel() v3 (supabase/migrations/20261013020000_start_steps.sql, after
-- 20261012020000_funnel_steps.sql and 20261009020000_funnel.sql) against a real Postgres: seeded
-- accounts, every stage, the recorded steps and when tracking began, ended trials, the time zone,
-- kids and admins left out, and who may call it; and the steps before the account: journeys
-- recorded and linked through record_start_step() and link_start_journey(), grouped by minute and
-- events with no ids, the 60-day window, and a journey linked to an admin left out. Runs in one
-- transaction that is rolled back, so nothing it seeds is left behind.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 \
--     -f src/lib/funnel/__tests__/admin_funnel.test.sql
--
-- (or RUN_DB_TESTS=1 npx vitest run src/lib/funnel/__tests__/adminFunnel.integration.test.ts)
-- A failed expectation raises, which aborts the run with a non-zero exit.

\set QUIET on
begin;

create or replace function pg_temp.fq_expect(p_what text, p_got jsonb, p_want jsonb) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'admin_funnel test failed: %: got %, want %', p_what, p_got, p_want;
  end if;
end;
$$;

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

-- The steps before the account (v3). Journeys, recorded as the route records them (the service
-- role's record_start_step) and linked as the new account (link_start_journey):
--   s1, s2  started, chose who, picked a grade, nothing more (same minute, same events: one group of 2)
--   s3      on to the plan and the account screen, then a's account (start_account), then one step more
--   s4      linked to the admin: left out
--   s5      began 61 days ago: outside the window
-- Every journey but s5 began ten days ago, in the minute fq_minute names.
create temp table fq_journey (tag text primary key, id uuid not null default gen_random_uuid()) on commit drop;
insert into fq_journey (tag) values ('s1'), ('s2'), ('s3'), ('s4'), ('s5'), ('none');

-- link_start_journey as a user: the session's claims, the authenticated role
create or replace function pg_temp.fq_link(p_user uuid, p_journey uuid) returns boolean language plpgsql as $$
declare
  v boolean;
begin
  perform set_config('request.jwt.claims', coalesce(jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, ''), true);
  execute 'set local role authenticated';
  v := public.link_start_journey(p_journey);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;

create or replace function pg_temp.fq_j(p_tag text) returns uuid language sql as $$ select id from fq_journey where tag = p_tag $$;
create or replace function pg_temp.fq_u(p_tag text) returns uuid language sql as $$ select id from fq_seed where tag = p_tag $$;

do $$
declare
  ok boolean;
  n integer;
begin
  perform public.record_start_step(pg_temp.fq_j('s1'), 'start_shown');
  perform public.record_start_step(pg_temp.fq_j('s1'), 'start_who', '{"role":"parent"}');
  perform public.record_start_step(pg_temp.fq_j('s1'), 'start_grade', '{"grade":3}');
  perform public.record_start_step(pg_temp.fq_j('s1'), 'start_shown', '{"again":true}');
  perform public.record_start_step(pg_temp.fq_j('s2'), 'start_shown', '{}');
  perform public.record_start_step(pg_temp.fq_j('s2'), 'start_who', 'null');
  perform public.record_start_step(pg_temp.fq_j('s2'), 'start_grade', '{"course":"algebra1"}');
  perform public.record_start_step(pg_temp.fq_j('s3'), 'start_shown');
  perform public.record_start_step(pg_temp.fq_j('s3'), 'start_plan');
  perform public.record_start_step(pg_temp.fq_j('s3'), 'start_account_shown');
  perform public.record_start_step(pg_temp.fq_j('s4'), 'start_shown');
  perform public.record_start_step(pg_temp.fq_j('s5'), 'start_shown');

  perform pg_temp.fq_expect('a repeated step is counted, its first details kept',
    (select jsonb_build_object('times', times, 'meta', meta) from public.start_steps where journey_id = pg_temp.fq_j('s1') and event = 'start_shown'),
    '{"times":2,"meta":null}');
  perform pg_temp.fq_expect('details kept as given; {} and a JSON null as none',
    (select jsonb_agg(meta order by journey_id = pg_temp.fq_j('s2'), event) from public.start_steps where journey_id in (pg_temp.fq_j('s1'), pg_temp.fq_j('s2')) and event <> 'start_shown'),
    '[{"grade":3},{"role":"parent"},{"course":"algebra1"},null]');

  -- what record_start_step refuses: start_account (linking records it), an unknown event, details that are not small and flat
  begin
    perform public.record_start_step(pg_temp.fq_j('s1'), 'start_account');
    raise exception 'admin_funnel test failed: record_start_step recorded start_account';
  exception when check_violation then null;
  end;
  begin
    perform public.record_start_step(pg_temp.fq_j('s1'), 'start_teleported');
    raise exception 'admin_funnel test failed: an unknown event was recorded';
  exception when check_violation then null;
  end;
  begin
    perform public.record_start_step(pg_temp.fq_j('s1'), 'start_focus', '{"skills":["fractions"]}');
    raise exception 'admin_funnel test failed: a nested meta was recorded';
  exception when check_violation then null;
  end;
  begin
    perform public.record_start_step(pg_temp.fq_j('s1'), 'start_focus', jsonb_build_object('note', repeat('x', 500)));
    raise exception 'admin_funnel test failed: a meta over 500 bytes was recorded';
  exception when check_violation then null;
  end;
  begin
    perform public.record_start_step(null, 'start_shown');
    raise exception 'admin_funnel test failed: a step with no journey was recorded';
  exception when invalid_parameter_value then null;
  end;

  -- linking: a's account takes s3 and records start_account; b cannot take it after; nothing to take in a journey with no rows
  ok := pg_temp.fq_link(pg_temp.fq_u('a'), pg_temp.fq_j('s3'));
  perform pg_temp.fq_expect('a links s3', to_jsonb(ok), 'true');
  perform pg_temp.fq_expect('s3 is a''s, start_account recorded',
    (select jsonb_agg(jsonb_build_array(event, user_id = pg_temp.fq_u('a')) order by event) from public.start_steps where journey_id = pg_temp.fq_j('s3')),
    '[["start_account",true],["start_account_shown",true],["start_plan",true],["start_shown",true]]');
  ok := pg_temp.fq_link(pg_temp.fq_u('b'), pg_temp.fq_j('s3'));
  perform pg_temp.fq_expect('b cannot take a''s journey', to_jsonb(ok), 'false');
  perform pg_temp.fq_expect('s3 is still a''s alone',
    (select count(*) from public.start_steps where journey_id = pg_temp.fq_j('s3') and user_id is distinct from pg_temp.fq_u('a'))::int::text::jsonb, '0');
  ok := pg_temp.fq_link(pg_temp.fq_u('b'), pg_temp.fq_j('none'));
  perform pg_temp.fq_expect('no journey to link: false, and none made', jsonb_build_array(ok, (select count(*) from public.start_steps where journey_id = pg_temp.fq_j('none'))), '[false,0]');
  -- a step after the link joins the account
  perform public.record_start_step(pg_temp.fq_j('s3'), 'start_handoff');
  perform pg_temp.fq_expect('a later step of a linked journey joins its account',
    (select to_jsonb(user_id = pg_temp.fq_u('a')) from public.start_steps where journey_id = pg_temp.fq_j('s3') and event = 'start_handoff'), 'true');
  -- linking again counts start_account again, and takes nothing else
  ok := pg_temp.fq_link(pg_temp.fq_u('a'), pg_temp.fq_j('s3'));
  perform pg_temp.fq_expect('a links s3 again', jsonb_build_array(ok, (select times from public.start_steps where journey_id = pg_temp.fq_j('s3') and event = 'start_account')), '[true,2]');
  ok := pg_temp.fq_link(pg_temp.fq_u('admin'), pg_temp.fq_j('s4'));
  perform pg_temp.fq_expect('the admin links s4', to_jsonb(ok), 'true');

  begin
    ok := pg_temp.fq_link(null, pg_temp.fq_j('s1'));
    raise exception 'admin_funnel test failed: link_start_journey worked signed out';
  exception when insufficient_privilege then
    reset role;
  end;
  perform pg_temp.fq_expect('s1 is nobody''s', (select count(*) from public.start_steps where journey_id = pg_temp.fq_j('s1') and user_id is not null)::int::text::jsonb, '0');

  -- when they began
  update public.start_steps set first_at = now() - interval '10 days' where journey_id in (pg_temp.fq_j('s1'), pg_temp.fq_j('s2'), pg_temp.fq_j('s3'), pg_temp.fq_j('s4'));
  update public.start_steps set first_at = now() - interval '61 days' where journey_id = pg_temp.fq_j('s5');
  get diagnostics n = row_count;
  perform pg_temp.fq_expect('s5 has one row', to_jsonb(n), '1');
end;
$$;

create temp table fq_minute on commit drop as
  select to_char(date_trunc('minute', (now() - interval '10 days') at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI"Z"') as m,
         to_char(date_trunc('minute', (now() - interval '61 days') at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI"Z"') as old;

create temp table fq_after on commit drop as
  select public.admin_funnel('America/New_York') as r, public.admin_funnel('UTC') as r_utc;

-- how many journeys a report lists that began in minute p_at and recorded exactly p_events
create or replace function pg_temp.fq_journeys(p jsonb, p_at text, p_events jsonb) returns integer language sql as $$
  select coalesce(sum((g ->> 'n')::int), 0)::int from jsonb_array_elements(p -> 'start' -> 'journeys') g
   where g ->> 'first_at' = p_at and g -> 'events' = p_events
$$;

create or replace function pg_temp.fq_entry(p jsonb, p_source text) returns jsonb language sql as $$
  select e from jsonb_array_elements(p -> 'accounts') e where e ->> 'source' = p_source
$$;

-- an entry's stages, whether it was canceled, and whether its trial is over
create or replace function pg_temp.fq_plan(p jsonb, p_source text) returns jsonb language sql as $$
  select jsonb_build_object('stages', e -> 'stages', 'canceled', e -> 'canceled', 'trial_ended', e -> 'trial_ended')
    from jsonb_array_elements(p -> 'accounts') e where e ->> 'source' = p_source
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

  -- v3: the steps before the account
  perform pg_temp.fq_expect('start: the window began 60 days ago',
    r -> 'start' -> 'since', to_jsonb(to_char(date_trunc('minute', (now() - interval '60 days') at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI"Z"')));
  perform pg_temp.fq_expect('start: s1 and s2, one group of two',
    to_jsonb(pg_temp.fq_journeys(r, (select m from fq_minute), '["start_grade","start_shown","start_who"]') - pg_temp.fq_journeys(b, (select m from fq_minute), '["start_grade","start_shown","start_who"]')), '2');
  perform pg_temp.fq_expect('start: s3, with start_account and the later step, in name order',
    to_jsonb(pg_temp.fq_journeys(r, (select m from fq_minute), '["start_account","start_account_shown","start_handoff","start_plan","start_shown"]')
           - pg_temp.fq_journeys(b, (select m from fq_minute), '["start_account","start_account_shown","start_handoff","start_plan","start_shown"]')), '1');
  perform pg_temp.fq_expect('start: s4, linked to an admin, left out',
    to_jsonb(pg_temp.fq_journeys(r, (select m from fq_minute), '["start_account","start_shown"]') - pg_temp.fq_journeys(b, (select m from fq_minute), '["start_account","start_shown"]')), '0');
  perform pg_temp.fq_expect('start: s5, 61 days old, left out',
    to_jsonb(pg_temp.fq_journeys(r, (select old from fq_minute), '["start_shown"]')), '0');
  perform pg_temp.fq_expect('start: three more journeys in all',
    to_jsonb((select sum((g ->> 'n')::int) from jsonb_array_elements(r -> 'start' -> 'journeys') g)
           - coalesce((select sum((g ->> 'n')::int) from jsonb_array_elements(b -> 'start' -> 'journeys') g), 0)), '3');
  perform pg_temp.fq_expect('start: a group is first_at, events and n, nothing else (no ids)',
    (select coalesce(jsonb_agg(distinct (select jsonb_agg(k order by k) from jsonb_object_keys(g) k)), '[]') from jsonb_array_elements(r -> 'start' -> 'journeys') g),
    '[["events","first_at","n"]]');
  perform pg_temp.fq_expect('start: the answer has no journey id and no user id anywhere',
    to_jsonb((r -> 'start')::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'), 'false');
  perform pg_temp.fq_expect('empty zone is New York', public.admin_funnel('') -> 'time_zone', '"America/New_York"');

  begin
    perform public.admin_funnel('Mars/Olympus');
    raise exception 'admin_funnel test failed: an unknown zone was accepted';
  exception when invalid_parameter_value then
    null;
  end;
end;
$$;

-- Nobody but the service role may call it (or its helper), or record a step; anon cannot link.
do $$
declare
  role_name text;
begin
  begin
    execute 'set local role anon';
    perform public.link_start_journey(gen_random_uuid());
    raise exception 'admin_funnel test failed: anon could call link_start_journey';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  foreach role_name in array array['anon', 'authenticated'] loop
    begin
      execute format('set local role %I', role_name);
      perform public.record_start_step(gen_random_uuid(), 'start_shown');
      raise exception 'admin_funnel test failed: % could call record_start_step', role_name;
    exception when insufficient_privilege then
      null;
    end;
    reset role;
    begin
      execute format('set local role %I', role_name);
      perform 1 from public.start_steps limit 1;
      raise exception 'admin_funnel test failed: % could read start_steps', role_name;
    exception when insufficient_privilege then
      null;
    end;
    reset role;
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
  perform public.record_start_step(gen_random_uuid(), 'start_shown');
  reset role;
end;
$$;

\echo admin_funnel: all expectations met
rollback;
