import { describe, expect, it } from "vitest";
import type { JsonObject } from "tldraw";
import type { Stroke } from "@/lib/hand";
import type { LiveEngine, Rect } from "../../contracts";
import type { ChatAction, ChatRunReport } from "../../chat/contracts";
import { CHAT_BLOCK_META, ChatDesk, tailAtWord, type ChatShape } from "../../chat/desk";
import { FREE_AREA } from "../../chat/layout";
import { HAND_BLOCK_META, HAND_LINE_META, HAND_PART_META, type HandPlan } from "../../handwriting";
import { LECTURE_BLOCK_META, LECTURE_ID_META, LECTURE_LIMITS, LECTURE_WHAT_META, type LectureAction, type LecturePageMeta, type LectureRunReport } from "../contracts";
import { estimateBytes, LECTURE_LAYOUT, LECTURE_NOTES, LectureDesk, roundPlan, scalePlan, type LectureHost, type LecturePlanners } from "../desk";
import { LECTURE_BOXES } from "../plan";

/**
 * The lecture desk against a fake board: where each block goes on a 1600×900 screen (the topic top
 * left, the notes down the left under it, the pictures to the right), a new screen when this one is
 * full — carrying the topic as "<topic> (cont.)" — or when a new topic starts on a screen with
 * anything on it; the chat's own actions through the chat desk; the screen in words for the director.
 */

const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };

/** A plan whose ink is exactly a w × h rectangle outline from (0, 0): its bounds are what it covers. */
function boxPlan(w: number, h: number, label: string): HandPlan {
  const seg = (a: [number, number], b: [number, number], order: number): Stroke => ({ points: [a, b].map(([x, y]) => ({ x, y, z: 0.5 })), order, kind: "rule" }) as Stroke;
  const strokes = [seg([0, 0], [w, 0], 0), seg([w, 0], [w, h], 1), seg([w, h], [0, h], 2), seg([0, h], [0, 0], 3)];
  return { lines: [{ latex: label, x: 0, y: 0, strokes, baseline: h, startMs: 0, durationMs: 100 }], bounds: { x: 0, y: 0, w, h }, size: 30, totalMs: 100 };
}

interface FakePage {
  id: string;
  shapes: ChatShape[];
  meta: LecturePageMeta;
}

interface Written {
  page: string;
  plan: HandPlan;
  meta: JsonObject;
  lead: JsonObject;
}

