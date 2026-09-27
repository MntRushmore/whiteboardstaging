/**
 * Calculus the way a teacher writes it on the board: derivatives, integrals and limits, each
 * as the lines a student would write under the question — maths, never words — and exact.
 *
 *   \frac{d}{dx}(3x^2 + 2x)    \int (4x^3 - 2x) \, dx                        \int_0^2 3x^2 \, dx    \lim_{x \to 2} \frac{x^2 - 4}{x - 2}
 *   = 3 \cdot 2x + 2           = 4 \cdot \frac{x^4}{4} - 2 \cdot \frac{x^2}{2} + C   = [x^3]_0^2          = \lim_{x \to 2} \frac{(x - 2)(x + 2)}{x - 2}
 *   = 6x + 2                   = x^4 - x^2 + C                               = 8 - 0              = \lim_{x \to 2} (x + 2)
 *                                                                            = 8                  = 4
 *
 * How it is organised:
 *
 *  - `Expr`: the student's expression as a small tree (from the mathjs source `latex.ts` made),
 *    printed back as LaTeX in the notation a teacher uses (`3x^{2}`, `\sin(3x)`, `\ln|x|`).
 *  - `Canon`: a simplified sum of terms (exact rational coefficient × factors), used for every
 *    "simplify" line. Brackets raised to a power stay as they are (`10(2x + 1)^{4}`).
 *  - The rule lines (`3 \cdot 2x + 2`, `\cos(3x) \cdot 3`, `\frac{x^{3}}{3}`) are written while
 *    the rule is applied, so they show the rule, not only its result.
 *  - `Ex`: exact values (rationals, `\sqrt{2}`, `\pi`, `e^{2}`, `\ln 2`) for definite integrals
 *    and limits. Anything that does not stay exact is refused, never approximated.
 *
 * Every result is checked numerically before it is returned (a derivative against a central
 * difference, an antiderivative by differentiating it back, a definite integral against
 * Simpson, a limit against the function near the point): a bug here becomes `null`, never a
 * wrong line on a student's page. Pure TypeScript; mathjs only through the instance passed in.
 */
import type { MathJsInstance, MathNode } from "mathjs";
import { usesSymbol } from "./classify";
import { asSmallFraction } from "./format";
import { DIFFERENTIAL_D, GREEK, preprocessLatex, splitRelations, type Translated } from "./latex";
import { continueLine, isRelationLine } from "./solution";

class NotCalculus extends Error {}
/** An exact evaluation met a zero denominator: a limit may still exist (0/0); a value does not. */
class ZeroDivision extends Error {}

function fail(): never {
  throw new NotCalculus();
}

// ---------------------------------------------------------------------------------------------
// Exact rationals
// ---------------------------------------------------------------------------------------------

interface Q {
  n: number;
  d: number;
}

const BIG = 1e12;

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function q(n: number, d = 1): Q {
  if (!Number.isInteger(n) || !Number.isInteger(d)) fail();
  if (d === 0) throw new ZeroDivision();
  if (Math.abs(n) > BIG || Math.abs(d) > BIG) fail();
  const g = gcd(n, d);
  const s = d < 0 ? -1 : 1;
  const out = { n: (s * n) / g, d: (s * d) / g };
  if (Object.is(out.n, -0)) out.n = 0;
  return out;
}

const Q0 = q(0);
const Q1 = q(1);
const QM1 = q(-1);
const QHALF = q(1, 2);
const qAdd = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qNeg = (a: Q): Q => q(-a.n, a.d);
const qSub = (a: Q, b: Q): Q => qAdd(a, qNeg(b));
const qMul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
const qDiv = (a: Q, b: Q): Q => {
  if (b.n === 0) throw new ZeroDivision();
  return q(a.n * b.d, a.d * b.n);
};
const qAbs = (a: Q): Q => q(Math.abs(a.n), a.d);
const qEq = (a: Q, b: Q): boolean => a.n === b.n && a.d === b.d;
const qZero = (a: Q): boolean => a.n === 0;
const qOne = (a: Q): boolean => a.n === 1 && a.d === 1;
const qInt = (a: Q): boolean => a.d === 1;
const qVal = (a: Q): number => a.n / a.d;

function qPowInt(a: Q, k: number): Q {
  if (!Number.isInteger(k) || Math.abs(k) > 64) fail();
  if (k < 0) return qDiv(Q1, qPowInt(a, -k));
  let out = Q1;
  for (let i = 0; i < k; i++) out = qMul(out, a);
  return out;
}

/** The exact integer k-th root of n (n >= 0), or null. */
function intRoot(n: number, k: number): number | null {
  if (n < 0) return null;
  const r = Math.round(n ** (1 / k));
  for (const c of [r - 1, r, r + 1]) if (c >= 0 && c ** k === n) return c;
  return null;
}

/** a^(1/k) when it is rational, else null. */
function qRoot(a: Q, k: number): Q | null {
  if (a.n < 0) return null;
  const n = intRoot(a.n, k);
  const d = intRoot(a.d, k);
  return n === null || d === null ? null : q(n, d);
}

/** c^k for a rational exponent, when the answer is rational; null otherwise. */
function qPowRational(c: Q, k: Q): Q | null {
  if (qInt(k)) return qPowInt(c, k.n);
  if (qOne(c)) return Q1;
  if (c.n < 0) return null;
  const root = qRoot(c, k.d);
  return root ? qPowInt(root, k.n) : null;
}

function qLatex(a: Q): string {
  if (a.d === 1) return String(a.n);
  return `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`;
}

// ---------------------------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------------------------

type Fn = "sin" | "cos" | "tan" | "sec" | "csc" | "cot" | "ln" | "log10" | "exp" | "abs" | "asin" | "acos" | "atan";
const TRIG: ReadonlySet<string> = new Set(["sin", "cos", "tan", "sec", "csc", "cot"]);

type Expr =
  | { t: "num"; q: Q }
  | { t: "sym"; name: string }
  | { t: "add"; args: Expr[] }
  | { t: "mul"; args: Expr[] }
  | { t: "div"; num: Expr; den: Expr }
  | { t: "pow"; base: Expr; exp: Expr }
  | { t: "neg"; arg: Expr }
  | { t: "fn"; name: Fn; arg: Expr }
  | { t: "sqrt"; arg: Expr }
  /** a value written into an expression (the substitution line of a limit or of f'(2)) */
  | { t: "lit"; tex: string; neg: boolean; atom: boolean };

const N = (a: Q): Expr => ({ t: "num", q: a });
const I = (n: number): Expr => N(q(n));
const S = (name: string): Expr => ({ t: "sym", name });

function add(args: Expr[]): Expr {
  const flat = args.flatMap((a) => (a.t === "add" ? a.args : [a]));
  if (flat.length === 0) return I(0);
  return flat.length === 1 ? flat[0] : { t: "add", args: flat };
}

function mul(args: Expr[]): Expr {
  const flat = args.flatMap((a) => (a.t === "mul" ? a.args : [a])).filter((a) => !(a.t === "num" && qOne(a.q)));
  if (flat.length === 0) return I(1);
  return flat.length === 1 ? flat[0] : { t: "mul", args: flat };
}

const div = (num: Expr, den: Expr): Expr => ({ t: "div", num, den });
const pow = (base: Expr, exp: Expr): Expr => ({ t: "pow", base, exp });
const fn = (name: Fn, arg: Expr): Expr => ({ t: "fn", name, arg });

function neg(arg: Expr): Expr {
  if (arg.t === "num") return N(qNeg(arg.q));
  if (arg.t === "neg") return arg.arg;
  return { t: "neg", arg };
}

function hasVar(e: Expr, x: string): boolean {
  switch (e.t) {
    case "num":
    case "lit":
      return false;
    case "sym":
      return e.name === x;
    case "add":
    case "mul":
      return e.args.some((a) => hasVar(a, x));
    case "div":
      return hasVar(e.num, x) || hasVar(e.den, x);
    case "pow":
      return hasVar(e.base, x) || hasVar(e.exp, x);
    case "neg":
    case "fn":
    case "sqrt":
      return hasVar(e.arg, x);
  }
}

const isVar = (e: Expr, x: string): boolean => e.t === "sym" && e.name === x;

/** Symbols other than the constants π and e. */
function symbolsOf(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.t) {
    case "sym":
      if (e.name !== "pi" && e.name !== "e") out.add(e.name);
      break;
    case "add":
    case "mul":
      e.args.forEach((a) => symbolsOf(a, out));
      break;
    case "div":
      symbolsOf(e.num, out);
      symbolsOf(e.den, out);
      break;
    case "pow":
      symbolsOf(e.base, out);
      symbolsOf(e.exp, out);
      break;
    case "neg":
    case "fn":
    case "sqrt":
      symbolsOf(e.arg, out);
      break;
    default:
      break;
  }
  return out;
}

function substitute(e: Expr, x: string, value: Expr): Expr {
  switch (e.t) {
    case "sym":
      return e.name === x ? value : e;
    case "add":
      return { t: "add", args: e.args.map((a) => substitute(a, x, value)) };
    case "mul":
      return { t: "mul", args: e.args.map((a) => substitute(a, x, value)) };
    case "div":
      return div(substitute(e.num, x, value), substitute(e.den, x, value));
    case "pow":
      return pow(substitute(e.base, x, value), substitute(e.exp, x, value));
    case "neg":
      return { t: "neg", arg: substitute(e.arg, x, value) };
    case "fn":
      return fn(e.name, substitute(e.arg, x, value));
    case "sqrt":
      return { t: "sqrt", arg: substitute(e.arg, x, value) };
    default:
      return e;
  }
}

type AnyNode = MathNode & {
  type: string;
  value?: unknown;
  name?: string;
  fn?: string | { name?: string };
  args?: MathNode[];
  content?: MathNode;
};

const FUNCTION_NAMES: Record<string, Fn> = {
  sin: "sin",
  cos: "cos",
  tan: "tan",
  sec: "sec",
  csc: "csc",
  cot: "cot",
  log: "ln",
  log10: "log10",
  exp: "exp",
  abs: "abs",
  asin: "asin",
  acos: "acos",
  atan: "atan",
};

/** `\sin^{-1}`: the inverse functions as a student writes them (the hand draws the index). */
const INVERSE_TEX: Partial<Record<Fn, string>> = { asin: "\\sin^{-1}", acos: "\\cos^{-1}", atan: "\\tan^{-1}" };

/** mathjs tree → Expr. Integers only: a decimal, a unit or an unknown function is refused. */
function fromNode(node: MathNode): Expr {
  const n = node as AnyNode;
  switch (n.type) {
    case "ConstantNode":
      if (typeof n.value !== "number" || !Number.isInteger(n.value)) fail();
      return I(n.value as number);
    case "SymbolNode": {
      const name = n.name ?? "";
      if (name === "pi" || name === "e" || (/^[a-zA-Z]$/.test(name) && name !== "i") || GREEK.has(name)) return S(name);
      return fail();
    }
    case "ParenthesisNode":
      return n.content ? fromNode(n.content) : fail();
    case "OperatorNode": {
      const f = typeof n.fn === "string" ? n.fn : n.fn?.name;
      const a = n.args ?? [];
      switch (f) {
        case "add":
          return add([fromNode(a[0]), fromNode(a[1])]);
        case "subtract":
          return add([fromNode(a[0]), neg(fromNode(a[1]))]);
        case "multiply":
          return mul([fromNode(a[0]), fromNode(a[1])]);
        case "divide":
          return div(fromNode(a[0]), fromNode(a[1]));
        case "unaryMinus":
          return neg(fromNode(a[0]));
        case "unaryPlus":
          return fromNode(a[0]);
        case "pow": {
          const base = fromNode(a[0]);
          const exp = fromNode(a[1]);
          return base.t === "sym" && base.name === "e" ? fn("exp", exp) : pow(base, exp);
        }
        default:
          return fail();
      }
    }
    case "FunctionNode": {
      const name = typeof n.fn === "string" ? n.fn : (n.fn?.name ?? "");
      const a = n.args ?? [];
      if (a.length === 1) {
        if (name === "sqrt") return { t: "sqrt", arg: fromNode(a[0]) };
        const f = FUNCTION_NAMES[name];
        if (f) return fn(f, fromNode(a[0]));
      }
      if (name === "nthRoot" && a.length === 2) {
        const k = rationalValue(fromNode(a[1]));
        if (!k || !qInt(k) || k.n < 2) fail();
        return pow(fromNode(a[0]), N(q(1, k.n)));
      }
      return fail();
    }
    default:
      return fail();
  }
}

// ---------------------------------------------------------------------------------------------
// LaTeX, the way a teacher writes it
// ---------------------------------------------------------------------------------------------

function symTex(name: string): string {
  if (name === "pi") return "\\pi";
  if (GREEK.has(name)) return `\\${name}`;
  return name;
}

/** `+`/`-` outside every bracket after the first character: the string is a sum. */
function hasTopLevelSum(s: string): boolean {
  let depth = 0;
  let bars = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      const m = /^\\[a-zA-Z]+/.exec(s.slice(i));
      i += m ? m[0].length - 1 : 1;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "|") bars = 1 - bars;
    else if ((ch === "+" || ch === "-") && depth === 0 && bars === 0 && s.slice(0, i).trim() !== "") return true;
  }
  return false;
}

/** A function applied without brackets at the end: `\sin x`, `\ln 2`, `\cos\pi`, `\sec^{2} x`. */
const BARE_FN_END = /\\(?:sin|cos|tan|sec|csc|cot|ln|log)(?:\^\{[^{}]*\})?(?:\s[a-zA-Z0-9]+|\\[a-zA-Z]+)$/;

/** Juxtaposition where a student would, `\cdot` where juxtaposition would misread (`3 \cdot 2x`). */
function joinProduct(parts: readonly string[]): string {
  let out = "";
  for (const p of parts) {
    if (!p) continue;
    if (!out) {
      out = p;
      continue;
    }
    const bare = BARE_FN_END.test(out);
    if (/^[0-9.]/.test(p) || /^-/.test(p) || (/^\\frac/.test(p) && /[0-9}]$/.test(out)) || (bare && /^[a-zA-Z0-9(|]/.test(p))) out += ` \\cdot ${p}`;
    else if (bare || (/\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(p))) out += ` ${p}`;
    else out += p;
  }
  return out;
}

function isNegTerm(e: Expr): boolean {
  if (e.t === "num") return e.q.n < 0;
  if (e.t === "neg") return true;
  if (e.t === "mul") return isNegTerm(e.args[0]);
  if (e.t === "div") return isNegTerm(e.num);
  return false;
}

function negTerm(e: Expr): Expr {
  if (e.t === "num") return N(qNeg(e.q));
  if (e.t === "neg") return e.arg;
  if (e.t === "mul") return mul([negTerm(e.args[0]), ...e.args.slice(1)]);
  if (e.t === "div") return div(negTerm(e.num), e.den);
  return neg(e);
}

