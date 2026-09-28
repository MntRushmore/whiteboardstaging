import { describe, expect, it } from "vitest";
import { tutorLinesOf, stripLabel } from "../desk";
import { classifyLine, proofProblem, readProofs, type BoardLine } from "../read";

let n = 0;
const line = (latex: string, x: number, y: number, w = 220, h = 40): BoardLine => ({ id: `ln_${++n}`, latex, bounds: { x, y, w, h } });

/** A proof as a student lays it out: Given, Prove, then rows (statement at x = 100, reason at x = 620). */
function board(rows: Array<[string, string | null]>, opts: { given?: string; prove?: string; header?: boolean; top?: number } = {}): BoardLine[] {
  const top = opts.top ?? 100;
  const out: BoardLine[] = [];
  if (opts.given !== undefined) out.push(line(opts.given, 100, top, 600));
  if (opts.prove !== undefined) out.push(line(opts.prove, 100, top + 60, 400));
  let y = top + 140;
  if (opts.header) {
    out.push(line("\\text{Statements}", 100, y, 200), line("\\text{Reasons}", 620, y, 160));
    y += 60;
  }
  for (const [s, r] of rows) {
    out.push(line(s, 100, y, 300));
    if (r) out.push(line(r, 620, y + 4, 160, 36));
    y += 60;
  }
  return out;
}

const GIVEN = "\\text{Given: } \\overline{AB} \\cong \\overline{CB}, \\ \\overline{AD} \\cong \\overline{CD}";
const PROVE = "\\text{Prove: } \\triangle ABD \\cong \\triangle CBD";

