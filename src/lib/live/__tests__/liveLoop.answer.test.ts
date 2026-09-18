import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Box, type TLDrawShape, type TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine, translateShapes } from "../__fixtures__/strokes";
import { settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { isLiveMeta, type LiveEngine, type LiveSseEvent, type MathShapeProps, type RecognizeResponse, type Rect } from "../contracts";
import { TUTOR_INK_COLOR, composeAnswer } from "../answer";
import { getEngine } from "../engine";
import { handBlockOf, handSeedFor, inlineHandSizeFor, planHandwriting } from "../handwriting";
import { inlineAnswerGap } from "../placement";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * The answer at the end of the student's own line.
 *
 * The owner wrote `36 + 2 =` and the tutor typeset `36 + 2 = = 38` beside it in grey. Two
 * things were wrong and both are asserted here: a line that already ends in a relation never
 * gets a second one, and a finished sum is answered — in the tutor's hand, in the tutor's
 * colour, continuing the student's line — instead of being read back to them.
 *
 * Everything below runs against the REAL local engine and the REAL hand engine, and nothing
 * here may reach a model: `36 + 2` is arithmetic, not a question for anyone.
 */

/** Loading mathjs is real async work, so it happens once, before the fake clock starts. */
let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("live loop — the tutor answers the line instead of restating it", () => {
  // Deterministic, synchronous stroke hashing: see the fixture for why.
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let handwriting: boolean;
  let streamCalls: string[];
  let latex: string;

  function makeLoop(): LiveLoop {
    const stream = async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
      streamCalls.push(path);
    };
    return createLiveLoop(
      editor,
      { boardId: "board-1", mode: "answer", enabled: true, voiceActive: false },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream,
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => handwriting,
        reducedMotion: () => true, // the reveal animation is handwriting.test.ts's subject
      },
    );
  }

  /** The tutor's ink: one live-meta draw shape per stroke. */
  function handShapes(): TLDrawShape[] {
    return editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta)) as TLDrawShape[];
  }

  /** How many separate written blocks are on the page (a whole line of writing is one). */
  function handBlocks(): number {
    return new Set(handShapes().map((s) => handBlockOf(s.meta))).size;
  }

  /** The strokes on the canvas, as a geometry fingerprint independent of where they landed. */
  function handWriting(): string {
    return handShapes()
      .map((s) => s.props.segments[0].points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "))
      .sort()
      .join("|");
  }

  /** The same fingerprint for the answer this line SHOULD be finished with, in its own hand. */
  function expectedAnswerWriting(answer: string): string {
    const st = Object.values(liveStore.lines.get())[0];
    const plan = planHandwriting([answer], {
      size: inlineHandSizeFor(st.line.bounds.h),
      seed: handSeedFor(`${st.line.id}:answer`),
    }).plan;
    if (!plan) throw new Error(`the hand engine cannot draw ${answer}`);
    return plan.lines
      .flatMap((l) => l.strokes.map((s) => s.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")))
      .sort()
      .join("|");
  }

  function unionOf(shapes: TLShape[]): Rect {
    const boxes = shapes.map((s) => editor.getShapePageBounds(s)).filter((b): b is Box => Boolean(b));
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function studentInk(): Rect {
    return Object.values(liveStore.lines.get())[0].line.bounds;
  }

  function echoes(): MathShapeProps[] {
    return editor.shapesOfType("math").map((s) => s.props as MathShapeProps);
  }

  /** Writes one line of ink that the scripted recognizer reads back as `latex`, then settles. */
  async function writeLine(shapes: TLDrawShape[] = fixtureSingleLine()): Promise<void> {
    const before = fetchJson.mock.calls.length;
    editor.putUser(shapes);
    await vi.advanceTimersByTimeAsync(2000);
    await settleUntil(() => fetchJson.mock.calls.length > before);
    await settleUntil(() => Object.values(liveStore.lines.get()).some((s) => s.latex === latex));
    await rest();
  }

  /**
   * Lets every timer the line armed run out (the idle re-render among them) and waits for the
   * page to stop changing — the answer is written from a detached path, so there is no single
   * condition to wait on, and a fixed tick count raced under full-suite load.
   */
  async function rest(): Promise<void> {
    await vi.advanceTimersByTimeAsync(20_000);
    await settleStable(() =>
      [editor.shapesOfType("math").length, editor.shapesOfType("draw").length, streamCalls.length].join("|"),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    handwriting = true;
    streamCalls = [];
    latex = "36+2=";
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => ({
      latex,
      text: "",
      kind: "math",
      confidence: 0.97,
      provider: "mathpix",
      ms: 300,
    }));
    loop = makeLoop();
    loop.start();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  // ------------------------------------------------------------ the calculator case

  it("writes `38` by hand after `36 + 2 =`, and does not restate the line", async () => {
    await writeLine();

    expect(handBlocks()).toBe(1);
    expect(handWriting()).toBe(expectedAnswerWriting("38"));
    // no typeset echo at all: for a finished sum the answer IS the confirmation
    expect(echoes()).toEqual([]);
    // deterministic arithmetic never goes near a model
    expect(streamCalls).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(1); // the one recognition, nothing else
  });

  it("writes it in the tutor's colour, not the student's black", async () => {
    await writeLine();

    const ink = handShapes();
    expect(ink.length).toBeGreaterThan(0);
    for (const s of ink) expect(s.props.color).toBe(TUTOR_INK_COLOR);
    for (const s of editor.shapesOfType("draw").filter((d) => !isLiveMeta(d.meta))) {
      expect((s as TLDrawShape).props.color).toBe("black");
    }
  });

  it("puts it after their `=`, on their writing line — a continuation, not a new line", async () => {
    await writeLine();

    const line = studentInk();
    const answer = unionOf(handShapes());
    const gap = answer.x - (line.x + line.w);
    // clear of their last glyph, and no further off than a written gap should be
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(inlineAnswerGap(line.h) + 2);
    // the same baseline: digits sit on the line's bottom edge, they do not hang below it
    expect(Math.abs(answer.y + answer.h - (line.y + line.h))).toBeLessThanOrEqual(2);
    // and beside the work, not under it
    expect(answer.y).toBeGreaterThanOrEqual(line.y - line.h);
    // and in the student's own hand size, not a footnote next to their writing
    expect(answer.h).toBeGreaterThan(line.h * 0.8);
  });

  // ------------------------------------------------------------ every other line is untouched

  it("leaves `36 + 2` — no `=`, so no question — with today's silent echo", async () => {
    latex = "36+2";
    await writeLine();

    expect(handShapes()).toEqual([]);
    expect(echoes()).toMatchObject([{ latex: "36+2", resultLatex: "", source: "echo" }]);
    expect(streamCalls).toEqual([]);
  });

  it("leaves an equation with today's echo: `did I read you right` is still wanted", async () => {
    latex = "2x+3=11";
    await writeLine();

    expect(handShapes()).toEqual([]);
    expect(echoes()).toMatchObject([{ latex: "2x+3=11", source: "echo" }]);
    expect(streamCalls).toEqual([]);
  });

  // ------------------------------------------------------------ re-running and erasing

  it("replaces the answer when the line is rewritten, rather than stacking a second one", async () => {
    await writeLine();
    expect(handWriting()).toBe(expectedAnswerWriting("38"));

    // the student changes their ink; the recognizer now reads a different sum
    latex = "36+3=";
    const first = editor.shapesOfType("draw").find((s) => !isLiveMeta(s.meta))!;
    editor.updateUser(first.id, (s) => ({ ...s, x: s.x + 3 }));
    await vi.advanceTimersByTimeAsync(2000);
    await settleUntil(() => Object.values(liveStore.lines.get()).some((s) => s.latex === latex));
    await rest();

    expect(handBlocks()).toBe(1);
    expect(handWriting()).toBe(expectedAnswerWriting("39"));
    expect(echoes()).toEqual([]);
    expect(streamCalls).toEqual([]);
  });

  it("takes the answer away with the line the student erases", async () => {
    await writeLine();
    expect(handShapes().length).toBeGreaterThan(0);

    editor.removeUser(editor.shapesOfType("draw").filter((s) => !isLiveMeta(s.meta)).map((s) => s.id));
    await vi.advanceTimersByTimeAsync(2000);
    await settleUntil(() => Object.keys(liveStore.lines.get()).length === 0);
    await rest();

    expect(handShapes()).toEqual([]);
    expect(editor.shapesOfType("math")).toEqual([]);
  });

  // ------------------------------------------------------------ falling back to the echo

  it("falls back to the typeset echo, composed with ONE `=`, when the hand is switched off", async () => {
    handwriting = false;
    await writeLine();

    expect(handShapes()).toEqual([]);
    const [echo] = echoes();
    expect(echo).toMatchObject({ latex: "36+2=", resultLatex: "38" });
    // the reported bug: the shape renders latex + result, and that join must not double the `=`
    expect(composeAnswer(echo.latex, echo.resultLatex)).toBe("36+2= 38");
    expect(composeAnswer(echo.latex, echo.resultLatex).match(/=/g)).toHaveLength(1);
    expect(streamCalls).toEqual([]);
  });

  it("falls back to the typeset echo when there is no room beside the line", async () => {
    // the line runs to the right edge of the viewport: the answer cannot continue it there
    await writeLine(translateShapes(fixtureSingleLine(), 1330, 0));

    expect(handShapes()).toEqual([]);
    const [echo] = echoes();
    expect(echo).toMatchObject({ latex: "36+2=", resultLatex: "38" });
    expect(composeAnswer(echo.latex, echo.resultLatex)).toBe("36+2= 38");
    expect(streamCalls).toEqual([]);
  });
});
