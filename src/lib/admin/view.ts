/**
 * The /admin page's words and numbers: pure functions from an `AdminOverview` (the contract,
 * `src/lib/admin/contracts.ts`) to what each section shows. No React, no network, no browser API at
 * module scope, so the page renders from fixtures and every line of copy is tested
 * (src/lib/admin/__tests__/view.test.ts). Times are formatted in the viewer's time zone, or the one a
 * test passes.
 */
import { ALERT_RULES, SERVICES, type AdminOverview, type ErrorGroup, type EventLevel, type EventSource, type HealthResult, type Service, type ServiceStatus } from "./contracts";

export interface ViewClock {
  /** ms since the epoch: what "now" is for relative times and staleness */
  now: number;
  /** IANA zone; the runtime's own when absent */
  timeZone?: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A service whose last check is older than this is "not checked lately" (checks run every 5 minutes). */
export const STALE_AFTER_MS = 15 * 60_000;

/** How often the page reads the overview again while it is visible. */
export const AUTO_REFRESH_MS = 60_000;

export const ADMIN_COPY = {
  title: "Admin",
  overviewTitle: "Overview",
  documentTitle: "Admin · Agathon",
  notFoundTitle: "Not found · Agathon",
  back: "My whiteboards",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  updated: (rel: string) => `Updated ${rel}`,
  autoRefresh: "Refreshes every minute while this page is open.",
  loadFailedTitle: "Couldn't load the overview",
  loadFallback: "Something went wrong reading the overview. Try again in a moment.",
  badShape: "The overview came back in a shape this page doesn't know. The page and the server may be from different releases: reload the page.",
  retry: "Try again",

  statusTitle: "Status",
  statusHint: "Each service is checked every 5 minutes. Uptime is the share of checks that passed in the last 24 hours.",
  checkNow: "Check now",
  checking: "Checking…",
  checkDone: "Checked just now.",
  checkFailed: (message: string) => `The check didn't run: ${message}`,
  liveCheckTitle: "Live check (just now)",

  errorsTitle: "Errors students saw",
  errorsHint: "Errors on the board and in Ask, crashes in the browser, and server and AI failures. Health checks are under Status.",
  topIssuesTitle: "Top open issues, last 7 days",
  groupsTitle: "Grouped, last 24 hours",
  chartTitle: "Errors and warnings per hour, last 48 hours",
  groupsEmpty: "Nothing went wrong in the last 24 hours.",
  samplesToggle: (n: number) => (n === 1 ? "See the latest one" : `See the latest ${n}`),
  signedOut: "signed out",
  openBoard: "Board",

  aiTitle: "AI",
  aiHint: "Each AI route over the last 24 hours. A failed call is refunded, so calls are the ones that went through; failure % is failures out of calls plus failures.",
  aiEmpty: "No AI calls in the last 24 hours.",
  aiIdle: (labels: string) => `No calls in 24 hours: ${labels}.`,
  aiColumns: { route: "Route", calls: "Calls", failures: "Failed", rate: "Failure %", fallbacks: "Fallbacks" },

  moneyTitle: "Money",
  moneyHint: "Agathon Unlimited, from Stripe's webhooks. Admin accounts are left out. Monthly revenue counts paying plans not set to cancel.",
  upcomingTitle: "Charges in the next 14 days",
  upcomingEmpty: "No charges in the next 14 days.",
  usersTitle: "Users and learning",
  usersHint: "Active means an AI call or a problem worked on a board.",

  bugsTitle: "Bug reports",
  bugsHint: "The newest reports nobody has looked at yet.",
  bugsFallbackHint: "The latest 20.",
  liveTitle: "Live now",
  bugsEmpty: "No bug reports yet.",
  noMessage: "(no message)",
  noEmail: "no email",
} as const;

// ------------------------------------------------------------------ numbers and times

const NUMBER = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return NUMBER.format(Math.round(n));
}

/** "1 error", "23 errors" */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "142 ms", "1.2 s", "12 s" */
export function formatLatency(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  if (Math.round(ms) < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}

/**
 * "100%", "99.6%", "94%", "0%": one decimal at most, rounded down, so a share just under 1 never
 * reads 100% (an uptime that was not perfect), and a share above 0 never reads 0% ("<0.1%").
 */
export function formatPercent(ratio: number | null): string | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  const pct = Math.min(1, Math.max(0, ratio)) * 100;
  const down = Math.floor(pct * 10 + 1e-9) / 10;
  if (down === 0 && pct > 0) return "<0.1%";
  return `${down.toFixed(1).replace(/\.0$/, "")}%`;
}

