import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError } from "@/lib/api-client";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine, writeLine } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  isLiveMeta,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeResponse,
  type SetupRequest,
  type SolveStep,
  type UseLiveMathOptions,
} from "../contracts";
import { getEngine } from "../engine";
import { handLinesOf } from "../handwriting";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { localSolve } from "../localSolve";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { setupBlock, validateSetupLines, wordProblemKey } from "../wordProblem";

/**
 * Word problems: "the model understands, the engine calculates". Solve on a problem written as
 * prose asks /api/live/setup for the equations only; the local engine solves them and the tutor
 * writes setup + steps as one handwritten block. Only when the setup fails, is invalid, or the
 * engine cannot solve it does the board fall back to /api/live/solve.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const TRAIN = "\\text{A train travels 150 km in 2.5 hours. What is its average speed?}";
const COINS = ["\\text{A jar has 25 coins, all nickels and dimes.}", "\\text{They are worth 185 cents. How many dimes are there?}"];

function step(index: number, latex: string, final = false): LiveSseEvent {
  return { event: "step", data: { index, latex, explanation: "", final } satisfies SolveStep };
}

describe("live loop — word problems: the model sets up, the engine solves", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let calls: string[];
  let script: LiveSseEvent[][];
  let reads: Array<Partial<RecognizeResponse>>;
  let setupReply: string[] | Error;
  let setupBodies: SetupRequest[];
  let online: boolean;
  let handwriting: boolean;

  function start(mode: UseLiveMathOptions["mode"] = "answer"): void {
    loop?.stop();
    resetLiveStore();
    const stream = async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
      calls.push(path);
      for (const ev of script.shift() ?? []) yield ev;
    };
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream,
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => online,
        handwritingEnabled: () => handwriting,
        reducedMotion: () => true,
        setup: async (req) => {
          setupBodies.push(req);
          if (setupReply instanceof Error) throw setupReply;
          return { lines: setupReply, model: "openai/gpt-5.4-mini", ms: 700 };
        },
        reread: async () => {
          throw new Error("no second reader in this file");
        },
      },
    );
    loop.start();
  }

  /** Writes one line of ink the scripted recognizer reads as the next of `reads`. */
  async function write(strokes = fixtureSingleLine()): Promise<string> {
    const before = fetchJson.mock.calls.length;
    editor.putUser(strokes);
    await vi.advanceTimersByTimeAsync(2000);
    await settleUntil(() => fetchJson.mock.calls.length > before);
    await settle(8);
    const line = Object.values(liveStore.lines.get()).find((st) => st.line.strokeIds.includes(strokes[0].id));
    if (!line) throw new Error("the strokes just written are on no line");
    return line.line.id;
  }

  async function run(action: () => void): Promise<void> {
    action();
    await settle();
    await vi.advanceTimersByTimeAsync(5_000);
    await settleStable(() => [calls.length, setupBodies.length, editor.shapesOfType("math").length, editor.shapesOfType("draw").length, liveStore.solving.get()].join("|"));
  }

  const solves = () => calls.filter((p) => p.endsWith("/solve"));
  const tutorInk = () => editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai" && !(s.meta as Record<string, unknown>).mark);
  /** the lines the tutor wrote by hand, top to bottom */
  const handLines = () => handLinesOf(tutorInk());
  const typeset = () =>
    editor
      .shapesOfType("math")
      .filter((s) => (s.props as MathShapeProps).source === "ai")
      .sort((a, b) => a.y - b.y)
      .map((s) => (s.props as MathShapeProps).latex);

  /** What the board should write for this setup: the setup, then the engine's own steps. */
  const expectedBlock = (setup: string[]) => setupBlock(setup, localSolve(engine, setup).steps);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    editor = createFakeEditor();
    calls = [];
    script = [];
    reads = [{ latex: TRAIN }];
    setupReply = ["v = \\frac{150}{2.5}"];
    setupBodies = [];
    online = true;
    handwriting = true;
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => {
      const next = reads.length > 1 ? reads.shift()! : reads[0];
      return { latex: "", text: "", kind: "text", confidence: 0.95, provider: "mathpix", ms: 100, ...next };
    });
    start();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  it("writes the setup and the engine's steps by hand as one block, and never asks the solve model", async () => {
    const lineId = await write();
    await run(() => loop.requestSolve(lineId));

    expect(setupBodies).toEqual([{ boardId: "board-1", lines: [TRAIN] }]);
    expect(solves()).toEqual([]);
    const block = expectedBlock(["v = \\frac{150}{2.5}"]);
    expect(block[0]).toBe("v = \\frac{150}{2.5}");
    expect(block.length).toBeGreaterThan(1); // the engine's answer follows the setup
    expect(handLines()).toEqual(block);
    expect(typeset()).toEqual([]);
    // the block records the problem it solves, so Solve again is free
    expect(tutorInk().every((s) => (s.meta as Record<string, unknown>).solvedLatex === wordProblemKey([TRAIN]))).toBe(true);
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.solving.get()).toBe(0);
  });

  it("a second Solve on the same problem draws nothing new and costs no second setup", async () => {
    const lineId = await write();
    await run(() => loop.requestSolve(lineId));
    const inkBefore = tutorInk().length;
    await run(() => loop.requestSolve(lineId));
    expect(setupBodies).toHaveLength(1);
    expect(solves()).toEqual([]);
    expect(tutorInk()).toHaveLength(inkBefore);
  });

  it("a system of two equations: both lines, then the engine's elimination or substitution", async () => {
    reads = [{ latex: COINS[0] }, { latex: COINS[1] }];
    setupReply = ["n + d = 25", "5n + 10d = 185"];
    await write(writeLine("2x+3=11", 100, 200, 40));
    const lineId = await write(writeLine("x=4", 100, 280, 40));
    await run(() => loop.requestSolve(lineId));

    expect(setupBodies[0].lines).toEqual(COINS);
    expect(solves()).toEqual([]);
    const lines = handLines();
    expect(lines.slice(0, 2)).toEqual(["n + d = 25", "5n + 10d = 185"]);
    expect(lines.join(" ; ")).toMatch(/d = 12/);
  });

  it("typesets the block when the hand is switched off — still no solve model", async () => {
    handwriting = false;
    const lineId = await write();
    await run(() => loop.requestSolve(lineId));
    expect(solves()).toEqual([]);
    expect(tutorInk()).toEqual([]);
    expect(typeset()).toEqual(expectedBlock(["v = \\frac{150}{2.5}"]));
  });

  it("a setup the engine cannot solve falls back to /api/live/solve", async () => {
    setupReply = ["x + y = 10"]; // valid maths, one equation in two unknowns
    script = [[step(1, "v = \\frac{150}{2.5}"), step(2, "\\boxed{v = 60}", true)]];
    const lineId = await write();
    await run(() => loop.requestSolve(lineId));
    expect(setupBodies).toHaveLength(1);
    expect(solves()).toEqual(["/api/live/solve"]);
    // the model's checked steps, not the rejected setup
    expect(handLines()).toEqual(["v = \\frac{150}{2.5}", "v = 60"]);
  });

  it.each([
    ["words", ["\\text{speed} = \\frac{150}{2.5}"]],
    ["a sentence", ["The speed is 60"]],
    ["a letter nobody defined", ["v = \\frac{d}{t}"]],
    ["a Greek letter from nowhere", ["\\varepsilon = \\frac{150}{2.5}"]],
    ["LaTeX the engine cannot read", ["v = \\frac{150}{"]],
  ])("an invalid setup (%s) is never drawn: the solve model is asked instead", async (_why, lines) => {
    setupReply = lines;
    script = [[step(1, "v = \\frac{150}{2.5}"), step(2, "\\boxed{v = 60}", true)]];
    const lineId = await write();
    await run(() => loop.requestSolve(lineId));
    expect(solves()).toEqual(["/api/live/solve"]);
    const drawn = [...handLines(), ...typeset()].join(" ; ");
    expect(drawn).not.toMatch(/text|speed|The|\\frac\{d\}|varepsilon/);
  });

  it("a failed setup call falls back to /api/live/solve", async () => {
    setupReply = new ApiError("The AI service returned an error. Please try again.", 502, "upstream_error");
    script = [[step(1, "v = \\frac{150}{2.5}"), step(2, "\\boxed{v = 60}", true)]];
    const lineId = await write();
    await run(() => loop.requestSolve(lineId));
    expect(solves()).toEqual(["/api/live/solve"]);
    expect(liveStore.lastError.get()).toBeNull();
  });

  it("out of credits on the setup: the error is shown and the solve model is not asked too", async () => {
    setupReply = new ApiError("You have used this month's credits.", 402, "credits_exhausted");
    const lineId = await write();
    await run(() => loop.requestSolve(lineId));
    expect(solves()).toEqual([]);
    expect(liveStore.lastError.get()).toMatchObject({ kind: "solve", lineId });
  });

  it("offline: the solve is deferred as before, and no setup is asked for", async () => {
    const lineId = await write();
    online = false;
    loop.setOnline(false);
    await run(() => loop.requestSolve(lineId));
    expect(setupBodies).toEqual([]);
    expect(solves()).toEqual([]);
    expect(liveStore.status.get()).toBe("offline");
  });

  it("a hint in Feedback (More help) writes the first setup line only", async () => {
    start("feedback");
    const lineId = await write();
    await run(() => loop.escalate(lineId));
    expect(setupBodies).toHaveLength(1);
    expect(solves()).toEqual([]);
    expect(handLines()).toEqual(["v = \\frac{150}{2.5}"]);
  });

  it("maths the engine can already do never asks for a setup", async () => {
    reads = [{ latex: "2x+3=11", kind: "math" }];
    const lineId = await write();
    await run(() => loop.requestSolve(lineId));
    expect(setupBodies).toEqual([]);
    expect(solves()).toEqual([]);
  });
});

