import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine as inkLine } from "../__fixtures__/strokes";
import { settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  LIVE_TIMING,
  type CheckRequest,
  type HelpMode,
  type LineAnalysis,
  type LiveEngine,
  type LiveSseEvent,
  type RecognizeRequest,
  type RecognizeResponse,
} from "../contracts";
import { getEngine } from "../engine";
import { handBlockOf } from "../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import { problemMetaOf } from "../chat/cells";
import type { ChatAction, ChatRunReport } from "../chat/contracts";
import { learningBus } from "@/lib/learning/bus";
import type { ChatRunOrigin, LearningSignal } from "@/lib/learning/contracts";
import { LINEAR_TEACH } from "../chat/__tests__/teachFixtures";

/**
 * What the board tells the learning record (`learningBus`): a problem the chat wrote and where it
 * came from, each student line as its mark settles or changes (with its problem, the line above it
 * and whether it is the answer), the mistakes a model names, the tutor's help (and whether Auto gave
 * it), the tutor finishing a problem, a screen left, the board closed. One problem keeps one key.
 *
 * The real engine and the real hand engine; the models are scripted streams.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
  // the worked-solution writer the chat desk loads on first use: loaded now, so a fake clock never waits on it
  await import("../chat/teachWrite");
});

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

type Reply = { events?: LiveSseEvent[] };

describe("live loop — the learning record's signals", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let calls: Array<{ path: string; body: unknown }>;
  let replies: { check: Reply[]; solve: Reply[] };
  let script: string[];
  let assigned: Map<string, string>;
  let signals: LearningSignal[];
  let unsubscribe: () => void;

  function start(mode: HelpMode, opts: { auto?: boolean; engine?: LiveEngine } = {}): void {
    loop?.stop();
    resetLiveStore();
    const stream = async function* (path: string, body: unknown): AsyncGenerator<LiveSseEvent, void, undefined> {
      calls.push({ path, body });
      const reply = (path.endsWith("/solve") ? replies.solve : replies.check).shift() ?? {};
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
        notify: () => undefined,
      },
    );
    loop.start();
  }

  /** Distinct ink per row: identical strokes would hit the recognizer's content cache. */
  const ROW_INK = ["2x=8", "x=4", "3+4=", "8+1=", "4x=8", "1+2="];

  /** One line of ink at `row` (x 100), read as `latex`; resolves with its line id once it is read. */
  async function penLine(row: number, latex: string, opts: { x?: number; y?: number; ink?: string } = {}): Promise<string> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(inkLine(opts.ink ?? ROW_INK[row], opts.x ?? 100, opts.y ?? 200 + row * 120, 40));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.analysis)));
    await quiesce();
    const added = Object.keys(liveStore.lines.get()).find((id) => !before.has(id));
    if (!added) throw new Error(`${latex} produced no line`);
    return added;
  }

  const quiesce = () => settleStable(() => [editor.getCurrentPageShapes().length, calls.length, liveStore.solving.get(), signals.length].join("|"));

  async function wait(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await quiesce();
  }

  /** A chat reply's actions, run to the end with the clock turning. */
  async function run(actions: ChatAction[], from?: ChatRunOrigin): Promise<ChatRunReport> {
    let result: ChatRunReport | null = null;
    let error: unknown = null;
    loop.runChatActions(actions, from).then(
      (r) => (result = r),
      (e) => (error = e),
    );
    for (let i = 0; i < 400 && !result && !error; i++) await vi.advanceTimersByTimeAsync(50);
    if (error) throw error;
    if (!result) throw new Error("the chat never finished");
    await quiesce();
    return result;
  }

  /** The signals in brief, in order: `line <latex> <mark> [solved]`, `help <kind> [auto]`, `problem <origin>`… */
  const brief = (list: LearningSignal[] = signals) =>
    list.map((s) => {
      switch (s.type) {
        case "line":
          return `line ${s.latex} ${s.mark ?? "-"}${s.solved ? " solved" : ""}`;
        case "help":
          return `help ${s.help}${s.auto ? " auto" : ""}`;
        case "problem":
          return `problem ${s.origin}`;
        case "mistake":
          return `mistake ${s.kind} ${s.source}`;
        default:
          return s.type;
      }
    });
  /** each line's marks as they changed, by its latex */
  const lineSignals = () => signals.filter((s): s is Extract<LearningSignal, { type: "line" }> => s.type === "line");
  const keys = () => new Set(signals.flatMap((s) => ("problemKey" in s ? [s.problemKey] : [])));
  const page = () => editor.getCurrentPage().id;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    editor = createFakeEditor();
    const p = editor.getCurrentPage();
    editor.store.put([{ ...p, meta: { screen: { ...DEFAULT_SCREEN } } }]);
    calls = [];
    replies = { check: [], solve: [] };
    script = [];
    assigned = new Map();
    signals = [];
    learningBus.reset();
    unsubscribe = learningBus.onSignal((s) => signals.push(s));
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
    loop?.stop();
    unsubscribe();
    learningBus.reset();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("a problem solved alone: each line once as it is marked, one key, the answer solved; the board closing", async () => {
    start("feedback");
    const head = await penLine(0, "2x+3=11");
    await penLine(1, "2x=8");
    await penLine(2, "x=4");
    await wait(ANSWER_SETTLE_MS);
    loop.stop();
    expect(brief()).toEqual(["line 2x+3=11 -", "line 2x=8 check", "line x=4 check solved", "closed"]);
    // one problem, named by its head line on this screen
    expect([...keys()]).toEqual([`${page()}#ink:${head}`]);
    const lines = lineSignals();
    expect(lines.map((s) => s.previousLatex)).toEqual([undefined, "2x+3=11", "2x=8"]);
    expect(lines.every((s) => s.problemLatex.join() === "2x+3=11" && s.boardId === "board-1" && s.pageId === page())).toBe(true);
    expect(lines.map((s) => s.kind)).toEqual(["equation", "equation", "equation"]);
    expect(signals.at(-1)).toMatchObject({ type: "closed", boardId: "board-1" });
  });

  it("ringed, then fixed: the ring, then the rewritten line ticked — still one problem", async () => {
    start("feedback");
    const head = await penLine(0, "2x+3=11");
    const wrong = await penLine(1, "2x=7");
    await wait(ANSWER_SETTLE_MS);
    expect(lineSignals().at(-1)).toMatchObject({ lineId: wrong, mark: "circle", previousLatex: "2x+3=11", solved: false });
    // rubbed out and written again, right
    editor.removeUser([...liveStore.lines.get()[wrong].line.strokeIds]);
    await wait(LIVE_TIMING.quietMs + 300);
    const fixed = await penLine(1, "2x=8", { ink: "4x=8" });
    await penLine(2, "x=4");
    await wait(ANSWER_SETTLE_MS);
    const marks = brief().filter((b) => b.startsWith("line"));
    // (the ring may wait for its second look: a line held unmarked first says so, then the ring)
    expect(marks.filter((b) => !b.startsWith("line 2x=7 -"))).toEqual(["line 2x+3=11 -", "line 2x=7 circle", "line 2x=8 check", "line x=4 check solved"]);
    expect(lineSignals().find((s) => s.lineId === fixed)).toMatchObject({ mark: "check", previousLatex: "2x+3=11" });
    expect([...keys()]).toEqual([`${page()}#ink:${head}`]);
    // Feedback writes no step beside a ring: no help
    expect(signals.some((s) => s.type === "help")).toBe(false);
  });

  it("a fix written under a ringed step is ticked: judged against the last right line, not the slip", async () => {
    start("feedback");
    await penLine(0, "3x-5=10");
    await penLine(1, "3x=5");
    const fix = await penLine(2, "3x=15");
    await penLine(3, "x=5");
    await wait(ANSWER_SETTLE_MS);
    const last = new Map(lineSignals().map((s) => [s.latex, s.mark]));
    expect(Object.fromEntries(last)).toMatchObject({ "3x=5": "circle", "3x=15": "check", "x=5": "check" });
    expect(lineSignals().find((s) => s.lineId === fix)).toMatchObject({ previousLatex: "3x-5=10" });
    expect(lineSignals().at(-1)).toMatchObject({ latex: "x=5", solved: true });
  });

  it("a step carried on from a slip gets no mark (the slip is ringed already); the right answer after it is ticked", async () => {
    start("feedback");
    await penLine(0, "3x-5=10");
    await penLine(1, "3x=5");
    const carried = await penLine(2, "x=\\frac{5}{3}");
    await wait(ANSWER_SETTLE_MS);
    expect(liveStore.lines.get()[carried].analysis).toMatchObject({ verdict: "none", carried: true });
    expect(lineSignals().filter((s) => s.lineId === carried).at(-1)?.mark ?? null).toBeNull();
    // the student spots it and writes the answer: right from the problem
    await penLine(3, "x=5");
    await wait(ANSWER_SETTLE_MS);
    expect(lineSignals().at(-1)).toMatchObject({ latex: "x=5", mark: "check", solved: true });
    // one ring on the board for one slip
    expect(lineSignals().filter((s) => s.mark === "circle").map((s) => s.latex)).toEqual(["3x=5"]);
  });

  it("a young student's own sum: a true fact is ticked and solved, a false one ringed", async () => {
    start("feedback");
    await penLine(0, "7+5=12", { ink: "3+4=" });
    await penLine(3, "9-3=5", { x: 900, y: 200, ink: "8+1=" });
    await wait(ANSWER_SETTLE_MS);
    const last = new Map(lineSignals().map((s) => [s.latex, s]));
    expect(last.get("7+5=12")).toMatchObject({ mark: "check", solved: true });
    expect(last.get("9-3=5")).toMatchObject({ mark: "circle", solved: false });
  });

  it("a chain of right steps is ticked as before", async () => {
    start("feedback");
    await penLine(0, "2x+3=11");
    await penLine(1, "2x=8");
    await penLine(2, "x=4");
    await wait(ANSWER_SETTLE_MS);
    expect(brief().filter((b) => b.startsWith("line"))).toEqual(["line 2x+3=11 -", "line 2x=8 check", "line x=4 check solved"]);
  });

  it("Suggest's step when stuck is Auto's help; the dial to Solve then has Auto finish it", async () => {
    start("suggest");
    const head = await penLine(0, "2x+3=11");
    await wait(ANSWER_SETTLE_MS + LIVE_TIMING.stuckMs);
    expect(brief()).toEqual(["line 2x+3=11 -", "help next_step auto"]);
    loop.setOptions({ boardId: "board-1", mode: "answer", enabled: true, auto: true });
    await wait(1000);
    expect(brief().slice(2)).toEqual(["help solve auto", "tutor_solved"]);
    expect(signals.at(-1)).toMatchObject({ type: "tutor_solved", problemKey: `${page()}#ink:${head}`, problemLatex: ["2x+3=11"], boardId: "board-1" });
    expect([...keys()]).toEqual([`${page()}#ink:${head}`]);
  });

  it("Help me (a step) then Solve it, asked, with Auto off: each ask, then what it wrote", async () => {
    start("suggest", { auto: false });
    const head = await penLine(0, "2x+3=11");
    await wait(ANSWER_SETTLE_MS);
    // what the controller does for the button: say it was asked, then ask
    loop.noteAsked();
    loop.requestHelp();
    await wait(500);
    loop.setOptions({ boardId: "board-1", mode: "answer", enabled: true, auto: false });
    await wait(500);
    loop.noteAsked();
    loop.requestSolve();
    await wait(500);
    expect(brief().filter((b) => !b.startsWith("line"))).toEqual(["help ask", "help next_step", "help ask", "help solve", "tutor_solved"]);
    expect([...keys()]).toEqual([`${page()}#ink:${head}`]);
  });

  it("a chat problem says where it came from, and the work under it is that problem", async () => {
    start("feedback");
    await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }], { origin: "practice" });
    const problems = signals.filter((s): s is Extract<LearningSignal, { type: "problem" }> => s.type === "problem");
    expect(problems.map((p) => [p.origin, p.problemLatex])).toEqual([
      ["practice", ["2x + 3 = 11"]],
      ["practice", ["3x = 12"]],
    ]);
    // named by the problem's own hand block on this screen (what `readProblemCells` keys it by)
    const blockOf = (n: number) => handBlockOf(editor.getCurrentPageShapes().find((s) => problemMetaOf(s.meta)?.n === n)!.meta);
    expect(problems.map((p) => p.problemKey)).toEqual([`${page()}#cell:${blockOf(1)}`, `${page()}#cell:${blockOf(2)}`]);
    // work under problem 1 (its cell: x 48–800, y 72–472)
    await penLine(0, "2x=8", { y: 200 });
    await penLine(1, "x=4", { y: 280 });
    const lines = lineSignals();
    expect(lines.map((s) => [s.problemKey, s.mark, s.solved])).toEqual([
      [problems[0].problemKey, "check", false],
      [problems[0].problemKey, "check", true],
    ]);
    expect(lines[0]).toMatchObject({ problemLatex: ["2x + 3 = 11"], previousLatex: "2x + 3 = 11" });
    expect(lines[1]).toMatchObject({ previousLatex: "2x=8" });
  });

  it("each chat run's problems keep its own origin, queued runs too; the chat's own by default", async () => {
    start("feedback");
    const first = loop.runChatActions([{ type: "write_problems", problems: [["2x + 3 = 11"]] }], { origin: "now_you_try", parentId: "attempt-1" });
    const second = loop.runChatActions([{ type: "write_problems", problems: [["3x = 12"]] }]);
    let done = false;
    void Promise.all([first, second]).then(() => (done = true));
    for (let i = 0; i < 400 && !done; i++) await vi.advanceTimersByTimeAsync(50);
    await quiesce();
    const problems = signals.filter((s): s is Extract<LearningSignal, { type: "problem" }> => s.type === "problem");
    expect(problems.map((p) => [p.origin, p.parentId, p.problemLatex[0]])).toEqual([
      ["now_you_try", "attempt-1", "2x + 3 = 11"],
      ["tutor_problem", undefined, "3x = 12"],
    ]);
    // the second went on a screen of its own (the first had work on it)
    expect(problems[0].pageId).not.toBe(problems[1].pageId);
  });

  it("\"help me with 1\" in the chat: an ask about that problem, then the step the tutor wrote under it", async () => {
    start("feedback");
    await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["3x = 12"]] }]);
    const problem1 = signals.find((s) => s.type === "problem")!;
    signals.length = 0;
    await run([{ type: "help_problem", problem: 1, depth: "step" }]);
    expect(brief()).toEqual(["help ask", "help next_step"]);
    expect([...keys()]).toEqual(["problemKey" in problem1 ? problem1.problemKey : ""]);
    signals.length = 0;
    await run([{ type: "help_problem", problem: 1, depth: "solve" }]);
    expect(brief()).toEqual(["help ask", "help solve", "tutor_solved"]);
    expect(signals.at(-1)).toMatchObject({ problemLatex: ["2x + 3 = 11"] });
  });

  it("a young student's side calculations under 18 × 7 (prod: 8 lines, 3 rings, none right): ticks, the partial alone unmarked, solved once — by the answer", async () => {
    start("feedback");
    await run([{ type: "write_problems", problems: [["18 \\times 7"]] }]);
    signals.length = 0;
    await penLine(0, "10 \\times 7 = 70", { y: 200 });
    await penLine(1, "8 \\times 7 = 56", { y: 280 });
    await penLine(2, "70", { y: 360 });
    await penLine(3, "126", { y: 440 });
    await wait(3000);
    // each line's last word to the record: no ring, no "?", and only the answer solves it
    const last = new Map(lineSignals().map((s) => [s.latex, `${s.mark ?? "-"}${s.solved ? " solved" : ""}`]));
    expect([...last]).toEqual([
      ["10 \\times 7 = 70", "check"],
      ["8 \\times 7 = 56", "check"],
      ["70", "-"],
      ["126", "check solved"],
    ]);
    expect(lineSignals().filter((s) => s.solved).map((s) => s.latex)).toEqual(["126"]);
  });

  it("with the dial at Off, nothing is drawn — the record still takes each line's verdict", async () => {
    start("off");
    await penLine(0, "2x+3=11");
    await penLine(1, "2x=7");
    await penLine(2, "x=4", { ink: "1+2=" });
    await wait(ANSWER_SETTLE_MS);
    // (x = 4 solves the problem: the engine judges an answer against the problem itself)
    expect(brief()).toEqual(["line 2x+3=11 -", "line 2x=7 circle", "line x=4 check solved"]);
    // the marks on the page: none
    expect(editor.getCurrentPageShapes().filter((s) => (s.meta as Record<string, unknown>).mark)).toEqual([]);
  });

  it("Solve finishing a sum after its `=` at the pause: Auto's answer, the tutor solved it", async () => {
    start("answer");
    await penLine(0, "3+4=");
    await wait(ANSWER_SETTLE_MS);
    expect(brief()).toEqual(["line 3+4= -", "help solve auto", "tutor_solved"]);
    expect(signals.at(-1)).toMatchObject({ problemLatex: ["3+4="] });
  });

  it("a worked solution the chat taught is a problem the tutor solved", async () => {
    start("feedback");
    const report = await run([{ type: "teach", steps: LINEAR_TEACH.steps.map((s) => ({ say: s.say, math: [...(s.math ?? [])] })), answer: LINEAR_TEACH.answer }]);
    expect(report.outcomes).toEqual([{ type: "teach", ok: true }]);
    expect(brief()).toEqual(["problem teach", "help solve", "tutor_solved"]);
    const taught = signals[0] as Extract<LearningSignal, { type: "problem" }>;
    expect(taught.problemLatex).toEqual(["2x + 3 = 11"]);
    expect(taught.problemKey.startsWith(`${page()}#teach:`)).toBe(true);
    expect(signals[2]).toMatchObject({ problemKey: taught.problemKey, origin: "teach" });
  });

  it("a screen switch says which screen; coming back brings the lines back without a word", async () => {
    start("feedback");
    const first = page();
    await penLine(0, "2x+3=11");
    await penLine(1, "2x=8");
    const before = signals.length;
    const screen2 = editor.addPage({ screen: { ...DEFAULT_SCREEN } });
    editor.switchPage(screen2);
    await quiesce();
    expect(signals.slice(before)).toEqual([{ type: "screen", at: expect.any(Number), boardId: "board-1", pageId: screen2 }]);
    editor.switchPage(first);
    await wait(1000);
    expect(brief(signals.slice(before))).toEqual(["screen", "screen"]);
    expect(signals.at(-1)).toMatchObject({ type: "screen", pageId: first });
  });

  it("a reload says nothing about the lines already there; a new line keeps its problem's key", async () => {
    start("feedback");
    const head = await penLine(0, "2x+3=11");
    await penLine(1, "2x=8");
    loop.stop();
    signals.length = 0;
    // the board opened again: its lines come back from their readbacks
    start("feedback");
    await wait(ANSWER_SETTLE_MS);
    expect(signals).toEqual([]);
    await penLine(2, "x=4");
    expect(brief()).toEqual(["line x=4 check solved"]);
    expect([...keys()]).toEqual([`${page()}#ink:${head}`]);
  });

  it("a model's ring names the mistake; asked for, its words are a hint", async () => {
    start("feedback", { engine: withUnjudged() });
    await penLine(0, "2x+3=11");
    const line = await penLine(1, UNJUDGED);
    replies.check.push({ events: [{ event: "annotation", data: { lineId: line, verdict: "warn", kind: "sign", message: "Look at the sign on the left", confidence: 0.9 } }] });
    loop.noteAsked(line);
    loop.requestCheck(line);
    await wait(500);
    expect(brief().slice(-4)).toEqual(["help ask", `line ${UNJUDGED} circle`, "mistake sign model", "help hint"]);
    expect(signals.find((s) => s.type === "mistake")).toMatchObject({ lineId: line, source: "model" });
  });

  it("an unasked model ring is a mark, not help: the mistake only", async () => {
    start("feedback", { engine: withUnjudged() });
    await penLine(0, "2x+3=11");
    const line = await penLine(1, UNJUDGED);
    replies.check.push({ events: [{ event: "annotation", data: { lineId: line, verdict: "warn", kind: "arithmetic", message: "Check the arithmetic", confidence: 0.9 } }] });
    // Auto's check at the pause
    await wait(ANSWER_SETTLE_MS);
    expect(calls.filter((c) => c.path.endsWith("/check"))).toHaveLength(1);
    expect(brief().slice(-2)).toEqual([`line ${UNJUDGED} circle`, "mistake arithmetic model"]);
    expect(signals.some((s) => s.type === "help")).toBe(false);
  });

  it("a model's note that is no mistake (notation) names none", async () => {
    start("feedback", { engine: withUnjudged() });
    await penLine(0, "2x+3=11");
    const line = await penLine(1, UNJUDGED);
    replies.check.push({ events: [{ event: "annotation", data: { lineId: line, verdict: "warn", kind: "notation", message: "Not what you wrote?", confidence: 0.4 } }] });
    await wait(ANSWER_SETTLE_MS);
    expect(signals.some((s) => s.type === "mistake" || s.type === "help")).toBe(false);
  });

  it("the check carries the learner hint once the board has it — and nothing new before", async () => {
    start("feedback", { engine: withUnjudged() });
    await penLine(0, "2x+3=11");
    const line = await penLine(1, UNJUDGED);
    loop.requestCheck(line);
    await wait(200);
    const plain = calls.filter((c) => c.path.endsWith("/check")).at(-1)!.body as CheckRequest;
    expect("learner" in plain).toBe(false);
    const hint = { weakSkills: [{ id: "two_step_equations", name: "Two-step equations" }], strongSkills: [], recurringMistakes: [{ kind: "sign" as const, count: 3 }] };
    learningBus.setLearner(hint);
    loop.requestCheck(line);
    await wait(200);
    const withHint = calls.filter((c) => c.path.endsWith("/check")).at(-1)!.body as CheckRequest;
    expect(withHint.learner).toEqual(hint);
    expect({ ...withHint, learner: undefined }).toEqual({ ...plain, learner: undefined });
  });

  it("the tutor's own ink and a chat's lines are never a student's line", async () => {
    start("feedback");
    await run([{ type: "write_lines", lines: ["(a + b)^{2} = a^{2} + 2ab + b^{2}"] }]);
    await wait(ANSWER_SETTLE_MS);
    expect(signals).toEqual([]);
  });

  it("a listener that throws never reaches the loop", async () => {
    const off = learningBus.onSignal(() => {
      throw new Error("a broken tracker");
    });
    start("feedback");
    await penLine(0, "2x+3=11");
    const second = await penLine(1, "2x=8");
    off();
    expect(liveStore.lines.get()[second].analysis?.verdict).toBe("ok");
    expect(brief()).toEqual(["line 2x+3=11 -", "line 2x=8 check"]);
  });
});