/** "$12.40" */
export function formatUsd(usd: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(usd);
}

/** "just now", "4 min ago", "2 h ago", "1 day ago", "3 days ago" */
export function relativeTime(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const ago = Math.max(0, now - t);
  if (ago < 45_000) return "just now";
  const min = Math.round(ago / 60_000);
  if (min < 60) return `${Math.max(1, min)} min ago`;
  const h = Math.floor(ago / HOUR_MS);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(ago / DAY_MS);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

/** The calendar date of `t` in the zone. */
function calendarDate(t: number, timeZone?: string): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return [get("year"), get("month"), get("day")];
}

/** Whole calendar days from `t` to now in the zone (0 today, 1 yesterday). */
export function daysBefore(t: number, clock: ViewClock): number {
  const [y1, m1, d1] = calendarDate(t, clock.timeZone);
  const [y2, m2, d2] = calendarDate(clock.now, clock.timeZone);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

/** "3:42 PM" */
export function clockTime(t: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(t));
}

/** "3:42 PM" today, "yesterday, 3:42 PM", "Oct 3, 3:42 PM" before that. */
export function formatWhen(iso: string, clock: ViewClock): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const time = clockTime(t, clock.timeZone);
  const days = daysBefore(t, clock);
  if (days === 0) return time;
  if (days === 1) return `yesterday, ${time}`;
  const date = new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, month: "short", day: "numeric" }).format(new Date(t));
  return `${date}, ${time}`;
}

// ------------------------------------------------------------------ services

export const SERVICE_NAMES: Record<Service, string> = {
  app: "App",
  database: "Database",
  openrouter: "OpenRouter AI",
  mathpix: "Mathpix handwriting",
  email: "Email",
  stripe: "Stripe",
};

/** What each service is for, under its name. */
export const SERVICE_ROLES: Record<Service, string> = {
  app: "The site answers",
  database: "Supabase Postgres",
  openrouter: "Every model call",
  mathpix: "Handwriting to maths",
  email: "Resend: welcome, reminders, alerts",
  stripe: "Ink packs and Unlimited",
};

export type ServiceState = "up" | "down" | "stale" | "unknown";

export const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  up: "Up",
  down: "Down",
  stale: "Not checked lately",
  unknown: "Not checked yet",
};

/**
 * Up or down by the last check; a failing service stays down however old its check. A passing one
 * whose check is older than STALE_AFTER_MS is "not checked lately": the checks may have stopped.
 */
export function serviceState(s: Pick<ServiceStatus, "ok" | "lastCheckAt">, now: number): ServiceState {
  if (s.ok === null || !s.lastCheckAt) return "unknown";
  if (!s.ok) return "down";
  const t = Date.parse(s.lastCheckAt);
  if (!Number.isFinite(t) || now - t > STALE_AFTER_MS) return "stale";
  return "up";
}

export interface ServiceCardView {
  service: Service;
  name: string;
  role: string;
  state: ServiceState;
  stateLabel: string;
  /** the line under the name when it adds to the state: "Down since 3:42 PM", "Last check 2 h ago", "No check yet"; null when up */
  headline: string | null;
  latency: string | null;
  /** "99.7% up in 24 h" */
  uptime: string | null;
  /** "Checked 2 min ago" */
  lastCheck: string | null;
  /** the check's own words: why it failed, or "$12.40 credit left" */
  detail: string | null;
  /** OpenRouter's credit is under the alert line */
  lowCredit: boolean;
}

function downSinceText(s: ServiceStatus, clock: ViewClock): string | null {
  const since = s.downSince ?? s.lastCheckAt;
  return since ? formatWhen(since, clock) : null;
}

export function serviceCard(s: ServiceStatus, clock: ViewClock, openrouter: AdminOverview["openrouter"] = null): ServiceCardView {
  const state = serviceState(s, clock.now);
  const since = downSinceText(s, clock);
  const rel = relativeTime(s.lastCheckAt, clock.now);
  const headline =
    state === "down"
      ? since
        ? `Down since ${since}`
        : "Down"
      : state === "up"
        ? null
        : state === "stale"
          ? rel
            ? `Last check ${rel}`
            : "No recent check"
          : "No check yet";
  const uptime = formatPercent(s.uptime24h);
  const credit = s.service === "openrouter" ? openrouter?.creditsLeftUsd ?? null : null;
  return {
    service: s.service,
    name: SERVICE_NAMES[s.service],
    role: SERVICE_ROLES[s.service],
    state,
    stateLabel: SERVICE_STATE_LABELS[state],
    headline,
    latency: formatLatency(s.latencyMs),
    uptime: uptime ? `${uptime} up in 24 h` : null,
    lastCheck: rel ? `Checked ${rel}` : null,
    detail: s.detail?.trim() ? s.detail.trim() : null,
    lowCredit: credit !== null && credit < ALERT_RULES.lowCreditsUsd,
  };
}

