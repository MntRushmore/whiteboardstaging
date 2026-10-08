-- =============================================================================
-- The admin console (2026-10-08). Idempotent; additive to 20261005000000_admin.sql.
--
-- /admin grows from one overview page into a console (src/lib/admin/contracts.ts, "the admin
-- console"): who uses Agathon (users, one page per user), their boards (a read-only viewer and a
-- replay), what they reported (a bug inbox with screenshots) and what broke (issues: error groups
-- an admin can mute or mark fixed). The console's API routes (src/app/api/admin/*, behind
-- requireAdmin) read and write these objects with the service role; no user ever can.
--
--   admin_audit       one row per time an admin LOOKS at a student's content or CHANGES the
--                     console's state: a board opened in the viewer ('board.view', every read that
--                     returns its snapshot), a bug screenshot opened ('bug.screenshot'), a user's page
--                     ('user.view') or a page of board thumbnails ('boards.list') read, a bug report
--                     triaged ('bug.update'), an issue muted or marked fixed ('issue.update'). The
--                     privacy policy says staff may look at a student's boards and bug reports to fix
--                     problems and improve the tutor and that each look is logged: this is that log.
--                     The routes write the row BEFORE they answer with the content, and answer 503
--                     when it cannot be written (no look goes unlogged). Kept 180 days
--                     (prune_admin_rows()). `admin_id` is set null if the admin's account is deleted;
--                     `target_id` is text with no foreign key, so the record of a look outlives the
--                     board or account looked at (it names an id, never content).
--   bug_reports       + status (new | seen | fixed | wontfix, default new), admin_note (<= 2000
--                     chars), resolved_at (set by a trigger when the status becomes fixed or wontfix,
--                     cleared when it goes back). A student still inserts their own report and still
--                     cannot read any (20261003100100_bug_reports_own_only.sql is unchanged); the new
--                     trigger forces status 'new' and no note or resolved_at on an insert made with a
--                     user's token, so a student cannot file a report already "fixed" or with a note
--                     of their own, and they have no UPDATE privilege to change it later.
--   admin_issues      the state of an issue (app_events grouped by issueFingerprint(kind, code,
--                     message), src/lib/admin/contracts.ts): open, muted (hidden from the inbox and
--                     from the error-spike alert's count) or fixed (hidden until an event arrives
--                     after fixed_at: then it is a regression), with a note. One row per fingerprint
--                     an admin has touched; no row reads as open.
--   admin_board_rows  a view: whiteboards without their `data`, plus the stored size of `data`
--                     (pg_column_size, which reads the TOAST pointer and never the 8 MB value) and
--                     how many learning attempts point at the board. The board list and pages read
--                     it; the viewer reads `data` itself from whiteboards.
--   admin_bug_rows    a view: bug_reports without the screenshot (a data URL of up to a few MB),
--                     plus whether there is one. The bug inbox reads it; the screenshot route reads
--                     the one screenshot it serves from bug_reports.
--   admin_user_stats(p_since, p_user)  per account (profiles): boards and the latest save, learning
--                     attempts since p_since and how many were solved alone (first_try,
--                     self_corrected: INDEPENDENT_OUTCOMES), the latest attempt's update, metered AI
--                     calls since p_since (usage_events + unlimited_usage: an Unlimited subscriber's
--                     calls go to the latter) and the latest one, bug reports. Each figure is an
--                     index probe per account, so the users list costs one call however many rows
--                     the tables hold (PostgREST cannot aggregate; reading the rows would stop at
--                     the row caps). p_user narrows it to one account (the user page).
--   admin_user_days(p_user, p_since)   one account's activity per UTC day since p_since: learning
--                     attempts started, AI calls, and boards touched (an attempt on it, created, or
--                     last saved that day). Only days with something in them.
--
-- Who may do what. Every new table and view: RLS on (tables), NO policy, every privilege revoked
-- from anon and authenticated, granted to the service role, like app_events. The views are
-- security_invoker, so even a grant by mistake would still apply the caller's own RLS on the
-- tables underneath. The two functions are security invoker too and executable by the service
-- role alone: they read every account's numbers.
--
-- Indexes for the console's reads (the rest exist: learning_attempts (user_id, started_at desc) and
-- (board_id), usage_events and unlimited_usage (user_id, created_at desc), whiteboard_snapshots
-- (whiteboard_id, version desc), email_log (user_id, kind, ref), unlimited_subscriptions (user_id)):
--   whiteboards_live_idx      (updated_at desc) where deleted_at is null: every board, newest first,
--                             "live now" (saved in the last few minutes), the next page (?before=)
--   app_events_board_at_idx   (board_id, at desc): a board's events (the viewer), errors per board
--   app_events_user_at_idx    (user_id, at desc): a user's latest events and errors this week
--   bug_reports_user_idx      (user_id, created_at desc): a user's reports, and their count per user
--                             (and deleting an account no longer scans the table for its reports)
--
-- Retention: prune_admin_rows() (called daily by the health run) also deletes admin_audit rows
-- older than 180 days, and answers {"app_events", "health_checks", "admin_audit"} counts.
--
-- Deploy order: before the code that reads it. Without it the console's routes answer 502 naming
-- the missing object, and the content routes 503 (the audit row cannot be written); the overview,
-- the health run and the alerts keep working (the alerts read admin_issues for muted issues and
-- count everything when it is missing).
--
-- Objects:
--   tables      admin_audit, admin_issues
--   columns     bug_reports.status, bug_reports.admin_note, bug_reports.resolved_at
--   constraints admin_audit_action_format, admin_audit_target_kind_format, admin_audit_target_id_len,
--               admin_audit_meta_object, admin_issues_fingerprint_len, admin_issues_status_known,
--               admin_issues_note_len, admin_issues_fixed_at_with_status, bug_reports_status_known,
--               bug_reports_admin_note_len
--   indexes     admin_audit_at_idx, admin_audit_target_idx, whiteboards_live_idx,
--               app_events_board_at_idx, app_events_user_at_idx, bug_reports_user_idx
--   views       admin_board_rows, admin_bug_rows [security_invoker, service role only]
--   functions   bug_reports_triage() [trigger], admin_user_stats(timestamptz, uuid),
--               admin_user_days(uuid, timestamptz) [service role], prune_admin_rows() replaced
--   triggers    bug_reports_triage (before insert or update on bug_reports)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. admin_audit: every look at a student's content, and every change an admin makes
-- -----------------------------------------------------------------------------
create table if not exists public.admin_audit (
  id          bigint      generated always as identity primary key,
  at          timestamptz not null default now(),
  admin_id    uuid        references auth.users (id) on delete set null,
  -- `<what>.<verb>`: board.view, bug.screenshot, bug.update, issue.update, user.view, boards.list
  action      text        not null,
  -- user | board | bug | issue
  target_kind text,
  -- a uuid, or an issue's fingerprint (up to 400 characters)
  target_id   text,
  -- small detail (the board's version, the new status); never student content
  meta        jsonb,
  constraint admin_audit_action_format check (action ~ '^[a-z][a-z_]{0,31}\.[a-z][a-z_]{0,31}$'),
  constraint admin_audit_target_kind_format check (target_kind is null or target_kind ~ '^[a-z][a-z_]{0,31}$'),
  constraint admin_audit_target_id_len check (target_id is null or char_length(target_id) <= 400),
  constraint admin_audit_meta_object check (meta is null or (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 4096))
);

-- The latest looks; the prune.
create index if not exists admin_audit_at_idx on public.admin_audit (at desc);
-- Who looked at this board / bug / user, newest first.
create index if not exists admin_audit_target_idx on public.admin_audit (target_kind, target_id, at desc);

alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from public, anon, authenticated;
grant all on public.admin_audit to service_role;

-- -----------------------------------------------------------------------------
-- 2. bug_reports: triage
-- -----------------------------------------------------------------------------
alter table public.bug_reports add column if not exists status text not null default 'new';
alter table public.bug_reports add column if not exists admin_note text;
alter table public.bug_reports add column if not exists resolved_at timestamptz;

alter table public.bug_reports drop constraint if exists bug_reports_status_known;
alter table public.bug_reports
  add constraint bug_reports_status_known check (status in ('new', 'seen', 'fixed', 'wontfix'));
alter table public.bug_reports drop constraint if exists bug_reports_admin_note_len;
alter table public.bug_reports
  add constraint bug_reports_admin_note_len check (admin_note is null or char_length(admin_note) <= 2000);

-- A report a student files is always new, with no note: whatever the insert sent (a user's token:
-- the role is authenticated, or auth.uid() is set). The service role and SQL insert as they like.
-- On an update (the service role only: users have no UPDATE privilege), resolved_at follows the
-- status: set when it becomes fixed or wontfix, cleared when it goes back to new or seen.
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
    end if;
  elsif new.status is distinct from old.status then
    new.resolved_at := case when new.status in ('fixed', 'wontfix') then now() else null end;
  end if;
  return new;
end;
$$;
revoke all on function public.bug_reports_triage() from public, anon, authenticated;

drop trigger if exists bug_reports_triage on public.bug_reports;
create trigger bug_reports_triage
  before insert or update on public.bug_reports
  for each row execute function public.bug_reports_triage();

-- A user's reports (the user page, the count per user), and deleting an account (the reports
-- cascade with it: 20261003010100) without a scan of the table.
create index if not exists bug_reports_user_idx on public.bug_reports (user_id, created_at desc) where user_id is not null;