class FakeBoard implements LectureHost {
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
function fakePlanners(overrides: Partial<LecturePlanners> = {}): LecturePlanners {
  return {
    boxes: LECTURE_BOXES,
    heading: (text, { maxW }) => boxPlan(Math.min(text.length * 20, maxW), 44, text),
    note: (text, { maxW }) => boxPlan(Math.min(text.length * 12, maxW), 36, text),
    chart: (_spec, { box }) => boxPlan(box.w, box.h, "chart"),
    diagram: (_spec, { box }) => boxPlan(box.w, box.h, "diagram"),
    ...overrides,
  };
}

function setup(planners: Partial<LecturePlanners> = {}) {
  const board = new FakeBoard();
  const chat = new ChatDesk(board);
  const desk = new LectureDesk(board, chat, fakePlanners(planners));
  return { board, chat, desk };
}

const BAR: LectureAction = { type: "chart", chart: { kind: "bar", title: "GDP growth", labels: ["2021", "2022", "2023"], series: [{ values: [7.6, 4.1, 0.1] }], unit: "%" } };
const CYCLE: LectureAction = { type: "diagram", diagram: { kind: "cycle", title: "The water cycle", steps: ["Evaporation", "Condensation", "Precipitation", "Collection"] } };

describe("the lecture desk — placing blocks", () => {
  it("a heading on an empty screen: at the top left, under the board's bar, and the screen takes its topic", async () => {
    const { board, desk } = setup();
    const report = await desk.run([{ type: "heading", text: "Photosynthesis" }]);
    expect(report).toEqual({ outcomes: [{ type: "heading", ok: true, what: "heading: Photosynthesis" }], screensAdded: 0 });
    expect(board.writes).toHaveLength(1);
    const [w] = board.writes;
    expect(w.plan.bounds).toMatchObject({ x: FREE_AREA.margin, y: FREE_AREA.top });
    // the summary once, on the first stroke; the kind on every stroke
    expect(w.meta).toEqual({ [LECTURE_BLOCK_META]: "heading" });
    expect(w.lead).toEqual({ [LECTURE_WHAT_META]: "heading: Photosynthesis" });
    expect(board.page.shapes.filter((s) => (s.meta as Record<string, unknown>)[LECTURE_WHAT_META])).toHaveLength(1);
    expect(board.page.meta.topic).toBe("Photosynthesis");
  });

  it("a heading on a screen with anything on it: a new screen first (a new topic starts clean)", async () => {
    const { board, desk } = setup();
    board.put({ x: 300, y: 400, w: 200, h: 60 });
    board.page.meta.topic = "Respiration";
    const report = await desk.run([{ type: "heading", text: "Photosynthesis" }]);
    expect(report.screensAdded).toBe(1);
    expect(report.outcomes).toEqual([{ type: "heading", ok: true, what: "heading: Photosynthesis" }]);
    expect(board.writes.map((w) => w.page)).toEqual(["p2"]);
    expect(board.pages[0].meta.topic).toBe("Respiration");
    expect(board.pages[1].meta.topic).toBe("Photosynthesis");
  });

  it("notes go down the left: the first under the heading, each next one under the one before", async () => {
    const { board, desk } = setup();
    await desk.run([
      { type: "heading", text: "Cells" },
      { type: "note", text: "Mitochondria make ATP" },
      { type: "note", text: "The nucleus holds the DNA" },
    ]);
    const [h, n1, n2] = board.writes.map((w) => w.plan.bounds);
    expect(n1.x).toBe(h.x);
    expect(n1.y).toBe(h.y + h.h + LECTURE_LAYOUT.headingGap);
    expect(n2.x).toBe(n1.x);
    expect(n2.y).toBe(n1.y + n1.h + LECTURE_LAYOUT.noteGap);
  });

  it("the next note follows the last one written, not the lowest on the screen", async () => {
    const { board, desk } = setup();
    await desk.run([
      { type: "heading", text: "Cells" },
      { type: "note", text: "one" },
    ]);
    // something of the student's lower down the column does not pull the next note after it
    board.put({ x: 700, y: 700, w: 100, h: 40 });
    await desk.run([{ type: "note", text: "two" }]);
    const [, n1, n2] = board.writes.map((w) => w.plan.bounds);
    expect(n2.y).toBe(n1.y + n1.h + LECTURE_LAYOUT.noteGap);
  });

  it("a note whose place under the last is taken goes to the first free place in the notes column", async () => {
    const { board, desk } = setup();
    await desk.run([
      { type: "heading", text: "Cells" },
      { type: "note", text: "one" },
    ]);
    const n1 = board.writes[1].plan.bounds;
    // the student wrote right under the note, across the column
    board.put({ x: 40, y: n1.y + n1.h + 10, w: 700, h: 120 });
    await desk.run([{ type: "note", text: "two" }]);
    const n2 = board.writes[2].plan.bounds;
    expect(n2.y).toBeGreaterThan(n1.y + n1.h + 10 + 120);
    expect(n2.x).toBeLessThan(2 * FREE_AREA.margin + LECTURE_BOXES.note.maxW);
  });

  it("a chart goes to the right of the notes column, as large as it fits", async () => {
    const { board, desk } = setup();
    const report = await desk.run([{ type: "heading", text: "The economy" }, { type: "note", text: "Growth slowed after 2021" }, BAR]);
    expect(report.outcomes.map((o) => [o.type, o.ok, o.what])).toEqual([
      ["heading", true, "heading: The economy"],
      ["note", true, "note: Growth slowed after 2021"],
      ["chart", true, "bar chart: GDP growth"],
    ]);
    const chart = board.writes[2];
    expect(chart.plan.bounds.w).toBe(LECTURE_BOXES.visual[0].w);
    expect(chart.plan.bounds.x).toBeGreaterThanOrEqual(LECTURE_BOXES.note.maxW + LECTURE_LAYOUT.gutter + FREE_AREA.margin);
    expect(chart.meta).toEqual({ [LECTURE_BLOCK_META]: "chart", [LECTURE_ID_META]: expect.stringMatching(/^lv_[0-9a-z]+$/) });
    expect(report.outcomes[2].id).toBe(chart.meta[LECTURE_ID_META]);
  });

  it("a smaller box when the largest does not fit here; a planner that cannot draw one box is asked for the next", async () => {
    const tried: number[] = [];
    const { board, desk } = setup({
      diagram: (_spec, { box }) => {
        tried.push(box.w);
        return box.w === LECTURE_BOXES.visual[0].w ? null : boxPlan(box.w, box.h, "diagram");
      },
    });
    const report = await desk.run([CYCLE]);
    expect(report.outcomes[0]).toMatchObject({ ok: true, what: "cycle: The water cycle" });
    expect(board.writes[0].plan.bounds.w).toBe(LECTURE_BOXES.visual[1].w);
    expect(tried).toEqual(LECTURE_BOXES.visual.map((b) => b.w));
  });

  it("a picture that fits nowhere here: a new screen headed '<topic> (cont.)', smaller, and carrying the topic", async () => {
    const { board, desk } = setup();
    await desk.run([{ type: "heading", text: "Photosynthesis" }]);
    // the rest of the screen is full
    board.put({ x: 0, y: 150, w: 1600, h: 750 });
    const report = await desk.run([CYCLE]);
    expect(report.screensAdded).toBe(1);
    expect(report.outcomes).toEqual([{ type: "diagram", ok: true, what: "cycle: The water cycle", id: expect.stringMatching(/^lv_/) }]);
    const [, cont, cycle] = board.writes;
    expect(cont.page).toBe("p2");
    expect(cont.meta).toEqual({ [LECTURE_BLOCK_META]: "heading" });
    expect(cont.lead).toEqual({ [LECTURE_WHAT_META]: "heading: Photosynthesis (cont.)" });
    expect(cont.plan.bounds).toMatchObject({ x: FREE_AREA.margin, y: FREE_AREA.top });
    expect(cont.plan.bounds.h).toBeCloseTo(44 * LECTURE_LAYOUT.contScale, 5);
    expect(cycle.page).toBe("p2");
    expect(cycle.plan.bounds.y).toBeGreaterThan(cont.plan.bounds.y + cont.plan.bounds.h);
    expect(board.pages[1].meta.topic).toBe("Photosynthesis");
  });

  it("a note that fits nowhere here goes on a new screen too; with no topic, the new screen has no heading", async () => {
    const { board, desk } = setup();
    board.put({ x: 0, y: 0, w: 1600, h: 900 });
    const report = await desk.run([{ type: "note", text: "Enzymes speed reactions up" }]);
    expect(report).toMatchObject({ screensAdded: 1, outcomes: [{ type: "note", ok: true }] });
    expect(board.writes.map((w) => [w.page, w.meta[LECTURE_BLOCK_META]])).toEqual([["p2", "note"]]);
    expect(board.writes[0].plan.bounds).toMatchObject({ x: FREE_AREA.margin, y: FREE_AREA.top });
  });

  it("a screen close to tldraw's shape limit takes no more: the next block goes on a new screen", async () => {
    const { board, desk } = setup();
    for (let i = 0; i < LECTURE_LAYOUT.maxShapesPerScreen - 2; i++) board.put({ x: 1500, y: 800, w: 1, h: 1 });
    const report = await desk.run([{ type: "note", text: "one more" }]);
    expect(report.screensAdded).toBe(1);
    expect(board.writes[0].page).toBe("p2");
  });

  it("a board close to the autosave's limit: the lecture stops sketching (and says why) before the board stops saving", async () => {
    const { board, desk } = setup();
    board.bytes = LECTURE_LAYOUT.boardBudgetBytes - 1000;
    const report = await desk.run([{ type: "heading", text: "Cells" }, BAR, { type: "graph", relations: ["y = x"] } as LectureAction]);
    expect(report.outcomes.slice(0, 2)).toEqual([
      { type: "heading", ok: false, note: LECTURE_NOTES.boardFull },
      { type: "chart", ok: false, note: LECTURE_NOTES.boardFull },
    ]);
    expect(board.writes).toEqual([]);
    expect(board.pages).toHaveLength(1);
    // well under it, the same run is written
    board.bytes = 1_000_000;
    expect((await desk.run([{ type: "heading", text: "Cells" }, BAR])).outcomes.map((o) => o.ok)).toEqual([true, true]);
  });

  it("the screen cap: nothing written, a note says why", async () => {
    const { board, desk } = setup();
    board.maxScreens = 1;
    board.put({ x: 0, y: 0, w: 1600, h: 900 });
    const report = await desk.run([BAR, { type: "heading", text: "Next" }]);
    expect(report.outcomes).toEqual([
      { type: "chart", ok: false, note: LECTURE_NOTES.noRoom },
      { type: "heading", ok: false, note: LECTURE_NOTES.noScreens },
    ]);
    expect(board.writes).toEqual([]);
  });

  it("a picture no box can hold, or a heading the hand cannot write: left out with a note, nothing written", async () => {
    const { board, desk } = setup({ chart: () => null, heading: () => null });
    const report = await desk.run([BAR, { type: "heading", text: "Topic" }, { type: "note", text: "still written" }]);
    expect(report.outcomes).toEqual([
      { type: "chart", ok: false, note: LECTURE_NOTES.cannotSketch },
      { type: "heading", ok: false, note: LECTURE_NOTES.cannotWrite },
      { type: "note", ok: true, what: "note: still written" },
    ]);
    expect(board.writes).toHaveLength(1);
  });

  it("a planner that throws costs that block only", async () => {
    const { board, desk } = setup({
      diagram: () => {
        throw new Error("boom");
      },
      note: () => {
        throw new Error("boom");
      },
    });
    const report = await desk.run([CYCLE, { type: "note", text: "x" }, { type: "heading", text: "Still" }]);
    expect(report.outcomes).toEqual([
      { type: "diagram", ok: false, note: LECTURE_NOTES.cannotSketch },
      { type: "note", ok: false, note: LECTURE_NOTES.failed },
      { type: "heading", ok: true, what: "heading: Still" },
    ]);
    expect(board.writes).toHaveLength(1);
  });

  it("every block is written at 1/100 px (the saved board is ~35 % lighter)", async () => {
    const { board, desk } = setup({ note: () => boxPlan(123.456789, 36.123456, "n") });
    await desk.run([{ type: "note", text: "x" }]);
    for (const p of board.writes[0].plan.lines[0].strokes.flatMap((s) => s.points)) {
      expect(Math.round(p.x * 100) / 100).toBe(p.x);
      expect(Math.round(p.y * 100) / 100).toBe(p.y);
    }
  });
});

describe("the lecture desk — the hand, the screens, the order", () => {
  it("the tutor's handwriting off: the lecture's own blocks are not written, and the note says how to see them", async () => {
    const { board, desk } = setup();
    board.hand = false;
    const report = await desk.run([{ type: "heading", text: "Cells" }, BAR]);
    expect(report.outcomes).toEqual([
      { type: "heading", ok: false, note: LECTURE_NOTES.handOff },
      { type: "chart", ok: false, note: LECTURE_NOTES.handOff },
    ]);
    expect(board.writes).toEqual([]);
  });

  it("the student moves to another screen while the hand is busy: that block and the rest are not written", async () => {
    const { board, desk } = setup();
    board.pages.push({ id: "p2", shapes: [], meta: {} });
    board.busy = true;
    board.onDelay = () => {
      board.current = 1;
      board.busy = false;
    };
    const report = await desk.run([{ type: "note", text: "one" }, { type: "note", text: "two" }]);
    expect(report.outcomes).toEqual([{ type: "note", ok: false, note: LECTURE_NOTES.movedAway }]);
    expect(board.writes).toEqual([]);
  });

  it("the student moves between two blocks: the next is not started", async () => {
    const { board, desk } = setup();
    board.pages.push({ id: "p2", shapes: [], meta: {} });
    let n = 0;
    board.beforeWrite = () => {
      if (++n === 1) queueMicrotask(() => (board.current = 1));
    };
    const report = await desk.run([{ type: "heading", text: "Cells" }, { type: "note", text: "two" }]);
    expect(report.outcomes).toEqual([
      { type: "heading", ok: true, what: "heading: Cells" },
      { type: "note", ok: false, note: LECTURE_NOTES.movedAway },
    ]);
    expect(board.writes.map((w) => w.page)).toEqual(["p1"]);
  });

  it("a second run waits for the first", async () => {
    const { board, desk } = setup();
    const a = desk.run([{ type: "heading", text: "First" }, { type: "note", text: "a" }]);
    const b = desk.run([{ type: "note", text: "b" }]);
    await Promise.all([a, b]);
    expect(board.writes.map((w) => w.lead[LECTURE_WHAT_META])).toEqual(["heading: First", "note: a", "note: b"]);
  });

  it("a chat reply being written goes first: a lecture block waits its turn at the chat desk", async () => {
    const { board, chat, desk } = setup();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const reply = chat.exclusive(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push("chat");
            resolve();
          };
        }),
    );
    const lecture = desk.run([{ type: "heading", text: "Waits" }]).then(() => order.push("lecture"));
    await new Promise((r) => setTimeout(r, 5));
    expect(board.writes).toEqual([]);
    release();
    await Promise.all([reply, lecture]);
    expect(order).toEqual(["chat", "lecture"]);
  });
});

