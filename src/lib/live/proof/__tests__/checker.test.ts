import { describe, expect, it } from "vitest";
import { checkProof, type ProofProblem } from "../checker";
import { parseStatement } from "../facts";
import { buildFigure, rayRep, type FigureRead } from "../figure";
import { planProof } from "../planner";
import { Resolver } from "../resolve";
import { normalizeReason, resolveBisector } from "../vocab";

const KITE: FigureRead = { points: { A: [0, 50], B: [50, 0], C: [100, 50], D: [50, 110] }, lines: ["AB", "BC", "CD", "DA", "BD"] };
const CROSS: FigureRead = { points: { A: [0, 0], B: [0, 100], C: [100, 0], D: [100, 100], E: [50, 50] }, lines: ["AED", "BEC", "AB", "CD"] };
const PARALLELOGRAM: FigureRead = { points: { A: [0, 0], B: [100, 0], C: [130, 80], D: [30, 80] }, lines: ["AB", "BC", "CD", "DA", "BD"] };

function problem(given: string | null, prove: string, rows: Array<[string, string]>): ProofProblem {
  return {
    givens: given === null ? null : parseStatement(given),
    prove: parseStatement(prove),
    rows: rows.map(([s, r]) => {
      const statement = s ? parseStatement(s) : null;
      return { statement, reason: r ? resolveBisector(normalizeReason(r), statement?.facts.some((f) => f.t === "angCong") ?? false) : null };
    }),
  };
}
const verdicts = (p: ProofProblem, fig: FigureRead | null = null) => checkProof(p, fig ? buildFigure(fig) : null).map((v) => `${v.verdict}${v.verdict === "ok" ? "" : `:${v.why}`}`);

const SSS_KITE: Array<[string, string]> = [
  ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
  ["\\overline{AD} \\cong \\overline{CD}", "\\text{Given}"],
  ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
  ["\\triangle ABD \\cong \\triangle CBD", "\\text{SSS}"],
];
const GIVEN_KITE = "\\overline{AB} \\cong \\overline{CB}, \\ \\overline{AD} \\cong \\overline{CD}";

