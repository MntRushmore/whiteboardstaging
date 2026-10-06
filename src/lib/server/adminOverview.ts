/**
 * The /admin page's overview (`AdminOverview`, src/lib/admin/contracts.ts), read with the service
 * role over PostgREST and Supabase Auth's admin API: plain fetches, all in parallel, then
 * aggregated here. GET /api/admin/overview calls `buildAdminOverview` once the caller is an admin.
 *
 * Reads (24 h / 48 h / 7 d back from `now`):
 *   health_checks     24 h of checks: each service's latest, uptime, latency, down since; OpenRouter's credit
 *   app_events        48 h of errors and warnings (not health checks): per hour, groups, AI failures
 *                     + an exact count of the last 24 h's errors
 *   usage_events      7 d of metered calls (route, user, time) ─┐ AI calls per route (24 h),
 *   unlimited_usage   7 d of Unlimited subscribers' calls ──────┤ active users (24 h, 7 d)
 *   learning_attempts 7 d of problems worked (user, time) ──────┘ + exact counts of today's attempts
 *   profiles          exact counts: accounts, sign-ups in 24 h and 7 d, finished the welcome
 *   unlimited_subscriptions  every subscription (money: paying, in trial, charges coming, conversion)
 *   admins            whose subscriptions to leave out of the money (the owner's own tests)
 *   bug_reports       the latest 20
 *   auth admin API    the email of each user in an error group's samples (cached 10 minutes)
 *
 * Row reads stop at ROW_CAP rows each, newest first (PostgREST pages of 1,000). Counts that must be
 * exact use `Prefer: count=exact` instead of rows. The distinct-user counts are the only numbers that
 * can come out low past the cap (more than 5,000 calls in a week); a SQL function would make them
 * exact at any size (see the report that came with this file). A table that does not exist yet (the
 * admin migration not applied) reads as empty; any other failure throws `OverviewQueryError`, which
 * names the table.
 */
import { SERVICES, type AdminOverview, type ErrorGroup, type EventLevel, type EventSource, type Service, type ServiceStatus } from "@/lib/admin/contracts";
import { normalizeRoute } from "@/lib/admin/view";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "admin-overview" });

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Rows read per table at most (newest first). */
export const ROW_CAP = 5_000;
/** PostgREST's page (Supabase's default max-rows). */
export const PAGE_SIZE = 1_000;
/** One request's budget; the whole overview aims at under 2 s. */
export const QUERY_TIMEOUT_MS = 6_000;
/** Error groups returned, and samples per group. */
export const MAX_GROUPS = 30;
export const SAMPLES_PER_GROUP = 3;
/** Emails looked up per overview at most, and how long one is remembered. */
export const MAX_EMAIL_LOOKUPS = 40;
export const EMAIL_CACHE_MS = 10 * 60_000;
export const BUG_REPORTS = 20;

/** The routes the AI table always lists (ROUTE_COSTS with a price), even with no calls. */
export const METERED_ROUTES = [
  "live/recognize",
  "live/check",
  "live/solve",
  "live/setup",
  "live/reread",
  "live/proof",
  "live/chat",
  "live/lecture",
  "live/sketch",
  "live/listen",
] as const;

export interface OverviewDeps {
  /** the Supabase project URL */
  url: string;
  serviceKey: string;
  fetch?: typeof fetch;
  /** ms since the epoch; Date.now() by default */
  now?: number;
}