-- -----------------------------------------------------------------------------
-- 3. admin_issues: open, muted or fixed
-- -----------------------------------------------------------------------------
create table if not exists public.admin_issues (
  -- issueFingerprint(kind, code, message): `<kind>|<code>|<message, digits as #>`
  fingerprint text        primary key,
  status      text        not null default 'open',
  note        text,
  -- when it was marked fixed (an event after it is a regression); null unless fixed
  fixed_at    timestamptz,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users (id) on delete set null,
  constraint admin_issues_fingerprint_len check (char_length(fingerprint) between 1 and 400),
  constraint admin_issues_status_known check (status in ('open', 'muted', 'fixed')),
  constraint admin_issues_note_len check (note is null or char_length(note) <= 2000),
  constraint admin_issues_fixed_at_with_status check ((status = 'fixed') = (fixed_at is not null))
);

alter table public.admin_issues enable row level security;
revoke all on public.admin_issues from public, anon, authenticated;
grant all on public.admin_issues to service_role;

-- -----------------------------------------------------------------------------
-- 4. Indexes for the console's reads
-- -----------------------------------------------------------------------------
create index if not exists whiteboards_live_idx on public.whiteboards (updated_at desc) where deleted_at is null;
create index if not exists app_events_board_at_idx on public.app_events (board_id, at desc) where board_id is not null;
create index if not exists app_events_user_at_idx on public.app_events (user_id, at desc) where user_id is not null;

