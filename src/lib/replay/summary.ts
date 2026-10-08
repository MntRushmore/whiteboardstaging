/**
 * What a replay adds up to: the student's strokes, the lines the tutor ticked, the mistakes fixed,
 * the time spent. Shown on the student's replay when it ends ("You wrote 128 strokes · 7 ✓ · fixed
 * 2 mistakes · 14 minutes of work") and beside the admin's viewer. Pure: from a timeline (and, when
 * known, the learning record's count of mistakes the student fixed: the board itself only keeps the
 * tutor's latest mark on each line, so a ring later turned into a tick leaves no trace on it).
 */
import type { Timeline } from "./timeline";

export interface ReplaySummary {
  /** the student's strokes on the board */
  strokes: number;
  /** lines the tutor ticked */
  ticks: number;
  /** lines still ringed */
  rings: number;
  /** screens drawn on */
  screens: number;
  /** mistakes the student fixed (attempts that ended `self_corrected`), when known */
  fixed: number | null;
  /** time spent working, from the board's real times (a pause counts at most ACTIVE_GAP_MS); null when too few are known */
  activeMs: number | null;
}

/** A pause longer than this counts as this much work (the learning record's own cap: LEARNING_LIMITS.maxGapMs). */
export const ACTIVE_GAP_MS = 120_000;

export function replaySummary(timeline: Timeline, opts: { fixed?: number | null } = {}): ReplaySummary {
  let strokes = 0;
  const times: number[] = [];
  for (const it of timeline.items) {
    if (it.by === "student" && it.points > 0) strokes++;
    if (it.realAt !== null) times.push(it.realAt);
  }
  times.sort((a, b) => a - b);
  let activeMs: number | null = null;
  if (times.length >= 2) {
    activeMs = 0;
    for (let i = 1; i < times.length; i++) activeMs += Math.min(ACTIVE_GAP_MS, times[i] - times[i - 1]);
  }
  return {
    strokes,
    ticks: timeline.marks.filter((m) => m.kind === "check").length,
    rings: timeline.marks.filter((m) => m.kind === "circle").length,
    screens: timeline.pages.length,
    fixed: opts.fixed ?? null,
    activeMs,
  };
}

/** Whole minutes of work, at least 1 once there is any; null when unknown. */
export function workMinutes(summary: ReplaySummary): number | null {
  if (summary.activeMs === null || summary.activeMs <= 0) return null;
  return Math.max(1, Math.round(summary.activeMs / 60_000));
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The pieces of the student's summary, in order, leaving out what is zero or unknown. */
export function summaryParts(summary: ReplaySummary): { key: "strokes" | "ticks" | "fixed" | "minutes"; text: string }[] {
  const parts: { key: "strokes" | "ticks" | "fixed" | "minutes"; text: string }[] = [];
  if (summary.strokes > 0) parts.push({ key: "strokes", text: `You wrote ${n(summary.strokes, "stroke")}` });
  if (summary.ticks > 0) parts.push({ key: "ticks", text: `${summary.ticks} ✓` });
  if (summary.fixed) parts.push({ key: "fixed", text: `fixed ${n(summary.fixed, "mistake")}` });
  const minutes = workMinutes(summary);
  if (minutes !== null) parts.push({ key: "minutes", text: `${n(minutes, "minute")} of work` });
  return parts;
}

/** "You wrote 128 strokes · 7 ✓ · fixed 2 mistakes · 14 minutes of work" */
export function summaryLine(summary: ReplaySummary): string {
  return summaryParts(summary)
    .map((p) => p.text)
    .join(" · ");
}

/** The student's replay, in their words: short. */
export const KID_REPLAY_COPY = {
  open: "Replay my board",
  title: "Your board replay",
  close: "Close the replay",
  play: "Play",
  pause: "Pause",
  again: "Watch again",
  back: "Back to my board",
  speed: (x: number) => `${x}× speed`,
  scrubber: "Replay position",
  loading: "Getting your replay ready…",
  empty: "Nothing to replay yet. Draw something first!",
  /** the card at the end */
  doneTitle: (summary: ReplaySummary) => (summary.ticks >= 3 ? "Look at you go!" : summary.strokes > 0 ? "Look at all that work!" : "All done!"),
  ticks: (count: number) => n(count, "line"),
  strokes: (count: number) => n(count, "stroke"),
  fixed: (count: number) => `${n(count, "mistake")} fixed`,
  minutes: (count: number) => `${n(count, "minute")} of work`,
} as const;