/** The env the overview needs, or null without the service role key. */
export function overviewDeps(): OverviewDeps | null {
  const env = getServerEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return { url: env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ""), serviceKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

/** A read the overview cannot do without; `what` names the table (or "auth"). */
export class OverviewQueryError extends Error {
  readonly what: string;
  readonly status: number | null;
  constructor(what: string, status: number | null, detail: string) {
    super(`Couldn't read ${what}: ${detail}`);
    this.name = "OverviewQueryError";
    this.what = what;
    this.status = status;
  }
}

/** PostgREST's "no such table" (schema cache) and Postgres's undefined_table. */
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

class MissingTableError extends Error {}

// ------------------------------------------------------------------ PostgREST

type Query = { table: string; params: Record<string, string> };

function queryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%3E/g, ">")}`)
    .join("&");
}

interface Rest {
  rows<T>(q: Query): Promise<T[]>;
  /** newest-first rows up to `cap`, the first page alone unless it came back full */
  paged<T>(q: Query, cap?: number): Promise<{ rows: T[]; truncated: boolean }>;
  count(q: Query): Promise<number>;
  email(userId: string): Promise<string | null>;
}

const emailCache = new Map<string, { email: string | null; at: number }>();

/** Tests only. */
export function resetOverviewCaches(): void {
  emailCache.clear();
  warnedMissing.clear();
}

const warnedMissing = new Set<string>();

function restClient(deps: OverviewDeps): Rest {
  const f = deps.fetch ?? fetch;
  const headers = { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}` };

  async function request(q: Query, init: { method?: "GET" | "HEAD"; prefer?: string }): Promise<Response> {
    const url = `${deps.url}/rest/v1/${q.table}?${queryString(q.params)}`;
    let res: Response;
    try {
      res = await f(url, {
        method: init.method ?? "GET",
        headers: { ...headers, ...(init.prefer ? { Prefer: init.prefer } : {}) },
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      throw new OverviewQueryError(q.table, null, name === "TimeoutError" || name === "AbortError" ? "no answer in time" : `network: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.ok) return res;
    const body = init.method === "HEAD" ? null : ((await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null);
    const code = typeof body?.code === "string" ? body.code : "";
    if (MISSING_TABLE_CODES.has(code) || (init.method === "HEAD" && res.status === 404)) throw new MissingTableError(q.table);
    const message = typeof body?.message === "string" ? body.message : "";
    throw new OverviewQueryError(q.table, res.status, `status ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message.slice(0, 200)}` : ""}`);
  }

  /** A missing table reads as empty (logged once per table per process). */
  async function orEmpty<T>(table: string, run: () => Promise<T>, empty: T): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof MissingTableError)) throw err;
      if (!warnedMissing.has(table)) {
        warnedMissing.add(table);
        log.warn({ table }, "admin overview: table missing (migration not applied?); read as empty");
      }
      return empty;
    }
  }

  async function rows<T>(q: Query): Promise<T[]> {
    return orEmpty(q.table, async () => (await (await request(q, {})).json()) as T[], [] as T[]);
  }

  /** `Content-Range: 0-999/4210` -> 4210; null when the total is not given ("*"). */
  const totalOf = (res: Response) => {
    const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "");
    return m ? Number(m[1]) : null;
  };

  return {
    rows,
    async paged<T>(q: Query, cap = ROW_CAP) {
      const params = (offset: number) => ({ table: q.table, params: { ...q.params, limit: String(PAGE_SIZE), offset: String(offset) } });
      // The first page also asks how many rows match, so only the pages needed are read next.
      const first = await orEmpty(
        q.table,
        async () => {
          const res = await request(params(0), { prefer: "count=exact" });
          return { rows: (await res.json()) as T[], total: totalOf(res) };
        },
        { rows: [] as T[], total: 0 },
      );
      if (first.rows.length < PAGE_SIZE) return { rows: first.rows.slice(0, cap), truncated: first.rows.length > cap };
      const want = Math.min(cap, first.total ?? cap);
      const offsets: number[] = [];
      for (let o = PAGE_SIZE; o < want; o += PAGE_SIZE) offsets.push(o);
      const rest = await Promise.all(offsets.map((o) => rows<T>(params(o))));
      const all = [first.rows, ...rest].flat().slice(0, cap);
      const truncated = first.total !== null ? first.total > cap : all.length >= cap && (rest[rest.length - 1]?.length ?? 0) === PAGE_SIZE;
      return { rows: all, truncated };
    },
    async count(q: Query) {
      return orEmpty(
        q.table,
        async () => {
          const res = await request({ table: q.table, params: { ...q.params, limit: "1" } }, { method: "HEAD", prefer: "count=exact" });
          const total = totalOf(res);
          if (total === null) throw new OverviewQueryError(q.table, res.status, "no count in the answer");
          return total;
        },
        0,
      );
    },
    async email(userId: string) {
      const cached = emailCache.get(userId);
      const now = Date.now();
      if (cached && now - cached.at < EMAIL_CACHE_MS) return cached.email;
      try {
        const res = await f(`${deps.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
          headers,
          signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
          cache: "no-store",
        });
        // a deleted account answers 404: remembered as no email
        if (!res.ok && res.status !== 404) return null;
        const body = res.ok ? ((await res.json().catch(() => null)) as { email?: unknown } | null) : null;
        const email = typeof body?.email === "string" && body.email ? body.email : null;
        emailCache.set(userId, { email, at: now });
        return email;
      } catch {
        return null;
      }
    },
  };
}

// ------------------------------------------------------------------ rows

export interface HealthRow {
  at: string;
  service: string;
  ok: boolean;
  latency_ms: number | null;
  detail: string | null;
}

export interface EventRow {
  at: string;
  source: EventSource;
  level: EventLevel;
  kind: string;
  code: string | null;
  message: string | null;
  route: string | null;
  user_id: string | null;
  board_id: string | null;
  request_id: string | null;
}

export interface UsageRow {
  route: string;
  user_id: string | null;
  created_at: string;
}

export interface ActivityRow {
  user_id: string | null;
  updated_at: string;
}

export interface BugRow {
  created_at: string;
  user_email: string | null;
  message: string | null;
  url: string | null;
}

// ------------------------------------------------------------------ aggregation (pure, exported for tests)

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** The current failing run of a service's checks (newest first): its first failure, and whether the run reaches past the rows. */
export function failingRun(rowsNewestFirst: readonly HealthRow[]): { since: string | null; complete: boolean } {
  if (!rowsNewestFirst.length || rowsNewestFirst[0].ok) return { since: null, complete: true };
  let since = rowsNewestFirst[0].at;
  for (const row of rowsNewestFirst) {
    if (row.ok) return { since, complete: true };
    since = row.at;
  }
  return { since, complete: false };
}

/** Each service's status from its checks of the last 24 h (newest first) and, for a service with none, its latest check before that. */
export function serviceStatuses(rows: readonly HealthRow[], older: Partial<Record<Service, HealthRow>> = {}, downSince: Partial<Record<Service, string>> = {}): ServiceStatus[] {
  return SERVICES.map((service) => {
    const mine = rows.filter((r) => r.service === service);
    const latest = mine[0] ?? older[service] ?? null;
    const passed = mine.filter((r) => r.ok).length;
    const run = failingRun(mine.length ? mine : latest ? [latest] : []);
    return {
      service,
      ok: latest ? latest.ok : null,
      lastCheckAt: latest?.at ?? null,
      latencyMs: latest && typeof latest.latency_ms === "number" ? latest.latency_ms : null,
      detail: latest?.detail ?? null,
      uptime24h: mine.length ? passed / mine.length : null,
      downSince: latest && !latest.ok ? (downSince[service] ?? run.since) : null,
    };
  });
}

const MONEY = "\\$\\s*(-?[\\d,]+(?:\\.\\d+)?)";
const LEFT_PATTERNS = [
  new RegExp(`${MONEY}\\s*(?:of\\s+)?(?:in\\s+)?(?:credits?\\s*|balance\\s*)?(?:left|remaining)`, "i"),
  new RegExp(`(?:credits?|balance)\\s*(?:left|remaining)?\\s*[:=]?\\s*${MONEY}`, "i"),
];
const USED_PATTERNS = [new RegExp(`${MONEY}\\s*used`, "i"), new RegExp(`used\\s*[:=]?\\s*${MONEY}`, "i")];

function money(detail: string, patterns: readonly RegExp[]): number | null {
  for (const p of patterns) {
    const m = p.exec(detail);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * OpenRouter's credit from a check's detail, as the health check writes it ("$12.40 credit left",
 * "credits left: $12.40", "$87.60 used"). Null numbers when it says neither.
 */
export function parseCredits(detail: string | null): { creditsLeftUsd: number | null; usedUsd: number | null } {
  if (!detail) return { creditsLeftUsd: null, usedUsd: null };
  return { creditsLeftUsd: money(detail, LEFT_PATTERNS), usedUsd: money(detail, USED_PATTERNS) };
}

/** The latest OpenRouter check (newest first) that names its credit; null without any OpenRouter check. */
export function openrouterCredits(rows: readonly HealthRow[], older?: HealthRow): AdminOverview["openrouter"] {
  const mine = rows.filter((r) => r.service === "openrouter");
  if (!mine.length && !older) return null;
  for (const row of mine.length ? mine : [older!]) {
    const parsed = parseCredits(row.detail);
    if (parsed.creditsLeftUsd !== null || parsed.usedUsd !== null) return parsed;
  }
  return { creditsLeftUsd: null, usedUsd: null };
}

/** The start of the UTC hour `t` falls in. */
export function hourStart(t: number): number {
  return Math.floor(t / HOUR_MS) * HOUR_MS;
}

/** 48 hours, oldest first, the last one the current hour; every hour present. */
export function perHour(events: readonly EventRow[], now: number): AdminOverview["errors"]["perHour"] {
  const last = hourStart(now);
  const first = last - 47 * HOUR_MS;
  const buckets = Array.from({ length: 48 }, (_, i) => ({ hour: new Date(first + i * HOUR_MS).toISOString(), errors: 0, warnings: 0 }));
  for (const e of events) {
    const t = time(e.at);
    if (!Number.isFinite(t) || t < first || t >= last + HOUR_MS) continue;
    const b = buckets[Math.floor((t - first) / HOUR_MS)];
    if (e.level === "error") b.errors += 1;
    else if (e.level === "warn") b.warnings += 1;
  }
  return buckets;
}

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** What groups two messages together: ids and numbers left out, case and spacing ignored. */
export function messageKey(message: string | null): string {
  return (message ?? "")
    .toLowerCase()
    .replace(UUID_ANYWHERE, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/g, "<id>")
    .replace(/\d+(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

type Sample = ErrorGroup["samples"][number] & { userId: string | null };
type GroupAcc = { group: Omit<ErrorGroup, "samples">; users: Set<string>; samples: Sample[] };

/** The grouping itself: newest-first events in, the top MAX_GROUPS out, samples still carrying user ids. */
function groupEvents(events24h: readonly EventRow[]): GroupAcc[] {
  const groups = new Map<string, GroupAcc>();
  for (const e of events24h) {
    if (e.level !== "error" && e.level !== "warn") continue;
    const key = `${e.kind}\u0000${e.code ?? ""}\u0000${messageKey(e.message)}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        users: new Set(),
        samples: [],
        group: { kind: e.kind, code: e.code ?? null, source: e.source, level: e.level, message: e.message ?? "", count: 0, users: 0, firstAt: e.at, lastAt: e.at },
      };
      groups.set(key, acc);
    }
    const g = acc.group;
    g.count += 1;
    if (e.user_id) acc.users.add(e.user_id);
    if (time(e.at) < time(g.firstAt)) g.firstAt = e.at;
    if (time(e.at) > time(g.lastAt)) {
      // the group reads as its latest event
      g.lastAt = e.at;
      g.message = e.message ?? "";
      g.source = e.source;
      g.level = e.level;
    }
    acc.samples.push({ at: e.at, userEmail: null, userId: e.user_id ?? null, boardId: e.board_id ?? null, route: e.route ?? null, requestId: e.request_id ?? null });
  }
  return [...groups.values()]
    .map((acc) => {
      acc.group.users = acc.users.size;
      acc.samples = acc.samples.sort((x, y) => time(y.at) - time(x.at)).slice(0, SAMPLES_PER_GROUP);
      return acc;
    })
    .sort((x, y) => y.group.count - x.group.count || time(y.group.lastAt) - time(x.group.lastAt))
    .slice(0, MAX_GROUPS);
}

