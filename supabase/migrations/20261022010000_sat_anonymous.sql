-- =============================================================================
-- SAT mode without an account (owner, 2026-10-22; docs/SAT-MODE.md). Idempotent; additive to
-- 20261022000000_sat_mode.sql and 20261009040000_family_hardening.sql. LOCAL ONLY until the owner
-- OKs production, and then only together with turning anonymous sign-ins on (the deploy checklist).
--
-- A student can practise SAT math before any sign-up: POST /api/sat/anon (App Attest guarded) makes
-- a Supabase ANONYMOUS user (auth.users.is_anonymous, the JWT's `is_anonymous` claim). Such a user
-- is for SAT mode and nothing else:
--
--   1. No account things. handle_new_user() makes NO profile and grants NO starter ink for an
--      anonymous user, and ensure_ink_account() (the self-heal behind consume_credits and
--      ink_summary) does nothing for one. With no profile row an anonymous user is not an account to
--      anything that counts accounts (the admin overview, the funnel, the users list, the weekly
--      report, emails all read `profiles`), cannot be charged or spend ink (consume_credits answers
--      `account not found`), and gets no trial (the billing routes refuse anonymous callers,
--      src/lib/server/auth.ts).
--   2. Consent. require_signup_terms() lets an anonymous user in without `terms_version` (nobody has
--      signed up). Becoming permanent is the sign-up: a user whose is_anonymous turns false must
--      carry a valid `user_metadata.terms_version` by then (the app sends it with updateUser before
--      linking an email or Apple), or the change is refused (sat_users_require_terms_on_upgrade,
--      BEFORE UPDATE), exactly as a sign-up without it is.
--   3. Upgrading keeps the id. The AFTER INSERT trigger never runs again for that user, so
--      sat_user_upgraded (AFTER UPDATE OF is_anonymous) does what a sign-up would: the profile with
--      the acceptance (stamped at the upgrade) and the starter ink (ensure_ink_account). SAT
--      attempts, passes and boards are already theirs (same id).
--   4. The database itself, for what a client could do directly with its token (an anonymous user's
--      role is `authenticated`, like everyone's): a PostgREST pre-request check,
--      anonymous_request_guard(), lets an anonymous token READ (RLS still limits it to its own rows)
--      but WRITE only what SAT mode needs: sat_attempts, its whiteboards (the SAT session board and
--      its pages), their board_assets and user_settings, and the RPCs the SAT routes call as the
--      student (rate_limit_hit, rate_limit_spend, sat_tutor_access, sat_tutor_spend) plus
--      delete_own_account. Any other write or RPC is a 403 (`PT403`). An anonymous user may keep at
--      most 10 boards (whiteboards_anonymous_cap).
--
-- The pre-request function is set on the `authenticator` role (pgrst.db_pre_request) and PostgREST
-- reloads its config at the end. Setting it replaces any other pre-request function: there is none
-- in this project before this migration.
--
-- Objects:
--   replaced    require_signup_terms(), handle_new_user(), ensure_ink_account(uuid) (each: the
--               anonymous branch only; otherwise unchanged from 20261003010000 / 20261009040000)
--   functions   sat_users_require_terms_on_upgrade() [trigger], sat_user_upgraded() [trigger],
--               jwt_is_anonymous(), anonymous_request_guard() [PostgREST pre-request],
--               whiteboards_anonymous_cap() [trigger]
--   triggers    sat_users_require_terms_on_upgrade (auth.users, BEFORE UPDATE OF is_anonymous),
--               sat_user_upgraded (auth.users, AFTER UPDATE OF is_anonymous),
--               whiteboards_anonymous_cap (whiteboards, BEFORE INSERT)
--   setting     role authenticator: pgrst.db_pre_request = 'public.anonymous_request_guard'
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Sign-up: anonymous users need no terms, get no profile and no ink
-- -----------------------------------------------------------------------------
create or replace function public.require_signup_terms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- an anonymous SAT session has not signed up; it accepts the terms when it becomes permanent
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  if public.signup_terms_version(new.raw_user_meta_data) is null then
    raise exception 'sign-up refused: the Terms and Privacy Policy were not accepted (user_metadata.terms_version is missing)'
      using errcode = '23514',
            hint = 'Sign up from the app, or pass user_metadata.terms_version (YYYY-MM-DD, 2026-01-01 to tomorrow) to the admin API.';
  end if;
  return new;
end;
$$;
revoke all on function public.require_signup_terms() from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terms text := public.signup_terms_version(new.raw_user_meta_data);
begin
  -- An anonymous SAT session is not an account: no profile, no ink (sat_user_upgraded makes both
  -- when it becomes permanent).
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  begin
    insert into public.profiles (user_id, display_name, accepted_terms_at, terms_version)
    values (
      new.id,
      nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''), 80), ''),
      case when v_terms is not null then coalesce(new.created_at, now()) end,
      v_terms
    )
    on conflict (user_id) do nothing;
  exception when others then
    raise warning 'handle_new_user: could not create profile for %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  -- A kid profile's help comes from their grown-up's plan, never from ink of its own.
  if not public.is_kid_signup(new.raw_user_meta_data) then
    begin
      insert into public.ink_grants (user_id, units, kind, reason)
      values (new.id, public.ink_starter_amount(), 'starter', 'Starter ink')
      on conflict (user_id) where kind = 'starter' do nothing;
    exception when others then
      raise warning 'handle_new_user: could not grant starter ink to %: % (%)', new.id, sqlerrm, sqlstate;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

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
  -- an anonymous SAT session has no profile and no ink, and the self-heal must not make them
  if exists (select 1 from auth.users u where u.id = p_uid and coalesce(u.is_anonymous, false)) then
    return;
  end if;
  insert into public.profiles (user_id, accepted_terms_at, terms_version)
  select u.id,
         case when public.signup_terms_version(u.raw_user_meta_data) is not null then coalesce(u.created_at, now()) end,
         public.signup_terms_version(u.raw_user_meta_data)
  from auth.users u where u.id = p_uid
  on conflict (user_id) do nothing;

  if exists (select 1 from public.profiles where user_id = p_uid)
     and not exists (select 1 from public.ink_grants where user_id = p_uid and kind = 'starter')
     and not exists (select 1 from public.family_members m where m.child_id = p_uid)
     and not exists (select 1 from auth.users u where u.id = p_uid and public.is_kid_signup(u.raw_user_meta_data)) then
    insert into public.ink_grants (user_id, units, kind, reason)
    values (p_uid, public.ink_starter_amount(), 'starter', 'Starter ink')
    on conflict (user_id) where kind = 'starter' do nothing;
  end if;
