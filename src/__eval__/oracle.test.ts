import { describe, expect, it } from "vitest";
import { CORPUS, TOPICS } from "./corpus";
import {
  compareExprs,
  isAntiderivative,
  isExpanded,
  isFactored,
  parseLine,
  rootSet,
  sameTruth,
  solvedValues,
  truthAt,
  type Expr,
  type Indefinite,
  type Relation,
} from "./oracle";

/**
 * The scoreboard is only as good as its judge. These pin the oracle on cases where the answer
 * is known, and then check the CORPUS against the oracle: every expected answer must actually
 * solve its problem, so a typo in corpus.ts cannot turn into a fake engine failure.
 */

const rel = (latex: string) => {
  const p = parseLine(latex);
  if (p.kind !== "relation") throw new Error(`${latex} is ${p.kind}`);
  return p;
};
const expr = (latex: string) => {
  const p = parseLine(latex);
  if (p.kind !== "expr") throw new Error(`${latex} is ${p.kind}`);
  return p;
};
const roots = (latex: string, v = "x", candidates: number[] = []) => rootSet(rel(latex), v, candidates);

describe("oracle: reading a line", () => {
  it.each([
    ["2x + 3", "expr"],
    ["= 2x + 6", "expr"],
    ["36 + 2 =", "expr"],
    ["x = 2 \\text{ or } x = 3", "relation"],
    ["x \\approx 2.414", "relation"],
    ["-2 < x < 2", "relation"],
    ["\\varnothing", "empty-set"],
    ["x \\in \\mathbb{R}", "all-reals"],
    ["x = ?", "question"],
    ["y =", "question"],
    ["\\int x^{2} \\, dx", "indefinite"],
    ["\\int (3x^{2} + 2x) \\, dx", "indefinite"],
    ["", "unreadable"],
    ["\\frac{dy}{dx} =", "unreadable"],
  ])("%s is %s", (latex, kind) => {
    expect(parseLine(latex).kind).toBe(kind);
  });

  it("splits `or` and ± into alternatives", () => {
    expect(rel("x = 2 \\text{ or } x = 3").alternatives).toHaveLength(2);
    expect(rel("x = 1 \\pm \\sqrt{2}").alternatives).toHaveLength(2);
    expect(solvedValues(rel("x = 1 \\pm \\sqrt{2}"), "x")?.values.map((v) => v.re)).toEqual([1 + Math.SQRT2, 1 - Math.SQRT2]);
  });

  it("reads the values of a solved line, complex ones included", () => {
    expect(solvedValues(rel("x = -\\frac{1}{3} \\text{ or } x = 2"), "x")?.values.map((v) => v.re)).toEqual([-1 / 3, 2]);
    const c = solvedValues(rel("x \\approx -\\frac{1}{2} - 0.866i \\text{ or } x \\approx -\\frac{1}{2} + 0.866i"), "x");
    expect(c?.approx).toBe(true);
    expect(c?.values.every((v) => Math.abs(v.im) > 0.8)).toBe(true);
    // not solved: the unknown is not alone
    expect(solvedValues(rel("2x = 8"), "x")).toBeNull();
  });
});

describe("oracle: solution sets of equations", () => {
  it("finds simple, double, far and radical roots", () => {
    const r6 = (latex: string) => roots(latex)?.roots.map((r) => Math.round(r * 1e6) / 1e6);
    expect(r6("x^{2} - 5x + 6 = 0")).toEqual([2, 3]);
    expect(r6("x^{2} - 6x + 9 = 0")).toEqual([3]); // touches, no sign change
    expect(r6("\\log(x) = 2")).toEqual([100]);
    expect(r6("\\sqrt{x + 2} = x")).toEqual([2]);
    expect(r6("2^{x} = 10")).toEqual([Math.round(Math.log2(10) * 1e6) / 1e6]);
  });

  it("knows no solution, every x, and that a pole is not a root", () => {
    expect(roots("x^{2} + 1 = 0")).toEqual({ all: false, roots: [] });
    expect(roots("2(x + 3) = 2x + 6")?.all).toBe(true);
    expect(roots("\\frac{1}{x - 2} = 0")).toEqual({ all: false, roots: [] });
  });

  it("reads a negative base without brackets the way it is written", () => {
    // `-2^{2}` is -4: the quadratic-formula line the engine writes this way has other roots
    expect(roots("x = \\frac{2 \\pm \\sqrt{-2^{2} - 4 \\cdot 1 \\cdot -1}}{2 \\cdot 1}")?.roots).toEqual([1]);
    expect(roots("x = \\frac{2 \\pm \\sqrt{(-2)^{2} - 4 \\cdot 1 \\cdot (-1)}}{2 \\cdot 1}")?.roots.length).toBe(2);
  });
});

