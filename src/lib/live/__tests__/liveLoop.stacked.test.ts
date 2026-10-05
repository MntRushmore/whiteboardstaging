import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape, TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { handRow, handRule, toInkStrokes, writeStack, type StackShapes } from "../__fixtures__/strokes";
import { settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { LIVE_TIMING, isLiveMeta, type HelpMode, type LiveEngine, type LiveSseEvent, type MathShapeProps, type RecognizeRequest, type RecognizeResponse } from "../contracts";
import { splitInk } from "../diagrams";
import { getEngine } from "../engine";
import { HAND_LINE_META, HAND_PART_META } from "../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { stackGrid, type StackGrid } from "../stackedSums";

/**
 * Column (stacked) arithmetic on the board (the owner, 2026-10-04: a student's right
 * `286 + 680 = 966` in columns, a carry over the 2 — and the tutor wrote `= 0.7039` under it, 680 ÷
 * 966: the rule had been read as a fraction bar, and the engine wrote the fraction's decimal).
 *
 * Now the block is one line, read once, worked column by column: a tick or a ring round the first
 * wrong digit (in every mode, with Auto), Help's next column with its carry, Solve's missing digits
 * in the student's columns — the engine's alone, never a model's. Out of scope stays quiet.
 *
 * The real engine and the real hand engine; Mathpix is scripted by how many strokes it is sent.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

/** Mathpix's read of a stacked sum (what it returned for the tutor's hand writing these). */
function array(rows: string[], answer: string): string {
  return `\\begin{array}{r}\n${rows.join(" \\\\\n")} \\\\\n\\hline${answer ? ` ${answer}` : ""}\n\\end{array}`;
}

const OWNER_ROWS = ["286", "+680"];

describe("live loop — stacked sums", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  /** the model's calls: there must be none */
  let calls: string[];
  /** what Mathpix reads for a line of this many strokes (and how sure it is) */
  let reads: Map<number, { latex: string; confidence?: number }>;

  function start(mode: HelpMode, opts: { auto?: boolean } = {}): void {
    loop?.stop();
    resetLiveStore();
    const stream = async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
      calls.push(path);
    };
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true, auto: opts.auto ?? true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream,
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        setup: async () => {
          calls.push("setup");
          throw new Error("no word problems here");
        },
        reread: async () => {
          calls.push("reread");
          throw new Error("no second reader here");
        },
        notify: () => undefined,
      },
    );
    loop.start();
  }

  const quiesce = () => settleStable(() => [editor.getCurrentPageShapes().length, calls.length, liveStore.solving.get(), fetchJson.mock.calls.length].join("|"));

  /** The student writes this ink and lifts the pen; it is read. */
  async function pen(shapes: TLDrawShape[]): Promise<void> {
    editor.putUser(shapes);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.values(liveStore.lines.get()).every((s) => s.latex !== "" || s.provider !== "none"));
    await quiesce();
  }

  /** Time passes with no ink. */
  async function wait(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await quiesce();
  }

  /** The stacked sum as the student writes it, and what Mathpix reads it as. */
  function sum(rows: string[], answer: string | null, opts: Parameters<typeof writeStack>[2] & { read?: string; confidence?: number } = {}): StackShapes {
    const ink = writeStack(rows, answer, opts);
    const n = ink.rows.flat().length + 1 + ink.answer.length;
    reads.set(n, { latex: opts.read ?? array(rows, answer ?? ""), confidence: opts.confidence });
    return ink;
  }

  const metaOf = (s: TLShape) => s.meta as Record<string, unknown>;
  const tutorInk = () => editor.getCurrentPageShapes().filter((s) => s.type === "draw" && isLiveMeta(s.meta) && s.meta.source === "ai");
  /** the tutor's marks, by kind */
  const marks = () => tutorInk().filter((s) => metaOf(s).mark).map((s) => String(metaOf(s).mark).split(":")[0]);
  /** the digits the tutor wrote into the sum: `a0=6` (the answer's ones), `c2=1` (a carry over the hundreds), `f2=9` (under a wrong digit) */
  const digits = () => [...new Set(tutorInk().filter((s) => metaOf(s)[HAND_PART_META]).map((s) => `${String(metaOf(s)[HAND_PART_META])}=${String(metaOf(s)[HAND_LINE_META])}`))].sort();
  /** everything the tutor wrote that is not a mark */
  const written = () => [...new Set(tutorInk().filter((s) => !metaOf(s).mark).map((s) => String(metaOf(s)[HAND_LINE_META])))];
  const echoNote = () => (editor.shapesOfType("math").find((s) => isLiveMeta(s.meta) && s.meta.source === "echo")?.props as MathShapeProps | undefined)?.note ?? "";
  const stackLine = () => Object.values(liveStore.lines.get()).find((s) => s.latex.startsWith("\\begin{array}"))!;

  /** The ink box of the tutor's strokes for one part (`a2`): where that digit was written. */
  function partBox(part: string): { x: number; y: number; w: number; h: number } {
    const boxes = tutorInk()
      .filter((s) => metaOf(s)[HAND_PART_META] === part)
      .map((s) => editor.getShapePageBounds(s)!);
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
  }

  /** The columns of the sum this ink is (as the loop finds them). */
  function gridOf(ink: StackShapes, rows: Array<{ digits: number; last: number }>): StackGrid {
    const split = splitInk(toInkStrokes(ink.all));
    return stackGrid(split.stacks[0], rows);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    editor = createFakeEditor();
    calls = [];
    reads = new Map();
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const { strokes } = body as RecognizeRequest;
      const read = reads.get(strokes.x.length) ?? { latex: "\\Delta" };
      return { latex: read.latex, text: "", kind: "math", confidence: read.confidence ?? 1, provider: "mathpix", ms: 300 };
    });
    liveStore.inkBalance.set(null);
  });

  afterEach(() => {
    loop.stop();
    liveStore.inkBalance.set(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("the owner's sum: 286 + 680 = 966, a carry over the 2", () => {
    it("is one line, read once; in Solve with Auto on it gets a tick and nothing else — no `= 0.7039`, no model", async () => {
      start("answer");
      await pen(sum(OWNER_ROWS, "966", { carries: [{ place: 2, digit: "1" }] }).all);
      await wait(ANSWER_SETTLE_MS + LIVE_TIMING.stuckMs);
      expect(fetchJson).toHaveBeenCalledTimes(1);
      expect(Object.keys(liveStore.lines.get())).toHaveLength(1);
      expect(stackLine().analysis).toMatchObject({ verdict: "ok", solved: true });
      expect(marks()).toEqual(["check"]);
      expect(written()).toEqual([]);
      expect(calls).toEqual([]);
    });

    it("read as a fraction (the old read of it), it is still no fraction: nothing is written, asked or not", async () => {
      start("answer");
      const ink = sum(OWNER_ROWS, "966", { read: "\\frac{+680}{966}" });
      await pen(ink.all);
      await wait(ANSWER_SETTLE_MS + LIVE_TIMING.stuckMs);
      loop.noteAsked();
      loop.requestSolve();
      loop.requestHelp();
      await wait(1000);
      expect(written()).toEqual([]);
      expect(marks()).toEqual([]);
      expect(calls).toEqual([]);
    });

    it("should the layout ever be missed, a read of `+ 680` over `966` as a fraction is still never answered", async () => {
      // one number over the rule is no stacked sum (`stackedSums.ts` needs two): the clusterer's fraction, read as the owner's was
      start("answer");
      const plus = handRow("+680", 400, 244);
      const plusInk = toInkStrokes(plus);
      const bottom = Math.max(...plusInk.map((s) => s.bounds.y + s.bounds.h));
      const left = Math.min(...plusInk.map((s) => s.bounds.x));
      const shapes = [...plus, handRule(left - 6, 406, bottom + 8), ...handRow("966", 400, bottom + 18, 40, 12)];
      reads.set(shapes.length, { latex: "\\frac{+680}{966}" });
      await pen(shapes);
      expect(Object.values(liveStore.lines.get()).map((s) => s.latex)).toEqual(["\\frac{+680}{966}"]);
      await wait(ANSWER_SETTLE_MS + LIVE_TIMING.stuckMs);
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(written()).toEqual([]);
      expect(calls).toEqual([]);
    });

    it("in Feedback, a tick; with Auto off, nothing until Help me — then the tick, and no model check", async () => {
      start("feedback", { auto: false });
      await pen(sum(OWNER_ROWS, "966", { carries: [{ place: 2, digit: "1" }] }).all);
      await wait(ANSWER_SETTLE_MS);
      expect(marks()).toEqual([]);
      loop.noteAsked();
      loop.requestHelp();
      await wait(1000);
      expect(marks()).toEqual(["check"]);
      expect(calls).toEqual([]);
    });

    it("the tick sits after the answer row, level with it", async () => {
      start("feedback");
      const ink = sum(OWNER_ROWS, "966");
      await pen(ink.all);
      await wait(1500);
      const tick = tutorInk().find((s) => metaOf(s).mark)!;
      const box = editor.getShapePageBounds(tick)!;
      const answer = toInkStrokes(ink.answer);
      const top = Math.min(...answer.map((s) => s.bounds.y));
      const bottom = Math.max(...answer.map((s) => s.bounds.y + s.bounds.h));
      expect(box.x).toBeGreaterThan(Math.max(...answer.map((s) => s.bounds.x + s.bounds.w)));
      expect(box.y + box.h / 2).toBeGreaterThan(top);
      expect(box.y + box.h / 2).toBeLessThan(bottom);
    });
  });

  describe("a wrong answer: ringed in its column, with a short note", () => {
    it("286 + 680 = 866 (the carry forgotten): the ring round the 8, the note on the readback; no model", async () => {
      start("feedback");
      const ink = sum(OWNER_ROWS, "866");
      await pen(ink.all);
      await wait(1500);
      expect(marks()).toEqual(["circle"]);
      expect(echoNote()).toBe("Add the 1 you carried to the hundreds.");
      const ring = editor.getShapePageBounds(tutorInk().find((s) => metaOf(s).mark)!)!;
      const grid = gridOf(ink, [{ digits: 3, last: 0 }, { digits: 3, last: 0 }]);
      // round the hundreds digit, not the whole sum
      expect(Math.abs(ring.x + ring.w / 2 - grid.x(2))).toBeLessThan(grid.pitch * 0.4);
      expect(ring.w).toBeLessThan(grid.pitch * 2.5);
      expect(calls).toEqual([]);
    });

    it("in Suggest, once the student stops: the right digit under the wrong one", async () => {
      start("suggest");
      const ink = sum(OWNER_ROWS, "866");
      await pen(ink.all);
      await wait(ANSWER_SETTLE_MS + 1000);
      expect(marks()).toEqual(["circle"]);
      expect(digits()).toEqual(["f2=9"]);
      const grid = gridOf(ink, [{ digits: 3, last: 0 }, { digits: 3, last: 0 }]);
      const nine = partBox("f2");
      expect(Math.abs(nine.x + nine.w / 2 - grid.x(2))).toBeLessThan(grid.pitch * 0.3);
      expect(nine.y).toBeGreaterThan(Math.max(...toInkStrokes(ink.answer).map((s) => s.bounds.y + s.bounds.h)));
      expect(calls).toEqual([]);
    });

    it("Solve asked: the right answer on a row under it, column for column", async () => {
      start("answer", { auto: false });
      await pen(sum(OWNER_ROWS, "856").all);
      loop.noteAsked();
      loop.requestSolve();
      await wait(2000);
      expect(digits()).toEqual(["f0=6", "f1=6", "f2=9"]);
      expect(calls).toEqual([]);
    });

    it("a read Mathpix was unsure of is not ringed, and nothing is written for it", async () => {
      start("suggest");
      await pen(sum(OWNER_ROWS, "866", { confidence: 0.7 }).all);
      await wait(ANSWER_SETTLE_MS + LIVE_TIMING.stuckMs);
      loop.noteAsked();
      loop.requestHelp();
      await wait(1000);
      expect(marks()).toEqual([]);
      expect(written()).toEqual([]);
      expect(calls).toEqual([]);
    });
  });

  describe("a partial answer, filled in from the right", () => {
    it("right so far: no ring and no tick; Help me writes the next column", async () => {
      start("feedback");
      await pen(sum(OWNER_ROWS, "66").all);
      await wait(ANSWER_SETTLE_MS);
      expect(marks()).toEqual([]);
      loop.noteAsked();
      loop.requestHelp();
      await wait(1000);
      expect(digits()).toEqual(["a2=9"]);
      expect(calls).toEqual([]);
    });

    it("a digit written under the hundreds first is the hundreds: not wrong", async () => {
      start("feedback");
      const ink = sum(OWNER_ROWS, null);
      const grid = gridOf(ink, [{ digits: 3, last: 0 }, { digits: 3, last: 0 }]);
      const nine = handRow("9", grid.x(2) + 7, grid.answerBaseline - 25, 40, 12);
      reads.set(ink.rows.flat().length + 1 + nine.length, { latex: array(OWNER_ROWS, "9") });
      await pen([...ink.all, ...nine]);
      await wait(ANSWER_SETTLE_MS);
      expect(stackLine().analysis?.verdict).toBe("none");
      expect(marks()).toEqual([]);
    });
  });

  describe("Help me / Suggest: the next column, and its carry", () => {
    it("one column at a time, right to left, each in its column; the carry over the next", async () => {
      start("suggest", { auto: false });
      const ink = sum(OWNER_ROWS, null);
      await pen(ink.all);
      const help = async () => {
        loop.noteAsked();
        loop.requestHelp();
        await wait(1500);
      };
      await help();
      expect(digits()).toEqual(["a0=6"]);
      await help();
      // 8 + 8 = 16: the 6, and the 1 carried over the hundreds
      expect(digits()).toEqual(["a0=6", "a1=6", "c2=1"]);
      await help();
      expect(digits()).toEqual(["a0=6", "a1=6", "a2=9", "c2=1"]);
      await help();
      expect(digits()).toEqual(["a0=6", "a1=6", "a2=9", "c2=1"]);
      const grid = gridOf(ink, [{ digits: 3, last: 0 }, { digits: 3, last: 0 }]);
      for (const p of [0, 1, 2]) {
        const box = partBox(`a${p}`);
        expect(Math.abs(box.x + box.w / 2 - grid.x(p))).toBeLessThan(grid.pitch * 0.3);
        expect(Math.abs(box.y + box.h - grid.answerBaseline)).toBeLessThan(grid.digit * 0.25);
      }
      const carry = partBox("c2");
      expect(Math.abs(carry.x + carry.w / 2 - grid.x(2))).toBeLessThan(grid.pitch * 0.4);
      expect(carry.y + carry.h).toBeLessThan(Math.min(...toInkStrokes(ink.rows[0]).map((s) => s.bounds.y)) + 2);
      expect(carry.h).toBeLessThan(grid.digit * 0.8);
      expect(calls).toEqual([]);
    });

    it("Auto in Suggest, stuck: the next column once", async () => {
      start("suggest");
      await pen(sum(OWNER_ROWS, null).all);
      await wait(LIVE_TIMING.stuckMs + 500);
      expect(digits()).toEqual(["a0=6"]);
      await wait(LIVE_TIMING.stuckMs * 2);
      expect(digits()).toEqual(["a0=6"]);
      expect(calls).toEqual([]);
    });
  });

  describe("Solve: the answer under the rule, in the student's columns", () => {
    it("asked: every digit, right to left, with the carry", async () => {
      start("answer", { auto: false });
      const ink = sum(OWNER_ROWS, null);
      await pen(ink.all);
      loop.noteAsked();
      loop.requestSolve();
      await wait(2000);
      expect(digits()).toEqual(["a0=6", "a1=6", "a2=9", "c2=1"]);
      const grid = gridOf(ink, [{ digits: 3, last: 0 }, { digits: 3, last: 0 }]);
      const rule = toInkStrokes([ink.rule])[0].bounds;
      for (const p of [0, 1, 2]) {
        const box = partBox(`a${p}`);
        expect(Math.abs(box.x + box.w / 2 - grid.x(p))).toBeLessThan(grid.pitch * 0.3);
        expect(box.y).toBeGreaterThan(rule.y);
      }
      // asked again: it is all written
      loop.noteAsked();
      loop.requestSolve();
      await wait(1000);
      expect(digits()).toEqual(["a0=6", "a1=6", "a2=9", "c2=1"]);
      expect(calls).toEqual([]);
    });

    it("Auto in Solve finishes it at the pause; a carry the student wrote is not written again", async () => {
      start("answer");
      await pen(sum(OWNER_ROWS, null, { carries: [{ place: 2, digit: "1" }] }).all);
      await wait(ANSWER_SETTLE_MS + 1000);
      expect(digits()).toEqual(["a0=6", "a1=6", "a2=9"]);
      expect(calls).toEqual([]);
    });

    it("taking away: 52 - 17, the digits and no carries", async () => {
      start("answer", { auto: false });
      await pen(sum(["52", "-17"], null).all);
      loop.noteAsked();
      loop.requestSolve();
      await wait(2000);
      expect(digits()).toEqual(["a0=5", "a1=3"]);
    });

    it("the partial answer finished: only the missing digits", async () => {
      start("answer", { auto: false });
      await pen(sum(OWNER_ROWS, "66").all);
      loop.noteAsked();
      loop.requestSolve();
      await wait(2000);
      expect(digits()).toEqual(["a2=9"]);
    });
  });

  describe("out of scope: quiet, never a wrong answer", () => {
    it("long multiplication's partial products: nothing marked, nothing written, no model", async () => {
      start("answer");
      const ink = writeStack(["23", "\\times 45"], "115");
      const answerBottom = Math.max(...toInkStrokes(ink.answer).map((s) => s.bounds.y + s.bounds.h));
      const second = handRow("920", 400, answerBottom + 10, 40, 30);
      const n = ink.all.length + second.length;
      reads.set(n, { latex: "\\begin{array}{r}\n23 \\\\\n\\times 45 \\\\\n\\hline 115 \\\\\n920\n\\end{array}" });
      await pen([...ink.all, ...second]);
      await wait(ANSWER_SETTLE_MS + LIVE_TIMING.stuckMs);
      loop.noteAsked();
      loop.requestSolve();
      loop.requestHelp();
      await wait(1000);
      expect(Object.keys(liveStore.lines.get())).toHaveLength(1);
      expect(marks()).toEqual([]);
      expect(written()).toEqual([]);
      expect(calls).toEqual([]);
    });
  });

  describe("fractions are still fractions", () => {
    it("\\frac{1+2}{3} is one line, read and worked as before", async () => {
      start("answer", { auto: false });
      const ink = handRow("\\frac{1+2}{3}", 400, 200);
      reads.set(ink.length, { latex: "\\frac{1+2}{3}" });
      await pen(ink);
      const lines = Object.values(liveStore.lines.get());
      expect(lines).toHaveLength(1);
      expect(lines[0].analysis).toMatchObject({ kind: "expression" });
      loop.noteAsked();
      loop.requestSolve(lines[0].line.id);
      await wait(2000);
      expect(written().length).toBeGreaterThan(0);
      expect(calls).toEqual([]);
    });
  });
});