describe("the lecture desk — the chat's own actions", () => {
  function stubChat(outcome: ChatRunReport, onRun?: () => void) {
    const board = new FakeBoard();
    const calls: ChatAction[][] = [];
    const chat = {
      run: async (actions: readonly ChatAction[]) => {
        calls.push([...actions]);
        onRun?.call(null);
        return outcome;
      },
      exclusive: <T,>(fn: () => Promise<T>) => fn(),
    } as unknown as ChatDesk;
    return { board, calls, desk: new LectureDesk(board, chat, fakePlanners()) };
  }

  it("graph, figure, formula and new screen go through the chat desk one at a time; the outcome carries what was drawn", async () => {
    const { desk, calls } = stubChat({ outcomes: [{ type: "graph", ok: true }], problemsWritten: 0, problemsDropped: 0, screensAdded: 0 });
    const graph: LectureAction = { type: "graph", relations: ["y = x^{2}"] };
    const lines: LectureAction = { type: "write_lines", lines: ["E = mc^{2}"] };
    const report = await desk.run([graph, lines]);
    expect(calls).toEqual([[graph], [lines]]);
    expect(report.outcomes).toEqual([
      { type: "graph", ok: true, what: "graph: y = x^{2}" },
      { type: "write_lines", ok: true, what: "formula: E = mc^{2}" },
    ]);
  });

  it("a note from the chat desk comes back with its outcome", async () => {
    const { desk } = stubChat({ outcomes: [{ type: "draw_figure", ok: false, note: "I couldn't draw that figure." }], problemsWritten: 0, problemsDropped: 0, screensAdded: 0 });
    const report = await desk.run([{ type: "draw_figure", figure: { kind: "triangle" } } as unknown as LectureAction]);
    expect(report.outcomes).toEqual([{ type: "draw_figure", ok: false, note: "I couldn't draw that figure." }]);
  });

  it("a screen the chat adds counts, and the lecture goes on there (a graph that overflowed keeps the topic)", async () => {
    let board: FakeBoard | null = null;
    const res = stubChat({ outcomes: [{ type: "graph", ok: true }], problemsWritten: 0, problemsDropped: 0, screensAdded: 1 }, () => board?.addScreen());
    board = res.board;
    board.page.meta.topic = "Quadratics";
    const report = await res.desk.run([{ type: "graph", relations: ["y = x^{2}"] }, { type: "note", text: "The vertex is the minimum" }]);
    expect(report.screensAdded).toBe(1);
    expect(report.outcomes.map((o) => o.ok)).toEqual([true, true]);
    expect(board.writes.map((w) => w.page)).toEqual(["p2"]);
    expect(board.pages[1].meta.topic).toBe("Quadratics");
  });

  it("new_screen through the real chat desk: a blank screen, and the next block is written on it", async () => {
    const { board, desk } = setup();
    board.put({ x: 100, y: 100, w: 50, h: 50 });
    const report = await desk.run([{ type: "new_screen" }, { type: "note", text: "fresh" }]);
    expect(report).toMatchObject({ screensAdded: 1, outcomes: [{ type: "new_screen", ok: true, what: "new screen" }, { type: "note", ok: true }] });
    expect(board.writes.map((w) => w.page)).toEqual(["p2"]);
  });
});

