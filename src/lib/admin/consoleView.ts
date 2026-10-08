/**
 * The admin console's shared words and helpers (2026-10-08): the nav and its counts, the plan
 * badges, who an account is in one line, dates, a device from a bug report's diagnostics, and
 * the little per-day sparklines. Pure like view.ts (no React, no network, no browser API at module
 * scope): every page's view module builds on these, and every line is tested
 * (src/lib/admin/__tests__/consoleView.test.ts).
 */
import { ADMIN_LIMITS, ADMIN_PAGES, type PlanState } from "./contracts";
import { daysBefore, formatCount, plural, relativeTime, type ViewClock } from "./view";

const DAY_MS = 86_400_000;

export const CONSOLE_COPY = {
  /** the console's name, above the sections */
  name: "Admin",
  navLabel: "Admin sections",
  documentTitle: (page: string) => `${page} · Admin · Agathon`,
  retry: "Try again",
  loadFallback: "Something went wrong on the way. Try again in a moment.",
  badShape: "The server answered in a shape this page doesn't know. The page and the server may be from different releases: reload the page.",
  loadFailed: (what: string) => `Couldn't load ${what}`,
  /** a refresh failed and the last answer stays on screen */
  staleNote: "couldn't refresh",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Couldn't copy",
  signedOut: "signed out",
  noEmail: "no email",
  noName: "No name",
  admin: "Admin",
  untitled: "Untitled board",
  never: "never",
  saveFailed: (message: string) => `Couldn't save: ${message}. Put back as it was.`,
  saved: "Saved",
  undo: "Undo",
} as const;

// ------------------------------------------------------------------ the nav

export const CONSOLE_PAGES = ["overview", "users", "boards", "bugs", "issues"] as const;
export type ConsolePage = (typeof CONSOLE_PAGES)[number];

export const CONSOLE_PAGE_LABELS: Record<ConsolePage, string> = {
  overview: "Overview",
  users: "Users",
  boards: "Boards",
  bugs: "Bugs",
  issues: "Issues",
};

export const CONSOLE_PAGE_HREFS: Record<ConsolePage, string> = {
  overview: ADMIN_PAGES.overview,
  users: ADMIN_PAGES.users,
  boards: ADMIN_PAGES.boards,
  bugs: ADMIN_PAGES.bugs,
  issues: ADMIN_PAGES.issues,
};

export interface NavItemView {
  page: ConsolePage;
  href: string;
  label: string;
  /** "3", "99+"; null for no count (none, or not known yet) */
  count: string | null;
  /** what the count means, for a screen reader: "3 new bug reports" */
  countLabel: string | null;
  /** something regressed: the count is drawn in the danger tone */
  urgent: boolean;
  current: boolean;
}

export interface NavCounts {
  /** bug reports in "new"; null until known */
  newBugs: number | null;
  /** issues needing a look (open or regressed, noise left out); null until known */
  openIssues: number | null;
  /** of those, regressed */
  regressed?: number;
}

function countText(n: number): string {
  return n > 99 ? "99+" : formatCount(n);
}

/** The console's sections, the current one marked, with the counts worth a glance. */
export function consoleNav(current: ConsolePage | null, counts: NavCounts): NavItemView[] {
  return CONSOLE_PAGES.map((page) => {
    const n = page === "bugs" ? counts.newBugs : page === "issues" ? counts.openIssues : null;
    const shown = n !== null && n > 0;
    return {
      page,
      href: CONSOLE_PAGE_HREFS[page],
      label: CONSOLE_PAGE_LABELS[page],
      count: shown ? countText(n) : null,
      countLabel: !shown ? null : page === "bugs" ? plural(n, "new bug report") : plural(n, "open issue"),
      urgent: page === "issues" && (counts.regressed ?? 0) > 0,
      current: page === current,
    };
  });
}

// ------------------------------------------------------------------ plans

export const PLAN_LABELS: Record<PlanState, string> = {
  none: "No plan",
  trialing: "Trial",
  trial_cancelling: "Trial, cancelling",
  active: "Paying",
  cancelling: "Paying, cancelling",
  failing: "Payment failing",
  ended: "Ended",
};

/** A pill's tone. Colour always comes with the plan's words. */
export type Tone = "neutral" | "muted" | "info" | "success" | "warn" | "danger";

export const PLAN_TONES: Record<PlanState, Tone> = {
  none: "muted",
  trialing: "info",
  trial_cancelling: "warn",
  active: "success",
  cancelling: "warn",
  failing: "danger",
  ended: "neutral",
};

/** "Trial ends Fri, Oct 10" (or "today", "tomorrow"); null when not trialing or unknown. */
export function trialNote(plan: PlanState, trialEndsAt: string | null, clock: ViewClock): string | null {
  if ((plan !== "trialing" && plan !== "trial_cancelling") || !trialEndsAt) return null;
  const t = Date.parse(trialEndsAt);
  if (!Number.isFinite(t)) return null;
  const days = -daysBefore(t, clock);
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : days < 0 ? formatDay(trialEndsAt, clock) : weekdayDate(t, clock.timeZone);
  return days < 0 ? `Trial ended ${when}` : `Trial ends ${when}`;
}

