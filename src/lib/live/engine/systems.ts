/**
 * Solving for an unknown from the lines ABOVE it — the part of algebra a single line cannot do.
 *
 *   x + y = 18        x + y = 18
 *   y = 9             x - y = 4
 *   x = ?             (Solve)
 *   ─────────         ─────────
 *   x + 9 = 18        y = 18 - x
 *   x = 9             x - (18 - x) = 4
 *                     2x = 22
 *                     x = 11
 *                     y = 18 - 11
 *                     y = 7
 *
 * Two cases, both the way a teacher writes them: a known value substituted into an equation
 * that then has one unknown left, or two linear equations in two unknowns by substitution
 * (isolate a variable whose coefficient is ±1 where there is one). Where no such coefficient
 * exists substitution would write fractions, so two equations are solved by elimination instead,
 * and three equations in three unknowns always are (`elimination.ts`). Anything else is `null`:
 * never a guess, and the caller decides whether a model may try.
 */
import { qAdd, qLatex, qMul, type Q } from "./algebra";
import { eliminateTwo, solveThreeByElimination } from "./elimination";
import { exactly, qFromNumber } from "./poly";
import { LIST_SEP } from "./solution";

/** `x = ?`, `x =`, `x = \text{?}` — the student asking for x. */
export function questionVariable(latex: string): string | null {
  const s = latex
    .replace(/\\text\s*\{\s*\?\s*\}/g, "?")
    .replace(/\\[,;:! ]|\\quad|\\qquad|~/g, "")
    .replace(/\s+/g, "");
  const m = /^([a-zA-Z])=\??$/.exec(s);
  return m ? m[1] : null;
}

/**
 * Replaces the standalone variable letters in `latex` (never letters inside a command such as
 * `\frac`) with the given LaTeX, bracketed when it follows a coefficient or is not a plain
 * non-negative number: `3y` with y = 9 is `3(9)`, `x + y` with y = 9 is `x + 9`.
 */
export function substituteLatex(latex: string, values: Record<string, string>): string {
  let out = "";
  const re = /(\\[a-zA-Z]+)|([a-zA-Z])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latex))) {
    out += latex.slice(last, m.index);
    last = re.lastIndex;
    if (m[1] || !(m[2] in values)) {
      out += m[0];
      continue;
    }
    const value = values[m[2]];
    const before = out.trimEnd().slice(-1);
    const after = latex.slice(re.lastIndex).trimStart().charAt(0);
    const plain = /^\d+(?:\.\d+)?$/.test(value);
    const glued = /[0-9a-zA-Z)}]/.test(before);
    // a whole side needs no bracket (`2x + 1 = x^{2}`), nor a negative number opening a sum (`-8 + 3`)
    const wholeSide = (before === "" || before === "=") && (after === "" || after === "=");
    const leadingNegative = /^-\d+(?:\.\d+)?$/.test(value) && (before === "" || before === "=") && ["", "+", "-", "="].includes(after);
    out += (plain && !glued) || wholeSide || leadingNegative ? value : `(${value})`;
  }
  return out + latex.slice(last);
}

export interface LinearForm {
  /** coefficient per variable */
  coef: Record<string, number>;
  /** constant term: the equation is sum(coef * v) + constant = 0 */
  constant: number;
}

type NumFmt = (n: number) => string;

/**
 * A rearranged side as a student writes it: `x - 1`, `2x + 1` (variable first when its
 * coefficient is positive), `18 - x`, `4 - \frac{2}{3}x` (constant first when it is negative).
 */
export function linearLatex(constant: number, coef: number, variable: string, fmt: NumFmt): string {
  const hasC = Math.abs(constant) > 1e-12;
  const hasV = Math.abs(coef) > 1e-12;
  if (!hasV) return fmt(constant);
  const mag = Math.abs(coef);
  const term = Math.abs(mag - 1) < 1e-12 ? variable : `${fmt(mag)}${variable}`;
  if (!hasC) return coef < 0 ? `-${term}` : term;
  const c = Math.abs(constant);
  if (coef > 0) return `${term} ${constant < 0 ? "-" : "+"} ${fmt(c)}`;
  return `${fmt(constant)} - ${term}`;
}

export interface SystemSolution {
  /** the answer line for the variable asked for (or the first one solved) */
  latex: string;
  steps: string[];
}

