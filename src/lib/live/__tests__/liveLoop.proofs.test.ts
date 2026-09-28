import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape, TLShapeId } from "tldraw";
import { boundsOf, DRAWINGS, writeAt } from "@/__eval__/drawings";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { drawShapeFromPoints } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { isLiveMeta, type InkStroke, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse, type UseLiveMathOptions } from "../contracts";
import { getEngine } from "../engine";
import { handLinesOf } from "../handwriting";
import { ANSWER_SETTLE_MS, createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import type { ProofRequest, ProofResponse } from "../proof/contracts";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * Two-column proofs on the board (`src/lib/live/proof`, `ProofDesk`): the rows are paired and
 * checked as a proof — a tick after a verified row's reason, a ring round the wrong half of a wrong
 * row — and Help / Solve write the next row (the rest, in Solve) in the tutor's hand, statement in
 * the statement column and reason in the reason column, from the engine's planner; the model is
 * asked only when the planner cannot finish, and its row is written only when the checker ticks it.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const CROP = "data:image/jpeg;base64,ZmFrZQ==";
class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(_blob: Blob): void {
    void _blob;
    this.result = CROP;
    queueMicrotask(() => this.onload?.());
  }
}

const GIVEN = "\\text{Given: } \\overline{AB} \\cong \\overline{CB}, \\ \\overline{AD} \\cong \\overline{CD}";
const PROVE = "\\text{Prove: } \\triangle ABD \\cong \\triangle CBD";
const ROWS: Array<[string, string]> = [
  ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
  ["\\overline{AD} \\cong \\overline{CD}", "\\text{Given}"],
  ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
  ["\\triangle ABD \\cong \\triangle CBD", "\\text{SSS}"],
];
const STATEMENT_X = 100;
const REASON_X = 640;
const rowY = (i: number) => 260 + 80 * i;

