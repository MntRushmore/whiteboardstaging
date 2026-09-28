import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape, TLShapeId } from "tldraw";
import { writeAt } from "@/__eval__/drawings";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { drawShapeFromPoints } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { isLiveMeta, type InkStroke, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse, type UseLiveMathOptions } from "../contracts";
import { getEngine } from "../engine";
import { handBlockOf, handLinesOf } from "../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import type { ProofRequest, ProofResponse } from "../proof/contracts";
import { tutorLinesOf } from "../proof/desk";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import type { ChatAction, ChatRunReport, WriteProofAction } from "../chat/contracts";
import type { FigureSpec } from "../figureDraw/contracts";

/**
 * The board chat writes two-column proofs (`write_proof`): the figure, `Given:` / `Prove:` and the
 * Statements | Reasons table in the tutor's hand — every row of a worked proof (the planner's rows,
 * never marked: they are the tutor's), or the table left empty for the student. The proof desk
 * knows the proof from the strokes' meta (the figure's read, the rows), so the student's rows in the
 * table get their ticks and rings, and Help / Solve continue it.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

/** A kite ABCD: AB ≅ CB, AD ≅ CD, its diagonal BD. */
const KITE: FigureSpec = {
  points: { A: { x: 0, y: 0 }, B: { x: 5, y: 4 }, C: { x: 10, y: 0 }, D: { x: 5, y: -8 } },
  polygons: [{ vertices: ["A", "B", "C", "D"] }],
  segments: [
    { from: "B", to: "D" },
    { from: "A", to: "B", ticks: 1 },
    { from: "C", to: "B", ticks: 1 },
    { from: "A", to: "D", ticks: 2 },
    { from: "C", to: "D", ticks: 2 },
  ],
};
const KITE_PROOF: WriteProofAction = {
  type: "write_proof",
  figure: KITE,
  given: ["\\overline{AB} \\cong \\overline{CB}", "\\overline{AD} \\cong \\overline{CD}"],
  prove: "\\triangle ABD \\cong \\triangle CBD",
  worked: false,
};
/** An isosceles triangle ABC (AB ≅ AC) with D the midpoint of BC. */
const ISOSCELES: FigureSpec = {
  points: { A: { x: 3, y: 5 }, B: { x: 0, y: 0 }, C: { x: 6, y: 0 }, D: { x: 3, y: 0 } },
  segments: [
    { from: "A", to: "B", ticks: 1 },
    { from: "A", to: "C", ticks: 1 },
    { from: "B", to: "D", ticks: 2 },
    { from: "D", to: "C", ticks: 2 },
    { from: "A", to: "D" },
  ],
};
const BASE_ANGLES: WriteProofAction = {
  type: "write_proof",
  figure: ISOSCELES,
  given: ["\\overline{AB} \\cong \\overline{AC}", "D \\text{ is the midpoint of } \\overline{BC}"],
  prove: "\\angle B \\cong \\angle C",
  worked: true,
};

