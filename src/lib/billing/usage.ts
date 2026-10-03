/**
 * Pure view model for the Usage card on /account: what each metered route is called in plain
 * words, and the last 30 days of `usage_by_day()` rows summed by day and by kind. No React, no
 * network, no browser APIs at module scope; unit-tested in src/lib/billing/__tests__/usage.test.ts.
 *
 * The rows come from the RPC in supabase/migrations/20260927000000_usage_by_day.sql (given its
 * `p_days` window by 20261002000000_ink.sql): one per (calendar day in the student's time zone,
 * route), with the ink spent in the column still called `credits`.
 */

import { z } from "zod";
import { formatInk } from "@/lib/billing/inkSummary";

/** Days of history the Usage card asks for (`usage_by_day(p_time_zone, p_days)`). */
export const USAGE_WINDOW_DAYS = 30;

/** A kind of work the tutor charges for, keyed by canonical route (see canonicalRouteKey). */
export type UsageKind = {
  key: string;
  /** Plain name, e.g. "Handwriting reading". */
  label: string;
  /** Count noun, singular and plural: "1 read", "342 reads". */
  unit: readonly [string, string];
  /** Ink per call for the routes billed today; mirrors ROUTE_COSTS (asserted in the tests). */
  cost?: number;
};

const TIMES = ["time", "times"] as const;

/**
 * Canonical key for a metered route: leading "/api/" removed, "/" and "_" folded to "-",
 * lower-case (so "live/recognize", "/api/live/recognize" and "live_recognize" all match).
 */