/** Every service in the contract's order: a service the overview leaves out reads as never checked. */
export function serviceCards(overview: Pick<AdminOverview, "services" | "openrouter">, clock: ViewClock): ServiceCardView[] {
  const byService = new Map(overview.services.map((s) => [s.service, s]));
  return SERVICES.map((service) =>
    serviceCard(byService.get(service) ?? { service, ok: null, lastCheckAt: null, latencyMs: null, detail: null, uptime24h: null, downSince: null }, clock, overview.openrouter),
  );
}

export type SummaryTone = "ok" | "down" | "warn" | "unknown";

export interface StatusSummaryView {
  tone: SummaryTone;
  text: string;
}

/** "A", "A and B", "A, B and C" */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The big line at the top: what is down and since when, or that the checks stopped, or all normal.
 *   "All systems normal" · "Mathpix is down since 3:42 PM" · "Mathpix and Stripe are down since 3:42 PM"
 *   "4 services are down: …" · "Checks have stopped: the last one was 2 h ago" · "No health checks yet"
 */
export function statusSummary(cards: readonly ServiceCardView[], services: readonly ServiceStatus[], clock: ViewClock): StatusSummaryView {
  const down = cards.filter((c) => c.state === "down");
  if (down.length > 0) {
    const sinceTimes = down
      .map((c) => services.find((s) => s.service === c.service))
      .map((s) => (s ? Date.parse(s.downSince ?? s.lastCheckAt ?? "") : NaN))
      .filter(Number.isFinite);
    const earliest = sinceTimes.length ? Math.min(...sinceTimes) : null;
    const since = earliest !== null ? ` since ${formatWhen(new Date(earliest).toISOString(), clock)}` : "";
    if (down.length === 1) return { tone: "down", text: `${down[0].name} is down${since}` };
    if (down.length <= 3) return { tone: "down", text: `${listWords(down.map((c) => c.name))} are down${since}` };
    return { tone: "down", text: `${down.length} services are down: ${listWords(down.map((c) => c.name))}` };
  }
  if (cards.every((c) => c.state === "unknown")) return { tone: "unknown", text: "No health checks yet" };
  const stale = cards.filter((c) => c.state === "stale");
  if (stale.length > 0) {
    const latest = Math.max(...services.map((s) => Date.parse(s.lastCheckAt ?? "")).filter(Number.isFinite));
    const rel = Number.isFinite(latest) ? relativeTime(new Date(latest).toISOString(), clock.now) : null;
    if (stale.length === cards.filter((c) => c.state !== "unknown").length) {
      return { tone: "warn", text: rel ? `Checks have stopped: the last one was ${rel}` : "Checks have stopped" };
    }
    return { tone: "warn", text: `${listWords(stale.map((c) => c.name))} ${stale.length === 1 ? "hasn't" : "haven't"} been checked lately` };
  }
  const unknown = cards.filter((c) => c.state === "unknown");
  if (unknown.length > 0) {
    return { tone: "ok", text: `All checked systems normal · ${listWords(unknown.map((c) => c.name))} not checked yet` };
  }
  return { tone: "ok", text: "All systems normal" };
}

/**
 * "Check now" answers with the checks it just ran, in whichever shape the health route sends them:
 * an array of HealthResult, or an object holding one under `results` or `checks`. Anything else is
 * null (the page then just reloads the overview).
 */
export function parseHealthResults(body: unknown): HealthResult[] | null {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object"
      ? ((body as Record<string, unknown>).results ?? (body as Record<string, unknown>).checks)
      : null;
  if (!Array.isArray(list)) return null;
  const out: HealthResult[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.service !== "string" || !(SERVICES as readonly string[]).includes(r.service) || typeof r.ok !== "boolean") continue;
    out.push({
      service: r.service as Service,
      ok: r.ok,
      latencyMs: typeof r.latencyMs === "number" && Number.isFinite(r.latencyMs) ? r.latencyMs : 0,
      detail: typeof r.detail === "string" ? r.detail : undefined,
      at: typeof r.at === "string" ? r.at : new Date().toISOString(),
    });
  }
  return out.length ? out : null;
}