const wrapMinus = (s: string): string => (s.startsWith("-") ? `(${s})` : s);

function fnArg(arg: Expr): string {
  if (arg.t === "sym") return arg.name.length === 1 ? ` ${arg.name}` : symTex(arg.name);
  if (arg.t === "num" && arg.q.n >= 0 && qInt(arg.q)) return ` ${arg.q.n}`;
  if (arg.t === "lit" && arg.atom && !arg.neg) return arg.tex.startsWith("\\") ? arg.tex : ` ${arg.tex}`;
  return `(${tex(arg)})`;
}

function texFn(name: Fn, arg: Expr): string {
  switch (name) {
    case "exp":
      return `e^{${tex(arg)}}`;
    case "abs":
      return `|${tex(arg)}|`;
    case "ln":
      return arg.t === "fn" && arg.name === "abs" ? `\\ln|${tex(arg.arg)}|` : `\\ln${fnArg(arg)}`;
    case "log10":
      return `\\log${fnArg(arg)}`;
    case "asin":
    case "acos":
    case "atan": {
      // `\tan^{-1}\frac{x}{2}`, not `\tan^{-1}(\frac{1}{2}x)`
      if (arg.t === "mul" && arg.args.length === 2 && arg.args[1].t === "sym") {
        const k = rationalValue(arg.args[0]);
        if (k && k.n > 0 && !qInt(k)) return `${INVERSE_TEX[name]}\\frac{${joinProduct([k.n === 1 ? "" : String(k.n), tex(arg.args[1])])}}{${k.d}}`;
      }
      return `${INVERSE_TEX[name]}${fnArg(arg)}`;
    }
    default:
      return `\\${name}${fnArg(arg)}`;
  }
}

function texPow(base: Expr, exp: Expr): string {
  const k = rationalValue(exp);
  const expTex = tex(exp);
  if (base.t === "fn" && TRIG.has(base.name) && k && qInt(k) && k.n > 0) return `\\${base.name}^{${expTex}}${fnArg(base.arg)}`;
  let b: string;
  if (base.t === "sym") b = symTex(base.name);
  else if (base.t === "num" && base.q.n >= 0 && qInt(base.q)) b = qLatex(base.q);
  else if (base.t === "lit" && base.atom && !base.neg) b = base.tex;
  else b = `(${tex(base)})`;
  return `${b}^{${expTex}}`;
}

function texFactor(a: Expr, alone: boolean): string {
  if (a.t === "add") return alone ? tex(a) : `(${tex(a)})`;
  if (a.t === "neg" || (a.t === "num" && a.q.n < 0) || (a.t === "lit" && a.neg)) return `(${tex(a)})`;
  return tex(a);
}

function texMul(args: Expr[]): string {
  let sign = "";
  let rest = args;
  const first = args[0];
  if (first.t === "num" && first.q.n < 0) {
    sign = "-";
    const mag = qNeg(first.q);
    rest = qOne(mag) ? args.slice(1) : [N(mag), ...args.slice(1)];
  } else if (first.t === "neg") {
    sign = "-";
    rest = [first.arg, ...args.slice(1)];
  }
  const body = joinProduct(rest.map((a) => texFactor(a, rest.length === 1)));
  return sign + (sign && body.startsWith("-") ? `(${body})` : body);
}