describe("the lecture desk — the screen in words", () => {
  it("an empty screen: empty, no topic, nothing drawn, all the room", () => {
    const { desk } = setup();
    expect(desk.screen()).toEqual({ empty: true, topic: null, drawn: [], room: 1, active: [] });
  });

  it("the topic from the page meta; what is drawn in reading order, once per block; the room left", async () => {
    const { board, desk } = setup();
    await desk.run([{ type: "heading", text: "Cells" }, { type: "note", text: "Mitochondria make ATP" }, BAR]);
    // a graph the chat drew (its equation above it), a formula, a figure, and a mark that is not a block
    board.put({ x: 700, y: 560, w: 120, h: 30 }, { live: true, source: "ai", [CHAT_BLOCK_META]: "graph", [HAND_BLOCK_META]: "g1", [HAND_LINE_META]: "y = x^{2}" });
    board.put({ x: 700, y: 600, w: 300, h: 200 }, { live: true, source: "ai", [CHAT_BLOCK_META]: "graph", [HAND_BLOCK_META]: "g1", [HAND_LINE_META]: "x" });
    board.put({ x: 60, y: 700, w: 200, h: 40 }, { live: true, source: "ai", [CHAT_BLOCK_META]: "lines", [HAND_BLOCK_META]: "l1", [HAND_LINE_META]: "E = mc^{2}" });
    board.put({ x: 60, y: 760, w: 200, h: 40 }, { live: true, source: "ai", [CHAT_BLOCK_META]: "figure", [HAND_BLOCK_META]: "f1", [HAND_LINE_META]: "A" });
    board.put({ x: 60, y: 820, w: 20, h: 20 }, { live: true, source: "ai", mark: "tick:1" });
    const s = desk.screen();
    expect(s.empty).toBe(false);
    expect(s.topic).toBe("Cells");
    expect(s.drawn).toEqual(["heading: Cells", "note: Mitochondria make ATP", "bar chart: GDP growth", "graph: y = x^{2}", "formula: E = mc^{2}", "geometry figure"]);
    expect(s.room).toBeGreaterThan(0.2);
    expect(s.room).toBeLessThan(0.9);
  });

  it("drawn is capped at LECTURE_LIMITS.drawn; a topic is cleaned of what a heading may not hold", () => {
    const { board, desk } = setup();
    for (let i = 0; i < 20; i++) board.put({ x: 60, y: 100 + i * 30, w: 100, h: 20 }, { [LECTURE_BLOCK_META]: "note", [LECTURE_WHAT_META]: `note: point ${i}`, [HAND_BLOCK_META]: `n${i}` });
    board.page.meta.topic = "  Cells {and} $tissues\n";
    const s = desk.screen();
    expect(s.drawn).toHaveLength(LECTURE_LIMITS.drawn);
    expect(s.drawn[0]).toBe("note: point 0");
    expect(s.topic).toBe("Cells and tissues");
  });

  it("a full screen has no room", () => {
    const { board, desk } = setup();
    board.put({ x: 0, y: 0, w: 1600, h: 900 });
    expect(desk.screen().room).toBe(0);
  });
});

