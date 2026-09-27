/**
 * Solving a formula for one of its letters (A-CED.4), the way a teacher writes it:
 *
 *   A = \frac{1}{2}bh   (h = ?)      P = 2l + 2w   (w = ?)      x = \frac{y + 1}{y - 2}   (y)
 *   2A = bh                         P - 2l = 2w                 x(y - 2) = y + 1
 *   h = \frac{2A}{b}                w = \frac{P - 2l}{2}        xy - 2x = y + 1
 *                                                               xy - y = 2x + 1
 *   A = \pi r^{2}   (r = ?)                                     y(x - 1) = 2x + 1
 *   \frac{A}{\pi} = r^{2}                                       y = \frac{2x + 1}{x - 1}
 *   r = \sqrt{\frac{A}{\pi}}
 *
 * Two methods. LINEAR: every denominator cleared by the LCD (shown unexpanded), brackets
 * expanded, the terms with the letter on one side and the rest on the other, the letter factored
 * out when it is in several terms, then divided out. PEEL: the letter in ONE place under a power,
 * a root, an exponential or a log — the rest moved away, the coefficient divided, the operation
 * undone (the principal root for an even power: a formula's lengths are positive), then the
 * linear method on what is left. Every answer is checked numerically in the original line
 * before it is returned; anything else is `null`.
 */
import type { MathNode } from "mathjs";
import { combineTerms, q, qDiv, qMul, qNeg, standardOrder, termsOf, type Q, type Term } from "./algebra";
import { equationHolds, lettersOf, parseExpr, printNode, sampleScopes, splitEquation, type CourseDeps } from "./courseKit";
import { argsOf, constantValue, fnOf, mentions, stripParens, summands } from "./nodes";
import { exactly, qIsZero } from "./poly";
import { StepWriter } from "./solution";

export interface LiteralSolution {
  steps: string[];
  /** the answer line, `h = \frac{2A}{b}` */
  final: string;
  /** its right-hand side */
  value: string;
}

// ---------------------------------------------------------------- printing terms

/** A symbol as written: `\pi`, `y_{1}`, `x`. */
export function symbolTex(name: string): string {
  if (name === "pi") return "\\pi";
  if (/^[a-zA-Z]_[a-zA-Z0-9]+$/.test(name)) return `${name[0]}_{${name.slice(2)}}`;
  return name;
}

function monoTex(vars: Record<string, number>): string {
  // π first, then capitals, then small letters (`\pi r^{2}h`, `Prt`, `2A`)
  const rank = (v: string) => (v === "pi" ? 0 : /^[A-Z]/.test(v) ? 1 : 2);
  const names = Object.keys(vars).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  let out = "";
  for (const v of names) {
    const body = vars[v] === 1 ? symbolTex(v) : `${symbolTex(v)}^{${vars[v]}}`;
    out += out && /\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(body) ? ` ${body}` : body;
  }
  return out;
}

function qTex(a: Q): string {
  if (a.d === 1) return String(a.n);
  return `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`;
}

function termBody(t: Term): string {
  const mono = monoTex(t.vars);
  const mag: Q = { n: Math.abs(t.c.n), d: t.c.d };
  if (!mono) return qTex(mag);
  if (mag.n === 1 && mag.d === 1) return mono;
  return `${qTex(mag)}${mono}`;
}

/** `2x - 3y + 1`, `\pi r^{2}h`; `0` for none. Terms in the order given. */
export function termsTex(terms: readonly Term[]): string {
  let out = "";
  for (const t of terms) {
    const body = termBody(t);
    const neg = t.c.n < 0;
    if (!out) out = neg ? `-${body}` : body;
    else out += ` ${neg ? "-" : "+"} ${body}`;
  }
  return out || "0";
}

const negate = (ts: readonly Term[]): Term[] => ts.map((t) => ({ c: qNeg(t.c), vars: { ...t.vars } }));

const isNumberTerm = (t: Term): boolean => Object.keys(t.vars).length === 0;

/** A sum as a factor: `(x - 1)` when it has several terms, the term itself otherwise. */
function factorTex(ts: readonly Term[]): string {
  return ts.length > 1 ? `(${termsTex(ts)})` : termsTex(ts);
}

// ---------------------------------------------------------------- fractions

interface Parts {
  num: MathNode[];
  den: MathNode[];
}

