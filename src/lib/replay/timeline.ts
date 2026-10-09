/**
 * A board's replay (2026-10-08): the order and pace its strokes were drawn in, worked out from a
 * stored board alone, so the same timeline plays in the admin's viewer, in the student's own
 * "Replay" on the board, and later in a parent's view or a study room.
 *
 * Times. From 2026-10-08 the board stamps every shape it creates with `meta[STROKE_TIME.start]`
 * (ms since the epoch, pen down) and every draw stroke, when it completes, with
 * `meta[STROKE_TIME.end]` (pen up); the tutor's shapes also carry `meta.createdAt`
 * (src/lib/live/contracts.ts). Older boards have neither for the student's ink: their strokes are
 * ordered by `index` within each page (tldraw gives a new shape an index above the top one, so this
 * is creation order unless the student re-ordered) and paced by length.
 *
 * Pace. Long pauses are squeezed (`maxGapMs`), so an hour's lesson plays in a minute or two at 1x,
 * and a stroke takes as long as it took to draw (or `msPerPoint` per point when untimed), never
 * less than `minStrokeMs`.
 *
 * Pure: no tldraw runtime import (types only), no DOM. The player (src/components/replay) turns a
 * frame into store updates.
 */
import type { TLRecord } from "tldraw";

/** The meta keys the board stamps (numbers: ms since the epoch). Not `live`: LiveLoop tells the student's ink by its absence. */
export const STROKE_TIME = { start: "t", end: "t1" } as const;

export interface ReplayOptions {
  /** a pause longer than this plays as this long (default 700) */
  maxGapMs?: number;
  /** untimed strokes: ms per point (default 8) */
  msPerPoint?: number;
  /** no stroke is shorter than this (default 120) */
  minStrokeMs?: number;
}

export interface ReplayItem {
  /** the shape's id */
  id: string;
  /** the page (screen) it is on */
  pageId: string;
  /** who drew it: the student, the tutor (meta.live), or something placed (an image, a sticker, a PDF page) */
  by: "student" | "tutor" | "placed";
  /** on the replay's clock (ms from 0) */
  start: number;
  end: number;
  /** a draw shape's points across its segments (0 for other shapes: they appear whole at `start`) */
  points: number;
  /** the real time it was drawn (ms since the epoch), when known */
  realAt: number | null;
}

export interface Timeline {
  /** in replay order */
  items: ReplayItem[];
  /** the replay's length at 1x */
  durationMs: number;
  /** pages in the order they were first drawn on */
  pages: string[];
  /** share of items with a real time (1: fully timed; 0: an old board, ordered by index) */
  timedShare: number;
  /** the first and last real times, when any */
  realStart: number | null;
  realEnd: number | null;
}

/** What is on the board at a moment of the replay. */
export interface ReplayFrame {
  /** shape id -> points to show (a draw shape mid-stroke), or Infinity for whole */
  shown: Map<string, number>;
  /** the page the replay is on (the latest item's) */
  pageId: string | null;
  /** the item being drawn, if any */
  current: ReplayItem | null;
}

/** The shapes of a stored board (a store snapshot's records, or `{document:{store}}`), in replay order with times. */
export function buildTimeline(records: readonly TLRecord[], options?: ReplayOptions): Timeline {
  void records;
  void options;
  throw new Error("buildTimeline: not built yet");
}

/** The frame at `ms` on the replay's clock. */
export function frameAt(timeline: Timeline, ms: number): ReplayFrame {
  void timeline;
  void ms;
  throw new Error("frameAt: not built yet");
}

/** The records of a stored board, whichever shape it was stored in (`{document:{store,schema},session}` or a bare store snapshot). Empty when unreadable. */
export function recordsOf(snapshot: unknown): TLRecord[] {
  void snapshot;
  throw new Error("recordsOf: not built yet");
}
