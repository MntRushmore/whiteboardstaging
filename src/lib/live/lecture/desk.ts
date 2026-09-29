import type { JsonObject } from "tldraw";
import type { Rect } from "../contracts";
import { problemMetaOf } from "../chat/cells";
import type { ChatAction } from "../chat/contracts";
import { CHAT_BLOCK_META, CHAT_WRITE, type ChatDesk, type ChatHost, type ChatShape } from "../chat/desk";
import { appendHeard } from "./meta";
import { findFreeArea, FREE_AREA } from "../chat/layout";
import { HAND_BLOCK_META, HAND_LINE_META, HAND_PART_META, paceFor, placeHandPlan, type HandLinePlan, type HandPlan } from "../handwriting";
import {
  ChartSpecSchema,
  describeLectureAction,
  DiagramSpecSchema,
  LECTURE_BLOCK_META,
  LECTURE_ID_META,
  LECTURE_LIMITS,
  LECTURE_WHAT_META,
  type ActiveVisual,
  type ChartSpec,
  type DiagramSpec,
  type LectureAction,
  type LectureActionOutcome,
  type LectureActionType,
  type LectureBoard,
  type LecturePageMeta,
  type LectureRunReport,
  type LectureScreen,
  type LectureSpecMeta,
  type SketchAction,
  type SketchDrawing,
  type SketchRequest,
} from "./contracts";
import type { LECTURE_BOXES, LecturePlanOptions } from "./plan";
import type { PanelsLayout, SketchPlanOptions } from "./sketch/plan";

/**
 * Lecture mode's hand: places each of the director's actions on the current screen and writes it
 * in the tutor's hand, one block at a time. A lecture screen reads like a page of good notes — the
 * topic at the top left, the key points down the left under it, the pictures (a chart, a diagram)
 * on the right — and a new screen when this one is full ("<topic> (cont.)") or the topic changes.
 * Graphs, figures, formulas and new screens are the board chat's own actions and go through its
 * desk unchanged (`ChatDesk`), so they are checked and placed exactly as when the student asks.
 *
 * LIVE: a chart or a diagram keeps an id (`LECTURE_ID_META` on its strokes) and its spec, box and
 * seed on the screen's page meta (`LecturePageMeta.visuals`). An update re-plans the old spec and
 * the new one in that same box with that same seed, compares them part by part
 * (`HandLinePlan.part`, `diffParts`), rubs out the parts that changed or went and writes only the
 * parts that changed or came — Q2's bar is drawn next to Q1's, nothing else moves.
 *
 * FREE DRAWING (`sketch`): a picture, or a comic strip of up to four panels. The frames, captions
 * and title (`planPanels`) go on the board at once; each panel's drawing comes from the illustrator
 * (`RequestSketch`, `POST /api/live/lecture/sketch`, ~10–20 s) and fills its frame when it arrives.
 * How that is sequenced without holding up the lecture:
 *
 *  - All the panels are asked for IN PARALLEL, as soon as the frames are placed (before they are
 *    written: the hand's few seconds on the frames are not added to the wait).
 *  - The sketch action ends when its frames are on the board: the run goes on, the session asks the
 *    director again, notes and chart updates keep being written while the drawings load.
 *  - Each drawing is written when it arrives, through the chat desk's turn (`ChatDesk.exclusive`)
 *    like every other block — so a fill and a note never measure the same free space or write at
 *    once — and in READING ORDER: panel 3 arriving before panel 2 waits for it (`PendingSketch.next`).
 *    A panel that fails, or whose drawing cannot be planned, gets a small note in its frame instead;
 *    the others are drawn all the same.
 *  - The sketch's whole box is kept clear while its panels are coming (`obstacles`), so nothing
 *    else is placed in a frame that is still empty.
 *  - Leaving the screen (a new topic, a screen that is full, a new screen) first waits for the
 *    panels still coming on it, up to `LECTURE_LAYOUT.sketch.waitMs` from when they were asked for,
 *    and writes them (`settleSketches`, from inside the turn, so it never waits on itself): the tutor
 *    never walks away from half-empty frames. Only then is the rest of the lecture held up.
 *  - A drawing is only ever written on the screen its frames are on. The student on another screen
 *    when it arrives: it waits for them to come back (tried again on the next arrival, the next run
 *    and the next look at the screen for the director), for `LECTURE_LAYOUT.sketch.keepMs`.
 *
 * The loop is the host (`LiveLoop.lectureHost`): the chat's host plus the screen's page meta and a
 * way to rub strokes out. The planners (`./plan`) are loaded on the first run, not with the board:
 * nobody who never turns lecture mode on downloads them; the sketch planners (`./sketch/plan`)
 * with the first sketch.
 */

export interface LectureHost extends ChatHost {
  /** a screen's `LECTURE_PAGE_META` (the current one's when no page is given; empty when it has none) */
  screenMeta(pageId?: string): LecturePageMeta;
  /** merges into a screen's `LECTURE_PAGE_META` (the current one's by default); saved with the board, outside the undo history */
  setScreenMeta(patch: Partial<LecturePageMeta>, pageId?: string): void;
  /** rubs these shapes out, outside the undo history (as the tutor's own writes are) */
  deleteShapes(ids: readonly string[]): void;
  /** roughly how large the board's saved snapshot is now, in bytes (absent: the desk never stops for size) */
  boardBytes?(): number;
  now?(): number;
}

/** What the desk needs of the planners (`./plan`); injected in tests. */
export interface LecturePlanners {
  boxes: typeof LECTURE_BOXES;
  chart(spec: ChartSpec, opts: LecturePlanOptions): HandPlan | null;
  diagram(spec: DiagramSpec, opts: LecturePlanOptions): HandPlan | null;
  heading(text: string, opts: { seed: number; maxW: number }): HandPlan | null;
  note(text: string, opts: { seed: number; maxW: number }): HandPlan | null;
  /** free drawing's planners; absent, they are loaded from `./sketch/plan` with the first sketch */
  sketches?: SketchPlanners;
}

/** What the desk needs of free drawing's planners (`./sketch/plan`). */
export interface SketchPlanners {
  panels(layout: { count: number; captions: ReadonlyArray<string | undefined>; title?: string; framed: boolean }, opts: SketchPlanOptions): PanelsLayout | null;
  sketch(drawing: SketchDrawing, opts: SketchPlanOptions): HandPlan | null;
}

export type LoadLecturePlanners = () => Promise<LecturePlanners>;

const loadPlanners: LoadLecturePlanners = () =>
  import("./plan").then((m) => ({ boxes: m.LECTURE_BOXES, chart: m.planChart, diagram: m.planDiagram, heading: m.planHeading, note: m.planNote }));

const loadSketchPlanners = (): Promise<SketchPlanners> => import("./sketch/plan").then((m) => ({ panels: m.planPanels, sketch: m.planSketch }));

// ------------------------------------------------------------------ what a run is given

/** One panel as the desk asks for it; the session adds the board and itself (`SketchRequest`). */
export type SketchPanelRequest = Omit<SketchRequest, "boardId" | "session">;
/**
 * Draws one panel: the illustrator's drawing, or a rejection. Rejected with an `AbortError` when
 * the lecture ended or the desk no longer wants it (nothing is written for it then); with anything
 * else when it failed (its frame gets a note).
 */
export type RequestSketch = (req: SketchPanelRequest, signal: AbortSignal) => Promise<SketchDrawing>;

/** How far a sketch's panels are, for the panel's "Drawing the comic…". */
export interface SketchProgress {
  id: string;
  panels: number;
  /** panels drawn into their frames */
  drawn: number;
  /** panels that got a note instead (failed, or could not be drawn there) */
  failed: number;
  /** nothing more will be written for it */
  done: boolean;
}

/**
 * What the session gives a run beyond its actions (`LectureDesk.run`): the way to the illustrator,
 * which knows the board and the lecture's session (`LectureSession`), and where a sketch's progress
 * goes. Without `requestSketch` a sketch is not drawn.
 */
export interface LectureRunOptions {
  requestSketch?: RequestSketch;
  onSketch?(progress: SketchProgress): void;
  /**
   * The lecture has gone on while this run was being drawn (the session has unread words): the
   * hand speeds up (`LECTURE_LAYOUT.catchUpPace`) so a fast talker does not leave the board behind.
   */
  behind?(): boolean;
}

type PanelState = { state: "waiting" } | { state: "ready"; drawing: SketchDrawing } | { state: "failed" } | { state: "dropped" };

/** A sketch whose frames are placed and whose panels are still coming or still to be written. */
interface PendingSketch {
  id: string;
  /** the screen its frames are on: its drawings are never written on another */
  page: string;
  /** its whole box on that screen, kept clear while panels are coming */
  area: Rect;
  /** each panel's drawing area on the page, in reading order */
  frames: Rect[];
  panels: PanelState[];
  /** the next panel to write: the ones before it are written (or given up) */
  next: number;
  drawn: number;
  failed: number;
  seed: number;
  startedAt: number;
  /** the frames are on the board (a panel that arrives sooner waits for them) */
  framed: boolean;
  /** the summary is on a stroke already (with the frames, or with the first panel when there are no frames to carry it) */
  whatWritten: boolean;
  what: string;
  /** every panel's request has settled */
  settled: Promise<void>;
  ctrl: AbortController;
  planners: LecturePlanners;
  sketches: SketchPlanners;
  onSketch?: (p: SketchProgress) => void;
}

