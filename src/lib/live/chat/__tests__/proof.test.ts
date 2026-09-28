import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine, Rect } from "../../contracts";
import { getEngine } from "../../engine";
import type { FigureSpec } from "../../figureDraw/contracts";
import { planFigure } from "../../figureDraw";
import type { HandPlan } from "../../handwriting";
import { checkProof } from "../../proof/checker";
import { tutorLinesOf } from "../../proof/desk";
import { parseStatement } from "../../proof/facts";
import { buildFigure } from "../../proof/figure";
import { proofRowsPlan } from "../../proof/place";
import { proofProblem, readProofs } from "../../proof/read";
import { Resolver } from "../../proof/resolve";
import { decodeFigureRead, encodeFigureRead, tutorFiguresOf } from "../../proof/tutorFigure";
import { ALGEBRA_PROOF_EXAMPLE, PROOF_EXAMPLES } from "@/lib/server/prompts/chat";
import { ChatActionSchema, ChatResponseSchema, WriteProofSchema, type WriteProofAction } from "../contracts";
import { checkProofProposal, figureReadOf, PROOF_CHECK, type CheckedProof } from "../proof";
import { layoutProof, PROOF_LAYOUT, type ProofLayout } from "../proofLayout";
import { verifyLines } from "../verify";

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const SCREEN: Rect = { x: 0, y: 0, w: 1600, h: 900 };

/** The kite ABCD with both diagonals crossing at E: two congruences chained through CPCTC. */
const KITE_E: FigureSpec = {
  points: { A: { x: 0, y: 0 }, B: { x: 5, y: 4 }, C: { x: 10, y: 0 }, D: { x: 5, y: -8 }, E: { x: 5, y: 0 } },
  segments: [
    { from: "A", to: "B", ticks: 1 },
    { from: "C", to: "B", ticks: 1 },
    { from: "A", to: "D", ticks: 2 },
    { from: "C", to: "D", ticks: 2 },
    { from: "A", to: "C" },
    { from: "B", to: "D" },
  ],
};
const HARDEST: WriteProofAction = {
  type: "write_proof",
  figure: KITE_E,
  given: ["\\overline{AB} \\cong \\overline{CB}", "\\overline{AD} \\cong \\overline{CD}"],
  prove: "\\overline{AE} \\cong \\overline{CE}",
  worked: true,
};
/** An isosceles triangle with the median AD. */
const ISOSCELES: FigureSpec = {
  points: { A: { x: 3, y: 5 }, B: { x: 0, y: 0 }, C: { x: 6, y: 0 }, D: { x: 3, y: 0 } },
  segments: [
    { from: "A", to: "B" },
    { from: "A", to: "C" },
    { from: "B", to: "D" },
    { from: "D", to: "C" },
    { from: "A", to: "D" },
  ],
};

function proved(action: Pick<WriteProofAction, "figure" | "given" | "prove"> & { worked?: boolean }): CheckedProof {
  const v = checkProofProposal(action);
  if (!v.ok) throw new Error(v.problems.join(" | "));
  return v.proof;
}

describe("write_proof: the contract", () => {
  it("parses; a worked proof unless it says otherwise; a few givens, no $", () => {
    const a = ChatActionSchema.parse({ type: "write_proof", figure: KITE_E, given: ["\\overline{AB} \\cong \\overline{CB}"], prove: "\\overline{AE} \\cong \\overline{CE}" });
    expect(a).toMatchObject({ type: "write_proof", worked: true });
    expect(WriteProofSchema.safeParse({ ...HARDEST, worked: false }).success).toBe(true);
    expect(WriteProofSchema.safeParse({ ...HARDEST, given: [] }).success).toBe(false);
    expect(WriteProofSchema.safeParse({ ...HARDEST, given: Array(5).fill("\\overline{AB} \\cong \\overline{CB}") }).success).toBe(false);
    expect(WriteProofSchema.safeParse({ ...HARDEST, prove: "$\\overline{AE} \\cong \\overline{CE}$" }).success).toBe(false);
    expect(WriteProofSchema.safeParse({ ...HARDEST, figure: { points: { "1A": { x: 0, y: 0 } } } }).success).toBe(false);
    const res = ChatResponseSchema.parse({ reply: "Here.", actions: [HARDEST], model: "m", ms: 1 });
    expect(ChatResponseSchema.parse(JSON.parse(JSON.stringify(res)))).toEqual(res);
  });
});

