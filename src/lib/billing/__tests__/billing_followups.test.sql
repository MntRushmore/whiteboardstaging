-- The billing follow-ups (supabase/migrations/20261009130000_billing_followups.sql) against a real
-- Postgres: admin_funnel()'s `active_subscriptions`, the basis of the Funnel's MRR, counts only
-- active plans linked to an account that is not an admin's (not admins' own plans, not rows linked
-- to nobody), and who may call it is unchanged. Runs in one transaction that is rolled back, so
-- nothing is left behind.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 \
--     -f src/lib/billing/__tests__/billing_followups.test.sql
--
-- (or RUN_DB_TESTS=1 npx vitest run src/lib/billing/__tests__/billingFollowups.integration.test.ts)
-- A failed expectation raises, which aborts the run with a non-zero exit.

\set QUIET on
begin;

create temp table bf_seed (tag text primary key, id uuid not null default gen_random_uuid()) on commit drop;
insert into bf_seed (tag) values ('payer'), ('trialing'), ('admin');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select s.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'followups-test-' || s.tag || '-' || s.id || '@example.com',
       jsonb_build_object('terms_version', '2026-10-08'), now(), now()
  from bf_seed s;
insert into public.admins (user_id) select id from bf_seed where tag = 'admin';

create temp table bf_before on commit drop as select public.admin_funnel('UTC') as r;

create or replace function pg_temp.bf_expect(p_what text, p_got jsonb, p_want jsonb) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'billing follow-ups test failed: %: got %, want %', p_what, p_got, p_want;
  end if;
end;
$$;

-- a family paying (revenue), one in its free trial (not yet), the owner's own plan (an admin's),
-- and two paid plans linked to nobody (an account deleted, a link opened outside the app)
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status)
select 'sub_bf_payer', id, 'active' from bf_seed where tag = 'payer';
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status)
select 'sub_bf_trial', id, 'trialing' from bf_seed where tag = 'trialing';
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status)
select 'sub_bf_admin', id, 'active' from bf_seed where tag = 'admin';
insert into public.unlimited_subscriptions (stripe_subscription_id, user_id, status)
values ('sub_bf_nobody_1', null, 'active'), ('sub_bf_nobody_2', null, 'active');

do $$
declare
  r jsonb := public.admin_funnel('UTC');
  b jsonb := (select x.r from bf_before x);
begin
  perform pg_temp.bf_expect('active: the paying family only',
    to_jsonb((r ->> 'active_subscriptions')::int - (b ->> 'active_subscriptions')::int), '1');
  -- the same plan counts once its account is no longer an admin's (it was the admin rule that left it out)
  delete from public.admins where user_id = (select id from bf_seed where tag = 'admin');
  perform pg_temp.bf_expect('active: an account that is no longer an admin counts',
    to_jsonb((public.admin_funnel('UTC') ->> 'active_subscriptions')::int - (b ->> 'active_subscriptions')::int), '2');
  -- and the answer's shape is unchanged
  perform pg_temp.bf_expect('the answer keeps its keys',
    (select to_jsonb(array_agg(k order by k)) from jsonb_object_keys(r) k), '["accounts","active_subscriptions","generated_at","kid_profiles","time_zone"]');
end;
$$;

-- Nobody but the service role may call it.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    begin
      execute format('set local role %I', role_name);
      perform public.admin_funnel('UTC');
      raise exception 'billing follow-ups test failed: % could call admin_funnel', role_name;
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

\echo billing_followups: all expectations met
rollback;
