-- =============================================================================
-- Referral hardening (2026-10-09, Phase 2 review). Idempotent; replaces four functions of
-- 20261009110000_referrals.sql (which it needs), adds one trigger, and repairs the rows the old rules
-- got wrong. docs/RUNBOOK-billing.md section 15; src/lib/referral/admin.ts mirrors the reward rule.
--
-- 1. 'paid' came too early. A referral became 'paid' (reward due) when the friend's subscription
--    turned 'active'. Stripe sets 'active' when the trial ends, about an hour BEFORE it tries the
--    first charge, so a card that then declined left the plan past_due and the referral 'paid' for
--    good: a free month for every throwaway account. 'active' is still how a referral reaches
--    'paid' (the webhook has no invoice events), but it is no longer final, and no longer enough:
--      referrals_follow_plan()   also moves a 'paid' referral BACK to 'trialing' (paid_at cleared)
--                                when the friend's subscription goes past_due, unpaid, canceled,
--                                incomplete_expired or paused, unless another of the friend's
--                                subscriptions is active. A plan that recovers (a retry is paid:
--                                'active' again) makes it 'paid' again, dated anew. 'rewarded' and
--                                'void' are never touched.
--      admin_referral_mark()     'rewarded' also needs the friend's plan 'active' and settled: now at
--                                least 3 days past the later of the plan's trial end and the
--                                referral's paid_at, so Stripe's first charge and its first retries
--                                have played out. Otherwise P0001, hint `referral_unsettled`.
--                                (The console's own guard: rewardGate(), REFERRAL_SETTLE_DAYS.)
--      referral_entry()          the friend's plan is their active subscription when they have one,
--                                else their latest, and the answer carries its trial end
--                                (referred.trial_end) so the console can say when a reward may be
--                                given.
--    Even so, 'paid' is "the plan is active", not "Stripe was paid": the runbook's reward steps
--    check the first non-zero invoice in Stripe before the credit.
-- 2. Late attach. save_attribution() is callable while the account's attribution is null, at any
--    age, and the referral started at the friend's plan's state. So an existing (even paying)
--    customer could be "referred" weeks later, born 'paid', or claim the friend's 30-day link late.
--    profiles_record_referral() now records a referral only for an account made within 24 hours
--    of the save that has no unlimited_subscriptions row yet, and the row always starts at
--    'signed_up' (the plan then moves it). Otherwise the `ref` is stripped from the attribution, as
--    for any ref that records nothing. referral_plan_status() is no longer used (left in place,
--    still uncallable).
-- 3. A void left the ref. Trigger referrals_strip_ref (AFTER UPDATE OF status OR DELETE ON
--    referrals) removes `ref` from the friend's profiles.attribution when their referral is voided
--    or deleted (by hand, or by the cascade when the referrer's account is deleted), so the plan
--    screen stops offering the friend's free-month link (useReferred reads that ref).
-- 4. Repairs (each a no-op the second time): a 'paid' referral whose friend has no active
--    subscription goes back to 'trialing'; a `ref` with no live (non-void) referral behind it is
--    stripped.
--
-- Who may call what is unchanged: the admin functions are the service role's, the rest internal.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Recording: a new account only, and always from the start
-- -----------------------------------------------------------------------------
-- Same as 20261009110000_referrals.sql except the two new conditions (made within 24 hours, no
-- plan yet) and the row's start ('signed_up', never the plan's current state).
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
         -- a new account: the save follows the sign-up within a day, before any plan
         and v_created > now() - interval '24 hours'
         and not exists (select 1 from public.unlimited_subscriptions s where s.user_id = new.user_id)
         and not public.referral_is_kid(new.user_id)
         and not public.referral_is_kid(v_referrer)
      then
        insert into public.referrals (referrer_id, referred_id, code, status, paid_at)
        values (v_referrer, new.user_id, v_code, 'signed_up', null)
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

-- -----------------------------------------------------------------------------
-- 2. Following the friend's plan: back to 'trialing' when the charge fails
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
  begin
    if new.status in ('past_due', 'unpaid', 'canceled', 'incomplete_expired', 'paused') then
      -- the first charge failed, or the plan stopped: not paid after all (unless another of the
      -- friend's plans is active). Rewarded and void rows are final.
      update public.referrals r
         set status = 'trialing',
             paid_at = null
       where r.referred_id = new.user_id
         and r.status = 'paid'
         and not exists (select 1 from public.unlimited_subscriptions s
                          where s.user_id = new.user_id and s.id <> new.id and s.status = 'active');
      return null;
    end if;

    v_next := case new.status when 'active' then 'paid' when 'trialing' then 'trialing' else null end;
    if v_next is null then
      return null;
    end if;
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

-- (the trigger unlimited_subscriptions_referral is unchanged: it calls the function by name)

-- -----------------------------------------------------------------------------
-- 3. A voided or deleted referral takes the friend's ref with it
-- -----------------------------------------------------------------------------
create or replace function public.referrals_strip_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- the cascade from a deleted account must never fail on this
    begin
      update public.profiles p
         set attribution = p.attribution - 'ref'
       where p.user_id = old.referred_id
         and jsonb_typeof(p.attribution) = 'object'
         and p.attribution ? 'ref';
    exception when others then
      raise warning 'referral ref not cleared for %: % (%)', old.referred_id, sqlerrm, sqlstate;
    end;
  elsif new.status = 'void' and old.status is distinct from 'void' then
    update public.profiles p
       set attribution = p.attribution - 'ref'
     where p.user_id = new.referred_id
       and jsonb_typeof(p.attribution) = 'object'
       and p.attribution ? 'ref';
  end if;
  return null;
end;
$$;
revoke all on function public.referrals_strip_ref() from public, anon, authenticated;

drop trigger if exists referrals_strip_ref on public.referrals;
create trigger referrals_strip_ref
  after update of status or delete on public.referrals
  for each row execute function public.referrals_strip_ref();

-- -----------------------------------------------------------------------------
-- 4. The admin console: the friend's plan and its trial end; a reward only once settled
-- -----------------------------------------------------------------------------
-- Same as 20261009110000_referrals.sql except the friend's plan (`fp`): their active subscription
-- when there is one, else the latest, with its trial end.
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
             'plan_status', fp.status,
             'trial_end', fp.trial_end
           )
         )
    from public.referrals r
    left join lateral (
      select s.status, s.trial_end
        from public.unlimited_subscriptions s
       where s.user_id = r.referred_id
       order by coalesce(s.status = 'active', false) desc, s.updated_at desc, s.id desc
       limit 1
    ) fp on true
   where r.id = p_id
