import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createShapeId, type Editor, type TLDrawShape, type TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine, fixtureTwoLines } from "../__fixtures__/strokes";
import {
  LIVE_TIMING,
  MATH_SHAPE_DEFAULTS,
  type CheckRequest,
  type GraphShapeProps,
  type HelpMode,
  type LineAnalysis,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeResponse,
} from "../contracts";
import { BADGE_TAP_EVENT, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { liveWrite } from "../liveWrite";
import { ECHO_WIDTH_RELAYOUT_PX, PLACEMENT, estimateEchoWidth } from "../placement";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { settle } from "@/lib/live/__fixtures__/settle";

/**
 * Regressions from the browser QA (QA-REPORT B1, B2, B4, B5, B6 and the chemistry note):
 * the loop is driven through a headless tldraw store with a scripted recognizer, engine
 * and check stream.
 */

const CHEM = "\\mathrm{Fe}+\\mathrm{O}_{2} \\rightarrow \\mathrm{Fe}_{2}\\mathrm{O}_{3}";
const CHEM_NO_BALANCE = "\\mathrm{X}+\\mathrm{Y} \\rightarrow \\mathrm{XY}_{2}";
const CHEM_BALANCED = "4\\mathrm{Fe}+3\\mathrm{O}_{2} \\rightarrow 2\\mathrm{Fe}_{2}\\mathrm{O}_{3}";
const BALANCED_LATEX = "4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\rightarrow 2\\,\\mathrm{Fe_{2}O_{3}}";

const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => {
    const base: LineAnalysis = { kind: "equation", math: latex, resultLatex: "", verdict: "unknown", note: "" };
    if (latex === "\\Delta") return { ...base, kind: "expression", verdict: "none" };
    if (latex.startsWith("\\text")) return { ...base, kind: "text", verdict: "none" };
    if (latex === "2x=8" || latex === "x=4") return { ...base, verdict: "ok" };
    if (latex === "x=5") return { ...base, verdict: "mismatch", note: "Check the division on the right side" };
    if (latex.startsWith("y=")) return { ...base, kind: "function", verdict: "none", plot: { expr: latex.slice(2), latex } };
    if (latex === CHEM) {
      return { ...base, kind: "chem", verdict: "mismatch", note: "Count the atoms on each side", chem: { balanced: false, balancedLatex: BALANCED_LATEX } };
    }
    if (latex === CHEM_NO_BALANCE) {
      return { ...base, kind: "chem", verdict: "mismatch", note: "Count the atoms on each side", chem: { balanced: false, balancedLatex: "" } };
    }
    if (latex === CHEM_BALANCED) {
      return { ...base, kind: "chem", verdict: "ok", note: "Balanced", chem: { balanced: true, balancedLatex: BALANCED_LATEX } };
    }
    return base;
  },
  compileExpr: () => () => 0,
  solveLatex: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

function annotation(lineId: string, message: string, question = "What do you get when you divide 8 by 2?"): LiveSseEvent {
  return {
    event: "annotation",
    data: { lineId, verdict: "warn", kind: "arithmetic", message, question, confidence: 0.9 },
  };
}

describe("live loop — QA regressions", () => {
  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let events: EventTarget;
  /** latex the scripted recognizer returns for the next recognitions (FIFO; last one repeats) */
  let latexQueue: string[];
  let lastLatex: string;
  let checkRequests: CheckRequest[];
  /** events the scripted check stream yields per call (FIFO; empty stream when exhausted) */
  let streamQueue: LiveSseEvent[][];

  function makeLoop(mode: HelpMode = "feedback", voiceActive = false): LiveLoop {
    const stream = async function* (path: string, body: unknown): AsyncGenerator<LiveSseEvent, void, undefined> {
      if (path.endsWith("/check")) checkRequests.push(body as CheckRequest);
      const evs = streamQueue.shift() ?? [];
      for (const ev of evs) yield ev;
    };
    return createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true, voiceActive },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream,
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events,
        isOnline: () => true,
      },
    );
  }

  /** Writes one handwritten line and waits for its echo; returns the line id. */
  async function write(shapes: TLDrawShape[], latex: string): Promise<string> {
    latexQueue.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(shapes);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs + 1);
    await settle(8);
    const added = Object.keys(liveStore.lines.get()).find((id) => !before.has(id));
    if (!added) throw new Error("line was not created");
    return added;
  }

  function echoOf(lineId: string): TLShape {
    const id = liveStore.lines.get()[lineId]?.mathShapeId;
    if (!id) throw new Error(`line ${lineId} has no echo`);
    const shape = editor.getShape(id);
    if (!shape) throw new Error(`echo ${id} is not in the store`);
    return shape;
  }

  function graphOf(lineId: string): TLShape | undefined {
    const id = liveStore.lines.get()[lineId]?.graphShapeId;
    return id ? editor.getShape(id) : undefined;
  }

  function remount(mode: HelpMode): void {
    loop.stop();
    resetLiveStore();
    loop = makeLoop(mode);
    loop.start();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    events = new EventTarget();
    latexQueue = [];
    lastLatex = "2x+3=11";
    checkRequests = [];
    streamQueue = [];
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => {
      lastLatex = latexQueue.shift() ?? lastLatex;
      return { latex: lastLatex, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
    });
    loop = makeLoop();
    loop.start();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  // ------------------------------------------------------------------ B1
  describe("B1 — lastBurst reflects student ink only", () => {
    it("live-created shapes and student edits/deletes of live shapes never mark a burst", async () => {
      liveWrite(editor as unknown as Editor, () => {
        editor.createShapes([
          {
            id: createShapeId(),
            type: "math",
            x: 10,
            y: 10,
            props: { ...MATH_SHAPE_DEFAULTS, latex: "x=1", source: "ai" },
            meta: { live: true, source: "ai", lineId: "", createdAt: 1 },
          },
        ]);
      });
      await settle();
      expect(liveStore.lastBurst.get()).toBeNull();

      const lineId = await write(fixtureSingleLine(), "x=4");
      const burst = liveStore.lastBurst.get();
      expect(burst?.state).toBe("handled");

      // Student retypes the echo (user-sourced update of a live shape).
      const echo = echoOf(lineId);
      editor.updateUser(echo.id, (s) => ({ ...s, props: { ...s.props, latex: "x=5" } }) as TLShape);
      await settle(6);
      await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs * 2);
      await settle(4);
      expect(liveStore.lines.get()[lineId].latex).toBe("x=5");
      expect(liveStore.lastBurst.get()).toBe(burst);

      // Student moves and then deletes the echo.
      editor.updateUser(echo.id, (s) => ({ ...s, x: s.x + 50 }));
      editor.removeUser([echo.id]);
      await settle(6);
      await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs * 2);
      await settle(4);
      expect(liveStore.lastBurst.get()).toBe(burst);
      expect(fetchJson).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------------------------------ B2 / B8
  describe("B2/B8 — non-math ink stays silent and hands the burst to the legacy pipeline", () => {
    it("a lone \\Delta (a drawn triangle) gets no echo and the burst ends 'unhandled'", async () => {
      latexQueue.push("\\Delta");
      editor.putUser(fixtureSingleLine());
      expect(liveStore.lastBurst.get()?.state).toBe("pending");
      await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
      await settle(8);
      expect(fetchJson).toHaveBeenCalledTimes(1);
      expect(editor.shapesOfType("math")).toHaveLength(0);
      expect(liveStore.lastBurst.get()?.state).toBe("unhandled");
      expect(checkRequests).toHaveLength(0);
    });

    it("a prose line (kind 'text') gets no echo and the burst ends 'unhandled'", async () => {
      latexQueue.push("\\text { hello there }");
      editor.putUser(fixtureSingleLine());
      await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
      await settle(8);
      expect(editor.shapesOfType("math")).toHaveLength(0);
      expect(liveStore.lastBurst.get()?.state).toBe("unhandled");
    });

    it("a real equation in the same burst keeps it 'handled'", async () => {
      await write(fixtureSingleLine(), "2x=8");
      expect(editor.shapesOfType("math")).toHaveLength(1);
      expect(liveStore.lastBurst.get()?.state).toBe("handled");
    });
  });

  // ------------------------------------------------------------------ B4
  describe("B4 — raising the dial and tapping the badge start checks", () => {
    it("switching Feedback -> Suggest checks every amber line (once per column, focus = lowest amber)", async () => {
      const [top, bottom] = [fixtureTwoLines().slice(0, 6), fixtureTwoLines().slice(6)];
      const okLine = await write(top, "2x=8");
      const warnLine = await write(bottom, "x=5");
      expect((echoOf(okLine).props as MathShapeProps).status).toBe("ok");
      expect((echoOf(warnLine).props as MathShapeProps).status).toBe("warn");
      // Feedback never asks the model about a local mismatch by itself.
      expect(checkRequests).toHaveLength(0);

      loop.setOptions({ boardId: "board-1", mode: "suggest", enabled: true, voiceActive: false });
      await settle(4);
      expect(checkRequests).toHaveLength(1);
      expect(checkRequests[0]).toMatchObject({ mode: "suggest", focusLineId: warnLine, userAsked: false });
      expect(checkRequests[0].lines.map((l) => l.id)).toEqual([okLine, warnLine]);

      // Suggest -> Solve is not a rise onto the hint rungs: no second check.
      loop.setOptions({ boardId: "board-1", mode: "answer", enabled: true, voiceActive: false });
      await settle(4);
      expect(checkRequests).toHaveLength(1);
    });

    it("does not start a ladder-rise check while a hint card is open, while voice is active, or for ok lines", async () => {
      const lineId = await write(fixtureSingleLine(), "x=5");
      liveStore.openHints.set([{ id: "h1", lineId: "other", message: "m", question: "q", level: 0, createdAt: 0 }]);
      loop.setOptions({ boardId: "board-1", mode: "suggest", enabled: true, voiceActive: false });
      await settle(4);
      expect(checkRequests).toHaveLength(0);
      liveStore.openHints.set([]);

      loop.setOptions({ boardId: "board-1", mode: "feedback", enabled: true, voiceActive: false });
      loop.setOptions({ boardId: "board-1", mode: "suggest", enabled: true, voiceActive: true });
      await settle(4);
      expect(checkRequests).toHaveLength(0);

      loop.setOptions({ boardId: "board-1", mode: "feedback", enabled: true, voiceActive: false });
      loop.retypeLine(lineId, "x=4");
      await settle(6);
      loop.setOptions({ boardId: "board-1", mode: "suggest", enabled: true, voiceActive: false });
      await settle(4);
      expect(checkRequests).toHaveLength(0);
    });

    it("a badge tap requests a location-only check in Feedback; the same tap escalates after a hint in Suggest", async () => {
      const lineId = await write(fixtureSingleLine(), "x=5");
      const echo = echoOf(lineId);

      events.dispatchEvent(new CustomEvent(BADGE_TAP_EVENT, { detail: { lineId, shapeId: echo.id } }));
      await settle(4);
      expect(checkRequests).toHaveLength(1);
      expect(checkRequests[0]).toMatchObject({ mode: "feedback", focusLineId: lineId, userAsked: true });
      expect(liveStore.openHints.get()).toHaveLength(0);

      // Suggest: the tap runs a check whose annotation opens the hint card.
      loop.setOptions({ boardId: "board-1", mode: "suggest", enabled: true, voiceActive: false });
      await settle(4);
      // The ladder rise itself fired one (empty) check.
      expect(checkRequests).toHaveLength(2);
      streamQueue.push([annotation(lineId, "Look again at the right side of line 1")]);
      events.dispatchEvent(new CustomEvent(BADGE_TAP_EVENT, { detail: { lineId, shapeId: echo.id } }));
      await settle(6);
      expect(checkRequests).toHaveLength(3);
      expect(checkRequests[2]).toMatchObject({ mode: "suggest", userAsked: true });
      expect(liveStore.openHints.get()).toHaveLength(1);
      expect(liveStore.openHints.get()[0]).toMatchObject({ lineId, level: 0 });
      expect(liveStore.lines.get()[lineId].hintsShown).toBe(1);

      // Second tap with a hint already shown: escalate (a new, level-1 hint for THIS line).
      streamQueue.push([annotation(lineId, "Divide both sides by the same number")]);
      events.dispatchEvent(new CustomEvent(BADGE_TAP_EVENT, { detail: { lineId, shapeId: echo.id } }));
      await settle(6);
      expect(checkRequests).toHaveLength(4);
      expect(checkRequests[3]).toMatchObject({ mode: "suggest", userAsked: true });
      const hints = liveStore.openHints.get();
      expect(hints).toHaveLength(1);
      expect(hints[0]).toMatchObject({ lineId, level: 1, message: "Divide both sides by the same number" });
    });

    it("resolves the line from shapeId alone, ignores taps in Off, and stops listening after stop()", async () => {
      const lineId = await write(fixtureSingleLine(), "x=5");
      const echo = echoOf(lineId);
      events.dispatchEvent(new CustomEvent(BADGE_TAP_EVENT, { detail: { shapeId: echo.id } }));
      await settle(4);
      expect(checkRequests).toHaveLength(1);
      expect(checkRequests[0].focusLineId).toBe(lineId);

      loop.setOptions({ boardId: "board-1", mode: "off", enabled: true, voiceActive: false });
      events.dispatchEvent(new CustomEvent(BADGE_TAP_EVENT, { detail: { lineId, shapeId: echo.id } }));
      await settle(4);
      expect(checkRequests).toHaveLength(1);

      loop.setOptions({ boardId: "board-1", mode: "feedback", enabled: true, voiceActive: false });
      loop.stop();
      events.dispatchEvent(new CustomEvent(BADGE_TAP_EVENT, { detail: { lineId, shapeId: echo.id } }));
      await settle(4);
      expect(checkRequests).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------ B5
  describe("B5 — graph placement follows the measured echo and stays closed once dismissed", () => {
    it("places the graph right of the estimated echo, then re-places it when KaTeX measures wider", async () => {
      const lineId = await write(fixtureSingleLine(), "y=x^{2}-4");
      const echo = echoOf(lineId);
      const graph = graphOf(lineId);
      expect(graph).toBeDefined();
      const estimate = estimateEchoWidth("y=x^{2}-4", "m");
      expect((echo.props as MathShapeProps).w).toBe(estimate);
      expect(estimate).toBeGreaterThanOrEqual(129);
      expect(graph!.x).toBe(echo.x + estimate + PLACEMENT.graphGap);

      // The shape util's ResizeObserver writes the measured size (source 'remote').
      const measured = estimate + 40;
      liveWrite(editor as unknown as Editor, () => {
        editor.updateShapes([{ id: echo.id, type: "math", props: { w: measured } }]);
      });
      await settle(6);
      expect(graphOf(lineId)!.x).toBe(echo.x + measured + PLACEMENT.graphGap);

      // Sub-threshold jitter does not move the card.
      liveWrite(editor as unknown as Editor, () => {
        editor.updateShapes([{ id: echo.id, type: "math", props: { w: measured + ECHO_WIDTH_RELAYOUT_PX - 1 } }]);
      });
      await settle(6);
      expect(graphOf(lineId)!.x).toBe(echo.x + measured + PLACEMENT.graphGap);
      expect(fetchJson).toHaveBeenCalledTimes(1);
    });

    it("pushes an AI step shape that the wider echo now covers out of the way", async () => {
      const lineId = await write(fixtureSingleLine(), "2x=8");
      const echo = echoOf(lineId);
      const stepId = createShapeId();
      // An AI shape parked just right of the estimated echo.
      liveWrite(editor as unknown as Editor, () => {
        editor.createShapes([
          {
            id: stepId,
            type: "math",
            x: echo.x + (echo.props as MathShapeProps).w + 4,
            y: echo.y,
            props: { ...MATH_SHAPE_DEFAULTS, latex: "x=4", source: "ai", lineId, w: 80, h: 44 },
            meta: { live: true, source: "ai", lineId, createdAt: 1 },
          },
        ]);
      });
      await settle(4);
      const before = editor.getShape(stepId)!;
      liveWrite(editor as unknown as Editor, () => {
        editor.updateShapes([{ id: echo.id, type: "math", props: { w: (echo.props as MathShapeProps).w + 60 } }]);
      });
      await settle(6);
      const after = editor.getShape(stepId)!;
      expect(after.x !== before.x || after.y !== before.y).toBe(true);
      const echoNow = editor.getShape(echo.id)!;
      const echoRight = echoNow.x + (echoNow.props as MathShapeProps).w;
      expect(after.x >= echoRight || after.y >= echoNow.y + (echoNow.props as MathShapeProps).h).toBe(true);
    });

    it("a graph the student deleted is not re-created on later renders until the plot changes", async () => {
      const lineId = await write(fixtureSingleLine(), "y=x^{2}-4");
      const graph = graphOf(lineId)!;
      editor.removeUser([graph.id]);
      await settle(4);
      expect(liveStore.lines.get()[lineId].graphShapeId).toBeNull();
      expect(editor.getShape(echoOf(lineId).id)!.meta).toMatchObject({ graphDismissed: "x^{2}-4" });

      // A mode switch re-renders every line: the card must stay closed.
      loop.setOptions({ boardId: "board-1", mode: "suggest", enabled: true, voiceActive: false });
      await settle(6);
      expect(editor.shapesOfType("graph")).toHaveLength(0);

      // A cascade from a retype of the same expression keeps it closed too.
      loop.retypeLine(lineId, "y=x^{2}-4");
      await settle(6);
      expect(editor.shapesOfType("graph")).toHaveLength(0);

      // A different plot brings a fresh card.
      loop.retypeLine(lineId, "y=x^{3}");
      await settle(6);
      const graphs = editor.shapesOfType("graph");
      expect(graphs).toHaveLength(1);
      expect((graphs[0].props as GraphShapeProps).fns[0].expr).toBe("x^{3}");
      expect(editor.getShape(echoOf(lineId).id)!.meta).toMatchObject({ graphDismissed: "" });
    });

    it("a graph closed from its header (remote delete) stays closed, also across a remount", async () => {
      const lineId = await write(fixtureSingleLine(), "y=x^{2}-4");
      const graph = graphOf(lineId)!;
      liveWrite(editor as unknown as Editor, () => editor.deleteShapes([graph.id]));
      await settle(6);
      expect(liveStore.lines.get()[lineId].graphShapeId).toBeNull();
      loop.setOptions({ boardId: "board-1", mode: "answer", enabled: true, voiceActive: false });
      await settle(6);
      expect(editor.shapesOfType("graph")).toHaveLength(0);

      remount("feedback");
      await settle(8);
      const lines = Object.values(liveStore.lines.get());
      expect(lines).toHaveLength(1);
      expect(lines[0].latex).toBe("y=x^{2}-4");
      expect(editor.shapesOfType("graph")).toHaveLength(0);
      expect(fetchJson).toHaveBeenCalledTimes(1);
    });

    it("the loop's own graph deletes (plot gone) are not treated as a dismissal", async () => {
      const lineId = await write(fixtureSingleLine(), "y=x^{2}-4");
      expect(editor.shapesOfType("graph")).toHaveLength(1);
      loop.retypeLine(lineId, "2x=8");
      await settle(6);
      expect(editor.shapesOfType("graph")).toHaveLength(0);
      loop.retypeLine(lineId, "y=x^{2}-4");
      await settle(6);
      expect(editor.shapesOfType("graph")).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------ B6
  describe("B6 — mounting in Off keeps persisted badges", () => {
    it("does not rewrite ok/warn statuses to none on a reload into Off; new lines in Off get none", async () => {
      const okLine = await write(fixtureTwoLines().slice(0, 6), "x=4");
      const okEchoId = echoOf(okLine).id;
      expect((echoOf(okLine).props as MathShapeProps).status).toBe("ok");

      remount("off");
      await settle(8);
      await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs * 2);
      await settle(4);
      expect(Object.keys(liveStore.lines.get())).toHaveLength(1);
      expect((editor.getShape(okEchoId)!.props as MathShapeProps).status).toBe("ok");
      expect(fetchJson).toHaveBeenCalledTimes(1);

      const newLine = await write(fixtureTwoLines().slice(6), "x=5");
      expect((echoOf(newLine).props as MathShapeProps).status).toBe("none");
      expect((editor.getShape(okEchoId)!.props as MathShapeProps).status).toBe("ok");

      // Picking a mode re-badges everything from the engine.
      loop.setOptions({ boardId: "board-1", mode: "feedback", enabled: true, voiceActive: false });
      await settle(6);
      expect((echoOf(newLine).props as MathShapeProps).status).toBe("warn");
      expect((editor.getShape(okEchoId)!.props as MathShapeProps).status).toBe("ok");
    });

    it("still re-badges on a reload into a help mode", async () => {
      const lineId = await write(fixtureSingleLine(), "x=5");
      const echoId = echoOf(lineId).id;
      liveWrite(editor as unknown as Editor, () => {
        editor.updateShapes([{ id: echoId, type: "math", props: { status: "none" } }]);
      });
      await settle(4);
      remount("suggest");
      await settle(8);
      expect((editor.getShape(echoId)!.props as MathShapeProps).status).toBe("warn");
    });
  });

  // ------------------------------------------------------------------ chemistry note
  describe("chemistry note by mode", () => {
    it("shows the atom-count nudge with an amber dot below Solve and the balanced equation in Solve", async () => {
      const lineId = await write(fixtureSingleLine(), CHEM);
      let props = echoOf(lineId).props as MathShapeProps;
      expect(props.status).toBe("warn");
      expect(props.note).toBe("Count the atoms on each side");

      loop.setOptions({ boardId: "board-1", mode: "suggest", enabled: true, voiceActive: false });
      await settle(6);
      props = echoOf(lineId).props as MathShapeProps;
      expect(props.note).toBe("Count the atoms on each side");

      loop.setOptions({ boardId: "board-1", mode: "answer", enabled: true, voiceActive: false });
      await settle(6);
      props = echoOf(lineId).props as MathShapeProps;
      expect(props.status).toBe("warn");
      expect(props.note).toBe(`Balanced: ${BALANCED_LATEX}`);
    });

    it("falls back to the plain note in Solve when the balancer has no result, and labels balanced equations", async () => {
      loop.setOptions({ boardId: "board-1", mode: "answer", enabled: true, voiceActive: false });
      const unbalanced = await write(fixtureTwoLines().slice(0, 6), CHEM_NO_BALANCE);
      const props = echoOf(unbalanced).props as MathShapeProps;
      expect(props.status).toBe("warn");
      expect(props.note).toBe("Count the atoms on each side");
      expect(props.note.startsWith("Balanced")).toBe(false);

      const balanced = await write(fixtureTwoLines().slice(6), CHEM_BALANCED);
      const okProps = echoOf(balanced).props as MathShapeProps;
      expect(okProps.status).toBe("ok");
      expect(okProps.note).toBe("Balanced");
    });
  });
});