end;
$$;
revoke all on function public.ensure_ink_account(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Becoming permanent: the terms first, then what a sign-up would have made
-- -----------------------------------------------------------------------------
create or replace function public.sat_users_require_terms_on_upgrade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.is_anonymous, false) and not coalesce(new.is_anonymous, false)
     and public.signup_terms_version(new.raw_user_meta_data) is null then
    raise exception 'upgrade refused: the Terms and Privacy Policy were not accepted (user_metadata.terms_version is missing)'
      using errcode = '23514',
            hint = 'Call updateUser with data.terms_version (YYYY-MM-DD) before linking an email or identity.';
  end if;
  return new;
end;
$$;
revoke all on function public.sat_users_require_terms_on_upgrade() from public, anon, authenticated;

create or replace function public.sat_user_upgraded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terms text := public.signup_terms_version(new.raw_user_meta_data);
begin
  if not (coalesce(old.is_anonymous, false) and not coalesce(new.is_anonymous, false)) then
    return new;
  end if;
  begin
    -- the sign-up is now: the acceptance is stamped now, not when the anonymous session began
    insert into public.profiles (user_id, display_name, accepted_terms_at, terms_version)
    values (
      new.id,
      nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''), 80), ''),
      case when v_terms is not null then now() end,
      v_terms
    )
    on conflict (user_id) do nothing;
    perform public.ensure_ink_account(new.id);
  exception when others then
    -- never block the upgrade over this: ensure_ink_account heals it on the first charged call
    raise warning 'sat_user_upgraded: could not set up the account for %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;
revoke all on function public.sat_user_upgraded() from public, anon, authenticated;

-- Created once (as 20261003010000_signup_consent.sql does): dropping a trigger on auth.users needs
-- its ownership, which the hosted project's postgres role may not have.
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'sat_users_require_terms_on_upgrade' and not tgisinternal) then
    create trigger sat_users_require_terms_on_upgrade
      before update of is_anonymous on auth.users
      for each row execute function public.sat_users_require_terms_on_upgrade();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'sat_user_upgraded' and not tgisinternal) then
    create trigger sat_user_upgraded
      after update of is_anonymous on auth.users
      for each row execute function public.sat_user_upgraded();
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. What an anonymous token may do through PostgREST
-- -----------------------------------------------------------------------------
-- Is the request's JWT an anonymous user's? (false for no JWT, the service role, a real account)
create or replace function public.jwt_is_anonymous()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false)
$$;
revoke all on function public.jwt_is_anonymous() from public, anon;
grant execute on function public.jwt_is_anonymous() to authenticated, service_role;

create or replace function public.anonymous_request_guard()
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_method text := upper(coalesce(current_setting('request.method', true), ''));
  v_path text := coalesce(current_setting('request.path', true), '');
begin
  if not public.jwt_is_anonymous() then
    return;
  end if;
  -- reads: RLS already keeps them to the user's own rows (and live SAT questions)
  if v_method in ('GET', 'HEAD', 'OPTIONS') and v_path not like '/rpc/%' then
    return;
  end if;
  if v_path in (
    '/sat_attempts', '/whiteboards', '/board_assets', '/user_settings',
    '/rpc/rate_limit_hit', '/rpc/rate_limit_spend', '/rpc/sat_tutor_access', '/rpc/sat_tutor_spend',
    '/rpc/delete_own_account'
  ) then
    return;
  end if;
  raise sqlstate 'PT403' using message = 'This needs an account: SAT practice is all that works without one.', hint = 'anonymous';
end;
$$;
revoke all on function public.anonymous_request_guard() from public, anon;
grant execute on function public.anonymous_request_guard() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.anonymous_request_guard';

-- An anonymous user keeps at most 10 boards (an SAT session is one board).
create or replace function public.whiteboards_anonymous_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from auth.users u where u.id = new.user_id and coalesce(u.is_anonymous, false))
     and (select count(*) from public.whiteboards w where w.user_id = new.user_id) >= 10 then
    raise exception 'too many boards without an account' using errcode = '23514', hint = 'whiteboards_anonymous_cap';
  end if;
  return new;
end;
$$;
revoke all on function public.whiteboards_anonymous_cap() from public, anon, authenticated;

drop trigger if exists whiteboards_anonymous_cap on public.whiteboards;
create trigger whiteboards_anonymous_cap
  before insert on public.whiteboards
  for each row execute function public.whiteboards_anonymous_cap();

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
