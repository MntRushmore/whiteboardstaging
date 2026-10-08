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
 * Order. Every shape of the board is laid out in "board order" (page by page in the pages' order,
 * then by index, a group's children after it). A timed shape is placed at its real time. An untimed
 * one (an old board's student ink) borrows the time of the next timed shape after it in board order
 * and plays just before it: index order is creation order across the student's and the tutor's
 * shapes alike, so a line of old ink plays right before the tutor's echo or tick that answered it.
 * With nothing timed after it, it plays just after the last timed shape before it; on a board with
 * nothing timed at all, it plays in board order.
 *
 * Pace. Long pauses are squeezed (`maxGapMs`), so an hour's lesson plays in a minute or two at 1x,
 * and a stroke takes as long as it took to draw (or `msPerPoint` per point when untimed), never
 * less than `minStrokeMs` (nor more than `maxStrokeMs`). Items never overlap: one is drawn at a
 * time, so a frame is "the first `upTo` items, the last perhaps part drawn" and `frameAt` is a
 * binary search.
 *
 * Pure: no tldraw runtime import (types only), no DOM. The player (src/components/replay) turns a
 * frame into store updates.
 */
import type { TLRecord } from "tldraw";
import { markKindOf, type MarkKind } from "@/lib/onboarding/marks";
import { STROKE_TIME } from "./strokeTime";

/** The meta keys the board stamps (numbers: ms since the epoch). Not `live`: LiveLoop tells the student's ink by its absence. */
export { STROKE_TIME };

export interface ReplayOptions {
  /** a pause longer than this plays as this long (default 700) */
  maxGapMs?: number;
  /** untimed strokes: ms per point (default 8) */
  msPerPoint?: number;
  /** no stroke is shorter than this (default 120) */
  minStrokeMs?: number;
  /** no stroke is longer than this (default 4000): a stroke extended long after it was begun */
  maxStrokeMs?: number;
}

/** The pacing constants (`ReplayOptions` overrides the first four). */
export const REPLAY_PACE = {
  maxGapMs: 700,
  msPerPoint: 8,
  minStrokeMs: 120,
  maxStrokeMs: 4000,
  /** between two shapes with no real time between them (an old board's ink) */
  untimedGapMs: 140,
  /** between two strokes of the tutor's writing (one block shares one `createdAt`) */
  tutorGapMs: 50,
  /** the shortest pause between two timed shapes (a fast writer's pen lifts) */
  minGapMs: 30,
  /** at least this long when the replay moves to another screen, so the move is seen */
  pageTurnMs: 650,
  /** before the first shape */
  leadMs: 300,
  /** after the last one, the finished board */
  tailMs: 600,
} as const;

export type ReplayMarkKind = MarkKind;

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
  /** the shape's type: "draw", "math", "image"… */
  type: string;
  /** the tutor's mark this stroke is part of (a tick, a ring, a question mark), from `meta.mark` */
  mark: ReplayMarkKind | null;
  /** the line of maths a tutor's shape belongs to (`meta.lineId`) */
  lineId: string | null;
}

/** A tutor's mark on the replay's clock: the scrubber's ticks and rings. One per line and mark. */
export interface ReplayMark {
  /** when its first stroke starts, on the replay's clock */
  at: number;
  kind: ReplayMarkKind;
  lineId: string | null;
  /** its first stroke */
  id: string;
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
  /** the tutor's marks, in replay order */
  marks: ReplayMark[];
}

/** What is on the board at a moment of the replay. */
export interface ReplayFrame {
  /** shape id -> points to show (a draw shape mid-stroke), or Infinity for whole (built when first read) */
  shown: Map<string, number>;
  /** the page the replay is on (the latest item's; before the first, the first item's) */
  pageId: string | null;
  /** the item being drawn, if any */
  current: ReplayItem | null;
  /** items[0, upTo) are on the board; the last of them may be `current`, part drawn */
  upTo: number;
  /** how many of `current`'s points show (Infinity: whole, or not a stroke) */
  currentPoints: number;
}

// ------------------------------------------------------------------ records

type AnyRecord = { id: string; typeName: string } & Record<string, unknown>;

function isRecordLike(v: unknown): v is AnyRecord {
  return !!v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" && typeof (v as { typeName?: unknown }).typeName === "string";
}

function storeMapOf(snapshot: unknown): Record<string, unknown> | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as { document?: unknown; store?: unknown };
  const doc = s.document as { store?: unknown } | undefined;
  if (doc && typeof doc === "object" && doc.store && typeof doc.store === "object") return doc.store as Record<string, unknown>;
  if (s.store && typeof s.store === "object") return s.store as Record<string, unknown>;
  // a map of records with no wrapper at all
  const values = Object.values(snapshot as Record<string, unknown>);
  if (values.length > 0 && values.every(isRecordLike)) return snapshot as Record<string, unknown>;
  return null;
}