describe("the lecture desk — the transcript on the screen", () => {
  it("heard text is appended to the screen's transcript, a space between", () => {
    const { board, desk } = setup();
    desk.saveTranscript("  Today we look at   cells. ");
    desk.saveTranscript("");
    desk.saveTranscript("Every living thing is made of them.");
    expect(board.page.meta.transcript).toBe("Today we look at cells. Every living thing is made of them.");
    expect(board.metaWrites).toBe(2);
  });

  it("kept to the last screenTranscriptChars, dropped from the front at a word", () => {
    const { board, desk } = setup();
    const words = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(" ");
    desk.saveTranscript(words);
    desk.saveTranscript("the end");
    const t = board.page.meta.transcript ?? "";
    expect(t.length).toBeLessThanOrEqual(LECTURE_LIMITS.screenTranscriptChars);
    expect(t.length).toBeGreaterThan(LECTURE_LIMITS.screenTranscriptChars - 12);
    expect(t.endsWith("word2999 the end")).toBe(true);
    expect(t.startsWith("word")).toBe(true);
    expect(`${words} the end`.endsWith(t)).toBe(true);
  });

  it("each screen keeps its own transcript", async () => {
    const { board, desk } = setup();
    desk.saveTranscript("first screen");
    board.addScreen();
    desk.saveTranscript("second screen");
    expect(board.pages.map((p) => p.meta.transcript)).toEqual(["first screen", "second screen"]);
  });
});

describe("helpers", () => {
  it("tailAtWord: short text unchanged; a cut inside a word drops the rest of it; one long word is cut hard", () => {
    expect(tailAtWord("abc def", 20)).toBe("abc def");
    expect(tailAtWord("alpha beta gamma", 8)).toBe("gamma");
    expect(tailAtWord("alpha beta gamma", 9)).toBe("gamma");
    // the cut falls exactly at a word
    expect(tailAtWord("alpha beta gamma", 10)).toBe("beta gamma");
    expect(tailAtWord("abcdefghij", 4)).toBe("ghij");
  });

  it("roundPlan keeps the shape at 1/100 px; scalePlan scales about the top-left", () => {
    const plan = boxPlan(100.123456, 50.987654, "x");
    const r = roundPlan({ ...plan, lines: plan.lines.map((l) => ({ ...l, x: 10.555555, y: 3.333333 })) });
    expect(r.lines[0]).toMatchObject({ x: 10.56, y: 3.33 });
    expect(r.lines[0].strokes[0].points[1]).toEqual({ x: 100.12, y: 0, z: 0.5 });
    const placed = { ...plan, bounds: { ...plan.bounds, x: 40, y: 20 }, lines: plan.lines.map((l) => ({ ...l, x: 40, y: 20 })) };
    const s = scalePlan(placed, 0.5);
    expect(s.bounds).toEqual({ x: 40, y: 20, w: 100.123456 / 2, h: 50.987654 / 2 });
    expect(s.lines[0].strokes[1].points[1]).toMatchObject({ x: 100.123456 / 2, y: 50.987654 / 2 });
    expect(s.size).toBe(15);
  });

  it("estimateBytes: ~550 bytes a stroke, ~38 a point", () => {
    expect(estimateBytes(boxPlan(10, 10, "x"))).toBe(4 * 550 + 8 * 38);
  });
});

// the report type is the contract's
const _typed: LectureRunReport = { outcomes: [], screensAdded: 0 };
void _typed;

// ------------------------------------------------------------------ LIVE: charts that grow as the lecture goes