describe("live loop — the board chat writes proofs", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let reads: string[];
  let proofBodies: ProofRequest[];

  function start(mode: UseLiveMathOptions["mode"]): void {
    loop?.stop();
    resetLiveStore();
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {},
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        proof: async (req): Promise<ProofResponse> => {
          proofBodies.push(req);
          throw new Error("no model in this test");
        },
      },
    );
    loop.start();
  }

  async function chat(actions: ChatAction[]): Promise<ChatRunReport> {
    let result: ChatRunReport | null = null;
    let error: unknown = null;
    loop.runChatActions(actions).then(
      (r) => (result = r),
      (e) => (error = e),
    );
    for (let i = 0; i < 600 && !result && !error; i++) await vi.advanceTimersByTimeAsync(50);
    if (error) throw error;
    if (!result) throw new Error("the chat never finished");
    return result;
  }

  /** The student writes one line: its ink goes on the board and the recognizer reads it as `latex`. */
  async function write(latex: string, x: number, y: number): Promise<InkStroke[]> {
    reads.push(latex);
    const ink = writeAt(latex, x, y);
    editor.putUser(ink.map((s) => drawShapeFromPoints(s.segments[0], s.id)));
    await vi.advanceTimersByTimeAsync(1_000);
    await settleUntil(() => Object.values(liveStore.lines.get()).some((st) => st.line.strokeIds.includes(ink[0].id as TLShapeId) && st.latex !== ""));
    await settleStable(() => `${fetchJson.mock.calls.length}|${editor.shapesOfType("draw").length}`, 6);
    reads.length = 0;
    return ink;
  }

  async function ask(action: () => void): Promise<void> {
    action();
    await settle();
    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS + 5_000);
    await settleStable(() => [proofBodies.length, editor.shapesOfType("draw").length, liveStore.solving.get()].join("|"));
  }

  const meta = (s: TLShape) => s.meta as Record<string, unknown>;
  const tutor = () => editor.getCurrentPageShapes().filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai");
  const ofBlock = (kind: string) => tutor().filter((s) => meta(s).chatBlock === kind);
  const inkOf = (latex: string) => tutor().filter((s) => meta(s).handLine === latex);
  const box = (shapes: readonly TLShape[]) => {
    const b = shapes.map((s) => editor.getShapePageBounds(s)!);
    return { x: Math.min(...b.map((r) => r.x)), y: Math.min(...b.map((r) => r.y)), r: Math.max(...b.map((r) => r.maxX)), b: Math.max(...b.map((r) => r.maxY)) };
  };
  const marks = (kind: "check" | "circle") => editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta) && String(meta(s).mark ?? "").startsWith(`${kind}:`));
  const lineOf = (ink: readonly InkStroke[]) => Object.values(liveStore.lines.get()).find((st) => st.line.strokeIds.includes(ink[0].id as TLShapeId))!;
  /** The tutor's proof lines (as the proof desk reads them back), in reading order: [latex, bounds]. */
  const proofLines = (skipBlocks: ReadonlySet<string> = new Set()): Array<[string, { x: number; y: number; w: number; h: number }]> => {
    const shapes = tutor()
      .filter((s) => typeof meta(s).proofRows === "string" && !skipBlocks.has(handBlockOf(s.meta)))
      .map((s) => ({ block: handBlockOf(s.meta), latex: String(meta(s).handLine), bounds: editor.getShapePageBounds(s)! }));
    return tutorLinesOf(shapes)
      .sort((a, b) => (Math.abs(a.bounds.y + a.bounds.h / 2 - (b.bounds.y + b.bounds.h / 2)) > 22 ? a.bounds.y - b.bounds.y : a.bounds.x - b.bounds.x))
      .map((l) => [l.latex, l.bounds]);
  };
  /** The rows written after the setup (by Help / Solve). */
  const helpRows = (setupBlocks: ReadonlySet<string>) => proofLines(setupBlocks);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    editor = createFakeEditor();
    const page = editor.getCurrentPage();
    editor.store.put([{ ...page, meta: { screen: { ...DEFAULT_SCREEN } } }]);
    reads = [];
    proofBodies = [];
    const byLine = new Map<string, string>();
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const req = body as RecognizeRequest;
      let latex = byLine.get(req.lineId);
      if (latex === undefined) {
        latex = reads.shift() ?? "";
        byLine.set(req.lineId, latex);
      }
      return { latex, text: latex, kind: "math", confidence: 0.98, provider: "mathpix", ms: 90 };
    });
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  it("worked: the figure, Given and Prove, the table and every row — the planner's, unmarked — beside each other on the screen", async () => {
    start("feedback");
    const report = await chat([BASE_ANGLES]);
    expect(report.outcomes).toEqual([{ type: "write_proof", ok: true }]);
    const figure = ofBlock("figure");
    expect(figure.length).toBeGreaterThan(5);
    expect(new Set(figure.map((s) => meta(s).proofFigure))).toEqual(new Set(["A:3,-5;B:0,0;C:6,0;D:3,0|AB,AC,BDC,AD"]));
    expect(handLinesOf(figure)).toEqual(expect.arrayContaining(["A", "B", "C", "D"]));
    const written = proofLines().map(([l]) => l);
    expect(written).toEqual([
      "\\text{Given: } \\overline{AB} \\cong \\overline{AC}, \\ D \\text{ is the midpoint of } \\overline{BC}",
      "\\text{Prove: } \\angle B \\cong \\angle C",
      "\\text{Statements}",
      "\\text{Reasons}",
      "\\overline{AB} \\cong \\overline{AC}",
      "\\text{Given}",
      "\\overline{AD} \\cong \\overline{AD}",
      "\\text{Reflexive}",
      "\\overline{BD} \\cong \\overline{DC}",
      "\\text{Def. of midpoint}",
      "\\triangle ABD \\cong \\triangle ACD",
      "\\text{SSS}",
      "\\angle B \\cong \\angle C",
      "\\text{CPCTC}",
    ]);
    // never the theorem being proved
    expect(written).not.toContain("\\text{Isos. } \\triangle \\text{ thm}");
    // on the screen, the figure clear of the writing
    const fig = box(figure);
    const text = box(ofBlock("proof"));
    for (const b of [fig, text]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.r).toBeLessThanOrEqual(1600);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.b).toBeLessThanOrEqual(900);
    }
    expect(text.r).toBeLessThan(fig.x);
    // the tutor's rows are never marked, and asking for more writes nothing: it is proved
    expect(marks("check")).toEqual([]);
    const before = tutor().length;
    await ask(() => loop.requestHelp());
    expect(tutor()).toHaveLength(before);
    expect(proofBodies).toEqual([]);
  });

  it("set up for the student: a right first row in the table gets a tick; Help writes the next row under it", async () => {
    start("suggest");
    const report = await chat([KITE_PROOF]);
    expect(report.outcomes).toEqual([{ type: "write_proof", ok: true }]);
    const setup = new Set(tutor().map((s) => handBlockOf(s.meta)));
    expect(proofLines().map(([l]) => l)).toEqual([
      "\\text{Given: } \\overline{AB} \\cong \\overline{CB}, \\ \\overline{AD} \\cong \\overline{CD}",
      "\\text{Prove: } \\triangle ABD \\cong \\triangle CBD",
      "\\text{Statements}",
      "\\text{Reasons}",
    ]);
    const statementsAt = box(inkOf("\\text{Statements}"));
    const reasonsAt = box(inkOf("\\text{Reasons}"));
    const rules = box(tutor().filter((s) => meta(s).proofTable === "rules"));
    expect(rules.b).toBeGreaterThan(700);

    // the student writes the first row in the table
    const y = statementsAt.b + 40;
    const statement = await write("\\overline{AB} \\cong \\overline{CB}", statementsAt.x + 4, y);
    const reason = await write("\\text{Given}", reasonsAt.x + 4, y + 4);
    await settleStable(() => String(marks("check").length));
    expect(new Set(marks("check").map((s) => (s.meta as { lineId: string }).lineId))).toEqual(new Set([lineOf(reason).line.id]));
    expect(marks("circle")).toEqual([]);

    // Help: the next row, in the tutor's hand, statement under the student's, reason in the reason column
    await ask(() => loop.requestHelp());
    expect(proofBodies).toEqual([]);
    const next = helpRows(setup);
    expect(next.map(([l]) => l)).toEqual(["\\overline{AD} \\cong \\overline{CD}", "\\text{Given}"]);
    const row = lineOf(statement).line.bounds;
    expect(Math.abs(next[0][1].x - row.x)).toBeLessThan(14);
    expect(next[0][1].y).toBeGreaterThan(row.y + row.h);
    expect(Math.abs(next[1][1].x - lineOf(reason).line.bounds.x)).toBeLessThan(14);
    expect(liveStore.lastError.get()).toBeNull();
  });

  it("set up and not begun: Help writes the first row under the header, its reason under Reasons", async () => {
    start("suggest");
    await chat([KITE_PROOF]);
    const setup = new Set(tutor().map((s) => handBlockOf(s.meta)));
    await ask(() => loop.requestHelp());
    const rows = helpRows(setup);
    expect(rows.map(([l]) => l)).toEqual(["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"]);
    const statementsAt = box(inkOf("\\text{Statements}"));
    const reasonsAt = box(inkOf("\\text{Reasons}"));
    expect(Math.abs(rows[0][1].x - statementsAt.x)).toBeLessThan(14);
    expect(Math.abs(rows[1][1].x - reasonsAt.x)).toBeLessThan(14);
    expect(rows[0][1].y).toBeGreaterThan(statementsAt.b);
    // Solve: the rest of it
    start("answer");
    await ask(() => loop.requestSolve());
    expect(helpRows(setup).map(([l]) => l)).toEqual([
      "\\overline{AB} \\cong \\overline{CB}",
      "\\text{Given}",
      "\\overline{AD} \\cong \\overline{CD}",
      "\\text{Given}",
      "\\overline{BD} \\cong \\overline{BD}",
      "\\text{Reflexive}",
      "\\triangle ABD \\cong \\triangle CBD",
      "\\text{SSS}",
    ]);
  });

  it("a proof the engine cannot prove is not written, and the panel is told", async () => {
    start("feedback");
    const report = await chat([{ ...KITE_PROOF, given: ["\\overline{AB} \\cong \\overline{CB}"] }]);
    expect(report.outcomes).toEqual([{ type: "write_proof", ok: false, note: "I couldn't check that proof, so I didn't write it." }]);
    expect(tutor()).toEqual([]);
  });

  it("a screen with work on it keeps it: the proof goes on a new screen", async () => {
    start("feedback");
    await write("2x + 3 = 11", 100, 200);
    const report = await chat([BASE_ANGLES]);
    expect(report).toMatchObject({ screensAdded: 1, outcomes: [{ type: "write_proof", ok: true }] });
    expect(editor.getPages()).toHaveLength(2);
    expect(ofBlock("figure").length).toBeGreaterThan(5);
  });
});
