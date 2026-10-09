/**
 * The grades' starters on a live board (the loop, a fake editor, the real engine; the recognizer
 * answers what the student "wrote"): the guided board's promise as a child meets it. The tutor
 * writes the starter, the child writes the first step the way a child does — `7` alone under
 * `3 + 4` — and gets a tick; a slip gets a ring, never silence. On a starter whose first step is
 * the answer, coach mark 2's extra problem (`helpProblemFor`) gives Help me something to write.
 *
 * `courses.test.ts` holds every starter to the engine line by line; this is the same promise
 * through the board's own reading of a young student's answer (`bareAnswer`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "@/lib/live/__fixtures__/fakeEditor";
import { writeLine as inkLine } from "@/lib/live/__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { isLiveMeta, LIVE_TIMING, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { createLiveLoop, type LiveLoop } from "@/lib/live/liveLoop";
import { liveStore, resetLiveStore } from "@/lib/live/liveStore";
import { RecognizeClient, type FetchJson } from "@/lib/live/recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import type { ChatAction, ChatRunReport } from "@/lib/live/chat/contracts";
import { GRADE_IDS } from "@/lib/learning/grades";
import { isTutorWork } from "../marks";
import { GRADE_STARTERS, startersFor } from "../courses";
import { helpProblemFor, initialTour } from "../tour";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const STARTERS = GRADE_IDS.flatMap((grade) => GRADE_STARTERS[grade].map((s, i) => ({ grade, i, ...s })));

/** A slip a child makes on each (as `courses.test.ts`, written the way a child writes it). */
const WRONG: Record<string, string> = {
  "3 + 4": "8",
  "5 + 2": "6",
  "7 - 3": "5",
  "8 + 7": "16",
  "15 - 8": "8",
  "40 + 30": "60",
  "47 + 38": "75",
  "72 - 35": "47",
  "56 + 27": "73",
  "6 \\times 7": "36",
  "42 \\div 6": "6",
  "4 \\times 60": "2400",
  "\\frac{2}{7} + \\frac{3}{7}": "\\frac{5}{14}",
  "46 \\times 7": "282",
  "864 \\div 4": "226",
  "\\frac{1}{2} + \\frac{1}{3}": "= \\frac{2}{5}",
  "\\frac{2}{3} \\times \\frac{3}{5}": "= \\frac{5}{8}",
  "\\frac{3}{4} + \\frac{1}{6}": "= \\frac{4}{10}",
  "x + 7 = 15": "x = 22",
  "3x = 24": "x = 21",
  "\\frac{3}{4} \\div \\frac{1}{2}": "= \\frac{3}{8}",
  "2x + 5 = 17": "2x = 22",
  "3x - 4 = 11": "3x = 7",
  "\\frac{x}{4} = \\frac{9}{12}": "x = 4",
  "5x - 3 = 2x + 9": "7x = 12",
  "2(x + 3) = 14": "x + 3 = 12",
  "3x + 4 = x + 10": "4x + 4 = 10",
};