/** A live check's results as service statuses (no uptime: one check is not a day). */
export function statusesFromResults(results: readonly HealthResult[]): ServiceStatus[] {
  return results.map((r) => ({
    service: r.service,
    ok: r.ok,
    lastCheckAt: r.at,
    latencyMs: r.latencyMs,
    detail: r.detail ?? null,
    uptime24h: null,
    downSince: r.ok ? null : r.at,
  }));
}

// ------------------------------------------------------------------ errors

/** The words for an event kind (contracts.ts, EVENT_KIND conventions), so a group reads at a glance. */
const LIVE_KIND_LABELS: Record<string, string> = {
  "live.solve": "Solve failed",
  "live.recognize": "Couldn't read handwriting",
  "live.check": "Checking work failed",
  "live.capabilities": "Live couldn't start",
  "live.chat": "Ask failed",
  "live.save": "Board didn't save",
  "live.ink": "Out of ink",
  "live.setup": "Word-problem setup failed",
  "live.reread": "Second read failed",
  "live.proof": "Proof help failed",
  "live.lecture": "Lecture mode failed",
  "live.sketch": "Lecture drawing failed",
  "live.listen": "Lecture listening failed",
  "live.title": "Board naming failed",
  "client.boundary": "Page crashed",
  "client.error": "Browser error",
  "client.rejection": "Browser error (promise)",
  mathpix: "Mathpix failed",
};

/** What each AI route does, in the AI table and in kind labels. */
export const ROUTE_LABELS: Record<string, { label: string; metered: boolean }> = {
  "live/recognize": { label: "Handwriting reading", metered: true },
  "live/check": { label: "Checking work", metered: true },
  "live/solve": { label: "Solve", metered: true },
  "live/setup": { label: "Word-problem setup", metered: true },
  "live/reread": { label: "Second read", metered: true },
  "live/proof": { label: "Proofs", metered: true },
  "live/chat": { label: "Ask (board chat)", metered: true },
  "live/lecture": { label: "Lecture director", metered: true },
  "live/sketch": { label: "Lecture drawings", metered: true },
  "live/listen": { label: "Lecture listening", metered: true },
  "live/title": { label: "Board naming", metered: false },
};

/**
 * A route as the AI table keys it: "live.solve", "/api/live/solve" and "live/solve" are all
 * "live/solve"; the lecture sub-routes take their metered names (sketch, listen).
 */
export function normalizeRoute(route: string): string {
  const r = route
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/^api\//, "")
    .replace(/\./g, "/")
    .replace(/\/+$/, "");
  if (r === "live/lecture/sketch") return "live/sketch";
  if (r === "live/lecture/token") return "live/listen";
  return r;
}

export function routeLabel(route: string): string {
  return ROUTE_LABELS[normalizeRoute(route)]?.label ?? normalizeRoute(route);
}

const MODEL_CODE_LABELS: Record<string, string> = {
  timeout: "model timed out",
  upstream: "model error",
  invalid: "model reply unusable",
  fallback: "used the backup model",
  rate_limited: "model rate limited",
};

/**
 * A short readable label for an event's kind (and code):
 *   live.solve → "Solve failed"; route.live.solve → "Solve: server error";
 *   model.live.chat + timeout → "Ask (board chat): model timed out"; health.mathpix → "Mathpix handwriting check failed".
 */
export function kindLabel(kind: string, code: string | null = null): string {
  const known = LIVE_KIND_LABELS[kind];
  if (known) return known;
  const route = /^route\.(.+)$/.exec(kind);
  if (route) return `${routeLabel(route[1])}: server error`;
  const model = /^model\.(.+)$/.exec(kind);
  if (model) return `${routeLabel(model[1])}: ${(code && MODEL_CODE_LABELS[code]) || "model failed"}`;
  const health = /^health\.(.+)$/.exec(kind);
  if (health) {
    const name = (SERVICE_NAMES as Record<string, string>)[health[1]] ?? health[1];
    return `${name} check failed`;
  }
  const live = /^live\.(.+)$/.exec(kind);
  if (live) return `${live[1].replace(/[._-]+/g, " ")} failed`.replace(/^./, (c) => c.toUpperCase());
  const client = /^client\.(.+)$/.exec(kind);
  if (client) return "Browser error";
  return kind;
}