/**
 * Errors and warnings of the last 24 h grouped by kind + code + message (ids and numbers aside),
 * most frequent first, at most MAX_GROUPS, each with its latest SAMPLES_PER_GROUP. A group reads as
 * its latest event; the samples' emails come from `emails` (user id -> email).
 */
export function errorGroups(events24h: readonly EventRow[], emails: ReadonlyMap<string, string | null> = new Map()): ErrorGroup[] {
  return groupEvents(events24h).map(({ group, samples }) => ({
    ...group,
    samples: samples.map(({ userId, ...s }) => ({ ...s, userEmail: userId ? (emails.get(userId) ?? null) : null })),
  }));
}

/** The users in the groups' samples (whose emails the page shows), at most MAX_EMAIL_LOOKUPS. */
export function sampleUserIds(events24h: readonly EventRow[]): string[] {
  const ids = new Set<string>();
  for (const acc of groupEvents(events24h)) for (const s of acc.samples) if (s.userId) ids.add(s.userId);
  return [...ids].slice(0, MAX_EMAIL_LOOKUPS);
}

/** The AI route an event is about: `model.live.solve` and `route.live.solve` are "live/solve". */
export function eventRoute(kind: string): string | null {
  const m = /^(?:model|route)\.(.+)$/.exec(kind);
  return m ? normalizeRoute(m[1]) : null;
}