/** A rectangle outline from (0, 0) as a line of its own at (x, y), named `part`. */
function partLine(part: string, x: number, y: number, w: number, h: number, startMs: number, style?: HandPlan["lines"][number]["style"]): HandPlan["lines"][number] {
  const pts: Array<[number, number]> = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
    [0, 0],
  ];
  const stroke = { points: pts.map(([px, py]) => ({ x: px, y: py, z: 0.5 })), order: 0, kind: "rule" } as Stroke;
  return { latex: part, x, y, strokes: [stroke], baseline: h, startMs, durationMs: 300, part, ...(style ? { style } : {}) };
}

/**
 * A bar chart as the planners draw one, with named parts: the axes; per category its label, and —
 * once its value is said — its bar and the value over it. Each category has its own slot (so Q2's
 * arrival moves nothing) at 10 px a unit, until a value too tall for the box rescales every bar.
 */
function partsChart(spec: ChartSpec, { box }: { seed: number; box: { w: number; h: number } }): HandPlan | null {
  if (spec.kind !== "bar" && spec.kind !== "line") return boxPlan(box.w, box.h, spec.kind);
  if (spec.labels.length * 60 + 40 > box.w) return null;
  const base = box.h - 40;
  const values = spec.series[0].values;
  const max = Math.max(0, ...values.filter((v): v is number => v !== null));
  const unit = max * 10 > base - 20 ? (base - 20) / max : 10;
  // the axes are as long as the categories need: a short chart leaves the rest of its box empty
  const width = spec.labels.length * 60 + 40;
  const lines = [partLine("axis", 0, 0, width, base, 0)];
  let t = 400;
  spec.labels.forEach((label, i) => {
    const x = 40 + i * 60;
    lines.push(partLine(`label:${label}`, x, base + 10, 40, 16, (t += 300)));
    const v = values[i];
    if (v === null || v === undefined) return;
    lines.push(partLine(`bar:${label}`, x, base - v * unit, 40, v * unit, (t += 300), { color: "blue", fill: "semi", closed: true }));
    lines.push(partLine(`value:${label}`, x, base - v * unit - 20, 30, 14, (t += 300)));
  });
  return { lines, bounds: { x: 0, y: 0, w: width, h: base + 26 }, size: 30, totalMs: t + 300, pace: 2 };
}

type ChartSpec = Extract<LectureAction, { type: "chart" }>["chart"];

const sales = (values: Array<number | null>, labels = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"].slice(0, values.length)): ChartSpec => ({
  kind: "bar",
  title: "Sales",
  labels,
  series: [{ values }],
  unit: "million",
});