export const SOURCE_LABELS: Record<EventSource, string> = {
  client: "Browser",
  live: "Board",
  server: "Server",
  health: "Health check",
};

export const LEVEL_LABELS: Record<EventLevel, string> = {
  error: "Error",
  warn: "Warning",
  info: "Info",
};

/** "23 errors · 7 students"; "No errors in the last 24 hours"; signed-out errors touch no student. */
export function errorTotalsLine(total: number, users: number): string {
  if (total === 0) return "No errors in the last 24 hours";
  const who = users === 0 ? "no signed-in students" : plural(users, "student");
  return `${plural(total, "error")} · ${who}`;
}

export interface ErrorSampleView {
  key: string;
  when: string;
  /** "student@example.com", or "signed out" */
  who: string;
  boardHref: string | null;
  /** the board id's first 8 characters, for the link text */
  boardShort: string | null;
  route: string | null;
  requestId: string | null;
}

export interface ErrorGroupView {
  key: string;
  kind: string;
  label: string;
  code: string | null;
  level: EventLevel;
  levelLabel: string;
  sourceLabel: string;
  message: string;
  /** "12 times" */
  count: string;
  /** "5 students" / "no signed-in student" */
  users: string;
  /** "Last 4 min ago" */
  lastSeen: string;
  /** "First 2:10 PM" */
  firstSeen: string;
  samples: ErrorSampleView[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function errorGroupView(g: ErrorGroup, clock: ViewClock, index = 0): ErrorGroupView {
  return {
    key: `${g.kind}|${g.code ?? ""}|${index}`,
    kind: g.kind,
    label: kindLabel(g.kind, g.code),
    code: g.code,
    level: g.level,
    levelLabel: LEVEL_LABELS[g.level],
    sourceLabel: SOURCE_LABELS[g.source],
    message: g.message.trim() || "(no message)",
    count: plural(g.count, "time"),
    users: g.users === 0 ? "no signed-in student" : plural(g.users, "student"),
    lastSeen: `Last ${relativeTime(g.lastAt, clock.now) ?? formatWhen(g.lastAt, clock)}`,
    firstSeen: `First ${formatWhen(g.firstAt, clock)}`,
    samples: g.samples.map((s, i) => ({
      key: `${s.at}|${s.requestId ?? i}`,
      when: formatWhen(s.at, clock),
      who: s.userEmail ?? ADMIN_COPY.signedOut,
      boardHref: s.boardId && UUID.test(s.boardId) ? `/board/${s.boardId}` : null,
      boardShort: s.boardId && UUID.test(s.boardId) ? s.boardId.slice(0, 8) : null,
      route: s.route,
      requestId: s.requestId,
    })),
  };
}

// ------------------------------------------------------------------ the 48-hour chart

export interface ErrorChartBar {
  hour: string;
  errors: number;
  warnings: number;
  /** share of the scale's top, 0..1 */
  errorRatio: number;
  warningRatio: number;
  /** "3 PM" (the hour it starts) */
  time: string;
  /** "Today, 3 PM" / "Yesterday, 3 PM" / "Sat, 3 PM" */
  day: string;
  /** a label under the axis, or null */
  axisLabel: string | null;
  isNow: boolean;
  /** "Today, 3 PM: 4 errors, 1 warning" for the screen reader and the tooltip */
  label: string;
}

export interface ErrorChartView {
  bars: ErrorChartBar[];
  ticks: { value: number; label: string; ratio: number }[];
  /** the sentence under the chart */
  summary: string;
  hasData: boolean;
}

/** The scale's top: the smallest of 1, 2, 5, 10, 20, 50… at or above the highest bar. */
export function niceMax(n: number): number {
  if (n <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(n));
  for (const step of [1, 2, 5, 10]) if (step * pow >= n) return step * pow;
  return 10 * pow;
}

function hourLabel(t: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric" }).format(new Date(t));
}

function hourOfDay(t: number, timeZone?: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(t)).find((p) => p.type === "hour")?.value;
  return Number(h ?? 0) % 24;
}

function dayWord(t: number, clock: ViewClock): string {
  const days = daysBefore(t, clock);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, weekday: "short" }).format(new Date(t));
}

/**
 * The perHour series as stacked columns (errors at the baseline, warnings above), the last bar the
 * current hour. Axis labels name each midnight (the weekday) and noon, clear of the chart's ends,
 * plus "Now" under the last bar.
 */
