/**
 * Linear systems by elimination, exact, the way a teacher lays them out:
 *
 *   3x + 2y = 16          x + y + z = 6
 *   2x + 3y = 14          2x - y + z = 3
 *   ────────────          x + 2y - z = 2
 *   9x + 6y = 48          ────────────────
 *   4x + 6y = 28          2x + 3y = 8          (z eliminated: the first and third added)
 *   5x = 20               3x + y = 5           (the second and third added)
 *   x = 4                 9x + 3y = 15
 *   3(4)+2y=16            7x = 7
 *   12 + 2y = 16          x = 1
 *   2y = 4                y = 2
 *   y = 2                 z = 3
 *
 * Two equations use elimination only where substitution would bring in fractions (no
 * coefficient ±1 to isolate): `systems.ts` keeps substitution otherwise. Three equations in three
 * unknowns always go by elimination: one unknown out of two pairs, then the two-equation case,
 * then back-substitution. Everything within the 8-line block — the multiplied equations and the
 * back-substituted lines are the first to go; the eliminated equations and the values stay.
 */
import { gcdInt, q, qAdd, qDiv, qLatex, qMul, qNeg, termsLatex, type Q, type Term } from "./algebra";
import { exactly, qFromNumber, qIsZero } from "./poly";
import { LIST_SEP, MAX_STEPS, NO_SOLUTION, StepWriter } from "./solution";
import type { SystemDeps, SystemSolution } from "./systems";

type Substitute = (latex: string, values: Record<string, string>) => string;

/** `Σ c[v] v = d`, exact. */
interface ExactEq {
  c: Record<string, Q>;
  d: Q;
  /** the line as written (the student's, or one written here) */
  latex: string;
}

interface Fact {
  lhs: string;
  rhs: string;
  unknowns: string[];
  latex: string;
}

const PROBES = [
  [2.3, -1.7, 0.9],
  [-3.1, 4.9, -2.6],
];

/** The exact linear form of `lhs = rhs` in `vars`, or null when it is not linear with rational coefficients. */
function exactForm(deps: SystemDeps, f: { lhs: string; rhs: string; latex: string }, vars: readonly string[]): ExactEq | null {
  const at = (xs: number[]) => deps.evalG(f.lhs, f.rhs, Object.fromEntries(vars.map((v, i) => [v, xs[i]])));
  const zero = vars.map(() => 0);
  const c0 = at(zero);
  if (c0 === null) return null;
  const coefs: number[] = [];
  for (let i = 0; i < vars.length; i++) {
    const g = at(vars.map((_, j) => (j === i ? 1 : 0)));
    if (g === null) return null;
    coefs.push(g - c0);
  }
  for (const p of PROBES) {
    const xs = vars.map((_, i) => p[i]);
    const g = at(xs);
    if (g === null) return null;
    const predicted = c0 + coefs.reduce((s, c, i) => s + c * xs[i], 0);
    if (Math.abs(g - predicted) > 1e-7 * Math.max(1, Math.abs(g))) return null;
  }
  const exact = coefs.map((c) => qFromNumber(c));
  const d = qFromNumber(-c0);
  if (exact.some((c) => c === null) || d === null) return null;
  return { c: Object.fromEntries(vars.map((v, i) => [v, exact[i]!])), d, latex: f.latex };
}

function eqTex(e: { c: Record<string, Q>; d: Q }, vars: readonly string[]): string {
  const terms: Term[] = vars.filter((v) => e.c[v] && !qIsZero(e.c[v])).map((v) => ({ c: e.c[v], vars: { [v]: 1 } }));
  return `${termsLatex(terms)} = ${qLatex(e.d)}`;
}

function combine(a: ExactEq, ka: Q, b: ExactEq, kb: Q, vars: readonly string[]): ExactEq {
  const c: Record<string, Q> = {};
  for (const v of vars) c[v] = qAdd(qMul(ka, a.c[v] ?? q(0)), qMul(kb, b.c[v] ?? q(0)));
  const out = { c, d: qAdd(qMul(ka, a.d), qMul(kb, b.d)), latex: "" };
  out.latex = eqTex(out, vars);
  return out;
}

/** Divided by the common factor of its numbers, first coefficient positive: `4x + 6y = 20` → `2x + 3y = 10`. */
function reduced(e: ExactEq, vars: readonly string[]): ExactEq {
  const nums = [...vars.map((v) => e.c[v] ?? q(0)), e.d];
  if (nums.some((x) => x.d !== 1)) return e;
  let g = 0;
  for (const x of nums) if (x.n !== 0) g = g === 0 ? Math.abs(x.n) : gcdInt(g, x.n);
  const first = vars.map((v) => e.c[v]).find((x) => x && !qIsZero(x));
  if (!g || !first) return e;
  const k = q(first.n < 0 ? -1 : 1, g);
  return combine(e, k, e, q(0), vars);
}

const lcm = (a: number, b: number): number => (Math.abs(a) * Math.abs(b)) / gcdInt(a, b);
const isInt = (x: Q | undefined): boolean => !!x && x.d === 1;

