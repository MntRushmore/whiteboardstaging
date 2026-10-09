-- =============================================================================
-- Family plan (2026-10-09, "kids come back"). Idempotent; additive to
-- 20261009000000_kids_come_back.sql (the families and family_members tables). docs/KIDS-COME-BACK.md.
--
-- Parents pay, and siblings share one $25 plan. A kid profile is a real auth user made by the server
-- (src/lib/family, the /api/family routes, service role), linked to its grown-up by one
-- family_members row. This makes the kid's account read the grown-up's Agathon Unlimited, and keeps
-- the family whole when an account goes:
--
--   plan_owner_of(uid)     the account whose plan `uid` uses: a kid's grown-up, else `uid` itself.
--                          Internal (no client may call it).
--   has_unlimited(uid)     same as 20261003040000_go_live_gaps.sql, read through plan_owner_of: a kid
--                          has the plan while their grown-up does. consume_credits() asks it first
--                          (20261003020000_unlimited.sql), so a kid's help spends no ink and goes
--                          through the Unlimited fair-use path, counted on the kid's own
--                          unlimited_usage rows (each profile its own allowance; MAX_KIDS caps a
--                          family at 7 of them).
--   unlimited_state_of(uid) same as 20261003040000_go_live_gaps.sql, reading the grown-up's
--                          subscription rows for a kid: ink_summary().unlimited, so the paywall
--                          (src/lib/billing/planGate.ts) opens for a kid whose grown-up has the plan.
--                          `checkout_ref` stays the CALLER's own (a kid never checks out: the app
--                          shows a kid no billing, and a checkout with a kid's ref would put a second
--                          plan on the kid, not the family).
--   delete_own_account()   same as 20261003020000_unlimited.sql, plus: the grown-up's kids' accounts
--                          are deleted first (each kid's data cascades from their auth user), and a
--                          kid cannot delete their own account (hint `family_kid`: their grown-up
--                          removes the profile from the Family page). The /api/family routes delete
--                          the kids (and their saved images) before the client calls this; this is
--                          the backstop that never leaves a kid account without its grown-up.
--   family_pin_attempt(parent, limit, window_ms) / family_pin_forgive(parent, window_start)
--                          the PIN's budget, per FAMILY (5 wrong tries per 15 minutes,
--                          src/lib/family/server): a fixed window in rate_limit_counters keyed on the
--                          grown-up's id and bucket `family_pin`, counted BEFORE the PIN is checked
--                          (so parallel guesses cannot all slip in), and given back when the PIN was
--                          right. Service role only.
--   families / family_members triggers: a kid can never be a grown-up, a grown-up can never be
--                          someone's kid, and a family has at most 6 kids (MAX_KIDS), whatever
--                          calls race.
--
-- Supabase's default privileges grant ALL on every new public function to anon, authenticated and
-- service_role, so each function revokes first and grants exactly what is used.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. plan_owner_of
-- -----------------------------------------------------------------------------
create or replace function public.plan_owner_of(p_uid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select m.parent_id from public.family_members m where m.child_id = p_uid), p_uid)
$$;
revoke all on function public.plan_owner_of(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. has_unlimited, through the plan's owner
-- -----------------------------------------------------------------------------
-- Same as 20261003040000_go_live_gaps.sql, except that the rows read are the plan owner's: a kid's
-- grown-up's. `trialing` counts only on the owner's first plan; `active` always counts.
create or replace function public.has_unlimited(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null and exists (
    select 1
    from public.unlimited_subscriptions s
    where s.user_id = public.plan_owner_of(p_uid)
      and (s.status = 'active'
           or (s.status = 'trialing' and not public.unlimited_earlier_plan(s.user_id, s.id)))
      and (
        coalesce(s.current_period_end, s.trial_end) is null
        or coalesce(s.current_period_end, s.trial_end) + public.unlimited_grace() > now()
      )
  )
$$;
revoke all on function public.has_unlimited(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. unlimited_state_of, through the plan's owner
-- -----------------------------------------------------------------------------
-- Same as 20261003040000_go_live_gaps.sql, except that the subscription shown is the plan owner's.
-- checkout_ref is still p_uid's own.
create or replace function public.unlimited_state_of(p_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.unlimited_subscriptions%rowtype;
  v_ref uuid;
  v_owner uuid := public.plan_owner_of(p_uid);
begin
  select pr.checkout_ref into v_ref from public.profiles pr where pr.user_id = p_uid;

  select s.* into v_row
  from public.unlimited_subscriptions s
  where s.user_id = v_owner
  order by
    ((s.status = 'active'
      or (s.status = 'trialing' and not public.unlimited_earlier_plan(v_owner, s.id)))
     and (coalesce(s.current_period_end, s.trial_end) is null
          or coalesce(s.current_period_end, s.trial_end) + public.unlimited_grace() > now())) desc nulls last,
    s.updated_at desc,
    s.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'none', 'unlimited', false, 'trial_end', null, 'current_period_end', null,
      'cancel_at_period_end', false, 'cancel_at', null, 'repeat_trial', false, 'checkout_ref', v_ref
    );
  end if;
  return jsonb_build_object(
    'status',               v_row.status,
    'unlimited',            public.has_unlimited(p_uid),
    'trial_end',            v_row.trial_end,
    'current_period_end',   v_row.current_period_end,
    'cancel_at_period_end', v_row.cancel_at_period_end,
    'cancel_at',            v_row.cancel_at,
    'repeat_trial',         coalesce(v_row.status = 'trialing' and public.unlimited_earlier_plan(v_owner, v_row.id), false),
    'checkout_ref',         v_ref
  );
end;
$$;
revoke all on function public.unlimited_state_of(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. delete_own_account: the kids go first; a kid cannot delete themself
-- -----------------------------------------------------------------------------
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.family_members m where m.child_id = v_uid) then
    raise exception 'Ask your grown-up to remove this profile.'
      using errcode = 'P0001', hint = 'family_kid';
  end if;
  if exists (
    select 1 from public.unlimited_subscriptions s
    where s.user_id = v_uid
      and s.status in ('trialing', 'active', 'past_due', 'unpaid')
      and not s.cancel_at_period_end
      and s.cancel_at is null
  ) then
    raise exception 'Cancel Agathon Unlimited before deleting your account, so you are not charged again.'
      using errcode = 'P0001', hint = 'unlimited_active';
  end if;
  -- The kids' accounts first: each kid's boards, learning record and the rest cascade from their
  -- auth user. (Their saved images are removed by DELETE /api/family before this is called.)
  delete from auth.users u
  where u.id in (select m.child_id from public.family_members m where m.parent_id = v_uid);
  delete from auth.users where id = v_uid;
end;
$$;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. The PIN's budget, per family
-- -----------------------------------------------------------------------------
-- A copy of rate_limit_hit() (20260917030000_refunds_ratelimit.sql) whose key is the grown-up's id
-- from the server instead of auth.uid(): a kid trying PINs and their sibling trying PINs share one
-- budget. The answer adds `window_start`, which family_pin_forgive() takes back.
create or replace function public.family_pin_attempt(p_parent uuid, p_limit integer, p_window_ms integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_now_ms bigint;
  v_start_ms bigint;
  v_window_start timestamptz;
  v_expires_at timestamptz;
  v_hits integer;
  v_allowed boolean;
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

  v_now_ms       := floor(extract(epoch from now()) * 1000)::bigint;
  v_start_ms     := v_now_ms - (v_now_ms % p_window_ms);
  v_window_start := to_timestamp(v_start_ms / 1000.0);
  v_expires_at   := to_timestamp((v_start_ms + 2::bigint * p_window_ms) / 1000.0);

  delete from public.rate_limit_counters c
  where c.user_id = p_parent and c.bucket = 'family_pin' and c.expires_at <= now();

  insert into public.rate_limit_counters (user_id, bucket, window_start, hits, expires_at)
  values (p_parent, 'family_pin', v_window_start, 1, v_expires_at)
  on conflict (user_id, bucket, window_start)
    do update set hits = public.rate_limit_counters.hits + 1
  returning hits into v_hits;

  v_allowed := v_hits <= p_limit;

  return jsonb_build_object(
    'allowed',        v_allowed,
    'remaining',      greatest(0, p_limit - v_hits),
    'retry_after_ms', case when v_allowed then 0 else (v_start_ms + p_window_ms - v_now_ms)::integer end,
    'window_start',   v_window_start,
    'backend',        'db'
  );
end;
$$;
revoke all on function public.family_pin_attempt(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.family_pin_attempt(uuid, integer, integer) to service_role;

-- The PIN was right: that try does not count against the family.
create or replace function public.family_pin_forgive(p_parent uuid, p_window_start timestamptz)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.rate_limit_counters c
     set hits = greatest(0, c.hits - 1)
   where c.user_id = p_parent and c.bucket = 'family_pin' and c.window_start = p_window_start
$$;
revoke all on function public.family_pin_forgive(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.family_pin_forgive(uuid, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 6. A family's shape, whatever calls race
-- -----------------------------------------------------------------------------
-- A grown-up is never someone's kid (and a kid never a grown-up): a kid's account has no plan of its
-- own and must not gain kids of its own.
create or replace function public.families_parent_not_kid()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.family_members m where m.child_id = new.parent_id) then
    raise exception 'a kid profile cannot have kids' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.families_parent_not_kid() from public, anon, authenticated;

drop trigger if exists families_parent_not_kid on public.families;
create trigger families_parent_not_kid
  before insert or update of parent_id on public.families
  for each row execute function public.families_parent_not_kid();

-- A kid is never a grown-up, and a family has at most 6 kids (MAX_KIDS in
-- src/lib/family/contracts.ts). The family's row is locked first, so two adds at once count each
-- other.
create or replace function public.family_members_shape()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.families f where f.parent_id = new.child_id) then
    raise exception 'a grown-up cannot be a kid profile' using errcode = '23514';
  end if;
  perform 1 from public.families f where f.parent_id = new.parent_id for update;
  if (select count(*) from public.family_members m where m.parent_id = new.parent_id and m.child_id <> new.child_id) >= 6 then
    raise exception 'a family has at most 6 kids' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.family_members_shape() from public, anon, authenticated;

drop trigger if exists family_members_shape on public.family_members;
create trigger family_members_shape
  before insert or update of child_id, parent_id on public.family_members
  for each row execute function public.family_members_shape();

-- PostgREST caches the schema; the new functions need a reload.
notify pgrst, 'reload schema';
