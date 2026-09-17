-- =============================================================================
-- Refunds & database-backed rate limiting (2026-09-17). Idempotent; additive to
-- 20260917020000_accounts_billing.sql.
--
-- Both RPCs run AS THE USER (SECURITY DEFINER, keyed on auth.uid()) and are the
-- only way a user token reaches the objects below:
--
--   refund_credits(p_request_id)                   -> { refunded, remaining }
--     Gives back the credits consume_credits() charged for one request when the
--     upstream call failed after the charge. Deletes the caller's own
--     usage_events rows carrying that request_id, but only rows younger than
--     15 minutes, so a request id can never be replayed later to erase spend.
--     `refunded` is the number of credits (sum of units) removed; 0 when nothing
--     matched (unknown id, another user's id, or too old). Idempotent.
--
--   rate_limit_hit(p_bucket, p_limit, p_window_ms) -> { allowed, remaining, retry_after_ms, backend }
--     Fixed-window counter shared by every server instance (the in-memory
--     limiter in src/lib/server/rate-limit.ts is per instance). One atomic
--     upsert per call: INSERT ... ON CONFLICT DO UPDATE serialises concurrent
--     hits on the (user, bucket, window) row, so exactly p_limit calls per
--     window are allowed no matter how many arrive in parallel.
--
-- Objects created here:
--   table      rate_limit_counters (RLS on, NO policies, no authenticated grants: function-only)
--   index      usage_events_user_request_idx
--   functions  refund_credits(text), rate_limit_hit(text, integer, integer)
--
-- Supabase's default privileges grant ALL on new tables/functions to anon,
-- authenticated and service_role, so each object revokes first and then grants
-- exactly what the client uses. docs/RUNBOOK-supabase.md section 13 explains
-- the operator side.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. usage_events: lookup path for refunds (user, request_id)
-- -----------------------------------------------------------------------------
create index if not exists usage_events_user_request_idx
  on public.usage_events (user_id, request_id)
  where request_id is not null;

-- -----------------------------------------------------------------------------
-- 2. refund_credits
-- RPC: POST /rest/v1/rpc/refund_credits {p_request_id}  (as the user)
-- -----------------------------------------------------------------------------
create or replace function public.refund_credits(p_request_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_refunded integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_request_id is null or char_length(p_request_id) < 1 or char_length(p_request_id) > 100 then
    raise exception 'p_request_id must be 1..100 characters' using errcode = '22023';
  end if;

  -- Same lock consume_credits() takes, so a refund and a spend for one user
  -- serialise and the `remaining` we return is the balance after this refund.
  perform 1 from public.profiles pr where pr.user_id = v_uid for update;

  with gone as (
    delete from public.usage_events u
    where u.user_id = v_uid
      and u.request_id = p_request_id
      and u.created_at > now() - interval '15 minutes'
    returning u.units
  )
  select coalesce(sum(units), 0)::integer into v_refunded from gone;

  return jsonb_build_object(
    'refunded',  v_refunded,
    'remaining', (public.credit_balance(v_uid) ->> 'remaining')::integer
  );
end;
$$;
revoke all on function public.refund_credits(text) from public, anon;
grant execute on function public.refund_credits(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. rate_limit_counters (function-only table; nobody but service_role touches it directly)
-- -----------------------------------------------------------------------------
-- Rows are short-lived: `expires_at` is two windows after `window_start`, and
-- rate_limit_hit() deletes the caller's expired rows for the bucket on every
-- call plus (2% of calls) every expired row of every user. No FK to auth.users
-- on purpose: a deleted user's rows age out within two windows anyway and a
-- still-valid JWT of a deleted account should not turn a rate-limit check into
-- a constraint error.
create table if not exists public.rate_limit_counters (
  user_id      uuid        not null,
  bucket       text        not null check (char_length(bucket) between 1 and 100),
  window_start timestamptz not null,
  hits         integer     not null default 0 check (hits >= 0),
  expires_at   timestamptz not null,
  primary key (user_id, bucket, window_start)
);

create index if not exists rate_limit_counters_expires_idx
  on public.rate_limit_counters (expires_at);

alter table public.rate_limit_counters enable row level security;

revoke all on public.rate_limit_counters from public, anon, authenticated;
grant all on public.rate_limit_counters to service_role;

-- -----------------------------------------------------------------------------
-- 4. rate_limit_hit
-- RPC: POST /rest/v1/rpc/rate_limit_hit {p_bucket, p_limit, p_window_ms}  (as the user)
-- -----------------------------------------------------------------------------
-- Fixed window aligned to the Unix epoch: window_start = now - (now mod window).
-- allowed = hits <= p_limit after counting this call; remaining = limit - hits
-- (clamped at 0); retry_after_ms = ms until the window ends (0 when allowed).
create or replace function public.rate_limit_hit(
  p_bucket    text,
  p_limit     integer,
  p_window_ms integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now_ms bigint;
  v_start_ms bigint;
  v_window_start timestamptz;
  v_expires_at timestamptz;
  v_hits integer;
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_bucket is null or char_length(p_bucket) < 1 or char_length(p_bucket) > 100 then
    raise exception 'p_bucket must be 1..100 characters' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000000 then
    raise exception 'p_limit must be between 1 and 1000000' using errcode = '22023';
  end if;
  if p_window_ms is null or p_window_ms < 1 or p_window_ms > 86400000 then
    raise exception 'p_window_ms must be between 1 and 86400000' using errcode = '22023';
  end if;

  v_now_ms       := floor(extract(epoch from now()) * 1000)::bigint;
  v_start_ms     := v_now_ms - (v_now_ms % p_window_ms);
  v_window_start := to_timestamp(v_start_ms / 1000.0);
  v_expires_at   := to_timestamp((v_start_ms + 2::bigint * p_window_ms) / 1000.0);

  -- Deterministic, cheap (PK prefix) cleanup of this caller's finished windows for the bucket.
  delete from public.rate_limit_counters c
  where c.user_id = v_uid and c.bucket = p_bucket and c.expires_at <= now();

  -- Opportunistic global sweep so abandoned users/buckets do not accumulate.
  if random() < 0.02 then
    delete from public.rate_limit_counters c where c.expires_at <= now();
  end if;

  insert into public.rate_limit_counters (user_id, bucket, window_start, hits, expires_at)
  values (v_uid, p_bucket, v_window_start, 1, v_expires_at)
  on conflict (user_id, bucket, window_start)
    do update set hits = public.rate_limit_counters.hits + 1
  returning hits into v_hits;

  v_allowed := v_hits <= p_limit;

  return jsonb_build_object(
    'allowed',        v_allowed,
    'remaining',      greatest(0, p_limit - v_hits),
    'retry_after_ms', case when v_allowed then 0 else (v_start_ms + p_window_ms - v_now_ms)::integer end,
    'backend',        'db'
  );
end;
$$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon;
grant execute on function public.rate_limit_hit(text, integer, integer) to authenticated;

-- PostgREST caches the schema; the new table and RPCs need a reload.
notify pgrst, 'reload schema';