describe("oracle: inequalities", () => {
  it.each([
    ["-3x + 6 > 9", "x < -1", "equal"],
    ["-2x < 6", "x > -3", "equal"],
    ["x^{2} < 4", "-2 < x < 2", "equal"],
    ["x \\le 3", "x < 3", "different"],
    ["2x > 8", "x < 4", "different"],
  ])("%s vs %s: %s", (a, b, want) => {
    expect(sameTruth(rel(a), rel(b), "x")).toBe(want);
  });

  it("holds exactly at a closed boundary", () => {
    expect(truthAt(rel("x \\le 3"), { x: 3 })).toBe(true);
    expect(truthAt(rel("x < 3"), { x: 3 })).toBe(false);
  });
});

describe("oracle: expressions", () => {
  const same = (a: string, b: string, opts = {}) => compareExprs(expr(a), expr(b), opts);

  it.each([
    ["(x + 1)^{2}", "x^{2} + 2x + 1"],
    ["\\frac{d}{dx}(x^{3})", "3x^{2}"],
    ["\\frac{d^{2}}{dx^{2}}(x^{4})", "12x^{2}"],
    ["\\lim_{x \\to 3} \\frac{x^{2} - 9}{x - 3}", "6"],
    ["\\lim_{x \\to \\infty} \\frac{2x + 1}{x - 3}", "2"],
    ["\\int_{0}^{1} x^{2} \\, dx", "\\frac{1}{3}"],
    ["5 \\mathrm{~km}", "5000\\,\\mathrm{m}"],
    ["{\\sec\\left( x\\right)}^{2}", "\\frac{1}{\\cos^{2}(x)}"],
    ["\\ln|x|", "\\ln(|x|)"],
  ])("%s ≡ %s", (a, b) => {
    expect(same(a, b).exact).toBe(true);
  });

  it("tells a rounded decimal from the exact value", () => {
    const c = same("1.718", "e - 1");
    expect(c.exact).toBe(false);
    expect(c.approx).toBe(true);
    expect(same("1.8", "e - 1").approx).toBe(false);
  });

  it("compares antiderivatives up to a constant, and by differentiating", () => {
    expect(same("\\frac{x^{3}}{3} + 7", "\\frac{x^{3}}{3} + C", { upToConstant: true }).exact).toBe(true);
    expect(same("\\frac{x^{3}}{2}", "\\frac{x^{3}}{3} + C", { upToConstant: true }).exact).toBe(false);
    const integral = parseLine("\\int \\cos x \\, dx") as Indefinite;
    expect(isAntiderivative(expr("\\sin x + C"), integral.integrand, "x")).toBe("equal");
    expect(isAntiderivative(expr("\\cos x"), integral.integrand, "x")).toBe("different");
  });

  it("recognises the shape of a factorisation and an expansion", () => {
    expect(isFactored("(x + 2)(x + 3)")).toBe(true);
    expect(isFactored("= 3x(2x + 3)")).toBe(true);
    expect(isFactored("(x - 3)^{2}")).toBe(true);
    expect(isFactored("x^{2} + 5x + 6")).toBe(false);
    expect(isExpanded("= x^{2} + 3x + 2")).toBe(true);
    expect(isExpanded("(x + 1)(x + 2)")).toBe(false);
    expect(isExpanded("2(x + 4) + 3")).toBe(false);
  });
});

// ---------------------------------------------------------------- the corpus, checked by the oracle

/**
 * Problems whose LINE the board's translator reads differently from a person, so the oracle
 * (which reads through the same translator) cannot confirm the expectation from the line. The
 * expectation is still right — these are exactly the misreadings the scoreboard should show.
 */