/** An Expr as LaTeX, structure as given (no simplification). */
function tex(e: Expr): string {
  switch (e.t) {
    case "num":
      return qLatex(e.q);
    case "sym":
      return symTex(e.name);
    case "lit":
      return e.tex;
    case "add": {
      let out = "";
      e.args.forEach((a, i) => {
        if (i === 0) out = tex(a);
        else if (isNegTerm(a)) out += ` - ${wrapMinus(texFactor(negTerm(a), false))}`;
        else out += ` + ${wrapMinus(texFactor(a, false))}`;
      });
      return out;
    }
    case "neg": {
      const inner = e.arg.t === "add" ? `(${tex(e.arg)})` : tex(e.arg);
      return inner.startsWith("-") ? `-(${inner})` : `-${inner}`;
    }
    case "mul":
      return texMul(e.args);
    case "div":
      if (isNegTerm(e.num)) return `-\\frac{${tex(negTerm(e.num))}}{${tex(e.den)}}`;
      return `\\frac{${tex(e.num)}}{${tex(e.den)}}`;
    case "pow":
      return texPow(e.base, e.exp);
    case "fn":
      return texFn(e.name, e.arg);
    case "sqrt":
      return `\\sqrt{${tex(e.arg)}}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Canonical form: a sum of terms, coefficient × factors
// ---------------------------------------------------------------------------------------------

interface Factor {
  base: Expr;
  e: Q;
  key: string;
}
interface Term {
  c: Q;
  f: Factor[];
}
type Canon = Term[];

const factorOf = (base: Expr, e: Q): Factor => ({ base, e, key: tex(base) });
const UNIT: Term = { c: Q1, f: [] };

function termKey(t: Term): string {
  return t.f
    .map((f) => `${f.key}^${f.e.n}/${f.e.d}`)
    .sort()
    .join("*");
}

/** Like terms merged (first appearance order), zero terms dropped. */
function combine(terms: readonly Term[]): Canon {
  const order: string[] = [];
  const byKey = new Map<string, Term>();
  for (const t of terms) {
    const k = termKey(t);
    const seen = byKey.get(k);
    if (seen) byKey.set(k, { c: qAdd(seen.c, t.c), f: seen.f });
    else {
      order.push(k);
      byKey.set(k, t);
    }
  }
  return order.map((k) => byKey.get(k)!).filter((t) => !qZero(t.c));
}

/** (e^{g})^k = e^{kg}: an exponential is never printed as a power of itself. */
function normalizeFactor(f: Factor): Factor {
  if (f.base.t === "fn" && f.base.name === "exp" && !qOne(f.e)) {
    return factorOf(fn("exp", canonToExpr(scaleCanon(canon(f.base.arg), f.e))), Q1);
  }
  return f;
}

function mulTerm(a: Term, b: Term): Term {
  const f = a.f.map((x) => ({ ...x }));
  for (const g of b.f) {
    const i = f.findIndex((x) => x.key === g.key);
    if (i >= 0) f[i] = { ...f[i], e: qAdd(f[i].e, g.e) };
    else f.push(g);
  }
  return { c: qMul(a.c, b.c), f: f.filter((x) => !qZero(x.e)).map(normalizeFactor) };
}

function mulCanon(A: Canon, B: Canon): Canon {
  const out: Term[] = [];
  for (const a of A) for (const b of B) out.push(mulTerm(a, b));
  return combine(out);
}

function scaleCanon(A: Canon, k: Q): Canon {
  return combine(A.map((t) => ({ c: qMul(t.c, k), f: t.f })));
}

function invCanon(A: Canon): Canon {
  if (A.length === 0) throw new ZeroDivision();
  if (A.length === 1) return [{ c: qDiv(Q1, A[0].c), f: A[0].f.map((f) => normalizeFactor({ ...f, e: qNeg(f.e) })) }];
  return [{ c: Q1, f: [factorOf(canonToExpr(A), QM1)] }];
}

/** The value of a canonical sum when it is a plain rational, else null. */
function canonRational(A: Canon): Q | null {
  if (A.length === 0) return Q0;
  return A.length === 1 && A[0].f.length === 0 ? A[0].c : null;
}

function powCanon(A: Canon, k: Q): Canon {
  if (qZero(k)) return [UNIT];
  if (A.length === 0) {
    if (k.n > 0) return [];
    throw new ZeroDivision();
  }
  if (qOne(k)) return A;
  if (A.length === 1) {
    const t = A[0];
    const c = qPowRational(t.c, k);
    if (c) return [{ c, f: t.f.map((f) => normalizeFactor({ ...f, e: qMul(f.e, k) })) }];
  }
  return [{ c: Q1, f: [factorOf(canonToExpr(A), k)] }];
}

function fnCanon(name: Fn, A: Canon): Canon {
  const c0 = canonRational(A);
  if (c0 && qZero(c0)) {
    if (name === "exp" || name === "cos" || name === "sec") return [UNIT];
    if (name === "sin" || name === "tan" || name === "abs" || name === "asin" || name === "atan") return [];
    throw new ZeroDivision();
  }
  if (c0 && qOne(c0) && (name === "ln" || name === "log10")) return [];
  if (c0 && name === "abs") return [{ c: qAbs(c0), f: [] }];
  if (name === "ln" && A.length === 1 && qOne(A[0].c) && A[0].f.length === 1) {
    const only = A[0].f[0];
    if (only.base.t === "sym" && only.base.name === "e") return [{ c: only.e, f: [] }]; // ln(e^k) = k
    if (only.base.t === "fn" && only.base.name === "exp" && qOne(only.e)) return canon(only.base.arg);
  }
  return [{ c: Q1, f: [factorOf(fn(name, canonToExpr(A)), Q1)] }];
}

function canon(e: Expr): Canon {
  switch (e.t) {
    case "num":
      return qZero(e.q) ? [] : [{ c: e.q, f: [] }];
    case "sym":
      return [{ c: Q1, f: [factorOf(e, Q1)] }];
    case "lit":
      return fail();
    case "add":
      return combine(e.args.flatMap(canon));
    case "neg":
      return scaleCanon(canon(e.arg), QM1);
    case "mul":
      return e.args.reduce<Canon>((acc, a) => mulCanon(acc, canon(a)), [UNIT]);
    case "div":
      return mulCanon(canon(e.num), invCanon(canon(e.den)));
    case "sqrt":
      return powCanon(canon(e.arg), QHALF);
    case "pow": {
      const ce = canon(e.exp);
      const k = canonRational(ce);
      if (k) return powCanon(canon(e.base), k);
      return [{ c: Q1, f: [factorOf(pow(canonToExpr(canon(e.base)), canonToExpr(ce)), Q1)] }];
    }
    case "fn":
      return fnCanon(e.name, canon(e.arg));
  }
}

/** Parameters and π first, then the variable, then functions, then brackets: `2\pi x`, `xe^{x}`, `2x(x + 1)^{3}`. */
function factorClass(f: Factor, x: string): number {
  if (f.base.t === "sym") return f.base.name === x ? 1 : 0;
  if (f.base.t === "add") return 3;
  return 2;
}

function orderFactors(fs: readonly Factor[], x: string): Factor[] {
  return fs
    .map((f, i) => ({ f, i }))
    .sort((a, b) => factorClass(a.f, x) - factorClass(b.f, x) || a.i - b.i)
    .map((p) => p.f);
}

/** The variable being worked with, for factor order when a canonical form is turned back into an Expr. */
let orderVar = "x";

function termToExpr(t: Term): Expr {
  const fs = orderFactors(t.f, orderVar).map((f) => (qOne(f.e) ? f.base : pow(f.base, N(f.e))));
  if (fs.length === 0) return N(t.c);
  if (qOne(t.c)) return mul(fs);
  if (qEq(t.c, QM1)) return neg(mul(fs));
  return mul([N(t.c), ...fs]);
}

function canonToExpr(A: Canon): Expr {
  return A.length ? add(A.map(termToExpr)) : I(0);
}

/**
 * How a simplified line is printed:
 *  - `display`: the final answer — positive indices only (`-\frac{2}{x^{3}}`), `\sqrt{x}` for a half.
 *  - `power`: index form for the variable (`-2x^{-3}`, `\frac{1}{2}x^{-\frac{1}{2}}`), the line
 *    straight after the power rule; brackets and functions still go under a fraction bar.
 *  - `integrand`: index form, except `\frac{1}{x}` (the `\ln|x|` case is written as a fraction).
 */
type Mode = "display" | "power" | "integrand";

interface SplitTerm {
  neg: boolean;
  p: number;
  qd: number;
  num: Factor[];
  den: Factor[];
  denKey: string;
}

function splitTerm(t: Term, mode: Mode, x: string): SplitTerm {
  const inDen = (f: Factor) =>
    f.e.n < 0 && (mode === "display" || f.base.t !== "sym" || (mode === "integrand" && qEq(f.e, QM1)));
  const ordered = orderFactors(t.f, x);
  const num = ordered.filter((f) => !inDen(f));
  const den = ordered.filter(inDen).map((f) => ({ ...f, e: qNeg(f.e) }));
  return {
    neg: t.c.n < 0,
    p: Math.abs(t.c.n),
    qd: t.c.d,
    num,
    den,
    denKey: den
      .map((f) => `${f.key}^${f.e.n}/${f.e.d}`)
      .sort()
      .join("*"),
  };
}

function factorTex(f: Factor, mode: Mode, grouped: boolean): string {
  const b = f.base;
  const e = f.e;
  const half = qEq(e, QHALF);
  if (b.t === "sym") {
    if (qOne(e)) return symTex(b.name);
    if (half && mode === "display") return `\\sqrt{${symTex(b.name)}}`;
    return `${symTex(b.name)}^{${qLatex(e)}}`;
  }
  if (b.t === "add") {
    if (half) return `\\sqrt{${tex(b)}}`;
    if (qOne(e)) return grouped ? `(${tex(b)})` : tex(b);
    return `(${tex(b)})^{${qLatex(e)}}`;
  }
  if (b.t === "fn") {
    if (qOne(e)) return tex(b);
    if (half) return `\\sqrt{${tex(b)}}`;
    if (TRIG.has(b.name) && qInt(e) && e.n > 0) return `\\${b.name}^{${e.n}}${fnArg(b.arg)}`;
    return `(${tex(b)})^{${qLatex(e)}}`;
  }
  if (qOne(e)) return tex(b);
  return `(${tex(b)})^{${qLatex(e)}}`;
}

/** A factor whose exponent is printed as an index that is not a plain positive integer. */
function indexNotation(f: Factor, mode: Mode): boolean {
  if (qInt(f.e) && f.e.n > 0) return false;
  if (qEq(f.e, QHALF) && (mode === "display" || f.base.t !== "sym")) return false;
  return true;
}

function termBody(s: SplitTerm, mode: Mode): string {
  const nf = s.num;
  const df = s.den;
  const numTex = joinProduct(nf.map((f) => factorTex(f, mode, nf.length > 1 || s.p !== 1)));
  const denTex = joinProduct(df.map((f) => factorTex(f, mode, df.length > 1 || s.qd !== 1)));
  const lead = s.p === 1 ? "" : String(s.p);
  if (df.length === 0) {
    if (s.qd === 1) return nf.length ? joinProduct([lead, numTex]) : String(s.p);
    if (nf.length === 0) return `\\frac{${s.p}}{${s.qd}}`;
    // `\frac{2}{3}x^{\frac{3}{2}}`, `\frac{1}{2}\ln|2x + 1|`: the coefficient stays in front of an index or a log
    if (nf.some((f) => indexNotation(f, mode) || (f.base.t === "fn" && ["ln", "log10", "asin", "acos", "atan"].includes(f.base.name)))) {
      return joinProduct([`\\frac{${s.p}}{${s.qd}}`, numTex]);
    }
    return `\\frac{${joinProduct([lead, numTex])}}{${s.qd}}`;
  }
  const top = nf.length ? joinProduct([lead, numTex]) : String(s.p);
  const bottom = joinProduct([s.qd === 1 ? "" : String(s.qd), denTex]);
  return `\\frac{${top}}{${bottom}}`;
}

function joinSigned(items: ReadonlyArray<{ neg: boolean; body: string }>): string {
  let out = "";
  items.forEach((it, i) => {
    if (i === 0) out = it.neg ? `-${it.body}` : it.body;
    else out += ` ${it.neg ? "-" : "+"} ${it.body}`;
  });
  return out || "0";
}

function printCanon(A: Canon, mode: Mode, x: string): string {
  if (A.length === 0) return "0";
  const parts = A.map((t) => splitTerm(t, mode, x));
  const first = parts[0];
  // Several terms over one bracket: one fraction, as a teacher writes it (`\frac{2x + 1}{x^{2} + x}`).
  if (parts.length >= 2 && first.den.length > 0 && parts.every((p) => p.denKey === first.denKey && p.qd === first.qd)) {
    const top = joinSigned(parts.map((p) => ({ neg: p.neg, body: termBody({ ...p, qd: 1, den: [] }, mode) })));
    const bottom = joinProduct([first.qd === 1 ? "" : String(first.qd), joinProduct(first.den.map((f) => factorTex(f, mode, first.den.length > 1 || first.qd !== 1)))]);
    return `\\frac{${top}}{${bottom}}`;
  }
  return joinSigned(parts.map((p) => ({ neg: p.neg, body: termBody(p, mode) })));
}

/** A rational constant written as an Expr (`3`, `-\frac{1}{2}`, `2 \cdot 3`), or null. */
function rationalValue(e: Expr): Q | null {
  try {
    if (e.t === "lit") return null;
    const A = canon(e);
    const c = canonRational(A);
    return c;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Numbers, for the checks
// ---------------------------------------------------------------------------------------------

function evalNum(e: Expr, scope: Readonly<Record<string, number>>): number {
  switch (e.t) {
    case "num":
      return qVal(e.q);
    case "sym":
      if (e.name in scope) return scope[e.name];
      if (e.name === "pi") return Math.PI;
      if (e.name === "e") return Math.E;
      return NaN;
    case "lit":
      return NaN;
    case "add":
      return e.args.reduce((s, a) => s + evalNum(a, scope), 0);
    case "mul":
      return e.args.reduce((s, a) => s * evalNum(a, scope), 1);
    case "div":
      return evalNum(e.num, scope) / evalNum(e.den, scope);
    case "pow":
      return Math.pow(evalNum(e.base, scope), evalNum(e.exp, scope));
    case "neg":
      return -evalNum(e.arg, scope);
    case "sqrt":
      return Math.sqrt(evalNum(e.arg, scope));
    case "fn": {
      const a = evalNum(e.arg, scope);
      switch (e.name) {
        case "sin":
          return Math.sin(a);
        case "cos":
          return Math.cos(a);
        case "tan":
          return Math.tan(a);
        case "sec":
          return 1 / Math.cos(a);
        case "csc":
          return 1 / Math.sin(a);
        case "cot":
          return 1 / Math.tan(a);
        case "ln":
          return Math.log(a);
        case "log10":
          return Math.log10(a);
        case "exp":
          return Math.exp(a);
        case "abs":
          return Math.abs(a);
        case "asin":
          return Math.asin(a);
        case "acos":
          return Math.acos(a);
        case "atan":
          return Math.atan(a);
      }
    }
  }
}

const SAMPLES = [0.37, 0.81, 1.29, 1.73, 2.41, 3.07, 5.63, 7.31, 11.9, -0.63, -1.37, -2.9, -6.1];

/** Fixed values for letters other than the variable (a, k, C...), so both sides see the same numbers. */
function paramScope(e: Expr[], x: string): Record<string, number> {
  const scope: Record<string, number> = {};
  const names = new Set<string>();
  e.forEach((ex) => symbolsOf(ex, names));
  [...names]
    .filter((n) => n !== x)
    .sort()
    .forEach((n, i) => {
      scope[n] = 0.61 + 0.37 * (i + 1);
    });
  return scope;
}

const close = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/** f' agrees with a central difference of f at the sample points where both are finite. */
/** Points near 0 as well, for a function defined only there (`\sin^{-1}(2x)` needs |x| ≤ ½). */
const SMALL_SAMPLES = [0.07, 0.13, 0.21, 0.29, 0.37, 0.43, -0.11, -0.19, -0.31, -0.41];

function derivativeAgrees(f: Expr, fp: Expr, x: string): boolean {
  const scope = paramScope([f, fp], x);
  let checked = 0;
  for (const p of [...SAMPLES, ...SMALL_SAMPLES]) {
    const h = 1e-5 * Math.max(1, Math.abs(p));
    const at = (v: number) => evalNum(f, { ...scope, [x]: v });
    const numeric = (at(p + h) - at(p - h)) / (2 * h);
    const exact = evalNum(fp, { ...scope, [x]: p });
    if (!Number.isFinite(numeric) || !Number.isFinite(exact) || Math.abs(exact) > 1e8) continue;
    if (!close(numeric, exact, 1e-5)) return false;
    checked++;
  }
  return checked >= 3;
}

function simpson(f: (v: number) => number, a: number, b: number, panels = 2000): number {
  const h = (b - a) / panels;
  let sum = f(a) + f(b);
  for (let i = 1; i < panels; i++) sum += (i % 2 === 1 ? 4 : 2) * f(a + i * h);
  return (sum * h) / 3;
}

// ---------------------------------------------------------------------------------------------
// Differentiation, rule by rule
// ---------------------------------------------------------------------------------------------

interface DRes {
  /** the rule applied, as the line a teacher writes (`3 \cdot 2x + 2`) */
  tex: string;
  /** the derivative, unsimplified */
  val: Expr;
  /** set by the quotient rule: the result stays one fraction over v² */
  frac?: { num: Expr; den: Expr };
}

const D0: DRes = { tex: "0", val: I(0) };

function negTex(t: string): string {
  if (t === "0") return t;
  if (hasTopLevelSum(t)) return `-(${t})`;
  return t.startsWith("-") ? t.slice(1) : `-${t}`;
}

function joinTwo(a: string, b: string, op: "+" | "-"): string {
  if (op === "+") return b.startsWith("-") ? `${a} - ${b.slice(1)}` : `${a} + ${b}`;
  if (hasTopLevelSum(b)) return `${a} - (${b})`;
  return b.startsWith("-") ? `${a} + ${b.slice(1)}` : `${a} - ${b}`;
}

const chainFactor = (t: string): string => (hasTopLevelSum(t) || t.startsWith("-") ? `(${t})` : t);

function fracTex(top: string, bottom: string): string {
  if (top.startsWith("-") && !hasTopLevelSum(top)) return `-\\frac{${top.slice(1)}}{${bottom}}`;
  return `\\frac{${top}}{${bottom}}`;
}

/** `\frac{d}{dx}(x + x^{-1})`, `\frac{d}{dx} x^{\frac{1}{2}}`: brackets only round a sum or a sign. */
function ddx(x: string, body: string): string {
  return hasTopLevelSum(body) || body.startsWith("-") ? `\\frac{d}{d${x}}(${body})` : `\\frac{d}{d${x}} ${body}`;
}

/** `c^k`-style coefficient in front of a factor: `5(2x + 1)^{4}`, `-(x^{2} + 1)^{-2}`. */
function coefJoin(k: Q, body: string): string {
  if (qOne(k)) return body;
  if (qEq(k, QM1)) return `-${body}`;
  return joinProduct([qLatex(k), body]);
}

function asOneTerm(A: Canon): Term {
  if (A.length === 0) return { c: Q0, f: [] };
  if (A.length === 1) return A[0];
  return { c: Q1, f: [factorOf(canonToExpr(A), Q1)] };
}

/** Rewrites before differentiating: roots as powers, `\frac{1}{x}` as `x^{-1}`, a sum over `x^k` split. */
function rewriteD(e: Expr, x: string): Expr {
  switch (e.t) {
    case "sqrt":
      return powMerge(rewriteD(e.arg, x), QHALF);
    case "pow": {
      const b = rewriteD(e.base, x);
      const k = rationalValue(e.exp);
      return k ? powMerge(b, k) : pow(b, rewriteD(e.exp, x));
    }
    case "add":
      return add(e.args.map((a) => rewriteD(a, x)));
    case "neg":
      return neg(rewriteD(e.arg, x));
    case "fn":
      return fn(e.name, rewriteD(e.arg, x));
    case "mul": {
      const args = e.args.map((a) => rewriteD(a, x));
      if (args.filter((a) => hasVar(a, x) && monomial(a, x) !== null).length < 2) return mul(args);
      const monos = args.filter((a) => monomial(a, x) !== null);
      let c = Q1;
      let k = Q0;
      for (const m of monos) {
        const mm = monomial(m, x)!;
        c = qMul(c, mm.c);
        k = qAdd(k, mm.k);
      }
      return mul([...args.filter((a) => !monos.includes(a)), monoExpr(c, k, x)]);
    }
    case "div": {
      const n = rewriteD(e.num, x);
      const d = rewriteD(e.den, x);
      if (!hasVar(d, x)) return div(n, d);
      const dm = monomial(d, x);
      if (dm) {
        const terms = n.t === "add" ? n.args : [n];
        return add(
          terms.map((t) => {
            const tm = monomial(t, x);
            return tm ? monoExpr(qDiv(tm.c, dm.c), qSub(tm.k, dm.k), x) : div(t, d);
          }),
        );
      }
      if (!hasVar(n, x)) {
        const inv = powMerge(d, QM1);
        const c = rationalValue(n);
        return c && qOne(c) ? inv : mul([n, inv]);
      }
      return div(n, d);
    }
    default:
      return e;
  }
}

function powMerge(b: Expr, k: Q): Expr {
  if (qOne(k)) return b;
  if (b.t === "pow") {
    const kk = rationalValue(b.exp);
    if (kk) {
      const m = qMul(kk, k);
      return qOne(m) ? b.base : pow(b.base, N(m));
    }
  }
  if (b.t === "sqrt") return powMerge(b.arg, qMul(QHALF, k));
  return pow(b, N(k));
}

/** c·x^k with rational c and k, else null. */
function monomial(e: Expr, x: string): { c: Q; k: Q } | null {
  switch (e.t) {
    case "num":
      return { c: e.q, k: Q0 };
    case "sym":
      return e.name === x ? { c: Q1, k: Q1 } : null;
    case "pow": {
      if (!isVar(e.base, x)) return null;
      const k = rationalValue(e.exp);
      return k ? { c: Q1, k } : null;
    }
    case "sqrt":
      return isVar(e.arg, x) ? { c: Q1, k: QHALF } : null;
    case "neg": {
      const m = monomial(e.arg, x);
      return m ? { c: qNeg(m.c), k: m.k } : null;
    }
    case "mul": {
      let c = Q1;
      let k = Q0;
      for (const a of e.args) {
        const m = monomial(a, x);
        if (!m) return null;
        c = qMul(c, m.c);
        k = qAdd(k, m.k);
      }
      return { c, k };
    }
    case "div": {
      const n = monomial(e.num, x);
      const d = monomial(e.den, x);
      if (!n || !d || qZero(d.c)) return null;
      return { c: qDiv(n.c, d.c), k: qSub(n.k, d.k) };
    }
    default:
      return null;
  }
}

function monoExpr(c: Q, k: Q, x: string): Expr {
  if (qZero(c)) return I(0);
  if (qZero(k)) return N(c);
  const base = qOne(k) ? S(x) : pow(S(x), N(k));
  if (qOne(c)) return base;
  if (qEq(c, QM1)) return neg(base);
  return mul([N(c), base]);
}

function makeDiff(x: string) {
  const X = S(x);
  const show = (e: Expr): string => printCanon(canon(e), "display", x);

  const powerRuleTex = (k: Q): string => {
    const km1 = qSub(k, Q1);
    const xp = qOne(km1) ? x : `${x}^{${qLatex(km1)}}`;
    if (qEq(k, QM1)) return `-${xp}`;
    return `${qLatex(k)}${xp}`;
  };

  const scaleRule = (c: Expr, inner: DRes): DRes => {
    if (inner.tex === "0") return D0;
    const cq = rationalValue(c);
    if (cq && qEq(cq, QM1)) return { tex: negTex(inner.tex), val: neg(inner.val) };
    const cTex = tex(c);
    let t: string;
    if (inner.tex === "1") t = cTex;
    else if (hasTopLevelSum(inner.tex)) t = `${cTex}(${inner.tex})`;
    else if (inner.tex.startsWith("-")) t = `${cTex} \\cdot (${inner.tex})`;
    else t = joinProduct([cTex, inner.tex]);
    return { tex: t, val: mul([c, inner.val]) };
  };

  /** u·v written as one term (`2x\sin x`, `xe^{x}`), brackets kept, like bases merged. */
  const prodTex = (a: Expr, b: Expr): string => {
    const t = mulTerm(asOneTerm(canon(a)), asOneTerm(canon(b)));
    return qZero(t.c) ? "0" : printCanon([t], "display", x);
  };

  const outer = (name: Fn, g: Expr): { tex: string; val: Expr } => {
    switch (name) {
      case "sin":
        return { tex: tex(fn("cos", g)), val: fn("cos", g) };
      case "cos":
        return { tex: `-${tex(fn("sin", g))}`, val: neg(fn("sin", g)) };
      case "tan":
        return { tex: tex(pow(fn("sec", g), I(2))), val: pow(fn("sec", g), I(2)) };
      case "sec":
        return { tex: joinProduct([tex(fn("sec", g)), tex(fn("tan", g))]), val: mul([fn("sec", g), fn("tan", g)]) };
      case "csc":
        return { tex: `-${joinProduct([tex(fn("csc", g)), tex(fn("cot", g))])}`, val: neg(mul([fn("csc", g), fn("cot", g)])) };
      case "cot":
        return { tex: `-${tex(pow(fn("csc", g), I(2)))}`, val: neg(pow(fn("csc", g), I(2))) };
      case "exp":
        return { tex: tex(fn("exp", g)), val: fn("exp", g) };
      case "ln": {
        const h = g.t === "fn" && g.name === "abs" ? g.arg : g;
        return { tex: `\\frac{1}{${tex(h)}}`, val: div(I(1), h) };
      }
      case "log10":
        return { tex: `\\frac{1}{${joinProduct([texFactor(g, false), "\\ln 10"])}}`, val: div(I(1), mul([g, fn("ln", I(10))])) };
      case "atan": {
        const g2 = pow(g, I(2));
        return { tex: `\\frac{1}{1 + ${tex(g2)}}`, val: div(I(1), add([I(1), g2])) };
      }
      case "asin":
      case "acos": {
        const root = { t: "sqrt" as const, arg: add([I(1), neg(pow(g, I(2)))]) };
        const t = `\\frac{1}{${tex(root)}}`;
        return name === "asin" ? { tex: t, val: div(I(1), root) } : { tex: `-${t}`, val: neg(div(I(1), root)) };
      }
      case "abs":
        return fail();
    }
  };

  const d = (e: Expr): DRes => {
    if (!hasVar(e, x)) return D0;
    switch (e.t) {
      case "sym":
        return { tex: "1", val: I(1) };
      case "add": {
        const parts = e.args.map(d).filter((p) => p.tex !== "0");
        if (!parts.length) return D0;
        return { tex: parts.map((p) => p.tex).reduce((acc, t) => joinTwo(acc, t, "+")), val: add(parts.map((p) => p.val)) };
      }
      case "neg": {
        const p = d(e.arg);
        return p.tex === "0" ? D0 : { tex: negTex(p.tex), val: neg(p.val) };
      }
      case "mul": {
        const consts = e.args.filter((a) => !hasVar(a, x));
        const vars = e.args.filter((a) => hasVar(a, x));
        const inner = vars.length === 1 ? d(vars[0]) : product(vars[0], mul(vars.slice(1)));
        return consts.length ? scaleRule(mul(consts), inner) : inner;
      }
      case "div": {
        if (!hasVar(e.den, x)) {
          const p = d(e.num);
          return p.tex === "0" ? D0 : { tex: fracTex(p.tex, tex(e.den)), val: div(p.val, e.den) };
        }
        if (!hasVar(e.num, x)) return d(mul([e.num, powMerge(e.den, QM1)]));
        return quotient(e.num, e.den);
      }
      case "sqrt":
        return d(pow(e.arg, N(QHALF)));
      case "pow":
        return dPow(e.base, e.exp);
      case "fn": {
        const o = outer(e.name, e.arg);
        // \ln|g| differentiates like \ln g: the chain goes through g
        const g = e.name === "ln" && e.arg.t === "fn" && e.arg.name === "abs" ? e.arg.arg : e.arg;
        if (isVar(g, x)) return o;
        const inner = d(g);
        if (inner.tex === "0") return D0;
        const innerTex = show(inner.val);
        return { tex: innerTex === "1" ? o.tex : `${o.tex} \\cdot ${chainFactor(innerTex)}`, val: mul([o.val, inner.val]) };
      }
      default:
        return fail();
    }
  };

  const dPow = (base: Expr, exp: Expr): DRes => {
    if (!hasVar(exp, x)) {
      const k = rationalValue(exp);
      if (!k) return fail(); // x^n, x^{\pi}: not a school exponent
      if (qZero(k)) return D0;
      if (qOne(k)) return d(base);
      const km1 = qSub(k, Q1);
      if (isVar(base, x)) return { tex: powerRuleTex(k), val: mul([N(k), qOne(km1) ? X : pow(X, N(km1))]) };
      const inner = d(base);
      if (inner.tex === "0") return D0;
      const innerTex = show(inner.val);
      const powPart = qOne(km1) ? texFactor(base, false) : tex(pow(base, N(km1)));
      const o = coefJoin(k, powPart);
      return { tex: innerTex === "1" ? o : `${o} \\cdot ${chainFactor(innerTex)}`, val: mul([N(k), pow(base, N(km1)), inner.val]) };
    }
    if (!hasVar(base, x)) {
      // a^{g} = a^{g} \ln a · g'
      const bq = rationalValue(base);
      if (bq ? bq.n <= 0 || qOne(bq) : base.t !== "sym") return fail();
      const inner = d(exp);
      if (inner.tex === "0") return D0;
      const innerTex = show(inner.val);
      const o = joinProduct([tex(pow(base, exp)), texFn("ln", base)]);
      return { tex: innerTex === "1" ? o : `${o} \\cdot ${chainFactor(innerTex)}`, val: mul([pow(base, exp), fn("ln", base), inner.val]) };
    }
    return fail();
  };

  const product = (u: Expr, v: Expr): DRes => {
    const du = d(u).val;
    const dv = d(v).val;
    return { tex: joinTwo(prodTex(du, v), prodTex(u, dv), "+"), val: add([mul([du, v]), mul([u, dv])]) };
  };

  const quotient = (u: Expr, v: Expr): DRes => {
    const du = d(u).val;
    const dv = d(v).val;
    const top = joinTwo(prodTex(du, v), prodTex(u, dv), "-");
    const bottom = tex(pow(v, I(2)));
    const num = add([mul([du, v]), neg(mul([u, dv]))]);
    const den = pow(v, I(2));
    return { tex: `\\frac{${top}}{${bottom}}`, val: div(num, den), frac: { num, den } };
  };

  return d;
}

// ---------------------------------------------------------------------------------------------
// Exact values: rationals, √, π, e, ln
// ---------------------------------------------------------------------------------------------

type AtomKind = "pi" | "sqrt" | "e" | "ln" | "fn";

interface Atom {
  kind: AtomKind;
  key: string;
  tex: string;
  v: number;
  /** π power, √ radicand, e exponent, ln argument */
  p?: number;
  m?: number;
  r?: Q;
  arg?: Q;
}

interface Ex {
  r: Q;
  t: Array<{ c: Q; a: Atom }>;
}

const exQ = (r: Q): Ex => ({ r, t: [] });
const exAtom = (a: Atom, c: Q = Q1): Ex => ({ r: Q0, t: [{ c, a }] });

function piAtom(p: number): Atom {
  return { kind: "pi", key: `pi^${p}`, tex: p === 1 ? "\\pi" : `\\pi^{${p}}`, v: Math.PI ** p, p };
}

function sqrtAtom(m: number): Atom {
  return { kind: "sqrt", key: `sqrt${m}`, tex: `\\sqrt{${m}}`, v: Math.sqrt(m), m };
}

function eAtom(r: Q): Atom {
  return { kind: "e", key: `e^${r.n}/${r.d}`, tex: qOne(r) ? "e" : `e^{${qLatex(r)}}`, v: Math.exp(qVal(r)), r };
}

function lnAtom(a: Q): Atom {
  return { kind: "ln", key: `ln${a.n}/${a.d}`, tex: qInt(a) ? `\\ln ${a.n}` : `\\ln\\frac{${a.n}}{${a.d}}`, v: Math.log(qVal(a)), arg: a };
}

function fnAtom(name: string, a: Q, v: number): Atom {
  const arg = qInt(a) && a.n >= 0 ? ` ${a.n}` : `(${qLatex(a)})`;
  return { kind: "fn", key: `${name}${a.n}/${a.d}`, tex: `\\${name}${arg}`, v, arg: a };
}

function exAdd(a: Ex, b: Ex): Ex {
  const t = a.t.map((x) => ({ ...x }));
  for (const y of b.t) {
    const i = t.findIndex((x) => x.a.key === y.a.key);
    if (i >= 0) t[i] = { c: qAdd(t[i].c, y.c), a: t[i].a };
    else t.push({ ...y });
  }
  return { r: qAdd(a.r, b.r), t: t.filter((x) => !qZero(x.c)) };
}

const exScale = (a: Ex, k: Q): Ex => ({ r: qMul(a.r, k), t: a.t.map((x) => ({ c: qMul(x.c, k), a: x.a })).filter((x) => !qZero(x.c)) });
const exNeg = (a: Ex): Ex => exScale(a, QM1);
const exSub = (a: Ex, b: Ex): Ex => exAdd(a, exNeg(b));
const exNum = (a: Ex): number => a.t.reduce((s, x) => s + qVal(x.c) * x.a.v, qVal(a.r));
const exIsRational = (a: Ex): boolean => a.t.length === 0;

/** √r for a rational r >= 0: `\frac{s}{d}\sqrt{m}` with m square-free, or a rational. */
function exSqrtQ(r: Q): Ex {
  if (r.n < 0) fail();
  if (r.n === 0) return exQ(Q0);
  let m = r.n * r.d;
  if (m > 1e10) fail();
  let s = 1;
  for (let f = 2; f * f <= m; f++) {
    while (m % (f * f) === 0) {
      m /= f * f;
      s *= f;
    }
  }
  const c = q(s, r.d);
  return m === 1 ? exQ(c) : exAtom(sqrtAtom(m), c);
}

function atomMul(x: Atom, y: Atom): Ex {
  if (x.kind === "pi" && y.kind === "pi") return exAtom(piAtom((x.p ?? 1) + (y.p ?? 1)));
  if (x.kind === "sqrt" && y.kind === "sqrt") return exSqrtQ(q((x.m ?? 1) * (y.m ?? 1)));
  if (x.kind === "e" && y.kind === "e") {
    const r = qAdd(x.r ?? Q1, y.r ?? Q1);
    return qZero(r) ? exQ(Q1) : exAtom(eAtom(r));
  }
  return fail();
}

function exMul(a: Ex, b: Ex): Ex {
  let out = exQ(Q0);
  const pa: Array<{ c: Q; a: Atom | null }> = [{ c: a.r, a: null }, ...a.t];
  const pb: Array<{ c: Q; a: Atom | null }> = [{ c: b.r, a: null }, ...b.t];
  for (const x of pa) {
    for (const y of pb) {
      if (qZero(x.c) || qZero(y.c)) continue;
      const c = qMul(x.c, y.c);
      let term: Ex;
      if (!x.a && !y.a) term = exQ(c);
      else if (!x.a) term = exAtom(y.a!, c);
      else if (!y.a) term = exAtom(x.a, c);
      else term = exScale(atomMul(x.a, y.a), c);
      out = exAdd(out, term);
    }
  }
  return out;
}

function exInv(a: Ex): Ex {
  if (exIsRational(a)) return exQ(qDiv(Q1, a.r));
  if (qZero(a.r) && a.t.length === 1) {
    const { c, a: atom } = a.t[0];
    if (atom.kind === "sqrt") return exAtom(atom, qDiv(Q1, qMul(c, q(atom.m ?? 1))));
    if (atom.kind === "e") return exAtom(eAtom(qNeg(atom.r ?? Q1)), qDiv(Q1, c));
  }
  return fail();
}

function exPowQ(a: Ex, k: Q): Ex {
  if (qInt(k)) {
    if (k.n < 0) return exInv(exPowQ(a, q(-k.n)));
    if (k.n > 16) fail();
    let out = exQ(Q1);
    for (let i = 0; i < k.n; i++) out = exMul(out, a);
    return out;
  }
  if (exIsRational(a)) {
    if (a.r.n < 0) fail(); // not real
    if (a.r.n === 0) {
      if (k.n > 0) return exQ(Q0);
      throw new ZeroDivision();
    }
    const root = qRoot(a.r, k.d);
    if (root) return exQ(qPowInt(root, k.n));
    if (k.d === 2) return exPowQ(exSqrtQ(a.r), q(k.n));
    return fail();
  }
  if (qZero(a.r) && a.t.length === 1 && qOne(a.t[0].c) && a.t[0].a.kind === "e") return exAtom(eAtom(qMul(a.t[0].a.r ?? Q1, k)));
  return fail();
}

/** sin(kπ/12) for the angles a student knows (multiples of π/6 and π/4). */
function sin12(k: number): Ex {
  const m = ((k % 24) + 24) % 24;
  if (m >= 12) return exNeg(sin12(m - 12));
  if (m > 6) return sin12(12 - m);
  switch (m) {
    case 0:
      return exQ(Q0);
    case 2:
      return exQ(QHALF);
    case 3:
      return exAtom(sqrtAtom(2), QHALF);
    case 4:
      return exAtom(sqrtAtom(3), QHALF);
    case 6:
      return exQ(Q1);
    default:
      return fail();
  }
}

function exTrig(name: Fn, a: Ex): Ex {
  // a rational multiple of π
  if (qZero(a.r) && a.t.length === 1 && a.t[0].a.kind === "pi" && a.t[0].a.p === 1) {
    const k = qMul(a.t[0].c, q(12));
    if (!qInt(k)) fail();
    const s = sin12(k.n);
    const c = sin12(k.n + 6);
    switch (name) {
      case "sin":
        return s;
      case "cos":
        return c;
      case "tan":
        return exMul(s, exInv(c));
      case "sec":
        return exInv(c);
      case "csc":
        return exInv(s);
      case "cot":
        return exMul(c, exInv(s));
      default:
        return fail();
    }
  }
  if (!exIsRational(a)) return fail();
  const v = qVal(a.r);
  const values: Record<string, number> = { sin: Math.sin(v), cos: Math.cos(v), tan: Math.tan(v) };
  if (!(name in values)) return fail();
  return exAtom(fnAtom(name, a.r, values[name]));
}

function exFn(name: Fn, a: Ex): Ex {
  switch (name) {
    case "exp":
      if (exIsRational(a)) return qZero(a.r) ? exQ(Q1) : exAtom(eAtom(a.r));
      if (qZero(a.r) && a.t.length === 1 && a.t[0].a.kind === "ln" && qInt(a.t[0].c)) return exQ(qPowInt(a.t[0].a.arg ?? Q1, a.t[0].c.n));
      return fail();
    case "ln": {
      if (exIsRational(a)) {
        const r = a.r;
        if (r.n <= 0) fail(); // ln of zero or a negative: undefined
        if (qOne(r)) return exQ(Q0);
        if (r.n === 1) return exAtom(lnAtom(q(r.d)), QM1); // ln(1/n) = -ln n
        return exAtom(lnAtom(r));
      }
      if (qZero(a.r) && a.t.length === 1 && a.t[0].a.kind === "e" && a.t[0].c.n > 0) {
        const { c, a: atom } = a.t[0];
        return exAdd(exFn("ln", exQ(c)), exQ(atom.r ?? Q1));
      }
      return fail();
    }
    case "log10": {
      if (!exIsRational(a) || a.r.n <= 0) fail();
      if (qOne(a.r)) return exQ(Q0);
      for (let k = 1; k <= 12; k++) if (qEq(a.r, q(10 ** k))) return exQ(q(k));
      return exAtom(fnAtom("log", a.r, Math.log10(qVal(a.r))));
    }
    case "abs":
      return exNum(a) < 0 ? exNeg(a) : a;
    case "asin":
    case "acos":
    case "atan":
      return exInverseTrig(name, a);
    default:
      if (exIsRational(a) && qZero(a.r)) {
        if (name === "sin" || name === "tan") return exQ(Q0);
        if (name === "cos" || name === "sec") return exQ(Q1);
        throw new ZeroDivision();
      }
      return exTrig(name, a);
  }
}

/** sin⁻¹, cos⁻¹, tan⁻¹ at the values of the special angles (`\\tan^{-1} 1 = \\frac{\\pi}{4}`), else not exact. */
function exInverseTrig(name: "asin" | "acos" | "atan", a: Ex): Ex {
  const v = exNum(a);
  const r2 = Math.SQRT2 / 2;
  const r3 = Math.sqrt(3);
  const table: Array<[number, Q]> =
    name === "atan"
      ? [
          [0, Q0],
          [r3 / 3, q(1, 6)],
          [1, q(1, 4)],
          [r3, q(1, 3)],
        ]
      : [
          [0, Q0],
          [0.5, q(1, 6)],
          [r2, q(1, 4)],
          [r3 / 2, q(1, 3)],
          [1, QHALF],
        ];
  const hit = table.find(([t]) => Math.abs(Math.abs(v) - t) < 1e-12);
  if (!hit) return fail();
  const k = v < 0 ? qNeg(hit[1]) : hit[1];
  const angle = name === "acos" ? qSub(QHALF, k) : k;
  return qZero(angle) ? exQ(Q0) : exAtom(piAtom(1), angle);
}

function evalExact(e: Expr, env: ReadonlyMap<string, Ex>): Ex {
  switch (e.t) {
    case "num":
      return exQ(e.q);
    case "sym": {
      const v = env.get(e.name);
      if (v) return v;
      if (e.name === "pi") return exAtom(piAtom(1));
      if (e.name === "e") return exAtom(eAtom(Q1));
      return fail();
    }
    case "lit":
      return fail();
    case "add":
      return e.args.map((a) => evalExact(a, env)).reduce(exAdd);
    case "neg":
      return exNeg(evalExact(e.arg, env));
    case "mul":
      return e.args.map((a) => evalExact(a, env)).reduce(exMul);
    case "div":
      return exMul(evalExact(e.num, env), exInv(evalExact(e.den, env)));
    case "sqrt":
      return exPowQ(evalExact(e.arg, env), QHALF);
    case "pow": {
      const k = evalExact(e.exp, env);
      if (!exIsRational(k)) fail();
      return exPowQ(evalExact(e.base, env), k.r);
    }
    case "fn":
      return exFn(e.name, evalExact(e.arg, env));
  }
}

/** `\ln 4 - \ln 2` → `\ln 2`: logs with whole-number multiples combine into one. */
function mergeLn(terms: Ex["t"]): Ex["t"] {
  const logs = terms.filter((x) => x.a.kind === "ln");
  if (logs.length < 2) return terms;
  const c0 = qAbs(logs[0].c);
  let prod = Q1;
  for (const l of logs) {
    const k = qDiv(l.c, c0);
    if (!qInt(k)) return terms;
    prod = qMul(prod, qPowInt(l.a.arg ?? Q1, k.n));
  }
  const rest = terms.filter((x) => x.a.kind !== "ln");
  if (qOne(prod)) return rest;
  const merged = prod.n === 1 ? { c: qNeg(c0), a: lnAtom(q(prod.d)) } : { c: c0, a: lnAtom(prod) };
  return [...rest, merged];
}

function atomBody(c: Q, atom: Atom): string {
  if (atom.kind === "pi" || atom.kind === "sqrt") {
    const top = c.n === 1 ? atom.tex : joinProduct([String(c.n), atom.tex]);
    return c.d === 1 ? top : `\\frac{${top}}{${c.d}}`;
  }
  return joinProduct([qOne(c) ? "" : qLatex(c), atom.tex]);
}

/** An exact value as a teacher writes it: `e^{2} - 1`, `\frac{3}{2} + \ln 2`, `\frac{\sqrt{2}}{2}`. */
function exTex(a: Ex, merge = false): string {
  const terms = merge ? mergeLn(a.t) : a.t;
  const atoms = terms.map((x) => ({ neg: x.c.n < 0, body: atomBody(qAbs(x.c), x.a) }));
  if (qZero(a.r)) return joinSigned(atoms);
  const r = { neg: a.r.n < 0, body: qLatex(qAbs(a.r)) };
  return joinSigned(a.r.n > 0 ? [r, ...atoms] : [...atoms, r]);
}

const exIsSum = (a: Ex): boolean => a.t.length + (qZero(a.r) ? 0 : 1) > 1;

function exLit(a: Ex): Expr {
  const t = exTex(a);
  const single = a.t.length === 0 ? qInt(a.r) : qZero(a.r) && a.t.length === 1 && qOne(qAbs(a.t[0].c)) && (a.t[0].a.kind === "pi" || a.t[0].a.kind === "e");
  return { t: "lit", tex: t, neg: exNum(a) < 0, atom: single };
}

/** A number mathjs computed (a limit's point, `pi / 2` = 1.5707...) back as an exact value, or null. */
function exactFromNumber(v: number): Ex | null {
  if (!Number.isFinite(v)) return null;
  const near = Number(v.toPrecision(12));
  if (Number.isInteger(near)) return exQ(q(near));
  const f = asSmallFraction(near);
  if (f) return exQ(q(f.n, f.d));
  const p = v / Math.PI;
  const pn = Number(p.toPrecision(12));
  if (Number.isInteger(pn)) return exAtom(piAtom(1), q(pn));
  const pf = asSmallFraction(pn);
  if (pf) return exAtom(piAtom(1), q(pf.n, pf.d));
  return null;
}

// ---------------------------------------------------------------------------------------------
// Polynomials (limits of rational functions)
// ---------------------------------------------------------------------------------------------

/** Coefficients, lowest power first. */
type Poly = Q[];

function trimPoly(p: Poly): Poly {
  const out = [...p];
  while (out.length > 0 && qZero(out[out.length - 1])) out.pop();
  return out;
}

function polyOf(e: Expr, x: string): Poly | null {
  let A: Canon;
  try {
    A = canon(e);
  } catch {
    return null;
  }
  const out: Q[] = [];
  for (const t of A) {
    if (t.f.length > 1) return null;
    let k = 0;
    if (t.f.length === 1) {
      const f = t.f[0];
      if (!isVar(f.base, x) || !qInt(f.e) || f.e.n < 0 || f.e.n > 12) return null;
      k = f.e.n;
    }
    out[k] = qAdd(out[k] ?? Q0, t.c);
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i] ?? Q0;
  return trimPoly(out);
}

function pEval(p: Poly, v: Q): Q {
  let acc = Q0;
  for (let i = p.length - 1; i >= 0; i--) acc = qAdd(qMul(acc, v), p[i]);
  return acc;
}

/** p / (x - r) by synthetic division (the remainder is dropped: callers divide exact factors only). */
function pDivRoot(p: Poly, r: Q): Poly {
  const n = p.length - 1;
  const out: Q[] = new Array<Q>(n).fill(Q0);
  let carry = Q0;
  for (let i = n; i >= 1; i--) {
    carry = qAdd(p[i], qMul(carry, r));
    out[i - 1] = carry;
  }
  return out;
}

const pScale = (p: Poly, k: Q): Poly => p.map((c) => qMul(c, k));

function polyCanon(p: Poly, x: string): Canon {
  const out: Term[] = [];
  for (let k = p.length - 1; k >= 0; k--) {
    if (qZero(p[k])) continue;
    out.push({ c: p[k], f: k === 0 ? [] : [factorOf(S(x), q(k))] });
  }
  return out;
}

const pTex = (p: Poly, x: string): string => printCanon(polyCanon(p, x), "display", x);

/** a·x + b with rational a ≠ 0 and b (the inside of a reverse chain rule), or null. */
function linearOf(e: Expr, x: string): { a: Q; b: Q } | null {
  if (isVar(e, x)) return { a: Q1, b: Q0 };
  const p = polyOf(e, x);
  if (!p || p.length !== 2 || qZero(p[1])) return null;
  return { a: p[1], b: p[0] };
}

// ---------------------------------------------------------------------------------------------
// The engine-facing module
// ---------------------------------------------------------------------------------------------

/**
 * An antiderivative found by a technique (`integration.ts`: substitution, parts, an identity,
 * partial fractions), already checked by differentiating it back.
 */
export interface IntegralTechnique {
  /**
   * The working, as drawn: a relation (`u = x^{2} + 1`, `du = 2x \, dx`) stands on its own
   * line, every other line continues the question with `=`. The last line is `F + C`.
   */
  lines: string[];
  /** the antiderivative, without the constant */
  F: Expr;
  /** F as the teacher writes it (`\frac{(x^{2} + 1)^{6}}{6}`) */
  display: string;
}

/** A definite integral done by a technique: the working and its exact value. */
export interface DefiniteTechnique {
  lines: string[];
  value: Ex;
}

/** A limit the direct methods cannot do (`limits.ts`: the conjugate, a known limit). */
export interface LimitTechnique {
  lines: string[];
  value: Ex;
}

export interface CalculusDeps {
  /** LaTeX → mathjs source (the engine's `translate`); throws on LaTeX it cannot read */
  translate(latex: string): Translated;
  /** integration techniques, tried when the term-by-term rules cannot integrate (`integration.ts`) */
  integrate?(integrand: Expr, x: string, constant: string): IntegralTechnique | null;
  /** the same, over [a, b] (limits changed with a substitution, the bracket evaluated exactly) */
  integrateDefinite?(integrand: Expr, x: string, a: Ex, b: Ex): DefiniteTechnique | null;
  /** limits at a finite point that direct substitution and factorising cannot do */
  limit?(operand: Expr, x: string, a: Ex, prefix: string): LimitTechnique | null;
}

export interface Calculus {
  /**
   * Teacher-style steps for a calculus expression (a derivative, an integral, a limit; a
   * trailing `=` is allowed). Bare lines, no leading `=`: the last one is the answer. Null
   * when the line is not calculus, or the engine cannot do it exactly.
   */
  steps(latex: string): string[] | null;
  /**
   * The same, for the last of several lines: `\frac{dy}{dx}` / `f'(x)` / `f'(2)` against a
   * definition on a line above, or a calculus line on its own. Steps are ready to draw (`= …`).
   * `undefined` when the last line is not a calculus question at all (the caller tries its
   * other solvers), `null` when it is one the engine cannot answer.
   */
  fromLines(lines: readonly string[]): { latex: string; steps: string[] } | null | undefined;
  /** The final answer for a translated line that is one calculus call, as LaTeX, or null. */
  resultLatex(source: string): string | null;
  /**
   * `\int 2x \, dx = x^2 + C`: checked by differentiating the right-hand side (so an answer the
   * engine could not have found itself is still checked). Null when the line is not such a claim.
   */
  claimVerdict(sources: readonly string[], ops: readonly string[]): "ok" | "mismatch" | "unknown" | null;
  /**
   * The term-by-term rules on an integrand (the inner integral of a substitution or of parts):
   * the rule line, the antiderivative printed and as an Expr; null when they cannot. No `+ C`.
   */
  basicIntegral(integrand: Expr, x: string): BasicIntegral | null;
}

export interface BasicIntegral {
  /** the integrand rewritten first (`x^{\frac{1}{2}}` for `\sqrt{x}`), or null */
  rewrite: string | null;
  rule: string;
  display: string;
  F: Expr;
}

const MAX_STEPS = 8;

/** Normalized for comparing two lines: spacing, braces, `\left`/`\right` never count. */
function lineKey(s: string): string {
  return s
    .replace(/\\rightarrow|\\longrightarrow/g, "\\to")
    .replace(/\\left|\\right/g, "")
    .replace(/\\[,;:! ]/g, "")
    .replace(/\\cdot/g, "*")
    .replace(/[{}\s]/g, "")
    .replace(/=+$/, "");
}

/** Drops a line identical to the one before it (or to the question), always keeping the last. */
function tidySteps(steps: readonly string[], input: string): string[] {
  const out: string[] = [];
  let last = lineKey(input);
  for (const s of steps) {
    const k = lineKey(s);
    if (!s || k === last) continue;
    out.push(s);
    last = k;
  }
  while (out.length > MAX_STEPS) out.splice(out.length > 2 ? 1 : 0, 1);
  return out;
}

type Target = { kind: "finite"; v: Ex } | { kind: "inf"; sign: 1 | -1 };
type LimitValue = { kind: "finite"; v: Ex } | { kind: "inf"; sign: 1 | -1 };

const LEIBNIZ_Q = new RegExp(
  String.raw`^\\frac\s*\{\s*${DIFFERENTIAL_D}\s*(?:\^\s*\{?\s*([2-4])\s*\}?)?\s*([a-zA-Z])\s*\}\s*\{\s*${DIFFERENTIAL_D}\s*([a-zA-Z])\s*(?:\^\s*\{?\s*([2-4])\s*\}?)?\s*\}$`,
);
const PRIME_Q = /^([a-zA-Z])\s*('{1,3}|(?:\\prime\s*){1,3}|\^\s*\{\s*(?:\\prime\s*){1,3}\}|\^\s*\\prime)\s*(?:(?:\\left)?\(\s*([^()]*?)\s*(?:\\right)?\))?$/;
const DEFINITION = /^([a-zA-Z])\s*(?:(?:\\left)?\(\s*([a-zA-Z])\s*(?:\\right)?\))?\s*=\s*([^=<>]+)$/;
/** A line that is a calculus question: `\lim`, `\int`, or a `\frac{d}{dx}` / `\frac{d^2}{dx^2}` operator. */
const CALCULUS_LINE = new RegExp(
  String.raw`\\(?:lim|int)(?![a-zA-Z])|\\frac\s*\{\s*${DIFFERENTIAL_D}\s*(?:\^\s*\{?\s*\d\s*\}?)?\s*\}\s*\{\s*${DIFFERENTIAL_D}\s*\\?[a-zA-Z]`,
);

function stripEquals(latex: string): string {
  return preprocessLatex(latex ?? "")
    .trim()
    .replace(/=\s*$/, "")
    .trim();
}

export function createCalculus(math: MathJsInstance, deps: CalculusDeps): Calculus {
  const cache = new Map<string, string[] | null>();

  const parseExpr = (source: string): Expr => {
    try {
      return fromNode(math.parse(source));
    } catch (e) {
      if (e instanceof NotCalculus || e instanceof ZeroDivision) throw e;
      return fail();
    }
  };

  const stringArg = (node: MathNode | undefined): string => {
    const n = node as AnyNode | undefined;
    if (!n || n.type !== "ConstantNode" || typeof n.value !== "string") return fail();
    return n.value;
  };

  /** the point of a limit, or a bound: `2`, `-\infty`, `\frac{\pi}{2}` */
  const targetOf = (node: MathNode): Target => {
    const n = node as AnyNode;
    const inner = n.type === "ParenthesisNode" && n.content ? (n.content as AnyNode) : n;
    // mathjs reads `Infinity` as a constant (or, in older versions, a symbol)
    const isInfinity = (a: AnyNode | undefined) => !!a && ((a.type === "SymbolNode" && a.name === "Infinity") || (a.type === "ConstantNode" && a.value === Infinity));
    if (isInfinity(inner)) return { kind: "inf", sign: 1 };
    if (inner.type === "OperatorNode" && (inner.fn === "unaryMinus" || inner.fn === "unaryPlus")) {
      const a = (inner.args ?? [])[0] as AnyNode | undefined;
      if (isInfinity(a)) return { kind: "inf", sign: inner.fn === "unaryMinus" ? -1 : 1 };
    }
    const e = fromNode(node);
    if ([...symbolsOf(e)].length > 0) fail();
    return { kind: "finite", v: evalExact(e, new Map()) };
  };

  const targetTex = (t: Target): string => (t.kind === "inf" ? (t.sign > 0 ? "\\infty" : "-\\infty") : exTex(t.v));

  // --- derivatives -------------------------------------------------------------------------

  interface DerivativeWork {
    steps: string[];
    /** the n-th derivative, simplified */
    result: Canon;
    finalTex: string;
  }

  /**
   * A line of an earlier stage of a higher derivative, still under the derivatives left to take:
   * `\frac{d^2}{dx^2}(x^4)` is `= \frac{d}{dx}(4x^{3})`, never `= 4x^{3}` (the first derivative
   * is not equal to the second).
   */
  const underD = (x: string, body: string, m: number): string => {
    if (m === 0) return body;
    const op = m === 1 ? `\\frac{d}{d${x}}` : `\\frac{d^{${m}}}{d${x}^{${m}}}`;
    return `${op}(${body})`;
  };

  /**
   * f(x)^{g(x)} (`x^{x}`): logarithmic differentiation — name it y, take logs, differentiate
   * both sides (y implicitly), then multiply back by y.
   */
  const logDifferentiation = (operand: Expr, x: string): DerivativeWork | null => {
    if (operand.t !== "pow" || !hasVar(operand.base, x) || !hasVar(operand.exp, x)) return null;
    const y = symbolsOf(operand).has("y") ? "w" : "y";
    const lnY = mul([operand.exp, fn("ln", operand.base)]);
    const D = makeDiff(x)(lnY);
    const Dc = canon(D.val);
    const result = canon(mul([operand, canonToExpr(Dc)]));
    if (!derivativeAgrees(operand, canonToExpr(result), x)) return null;
    const dydx = `\\frac{d${y}}{d${x}}`;
    const inner = printCanon(Dc, "display", x);
    const bracket = hasTopLevelSum(inner) ? `(${inner})` : inner;
    const lines = [`${y} = ${tex(operand)}`, `\\ln ${y} = ${printCanon(canon(lnY), "display", x)}`, `\\frac{1}{${y}}${dydx} = ${D.tex}`];
    if (lineKey(D.tex) !== lineKey(inner)) lines.push(`\\frac{1}{${y}}${dydx} = ${inner}`);
    const finalTex = joinProduct([tex(operand), bracket]);
    lines.push(`${dydx} = ${joinProduct([y, bracket])}`, finalTex);
    return { steps: lines, result, finalTex };
  };

  const derivativeWork = (operand: Expr, x: string, order: number): DerivativeWork | null => {
    orderVar = x;
    if (order === 1) {
      const logs = logDifferentiation(operand, x);
      if (logs) return logs;
    }
    const d = makeDiff(x);
    let cur = operand;
    const stages: string[][] = [];
    let result: Canon = [];
    let finalTex = "";
    for (let k = 0; k < order; k++) {
      const m = order - 1 - k;
      const lines: string[] = [];
      if (k > 0) {
        // the index form of the last stage's answer, when that is what gets differentiated next
        const power = underD(x, printCanon(result, "power", x), m + 1);
        const prev = stages[k - 1];
        if (lineKey(power) !== lineKey(prev[prev.length - 1])) lines.push(power);
      }
      const rw = rewriteD(cur, x);
      if (k === 0 && lineKey(tex(rw)) !== lineKey(tex(cur))) lines.push(m === 0 ? ddx(x, tex(rw)) : underD(x, tex(rw), m + 1));
      const D = d(rw);
      result = canon(D.val);
      if (!derivativeAgrees(cur, canonToExpr(result), x)) return null;
      if (D.frac) {
        const top = printCanon(canon(D.frac.num), "display", x);
        finalTex = top === "0" ? "0" : fracTex(top, tex(D.frac.den));
        lines.push(underD(x, D.tex, m), underD(x, finalTex, m));
      } else {
        finalTex = printCanon(result, "display", x);
        // the index-form line only when it is a step between the rule and the answer; an
        // earlier stage stops at the index form, which is what gets differentiated next
        const shown = m > 0 ? [D.tex, printCanon(result, "power", x)] : [D.tex, printCanon(result, "power", x), finalTex];
        const kept = shown.filter((l, i) => i === 0 || lineKey(l) !== lineKey(shown[i - 1]));
        if (m === 0 && lineKey(D.tex) === lineKey(finalTex)) lines.push(D.tex);
        else lines.push(...kept.map((l) => underD(x, l, m)));
      }
      stages.push(lines);
      cur = canonToExpr(result);
    }
    const last = stages[stages.length - 1];
    const lines = stages.flat();
    // over the block's budget: the earlier stages' working lines go first
    while (lines.length > MAX_STEPS && lines.length > last.length) lines.splice(0, 1);
    return { steps: lines, result, finalTex };
  };

  // --- integrals ---------------------------------------------------------------------------

  interface IntegralWork {
    rewrite: string | null;
    rule: string;
    F: Canon;
    Fexpr: Expr;
    display: string;
    constant: string;
    /**
     * Where the antiderivative does not hold, for a definite integral to stay clear of: the
     * base (ax + b) of a negative power (a pole at its root) or of a fractional one (it must
     * stay >= 0, or > 0 when the power is negative too).
     */
    domain: Array<{ lin: { a: Q; b: Q }; pole: boolean; nonneg: boolean; strict: boolean }>;
  }

  const integralWork = (integrand: Expr, x: string): IntegralWork | null => {
    orderVar = x;
    const C = canon(integrand);
    const printed = printCanon(C, "integrand", x);
    const rewrite = lineKey(printed) !== lineKey(tex(integrand)) ? printed : null;
    const constant = symbolsOf(integrand).has("C") ? "K" : "C";
    const pieces: string[] = [];
    const vals: Expr[] = [];
    const domain: IntegralWork["domain"] = [];
    const restrict = (lin: { a: Q; b: Q }, k: Q) => {
      if (k.n < 0 || !qInt(k)) domain.push({ lin, pole: k.n < 0, nonneg: !qInt(k), strict: k.n < 0 });
    };
    const X = S(x);
    for (const t of C) {
      const xf = t.f.filter((f) => hasVar(f.base, x));
      const cf = t.f.filter((f) => !hasVar(f.base, x));
      const consts = cf.length ? termToExpr({ c: Q1, f: cf }) : null;
      let body: string;
      let unit: Expr;
      let sign = Q1;
      if (xf.length === 0) {
        body = x;
        unit = X;
      } else if (xf.length > 1) {
        return null;
      } else {
        const f = xf[0];
        const k = f.e;
        if (isVar(f.base, x)) {
          restrict({ a: Q1, b: Q0 }, k);
          if (qEq(k, QM1)) {
            body = `\\ln|${x}|`;
            unit = fn("ln", fn("abs", X));
          } else {
            const k1 = qAdd(k, Q1);
            body = `\\frac{${qOne(k1) ? x : `${x}^{${qLatex(k1)}}`}}{${qLatex(k1)}}`;
            unit = mul([N(qDiv(Q1, k1)), pow(X, N(k1))]);
          }
        } else if (f.base.t === "add") {
          const lin = linearOf(f.base, x);
          if (!lin) return null;
          restrict(lin, k);
          const baseTex = tex(f.base);
          if (qEq(k, QM1)) {
            body = joinProduct([qOne(lin.a) ? "" : qLatex(qDiv(Q1, lin.a)), `\\ln|${baseTex}|`]);
            unit = mul([N(qDiv(Q1, lin.a)), fn("ln", fn("abs", f.base))]);
          } else {
            const k1 = qAdd(k, Q1);
            const den = qOne(lin.a) ? qLatex(k1) : joinProduct([qLatex(k1), qLatex(lin.a).startsWith("-") ? `(${qLatex(lin.a)})` : qLatex(lin.a)]);
            body = `\\frac{(${baseTex})^{${qLatex(k1)}}}{${den}}`;
            unit = mul([N(qDiv(Q1, qMul(k1, lin.a))), pow(f.base, N(k1))]);
          }
        } else if (f.base.t === "fn" && (qOne(k) || (f.base.name === "sec" && qEq(k, q(2))))) {
          const g = f.base.arg;
          const lin = linearOf(g, x);
          if (!lin) return null;
          const over = (s: string) => (qOne(lin.a) ? s : `\\frac{${s}}{${qLatex(lin.a)}}`);
          const inv = N(qDiv(Q1, lin.a));
          switch (f.base.name) {
            case "exp":
              body = over(tex(f.base));
              unit = mul([inv, f.base]);
              break;
            case "sin":
              sign = QM1;
              body = over(tex(fn("cos", g)));
              unit = mul([N(qDiv(QM1, lin.a)), fn("cos", g)]);
              break;
            case "cos":
              body = over(tex(fn("sin", g)));
              unit = mul([inv, fn("sin", g)]);
              break;
            case "sec":
              if (!qEq(k, q(2))) return null;
              body = over(tex(fn("tan", g)));
              unit = mul([inv, fn("tan", g)]);
              break;
            default:
              return null;
          }
        } else if (f.base.t === "pow" && qOne(k) && !hasVar(f.base.base, x)) {
          const bq = rationalValue(f.base.base);
          const lin = linearOf(f.base.exp, x);
          if (!bq || bq.n <= 0 || qOne(bq) || !lin) return null;
          const lnB = texFn("ln", f.base.base);
          body = `\\frac{${tex(f.base)}}{${joinProduct([qOne(lin.a) ? "" : qLatex(lin.a), lnB])}}`;
          unit = mul([N(qDiv(Q1, lin.a)), f.base, pow(fn("ln", f.base.base), I(-1))]);
        } else {
          return null;
        }
      }
      const K = qMul(t.c, sign);
      const coef = consts ? tex(mul([N(K), consts])) : qOne(K) ? "" : qEq(K, QM1) ? "-" : qLatex(K);
      pieces.push(!coef ? body : coef === "-" ? `-${body}` : joinProduct([coef, body]));
      vals.push(mul([N(t.c), ...(consts ? [consts] : []), unit]));
    }
    if (!pieces.length) {
      pieces.push("0");
    }
    const F = canon(add(vals));
    const Fexpr = canonToExpr(F);
    // differentiate back: F' must be the integrand
    if (!derivativeAgrees(Fexpr, integrand, x)) return null;
    const rule = pieces.reduce((acc, p) => joinTwo(acc, p, "+"));
    return { rewrite, rule, F, Fexpr, display: printCanon(F, "display", x), constant, domain };
  };

  /** A technique's antiderivative (`integration.ts`), when the term-by-term rules have none. */
  const techniqueFor = (integrand: Expr, x: string): IntegralTechnique | null => {
    if (!deps.integrate) return null;
    try {
      const constant = symbolsOf(integrand).has("C") ? "K" : "C";
      const t = deps.integrate(integrand, x, constant);
      orderVar = x;
      return t && derivativeAgrees(t.F, integrand, x) ? t : null;
    } catch {
      return null;
    }
  };

  /** The term-by-term rules, or null (never a throw) when they cannot integrate this. */
  const basicWork = (integrand: Expr, x: string): IntegralWork | null => {
    try {
      return integralWork(integrand, x);
    } catch {
      return null;
    }
  };

  const indefiniteSteps = (integrand: Expr, x: string): string[] | null => {
    const w = basicWork(integrand, x);
    if (!w) return techniqueFor(integrand, x)?.lines ?? null;
    const plusC = (s: string) => (s === "0" ? w.constant : `${s} + ${w.constant}`);
    const lines: string[] = [];
    if (w.rewrite) lines.push(`\\int ${hasTopLevelSum(w.rewrite) ? `(${w.rewrite})` : w.rewrite} \\, d${x}`);
    lines.push(plusC(w.rule), plusC(w.display));
    return lines;
  };

  /** A technique over [a, b], checked against Simpson like every definite integral here. */
  const definiteTechnique = (integrand: Expr, x: string, a: Ex, b: Ex): { steps: string[]; value: Ex } | null => {
    if (!deps.integrateDefinite) return null;
    try {
      const na = exNum(a);
      const nb = exNum(b);
      const [left, right] = na <= nb ? [na, nb] : [nb, na];
      const f = (v: number) => evalNum(integrand, { [x]: v });
      for (let i = 0; i <= 400; i++) {
        const y = f(left + ((right - left) * i) / 400);
        if (!Number.isFinite(y) || Math.abs(y) > 1e9) return null;
      }
      const t = deps.integrateDefinite(integrand, x, a, b);
      orderVar = x;
      if (!t || !close(simpson(f, na, nb), exNum(t.value), 1e-4)) return null;
      return { steps: t.lines, value: t.value };
    } catch {
      return null;
    }
  };

  const definiteSteps = (integrand: Expr, x: string, lo: MathNode, hi: MathNode): { steps: string[]; value: Ex } | null => {
    const a = targetOf(lo);
    const b = targetOf(hi);
    if (a.kind !== "finite" || b.kind !== "finite") return null;
    const w = basicWork(integrand, x);
    if (!w) return definiteTechnique(integrand, x, a.v, b.v);
    const na = exNum(a.v);
    const nb = exNum(b.v);
    const [left, right] = na <= nb ? [na, nb] : [nb, na];
    // the antiderivative must hold on the whole interval: no pole, no root of a negative
    for (const r of w.domain) {
      const base = (v: number) => qVal(r.lin.a) * v + qVal(r.lin.b);
      const root = -qVal(r.lin.b) / qVal(r.lin.a);
      if (r.pole && root >= left && root <= right) return null;
      // a linear base is monotonic: its ends are its extremes
      const lowest = Math.min(base(left), base(right));
      if (r.nonneg && (lowest < 0 || (r.strict && lowest <= 0))) return null;
    }
    const f = (v: number) => evalNum(integrand, { [x]: v });
    for (let i = 0; i <= 400; i++) {
      const y = f(left + ((right - left) * i) / 400);
      if (!Number.isFinite(y) || Math.abs(y) > 1e9) return null;
    }
    const Fb = evalExact(w.Fexpr, new Map([[x, b.v]]));
    const Fa = evalExact(w.Fexpr, new Map([[x, a.v]]));
    const value = exSub(Fb, Fa);
    const numeric = simpson(f, na, nb);
    if (!close(numeric, exNum(value), 1e-4)) return null;
    const loTex = exTex(a.v);
    const hiTex = exTex(b.v);
    const lines: string[] = [];
    if (w.rewrite) lines.push(`\\int_{${loTex}}^{${hiTex}} ${hasTopLevelSum(w.rewrite) ? `(${w.rewrite})` : w.rewrite} \\, d${x}`);
    lines.push(`\\left[${w.display}\\right]_{${loTex}}^{${hiTex}}`);
    const bTex = exTex(Fb);
    const aTex = exTex(Fa);
    lines.push(`${exIsSum(Fb) ? `(${bTex})` : bTex} - ${exIsSum(Fa) || exNum(Fa) < 0 ? `(${aTex})` : aTex}`);
    lines.push(exTex(value, true));
    return { steps: lines, value };
  };

  // --- limits ------------------------------------------------------------------------------

  const limitNear = (operand: Expr, x: string, t: Target, L: LimitValue): boolean => {
    const f = (v: number) => evalNum(operand, { [x]: v });
    if (t.kind === "inf") {
      const y1 = f(t.sign * 1e4);
      const y2 = f(t.sign * 1e6);
      if (L.kind === "inf") return Number.isFinite(y2) && Math.sign(y2) === L.sign && Math.abs(y2) > Math.abs(y1);
      return Number.isFinite(y2) && close(y2, exNum(L.v), 1e-3);
    }
    if (L.kind === "inf") return false;
    const a = exNum(t.v);
    const h = 1e-6 * Math.max(1, Math.abs(a));
    const ys = [f(a - h), f(a + h)].filter(Number.isFinite);
    return ys.length > 0 && ys.every((y) => close(y, exNum(L.v), 1e-3));
  };

  /** `\lim_{x \to 0} \frac{\sin(3x)}{x}`, `\frac{1 - \cos x}{x}`, `\frac{x}{\sin x}`, `\frac{\tan x}{x}` */
  const standardLimit = (operand: Expr, x: string, prefix: string): { steps: string[]; value: Ex } | null => {
    const A = canon(operand);
    const find = (t: Term, name: string, e: Q) => t.f.find((f) => f.base.t === "fn" && f.base.name === name && qEq(f.e, e));
    const xPow = (t: Term, e: Q) => t.f.find((f) => isVar(f.base, x) && qEq(f.e, e));
    const kOf = (f: Factor | undefined): Q | null => {
      if (!f || f.base.t !== "fn") return null;
      const lin = linearOf(f.base.arg, x);
      return lin && qZero(lin.b) ? lin.a : null;
    };
    if (A.length === 1 && A[0].f.length === 2) {
      const t = A[0];
      const s = find(t, "sin", Q1) ?? find(t, "tan", Q1);
      const k = kOf(s);
      if (s && k && xPow(t, QM1)) {
        const value = qMul(t.c, k);
        const arg = (s.base as { arg: Expr }).arg;
        if (qOne(value)) return { steps: ["1"], value: exQ(Q1) };
        const shape = `\\frac{${tex(fn((s.base as { name: Fn }).name, arg))}}{${tex(arg)}}`;
        const lead = qOne(value) ? "" : `${qLatex(value)} \\cdot `;
        return { steps: [`${prefix} ${lead}${shape}`, `${qLatex(value)} \\cdot 1`, qLatex(value)], value: exQ(value) };
      }
      const sInv = find(t, "sin", QM1) ?? find(t, "tan", QM1);
      const kInv = kOf(sInv);
      if (sInv && kInv && xPow(t, Q1)) {
        const value = qDiv(t.c, kInv);
        return { steps: [qLatex(value)], value: exQ(value) };
      }
    }
    if (A.length === 2) {
      // (1 - cos kx)/x → 0
      const [p, r] = A;
      const cosTerm = [p, r].find((t) => t.f.length === 2 && find(t, "cos", Q1) && xPow(t, QM1));
      const plain = [p, r].find((t) => t.f.length === 1 && xPow(t, QM1));
      if (cosTerm && plain && qEq(cosTerm.c, qNeg(plain.c)) && kOf(find(cosTerm, "cos", Q1))) return { steps: ["0"], value: exQ(Q0) };
    }
    return null;
  };

  /** N/D as polynomials when the operand is a fraction of polynomials (or a polynomial). */
  const ratioOf = (e: Expr, x: string): { N: Poly; D: Poly } | null => {
    let sign = Q1;
    let body = e;
    if (body.t === "neg") {
      sign = QM1;
      body = body.arg;
    }
    if (body.t === "div") {
      const n = polyOf(body.num, x);
      const d = polyOf(body.den, x);
      if (!n || !d || d.length === 0) return null;
      return { N: pScale(n, sign), D: d };
    }
    const p = polyOf(e, x);
    return p ? { N: p, D: [Q1] } : null;
  };

  /** Qp · f^k as a student writes a factorised polynomial: `(x - 2)(x + 2)`, `x(x - 2)`, `2(x - 2)`. */
  const factorPoly = (Qp: Poly, f: Poly, k: number, x: string): string => {
    const fIsX = f.length === 2 && qZero(f[0]) && qOne(f[1]);
    const fTex = pTex(f, x);
    const grouped = fIsX ? (k === 1 ? x : `${x}^{${k}}`) : k === 1 ? `(${fTex})` : `(${fTex})^{${k}}`;
    const negLead = Qp[Qp.length - 1].n < 0;
    const Qn = negLead ? pScale(Qp, QM1) : Qp;
    const sign = negLead ? "-" : "";
    const isMono = Qn.slice(0, -1).every(qZero);
    if (Qn.length === 1 && qOne(Qn[0])) return sign ? `-${grouped}` : fIsX || k > 1 ? grouped : fTex;
    if (fIsX && isMono) {
      // x^j · x^k is one monomial
      const prod: Poly = new Array<Q>(Qn.length + k).fill(Q0);
      prod[Qn.length - 1 + k] = Qn[Qn.length - 1];
      return sign + pTex(prod, x);
    }
    if (isMono) return sign + joinProduct([pTex(Qn, x), grouped]);
    return sign + joinProduct([grouped, `(${pTex(Qn, x)})`]);
  };

  const finiteLimit = (operand: Expr, x: string, t: { kind: "finite"; v: Ex }, prefix: string): { steps: string[]; value: LimitValue } | null => {
    if (exIsRational(t.v) && qZero(t.v.r)) {
      const std = standardLimit(operand, x, prefix);
      if (std) return { steps: std.steps, value: { kind: "finite", v: std.value } };
    }
    try {
      const v = evalExact(operand, new Map([[x, t.v]]));
      const substituted = tex(substitute(operand, x, exLit(t.v)));
      return { steps: [substituted, exTex(v, true)], value: { kind: "finite", v } };
    } catch (e) {
      if (!(e instanceof ZeroDivision)) return null;
    }
    const factored = rationalLimit(operand, x, t, prefix);
    if (factored || !deps.limit) return factored;
    // 0/0 that needs the conjugate or a known limit (`limits.ts`)
    try {
      const tech = deps.limit(operand, x, t.v, prefix);
      orderVar = x;
      return tech ? { steps: tech.lines, value: { kind: "finite", v: tech.value } } : null;
    } catch {
      return null;
    }
  };

  /** 0/0 in a rational function: factor, cancel, substitute. */
  const rationalLimit = (operand: Expr, x: string, t: { kind: "finite"; v: Ex }, prefix: string): { steps: string[]; value: LimitValue } | null => {
    if (!exIsRational(t.v)) return null;
    const a = t.v.r;
    const r = ratioOf(operand, x);
    if (!r) return null;
    if (!qZero(pEval(r.D, a))) return null;
    if (!qZero(pEval(r.N, a))) return null; // a non-zero number over zero: no finite limit
    let Nk = r.N;
    let Dk = r.D;
    let k = 0;
    while (Nk.length > 1 && Dk.length > 1 && qZero(pEval(Nk, a)) && qZero(pEval(Dk, a)) && k < 12) {
      Nk = pDivRoot(Nk, a);
      Dk = pDivRoot(Dk, a);
      k++;
    }
    const dv = pEval(Dk, a);
    if (qZero(dv)) return null;
    const value = qDiv(pEval(Nk, a), dv);
    // the factor a student writes: (x - 2), x, (2x - 1)
    const f: Poly = [qNeg(q(a.n)), q(a.d)];
    const scaleK = qPowInt(q(a.d), k); // (x - p/q)^k = (qx - p)^k / q^k
    const Nq = pScale(Nk, qDiv(Q1, scaleK));
    const Dq = pScale(Dk, qDiv(Q1, scaleK));
    const factored = `\\frac{${factorPoly(Nq, f, k, x)}}{${factorPoly(Dq, f, k, x)}}`;
    // x^2 over x: nothing to factor, the cancelling is the whole step
    const simpleShapes = qZero(a) && r.N.slice(0, -1).every(qZero) && r.D.slice(0, -1).every(qZero);
    let cancelled: string;
    if (Dq.length === 1) {
      const pt = pTex(pScale(Nq, qDiv(Q1, Dq[0])), x);
      cancelled = hasTopLevelSum(pt) ? `(${pt})` : pt;
    } else cancelled = `\\frac{${pTex(Nq, x)}}{${pTex(Dq, x)}}`;
    const steps = [...(simpleShapes ? [] : [`${prefix} ${factored}`]), `${prefix} ${cancelled}`, qLatex(value)];
    return { steps, value: { kind: "finite", v: exQ(value) } };
  };

  const infiniteLimit = (operand: Expr, x: string, sign: 1 | -1, prefix: string): { steps: string[]; value: LimitValue } | null => {
    const r = ratioOf(operand, x);
    if (!r) return null;
    const { N: Np, D: Dp } = r;
    if (Np.length === 0) return { steps: ["0"], value: { kind: "finite", v: exQ(Q0) } };
    const dN = Np.length - 1;
    const dD = Dp.length - 1;
    const leadRatio = qDiv(Np[dN], Dp[dD]);
    const infSign = (Math.sign(leadRatio.n) * (sign < 0 && (dN - dD) % 2 !== 0 ? -1 : 1)) as 1 | -1;
    const infTex = infSign > 0 ? "\\infty" : "-\\infty";
    /** p's terms divided by x^m, highest power first */
    const divided = (p: Poly, m: number): Term[] => {
      const out: Term[] = [];
      for (let k = p.length - 1; k >= 0; k--) {
        if (qZero(p[k])) continue;
        const j = k - m;
        out.push({ c: p[k], f: j === 0 ? [] : [factorOf(S(x), q(j))] });
      }
      return out;
    };
    if (dD === 0) {
      const P = pScale(Np, qDiv(Q1, Dp[0]));
      if (dN === 0) return { steps: [qLatex(P[0])], value: { kind: "finite", v: exQ(P[0]) } };
      const nonzero = P.filter((c) => !qZero(c)).length;
      if (nonzero === 1) return { steps: [infTex], value: { kind: "inf", sign: infSign } };
      const inner = printCanon(divided(P, dN), "display", x);
      const xp = dN === 1 ? x : `${x}^{${dN}}`;
      return { steps: [`${prefix} ${xp}(${inner})`, infTex], value: { kind: "inf", sign: infSign } };
    }
    const nTerms = divided(Np, dD);
    const dTerms = divided(Dp, dD);
    // dividing by x^{dD} leaves 1 below the bar when the denominator was x^{dD} itself
    const denIsOne = dTerms.length === 1 && dTerms[0].f.length === 0 && qOne(dTerms[0].c);
    const nTex = printCanon(nTerms, "display", x);
    const dTex = printCanon(dTerms, "display", x);
    const first = `${prefix} ${denIsOne ? (hasTopLevelSum(nTex) ? `(${nTex})` : nTex) : `\\frac{${nTex}}{${dTex}}`}`;
    if (dN > dD) return { steps: [first, infTex], value: { kind: "inf", sign: infSign } };
    const zeroed = (ts: Term[]) => joinSigned(ts.map((t) => ({ neg: t.c.n < 0, body: t.f.length ? "0" : qLatex(qAbs(t.c)) })));
    const subst = denIsOne ? zeroed(nTerms) : `\\frac{${zeroed(nTerms)}}{${zeroed(dTerms)}}`;
    const value = dN === dD ? leadRatio : Q0;
    return { steps: [first, subst, qLatex(value)], value: { kind: "finite", v: exQ(value) } };
  };

  const limitWork = (operand: Expr, x: string, t: Target): { steps: string[]; value: LimitValue } | null => {
    orderVar = x;
    const prefix = `\\lim_{${x} \\to ${targetTex(t)}}`;
    const out = t.kind === "inf" ? infiniteLimit(operand, x, t.sign, prefix) : finiteLimit(operand, x, t, prefix);
    if (!out || !limitNear(operand, x, t, out.value)) return null;
    return out;
  };

  // --- dispatch ----------------------------------------------------------------------------

  interface Call {
    name: "derivative" | "antiderivative" | "integral" | "limit";
    node: AnyNode;
  }

  const callOf = (source: string): Call | null => {
    let node: AnyNode;
    try {
      node = math.parse(source) as AnyNode;
    } catch {
      return null;
    }
    while (node.type === "ParenthesisNode" && node.content) node = node.content as AnyNode;
    if (node.type !== "FunctionNode") return null;
    const name = typeof node.fn === "string" ? node.fn : (node.fn?.name ?? "");
    if (name === "derivative" || name === "antiderivative" || name === "integral" || name === "limit") return { name, node };
    return null;
  };

  /** Steps for one calculus call; the last line is the answer. A line that only restates the question is dropped. */
  const stepsForCall = (call: Call): string[] | null => {
    const raw = rawStepsForCall(call);
    if (!raw) return null;
    const question = questionTex(call);
    return question ? raw.filter((line) => lineKey(line) !== lineKey(question)) : raw;
  };

  /** The question in the engine's own notation (`\lim_{x \to 2} \frac{x^{2} - 4}{x - 2}`). */
  const questionTex = (call: Call): string | null => {
    try {
      const args = call.node.args ?? [];
      if (call.name === "limit") return `\\lim_{${stringArg(args[1])} \\to ${targetTex(targetOf(args[2]))}} ${tex(parseExpr(stringArg(args[0])))}`;
      if (call.name === "antiderivative") return `\\int ${tex(parseExpr(stringArg(args[0])))} \\, d${stringArg(args[1])}`;
      return null;
    } catch {
      return null;
    }
  };

  const rawStepsForCall = (call: Call): string[] | null => {
    const args = call.node.args ?? [];
    switch (call.name) {
      case "derivative": {
        let order = 0;
        let node: AnyNode = call.node;
        let x = "";
        while (node.type === "FunctionNode" && ((node.fn as { name?: string })?.name ?? "") === "derivative") {
          const a = node.args ?? [];
          const v = stringArg(a[1]);
          if (x && v !== x) return null;
          x = v;
          order++;
          node = a[0] as AnyNode;
        }
        if (order > 4) return null;
        const operand = parseExpr(stringArg(node));
        const w = derivativeWork(operand, x, order);
        return w ? w.steps : null;
      }
      case "antiderivative":
        return indefiniteSteps(parseExpr(stringArg(args[0])), stringArg(args[1]));
      case "integral": {
        const r = definiteSteps(parseExpr(stringArg(args[0])), stringArg(args[1]), args[2], args[3]);
        return r ? r.steps : null;
      }
      case "limit": {
        const x = stringArg(args[1]);
        const r = limitWork(parseExpr(stringArg(args[0])), x, targetOf(args[2]));
        return r ? r.steps : null;
      }
    }
  };

  const stepsForSource = (source: string): string[] | null => {
    const cached = cache.get(source);
    if (cached !== undefined) return cached;
    let out: string[] | null = null;
    try {
      const call = callOf(source);
      out = call ? stepsForCall(call) : null;
    } catch {
      out = null;
    }
    if (cache.size > 256) cache.clear();
    cache.set(source, out);
    return out;
  };

  const translateLine = (latex: string): string | null => {
    try {
      return deps.translate(latex).source;
    } catch {
      return null;
    }
  };

  const steps = (latex: string): string[] | null => {
    const pre = stripEquals(latex);
    if (!pre || !/\\(?:lim|int|frac|dfrac)/.test(pre)) return null;
    if (splitRelations(pre).ops.length > 0) return null;
    const source = translateLine(pre);
    if (!source) return null;
    const raw = stepsForSource(source);
    if (!raw) return null;
    const tidy = tidySteps(raw, pre);
    return tidy.length ? tidy : null;
  };

  // --- f'(x), dy/dx and f'(2) against a definition above ----------------------------------------

  interface Question {
    name: string;
    order: number;
    /** the variable when written (`\frac{dy}{dx}`, `f'(x)`) */
    variable: string | null;
    /** `f'(2)`: the point, as LaTeX */
    point: string | null;
  }

  const questionOf = (pre: string): Question | null => {
    const l = LEIBNIZ_Q.exec(pre);
    if (l) {
      const top = Number(l[1] ?? 1);
      const bottom = Number(l[4] ?? 1);
      if (top !== bottom) return null;
      return { name: l[2], order: top, variable: l[3], point: null };
    }
    const p = PRIME_Q.exec(pre);
    if (p) {
      const marks = p[2];
      const order = marks.includes("prime") ? (marks.match(/\\prime/g) ?? []).length : marks.length;
      const arg = (p[3] ?? "").trim();
      if (!arg) return { name: p[1], order, variable: null, point: null };
      if (/^[a-zA-Z]$/.test(arg)) return { name: p[1], order, variable: arg, point: null };
      return { name: p[1], order, variable: null, point: arg };
    }
    return null;
  };

  const definitionFor = (lines: readonly string[], q0: Question): { rhs: string; x: string } | null => {
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = DEFINITION.exec(stripEquals(lines[i]));
      if (!m || m[1] !== q0.name) continue;
      const rhs = m[3].trim();
      const x = m[2] ?? q0.variable ?? "x";
      if (q0.variable && x !== q0.variable) continue;
      if (!usesSymbol(rhs, x)) continue;
      return { rhs, x };
    }
    return null;
  };

  /**
   * `x^{2} + y^{2} = 25`, then `\frac{dy}{dx}`: both sides differentiated with y a function of x
   * (H = L - R: H_x + H_y y' = 0), y' collected, then alone.
   */
  const implicitFor = (lines: readonly string[], q0: Question, pre: string): { latex: string; steps: string[] } | null => {
    if (q0.order !== 1 || q0.point) return null;
    const y = q0.name;
    const x = q0.variable ?? "x";
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = stripEquals(lines[i]);
      const split = splitRelations(line);
      if (split.ops.length !== 1 || split.ops[0] !== "==") continue;
      try {
        const [lSrc, rSrc] = split.sides.map(translateLine);
        if (!lSrc || !rSrc) continue;
        const H = add([parseExpr(lSrc), neg(parseExpr(rSrc))]);
        const names = symbolsOf(H);
        if (!names.has(x) || !names.has(y) || names.size !== 2) continue;
        orderVar = x;
        const Hx = canon(makeDiff(x)(H).val);
        const Hy = canon(makeDiff(y)(H).val);
        if (Hy.length === 0 || !derivativeAgrees(H, canonToExpr(Hx), x) || !derivativeAgrees(H, canonToExpr(Hy), y)) continue;
        const dydx = `\\frac{d${y}}{d${x}}`;
        const hyTex = printCanon(Hy, "display", x);
        const hy = hyTex === "1" ? "" : hasTopLevelSum(hyTex) ? `(${hyTex})` : hyTex;
        const withY = `${hy}${dydx}`;
        const hxTex = printCanon(Hx, "display", x);
        const minusHx = printCanon(scaleCanon(Hx, QM1), "display", x);
        // one fraction: -H_x over H_y, cancelled when that leaves one term (`-\\frac{x}{y}`)
        const cancelled = printCanon(canon(div(neg(canonToExpr(Hx)), canonToExpr(Hy))), "display", x);
        const answer = hasTopLevelSum(cancelled) && !cancelled.startsWith("\\frac") ? fracTex(minusHx, hyTex) : cancelled;
        const out = [
          Hx.length === 0 ? `${withY} = 0` : joinTwo(hxTex, withY, "+") + " = 0",
          `${withY} = ${minusHx}`,
          `${dydx} = ${answer}`,
        ];
        const steps = out.filter((l, k) => k === 0 || lineKey(l) !== lineKey(out[k - 1]));
        return { latex: `${pre} = ${answer}`, steps };
      } catch {
        continue;
      }
    }
    return null;
  };

  const fromLines = (lines: readonly string[]): { latex: string; steps: string[] } | null | undefined => {
    if (!lines.length) return undefined;
    const pre = stripEquals(lines[lines.length - 1]);
    if (!pre || splitRelations(pre).ops.length > 0) return undefined;
    const question = questionOf(pre);
    if (question) {
      const def = definitionFor(lines.slice(0, -1), question);
      // no `y = …` above, but a relation in x and y: implicit differentiation
      if (!def) return implicitFor(lines.slice(0, -1), question, pre);
      if (question.order < 1 || question.order > 4) return null;
      try {
        const source = translateLine(def.rhs);
        if (!source) return null;
        const w = derivativeWork(parseExpr(source), def.x, question.order);
        if (!w) return null;
        const derivSteps = tidySteps(w.steps, `\\frac{d}{d${def.x}}(${def.rhs})`);
        if (!question.point) {
          // `y = x^{x}` is the student's own line above: not written again
          const drawn = derivSteps.filter((st) => !lines.some((l) => lineKey(stripEquals(l)) === lineKey(st))).map(continueLine);
          return { latex: `${pre} = ${w.finalTex}`, steps: drawn };
        }
        // f'(2): the derivative first, then the value at the point (not through y = …, logarithms)
        if (derivSteps.some(isRelationLine)) return null;
        const pointSource = translateLine(question.point);
        if (!pointSource) return null;
        const pointExpr = parseExpr(pointSource);
        if (symbolsOf(pointExpr).size > 0) return null;
        const at = evalExact(pointExpr, new Map());
        const fx = canonToExpr(w.result);
        const value = evalExact(fx, new Map([[def.x, at]]));
        const primes = "'".repeat(question.order);
        const head = `${question.name}${primes}(${def.x})`;
        const headAt = `${question.name}${primes}(${exTex(at)})`;
        const derivative = [`${head} = ${derivSteps[0]}`, ...derivSteps.slice(1).map((s) => `= ${s}`)];
        const substituted = tex(substitute(fx, def.x, exLit(at)));
        const valueTex = exTex(value, true);
        const tail = lineKey(substituted) === lineKey(valueTex) ? [`${headAt} = ${valueTex}`] : [`${headAt} = ${substituted}`, `= ${valueTex}`];
        while (derivative.length + tail.length > MAX_STEPS && derivative.length > 1) derivative.splice(0, 1);
        derivative[0] = derivative[0].startsWith("=") ? `${head} ${derivative[0]}` : derivative[0];
        return { latex: `${headAt} = ${valueTex}`, steps: [...derivative, ...tail] };
      } catch {
        return null;
      }
    }
    if (!CALCULUS_LINE.test(pre)) return undefined;
    const own = steps(pre);
    if (!own) return null;
    return { latex: `${pre} = ${own[own.length - 1]}`, steps: own.map(continueLine) };
  };

  const resultLatex = (source: string): string | null => {
    const s = stepsForSource(source);
    return s && s.length ? s[s.length - 1] : null;
  };

  // --- checking a student's antiderivative ------------------------------------------------------

  const claimVerdict = (sources: readonly string[], ops: readonly string[]): "ok" | "mismatch" | "unknown" | null => {
    if (sources.length !== 2 || ops.length !== 1 || ops[0] !== "==") return null;
    const calls = sources.map(callOf);
    const i = calls.findIndex((c) => c?.name === "antiderivative");
    if (i < 0) return null;
    const other = sources[1 - i];
    if (/\b(?:antiderivative|integral|derivative|limit)\(/.test(other)) return null;
    try {
      const args = calls[i]!.node.args ?? [];
      const x = stringArg(args[1]);
      const integrand = parseExpr(stringArg(args[0]));
      const claimed = parseExpr(other);
      const own = symbolsOf(integrand);
      const constants = [...symbolsOf(claimed)].filter((s) => s !== x && !own.has(s));
      // an antiderivative without its constant is not the whole answer
      if (constants.length === 0) return "mismatch";
      return derivativeAgrees(claimed, integrand, x) ? "ok" : "mismatch";
    } catch {
      return "unknown";
    }
  };

  // --- mathjs functions: what `latex.ts` translates `\lim`, `\int ... dx` and `[F]_a^b` into ------

  const limitValue = (expr: string, x: string, point: number): number => {
    const t: Target = point === Infinity ? { kind: "inf", sign: 1 } : point === -Infinity ? { kind: "inf", sign: -1 } : { kind: "finite", v: exactFromNumber(point) ?? fail() };
    const r = limitWork(parseExpr(expr), x, t);
    if (!r) throw new Error("the engine cannot find this limit");
    return r.value.kind === "inf" ? r.value.sign * Infinity : exNum(r.value.v);
  };

  math.import(
    {
      limit: (expr: string, x: string, point: number) => {
        try {
          return limitValue(expr, x, point);
        } catch {
          throw new Error("the engine cannot find this limit");
        }
      },
      antiderivative: (expr: string, x: string) => {
        let w: { Fexpr: Expr; constant: string } | null = null;
        try {
          const integrand = parseExpr(expr);
          w = basicWork(integrand, x);
          if (!w) {
            const t = techniqueFor(integrand, x);
            if (t) w = { Fexpr: t.F, constant: symbolsOf(integrand).has("C") ? "K" : "C" };
          }
        } catch {
          w = null;
        }
        if (!w) throw new Error("the engine cannot integrate this");
        return math.parse(`${toMathjs(w.Fexpr)} + ${w.constant}`);
      },
      bracketEval: (expr: string, x: string, lo: number, hi: number) => {
        const f = math.compile(expr);
        const at = (v: number) => {
          const y = f.evaluate({ [x]: v }) as unknown;
          if (typeof y !== "number" || !Number.isFinite(y)) throw new Error("cannot evaluate");
          return y;
        };
        return at(hi) - at(lo);
      },
    },
    { override: true },
  );

  const basicIntegral = (integrand: Expr, x: string): BasicIntegral | null => {
    const w = basicWork(integrand, x);
    return w ? { rewrite: w.rewrite, rule: w.rule, display: w.display, F: w.Fexpr } : null;
  };

  return { steps, fromLines, resultLatex, claimVerdict, basicIntegral };
}