describe("the figure as the proof reads it", () => {
  it("points y down, every drawn line through the named points on it, pieces of one line joined", () => {
    const read = figureReadOf(ISOSCELES);
    expect(read.points).toEqual({ A: [3, -5], B: [0, 0], C: [6, 0], D: [3, 0] });
    // BD and DC are one line, B–D–C
    expect(read.lines).toEqual(["AB", "AC", "BDC", "AD"]);
    // a point on a polygon's side is on that line; a line runs on past its points
    const poly = figureReadOf({ points: { A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 2, y: 3 }, M: { x: 2, y: 0 }, P: { x: 1, y: 0 } }, polygons: [{ vertices: ["A", "B", "C"] }], lines: [{ through: ["C", "M"] }] });
    expect(poly.lines).toEqual(["APMB", "BC", "AC", "CM"]);
    // numbered angle labels name their angles; names that are not one capital are left out
    const numbered = figureReadOf({ ...ISOSCELES, points: { ...ISOSCELES.points, P1: { x: 9, y: 9 } }, angles: [{ at: "A", from: "B", to: "D", label: "1" }] });
    expect(numbered.angles).toEqual({ "1": "BAD" });
    expect(numbered.points.P1).toBeUndefined();
  });

  it("round-trips through the strokes' meta, and is found again per block", () => {
    const read = figureReadOf(KITE_E);
    const s = encodeFigureRead(read);
    expect(s).toBe("A:0,0;B:5,-4;C:10,0;D:5,8;E:5,0|AB,BC,AD,CD,AEC,BED");
    expect(decodeFigureRead(s)).toEqual(read);
    expect(decodeFigureRead("nonsense")).toBeNull();
    expect(decodeFigureRead(42)).toBeNull();
    const figs = tutorFiguresOf([
      { block: "b1", meta: { proofFigure: s }, bounds: { x: 10, y: 10, w: 5, h: 5 } },
      { block: "b1", meta: { proofFigure: s }, bounds: { x: 100, y: 50, w: 5, h: 5 } },
      { block: "b2", meta: { chatBlock: "figure" }, bounds: { x: 0, y: 0, w: 1, h: 1 } },
    ]);
    expect(figs).toHaveLength(1);
    expect(figs[0].bounds).toEqual({ x: 10, y: 10, w: 95, h: 45 });
    expect(figs[0].read).toEqual(read);
  });
});

