/**
 * The health route's tables, through PostgREST with the service role (all three are service-role
 * only: 20261005000000_admin.sql). Plain `fetch`, like purgeBillingPayloads in storageGc.ts, so
 * tests replace one function and every write can carry its own deadline.
 *
 *   health_checks (id, at, service, ok, latency_ms, detail)        one row per service per run
 *   alert_state   (key pk, status ok|firing, since, last_sent_at, failures)  the alerts' memory
 *   app_events    (at, source, level, kind, code, message, route, user_id, …)  read for the error spike
 *   admin_issues  (fingerprint, status, …)                         muted issues, left out of the spike
 *   prune_admin_rows()                                              retention (RETENTION_DAYS), once a day
 *
 * Every helper throws a RestError on any failure, naming the table and PostgREST's message; the
 * caller decides what a failure means (a check fails, an alert is skipped, a write is logged).
 */
import type { HealthResult } from "@/lib/admin/contracts";

/** How long one PostgREST call may take when the caller gives no signal of its own. */
export const REST_TIMEOUT_MS = 6_000;

export type Rest = {
  /** NEXT_PUBLIC_SUPABASE_URL */
  url: string;
  serviceKey: string;
  fetch: typeof fetch;
  /** The caller's deadline (a check's own); REST_TIMEOUT_MS when absent. */
  signal?: AbortSignal;
};

export class RestError extends Error {
  readonly status: number | undefined;
  /** PostgREST's or Postgres's code (PGRST205, 42P01, …) */
  readonly code: string | undefined;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "RestError";
    this.status = status;
    this.code = code;
  }
}

function headers(rest: Rest, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: rest.serviceKey, Authorization: `Bearer ${rest.serviceKey}`, ...extra };
}

/** `profiles` from `profiles?select=…`, `prune_admin_rows` from `rpc/prune_admin_rows`. */
function tableOf(path: string): string {
  return path.split("?")[0].replace(/^rpc\//, "");
}

async function call(rest: Rest, path: string, init: RequestInit): Promise<unknown> {
  const url = `${rest.url.replace(/\/+$/, "")}/rest/v1/${path}`;
  const res = await rest.fetch(url, { ...init, cache: "no-store", signal: rest.signal ?? AbortSignal.timeout(REST_TIMEOUT_MS) });
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const b = body && typeof body === "object" ? (body as { message?: unknown; code?: unknown }) : {};
    const message = typeof b.message === "string" ? b.message.replace(/\s+/g, " ").slice(0, 160) : `HTTP ${res.status}`;
    throw new RestError(`${tableOf(path)}: ${res.status} ${message}`, res.status, typeof b.code === "string" ? b.code : undefined);
  }
  return body;
}

/** A GET returning rows (an array) — anything else is an error. */
export async function restGet<T extends unknown[]>(rest: Rest, path: string): Promise<T> {
  const body = await call(rest, path, { method: "GET", headers: headers(rest) });
  if (!Array.isArray(body)) throw new RestError(`${tableOf(path)}: expected rows`);
  return body as T;
}

// ------------------------------------------------------------------ health_checks

/** The longest `detail` stored (the page shows a line, not a log). */
export const MAX_DETAIL = 300;

/** One row per result, in one insert. */
export async function insertHealthChecks(rest: Rest, results: HealthResult[]): Promise<void> {
  if (!results.length) return;
  const rows = results.map((r) => ({ at: r.at, service: r.service, ok: r.ok, latency_ms: Math.round(r.latencyMs), detail: r.detail ? r.detail.slice(0, MAX_DETAIL) : null }));
  await call(rest, "health_checks", { method: "POST", headers: headers(rest, { "Content-Type": "application/json", Prefer: "return=minimal" }), body: JSON.stringify(rows) });
}

// ------------------------------------------------------------------ alert_state

export type AlertStatus = "ok" | "firing";

/** One alert's memory (camel-cased alert_state row). */
export type AlertState = {
  key: string;
  status: AlertStatus;
  /**
   * When the current streak began: the first failed check of a failing streak (still `ok` while
   * under `downAfterFailures`, then `firing`), or the first passing check after one.
   */
  since: string | null;
  /** The last FIRING email that went out (down, still down, spike, low credit); recoveries do not move it. */
  lastSentAt: string | null;
  /** Failed checks in a row (down alerts); runs over the thresholds in a row (the spike). */
  failures: number;
};

type AlertStateRow = { key: string; status: string; since: string | null; last_sent_at: string | null; failures: number | null };

export async function loadAlertStates(rest: Rest): Promise<Map<string, AlertState>> {
  const rows = await restGet<AlertStateRow[]>(rest, "alert_state?select=key,status,since,last_sent_at,failures");
  const map = new Map<string, AlertState>();
  for (const r of rows) {
    map.set(r.key, { key: r.key, status: r.status === "firing" ? "firing" : "ok", since: r.since ?? null, lastSentAt: r.last_sent_at ?? null, failures: Math.max(0, Number(r.failures) || 0) });
  }
  return map;
}

/** Upsert by key (only the states that changed are passed). */
export async function saveAlertStates(rest: Rest, states: AlertState[]): Promise<void> {
  if (!states.length) return;
  const rows = states.map((s) => ({ key: s.key, status: s.status, since: s.since, last_sent_at: s.lastSentAt, failures: s.failures }));
  await call(rest, "alert_state?on_conflict=key", {
    method: "POST",
    headers: headers(rest, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
  });
}

// ------------------------------------------------------------------ app_events

export type ErrorEventRow = {
  kind: string;
  code: string | null;
  message: string | null;
  user_id: string | null;
  source: string;
  /** meta->>stack: the top of a browser crash's stack, for the noise rule */
  stack?: string | null;
};

/** At most this many events are read for the spike: far past any threshold, small enough to group in memory. */
export const SPIKE_READ_LIMIT = 2000;

/** Errors students saw (sources live, client, server) since `since`, newest first. Health events are not counted. */
export async function recentErrorEvents(rest: Rest, since: Date): Promise<ErrorEventRow[]> {
  const q = new URLSearchParams({
    select: "kind,code,message,user_id,source,stack:meta->>stack",
    level: "eq.error",
    source: "in.(live,client,server)",
    at: `gte.${since.toISOString()}`,
    order: "at.desc",
    limit: String(SPIKE_READ_LIMIT),
  });
  return restGet<ErrorEventRow[]>(rest, `app_events?${q}`);
}

// ------------------------------------------------------------------ admin_issues

/**
 * The fingerprints of the issues an admin muted (admin_issues, 20261008000000_admin_console.sql):
 * the error spike leaves them out. Throws a RestError like the rest; the caller counts everything
 * when it cannot read them.
 */
export async function mutedFingerprints(rest: Rest): Promise<Set<string>> {
  const rows = await restGet<Array<{ fingerprint: string }>>(rest, "admin_issues?select=fingerprint&status=eq.muted");
  return new Set(rows.map((r) => r.fingerprint));
}

// ------------------------------------------------------------------ retention

/** prune_admin_rows(): deletes app_events and health_checks past RETENTION_DAYS, admin_audit past 180 days. Answers whatever the function returns. */
export async function pruneAdminRows(rest: Rest): Promise<unknown> {
  return call(rest, "rpc/prune_admin_rows", { method: "POST", headers: headers(rest, { "Content-Type": "application/json" }), body: "{}" });
}
