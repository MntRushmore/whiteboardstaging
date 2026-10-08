/**
 * App events: what went wrong, for the /admin page and the alerts (`public.app_events`,
 * supabase/migrations/20261005000000_admin.sql; the contract is src/lib/admin/contracts.ts).
 * Exports are frozen by the contract.
 *
 * Who records what:
 *   POST /api/client-errors         a crash in a student's browser (`client.*`) and an error card a
 *                                   student saw (`live.*`)
 *   errorResponse (request.ts)      a server route that answered 5xx (`route.<module>.<route>`)
 *   recordRouteEvent (request.ts)   a route answer that is no thrown error but that a student meets
 *                                   (recognize `unreadable`, solve `unusable_steps`, billing failing
 *                                   closed, chat problems dropped…: docs/RUNBOOK-ops.md)
 *   requireUser (auth.ts)           Supabase Auth unreachable (`auth`, `unavailable`)
 *   openrouter.ts                   a model call that fell back (`model.<route>`, code `fallback`,
 *                                   warn) or failed (code timeout | upstream | invalid | credits)
 *   mathpix.ts                      a Mathpix call that failed (`mathpix`)
 *   the health route                a failed health check (`health.<service>`), with recordEventNow
 *
 * One row per event, inserted with the service role through PostgREST (no policy lets anyone else
 * in). An event is checked against AppEventInputSchema first (its over-long strings cut to the
 * schema's lengths, so a long message is shortened rather than lost; anything else invalid is
 * dropped), `meta` is cut to about META_MAX_BYTES, and two guards keep a failing provider from
 * turning into a flood of writes:
 *   - repeats collapse: the same kind, code and message for the same user (or, without a user, the
 *     same request) within COLLAPSE_MS is written once;
 *   - a budget: at most BUDGET_PER_MINUTE events a minute per server instance; past it events are
 *     dropped and counted, and one warn line says how many when the minute ends. Health events
 *     are exempt (a handful every 5 minutes, and the alerts depend on them).
 *
 * Never throws and never holds a response: `recordEvent` starts the insert and hands it to
 * next/server's `after` (Vercel keeps the function alive until it finishes; outside a request it
 * simply runs). A failed insert is a warn line, at most one a minute. Without
 * SUPABASE_SERVICE_ROLE_KEY (or with no server env at all) both functions do nothing.
 */
import { after } from "next/server";
import { AppEventInputSchema, type AppEvent, type AppEventInput } from "@/lib/admin/contracts";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { RELEASE } from "@/lib/release";

const log = logger.child({ module: "app-events" });

/** Events written per server instance per minute, at most (health events are not counted). */
const BUDGET_PER_MINUTE = 60;
const BUDGET_WINDOW_MS = 60_000;
/** The same event for the same user within this long is written once. */
const COLLAPSE_MS = 30_000;
/** Remembered repeats before the memory is pruned (and cleared when pruning is not enough). */
const COLLAPSE_MAX_KEYS = 500;
/** `meta` serialized as JSON, at most (the contract's "~2 KB"). */
const META_MAX_BYTES = 2048;
/** Any one string inside `meta`, at most. */
const META_MAX_STRING = 500;
/** The insert gives up after this long. */
const WRITE_TIMEOUT_MS = 5_000;
/** At most one warn line about failed inserts (or invalid events) per this long. */
const WARN_EVERY_MS = 60_000;

/** The schema's string lengths: longer values are cut to these before validation. */
const MAX_LEN = { message: 500, code: 40, route: 200, requestId: 64, release: 64 } as const;

/** app_events as PostgREST takes it (`id` and `at` are the database's). */
type EventRow = {
  source: AppEvent["source"];
  level: AppEvent["level"];
  kind: string;
  code: string | null;
  message: string;
  route: string | null;
  user_id: string | null;
  board_id: string | null;
  request_id: string | null;
  meta: Record<string, unknown> | null;
  release: string;
};

type Target = { url: string; serviceKey: string };