describe("reading a proof off the board", () => {
  it("classifies the lines", () => {
    expect(classifyLine(GIVEN).role).toBe("given");
    expect(classifyLine("\\text { Given : } \\overline{A B} \\cong \\overline{C B}").role).toBe("given");
    expect(classifyLine(PROVE).role).toBe("prove");
    // text mode, as Mathpix returns a line of words and maths
    expect(classifyLine("Given: \\( E \\) is the midpoint of \\( \\overline{A D} \\)")).toMatchObject({ role: "given", statement: { complete: true } });
    expect(classifyLine("\\text{Given}").role).toBe("reason");
    expect(classifyLine("SAS").role).toBe("reason");
    expect(classifyLine("\\text{Statements}").role).toBe("header");
    expect(classifyLine("\\overline{AB} \\cong \\overline{CB}").role).toBe("statement");
    expect(classifyLine("x + 2 = 5").role).toBe("other");
    // a statement and its reason read as one line (written close together)
    expect(classifyLine("\\triangle A B D \\cong \\triangle C B D \\quad S S S")).toMatchObject({ role: "row", reason: "sss" });
    expect(classifyLine("\\overline{A B} \\cong \\overline{C B} \\quad \\text { Given }")).toMatchObject({ role: "row", reason: "given" });
    expect(classifyLine("\\angle AEB \\cong \\angle DEC \\text{ Vertical } \\angle s")).toMatchObject({ role: "row", reason: "vertical" });
    expect(stripLabel(GIVEN)).toBe("\\overline{AB} \\cong \\overline{CB}, \\ \\overline{AD} \\cong \\overline{CD}");
  });

  it("pairs each reason with the statement level with it, top to bottom, and finds Given and Prove", () => {
    const lines = board(
      [
        ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
        ["\\overline{AD} \\cong \\overline{CD}", "\\text{Given}"],
        ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
        ["\\triangle ABD \\cong \\triangle CBD", "SSS"],
      ],
      { given: GIVEN, prove: PROVE, header: true },
    );
    const proofs = readProofs(lines);
    expect(proofs).toHaveLength(1);
    const p = proofs[0];
    expect(p.rows.map((r) => [r.statement?.latex, r.reason?.latex])).toEqual([
      ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
      ["\\overline{AD} \\cong \\overline{CD}", "\\text{Given}"],
      ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle CBD", "SSS"],
    ]);
    expect(p.given.map((l) => l.latex)).toEqual([GIVEN]);
    expect(p.prove.map((l) => l.latex)).toEqual([PROVE]);
    expect(p.header).toHaveLength(2);
    expect(p.lineIds).toHaveLength(lines.length);
    expect(p.statementX).toBe(100);
    expect(p.reasonX).toBe(620);
    expect(p.rowPitch).toBe(60);
    const problem = proofProblem(p);
    expect(problem.givens?.facts).toHaveLength(2);
    expect(problem.prove?.facts).toEqual([{ t: "triCong", x: ["A", "B", "D"], y: ["C", "B", "D"] }]);
    expect(problem.rows.map((r) => r.reason)).toEqual(["given", "given", "reflexive", "sss"]);
  });

  it("a statement still waiting for its reason is a row too; a Given continued on the next line is the Given", () => {
    const lines = [
      line("\\text{Given: } \\overline{AB} \\cong \\overline{CB},", 100, 100, 500),
      line("\\overline{AD} \\cong \\overline{CD}", 180, 150, 260),
      line(PROVE, 100, 210, 400),
      line("\\overline{AB} \\cong \\overline{CB}", 100, 300, 260),
      line("\\text{Given}", 620, 304, 140, 36),
      line("\\overline{AD} \\cong \\overline{CD}", 100, 360, 260),
      line("\\text{Given}", 620, 364, 140, 36),
      line("\\overline{BD} \\cong \\overline{BD}", 100, 420, 260),
    ];
    const [p] = readProofs(lines);
    expect(p.given).toHaveLength(2);
    expect(proofProblem(p).givens?.facts).toHaveLength(2);
    expect(p.rows.map((r) => [r.statement?.latex ?? null, r.reason?.latex ?? null])).toEqual([
      ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
      ["\\overline{AD} \\cong \\overline{CD}", "\\text{Given}"],
      ["\\overline{BD} \\cong \\overline{BD}", null],
    ]);
    expect(p.bottom).toBe(460);
  });

  it("a row the clusterer read as one line is split at its reason", () => {
    const lines = [line(GIVEN, 100, 100, 600), line(PROVE, 100, 160, 400), line("\\overline{A B} \\cong \\overline{C B} \\quad \\text { Given }", 100, 240, 520), line("\\overline{AD} \\cong \\overline{CD}", 100, 300, 260), line("\\text{Given}", 620, 304, 140, 36)];
    const [p] = readProofs(lines);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0].merged?.latex).toContain("Given");
    expect(proofProblem(p).rows.map((r) => r.reason)).toEqual(["given", "given"]);
  });

  it("Given and Prove alone are a proof the tutor can start; lines of algebra are not a proof", () => {
    const [p] = readProofs([line(GIVEN, 100, 100, 600), line(PROVE, 100, 160, 400)]);
    expect(p.rows).toEqual([]);
    expect(p.bottom).toBe(200);
    expect(readProofs([line("2x + 3 = 11", 100, 100), line("2x = 8", 100, 160), line("x = 4", 100, 220)])).toEqual([]);
    // one statement and a reason, no Given / Prove / header: not enough to call it a proof
    expect(readProofs([line("\\overline{AB} \\cong \\overline{CD}", 100, 100), line("\\text{Given}", 620, 104, 140, 36)])).toEqual([]);
  });

  it("with no rows yet, sizes come from the Prove line: two givens read as one line do not double them", () => {
    // `Given: E is the midpoint of AD` with `E is midpoint of BC` under it, read as one 100 px line
    const [p] = readProofs([line("\\text{Given: } E \\text{ is the midpoint of } \\overline{AD} \\ E \\text{ is midpoint of } \\overline{BC}", 100, 100, 600, 100), line(PROVE, 100, 220, 400)]);
    expect(p.lineHeight).toBe(40);
    expect(p.rowPitch).toBe(72);
    // the reason column starts near the statements, not a screen's width away (a figure drawn beside)
    expect(p.reasonX).toBe(100 + 7 * 40);
  });

  it("the tutor's rows come back as lines (a reason written twice in one block is two lines)", () => {
    const shapes = [
      { block: "hb_1", latex: "\\overline{BD} \\cong \\overline{BD}", bounds: { x: 100, y: 400, w: 120, h: 30 } },
      { block: "hb_1", latex: "\\overline{BD} \\cong \\overline{BD}", bounds: { x: 230, y: 402, w: 60, h: 28 } },
      { block: "hb_1", latex: "\\text{Given}", bounds: { x: 620, y: 402, w: 90, h: 28 } },
      { block: "hb_1", latex: "\\text{Given}", bounds: { x: 620, y: 462, w: 90, h: 28 } },
    ];
    const lines = tutorLinesOf(shapes);
    expect(lines.map((l) => [l.latex, l.bounds.y])).toEqual([
      ["\\overline{BD} \\cong \\overline{BD}", 400],
      ["\\text{Given}", 402],
      ["\\text{Given}", 462],
    ]);
    expect(lines.every((l) => l.tutor)).toBe(true);
  });
});
