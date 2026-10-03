-- =============================================================================
-- Bug reports leave with the account (2026-10-03). Idempotent.
--
-- A bug report (src/components/BugReportButton.tsx) holds the reporter's account email, their
-- message, a screenshot of their board, recent app logs and browser details: all of it personal.
-- bug_reports.user_id was ON DELETE SET NULL (20260911000000_init.sql), so deleting an account
-- (Delete account -> delete_own_account(), or the dashboard) kept every report, email included.
--
-- Now ON DELETE CASCADE: an account's reports are deleted with it, in the same transaction.
-- Reports already orphaned by an account deleted before this migration (user_id null, an email
-- still on them) are deleted here too. A report always carries both or neither (the client sends
-- user_id and user_email together), so an orphan with an email can only be a deleted account's.
--
-- The privacy policy (src/app/(platform)/privacy/page.tsx, "How long we keep it") says so.
--
-- Deploy order: with 20261003010000, after the frontend deploy (RUNBOOK-billing section 7, step 5).
-- The code does not need it: until then a deleted account's reports simply stay, as before.
--
-- Objects: constraint bug_reports_user_id_fkey replaced (on delete cascade).
-- =============================================================================

delete from public.bug_reports where user_id is null and user_email is not null;

alter table public.bug_reports drop constraint if exists bug_reports_user_id_fkey;
alter table public.bug_reports
  add constraint bug_reports_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;