describe("checking a proposed proof", () => {
  it("a provable proof: the planner's rows, every one ticked by the checker, with the figure", () => {
    const proof = proved(HARDEST);
    expect(proof.given).toEqual(["\\overline{AB} \\cong \\overline{CB}", "\\overline{AD} \\cong \\overline{CD}"]);
    expect(proof.prove).toBe("\\overline{AE} \\cong \\overline{CE}");
    expect(proof.rows.map((r) => r.reason)).toEqual(["given", "given", "reflexive", "reflexive", "sss", "cpctc", "sas", "cpctc"]);
    const figure = buildFigure(proof.figure);
    const verdicts = checkProof(
      {
        givens: { facts: proof.givenFacts, complete: true },
        prove: { facts: proof.proveFacts, complete: true },
        rows: proof.rows.map((r) => ({ statement: { facts: r.facts, complete: true }, reason: r.reason })),
      },
      figure,
    );
    expect(verdicts.every((v) => v.verdict === "ok")).toBe(true);
  });

  it("the model's statements come back in the reader's forms; words only as the reader's phrases", () => {
    const proof = proved({ figure: ISOSCELES, given: ["AB ≅ AC", "D is the midpoint of BC"], prove: "∠B ≅ ∠C" });
    expect(proof.given).toEqual(["\\overline{AB} \\cong \\overline{AC}", "D \\text{ is the midpoint of } \\overline{BC}"]);
    expect(proof.prove).toBe("\\angle B \\cong \\angle C");
  });

  it("a proof OF the base angles theorem does not cite it: congruent halves, then CPCTC", () => {
    const proof = proved({ figure: ISOSCELES, given: ["\\overline{AB} \\cong \\overline{AC}", "D \\text{ is the midpoint of } \\overline{BC}"], prove: "\\angle B \\cong \\angle C" });
    expect(proof.rows.map((r) => r.reason)).not.toContain("isosceles");
    expect(proof.rows.at(-1)?.reason).toBe("cpctc");
    // with nothing to split the triangle, it cannot be proved without the theorem itself
    const bare = checkProofProposal({ figure: ISOSCELES, given: ["\\overline{AB} \\cong \\overline{AC}"], prove: "\\angle B \\cong \\angle C" });
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.problems[0]).toMatch(/may not cite Isos\. △ thm/);
  });

  it("an unprovable proof is refused with what the engine reached and what it proves with", () => {
    const v = checkProofProposal({ ...HARDEST, given: ["\\overline{AB} \\cong \\overline{CB}"] });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.problems[0]).toMatch(/could not prove \\overline\{AE\} \\cong \\overline\{CE\} from these givens with this figure\. From the givens it proves no two triangles congruent\./);
      expect(v.problems[1]).toMatch(/SSS, SAS, ASA, AAS, HL, CPCTC/);
    }
    // a rhombus's halves, with a vertical angle given: congruent in the drawing, not from the givens
    const rhombus: FigureSpec = {
      points: { A: { x: -4, y: 0 }, B: { x: 0, y: 5 }, C: { x: 4, y: 0 }, D: { x: 0, y: -5 }, E: { x: 0, y: 0 } },
      segments: ["AB", "BC", "AD", "DC", "AC", "BD"].map((s) => ({ from: s[0], to: s[1] })),
    };
    const w = checkProofProposal({ figure: rhombus, given: ["\\overline{AB} \\cong \\overline{CB}", "\\overline{AD} \\cong \\overline{CD}", "\\angle AEB \\cong \\angle CED"], prove: "\\triangle AEB \\cong \\triangle CED" });
    expect(w.ok).toBe(false);
    if (!w.ok) {
      expect(w.problems[0]).toMatch(/From the givens it proves \\triangle [A-E]{3} \\cong \\triangle [A-E]{3}/);
      expect(w.problems[0]).toMatch(/For \\triangle AEB \\cong \\triangle CED it has \\overline\{AE\} \\cong \\overline\{CE\}, \\angle BEA \\cong \\angle DEC/);
      expect(w.problems[0]).toMatch(/and not .*\\overline\{EB\} \\cong \\overline\{ED\}/);
    }
  });

  it("a figure that contradicts a given, a statement it cannot read, a point not in the figure, a bad name", () => {
    // the drawer's own check first (equal ticks on unequal sides)…
    const ticked = checkProofProposal({ ...HARDEST, figure: { ...KITE_E, points: { ...KITE_E.points, B: { x: 4, y: 4 } } } });
    expect(ticked.ok).toBe(false);
    if (!ticked.ok) expect(ticked.problems.join(" ")).toMatch(/AB and CB are marked equal/);
    // …then the givens against the drawing, with no marks to go by
    const skewed = checkProofProposal({ figure: { ...ISOSCELES, points: { ...ISOSCELES.points, B: { x: 1, y: 0 } } }, given: ["\\overline{AB} \\cong \\overline{AC}"], prove: "\\angle ABD \\cong \\angle ACD" });
    expect(skewed.ok).toBe(false);
    if (!skewed.ok) expect(skewed.problems[0]).toBe("The figure does not show \\overline{AB} \\cong \\overline{AC}: AB is drawn 5.39 long and AC 5.83. Place the points so they are equal.");
    const unread = checkProofProposal({ ...HARDEST, given: ["the sides are equal"] });
    expect(unread.ok).toBe(false);
    if (!unread.ok) expect(unread.problems[0]).toMatch(/could not be read/);
    const stranger = checkProofProposal({ ...HARDEST, prove: "\\overline{AF} \\cong \\overline{CF}" });
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.problems[0]).toMatch(/names F, which the figure does not have/);
    const named = checkProofProposal({ ...HARDEST, figure: { ...KITE_E, points: { ...KITE_E.points, P1: { x: 20, y: 20 } } } });
    expect(named.ok).toBe(false);
    if (!named.ok) expect(named.problems.join(" ")).toMatch(/one capital letter/);
    const isos = checkProofProposal({ ...HARDEST, given: ["\\triangle ABC \\text{ is isosceles}"] });
    expect(isos.ok).toBe(false);
    if (!isos.ok) expect(isos.problems[0]).toMatch(/state its congruent sides instead/);
  });

  it("the Prove is one of the givens: nothing to prove", () => {
    const v = checkProofProposal({ ...HARDEST, prove: "\\overline{AB} \\cong \\overline{CB}" });
    expect(v).toEqual({ ok: false, problems: ["The Prove statement is one of the givens: prove something that takes steps."] });
  });

  it("the hand must be able to write every line", () => {
    const v = checkProofProposal(HARDEST, { canWrite: (l) => !l.includes("CPCTC") });
    expect(v).toEqual({ ok: false, problems: ['The board\'s hand cannot write "\\text{CPCTC}".'] });
  });

  it("every proof the prompt shows is one the engine proves (a copied example still reaches the board)", () => {
    for (const e of PROOF_EXAMPLES) {
      const v = checkProofProposal(e.action);
      expect(v.ok, `${e.request}: ${v.ok ? "" : v.problems.join(" | ")}`).toBe(true);
      if (v.ok) expect(v.proof.rows.length).toBeLessThanOrEqual(PROOF_CHECK.maxRows);
    }
    const hardest = PROOF_EXAMPLES.find((e) => /hardest/.test(e.request))!;
    const rows = proved(hardest.action).rows;
    // demanding: overlapping triangles, three congruences chained through CPCTC, the most rows the board takes
    expect(rows.filter((r) => ["sss", "sas", "asa", "aas", "hl"].includes(r.reason))).toHaveLength(3);
    expect(rows.filter((r) => r.reason === "cpctc").length).toBeGreaterThanOrEqual(2);
    expect(rows).toHaveLength(PROOF_CHECK.maxRows);
    // and it lays out on the screen
    expect(laidOut(proved(hardest.action), hardest.action.figure, true).bounds.y + 1).toBeGreaterThan(0);
    expect(PROOF_EXAMPLES.find((e) => /to do/.test(e.request))?.action.worked).toBe(false);
  });
});