/** A product / quotient as its factors above and below the bar. */
function fracParts(node: MathNode): Parts {
  const n = stripParens(node);
  const f = fnOf(n);
  const a = argsOf(n);
  if (n.type === "OperatorNode") {
    if (f === "multiply" && a.length === 2) {
      const l = fracParts(a[0]);
      const r = fracParts(a[1]);
      return { num: [...l.num, ...r.num], den: [...l.den, ...r.den] };
    }
    if (f === "divide" && a.length === 2) {
      const l = fracParts(a[0]);
      const r = fracParts(a[1]);
      return { num: [...l.num, ...r.den], den: [...l.den, ...r.num] };
    }
  }
  return { num: [n], den: [] };
}

interface Cleared {
  /** the line with every denominator cleared, as written (unexpanded) */
  latex: string;
  /** each side's summands, cleared, as nodes */
  sides: [MathNode, MathNode];
  cleared: boolean;
}

/**
 * Multiplies both sides by the LCD: the lcm of the numeric denominators times every distinct
 * symbolic denominator. Null when a denominator is zero or the line cannot be printed.
 */
function clearDenominators(deps: CourseDeps, L: MathNode, R: MathNode): Cleared | null {
  const math = deps.math;
  const sideSummands = [summands(L), summands(R)];
  let numericLcm = 1;
  const symbolic: Array<{ key: string; node: MathNode }> = [];
  const info = sideSummands.map((ss) =>
    ss.map((s) => {
      const parts = fracParts(s.node);
      let k: Q = q(s.sign);
      const num: MathNode[] = [];
      const den: Array<{ key: string; node: MathNode }> = [];
      for (const f of parts.num) {
        const c = constantValue(f);
        if (c) k = qMul(k, c);
        else num.push(f);
      }
      for (const f of parts.den) {
        const c = constantValue(f);
        if (c) {
          if (qIsZero(c)) throw new Error("zero denominator");
          k = qDiv(k, c);
        } else {
          const key = stripParens(f).toString();
          den.push({ key, node: stripParens(f) });
          if (!symbolic.some((x) => x.key === key)) symbolic.push({ key, node: stripParens(f) });
        }
      }
      return { k, num, den };
    }),
  );
  for (const side of info) for (const s of side) numericLcm = lcmInt(numericLcm, s.k.d);
  if (numericLcm === 1 && symbolic.length === 0) return { latex: "", sides: [L, R], cleared: false };
  const printed: string[][] = [];
  const nodes: MathNode[] = [];
  for (const side of info) {
    const texts: string[] = [];
    const parts: string[] = [];
    for (const s of side) {
      const missing = symbolic.filter((x) => !s.den.some((d) => d.key === x.key));
      // a denominator written twice (`\frac{1}{x^{2}}` as x·x) is out of scope
      if (s.den.length !== new Set(s.den.map((d) => d.key)).size) return null;
      const k = qMul(s.k, q(numericLcm));
      const factors = [...s.num, ...missing.map((m) => m.node)];
      const body = factors.map((f) => printNode(f)).filter((x) => x !== null) as string[];
      if (body.length !== factors.length) return null;
      const factorTexts = factors.map((f, i) => (isSum(f) && factors.length + (k.n === 1 && k.d === 1 ? 0 : 1) > 1 ? `(${body[i]})` : body[i]));
      const mag = { n: Math.abs(k.n), d: k.d };
      const coef = mag.n === 1 && mag.d === 1 && factorTexts.length > 0 ? "" : qTex(mag);
      let tex = coef + joinFactors(factorTexts, coef);
      if (!tex) tex = "1";
      texts.push(k.n < 0 ? `-${tex}` : tex);
      const src = [k.d === 1 ? `${k.n}` : `(${k.n}/${k.d})`, ...factors.map((f) => `(${f.toString()})`)].join(" * ");
      parts.push(src);
    }
    let line = "";
    for (const t of texts) line = !line ? t : t.startsWith("-") ? `${line} - ${t.slice(1)}` : `${line} + ${t}`;
    printed.push([line]);
    try {
      nodes.push(math.parse(parts.join(" + ") || "0"));
    } catch {
      return null;
    }
  }
  return { latex: `${printed[0][0]} = ${printed[1][0]}`, sides: [nodes[0], nodes[1]], cleared: true };
}

function joinFactors(texts: readonly string[], coef: string): string {
  let out = "";
  for (const t of texts) {
    if (!out) out = coef && /^\d/.test(t) ? `\\cdot ${t}` : t;
    else out += /\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(t) ? ` ${t}` : /^\d/.test(t) ? ` \\cdot ${t}` : t;
  }
  return out;
}

