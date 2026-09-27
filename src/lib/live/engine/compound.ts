/**
 * Checking the lines the advanced solvers teach — lines a student writes too:
 *
 *   2x - 3 = 5, \ 2x - 3 = -5     a split into branches: the union of their solutions
 *   x < -2, \ x > 4               a union of inequalities
 *   -3 < x - 1 < 3                a chain: both halves at once
 *   x + 2 = x^2                   under `\sqrt{x + 2} = x`: squaring may add a root, and that is
 *                                 a correct step, not a mistake
 *   x = 2                         under `x = -1, \ x = 2`, dropping the root the first line cannot
 *                                 take: right when it is exactly the original's solution set
 *
 * Every compound line is turned into ONE ordinary relation the equivalence checker already reads:
 * branches of equations as a product equal to zero, a union of inequalities as `min(…) < 0`, a
 * chain as `max(…) < 0`. Pure apart from the mathjs instance passed in.
 */
import type { MathJsInstance, MathNode } from "mathjs";
import type { EngineVerdict } from "../contracts";
import { equationRoots, rootToNumber, satisfies, type Relation, type RootValue } from "./equivalence";
import { safeParse, toNumber } from "./math";

type Op = "==" | "<" | ">" | "<=" | ">=";

/** The parts of `a, \ b, \ c` split at top-level commas (none inside a bracket or a group); null for one part. */
export function splitAtCommas(latex: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+)/.exec(latex.slice(i));
      if (m?.[1] === "left") depth++;
      else if (m?.[1] === "right") depth--;
      i += m ? m[0].length - 1 : 1;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(latex.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(latex.slice(start));
  const clean = parts.map((p) => p.replace(/^(?:\s|\\[ ,;:!]|\\q?quad)+|(?:\s|\\[ ,;:!]|\\q?quad)+$/g, "")).filter(Boolean);
  return clean.length >= 2 ? clean : null;
}

export interface Part {
  op: Op;
  lhs: string;
  rhs: string;
}

/** `h < 0` form of one inequality: `p < q` is `p - q`, `p > q` is `q - p`. */
function below(p: Part): string {
  return p.op === "<" || p.op === "<=" ? `(${p.lhs}) - (${p.rhs})` : `(${p.rhs}) - (${p.lhs})`;
}

/**
 * Branches as one relation: equations → `(f1 - g1) * (f2 - g2) == 0`; inequalities →
 * `min(h1, h2) < 0`. Null for a mix of the two.
 */
export function unionRelation(parts: readonly Part[], variable: string): Relation | null {
  if (parts.every((p) => p.op === "==")) {
    const lhs = parts.map((p) => `((${p.lhs}) - (${p.rhs}))`).join(" * ");
    return { op: "==", lhs, rhs: "0", source: `${lhs} == 0`, variables: [variable] };
  }
  if (parts.some((p) => p.op === "==")) return null;
  const op: Op = parts.every((p) => p.op === "<" || p.op === ">") ? "<" : "<=";
  const lhs = `min(${parts.map(below).join(", ")})`;
  return { op, lhs, rhs: "0", source: `${lhs} ${op} 0`, variables: [variable] };
}

/** `a < f < b` (or `a > f > b`) as `max(a - f, f - b) < 0`; null for anything else. */
export function chainRelation(sources: readonly string[], ops: readonly string[], variable: string): Relation | null {
  if (sources.length !== 3 || ops.length !== 2) return null;
  const up = ops.every((o) => o === "<" || o === "<=");
  const down = ops.every((o) => o === ">" || o === ">=");
  if (!up && !down) return null;
  const [a, f, b] = sources;
  const parts: Part[] = [
    { op: ops[0] as Op, lhs: a, rhs: f },
    { op: ops[1] as Op, lhs: f, rhs: b },
  ];
  const op: Op = ops.every((o) => o === "<" || o === ">") ? "<" : "<=";
  const lhs = `max(${parts.map(below).join(", ")})`;
  return { op, lhs, rhs: "0", source: `${lhs} ${op} 0`, variables: [variable] };
}