// ------------------------------------------------------------------ who

/** The name, else the email's local part, else "No name". */
export function personName(name: string | null | undefined, email: string | null | undefined): string {
  const n = name?.trim();
  if (n) return n;
  const local = email?.trim().split("@")[0];
  return local || CONSOLE_COPY.noName;
}

/** "Maya Chen" → "MC"; "maya.chen@x.com" → "MC"; "sam@x.com" → "S"; nothing → "?". */
export function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.trim().split("@")[0] || "";
  const words = source.split(/[\s._-]+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return "?";
  const first = (w: string) => [...w].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? "";
  return (words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1])).toUpperCase();
}

/** One of four avatar tones, the same for an id every time. */
export function avatarTone(id: string): 1 | 2 | 3 | 4 {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 4) + 1) as 1 | 2 | 3 | 4;
}

/** An id's first 8 characters, for link text. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The viewer's address for a board id; null for anything that is not one. */
export function boardHref(id: string | null | undefined): string | null {
  return id && UUID.test(id) ? ADMIN_PAGES.board(id) : null;
}

/** A user's page; null without an id. */
export function userHref(id: string | null | undefined): string | null {
  return id && UUID.test(id) ? ADMIN_PAGES.user(id) : null;
}

/** profiles.course → its name (the onboarding's courses, without loading their starter problems). */
const COURSE_LABELS: Record<string, string> = {
  algebra1: "Algebra 1",
  geometry: "Geometry",
  algebra2: "Algebra 2",
  precalc_calc: "Pre-calculus / Calculus",
  other: "Something else",
};

export function courseName(course: string | null | undefined): string | null {
  if (!course) return null;
  return COURSE_LABELS[course] ?? course;
}

// ------------------------------------------------------------------ dates

function weekdayDate(t: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(t));
}

/** "Today", "Yesterday", "Oct 3", or "Oct 3, 2025" in another year. */
export function formatDay(iso: string | null, clock: ViewClock): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const days = daysBefore(t, clock);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const year = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, year: "numeric" }).format(new Date(ms));
  const sameYear = year(t) === year(clock.now);
  return new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(new Date(t));
}

/** The full moment, for a tooltip: "Wed, Oct 8, 2026, 3:42 PM". */
export function exactTime(iso: string | null, clock: ViewClock): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(t));
}

/** "3 min ago", or "never" for no time. */
export function agoOrNever(iso: string | null, now: number): string {
  return relativeTime(iso, now) ?? CONSOLE_COPY.never;
}

/** Saved within ADMIN_LIMITS.liveWindowMin: on a board right now. */
export function isLiveNow(updatedAt: string | null, now: number): boolean {
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) && now - t <= ADMIN_LIMITS.liveWindowMin * 60_000 && t <= now + 60_000;
}

/** The time of day with seconds: "3:42:07 PM" (a log line). */
export function clockWithSeconds(iso: string, timeZone?: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(t));
}

// ------------------------------------------------------------------ numbers

/** "62%" of a part of a whole, whole percents; null with no whole. */
export function percentOf(part: number, whole: number): string | null {
  if (!(whole > 0)) return null;
  return `${Math.round((Math.min(part, whole) / whole) * 100)}%`;
}

