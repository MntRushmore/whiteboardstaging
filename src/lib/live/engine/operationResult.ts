/**
 * The equation an operation line leads to (`operationLine.ts`): `2x + 3 = 11` with `-3 \quad -3`
 * under it is `2x = 8`; `2\sin x = 1` with a bar and a `2` under it is `\sin x = \frac{1}{2}`;
 * `-2x < 6` divided by -2 is `x > -3` (the sign turned round). What the tutor writes under a right
 * operation line once the student stops (Suggest and Solve).
 *
 * Simplified the way a student writes the next line: a polynomial side collected into its terms
 * (`termsOf`, highest power first, the number last); any other side as a sum of constant ×
 * something (`\sin x`, `\sqrt{x}`, `2^{x}`), the operation applied to each and like ones collected.
 * '' when it cannot be written simply (multiplying or dividing by a letter, a side it cannot take
 * apart) — the tutor then writes nothing. Pure: type-only mathjs import.
 */
import type { MathNode } from "mathjs";
import { combineTerms, opLatex, qAdd, qDiv, qLatex, qMul, qNeg, standardOrder, termsLatex, termsOf, type Q, type RelOp } from "./algebra";
import { nodeToLatex } from "./format";
import { freeSymbols } from "./math";
import { coefficientOf, constantValue, summands } from "./nodes";
import { exactly } from "./poly";
import type { OperationOp } from "./operationLine";

