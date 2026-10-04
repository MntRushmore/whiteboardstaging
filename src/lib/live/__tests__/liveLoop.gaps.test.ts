import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine as inkLine } from "../__fixtures__/strokes";
import { settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  LIVE_TIMING,
  isLiveMeta,
  type CheckRequest,
  type HelpMode,
  type LineAnalysis,
  type LiveEngine,
  type LiveSseEvent,
  type RecognizeRequest,
  type RecognizeResponse,
  type Rect,
  type SolveRequest,
} from "../contracts";
import { getEngine } from "../engine";
import { handLinesOf } from "../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { problemMetaOf } from "../chat/cells";
import type { ChatAction, ChatRunReport } from "../chat/contracts";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";

/**
 * Two problems written one under the other (the owner: "a blank vertical gap between rows in the
 * same column starts a new problem"). A student writes `2x + 3 = 11`, leaves a clear blank gap and
 * writes `4x = 8` further down: two problems. A column was one problem whatever the gap short of
 * three lines (or 120 desktop px), so `4x = 8` was judged as the next step of `2x + 3 = 11` (a ring),
 * Solve and Help went from there, and Auto's model check read both as one.
 *
 * But closely stacked lines stay one problem (`3x + 24 =` over `x = 3`: the value it is worked out
 * at), as does working with the uneven gaps students leave between steps, working that goes on
 * under the tutor's own steps, and working with a gap where a step was rubbed out.
 *
 * Every line is 40 px tall: a new problem's gap is 2.5 lines of blank (100 px).
 *
 * The real engine and the real hand engine; the recognizer and the model are scripted.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const H = 40;
/** a line `lines` of blank under the bottom of one at `y` */
const under = (y: number, lines: number) => y + H + lines * H;

/** A line the engine cannot judge: only a model can say whether it follows. */
const UNJUDGED = "x^{2}+y=\\sin y";