/** "1 h 20 min", "45 min", "under a minute", "none". */
export function formatMinutes(minutes: number): string {
  if (!(minutes > 0)) return "none";
  if (minutes < 1) return "under a minute";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** A tile's short form: "4h 42m", "45m", "0m". */
export function formatMinutesShort(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${formatCount(h)}h ${m % 60}m` : `${formatCount(h)}h`;
}

/** "120 KB", "1.4 MB" */
export function formatKb(kb: number): string {
  if (kb < 1024) return `${formatCount(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

// ------------------------------------------------------------------ devices

export interface Browser {
  browser: string | null;
  os: string | null;
}

/** The browser and system from a user agent, in words: Safari on iPhone, Chrome on ChromeOS. */
export function browserFromUserAgent(ua: string | null | undefined): Browser {
  const s = ua ?? "";
  if (!s.trim()) return { browser: null, os: null };
  const browser = /Edg(e|A|iOS)?\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /SamsungBrowser\//.test(s)
        ? "Samsung Internet"
        : /CriOS\//.test(s)
          ? "Chrome"
          : /FxiOS\/|Firefox\//.test(s)
            ? "Firefox"
            : /Chrome\/|Chromium\//.test(s)
              ? "Chrome"
              : /Safari\//.test(s) && /Version\//.test(s)
                ? "Safari"
                : /AppleWebKit\//.test(s) && /Mobile\//.test(s)
                  ? "Safari (in an app)"
                  : null;
  const os = /iPhone/.test(s)
    ? "iPhone"
    : /iPad/.test(s)
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /CrOS/.test(s)
          ? "ChromeOS"
          : /Windows/.test(s)
            ? "Windows"
            : /Mac OS X|Macintosh/.test(s)
              ? "Mac"
              : /Linux/.test(s)
                ? "Linux"
                : null;
  return { browser, os };
}

export interface DeviceView {
  /** "Safari on iPhone · 390 × 844" */
  summary: string | null;
  /** the rest in one line: "MacIntel · screen 1024 × 768 @2x · en-US · online" */
  more: string | null;
  facts: { label: string; value: string }[];
}

function sizeOf(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const { width, height } = v as { width?: unknown; height?: unknown };
  return typeof width === "number" && typeof height === "number" && width > 0 && height > 0 ? `${Math.round(width)} × ${Math.round(height)}` : null;
}

/** A bug report's diagnostics (BugReportButton's collectDiagnostics) as a line and a few facts. */
export function deviceView(diagnostics: Record<string, unknown> | null): DeviceView {
  if (!diagnostics) return { summary: null, more: null, facts: [] };
  const str = (k: string) => (typeof diagnostics[k] === "string" && (diagnostics[k] as string).trim() ? (diagnostics[k] as string).trim() : null);
  const { browser, os } = browserFromUserAgent(str("userAgent"));
  const viewport = sizeOf(diagnostics.viewport);
  const screen = diagnostics.screen && typeof diagnostics.screen === "object" ? (diagnostics.screen as Record<string, unknown>) : null;
  const ratio = screen && typeof screen.pixelRatio === "number" ? screen.pixelRatio : null;
  const who = browser && os ? `${browser} on ${os}` : (browser ?? os);
  const facts: { label: string; value: string }[] = [];
  if (who) facts.push({ label: "Browser", value: who });
  if (str("platform")) facts.push({ label: "Platform", value: str("platform")! });
  if (viewport) facts.push({ label: "Window", value: viewport });
  if (sizeOf(screen)) facts.push({ label: "Screen", value: `${sizeOf(screen)}${ratio ? ` @${Number(ratio.toFixed(2))}x` : ""}` });
  if (str("language")) facts.push({ label: "Language", value: str("language")! });
  if (typeof diagnostics.online === "boolean") facts.push({ label: "Network", value: diagnostics.online ? "Online" : "Offline" });
  const summary = [who, viewport].filter(Boolean).join(" · ") || null;
  const rest = facts.filter((f) => f.label !== "Browser" && f.label !== "Window").map((f) => (f.label === "Screen" ? `screen ${f.value}` : f.label === "Network" ? f.value.toLowerCase() : f.value));
  return { summary, more: rest.length ? rest.join(" · ") : null, facts };
}

// ------------------------------------------------------------------ sparklines

export interface SparkBar {
  key: string;
  value: number;
  /** share of the highest bar, 0..1 */
  ratio: number;
  /** "Oct 3: 4" */
  label: string;
}

export interface SparkView {
  bars: SparkBar[];
  total: number;
  /** "12 in 7 days, most on Oct 7 (5)" for a screen reader */
  summary: string;
}

/**
 * Per-day counts, oldest first, the last one today (in the viewer's zone), as bars scaled to the
 * highest. `unit` names a count in the summary.
 */
export function sparkline(values: readonly number[], clock: ViewClock, unit: [string, string] = ["event", "events"]): SparkView {
  const max = values.reduce((m, v) => Math.max(m, v), 0);
  const last = values.length - 1;
  const dayOf = (i: number) => new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, month: "short", day: "numeric" }).format(new Date(clock.now - (last - i) * DAY_MS));
  const bars = values.map((value, i) => ({ key: `${i}`, value, ratio: max > 0 ? value / max : 0, label: `${dayOf(i)}: ${formatCount(value)}` }));
  const total = values.reduce((n, v) => n + v, 0);
  const peak = values.indexOf(max);
  const span = values.length === 1 ? "today" : `${values.length} days`;
  const summary =
    total === 0 ? `None in ${span}` : `${formatCount(total)} ${total === 1 ? unit[0] : unit[1]} in ${span}${values.length > 1 ? `, most on ${dayOf(peak)} (${formatCount(max)})` : ""}`;
  return { bars, total, summary };
}

// ------------------------------------------------------------------ meta

/** A meta value as one short line: strings as they are, numbers formatted, the rest as JSON. */
export function metaValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isInteger(v) ? formatCount(v) : String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Pretty JSON for a details block; null for nothing to show. */
export function prettyJson(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && Object.keys(v as object).length === 0) return null;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** The facts worth a glance in an event's meta, in this order: model, fallback model, ms, status, error. */
export function metaFacts(meta: Record<string, unknown> | null): { label: string; value: string }[] {
  if (!meta) return [];
  const picks: [string[], string][] = [
    [["model", "primary", "primaryModel"], "Model"],
    [["fallback", "fallbackModel"], "Fallback"],
    [["ms", "latencyMs", "durationMs", "elapsedMs"], "Took"],
    [["status", "httpStatus"], "Status"],
    [["error", "err", "reason"], "Error"],
  ];
  const out: { label: string; value: string }[] = [];
  for (const [keys, label] of picks) {
    const key = keys.find((k) => meta[k] !== undefined && meta[k] !== null && meta[k] !== "");
    if (!key) continue;
    const v = meta[key];
    out.push({ label, value: label === "Took" && typeof v === "number" ? (v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`) : metaValue(v) });
  }
  return out;
}
