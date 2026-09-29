import type { JsonObject } from "tldraw";
import type { Stroke } from "@/lib/hand";
import type { LiveEngine, Rect } from "../../contracts";
import { ChatDesk, type ChatShape } from "../../chat/desk";
import { HAND_BLOCK_META, HAND_LINE_META, HAND_PART_META, type HandPlan } from "../../handwriting";
import type { LecturePageMeta } from "../contracts";
import { LectureDesk, type LectureHost, type LecturePlanners } from "../desk";
import { LECTURE_BOXES } from "../plan";

/**
 * The lecture desk's fake board, for its tests (`desk*.test.ts`) and the slide gallery: a 1600×900
 * screen (more are added as the desk asks), every write kept as the placed plan it was (`writes`)
 * and as one shape a stroke with the meta the loop's writer gives it, the screen's page meta, and
 * planners that draw each block as its box.
 */

export const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };

/** A plan whose ink is exactly a w × h rectangle outline from (0, 0): its bounds are what it covers. */
export function boxPlan(w: number, h: number, label: string): HandPlan {
  const seg = (a: [number, number], b: [number, number], order: number): Stroke => ({ points: [a, b].map(([x, y]) => ({ x, y, z: 0.5 })), order, kind: "rule" }) as Stroke;
  const strokes = [seg([0, 0], [w, 0], 0), seg([w, 0], [w, h], 1), seg([w, h], [0, h], 2), seg([0, h], [0, 0], 3)];
  return { lines: [{ latex: label, x: 0, y: 0, strokes, baseline: h, startMs: 0, durationMs: 100 }], bounds: { x: 0, y: 0, w, h }, size: 30, totalMs: 100 };
}

export interface FakePage {
  id: string;
  shapes: ChatShape[];
  meta: LecturePageMeta;
}

export interface Written {
  page: string;
  plan: HandPlan;
  meta: JsonObject;
  lead: JsonObject;
}

export class FakeBoard implements LectureHost {
  pages: FakePage[] = [{ id: "p1", shapes: [], meta: {} }];
  current = 0;
  hand = true;
  busy = false;
  maxScreens = 50;
  writes: Written[] = [];
  deleted: string[] = [];
  metaWrites = 0;
  private clock = 1;
  private blocks = 0;
  /** runs before each write (a test moves the student to another screen here) */
  beforeWrite: (() => void) | null = null;
  /** runs on each wait for the hand */
  onDelay: (() => void) | null = null;

  get page(): FakePage {
    return this.pages[this.current];
  }

  engine = async (): Promise<LiveEngine> => ({}) as LiveEngine;
  shapes = (): ChatShape[] => this.page.shapes;
  screen = (): Rect => ({ ...SCREEN });
  pageId = (): string => this.page.id;
  studentLines = (): string[] => [];
  handwriting = (): boolean => this.hand;
  handBusy = (): boolean => this.busy;
  /** as the loop's writer: `extraMeta` on every stroke, `leadMeta` on the first, a named line's part on its strokes */
  write = async (plan: HandPlan, extraMeta: JsonObject, leadMeta: JsonObject = {}): Promise<void> => {
    this.beforeWrite?.();
    const block = `hb_${++this.blocks}`;
    const createdAt = this.clock++;
    this.writes.push({ page: this.page.id, plan, meta: extraMeta, lead: leadMeta });
    let first = true;
    for (const line of plan.lines) {
      for (const st of line.strokes) {
        const xs = st.points.map((p) => line.x + p.x);
        const ys = st.points.map((p) => line.y + p.y);
        const bounds = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        this.page.shapes.push({
          id: `s${++this.strokeIds}_${block}`,
          type: "draw",
          meta: {
            live: true,
            source: "ai",
            lineId: "chat",
            createdAt,
            [HAND_BLOCK_META]: block,
            [HAND_LINE_META]: line.latex,
            ...(line.part ? { [HAND_PART_META]: line.part } : {}),
            ...extraMeta,
            ...(first ? leadMeta : {}),
          },
          bounds,
        });
        first = false;
      }
    }
  };
  private strokeIds = 0;
  deleteShapes = (ids: readonly string[]): void => {
    const gone = new Set(ids);
    this.deleted.push(...ids);
    for (const p of this.pages) p.shapes = p.shapes.filter((s) => !gone.has(s.id));
  };
  now = (): number => 1_000 * this.clock++;
  typeset = (): Rect => {
    throw new Error("not in lecture tests");
  };
  addScreen = (): boolean => {
    if (this.pages.length >= this.maxScreens) return false;
    this.pages.push({ id: `p${this.pages.length + 1}`, shapes: [], meta: {} });
    this.current = this.pages.length - 1;
    return true;
  };
  screenReady = (): boolean => true;
  clearTutor = (): void => undefined;
  problemsChanged = (): void => undefined;
  helpProblem = () => "missing" as const;
  planFigure = () => null;
  seed = (key: string): number => key.length;
  delay = async (): Promise<void> => {
    this.onDelay?.();
  };
  /** the saved board's size, when a test sets it */
  bytes: number | null = null;
  boardBytes = (): number => this.bytes ?? 0;
  pageOf(id?: string): FakePage {
    return (id && this.pages.find((p) => p.id === id)) || this.page;
  }
  screenMeta = (pageId?: string): LecturePageMeta => ({ ...this.pageOf(pageId).meta });
  setScreenMeta = (patch: Partial<LecturePageMeta>, pageId?: string): void => {
    this.metaWrites++;
    Object.assign(this.pageOf(pageId).meta, patch);
  };

  /** student ink (or anything) at a rect on the current screen */
  put(bounds: Rect, meta: Record<string, unknown> = {}): void {
    this.page.shapes.push({ id: `x${this.page.shapes.length}`, type: "draw", meta, bounds });
  }

  /** the written block's page rect */
  rectOf(w: Written): Rect {
    return w.plan.bounds;
  }
}

/** Planners that draw each block as its box: a heading 20 px a character, a note 12, a picture its whole box. */
export function fakePlanners(overrides: Partial<LecturePlanners> = {}): LecturePlanners {
  return {
    boxes: LECTURE_BOXES,
    heading: (text, { maxW }) => boxPlan(Math.min(text.length * 20, maxW), 44, text),
    note: (text, { maxW }) => boxPlan(Math.min(text.length * 12, maxW), 36, text),
    chart: (_spec, { box }) => boxPlan(box.w, box.h, "chart"),
    diagram: (_spec, { box }) => boxPlan(box.w, box.h, "diagram"),
    ...overrides,
  };
}

export function setup(planners: Partial<LecturePlanners> = {}) {
  const board = new FakeBoard();
  const chat = new ChatDesk(board);
  const desk = new LectureDesk(board, chat, fakePlanners(planners));
  return { board, chat, desk };
}
