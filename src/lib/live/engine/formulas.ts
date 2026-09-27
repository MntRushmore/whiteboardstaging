/**
 * A formula with every value known, worked out in the student's own decimals (F-LE.5, A-CED.1):
 *
 *   A = P(1 + r)^{t}, P = 1000, r = 0.05, t = 3, A = ?
 *   A = 1000(1 + 0.05)^{3}          the values as written (not `\frac{1}{20}`)
 *   A = 1000(1.05)^{3}              brackets first
 *   A = 1000(1.157625)              then powers
 *   A = 1157.625                    then products
 *
 * Only when a value is written in decimals (the systems path substitutes whole numbers and
 * fractions exactly already). A value with no short decimal is rounded to the cent and written
 * with `\approx` (`A \approx 1348.85`) — money is. Checked against the formula evaluated directly.
 */
import type { MathNode } from "mathjs";
import { evalLatex, lettersOf, numberLatex, parseExpr, printNode, questionName, splitEquation, type CourseDeps } from "./courseKit";
import { substituteParam } from "./functionNotation";
import { argsOf, fnOf, stripParens } from "./nodes";

type AnyNode = MathNode & { value?: unknown; content?: MathNode };

function isConst(n: MathNode): boolean {
  const s = stripParens(n) as AnyNode;
  return s.type === "ConstantNode" || (s.type === "SymbolNode" && ((s as MathNode & { name: string }).name === "e" || (s as MathNode & { name: string }).name === "pi"));
}

/**
 * One round of arithmetic: every innermost bracket worked out; else every power; else every
 * product / quotient; else every sum. Null when nothing is left to do or a value is not exact.
 */
function reduceOnce(deps: CourseDeps, node: MathNode): MathNode | null {
  const math = deps.math;
  const value = (n: MathNode): number | null => {
    try {
      const v = n.compile().evaluate({});
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };
  const allConst = (n: MathNode) => {
    let ok = true;
    n.traverse((x: MathNode) => {
      if (x.type === "SymbolNode" && !["e", "pi"].includes((x as MathNode & { name: string }).name)) ok = false;
      if (x.type === "ParenthesisNode" && x !== n) ok = false;
    });
    return ok;
  };
  let changed = false;
  const stage = (pred: (n: MathNode) => boolean) =>
    node.transform((n: MathNode) => {
      if (!pred(n)) return n;
      const v = value(n);
      if (v === null) return n;
      changed = true;
      return new math.ConstantNode(v);
    });
  // brackets: `(1 + 0.05)` → 1.05 (a bracket round a lone number stays for the next line)
  let out = stage((n) => n.type === "ParenthesisNode" && !isConst((n as AnyNode).content!) && allConst((n as AnyNode).content!));
  if (changed) return out;
  const op = (name: string) => (n: MathNode) => n.type === "OperatorNode" && fnOf(n) === name && argsOf(n).every(isConst);
  for (const name of ["pow", "multiply", "divide", "add", "subtract", "unaryMinus"]) {
    changed = false;
    out = stage(op(name));
    if (changed) return out;
  }
  return null;
}

/** `(1.05)` keeps its bracket in print: `1000(1.05)^{3}`. Null once a value has no short decimal. */
function print(node: MathNode): string | null {
  return printNode(node, (x) => numberLatex(x, true));
}

/**
 * The column's `X = ?` from a formula `X = …` above and a value for every other letter, or null.
 */
export function formulaAnswer(deps: CourseDeps, lines: readonly string[]): { latex: string; steps: string[] } | null {
  try {
    const target = lines[lines.length - 1] ?? "";
    const asked = questionName(target);
    if (!asked || !/^[a-zA-Z]$/.test(asked)) return null;
    const known = new Map<string, string>();
    let formula: [string, string] | null = null;
    for (const l of lines.slice(0, -1)) {
      const sides = splitEquation(l);
      if (!sides) return null;
      const left = sides[0].trim();
      const rightNode = parseExpr(deps, sides[1]);
      if (!rightNode) return null;
      if (/^[a-zA-Z]$/.test(left) && lettersOf(rightNode).length === 0) {
        known.set(left, sides[1].trim());
        continue;
      }
      if (left === asked && !formula) {
        formula = [left, sides[1]];
        continue;
      }
      return null;
    }
    if (!formula || known.has(asked)) return null;
    // decimals only: whole numbers and fractions are the systems path's
    if (![...known.values()].some((v) => /\d\.\d/.test(v))) return null;
    const rhsNode = parseExpr(deps, formula[1]);
    if (!rhsNode) return null;
    const letters = lettersOf(rhsNode);
    if (letters.length === 0 || letters.some((v) => !known.has(v))) return null;
    let substituted = formula[1];
    for (const v of letters) substituted = substituteParam(substituted, v, known.get(v)!);
    const steps: string[] = [`${asked} = ${substituted}`];
    let node = parseExpr(deps, substituted);
    if (!node) return null;
    for (let guard = 0; guard < 6; guard++) {
      const next = reduceOnce(deps, node);
      if (!next) break;
      node = next;
      const tex = print(node);
      if (!tex) break;
      const line = `${asked} = ${tex}`;
      if (deps.normalize(line) !== deps.normalize(steps[steps.length - 1])) steps.push(line);
    }
    const scope = Object.fromEntries([...known.entries()].map(([k, v]) => [k, evalLatex(deps, v)?.re ?? NaN]));
    const direct = evalLatex(deps, formula[1], scope);
    if (!direct || Math.abs(direct.im) > 1e-9) return null;
    const exact = numberLatex(direct.re, true);
    const final = exact !== null ? `${asked} = ${exact}` : `${asked} \\approx ${direct.re.toFixed(2)}`;
    // the last reduced line is the value, or it is replaced by the value (rounded when it must be)
    const last = steps[steps.length - 1];
    const lastValue = evalLatex(deps, last.split("=")[1] ?? "");
    if (!lastValue || Math.abs(lastValue.re - direct.re) > 1e-9 * Math.max(1, Math.abs(direct.re))) return null;
    if (deps.normalize(last) !== deps.normalize(final)) {
      if (/^[^=]*=\s*-?\d+(?:\.\d+)?$/.test(last)) steps.pop();
      steps.push(final);
    }
    return { latex: final, steps: steps.slice(0, 8) };
  } catch {
    return null;
  }
}