export function buildErrorChart(perHour: AdminOverview["errors"]["perHour"], clock: ViewClock): ErrorChartView {
  const highest = perHour.reduce((m, h) => Math.max(m, h.errors + h.warnings), 0);
  const top = niceMax(highest);
  const last = perHour.length - 1;
  const bars = perHour.map((h, i): ErrorChartBar => {
    const t = Date.parse(h.hour);
    const hod = hourOfDay(t, clock.timeZone);
    const time = hourLabel(t, clock.timeZone);
    const day = dayWord(t, clock);
    const isNow = i === last;
    // "Now" sits under the last bar: nothing else within 7 bars of it, or 3 of the start
    const nearEdge = i < 3 || i > last - 8;
    const axisLabel = isNow ? "Now" : nearEdge ? null : hod === 0 ? new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, weekday: "short" }).format(new Date(t)) : hod === 12 ? "12 PM" : null;
    const counts = h.errors + h.warnings === 0 ? "nothing" : [plural(h.errors, "error"), plural(h.warnings, "warning")].join(", ");
    return {
      hour: h.hour,
      errors: h.errors,
      warnings: h.warnings,
      errorRatio: h.errors / top,
      warningRatio: h.warnings / top,
      time,
      day,
      axisLabel,
      isNow,
      label: `${day}, ${time}${isNow ? " (this hour)" : ""}: ${counts}`,
    };
  });
  const ticks = (top >= 2 && top % 2 === 0 ? [top / 2, top] : [top]).map((value) => ({ value, label: formatCount(value), ratio: value / top }));

  let summary: string;
  if (highest === 0) {
    summary = "No errors or warnings in the last 48 hours.";
  } else {
    const errors = perHour.reduce((n, h) => n + h.errors, 0);
    const warnings = perHour.reduce((n, h) => n + h.warnings, 0);
    const peakIndex = perHour.reduce((best, h, i) => (h.errors > perHour[best].errors ? i : best), 0);
    const peak = bars[peakIndex];
    const total = `${plural(errors, "error")} and ${plural(warnings, "warning")} in 48 hours.`;
    const peakDay = peak.day === "Today" || peak.day === "Yesterday" ? peak.day.toLowerCase() : peak.day;
    summary = errors > 0 ? `${total} The worst hour: ${plural(peak.errors, "error")}, ${peakDay} at ${peak.time}.` : total;
  }
  return { bars, ticks, summary, hasData: highest > 0 };
}

// ------------------------------------------------------------------ AI

export type RateTone = "ok" | "warn" | "bad";

export interface AiRowView {
  route: string;
  label: string;
  calls: string;
  failures: string;
  rate: string;
  fallbacks: string;
  tone: RateTone;
  /** an icon-free word for the tone, for screen readers and colour-blind eyes */
  toneLabel: string | null;
}

/** Failures out of calls plus failures (a failed call is refunded, so it is not among the calls). */
export function failureRate(calls: number, failures: number): number | null {
  const attempts = calls + failures;
  return attempts > 0 ? failures / attempts : null;
}

/** 5 % or more is worth a look; 20 % or more (at least 3 failures) is bad. */
export function rateTone(calls: number, failures: number): RateTone {
  const rate = failureRate(calls, failures);
  if (rate === null || failures === 0) return "ok";
  if (rate >= 0.2 && failures >= 3) return "bad";
  if (rate >= 0.05) return "warn";
  return "ok";
}

export interface AiTableView {
  rows: AiRowView[];
  /** the routes with nothing in 24 hours, named in one line under the table */
  idle: string | null;
  empty: boolean;
}

export function buildAiTable(routes: AdminOverview["ai"]["routes"]): AiTableView {
  const active = routes.filter((r) => r.calls24h + r.failures24h + r.fallbacks24h > 0);
  const idle = routes.filter((r) => r.calls24h + r.failures24h + r.fallbacks24h === 0);
  const rows = [...active]
    .sort((a, b) => b.calls24h - a.calls24h || b.failures24h - a.failures24h || a.route.localeCompare(b.route))
    .map((r): AiRowView => {
      const tone = rateTone(r.calls24h, r.failures24h);
      const metered = ROUTE_LABELS[normalizeRoute(r.route)]?.metered ?? true;
      const rate = failureRate(r.calls24h, r.failures24h);
      return {
        route: normalizeRoute(r.route),
        label: routeLabel(r.route),
        calls: metered ? formatCount(r.calls24h) : "—",
        failures: formatCount(r.failures24h),
        rate: !metered || rate === null ? "—" : (formatPercent(rate) ?? "—"),
        fallbacks: formatCount(r.fallbacks24h),
        // an unmetered route has no rate to judge: its failures speak for themselves
        tone: metered ? tone : "ok",
        toneLabel: !metered ? null : tone === "bad" ? "High" : tone === "warn" ? "Watch" : null,
      };
    });
  return {
    rows,
    idle: idle.length ? ADMIN_COPY.aiIdle(listWords(idle.map((r) => routeLabel(r.route)))) : null,
    empty: rows.length === 0,
  };
}

