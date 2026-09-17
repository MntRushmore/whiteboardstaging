-- =============================================================================
-- Accounts & billing (2026-09-17). Idempotent; additive to the earlier migrations.
--
-- Credits are the unit. Every user has a plan (public.plans) with a monthly
-- allowance; the balance for the current calendar month (UTC) is
--
--   remaining = plan.monthly_credits
--             + sum(credit_grants.units  this month)
--             - sum(usage_events.units   this month)
--
-- Metering runs AS THE USER through the SECURITY DEFINER RPC consume_credits()
-- called with the user's own JWT: a user can only spend their own credits and
-- nothing exposed to `authenticated` can add credits or change a plan. Plan
-- changes and grants happen only via the service role (billing webhook) or SQL.
--
-- Objects created here:
--   tables     plans, profiles, usage_events, credit_grants, billing_events
--   functions  handle_new_user() [trigger], credit_period(), credit_balance(uuid),
--              credit_summary(), consume_credits(text,int,text,text), delete_own_account()
--   triggers   on_auth_user_created (auth.users AFTER INSERT), profiles_set_updated_at
--
-- Supabase's default privileges grant ALL on every new public table/function to
-- anon, authenticated and service_role, so each object below revokes first and
-- then grants exactly what the client uses. docs/RUNBOOK-supabase.md "Accounts &
-- billing" explains the operator side.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. plans (catalogue; readable by every signed-in user, never writable via API)
-- -----------------------------------------------------------------------------
create table if not exists public.plans (
  id              text        primary key,
  name            text        not null,
  monthly_credits integer     not null check (monthly_credits >= 0),
  price_cents     integer     not null default 0 check (price_cents >= 0),
  features        jsonb       not null default '[]'::jsonb,
  sort            integer     not null default 0,
  active          boolean     not null default true,
  constraint plans_id_format check (id ~ '^[a-z][a-z0-9_-]{0,31}$'),
  constraint plans_features_is_array check (jsonb_typeof(features) = 'array')
);

-- PLACEHOLDER numbers: the allowances and prices below are starting points, not
-- a pricing decision. Change them with a plain UPDATE (runbook) - no deploy needed.
insert into public.plans (id, name, monthly_credits, price_cents, features, sort, active) values
  ('free', 'Free', 300,   0,    '["300 credits / month", "All AI tutor modes"]'::jsonb, 0, true),
  ('plus', 'Plus', 3000,  900,  '["3,000 credits / month", "All AI tutor modes", "Worksheets"]'::jsonb, 1, true),
  ('pro',  'Pro',  12000, 2900, '["12,000 credits / month", "All AI tutor modes", "Worksheets", "Priority models"]'::jsonb, 2, true)
on conflict (id) do update
  set name            = excluded.name,
      monthly_credits = excluded.monthly_credits,
      price_cents     = excluded.price_cents,
      features        = excluded.features,
      sort            = excluded.sort,
      active          = excluded.active;

alter table public.plans enable row level security;

drop policy if exists "plans: authenticated select" on public.plans;
create policy "plans: authenticated select"
  on public.plans for select
  to authenticated
  using (true);

revoke all on public.plans from public, anon, authenticated;
grant select on public.plans to authenticated;
grant all on public.plans to service_role;

-- -----------------------------------------------------------------------------
-- 2. profiles (one row per auth.users row; the only per-user billing state)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id                 uuid        primary key references auth.users (id) on delete cascade,
  display_name            text,
  plan_id                 text        not null default 'free' references public.plans (id),
  billing_customer_id     text,
  billing_subscription_id text,
  billing_status          text,
  current_period_end      timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint profiles_display_name_len check (display_name is null or char_length(display_name) between 1 and 80)
);

create index if not exists profiles_billing_customer_idx
  on public.profiles (billing_customer_id) where billing_customer_id is not null;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create the profile when a user signs up. SECURITY DEFINER because the