export interface SystemDeps {
  /** one relation per line: sides as mathjs source, its free unknowns and whether it has units */
  parse(latex: string): { lhs: string; rhs: string; unknowns: string[]; latex: string } | null;
  /** single-unknown solve with steps (the engine's `solveLatex`) */
  solveOne(latex: string): { latex: string; steps: string[] } | null;
  /**
   * A linear equation whose unknown cancels: its steps down to `0 = 0` (identity) or `0 = 2`
   * (contradiction). Null when the unknown does not cancel. Optional for test doubles.
   */
  cancelled?(latex: string): { steps: string[]; outcome: "identity" | "contradiction" } | null;
  /** the single real root of a one-unknown equation, when there is exactly one */
  singleRoot(latex: string, variable: string): number | null;
  /**
   * A one-unknown equation solved exactly, with its steps and real roots (`exact` when rational);
   * null when no exact method applies. Optional for test doubles.
   */
  solveRoots?(latex: string): { steps: string[]; roots: Array<{ latex: string; value: number; exact?: Q }> | null } | null;
  /** evaluates `lhs - rhs` of a parsed relation at a scope */
  evalG(lhs: string, rhs: string, scope: Record<string, number>): number | null;
  fmt: NumFmt;
  normalize(latex: string): string;
}

function linearFormOf(deps: SystemDeps, lhs: string, rhs: string, vars: [string, string]): LinearForm | null {
  const [a, b] = vars;
  const at = (x: number, y: number) => deps.evalG(lhs, rhs, { [a]: x, [b]: y });
  const c0 = at(0, 0);
  const ga = at(1, 0);
  const gb = at(0, 1);
  if (c0 === null || ga === null || gb === null) return null;
  const ca = ga - c0;
  const cb = gb - c0;
  // linear: agree with the plane at two more irregular points
  for (const [x, y] of [
    [2.3, -1.7],
    [-3.1, 4.9],
  ]) {
    const g = at(x, y);
    if (g === null) return null;
    const predicted = c0 + ca * x + cb * y;
    if (Math.abs(g - predicted) > 1e-7 * Math.max(1, Math.abs(g))) return null;
  }
  return { coef: { [a]: ca, [b]: cb }, constant: c0 };
}

/** Round-trip-safe number for the next step's LaTeX (fractions stay exact via `fmt`). */
function clean(n: number): number {
  const r = Math.round(n * 1e9) / 1e9;
  return Object.is(r, -0) ? 0 : r;
}

/** The empty set: two parallel lines have no point in common. Drawn by the hand as `∅`. */
export const EMPTY_SET = "\\varnothing";

/** The Solve block's line budget (`LIVE_LIMITS.maxSolveSteps`): the answer must survive the cut. */
export const MAX_SYSTEM_STEPS = 8;

/** Index of the `y = 18 - 11` back-substitution line, the first thing to drop when over budget. */
function backIndex(steps: string[], other: string, otherFinal: string, backExpr: string, deps: SystemDeps): number {
  const line = `${other} = ${backExpr}`;
  if (deps.normalize(line) === deps.normalize(otherFinal)) return -1;
  return steps.lastIndexOf(line);
}

/**
 * Keeps a system's steps within the block budget without losing the answer: over budget, the
 * back-substitution line goes first, then the working lines after the substitution, oldest
 * first — the setup (the first `keepHead` lines) and the last three lines always stay.
 */
function fitSteps(steps: string[], keepHead: number, dropFirst = -1): string[] {
  const out = [...steps];
  if (out.length > MAX_SYSTEM_STEPS && dropFirst >= 0) out.splice(dropFirst, 1);
  while (out.length > MAX_SYSTEM_STEPS && out.length - keepHead > 3) out.splice(keepHead, 1);
  return out;
}

