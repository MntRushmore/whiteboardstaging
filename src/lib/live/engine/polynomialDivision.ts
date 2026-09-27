/**
 * Polynomial long division (A-APR.2, A-APR.6), with the working, as lines that each equal the
 * question — the dividend rewritten one quotient term at a time:
 *
 *   \frac{x^{3} - 2x^{2} + 4}{x - 3}
 *   = \frac{x^{2}(x - 3) + x^{2} + 4}{x - 3}         x^{2} times the divisor, and what is left
 *   = x^{2} + \frac{x^{2} + 4}{x - 3}
 *   = x^{2} + \frac{x(x - 3) + 3x + 4}{x - 3}
 *   = x^{2} + x + \frac{3x + 4}{x - 3}
 *   = x^{2} + x + \frac{3(x - 3) + 13}{x - 3}
 *   = x^{2} + x + 3 + \frac{13}{x - 3}                quotient + remainder over the divisor
 *
 * The remainder is P(3) (the remainder theorem: `P(3) =` under `P(x) = …` is function notation).
 * Taken only when the top has at least the bottom's degree and nothing cancels (a common factor
 * is `polynomial.ts`'s). Over the line budget the rewritten-dividend lines go first. Checked
 * numerically against the question.
 */
import type { MathNode } from "mathjs";
import { q, qAdd, qDiv, qMul, type Q } from "./algebra";
import { chainAgrees, lettersOf, type CourseDeps } from "./courseKit";
import { argsOf, fnOf, polyOf, stripParens } from "./nodes";
import { deg, exactly, lead, polyLatex, polySub, trim, type Poly } from "./poly";
import { StepWriter } from "./solution";

const qTex = (a: Q): string => (a.d === 1 ? String(a.n) : `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`);

/** `x^{2}(x - 3)`, `-2x(x - 3)`, `3(x - 3)`, `(x - 3)` for the quotient term c·x^k times the divisor. */
function timesDivisor(c: Q, k: number, B: Poly, v: string): string {
  const mag: Q = { n: Math.abs(c.n), d: c.d };
  const coef = mag.n === 1 && mag.d === 1 ? "" : qTex(mag);
  const power = k === 0 ? "" : k === 1 ? v : `${v}^{${k}}`;
  return `${c.n < 0 ? "-" : ""}${coef}${power}(${polyLatex(B, v)})`;
}

/** `A + B` where B may start with a minus. */
function plus(a: string, b: string): string {
  if (!a) return b;
  return b.startsWith("-") ? `${a} - ${b.slice(1)}` : `${a} + ${b}`;
}

function fractionTex(top: string, B: Poly, v: string): string {
  const neg = top.startsWith("-") && !/[+-]/.test(top.slice(1));
  return neg ? `-\\frac{${top.slice(1)}}{${polyLatex(B, v)}}` : `\\frac{${top}}{${polyLatex(B, v)}}`;
}

/**
 * The long-division lines for `\frac{A}{B}` (or `A \div B`) in one letter, or null: not a
 * quotient of polynomials, top of lower degree, or a check that fails.
 */
export function longDivisionSteps(deps: CourseDeps, node: MathNode, input: string): string[] | null {
  try {
    return exactly(() => {
      const n = stripParens(node);
      if (n.type !== "OperatorNode" || fnOf(n) !== "divide") return null;
      const letters = lettersOf(n);
      if (letters.length !== 1) return null;
      const v = letters[0];
      const A = polyOf(argsOf(n)[0], v);
      const B = polyOf(argsOf(n)[1], v);
      if (!A || !B || deg(B) < 1 || deg(A) <= deg(B)) return null;
      const w = new StepWriter(deps.normalize, input);
      let R: Poly = [...A];
      let quotient: Poly = [];
      let guard = 0;
      while (R.length > 0 && deg(R) >= deg(B) && guard++ < 8) {
        const k = deg(R) - deg(B);
        const c = qDiv(lead(R), lead(B));
        const term: Poly = new Array(k + 1).fill(q(0));
        term[k] = c;
        const product = mulPoly(term, B);
        const next = polySub(R, product);
        const qTexNow = quotient.length ? polyLatex(quotient, v) : "";
        // the dividend (what is left of it) as the quotient term times the divisor, plus the rest
        const rest = next.length ? polyLatex(next, v) : "";
        const rewritten = rest ? plus(timesDivisor(c, k, B, v), rest) : timesDivisor(c, k, B, v);
        w.write(plus(qTexNow, fractionTex(rewritten, B, v)), true);
        quotient = trim(addPoly(quotient, term));
        R = next;
        const qNow = polyLatex(quotient, v);
        w.write(R.length ? plus(qNow, fractionTex(polyLatex(R, v), B, v)) : qNow);
      }
      if (R.length > 0 && deg(R) >= deg(B)) return null;
      const lines = w.lines();
      if (lines.length === 0) return null;
      if (!chainAgrees(deps, input, lines)) return null;
      return lines;
    });
  } catch {
    return null;
  }
}

function mulPoly(a: Poly, b: Poly): Poly {
  const out: Q[] = new Array(Math.max(0, a.length + b.length - 1)).fill(q(0));
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] = qAdd(out[i + j], qMul(a[i], b[j]));
  return trim(out);
}

function addPoly(a: Poly, b: Poly): Poly {
  const out: Q[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(qAdd(a[i] ?? q(0), b[i] ?? q(0)));
  return trim(out);
}