/**
 * Eliminates `other` from two equations and solves for `target`, then back-substitutes for
 * `other`. Writes into `w`; null when the coefficients are not whole numbers or the lines are
 * parallel (the caller has other paths for those).
 */
function solveTwo(e1: ExactEq, e2: ExactEq, target: string, other: string, w: StepWriter, deps: SystemDeps, substitute: Substitute): { t: Q; o: Q } | null {
  const vars = [target, other].sort();
  const a1 = e1.c[other];
  const a2 = e2.c[other];
  if (!a1 || !a2 || qIsZero(a1) || qIsZero(a2) || !isInt(a1) || !isInt(a2)) return null;
  const L = lcm(a1.n, a2.n);
  const m1 = q(L / Math.abs(a1.n));
  const m2 = q(L / Math.abs(a2.n));
  const s1 = combine(e1, m1, e1, q(0), vars);
  const s2 = combine(e2, m2, e2, q(0), vars);
  if (m1.n !== 1) w.write(s1.latex, true);
  if (m2.n !== 1) w.write(s2.latex, true);
  // same sign: subtract; opposite signs: add
  const sameSign = Math.sign(a1.n) === Math.sign(a2.n);
  const out = combine(s1, q(1), s2, q(sameSign ? -1 : 1), vars);
  let ct = out.c[target];
  let dt = out.d;
  if (!ct || qIsZero(ct)) return null;
  if (ct.n < 0) {
    ct = qNeg(ct);
    dt = qNeg(dt);
  }
  w.write(`${termsLatex([{ c: ct, vars: { [target]: 1 } }])} = ${qLatex(dt)}`);
  const t = qDiv(dt, ct);
  w.write(`${target} = ${qLatex(t)}`);
  // back into the equation whose `other` coefficient is ±1, when there is one
  const back = Math.abs(a1.n) === 1 || Math.abs(a2.n) !== 1 ? e1 : e2;
  const o = backSubstitute(back, { [target]: t }, other, w, deps, substitute);
  return o ? { t, o } : null;
}

/** `3(4)+2y=16` → … → `y = 2`: the known values put in, the one unknown left solved. */
function backSubstitute(e: ExactEq, known: Record<string, Q>, unknown: string, w: StepWriter, deps: SystemDeps, substitute: Substitute): Q | null {
  let rest = e.d;
  for (const [v, value] of Object.entries(known)) rest = qAdd(rest, qNeg(qMul(e.c[v] ?? q(0), value)));
  const c = e.c[unknown];
  if (!c || qIsZero(c)) return null;
  const value = qDiv(rest, c);
  const values = Object.fromEntries(Object.entries(known).map(([v, x]) => [v, qLatex(x)]));
  const line = substitute(e.latex, values);
  w.write(line, true);
  const solved = deps.solveOne(line);
  const finalLine = `${unknown} = ${qLatex(value)}`;
  for (const s of solved?.steps ?? []) if (deps.normalize(s) !== deps.normalize(finalLine)) w.write(s, true);
  w.write(finalLine);
  return value;
}

/** How much writing eliminating `other` takes: equations that need multiplying first, then the multipliers. */
function eliminationCost(e1: ExactEq, e2: ExactEq, other: string): number {
  const a1 = e1.c[other];
  const a2 = e2.c[other];
  if (!a1 || !a2 || qIsZero(a1) || qIsZero(a2) || !isInt(a1) || !isInt(a2)) return Infinity;
  const L = lcm(a1.n, a2.n);
  const m1 = L / Math.abs(a1.n);
  const m2 = L / Math.abs(a2.n);
  return 100 * (Number(m1 !== 1) + Number(m2 !== 1)) + m1 + m2;
}

/** Which unknown to solve for first: the one asked for, else the one whose partner is cheaper to eliminate. */
function order(e1: ExactEq, e2: ExactEq, vars: readonly string[], want: string | null): [string, string] {
  const [a, b] = vars;
  if (want === a) return [a, b];
  if (want === b) return [b, a];
  return eliminationCost(e1, e2, a) < eliminationCost(e1, e2, b) ? [b, a] : [a, b];
}

/**
 * Two linear equations by elimination (the caller decided substitution would bring fractions).
 * `target` is solved first; the answer line is its value.
 */
export function eliminateTwo(f1: Fact, f2: Fact, vars: readonly [string, string], want: string | null, deps: SystemDeps, substitute: Substitute): SystemSolution | null {
  return exactly(() => {
    const e1 = exactForm(deps, f1, vars);
    const e2 = exactForm(deps, f2, vars);
    if (!e1 || !e2) return null;
    const [target, other] = order(e1, e2, vars, want);
    const w = new StepWriter(deps.normalize);
    const r = solveTwo(e1, e2, target, other, w, deps, substitute);
    if (!r) return null;
    return { latex: `${target} = ${qLatex(r.t)}`, steps: w.lines(MAX_STEPS) };
  });
}