/** The records of a stored board, whichever shape it was stored in (`{document:{store,schema},session}` or a bare store snapshot). Empty when unreadable. */
export function recordsOf(snapshot: unknown): TLRecord[] {
  const map = storeMapOf(snapshot);
  if (!map) return [];
  const out: TLRecord[] = [];
  for (const v of Object.values(map)) if (isRecordLike(v)) out.push(v as unknown as TLRecord);
  return out;
}

// ------------------------------------------------------------------ the timeline

const STROKE_TYPES = new Set(["draw", "highlight"]);
const PLACED_TYPES = new Set(["image", "video", "embed", "bookmark"]);

/** A draw shape's points across its segments (0 when it has none to count). */
export function strokePoints(props: unknown): number {
  const segments = (props as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segments)) return 0;
  let n = 0;
  for (const s of segments) {
    const pts = (s as { points?: unknown } | null)?.points;
    if (Array.isArray(pts)) n += pts.length;
  }
  return n;
}

const epochMs = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Plain code-unit order: tldraw's fractional indices sort this way (never localeCompare). */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function comparePaths(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = cmp(a[i], b[i]);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

interface Entry {
  id: string;
  type: string;
  pageId: string;
  pageOrder: number;
  path: string[];
  by: ReplayItem["by"];
  points: number;
  realStart: number | null;
  realEnd: number | null;
  mark: ReplayMarkKind | null;
  markKey: string | null;
  lineId: string | null;
  seq: number;
  sortTime: number;
  tier: number;
}