describe("the lecture desk — live charts", () => {
  const partsOfShapes = (board: FakeBoard, id: string) =>
    board.page.shapes.filter((s) => (s.meta as Record<string, unknown>)[LECTURE_ID_META] === id).map((s) => String((s.meta as Record<string, unknown>)[HAND_PART_META]));

  async function drawn(values: Array<number | null>) {
    const setupRes = setup({ chart: partsChart });
    const r = await setupRes.desk.run([{ type: "chart", chart: sales(values) }]);
    const id = r.outcomes[0].id;
    if (!id) throw new Error("no id");
    return { ...setupRes, id };
  }

  it("Q1, then Q2: only Q2's bar and its value are written, in place; nothing is rubbed out", async () => {
    const { board, desk, id } = await drawn([12, null]);
    const entry = board.page.meta.visuals?.[id];
    if (!entry) throw new Error("no visual recorded");
    expect(partsOfShapes(board, id).sort()).toEqual(["axis", "bar:Q1", "label:Q1", "label:Q2", "value:Q1"]);
    const report = await desk.run([{ type: "update_chart", target: id, chart: sales([12, 15]) }]);
    expect(report).toEqual({ outcomes: [{ type: "update_chart", ok: true, id, what: "bar chart: Sales" }], screensAdded: 0 });
    expect(board.deleted).toEqual([]);
    expect(board.writes).toHaveLength(2);
    const update = board.writes[1];
    expect(update.meta).toEqual({ [LECTURE_BLOCK_META]: "chart", [LECTURE_ID_META]: id });
    expect(update.plan.lines.map((l) => l.part)).toEqual(["bar:Q2", "value:Q2"]);
    // where the whole chart puts Q2's bar: the chart's own (0, 0) is at `at`
    const bar = update.plan.lines[0];
    expect(bar.x).toBeCloseTo(entry.at.x + 40 + 60, 2);
    expect(bar.y).toBeCloseTo(entry.at.y + 340 - 150, 2);
    expect(bar.style).toEqual({ color: "blue", fill: "semi", closed: true });
    // one bar and its value, from the start, at the sketch's pace: well under a second
    expect(update.plan.lines[0].startMs).toBe(0);
    expect(update.plan.totalMs / (update.plan.pace ?? 1)).toBeLessThan(1000);
    expect(partsOfShapes(board, id).sort()).toEqual(["axis", "bar:Q1", "bar:Q2", "label:Q1", "label:Q2", "value:Q1", "value:Q2"]);
    const after = board.page.meta.visuals?.[id];
    expect(after?.chart).toEqual(sales([12, 15]));
    expect(after?.updatedAt).toBeGreaterThan(entry.updatedAt);
    expect({ box: after?.box, seed: after?.seed, at: after?.at }).toEqual({ box: entry.box, seed: entry.seed, at: entry.at });
  });

  it("a correction replaces only that bar and its value", async () => {
    const { board, desk, id } = await drawn([12, 15]);
    const q2 = board.page.shapes.filter((s) => ["bar:Q2", "value:Q2"].includes(String((s.meta as Record<string, unknown>)[HAND_PART_META]))).map((s) => s.id);
    expect(q2).toHaveLength(2);
    const report = await desk.run([{ type: "update_chart", target: id, chart: sales([12, 18]) }]);
    expect(report.outcomes[0]).toMatchObject({ ok: true, id });
    expect(board.deleted.sort()).toEqual(q2.sort());
    expect(board.writes[1].plan.lines.map((l) => l.part)).toEqual(["bar:Q2", "value:Q2"]);
    expect(board.writes[1].plan.lines[0].y).toBeCloseTo(board.page.meta.visuals![id].at.y + 340 - 180, 2);
  });

  it("the same spec again: nothing rubbed out, nothing written, still live", async () => {
    const { board, desk, id } = await drawn([12, 15]);
    const before = board.page.meta.visuals![id].updatedAt;
    const report = await desk.run([{ type: "update_chart", target: id, chart: sales([12, 15]) }]);
    expect(report.outcomes[0]).toMatchObject({ ok: true, id });
    expect(board.deleted).toEqual([]);
    expect(board.writes).toHaveLength(1);
    expect(board.page.meta.visuals![id].updatedAt).toBeGreaterThan(before);
  });

  it("a new scale rewrites most of it: a quick redraw, faster than the first sketch", async () => {
    const { board, desk, id } = await drawn([12, 15, 10]);
    const report = await desk.run([{ type: "update_chart", target: id, chart: sales([12, 15, 60]) }]);
    expect(report.outcomes[0]).toMatchObject({ ok: true, id });
    const update = board.writes[1];
    expect(update.plan.lines.map((l) => l.part)).toEqual(["bar:Q1", "value:Q1", "bar:Q2", "value:Q2", "bar:Q3", "value:Q3"]);
    expect(board.deleted).toHaveLength(6);
    expect(update.plan.pace).toBeCloseTo(2 * LECTURE_LAYOUT.redrawPace, 5);
    // the axes and the labels were never touched
    expect(partsOfShapes(board, id).filter((p) => p === "axis" || p.startsWith("label:"))).toHaveLength(4);
  });

  it("a target that is not on this screen: drawn as a new chart here, with a new id", async () => {
    const { board, desk, id } = await drawn([12, null]);
    const onFirst = board.pages[0].shapes.length;
    board.addScreen();
    const report = await desk.run([{ type: "update_chart", target: id, chart: sales([12, 15]) }]);
    const out = report.outcomes[0];
    expect(out).toMatchObject({ type: "update_chart", ok: true, what: "bar chart: Sales" });
    expect(out.id).toMatch(/^lv_/);
    expect(out.id).not.toBe(id);
    expect(board.writes.at(-1)?.page).toBe("p2");
    expect(board.pages[0].shapes).toHaveLength(onFirst);
    expect(board.deleted).toEqual([]);
    expect(board.pages[1].meta.visuals?.[out.id!]?.chart).toEqual(sales([12, 15]));
  });

  it("the kind changing (a bar chart that became a line chart): a new chart, the old one left as it is", async () => {
    const { board, desk, id } = await drawn([12, 15]);
    const before = partsOfShapes(board, id).length;
    const line: ChartSpec = { kind: "line", title: "Sales", labels: ["Q1", "Q2"], series: [{ values: [12, 15] }], unit: "million" };
    const report = await desk.run([{ type: "update_chart", target: id, chart: line }]);
    expect(report.outcomes[0].id).not.toBe(id);
    expect(report.outcomes[0]).toMatchObject({ ok: true, what: "line chart: Sales" });
    expect(partsOfShapes(board, id)).toHaveLength(before);
    expect(board.deleted).toEqual([]);
    // an update_diagram aimed at a chart is a new diagram too
    const d = await desk.run([{ type: "update_diagram", target: id, diagram: { kind: "flow", steps: ["a", "b"] } }]);
    expect(d.outcomes[0]).toMatchObject({ type: "update_diagram", ok: true });
    expect(d.outcomes[0].id).not.toBe(id);
  });

  it("outgrown its box: rubbed out and drawn again, as large as it fits, under the same id", async () => {
    const { board, desk } = setup({ chart: partsChart });
    // only a corner of the screen is free: the chart is drawn in the smallest box
    board.put({ x: 0, y: 0, w: 1600, h: 520 });
    board.put({ x: 0, y: 520, w: 1100, h: 380 });
    const r = await desk.run([{ type: "chart", chart: sales([1, 2, 3]) }]);
    const id = r.outcomes[0].id!;
    expect(board.page.meta.visuals?.[id]?.box).toEqual(LECTURE_BOXES.visual[2]);
    const first = board.page.shapes.filter((s) => (s.meta as Record<string, unknown>)[LECTURE_ID_META] === id).map((s) => s.id);
    const report = await desk.run([{ type: "update_chart", target: id, chart: sales([1, 2, 3, 4, 5, 6]) }]);
    expect(report).toMatchObject({ screensAdded: 1, outcomes: [{ type: "update_chart", ok: true, id }] });
    expect(board.deleted.sort()).toEqual(first.sort());
    expect(board.pages[1].meta.visuals?.[id]?.box).toEqual(LECTURE_BOXES.visual[0]);
  });

  it("active: the live visuals still on the screen, newest first, at most two, with their specs", async () => {
    const { board, desk } = setup({ chart: partsChart });
    const a = (await desk.run([{ type: "chart", chart: sales([1, 2]) }])).outcomes[0].id!;
    const b = (await desk.run([CYCLE])).outcomes[0].id!;
    const c = (await desk.run([{ type: "chart", chart: sales([3, null]) }])).outcomes[0].id!;
    expect(desk.screen().active).toEqual([
      { id: c, chart: sales([3, null]) },
      { id: b, diagram: (CYCLE as Extract<LectureAction, { type: "diagram" }>).diagram },
    ]);
    await desk.run([{ type: "update_chart", target: a, chart: sales([1, 2, 3], ["Q1", "Q2", "Q3"]) }]);
    expect(desk.screen().active.map((v) => v.id)).toEqual([a, c]);
    // the student rubs out the newest: it is not live any more
    board.deleteShapes(board.page.shapes.filter((s) => (s.meta as Record<string, unknown>)[LECTURE_ID_META] === a).map((s) => s.id));
    expect(desk.screen().active.map((v) => v.id)).toEqual([c, b]);
    // and it is dropped from the page meta the next time a visual is recorded there
    await desk.run([{ type: "update_chart", target: c, chart: sales([3, 4]) }]);
    expect(Object.keys(board.page.meta.visuals ?? {}).sort()).toEqual([b, c].sort());
  });

  it("a spec kept on the page is a spec that parses, and re-plans to the ink on the board", async () => {
    const { board, desk, id } = await drawn([12, null]);
    const entry = board.page.meta.visuals?.[id];
    if (!entry) throw new Error("no visual recorded");
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
    expect(entry).toEqual({ chart: sales([12, null]), box: LECTURE_BOXES.visual[0], seed: expect.any(Number), at: expect.any(Object), updatedAt: expect.any(Number) });
    expect(desk.screen().active).toEqual([{ id, chart: sales([12, null]) }]);
    // the stored box, seed and place give back exactly what was written
    const again = partsChart(entry.chart!, { seed: entry.seed, box: entry.box })!;
    const written = board.writes[0].plan;
    expect(written.bounds.x).toBeCloseTo(entry.at.x, 2);
    expect(written.bounds.y).toBeCloseTo(entry.at.y, 2);
    for (const l of again.lines) {
      const w = written.lines.find((x) => x.part === l.part)!;
      expect(w.x).toBeCloseTo(entry.at.x + l.x, 2);
      expect(w.y).toBeCloseTo(entry.at.y + l.y, 2);
    }
    // a spec that no longer passes the contract (an older board) is not offered for update
    board.page.meta.visuals = { [id]: { ...entry, chart: { kind: "bar" } as unknown as ChartSpec } };
    expect(desk.screen().active).toEqual([]);
  });

  it("a picture's whole box is kept for it: nothing else is placed where it may grow", async () => {
    // two categories: 160 px of ink in a 520 px box
    const { board, desk, id } = await drawn([2, null]);
    const entry = board.page.meta.visuals![id];
    expect(board.writes[0].plan.bounds.w).toBe(160);
    // the notes column is full: the notes have to go to the right, round the chart
    board.put({ x: 0, y: 0, w: 700, h: 900 });
    await desk.run([{ type: "note", text: "x".repeat(15) }, { type: "note", text: "y".repeat(15) }]);
    const notes = board.writes.slice(1);
    expect(notes.map((w) => w.page)).toEqual(["p1", "p1"]);
    const box = { x: entry.at.x, y: entry.at.y, w: entry.box.w, h: entry.box.h };
    for (const w of notes) {
      const b = w.plan.bounds;
      expect(b.x + b.w <= box.x || b.x >= box.x + box.w || b.y + b.h <= box.y || b.y >= box.y + box.h).toBe(true);
    }
  });
});

