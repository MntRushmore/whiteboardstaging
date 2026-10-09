-- =============================================================================
-- Family hardening (2026-10-09, "kids come back"). Idempotent; on top of
-- 20261009000000_kids_come_back.sql and 20261009010000_family_plan.sql. docs/KIDS-COME-BACK.md.
--
-- A review found four gaps that kid profiles (real auth users the server makes) opened. Each
-- function below is re-declared from its latest definition, and only the lines named here change.
--
-- 1. Kids were a way to get free AI. Each kid was a new auth user, so the sign-up trigger gave it
--    starter ink. Adding a kid needed no plan, and removing and re-adding one cost nothing. Deleting a
--    kid also cascaded its unlimited_usage rows, which gave a fresh fair-use allowance.
--   is_kid_signup(meta)    true when an account was made as a kid: raw_user_meta_data.kid = true,
--                          which createKid sets (src/lib/family/server/store.ts). Internal.
--   handle_new_user()      same as 20261003010000_signup_consent.sql, except that a kid account gets
--                          no starter ink. A public sign-up that sets the flag only gives up its own
--                          starter.
--   ensure_ink_account(uid) same as 20261003010000_signup_consent.sql, except that it never grants a
--                          missing starter to a kid (by the flag, or by a family_members row).
--                          Otherwise the self-heal would give the ink back on the kid's first call.
--   consume_credits(...)   same as 20261003020000_unlimited.sql, except:
--                          - a kid (plan_owner_of(uid) <> uid) never spends ink of their own. Without
--                            the grown-up's Unlimited the answer is `insufficient_credits` with
--                            `plan_required: true` and remaining 0, and nothing is written;
--                          - fair use is counted per FAMILY. The Unlimited branch counts and writes
--                            unlimited_usage rows on the plan owner (the grown-up), so a family
--                            shares one daily allowance (unlimited_fair_use_per_day()). Deleting a
--                            kid resets nothing, because the rows are not the kid's to cascade.
--                            A kid's call also locks the grown-up's profile row, so a family's
--                            parallel calls run one at a time and the cap stays exact. (The admin
--                            console's per-account call counts now show a family's Unlimited calls
--                            on the grown-up.)
--   refund_ink_for(...)    same as 20261003020000_unlimited.sql, except that it also looks for the
--                          refunded call's unlimited_usage row on the plan owner.
--   family_kid_add_attempt(parent, limit, window_ms)
--                          the per-family budget for ADDING kids (6 a day, src/lib/family/server).
--                          It is counted in rate_limit_counters (bucket `family_kid_add`) and keyed
--                          on the grown-up, so removing and re-adding kids cannot churn accounts.
--                          Service role only. The server also refuses to add a kid unless the
--                          grown-up has Unlimited (has_unlimited(), read with the service role).
--
-- 2. The PIN could be brute forced: 5 tries per 15 minutes is about 480 guesses a day.
--   families.pin_locked_at when the family's daily budget ran out; null when not locked.
--   family_pin_attempt(parent, limit, window_ms, day_limit = 10)
--                          replaces the 3-argument version, which is dropped (the default keeps the
--                          old calls working). It keeps the 15-minute budget, and adds a budget of at
--                          most `day_limit` counted tries per family per 24 hours (bucket
--                          `family_pin_day`). A right PIN is given back, so it is the wrong PINs that
--                          count. The try that spends the day's last one locks switching to the
--                          grown-up, and answers `last: true` (the server records an app_event when
--                          that try was wrong). While locked, every try is refused WITHOUT being
--                          counted (`locked: true`, retry_after_ms to the lock's end) until either:
--                          - 24 hours pass; or
--                          - the grown-up signs in with their own credentials (password, OAuth or
--                            an emailed link), which moves auth.users.last_sign_in_at past the lock.
--                            A token refresh does not move it, and the switch, the only other way
--                            in, is what is locked.
--                          When the lock lifts, the family starts a fresh budget.
--   family_counter_hit(parent, bucket, window_ms)
--                          the fixed-window counter the two budgets share (a copy of the one in
--                          rate_limit_hit(), keyed on the grown-up). Internal.
--   family_pin_forgive(parent, window_start)
--                          gives a right PIN's try back in both budgets and lifts a lock that try set.
--   families_pin_changed   trigger: a new PIN (set from the grown-up's own session, POST
--                          /api/family/pin) lifts the lock and clears both budgets.
--
-- 3. No kid outlives their grown-up, however the grown-up's account is deleted.
--   families_delete_kids   trigger, BEFORE DELETE on families: deletes the family's kids' auth users,
--                          and each kid's data cascades from their auth user. families cascades from
--                          the grown-up's auth user, so this covers an admin or Dashboard deletion
--                          (auth.admin.deleteUser) as well as delete_own_account(). That function
--                          deletes the kids itself first, so the trigger then finds none. It cannot
--                          loop: a kid never has a families row (families_parent_not_kid), so deleting
--                          a kid deletes no families row. SQL cannot remove the kids' Storage objects:
--                          the app removes them first (DELETE /api/family), or the GC does later.
--
-- 4. (No SQL.) src/lib/billing/deleteAccount.ts no longer deletes the kids' accounts before
--    delete_own_account(). DELETE /api/family now removes only their saved images, and the RPC
--    deletes the kids with the grown-up in one transaction, so a refused or failed RPC keeps
--    every kid.
--
-- Supabase's default privileges grant ALL on every new public function to anon, authenticated and
-- service_role, so each function revokes first and grants exactly what is used.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Kids get no ink of their own
-- -----------------------------------------------------------------------------
create or replace function public.is_kid_signup(p_meta jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_meta ->> 'kid', '') = 'true'
$$;
revoke all on function public.is_kid_signup(jsonb) from public, anon, authenticated;

-- The sign-up trigger (20261003010000_signup_consent.sql). The only change: a kid gets no starter ink.
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

-- The self-heal (20261003010000_signup_consent.sql). The only change: no starter for a kid.
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
-- 2. Spending: a kid only through the grown-up's plan; fair use per family
-- -----------------------------------------------------------------------------
-- Same as 20261003020000_unlimited.sql, except for the v_owner lines (see the header).
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

  -- A kid has no ink of their own to spend: help comes only through the grown-up's plan.
  if v_owner <> v_uid then
    return jsonb_build_object('ok', false, 'remaining', 0, 'reason', 'insufficient_credits', 'plan_required', true);
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

-- Same as 20261003020000_unlimited.sql, except that the call's unlimited_usage row may be on the plan
-- owner (a kid's call, counted for the family). The caller's own rows are still looked at too (a
-- call recorded before this migration).
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
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;
  if p_request_id is null or char_length(p_request_id) < 1 or char_length(p_request_id) > 100 then
    raise exception 'p_request_id must be 1..100 characters' using errcode = '22023';
  end if;

  -- Same lock consume_credits() takes, so a refund and a spend for one user serialise.
  perform 1 from public.profiles pr where pr.user_id = p_user_id for update;

  -- The one path allowed to delete usage rows (ink_ledger_guard_delete), for this statement only.
  perform set_config('agathon.ink_refund', 'on', true);
  with gone as (
    delete from public.usage_events u
    where u.user_id = p_user_id
      and u.request_id = p_request_id
      and u.created_at > now() - interval '15 minutes'
    returning u.units
  )
  select coalesce(sum(units), 0)::integer into v_refunded from gone;
  perform set_config('agathon.ink_refund', 'off', true);

  delete from public.unlimited_usage u
  where u.user_id in (p_user_id, public.plan_owner_of(p_user_id))
    and u.request_id = p_request_id
    and u.created_at > now() - interval '15 minutes';

  select pr.ink_balance into v_balance from public.profiles pr where pr.user_id = p_user_id;
  return jsonb_build_object('refunded', v_refunded, 'remaining', coalesce(v_balance, 0));
end;
$$;
revoke all on function public.refund_ink_for(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_ink_for(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. A family's counters (the PIN's budgets, adding kids)
-- -----------------------------------------------------------------------------
-- rate_limit_hit()'s fixed window (20260917030000_refunds_ratelimit.sql), keyed on the grown-up's
-- id from the server instead of auth.uid(). Counts one hit and says where the window stands.
create or replace function public.family_counter_hit(
  p_parent uuid,
  p_bucket text,
  p_window_ms integer,
  out o_hits integer,
  out o_window_start timestamptz,
  out o_retry_after_ms integer
)
language plpgsql
volatile
set search_path = public
as $$
declare
  v_now_ms bigint := floor(extract(epoch from now()) * 1000)::bigint;
  v_start_ms bigint := v_now_ms - (v_now_ms % p_window_ms);
begin
  o_window_start := to_timestamp(v_start_ms / 1000.0);
  o_retry_after_ms := (v_start_ms + p_window_ms - v_now_ms)::integer;

  delete from public.rate_limit_counters c
  where c.user_id = p_parent and c.bucket = p_bucket and c.expires_at <= now();

  insert into public.rate_limit_counters as c (user_id, bucket, window_start, hits, expires_at)
  values (p_parent, p_bucket, o_window_start, 1, to_timestamp((v_start_ms + 2::bigint * p_window_ms) / 1000.0))
  on conflict (user_id, bucket, window_start)
    do update set hits = c.hits + 1
  returning c.hits into o_hits;
end;
$$;
revoke all on function public.family_counter_hit(uuid, text, integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. The PIN: 15 minutes' budget, a day's budget, and the lock
-- -----------------------------------------------------------------------------
alter table public.families add column if not exists pin_locked_at timestamptz;

drop function if exists public.family_pin_attempt(uuid, integer, integer);

create or replace function public.family_pin_attempt(
  p_parent uuid,
  p_limit integer,
  p_window_ms integer,
  p_day_limit integer default 10
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_day_ms constant integer := 86400000;
  v_locked_at timestamptz;
  v_signed_in timestamptz;
  v_short record;
  v_day record;
begin
  if p_parent is null then
    raise exception 'p_parent is required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000' using errcode = '22023';
  end if;
  if p_window_ms is null or p_window_ms < 1000 or p_window_ms > 86400000 then
    raise exception 'p_window_ms must be between 1000 and 86400000' using errcode = '22023';
  end if;
  if p_day_limit is null or p_day_limit < 1 or p_day_limit > 1000 then
    raise exception 'p_day_limit must be between 1 and 1000' using errcode = '22023';
  end if;

  -- One try per family at a time from here: the lock is read and set under the family row's lock.
  select f.pin_locked_at into v_locked_at from public.families f where f.parent_id = p_parent for update;

  if v_locked_at is not null then
    select u.last_sign_in_at into v_signed_in from auth.users u where u.id = p_parent;
    if v_locked_at <= now() - interval '24 hours' or (v_signed_in is not null and v_signed_in > v_locked_at) then
      -- Over: 24 hours passed, or the grown-up signed in themself. A fresh budget.
      update public.families f set pin_locked_at = null where f.parent_id = p_parent;
      delete from public.rate_limit_counters c where c.user_id = p_parent and c.bucket in ('family_pin', 'family_pin_day');
    else
      return jsonb_build_object(
        'allowed', false, 'remaining', 0, 'locked', true, 'last', false, 'window_start', null, 'backend', 'db',
        'retry_after_ms', greatest(1000, least(v_day_ms, ceil(extract(epoch from (v_locked_at + interval '24 hours' - now())) * 1000)))::integer
      );
    end if;
  end if;

  -- The 15-minute budget. A try refused here never reaches the PIN, so the day does not count it.
  select * into v_short from public.family_counter_hit(p_parent, 'family_pin', p_window_ms);
  if v_short.o_hits > p_limit then
    return jsonb_build_object(
      'allowed', false, 'remaining', 0, 'locked', false, 'last', false, 'backend', 'db',
      'retry_after_ms', v_short.o_retry_after_ms, 'window_start', v_short.o_window_start
    );
  end if;

  -- The day's budget. The try that spends the last one sets the lock (a right PIN lifts it again,
  -- family_pin_forgive); past it (no family row to hold a lock) the try is refused.
  select * into v_day from public.family_counter_hit(p_parent, 'family_pin_day', v_day_ms);
  if v_day.o_hits >= p_day_limit then
    update public.families f set pin_locked_at = now() where f.parent_id = p_parent;
  end if;
  if v_day.o_hits > p_day_limit then
    return jsonb_build_object(
      'allowed', false, 'remaining', 0, 'locked', true, 'last', false, 'window_start', null, 'backend', 'db',
      'retry_after_ms', v_day.o_retry_after_ms
    );
  end if;

  return jsonb_build_object(
    'allowed',        true,
    'remaining',      least(p_limit - v_short.o_hits, p_day_limit - v_day.o_hits),
    'retry_after_ms', 0,
    'window_start',   v_short.o_window_start,
    'locked',         false,
    'last',           v_day.o_hits >= p_day_limit,
    'backend',        'db'
  );
end;
$$;
revoke all on function public.family_pin_attempt(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.family_pin_attempt(uuid, integer, integer, integer) to service_role;

-- The PIN was right: that try does not count against the family, in either budget, and a lock that
-- try set is lifted (the grown-up is here). The day window holding the try is the one holding its
-- 15-minute window (15 minutes divide a day).
create or replace function public.family_pin_forgive(p_parent uuid, p_window_start timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz;
begin
  if p_parent is null or p_window_start is null then
    return;
  end if;
  v_day_start := to_timestamp(floor(extract(epoch from p_window_start) / 86400) * 86400);
  update public.rate_limit_counters c
     set hits = greatest(0, c.hits - 1)
   where c.user_id = p_parent and c.bucket = 'family_pin' and c.window_start = p_window_start;
  update public.rate_limit_counters c
     set hits = greatest(0, c.hits - 1)
   where c.user_id = p_parent and c.bucket = 'family_pin_day' and c.window_start = v_day_start;
  update public.families f set pin_locked_at = null where f.parent_id = p_parent and f.pin_locked_at is not null;
end;
$$;
revoke all on function public.family_pin_forgive(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.family_pin_forgive(uuid, timestamptz) to service_role;

-- A new PIN comes from the grown-up's own session: the lock is lifted and both budgets start over.
create or replace function public.families_pin_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pin_hash is distinct from old.pin_hash then
    new.pin_locked_at := null;
    delete from public.rate_limit_counters c
    where c.user_id = new.parent_id and c.bucket in ('family_pin', 'family_pin_day');
  end if;
  return new;
end;
$$;
revoke all on function public.families_pin_changed() from public, anon, authenticated;

drop trigger if exists families_pin_changed on public.families;
create trigger families_pin_changed
  before update of pin_hash on public.families
  for each row execute function public.families_pin_changed();

-- -----------------------------------------------------------------------------
-- 5. Adding kids: a budget per family
-- -----------------------------------------------------------------------------
create or replace function public.family_kid_add_attempt(p_parent uuid, p_limit integer, p_window_ms integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v record;
begin
  if p_parent is null then
    raise exception 'p_parent is required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000' using errcode = '22023';
  end if;
  if p_window_ms is null or p_window_ms < 1000 or p_window_ms > 86400000 then
    raise exception 'p_window_ms must be between 1000 and 86400000' using errcode = '22023';
  end if;

  select * into v from public.family_counter_hit(p_parent, 'family_kid_add', p_window_ms);
  return jsonb_build_object(
    'allowed',        v.o_hits <= p_limit,
    'remaining',      greatest(0, p_limit - v.o_hits),
    'retry_after_ms', case when v.o_hits <= p_limit then 0 else v.o_retry_after_ms end,
    'backend',        'db'
  );
end;
$$;
revoke all on function public.family_kid_add_attempt(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.family_kid_add_attempt(uuid, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 6. The kids go with their family, whoever deletes it
-- -----------------------------------------------------------------------------
create or replace function public.families_delete_kids()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.users u
  where u.id in (select m.child_id from public.family_members m where m.parent_id = old.parent_id)
    and u.id <> old.parent_id;
  return old;
end;
$$;
revoke all on function public.families_delete_kids() from public, anon, authenticated;

drop trigger if exists families_delete_kids on public.families;
create trigger families_delete_kids
  before delete on public.families
  for each row execute function public.families_delete_kids();

-- PostgREST caches the schema; the new and changed functions need a reload.
notify pgrst, 'reload schema';