describe("live loop — two-column proofs", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let reads: string[];
  let calls: string[];
  let proofBodies: ProofRequest[];
  let proofReply: (req: ProofRequest) => ProofResponse | Error;

  function start(mode: UseLiveMathOptions["mode"]): void {
    loop?.stop();
    resetLiveStore();
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true },
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
        setup: async () => {
          throw new Error("no setup in this file");
        },
        reread: async () => {
          throw new Error("no second reader in this file");
        },
        proof: async (req) => {
          proofBodies.push(req);
          const r = proofReply(req);
          if (r instanceof Error) throw r;
          return r;
        },
      },
    );
    loop.start();
  }

  /** Writes one line: its ink goes on the board and the recognizer reads it as `read`. */
  async function write(latex: string, x: number, y: number, read = latex.replace(/\s+/g, " ")): Promise<InkStroke[]> {
    reads.push(read);
    const ink = writeAt(latex, x, y);
    editor.putUser(ink.map((s) => drawShapeFromPoints(s.segments[0], s.id)));
    await vi.advanceTimersByTimeAsync(1_000);
    // until this line's read has landed (and the marks it moves after it)
    await settleUntil(() => Object.values(liveStore.lines.get()).some((st) => st.line.strokeIds.includes(ink[0].id as TLShapeId) && st.latex !== ""));
    await settleStable(() => `${fetchJson.mock.calls.length}|${editor.shapesOfType("math").length}|${editor.shapesOfType("draw").length}`, 6);
    // the same ink written again (a second `Given`) is read from the recognition cache: its read is not asked for
    reads.length = 0;
    return ink;
  }

  async function writeProof(rows: Array<[string, string]>, opts: { header?: boolean } = {}): Promise<Array<{ statement: InkStroke[]; reason: InkStroke[] }>> {
    await write(GIVEN, STATEMENT_X, 100);
    await write(PROVE, STATEMENT_X, 170);
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const statement = await write(rows[i][0], STATEMENT_X, rowY(i));
      const reason = await write(rows[i][1], REASON_X, rowY(i) + 4);
      out.push({ statement, reason });
    }
    void opts;
    return out;
  }

  async function run(action: () => void): Promise<void> {
    action();
    await settle();
    await vi.advanceTimersByTimeAsync(ANSWER_SETTLE_MS + 5_000);
    await settleStable(() => [proofBodies.length, fetchJson.mock.calls.length, editor.shapesOfType("draw").length, liveStore.solving.get()].join("|"));
  }

  const meta = (s: TLShape) => s.meta as Record<string, unknown>;
  const tutorRows = () => editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta) && typeof meta(s).proofRows === "string");
  const marks = (kind: "check" | "circle" | "question") => editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta) && String(meta(s).mark ?? "").startsWith(`${kind}:`));
  const lineOf = (ink: readonly InkStroke[]) => Object.values(liveStore.lines.get()).find((st) => st.line.strokeIds.includes(ink[0].id as TLShapeId))!;
  const markedLines = (kind: "check" | "circle") => new Set(marks(kind).map((s) => (s.meta as { lineId: string }).lineId));
  /** The tutor's rows as a table: each written line at its place, grouped into rows, left to right. */
  const tutorTable = (): string[] => {
    const lines = new Map<string, { x: number; y: number }>();
    for (const s of tutorRows()) {
      const k = String(meta(s).handLine);
      const cur = lines.get(k);
      lines.set(k, { x: Math.min(cur?.x ?? Infinity, s.x), y: Math.min(cur?.y ?? Infinity, s.y) });
    }
    return [...lines.entries()].sort((a, b) => (Math.abs(a[1].y - b[1].y) > 25 ? a[1].y - b[1].y : a[1].x - b[1].x)).map(([k]) => k);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubGlobal("FileReader", FakeFileReader);
    editor = createFakeEditor(undefined, undefined);
    editor.toImage = (async () => ({ blob: new Blob(["jpeg-bytes"], { type: "image/jpeg" }), width: 300, height: 200 })) as unknown as FakeEditor["toImage"];
    reads = [];
    calls = [];
    proofBodies = [];
    proofReply = () => new Error("no model in this test");
    const byLine = new Map<string, string>();
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const req = body as RecognizeRequest;
      // a line read again (its ink regrouped for a moment) reads the same; a new line takes the next read
      let latex = req.lineId.startsWith("dg_") ? "\\begin{array}{l} A \\\\ B \\\\ C \\\\ D \\end{array}" : byLine.get(req.lineId);
      if (latex === undefined) {
        latex = reads.shift() ?? "";
        byLine.set(req.lineId, latex);
      }
      return { latex, text: latex, kind: "math", confidence: 0.98, provider: "mathpix", ms: 90 };
    });
    start("feedback");
  });

  afterEach(() => {
    loop.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("Feedback: every verified row gets a tick after its reason; the wrong row a ring; no model, no words", async () => {
    const rows = await writeProof([...ROWS.slice(0, 3), ["\\triangle ABD \\cong \\triangle CBD", "\\text{SAS}"]]);
    const checked = markedLines("check");
    const ringed = markedLines("circle");
    for (let i = 0; i < 3; i++) {
      expect(checked.has(lineOf(rows[i].reason).line.id), `row ${i + 1} reason`).toBe(true);
      expect(checked.has(lineOf(rows[i].statement).line.id), `row ${i + 1} statement`).toBe(false);
    }
    // SAS with three sides and no angle: the reason is wrong
    expect(ringed).toEqual(new Set([lineOf(rows[3].reason).line.id]));
    expect(checked.has(lineOf(rows[3].reason).line.id)).toBe(false);
    expect(marks("question")).toEqual([]);
    expect(calls).toEqual([]);
    expect(proofBodies).toEqual([]);
    // the proof's lines are not the engine's equations (no stray analysis, no echo badge but the row's)
    expect(liveStore.lines.get()[lineOf(rows[2].statement).line.id].analysis?.kind).toBe("label");
  });

  it("the wrong correspondence is ringed on the statement", async () => {
    const rows = await writeProof([...ROWS.slice(0, 3), ["\\triangle ABD \\cong \\triangle CDB", "\\text{SSS}"]]);
    expect(markedLines("circle")).toEqual(new Set([lineOf(rows[3].statement).line.id]));
  });

  it("Suggest: Help writes the next row in the tutor's hand, statement and reason in their columns under the last row", async () => {
    start("suggest");
    const rows = await writeProof(ROWS.slice(0, 2));
    await run(() => loop.requestHelp());
    expect(proofBodies).toEqual([]);
    const ink = tutorRows();
    expect(handLinesOf(ink)).toEqual(["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"]);
    const statementInk = ink.filter((s) => meta(s).handLine === "\\overline{BD} \\cong \\overline{BD}");
    const reasonInk = ink.filter((s) => meta(s).handLine === "\\text{Reflexive}");
    const sx = Math.min(...statementInk.map((s) => s.x));
    const rx = Math.min(...reasonInk.map((s) => s.x));
    const lastRow = lineOf(rows[1].statement).line.bounds;
    const firstReason = lineOf(rows[0].reason).line.bounds;
    expect(Math.abs(sx - lastRow.x)).toBeLessThan(12);
    expect(Math.abs(rx - firstReason.x)).toBeLessThan(12);
    const top = Math.min(...ink.map((s) => s.y));
    expect(top).toBeGreaterThan(lastRow.y + lastRow.h);
    expect(top).toBeLessThan(lastRow.y + lastRow.h + 90);
    // on one writing line: the statement's and the reason's ink overlap vertically
    const sy = Math.max(...statementInk.map((s) => s.y));
    const ry = Math.min(...reasonInk.map((s) => s.y));
    expect(Math.abs(sy - ry)).toBeLessThan(40);
    expect(liveStore.lastError.get()).toBeNull();
    expect(liveStore.solving.get()).toBe(0);

    // asked again: the row after it (the tutor's row counts as written)
    await run(() => loop.requestHelp());
    expect(tutorTable()).toEqual(["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}", "\\triangle ABD \\cong \\triangle CBD", "\\text{SSS}"]);
    // and once proved, nothing more
    const count = tutorRows().length;
    await run(() => loop.requestHelp());
    expect(tutorRows()).toHaveLength(count);
    expect(liveStore.lastError.get()).toBeNull();
  });

  it("Solve writes the rest of the proof; the student's next row after the tutor's is checked against it", async () => {
    start("answer");
    const rows = await writeProof(ROWS.slice(0, 1));
    await run(() => loop.requestSolve(lineOf(rows[0].reason).line.id));
    expect(tutorTable()).toEqual([
      "\\overline{AD} \\cong \\overline{CD}",
      "\\text{Given}",
      "\\overline{BD} \\cong \\overline{BD}",
      "\\text{Reflexive}",
      "\\triangle ABD \\cong \\triangle CBD",
      "\\text{SSS}",
    ]);
    expect(proofBodies).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("the model is asked only when the planner cannot finish, and its row is written only when the checker ticks it", async () => {
    start("suggest");
    // no figure drawn: the vertical angles cannot be found, so the planner cannot finish
    const given = "\\text{Given: } E \\text{ is the midpoint of } \\overline{AD}";
    await write(given, STATEMENT_X, 100);
    await write("\\text{Prove: } \\triangle ABE \\cong \\triangle DCE", STATEMENT_X, 170);
    await write("E \\text{ is the midpoint of } \\overline{AD}", STATEMENT_X, rowY(0));
    await write("\\text{Given}", REASON_X, rowY(0) + 4);

    // a row the checker cannot confirm (the figure is not read) is not written
    proofReply = () => ({ row: { statement: "\\angle AEB \\cong \\angle DEC", reason: "\\text{Vertical } \\angle s" }, model: "openai/gpt-5.4-mini", ms: 900 });
    await run(() => loop.requestHelp());
    expect(proofBodies).toHaveLength(1);
    expect(proofBodies[0]).toMatchObject({ task: "step", prove: "\\triangle ABE \\cong \\triangle DCE", givens: ["E \\text{ is the midpoint of } \\overline{AD}"] });
    expect(proofBodies[0].rows).toEqual([{ statement: "E \\text{ is the midpoint of } \\overline{AD}", reason: "\\text{Given}" }]);
    expect(tutorRows()).toEqual([]);
    expect(liveStore.lastError.get()?.message).toBe("Couldn't work this out");

    // a row it ticks is written, in the tutor's own form
    proofReply = () => ({ row: { statement: "AE = ED", reason: "def of midpt" }, model: "openai/gpt-5.4-mini", ms: 900 });
    await run(() => loop.requestHelp());
    expect(tutorTable()).toEqual(["\\overline{AE} \\cong \\overline{ED}", "\\text{Def. of midpoint}"]);
  });

  it("a figure beside the proof is read once, and the planner finishes with it", async () => {
    start("answer");
    proofReply = (req) =>
      req.task === "figure"
        ? { figure: { points: { A: [0, 50], B: [50, 0], C: [100, 50], D: [50, 110] }, lines: ["AB", "BC", "CD", "DA", "BD"] }, model: "openai/gpt-5.4-mini", ms: 1200 }
        : new Error("no step");
    const given = "\\text{Given: } \\overline{AB} \\cong \\overline{CB}, \\ \\angle ABD \\cong \\angle CBD";
    await write(given, STATEMENT_X, 100);
    await write("\\text{Prove: } \\angle A \\cong \\angle C", STATEMENT_X, 170);
    const tri = DRAWINGS.triangle(1000, 90, 2);
    editor.putUser([...tri.strokes, ...tri.labels.flat()].map((s) => drawShapeFromPoints(s.segments[0], s.id)));
    await vi.advanceTimersByTimeAsync(1_000);
    await settleStable(() => `${fetchJson.mock.calls.length}|${liveStore.diagrams.get().length}`);
    const row = await write(ROWS[0][0], STATEMENT_X, rowY(0));
    await write(ROWS[0][1], REASON_X, rowY(0) + 4);
    expect(liveStore.diagrams.get()).toHaveLength(1);

    await run(() => loop.requestSolve(lineOf(row).line.id));
    expect(proofBodies.map((b) => b.task)).toEqual(["figure"]);
    expect(proofBodies[0]).toMatchObject({ crop: CROP, prove: "\\angle A \\cong \\angle C" });
    expect(tutorTable()).toEqual([
      "\\angle ABD \\cong \\angle CBD",
      "\\text{Given}",
      "\\overline{BD} \\cong \\overline{BD}",
      "\\text{Reflexive}",
      "\\triangle ABD \\cong \\triangle CBD",
      "\\text{SAS}",
      "\\angle A \\cong \\angle C",
      "\\text{CPCTC}",
    ]);
    // the figure is not read again
    await run(() => loop.requestSolve(lineOf(row).line.id));
    expect(proofBodies.map((b) => b.task)).toEqual(["figure"]);
    void boundsOf;
  });

  it("lines that are not a proof keep the engine's marks", async () => {
    const eq = await write("2x + 3 = 11", 100, 100, "2 x+3=11");
    const step = await write("2x = 8", 100, 180, "2 x=8");
    expect(markedLines("check").has(lineOf(step).line.id)).toBe(true);
    expect(liveStore.lines.get()[lineOf(eq).line.id].analysis?.kind).toBe("equation");
  });
});