/** The tutor's lines of a laid-out proof, as the proof desk reads them back from its strokes. */
function tutorLines(layout: ProofLayout, include: ReadonlyArray<"statements" | "body"> = ["statements", "body"]) {
  const shapes: Array<{ block: string; latex: string; bounds: Rect }> = [];
  for (const key of include) {
    const plan: HandPlan = layout[key];
    for (const line of plan.lines) {
      for (const st of line.strokes) {
        const xs = st.points.map((p) => p.x + line.x);
        const ys = st.points.map((p) => p.y + line.y);
        shapes.push({ block: key, latex: line.latex, bounds: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(1, Math.max(...xs) - Math.min(...xs)), h: Math.max(1, Math.max(...ys) - Math.min(...ys)) } });
      }
    }
  }
  return tutorLinesOf(shapes);
}

function laidOut(proof: CheckedProof, spec: FigureSpec, worked: boolean): ProofLayout {
  const layout = layoutProof({
    screen: SCREEN,
    given: proof.given,
    prove: proof.prove,
    rows: worked ? proof.rows : null,
    figure: (box) => planFigure(spec, { seed: 7, box })?.plan ?? null,
    seed: 11,
  });
  if (!layout) throw new Error("no layout");
  return layout;
}

const inside = (r: Rect, s: Rect) => r.x >= s.x && r.y >= s.y && r.x + r.w <= s.x + s.w && r.y + r.h <= s.y + s.h;