-- -----------------------------------------------------------------------------
-- 5. Views: boards without their data, bug reports without their screenshot
-- -----------------------------------------------------------------------------
create or replace view public.admin_board_rows
with (security_invoker = true)
as
select
  w.id,
  w.user_id,
  w.title,
  w.preview,
  w.created_at,
  w.updated_at,
  w.version,
  w.deleted_at,
  pg_column_size(w.data)::bigint as size_bytes,
  (select count(*) from public.learning_attempts la where la.board_id = w.id)::integer as attempts
from public.whiteboards w;

revoke all on public.admin_board_rows from public, anon, authenticated;
grant select on public.admin_board_rows to service_role;

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
  (b.screenshot is not null and b.screenshot <> '') as has_screenshot
from public.bug_reports b;

revoke all on public.admin_bug_rows from public, anon, authenticated;
grant select on public.admin_bug_rows to service_role;

-- -----------------------------------------------------------------------------
-- 6. Per-account numbers for the users list and a user's page
-- -----------------------------------------------------------------------------
create or replace function public.admin_user_stats(p_since timestamptz, p_user uuid default null)
returns table (
  user_id         uuid,
  boards          integer,
  last_board_at   timestamptz,
  attempts        integer,
  solved_alone    integer,
  last_attempt_at timestamptz,
  ai_calls        integer,
  last_ai_at      timestamptz,
  bug_reports     integer
)
language sql
stable
set search_path = public
as $$
  select
    p.user_id,
    coalesce(b.n, 0),
    b.last_at,
    coalesce(a.n, 0),
    coalesce(a.alone, 0),
    -- the latest attempt's last update (the latest started: an index probe, not a scan)
    (select la.updated_at from public.learning_attempts la where la.user_id = p.user_id order by la.started_at desc limit 1),
    coalesce(u.n, 0) + coalesce(ul.n, 0),
    greatest(
      (select ue.created_at from public.usage_events ue where ue.user_id = p.user_id order by ue.created_at desc limit 1),
      (select uu.created_at from public.unlimited_usage uu where uu.user_id = p.user_id order by uu.created_at desc limit 1)
    ),
    coalesce(r.n, 0)
  from public.profiles p
  left join lateral (
    select count(*) filter (where w.deleted_at is null)::integer as n, max(w.updated_at) as last_at
    from public.whiteboards w where w.user_id = p.user_id
  ) b on true
  left join lateral (
    select count(*)::integer as n, count(*) filter (where la.outcome in ('first_try', 'self_corrected'))::integer as alone
    from public.learning_attempts la where la.user_id = p.user_id and la.started_at >= p_since
  ) a on true
  left join lateral (
    select count(*)::integer as n from public.usage_events ue where ue.user_id = p.user_id and ue.created_at >= p_since
  ) u on true
  left join lateral (
    select count(*)::integer as n from public.unlimited_usage uu where uu.user_id = p.user_id and uu.created_at >= p_since
  ) ul on true
  left join lateral (
    select count(*)::integer as n from public.bug_reports br where br.user_id = p.user_id
  ) r on true
  where p_user is null or p.user_id = p_user
  order by p.user_id;
