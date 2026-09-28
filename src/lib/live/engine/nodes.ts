/**
 * Reading the shape of a mathjs tree for the solvers: which summands a side has, the constant in
 * front of a term, whether the unknown sits under a root, a bar, a log or in an exponent.
 * Pure: type-only mathjs import.
 */
import type { MathNode } from "mathjs";
import { combineTerms, q, qMul, qNeg, termsOf, type Q, type Term } from "./algebra";
import { exactly, polyFromTerms, type Poly } from "./poly";

type AnyNode = MathNode & {
  type: string;
  fn?: string | { name?: string };
  op?: string;
  args?: MathNode[];
  content?: MathNode;
  value?: unknown;
  name?: string;
};

const asAny = (n: MathNode): AnyNode => n as AnyNode;

/** `add`, `multiply`, `pow`, … for an operator; the function name (`abs`, `sqrt`, `log`) for a call. */
export function fnOf(node: MathNode): string {
  const n = asAny(node);
  if (n.type === "OperatorNode") return typeof n.fn === "string" ? n.fn : (n.fn?.name ?? "");
  if (n.type === "FunctionNode") return typeof n.fn === "string" ? n.fn : (n.fn?.name ?? "");
  return "";
}

export const argsOf = (node: MathNode): MathNode[] => asAny(node).args ?? [];

export function stripParens(node: MathNode): MathNode {
  let n = node;
  while (asAny(n).type === "ParenthesisNode" && asAny(n).content) n = asAny(n).content!;
  return n;
}

/** Does `node` mention the symbol `name` anywhere (function names excluded)? */
export function mentions(node: MathNode, name: string): boolean {
  let found = false;
  node.traverse((n: MathNode, path: string, parent: MathNode | null) => {
    if (found || n.type !== "SymbolNode") return;
    if (parent && parent.type === "FunctionNode" && path === "fn") return;
    if ((n as MathNode & { name: string }).name === name) found = true;
  });
  return found;
}

/** Any sub-node for which `pred` holds. */
export function some(node: MathNode, pred: (n: MathNode) => boolean): boolean {
  let found = false;
  node.traverse((n: MathNode) => {
    if (!found && pred(n)) found = true;
  });
  return found;
}

interface Summand {
  sign: 1 | -1;
  node: MathNode;
}

/** A side as its top-level summands: `3 - 2|x| + 1` → [+3, -(2|x|), +1]. */
export function summands(node: MathNode, sign: 1 | -1 = 1): Summand[] {
  const n = stripParens(node);
  const f = fnOf(n);
  const a = argsOf(n);
  if (asAny(n).type === "OperatorNode") {
    if (f === "add" && a.length === 2) return [...summands(a[0], sign), ...summands(a[1], sign)];
    if (f === "subtract" && a.length === 2) return [...summands(a[0], sign), ...summands(a[1], (-sign) as 1 | -1)];
    if (f === "unaryMinus" && a.length === 1) return summands(a[0], (-sign) as 1 | -1);
    if (f === "unaryPlus" && a.length === 1) return summands(a[0], sign);
  }
  return [{ sign, node: n }];
}

/** The exact value of a node with no unknowns and only + - * / ^ (small integer powers), or null. */
export function constantValue(node: MathNode): Q | null {
  const terms = termsOf(node, []);
  if (!terms) return null;
  return exactly(() => {
    let sum = q(0);
    for (const t of combineTerms(terms)) {
      if (Object.keys(t.vars).length > 0) return null;
      sum = t.c;
    }
    return sum;
  });
}

/**
 * `k · core`: the constant factor in front of a term and what it multiplies — `2\sqrt{x}` is
 * (2, sqrt), `-\frac{|x|}{3}` is (-1/3, abs), `\sqrt{x}` is (1, sqrt).
 */
export function coefficientOf(node: MathNode): { k: Q; core: MathNode } | null {
  const n = stripParens(node);
  const f = fnOf(n);
  const a = argsOf(n);
  if (asAny(n).type === "OperatorNode") {
    if (f === "unaryMinus" && a.length === 1) {
      const inner = coefficientOf(a[0]);
      return inner && exactly(() => ({ k: qNeg(inner.k), core: inner.core }));
    }
    if (f === "multiply" && a.length === 2) {
      const c0 = constantValue(a[0]);
      if (c0) {
        const inner = coefficientOf(a[1]);
        return inner && exactly(() => ({ k: qMul(c0, inner.k), core: inner.core }));
      }
      const c1 = constantValue(a[1]);
      if (c1) {
        const inner = coefficientOf(a[0]);
        return inner && exactly(() => ({ k: qMul(c1, inner.k), core: inner.core }));
      }
    }
    if (f === "divide" && a.length === 2) {
      const d = constantValue(a[1]);
      if (d && d.n !== 0) {
        const inner = coefficientOf(a[0]);
        return inner && exactly(() => ({ k: qMul(inner.k, q(d.d, d.n)), core: inner.core }));
      }
    }
  }
  return { k: q(1), core: n };
}

/** Terms of a polynomial in `variable` (exact), or null. */
export const polyTermsOf = (node: MathNode, variable: string): Term[] | null => termsOf(node, [variable]);

/** A node as an exact polynomial in `variable`, or null. */
export function polyOf(node: MathNode, variable: string): Poly | null {
  const terms = termsOf(node, [variable]);
  return terms ? polyFromTerms(terms, variable) : null;
}
