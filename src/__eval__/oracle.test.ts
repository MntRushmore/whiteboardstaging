import { describe, expect, it } from "vitest";
import { CORPUS, TOPICS, type EvalProblem } from "./corpus";
import { withoutIntervalPiece } from "./judge";
import {
  compareExprs,
  exprOf,
  isInequality,
  isAntiderivative,
  isExpanded,
  isFactored,
  parseLine,
  rootSet,
  sameTruth,
  solvedValues,
  truthAt,
  truthEverywhere,
  tuplesIn,
  type Expr,
  type Indefinite,
  type Relation,
} from "./oracle";

// ---------------------------------------------------------------- geometry, checked independently

/** `A(1, 2)`, `(1, 2)` on a line: name (or null) and coordinates, as written (integers). */
function pointsOn(latex: string): Array<{ name: string | null; x: number; y: number }> {
  return [...latex.matchAll(/(?:([A-Z])\s*=?\s*)?(?:\\left\s*)?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:\\right\s*)?\)/g)].map((m) => ({ name: m[1] ?? null, x: Number(m[2]), y: Number(m[3]) }));
}

/** a(x² + y²) + Dx + Ey + F by sampling a relation in x and y: its centre and radius. */
function circleOf(r: Relation): { h: number; k: number; r: number } | null {
  const [L, R] = r.alternatives[0].sides;
  const f = (x: number, y: number) => {
    const a = L.at({ x, y });
    const b = R.at({ x, y });
    return typeof a === "number" && typeof b === "number" ? a - b : NaN;
  };
  const F = f(0, 0);
  const a = (f(1, 0) + f(-1, 0)) / 2 - F;
  const D = (f(1, 0) - f(-1, 0)) / 2;
  const E = (f(0, 1) - f(0, -1)) / 2;
  if (!Number.isFinite(a) || a === 0) return null;
  const h = -D / (2 * a);
  const k = -E / (2 * a);
  const r2 = h * h + k * k - F / a;
  return r2 > 0 ? { h, k, r: Math.sqrt(r2) } : null;
}