const FLIP: Record<RelOp, RelOp> = { "==": "==", "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
const SYMBOL: Record<OperationOp, string> = { add: "+", subtract: "-", multiply: "*", divide: "/" };

/** One summand of a side: k × core (`core` null for a number), keyed by the core's LaTeX. */
interface Piece {
  k: Q;
  core: string | null;
}

/** `\sin\left(x\right)` → `\sin x`: a lone letter or number in brackets after a function name. */
function tidyCore(tex: string): string {
  return tex.replace(/\\left\(\s*([a-zA-Z0-9])\s*\\right\)/g, " $1").replace(/\s+/g, " ").trim();
}

/** A side as its summands, each k × core; null when one of them is not that. */
function piecesOf(node: MathNode): Piece[] | null {
  const out: Piece[] = [];
  for (const s of summands(node)) {
    const c = constantValue(s.node);
    if (c) {
      out.push({ k: s.sign < 0 ? qNeg(c) : c, core: null });
      continue;
    }
    const kc = coefficientOf(s.node);
    if (!kc) return null;
    const tex = tidyCore(nodeToLatex(kc.core));
    if (!tex || /\\cdot|\\left|\\right/.test(tex)) return null;
    out.push({ k: s.sign < 0 ? qNeg(kc.k) : kc.k, core: tex });
  }
  return out;
}

/** Like cores collected, zeros dropped, in the order they first appear; `0` for nothing. */
function piecesLatex(pieces: readonly Piece[]): string | null {
  const order: Array<string | null> = [];
  const sum = new Map<string | null, Q>();
  for (const p of pieces) {
    const cur = sum.get(p.core);
    if (!cur) order.push(p.core);
    const next = exactly(() => (cur ? qAdd(cur, p.k) : p.k));
    if (!next) return null;
    sum.set(p.core, next);
  }
  // the number last, as a student writes it
  const cores = [...order.filter((c) => c !== null), ...order.filter((c) => c === null)];
  let out = "";
  for (const core of cores) {
    const k = sum.get(core)!;
    if (k.n === 0) continue;
    const neg = k.n < 0;
    const mag: Q = { n: Math.abs(k.n), d: k.d };
    let body: string;
    if (core === null) body = qLatex(mag);
    else if (mag.n === 1 && mag.d === 1) body = core;
    else body = /^[\d.]/.test(core) ? `${qLatex(mag)} \\cdot ${core}` : `${qLatex(mag)}${core}`;
    out = out ? `${out} ${neg ? "-" : "+"} ${body}` : `${neg ? "-" : ""}${body}`;
  }
  return out || "0";
}

/** One side after the operation, or null. */
function sideAfter(side: string, op: OperationOp, operand: string, factor: Q | null, parse: (source: string) => MathNode | null): string | null {
  const node = parse(`(${side}) ${SYMBOL[op]} (${operand})`);
  if (!node) return null;
  // a polynomial in single letters: its terms, collected
  const letters = freeSymbols(node);
  if (letters.every((v) => /^[a-zA-Z]$/.test(v))) {
    const terms = termsOf(node, letters);
    if (terms) return termsLatex(standardOrder(combineTerms(terms)));
  }
  // anything else: k × core summands, the operation applied to each
  const before = parse(side);
  const pieces = before ? piecesOf(before) : null;
  if (!pieces) return null;
  if (op === "add" || op === "subtract") {
    const added = parse(operand);
    const extra = added ? piecesOf(added) : null;
    if (!extra) return null;
    return piecesLatex([...pieces, ...extra.map((p) => (op === "subtract" ? { ...p, k: qNeg(p.k) } : p))]);
  }
  if (!factor) return null;
  const scaled = exactly(() => pieces.map((p) => ({ ...p, k: op === "multiply" ? qMul(p.k, factor) : qDiv(p.k, factor) })));
  return scaled ? piecesLatex(scaled) : null;
}

/**
 * Is the relation (a line's mathjs source) linear in its unknowns — every side a polynomial in
 * single letters with no term of degree 2 or more, once everything is on one side? A chain
 * (`max(a - f, f - b) < 0`, `compound.ts`) is linear when each of its parts is. Anything with a
 * power, a product of unknowns, a function (trig, a log, a root) or an unknown in a denominator
 * is not; neither is a union or a list of branches. Decides whether two different operands under
 * it are a mistake or scratch work (`judgeOperation`).
 */
export function linearRelation(relationMath: string, parse: (source: string) => MathNode | null): boolean {
  try {
    const m = relationMath.trim();
    let exprs: string[];
    const chain = /^max\((.*)\)\s*<=?\s*0$/.exec(m);
    if (chain) {
      const node = parse(`max(${chain[1]})`);
      const args = node ? ((node as MathNode & { args?: MathNode[] }).args ?? []) : [];
      if (args.length !== 2) return false;
      exprs = args.map((a) => a.toString());
    } else {
      if (/^min\(|!=/.test(m) || /^\(\(.*\)\) \* \(\(.*\)\) == 0$/.test(m)) return false;
      const parts = m.split(/(<=|>=|==|<|>)/).map((p) => p.trim());
      if (parts.length < 3 || parts.length % 2 === 0 || parts.some((p) => !p)) return false;
      const sides = parts.filter((_, i) => i % 2 === 0);
      exprs = sides.slice(1).map((s, i) => `(${sides[i]}) - (${s})`);
    }
    for (const e of exprs) {
      const node = parse(e);
      if (!node) return false;
      const letters = freeSymbols(node);
      if (!letters.every((v) => /^[a-zA-Z]$/.test(v))) return false;
      const terms = termsOf(node, letters);
      if (!terms) return false;
      if (combineTerms(terms).some((t) => Object.values(t.vars).reduce((a, b) => a + b, 0) > 1)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The relation `relationMath` (a line's mathjs source: `2 * x + 3 == 11`, `-3 < 2 * x + 1 < 7`)
 * after `op` by `operandMath` on every side, as LaTeX; '' when it cannot be written simply.
 */
export function operationResult(relationMath: string, op: OperationOp, operandMath: string, parse: (source: string) => MathNode | null): string {
  try {
    const parts = relationMath.split(/(<=|>=|==|<|>)/).map((p) => p.trim());
    if (parts.length < 3 || parts.length % 2 === 0 || parts.some((p) => !p)) return "";
    const sides = parts.filter((_, i) => i % 2 === 0);
    const rels = parts.filter((_, i) => i % 2 === 1) as RelOp[];
    const operandNode = parse(operandMath);
    if (!operandNode) return "";
    let factor: Q | null = null;
    if (op === "multiply" || op === "divide") {
      factor = constantValue(operandNode);
      // a letter may be 0: no result; by 0 there is none
      if (!factor || factor.n === 0) return "";
    }
    const flip = factor !== null && factor.n < 0;
    const out: string[] = [];
    for (const side of sides) {
      const tex = sideAfter(side, op, operandMath, factor, parse);
      if (tex === null) return "";
      out.push(tex);
    }
    let latex = out[0];
    rels.forEach((rel, i) => {
      latex += ` ${opLatex(flip ? FLIP[rel] : rel)} ${out[i + 1]}`;
    });
    return latex;
  } catch {
    return "";
  }
}