describe("parts", () => {
  it("unnamed lines are parts of their own, named by their ink; the same ink twice is told apart", async () => {
    const { partsOf } = await import("../desk");
    const a = boxPlan(10, 10, "a").lines[0];
    const plan: HandPlan = { lines: [a, { ...a }, { ...a, x: 5 }, { ...a, part: "named" }, { ...a, part: "named", y: 3 }], bounds: { x: 0, y: 0, w: 20, h: 20 }, size: 30, totalMs: 1 };
    const parts = partsOf(plan);
    const keys = [...parts.keys()];
    expect(keys).toHaveLength(4);
    expect(keys[0]).toMatch(/^~[0-9a-z]+$/);
    expect(keys[1]).toBe(`${keys[0]}#1`);
    expect(keys[2]).not.toBe(keys[0]);
    expect(parts.get("named")).toHaveLength(2);
  });

  it("diffParts: the same ink stays, moved or restyled ink is rewritten, a part that went is rubbed out", async () => {
    const { diffParts } = await import("../desk");
    const mk = (lines: HandPlan["lines"]): HandPlan => ({ lines, bounds: { x: 0, y: 0, w: 100, h: 100 }, size: 30, totalMs: 1 });
    const before = mk([partLine("axis", 0, 0, 90, 90, 0), partLine("bar:A", 10, 50, 10, 40, 1), partLine("bar:B", 30, 60, 10, 30, 2), partLine("gone", 0, 95, 5, 5, 3)]);
    const after = mk([partLine("axis", 0, 0.004, 90, 90, 0), partLine("bar:A", 10, 50, 10, 40, 1, { color: "orange" }), partLine("bar:B", 30, 40, 10, 50, 2), partLine("new", 50, 50, 5, 5, 3)]);
    const d = diffParts(before, after);
    expect(d.keep).toEqual(["axis"]);
    expect(d.remove.sort()).toEqual(["bar:A", "bar:B", "gone"]);
    expect(d.add.map((l) => l.part)).toEqual(["bar:A", "bar:B", "new"]);
    expect({ written: d.written, total: d.total }).toEqual({ written: 3, total: 4 });
  });
});