function isAbort(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

export const LECTURE_LAYOUT = {
  /** space between the notes column and the pictures to its right */
  gutter: 40,
  /**
   * Under a heading, and between two notes. More than `FREE_AREA.clearance`, so the block above is
   * not in the way of the one under it.
   */
  headingGap: 26,
  noteGap: 22,
  /** a continued screen's heading ("Photosynthesis (cont.)") is written smaller than a topic's */
  contScale: 0.7,
  contMaxW: 900,
  /** the grid `room` is measured on (px): coarse on purpose, it is a hint for the director */
  roomCell: 50,
  /**
   * Strokes a screen may hold before the next block goes on a new one. tldraw refuses to create
   * shapes past `maxShapesPerPage` (4000) with only a toast — the block would silently be lost —
   * and every stroke of a sketch is a shape; the student's own ink needs room under the limit too.
   */
  maxShapesPerScreen: 3200,
  /**
   * The board's saved size past which the lecture stops sketching. The autosave refuses a snapshot
   * over 4 MB (`SNAPSHOT_LIMITS.hardBytes`) — and ink cannot be offloaded like an image — so a board
   * that grew past it would stop saving mid-lecture. A sketch weighs ~60–230 KB (see `estimateBytes`);
   * this leaves room for the rest of the student's own writing.
   */
  boardBudgetBytes: 3_300_000,
  /** two versions of a part are the same ink when every coordinate is within this (px) */
  sameInkPx: 0.01,
  /** how much faster the hand draws while the lecture is ahead of the board (`LectureRunOptions.behind`) */
  catchUpPace: 2.2,
  /**
   * The pen of a sketch's lines — axes, bars, boxes, arrows — as a stroke weight (`Stroke.weight`;
   * its words carry their own, `wordsWeight`): a touch lighter than the tutor's writing pen, so a
   * chart reads as a drawing and its labels stay the loudest thing on it.
   */
  lineWeight: 0.8,
  /**
   * Where the lecture bar floats over the screen (`LectureBar`: bottom centre, above tldraw's
   * toolbar), as fractions of the screen: nothing is sketched there, or the bar would hide it for
   * the whole lecture. Measured with the screen fitted to a 1440 px window; a little generous.
   */
  barZone: { x0: 0.29, x1: 0.71, y0: 0.74 },
  /** between two parts of an update, written one after the other */
  partGapMs: 150,
  /**
   * An update that rewrites most of a sketch (a new scale, a relaid-out diagram) is a redraw of
   * what the student has just seen: written this much faster than the sketch was first drawn.
   */
  redrawShare: 0.6,
  redrawPace: 1.6,
  sketch: {
    /**
     * A comic strip: a wide band across the screen, under the heading, largest first. Its bottom
     * must stay above the lecture bar (`barZone`, from 74 % down): 540 fits under the board's own
     * bar alone, 460 under a heading too.
     */
    comic: [
      { w: 1400, h: 540 },
      { w: 1400, h: 460 },
      { w: 1200, h: 400 },
    ],
    /** one picture: a box like a chart's, to the right of the notes */
    picture: [
      { w: 520, h: 420 },
      { w: 440, h: 360 },
      { w: 360, h: 300 },
    ],
    /** what a panel's drawing is expected to add to the saved board, before it arrives (the board budget) */
    panelBytes: 150_000,
    /** leaving a screen waits for its panels still coming up to this long after they were asked for */
    waitMs: 30_000,
    waitStepMs: 250,
    /** a sketch whose screen the student left: its drawings wait this long for them to come back */
    keepMs: 120_000,
    /** the note in a panel that could not be drawn: at most this scale of a note, and this share of the frame's width */
    failScale: 0.6,
    failWidth: 0.85,
  },
} as const;

export const LECTURE_NOTES = {
  handOff: "Turn on the tutor's handwriting to see sketches.",
  movedAway: "I stopped because you moved to another screen.",
  noScreens: "This board already has the most screens it can hold.",
  cannotSketch: "I couldn't sketch that.",
  cannotWrite: "I couldn't write that on the board.",
  noRoom: "There's no room left for that on this board.",
  failed: "Something went wrong drawing that, so I left it out.",
  boardFull: "This board is nearly too big to save, so I've stopped sketching. Start a new board for the rest of the lecture.",
  /** written in a comic's frame whose drawing failed (the others are drawn all the same) */
  panelFailed: "Couldn't draw this one",
} as const;

type Report = LectureRunReport;
type OwnAction = Extract<LectureAction, { type: "heading" | "note" | "chart" | "diagram" | "update_chart" | "update_diagram" | "sketch" }>;
type VisualKind = "chart" | "diagram";
type Spec = { kind: VisualKind; chart?: ChartSpec; diagram?: DiagramSpec };

/** One lecture (or chat) block on the screen: its strokes' union, its meta. */
interface Block {
  key: string;
  bounds: Rect;
  meta: Record<string, unknown>;
  /** the block's `LECTURE_WHAT_META` (on its first stroke only) */
  what: string;
  /** the topmost stroke's `HAND_LINE_META` (a graph's equation is written above it) */
  topLine: string;
  topY: number;
  lines: Array<{ latex: string; y: number }>;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function metaOf(s: ChatShape): Record<string, unknown> {
  return s.meta && typeof s.meta === "object" ? (s.meta as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A heading as the director may be told it: the words, none of the characters a heading may not hold. */
function cleanTopic(s: string | undefined): string | null {
  const t = (s ?? "").replace(/[\\$<>{}\n\r\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, LECTURE_LIMITS.heading).trim();
  return t || null;
}

function clipWhat(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= LECTURE_LIMITS.whatChars ? t : `${t.slice(0, LECTURE_LIMITS.whatChars - 1)}…`;
}

/**
 * The plan with every coordinate at 1/100 px. The hand's strokes come out of the layout at full
 * double precision — 17 digits a coordinate, ~65 bytes a point in the saved board — and a lecture
 * writes tens of thousands of points an hour. A hundredth of a pixel is far below anything the
 * screen can show (tldraw's own pen keeps two decimals too); it makes a sketch ~35 % lighter.
 */
/** The plan with every stroke that has no pen weight of its own (a sketch's lines) given `weight`. */
export function weighPlan(plan: HandPlan, weight: number): HandPlan {
  return { ...plan, lines: plan.lines.map((l) => ({ ...l, strokes: l.strokes.map((st) => (st.weight === undefined ? { ...st, weight } : st)) })) };
}

export function roundPlan(plan: HandPlan): HandPlan {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    ...plan,
    lines: plan.lines.map((l) => ({
      ...l,
      x: r(l.x),
      y: r(l.y),
      strokes: l.strokes.map((st) => ({ ...st, points: st.points.map((p) => ({ x: r(p.x), y: r(p.y), z: r(p.z) })) })),
    })),
    bounds: { x: r(plan.bounds.x), y: r(plan.bounds.y), w: plan.bounds.w, h: plan.bounds.h },
  };
}

/** The plan drawn `s` times its size, about its top-left corner (a continued screen's smaller heading). */
export function scalePlan(plan: HandPlan, s: number): HandPlan {
  const { x: ox, y: oy } = plan.bounds;
  return {
    ...plan,
    lines: plan.lines.map((l) => ({
      ...l,
      x: ox + (l.x - ox) * s,
      y: oy + (l.y - oy) * s,
      baseline: l.baseline * s,
      strokes: l.strokes.map((st) => ({ ...st, points: st.points.map((p) => ({ ...p, x: p.x * s, y: p.y * s })) })),
    })),
    bounds: { x: ox, y: oy, w: plan.bounds.w * s, h: plan.bounds.h * s },
    size: plan.size * s,
  };
}

// ------------------------------------------------------------------ parts: what an update rewrites

/** FNV-1a, base 36: a short stable name for a line's ink. */
function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function inkKey(l: HandLinePlan): string {
  const r = (n: number) => Math.round(n * 100);
  const style = l.style ? `${l.style.color ?? ""}/${l.style.fill ?? ""}/${l.style.closed ? 1 : 0}` : "";
  return `${r(l.x)},${r(l.y)}|${style}|${l.strokes.map((st) => st.points.map((p) => `${r(p.x)},${r(p.y)}`).join(" ")).join(";")}`;
}

/** The same ink, to `LECTURE_LAYOUT.sameInkPx`: where every point is, and how it is inked. */
function sameInk(a: readonly HandLinePlan[], b: readonly HandLinePlan[]): boolean {
  const tol = LECTURE_LAYOUT.sameInkPx + 1e-9;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (Math.abs(p.x - q.x) > tol || Math.abs(p.y - q.y) > tol || p.strokes.length !== q.strokes.length) return false;
    if ((p.style?.color ?? "") !== (q.style?.color ?? "") || (p.style?.fill ?? "") !== (q.style?.fill ?? "") || Boolean(p.style?.closed) !== Boolean(q.style?.closed)) return false;
    for (let j = 0; j < p.strokes.length; j++) {
      const s = p.strokes[j].points;
      const t = q.strokes[j].points;
      if (s.length !== t.length) return false;
      for (let k = 0; k < s.length; k++) if (Math.abs(s[k].x - t[k].x) > tol || Math.abs(s[k].y - t[k].y) > tol) return false;
    }
  }
  return true;
}

/**
 * A plan's lines by part (`HandLinePlan.part`), in plan order. A line the planner did not name is a
 * part of its own, named by its ink (`~<hash>`): kept when an update draws it exactly the same, and
 * rewritten otherwise — so the diff works, only coarser, before every planner names its parts.
 */
export function partsOf(plan: HandPlan): Map<string, HandLinePlan[]> {
  const out = new Map<string, HandLinePlan[]>();
  const unnamed = new Map<string, number>();
  for (const l of plan.lines) {
    let key = l.part;
    if (!key) {
      const ink = `~${hashOf(inkKey(l))}`;
      const n = unnamed.get(ink) ?? 0;
      unnamed.set(ink, n + 1);
      key = n === 0 ? ink : `${ink}#${n}`;
    }
    const list = out.get(key);
    if (list) list.push(l);
    else out.set(key, [l]);
  }
  return out;
}

/** Every line named with its part (`partsOf`), so each stroke is stamped with it (`HAND_PART_META`). */
export function withParts(plan: HandPlan): HandPlan {
  const lines: HandLinePlan[] = [];
  for (const [part, ls] of partsOf(plan)) for (const l of ls) lines.push({ ...l, part });
  lines.sort((a, b) => a.startMs - b.startMs);
  return { ...plan, lines };
}

export interface PartsDiff {
  /** parts of the old plan whose strokes stay as they are */
  keep: string[];
  /** parts of the old plan to rub out: gone, or drawn differently now */
  remove: string[];
  /** the new plan's lines to write (new parts, and changed ones), each named with its part */
  add: HandLinePlan[];
  /** how many of the new plan's parts are written (`add`), of how many */
  written: number;
  total: number;
}

/**
 * What an update changes: the old spec's plan and the new spec's plan (same box, same seed), part
 * by part. A part with the same name and the same ink in both stays; the rest of the old goes; the
 * rest of the new is written.
 */
export function diffParts(before: HandPlan, after: HandPlan): PartsDiff {
  const old = partsOf(before);
  const next = partsOf(after);
  const keep: string[] = [];
  const remove: string[] = [];
  for (const [key, lines] of old) {
    const now = next.get(key);
    if (now && sameInk(lines, now)) keep.push(key);
    else remove.push(key);
  }
  const kept = new Set(keep);
  const add: HandLinePlan[] = [];
  let written = 0;
  for (const [key, lines] of next) {
    if (kept.has(key)) continue;
    written++;
    for (const l of lines) add.push({ ...l, part: key });
  }
  add.sort((a, b) => a.startMs - b.startMs);
  return { keep, remove, add, written, total: next.size };
}

function lineBounds(l: HandLinePlan): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const st of l.strokes) {
    for (const p of st.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: l.x + minX, y: l.y + minY, w: maxX - minX, h: maxY - minY };
}

/**
 * These lines of a plan as a plan of their own, written one after the other from the start (not at
 * the times they had in the whole sketch), at the sketch's own pace — faster when it is a redraw.
 */
export function partialPlan(lines: readonly HandLinePlan[], of: HandPlan, redraw: boolean): HandPlan | null {
  let t = 0;
  let bounds: Rect | null = null;
  const out: HandLinePlan[] = [];
  for (const l of [...lines].sort((a, b) => a.startMs - b.startMs)) {
    const b = lineBounds(l);
    if (!b) continue;
    bounds = bounds ? union(bounds, b) : b;
    out.push({ ...l, startMs: t });
    t += l.durationMs + LECTURE_LAYOUT.partGapMs;
  }
  if (!bounds || out.length === 0) return null;
  const totalMs = Math.max(0, t - LECTURE_LAYOUT.partGapMs);
  const pace = (of.pace ?? paceFor(of.totalMs)) * (redraw ? LECTURE_LAYOUT.redrawPace : 1);
  return { lines: out, bounds, size: of.size, totalMs, pace };
}

// ------------------------------------------------------------------ the desk

export class LectureDesk implements LectureBoard {
  private readonly host: LectureHost;
  private readonly chat: ChatDesk;
  private readonly load: LoadLecturePlanners;
  private planners: Promise<LecturePlanners> | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  /** is the lecture ahead of the board (the latest run's `behind`)? */
  private behind: (() => boolean) | null = null;

  /** The plan at a faster pace while the lecture is ahead of the board, else as it is. */
  private paced(plan: HandPlan): HandPlan {
    let behind = false;
    try {
      behind = this.behind?.() === true;
    } catch {
      behind = false;
    }
    return behind ? { ...plan, pace: (plan.pace ?? 1) * LECTURE_LAYOUT.catchUpPace } : plan;
  }
  private expectedPage = "";
  private running = 0;
  private ids = 0;
  /** the run was cut short (the student moved to another screen): the rest is not drawn */
  private stopped = false;
  private sketchPlanners: Promise<SketchPlanners> | null = null;
  /** sketches whose panels are still coming or still to be written, oldest first */
  private readonly pending = new Set<PendingSketch>();

  constructor(host: LectureHost, chat: ChatDesk, planners: LecturePlanners | LoadLecturePlanners = loadPlanners) {
    this.host = host;
    this.chat = chat;
    this.load = typeof planners === "function" ? planners : async () => planners;
  }

  /** Actions are being written. */
  get busy(): boolean {
    return this.running > 0;
  }

  /** Sketches whose panels are still being drawn. */
  get sketching(): number {
    return this.pending.size;
  }

  // ---------------------------------------------------------------- the screen, for the director

  /**
   * What is on this screen, in words: its topic, what is drawn on it, how much room is left, what
   * can be updated. Looking at the screen is also when a panel that arrived while the student was on
   * another screen is written, now they are back on its own.
   */
  screen(): LectureScreen {
    this.flushAll();
    const shapes = this.host.shapes();
    const meta = this.host.screenMeta();
    return {
      empty: shapes.length === 0,
      topic: cleanTopic(meta.topic),
      drawn: this.drawn(shapes, meta),
      room: this.room(shapes),
      active: this.active(shapes, meta),
    };
  }

  /**
   * The live charts and diagrams on this screen, newest first: those whose strokes are still there
   * (one the student rubbed out is not live), with their specs as drawn now. A spec that no longer
   * passes the contract (an older board) is left out rather than failing the director's request.
   */
  private active(shapes: readonly ChatShape[], meta: LecturePageMeta): ActiveVisual[] {
    const present = this.visualIds(shapes);
    const out: ActiveVisual[] = [];
    const entries = Object.entries(meta.visuals ?? {})
      .filter(([id]) => present.has(id) && id.length <= LECTURE_LIMITS.idChars)
      .sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));
    for (const [id, v] of entries) {
      const spec = validSpec(v);
      if (spec?.chart) out.push({ id, chart: spec.chart });
      else if (spec?.diagram) out.push({ id, diagram: spec.diagram });
      if (out.length >= LECTURE_LIMITS.active) break;
    }
    return out;
  }

  /**
   * One line per block the tutor drew here, in reading order: a lecture block's own summary (a
   * heading's or a note's `LECTURE_WHAT_META`, a chart's or a diagram's from its spec), and a word
   * or two for the chat's graphs, figures and formulas — whether the lecture or the student asked
   * for them, they are on the screen and should not be drawn again.
   */
  private drawn(shapes: readonly ChatShape[], meta: LecturePageMeta): string[] {
    const items: Array<{ what: string; y: number; x: number }> = [];
    const seen = new Set<string>();
    for (const b of this.blocks(shapes).values()) {
      const kind = str(b.meta[CHAT_BLOCK_META]);
      const lecture = str(b.meta[LECTURE_BLOCK_META]);
      const id = str(b.meta[LECTURE_ID_META]);
      let what = "";
      if (id) {
        // a chart or a diagram as it is now (its spec); a sketch by the summary its first stroke carries
        const spec = validSpec(meta.visuals?.[id]);
        what = spec?.chart ? describeLectureAction({ type: "chart", chart: spec.chart }) : spec?.diagram ? describeLectureAction({ type: "diagram", diagram: spec.diagram }) : b.what || lecture;
      } else if (lecture) what = b.what;
      else if (kind === "graph") what = b.topLine ? `graph: ${b.topLine}` : "graph";
      else if (kind === "figure") what = "geometry figure";
      else if (kind === "lines") {
        const lines = [...new Set(b.lines.sort((p, q) => p.y - q.y).map((l) => l.latex).filter(Boolean))];
        what = lines.length ? `formula: ${lines.join("; ")}` : "";
      }
      what = clipWhat(what);
      if (!what || seen.has(what)) continue;
      seen.add(what);
      items.push({ what, y: b.bounds.y, x: b.bounds.x });
    }
    return items
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .slice(0, LECTURE_LIMITS.drawn)
      .map((i) => i.what);
  }

  /**
   * Roughly how much of the screen is still free (0..1): the share of a coarse grid over the area
   * blocks are placed in (inside the margins, under the board's bar) that nothing covers.
   */
  private room(shapes: readonly ChatShape[]): number {
    const screen = this.host.screen();
    const x0 = screen.x + FREE_AREA.margin;
    const y0 = screen.y + FREE_AREA.top;
    const x1 = screen.x + screen.w - FREE_AREA.margin;
    const y1 = screen.y + screen.h - FREE_AREA.margin;
    const cell = LECTURE_LAYOUT.roomCell;
    const cols = Math.ceil((x1 - x0) / cell);
    const rows = Math.ceil((y1 - y0) / cell);
    if (cols <= 0 || rows <= 0) return 0;
    // each obstacle marks the cells it touches (1): a lecture screen holds thousands of strokes; the
    // cells under the lecture bar (2) are never free, and are not part of the room either
    const covered = new Uint8Array(cols * rows);
    const mark = (o: Rect, v: number) => {
      const c0 = Math.max(0, Math.floor((o.x - x0) / cell));
      const c1 = Math.min(cols - 1, Math.ceil((o.x + o.w - x0) / cell) - 1);
      const r0 = Math.max(0, Math.floor((o.y - y0) / cell));
      const r1 = Math.min(rows - 1, Math.ceil((o.y + o.h - y0) / cell) - 1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) covered[r * cols + c] = v;
    };
    for (const o of this.obstacles(shapes, false)) mark(o, 1);
    mark(this.barZone(), 2);
    let free = 0;
    let usable = 0;
    for (const v of covered) {
      if (v === 2) continue;
      usable++;
      if (!v) free++;
    }
    return usable === 0 ? 0 : Math.round((free / usable) * 100) / 100;
  }

  // ---------------------------------------------------------------- the transcript

  /**
   * Appends what was heard to this screen's saved transcript, keeping the last
   * `screenTranscriptChars` (older text is dropped from the front, at a word).
   */
  saveTranscript(text: string): void {
    if (!text.trim()) return;
    this.host.setScreenMeta({ transcript: appendHeard(this.host.screenMeta().transcript ?? "", text) });
  }

  // ---------------------------------------------------------------- running the director's actions

  /**
   * Runs the actions in order, one block at a time; a second call waits for the first. Resolves
   * when the last is on the page — for a sketch, when its frames are: its drawings are written as
   * they arrive, after the run (`opts.onSketch` hears how far they are).
   */
  run(actions: readonly LectureAction[], opts: LectureRunOptions = {}): Promise<Report> {
    if (opts.behind) this.behind = opts.behind;
    const next = this.tail.then(() => this.runNow(actions, opts));
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async runNow(actions: readonly LectureAction[], opts: LectureRunOptions): Promise<Report> {
    this.running++;
    this.stopped = false;
    const report: Report = { outcomes: [], screensAdded: 0 };
    try {
      this.flushAll();
      this.expectedPage = this.host.pageId();
      for (const action of actions) {
        if (!this.onScreen()) {
          report.outcomes.push({ type: action.type, ok: false, note: LECTURE_NOTES.movedAway });
          break;
        }
        let out: LectureActionOutcome;
        try {
          out = await this.runOne(action, report, opts);
        } catch (e) {
          this.host.metric?.("live.lecture.failed", { type: action.type, error: e instanceof Error ? e.message : String(e) });
          out = { type: action.type, ok: false, note: LECTURE_NOTES.failed };
        }
        report.outcomes.push(out.ok ? { ...out, what: describeLectureAction(action) } : out);
        if (this.stopped) break;
      }
    } finally {
      this.running--;
    }
    return report;
  }

  private runOne(action: LectureAction, report: Report, opts: LectureRunOptions): Promise<LectureActionOutcome> {
    switch (action.type) {
      case "heading":
      case "note":
      case "chart":
      case "diagram":
      case "update_chart":
      case "update_diagram":
      case "sketch":
        return this.own(action, report, opts);
      case "graph":
      case "draw_figure":
      case "write_lines":
      case "new_screen":
        return this.delegate(action, report);
    }
  }

  /**
   * The chat's own actions, through its desk: its outcome, its screens. The chat may move to a new
   * screen (a new screen asked for, a graph with no room here): the panels still coming on this one
   * are written first.
   */
  private async delegate(action: Extract<LectureAction, { type: ChatAction["type"] }>, report: Report): Promise<LectureActionOutcome> {
    const topic = cleanTopic(this.host.screenMeta().topic);
    if (this.pendingHere()) await this.chat.exclusive(() => this.settleSketches());
    const res = await this.chat.run([action]);
    report.screensAdded += res.screensAdded;
    if (res.screensAdded > 0) {
      // the chat moved to a screen of its own: the lecture goes on there, on the same topic when
      // the graph (or the figure, the formula) only overflowed onto it
      this.expectedPage = this.host.pageId();
      if (topic && action.type !== "new_screen") this.host.setScreenMeta({ topic });
    }
    const o = res.outcomes[0];
    if (!o) return { type: action.type, ok: false, note: LECTURE_NOTES.cannotWrite };
    return { type: action.type, ok: o.ok, ...(o.note ? { note: o.note } : {}) };
  }

  /** The lecture's own blocks: planned here, written in the chat desk's turn. */
  private async own(action: OwnAction, report: Report, opts: LectureRunOptions): Promise<LectureActionOutcome> {
    if (!this.host.handwriting()) return { type: action.type, ok: false, note: LECTURE_NOTES.handOff };
    const planners = await this.plannersOnce();
    if (action.type === "sketch") {
      if (!opts.requestSketch) return { type: "sketch", ok: false, note: LECTURE_NOTES.cannotSketch };
      const sketches = await this.sketchPlannersOnce(planners);
      return this.chat.exclusive(() => this.sketch(action, planners, sketches, report, opts));
    }
    return this.chat.exclusive(async () => {
      switch (action.type) {
        case "heading":
          return this.heading(action.text, planners, report);
        case "note":
          return this.note(action.text, planners, report);
        case "chart":
          return this.visual(action.type, { kind: "chart", chart: action.chart }, planners, report);
        case "diagram":
          return this.visual(action.type, { kind: "diagram", diagram: action.diagram }, planners, report);
        case "update_chart":
          return this.update(action.type, action.target, { kind: "chart", chart: action.chart }, planners, report);
        case "update_diagram":
          return this.update(action.type, action.target, { kind: "diagram", diagram: action.diagram }, planners, report);
      }
    });
  }

  private plannersOnce(): Promise<LecturePlanners> {
    if (!this.planners) {
      this.planners = this.load();
      // a failed download is tried again on the next action, not remembered
      this.planners.catch(() => (this.planners = null));
    }
    return this.planners;
  }

  /** The sketch planners: the injected ones, else `./sketch/plan`, loaded with the first sketch. */
  private sketchPlannersOnce(planners: LecturePlanners): Promise<SketchPlanners> {
    if (planners.sketches) return Promise.resolve(planners.sketches);
    if (!this.sketchPlanners) {
      this.sketchPlanners = loadSketchPlanners();
      this.sketchPlanners.catch(() => (this.sketchPlanners = null));
    }
    return this.sketchPlanners;
  }

  // ---------------------------------------------------------------- heading

  /** A new topic, at the top left of a screen of its own (a new one when this one has anything on it). */
  private async heading(text: string, planners: LecturePlanners, report: Report): Promise<LectureActionOutcome> {
    const plan = planners.heading(text, { seed: this.host.seed(`lecture:heading:${text}`), maxW: this.headingMaxW(planners) });
    if (!plan) return { type: "heading", ok: false, note: LECTURE_NOTES.cannotWrite };
    if (this.boardFull(plan)) return { type: "heading", ok: false, note: LECTURE_NOTES.boardFull };
    await this.waitForHand();
    if (!this.onScreen()) return this.movedAway("heading");
    if (this.host.shapes().length > 0) {
      if (!(await this.newScreen(report))) return { type: "heading", ok: false, note: LECTURE_NOTES.noScreens };
    }
    const screen = this.host.screen();
    const page = this.expectedPage;
    const ok = await this.writeText(plan, { x: screen.x + FREE_AREA.margin, y: screen.y + FREE_AREA.top }, "heading", describeLectureAction({ type: "heading", text }));
    if (!ok) return this.movedAway("heading");
    this.host.setScreenMeta({ topic: text }, page);
    return { type: "heading", ok: true };
  }

  private headingMaxW(planners: LecturePlanners): number {
    return Math.min(planners.boxes.heading.maxW, this.host.screen().w - 2 * FREE_AREA.margin);
  }

  // ---------------------------------------------------------------- note

  /** A key point, down the notes column: under the note before it, else under the heading, else wherever there is room. */
  private async note(text: string, planners: LecturePlanners, report: Report): Promise<LectureActionOutcome> {
    const maxW = Math.min(planners.boxes.note.maxW, this.host.screen().w - 2 * FREE_AREA.margin);
    const plan = planners.note(text, { seed: this.host.seed(`lecture:note:${text}`), maxW });
    if (!plan) return { type: "note", ok: false, note: LECTURE_NOTES.cannotWrite };
    if (this.boardFull(plan)) return { type: "note", ok: false, note: LECTURE_NOTES.boardFull };
    await this.waitForHand();
    if (!this.onScreen()) return this.movedAway("note");
    let at = this.notePlace(plan, planners);
    if (!at) {
      if (!(await this.continueOnNewScreen(planners, report))) return { type: "note", ok: false, note: LECTURE_NOTES.noRoom };
      at = this.notePlace(plan, planners);
      if (!at) return { type: "note", ok: false, note: LECTURE_NOTES.noRoom };
    }
    const ok = await this.writeText(plan, at, "note", describeLectureAction({ type: "note", text }));
    return ok ? { type: "note", ok: true } : this.movedAway("note");
  }

  /**
   * Under the last note written here (or the heading), else the first free place in the notes
   * column below it, else below the heading anywhere. Never beside the heading: the top line is
   * the topic's. Null: this screen has no room for it.
   */
  private notePlace(plan: HandPlan, planners: LecturePlanners): { x: number; y: number } | null {
    const size = { w: plan.bounds.w, h: plan.bounds.h };
    const screen = this.host.screen();
    const shapes = this.host.shapes();
    if (crowded(shapes, plan)) return null;
    const obstacles = this.obstacles(shapes);
    const blocks = [...this.blocks(shapes).values()];
    const notes = blocks.filter((b) => b.meta[LECTURE_BLOCK_META] === "note");
    const last = notes.sort((a, b) => num(b.meta.createdAt) - num(a.meta.createdAt) || b.bounds.y + b.bounds.h - (a.bounds.y + a.bounds.h))[0];
    const heading = topHeading(blocks);
    const under = last ? { b: last.bounds, gap: LECTURE_LAYOUT.noteGap } : heading ? { b: heading.bounds, gap: LECTURE_LAYOUT.headingGap } : null;
    if (under) {
      const r = { x: under.b.x, y: under.b.y + under.b.h + under.gap, w: size.w, h: size.h };
      if (this.fits(r, screen, obstacles)) return r;
    }
    const column: Rect = { x: screen.x, y: screen.y, w: Math.min(screen.w, 2 * FREE_AREA.margin + planners.boxes.note.maxW), h: screen.h };
    const top = underHeading(heading, screen);
    const afterLast = last ? findFreeArea(size, from(column, Math.max(top, last.bounds.y + last.bounds.h + LECTURE_LAYOUT.noteGap - screen.y)), obstacles) : null;
    return afterLast ?? findFreeArea(size, from(column, top), obstacles) ?? findFreeArea(size, from(screen, top), obstacles);
  }

  // ---------------------------------------------------------------- chart, diagram

  /**
   * A new picture: as large as it fits (`boxes.visual`, largest first), to the right of the notes
   * column when there is room there, else anywhere on the screen; a new screen, carrying the
   * topic, when nothing fits here. Its whole box is kept for it (an update may grow into it), and
   * it is recorded — id, spec, box, seed, place — so it can be updated.
   */
  private async visual(type: LectureActionType, spec: Spec, planners: LecturePlanners, report: Report, reuseId?: string): Promise<LectureActionOutcome> {
    const seed = this.host.seed(`lecture:${spec.kind}:${JSON.stringify(spec.chart ?? spec.diagram).slice(0, 400)}`);
    const plans = planners.boxes.visual.map((box) => this.planIn(spec, planners, { seed, box: { w: box.w, h: box.h } }));
    const largest = plans.find((p): p is HandPlan => p !== null);
    if (!largest) return { type, ok: false, note: LECTURE_NOTES.cannotSketch };
    if (this.boardFull(largest)) return { type, ok: false, note: LECTURE_NOTES.boardFull };
    await this.waitForHand();
    if (!this.onScreen()) return this.movedAway(type);
    let placed = this.visualPlace(plans, planners);
    if (!placed) {
      if (!(await this.continueOnNewScreen(planners, report))) return { type, ok: false, note: LECTURE_NOTES.noRoom };
      placed = this.visualPlace(plans, planners);
      if (!placed) return { type, ok: false, note: LECTURE_NOTES.noRoom };
    }
    const id = reuseId ?? this.newId();
    const page = this.expectedPage;
    const plan = withParts(placed.plan);
    const at = { x: placed.slot.x + plan.bounds.x, y: placed.slot.y + plan.bounds.y };
    if (!(await this.writeVisual(placeHandPlan(plan, at), spec.kind, id))) return this.movedAway(type);
    const box = planners.boxes.visual[placed.box];
    this.record(id, { ...specOf(spec), box: { w: box.w, h: box.h }, seed, at, updatedAt: this.now() }, page);
    this.host.metric?.("live.lecture.visual", { type: spec.kind, kind: (spec.chart ?? spec.diagram)?.kind, box: placed.box, screens: report.screensAdded });
    return { type, ok: true, id };
  }

  private visualPlace(plans: readonly (HandPlan | null)[], planners: LecturePlanners): { plan: HandPlan; slot: { x: number; y: number }; box: number } | null {
    const screen = this.host.screen();
    const shapes = this.host.shapes();
    const obstacles = this.obstacles(shapes);
    const top = underHeading(topHeading([...this.blocks(shapes).values()]), screen);
    // `findFreeArea` keeps its margin inside this rect: the pictures start a gutter past the notes column
    const left = planners.boxes.note.maxW + LECTURE_LAYOUT.gutter;
    const right: Rect = { x: screen.x + left, y: screen.y, w: Math.max(0, screen.w - left), h: screen.h };
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      if (!plan || crowded(shapes, plan)) continue;
      // the whole box, not the ink: an update may draw anywhere in it
      const size = { w: Math.max(planners.boxes.visual[i].w, plan.bounds.w), h: Math.max(planners.boxes.visual[i].h, plan.bounds.h) };
      const slot = findFreeArea(size, from(right, top), obstacles) ?? findFreeArea(size, from(screen, top), obstacles);
      if (slot) return { plan, slot, box: i };
    }
    return null;
  }

  // ---------------------------------------------------------------- live updates

  /**
   * LIVE: the chart (or diagram) `target`, as it should now be. On this screen and of the same
   * kind: both specs are planned in its box with its seed, and only what changed is rubbed out and
   * written (`diffParts`) — Q2's bar and its value, or the one bar that was corrected; a new scale
   * rewrites most of it, faster. Otherwise (erased, on another screen, a pie that became a bar
   * chart) it is drawn as a new one, with a new id.
   */
  private async update(type: LectureActionType, target: string, spec: Spec, planners: LecturePlanners, report: Report): Promise<LectureActionOutcome> {
    await this.waitForHand();
    if (!this.onScreen()) return this.movedAway(type);
    const entry = this.host.screenMeta().visuals?.[target];
    const strokes = this.host.shapes().filter((s) => str(metaOf(s)[LECTURE_ID_META]) === target);
    const before = entry ? validSpec(entry) : null;
    const was = before?.chart ?? before?.diagram;
    const now = spec.chart ?? spec.diagram;
    if (!entry || !before || strokes.length === 0 || before.kind !== spec.kind || !was || !now || was.kind !== now.kind) {
      this.host.metric?.("live.lecture.update.new", { reason: !entry || strokes.length === 0 ? "gone" : "kind" });
      return this.visual(type, spec, planners, report);
    }
    const opts = { seed: entry.seed, box: entry.box };
    const after = this.planIn(spec, planners, opts);
    if (!after) {
      // it has outgrown its box: drawn again, as large as it fits, under the same id
      this.host.deleteShapes(strokes.map((s) => s.id));
      return this.visual(type, spec, planners, report, target);
    }
    const prev = this.planIn(before, planners, opts);
    // where the plan's own (0, 0) is on the page: the same for the old plan and the new one
    const origin = prev ? { x: entry.at.x - prev.bounds.x, y: entry.at.y - prev.bounds.y } : { x: entry.at.x - after.bounds.x, y: entry.at.y - after.bounds.y };
    let rub: string[];
    let lines: HandLinePlan[];
    let redraw: boolean;
    if (prev) {
      const d = diffParts(prev, after);
      const gone = new Set(d.remove);
      rub = strokes.filter((s) => gone.has(str(metaOf(s)[HAND_PART_META]))).map((s) => s.id);
      lines = d.add;
      redraw = d.total > 0 && d.written / d.total >= LECTURE_LAYOUT.redrawShare;
      this.host.metric?.("live.lecture.update", { kept: d.keep.length, removed: d.remove.length, written: d.written, total: d.total });
    } else {
      // the old spec cannot be planned again (the planners changed since): a redraw in place
      rub = strokes.map((s) => s.id);
      lines = withParts(after).lines;
      redraw = true;
    }
    const partial = lines.length > 0 ? partialPlan(lines, after, redraw) : null;
    if (partial && this.boardFull(partial)) return { type, ok: false, note: LECTURE_NOTES.boardFull };
    const page = this.expectedPage;
    if (rub.length > 0) this.host.deleteShapes(rub);
    if (partial && !(await this.writeVisual(placeHandPlan(partial, { x: origin.x + partial.bounds.x, y: origin.y + partial.bounds.y }), spec.kind, target))) {
      return this.movedAway(type);
    }
    this.record(target, { ...entry, ...specOf(spec), updatedAt: this.now() }, page);
    return { type, ok: true, id: target };
  }

  /**
   * A spec planned in a box; null when the planner cannot draw it there (or fails). A title that
   * only repeats the screen's heading ("How a product gets built" under "How a product gets
   * built") is left off; the same rule plans a live visual before and after an update, so the
   * two still match part for part.
   */
  private planIn(spec: Spec, planners: LecturePlanners, opts: LecturePlanOptions): HandPlan | null {
    const topic = (this.host.screenMeta().topic ?? "").trim().toLowerCase();
    const untitled = <T extends { title?: string }>(v: T): T => (topic && v.title?.trim().toLowerCase() === topic ? { ...v, title: undefined } : v);
    try {
      if (spec.kind === "chart" && spec.chart) return planners.chart(untitled(spec.chart), opts);
      if (spec.kind === "diagram" && spec.diagram) return planners.diagram(untitled(spec.diagram), opts);
    } catch (e) {
      this.host.metric?.("live.lecture.plan.failed", { type: spec.kind, error: e instanceof Error ? e.message : String(e) });
    }
    return null;
  }

  /**
   * Keeps a visual on its screen's page meta, promptly (an update needs it next). Entries whose
   * strokes are all gone from the current screen are dropped as it is written.
   */
  private record(id: string, entry: LectureSpecMeta, page: string): void {
    const cur = this.host.screenMeta(page).visuals ?? {};
    const here = page === this.host.pageId() ? this.visualIds(this.host.shapes()) : null;
    const visuals: Record<string, LectureSpecMeta> = {};
    for (const [k, v] of Object.entries(cur)) if (!here || here.has(k)) visuals[k] = v;
    visuals[id] = JSON.parse(JSON.stringify(entry)) as LectureSpecMeta;
    this.host.setScreenMeta({ visuals }, page);
  }

  private newId(): string {
    return `lv_${this.now().toString(36)}${(++this.ids).toString(36)}${Math.floor(Math.random() * 1296)
      .toString(36)
      .padStart(2, "0")}`;
  }

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  /** The ids of the live visuals whose strokes are on the screen. */
  private visualIds(shapes: readonly ChatShape[]): Set<string> {
    const out = new Set<string>();
    for (const s of shapes) {
      const id = str(metaOf(s)[LECTURE_ID_META]);
      if (id) out.add(id);
    }
    return out;
  }

  // ---------------------------------------------------------------- free drawing

  /**
   * A picture or a comic strip: its frames, captions and title laid out (a comic in a wide band
   * under the heading, a picture in a chart's box to the right of the notes; a new screen, carrying
   * the topic, when it does not fit here), its panels asked for in parallel, its frames written.
   * Done then: each drawing fills its frame when it arrives (`flush`), in reading order.
   */
  private async sketch(action: SketchAction, planners: LecturePlanners, sketches: SketchPlanners, report: Report, opts: LectureRunOptions): Promise<LectureActionOutcome> {
    const type = "sketch";
    const request = opts.requestSketch;
    if (!request) return { type, ok: false, note: LECTURE_NOTES.cannotSketch };
    const n = action.panels.length;
    const comic = n > 1;
    const topic = (this.host.screenMeta().topic ?? "").trim().toLowerCase();
    // a title that only repeats the screen's heading is left off (as a chart's is)
    const title = action.title && action.title.trim().toLowerCase() !== topic ? action.title : undefined;
    const seed = this.host.seed(`lecture:sketch:${JSON.stringify(action).slice(0, 400)}`);
    const boxes = comic ? LECTURE_LAYOUT.sketch.comic : LECTURE_LAYOUT.sketch.picture;
    const layout = { count: n, captions: action.panels.map((p) => p.caption), ...(title ? { title } : {}), framed: comic };
    const plans = boxes.map((box) => this.panelsIn(sketches, layout, { seed, box: { w: box.w, h: box.h } }));
    const largest = plans.find((p): p is PanelsLayout => p !== null);
    if (!largest) return { type, ok: false, note: LECTURE_NOTES.cannotSketch };
    if (this.boardFull(largest.plan, n * LECTURE_LAYOUT.sketch.panelBytes)) return { type, ok: false, note: LECTURE_NOTES.boardFull };
    await this.waitForHand();
    if (!this.onScreen()) return this.movedAway(type);
    let placed = this.sketchPlace(plans, comic, planners);
    if (!placed) {
      if (!(await this.continueOnNewScreen(planners, report))) return { type, ok: false, note: LECTURE_NOTES.noRoom };
      placed = this.sketchPlace(plans, comic, planners);
      if (!placed) return { type, ok: false, note: LECTURE_NOTES.noRoom };
    }
    const { slot, box } = placed;
    // the plan's own (0, 0) goes at the slot: its frames are in the same coordinates as its ink
    const frames = placed.layout.frames.map((f) => ({ x: slot.x + f.x, y: slot.y + f.y, w: f.w, h: f.h }));
    const sk: PendingSketch = {
      id: this.newId(),
      page: this.expectedPage,
      area: { x: slot.x, y: slot.y, w: box.w, h: box.h },
      frames,
      panels: action.panels.map(() => ({ state: "waiting" })),
      next: 0,
      drawn: 0,
      failed: 0,
      seed,
      startedAt: this.now(),
      framed: false,
      whatWritten: false,
      what: describeLectureAction(action),
      settled: Promise.resolve(),
      ctrl: new AbortController(),
      planners,
      sketches,
      onSketch: opts.onSketch,
    };
    this.pending.add(sk);
    // asked for now, before the frames are written: the hand's few seconds on them are not added to the wait
    sk.settled = Promise.all(
      action.panels.map((p, i) => {
        const f = frames[i];
        const req: SketchPanelRequest = {
          prompt: p.prompt,
          ...(action.cast ? { cast: action.cast } : {}),
          ...(comic ? { panel: { index: i, of: n } } : {}),
          aspect: Math.min(2.5, Math.max(0.4, f.h > 0 ? f.w / f.h : 1)),
        };
        return this.askPanel(sk, i, request, req);
      }),
    ).then(() => undefined);
    const plan = withParts(placed.layout.plan);
    const at = { x: slot.x + plan.bounds.x, y: slot.y + plan.bounds.y };
    if (plan.lines.some((l) => l.strokes.length > 0)) {
      if (!(await this.writeVisual(placeHandPlan(plan, at), "sketch", sk.id, { [LECTURE_WHAT_META]: sk.what }))) return this.callOff(sk);
      sk.whatWritten = true;
    } else if (!this.onScreen()) return this.callOff(sk);
    sk.framed = true;
    this.progress(sk, false);
    this.host.metric?.("live.lecture.sketch", { panels: n, box: placed.index, screens: report.screensAdded });
    // a panel that came in while the frames were being written is written in the next turn
    this.queueFlush(sk);
    return { type, ok: true, id: sk.id };
  }

  /** The student moved away before the frames went on: nothing of the sketch is drawn, its panels are called off. */
  private callOff(sk: PendingSketch): LectureActionOutcome {
    sk.ctrl.abort();
    this.pending.delete(sk);
    return this.movedAway("sketch");
  }

  /** One panel asked for; when it settles, the sketch is written as far as it can be, in the chat desk's turn. */
  private askPanel(sk: PendingSketch, i: number, request: RequestSketch, req: SketchPanelRequest): Promise<void> {
    return Promise.resolve()
      .then(() => request(req, sk.ctrl.signal))
      .then(
        (drawing) => {
          if (sk.panels[i].state === "waiting") sk.panels[i] = { state: "ready", drawing };
        },
        (e: unknown) => {
          if (sk.panels[i].state !== "waiting") return;
          const dropped = isAbort(e) || sk.ctrl.signal.aborted;
          sk.panels[i] = { state: dropped ? "dropped" : "failed" };
          if (!dropped) this.host.metric?.("live.lecture.sketch.failed", { panel: i, error: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
        },
      )
      .then(() => this.queueFlush(sk));
  }

  /** The sketch written as far as it can be, in the chat desk's turn (after the block being written, before the next). */
  private queueFlush(sk: PendingSketch): void {
    if (!this.pending.has(sk)) return;
    this.chat.exclusive(() => this.flush(sk)).catch((e: unknown) => this.host.metric?.("live.lecture.sketch.flush", { error: e instanceof Error ? e.message : String(e) }));
  }

  /** Every sketch on the current screen written as far as it can be; one left too long on another screen given up. */
  private flushAll(): void {
    const page = this.host.pageId();
    for (const sk of [...this.pending]) {
      if (sk.page === page) {
        if (sk.framed && sk.next < sk.panels.length && sk.panels[sk.next].state !== "waiting") this.queueFlush(sk);
      } else if (this.now() - sk.startedAt > LECTURE_LAYOUT.sketch.keepMs) this.giveUp(sk);
    }
  }

  /**
   * Writes the sketch's panels in reading order, from the first not written, for as long as each is
   * in: a drawing into its frame, a note for one that failed, nothing for one called off. Stops at a
   * panel still coming (its arrival calls this again), and when the student is not on the sketch's
   * screen (a drawing is never written on another; it is tried again when they are back). Runs in
   * the chat desk's turn, or inside one (`settleSketches`): it never takes the turn itself.
   */
  private async flush(sk: PendingSketch): Promise<void> {
    if (!this.pending.has(sk) || !sk.framed) return;
    while (sk.next < sk.panels.length) {
      const i = sk.next;
      const p = sk.panels[i];
      if (p.state === "waiting") return;
      if (this.host.pageId() !== sk.page) {
        if (this.now() - sk.startedAt > LECTURE_LAYOUT.sketch.keepMs) this.giveUp(sk);
        return;
      }
      if (p.state === "ready") {
        const done = await this.fillPanel(sk, i, p.drawing);
        if (done === "away") return;
        if (done === "drawn") sk.drawn++;
        else sk.failed++;
      } else if (p.state === "failed") {
        if ((await this.panelNote(sk, i)) === "away") return;
        sk.failed++;
      }
      sk.next++;
      if (sk.next < sk.panels.length) this.progress(sk, false);
    }
    this.close(sk);
  }

  /** A drawing into its frame (fitted and centred by the planner), or the frame's note when it cannot be drawn there. */
  private async fillPanel(sk: PendingSketch, i: number, drawing: SketchDrawing): Promise<"drawn" | "failed" | "away"> {
    const frame = sk.frames[i];
    let plan: HandPlan | null = null;
    try {
      plan = sk.sketches.sketch(drawing, { seed: sk.seed + i + 1, box: { w: frame.w, h: frame.h } });
    } catch (e) {
      this.host.metric?.("live.lecture.plan.failed", { type: "sketch", error: e instanceof Error ? e.message : String(e) });
    }
    if (!plan || !plan.lines.some((l) => l.strokes.length > 0)) return (await this.panelNote(sk, i)) === "away" ? "away" : "failed";
    if (crowded(this.host.shapes(), plan) || this.boardFull(plan)) {
      // no note either: it would only add to what is already too much
      this.host.metric?.("live.lecture.sketch.skipped", { panel: i });
      return "failed";
    }
    // each stroke named by its panel, so one panel's ink is told from its neighbour's
    const named = withParts(plan);
    const lines = named.lines.map((l) => ({ ...l, part: `panel${i}:${l.part ?? ""}` }));
    const at = { x: frame.x + plan.bounds.x, y: frame.y + plan.bounds.y };
    return (await this.writePanel(sk, placeHandPlan({ ...named, lines }, at))) ? "drawn" : "away";
  }

  /** "Couldn't draw this one", small, in the middle of the panel's frame. */
  private async panelNote(sk: PendingSketch, i: number): Promise<"written" | "away"> {
    const frame = sk.frames[i];
    const S = LECTURE_LAYOUT.sketch;
    const text = LECTURE_NOTES.panelFailed;
    let plan: HandPlan | null = null;
    try {
      plan = sk.planners.note(text, { seed: this.host.seed(`lecture:note:${text}`), maxW: sk.planners.boxes.note.maxW });
    } catch {
      plan = null;
    }
    if (!plan || plan.bounds.w <= 0) return "written";
    const small = scalePlan(plan, Math.min(S.failScale, (frame.w * S.failWidth) / plan.bounds.w));
    const at = { x: frame.x + (frame.w - small.bounds.w) / 2, y: frame.y + Math.max(0, (frame.h - small.bounds.h) / 2) };
    return (await this.writePanel(sk, placeHandPlan(small, at))) ? "written" : "away";
  }

  /** A panel's ink (or its note) on the sketch's own screen, with the sketch's id; false when the student is elsewhere. */
  private async writePanel(sk: PendingSketch, plan: HandPlan): Promise<boolean> {
    await this.waitForHand();
    if (this.host.pageId() !== sk.page) return false;
    const meta: JsonObject = { [LECTURE_BLOCK_META]: "sketch", [LECTURE_ID_META]: sk.id };
    // with no frames to carry it (a picture with no caption), the first panel carries the sketch's summary
    const lead: JsonObject | undefined = sk.whatWritten ? undefined : { [LECTURE_WHAT_META]: sk.what };
    await this.host.write(this.paced(roundPlan(weighPlan(plan, LECTURE_LAYOUT.lineWeight))), meta, lead);
    sk.whatWritten = true;
    return true;
  }

  /**
   * Before the tutor leaves this screen: the panels still coming on it, waited for (up to
   * `sketch.waitMs` after they were asked for) and written. Called inside the chat desk's turn,
   * which the arrivals' own writes wait for, so it writes them itself; a panel still not in by then
   * gets its note, and its request is called off.
   */
  private async settleSketches(): Promise<void> {
    const page = this.host.pageId();
    const S = LECTURE_LAYOUT.sketch;
    for (const sk of [...this.pending]) {
      if (sk.page !== page || !sk.framed) continue;
      let settled = false;
      void sk.settled.then(() => (settled = true));
      await Promise.resolve();
      const left = Math.max(0, sk.startedAt + S.waitMs - this.now());
      for (let waited = 0; !settled && waited < left; waited += S.waitStepMs) await this.host.delay(S.waitStepMs);
      if (!settled) {
        this.host.metric?.("live.lecture.sketch.late", { panels: sk.panels.filter((p) => p.state === "waiting").length });
        sk.panels = sk.panels.map((p) => (p.state === "waiting" ? { state: "failed" } : p));
        sk.ctrl.abort();
      }
      await this.flush(sk);
      // the student had moved away meanwhile: nothing of it is written on another screen
      if (this.pending.has(sk) && this.host.pageId() !== sk.page) this.giveUp(sk);
    }
  }

  /** A sketch still coming on the current screen. */
  private pendingHere(): boolean {
    const page = this.host.pageId();
    for (const sk of this.pending) if (sk.page === page) return true;
    return false;
  }

  /** The rest of a sketch not drawn: its requests called off, its progress done. */
  private giveUp(sk: PendingSketch): void {
    if (!this.pending.has(sk)) return;
    this.host.metric?.("live.lecture.sketch.gaveUp", { written: sk.next, panels: sk.panels.length });
    sk.ctrl.abort();
    this.close(sk);
  }

  private close(sk: PendingSketch): void {
    if (this.pending.delete(sk)) this.progress(sk, true);
  }

  private progress(sk: PendingSketch, done: boolean): void {
    try {
      sk.onSketch?.({ id: sk.id, panels: sk.panels.length, drawn: sk.drawn, failed: sk.failed, done });
    } catch {
      /* the listener's problem, not the drawing's */
    }
  }

  /** The frames laid out in a box; null when they cannot be (or the planner fails). */
  private panelsIn(sketches: SketchPlanners, layout: Parameters<SketchPlanners["panels"]>[0], opts: SketchPlanOptions): PanelsLayout | null {
    try {
      const out = sketches.panels(layout, opts);
      return out && out.frames.length === layout.count ? out : null;
    } catch (e) {
      this.host.metric?.("live.lecture.plan.failed", { type: "panels", error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  /**
   * Where the sketch goes, largest box first: a comic in a band across the screen under the heading;
   * a picture to the right of the notes column when there is room there, else anywhere. Its whole
   * box is kept for it (the drawings fill it later).
   */
  private sketchPlace(plans: readonly (PanelsLayout | null)[], comic: boolean, planners: LecturePlanners): { layout: PanelsLayout; slot: { x: number; y: number }; box: { w: number; h: number }; index: number } | null {
    const screen = this.host.screen();
    const shapes = this.host.shapes();
    const obstacles = this.obstacles(shapes);
    const top = underHeading(topHeading([...this.blocks(shapes).values()]), screen);
    const boxes = comic ? LECTURE_LAYOUT.sketch.comic : LECTURE_LAYOUT.sketch.picture;
    const left = planners.boxes.note.maxW + LECTURE_LAYOUT.gutter;
    const right: Rect = { x: screen.x + left, y: screen.y, w: Math.max(0, screen.w - left), h: screen.h };
    for (let i = 0; i < plans.length; i++) {
      const layout = plans[i];
      if (!layout || crowded(shapes, layout.plan)) continue;
      const b = layout.plan.bounds;
      const box = { w: Math.max(boxes[i].w, b.x + b.w), h: Math.max(boxes[i].h, b.y + b.h) };
      const slot = comic ? findFreeArea(box, from(screen, top), obstacles) : (findFreeArea(box, from(right, top), obstacles) ?? findFreeArea(box, from(screen, top), obstacles));
      if (slot) return { layout, slot, box, index: i };
    }
    return null;
  }

  // ---------------------------------------------------------------- screens

  /**
   * This screen is full: a new one, headed "<topic> (cont.)" in a smaller hand when this one had a
   * topic, and carrying that topic in its meta. False at the screen cap.
   */
  private async continueOnNewScreen(planners: LecturePlanners, report: Report): Promise<boolean> {
    const topic = cleanTopic(this.host.screenMeta().topic);
    if (!(await this.newScreen(report))) return false;
    if (!topic) return true;
    const text = `${topic} (cont.)`;
    const plan = planners.heading(text, { seed: this.host.seed(`lecture:heading:${text}`), maxW: LECTURE_LAYOUT.contMaxW / LECTURE_LAYOUT.contScale });
    this.host.setScreenMeta({ topic });
    if (!plan) return true;
    const screen = this.host.screen();
    await this.writeText(scalePlan(plan, LECTURE_LAYOUT.contScale), { x: screen.x + FREE_AREA.margin, y: screen.y + FREE_AREA.top }, "heading", describeLectureAction({ type: "heading", text }));
    return true;
  }

  /**
   * A blank screen after the last, once the loop has moved to it with us (as `ChatDesk.newScreen`).
   * The panels still coming on this screen are written first (`settleSketches`): always called in
   * the chat desk's turn.
   */
  private async newScreen(report: Report): Promise<boolean> {
    if (this.pendingHere()) await this.settleSketches();
    await this.waitForHand();
    if (!this.host.addScreen()) return false;
    this.expectedPage = this.host.pageId();
    report.screensAdded++;
    for (let waited = 0; !this.host.screenReady() && waited < CHAT_WRITE.screenWaitMaxMs; waited += CHAT_WRITE.screenWaitStepMs) {
      await this.host.delay(CHAT_WRITE.screenWaitStepMs);
    }
    return true;
  }

  // ---------------------------------------------------------------- helpers

  /** Writing this (and `extra` bytes more to come: a sketch's drawings) would take the board past `boardBudgetBytes`. */
  private boardFull(plan: HandPlan, extra = 0): boolean {
    const now = this.host.boardBytes?.();
    if (now === undefined) return false;
    const over = now + estimateBytes(plan) + extra > LECTURE_LAYOUT.boardBudgetBytes;
    if (over) this.host.metric?.("live.lecture.boardFull", { bytes: now });
    return over;
  }

  private onScreen(): boolean {
    return this.host.pageId() === this.expectedPage;
  }

  private movedAway(type: LectureActionType): LectureActionOutcome {
    this.stopped = true;
    return { type, ok: false, note: LECTURE_NOTES.movedAway };
  }

  /**
   * A heading or a note, its top-left at `at`, as ONE whole block. Its summary goes on its first
   * stroke only (`leadMeta`): a note is ~70 strokes, and the words need saying once. False
   * (nothing written) when the student has moved to another screen while the hand was busy: a
   * block placed for one screen is never written on another.
   */
  private async writeText(plan: HandPlan, at: { x: number; y: number }, kind: "heading" | "note", what: string): Promise<boolean> {
    await this.waitForHand();
    if (!this.onScreen()) return false;
    await this.host.write(this.paced(roundPlan(placeHandPlan(plan, at))), { [LECTURE_BLOCK_META]: kind }, { [LECTURE_WHAT_META]: what });
    return true;
  }

  /**
   * A placed chart or diagram (or the parts an update writes, or a sketch's frames), every stroke
   * carrying its id and its part; `lead` on the first stroke only (a sketch's summary).
   */
  private async writeVisual(plan: HandPlan, kind: VisualKind | "sketch", id: string, lead?: JsonObject): Promise<boolean> {
    await this.waitForHand();
    if (!this.onScreen()) return false;
    const meta: JsonObject = { [LECTURE_BLOCK_META]: kind, [LECTURE_ID_META]: id };
    await this.host.write(this.paced(roundPlan(weighPlan(plan, LECTURE_LAYOUT.lineWeight))), meta, lead);
    return true;
  }

  private async waitForHand(): Promise<void> {
    let waited = 0;
    while (this.host.handBusy() && waited < CHAT_WRITE.waitMaxMs) {
      await this.host.delay(CHAT_WRITE.waitStepMs);
      waited += CHAT_WRITE.waitStepMs;
    }
  }

  /** Inside the margins, under the board's bar, clear of everything on the screen. */
  private fits(r: Rect, screen: Rect, obstacles: readonly Rect[]): boolean {
    const { margin, top, clearance } = FREE_AREA;
    if (r.x < screen.x + margin || r.y < screen.y + top) return false;
    if (r.x + r.w > screen.x + screen.w - margin || r.y + r.h > screen.y + screen.h - margin) return false;
    const grown = { x: r.x - clearance, y: r.y - clearance, w: r.w + 2 * clearance, h: r.h + 2 * clearance };
    return !obstacles.some((o) => intersects(grown, o));
  }

  /**
   * What free space must stay clear of: everything on the screen, each chat problem's whole cell
   * (the student works there), and each live visual's whole box (its next update draws there).
   */
  /** The part of the screen the lecture bar floats over (`LECTURE_LAYOUT.barZone`). */
  private barZone(): Rect {
    const screen = this.host.screen();
    const { x0, x1, y0 } = LECTURE_LAYOUT.barZone;
    return { x: screen.x + screen.w * x0, y: screen.y + screen.h * y0, w: screen.w * (x1 - x0), h: screen.h * (1 - y0) };
  }

  private obstacles(shapes: readonly ChatShape[], bar = true): Rect[] {
    const out: Rect[] = bar ? [this.barZone()] : [];
    const cells = new Set<string>();
    for (const s of shapes) {
      if (s.bounds) out.push(s.bounds);
      const p = problemMetaOf(s.meta);
      const key = p ? `${p.cell.x},${p.cell.y}` : "";
      if (p && !cells.has(key)) {
        cells.add(key);
        out.push(p.cell);
      }
    }
    const present = this.visualIds(shapes);
    for (const [id, v] of Object.entries(this.host.screenMeta().visuals ?? {})) {
      if (present.has(id) && v?.at && v.box) out.push({ x: v.at.x, y: v.at.y, w: v.box.w, h: v.box.h });
    }
    // a sketch's whole box while its drawings are coming: its frames are empty, not free
    const page = this.host.pageId();
    for (const sk of this.pending) if (sk.page === page) out.push(sk.area);
    return out;
  }

  /** The tutor's lecture and chat blocks on the screen: a chart or diagram by its id (all its updates), the rest by hand block. */
  private blocks(shapes: readonly ChatShape[]): Map<string, Block> {
    const out = new Map<string, Block>();
    for (const s of shapes) {
      const meta = metaOf(s);
      if (!s.bounds || (!str(meta[LECTURE_BLOCK_META]) && !str(meta[CHAT_BLOCK_META]))) continue;
      const key = str(meta[LECTURE_ID_META]) || str(meta[HAND_BLOCK_META]) || s.id;
      const line = str(meta[HAND_LINE_META]);
      const what = str(meta[LECTURE_WHAT_META]);
      const b = out.get(key);
      if (!b) {
        out.set(key, { key, bounds: { ...s.bounds }, meta, what, topLine: line, topY: s.bounds.y, lines: line ? [{ latex: line, y: s.bounds.y }] : [] });
        continue;
      }
      b.bounds = union(b.bounds, s.bounds);
      if (!b.what && what) b.what = what;
      if (line) b.lines.push({ latex: line, y: s.bounds.y });
      if (s.bounds.y < b.topY) {
        b.topY = s.bounds.y;
        b.topLine = line;
      }
    }
    return out;
  }
}

/** A stored visual's spec, if it still passes the contract. */
function validSpec(v: Partial<LectureSpecMeta> | undefined): Spec | null {
  if (!v) return null;
  if (v.chart) {
    const r = ChartSpecSchema.safeParse(v.chart);
    return r.success ? { kind: "chart", chart: r.data } : null;
  }
  if (v.diagram) {
    const r = DiagramSpecSchema.safeParse(v.diagram);
    return r.success ? { kind: "diagram", diagram: r.data } : null;
  }
  return null;
}

/** The spec half of a `LectureSpecMeta` (one of `chart`, `diagram`). */
function specOf(spec: Spec): Pick<LectureSpecMeta, "chart" | "diagram"> {
  return spec.kind === "chart" ? { chart: spec.chart, diagram: undefined } : { diagram: spec.diagram, chart: undefined };
}

/** The screen's heading: the topmost lecture heading on it. */
function topHeading(blocks: readonly Block[]): Block | undefined {
  return blocks.filter((b) => b.meta[LECTURE_BLOCK_META] === "heading").sort((a, b) => a.bounds.y - b.bounds.y)[0];
}

/** Where what goes under the topic may start, from the screen's top (`findFreeArea`'s `top`): below its heading, else under the bar. */
function underHeading(heading: Block | undefined, screen: Rect): number {
  if (!heading) return FREE_AREA.top;
  return Math.max(FREE_AREA.top, heading.bounds.y + heading.bounds.h + LECTURE_LAYOUT.headingGap - screen.y);
}

/**
 * The part of `area` a free-area search should start `top` px down it (rather than `FREE_AREA.top`):
 * `findFreeArea` keeps its own top margin inside the rect it is given, so the rect moves down.
 */
function from(area: Rect, top: number): Rect {
  const dy = Math.max(0, top - FREE_AREA.top);
  return { x: area.x, y: area.y + dy, w: area.w, h: Math.max(0, area.h - dy) };
}

/**
 * What a plan adds to the saved board, roughly: each stroke is a tldraw draw shape (~550 bytes of
 * record and meta) and each point `{"x":…,"y":…,"z":…}` at 1/100 px ~38 bytes (measured on a
 * headless store with tldraw 4.2, `desk.weight.test.ts`).
 */
export function estimateBytes(plan: HandPlan): number {
  let strokes = 0;
  let points = 0;
  for (const l of plan.lines) {
    strokes += l.strokes.length;
    for (const st of l.strokes) points += st.points.length;
  }
  return strokes * 550 + points * 38;
}

/** The screen would hold too many strokes with this plan on it (`LECTURE_LAYOUT.maxShapesPerScreen`). */
function crowded(shapes: readonly ChatShape[], plan: HandPlan): boolean {
  let strokes = 0;
  for (const l of plan.lines) strokes += l.strokes.length;
  return shapes.length + strokes > LECTURE_LAYOUT.maxShapesPerScreen;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