describe("the grades' starters on a live board", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let script: string[];
  let assigned: Map<string, string>;

  function start(): void {
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode: "feedback", enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {},
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
      },
    );
    loop.start();
  }

  async function run(actions: ChatAction[]): Promise<ChatRunReport> {
    let result: ChatRunReport | null = null;
    let error: unknown = null;
    loop.runChatActions(actions).then(
      (r) => (result = r),
      (e) => (error = e),
    );
    for (let i = 0; i < 400 && !result && !error; i++) await vi.advanceTimersByTimeAsync(50);
    if (error) throw error;
    if (!result) throw new Error("the chat never finished");
    return result;
  }

  /**
   * The child writes a line under the problem, read back as `latex` (the ink is a stand-in: the
   * fixture's glyphs are few); resolves with the line's id once analysed.
   */
  async function write(latex: string): Promise<string> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(inkLine("14", 120, 170, 40));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.analysis)));
    const added = Object.keys(liveStore.lines.get()).find((id) => !before.has(id));
    if (!added) throw new Error(`${latex} produced no line`);
    // the child stops writing: the canvas settle runs out, and the tutor's mark lands
    await vi.advanceTimersByTimeAsync(3000);
    await landed();
    return added;
  }

  async function landed(): Promise<void> {
    await settle();
    await settleStable(() => String(editor.getCurrentPageShapes().length));
  }

  const tutor = (): TLShape[] => editor.getCurrentPageShapes().filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai");
  const marksOn = (lineId: string) => [
    ...new Set(
      tutor()
        .filter((s) => s.meta.lineId === lineId && (s.meta as Record<string, unknown>).mark)
        .map((s) => String((s.meta as Record<string, unknown>).mark).split(":")[0]),
    ),
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    editor.store.put([{ ...editor.getCurrentPage(), meta: { screen: { ...DEFAULT_SCREEN } } }]);
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
    start();
  });

  afterEach(() => {
    loop?.stop();
    vi.useRealTimers();
  });

  describe.each(STARTERS)("grade $grade #$i: $lines", ({ grade, i, lines, firstStep }) => {
    it("is written by the tutor, and the child's first step gets a tick", async () => {
      expect((await run([{ type: "write_problems", problems: [[...lines]] }])).problemsWritten).toBe(1);
      const line = await write(firstStep);
      expect(liveStore.lines.get()[line].analysis?.verdict).toBe("ok");
      expect(marksOn(line)).toEqual(["check"]);
    });

    it("a slip gets a ring, never silence", async () => {
      await run([{ type: "write_problems", problems: [[...lines]] }]);
      const line = await write(WRONG[lines.join("; ")]);
      expect(marksOn(line)).toEqual(["circle"]);
    });

    it("coach mark 2 after a ticked answer: the tour's next problem gives Help me something to write", async () => {
      const starters = startersFor("other", i, grade);
      const starter = starters[0];
      const extra = helpProblemFor({ step: "help", outcome: "tick" }, starter, starters);
      if (!starter.oneStep) {
        expect(extra).toBeNull();
        return;
      }
      expect(extra).not.toBeNull();
      await run([{ type: "write_problems", problems: [[...lines]] }]);
      await write(firstStep);
      expect((await run([{ type: "write_problems", problems: [[...extra!.lines]] }])).problemsWritten).toBe(1);
      await landed();
      const before = new Set(tutor().map((s) => s.id));
      expect(loop.requestHelp()).toBe(true);
      await landed();
      await vi.advanceTimersByTimeAsync(5000);
      await landed();
      expect(tutor().filter((s) => !before.has(s.id) && isTutorWork(s.meta)).length).toBeGreaterThan(0);
    });
  });
});

describe("helpProblemFor", () => {
  const [k1, k2, k3] = GRADE_STARTERS[0];
  const help = { ...initialTour("help"), outcome: "tick" as const };

  it("writes the next starter of the set on coach mark 2, after a ticked answer", () => {
    expect(helpProblemFor(help, k1, [k1, k2, k3])).toBe(k2);
    // never the same problem again (two starters can share their lines in a list)
    expect(helpProblemFor(help, k1, [k1, { ...k1 }, k3])).toBe(k3);
  });

  it("writes nothing on a starter with more to do, after a ring or a skip, or on any other coach mark", () => {
    const algebra = GRADE_STARTERS[7][0];
    expect(helpProblemFor(help, algebra, GRADE_STARTERS[7])).toBeNull();
    expect(helpProblemFor({ step: "help", outcome: "ring" }, k1, [k1, k2])).toBeNull();
    expect(helpProblemFor({ step: "help", outcome: null }, k1, [k1, k2])).toBeNull();
    for (const step of ["write", "result", "helped", "ask"] as const) expect(helpProblemFor({ step, outcome: "tick" }, k1, [k1, k2])).toBeNull();
    expect(helpProblemFor(help, null, [k1, k2])).toBeNull();
    expect(helpProblemFor(help, k1, [k1])).toBeNull();
  });
});
