-- =============================================================================
-- Bug reports: always the reporter's own, with the reporter's own address (security audit,
-- 2026-10-03). Idempotent.
--
-- Two gaps in "bug_reports: authenticated insert own" (20260911000000_init.sql):
--   1. `with check (user_id is null or user_id = auth.uid())`: a signed-in user could file a report
--      with NO user id. Such a report is nobody's, so it never leaves with an account
--      (20261003010100 made reports cascade on delete_own_account()), and it can carry any email.
--      The app always sends its user id (src/components/BugReportButton.tsx); only a hand-made
--      request sends null.
--   2. `user_email` was whatever the client sent, so anyone could file reports "from" another
--      person's address, and the owner answering a report would write to that stranger.
--
-- Now a report must carry the caller's own user id, and a BEFORE INSERT trigger stamps the
-- address from the caller's verified JWT over whatever was sent (null when the token has none).
-- Inserts without a user JWT (the service role, SQL) are left as they are.
-- scripts/lib/rlsChecks.mjs (checkBugReports) proves both.
-- =============================================================================

drop policy if exists "bug_reports: authenticated insert own" on public.bug_reports;
create policy "bug_reports: authenticated insert own"
  on public.bug_reports for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create or replace function public.bug_reports_stamp_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.user_email := nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), '');
  end if;
  return new;
end;
$$;
revoke all on function public.bug_reports_stamp_email() from public, anon, authenticated;

drop trigger if exists bug_reports_stamp_email on public.bug_reports;
create trigger bug_reports_stamp_email
  before insert on public.bug_reports
  for each row execute function public.bug_reports_stamp_email();
