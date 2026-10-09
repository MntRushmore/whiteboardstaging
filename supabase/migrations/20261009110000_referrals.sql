-- =============================================================================
-- Referrals, "Give a month, get a month" (2026-10-09, Phase 2). Idempotent; additive. Needs
-- 20261009100000_parents_recommend.sql (profiles.referral_code, the referrals table),
-- 20261009000000_kids_come_back.sql (profiles.attribution, family_members, save_attribution),
-- 20261003020000_unlimited.sql (unlimited_subscriptions) and 20261008000000_admin_console.sql
-- (admin_audit). docs/KIDS-COME-BACK.md; src/lib/referral/contracts.ts is the contract.
--
-- A grown-up shares `https://agathon.app/?ref=<code>`. The funnel's capture keeps the `?ref=` in
-- the visitor's attribution, and save_attribution() writes it to the new account's profile once.
-- This migration turns that write into a referral row, moves the row along as the friend's plan
-- starts and is paid for, and gives the admin console the list and the two buttons ("Mark
-- rewarded", "Void"). The app has no Stripe secret key: the free months themselves are Stripe
-- objects the owner makes or applies by hand (docs/RUNBOOK-billing.md, "Referrals").
--
--   profiles.referral_code_at  when the grown-up's code was made (by my_referral_code()). A
--                       referral counts only for an account made AFTER it: an account that existed
--                       before the code cannot have come from it. Owner-readable like the rest of
--                       the profile; never client-writable (the profile's only client-writable
--                       column is display_name).
--
-- Functions a signed-in grown-up calls:
--   my_referral_code() -> text        the caller's code, made on the first call: 8 characters from
--                       the contract's alphabet without its vowels (no words spelled by chance),
--                       unique (a collision tries again). A kid profile (family_members, or a
--                       KID_EMAIL_DOMAIN address) is refused: 42501, hint `family_kid`.
--   referral_summary() -> jsonb       { code, signed_up, paid, months_earned, months_pending }:
--                       the caller's code (made if needed, so the card needs one call) and counts of
--                       their referrals (ReferralSummary in the contract; the link is built in the
--                       browser). signed_up counts every referral not voided; paid, those paid or
--                       rewarded; months_earned, rewarded; months_pending, paid and not yet
--                       rewarded. Kids refused like my_referral_code().
--
-- Triggers:
--   profiles_record_referral   BEFORE INSERT OR UPDATE OF attribution ON profiles, when the
--                       attribution is set for the first time (from null) and carries a `ref`. The
--                       code (trimmed, upper-cased) makes a referrals row when it belongs to another
--                       grown-up's existing account, the account is not a kid, was made after the
--                       code, and has no referral yet. Self-referral is refused twice over: the same
--                       account, and any kid profile (so a grown-up's own kids never count). The
--                       row starts at the friend's plan's state, in case it was saved late. The
--                       attribution's `ref` is then the recorded code, or REMOVED when no referral
--                       was recorded: `profiles.attribution.ref` present means "this account was
--                       referred", which is how the plan screen chooses the friend's free-month
--                       Payment Link (src/lib/billing/planChoice.ts) without a made-up code
--                       unlocking it. Never fails the attribution's write: a failure to record is a
--                       warning, and the ref is dropped.
--   unlimited_subscriptions_referral   AFTER INSERT OR UPDATE OF status, user_id ON
--                       unlimited_subscriptions: the referred account's subscription moves its
--                       referral forward only: trialing -> 'trialing'; active (the first successful
--                       charge) -> 'paid' and paid_at. 'rewarded' and 'void' are final. Never fails
--                       the webhook's write (a warning instead).
--   referrals_set_updated_at   keeps referrals.updated_at.
--
-- The admin console's (service role only):
--   admin_referrals(p_limit) -> jsonb   { generated_at, counts {status: n}, truncated, referrals: [
--                       { id, code, status, created_at, paid_at, rewarded_at, updated_at,
--                         rewarded_by_email,
--                         referrer { id, email, created_at, customer_id, payer_email },
--                         referred { id, email, created_at, payer_email, plan_status } } ] }
--                       newest first, at most p_limit (1..5000, default 1000). Emails come from
--                       auth.users and the checkouts' payer emails (known only after checkout), so
--                       the admin can judge abuse; customer_id is the referrer's Stripe customer,
--                       where the credit goes.
--   admin_referral_mark(p_id, p_status, p_admin) -> jsonb   'rewarded' (from 'paid' only:
--                       rewarded_at, rewarded_by) or 'void' (from signed_up, trialing or paid), and
--                       one admin_audit row ('referral.reward' / 'referral.void', target 'referral')
--                       in the same transaction. Answers the row as admin_referrals() shows it. No
--                       such row: P0002, hint `not_found`; a move the status does not allow: P0001,
--                       hint `referral_state`; another status: 22023.
--
-- Internal (no client may call them): referral_new_code(), referral_is_kid(uuid),
-- referral_code_for(uuid), referral_plan_status(uuid), referral_entry(bigint).
--
-- Supabase's default privileges grant ALL on every new public function to anon, authenticated and
-- service_role, so each function revokes first and grants exactly what is used.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. When the code was made
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists referral_code_at timestamptz;
-- a code made some other way (by hand) dates from now: only accounts made after it count
update public.profiles set referral_code_at = now() where referral_code is not null and referral_code_at is null;

drop trigger if exists referrals_set_updated_at on public.referrals;
create trigger referrals_set_updated_at
  before update on public.referrals
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Internal helpers
-- -----------------------------------------------------------------------------
-- A fresh code: 8 characters from the contract's alphabet less its vowels (A, E, U), so a code
-- never spells a word by chance. The randomness is gen_random_uuid()'s (a strong source, built in);
-- bytes 6 and 8 carry the uuid's version and variant bits, so they are skipped.
create or replace function public.referral_new_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_alphabet constant text := 'BCDFGHJKMNPQRSTVWXYZ23456789';
  v_bytes bytea := uuid_send(gen_random_uuid());
  v_out text := '';
  i int;
begin
  foreach i in array array[0, 1, 2, 3, 4, 5, 7, 9] loop
    v_out := v_out || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
  end loop;
  return v_out;
end;
$$;
revoke all on function public.referral_new_code() from public, anon, authenticated;

-- A kid profile: a family_members kid, or an address on KID_EMAIL_DOMAIN
-- (src/lib/family/contracts.ts), which a kid has from the moment the server makes it.
create or replace function public.referral_is_kid(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.family_members m where m.child_id = p_uid)
      or exists (select 1 from auth.users u where u.id = p_uid and lower(btrim(coalesce(u.email, ''))) like '%@kids.agathon.app')
$$;
revoke all on function public.referral_is_kid(uuid) from public, anon, authenticated;

-- The account's code, made on first ask. Two first asks at once: the second waits on the row's
-- lock, finds the first's code, and answers it.
create or replace function public.referral_code_for(p_uid uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_code text;
  v_try int := 0;
begin
  if p_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.referral_is_kid(p_uid) then
    raise exception 'Referrals are for grown-ups.' using errcode = '42501', hint = 'family_kid';
  end if;

  select p.referral_code into v_code from public.profiles p where p.user_id = p_uid;
  if v_code is not null then
    return v_code;
  end if;

  -- Self-heal a missing profile (sign-up trigger failed) - only for a user that still exists.
  insert into public.profiles (user_id)
  select u.id from auth.users u where u.id = p_uid
  on conflict (user_id) do nothing;

  loop
    v_try := v_try + 1;
    begin
      update public.profiles
         set referral_code = public.referral_new_code(), referral_code_at = now()
       where user_id = p_uid and referral_code is null
      returning referral_code into v_code;
      if v_code is null then
        select p.referral_code into v_code from public.profiles p where p.user_id = p_uid;
      end if;
      if v_code is null then
        raise exception 'account not found' using errcode = '42501';
      end if;
      return v_code;
    exception when unique_violation then
      -- another account has this code: draw again (about 3e11 codes, so this is rare)
      if v_try >= 8 then
        raise;
      end if;
    end;
  end loop;
end;
$$;
revoke all on function public.referral_code_for(uuid) from public, anon, authenticated;

-- How far the account's plan got, as a referral status: 'paid' once a subscription is active
-- (its first charge succeeded), 'trialing' while one is in its free trial, else 'signed_up'.
create or replace function public.referral_plan_status(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when exists (select 1 from public.unlimited_subscriptions s where s.user_id = p_uid and s.status = 'active') then 'paid'
           when exists (select 1 from public.unlimited_subscriptions s where s.user_id = p_uid and s.status = 'trialing') then 'trialing'
           else 'signed_up'
         end
$$;
revoke all on function public.referral_plan_status(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. What a grown-up calls
-- -----------------------------------------------------------------------------
create or replace function public.my_referral_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  return public.referral_code_for(auth.uid());
end;
$$;
revoke all on function public.my_referral_code() from public, anon;
grant execute on function public.my_referral_code() to authenticated;

create or replace function public.referral_summary()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := public.referral_code_for(v_uid);
  v_out jsonb;
begin
  select jsonb_build_object(
           'code', v_code,
           'signed_up', count(*) filter (where r.status <> 'void'),
           'paid', count(*) filter (where r.status in ('paid', 'rewarded')),
           'months_earned', count(*) filter (where r.status = 'rewarded'),
           'months_pending', count(*) filter (where r.status = 'paid')
         )
    into v_out
    from public.referrals r
   where r.referrer_id = v_uid;
  return v_out;
end;
$$;
revoke all on function public.referral_summary() from public, anon;
grant execute on function public.referral_summary() to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Recording a referral when the new account's attribution is saved
-- -----------------------------------------------------------------------------
create or replace function public.profiles_record_referral()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_referrer uuid;
  v_code_at timestamptz;
  v_created timestamptz;
  v_status text;
  v_kept text;
begin
  if new.attribution is null or jsonb_typeof(new.attribution) <> 'object' or not (new.attribution ? 'ref') then
    return new;
  end if;
  -- only the account's first attribution counts (save_attribution writes it once)
  if tg_op = 'UPDATE' and old.attribution is not null then
    return new;
  end if;

  begin
    v_code := upper(btrim(coalesce(new.attribution ->> 'ref', '')));
    if v_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6,10}$' then
      select p.user_id, p.referral_code_at into v_referrer, v_code_at
        from public.profiles p
       where p.referral_code = v_code;
      select u.created_at into v_created from auth.users u where u.id = new.user_id;
      if v_referrer is not null
         and v_referrer <> new.user_id
         and v_code_at is not null
         and v_created is not null
         and v_created > v_code_at
         and not public.referral_is_kid(new.user_id)
         and not public.referral_is_kid(v_referrer)
      then
        v_status := public.referral_plan_status(new.user_id);
        insert into public.referrals (referrer_id, referred_id, code, status, paid_at)
        values (v_referrer, new.user_id, v_code, v_status, case when v_status = 'paid' then now() end)
        on conflict (referred_id) do nothing;
      end if;
    end if;
    select r.code into v_kept from public.referrals r where r.referred_id = new.user_id and r.status <> 'void';
  exception when others then
    raise warning 'referral not recorded for %: % (%)', new.user_id, sqlerrm, sqlstate;
    v_kept := null;
  end;

  if v_kept is not null then
    new.attribution := jsonb_set(new.attribution, '{ref}', to_jsonb(v_kept));
  else
    new.attribution := new.attribution - 'ref';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_record_referral() from public, anon, authenticated;

drop trigger if exists profiles_record_referral on public.profiles;
create trigger profiles_record_referral
  before insert or update of attribution on public.profiles
  for each row execute function public.profiles_record_referral();

-- -----------------------------------------------------------------------------
-- 5. Following the friend's plan
-- -----------------------------------------------------------------------------
create or replace function public.referrals_follow_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next text;
begin
  if new.user_id is null then
    return null;
  end if;
  v_next := case new.status when 'active' then 'paid' when 'trialing' then 'trialing' else null end;
  if v_next is null then
    return null;
  end if;
  begin
    update public.referrals r
       set status = v_next,
           paid_at = case when v_next = 'paid' then coalesce(r.paid_at, now()) else r.paid_at end
     where r.referred_id = new.user_id
       and (r.status = 'signed_up' or (r.status = 'trialing' and v_next = 'paid'));
  exception when others then
    raise warning 'referral not moved for %: % (%)', new.user_id, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke all on function public.referrals_follow_plan() from public, anon, authenticated;

drop trigger if exists unlimited_subscriptions_referral on public.unlimited_subscriptions;
create trigger unlimited_subscriptions_referral
  after insert or update of status, user_id on public.unlimited_subscriptions
  for each row execute function public.referrals_follow_plan();

-- -----------------------------------------------------------------------------
-- 6. The admin console's list and buttons
-- -----------------------------------------------------------------------------
-- One referral as the console shows it.
create or replace function public.referral_entry(p_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', r.id,
           'code', r.code,
           'status', r.status,
           'created_at', r.created_at,
           'paid_at', r.paid_at,
           'rewarded_at', r.rewarded_at,
           'updated_at', r.updated_at,
           'rewarded_by_email', (select u.email from auth.users u where u.id = r.rewarded_by),
           'referrer', jsonb_build_object(
             'id', r.referrer_id,
             'email', (select u.email from auth.users u where u.id = r.referrer_id),
             'created_at', (select u.created_at from auth.users u where u.id = r.referrer_id),
             'customer_id', (select s.stripe_customer_id from public.unlimited_subscriptions s
                              where s.user_id = r.referrer_id and s.stripe_customer_id is not null
                              order by s.updated_at desc, s.id desc limit 1),
             'payer_email', (select s.payer_email from public.unlimited_subscriptions s
                              where s.user_id = r.referrer_id and s.payer_email is not null
                              order by s.updated_at desc, s.id desc limit 1)
           ),
           'referred', jsonb_build_object(
             'id', r.referred_id,
             'email', (select u.email from auth.users u where u.id = r.referred_id),
             'created_at', (select u.created_at from auth.users u where u.id = r.referred_id),
             'payer_email', (select s.payer_email from public.unlimited_subscriptions s
                              where s.user_id = r.referred_id and s.payer_email is not null
                              order by s.updated_at desc, s.id desc limit 1),
             'plan_status', (select s.status from public.unlimited_subscriptions s
                              where s.user_id = r.referred_id
                              order by s.updated_at desc, s.id desc limit 1)
           )
         )
    from public.referrals r
   where r.id = p_id
$$;
revoke all on function public.referral_entry(bigint) from public, anon, authenticated;

create or replace function public.admin_referrals(p_limit int default 1000)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := coalesce(p_limit, 1000);
  v_total bigint;
begin
  if v_limit < 1 or v_limit > 5000 then
    raise exception 'p_limit must be between 1 and 5000' using errcode = '22023';
  end if;
  select count(*) into v_total from public.referrals;
  return jsonb_build_object(
    'generated_at', now(),
    'counts', (
      select jsonb_build_object(
               'signed_up', count(*) filter (where r.status = 'signed_up'),
               'trialing', count(*) filter (where r.status = 'trialing'),
               'paid', count(*) filter (where r.status = 'paid'),
               'rewarded', count(*) filter (where r.status = 'rewarded'),
               'void', count(*) filter (where r.status = 'void')
             )
        from public.referrals r
    ),
    'truncated', v_total > v_limit,
    'referrals', coalesce((
      select jsonb_agg(public.referral_entry(x.id) order by x.created_at desc, x.id desc)
        from (select r.id, r.created_at from public.referrals r order by r.created_at desc, r.id desc limit v_limit) x
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_referrals(int) from public, anon, authenticated;
grant execute on function public.admin_referrals(int) to service_role;

create or replace function public.admin_referral_mark(p_id bigint, p_status text, p_admin uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_from text;
begin
  if p_status is null or p_status not in ('rewarded', 'void') then
    raise exception 'p_status must be rewarded or void' using errcode = '22023';
  end if;
  if p_admin is null then
    raise exception 'p_admin is required' using errcode = '22023';
  end if;

  select r.status into v_from from public.referrals r where r.id = p_id for update;
  if not found then
    raise exception 'No referral has that id.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if (p_status = 'rewarded' and v_from <> 'paid')
     or (p_status = 'void' and v_from not in ('signed_up', 'trialing', 'paid')) then
    raise exception 'This referral is %, so it cannot be marked %.', v_from, p_status
      using errcode = 'P0001', hint = 'referral_state';
  end if;

  update public.referrals r
     set status = p_status,
         rewarded_at = case when p_status = 'rewarded' then now() else r.rewarded_at end,
         rewarded_by = case when p_status = 'rewarded' then p_admin else r.rewarded_by end
   where r.id = p_id;

  insert into public.admin_audit (admin_id, action, target_kind, target_id, meta)
  values (
    p_admin,
    case when p_status = 'rewarded' then 'referral.reward' else 'referral.void' end,
    'referral',
    p_id::text,
    jsonb_build_object('from', v_from, 'to', p_status)
  );

  return public.referral_entry(p_id);
end;
$$;
revoke all on function public.admin_referral_mark(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_referral_mark(bigint, text, uuid) to service_role;

-- PostgREST caches the schema; the new column and functions need a reload.
notify pgrst, 'reload schema';