// ------------------------------------------------------------------ users and learning

export interface StatTile {
  key: "accounts" | "signups" | "active" | "problems" | "mrr" | "trials" | "due" | "converted" | "signupToTrial" | "lost";
  value: string;
  label: string;
  hint: string;
}

export function statTiles(users: AdminOverview["users"], learning: AdminOverview["learning"]): StatTile[] {
  const alone = learning.attempts24h > 0 ? formatPercent(learning.solvedAlone24h / learning.attempts24h) : null;
  return [
    { key: "accounts", value: formatCount(users.total), label: "Accounts", hint: `${formatCount(users.signups24h)} new today` },
    { key: "signups", value: formatCount(users.signups7d), label: "New this week", hint: "Sign-ups, last 7 days" },
    { key: "active", value: formatCount(users.active24h), label: "Active today", hint: `${formatCount(users.active7d)} this week` },
    {
      key: "problems",
      value: formatCount(learning.attempts24h),
      label: "Problems today",
      hint: alone ? `${formatCount(learning.solvedAlone24h)} solved alone (${alone})` : "None worked yet",
    },
  ];
}

/** "80 accounts → 59 finished the welcome → 8 started a trial → 0 paying" */
export function funnelLine(funnel: AdminOverview["funnel"]): string {
  return [
    plural(funnel.accounts, "account"),
    `${formatCount(funnel.onboarded)} finished the welcome`,
    `${formatCount(funnel.trials)} started a trial`,
    `${formatCount(funnel.paying)} paying`,
  ].join(" → ");
}

// ------------------------------------------------------------------ money

/** "$25", "$1,250", "$12.50": whole dollars without cents. */
export function formatDollars(usd: number): string {
  return Number.isInteger(usd)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(usd)
    : formatUsd(usd);
}

export interface UpcomingDayView {
  key: string;
  /** "Mon, Oct 12" (or "Today", "Tomorrow") */
  day: string;
  /** "3 first charges, 1 renewal" */
  what: string;
  amount: string;
}

export interface MoneyView {
  tiles: StatTile[];
  upcoming: UpcomingDayView[];
}

/** Charges due within `days` of now. */
function dueWithin(money: AdminOverview["money"], now: number, days: number) {
  return money.upcoming.filter((c) => Date.parse(c.at) < now + days * DAY_MS);
}

export function moneyTiles(money: AdminOverview["money"], signups7d: number, clock: ViewClock): StatTile[] {
  const due7 = dueWithin(money, clock.now, 7);
  const due7Usd = due7.reduce((n, c) => n + c.usd, 0);
  const firsts = due7.filter((c) => c.kind === "first").length;
  const conversion = money.trialsOver > 0 ? formatPercent(money.trialsConverted / money.trialsOver) : null;
  const toTrial = signups7d > 0 ? formatPercent(money.started7d / signups7d) : null;
  return [
    {
      key: "mrr",
      value: formatDollars(money.mrrUsd),
      label: "Monthly revenue",
      hint:
        money.paying === 0
          ? "Nobody paying yet"
          : `${plural(money.paying, "paying plan")} × ${formatDollars(money.priceUsd)}${money.payingCancelling ? `, ${formatCount(money.payingCancelling)} set to cancel` : ""}`,
    },
    {
      key: "trials",
      value: formatCount(money.trialing),
      label: "In free trial",
      hint:
        money.trialing === 0
          ? "No trials right now"
          : `${formatDollars(money.pipelineUsd)}/month if they all pay${money.trialsCancelling ? `; ${formatCount(money.trialsCancelling)} set to cancel` : ""}`,
    },
    {
      key: "due",
      value: formatDollars(due7Usd),
      label: "Due in 7 days",
      hint: due7.length === 0 ? "No charges due" : `${plural(due7.length, "charge")}${firsts ? `, ${formatCount(firsts)} of them first charges` : ""}`,
    },
    {
      key: "converted",
      value: conversion ?? "—",
      label: "Trial → paid",
      hint: money.trialsOver === 0 ? "No trial has ended yet" : `${formatCount(money.trialsConverted)} of ${plural(money.trialsOver, "ended trial")}`,
    },
    {
      key: "signupToTrial",
      value: toTrial ?? "—",
      label: "Sign-up → trial",
      hint: `${plural(money.started7d, "trial")} from ${plural(signups7d, "sign-up")} this week`,
    },
    {
      key: "lost",
      value: formatCount(money.failing + money.ended),
      label: "Cancelled or failing",
      hint: `${formatCount(money.ended)} cancelled, ${formatCount(money.failing)} with a failing charge`,
    },
  ];
}

