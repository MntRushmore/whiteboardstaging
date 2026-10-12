import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine, writeLine } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { isLiveMeta, type LiveEngine, type LiveSseEvent, type RecognizeResponse, type UseLiveMathOptions } from "../contracts";
import { getEngine } from "../engine";
import { handLinesOf } from "../handwriting";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import type { ChatAction, ChatRunReport } from "../chat/contracts";
import { HELP_BOARD_NOTES } from "../chat/desk";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";

/**
 * Ask's `help_board` (docs/ASK-V2.md): "is this right?", "help me with this", "what's next?",
 * "solve it" about the student's OWN work does exactly what the board's Help me (`step`) and Solve
 * it (`solve`) do — on the line they wrote in last, by the engine, in the tutor's hand — whatever the
 * dial says, with Auto on or off; and says so honestly when there is nothing of theirs to help with.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("live loop — Ask's help_board: Help me / Solve it on the student's own work", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let calls: string[];
  /** what the recognizer answers next (the last one repeats) */
  let reads: Array<Partial<RecognizeResponse>>;

  function start(mode: UseLiveMathOptions["mode"], opts: Partial<UseLiveMathOptions> = {}): void {
    loop?.stop();
    resetLiveStore();
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true, ...opts },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
          calls.push(path);
        },
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

  /** A reply's actions, run as the panel runs them; the clock turned until they are all on the page. */
  async function ask(actions: ChatAction[]): Promise<ChatRunReport> {
    let result: ChatRunReport | null = null;
    let error: unknown = null;
    loop.runChatActions(actions).then(
      (r) => (result = r),
      (e) => (error = e),
    );
    for (let i = 0; i < 400 && !result && !error; i++) await vi.advanceTimersByTimeAsync(50);
    if (error) throw error;
    if (!result) throw new Error("the chat never finished");
    await settleStable(() => String(tutorInk().length));
    return result;
  }

  const tutorInk = () => editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai");
  const meta = (s: ReturnType<typeof tutorInk>[number]) => s.meta as Record<string, unknown>;
  const marksOf = (kind: "check" | "circle" | "question") => tutorInk().filter((s) => String(meta(s).mark ?? "").startsWith(`${kind}:`));
  const written = () => handLinesOf(tutorInk().filter((s) => !meta(s).mark));
  const suggestions = () => tutorInk().filter((s) => typeof meta(s).suggestFor === "string");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    editor = createFakeEditor();
    const page = editor.getCurrentPage();
    editor.store.put([{ ...page, meta: { screen: { ...DEFAULT_SCREEN } } }]);
    calls = [];
    reads = [{ latex: "2x+3=11" }];
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => {
      const next = reads.length > 1 ? reads.shift()! : reads[0];
      return { latex: "", text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 100, ...next };
    });
    start("feedback");
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  it("'what's next?' in Feedback: the next step under the student's line, by the engine, as Help me writes it", async () => {
    await write(writeLine("2x+3=11", 100, 200, 40));
    const report = await ask([{ type: "help_board", depth: "step" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: true }]);
    expect(written()).toEqual(["2x = 8"]);
    expect(calls).toEqual([]);
  });

  it("'solve it' with the dial on Feedback: the rest worked out — the depth asked for, not the dial's", async () => {
    await write(writeLine("2x+3=11", 100, 200, 40));
    const report = await ask([{ type: "help_board", depth: "solve" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: true }]);
    expect(written()).toEqual(["2x = 8", "x = 4"]);
    expect(calls).toEqual([]);
  });

  it("'is this right?' on a wrong line: the right step beside it, as Help me gives it", async () => {
    reads = [{ latex: "2x+3=11" }, { latex: "x=5" }];
    await write(writeLine("2x+3=11", 100, 200, 40));
    await write(writeLine("x=3", 100, 300, 40)); // read as x=5: wrong
    const report = await ask([{ type: "help_board", depth: "step" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: true }]);
    expect(suggestions().length).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });

  it("with the dial on Off: a typed ask is answered all the same (the button is not there)", async () => {
    start("off");
    await write(writeLine("2x+3=11", 100, 200, 40));
    expect(loop.requestHelp()).toBe(false);
    const report = await ask([{ type: "help_board", depth: "solve" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: true }]);
    expect(written()).toEqual(["2x = 8", "x = 4"]);
  });

  it("with Auto off: the ask is an ask — the problem gets its marks, and the help", async () => {
    start("feedback", { auto: false });
    reads = [{ latex: "2x+3=11" }, { latex: "x=5" }];
    await write(writeLine("2x+3=11", 100, 200, 40));
    await write(writeLine("x=3", 100, 300, 40));
    // Auto off: read back, nothing marked unasked
    expect(marksOf("circle")).toEqual([]);
    const report = await ask([{ type: "help_board", depth: "step" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: true }]);
    expect(marksOf("circle").length).toBeGreaterThan(0);
    expect(suggestions().length).toBeGreaterThan(0);
  });

  it("with Auto on in Solve: what Auto already wrote is not written twice", async () => {
    start("answer");
    await write(writeLine("2x+3=11", 100, 200, 40));
    // the student stops: Auto works it out
    await vi.advanceTimersByTimeAsync(4_000);
    await settleStable(() => String(tutorInk().length));
    const auto = written();
    expect(auto.at(-1)).toBe("x = 4");
    const report = await ask([{ type: "help_board", depth: "solve" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: true }]);
    expect(written()).toEqual(auto);
    expect(calls).toEqual([]);
  });

  it("with Auto on in Suggest (a young kid's board): a sum ended with = gets its answer", async () => {
    start("suggest");
    reads = [{ latex: "7+5=" }];
    await write(writeLine("2+3=", 100, 200, 40)); // read as 7+5=
    const report = await ask([{ type: "help_board", depth: "solve" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: true }]);
    expect(written().join(" ")).toContain("12");
    expect(calls).toEqual([]);
  });

  it("only the chat's problems on the screen: the current one is worked under it, as the button does", async () => {
    await ask([{ type: "write_problems", problems: [["3x = 12"]] }]);
    const before = tutorInk().length;
    const report = await ask([{ type: "help_board", depth: "solve" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: true }]);
    expect(tutorInk().length).toBeGreaterThan(before);
    expect(written()).toContain("x = 4");
    expect(calls).toEqual([]);
  });

  it("a missing-number problem is worked with its box, by the engine: `4 + □ = 9` → `□ = 5`, no model", async () => {
    await ask([{ type: "write_problems", problems: [["4 + ? = 9"], ["\\frac{3}{4} \\; ? \\; \\frac{5}{8}"]] }]);
    const report = await ask([
      { type: "help_problem", problem: 1, depth: "solve" },
      { type: "help_problem", problem: 2, depth: "solve" },
    ]);
    expect(report.outcomes).toEqual([
      { type: "help_problem", ok: true },
      { type: "help_problem", ok: true },
    ]);
    expect(written()).toEqual(expect.arrayContaining(["\\square = 5", "\\frac{3}{4} > \\frac{5}{8}"]));
    expect(written().some((l) => /(^|[^\\a-z])x(?![a-z])/.test(l))).toBe(false);
    expect(calls).toEqual([]);
  });

  it("nothing of the student's on the screen: nothing written, and the panel says so — no model, no ink spent", async () => {
    const report = await ask([{ type: "help_board", depth: "step" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: false, note: HELP_BOARD_NOTES.nothing, why: "nothing" }]);
    expect(tutorInk()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("the tutor switched off (Live disabled): it cannot see their work, and says so", async () => {
    start("feedback", { enabled: false });
    const report = await ask([{ type: "help_board", depth: "solve" }]);
    expect(report.outcomes).toEqual([{ type: "help_board", ok: false, note: HELP_BOARD_NOTES.off, why: "off" }]);
  });

  it("asked again once it is solved: already worked out, nothing written twice", async () => {
    await write(writeLine("2x+3=11", 100, 200, 40));
    await ask([{ type: "help_board", depth: "solve" }]);
    const count = tutorInk().length;
    reads = [{ latex: "x=4" }];
    await write(writeLine("x=4", 100, 420, 40));
    const again = await ask([{ type: "help_board", depth: "solve" }]);
    expect(again.outcomes).toEqual([{ type: "help_board", ok: false, note: HELP_BOARD_NOTES.done, why: "done" }]);
    expect(tutorInk().length).toBeGreaterThanOrEqual(count);
  });

  it("after the writing already under way: problems first, then the help on the student's line", async () => {
    await write(writeLine("2x+3=11", 100, 200, 40));
    const report = await ask([{ type: "write_lines", lines: ["a^{2} + b^{2} = c^{2}"] }, { type: "help_board", depth: "step" }]);
    expect(report.outcomes).toEqual([
      { type: "write_lines", ok: true },
      { type: "help_board", ok: true },
    ]);
    expect(written()).toEqual(expect.arrayContaining(["a^{2} + b^{2} = c^{2}", "2x = 8"]));
  });

  it("a line still being read when asked: it waits for the read, then helps — no '?' about unread ink", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchJson.mockImplementation(async (): Promise<RecognizeResponse> => {
      await gate;
      return { latex: "2x+3=11", text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 100 };
    });
    editor.putUser(writeLine("2x+3=11", 100, 200, 40));
    await vi.advanceTimersByTimeAsync(2000);
    await settleUntil(() => fetchJson.mock.calls.length > 0);
    let report: ChatRunReport | null = null;
    void loop.runChatActions([{ type: "help_board", depth: "step" }]).then((r) => (report = r));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(report).toBeNull();
    release();
    for (let i = 0; i < 100 && !report; i++) await vi.advanceTimersByTimeAsync(50);
    await settleStable(() => String(tutorInk().length));
    expect(report!.outcomes).toEqual([{ type: "help_board", ok: true }]);
    expect(marksOf("question")).toEqual([]);
    expect(written()).toEqual(["2x = 8"]);
  });
});