$$;
revoke all on function public.admin_user_stats(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.admin_user_stats(timestamptz, uuid) to service_role;

create or replace function public.admin_user_days(p_user uuid, p_since timestamptz)
returns table (day date, attempts integer, ai_calls integer, boards integer)
language sql
stable
set search_path = public
as $$
  with attempts as (
    select (la.started_at at time zone 'UTC')::date as day, count(*)::integer as n
    from public.learning_attempts la
    where la.user_id = p_user and la.started_at >= p_since
    group by 1
  ),
  calls as (
    select (x.created_at at time zone 'UTC')::date as day, count(*)::integer as n
    from (
      select ue.created_at from public.usage_events ue where ue.user_id = p_user and ue.created_at >= p_since
      union all
      select uu.created_at from public.unlimited_usage uu where uu.user_id = p_user and uu.created_at >= p_since
    ) x
    group by 1
  ),
  touched as (
    select (la.started_at at time zone 'UTC')::date as day, la.board_id as board
    from public.learning_attempts la
    where la.user_id = p_user and la.started_at >= p_since and la.board_id is not null
    union
    select (w.created_at at time zone 'UTC')::date, w.id from public.whiteboards w
    where w.user_id = p_user and w.created_at >= p_since and w.deleted_at is null
    union
    select (w.updated_at at time zone 'UTC')::date, w.id from public.whiteboards w
    where w.user_id = p_user and w.updated_at >= p_since and w.deleted_at is null
  ),
  boards as (
    select t.day, count(*)::integer as n from touched t group by 1
  ),
  days as (
    select day from attempts union select day from calls union select day from boards
  )
  select d.day, coalesce(a.n, 0), coalesce(c.n, 0), coalesce(b.n, 0)
  from days d
  left join attempts a on a.day = d.day
  left join calls c on c.day = d.day
  left join boards b on b.day = d.day
  order by d.day;
$$;
revoke all on function public.admin_user_days(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_user_days(uuid, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 7. Retention: the audit log too
-- -----------------------------------------------------------------------------
-- As before (app_events 30 days, health_checks 14: RETENTION_DAYS in src/lib/admin/contracts.ts),
-- plus admin_audit 180 days. Answers {"app_events": n, "health_checks": n, "admin_audit": n}.
create or replace function public.prune_admin_rows()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_events integer;
  v_checks integer;
  v_audit  integer;
begin
  delete from public.app_events where at < now() - interval '30 days';
  get diagnostics v_events = row_count;
  delete from public.health_checks where at < now() - interval '14 days';
  get diagnostics v_checks = row_count;
  delete from public.admin_audit where at < now() - interval '180 days';
  get diagnostics v_audit = row_count;
  return jsonb_build_object('app_events', v_events, 'health_checks', v_checks, 'admin_audit', v_audit);
end;
$$;
revoke all on function public.prune_admin_rows() from public, anon, authenticated;
grant execute on function public.prune_admin_rows() to service_role;

-- PostgREST caches the schema; the new tables, views and RPCs need a reload.
notify pgrst, 'reload schema';