describe("laying the proof out", () => {
  it("worked: on the screen, the figure top right and clear of the writing; it reads back as the same proof, row for row", () => {
    const proof = proved(HARDEST);
    const layout = laidOut(proof, KITE_E, true);
    expect(layout.size).toBe(PROOF_LAYOUT.sizes[0]);
    for (const part of [layout.figure, layout.statements, layout.table, layout.body]) expect(inside(part.bounds, SCREEN)).toBe(true);
    const text = [layout.statements.bounds, layout.table.bounds, layout.body.bounds];
    for (const t of text) expect(t.x + t.w).toBeLessThan(layout.figure.bounds.x);
    expect(layout.figure.bounds.y).toBeLessThan(120);

    const reads = readProofs(tutorLines(layout));
    expect(reads).toHaveLength(1);
    const problem = proofProblem(reads[0]);
    const r = new Resolver(buildFigure(proof.figure), [...proof.givenFacts, ...proof.proveFacts]);
    const keys = (facts: readonly Parameters<Resolver["factKey"]>[0][]) => facts.map((f) => r.factKey(f)).sort();
    expect(keys(problem.givens!.facts)).toEqual(keys(proof.givenFacts));
    expect(keys(problem.prove!.facts)).toEqual(keys(proof.proveFacts));
    expect(problem.rows.map((row) => row.reason)).toEqual(proof.rows.map((row) => row.reason));
    expect(problem.rows.map((row) => keys(row.statement!.facts))).toEqual(proof.rows.map((row) => keys(row.facts)));
    // the checker ticks every row of what it read, with the figure
    expect(checkProof(problem, buildFigure(proof.figure)).every((v) => v.verdict === "ok")).toBe(true);
    expect(reads[0].statementX).toBeCloseTo(layout.statementX, 0);
    expect(Math.abs(reads[0].reasonX - layout.reasonX)).toBeLessThan(8);
  });

  it("set up for the student: Given, Prove and the header read as a proof not begun; its first row goes under the header, between the rules", () => {
    const proof = proved({ ...HARDEST, worked: false });
    const layout = laidOut(proof, KITE_E, false);
    expect(layout.tableBottom).toBeGreaterThan(SCREEN.h - 60);
    const reads = readProofs(tutorLines(layout));
    expect(reads).toHaveLength(1);
    const read = reads[0];
    expect(read.rows).toEqual([]);
    expect(read.header.map((h) => h.latex)).toEqual(["\\text{Statements}", "\\text{Reasons}"]);
    expect(proofProblem(read).prove?.facts).toEqual(parseStatement("\\overline{AE} \\cong \\overline{CE}").facts);
    expect(read.statementX).toBeCloseTo(layout.statementX, 0);
    expect(Math.abs(read.reasonX - layout.reasonX)).toBeLessThan(8);
    expect(read.bottom).toBeLessThan(layout.barY);
    // the row Help writes: under the rule, statement left of the divider, reason right of it
    const row = proofRowsPlan(read, [{ statement: proof.rows[0].statement, reasonLatex: proof.rows[0].reasonLatex }], { size: 28, seed: 1 })!;
    expect(row.bounds.y).toBeGreaterThan(layout.barY);
    const [statement, reason] = row.lines;
    expect(statement.x + Math.max(...statement.strokes.flatMap((s) => s.points.map((p) => p.x)))).toBeLessThan(layout.dividerX);
    expect(reason.x).toBeGreaterThan(layout.dividerX);
  });

  it("the longest proof the board takes still fits, at a smaller hand", () => {
    // ten rows: a long Given line and every row of a two-congruence proof, twice as wide
    const rows = Array.from({ length: PROOF_CHECK.maxRows }, (_, i) => ({ statement: `\\triangle ABE \\cong \\triangle CBE`, reasonLatex: i % 2 ? "\\text{Def. of seg. bisector}" : "\\text{CPCTC}" }));
    const layout = layoutProof({
      screen: SCREEN,
      given: ["\\overline{AB} \\cong \\overline{CB}", "\\overline{AD} \\cong \\overline{CD}", "E \\text{ is the midpoint of } \\overline{AC}", "\\overline{BD} \\perp \\overline{AC}"],
      prove: "\\triangle ABE \\cong \\triangle CBE",
      rows,
      figure: (box) => planFigure(KITE_E, { seed: 7, box })?.plan ?? null,
      seed: 3,
    });
    expect(layout).not.toBeNull();
    expect(inside(layout!.bounds, SCREEN)).toBe(true);
    expect(layout!.size).toBeLessThan(PROOF_LAYOUT.sizes[0]);
    // rows stay apart: two identical reasons are two lines to the reader
    expect(readProofs(tutorLines(layout!))[0].rows).toHaveLength(PROOF_CHECK.maxRows);
  });
});

describe("the prompt's algebra proof", () => {
  it("is maths lines, every step checked equal by the engine", () => {
    expect(verifyLines(engine, ALGEBRA_PROOF_EXAMPLE.lines)).toEqual({ ok: true });
  });
});
