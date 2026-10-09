-- =============================================================================
-- Bug report replies (2026-10-09). Idempotent; additive to 20261008000000_admin_console.sql.
--
-- Report a bug (src/components/BugReportButton.tsx) went one way: a student sent a report and never
-- heard back. Now an admin answers from /admin/bugs, the reporter reads and answers on /reports
-- (src/components/reports), and each side is emailed about the other's message
-- (src/lib/email/bugReply.ts).
--
--   bug_report_messages   one row per message on a report: `author` 'admin' (written by
--                         POST /api/admin/bugs/<id>/messages with the service role, author_id the
--                         admin) or 'reporter' (written only by bug_report_reply(), author_id the
--                         caller). 1 to 4,000 characters with something in them besides white space.
--                         RLS on, NO policy, every privilege revoked from anon and authenticated: a
--                         user reaches it only through the functions below. The rows go with their
--                         report (ON DELETE CASCADE), so with the reporter's account
--                         (20261003010100_bug_reports_leave_with_account.sql); an admin's deleted
--                         account leaves its messages, author_id set null.
--   bug_reports.reporter_seen_at
--                         when the reporter last opened their replies (/reports, or replying); null
--                         until then. An admin message after it is unread.
--   bug_reports_triage()  same as 20261008000000_admin_console.sql, plus: a user's insert cannot set
--                         reporter_seen_at (it would hide their own replies, nothing more, but a
--                         report is filed as nothing but new).
--   admin_bug_rows        same as 20261008000000_admin_console.sql, plus reporter_seen_at (the inbox
--                         says when the reporter last read their replies).
--
-- The reporter's functions: security definer, scoped to auth.uid(), executable by authenticated only.
-- A kid profile is an ordinary auth user (src/lib/family), so a kid reads and answers their own
-- reports like anyone; their grown-up reads them on the kid's profile, not their own.
--   my_bug_reports()      the caller's reports, newest first, at most 100: id, created_at, message,
--                         status, resolved_at, seen_at, unread (admin messages after seen_at) and the
--                         thread as jsonb ([{id, author, body, at}], oldest first). Never the
--                         screenshot, logs, diagnostics, the admin's note, or which admin wrote.
--   bug_report_reply(p_report_id, p_body) -> {id, author, body, at}
--                         a reporter's message on the caller's OWN report. The body is trimmed and
--                         must be 1 to 4,000 characters (22023). Someone else's report and no report
--                         at all are the same P0002 (hint bug_report_missing): nobody learns that
--                         another person's report exists. At most 20 replies per report per 24 hours
--                         (P0001, hint bug_reply_limit): POST /api/bug-reports/<id>/messages has its
--                         own per-minute budget first, and this one holds for a direct call too.
--                         Replying marks the report's replies seen.
--   bug_reports_mark_seen(p_report_id default null) -> integer
--                         reporter_seen_at := now() on the caller's report (null: every one of them)
--                         that has an unread admin message; answers how many were marked.
--   my_bug_unread_count() -> integer
--                         admin messages the caller has not seen, over all their reports (the dot
--                         on the app header's Report a bug).
--
-- Admins write with the service role (src/lib/server/adminConsole/bugReplies.ts): the message, then
-- status new -> seen (other statuses stay), then admin_audit 'bug.reply' with the reply's length,
-- never its words. bug_reports_triage() still files a user's report as new; a service-role write has
-- no auth.uid() and is left alone.
--
-- Deploy order: before the code that reads it. Without it the inbox answers 502 naming
-- bug_report_messages (or admin_bug_rows' missing column), /reports says it could not load, and the
-- header's dot stays off.
--
-- Down: drop functions my_bug_reports(), bug_report_reply(uuid, text), bug_reports_mark_seen(uuid)
-- and my_bug_unread_count(); drop table bug_report_messages; drop view admin_bug_rows and re-create it
-- and bug_reports_triage() from 20261008000000_admin_console.sql (create or replace cannot remove a
-- view's column); alter table bug_reports drop column reporter_seen_at.
--
-- Objects:
--   table       bug_report_messages
--   column      bug_reports.reporter_seen_at
--   constraints bug_report_messages_author_known, bug_report_messages_body_len
--   index       bug_report_messages_report_at_idx
--   view        admin_bug_rows [replaced: + reporter_seen_at; security_invoker, service role only]
--   functions   bug_reports_triage() [trigger, replaced], my_bug_reports(), bug_report_reply(uuid, text),
--               bug_reports_mark_seen(uuid), my_bug_unread_count() [authenticated]
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. bug_report_messages
-- -----------------------------------------------------------------------------
create table if not exists public.bug_report_messages (
  id         uuid        primary key default gen_random_uuid(),
  report_id  uuid        not null references public.bug_reports (id) on delete cascade,
  -- admin | reporter
  author     text        not null,
  author_id  uuid        references auth.users (id) on delete set null,
  body       text        not null,
  created_at timestamptz not null default now()
);

alter table public.bug_report_messages drop constraint if exists bug_report_messages_author_known;
alter table public.bug_report_messages
  add constraint bug_report_messages_author_known check (author in ('admin', 'reporter'));
alter table public.bug_report_messages drop constraint if exists bug_report_messages_body_len;
alter table public.bug_report_messages
  add constraint bug_report_messages_body_len check (char_length(body) between 1 and 4000 and body ~ '\S');

-- A report's thread, oldest first; its unread count.
create index if not exists bug_report_messages_report_at_idx on public.bug_report_messages (report_id, created_at);

alter table public.bug_report_messages enable row level security;
revoke all on public.bug_report_messages from public, anon, authenticated;
grant all on public.bug_report_messages to service_role;

-- -----------------------------------------------------------------------------
-- 2. bug_reports: when the reporter last read their replies
-- -----------------------------------------------------------------------------
alter table public.bug_reports add column if not exists reporter_seen_at timestamptz;

-- Same as 20261008000000_admin_console.sql, plus reporter_seen_at on a user's insert.
create or replace function public.bug_reports_triage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') or auth.uid() is not null then
      new.status := 'new';
      new.admin_note := null;
      new.resolved_at := null;
      new.reporter_seen_at := null;
    end if;
  elsif new.status is distinct from old.status then
    new.resolved_at := case when new.status in ('fixed', 'wontfix') then now() else null end;
  end if;
  return new;
end;
$$;
revoke all on function public.bug_reports_triage() from public, anon, authenticated;

-- Same as 20261008000000_admin_console.sql, plus reporter_seen_at (last, so create or replace can add it).
create or replace view public.admin_bug_rows
with (security_invoker = true)
as
select
  b.id,
  b.created_at,
  b.user_id,
  b.user_email,
  b.board_id,
  b.message,
  b.diagnostics,
  b.logs,
  b.status,
  b.admin_note,
  b.resolved_at,
  (b.screenshot is not null and b.screenshot <> '') as has_screenshot,
  b.reporter_seen_at
from public.bug_reports b;

revoke all on public.admin_bug_rows from public, anon, authenticated;
grant select on public.admin_bug_rows to service_role;

-- -----------------------------------------------------------------------------
-- 3. The reporter's functions
-- -----------------------------------------------------------------------------
create or replace function public.my_bug_reports()
returns table (
  id          uuid,
  created_at  timestamptz,
  message     text,
  status      text,
  resolved_at timestamptz,
  seen_at     timestamptz,
  unread      integer,
  thread      jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.created_at,
    left(coalesce(b.message, ''), 5000),
    b.status,
    b.resolved_at,
    b.reporter_seen_at,
    (select count(*)::integer from public.bug_report_messages m
      where m.report_id = b.id and m.author = 'admin' and m.created_at > coalesce(b.reporter_seen_at, '-infinity')),
    coalesce(
      (select jsonb_agg(jsonb_build_object('id', m.id, 'author', m.author, 'body', m.body, 'at', m.created_at) order by m.created_at, m.id)
         from public.bug_report_messages m where m.report_id = b.id),
      '[]'::jsonb
    )
  from public.bug_reports b
  where b.user_id = auth.uid()
  order by b.created_at desc, b.id desc
  limit 100
$$;
revoke all on function public.my_bug_reports() from public, anon;
grant execute on function public.my_bug_reports() to authenticated;

create or replace function public.bug_report_reply(p_report_id uuid, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := regexp_replace(coalesce(p_body, ''), '^\s+|\s+$', '', 'g');
  v_row public.bug_report_messages%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'a reply is 1 to 4000 characters' using errcode = '22023';
  end if;
  -- The caller's own report, locked: two replies at once count each other against the day's cap.
  perform 1 from public.bug_reports b where b.id = p_report_id and b.user_id = v_uid for update;
  if not found then
    raise exception 'no such bug report' using errcode = 'P0002', hint = 'bug_report_missing';
  end if;
  if (select count(*) from public.bug_report_messages m
       where m.report_id = p_report_id and m.author = 'reporter' and m.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too many replies on this report today' using errcode = 'P0001', hint = 'bug_reply_limit';
  end if;

  insert into public.bug_report_messages (report_id, author, author_id, body)
  values (p_report_id, 'reporter', v_uid, v_body)
  returning * into v_row;

  -- They wrote after reading: everything before it is seen.
  update public.bug_reports b set reporter_seen_at = now() where b.id = p_report_id;

  return jsonb_build_object('id', v_row.id, 'author', v_row.author, 'body', v_row.body, 'at', v_row.created_at);
end;
$$;
revoke all on function public.bug_report_reply(uuid, text) from public, anon;
grant execute on function public.bug_report_reply(uuid, text) to authenticated;

create or replace function public.bug_reports_mark_seen(p_report_id uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_marked integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.bug_reports b
     set reporter_seen_at = now()
   where b.user_id = v_uid
     and (p_report_id is null or b.id = p_report_id)
     and exists (
       select 1 from public.bug_report_messages m
       where m.report_id = b.id and m.author = 'admin' and m.created_at > coalesce(b.reporter_seen_at, '-infinity')
     );
  get diagnostics v_marked = row_count;
  return v_marked;
end;
$$;
revoke all on function public.bug_reports_mark_seen(uuid) from public, anon;
grant execute on function public.bug_reports_mark_seen(uuid) to authenticated;

create or replace function public.my_bug_unread_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.bug_reports b
  join public.bug_report_messages m on m.report_id = b.id
  where b.user_id = auth.uid()
    and m.author = 'admin'
    and m.created_at > coalesce(b.reporter_seen_at, '-infinity')
$$;
revoke all on function public.my_bug_unread_count() from public, anon;
grant execute on function public.my_bug_unread_count() to authenticated;

-- PostgREST caches the schema; the new table, column and RPCs need a reload.
notify pgrst, 'reload schema';