const MISREAD_BY_TRANSLATOR: Record<string, string> = {};

describe("eval corpus", () => {
  it("has ~150 problems with unique ids over every topic", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(140);
    expect(new Set(CORPUS.map((p) => p.id)).size).toBe(CORPUS.length);
    for (const t of TOPICS) expect(CORPUS.filter((p) => p.topic === t).length, t).toBeGreaterThanOrEqual(4);
  });

  it("states every expectation in a form the oracle reads", () => {
    for (const p of CORPUS) {
      const e = p.expect;
      expect(Boolean(e.values || e.answer), p.id).toBe(true);
      if (!e.values) expect(parseLine(e.equivalentTo ?? e.answer ?? "").kind, p.id).not.toBe("unreadable");
    }
  });

  it("every expected answer really solves its problem", () => {
    const problems: string[] = [];
    const unchecked: string[] = [];
    for (const p of CORPUS) {
      if (MISREAD_BY_TRANSLATOR[p.id]) continue;
      const e = p.expect;
      const lines = p.lines.map(parseLine);
      const target = lines[lines.length - 1];
      const relations = lines.filter((l): l is Relation => l.kind === "relation");
      if (e.values) {
        const vars = Object.keys(e.values);
        if (vars.length === 1 && relations.length === 1 && target.kind === "relation") {
          // one equation: its whole real solution set is the expectation
          const rs = rootSet(target, vars[0], e.values[vars[0]]);
          if (!rs || rs.all || rs.roots.length !== e.values[vars[0]].length || !e.values[vars[0]].every((v) => rs.roots.some((r) => Math.abs(r - v) < 1e-6))) {
            problems.push(`${p.id}: roots ${JSON.stringify(rs)} vs ${JSON.stringify(e.values)}`);
          }
        } else {
          // a system (or known values): the expected point satisfies every line
          const point: Record<string, number> = {};
          for (const l of relations) {
            const sv = l.vars.length === 1 ? solvedValues(l, l.vars[0]) : null;
            if (sv && sv.values.length === 1) point[l.vars[0]] = sv.values[0].re;
          }
          for (const v of vars) point[v] = e.values[v][0];
          for (const l of relations) if (truthAt(l, point) !== true) problems.push(`${p.id}: ${l.latex} is not true at ${JSON.stringify(point)}`);
        }
        continue;
      }
      const want = parseLine(e.equivalentTo ?? e.answer ?? "");
      if (want.kind === "expr" && target.kind === "expr") {
        // an `approxOk` answer is the rounded value: judge it by ITS decimals
        const c = e.approxOk ? compareExprs(want, target as Expr) : compareExprs(target as Expr, want, { upToConstant: e.upToConstant });
        if (!c.unknown && !(e.approxOk ? c.approx : c.exact)) problems.push(`${p.id}: ${p.lines.at(-1)} ≠ ${e.answer}`);
      } else if (want.kind === "expr" && target.kind === "indefinite") {
        if (isAntiderivative(want, target.integrand, target.variable) !== "equal") problems.push(`${p.id}: ${e.answer} is not an antiderivative`);
      } else if (want.kind === "relation" && target.kind === "relation" && want.vars.length === 1) {
        if (sameTruth(target, want, want.vars[0]) !== "equal") problems.push(`${p.id}: ${p.lines.at(-1)} is not ${e.answer}`);
      } else if (want.kind === "empty-set" && target.kind === "relation" && relations.length === 1) {
        const rs = rootSet(target, target.vars[0]);
        if (!rs || rs.all || rs.roots.length > 0) problems.push(`${p.id}: has solutions ${JSON.stringify(rs)}`);
      } else if (want.kind === "all-reals" && target.kind === "relation") {
        if (!rootSet(target, target.vars[0])?.all) problems.push(`${p.id}: is not an identity`);
      } else unchecked.push(p.id);
    }
    expect(problems).toEqual([]);
    // the few the oracle cannot confirm alone (`dy/dx` needs the line above, a whole line of
    // solutions, `\mathrm{min}`): keep the list short, so the corpus stays trustworthy
    expect(unchecked.length, unchecked.join(", ")).toBeLessThanOrEqual(8);
  });
});