export function canonicalRouteKey(route: string): string {
  return route
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/^api\//, "")
    .replace(/[/_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Every route that has ever been charged. The live routes carry their price; the retired
 * ones (the image pipeline and its helpers) bill nothing any more and stay only so older
 * history still reads as words.
 */
export const USAGE_KINDS: Readonly<Record<string, UsageKind>> = {
  "live-recognize": { key: "live-recognize", label: "Handwriting reading", unit: ["read", "reads"], cost: 1 },
  // The second reader: one line read again when the first read looks wrong.
  "live-reread": { key: "live-reread", label: "Second read of messy writing", unit: ["line", "lines"], cost: 1 },
  // A word problem's equations, or a drawn figure's (the same route with a crop).
  "live-setup": { key: "live-setup", label: "Word-problem setup", unit: ["setup", "setups"], cost: 2 },
  // A proof's figure read, or one next row the planner could not find.
  "live-proof": { key: "live-proof", label: "Figures & proofs", unit: TIMES, cost: 2 },
  "live-check": { key: "live-check", label: "Checking your work", unit: ["check", "checks"], cost: 3 },
  // The board chat: problems, graphs and figures asked for in words.
  "live-chat": { key: "live-chat", label: "Board chat", unit: ["request", "requests"], cost: 3 },
  // Lecture mode: the director deciding what to sketch from what was said, and the recognizer.
  "live-lecture": { key: "live-lecture", label: "Lecture sketches", unit: ["minute", "minutes"], cost: 2 },
  "live-sketch": { key: "live-sketch", label: "Lecture drawings", unit: ["drawing", "drawings"], cost: 4 },
  "live-listen": { key: "live-listen", label: "Lecture listening", unit: ["session", "sessions"], cost: 1 },
  "live-solve": { key: "live-solve", label: "Worked solutions", unit: ["solution", "solutions"], cost: 10 },
  "generate-solution": { key: "generate-solution", label: "Drawn help (retired)", unit: TIMES },
  "generate-worksheet": { key: "generate-worksheet", label: "Worksheets (retired)", unit: TIMES },
  ocr: { key: "ocr", label: "Text recognition (retired)", unit: TIMES },
  "check-help-needed": { key: "check-help-needed", label: "Help checks (retired)", unit: TIMES },
  "voice-analyze-workspace": { key: "voice-analyze-workspace", label: "Voice tutor (retired)", unit: TIMES },
};

/** The kind for a stored route; an unknown route keeps its own spelling rather than vanishing. */
export function usageKindFor(route: string): UsageKind {
  const key = canonicalRouteKey(route);
  return USAGE_KINDS[key] ?? { key: key || "other", label: key || "Other", unit: TIMES };
}

/** "1 read", "342 reads", "1,345 reads". */
export function countLabel(kind: Pick<UsageKind, "unit">, count: number): string {
  const n = Math.round(count);
  return `${formatInk(n)} ${n === 1 ? kind.unit[0] : kind.unit[1]}`;
}

/**
 * The honest one-liner for "what does ink buy": reading is most of the work at 1 ink; setup,
 * checking and solutions cost more. The numbers come from USAGE_KINDS.
 */
export function inkPriceSentence(): string {
  const cost = (key: string) => USAGE_KINDS[key].cost ?? 0;
  return (
    `Most of the tutor's work is reading your handwriting, at ${cost("live-recognize")} ink a line. ` +
    `Setting up a word problem costs ${cost("live-setup")}, checking your work ${cost("live-check")}, ` +
    `and a worked solution ${cost("live-solve")}. Drawing on your own is free.`
  );
}

/* ------------------------------------------------------------------------- */
/* usage_by_day() rows                                                        */
/* ------------------------------------------------------------------------- */

const count = z.coerce.number().finite();

export const UsageDayRowSchema = z.object({
  /** Calendar date in the requested time zone, "YYYY-MM-DD". */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  route: z.string(),
  events: count,
  /** Ink spent (the column kept its pre-ink name). */
  credits: count,
});

export type UsageDayRow = z.infer<typeof UsageDayRowSchema>;

/** Rows from `usage_by_day()`; malformed rows are dropped rather than crashing the card. */
export function parseUsageDayRows(payload: unknown): UsageDayRow[] {
  if (!Array.isArray(payload)) return [];
  const out: UsageDayRow[] = [];
  for (const row of payload) {
    const parsed = UsageDayRowSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export type UsageKindTotal = {
  key: string;
  label: string;
  count: number;
  /** "342 reads" */
  countLabel: string;
  ink: number;
};

export type UsageDay = {
  /** "YYYY-MM-DD" in the student's time zone; also the React key. */
  day: string;
  /** "Today", "Yesterday", or "Wed, Sep 23". */
  label: string;
  /** "Sep 27" beside Today / Yesterday; "" otherwise (the label already carries the date). */
  date: string;
  ink: number;
  count: number;
  /** Most ink first. */
  kinds: UsageKindTotal[];
};

export type UsageSummary = {
  /** Newest first. */
  days: UsageDay[];
  /** The whole window by kind, most ink first. */
  kinds: UsageKindTotal[];
  ink: number;
  count: number;
};

function byInkThenCount(a: UsageKindTotal, b: UsageKindTotal): number {
  return b.ink - a.ink || b.count - a.count || a.label.localeCompare(b.label);
}

/** Sums rows by kind: routes that canonicalise to the same kind are merged. */
function kindTotals(rows: ReadonlyArray<UsageDayRow>): UsageKindTotal[] {
  const totals = new Map<string, { kind: UsageKind; count: number; ink: number }>();
  for (const row of rows) {
    const kind = usageKindFor(row.route);
    const t = totals.get(kind.key) ?? { kind, count: 0, ink: 0 };
    t.count += row.events;
    t.ink += row.credits;
    totals.set(kind.key, t);
  }
  return [...totals.values()]
    .map(({ kind, count: n, ink }) => ({
      key: kind.key,
      label: kind.label,
      count: n,
      countLabel: countLabel(kind, n),
      ink,
    }))
    .sort(byInkThenCount);
}

const DAY_MS = 86_400_000;

/** Midnight UTC of a "YYYY-MM-DD" day, or NaN. Day arithmetic stays in UTC so no zone can shift it. */
function dayEpoch(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/**
 * "Today" / "Yesterday" relative to `today` (both "YYYY-MM-DD" in the same zone), else
 * "Wed, Sep 23" (with the year when it differs from today's).
 */
export function dayLabel(day: string, today: string): { label: string; date: string } {
  const at = dayEpoch(day);
  if (Number.isNaN(at)) return { label: day, date: "" };
  const date = new Date(at);
  const monthDay = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const diff = Math.round((dayEpoch(today) - at) / DAY_MS);
  if (diff === 0) return { label: "Today", date: monthDay };
  if (diff === 1) return { label: "Yesterday", date: monthDay };
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  const label = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
  return { label, date: "" };
}

/** Rows summed per day (newest first, each with its kinds) and over the whole window by kind. */
export function usageSummaryFor(rows: ReadonlyArray<UsageDayRow>, today: string): UsageSummary {
  const byDay = new Map<string, UsageDayRow[]>();
  for (const row of rows) {
    const list = byDay.get(row.day) ?? [];
    list.push(row);
    byDay.set(row.day, list);
  }
  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, list]) => {
      const kinds = kindTotals(list);
      return {
        day,
        ...dayLabel(day, today),
        ink: kinds.reduce((n, k) => n + k.ink, 0),
        count: kinds.reduce((n, k) => n + k.count, 0),
        kinds,
      };
    });
  const kinds = kindTotals(rows);
  return {
    days,
    kinds,
    ink: kinds.reduce((n, k) => n + k.ink, 0),
    count: kinds.reduce((n, k) => n + k.count, 0),
  };
}

/** "YYYY-MM-DD" of `date` in `timeZone` (the runtime's zone when omitted). */
export function localDayKey(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The browser's IANA zone, e.g. "America/New_York"; "UTC" when the runtime cannot say. */
export function runtimeTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