export function solveFromLines(lines: readonly string[], deps: SystemDeps): SystemSolution | null {
  let want: string | null = null;
  const known = new Map<string, number>();
  const facts: Array<{ lhs: string; rhs: string; unknowns: string[]; latex: string }> = [];

  for (const raw of lines) {
    const q = questionVariable(raw);
    if (q) {
      want = q;
      continue;
    }
    const rel = deps.parse(raw);
    if (!rel || rel.unknowns.length === 0) continue;
    if (rel.unknowns.length === 1) {
      const v = rel.unknowns[0];
      const root = deps.singleRoot(raw, v);
      if (root !== null) known.set(v, clean(root));
      continue;
    }
    facts.push(rel);
  }
  if (facts.length === 0) {
    // `x = ?` under `2x = 8`: already known
    if (want && known.has(want)) return { latex: `${want} = ${deps.fmt(known.get(want)!)}`, steps: [`${want} = ${deps.fmt(known.get(want)!)}`] };
    return null;
  }

  // 1. a known value substituted into an equation that is left with one unknown
  for (let i = facts.length - 1; i >= 0; i--) {
    const f = facts[i];
    const used = f.unknowns.filter((v) => known.has(v));
    const rest = f.unknowns.filter((v) => !known.has(v));
    if (used.length === 0 || rest.length !== 1) continue;
    if (want && rest[0] !== want) continue;
    const values: Record<string, string> = {};
    for (const v of used) values[v] = deps.fmt(known.get(v)!);
    const substituted = substituteLatex(f.latex, values);
    const solved = deps.solveOne(substituted);
    if (!solved) continue;
    const steps = [substituted, ...solved.steps.filter((s) => deps.normalize(s) !== deps.normalize(substituted))];
    return { latex: solved.latex, steps };
  }

  // 2. two linear equations in the same two unknowns, by substitution
  for (let i = facts.length - 1; i >= 1; i--) {
    for (let j = i - 1; j >= 0; j--) {
      const e1 = facts[j];
      const e2 = facts[i];
      const vars = [...new Set(e1.unknowns)].sort();
      if (vars.length !== 2 || [...new Set(e2.unknowns)].sort().join() !== vars.join()) continue;
      if (want && !vars.includes(want)) continue;
      const pair = vars as [string, string];
      const f1 = linearFormOf(deps, e1.lhs, e1.rhs, pair);
      const f2 = linearFormOf(deps, e2.lhs, e2.rhs, pair);
      if (!f1 || !f2) continue;
      const [a, b] = pair;
      const det = f1.coef[a] * f2.coef[b] - f1.coef[b] * f2.coef[a];
      const singular = Math.abs(det) < 1e-9; // parallel or the same line: no single solution

      // Isolate the variable NOT asked for, from the equation where its coefficient is ±1 if any.
      const target = want ?? a;
      const other = target === a ? b : a;
      const candidates: Array<[LinearForm, typeof e1, LinearForm, typeof e1]> = [
        [f1, e1, f2, e2],
        [f2, e2, f1, e1],
      ];
      candidates.sort(([fa], [fb]) => Number(Math.abs(Math.abs(fb.coef[other]) - 1) < 1e-12) - Number(Math.abs(Math.abs(fa.coef[other]) - 1) < 1e-12));
      const [iso, , , into] = candidates.find(([f]) => Math.abs(f.coef[other]) > 1e-12) ?? [];
      if (!iso || !into) continue;
      // other = k0 + k1 * target
      const k0 = clean(-iso.constant / iso.coef[other]);
      const k1 = clean(-iso.coef[target] / iso.coef[other]);
      const expr = linearLatex(k0, k1, target, deps.fmt);
      const step1 = `${other} = ${expr}`;
      const step2 = substituteLatex(into.latex, { [other]: expr });
      if (singular) {
        // Substitute anyway, as a teacher would, until the unknown cancels: `0 = 0` means the
        // two equations are one line (every point of `y = 18 - x`), `0 = 2` that they never meet.
        const cancelled = deps.cancelled?.(step2);
        if (!cancelled) continue;
        const steps = [step1, step2, ...cancelled.steps.filter((s) => deps.normalize(s) !== deps.normalize(step2))];
        const final = cancelled.outcome === "identity" ? step1 : EMPTY_SET;
        steps.push(final);
        return { latex: final, steps: fitSteps(steps, 2) };
      }
      // no coefficient ±1 to isolate, so substitution would write fractions: eliminate instead
      if (!Number.isInteger(k0) || !Number.isInteger(k1)) {
        const eliminated = eliminateTwo(e1, e2, pair, want, deps, substituteLatex);
        if (eliminated) return eliminated;
      }
      const solved = deps.solveOne(step2);
      if (!solved) continue;
      const tv = deps.singleRoot(step2, target);
      if (tv === null) continue;
      const tval = clean(tv);
      const oval = clean(k0 + k1 * tval);
      const backExpr = substituteLatex(expr, { [target]: deps.fmt(tval) });
      const steps = [step1, step2, ...solved.steps.filter((s) => deps.normalize(s) !== deps.normalize(step2))];
      const otherFinal = `${other} = ${deps.fmt(oval)}`;
      if (deps.normalize(`${other} = ${backExpr}`) !== deps.normalize(otherFinal)) steps.push(`${other} = ${backExpr}`);
      steps.push(otherFinal);
      return { latex: solved.latex, steps: fitSteps(steps, 2, backIndex(steps, other, otherFinal, backExpr, deps)) };
    }
  }

  // 3. three linear equations in three unknowns, by elimination; 4. one linear, one not
  return solveThreeByElimination(facts, want, deps, substituteLatex) ?? substituteIntoNonLinear(facts, want, deps);
}

