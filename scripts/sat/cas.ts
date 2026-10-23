/**
 * The bank's numeric check (no sympy on this machine: mathjs, plain numeric evaluation). The writer
 * gives each question a `verify` block computed from the givens (scripts/sat/prompts.ts); this file
 * checks the stored answer against it, independently of the writer's own answer:
 *
 *  - value, grid-in: every accepted form is within its precision of the computed value (a fraction
 *    or whole number exactly; a decimal to its last digit, so ".6666" and ".6667" both pass for 2/3);
 *  - value, multiple choice: the correct choice's LaTeX, evaluated, IS the computed value, and no
 *    other choice is;
 *  - expression: the target expression and each choice's LaTeX are evaluated at five values of x;
 *    the correct choice matches the target at all of them, every other choice misses at one or more.
 *
 * Anything it cannot read (a choice that is a sentence, an equation, a symbol other than x) is
 * `skipped`, not failed: those questions rest on the independent solve alone.
 */
import { evaluate } from "mathjs";
import type { SatQuestion } from "../../src/lib/sat/contracts";

export type Verify = { kind: "value"; expr: string } | { kind: "expression"; target: string } | { kind: "none" };
export type CasResult = { result: "pass" | "fail" | "skipped"; detail: string };

/** Turn a choice's LaTeX ("$\frac{3}{4}$", "$2\sqrt{3}$", "$2x^2 - 5x - 12$") into mathjs, or null. */
export function latexToMathjs(text: string): string | null {
  let t = text.trim().replace(/^\$+|\$+$/g, "").trim();
  // equations, inequalities, ordered pairs and trig are not single values
  if (!t || /[=<>,]/.test(t) || /\\(le|ge|ne|sin|cos|tan|angle|triangle|overline|theta)\b/.test(t)) return null;
  t = t.replace(/\^\\circ|\^\{\\circ\}/g, "");
  // \frac{a}{b} -> ((a)/(b)), innermost first
  for (let guard = 0; guard < 20 && t.includes("\\frac"); guard++) {
    const next = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "(($1)/($2))");
    if (next === t) break;
    t = next;
  }
  for (let guard = 0; guard < 20 && t.includes("\\sqrt"); guard++) {
    const next = t.replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)");
    if (next === t) break;
    t = next;
  }
  t = t.replace(/\\cdot/g, "*").replace(/\\pi/g, " pi ").replace(/\{/g, "(").replace(/\}/g, ")");
  if (t.includes("\\")) return null;
  // words are not maths
  const words = t.replace(/sqrt|pi/g, "").match(/[A-Za-z]{2,}/g);
  if (words) return null;
  // a single-letter variable before "(" multiplies: x(x - 4) -> x*(x - 4)
  t = t.replace(/\b([a-z])\s*\(/g, "$1*(").replace(/\)\s*\(/g, ")*(");
  return t;
}

function num(expr: string, scope: Record<string, number> = {}): number | null {
  try {
    const v = evaluate(expr, { ...scope }) as unknown;
    const n = typeof v === "number" ? v : typeof (v as { valueOf?: () => unknown })?.valueOf === "function" ? Number((v as { valueOf: () => unknown }).valueOf()) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const close = (a: number, b: number, tol = 1e-7) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/** A grid-in form's value and how precise it is. */
function formValue(f: string): { v: number; tol: number } | null {
  const t = f.trim();
  if (t.includes("/")) {
    const [a, b] = t.replace(/^-/, "").split("/").map(Number);
    if (!b) return null;
    return { v: (t.startsWith("-") ? -1 : 1) * (a / b), tol: 1e-9 };
  }
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  const decimals = t.includes(".") ? t.split(".")[1].length : 0;
  return { v, tol: decimals ? Math.pow(10, -decimals) * 1.0001 : 1e-9 };
}

const POINTS = [1.37, 2.71, -0.63, 3.14, 0.45];

export function casCheck(q: Pick<SatQuestion, "format" | "choices" | "answer">, verify: Verify | null | undefined): CasResult {
  if (!verify || verify.kind === "none") return { result: "skipped", detail: "no numeric form" };
  if (verify.kind === "value") {
    // a bare number is the writer's answer again, not a computation from the givens
    if (/^\s*-?[\d.]+\s*$/.test(verify.expr)) return { result: "skipped", detail: "verify is a bare number" };
    const v = num(verify.expr);
    if (v === null) return { result: "skipped", detail: `verify "${verify.expr}" did not evaluate` };
    if (q.format === "spr" && "accepted" in q.answer) {
      for (const f of q.answer.accepted) {
        const fv = formValue(f);
        if (!fv) return { result: "fail", detail: `accepted "${f}" is not a number` };
        if (Math.abs(fv.v - v) > Math.max(fv.tol, 1e-9 * Math.abs(v))) return { result: "fail", detail: `accepted "${f}" = ${fv.v} but the givens compute ${v}` };
      }
      return { result: "pass", detail: `= ${v}` };
    }
    if (q.format === "mcq" && q.choices && "key" in q.answer) {
      const key = q.answer.key;
      const values = q.choices.map((c) => {
        const m = latexToMathjs(c.text);
        return m === null ? null : num(m);
      });
      const right = values[q.choices.findIndex((c) => c.key === key)];
      if (right === null || right === undefined) return { result: "skipped", detail: "the correct choice is not a number" };
      if (!close(right, v, 1e-6)) return { result: "fail", detail: `choice ${key} = ${right} but the givens compute ${v}` };
      const twins = q.choices.filter((c, i) => c.key !== key && values[i] !== null && close(values[i]!, v, 1e-6)).map((c) => c.key);
      if (twins.length) return { result: "fail", detail: `choice ${twins.join(", ")} also equals ${v}` };
      return { result: "pass", detail: `= ${v}` };
    }
    return { result: "skipped", detail: "shape mismatch" };
  }
  // expression
  if (q.format !== "mcq" || !q.choices || !("key" in q.answer)) return { result: "skipped", detail: "expression check needs choices" };
  const target = POINTS.map((x) => num(verify.target.replace(/\b([a-z])\s*\(/g, "$1*("), { x }));
  if (target.some((t) => t === null)) return { result: "skipped", detail: `target "${verify.target}" did not evaluate` };
  const key = q.answer.key;
  for (const c of q.choices) {
    const m = latexToMathjs(c.text);
    if (m === null) return { result: "skipped", detail: `choice ${c.key} is not an expression in x` };
    const vals = POINTS.map((x) => num(m, { x }));
    if (vals.some((v) => v === null)) return { result: "skipped", detail: `choice ${c.key} did not evaluate` };
    const same = vals.every((v, i) => close(v!, target[i]!));
    if (c.key === key && !same) return { result: "fail", detail: `choice ${key} is not equivalent to ${verify.target}` };
    if (c.key !== key && same) return { result: "fail", detail: `choice ${c.key} is also equivalent to ${verify.target}` };
  }
  return { result: "pass", detail: "equivalent at 5 points, others differ" };
}