/**
 * Per AI route, the last 24 h: calls (metered rows), failures (error events of `model.<route>` or
 * `route.<route>`, one per request id, so a model failure and the 5xx it caused count once) and
 * fallbacks (`model.<route>` with code `fallback`, one per request id). Every metered route is
 * listed; others only when something happened.
 */
export function aiRoutes(usage24h: readonly UsageRow[], events24h: readonly EventRow[], exactCalls?: ReadonlyMap<string, number>): AdminOverview["ai"]["routes"] {
  const calls = new Map<string, number>();
  if (exactCalls) for (const [route, n] of exactCalls) calls.set(normalizeRoute(route), (calls.get(normalizeRoute(route)) ?? 0) + n);
  else for (const u of usage24h) calls.set(normalizeRoute(u.route), (calls.get(normalizeRoute(u.route)) ?? 0) + 1);

  const failures = new Map<string, Set<string>>();
  const fallbacks = new Map<string, Set<string>>();
  events24h.forEach((e, i) => {
    const route = eventRoute(e.kind);
    if (!route) return;
    const id = e.request_id ?? `#${i}`;
    if (e.code === "fallback" && e.kind.startsWith("model.")) {
      if (!fallbacks.has(route)) fallbacks.set(route, new Set());
      fallbacks.get(route)!.add(id);
    } else if (e.level === "error") {
      if (!failures.has(route)) failures.set(route, new Set());
      failures.get(route)!.add(id);
    }
  });

  const routes = new Set<string>([...METERED_ROUTES, ...calls.keys(), ...failures.keys(), ...fallbacks.keys()]);
  return [...routes]
    .map((route) => ({
      route,
      calls24h: calls.get(route) ?? 0,
      failures24h: failures.get(route)?.size ?? 0,
      fallbacks24h: fallbacks.get(route)?.size ?? 0,
    }))
    .sort((a, b) => b.calls24h - a.calls24h || b.failures24h - a.failures24h || a.route.localeCompare(b.route));
}