/** A root, a bar, a log or the unknown under a line: where a correct step can gain (or lose) a root. */
function restricted(math: MathJsInstance, rel: Relation, variable: string): { abs: boolean; any: boolean } {
  let abs = false;
  let any = false;
  for (const side of [rel.lhs, rel.rhs]) {
    const node = safeParse(math, side);
    if (!node) continue;
    node.traverse((n: MathNode) => {
      const t = n as MathNode & { fn?: { name?: string } | string; args?: MathNode[] };
      const name = n.type === "FunctionNode" ? (typeof t.fn === "string" ? t.fn : t.fn?.name) : n.type === "OperatorNode" ? (typeof t.fn === "string" ? t.fn : "") : "";
      if (name === "abs") abs = true;
      if (name === "abs" || name === "sqrt" || name === "nthRoot" || name === "log" || name === "log10") any = true;
      if (name === "divide" && t.args?.[1]?.toString().includes(variable)) any = true;
    });
  }
  return { abs, any };
}

function realAt(math: MathJsInstance, source: string, variable: string, x: number): number | null {
  try {
    const v = toNumber(math.evaluate(source, { [variable]: x }) as unknown);
    return v !== null && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** `prev` cannot take `x`: a side undefined there, or its sides equal only up to sign (a squaring's root). */
function extraneousFor(math: MathJsInstance, prev: Relation, variable: string, x: number): boolean {
  const l = realAt(math, prev.lhs, variable, x);
  const r = realAt(math, prev.rhs, variable, x);
  if (l === null || r === null) return true;
  return Math.abs(Math.abs(l) - Math.abs(r)) <= 1e-6 * Math.max(1, Math.abs(l), Math.abs(r));
}

const realRoots = (roots: RootValue[] | null): number[] | null => {
  if (!roots) return null;
  const out: number[] = [];
  for (const r of roots) {
    const n = rootToNumber(r);
    if (n !== null) out.push(n);
  }
  return out;
};

/**
 * A `mismatch` that is a correct step after all:
 *  - squaring a root away / clearing a denominator / dropping a log (`\sqrt{x+2} = x` → `x + 2 = x^2`):
 *    nothing lost, and every root gained is one the line above cannot take;
 *  - one branch of an absolute value (`|2x - 3| = 5` → `2x - 3 = 5`), against the line above or the
 *    first line of the work.
 */
export function relaxVerdict(
  math: MathJsInstance,
  verdict: EngineVerdict,
  cur: Relation,
  variable: string,
  prev: Relation | null,
  original: Relation | null,
  /** false for a line that is itself a split (`a, \ b`): it must carry every branch */
  oneBranch = true,
): EngineVerdict {
  if (verdict !== "mismatch" || cur.op !== "==") return verdict;
  const curRoots = realRoots(equationRoots(math, cur, variable).roots);
  if (!curRoots || curRoots.length === 0) return verdict;
  for (const ref of [prev, original]) {
    if (!ref || ref.op !== "==") continue;
    const kind = restricted(math, ref, variable);
    if (!kind.any) continue;
    const refRoots = realRoots(equationRoots(math, ref, variable).roots);
    if (!refRoots) continue;
    const kept = refRoots.every((r) => satisfies(math, cur, variable, r) === true);
    const gained = curRoots.filter((r) => satisfies(math, ref, variable, r) !== true);
    if (ref === prev && kept && gained.every((r) => extraneousFor(math, ref, variable, r))) return "ok";
    if (oneBranch && kind.abs && gained.length === 0) return "ok"; // a branch: its roots are some of the bars' roots
  }
  return verdict;
}

/** Are `values` exactly the real solutions of `original` (the answer after dropping extraneous roots)? */
export function isSolutionSet(math: MathJsInstance, original: Relation, variable: string, values: readonly RootValue[]): boolean {
  if (original.op !== "==" || values.length === 0) return false;
  const roots = realRoots(equationRoots(math, original, variable).roots);
  const nums = realRoots([...values]);
  if (!roots || !nums || nums.length !== values.length || roots.length === 0) return false;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));
  return nums.every((v) => satisfies(math, original, variable, v) === true) && roots.every((r) => nums.some((v) => near(v, r)));
}
