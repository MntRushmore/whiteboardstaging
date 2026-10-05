-- =============================================================================
-- Admin system (2026-10-05). Idempotent; additive (nothing else changes).
--
-- The owner's view of whether the backend and the AI are up and what students see go wrong
-- (src/lib/admin/contracts.ts is the shared contract; docs/ARCHITECTURE.md, "Admin"):
--
--   admins          who may open /admin. The owner's account, added by hand with
--                   `node scripts/make-admin.mjs <email>` (service role; this file names nobody).
--                   is_admin() answers "am I one?" for the signed-in user, so the app can show the
--                   link; the admin API routes check the table with the service role
--                   (src/lib/server/admin.ts, requireAdmin).
--   app_events      what went wrong, one row per event: a crash in a student's browser, an error
--                   card a student saw, a server route that answered 5xx, a model call that failed
--                   or fell back, a Mathpix call that failed, a health check that failed. Written
--                   only by the server (src/lib/server/events.ts, recordEvent), which validates
--                   each event against AppEventInputSchema, caps `meta` at ~2 KB, collapses repeats
--                   and drops events past a per-instance budget. The checks below are a copy of
--                   that schema, so the database refuses what the code never sends.
--   health_checks   one row per service per health run (every 5 minutes, pg_cron calling
--                   GET /api/admin/health): up or down, how long the check took, why.
--   alert_state     one row per alert rule and service (`down:openrouter`, `spike:errors`,
--                   `credits:openrouter`): firing or ok, since when, when the owner was last
--                   emailed, failures in a row. How the alert emails are throttled
--                   (ALERT_RULES.repeatAfterMin) and how a recovery is noticed.
--
-- Who may do what. Every table: RLS on, NO policy, every privilege revoked from anon and
-- authenticated, all granted to the service role, like email_log (20261003030000_email_log.sql).
-- A student who could read app_events would read other students' errors (user and board ids,
-- paths); one who could write it could fake an outage or bury a real one; one who could insert
-- into admins would be an admin. The only thing `authenticated` gets is EXECUTE on is_admin(),
-- which answers about the caller alone.
--
-- Lists and formats. `source`, `level` and `service` are lists, copies of EVENT_SOURCES,
-- EVENT_LEVELS and SERVICES in src/lib/admin/contracts.ts: a new value there needs a migration that
-- replaces the constraint, applied BEFORE the code that writes it (until then the insert is refused
-- with 23514 and the event is lost, logged as a warn). `kind` is a format (EVENT_KIND), so a new
-- kind of event needs no migration.
--
-- Personal data. app_events carries a user id (set null when the account is deleted: the event
-- stays, nobody's name is on it), a board id (no foreign key, so a deleted board keeps its events),
-- the page or API path and an error message. Never what a student wrote or typed: the client
-- sends none (src/lib/clientErrors.ts) and the server never puts it in a message. Retention:
-- app_events 30 days, health_checks 14 days (RETENTION_DAYS in the contract; prune_admin_rows(),
-- called by the health run).
--
-- Deploy order: before the code that writes (the events code, the health route). Without these
-- tables every event write fails (logged as a warn at most once a minute per instance) and
-- nothing else breaks; the /admin page answers that it cannot read them.
--
-- Supabase's default privileges grant ALL on every new public table and function to anon,
-- authenticated and service_role, so each object revokes first and grants exactly what is used.
--
-- Objects:
--   tables      admins, app_events, health_checks, alert_state
--   constraints app_events_source_known, app_events_level_known, app_events_kind_format,
--               app_events_code_len, app_events_message_len, app_events_route_len,
--               app_events_request_id_len, app_events_meta_object, app_events_release_len,
--               health_checks_service_known, health_checks_latency_range, health_checks_detail_len,
--               alert_state_key_format, alert_state_status_known, alert_state_failures_range
--   indexes     app_events_at_idx (at desc), app_events_kind_at_idx (kind, at desc),
--               app_events_user_idx (user_id, partial), health_checks_service_at_idx
--               (service, at desc), health_checks_at_idx (at)
--   functions   is_admin() [security definer, authenticated], prune_admin_rows() [service role]
--   grants      service_role: all on the four tables; authenticated: execute is_admin()
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. admins: who may open /admin
-- -----------------------------------------------------------------------------
create table if not exists public.admins (
  user_id  uuid        primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;
-- No policies on purpose: nothing but the service role (which bypasses RLS) may read or write.
revoke all on public.admins from public, anon, authenticated;
grant all on public.admins to service_role;

-- Is the signed-in user an admin? For the app to decide whether to show the /admin link; the admin
-- routes do not trust it (they read the table with the service role). Security definer because the
-- caller cannot read `admins`; it answers only about auth.uid(), so it tells nobody anything about
-- anyone else. False when signed out (auth.uid() is null).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. app_events: what went wrong
-- -----------------------------------------------------------------------------
create table if not exists public.app_events (
  id         bigint      generated always as identity primary key,
  at         timestamptz not null default now(),
  source     text        not null,
  level      text        not null default 'error',
  kind       text        not null,
  code       text,
  message    text        not null default '',
  route      text,
  user_id    uuid        references auth.users (id) on delete set null,
  -- no foreign key: a deleted board keeps its events
  board_id   uuid,
  request_id text,
  meta       jsonb,
  release    text,
  constraint app_events_source_known check (source in ('client', 'live', 'server', 'health')),
  constraint app_events_level_known check (level in ('error', 'warn', 'info')),
  constraint app_events_kind_format check (kind ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
  constraint app_events_code_len check (code is null or char_length(code) <= 40),
  constraint app_events_message_len check (char_length(message) <= 500),
  constraint app_events_route_len check (route is null or char_length(route) <= 200),
  constraint app_events_request_id_len check (request_id is null or char_length(request_id) <= 64),
  -- The server caps `meta` at ~2 KB of JSON; jsonb's text form spaces it out, so the bound here is
  -- looser. It stops a row the code would never write, not a byte over the code's cap.
  constraint app_events_meta_object check (meta is null or (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 8192)),
  constraint app_events_release_len check (release is null or char_length(release) <= 64)
);

-- The page's last-24/48-hours reads and the spike rule's window, newest first.
create index if not exists app_events_at_idx on public.app_events (at desc);
-- One kind over time (the AI routes' failures and fallbacks, `health.<service>`).
create index if not exists app_events_kind_at_idx on public.app_events (kind, at desc);
-- Deleting an account sets its events' user_id null: without this, every deletion scans the table.
create index if not exists app_events_user_idx on public.app_events (user_id) where user_id is not null;

alter table public.app_events enable row level security;
revoke all on public.app_events from public, anon, authenticated;
grant all on public.app_events to service_role;

-- -----------------------------------------------------------------------------
-- 3. health_checks: is each service up
-- -----------------------------------------------------------------------------
create table if not exists public.health_checks (
  id         bigint      generated always as identity primary key,
  at         timestamptz not null default now(),
  service    text        not null,
  ok         boolean     not null,
  -- whole milliseconds the check took
  latency_ms integer     not null default 0,
  -- why it failed, or a short note when it passed ("$12.40 credit left")
  detail     text,
  constraint health_checks_service_known check (service in ('app', 'database', 'openrouter', 'mathpix', 'email', 'stripe')),
  constraint health_checks_latency_range check (latency_ms between 0 and 600000),
  constraint health_checks_detail_len check (detail is null or char_length(detail) <= 500)
);

-- A service's latest check, its last 24 hours (uptime), when it started failing.
create index if not exists health_checks_service_at_idx on public.health_checks (service, at desc);
-- The prune.
create index if not exists health_checks_at_idx on public.health_checks (at);

alter table public.health_checks enable row level security;
revoke all on public.health_checks from public, anon, authenticated;
grant all on public.health_checks to service_role;

-- -----------------------------------------------------------------------------
-- 4. alert_state: one row per alert, so an email goes once and again only after a while
-- -----------------------------------------------------------------------------
create table if not exists public.alert_state (
  -- `down:<service>`, `spike:errors`, `credits:openrouter`
  key          text        primary key,
  status       text        not null default 'ok',
  -- when the current status began
  since        timestamptz not null default now(),
  -- the last email about this alert (firing or recovered)
  last_sent_at timestamptz,
  -- checks failed in a row (a down alert fires at ALERT_RULES.downAfterFailures)
  failures     integer     not null default 0,
  constraint alert_state_key_format check (key ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  constraint alert_state_status_known check (status in ('ok', 'firing')),
  constraint alert_state_failures_range check (failures >= 0)
);

alter table public.alert_state enable row level security;
revoke all on public.alert_state from public, anon, authenticated;
grant all on public.alert_state to service_role;

-- -----------------------------------------------------------------------------
-- 5. Retention
-- -----------------------------------------------------------------------------
-- Deletes app_events older than 30 days and health_checks older than 14 (RETENTION_DAYS in
-- src/lib/admin/contracts.ts: keep the two equal). Answers how many of each went:
-- {"app_events": n, "health_checks": n}. Service role only (the health run calls it); security
-- definer so a pg_cron job can call it too, whatever role owns the job.
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
begin
  delete from public.app_events where at < now() - interval '30 days';
  get diagnostics v_events = row_count;
  delete from public.health_checks where at < now() - interval '14 days';
  get diagnostics v_checks = row_count;
  return jsonb_build_object('app_events', v_events, 'health_checks', v_checks);
end;
$$;
revoke all on function public.prune_admin_rows() from public, anon, authenticated;
grant execute on function public.prune_admin_rows() to service_role;

-- PostgREST caches the schema; the new tables and RPCs need a reload.
notify pgrst, 'reload schema';