describe("proof checker", () => {
  it("ticks a correct SSS proof row by row", () => {
    expect(verdicts(problem(GIVEN_KITE, "\\triangle ABD \\cong \\triangle CBD", SSS_KITE))).toEqual(["ok", "ok", "ok", "ok"]);
  });

  it("the correspondence is the vertex order: △ABD ≅ △CDB is ringed on its statement", () => {
    const rows = [...SSS_KITE.slice(0, 3), ["\\triangle ABD \\cong \\triangle CDB", "\\text{SSS}"] as [string, string]];
    const v = checkProof(problem(GIVEN_KITE, "\\triangle ABD \\cong \\triangle CBD", rows), null);
    expect(v[3]).toEqual({ verdict: "wrong", why: "wrong-correspondence", part: "statement" });
    // the same triangles in an equivalent order are the same statement
    const rotated = [...SSS_KITE.slice(0, 3), ["\\triangle BDA \\cong \\triangle BDC", "\\text{SSS}"] as [string, string]];
    expect(verdicts(problem(GIVEN_KITE, "\\triangle ABD \\cong \\triangle CBD", rotated))[3]).toBe("ok");
  });

  it("a missing shared side is a missing prerequisite, ringed on the reason", () => {
    const v = checkProof(problem(GIVEN_KITE, "\\triangle ABD \\cong \\triangle CBD", [SSS_KITE[0], SSS_KITE[1], SSS_KITE[3]]), null);
    expect(v[2]).toEqual({ verdict: "wrong", why: "missing-prerequisite", part: "reason" });
  });

  it("SSA written as SAS is ringed as SSA; SSA and AAA as reasons are always wrong", () => {
    const given = "\\overline{AB} \\cong \\overline{CB}, \\ \\angle A \\cong \\angle C";
    const rows: Array<[string, string]> = [
      ["\\overline{AB} \\cong \\overline{CB}", "\\text{Given}"],
      ["\\angle A \\cong \\angle C", "\\text{Given}"],
      ["\\overline{BD} \\cong \\overline{BD}", "\\text{Reflexive}"],
      ["\\triangle ABD \\cong \\triangle CBD", "\\text{SAS}"],
    ];
    expect(verdicts(problem(given, "\\triangle ABD \\cong \\triangle CBD", rows), KITE)[3]).toBe("wrong:ssa");
    rows[3] = ["\\triangle ABD \\cong \\triangle CBD", "\\text{SSA}"];
    expect(verdicts(problem(given, "\\triangle ABD \\cong \\triangle CBD", rows), KITE)[3]).toBe("wrong:ssa");
  });

  it("a Given must be on the Given line; with no Given line it is left unmarked", () => {
    const rows: Array<[string, string]> = [["\\overline{BD} \\cong \\overline{BD}", "\\text{Given}"]];
    expect(verdicts(problem(GIVEN_KITE, "\\triangle ABD \\cong \\triangle CBD", rows))).toEqual(["wrong:not-given"]);
    expect(verdicts(problem(null, "\\triangle ABD \\cong \\triangle CBD", rows))).toEqual(["unknown:no-given-line"]);
    // a given written another way is the same given
    expect(verdicts(problem(GIVEN_KITE, "\\triangle ABD \\cong \\triangle CBD", [["\\overline{CB} \\cong \\overline{BA}", "\\text{Given}"]]))).toEqual(["ok"]);
  });

  it("CPCTC before any congruence is ringed; after one, its parts must correspond", () => {
    const given = "\\overline{AB} \\cong \\overline{CB}, \\ \\overline{AD} \\cong \\overline{CD}";
    expect(verdicts(problem(given, "\\angle A \\cong \\angle C", [["\\angle A \\cong \\angle C", "\\text{CPCTC}"]]), KITE)).toEqual(["wrong:cpctc-too-early"]);
    const rows: Array<[string, string]> = [...SSS_KITE, ["\\angle A \\cong \\angle C", "\\text{CPCTC}"]];
    expect(verdicts(problem(given, "\\angle A \\cong \\angle C", rows), KITE)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    rows[4] = ["\\overline{AB} \\cong \\overline{CD}", "\\text{CPCTC}"];
    expect(verdicts(problem(given, "\\angle A \\cong \\angle C", rows), KITE)[4]).toBe("wrong:cpctc-not-corresponding");
  });

  it("never rings on something missing while a row above is unread", () => {
    // no Given line: the second side can only come from row 2, which was not read
    const rows: Array<[string, string]> = [SSS_KITE[0], ["\\overline{A D} ??? \\overline{C D}", "\\text{Given}"], SSS_KITE[2], SSS_KITE[3]];
    expect(verdicts(problem(null, "\\triangle ABD \\cong \\triangle CBD", rows))).toEqual(["unknown:no-given-line", "unknown:unparsed", "ok", "unknown:unresolved"]);
    // read, and missing: now it is ringed
    const missing: Array<[string, string]> = [SSS_KITE[0], SSS_KITE[2], SSS_KITE[3]];
    expect(verdicts(problem(null, "\\triangle ABD \\cong \\triangle CBD", missing))[2]).toBe("wrong:missing-prerequisite");
  });

  it("figure facts: vertical angles need the figure, and angles at two vertices are never vertical", () => {
    const given = "E \\text{ is the midpoint of } \\overline{AD}, \\ E \\text{ is the midpoint of } \\overline{BC}";
    const rows: Array<[string, string]> = [["\\angle AEB \\cong \\angle DEC", "\\text{Vertical } \\angle s"]];
    const p = problem(given, "\\triangle ABE \\cong \\triangle DCE", rows);
    expect(verdicts(p, CROSS)).toEqual(["ok"]);
    expect(verdicts(p, null)).toEqual(["unknown:needs-figure"]);
    // not a vertical pair in this figure: unmarked, never ringed
    expect(verdicts(problem(given, "\\triangle ABE \\cong \\triangle DCE", [["\\angle AEB \\cong \\angle AEC", "\\text{Vertical } \\angle s"]]), CROSS)).toEqual(["unknown:needs-figure"]);
    expect(verdicts(problem(given, "\\triangle ABE \\cong \\triangle DCE", [["\\angle BAE \\cong \\angle CDE", "\\text{Vertical } \\angle s"]]), CROSS)).toEqual(["wrong:does-not-follow"]);
  });

  it("alternate interior angles need parallel lines: the figure says which, the givens must say parallel", () => {
    const rows: Array<[string, string]> = [["\\overline{AB} \\parallel \\overline{DC}", "\\text{Given}"], ["\\angle ABD \\cong \\angle CDB", "\\text{Alt. int. } \\angle s"]];
    expect(verdicts(problem("\\overline{AB} \\parallel \\overline{DC}", "\\triangle ABD \\cong \\triangle CDB", rows), PARALLELOGRAM)).toEqual(["ok", "ok"]);
    // the other pair of sides is not given parallel
    const other: Array<[string, string]> = [["\\angle ADB \\cong \\angle CBD", "\\text{Alt. int. } \\angle s"]];
    expect(verdicts(problem("\\overline{AB} \\parallel \\overline{DC}", "\\triangle ABD \\cong \\triangle CDB", other), PARALLELOGRAM)).toEqual(["wrong:missing-prerequisite"]);
    // no parallel lines at all: the theorem cannot be used
    expect(verdicts(problem("\\overline{AB} \\cong \\overline{DC}", "\\triangle ABD \\cong \\triangle CDB", other), null)).toEqual(["wrong:missing-prerequisite"]);
  });

  it("numbered angles are pinned down only by a figure read", () => {
    const fig: FigureRead = { points: { A: [0, 0], E: [50, 0], B: [100, 0], C: [30, -40], G: [80, 60] }, lines: ["AEB", "CEG"], angles: { "1": "AEC", "2": "BEG" } };
    const p = problem("\\angle 2 \\cong \\angle 3", "\\angle 1 \\cong \\angle 2", [["\\angle 1 \\cong \\angle 2", "\\text{Vertical } \\angle s"]]);
    expect(verdicts(p, fig)).toEqual(["ok"]);
    expect(verdicts(p, null)).toEqual(["unknown:unresolved"]);
  });

  it("with a figure, two names of one angle are one angle", () => {
    const fig = buildFigure({ points: { A: [50, 0], B: [0, 100], C: [100, 100], D: [25, 50], E: [75, 50] }, lines: ["ADB", "AEC", "BE", "CD"] });
    const r = new Resolver(fig, []);
    expect(rayRep(fig, "A", "D")).toBe(rayRep(fig, "A", "B"));
    expect(r.angKey({ k: "ang", a: "D", v: "A", c: "E" })).toBe(r.angKey({ k: "ang", a: "B", v: "A", c: "C" }));
    expect(r.angKey({ k: "angv", v: "A" })).toBe(r.angKey({ k: "ang", a: "B", v: "A", c: "C" }));
  });
});

describe("proof planner", () => {
  const PROVE = "\\triangle ABD \\cong \\triangle CBD";

  it("writes the whole proof, givens first, premises before the congruence", () => {
    const plan = planProof(problem(GIVEN_KITE, PROVE, []), buildFigure(KITE))!;
    expect(plan.map((r) => [r.statement, r.reason])).toEqual([
      ["\\overline{AB} \\cong \\overline{CB}", "given"],
      ["\\overline{AD} \\cong \\overline{CD}", "given"],
      ["\\overline{BD} \\cong \\overline{BD}", "reflexive"],
      ["\\triangle ABD \\cong \\triangle CBD", "sss"],
    ]);
    expect(plan[3].reasonLatex).toBe("\\text{SSS}");
  });

  it("continues from the rows written, and has nothing to add to a finished proof", () => {
    const plan = planProof(problem(GIVEN_KITE, PROVE, SSS_KITE.slice(0, 3)), buildFigure(KITE))!;
    expect(plan.map((r) => r.statement)).toEqual(["\\triangle ABD \\cong \\triangle CBD"]);
    expect(planProof(problem(GIVEN_KITE, PROVE, SSS_KITE), buildFigure(KITE))).toEqual([]);
  });

  it("does not restate a given that needs words; uses it straight from the Given line", () => {
    const given = "E \\text{ is the midpoint of } \\overline{AD}, \\ E \\text{ is the midpoint of } \\overline{BC}";
    const plan = planProof(problem(given, "\\triangle ABE \\cong \\triangle DCE", []), buildFigure(CROSS))!;
    expect(plan.map((r) => r.reason)).toEqual(["vertical", "midpoint", "midpoint", "sas"]);
    expect(plan.every((r) => !/\\text/.test(r.statement))).toBe(true);
  });

  it("returns null when the rules cannot reach the Prove statement", () => {
    expect(planProof(problem("\\overline{AB} \\cong \\overline{CB}", PROVE, []), buildFigure(KITE))).toBeNull();
    expect(planProof(problem(GIVEN_KITE, "", []), buildFigure(KITE))).toBeNull();
  });

  it("needs the figure for vertical angles", () => {
    const given = "E \\text{ is the midpoint of } \\overline{AD}, \\ E \\text{ is the midpoint of } \\overline{BC}";
    expect(planProof(problem(given, "\\triangle ABE \\cong \\triangle DCE", []), null)).toBeNull();
  });
});