/** `(w + 3) \cdot w` → `(w + 3)w`: a substituted bracket needs no dot. */
function tidyProduct(latex: string): string {
  return latex.replace(/\)\s*\\cdot\s*(?=[a-zA-Z(])/g, ")").replace(/([a-zA-Z])\s*\\cdot\s*\(/g, "$1(");
}

/**
 * Two equations in the same two unknowns, one linear and one not (`l = w + 3`, `l \cdot w = 40`),
 * by substitution, the way a teacher writes it:
 *
 *   l = w + 3, l \cdot w = 40     (the student's lines)
 *   (w + 3)w = 40                 the linear one substituted into the other
 *   w^{2} + 3w = 40 … (w + 8)(w - 5) = 0
 *   w = -8, \ w = 5               the one-unknown equation's own exact steps
 *   l = -8 + 3, \ l = 5 + 3       each root put back
 *   l = -5, \ l = 8               the partner of each root, in the same order
 *
 * The unknown isolated is the one alone on a side of the linear line (else one with coefficient
 * ±1) — the one asked for when there is one, so its values end the block. No real root is `\varnothing`. Null when the roots are not
 * rational (a surd would need putting back symbolically) or no exact method solves the line.
 */
function substituteIntoNonLinear(facts: ReadonlyArray<{ lhs: string; rhs: string; unknowns: string[]; latex: string }>, want: string | null, deps: SystemDeps): SystemSolution | null {
  if (!deps.solveRoots) return null;
  for (let i = facts.length - 1; i >= 1; i--) {
    for (let j = i - 1; j >= 0; j--) {
      const pairVars = [...new Set(facts[j].unknowns)].sort();
      if (pairVars.length !== 2 || [...new Set(facts[i].unknowns)].sort().join() !== pairVars.join()) continue;
      if (want && !pairVars.includes(want)) continue;
      const pair = pairVars as [string, string];
      const forms = [facts[j], facts[i]].map((f) => linearFormOf(deps, f.lhs, f.rhs, pair));
      if (forms[0] && forms[1]) continue; // both linear: substitution or elimination above
      const k = forms[0] ? 0 : forms[1] ? 1 : -1;
      if (k < 0) continue;
      const lin = k === 0 ? facts[j] : facts[i];
      const other = k === 0 ? facts[i] : facts[j];
      const form = forms[k]!;
      const alone = (v: string) => new RegExp(`(^|=)\\s*${v}\\s*(=|$)`).test(lin.latex.replace(/\s+/g, " "));
      // the unknown put back last is the one whose values end the block: the one asked for
      const choices = [...pair]
        .reverse()
        .filter((v) => Math.abs(form.coef[v]) > 1e-12)
        .sort((a, b) => Number(b === want) - Number(a === want) || Number(alone(b)) - Number(alone(a)) || Number(Math.abs(Math.abs(form.coef[b]) - 1) < 1e-12) - Number(Math.abs(Math.abs(form.coef[a]) - 1) < 1e-12));
      const iso = choices[0];
      if (!iso) continue;
      const keep = pair[0] === iso ? pair[1] : pair[0];
      const k0 = clean(-form.constant / form.coef[iso]);
      const k1 = clean(-form.coef[keep] / form.coef[iso]);
      const q0 = qFromNumber(k0);
      const q1 = qFromNumber(k1);
      if (!q0 || !q1) continue;
      const expr = linearLatex(k0, k1, keep, deps.fmt);
      const isolated = `${iso} = ${expr}`;
      const substituted = tidyProduct(substituteLatex(other.latex, { [iso]: expr }));
      const sol = deps.solveRoots(substituted);
      if (!sol || !sol.roots) continue;
      const steps: string[] = [];
      if (deps.normalize(isolated) !== deps.normalize(lin.latex)) steps.push(isolated);
      steps.push(substituted, ...sol.steps.filter((s) => deps.normalize(s) !== deps.normalize(substituted)));
      if (sol.roots.length === 0) {
        if (steps[steps.length - 1] !== EMPTY_SET) steps.push(EMPTY_SET);
        return { latex: EMPTY_SET, steps: fitSteps(steps, 1) };
      }
      const roots = [...sol.roots].sort((a, b) => a.value - b.value);
      if (roots.some((r) => !r.exact)) continue;
      const values = exactly(() => roots.map((r) => qAdd(q0, qMul(q1, r.exact!))));
      if (!values) continue;
      const back = `${roots.map((r) => `${iso} = ${substituteLatex(expr, { [keep]: qLatex(r.exact!) })}`).join(LIST_SEP)}`;
      const final = values.map((v) => `${iso} = ${qLatex(v)}`).join(LIST_SEP);
      if (deps.normalize(back) !== deps.normalize(final)) steps.push(back);
      steps.push(final);
      return { latex: final, steps: fitSteps(steps, 1, steps.lastIndexOf(back)) };
    }
  }
  return null;
}
