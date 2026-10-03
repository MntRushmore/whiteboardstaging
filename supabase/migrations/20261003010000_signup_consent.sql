-- =============================================================================
-- Sign-up consent (2026-10-03). Idempotent; additive to 20261002000000_ink.sql.
--
-- Sign-up asks for one box (src/components/login/LoginForm.tsx):
--   "I agree to the Terms and the Privacy Policy. I'm 13 or older, or I'm a parent or guardian
--    setting this up for my child."
-- What the account agreed to is kept on its profile:
--
--   profiles.accepted_terms_at  when the account was created with the box ticked (server time)
--   profiles.terms_version      which version of that text (TERMS_VERSION in src/lib/legal.ts,
--                               a date such as '2026-10-03'; the age statement is part of it)
--
-- Both stay null for accounts made before this migration: they are never asked again.
--
-- How it gets there, and why a client cannot skip it. The form passes
-- `options.data.terms_version` to supabase.auth.signUp; GoTrue writes it into
-- auth.users.raw_user_meta_data in the same INSERT that creates the account.
--   * auth_users_require_terms (BEFORE INSERT on auth.users) refuses an account without a
--     well-formed terms_version. A client that ignores the box, a page cached from before this
--     release, or a direct POST to /auth/v1/signup gets GoTrue's "Database error saving new user"
--     and no account at all.
--   * handle_new_user() (AFTER INSERT, as before) copies it onto the new profile, stamped with the
--     account's created_at; ensure_ink_account() (the self-heal for a missing profile) does too.
-- Recording it with a second request after sign-up was rejected: that request can be skipped,
-- fail, or come before there is a session (email confirmation), leaving an account with no record.
--
-- Every new account needs it, including one made with the service role: to a trigger, GoTrue's
-- admin create and a public sign-up are the same INSERT. Pass `user_metadata.terms_version` to
-- the admin API (scripts/lib/supabaseHttp.mjs does). The dashboard's "Add user" cannot pass
-- metadata, so it is refused too (docs/RUNBOOK-supabase.md, "Creating an account by hand").
--
-- No new grant: a user reads these columns with their profile and cannot write them (the only
-- column grant on profiles is update (display_name)).
--
-- What counts as a version: a real calendar date from 2026-01-01 to tomorrow (UTC), written
-- YYYY-MM-DD. Not a fixed list, so bumping TERMS_VERSION is a code change only; a client cannot
-- record a version from before 2026 or from the future, or a non-date such as 2026-99-99.
--
-- DEPLOY ORDER (RUNBOOK-billing section 7): apply this migration only AFTER the frontend that sends
-- terms_version is live. Applied first, every sign-up from the old form fails ("Database error
-- saving new user") until the deploy. The new frontend before this migration is harmless: GoTrue
-- keeps the metadata, the previous handle_new_user() ignores it, and the backfill below records
-- it for the accounts made in between.
--
-- Re-runnable without ownership of auth.users: the trigger is created only when it is missing
-- (a DO block over pg_trigger), never dropped and re-created; the functions are create-or-replace.
--
-- Objects:
--   columns     profiles.accepted_terms_at, profiles.terms_version
--   constraints profiles_terms_version_format, profiles_terms_recorded_together
--   functions   signup_terms_version(jsonb), require_signup_terms()
--   trigger     auth_users_require_terms (auth.users, BEFORE INSERT)
--   replaced    handle_new_user(), ensure_ink_account(uuid): unchanged except that they copy the
--               acceptance (the 300 starter ink as in 20261002000000_ink.sql)
--   data        profiles of accounts made between the frontend deploy and this migration get the
--               version their sign-up carried (only nulls are filled; idempotent)
-- =============================================================================

alter table public.profiles add column if not exists accepted_terms_at timestamptz;
alter table public.profiles add column if not exists terms_version text;

alter table public.profiles drop constraint if exists profiles_terms_version_format;
alter table public.profiles add constraint profiles_terms_version_format
  check (terms_version is null or (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and terms_version >= '2026-01-01'));

alter table public.profiles drop constraint if exists profiles_terms_recorded_together;
alter table public.profiles add constraint profiles_terms_recorded_together
  check ((accepted_terms_at is null) = (terms_version is null));

-- The version a sign-up's user metadata carries, when it is a valid one; else null. Valid: a string
-- YYYY-MM-DD that is a real calendar date from 2026-01-01 to tomorrow (UTC). Stable, not
-- immutable: "tomorrow" moves.
create or replace function public.signup_terms_version(p_meta jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v text := p_meta ->> 'terms_version';
  d date;
begin
  if jsonb_typeof(p_meta -> 'terms_version') is distinct from 'string' or v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  begin
    d := make_date(substr(v, 1, 4)::int, substr(v, 6, 2)::int, substr(v, 9, 2)::int);
  exception when others then
    return null; -- 2026-99-99, 2026-02-30
  end;
  if d < date '2026-01-01' or d > (now() at time zone 'utc')::date + 1 then
    return null;
  end if;
  return v;
end;
$$;
revoke all on function public.signup_terms_version(jsonb) from public, anon, authenticated;

-- BEFORE INSERT on auth.users: no acceptance, no account.
create or replace function public.require_signup_terms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.signup_terms_version(new.raw_user_meta_data) is null then
    raise exception 'sign-up refused: the Terms and Privacy Policy were not accepted (user_metadata.terms_version is missing)'
      using errcode = '23514',
            hint = 'Sign up from the app, or pass user_metadata.terms_version (YYYY-MM-DD, 2026-01-01 to tomorrow) to the admin API.';
  end if;
  return new;
end;
$$;
revoke all on function public.require_signup_terms() from public, anon, authenticated;

-- Created once; a re-run finds it and leaves it (dropping a trigger needs ownership of auth.users,
-- which the hosted project's postgres role may not have). The function above is what a re-run updates.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'auth_users_require_terms' and not tgisinternal
  ) then
    create trigger auth_users_require_terms
      before insert on auth.users
      for each row execute function public.require_signup_terms();
  end if;
end;
$$;

-- The sign-up trigger (20261002000000_ink.sql), now also recording the acceptance on the profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terms text := public.signup_terms_version(new.raw_user_meta_data);
begin
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

-- The self-heal (20261002000000_ink.sql): a profile it has to create carries the acceptance the
-- account was created with.
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
  insert into public.profiles (user_id, accepted_terms_at, terms_version)
  select u.id,
         case when public.signup_terms_version(u.raw_user_meta_data) is not null then coalesce(u.created_at, now()) end,
         public.signup_terms_version(u.raw_user_meta_data)
  from auth.users u where u.id = p_uid
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

-- Accounts made after the frontend that sends terms_version went live and before this migration:
-- their sign-up carried a version that the previous handle_new_user() did not copy. Only empty
-- profiles are filled, and only from accounts created on or after the version's own date (a
-- version cannot have been accepted before it existed), so a re-run changes nothing.
update public.profiles p
set accepted_terms_at = coalesce(u.created_at, now()),
    terms_version = public.signup_terms_version(u.raw_user_meta_data)
from auth.users u
where u.id = p.user_id
  and p.accepted_terms_at is null
  and public.signup_terms_version(u.raw_user_meta_data) is not null
  and u.created_at >= public.signup_terms_version(u.raw_user_meta_data)::date;

notify pgrst, 'reload schema';