$$;
revoke all on function public.referral_entry(bigint) from public, anon, authenticated;

-- Same as 20261009110000_referrals.sql except the reward's two new conditions: the friend's plan
-- (as referral_entry picks it) is 'active', and it is at least 3 days past the later of its trial
-- end and the referral's paid_at.
create or replace function public.admin_referral_mark(p_id bigint, p_status text, p_admin uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_from text;
  v_referred uuid;
  v_paid_at timestamptz;
  v_plan text;
  v_trial_end timestamptz;
  v_settled_at timestamptz;
begin
  if p_status is null or p_status not in ('rewarded', 'void') then
    raise exception 'p_status must be rewarded or void' using errcode = '22023';
  end if;
  if p_admin is null then
    raise exception 'p_admin is required' using errcode = '22023';
  end if;

  select r.status, r.referred_id, r.paid_at into v_from, v_referred, v_paid_at
    from public.referrals r where r.id = p_id for update;
  if not found then
    raise exception 'No referral has that id.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if (p_status = 'rewarded' and v_from <> 'paid')
     or (p_status = 'void' and v_from not in ('signed_up', 'trialing', 'paid')) then
    raise exception 'This referral is %, so it cannot be marked %.', v_from, p_status
      using errcode = 'P0001', hint = 'referral_state';
  end if;

  if p_status = 'rewarded' then
    select s.status, s.trial_end into v_plan, v_trial_end
      from public.unlimited_subscriptions s
     where s.user_id = v_referred
     order by coalesce(s.status = 'active', false) desc, s.updated_at desc, s.id desc
     limit 1;
    if v_plan is distinct from 'active' then
      raise exception 'The friend''s plan is %, not active, so nothing is owed yet.', coalesce(v_plan, 'missing')
        using errcode = 'P0001', hint = 'referral_unsettled';
    end if;
    v_settled_at := greatest(v_paid_at, v_trial_end) + interval '3 days';
    if v_settled_at is null or now() < v_settled_at then
      raise exception 'The friend''s first payment may still fail: reward from %.',
        coalesce(to_char(v_settled_at at time zone 'UTC', 'Mon FMDD, HH24:MI "UTC"'), 'once it is paid')
        using errcode = 'P0001', hint = 'referral_unsettled';
    end if;
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

-- -----------------------------------------------------------------------------
-- 5. Repairs
-- -----------------------------------------------------------------------------
-- 'paid' while the friend has no active plan: the first charge failed (or the plan stopped)
update public.referrals r
   set status = 'trialing',
       paid_at = null
 where r.status = 'paid'
   and not exists (select 1 from public.unlimited_subscriptions s where s.user_id = r.referred_id and s.status = 'active');

-- a ref with no live referral behind it (voided, or deleted with the referrer's account) offers a
-- free month nobody owes
update public.profiles p
   set attribution = p.attribution - 'ref'
 where jsonb_typeof(p.attribution) = 'object'
   and p.attribution ? 'ref'
   and not exists (select 1 from public.referrals r where r.referred_id = p.user_id and r.status <> 'void');

-- PostgREST caches the schema; the replaced functions need a reload.
notify pgrst, 'reload schema';