/** The real engine, except that `UNJUDGED` comes back unknown. */
function withUnjudged(): LiveEngine {
  const unknown = (latex: string): LineAnalysis => ({ kind: "equation", math: latex, resultLatex: "", verdict: "unknown", note: "" });
  return new Proxy(engine, {
    get(target, prop, receiver) {
      if (prop === "analyzeLine") return (latex: string, ctx: Parameters<LiveEngine["analyzeLine"]>[1]) => (latex === UNJUDGED ? unknown(latex) : target.analyzeLine(latex, ctx));
      const v = Reflect.get(target, prop, receiver) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

describe("live loop — a blank gap between rows starts a new problem", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let calls: Array<{ path: string; body: unknown }>;
  /** latex the recognizer gives each line, in the order the lines are first read */
  let script: string[];
  let assigned: Map<string, string>;

  function start(mode: HelpMode, opts: { auto?: boolean; engine?: LiveEngine } = {}): void {
    loop?.stop();
    resetLiveStore();
    const stream = async function* (path: string, body: unknown): AsyncGenerator<LiveSseEvent, void, undefined> {
      calls.push({ path, body });
    };
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true, auto: opts.auto ?? true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream,
        getEngine: async () => opts.engine ?? engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        setup: async () => {
          throw new Error("no word problems here");
        },
        reread: async () => {
          throw new Error("no second reader here");
        },
      },
    );
    loop.start();
  }

  /** One line of `ink` at (x, y), read as `latex`; the pen stays up just long enough for the read. */
  async function penLine(ink: string, latex: string, y: number, x = 100): Promise<{ id: string; strokes: TLShape[] }> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    const strokes = inkLine(ink, x, y, H);
    editor.putUser(strokes);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.analysis)));
    const id = Object.keys(liveStore.lines.get()).find((k) => !before.has(k));
    if (!id) throw new Error(`${ink} produced no line`);
    return { id, strokes };
  }

  const quiesce = () =>
    settleStable(() => [editor.getCurrentPageShapes().length, calls.length, liveStore.solving.get(), liveStore.lastError.get()?.id ?? ""].join("|"));

  /** Time passes with no ink. */
  async function wait(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await quiesce();
  }

  const metaOf = (s: TLShape) => s.meta as Record<string, unknown>;
  const tutorInk = () => editor.getCurrentPageShapes().filter((s) => s.type === "draw" && isLiveMeta(s.meta) && !metaOf(s).mark);
  /** what the tutor wrote by hand that is not a mark, as lines of maths */
  const work = () => handLinesOf(tutorInk());
  /** the tutor's marks on the page, by kind (`check`, `circle`, `question`) */
  const marks = () =>
    editor
      .getCurrentPageShapes()
      .filter((s) => isLiveMeta(s.meta) && metaOf(s).mark)
      .map((s) => String(metaOf(s).mark).split(":")[0]);
  const checks = () => calls.filter((c) => c.path.endsWith("/check")).map((c) => c.body as CheckRequest);
  const lineOf = (id: string) => liveStore.lines.get()[id];
  const columnOf = (id: string) => lineOf(id).line.column;
  const verdictOf = (id: string) => lineOf(id).analysis?.verdict;
  function boundsOf(shapes: TLShape[]): Rect {
    const boxes = shapes.map((s) => editor.getShapePageBounds(s)!);
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
  }
  /** One more flush of the whole screen: a stroke written well away from everything, read as `latex`. */
  async function inkElsewhere(latex: string): Promise<void> {
    await penLine("8", latex, 700, 1300);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    editor = createFakeEditor();
    calls = [];
    script = [];
    assigned = new Map();
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const { lineId } = body as RecognizeRequest;
      let latex = assigned.get(lineId);
      if (latex === undefined) {
        latex = script[assigned.size] ?? "\\Delta";
        assigned.set(lineId, latex);
      }
      return { latex, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
    });
    liveStore.inkBalance.set(null);
  });

  afterEach(() => {
    loop.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ------------------------------------------------------------------ two problems

  describe("`2x + 3 = 11`, a clear gap, then `4x = 8`: two problems", () => {
    // 2.75 lines of blank (110 px): past a new problem's 2.5, inside the old break of 120 px
    const Y_A = 200;
    const Y_B = under(Y_A, 2.75);

    it("the lower one is not judged as a step of the upper one, and the outline counts two problems", async () => {
      start("feedback");
      const a = await penLine("2x+3=11", "2x+3=11", Y_A);
      const b = await penLine("4x=8", "4x=8", Y_B);
      await wait(ANSWER_SETTLE_MS);
      expect(columnOf(a.id)).not.toBe(columnOf(b.id));
      expect(lineOf(b.id).line.row).toBe(0);
      // `4x = 8` with nothing above it: nothing to judge (it was a ring: x = 2 is not x = 4)
      expect(verdictOf(b.id)).not.toBe("mismatch");
      expect(marks()).not.toContain("circle");
      // the outline: two problems, the pen's around `4x = 8` alone
      expect(liveStore.helpTarget.get()).toMatchObject({ key: `c:${b.id}`, column: columnOf(b.id), by: "pen", problems: 2 });
      expect(liveStore.helpTarget.get()?.bounds).toEqual(lineOf(b.id).line.bounds);
    });

    it("Help me (Suggest) writes the next step of the problem the pen is in, under it", async () => {
      start("suggest", { auto: false });
      await penLine("2x+3=11", "2x+3=11", Y_A);
      const b = await penLine("4x=8", "4x=8", Y_B);
      loop.noteAsked();
      expect(loop.requestHelp()).toBe(true);
      await wait(1000);
      expect(work()).toEqual(["x = 2"]);
      expect(boundsOf(tutorInk()).y).toBeGreaterThan(lineOf(b.id).line.bounds.y + lineOf(b.id).line.bounds.h);
      expect(calls).toEqual([]);
    });

    it("Solve it finishes the problem the pen is in, not the one above", async () => {
      start("answer", { auto: false });
      await penLine("2x+3=11", "2x+3=11", Y_A);
      const b = await penLine("4x=8", "4x=8", Y_B);
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(work()).toEqual(["x = 2"]);
      expect(boundsOf(tutorInk()).y).toBeGreaterThan(lineOf(b.id).line.bounds.y + lineOf(b.id).line.bounds.h);
      expect(calls).toEqual([]);
    });

    it("...and a problem the engine cannot finish goes to the model alone, without the one above", async () => {
      start("answer", { auto: false, engine: withUnjudged() });
      await penLine("2x+3=11", "2x+3=11", Y_A);
      const b = await penLine("4x=8", UNJUDGED, Y_B);
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      const solves = calls.filter((c) => c.path.endsWith("/solve")).map((c) => c.body as SolveRequest);
      expect(solves).toHaveLength(1);
      expect(solves[0].lines.map((l) => l.latex)).toEqual([UNJUDGED]);
      expect(solves[0].fromLineId).toBe(b.id);
    });

    it("Auto finishes the problem the pen is in at the pause, and only that one", async () => {
      start("answer");
      await penLine("2x+3=11", "2x+3=11", Y_A);
      await penLine("4x=8", "4x=8", Y_B);
      await wait(ANSWER_SETTLE_MS);
      expect(work()).toEqual(["x = 2"]);
      expect(marks()).not.toContain("circle");
      expect(calls).toEqual([]);
    });

    it("Auto's model check reads the pen's problem alone", async () => {
      start("feedback", { engine: withUnjudged() });
      await penLine("2x+3=11", "2x+3=11", Y_A);
      await penLine("2x=8", "2x=8", under(Y_A, 0.5));
      const yB = under(under(Y_A, 0.5), 2.75);
      const b = await penLine("4x=8", "4x=8", yB);
      const unjudged = await penLine("x=4", UNJUDGED, under(yB, 0.5));
      await wait(ANSWER_SETTLE_MS);
      expect(checks()).toHaveLength(1);
      expect(checks()[0].focusLineId).toBe(unjudged.id);
      expect(checks()[0].lines.map((l) => l.latex)).toEqual(["4x=8", UNJUDGED]);
      expect(columnOf(unjudged.id)).toBe(columnOf(b.id));
    });

    it("the tutor working the upper one into the gap does not join them: not then, nor after a reload", async () => {
      start("answer", { auto: false });
      const a = await penLine("2x+3=11", "2x+3=11", Y_A);
      // a wider gap: the two steps of `2x + 3 = 11` fit in it
      const b = await penLine("4x=8", "4x=8", under(Y_A, 5));
      // picked with the select tool, then Solve it: its working goes under it, over `4x = 8`
      editor.select([...lineOf(a.id).line.strokeIds]);
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(work()).toEqual(["2x = 8", "x = 4"]);
      const written = boundsOf(tutorInk());
      expect(written.y).toBeGreaterThan(Y_A + H);
      expect(written.y + written.h).toBeLessThan(lineOf(b.id).line.bounds.y);
      editor.select([]);
      // the screen is clustered again (more ink elsewhere): still two problems
      await inkElsewhere("8");
      expect(columnOf(b.id)).not.toBe(columnOf(a.id));
      expect(verdictOf(b.id)).not.toBe("mismatch");
      // a reload: the tutor's working was written after `4x = 8`, so it still fills nothing for it
      start("answer", { auto: false });
      await quiesce();
      expect(columnOf(b.id)).not.toBe(columnOf(a.id));
      expect(verdictOf(b.id)).not.toBe("mismatch");
    });
  });

  // ------------------------------------------------------------------ one problem

  // No reading of what the lower line says (`=` first, a step the engine says follows, a value for
  // the line above) is needed to keep a line with its problem: a line that goes on with the one
  // above is written where a next step is, and that is short of a new problem's gap. These pass on
  // the gap alone.
  it.each([
    ["stacked closely", 0.75],
    ["two lines of blank under it", 2],
  ])("the owner's `3x + 24 =` over `x = 3`, %s, is one problem: 33 after its `=`", async (_how, blank) => {
    start("answer", { auto: false });
    const problem = await penLine("3x+24=", "3x+24=", 200);
    const given = await penLine("x=3", "x=3", under(200, blank));
    expect(columnOf(given.id)).toBe(columnOf(problem.id));
    expect(liveStore.helpTarget.get()?.problems).toBe(1);
    loop.noteAsked();
    loop.requestSolve();
    await wait(1000);
    expect(work()).toEqual(["33"]);
    expect(calls).toEqual([]);
  });

  it("a line that goes on from the one above (`=` first), two lines of blank under it, is in its problem", async () => {
    start("feedback");
    const problem = await penLine("3x+24=", "(x+y)^{2}=", 200);
    const more = await penLine("=8+1", "=x^{2}+2xy+y^{2}", under(200, 2), 140);
    expect(columnOf(more.id)).toBe(columnOf(problem.id));
    expect(liveStore.helpTarget.get()?.problems).toBe(1);
  });

  it("working with the uneven gaps students leave between steps is one problem", async () => {
    start("feedback");
    // under half a line, then over two lines of blank (2.2), then one
    const y1 = 200;
    const y2 = under(y1, 0.4);
    const y3 = under(y2, 2.2);
    const y4 = under(y3, 1);
    const eq = await penLine("2x+3=11", "2x+3=11", y1);
    const s1 = await penLine("8+1=", "2x+3-3=11-3", y2);
    const s2 = await penLine("2x=8", "2x=8", y3);
    const s3 = await penLine("x=4", "x=4", y4);
    await wait(ANSWER_SETTLE_MS);
    for (const s of [s1, s2, s3]) {
      expect(columnOf(s.id)).toBe(columnOf(eq.id));
      expect(verdictOf(s.id)).toBe("ok");
    }
    expect(marks().filter((m) => m === "circle")).toEqual([]);
    expect(liveStore.helpTarget.get()?.problems).toBe(1);
  });

  it("working that goes on under the tutor's steps is the same problem — and stays one when they are rubbed out", async () => {
    start("answer", { auto: false });
    const eq = await penLine("2x+3=11", "2x+3=11", 200);
    loop.noteAsked();
    loop.requestSolve();
    await wait(1000);
    expect(work()).toEqual(["2x = 8", "x = 4"]);
    const written = boundsOf(tutorInk());
    // the student writes their own answer under the tutor's working: well past a new problem's gap
    // below their own line, but the gap is the tutor's working, not blank
    const y = written.y + written.h + 0.5 * H;
    expect(y - (200 + H)).toBeGreaterThan(2.5 * H);
    const answer = await penLine("x=4", "x=4", y);
    expect(columnOf(answer.id)).toBe(columnOf(eq.id));
    expect(verdictOf(answer.id)).toBe("ok");
    expect(liveStore.helpTarget.get()?.problems).toBe(1);
    // the tutor's working rubbed out: a gap opens, but this was one problem
    editor.removeUser(tutorInk().map((s) => s.id));
    await inkElsewhere("8");
    expect(work()).toEqual([]);
    expect(columnOf(answer.id)).toBe(columnOf(eq.id));
    expect(verdictOf(answer.id)).toBe("ok");
  });

  it("a gap opened by rubbing out a step in the middle does not cut the problem in two", async () => {
    start("feedback");
    const eq = await penLine("2x+3=11", "2x+3=11", 200);
    const mid = await penLine("2x=8", "2x=8", under(200, 1));
    const last = await penLine("x=4", "x=4", under(under(200, 1), 1));
    expect(columnOf(last.id)).toBe(columnOf(eq.id));
    // three lines of blank between `2x + 3 = 11` and `x = 4` now
    editor.removeUser(mid.strokes.map((s) => s.id));
    await wait(LIVE_TIMING.quietMs + 300);
    expect(lineOf(mid.id)).toBeUndefined();
    // its readback and tick went with it; the student goes on writing, and the screen clustered
    // again sees the gap blank
    const check = await penLine("8+3=11", "8+3=11", under(under(under(200, 1), 1), 1));
    expect(lineOf(last.id).line.bounds.y - (200 + H)).toBeGreaterThan(2.5 * H);
    expect([last, check].map((s) => columnOf(s.id))).toEqual([columnOf(eq.id), columnOf(eq.id)]);
    expect([last, check].map((s) => lineOf(s.id).line.row)).toEqual([1, 2]);
    expect(liveStore.helpTarget.get()).toMatchObject({ problems: 1, key: `c:${eq.id}` });
  });

  it("the gap filled in by the student's own working afterwards makes them one problem again", async () => {
    start("feedback");
    const eq = await penLine("2x+3=11", "2x+3=11", 200);
    const far = await penLine("x=4", "x=4", under(200, 3));
    expect(columnOf(far.id)).not.toBe(columnOf(eq.id));
    const mid = await penLine("2x=8", "2x=8", under(200, 1));
    await quiesce();
    expect(columnOf(mid.id)).toBe(columnOf(eq.id));
    expect(columnOf(far.id)).toBe(columnOf(eq.id));
    expect(verdictOf(far.id)).toBe("ok");
    expect(liveStore.helpTarget.get()?.problems).toBe(1);
  });

  it("under one of the chat's problems its cell is the problem: a gap in the working there cuts nothing", async () => {
    const page = editor.getCurrentPage();
    editor.store.put([{ ...page, meta: { screen: { ...DEFAULT_SCREEN } } }]);
    start("feedback");
    let report: ChatRunReport | null = null;
    void loop.runChatActions([{ type: "write_problems", problems: [["2x + 3 = 11"]] }] satisfies ChatAction[]).then((r) => (report = r));
    for (let i = 0; i < 400 && !report; i++) await vi.advanceTimersByTimeAsync(50);
    expect(report).toMatchObject({ problemsWritten: 1 });
    const problem = editor.getCurrentPageShapes().filter((s) => problemMetaOf(s.meta));
    const head = boundsOf(problem);
    const y = head.y + head.h + 30;
    const first = await penLine("2x=8", "2x=8", y, head.x + 10);
    const far = await penLine("x=4", "x=4", under(y, 3), head.x + 10);
    expect(columnOf(far.id)).toBe(columnOf(first.id));
    expect(lineOf(far.id).line.row).toBe(1);
    expect(liveStore.helpTarget.get()).toMatchObject({ problems: 1 });
    expect(liveStore.helpTarget.get()?.key.startsWith("p:")).toBe(true);
  });

  // ------------------------------------------------------------------ a reload

  it("a reload checks nothing again and solves nothing: what was on the screen keeps its problems", async () => {
    start("feedback", { engine: withUnjudged() });
    const a = await penLine("2x+3=11", "2x+3=11", 200);
    const b = await penLine("4x=8", "4x=8", under(200, 2.75));
    const unjudged = await penLine("x=4", UNJUDGED, under(under(200, 2.75), 0.5));
    await wait(ANSWER_SETTLE_MS);
    expect(checks()).toHaveLength(1);
    const before = { calls: calls.length, shapes: editor.getCurrentPageShapes().length, marks: marks().sort() };

    start("feedback", { engine: withUnjudged() });
    await wait(ANSWER_SETTLE_MS + LIVE_TIMING.stuckMs);
    expect(columnOf(b.id)).not.toBe(columnOf(a.id));
    expect(columnOf(unjudged.id)).toBe(columnOf(b.id));
    expect(calls).toHaveLength(before.calls);
    expect(marks().sort()).toEqual(before.marks);
    expect(editor.getCurrentPageShapes()).toHaveLength(before.shapes);
    // the dial turned to Solve after the reload: nothing is solved unasked (the pen has not written)
    loop.setOptions({ ...loop.getOptions(), mode: "answer" });
    await wait(LIVE_TIMING.stuckMs);
    expect(work()).toEqual([]);
  });
});