describe("validateSetupLines", () => {
  const problem = ["\\text{The angles of a triangle are x, 2x and 3x degrees. Find x.}"];

  it("accepts assignments, equations, systems and `x = ?`, with $ and boxes off", () => {
    expect(validateSetupLines(engine, ["$v = \\frac{150}{2.5}$"], [])).toEqual(["v = \\frac{150}{2.5}"]);
    expect(validateSetupLines(engine, ["x + 2x + 3x = 180"], problem)).toEqual(["x + 2x + 3x = 180"]);
    expect(validateSetupLines(engine, ["m = 3s", "m + s = 36", "s = ?"], [])).toEqual(["m = 3s", "m + s = 36", "s = ?"]);
    expect(validateSetupLines(engine, ["\\boxed{c^{2} = 6^{2} + 8^{2}}"], [])).toEqual(["c^{2} = 6^{2} + 8^{2}"]);
  });

  it("drops a bare expression beside the equation (a real model reply), keeps the rest", () => {
    const rect = ["\\text{A rectangle is 3 cm longer than it is wide. Its area is 40 cm squared. Find its width.}"];
    expect(validateSetupLines(engine, ["w+3", "w(w+3)=40"], rect)).toEqual(["w(w+3)=40"]);
    // nothing but expressions: no setup at all
    expect(validateSetupLines(engine, ["w+3"], rect)).toBeNull();
  });

  it("refuses words, undefined letters, foreign Greek, unreadable LaTeX, nothing, and too much", () => {
    expect(validateSetupLines(engine, ["\\text{speed} = 60"], [])).toBeNull();
    expect(validateSetupLines(engine, ["v = \\frac{d}{t}"], [])).toBeNull();
    expect(validateSetupLines(engine, ["\\theta = 30 + 2"], [])).toBeNull();
    expect(validateSetupLines(engine, ["v = \\frac{150}{"], [])).toBeNull();
    expect(validateSetupLines(engine, [], [])).toBeNull();
    expect(validateSetupLines(engine, ["", "  "], [])).toBeNull();
    expect(validateSetupLines(engine, ["a = 1", "b = 2", "c = 3", "d = 4", "e = 5"], [])).toBeNull();
  });

  it("a letter the problem itself uses is the problem's own", () => {
    expect(validateSetupLines(engine, ["y = 3x"], ["x = 4"])).toEqual(["y = 3x"]);
    expect(validateSetupLines(engine, ["y = 3x"], [])).toBeNull();
  });

  it("setupBlock: setup first, a repeated line written once, the first line alone for a hint", () => {
    expect(setupBlock(["v = \\frac{150}{2.5}"], ["v = \\frac{150}{2.5}", "v = 60"])).toEqual(["v = \\frac{150}{2.5}", "v = 60"]);
    expect(setupBlock(["a + c = 200", "5a + 3c = 800"], ["a = 200 - c"], true)).toEqual(["a + c = 200"]);
  });
});