/** Distinct users with a timestamp at or after `since`. */
export function distinctUsers(rows: ReadonlyArray<{ user_id: string | null; at: string }>, since: number): number {
  const users = new Set<string>();
  for (const r of rows) if (r.user_id && time(r.at) >= since) users.add(r.user_id);
  return users.size;
}

/** The path a bug report was sent from, without its origin, query or hash. */
export function reportPath(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url, "https://x.invalid").pathname || null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ money

/** One subscription as the money needs it (unlimited_subscriptions, service role). */
export interface SubscriptionRow {
  user_id: string | null;
  status: string | null;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  cancel_at: string | null;
  created_at: string;
}

/** How far ahead the money lists charges. */
export const UPCOMING_DAYS = 14;

const PAYING = new Set(["active"]);
const FAILING = new Set(["past_due", "unpaid"]);
const ENDED = new Set(["canceled", "incomplete_expired"]);

/**
 * The money section from every subscription: admins' own left out (the owner trying the checkout is
 * not revenue). Pure, so the tests can hold it to Stripe's statuses.
 */
export function moneyOverview(subs: readonly SubscriptionRow[], adminIds: ReadonlySet<string>, now: number, priceUsd = UNLIMITED_PLAN.monthlyUsd): AdminOverview["money"] {
  const mine = subs.filter((s) => !(s.user_id && adminIds.has(s.user_id)));
  const cancelling = (s: SubscriptionRow) => s.cancel_at_period_end === true || s.cancel_at !== null;
  const paying = mine.filter((s) => s.status !== null && PAYING.has(s.status));
  const trialing = mine.filter((s) => s.status === "trialing");
  const over = mine.filter((s) => s.trial_end !== null && time(s.trial_end) < now && s.status !== "trialing" && s.status !== "incomplete");
  const horizon = now + UPCOMING_DAYS * DAY_MS;
  const upcoming: AdminOverview["money"]["upcoming"] = [];
  for (const s of mine) {
    if (cancelling(s)) continue;
    const at = s.status === "trialing" ? s.trial_end : s.status === "active" ? s.current_period_end : null;
    if (!at || time(at) < now || time(at) >= horizon) continue;
    upcoming.push({ at, kind: s.status === "trialing" ? "first" : "renewal", usd: priceUsd });
  }
  upcoming.sort((a, b) => time(a.at) - time(b.at));
  return {
    priceUsd,
    paying: paying.length,
    payingCancelling: paying.filter(cancelling).length,
    mrrUsd: paying.filter((s) => !cancelling(s)).length * priceUsd,
    trialing: trialing.length,
    trialsCancelling: trialing.filter(cancelling).length,
    pipelineUsd: trialing.filter((s) => !cancelling(s)).length * priceUsd,
    failing: mine.filter((s) => s.status !== null && FAILING.has(s.status)).length,
    ended: mine.filter((s) => s.status !== null && ENDED.has(s.status)).length,
    trialsOver: over.length,
    trialsConverted: over.filter((s) => s.status !== null && PAYING.has(s.status)).length,
    started7d: mine.filter((s) => time(s.created_at) >= now - 7 * DAY_MS).length,
    upcoming,
  };
}