/** Per instance, like the rest of this module's guards. */
const state = {
  windowStart: 0,
  used: 0,
  dropped: 0,
  /** collapse key -> when it was last written */
  recent: new Map<string, number>(),
  /** the warn throttle, per reason */
  warnedAt: new Map<string, number>(),
  suppressed: new Map<string, number>(),
};

/** Where to write, or null when there is no service role (or no valid server env). */
function target(): Target | null {
  try {
    const env = getServerEnv();
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
    return { url: env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ""), serviceKey: env.SUPABASE_SERVICE_ROLE_KEY };
  } catch {
    return null;
  }
}

/**
 * `text` that Postgres will store: no NUL (text and jsonb refuse it), no lone UTF-16 surrogate (a
 * cut emoji, which jsonb refuses as an escape), at most `max` UTF-16 units (what zod's `max`
 * counts; never more code points than Postgres's char_length counts).
 */
function clean(text: string, max: number): string {
  return text
    .split("\u0000")
    .join("")
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) => (m.length === 2 ? m : "�"))
    .slice(0, max)
    .replace(/[\uD800-\uDBFF]$/, "");
}

/** The event with its over-long strings cut to the schema's lengths (a long message is kept, shortened). */
function trimmed(event: AppEventInput): AppEventInput {
  const out: Record<string, unknown> = { ...event };
  for (const [key, max] of Object.entries(MAX_LEN)) {
    const value = out[key];
    if (typeof value === "string") out[key] = clean(value, max);
  }
  return out as AppEventInput;
}

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;

/** JSON.stringify's replacer: strings cleaned and capped, bigints as text (JSON has none). */
function metaValue(_key: string, value: unknown): unknown {
  if (typeof value === "string") return clean(value, META_MAX_STRING);
  if (typeof value === "bigint") return value.toString();
  return value;
}

/**
 * `meta` as JSON the database takes, at most META_MAX_BYTES. Too big: the keys that fit are kept in
 * order (a big value is skipped, smaller ones after it still go in) and `truncated: true` is added.
 * Something JSON cannot hold (a cycle) leaves only `truncated: true`.
 */
function capMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!meta) return null;
  let whole: string | undefined;
  try {
    whole = JSON.stringify(meta, metaValue);
  } catch {
    return { truncated: true };
  }
  if (whole === undefined) return null;
  if (bytes(whole) <= META_MAX_BYTES) return JSON.parse(whole) as Record<string, unknown>;

  const out: Record<string, unknown> = { truncated: true };
  let size = bytes(JSON.stringify(out));
  for (const [key, value] of Object.entries(meta)) {
    let part: string | undefined;
    try {
      part = JSON.stringify(value, metaValue);
    } catch {
      continue;
    }
    if (part === undefined) continue;
    // `,"key":value`
    const add = 1 + bytes(JSON.stringify(key)) + 1 + bytes(part);
    if (size + add > META_MAX_BYTES) continue;
    out[key] = JSON.parse(part);
    size += add;
  }
  return out;
}

/** A warn line per `reason` at most once per WARN_EVERY_MS, saying how many were held back. */
function warnThrottled(reason: string, fields: Record<string, unknown>, msg: string, now: number): void {
  try {
    const last = state.warnedAt.get(reason) ?? 0;
    if (now - last < WARN_EVERY_MS) {
      state.suppressed.set(reason, (state.suppressed.get(reason) ?? 0) + 1);
      return;
    }
    const suppressed = state.suppressed.get(reason) ?? 0;
    state.warnedAt.set(reason, now);
    state.suppressed.set(reason, 0);
    log.warn({ ...fields, ...(suppressed ? { suppressed } : {}) }, msg);
  } catch {
    // Logging must never become the next error.
  }
}

/** The repeat key: what happened, to whom (a user, else the request). */
function collapseKey(e: AppEvent): string {
  return [e.kind, e.code ?? "", e.message, e.userId ?? e.requestId ?? ""].join("\u0001");
}