-- insert on auth.users runs as supabase_auth_admin, which has no rights on
-- public.profiles. Never lets a profile problem block sign-up: consume_credits()
-- creates a missing profile on demand and credit_summary() falls back to 'free'.
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
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for users that existed before this migration.
insert into public.profiles (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

alter table public.profiles enable row level security;

drop policy if exists "profiles: owner select" on public.profiles;
create policy "profiles: owner select"
  on public.profiles for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "profiles: owner update" on public.profiles;
create policy "profiles: owner update"
  on public.profiles for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Column-level privilege: a user may change display_name and nothing else.
-- PATCH {plan_id: ...} fails with 42501 before RLS is even consulted.
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- -----------------------------------------------------------------------------
-- 3. usage_events (append-only ledger of spent credits; written only by consume_credits)
-- -----------------------------------------------------------------------------
create table if not exists public.usage_events (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  route       text        not null check (char_length(route) between 1 and 100),
  units       integer     not null check (units > 0),
  model       text        check (model is null or char_length(model) <= 200),
  request_id  text        check (request_id is null or char_length(request_id) <= 100),
  created_at  timestamptz not null default now()
);

create index if not exists usage_events_user_created_idx
  on public.usage_events (user_id, created_at desc);

alter table public.usage_events enable row level security;

drop policy if exists "usage_events: owner select" on public.usage_events;
create policy "usage_events: owner select"
  on public.usage_events for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.usage_events from public, anon, authenticated;
grant select on public.usage_events to authenticated;
grant all on public.usage_events to service_role;

-- -----------------------------------------------------------------------------
-- 4. credit_grants (extra credits for the month they are dated; service role / SQL only)
-- -----------------------------------------------------------------------------
create table if not exists public.credit_grants (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  units       integer     not null check (units <> 0),   -- negative = manual correction
  reason      text        check (reason is null or char_length(reason) <= 200),
  created_at  timestamptz not null default now()
);

create index if not exists credit_grants_user_created_idx
  on public.credit_grants (user_id, created_at desc);

alter table public.credit_grants enable row level security;

drop policy if exists "credit_grants: owner select" on public.credit_grants;
create policy "credit_grants: owner select"
  on public.credit_grants for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.credit_grants from public, anon, authenticated;
grant select on public.credit_grants to authenticated;
grant all on public.credit_grants to service_role;

-- -----------------------------------------------------------------------------
-- 5. billing_events (webhook idempotency log; service role only, RLS on with no policies)
-- -----------------------------------------------------------------------------
create table if not exists public.billing_events (
  id          text        primary key,           -- provider event id (e.g. evt_...)
  type        text,
  received_at timestamptz not null default now(),
  payload     jsonb
);

alter table public.billing_events enable row level security;

revoke all on public.billing_events from public, anon, authenticated;
grant all on public.billing_events to service_role;

-- -----------------------------------------------------------------------------
-- 6. Functions
-- -----------------------------------------------------------------------------

-- Current calendar month in UTC as [period_start, period_end).
create or replace function public.credit_period(out period_start timestamptz, out period_end timestamptz)
language sql
stable
set search_path = public
as $$
  select
    (date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
    ((date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc');
$$;
revoke all on function public.credit_period() from public, anon, authenticated;

-- Internal: balance for one user. Called only from the definer functions below,
-- which have already established who p_uid is. Falls back to plan 'free' when
-- the profile row is missing (sign-up trigger failed) so reads never error.
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
  v_monthly integer;
  v_used integer;
  v_granted integer;
begin
  select period_start, period_end into v_start, v_end from public.credit_period();

  select p.id, p.name, p.monthly_credits
    into v_plan_id, v_plan_name, v_monthly
  from public.profiles pr
  join public.plans p on p.id = pr.plan_id
  where pr.user_id = p_uid;

  if v_plan_id is null then
    select p.id, p.name, p.monthly_credits into v_plan_id, v_plan_name, v_monthly
    from public.plans p where p.id = 'free';
  end if;

  select coalesce(sum(u.units), 0)::integer into v_used
  from public.usage_events u
  where u.user_id = p_uid and u.created_at >= v_start and u.created_at < v_end;

  select coalesce(sum(g.units), 0)::integer into v_granted
  from public.credit_grants g
  where g.user_id = p_uid and g.created_at >= v_start and g.created_at < v_end;

  return jsonb_build_object(
    'plan_id',         v_plan_id,
    'plan_name',       v_plan_name,
    'monthly_credits', coalesce(v_monthly, 0),
    'used',            v_used,
    'granted',         v_granted,
    'remaining',       greatest(0, coalesce(v_monthly, 0) + v_granted - v_used),
    'period_start',    v_start,
    'period_end',      v_end
  );
end;
$$;
revoke all on function public.credit_balance(uuid) from public, anon, authenticated;

-- RPC: GET/POST /rest/v1/rpc/credit_summary  (as the user)
create or replace function public.credit_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return public.credit_balance(v_uid);
end;
$$;
revoke all on function public.credit_summary() from public, anon;
grant execute on function public.credit_summary() to authenticated;

-- RPC: POST /rest/v1/rpc/consume_credits {p_route, p_units, p_request_id?, p_model?}  (as the user)
-- Atomic per user: the profile row is locked FOR UPDATE for the duration of the
-- transaction, so parallel calls serialize and can never overspend. Returns
-- {ok:false, reason:'insufficient_credits'} WITHOUT writing when the balance is short.
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
  v_locked uuid;
  v_remaining integer;
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

  -- Self-heal a missing profile (sign-up trigger failed) - only for a user that still exists.
  insert into public.profiles (user_id)
  select u.id from auth.users u where u.id = v_uid
  on conflict (user_id) do nothing;

  select pr.user_id into v_locked
  from public.profiles pr
  where pr.user_id = v_uid
  for update;

  if v_locked is null then
    raise exception 'account not found' using errcode = '42501';
  end if;

  v_remaining := (public.credit_balance(v_uid) ->> 'remaining')::integer;

  if v_remaining < p_units then
    return jsonb_build_object('ok', false, 'remaining', v_remaining, 'reason', 'insufficient_credits');
  end if;

  insert into public.usage_events (user_id, route, units, model, request_id)
  values (v_uid, p_route, p_units, left(p_model, 200), left(p_request_id, 100));

  return jsonb_build_object('ok', true, 'remaining', v_remaining - p_units, 'reason', null);
end;
$$;
revoke all on function public.consume_credits(text, integer, text, text) from public, anon;
grant execute on function public.consume_credits(text, integer, text, text) to authenticated;

-- RPC: POST /rest/v1/rpc/delete_own_account  (as the user)
-- Deletes the caller's auth.users row; every public table references it ON
-- DELETE CASCADE (profiles, whiteboards -> snapshots/board_assets, user_settings,
-- trainers, training_samples, usage_events, credit_grants); bug_reports keeps
-- its rows with user_id set to null.
--
-- Storage is deliberately NOT touched here. storage.objects has no FK to
-- auth.users, and storage-api (>= 1.7x) installs a BEFORE DELETE trigger
-- (storage.protect_delete) that rejects direct row deletes with 42501 because
-- removing a row does not remove the file behind it - the bytes would be
-- orphaned in the backing store. Objects therefore have to be deleted through
-- the Storage API: the client should remove its own board-assets objects
-- (owner delete policy) before calling this RPC, and the runbook's GC query
-- lists any object whose first path segment no longer matches an auth.users id
-- for the operator to remove with the service role.
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
  delete from auth.users where id = v_uid;
end;
$$;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- PostgREST caches the schema; new tables and RPCs need a reload.
notify pgrst, 'reload schema';