/** Distinct accounts (admins left out) that ever started a trial, and that pay now. */
export function funnelCounts(subs: readonly SubscriptionRow[], adminIds: ReadonlySet<string>): { trials: number; paying: number } {
  const users = (rows: readonly SubscriptionRow[]) => new Set(rows.map((s) => s.user_id).filter((id): id is string => Boolean(id) && !adminIds.has(id!))).size;
  return { trials: users(subs), paying: users(subs.filter((s) => s.status !== null && PAYING.has(s.status))) };
}

// ------------------------------------------------------------------ the overview

/**
 * Reads and aggregates everything the /admin page shows. Two rounds of parallel requests: the
 * tables, then what they call for (more pages, a long outage's start, a service's last check before
 * the window, the samples' emails).
 */
export async function buildAdminOverview(deps: OverviewDeps): Promise<AdminOverview> {
  const now = deps.now ?? Date.now();
  const rest = restClient(deps);
  const iso = (t: number) => new Date(t).toISOString();
  const since24 = now - DAY_MS;
  const since7d = now - 7 * DAY_MS;
  const since48 = hourStart(now) - 47 * HOUR_MS;

  const [health, events, errors24hTotal, usage, unlimited, learning, attempts24h, solvedAlone24h, usersTotal, signups24h, signups7d, bugs, subs, admins, onboarded] = await Promise.all([
    rest.paged<HealthRow>({ table: "health_checks", params: { select: "at,service,ok,latency_ms,detail", at: `gte.${iso(since24)}`, order: "at.desc" } }),
    rest.paged<EventRow>({
      table: "app_events",
      params: { select: "at,source,level,kind,code,message,route,user_id,board_id,request_id", at: `gte.${iso(since48)}`, source: "neq.health", level: "in.(error,warn)", order: "at.desc" },
    }),
    rest.count({ table: "app_events", params: { select: "id", at: `gte.${iso(since24)}`, source: "neq.health", level: "eq.error" } }),
    rest.paged<UsageRow>({ table: "usage_events", params: { select: "route,user_id,created_at", created_at: `gte.${iso(since7d)}`, order: "created_at.desc" } }),
    rest.paged<UsageRow>({ table: "unlimited_usage", params: { select: "route,user_id,created_at", created_at: `gte.${iso(since7d)}`, order: "created_at.desc" } }),
    rest.paged<ActivityRow>({ table: "learning_attempts", params: { select: "user_id,updated_at", updated_at: `gte.${iso(since7d)}`, order: "updated_at.desc" } }),
    rest.count({ table: "learning_attempts", params: { select: "id", started_at: `gte.${iso(since24)}` } }),
    rest.count({ table: "learning_attempts", params: { select: "id", started_at: `gte.${iso(since24)}`, outcome: "in.(first_try,self_corrected)" } }),
    rest.count({ table: "profiles", params: { select: "user_id" } }),
    rest.count({ table: "profiles", params: { select: "user_id", created_at: `gte.${iso(since24)}` } }),
    rest.count({ table: "profiles", params: { select: "user_id", created_at: `gte.${iso(since7d)}` } }),
    rest.rows<BugRow>({ table: "bug_reports", params: { select: "created_at,user_email,message,url:diagnostics->>url", order: "created_at.desc", limit: String(BUG_REPORTS) } }),
    rest.paged<SubscriptionRow>({
      table: "unlimited_subscriptions",
      params: { select: "user_id,status,trial_end,current_period_end,cancel_at_period_end,cancel_at,created_at", order: "created_at.desc" },
    }),
    rest.rows<{ user_id: string }>({ table: "admins", params: { select: "user_id" } }),
    rest.count({ table: "profiles", params: { select: "user_id", onboarded_at: "not.is.null" } }),
  ]);

  const events24h = events.rows.filter((e) => time(e.at) >= since24);
  const metered24h = [...usage.rows, ...unlimited.rows].filter((u) => time(u.created_at) >= since24);
  // Past the cap the newest 5,000 may not reach back a day: count each route's calls exactly instead.
  const usageShort = (r: { rows: UsageRow[]; truncated: boolean }) => r.truncated && time(r.rows[r.rows.length - 1]?.created_at) > since24;
  const needExactCalls = usageShort(usage) || usageShort(unlimited);

  // Round two: what the tables call for.
  const missing = SERVICES.filter((service) => !health.rows.some((r) => r.service === service));
  const longOutages = SERVICES.filter((service) => {
    const mine = health.rows.filter((r) => r.service === service);
    return mine.length > 0 && !failingRun(mine).complete;
  });
  const [older, outageStarts, emailList, exactCalls] = await Promise.all([
    Promise.all(missing.map(async (service) => [service, await latestCheck(rest, service)] as const)),
    Promise.all(longOutages.map(async (service) => [service, await outageStart(rest, service)] as const)),
    Promise.all(sampleUserIds(events24h).map(async (id) => [id, await rest.email(id)] as const)),
    needExactCalls ? exactCallCounts(rest, iso(since24)) : Promise.resolve(undefined),
  ]);
  const olderBy: Partial<Record<Service, HealthRow>> = {};
  for (const [service, row] of older) if (row) olderBy[service] = row;
  // A service unchecked for a day whose last check failed (rare: the checks stopped mid-outage).
  const staleOutages = await Promise.all(
    older.filter(([, row]) => row && !row.ok).map(async ([service, row]) => [service, (await outageStart(rest, service)) ?? row!.at] as const),
  );
  const downSince: Partial<Record<Service, string>> = {};
  for (const [service, start] of [...outageStarts, ...staleOutages]) if (start) downSince[service] = start;

  if (usage.truncated || unlimited.truncated || learning.truncated) {
    log.warn({ usage: usage.rows.length, unlimited: unlimited.rows.length, learning: learning.rows.length }, "admin overview: a week of activity passed the row cap; active-user counts are a lower bound");
  }
  if (events.truncated) log.warn({ events: events.rows.length }, "admin overview: 48 h of events passed the row cap; older hours and groups are partial");

  const activity = [
    ...usage.rows.map((u) => ({ user_id: u.user_id, at: u.created_at })),
    ...unlimited.rows.map((u) => ({ user_id: u.user_id, at: u.created_at })),
    ...learning.rows.map((l) => ({ user_id: l.user_id, at: l.updated_at })),
  ];
  const emails = new Map(emailList);
  const adminIds = new Set(admins.map((a) => a.user_id));
  if (subs.truncated) log.warn({ subscriptions: subs.rows.length }, "admin overview: more subscriptions than the row cap; money is partial");

  return {
    generatedAt: iso(now),
    services: serviceStatuses(health.rows, olderBy, downSince),
    openrouter: openrouterCredits(health.rows, olderBy.openrouter),
    errors: {
      total24h: errors24hTotal,
      users24h: new Set(events24h.filter((e) => e.level === "error" && e.user_id).map((e) => e.user_id)).size,
      perHour: perHour(events.rows, now),
      groups: errorGroups(events24h, emails),
    },
    ai: { routes: aiRoutes(metered24h, events24h, exactCalls) },
    users: {
      total: usersTotal,
      signups24h,
      signups7d,
      active24h: distinctUsers(activity, since24),
      active7d: distinctUsers(activity, since7d),
    },
    money: moneyOverview(subs.rows, adminIds, now),
    funnel: { accounts: usersTotal, onboarded, ...funnelCounts(subs.rows, adminIds) },
    learning: { attempts24h, solvedAlone24h },
    bugReports: bugs.map((b) => ({
      at: b.created_at,
      email: b.user_email ?? null,
      message: (b.message ?? "").slice(0, 2_000),
      path: reportPath(b.url),
    })),
  };
}