/** True when the same event for the same user was written within COLLAPSE_MS. */
function isRepeat(key: string, now: number): boolean {
  const last = state.recent.get(key);
  return last !== undefined && now - last < COLLAPSE_MS;
}

function remember(key: string, now: number): void {
  if (state.recent.size >= COLLAPSE_MAX_KEYS) {
    for (const [k, at] of state.recent) if (now - at >= COLLAPSE_MS) state.recent.delete(k);
    if (state.recent.size >= COLLAPSE_MAX_KEYS) state.recent.clear();
  }
  state.recent.set(key, now);
}

/** Spends one event of this minute's budget; false (and counted) when it is spent. */
function withinBudget(now: number): boolean {
  if (now - state.windowStart >= BUDGET_WINDOW_MS) {
    if (state.dropped > 0) {
      try {
        log.warn({ dropped: state.dropped, budgetPerMinute: BUDGET_PER_MINUTE }, "app events dropped past the per-instance budget");
      } catch {
        // as above
      }
    }
    state.windowStart = now;
    state.used = 0;
    state.dropped = 0;
  }
  if (state.used >= BUDGET_PER_MINUTE) {
    state.dropped++;
    return false;
  }
  state.used++;
  return true;
}

/** Validate, collapse, spend the budget: the row to insert, or null to drop the event. */
function prepare(event: AppEventInput, now: number): EventRow | null {
  const parsed = AppEventInputSchema.safeParse(trimmed(event));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // The path and zod's wording only, never the values (they may be anything).
    warnThrottled("invalid", { path: issue?.path.join("."), issue: issue?.message }, "app event dropped: invalid", now);
    return null;
  }
  const e = parsed.data;
  const key = collapseKey(e);
  if (isRepeat(key, now)) return null;
  if (e.source !== "health" && !withinBudget(now)) return null;
  remember(key, now);
  return {
    source: e.source,
    level: e.level,
    kind: e.kind,
    code: e.code ?? null,
    message: e.message,
    route: e.route ?? null,
    user_id: e.userId ?? null,
    board_id: e.boardId ?? null,
    request_id: e.requestId ?? null,
    meta: capMeta(e.meta),
    release: e.release ?? RELEASE,
  };
}

/**
 * The insert. Calls fetch synchronously (before its first await), so the request is on its way
 * when recordEvent returns. Resolves either way; a failure is a throttled warn line.
 */
async function insert(row: EventRow, to: Target): Promise<void> {
  try {
    const res = await fetch(`${to.url}/rest/v1/app_events`, {
      method: "POST",
      headers: {
        apikey: to.serviceKey,
        Authorization: `Bearer ${to.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
      cache: "no-store",
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return;
    }
    const text = await res.text().catch(() => "");
    warnThrottled("insert", { status: res.status, error: text.slice(0, 200), kind: row.kind }, "app event not recorded", Date.now());
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    warnThrottled("insert", { error: error.slice(0, 200), kind: row.kind }, "app event not recorded", Date.now());
  }
}

/**
 * Records an event, fire and forget: never throws, never delays the response it is about, and drops
 * events past a per-instance budget (a failing provider must not turn into a flood of writes).
 * A no-op without SUPABASE_SERVICE_ROLE_KEY.
 */
export function recordEvent(event: AppEventInput): void {
  try {
    const to = target();
    if (!to) return;
    const row = prepare(event, Date.now());
    if (!row) return;
    const pending = insert(row, to);
    try {
      // A promise: Vercel's waitUntil keeps the function alive until the insert is done.
      after(pending);
    } catch {
      // Outside a request (a script, a test): `after` throws, and the insert simply runs.
    }
  } catch {
    // Recording must never become the next error.
  }
}

/** The same, awaited (the health route, tests): resolves once written or dropped; never rejects. */
export async function recordEventNow(event: AppEventInput): Promise<void> {
  try {
    const to = target();
    if (!to) return;
    const row = prepare(event, Date.now());
    if (!row) return;
    await insert(row, to);
  } catch {
    // As recordEvent.
  }
}