/** Expr → mathjs source (fully bracketed). */
function toMathjs(e: Expr): string {
  switch (e.t) {
    case "num":
      return e.q.d === 1 ? `(${e.q.n})` : `(${e.q.n} / ${e.q.d})`;
    case "sym":
      return e.name;
    case "lit":
      return fail();
    case "add":
      return `(${e.args.map(toMathjs).join(" + ")})`;
    case "mul":
      return `(${e.args.map(toMathjs).join(" * ")})`;
    case "div":
      return `(${toMathjs(e.num)} / ${toMathjs(e.den)})`;
    case "pow":
      return `(${toMathjs(e.base)} ^ ${toMathjs(e.exp)})`;
    case "neg":
      return `(-${toMathjs(e.arg)})`;
    case "sqrt":
      return `sqrt(${toMathjs(e.arg)})`;
    case "fn": {
      const name = e.name === "ln" ? "log" : e.name;
      return `${name}(${toMathjs(e.arg)})`;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Shared with the modules that extend this one: `trig.ts` (exact values, identities, equations),
// `integration.ts` (substitution, parts, identities, partial fractions) and `limits.ts`. They
// build on the same expression tree, printer, exact values and numerical checks, so a line they
// write looks like a line written here, and is checked the same way.
// ---------------------------------------------------------------------------------------------

/** Sets the variable factors are ordered around (`2\pi x`, `x e^{x}`) when a Canon is printed. */
export function setOrderVar(x: string): void {
  orderVar = x;
}

export type { AnyNode, Atom, Canon, DRes, Expr, Ex, Factor, Fn, Mode, Poly, Q, Term };
export {
  add,
  atomBody,
  BARE_FN_END,
  canon,
  canonRational,
  canonToExpr,
  chainFactor,
  close,
  combine,
  D0,
  derivativeAgrees,
  div,
  evalExact,
  evalNum,
  exactFromNumber,
  exAdd,
  exAtom,
  exFn,
  exInv,
  exIsRational,
  exIsSum,
  exLit,
  exMul,
  exNeg,
  exNum,
  exPowQ,
  exQ,
  exScale,
  exSqrtQ,
  exSub,
  exTex,
  factorOf,
  fail,
  fn,
  fnArg,
  fracTex,
  fromNode,
  hasTopLevelSum,
  hasVar,
  I,
  invCanon,
  isNegTerm,
  isVar,
  joinProduct,
  joinSigned,
  joinTwo,
  lineKey,
  linearOf,
  makeDiff,
  MAX_STEPS,
  monomial,
  mul,
  mulCanon,
  N,
  neg,
  negTex,
  NotCalculus,
  paramScope,
  pDivRoot,
  pEval,
  piAtom,
  polyCanon,
  polyOf,
  pow,
  powCanon,
  powMerge,
  printCanon,
  pScale,
  pTex,
  q,
  Q0,
  Q1,
  qAbs,
  qAdd,
  qDiv,
  qEq,
  QHALF,
  qInt,
  qLatex,
  QM1,
  qMul,
  qNeg,
  qOne,
  qPowInt,
  qRoot,
  qSub,
  qVal,
  qZero,
  rationalValue,
  S,
  SAMPLES,
  scaleCanon,
  simpson,
  sin12,
  sqrtAtom,
  substitute,
  symbolsOf,
  symTex,
  termToExpr,
  tex,
  texFactor,
  texFn,
  tidySteps,
  toMathjs,
  trimPoly,
  ZeroDivision,
};