/** The shapes of a stored board (a store snapshot's records, or `{document:{store}}`), in replay order with times. */
export function buildTimeline(records: readonly TLRecord[], options?: ReplayOptions): Timeline {
  const pace = { ...REPLAY_PACE, ...stripUndefined(options) };
  const list: readonly unknown[] = Array.isArray(records) ? records : recordsOf(records);

  const pages = new Map<string, { index: string }>();
  const shapes = new Map<string, AnyRecord>();
  for (const r of list) {
    if (!isRecordLike(r)) continue;
    if (r.typeName === "page") pages.set(r.id, { index: String(r.index ?? "") });
    else if (r.typeName === "shape") shapes.set(r.id, r);
  }
  const pageOrder = new Map([...pages.entries()].sort((a, b) => cmp(a[1].index, b[1].index)).map(([id], i) => [id, i]));

  // the page and the index path of each shape (a group's children sit under the group's index)
  const placeOf = new Map<string, { pageId: string; path: string[] } | null>();
  const place = (id: string, depth = 0): { pageId: string; path: string[] } | null => {
    const known = placeOf.get(id);
    if (known !== undefined) return known;
    const s = shapes.get(id);
    let out: { pageId: string; path: string[] } | null = null;
    if (s && depth < 64) {
      const parent = String(s.parentId ?? "");
      const index = String(s.index ?? "");
      if (pages.has(parent)) out = { pageId: parent, path: [index] };
      else {
        const up = place(parent, depth + 1);
        if (up) out = { pageId: up.pageId, path: [...up.path, index] };
      }
    }
    placeOf.set(id, out);
    return out;
  };

  const entries: Entry[] = [];
  for (const s of shapes.values()) {
    const at = place(s.id);
    if (!at) continue;
    const meta = (s.meta && typeof s.meta === "object" ? s.meta : {}) as Record<string, unknown>;
    const type = String(s.type ?? "");
    const live = meta.live === true;
    const t = epochMs(meta[STROKE_TIME.start]);
    const t1 = epochMs(meta[STROKE_TIME.end]);
    const realStart = t ?? (live ? epochMs(meta.createdAt) : null);
    const mark = markKindOf(meta);
    entries.push({
      id: s.id,
      type,
      pageId: at.pageId,
      pageOrder: pageOrder.get(at.pageId) ?? 0,
      path: at.path,
      by: live ? "tutor" : PLACED_TYPES.has(type) ? "placed" : "student",
      points: STROKE_TYPES.has(type) ? strokePoints(s.props) : 0,
      realStart,
      realEnd: t !== null && t1 !== null && t1 >= t ? t1 : null,
      mark,
      markKey: mark ? String(meta.mark) : null,
      lineId: typeof meta.lineId === "string" ? meta.lineId : null,
      seq: 0,
      sortTime: 0,
      tier: 1,
    });
  }

  // board order, then each untimed shape's borrowed time (see the header)
  entries.sort((a, b) => a.pageOrder - b.pageOrder || comparePaths(a.path, b.path) || cmp(a.id, b.id));
  let prev: number | null = null;
  const before: (number | null)[] = new Array(entries.length);
  entries.forEach((e, i) => {
    e.seq = i;
    if (e.realStart !== null) prev = e.realStart;
    before[i] = prev;
  });
  let next: number | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.realStart !== null) {
      next = e.realStart;
      e.sortTime = e.realStart;
      e.tier = 1;
    } else if (next !== null) {
      e.sortTime = next;
      e.tier = 0;
    } else if (before[i] !== null) {
      e.sortTime = before[i] as number;
      e.tier = 2;
    } else {
      e.sortTime = -Infinity;
      e.tier = 1;
    }
  }
  entries.sort((a, b) => (a.sortTime === b.sortTime ? 0 : a.sortTime < b.sortTime ? -1 : 1) || a.tier - b.tier || a.seq - b.seq);

  // the clock
  const items: ReplayItem[] = [];
  const marks: ReplayMark[] = [];
  const seenMarks = new Set<string>();
  const pagesSeen: string[] = [];
  let clock = 0;
  let prevEntry: Entry | null = null;
  let timed = 0;
  let realStart: number | null = null;
  let realEnd: number | null = null;
  for (const e of entries) {
    let gap: number;
    if (!prevEntry) gap = pace.leadMs;
    else if (e.realStart !== null && prevEntry.realStart !== null) {
      const prevEnd = prevEntry.realEnd ?? prevEntry.realStart;
      const floor = e.by === "tutor" && prevEntry.by === "tutor" ? pace.tutorGapMs : pace.minGapMs;
      gap = clamp(e.realStart - prevEnd, floor, Math.max(floor, pace.maxGapMs));
    } else gap = e.by === "tutor" && prevEntry.by === "tutor" ? pace.tutorGapMs : pace.untimedGapMs;
    if (prevEntry && prevEntry.pageId !== e.pageId) gap = Math.max(gap, pace.pageTurnMs);

    let duration = 0;
    if (e.points > 0) {
      const drawn = e.realEnd !== null && e.realStart !== null ? e.realEnd - e.realStart : e.points * pace.msPerPoint;
      duration = clamp(drawn, pace.minStrokeMs, Math.max(pace.minStrokeMs, pace.maxStrokeMs));
    }
    const start = clock + gap;
    const end = start + duration;
    clock = end;
    prevEntry = e;

    items.push({ id: e.id, pageId: e.pageId, by: e.by, start, end, points: e.points, realAt: e.realStart, type: e.type, mark: e.mark, lineId: e.lineId });
    if (e.realStart !== null) {
      timed++;
      realStart = realStart === null ? e.realStart : Math.min(realStart, e.realStart);
      const last = e.realEnd ?? e.realStart;
      realEnd = realEnd === null ? last : Math.max(realEnd, last);
    }
    if (e.mark) {
      const key = `${e.lineId ?? ""}|${e.markKey}`;
      if (!seenMarks.has(key)) {
        seenMarks.add(key);
        marks.push({ at: start, kind: e.mark, lineId: e.lineId, id: e.id });
      }
    }
    if (pagesSeen[pagesSeen.length - 1] !== e.pageId && !pagesSeen.includes(e.pageId)) pagesSeen.push(e.pageId);
  }

  return {
    items,
    durationMs: items.length === 0 ? 0 : clock + pace.tailMs,
    pages: pagesSeen,
    timedShare: items.length === 0 ? 0 : timed / items.length,
    realStart,
    realEnd,
    marks,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function stripUndefined(o: ReplayOptions | undefined): Partial<ReplayOptions> {
  const out: Record<string, number> = {};
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  return out;
}

// ------------------------------------------------------------------ frames

/** Each timeline's item starts, for the binary search (built once per timeline). */
const STARTS = new WeakMap<Timeline, Float64Array>();

function startsOf(timeline: Timeline): Float64Array {
  let starts = STARTS.get(timeline);
  if (!starts || starts.length !== timeline.items.length) {
    starts = Float64Array.from(timeline.items, (it) => it.start);
    STARTS.set(timeline, starts);
  }
  return starts;
}

/** How many items start before `ms` (they are on the board at `ms`). */
function countStarted(timeline: Timeline, ms: number): number {
  const starts = startsOf(timeline);
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The frame at `ms` on the replay's clock. */
export function frameAt(timeline: Timeline, ms: number): ReplayFrame {
  const items = timeline.items;
  const upTo = countStarted(timeline, ms);
  const last = upTo > 0 ? items[upTo - 1] : null;
  const current = last && ms < last.end ? last : null;
  let currentPoints = Infinity;
  if (current && current.points > 0) {
    const span = current.end - current.start;
    const frac = span > 0 ? (ms - current.start) / span : 1;
    const n = Math.min(current.points, Math.max(Math.min(2, current.points), Math.ceil(frac * current.points)));
    currentPoints = n >= current.points ? Infinity : n;
  }
  let shown: Map<string, number> | null = null;
  return {
    get shown() {
      if (!shown) {
        shown = new Map();
        for (let i = 0; i < upTo; i++) shown.set(items[i].id, Infinity);
        if (current && currentPoints !== Infinity) shown.set(current.id, currentPoints);
      }
      return shown;
    },
    pageId: last?.pageId ?? items[0]?.pageId ?? null,
    current,
    upTo,
    currentPoints,
  };
}

// ------------------------------------------------------------------ real time <-> replay time

/** The timed items' positions and real times, in replay order (real times never go down along it). */
const TIMED = new WeakMap<Timeline, { index: Int32Array; real: Float64Array }>();

function timedOf(timeline: Timeline): { index: Int32Array; real: Float64Array } {
  let t = TIMED.get(timeline);
  if (!t) {
    const index: number[] = [];
    const real: number[] = [];
    timeline.items.forEach((it, i) => {
      if (it.realAt !== null) {
        index.push(i);
        real.push(it.realAt);
      }
    });
    t = { index: Int32Array.from(index), real: Float64Array.from(real) };
    TIMED.set(timeline, t);
  }
  return t;
}

/**
 * Where on the replay's clock the board looked as it did at real time `at` (ms since the epoch): the
 * end of the last timed item drawn at or before it (0 before the first). Null when nothing is timed.
 */
export function realToReplay(timeline: Timeline, at: number): number | null {
  const { index, real } = timedOf(timeline);
  if (index.length === 0) return null;
  let lo = 0;
  let hi = real.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (real[mid] <= at) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return 0;
  const item = timeline.items[index[lo - 1]];
  // everything after the last timed item (untimed ink placed after it) belongs to "after `at`" too
  return lo === real.length && at > (timeline.realEnd ?? at) ? timeline.durationMs : item.end;
}

/** The real time at `ms` on the replay's clock: the latest timed item's at or before it. Null when unknown. */
export function replayToReal(timeline: Timeline, ms: number): number | null {
  const { index, real } = timedOf(timeline);
  if (index.length === 0) return null;
  const upTo = countStarted(timeline, ms);
  // the last timed item among items[0, upTo)
  let lo = 0;
  let hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index[mid] < upTo) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? null : real[lo - 1];
}

/** When the replay first draws on `pageId` (the start of its first item), or null. */
export function firstOnPage(timeline: Timeline, pageId: string): number | null {
  const it = timeline.items.find((i) => i.pageId === pageId);
  return it ? it.start : null;
}
