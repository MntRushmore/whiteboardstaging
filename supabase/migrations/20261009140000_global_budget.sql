-- =============================================================================
-- A budget for everyone together (2026-10-09, read aloud). Idempotent; adds one function.
--
--   global_budget_spend(p_bucket, p_amount, p_limit, p_window_ms)
--                         rate_limit_hit()'s fixed window (20260917030000_refunds_ratelimit.sql)
--                         for the whole app instead of one user: adds p_amount units (read aloud's
--                         characters sent to ElevenLabs, src/lib/server/rate-limit.ts
--                         `spendGlobalBudget`) to the window of bucket 'global:<p_bucket>', kept in
--                         rate_limit_counters under the nil uuid (no account has it; the table has
--                         no FK to auth.users), and answers like rate_limit_hit():
--                         { allowed, remaining, retry_after_ms, backend: 'db' }. A refused call's
--                         units count too: once spent, the window stays spent until it ends.
--
-- The service role only: a user who could call it could spend everyone's budget. Until this is
-- applied the app counts the budget per server instance instead (logged once), never not at all.
-- =============================================================================

create or replace function public.global_budget_spend(
  p_bucket    text,
  p_amount    integer,
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
  v_key constant uuid := '00000000-0000-0000-0000-000000000000';
  v_bucket text;
  v_now_ms bigint;
  v_start_ms bigint;
  v_window_start timestamptz;
  v_expires_at timestamptz;
  v_used integer;
  v_allowed boolean;
begin
  if p_bucket is null or char_length(p_bucket) < 1 or char_length(p_bucket) > 90 then
    raise exception 'p_bucket must be 1..90 characters' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'p_amount must be between 1 and 100000' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000000000 then
    raise exception 'p_limit must be between 1 and 1000000000' using errcode = '22023';
  end if;
  if p_window_ms is null or p_window_ms < 1000 or p_window_ms > 86400000 then
    raise exception 'p_window_ms must be between 1000 and 86400000' using errcode = '22023';
  end if;

  v_bucket       := 'global:' || p_bucket;
  v_now_ms       := floor(extract(epoch from now()) * 1000)::bigint;
  v_start_ms     := v_now_ms - (v_now_ms % p_window_ms);
  v_window_start := to_timestamp(v_start_ms / 1000.0);
  v_expires_at   := to_timestamp((v_start_ms + 2::bigint * p_window_ms) / 1000.0);

  delete from public.rate_limit_counters c
  where c.user_id = v_key and c.bucket = v_bucket and c.expires_at <= now();

  -- capped well inside an integer, however many refused calls keep adding to a spent window
  insert into public.rate_limit_counters as c (user_id, bucket, window_start, hits, expires_at)
  values (v_key, v_bucket, v_window_start, p_amount, v_expires_at)
  on conflict (user_id, bucket, window_start)
    do update set hits = least(c.hits + p_amount, 2000000000)
  returning c.hits into v_used;

  v_allowed := v_used <= p_limit;

  return jsonb_build_object(
    'allowed',        v_allowed,
    'remaining',      greatest(0, p_limit - v_used),
    'retry_after_ms', case when v_allowed then 0 else (v_start_ms + p_window_ms - v_now_ms)::integer end,
    'backend',        'db'
  );
end;
$$;
revoke all on function public.global_budget_spend(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.global_budget_spend(text, integer, integer, integer) to service_role;

notify pgrst, 'reload schema';