/** The next 14 days' charges, one row per day in the reader's zone. */
export function upcomingDays(money: AdminOverview["money"], clock: ViewClock): UpcomingDayView[] {
  const byDay = new Map<string, { at: number; first: number; renewal: number; usd: number }>();
  const dayKey = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: clock.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  for (const c of money.upcoming) {
    const t = Date.parse(c.at);
    if (!Number.isFinite(t)) continue;
    const key = dayKey(t);
    const day = byDay.get(key) ?? { at: t, first: 0, renewal: 0, usd: 0 };
    day[c.kind === "first" ? "first" : "renewal"] += 1;
    day.usd += c.usd;
    byDay.set(key, day);
  }
  const today = dayKey(clock.now);
  const tomorrow = dayKey(clock.now + DAY_MS);
  return [...byDay.entries()]
    .sort((a, b) => a[1].at - b[1].at)
    .map(([key, d]) => ({
      key,
      day:
        key === today
          ? "Today"
          : key === tomorrow
            ? "Tomorrow"
            : new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(d.at)),
      what: [d.first ? plural(d.first, "first charge") : null, d.renewal ? plural(d.renewal, "renewal") : null].filter(Boolean).join(", "),
      amount: formatDollars(d.usd),
    }));
}

// ------------------------------------------------------------------ bug reports

export interface BugReportView {
  key: string;
  when: string;
  ago: string | null;
  email: string;
  message: string;
  path: string | null;
}

export function bugReportViews(reports: AdminOverview["bugReports"], clock: ViewClock): BugReportView[] {
  return reports.map((r, i) => ({
    key: `${r.at}|${i}`,
    when: formatWhen(r.at, clock),
    ago: relativeTime(r.at, clock.now),
    email: r.email?.trim() || ADMIN_COPY.noEmail,
    message: r.message.trim() || ADMIN_COPY.noMessage,
    path: r.path,
  }));
}

// ------------------------------------------------------------------ the whole page

export interface AdminView {
  summary: StatusSummaryView;
  services: ServiceCardView[];
  credit: string | null;
  errors: {
    totals: string;
    chart: ErrorChartView;
    groups: ErrorGroupView[];
  };
  ai: AiTableView;
  money: MoneyView;
  tiles: StatTile[];
  /** "80 accounts → 59 finished the welcome → 8 started a trial → 0 paying" */
  funnel: string;
  bugs: BugReportView[];
  /** "Updated just now" */
  updated: string;
}

/** Everything the page shows, from one overview. */
export function buildAdminView(overview: AdminOverview, clock: ViewClock): AdminView {
  const services = serviceCards(overview, clock);
  const credit = overview.openrouter?.creditsLeftUsd ?? null;
  return {
    summary: statusSummary(services, overview.services, clock),
    services,
    credit: credit === null ? null : `${formatUsd(credit)} OpenRouter credit left`,
    errors: {
      totals: errorTotalsLine(overview.errors.total24h, overview.errors.users24h),
      chart: buildErrorChart(overview.errors.perHour, clock),
      groups: overview.errors.groups.map((g, i) => errorGroupView(g, clock, i)),
    },
    ai: buildAiTable(overview.ai.routes),
    money: { tiles: moneyTiles(overview.money, overview.users.signups7d, clock), upcoming: upcomingDays(overview.money, clock) },
    tiles: statTiles(overview.users, overview.learning),
    funnel: funnelLine(overview.funnel),
    bugs: bugReportViews(overview.bugReports, clock),
    updated: ADMIN_COPY.updated(relativeTime(overview.generatedAt, clock.now) ?? formatWhen(overview.generatedAt, clock)),
  };
}
