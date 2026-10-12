-- =============================================================================
-- A day's budget per user, in units (2026-10-12, Ask's mic). Idempotent; adds one function.
--
--   rate_limit_spend(p_bucket, p_amount, p_limit, p_window_ms)
--                         rate_limit_hit()'s fixed window (20260917030000_refunds_ratelimit.sql)
--                         for the CALLER, counting p_amount units instead of one hit: the seconds of
--                         speech one account sends to ElevenLabs Scribe in a day
--                         (POST /api/live/transcribe, src/lib/server/rate-limit.ts `spendUserBudget`,
--                         bucket 'liveTranscribeDaySeconds', 20 minutes). Spent before the call with
--                         the recording's estimated length, then trued up with the length Scribe
--                         measured (`audio_duration_secs`), so a small low-bitrate file holding many
--                         minutes is counted as what it is. Kept in rate_limit_counters under the
--                         caller's id as 'spend:<p_bucket>' (never the same row as a rate_limit_hit()
--                         bucket), and answers like rate_limit_hit():
--                         { allowed, remaining, retry_after_ms, backend: 'db' }. A refused call's units
--                         count too: once spent, the window stays spent until it ends.
--
-- As the user (auth.uid()), like rate_limit_hit(): a caller can only ever spend their own budget,
-- which only ever stops their own requests, and never give units back (p_amount is at least 1).
-- anon cannot call it. Until this is applied the app counts the budget per server instance instead
-- (logged once), never not at all.
--
-- Down: drop function public.rate_limit_spend(text, integer, integer, integer).
-- =============================================================================

create or replace function public.rate_limit_spend(
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
  v_uid uuid := auth.uid();
  v_bucket text;
  v_now_ms bigint;
  v_start_ms bigint;
  v_window_start timestamptz;
  v_expires_at timestamptz;
  v_used integer;
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_bucket is null or char_length(p_bucket) < 1 or char_length(p_bucket) > 90 then
    raise exception 'p_bucket must be 1..90 characters' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'p_amount must be between 1 and 100000' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000000 then
    raise exception 'p_limit must be between 1 and 1000000' using errcode = '22023';
  end if;
  if p_window_ms is null or p_window_ms < 1000 or p_window_ms > 86400000 then
    raise exception 'p_window_ms must be between 1000 and 86400000' using errcode = '22023';
  end if;

  v_bucket       := 'spend:' || p_bucket;
  v_now_ms       := floor(extract(epoch from now()) * 1000)::bigint;
  v_start_ms     := v_now_ms - (v_now_ms % p_window_ms);
  v_window_start := to_timestamp(v_start_ms / 1000.0);
  v_expires_at   := to_timestamp((v_start_ms + 2::bigint * p_window_ms) / 1000.0);

  -- the caller's finished windows for the bucket (PK prefix: cheap)
  delete from public.rate_limit_counters c
  where c.user_id = v_uid and c.bucket = v_bucket and c.expires_at <= now();

  -- capped well inside an integer, however many refused calls keep adding to a spent window
  insert into public.rate_limit_counters as c (user_id, bucket, window_start, hits, expires_at)
  values (v_uid, v_bucket, v_window_start, p_amount, v_expires_at)
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
revoke all on function public.rate_limit_spend(text, integer, integer, integer) from public, anon;
grant execute on function public.rate_limit_spend(text, integer, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
