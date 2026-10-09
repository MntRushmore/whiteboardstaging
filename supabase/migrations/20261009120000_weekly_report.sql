-- =============================================================================
-- The weekly parent report (2026-10-09, Phase 2). Idempotent; additive. docs/KIDS-COME-BACK.md,
-- src/lib/report.
--
-- profiles.weekly_report_opt_out (20261009100000_parents_recommend.sql) stops the Sunday email. The
-- client may read it (the owner's select grant) but not write it (profiles' update grant is
-- display_name only), so the report page's "Email me this" toggle writes it through this function:
--
--   set_weekly_report_opt_out(p_opt_out boolean) -> boolean
--       The caller's own row only (auth.uid()); refused for a kid profile (a family_members child:
--       the email goes to the grown-up, never to a kid). Answers the value now stored.
--
-- The email's one-tap unsubscribe link writes the same column with the service role
-- (GET /api/report/unsubscribe, signed with CRON_SECRET), and only ever to true.
-- =============================================================================

create or replace function public.set_weekly_report_opt_out(p_opt_out boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_value boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_opt_out is null then
    raise exception 'p_opt_out must be true or false' using errcode = '22023';
  end if;
  if exists (select 1 from public.family_members m where m.child_id = v_uid) then
    raise exception 'a kid profile has no weekly email' using errcode = '42501';
  end if;

  update public.profiles
     set weekly_report_opt_out = p_opt_out
   where user_id = v_uid
  returning weekly_report_opt_out into v_value;
  if not found then
    raise exception 'no profile for the caller' using errcode = 'P0002';
  end if;
  return v_value;
end;
$$;

revoke all on function public.set_weekly_report_opt_out(boolean) from public, anon;
grant execute on function public.set_weekly_report_opt_out(boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
