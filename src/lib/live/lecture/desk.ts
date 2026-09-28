import type { JsonObject } from "tldraw";
import type { Rect } from "../contracts";
import { problemMetaOf } from "../chat/cells";
import type { ChatAction } from "../chat/contracts";
import { CHAT_BLOCK_META, CHAT_WRITE, tailAtWord, type ChatDesk, type ChatHost, type ChatShape } from "../chat/desk";
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
} from "./contracts";
import type { LECTURE_BOXES, LecturePlanOptions } from "./plan";

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
 * The loop is the host (`LiveLoop.lectureHost`): the chat's host plus the screen's page meta and a
 * way to rub strokes out. The planners (`./plan`) are loaded on the first run, not with the board:
 * nobody who never turns lecture mode on downloads them.
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
}

export type LoadLecturePlanners = () => Promise<LecturePlanners>;

const loadPlanners: LoadLecturePlanners = () =>
  import("./plan").then((m) => ({ boxes: m.LECTURE_BOXES, chart: m.planChart, diagram: m.planDiagram, heading: m.planHeading, note: m.planNote }));

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
  /** between two parts of an update, written one after the other */
  partGapMs: 150,
  /**
   * An update that rewrites most of a sketch (a new scale, a relaid-out diagram) is a redraw of
   * what the student has just seen: written this much faster than the sketch was first drawn.
   */
  redrawShare: 0.6,
  redrawPace: 1.6,
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
} as const;

type Report = LectureRunReport;
type OwnAction = Extract<LectureAction, { type: "heading" | "note" | "chart" | "diagram" | "update_chart" | "update_diagram" }>;
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
  private expectedPage = "";
  private running = 0;
  private ids = 0;
  /** the run was cut short (the student moved to another screen): the rest is not drawn */
  private stopped = false;

  constructor(host: LectureHost, chat: ChatDesk, planners: LecturePlanners | LoadLecturePlanners = loadPlanners) {
    this.host = host;
    this.chat = chat;
    this.load = typeof planners === "function" ? planners : async () => planners;
  }

  /** Actions are being written. */
  get busy(): boolean {
    return this.running > 0;
  }

  // ---------------------------------------------------------------- the screen, for the director

  /** What is on this screen, in words: its topic, what is drawn on it, how much room is left, what can be updated. */
  screen(): LectureScreen {
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
        const spec = validSpec(meta.visuals?.[id]);
        what = spec?.chart ? describeLectureAction({ type: "chart", chart: spec.chart }) : spec?.diagram ? describeLectureAction({ type: "diagram", diagram: spec.diagram }) : lecture;
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
    // each obstacle marks the cells it touches: a lecture screen holds thousands of strokes
    const covered = new Uint8Array(cols * rows);
    for (const o of this.obstacles(shapes)) {
      const c0 = Math.max(0, Math.floor((o.x - x0) / cell));
      const c1 = Math.min(cols - 1, Math.ceil((o.x + o.w - x0) / cell) - 1);
      const r0 = Math.max(0, Math.floor((o.y - y0) / cell));
      const r1 = Math.min(rows - 1, Math.ceil((o.y + o.h - y0) / cell) - 1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) covered[r * cols + c] = 1;
    }
    let free = 0;
    for (const v of covered) if (!v) free++;
    return Math.round((free / covered.length) * 100) / 100;
  }

  // ---------------------------------------------------------------- the transcript

  /**
   * Appends what was heard to this screen's saved transcript, keeping the last
   * `screenTranscriptChars` (older text is dropped from the front, at a word).
   */
  saveTranscript(text: string): void {
    const heard = text.replace(/\s+/g, " ").trim();
    if (!heard) return;
    const cur = (this.host.screenMeta().transcript ?? "").trim();
    this.host.setScreenMeta({ transcript: tailAtWord(cur ? `${cur} ${heard}` : heard, LECTURE_LIMITS.screenTranscriptChars) });
  }

  // ---------------------------------------------------------------- running the director's actions

  /** Runs the actions in order, one block at a time; a second call waits for the first. */
  run(actions: readonly LectureAction[]): Promise<Report> {
    const next = this.tail.then(() => this.runNow(actions));
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async runNow(actions: readonly LectureAction[]): Promise<Report> {
    this.running++;
    this.stopped = false;
    const report: Report = { outcomes: [], screensAdded: 0 };
    try {
      this.expectedPage = this.host.pageId();
      for (const action of actions) {
        if (!this.onScreen()) {
          report.outcomes.push({ type: action.type, ok: false, note: LECTURE_NOTES.movedAway });
          break;
        }
        let out: LectureActionOutcome;
        try {
          out = await this.runOne(action, report);
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

  private runOne(action: LectureAction, report: Report): Promise<LectureActionOutcome> {
    switch (action.type) {
      case "heading":
      case "note":
      case "chart":
      case "diagram":
      case "update_chart":
      case "update_diagram":
        return this.own(action, report);
      case "graph":
      case "draw_figure":
      case "write_lines":
      case "new_screen":
        return this.delegate(action, report);
    }
  }

  /** The chat's own actions, through its desk: its outcome, its screens. */
  private async delegate(action: Extract<LectureAction, { type: ChatAction["type"] }>, report: Report): Promise<LectureActionOutcome> {
    const topic = cleanTopic(this.host.screenMeta().topic);
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
  private async own(action: OwnAction, report: Report): Promise<LectureActionOutcome> {
    if (!this.host.handwriting()) return { type: action.type, ok: false, note: LECTURE_NOTES.handOff };
    const planners = await this.plannersOnce();
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

  /** A spec planned in a box; null when the planner cannot draw it there (or fails). */
  private planIn(spec: Spec, planners: LecturePlanners, opts: LecturePlanOptions): HandPlan | null {
    try {
      if (spec.kind === "chart" && spec.chart) return planners.chart(spec.chart, opts);
      if (spec.kind === "diagram" && spec.diagram) return planners.diagram(spec.diagram, opts);
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

  /** A blank screen after the last, once the loop has moved to it with us (as `ChatDesk.newScreen`). */
  private async newScreen(report: Report): Promise<boolean> {
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

  /** Writing this would take the board past `boardBudgetBytes`. */
  private boardFull(plan: HandPlan): boolean {
    const now = this.host.boardBytes?.();
    if (now === undefined) return false;
    const over = now + estimateBytes(plan) > LECTURE_LAYOUT.boardBudgetBytes;
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
    await this.host.write(roundPlan(placeHandPlan(plan, at)), { [LECTURE_BLOCK_META]: kind }, { [LECTURE_WHAT_META]: what });
    return true;
  }

  /** A placed chart or diagram (or the parts an update writes), every stroke carrying its id and its part. */
  private async writeVisual(plan: HandPlan, kind: VisualKind, id: string): Promise<boolean> {
    await this.waitForHand();
    if (!this.onScreen()) return false;
    const meta: JsonObject = { [LECTURE_BLOCK_META]: kind, [LECTURE_ID_META]: id };
    await this.host.write(roundPlan(plan), meta);
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
  private obstacles(shapes: readonly ChatShape[]): Rect[] {
    const out: Rect[] = [];
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
