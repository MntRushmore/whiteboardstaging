-- =============================================================================
-- Parents recommend it (2026-10-09, Phase 2). Idempotent; additive. docs/KIDS-COME-BACK.md.
--
-- The shared schema of Phase 2; each part's functions come in its own migration
-- (20261009110000_referrals.sql, 20261009120000_weekly_report.sql, 20261009130000_annual.sql):
--
--   profiles.referral_code          a grown-up's code for "Give a month, get a month"
--                                   (src/lib/referral/contracts.ts REFERRAL_CODE_PATTERN), unique,
--                                   made on first ask by the referral part's RPC; never writable by
--                                   the client.
--   profiles.weekly_report_opt_out  true stops the weekly report email (src/lib/report); written by
--                                   the signed unsubscribe link's route and the report page (service
--                                   role or the report part's RPC).
--   referrals                       one row per referred account: who referred it, with which code,
--                                   and how far it got (signed_up, trialing, paid, rewarded, void).
--                                   The referrer reads their own rows' status and dates (never the
--                                   referred account's id is shown to them); writes are server-side.
--   unlimited_subscriptions.billing_interval
--                                   'month' or 'year' (the yearly family plan), written by the
--                                   Stripe webhook from the subscription's price; null on rows from
--                                   before it (all monthly).
-- =============================================================================

alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists weekly_report_opt_out boolean not null default false;

alter table public.profiles drop constraint if exists profiles_referral_code_shape;
alter table public.profiles add constraint profiles_referral_code_shape
  check (referral_code is null or referral_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6,10}$');
create unique index if not exists profiles_referral_code_key on public.profiles (referral_code) where referral_code is not null;

create table if not exists public.referrals (
  id           bigint generated always as identity primary key,
  referrer_id  uuid not null references auth.users (id) on delete cascade,
  -- one referral per account, ever (the first code saved wins)
  referred_id  uuid not null unique references auth.users (id) on delete cascade,
  code         text not null check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6,10}$'),
  status       text not null default 'signed_up' check (status in ('signed_up', 'trialing', 'paid', 'rewarded', 'void')),
  paid_at      timestamptz,
  rewarded_at  timestamptz,
  -- the admin who marked it rewarded (null once that admin's account is gone)
  rewarded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (referrer_id <> referred_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);

alter table public.referrals enable row level security;
revoke all on public.referrals from public, anon, authenticated;
grant select (id, referrer_id, code, status, paid_at, rewarded_at, created_at) on public.referrals to authenticated;
grant all on public.referrals to service_role;

drop policy if exists "referrals: referrer select" on public.referrals;
create policy "referrals: referrer select"
  on public.referrals for select to authenticated
  using (referrer_id = auth.uid());

alter table public.unlimited_subscriptions add column if not exists billing_interval text;
alter table public.unlimited_subscriptions drop constraint if exists unlimited_subscriptions_interval_known;
alter table public.unlimited_subscriptions add constraint unlimited_subscriptions_interval_known
  check (billing_interval is null or billing_interval in ('month', 'year'));

notify pgrst, 'reload schema';
