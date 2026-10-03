-- =============================================================================
-- Email log (2026-10-03). Idempotent; additive (nothing else changes).
--
-- Agathon sends two transactional emails through Resend (src/lib/email):
--   welcome          once per account, after the student finishes onboarding
--                    (POST /api/email/welcome, ref '')
--   trial_reminder   once per Agathon Unlimited subscription, about two days before its free
--                    week ends and the card is charged (GET /api/cron/trial-reminders, daily;
--                    ref = the Stripe subscription id)
-- This table is how each goes out at most once. One row per (user_id, kind, ref), unique, and the
-- server writes it in three steps (src/lib/email/log.ts, sendOnce):
--   1. claim   insert (user_id, kind, ref); a second claim of the same email hits the unique key
--              (23505) and sends nothing: two tabs, two cron runs, two server instances
--   2. send    through Resend
--   3. record  resend_id and sent_at on the claimed row
-- A failed send deletes its claim again (only a row with no resend_id), so a later attempt
-- retries. A row with sent_at null is a claim whose send never finished being recorded (the
-- process died in between): it still counts as sent; docs/RUNBOOK-ops.md ("Email") says how to
-- check Resend and resend.
--
-- Service role only: RLS on and NO policy, every privilege revoked from anon and authenticated.
-- A user who could read it would learn which emails went to whom; one who could insert would stop
-- their own emails (a forged "already sent"), and one who could delete would get them again.
--
-- Personal data: none beyond the user id (the address lives in auth.users; Resend's id finds the
-- message in Resend). The rows go with the account (ON DELETE CASCADE), like bug reports
-- (20261003010100_bug_reports_leave_with_account.sql).
--
-- `kind` is a format, not a list, so a new email needs no migration: lower-case snake_case, as
-- EmailKind in src/lib/email/log.ts names them.
--
-- Deploy order: any time before the code that sends (the routes answer 500 without the table,
-- and nothing is sent). The current code never touches it.
--
-- Supabase's default privileges grant ALL on every new public table to anon, authenticated and
-- service_role, so the table revokes first and grants the service role alone.
--
-- Objects:
--   table    email_log
--   indexes  email_log_once (unique: user_id, kind, ref), email_log_kind_ref_idx
-- =============================================================================

create table if not exists public.email_log (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  kind        text        not null check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- what the email is about, '' for once-per-account emails (welcome)
  ref         text        not null default '' check (char_length(ref) <= 255),
  -- Resend's email id, once the send is recorded
  resend_id   text        check (resend_id is null or char_length(resend_id) between 1 and 255),
  claimed_at  timestamptz not null default now(),
  sent_at     timestamptz,
  constraint email_log_sent_together check ((resend_id is null) = (sent_at is null))
);

-- The once-only key the claim depends on.
create unique index if not exists email_log_once on public.email_log (user_id, kind, ref);
-- The cron's first pass: which of today's subscriptions were already reminded.
create index if not exists email_log_kind_ref_idx on public.email_log (kind, ref);

alter table public.email_log enable row level security;

-- No policies on purpose: nothing but the service role (which bypasses RLS) may read or write.
revoke all on public.email_log from public, anon, authenticated;
grant all on public.email_log to service_role;

notify pgrst, 'reload schema';
