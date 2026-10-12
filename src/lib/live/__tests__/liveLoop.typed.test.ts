import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Box, type Editor, type TLDrawShape, type TLShape, type TLShapeId } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine as inkLine } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  isLiveMeta,
  LIVE_TIMING,
  type HelpMode,
  type LineAnalysis,
  type LiveEngine,
  type LiveLineState,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeRequest,
  type RecognizeResponse,
} from "../contracts";
import { getEngine } from "../engine";
import { handLinesOf } from "../handwriting";
import { createLiveLoop, type LiveEditorLike, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import { problemMetaOf } from "../chat/cells";
import type { ChatAction, ChatRunReport } from "../chat/contracts";
import { layoutMath } from "@/lib/hand";
import { TYPED_COUNT_META, TYPED_ID_META, TYPED_LATEX_META, TYPED_TEXT_META, type WriteTypedArgs, type WriteTypedResult } from "@/lib/typeMath/contracts";

/**
 * Type it (docs/TYPE-MATH.md): on a laptop the kid types a line and Enter writes it on the board as
 * their own ink, in the tutor's hand, and the tutor reads it as exactly what they typed — no
 * recognizer, no misread. Then everything after a read works on it as on any line.
 *
 * The real engine and the real hand engine; the recognizer is scripted and counted.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
}, 120_000);

/** A line the engine cannot judge: only a model can say whether it follows (`liveLoop.auto.test.ts`). */
const UNJUDGED = "x^{2}+y=\\sin y";
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

describe("live loop — Type it: a typed line is the kid's ink, read as typed", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let calls: string[];
  /** what the recognizer reads, whatever the ink */
  let read: string;

  function start(mode: HelpMode = "feedback", opts: { auto?: boolean; engine?: LiveEngine } = {}): void {
    loop?.stop();
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true, auto: opts.auto ?? true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
          calls.push(path);
        },
        getEngine: async () => opts.engine ?? engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        reread: async () => {
          throw new Error("no second reader here");
        },
      },
    );
    loop.start();
  }

  const lines = (): LiveLineState[] => Object.values(liveStore.lines.get()).sort((a, b) => a.line.bounds.y - b.line.bounds.y);
  const lineOf = (id: string): LiveLineState | undefined => liveStore.lines.get()[id];
  const meta = (s: TLShape) => s.meta as Record<string, unknown>;
  /** the kid's typed strokes on the page (no `live` meta, a `typedId`) */
  const typedInk = (): TLDrawShape[] => editor.shapesOfType("draw").filter((s) => !isLiveMeta(s.meta) && typeof meta(s)[TYPED_ID_META] === "string") as TLDrawShape[];
  const echoes = () => editor.shapesOfType("math").filter((s) => isLiveMeta(s.meta) && s.meta.source === "echo");
  const tutorWork = () => handLinesOf(editor.getCurrentPageShapes().filter((s) => s.type === "draw" && isLiveMeta(s.meta) && !meta(s).mark));
  const quiet = async () => {
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + LIVE_TIMING.rewriteQuietMs + 1);
    await settle();
  };

  /** Types `latex` and presses Enter; resolves once the tutor has read and analysed the line. */
  async function type(latex: string, args: Partial<WriteTypedArgs> = {}): Promise<WriteTypedResult> {
    // the writer is the bar's code: the bar loads it before Enter does anything
    await loop.prepareTyped();
    const res = loop.writeTyped({ text: latex, latex, ...args });
    if (res.ok) await settleUntil(() => Boolean(lineOf(res.lineId)?.analysis));
    await settleStable(() => `${editor.getCurrentPageShapes().length}|${calls.length}`);
    return res;
  }
  function ok(res: WriteTypedResult): Extract<WriteTypedResult, { ok: true }> {
    if (!res.ok) throw new Error(`refused: ${res.reason}`);
    return res;
  }

  /** A line written with the pen at (x, y), read as `read`. */
  async function penLine(ink: string, x: number, y: number, latex: string): Promise<string> {
    read = latex;
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(inkLine(ink, x, y, 40));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.analysis)));
    return Object.keys(liveStore.lines.get()).find((id) => !before.has(id))!;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    const page = editor.getCurrentPage();
    editor.store.put([{ ...page, meta: { screen: { ...DEFAULT_SCREEN } } }]);
    calls = [];
    read = "\\Delta";
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      void (body as RecognizeRequest);
      return { latex: read, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
    });
  });

  afterEach(() => {
    loop?.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("forms one line, read as typed, with no recognize call", async () => {
    start();
    const res = ok(await type("2x+3=11"));
    const all = lines();
    expect(all).toHaveLength(1);
    const [line] = all;
    expect(line.line.id).toBe(res.lineId);
    expect(line).toMatchObject({ latex: "2x+3=11", provider: "typed", confidence: 1, edited: true });
    expect(fetchJson).not.toHaveBeenCalled();
    // N draw shapes, one per stroke, all the kid's ink: no `live` meta, the line's id on each
    const ink = typedInk();
    expect(ink.length).toBeGreaterThan(3);
    expect(new Set(line.line.strokeIds)).toEqual(new Set(ink.map((s) => s.id)));
    expect(new Set(ink.map((s) => meta(s)[TYPED_ID_META])).size).toBe(1);
    const leads = ink.filter((s) => meta(s)[TYPED_COUNT_META] !== undefined);
    expect(leads).toHaveLength(1);
    expect(meta(leads[0])).toMatchObject({ [TYPED_LATEX_META]: "2x+3=11", [TYPED_TEXT_META]: "2x+3=11", [TYPED_COUNT_META]: ink.length });
    expect(ink.every((s) => s.props.isPen && s.props.dash === "draw" && s.props.isComplete)).toBe(true);
    expect(res.bounds).toEqual(line.line.bounds);
    // the readback is kept (status, reload), and says what was typed
    expect(echoes()).toHaveLength(1);
    expect((echoes()[0].props as MathShapeProps).latex).toBe("2x+3=11");
    expect(echoes()[0].meta.edited).toBe(true);
  });

  it("a long fraction bar or a radical's overline is never a drawing: one line each, read as typed", async () => {
    start();
    const frac = ok(await type("\\frac{123456789+987654321}{2}"));
    const root = ok(await type("\\sqrt{123456789+987654321}"));
    expect(liveStore.diagrams.get()).toEqual([]);
    expect(lines().map((l) => l.latex)).toEqual(["\\frac{123456789+987654321}{2}", "\\sqrt{123456789+987654321}"]);
    expect(lines().map((l) => l.line.id)).toEqual([frac.lineId, root.lineId]);
    expect(lines().reduce((n, l) => n + l.line.strokeIds.length, 0)).toBe(typedInk().length);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("two typed lines stack in the same column, the second under the first, clear of it", async () => {
    start();
    const first = ok(await type("2x+3=11"));
    const second = ok(await type("2x=8"));
    const a = lineOf(first.lineId)!;
    const b = lineOf(second.lineId)!;
    expect(b.line.column).toBe(a.line.column);
    expect(b.line.row).toBe(a.line.row + 1);
    expect(Math.abs(b.line.bounds.x - a.line.bounds.x)).toBeLessThan(1);
    expect(b.line.bounds.y).toBeGreaterThan(a.line.bounds.y + a.line.bounds.h);
    // a step under the step above: judged against it
    expect(b.analysis?.verdict).toBe("ok");
  });

  it("New problem starts a problem of its own", async () => {
    start();
    const first = ok(await type("2x+3=11"));
    const next = ok(await type("3x=12", { newProblem: true }));
    const a = lineOf(first.lineId)!;
    const b = lineOf(next.lineId)!;
    expect(b.line.column).not.toBe(a.line.column);
    expect(b.line.bounds.y).toBeGreaterThan(a.line.bounds.y + 2.5 * a.line.bounds.h);
  });

  it("a typed line under the chat's problem lands in that problem, and is judged against it", async () => {
    start("feedback");
    let report: ChatRunReport | null = null;
    const actions: ChatAction[] = [{ type: "write_problems", problems: [["2x + 3 = 11"]] }];
    void loop.runChatActions(actions).then((r) => (report = r));
    for (let i = 0; i < 400 && !report; i++) await vi.advanceTimersByTimeAsync(50);
    expect(report).not.toBeNull();
    const problem = editor.getCurrentPageShapes().find((s) => isLiveMeta(s.meta) && problemMetaOf(s.meta))!;
    const cell = problemMetaOf(problem.meta)!.cell;
    const heads = editor.getCurrentPageShapes().filter((s) => isLiveMeta(s.meta) && problemMetaOf(s.meta)).map((s) => editor.getShapePageBounds(s)!);
    const headBottom = Math.max(...heads.map((h) => h.maxY));

    const res = ok(await type("2x=8"));
    const b = lineOf(res.lineId)!.line.bounds;
    expect(b.x + b.w / 2).toBeGreaterThan(cell.x);
    expect(b.x + b.w / 2).toBeLessThan(cell.x + cell.w);
    expect(b.y).toBeGreaterThan(headBottom);
    expect(b.y + b.h).toBeLessThan(cell.y + cell.h);
    expect(lineOf(res.lineId)!.analysis?.verdict).toBe("ok");
  });

  it("a stroke of it rubbed out: the rest is ink like any other, read by the recognizer", async () => {
    start();
    ok(await type("2x=8"));
    const ink = typedInk();
    const lead = ink.find((s) => meta(s)[TYPED_COUNT_META] !== undefined)!;
    const other = ink.find((s) => s.id !== lead.id)!;
    read = "2x=0";
    editor.removeUser([other.id]);
    await quiet();
    await settleUntil(() => lines().some((l) => l.provider === "mathpix"));
    expect(fetchJson).toHaveBeenCalled();
    expect(lines().every((l) => l.provider === "mathpix")).toBe(true);
  });

  it("is ONE undo step, and Undo takes the line away", async () => {
    start();
    const stops: unknown[] = [];
    (editor as LiveEditorLike).markHistoryStoppingPoint = (name?: string) => stops.push(name);
    const created = vi.spyOn(editor, "createShapes");
    const res = ok(await type("2x+3=11"));
    expect(stops).toHaveLength(1);
    // one write of the kid's (the loop's own readback and marks come later, as live writes)
    const typedWrites = created.mock.calls.filter(([shapes]) => shapes.some((s) => s.meta && typeof (s.meta as Record<string, unknown>)[TYPED_ID_META] === "string"));
    expect(typedWrites).toHaveLength(1);
    expect(typedWrites[0][0]).toHaveLength(typedInk().length);

    // Undo: the strokes go (as the kid's own change)
    editor.removeUser(typedInk().map((s) => s.id));
    await quiet();
    expect(lineOf(res.lineId)).toBeUndefined();
    expect(lines()).toHaveLength(0);
    expect(echoes()).toHaveLength(0);
  });

  it("a reload keeps it typed: from its readback, or from its strokes alone — never recognized", async () => {
    start();
    const res = ok(await type("2x+3=11"));
    // reload: a new loop on the same page
    loop.stop();
    resetLiveStore();
    start();
    await settle(4);
    expect(lineOf(res.lineId)).toMatchObject({ latex: "2x+3=11", provider: "typed" });

    // the readback lost: the strokes still say what the line is
    loop.stop();
    resetLiveStore();
    editor.deleteShapes(echoes().map((s) => s.id));
    start();
    await settle(4);
    expect(lines()).toHaveLength(0);
    // the next flush (new ink elsewhere) forms it, and reads it as typed
    await penLine("4x=8", 1000, 600, "4x=8");
    await settleUntil(() => lines().some((l) => l.latex === "2x+3=11"));
    expect(lines().find((l) => l.latex === "2x+3=11")).toMatchObject({ provider: "typed" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("a typed line rewritten: its ink is replaced where it stands, in one step, read as the new line", async () => {
    start();
    const stops: unknown[] = [];
    (editor as LiveEditorLike).markHistoryStoppingPoint = (name?: string) => stops.push(name);
    const first = ok(await type("2x=8"));
    const was = lineOf(first.lineId)!.line.bounds;
    const before = new Set(typedInk().map((s) => s.id));
    const id = meta(typedInk()[0])[TYPED_ID_META];

    const res = ok(await type("2x=10", { replaceLineId: first.lineId }));
    expect(stops).toHaveLength(2);
    expect(typedInk().some((s) => before.has(s.id))).toBe(false);
    expect(new Set(typedInk().map((s) => meta(s)[TYPED_ID_META]))).toEqual(new Set([id]));
    expect(lines()).toHaveLength(1);
    const now = lineOf(res.lineId)!;
    expect(now).toMatchObject({ latex: "2x=10", provider: "typed" });
    expect(Math.abs(now.line.bounds.x - was.x)).toBeLessThan(1);
    // same writing line: digits sit on it, so the bottoms agree
    expect(Math.abs(now.line.bounds.y + now.line.bounds.h - (was.y + was.h))).toBeLessThan(3);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("a pen line rewritten by typing keeps its ink and takes the typed reading", async () => {
    start();
    const lineId = await penLine("2x=8", 100, 200, "2x=0");
    const strokes = [...lineOf(lineId)!.line.strokeIds];
    const shapesBefore = editor.getCurrentPageShapes().filter((s) => s.type === "draw" && !isLiveMeta(s.meta)).length;
    const res = ok(await type("2x=8", { replaceLineId: lineId }));
    await settleUntil(() => lineOf(lineId)?.latex === "2x=8");
    expect(res.lineId).toBe(lineId);
    expect(lineOf(lineId)).toMatchObject({ latex: "2x=8", provider: "typed", edited: true });
    expect(lineOf(lineId)!.line.strokeIds).toEqual(strokes);
    expect(editor.getCurrentPageShapes().filter((s) => s.type === "draw" && !isLiveMeta(s.meta))).toHaveLength(shapesBefore);
    expect(typedInk()).toHaveLength(0);
  });

  it("Auto acts on a typed line at once: Enter is the pause (no 2.5 s wait)", async () => {
    start("answer");
    ok(await type("2x+3=11"));
    // no time passes, only the read and what it starts
    await settleUntil(() => tutorWork().some((l) => /x\s*=\s*4/.test(l)));
    expect(tutorWork().some((l) => /x\s*=\s*4/.test(l))).toBe(true);
  });

  it("Auto's model check of a line the engine cannot judge runs at once on a typed line", async () => {
    start("feedback", { engine: withUnjudged() });
    ok(await type("2x+3=11"));
    ok(await type(UNJUDGED));
    await settleUntil(() => calls.some((p) => p.endsWith("/check")));
    expect(calls.filter((p) => p.endsWith("/check"))).toHaveLength(1);
  });

  it("the pen is unchanged: a line written with the pen still waits for the pause", async () => {
    start("answer");
    await penLine("2x+3=11", 100, 200, "2x+3=11");
    await settle(8);
    expect(tutorWork()).toEqual([]);
  });

  it("before the bar has loaded the writer: refused as off, no spot, no lines — then it all works", async () => {
    start();
    expect(loop.writeTyped({ text: "2x=8", latex: "2x=8" })).toEqual({ ok: false, reason: "off" });
    expect(loop.typedSpot()).toBeNull();
    expect(loop.typedLines()).toEqual([]);
    expect(editor.getCurrentPageShapes()).toHaveLength(0);
    // loaded once, however often it is asked for
    const first = loop.prepareTyped();
    expect(loop.prepareTyped()).toBe(first);
    await first;
    expect(loop.typedSpot()).not.toBeNull();
    const res = ok(await type("2x=8"));
    expect(loop.typedLines().map((l) => l.lineId)).toEqual([res.lineId]);
  });

  it("refuses what it cannot write, with nothing written", async () => {
    start();
    await loop.prepareTyped();
    const sentence = "\\text{this is a whole sentence of words that the hand never writes}";
    expect(layoutMath(sentence).unsupported.length).toBeGreaterThan(0);
    expect(loop.writeTyped({ text: "x", latex: sentence })).toEqual({ ok: false, reason: "unwritable" });
    expect(loop.writeTyped({ text: "", latex: "  " })).toEqual({ ok: false, reason: "empty" });
    expect(loop.writeTyped({ text: "x=1", latex: "x=1", replaceLineId: "ln_gone" })).toEqual({ ok: false, reason: "noLine" });
    loop.setOptions({ boardId: "board-1", mode: "feedback", enabled: false });
    expect(loop.writeTyped({ text: "x=1", latex: "x=1" })).toEqual({ ok: false, reason: "off" });
    expect(editor.getCurrentPageShapes()).toHaveLength(0);
  });

  it("is written in the kid's pen colour", async () => {
    (editor as LiveEditorLike).getStyleForNextShape = (() => "red") as unknown as Editor["getStyleForNextShape"];
    start();
    ok(await type("2x=8"));
    expect(typedInk().length).toBeGreaterThan(0);
    expect(typedInk().every((s) => s.props.color === "red")).toBe(true);
  });

  it("typedSpot is where Enter writes", async () => {
    start();
    ok(await type("2x+3=11"));
    const spot = loop.typedSpot()!;
    const res = ok(await type("2x=8"));
    const b = lineOf(res.lineId)!.line.bounds;
    expect(Math.abs(b.x - spot.x)).toBeLessThan(1);
    // the digits sit on the writing line
    expect(Math.abs(b.y + b.h - spot.baselineY)).toBeLessThan(spot.size * 0.25);
    expect(spot.size).toBeGreaterThan(20);
  });

  it("typedLines gives the current problem's lines, top to bottom, typed or not", async () => {
    start();
    const a = ok(await type("2x+3=11", { text: "2x+3=11" }));
    const b = ok(await type("2x=8", { text: "2x = 8" }));
    const below = lineOf(b.lineId)!.line.bounds;
    const pen = await penLine("4", below.x, below.y + below.h + 30, "x=4");
    const refs = loop.typedLines();
    expect(refs.map((r) => r.lineId)).toEqual([a.lineId, b.lineId, pen]);
    expect(refs.map((r) => [r.typed, r.typedText, r.latex])).toEqual([
      [true, "2x+3=11", "2x+3=11"],
      [true, "2x = 8", "2x=8"],
      [false, "", "x=4"],
    ]);
  });

  it("keeps the new line in view, out from under the typing bar", async () => {
    editor = createFakeEditor(editor.store, new Box(0, 0, 1600, 360));
    const setCamera = vi.fn();
    Object.assign(editor, { getCamera: () => ({ x: 0, y: 0, z: 1 }), setCamera, getZoomLevel: () => 1 });
    start();
    ok(await type("2x+3=11"));
    ok(await type("2x=8"));
    ok(await type("x=4"));
    expect(setCamera).toHaveBeenCalled();
    const [to] = setCamera.mock.calls.at(-1)!;
    expect(to.y).toBeLessThan(0);
  });

  it("ink sent whole without a reading (the phone pen, later) is one line of its own, read by the recognizer", async () => {
    start();
    const ink = inkLine("2x=8", 100, 200, 40);
    const group = ink.map((s, i) => ({ ...s, meta: i === 0 ? { [TYPED_ID_META]: "ph_1", [TYPED_COUNT_META]: ink.length } : { [TYPED_ID_META]: "ph_1" } })) as TLShape[];
    read = "2x=8";
    editor.putUser(group);
    await quiet();
    await settleUntil(() => lines().some((l) => l.latex));
    expect(lines()).toHaveLength(1);
    expect(new Set(lines()[0].line.strokeIds)).toEqual(new Set(group.map((s) => s.id as TLShapeId)));
    expect(lines()[0].provider).toBe("mathpix");
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});