/** The image of a point under `R_{90^{\circ}}`, `r_{y = x}`, `T_{\langle p, q \rangle}`, `D_{k}` (about the origin). */
function transformed(latex: string, named: ReadonlyArray<{ name: string | null; x: number; y: number }>): number[] | null {
  const m = /^([RrTD])_\{([^]*?)\}\s*(?:\\left\s*)?\(([^]*)\)$/.exec(latex.trim());
  if (!m) return null;
  const inner = m[3].replace(/\\right\s*$/, "").trim();
  const byName = named.find((p) => p.name === inner);
  const coords = byName ? [byName.x, byName.y] : inner.split(",").map((s) => exprOf(s)?.at({}));
  if (coords.length !== 2 || coords.some((c) => typeof c !== "number")) return null;
  const [x, y] = coords as number[];
  const sub = m[2].replace(/\s+/g, "");
  const angle = /^(-?\d+)\^\{?\\circ\}?$/.exec(sub);
  if (m[1] === "R" && angle) {
    const t = (Number(angle[1]) * Math.PI) / 180;
    return [Math.round((x * Math.cos(t) - y * Math.sin(t)) * 1e9) / 1e9, Math.round((x * Math.sin(t) + y * Math.cos(t)) * 1e9) / 1e9];
  }
  if (m[1] === "r") {
    if (sub === "y=x") return [y, x];
    if (sub === "y=-x") return [-y, -x];
    const line = /^([xy])=(-?\d+)$/.exec(sub);
    if (line) return line[1] === "x" ? [2 * Number(line[2]) - x, y] : [x, 2 * Number(line[2]) - y];
  }
  if (m[1] === "T") {
    const v = sub.replace(/\\langle|\\rangle/g, "").split(",").map(Number);
    return [x + v[0], y + v[1]];
  }
  if (m[1] === "D") {
    const k = exprOf(sub)?.at({});
    return typeof k === "number" ? [k * x, k * y] : null;
  }
  return null;
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

/**
 * The expectation of a geometry problem whose answer the one-equation / system checks cannot
 * reach (a point, a distance between named points, a formula in x_{1}, …), recomputed here from
 * the definitions: `undefined` when it is not one of these, `null` when it holds, else what is wrong.
 */
function geometryExpectation(p: EvalProblem): string | null | undefined {
  const e = p.expect;
  const target = p.lines[p.lines.length - 1];
  const points = p.lines.slice(0, -1).flatMap(pointsOn);
  const q = /^\s*([^=]+?)\s*=\s*\??\s*$/.exec(target)?.[1].replace(/\s+/g, "") ?? null;
  const pair = () => {
    const names = q ? /([A-Z])([A-Z])/.exec(q.replace(/^[dm]_\{?/, "")) : null;
    const a = names ? points.find((pt) => pt.name === names[1]) : points[0];
    const b = names ? points.find((pt) => pt.name === names[2]) : points[1];
    return a && b ? [a, b] : null;
  };
  if (e.point) {
    const got = ((): number[] | null => {
      const circle = p.lines.map(parseLine).find((l): l is Relation => l.kind === "relation" && l.vars.length === 2 && l.vars.includes("x") && l.vars.includes("y"));
      if (circle) {
        const c = circleOf(circle);
        if (!c) return null;
        if (e.values?.r && !near(c.r, e.values.r[0])) return [NaN, NaN];
        return [c.h, c.k];
      }
      const image = transformed(target, points);
      if (image) return image;
      const rule = p.lines.map((l) => /^\(\s*x\s*,\s*y\s*\)\s*\\to\s*\(([^,]+),([^)]+)\)$/.exec(l.trim())).find(Boolean);
      const all = p.lines.flatMap(pointsOn);
      if (rule && all.length === 1) return [exprOf(rule[1])!.at({ x: all[0].x, y: all[0].y }) as number, exprOf(rule[2])!.at({ x: all[0].x, y: all[0].y }) as number];
      const ratio = p.lines.map((l) => /^[A-Z]{2}\s*:\s*[A-Z]{2}\s*=\s*(\d+)\s*:\s*(\d+)$/.exec(l.trim())).find(Boolean);
      const two = pair();
      if (q && /^[A-Z]$/.test(q) && two) {
        const t = ratio ? Number(ratio[1]) / (Number(ratio[1]) + Number(ratio[2])) : 0.5;
        return [two[0].x + t * (two[1].x - two[0].x), two[0].y + t * (two[1].y - two[0].y)];
      }
      // the midpoint formula written with x_{1}, …, or a point with its numbers in
      const tuple = /=\s*\\left\s*\(([^]*)\\right\s*\)$/.exec(target) ?? /=\s*\(([^]*)\)$/.exec(target);
      if (tuple) {
        const scope: Record<string, number> = {};
        pointsOn(p.lines.slice(0, -1).join(" ")).forEach((pt, i) => {
          scope[`x_${i + 1}`] = pt.x;
          scope[`y_${i + 1}`] = pt.y;
        });
        let depth = 0;
        const body = tuple[1];
        const at = [...body].findIndex((ch) => (ch === "{" || ch === "(" ? (depth++, false) : ch === "}" || ch === ")" ? (depth--, false) : ch === "," && depth === 0));
        const xs = exprOf(body.slice(0, at))?.at(scope);
        const ys = exprOf(body.slice(at + 1))?.at(scope);
        return typeof xs === "number" && typeof ys === "number" ? [xs, ys] : null;
      }
      return tuplesIn(target).at(-1) ?? null;
    })();
    if (!got) return `${p.id}: cannot recompute the point`;
    return got.every((v, i) => near(v, e.point![i])) ? null : `${p.id}: the point is (${got.join(", ")}), not (${e.point.join(", ")})`;
  }
  if (e.answer && !e.values) {
    const want = parseLine(e.answer);
    const t = parseLine(target);
    // a check worked out (`169 = 169`, `85 \neq 81`): the same sides, and a true statement
    if (want.kind === "relation" && want.vars.length === 0 && t.kind === "relation" && t.vars.length === 0) {
      const a = t.alternatives[0].sides;
      const b = want.alternatives[0].sides;
      const same = a.length === b.length && a.every((s, i) => compareExprs(s, b[i]).exact);
      return same && truthAt(want, {}) === true ? null : `${p.id}: ${e.answer} is not ${target} worked out`;
    }
    // a circle's equation from its centre and radius (`h`, `k`, `r` above, or the centre as a point)
    if (want.kind === "relation" && want.vars.length === 2 && t.kind === "relation" && t.vars.includes("h")) {
      const known: Record<string, number> = {};
      for (const l of p.lines.slice(0, -1).map(parseLine)) {
        const sv = l.kind === "relation" && l.vars.length === 1 ? solvedValues(l, l.vars[0]) : null;
        if (sv) known[(l as Relation).vars[0]] = sv.values[0].re;
      }
      if (points.length === 1) Object.assign(known, { h: points[0].x, k: points[0].y });
      for (const x of [0.3, 1.7, -1.1, 3.4]) {
        const a = rootSet(t, "y", [], { ...known, x });
        const b = rootSet(want, "y", [], { x });
        if (!a || !b || a.all !== b.all || a.roots.length !== b.roots.length || !a.roots.every((r, i) => near(r, b.roots[i]))) return `${p.id}: not the circle at x = ${x}`;
      }
      return null;
    }
    // `r = 5 \mathrm{~cm}`, `A = \pi r^{2}`, `A = ?`: the formula with the known values (units and all) put in
    if (want.kind === "expr" && q && /^[A-Za-z]$/.test(q)) {
      const formula = p.lines.map((l) => new RegExp(`^\\s*${q}\\s*=\\s*(.*[a-zA-Z].*)$`).exec(l)).find((m) => m && !/\?/.test(m[1]));
      if (!formula) return undefined;
      let body = formula[1];
      for (const l of p.lines) {
        const k = /^\s*([a-zA-Z])\s*=\s*([^a-zA-Z=]*(?:\\mathrm\s*\{[^}]*\})?[^a-zA-Z=]*)$/.exec(l);
        if (k && k[1] !== q) body = body.replace(new RegExp(`(?<![a-zA-Z\\\\])${k[1]}(?![a-zA-Z])`, "g"), `(${k[2].trim()})`);
      }
      const got = exprOf(body);
      if (!got) return `${p.id}: cannot read ${body}`;
      return compareExprs(got, want).exact ? null : `${p.id}: ${body} is not ${e.answer}`;
    }
    return undefined;
  }
  if (!e.values || points.length < 2) return undefined;
  const two = pair();
  const scope: Record<string, number> = {};
  points.forEach((pt, i) => {
    scope[`x_${i + 1}`] = pt.x;
    scope[`y_${i + 1}`] = pt.y;
  });
  const want = Object.entries(e.values).map(([v, vs]) => [v, vs[0]] as const);
  const t = parseLine(target);
  if (t.kind === "relation") {
    // a formula in x_{1}, …: true at the points with the expected value
    const point = { ...scope, ...Object.fromEntries(want) };
    return truthAt(t, point) === true ? null : `${p.id}: ${target} is not true at ${JSON.stringify(point)}`;
  }
  if (!two) return `${p.id}: which two points?`;
  const [a, b] = two;
  const slope = (b.y - a.y) / (b.x - a.x);
  for (const [v, value] of want) {
    const expected = /^[A-Z]{2}$|^d/.test(v) ? Math.hypot(b.x - a.x, b.y - a.y) : v === "m_perp" ? -1 / slope : v.startsWith("m") ? slope : NaN;
    if (!near(expected, value)) return `${p.id}: ${v} is ${expected}, not ${value}`;
  }
  return null;
}

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
      expect(Boolean(e.values || e.answer || e.point), p.id).toBe(true);
      if (!e.values && !e.point) expect(parseLine(e.equivalentTo ?? e.answer ?? "").kind, p.id).not.toBe("unreadable");
      if (e.point) expect(e.point.length, p.id).toBe(2);
    }
  });

  // checks every corpus problem (1.7 s alone): generous under a loaded full-suite run
  it("every expected answer really solves its problem", { timeout: 30_000 }, () => {
    const problems: string[] = [];
    const unchecked: string[] = [];
    for (const p of CORPUS) {
      if (MISREAD_BY_TRANSLATOR[p.id]) continue;
      const e = p.expect;
      // points, distances between named points, formulas in x_{1}, …: recomputed from their definitions
      const geometry = geometryExpectation(p);
      if (geometry !== undefined) {
        if (geometry) problems.push(geometry);
        continue;
      }
      const lines = p.lines.map(parseLine);
      const target = lines[lines.length - 1];
      const relations = lines.filter((l): l is Relation => l.kind === "relation");
      if (e.values) {
        const vars = Object.keys(e.values);
        if (vars.length === 1 && relations.length === 1 && target.kind === "relation") {
          // one equation: its whole real solution set is the expectation — within the interval,
          // for a trig equation (the interval written on the line is not part of the equation)
          const w = e.interval;
          const equation = w ? parseLine(withoutIntervalPiece(p.lines[p.lines.length - 1])) : target;
          const all = equation.kind === "relation" ? rootSet(equation, vars[0], e.values[vars[0]]) : null;
          const inside = (x: number) => !w || (x > w.lo - 1e-9 && (x < w.hi - 1e-9 || (w.hiIn === true && Math.abs(x - w.hi) < 1e-9)));
          const rs = all && !all.all ? { all: false, roots: all.roots.filter(inside) } : all;
          if (!rs || rs.all || rs.roots.length !== e.values[vars[0]].length || !e.values[vars[0]].every((v) => rs.roots.some((r) => Math.abs(r - v) < 1e-6))) {
            problems.push(`${p.id}: roots ${JSON.stringify(rs)} vs ${JSON.stringify(e.values)}`);
          }
        } else {
          // a system (or known values): every expected point satisfies every line
          const known: Record<string, number> = {};
          for (const l of relations) {
            const sv = l.vars.length === 1 ? solvedValues(l, l.vars[0]) : null;
            if (sv && sv.values.length === 1) known[l.vars[0]] = sv.values[0].re;
          }
          const n = e.values[vars[0]].length;
          if (vars.some((v) => e.values![v].length !== n)) problems.push(`${p.id}: the unknowns have different numbers of values`);
          for (let i = 0; i < n; i++) {
            const point: Record<string, number> = { ...known };
            for (const v of vars) point[v] = e.values[v][i];
            // a part defined on its own line (`m\angle 1 = 3x + 10`) takes its value from that line
            for (let pass = 0; pass < 4; pass++) {
              for (const l of relations) {
                const missing = l.vars.filter((v) => !(v in point));
                if (missing.length !== 1) continue;
                const rs = rootSet(l, missing[0], [], point);
                if (rs && !rs.all && rs.roots.length === 1) point[missing[0]] = rs.roots[0];
              }
            }
            for (const l of relations) if (truthAt(l, point) !== true) problems.push(`${p.id}: ${l.latex} is not true at ${JSON.stringify(point)}`);
          }
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
      } else if (want.kind === "empty-set" && target.kind === "relation" && relations.length === 1 && isInequality(target)) {
        if (truthEverywhere(target, target.vars[0]) !== "never") problems.push(`${p.id}: holds somewhere`);
      } else if (want.kind === "empty-set" && target.kind === "relation" && relations.length === 1) {
        const rs = rootSet(target, target.vars[0]);
        if (!rs || rs.all || rs.roots.length > 0) problems.push(`${p.id}: has solutions ${JSON.stringify(rs)}`);
      } else if (want.kind === "all-reals" && target.kind === "relation" && isInequality(target)) {
        if (truthEverywhere(target, target.vars[0]) !== "always") problems.push(`${p.id}: does not always hold`);
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