function isSum(node: MathNode): boolean {
  const n = stripParens(node);
  const f = fnOf(n);
  return n.type === "OperatorNode" && (f === "add" || f === "subtract");
}

function lcmInt(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) [x, y] = [y, x % y];
  return (a / x) * b;
}

// ---------------------------------------------------------------- the linear method

function hasBracketOrProduct(latex: string): boolean {
  return /\(/.test(latex);
}

const powerOf = (t: Term, v: string): number => t.vars[v] ?? 0;

function without(t: Term, v: string): Term {
  const vars = { ...t.vars };
  delete vars[v];
  return { c: t.c, vars };
}

function allSymbols(node: MathNode): string[] {
  const out = lettersOf(node);
  if (mentions(node, "pi")) out.push("pi");
  return out;
}

/**
 * `B / A` as the answer's right-hand side: `\frac{2A}{b}`, `\frac{P - 2l}{2}`, `3y` (a number
 * dividing every coefficient), `-B` for A = -1.
 */
function quotientTex(B: Term[], A: Term[]): { tex: string; source: string } | null {
  return exactly(() => {
    let num = combineTerms(B);
    let den = combineTerms(A);
    if (den.length === 0) return null;
    if (num.length === 0) return { tex: "0", source: "0" };
    // a leading minus below goes above: `\frac{-B}{-A}` → `\frac{B}{A}`
    if (den[0].c.n < 0) {
      num = negate(num);
      den = negate(den);
    }
    if (den.length === 1 && isNumberTerm(den[0])) {
      const k = den[0].c;
      const divided = num.map((t) => ({ c: qDiv(t.c, k), vars: t.vars }));
      // every coefficient divides (or one term): `x = 3y`, `x = \frac{y}{3}` written as a fraction
      if (divided.every((t) => t.c.d === 1)) return { tex: termsTex(divided), source: termsSource(divided) };
      if (num.length === 1 && k.d === 1) return { tex: `${num[0].c.n < 0 ? "-" : ""}\\frac{${termBody({ c: { n: Math.abs(num[0].c.n), d: num[0].c.d }, vars: num[0].vars })}}{${k.n}}`, source: `(${termsSource(num)}) / (${termsSource(den)})` };
    }
    // a whole-number content in common above and below comes out (`\frac{2x + 4}{2y}` → `\frac{x + 2}{y}`)
    const g = contentGcd([...num, ...den]);
    if (g > 1) {
      num = num.map((t) => ({ c: qDiv(t.c, q(g)), vars: t.vars }));
      den = den.map((t) => ({ c: qDiv(t.c, q(g)), vars: t.vars }));
    }
    if (den.length === 1 && isNumberTerm(den[0]) && den[0].c.n === 1 && den[0].c.d === 1) return { tex: termsTex(num), source: termsSource(num) };
    const lead = num.length === 1 && num[0].c.n < 0 ? "-" : "";
    const top = lead ? termsTex(negate(num)) : termsTex(num);
    return { tex: `${lead}\\frac{${top}}{${termsTex(den)}}`, source: `(${termsSource(num)}) / (${termsSource(den)})` };
  });
}

function contentGcd(ts: readonly Term[]): number {
  let g = 0;
  for (const t of ts) {
    if (t.c.d !== 1) return 1;
    let x = Math.abs(t.c.n);
    let y = g;
    while (y) [x, y] = [y, x % y];
    g = x;
  }
  return g;
}

export function termsSource(ts: readonly Term[]): string {
  if (ts.length === 0) return "0";
  return ts
    .map((t) => {
      const parts = [`(${t.c.n}/${t.c.d})`, ...Object.entries(t.vars).map(([v, p]) => (p === 1 ? v : `${v}^${p}`))];
      return parts.join(" * ");
    })
    .join(" + ");
}

/**
 * The linear method on the cleared line `cl = cr` for `target`; `lastLine` is the line above
 * (a bracket there means the expanded line is worth writing).
 */
function linearMethod(cl: MathNode, cr: MathNode, target: string, lastLine: string, w: StepWriter): { value: string; source: string } | null {
  const symbols = [...new Set([...allSymbols(cl), ...allSymbols(cr)])];
  const TL = termsOf(cl, symbols);
  const TR = termsOf(cr, symbols);
  if (!TL || !TR) return null;
  const all = [...TL, ...TR];
  if (all.some((t) => powerOf(t, target) > 1)) return null;
  if (!all.some((t) => powerOf(t, target) === 1)) return null;
  if (hasBracketOrProduct(lastLine)) w.write(`${termsTex(combineTermsKeep(TL))} = ${termsTex(combineTermsKeep(TR))}`);
  const tL = combineTerms(TL.filter((t) => powerOf(t, target) === 1));
  const tR = combineTerms(TR.filter((t) => powerOf(t, target) === 1));
  const oL = combineTerms(TL.filter((t) => powerOf(t, target) === 0));
  const oR = combineTerms(TR.filter((t) => powerOf(t, target) === 0));
  let tTerms: Term[];
  let others: Term[];
  let targetOnRight = false;
  if (tL.length > 0 && tR.length === 0) {
    tTerms = tL;
    others = standardOrder(combineTerms([...oR, ...negate(oL)]));
    w.write(`${termsTex(tTerms)} = ${termsTex(others)}`);
  } else if (tL.length === 0 && tR.length > 0) {
    tTerms = tR;
    others = standardOrder(combineTerms([...oL, ...negate(oR)]));
    targetOnRight = true;
    w.write(`${termsTex(others)} = ${termsTex(tTerms)}`);
  } else {
    tTerms = combineTerms([...tL, ...negate(tR)]);
    others = standardOrder(combineTerms([...oR, ...negate(oL)]));
    w.write(`${termsTex([...tL, ...negate(tR)])} = ${termsTex(others)}`);
  }
  // the factor in the order a student writes it: `u + v`, `x - 1` (higher degree first, then a–z)
  const A = sortFactor(combineTerms(tTerms.map((t) => without(t, target))));
  if (A.length === 0) return null;
  if (A.length > 1) {
    const factored = `${symbolTex(target)}${factorTex(A)}`;
    w.write(targetOnRight ? `${termsTex(others)} = ${factored}` : `${factored} = ${termsTex(others)}`);
  }
  const quotient = quotientTex(others, A);
  if (!quotient) return null;
  return { value: quotient.tex, source: quotient.source };
}

function sortFactor(ts: Term[]): Term[] {
  const degree = (t: Term) => Object.values(t.vars).reduce((a, b) => a + b, 0);
  const key = (t: Term) => Object.keys(t.vars).sort().join("");
  return [...ts].sort((a, b) => degree(b) - degree(a) || (a.c.n < 0 ? 1 : 0) - (b.c.n < 0 ? 1 : 0) || key(a).localeCompare(key(b)));
}

/** Like terms merged, first-appearance order kept (`3 + x` stays `3 + x`). */
function combineTermsKeep(ts: readonly Term[]): Term[] {
  return combineTerms(ts);
}

// ---------------------------------------------------------------- the peel method

interface Peeled {
  /** what the letter sits in, once the rest is moved away */
  inner: MathNode;
  /** the other side, as a tree */
  rest: MathNode;
}

/**
 * The letter once, under a power / root / exponential / log: `k·F(inner) + others = side`.
 * Writes the lines that undo it and hands back `inner = …`. Null when the shape is anything else.
 */
function peel(deps: CourseDeps, L: MathNode, R: MathNode, target: string, w: StepWriter): Peeled | null {
  const math = deps.math;
  const [withT, other] = mentions(L, target) ? [L, R] : [R, L];
  if (mentions(other, target)) return null;
  const parts = summands(withT);
  const holders = parts.filter((p) => mentions(p.node, target));
  if (holders.length !== 1) return null;
  const rest = parts.filter((p) => !mentions(p.node, target));
  // the other summands moved across: `rest = other - others`
  let restNode: MathNode = other;
  for (const r of rest) restNode = new math.OperatorNode(r.sign > 0 ? "-" : "+", r.sign > 0 ? "subtract" : "add", [restNode, r.node]);
  const holder = holders[0];
  if (holder.sign < 0) restNode = new math.OperatorNode("-", "unaryMinus", [new math.ParenthesisNode(restNode)]);
  // the constant and letter factors in front (everything in the product without the target)
  const fp = fracParts(holder.node);
  const core = fp.num.filter((f) => mentions(f, target));
  if (core.length !== 1 || fp.den.some((f) => mentions(f, target))) return null;
  const coefNum = fp.num.filter((f) => !mentions(f, target));
  const coreNode = stripParens(core[0]);
  const coefTex = (() => {
    if (coefNum.length === 0 && fp.den.length === 0) return null;
    const num = coefNum.length ? coefNum.reduce((a, b) => new math.OperatorNode("*", "multiply", [a, b])) : new math.ConstantNode(1);
    return fp.den.length ? new math.OperatorNode("/", "divide", [num, fp.den.reduce((a, b) => new math.OperatorNode("*", "multiply", [a, b]))]) : num;
  })();
  const coreTex = printNode(coreNode);
  const restTex = printNode(restNode);
  if (!coreTex || !restTex) return null;
  if (rest.length > 0 || holder.sign < 0) {
    const holderTex = printNode(holder.node);
    if (!holderTex) return null;
    w.write(`${holderTex} = ${restTex}`);
  }
  // divide by the coefficient: `r^{2} = \frac{A}{\pi}`
  let rhs: MathNode = restNode;
  if (coefTex) {
    rhs = new math.OperatorNode("/", "divide", [restNode, coefTex]);
    const t = printNode(rhs);
    if (!t) return null;
    w.write(`${coreTex} = ${t}`);
  }
  const f = fnOf(coreNode);
  const a = argsOf(coreNode);
  let inner: MathNode;
  let undone: MathNode;
  if (coreNode.type === "OperatorNode" && f === "pow" && a.length === 2 && !mentions(a[1], target)) {
    const e = constantValue(a[1]);
    if (!e || e.d !== 1 || e.n < 2 || e.n > 5) {
      // `b^{x}` with the letter in the exponent is below; any other power is out of scope
      return null;
    }
    inner = a[0];
    undone = e.n === 2 ? new math.FunctionNode("sqrt", [rhs]) : new math.FunctionNode("nthRoot", [rhs, new math.ConstantNode(e.n)]);
  } else if (coreNode.type === "OperatorNode" && f === "pow" && a.length === 2 && !mentions(a[0], target)) {
    inner = a[1];
    const base = stripParens(a[0]);
    undone = base.type === "SymbolNode" && (base as MathNode & { name: string }).name === "e" ? new math.FunctionNode("log", [rhs]) : new math.FunctionNode("log", [rhs, base]);
  } else if (coreNode.type === "FunctionNode" && f === "sqrt") {
    inner = a[0];
    undone = new math.OperatorNode("^", "pow", [new math.ParenthesisNode(rhs), new math.ConstantNode(2)]);
  } else if (coreNode.type === "FunctionNode" && f === "nthRoot" && a.length === 2) {
    inner = a[0];
    undone = new math.OperatorNode("^", "pow", [new math.ParenthesisNode(rhs), a[1]]);
  } else if (coreNode.type === "FunctionNode" && f === "log" && a.length === 1) {
    inner = a[0];
    undone = new math.OperatorNode("^", "pow", [new math.SymbolNode("e"), rhs]);
  } else if (coreNode.type === "FunctionNode" && (f === "log10" || (f === "log" && a.length === 2))) {
    inner = a[0];
    undone = new math.OperatorNode("^", "pow", [f === "log10" ? new math.ConstantNode(10) : a[1], rhs]);
  } else return null;
  const innerTex = printNode(inner);
  const undoneTex = printNode(undone);
  if (!innerTex || !undoneTex) return null;
  w.write(`${innerTex} = ${undoneTex}`);
  return { inner, rest: undone };
}

/**
 * `a·t + b = K` where K is no polynomial (a log, a root): `t = \frac{K - b}{a}` with K kept whole.
 */
function opaqueLinear(inner: MathNode, rest: MathNode, target: string, w: StepWriter): { value: string; source: string } | null {
  const symbols = allSymbols(inner);
  const T = termsOf(inner, symbols);
  if (!T || T.some((t) => powerOf(t, target) > 1)) return null;
  const A = sortFactor(combineTerms(T.filter((t) => powerOf(t, target) === 1).map((t) => without(t, target))));
  const B = combineTerms(T.filter((t) => powerOf(t, target) === 0));
  if (A.length === 0) return null;
  const K = printNode(rest);
  if (!K) return null;
  let top = K;
  let topSource = `(${rest.toString()})`;
  if (B.length > 0) {
    const moved = negate(B);
    const tail = termsTex(moved);
    top = tail.startsWith("-") ? `${K} - ${tail.slice(1)}` : `${K} + ${tail}`;
    topSource = `(${rest.toString()}) - (${termsSource(B)})`;
    const aTex = A.length > 1 ? `${symbolTex(target)}${factorTex(A)}` : termsTex(A.map((t) => ({ c: t.c, vars: { ...t.vars, [target]: 1 } })));
    w.write(`${aTex} = ${top}`);
  }
  const onlyOne = A.length === 1 && Object.keys(A[0].vars).length === 0 && A[0].c.n === 1 && A[0].c.d === 1;
  if (onlyOne) return { value: top, source: topSource };
  return { value: `\\frac{${top}}{${termsTex(A)}}`, source: `(${topSource}) / (${termsSource(A)})` };
}

// ---------------------------------------------------------------- entry

/**
 * `latex` solved for `target`. `name` is how the answer line names it (default the letter).
 * Null when neither method applies or the answer fails its check in the original line.
 */
export function solveForLetter(deps: CourseDeps, latex: string, target: string, opts: { name?: string; positive?: boolean } = {}): LiteralSolution | null {
  try {
    const sides = splitEquation(latex);
    if (!sides) return null;
    const L = parseExpr(deps, sides[0]);
    const R = parseExpr(deps, sides[1]);
    if (!L || !R) return null;
    if (!mentions(L, target) && !mentions(R, target)) return null;
    const name = opts.name ?? symbolTex(target);
    const input = `${sides[0]} = ${sides[1]}`;
    const cleared = clearDenominators(deps, L, R);
    if (!cleared) return null;
    const [cl, cr] = cleared.sides;
    const lastLine = cleared.cleared ? cleared.latex : input;
    let w = new StepWriter(deps.normalize, input);
    if (cleared.cleared) w.write(cleared.latex);
    let result = linearMethod(cl, cr, target, lastLine, w);
    if (!result) {
      // the letter under a power, a root, an exponential or a log: undo it, then the linear method
      w = new StepWriter(deps.normalize, input);
      if (cleared.cleared) w.write(cleared.latex);
      const peeled = peel(deps, cleared.cleared ? cl : L, cleared.cleared ? cr : R, target, w);
      if (!peeled) return null;
      const innerTex = printNode(peeled.inner);
      const restTex = printNode(peeled.rest);
      if (!innerTex || !restTex) return null;
      if (stripParens(peeled.inner).type === "SymbolNode") result = { value: restTex, source: peeled.rest.toString() };
      else {
        const inner = clearDenominators(deps, peeled.inner, peeled.rest);
        if (inner?.cleared) w.write(inner.latex);
        result = inner ? linearMethod(inner.sides[0], inner.sides[1], target, inner.cleared ? inner.latex : `${innerTex} = ${restTex}`, w) : null;
        // `rt = \ln\frac{A}{P}`: the other side is no polynomial, so it is divided as it stands
        result ??= opaqueLinear(peeled.inner, peeled.rest, target, w);
        if (!result) return null;
      }
    }
    const final = `${name} = ${result.value}`;
    w.write(final);
    const steps = w.lines(8);
    if (steps[steps.length - 1] !== final) return null;
    if (!checks(deps, sides, target, result.source, steps, opts.positive ?? true)) return null;
    return { steps, final, value: result.value };
  } catch {
    return null;
  }
}

/**
 * The answer, put back into the ORIGINAL line, makes it true at every sample point where both
 * sides are defined (at least three); every other line of the working holds there too.
 */
function checks(deps: CourseDeps, sides: [string, string], target: string, source: string, steps: readonly string[], positive: boolean): boolean {
  let value: MathNode;
  try {
    value = deps.math.parse(source);
  } catch {
    return false;
  }
  const L = parseExpr(deps, sides[0]);
  const R = parseExpr(deps, sides[1]);
  if (!L || !R) return false;
  const others = [...new Set([...lettersOf(L), ...lettersOf(R)])].filter((v) => v !== target);
  let ok = 0;
  for (const scope of sampleScopes(others, positive)) {
    let t: unknown;
    try {
      t = value.compile().evaluate({ ...scope });
    } catch {
      continue;
    }
    if (typeof t !== "number" || !Number.isFinite(t)) continue;
    const at = { ...scope, [target]: t };
    const holds = equationHolds(deps, sides.join(" = "), at);
    if (holds === null) continue;
    if (!holds) return false;
    for (const s of steps) if (splitEquation(s) && equationHolds(deps, s, at) === false) return false;
    ok++;
  }
  return ok >= 3;
}