/** A service's latest check, however old. */
async function latestCheck(rest: Rest, service: Service): Promise<HealthRow | null> {
  const [row] = await rest.rows<HealthRow>({ table: "health_checks", params: { select: "at,service,ok,latency_ms,detail", service: `eq.${service}`, order: "at.desc", limit: "1" } });
  return row ?? null;
}

/** When a service's current outage began: the first failure after its last passing check (or its first check ever). */
async function outageStart(rest: Rest, service: Service): Promise<string | null> {
  const select = "at";
  const [lastOk] = await rest.rows<{ at: string }>({ table: "health_checks", params: { select, service: `eq.${service}`, ok: "eq.true", order: "at.desc", limit: "1" } });
  const [first] = await rest.rows<{ at: string }>({
    table: "health_checks",
    params: { select, service: `eq.${service}`, ...(lastOk ? { at: `gt.${lastOk.at}` } : {}), order: "at.asc", limit: "1" },
  });
  return first?.at ?? null;
}

/** Each metered route's exact calls since `sinceIso`, for a day busier than the row cap. */
async function exactCallCounts(rest: Rest, sinceIso: string): Promise<Map<string, number>> {
  const counts = await Promise.all(
    METERED_ROUTES.map(async (route) => {
      const [paid, unlimited] = await Promise.all([
        rest.count({ table: "usage_events", params: { select: "id", route: `eq.${route}`, created_at: `gte.${sinceIso}` } }),
        rest.count({ table: "unlimited_usage", params: { select: "id", route: `eq.${route}`, created_at: `gte.${sinceIso}` } }),
      ]);
      return [route, paid + unlimited] as const;
    }),
  );
  return new Map(counts);
}