/** The unknown to eliminate first and the equation it is eliminated with (smallest multipliers). */
function pivotFor(eqs: ExactEq[], vars: readonly string[], keep: string | null): { v: string; p: number } | null {
  let best: { v: string; p: number; cost: number } | null = null;
  for (const v of [...vars].reverse()) {
    if (v === keep) continue;
    for (let p = 0; p < eqs.length; p++) {
      const a = eqs[p].c[v];
      if (!a || qIsZero(a) || !isInt(a)) continue;
      let cost = 0;
      for (let i = 0; i < eqs.length; i++) {
        if (i === p) continue;
        const b = eqs[i].c[v];
        if (!b || qIsZero(b)) continue;
        if (!isInt(b)) {
          cost = Infinity;
          break;
        }
        const L = lcm(a.n, b.n);
        cost += L / Math.abs(a.n) + L / Math.abs(b.n);
      }
      if (!best || cost < best.cost) best = { v, p, cost };
    }
  }
  return best && best.cost < Infinity ? { v: best.v, p: best.p } : null;
}

/** Three linear equations in three unknowns, by elimination. Null when they are not, or not independent. */
export function solveThreeByElimination(facts: readonly Fact[], want: string | null, deps: SystemDeps, substitute: Substitute): SystemSolution | null {
  for (let k = facts.length - 1; k >= 2; k--) {
    const trio = [facts[k - 2], facts[k - 1], facts[k]];
    const vars = [...new Set(trio.flatMap((f) => f.unknowns))].sort();
    if (vars.length !== 3 || (want && !vars.includes(want))) continue;
    const out = exactly(() => solveTrio(trio, vars, want, deps, substitute));
    if (out) return out;
  }
  return null;
}

/** A contradiction was written (`0 = 1`): the system has no solution. */
function noSolution(w: StepWriter): SystemSolution {
  w.write(NO_SOLUTION);
  return { latex: NO_SOLUTION, steps: w.lines(MAX_STEPS) };
}

function solveTrio(trio: Fact[], vars: string[], want: string | null, deps: SystemDeps, substitute: Substitute): SystemSolution | null {
  const eqs = trio.map((f) => exactForm(deps, f, vars));
  if (eqs.some((e) => !e)) return null;
  const E = eqs as ExactEq[];
  const pivot = pivotFor(E, vars, want);
  if (!pivot) return null;
  const { v, p } = pivot;
  const w = new StepWriter(deps.normalize);
  const pair: ExactEq[] = [];
  for (let i = 0; i < 3; i++) {
    if (i === p) continue;
    const a = E[p].c[v];
    const b = E[i].c[v];
    if (!b || qIsZero(b)) {
      pair.push(E[i]); // already without `v`: the student's own line
      continue;
    }
    const L = lcm(a.n, b.n);
    const same = Math.sign(a.n) === Math.sign(b.n);
    const e = reduced(combine(E[i], q(L / Math.abs(b.n)), E[p], q(((same ? -1 : 1) * L) / Math.abs(a.n)), vars), vars);
    w.write(e.latex);
    // every unknown went at once: `0 = 1` (parallel planes, no solution) or `0 = 0` (the same plane)
    if (vars.every((x) => !e.c[x] || qIsZero(e.c[x]))) return qIsZero(e.d) ? null : noSolution(w);
    pair.push(e);
  }
  const rest = vars.filter((x) => x !== v);
  // the two equations left are parallel lines: eliminate one unknown and the other goes too
  const [p0, p1] = pair;
  const [r0, r1] = rest;
  const cross = qAdd(qMul(p0.c[r0] ?? q(0), p1.c[r1] ?? q(0)), qNeg(qMul(p0.c[r1] ?? q(0), p1.c[r0] ?? q(0))));
  if (qIsZero(cross)) {
    const by = [r0, r1].find((x) => p0.c[x] && !qIsZero(p0.c[x]) && p1.c[x] && !qIsZero(p1.c[x]) && isInt(p0.c[x]) && isInt(p1.c[x]));
    if (!by) return null;
    const a = p0.c[by];
    const b = p1.c[by];
    const L = lcm(a.n, b.n);
    const e = combine(p0, q(L / a.n), p1, q(-L / b.n), vars);
    if (qIsZero(e.d)) return null;
    w.write(e.latex);
    return noSolution(w);
  }
  const [target, other] = order(pair[0], pair[1], rest, want && rest.includes(want) ? want : null);
  const two = solveTwo(pair[0], pair[1], target, other, w, deps, substitute);
  if (!two) return null;
  const third = backSubstitute(E[p], { [target]: two.t, [other]: two.o }, v, w, deps, substitute);
  if (!third) return null;
  const values: Record<string, Q> = { [target]: two.t, [other]: two.o, [v]: third };
  const latex = want ? `${want} = ${qLatex(values[want])}` : vars.map((x) => `${x} = ${qLatex(values[x])}`).join(LIST_SEP);
  return { latex, steps: w.lines(MAX_STEPS) };
}
