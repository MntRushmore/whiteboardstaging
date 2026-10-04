import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { LIVE_COPY } from "@/components/live/copy";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine as inkLine } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
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
} from "../contracts";
import { getEngine } from "../engine";
import { handLinesOf } from "../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * The Auto switch (the owner: "sometimes the AI doesn't fire for Feedback and Suggest… there has
 * to be a button to auto run the AIs").
 *
 * On — the default — the tutor acts by itself once the student pauses: the engine's ticks and
 * rings as always, a model check of a line the engine cannot judge, Suggest's next step when they
 * stay stuck, Solve finishing the problem. Each at most once per state of the problem, never with
 * no ink, quiet when it fails, stopped by new ink. Off, it acts only on Help me / Solve it: the
 * lines are read back, nothing more, until the student asks — then that problem is marked and
 * helped as it always was.
 *
 * The real engine and the real hand engine; the model is a scripted stream.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

/** A line the engine cannot judge (verdict unknown): only a model can say whether it follows. */
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

/** What a scripted model call does: its events, after an optional gate — or it throws (a dropped request). */
type Reply = { events?: LiveSseEvent[]; gate?: Promise<void>; throwErr?: unknown };

describe("live loop — Auto", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let calls: Array<{ path: string; body: unknown }>;
  let replies: { check: Reply[]; solve: Reply[] };
  /** latex the recognizer gives each line, in the order the lines are first read */
  let script: string[];
  let assigned: Map<string, string>;
  /** while set, reads wait for it */
  let readGate: Promise<void> | null;
  /** the quiet notes the board showed (`deps.notify`) */
  let notes: string[];

  function start(mode: HelpMode, opts: { auto?: boolean; engine?: LiveEngine } = {}): void {
    loop?.stop();
    resetLiveStore();
    const stream = async function* (path: string, body: unknown): AsyncGenerator<LiveSseEvent, void, undefined> {
      calls.push({ path, body });
      const reply = (path.endsWith("/solve") ? replies.solve : replies.check).shift() ?? {};
      if (reply.gate) await reply.gate;
      if (reply.throwErr) throw reply.throwErr;
      for (const ev of reply.events ?? []) yield ev;
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
        notify: (message) => notes.push(message),
      },
    );
    loop.start();
  }

  /** Distinct ink per row: identical strokes would hit the recognizer's content cache. */
  const ROW_INK = ["2x=8", "x=4", "3+4=", "8+1=", "4x=8", "1+2="];

  /** One line of ink at `row`, read as `latex`; the pen stays up just long enough for the read. */
  async function penLine(row: number, latex: string, x = 100): Promise<string> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(inkLine(ROW_INK[row], x, 200 + row * 120, 40));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.latex)));
    return Object.keys(liveStore.lines.get()).find((id) => !before.has(id))!;
  }

  const quiesce = () =>
    settleStable(() => [editor.getCurrentPageShapes().length, calls.length, liveStore.solving.get(), liveStore.lastError.get()?.id ?? ""].join("|"));

  /** Time passes with no ink. */
  async function wait(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await quiesce();
  }

  const checks = () => calls.filter((c) => c.path.endsWith("/check")).map((c) => c.body as CheckRequest);
  const solves = () => calls.filter((c) => c.path.endsWith("/solve"));
  const metaOf = (s: TLShape) => s.meta as Record<string, unknown>;
  /** the tutor's marks on the page, by kind (`check`, `circle`, `question`) */
  const marks = () =>
    editor
      .getCurrentPageShapes()
      .filter((s) => isLiveMeta(s.meta) && metaOf(s).mark)
      .map((s) => String(metaOf(s).mark).split(":")[0]);
  /** what the tutor wrote that is not a mark, as lines of maths */
  const work = () => handLinesOf(editor.getCurrentPageShapes().filter((s) => s.type === "draw" && isLiveMeta(s.meta) && !metaOf(s).mark));
  const echoes = () => editor.shapesOfType("math").filter((s) => isLiveMeta(s.meta) && s.meta.source === "echo");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    editor = createFakeEditor();
    calls = [];
    replies = { check: [], solve: [] };
    script = [];
    assigned = new Map();
    readGate = null;
    notes = [];
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const { lineId } = body as RecognizeRequest;
      let latex = assigned.get(lineId);
      if (latex === undefined) {
        latex = script[assigned.size] ?? "\\Delta";
        assigned.set(lineId, latex);
      }
      if (readGate) await readGate;
      return { latex, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
    });
    liveStore.inkBalance.set(null);
  });

  afterEach(() => {
    loop.stop();
    liveStore.inkBalance.set(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ------------------------------------------------------------------ Feedback: the model check

  describe("Feedback: a line the engine cannot judge", () => {
    it("is checked by the model once the student pauses — not before, and only once", async () => {
      start("feedback", { engine: withUnjudged() });
      await penLine(0, "2x+3=11");
      const unjudged = await penLine(1, UNJUDGED);
      // the pause runs from the last ink, which is quietMs + 300 ago
      await wait(ANSWER_SETTLE_MS - LIVE_TIMING.quietMs - 400);
      expect(checks()).toEqual([]);
      await wait(200);
      expect(checks()).toHaveLength(1);
      expect(checks()[0]).toMatchObject({ focusLineId: unjudged, userAsked: false, mode: "feedback" });
      // nothing changed: never again, however long they wait (and the stuck pause asks nothing in Feedback)
      await wait(LIVE_TIMING.stuckMs * 3);
      expect(calls).toHaveLength(1);
    });

    it("a line read after the pause is checked at once, with no second pause", async () => {
      start("feedback", { engine: withUnjudged() });
      await penLine(0, "2x+3=11");
      let release!: () => void;
      readGate = new Promise<void>((r) => (release = r));
      script.push(UNJUDGED);
      editor.putUser(inkLine(ROW_INK[1], 100, 320, 40));
      await wait(ANSWER_SETTLE_MS + 500);
      expect(checks()).toEqual([]);
      release();
      readGate = null;
      await settleUntil(() => checks().length > 0);
      await quiesce();
      expect(checks()).toHaveLength(1);
    });

    it("is checked once the dial moves to a help mode while the student is stopped (it never was in Off)", async () => {
      start("off", { engine: withUnjudged() });
      await penLine(0, "2x+3=11");
      await penLine(1, UNJUDGED);
      await wait(LIVE_TIMING.stuckMs);
      expect(calls).toEqual([]);

      loop.setOptions({ ...loop.getOptions(), mode: "feedback" });
      await quiesce();
      expect(checks()).toHaveLength(1);
      // and moving it again changes nothing: that state of the problem was checked
      loop.setOptions({ ...loop.getOptions(), mode: "suggest" });
      await wait(LIVE_TIMING.stuckMs * 2);
      expect(checks()).toHaveLength(1);
    });

    it("is checked again when the line above it changes", async () => {
      start("feedback", { engine: withUnjudged() });
      const first = await penLine(0, "2x+3=11");
      await penLine(1, UNJUDGED);
      await wait(ANSWER_SETTLE_MS);
      expect(checks()).toHaveLength(1);

      loop.retypeLine(first, "2x+5=11");
      await settleUntil(() => checks().length > 1);
      await quiesce();
      expect(checks()).toHaveLength(2);
      expect(checks()[1].lines.map((l) => l.latex)).toEqual(["2x+5=11", UNJUDGED]);
    });

    it("fails without a word (logged, no pill, no ink dialog); the student's own ask still shows its failure", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      start("feedback", { engine: withUnjudged() });
      await penLine(0, "2x+3=11");
      const unjudged = await penLine(1, UNJUDGED);
      replies.check.push({ events: [{ event: "error", data: { error: "ink_empty", message: "Out of ink" } }] });
      await wait(ANSWER_SETTLE_MS);
      expect(checks()).toHaveLength(1);
      expect(liveStore.lastError.get()).toBeNull();
      expect(warn.mock.calls.some((c) => String(c[0]).includes("auto check failed"))).toBe(true);

      replies.check.push({ events: [{ event: "error", data: { error: "upstream_error", message: "The tutor service had a hiccup" } }] });
      loop.noteAsked(unjudged);
      loop.requestCheck(unjudged);
      await quiesce();
      expect(liveStore.lastError.get()).toMatchObject({ kind: "check", lineId: unjudged });
    });

    it("a check the network dropped says nothing: no 'Offline' for a call the student never made", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      start("feedback", { engine: withUnjudged() });
      await penLine(0, "2x+3=11");
      await penLine(1, UNJUDGED);
      replies.check.push({ throwErr: new TypeError("Load failed") });
      await wait(ANSWER_SETTLE_MS);
      expect(checks()).toHaveLength(1);
      expect(liveStore.status.get()).not.toBe("offline");
      expect(liveStore.offlineQueued.get()).toBe(0);
      expect(liveStore.lastError.get()).toBeNull();
    });

    it("spends nothing with no ink left, or while an out-of-ink error is showing", async () => {
      liveStore.inkBalance.set(0);
      start("feedback", { engine: withUnjudged() });
      await penLine(0, "2x+3=11");
      await penLine(1, UNJUDGED);
      await wait(ANSWER_SETTLE_MS);
      expect(calls).toEqual([]);

      liveStore.inkBalance.set(40);
      liveStore.lastError.set({ id: "e1", kind: "solve", code: "ink", message: "out", at: 0 });
      await penLine(2, "2x=8", 700);
      await wait(ANSWER_SETTLE_MS);
      expect(calls).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ Auto off

  describe("Auto off", () => {
    it("reads every line back but marks, checks and answers nothing — until the student asks", async () => {
      start("feedback", { auto: false, engine: withUnjudged() });
      await penLine(3, UNJUDGED, 700);
      await penLine(0, "2x+3=11");
      await penLine(1, "2x=8");
      await penLine(2, "x=5");
      await wait(LIVE_TIMING.stuckMs * 2);
      expect(echoes()).toHaveLength(4);
      expect(echoes().every((s) => (s.props as { status: string }).status === "none")).toBe(true);
      expect(marks()).toEqual([]);
      expect(work()).toEqual([]);
      expect(calls).toEqual([]);

      // Help me on `x = 5`: its problem is marked, and helped as always (the right step beside the ring)
      loop.noteAsked();
      loop.setOptions({ ...loop.getOptions() }); // a re-render of the bar changes nothing
      const helped = loop.requestHelp();
      await wait(1000);
      expect(helped).toBe(true);
      expect(marks().sort()).toEqual(["check", "circle"]);
      expect(work()).toEqual(["x = 4"]);
      // the other column was not asked about
      expect(calls).toEqual([]);
    });

    it("keeps a mark already on the page that still fits, and writes no new one", async () => {
      start("feedback");
      await penLine(0, "2x+3=11");
      await penLine(1, "2x=8");
      await wait(ANSWER_SETTLE_MS);
      expect(marks()).toEqual(["check"]);

      loop.setOptions({ ...loop.getOptions(), auto: false });
      await penLine(2, "x=4");
      await wait(ANSWER_SETTLE_MS);
      expect(marks()).toEqual(["check"]);
    });

    it("turned back on, the lines get their marks and what is due at a pause happens", async () => {
      start("answer", { auto: false });
      await penLine(0, "2x+3=11");
      await penLine(1, "2x=8");
      await wait(ANSWER_SETTLE_MS);
      expect(marks()).toEqual([]);
      expect(work()).toEqual([]);

      loop.setOptions({ ...loop.getOptions(), auto: true });
      await wait(100);
      expect(marks()).toEqual(["check"]);
      expect(work()).toEqual(["x = 4"]);
    });
  });

  // ------------------------------------------------------------------ Suggest: stuck

  describe("Suggest: the next step when the student stays stuck", () => {
    it("writes it once the stuck pause passes — not at the ordinary pause — and only once", async () => {
      start("suggest");
      await penLine(0, "2x+3=11");
      await wait(LIVE_TIMING.stuckMs - LIVE_TIMING.quietMs - 400);
      expect(work()).toEqual([]);
      await wait(200);
      expect(work()).toEqual(["2x = 8"]);
      await wait(LIVE_TIMING.stuckMs * 3);
      expect(work()).toEqual(["2x = 8"]);
      expect(calls).toEqual([]);
    });

    it("new ink starts the stuck pause over, and the step is for the line they are on", async () => {
      start("suggest");
      await penLine(0, "2x+3=11");
      await wait(LIVE_TIMING.stuckMs - 2000);
      await penLine(1, "2x=8");
      await wait(LIVE_TIMING.stuckMs - LIVE_TIMING.quietMs - 400);
      expect(work()).toEqual([]);
      await wait(400);
      expect(work()).toEqual(["x = 4"]);
    });

    it("nothing for a half-written expression: no step, and no \"as simple as it gets\" nobody asked for", async () => {
      start("suggest");
      await penLine(0, "2x+3");
      await wait(LIVE_TIMING.stuckMs * 2);
      expect(notes).toEqual([]);
      expect(work()).toEqual([]);
      expect(calls).toEqual([]);
    });

    it("nothing for a solved problem, a lone number, or right after the student asked", async () => {
      start("suggest");
      await penLine(0, "x+5=9");
      await penLine(1, "x=4");
      await wait(LIVE_TIMING.stuckMs * 2);
      expect(work()).toEqual([]);

      await penLine(2, "7", 700);
      await wait(LIVE_TIMING.stuckMs * 2);
      expect(work()).toEqual([]);

      await penLine(3, "2x+3=11", 400);
      loop.noteAsked(); // they tapped Help me on something: Auto adds nothing of its own
      await wait(LIVE_TIMING.stuckMs * 2);
      expect(work()).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ Solve: finish the problem

  describe("Solve: the latest problem finished at the pause", () => {
    it("finishes it as Solve it would, once, and not again for the unchanged problem", async () => {
      start("answer");
      await penLine(0, "2x+3=11");
      await wait(ANSWER_SETTLE_MS - LIVE_TIMING.quietMs - 400);
      expect(work()).toEqual([]);
      await wait(200);
      expect(work()).toEqual(["2x = 8", "x = 4"]);
      expect(calls).toEqual([]);

      // the dial away and back while stopped: the same problem, nothing new
      loop.setOptions({ ...loop.getOptions(), mode: "feedback" });
      await quiesce();
      loop.setOptions({ ...loop.getOptions(), mode: "answer" });
      await wait(LIVE_TIMING.stuckMs);
      expect(work()).toEqual(["2x = 8", "x = 4"]);
    });

    it("never on a line with nothing to solve: a lone number, a symbol, a solved line", async () => {
      start("answer");
      await penLine(0, "7");
      await wait(ANSWER_SETTLE_MS);
      await penLine(1, "\\Delta", 700);
      await wait(ANSWER_SETTLE_MS);
      await penLine(2, "x+5=9", 400);
      await penLine(3, "x=4", 400);
      await wait(ANSWER_SETTLE_MS * 2);
      expect(work()).toEqual([]);
      expect(calls).toEqual([]);
    });

    it("a lone expression asks for nothing: no note, nothing written — unless it is a sum the engine works out", async () => {
      start("answer");
      // already as simple as it goes: "This is as simple as it gets" popped up although nobody asked
      await penLine(0, "x^{2}+3x+5");
      await wait(ANSWER_SETTLE_MS * 2);
      expect(notes).toEqual([]);
      expect(work()).toEqual([]);
      // letters that would simplify are no question either until there is a `=` to answer
      await penLine(1, "2x+3x", 700);
      await wait(ANSWER_SETTLE_MS * 2);
      expect(notes).toEqual([]);
      expect(work()).toEqual([]);
      expect(calls).toEqual([]);

      // Solve it on the simplest one: asked, so the note says what would make it a question
      loop.noteAsked();
      loop.requestSolve(Object.values(liveStore.lines.get()).find((s) => s.latex === "x^{2}+3x+5")!.line.id);
      await quiesce();
      expect(notes).toEqual([LIVE_COPY.solve.simplest]);

      // `2 \times 2` with nothing after it is still finished: arithmetic the engine evaluates
      await penLine(2, "2\\times2", 400);
      await wait(ANSWER_SETTLE_MS * 2);
      expect(work()).toEqual(["= 4"]);
      expect(notes).toEqual([LIVE_COPY.solve.simplest]);
    });

    it("the student writing again stops a model solve still on its way: nothing lands", async () => {
      start("answer");
      let release!: () => void;
      replies.solve.push({ gate: new Promise<void>((r) => (release = r)), events: [{ event: "step", data: { index: 1, latex: "2a = 8 - b", explanation: "", final: true } }] });
      // two unknowns: the engine has no answer, so Solve asks the model
      await penLine(0, "2a+b=8");
      await wait(ANSWER_SETTLE_MS);
      expect(solves()).toHaveLength(1);
      expect(liveStore.solving.get()).toBe(1);

      await penLine(1, "7", 700);
      release();
      await wait(1000);
      expect(liveStore.solving.get()).toBe(0);
      expect(work()).toEqual([]);
      expect(editor.shapesOfType("math").filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai")).toEqual([]);
      expect(liveStore.lastError.get()).toBeNull();
    });

    it("fails without a word; Solve it on the same problem shows its failure", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      start("answer");
      replies.solve.push({ events: [{ event: "error", data: { error: "upstream_error", message: "The tutor service had a hiccup" } }] });
      const line = await penLine(0, "2a+b=8");
      await wait(ANSWER_SETTLE_MS);
      expect(solves()).toHaveLength(1);
      expect(liveStore.lastError.get()).toBeNull();

      replies.solve.push({ events: [{ event: "error", data: { error: "upstream_error", message: "The tutor service had a hiccup" } }] });
      loop.noteAsked();
      loop.requestSolve();
      await quiesce();
      expect(solves()).toHaveLength(2);
      expect(liveStore.lastError.get()).toMatchObject({ kind: "solve", lineId: line });
    });

    it("a solve the network dropped is not put off for later: no 'Offline', and the next read that gets through replays nothing", async () => {
      // Safari's "Load failed" while the browser still says online. Before, the solve was queued as
      // the student's own (`pendingSolve`), the pill said "Offline", and the next read that got
      // through ran it with none of Auto's guards: mid-writing, unasked.
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      start("answer");
      replies.solve.push({ throwErr: new TypeError("Load failed") });
      await penLine(0, "2a+b=8");
      await wait(ANSWER_SETTLE_MS);
      expect(solves()).toHaveLength(1);
      expect(liveStore.status.get()).not.toBe("offline");
      expect(liveStore.lastError.get()).toBeNull();

      // the student writes on elsewhere, and that line's read succeeds
      await penLine(1, "y=3", 700);
      await quiesce();
      expect(solves()).toHaveLength(1);
      await wait(ANSWER_SETTLE_MS);
      expect(solves()).toHaveLength(1);
      expect(work()).toEqual([]);
    });

    it("spends nothing with no ink left", async () => {
      liveStore.inkBalance.set(0);
      start("answer");
      await penLine(0, "2a+b=8");
      await wait(ANSWER_SETTLE_MS * 2);
      expect(calls).toEqual([]);
      expect(work()).toEqual([]);
    });

    it("with Auto off, nothing until Solve it", async () => {
      start("answer", { auto: false });
      await penLine(0, "2x+3=11");
      await wait(ANSWER_SETTLE_MS * 2);
      expect(work()).toEqual([]);
      loop.noteAsked();
      loop.requestSolve();
      await wait(100);
      expect(work()).toEqual(["2x = 8", "x = 4"]);
    });
  });

  // ------------------------------------------------------------------ the readback

  describe("the readback: the sign the tutor read the line", () => {
    it("shows for readbackMs after each read, Auto on or off, also for a line with nothing to judge", async () => {
      for (const auto of [true, false]) {
        start("feedback", { auto });
        const line = await penLine(auto ? 0 : 1, "x+5=9", auto ? 100 : 700);
        expect(liveStore.readbacks.get()[line]).toBeTypeOf("number");
        // nothing was written for it: the echo is the readback
        expect(echoes()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(LIVE_TIMING.readbackMs);
        await settle();
        expect(liveStore.readbacks.get()[line]).toBeUndefined();
        editor.removeUser(editor.shapesOfType("draw").map((s) => s.id));
        await wait(ANSWER_SETTLE_MS);
      }
    });

    it("not in Off: there is no help to show it for", async () => {
      start("off");
      const line = await penLine(0, "x+5=9");
      expect(echoes()).toHaveLength(1);
      expect(liveStore.readbacks.get()[line]).toBeUndefined();
    });
  });
});
