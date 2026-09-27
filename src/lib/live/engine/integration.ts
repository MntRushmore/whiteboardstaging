/**
 * Integration techniques, with the working a teacher writes: what `calculus.ts`'s term-by-term
 * rules cannot integrate comes here, and every answer is checked there by differentiating it back
 * (a definite one against Simpson) before a line of it is shown.
 *
 *   substitution                      parts                                  an identity
 *   \int 2x(x^{2} + 1)^{5} \, dx      \int x e^{x} \, dx                     \int \sin^{2} x \, dx
 *   u = x^{2} + 1                     \int u \, dv = uv - \int v \, du      = \int \frac{1 - \cos(2x)}{2} \, dx
 *   du = 2x \, dx                     u = x, \ dv = e^{x} \, dx              = \frac{x}{2} - \frac{\sin(2x)}{4} + C
 *   = \int u^{5} \, du                du = dx, \ v = e^{x}
 *   = \frac{u^{6}}{6} + C             = xe^{x} - \int e^{x} \, dx
 *   = \frac{(x^{2} + 1)^{6}}{6} + C   = xe^{x} - e^{x} + C
 *
 *   a standard form                   partial fractions
 *   \int \frac{1}{x^{2} + 4} \, dx    \int \frac{1}{x^{2} - 1} \, dx
 *   = \frac{1}{2}\tan^{-1}\frac{x}{2} + C    \frac{1}{(x - 1)(x + 1)} = \frac{A}{x - 1} + \frac{B}{x + 1}
 *                                     1 = A(x + 1) + B(x - 1)
 *                                     A = \frac{1}{2}, \ B = -\frac{1}{2}
 *                                     = \int \left(\frac{1}{2(x - 1)} - \frac{1}{2(x + 1)}\right) \, dx
 *                                     = \frac{1}{2}\ln|x - 1| - \frac{1}{2}\ln|x + 1| + C
 *
 * A relation (`u = x^{2} + 1`, `du = 2x \, dx`, `A = \frac{1}{2}`) stands on its own line; every
 * other line continues the question with `=` (`continueLine`). Definite integrals keep the
 * working and end with the evaluation bracket; a substitution changes the limits.
 */
import {
  add,
  canon,
  canonToExpr,
  close,
  derivativeAgrees,
  div,
  evalExact,
  evalNum,
  exIsSum,
  exNum,
  exSub,
  exTex,
  fn,
  hasTopLevelSum,
  hasVar,
  I,
  isVar,
  lineKey,
  linearOf,
  makeDiff,
  mul,
  N,
  neg,
  pEval,
  polyOf,
  pow,
  printCanon,
  q,
  Q0,
  Q1,
  qDiv,
  qEq,
  qInt,
  qLatex,
  qMul,
  qNeg,
  qOne,
  qRoot,
  qSub,
  qZero,
  S,
  setOrderVar,
  simpson,
  substitute,
  symbolsOf,
  tex,
  type BasicIntegral,
  type Canon,
  type DefiniteTechnique,
  type Ex,
  type Expr,
  type Factor,
  type IntegralTechnique,
  type Poly,
  type Q,
  type Term,
} from "./calculus";
import { isRelationLine, LIST_SEP } from "./solution";

export interface IntegrationDeps {
  /** `calculus.ts`'s term-by-term rules (the inner integral) */
  basic(integrand: Expr, x: string): BasicIntegral | null;
}

export interface Integration {
  integrate(integrand: Expr, x: string, constant: string): IntegralTechnique | null;
  integrateDefinite(integrand: Expr, x: string, a: Ex, b: Ex): DefiniteTechnique | null;
}

/** What a technique found: the lines, the antiderivative, and how its definite version is written. */
interface Plan {
  /** lines that stand alone: `u = …`, `du = …`, the parts, partial-fraction coefficients */
  asides: string[];
  /** the working that continues the question (`\int u^{5} \, du`, `xe^{x} - \int e^{x} \, dx`), without `+ C` */
  working: string[];
  F: Expr;
  /** the definite version's lines (limits changed, the bracket of uv, …) or null for the plain bracket */
  definite?: (a: Ex, b: Ex) => string[] | null;
}

const MAX_LINES = 8;

// ---------------------------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------------------------

const disp = (e: Expr, x: string): string => printCanon(canon(e), "display", x);
const plusC = (s: string, C: string): string => (s === "0" ? C : `${s} + ${C}`);

/** `\int u^{5} \, du`, `\int (x - 1) \, dx`, `\int_{1}^{2} u^{5} \, du`. */
function intTex(body: string, v: string, limits?: { lo: string; hi: string }): string {
  const lim = limits ? `_{${limits.lo}}^{${limits.hi}}` : "";
  const b = hasTopLevelSum(body) ? (body.startsWith("\\left(") ? body : `(${body})`) : body;
  return `\\int${lim} ${b} \\, d${v}`;
}

/** A coefficient in front of an integral: `\frac{1}{2}\int`, `-\int`, `3\int`. */
function coefTex(k: Q): string {
  if (qOne(k)) return "";
  if (qEq(k, q(-1))) return "-";
  return qLatex(k);
}

/** `du = 2x \, dx`; `du = dx`. */
function differential(v: string, body: string, x: string): string {
  return body === "1" ? `d${v} = d${x}` : `d${v} = ${body} \\, d${x}`;
}

/** `(e - e) - (0 - 1)`: F(b) - F(a) as the teacher writes the evaluation. */
function evaluation(Fb: Ex, Fa: Ex): string {
  const bTex = exTex(Fb);
  const aTex = exTex(Fa);
  return `${exIsSum(Fb) ? `(${bTex})` : bTex} - ${exIsSum(Fa) || exNum(Fa) < 0 ? `(${aTex})` : aTex}`;
}

/** The bracket, the evaluation, the value — or null when F is not exact at the limits. */
function bracketLines(Fshown: string, F: Expr, x: string, a: Ex, b: Ex, loTex: string, hiTex: string): { lines: string[]; value: Ex } | null {
  try {
    const Fb = evalExact(F, new Map([[x, b]]));
    const Fa = evalExact(F, new Map([[x, a]]));
    const value = exSub(Fb, Fa);
    return { lines: [`\\left[${Fshown}\\right]_{${loTex}}^{${hiTex}}`, evaluation(Fb, Fa), exTex(value, true)], value };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers on expressions
// ---------------------------------------------------------------------------------------------

/** The integrand as one product term (a substitution or parts works on a product), or null. */
function singleTerm(f: Expr): Term | null {
  const C = canon(f);
  return C.length === 1 ? C[0] : null;
}

const termExpr = (t: Term): Expr => canonToExpr([t]);

/** Every subtree printed like `g` replaced by the symbol u; null when x is still there after. */
function replaceInner(e: Expr, g: Expr, u: string, x: string): Expr | null {
  const key = tex(g);
  const walk = (n: Expr): Expr => {
    if (n.t !== "num" && n.t !== "lit" && tex(n) === key) return S(u);
    switch (n.t) {
      case "add":
        return { t: "add", args: n.args.map(walk) };
      case "mul":
        return { t: "mul", args: n.args.map(walk) };
      case "div":
        return div(walk(n.num), walk(n.den));
      case "pow":
        return pow(walk(n.base), walk(n.exp));
      case "neg":
        return { t: "neg", arg: walk(n.arg) };
      case "sqrt":
        return { t: "sqrt", arg: walk(n.arg) };
      case "fn":
        return fn(n.name, walk(n.arg));
      default:
        return n;
    }
  };
  const out = walk(e);
  return hasVar(out, x) ? null : out;
}

/** e^{a} · e^{b} as e^{a + b} (the canonical form keeps different exponents apart): e^{x} · e^{-x} = 1. */
function mergeExp(t: Term): Term {
  const exps = t.f.filter((f) => f.base.t === "fn" && f.base.name === "exp" && qOne(f.e));
  if (exps.length < 2) return t;
  const sum = canon(add(exps.map((f) => (f.base as { arg: Expr }).arg)));
  const rest = t.f.filter((f) => !exps.includes(f));
  if (sum.length === 0) return { c: t.c, f: rest };
  const merged = canon(mul([termExpr({ c: t.c, f: rest }), fn("exp", canonToExpr(sum))]));
  return merged.length === 1 ? merged[0] : t;
}

/** A fresh letter for the substitution: u, unless the line already has one. */
function freshLetter(f: Expr, x: string): string {
  const used = symbolsOf(f);
  for (const c of ["u", "t", "w", "z"]) if (c !== x && !used.has(c)) return c;
  return "u";
}

/** ln|g| → ln(g) where g is always positive (`x^{2} + 1`, `e^{x} + 1`): the teacher writes brackets. */
function positive(g: Expr, x: string): boolean {
  const p = polyOf(g, x);
  if (p && p.length === 3) {
    const [c, b, a] = p.map((v) => v.n / v.d);
    return a > 0 && b * b - 4 * a * c < 0;
  }
  if (g.t === "add") {
    return g.args.every((t) => {
      const r = canon(t);
      if (r.length !== 1) return false;
      const term = r[0];
      return term.c.n > 0 && term.f.every((f) => (f.base.t === "fn" && f.base.name === "exp") || (qInt(f.e) && f.e.n % 2 === 0));
    });
  }
  return false;
}

function dropBars(e: Expr, x: string): Expr {
  const walk = (n: Expr): Expr => {
    if (n.t === "fn" && n.name === "ln" && n.arg.t === "fn" && n.arg.name === "abs" && positive(n.arg.arg, x)) return fn("ln", n.arg.arg);
    switch (n.t) {
      case "add":
        return { t: "add", args: n.args.map(walk) };
      case "mul":
        return { t: "mul", args: n.args.map(walk) };
      case "div":
        return div(walk(n.num), walk(n.den));
      case "pow":
        return pow(walk(n.base), n.exp);
      case "neg":
        return { t: "neg", arg: walk(n.arg) };
      default:
        return n;
    }
  };
  return walk(e);
}

// ---------------------------------------------------------------------------------------------
// The techniques
// ---------------------------------------------------------------------------------------------

export function createIntegration(depsOf: () => IntegrationDeps): Integration {
  const basic = (f: Expr, x: string): BasicIntegral | null => {
    try {
      return depsOf().basic(f, x);
    } catch {
      return null;
    }
  };

  /** An antiderivative by the rules or a technique, for an inner integral (no lines). */
  const antiderivative = (f: Expr, x: string, depth: number): Expr | null => {
    const b = basic(f, x);
    if (b) return b.F;
    if (depth >= 2) return null;
    const p = plan(f, x, depth + 1);
    return p ? p.F : null;
  };

  // --- substitution -----------------------------------------------------------------------------

  /** The inner functions worth trying as u: a bracket, a function's argument, the function itself. */
  const candidates = (t: Term, x: string): Expr[] => {
    const out: Expr[] = [];
    const inner: Expr[] = [];
    const whole: Expr[] = [];
    for (const f of t.f) {
      const b = f.base;
      if (!hasVar(b, x)) continue;
      if (b.t === "add") inner.push(b);
      if (b.t === "fn") {
        if (!isVar(b.arg, x) && hasVar(b.arg, x)) inner.push(b.arg);
        if (b.name !== "exp" && b.name !== "abs") whole.push(b);
      }
      if (b.t === "pow" && !hasVar(b.base, x) && hasVar(b.exp, x)) inner.push(b.exp);
    }
    for (const g of [...inner, ...whole]) {
      if (linearOf(g, x) && g.t !== "fn") continue; // (2x + 1)^5: the reverse chain rule already does it
      if (!out.some((o) => tex(o) === tex(g))) out.push(g);
    }
    return out;
  };

  /** f / g' as one product term: g' a product divides out; g' a sum must be one of f's brackets (up to a number). */
  const divideByDerivative = (t: Term, gp: Canon, x: string): Term | null => {
    if (gp.length === 1) {
      const r = canon(mul([termExpr(t), pow(termExpr(gp[0]), I(-1))]));
      return r.length === 1 ? mergeExp(r[0]) : null;
    }
    const pg = polyOf(canonToExpr(gp), x);
    if (!pg) return null;
    for (let i = 0; i < t.f.length; i++) {
      const f = t.f[i];
      if (!qOne(f.e) || f.base.t !== "add") continue;
      const pb = polyOf(f.base, x);
      if (!pb || pb.length !== pg.length) continue;
      const k = qDiv(pg[pg.length - 1], pb[pb.length - 1]);
      if (pb.every((c, j) => qEq(qMul(c, k), pg[j]))) return { c: qDiv(t.c, k), f: t.f.filter((_, j) => j !== i) };
    }
    return null;
  };

  const substitution = (f: Expr, x: string): Plan | null => {
    const t = singleTerm(f);
    if (!t) return null;
    const u = freshLetter(f, x);
    const d = makeDiff(x);
    for (const g of candidates(t, x)) {
      let gp: Canon;
      try {
        gp = canon(d(g).val);
      } catch {
        continue;
      }
      if (gp.length === 0) continue;
      const ratio = divideByDerivative(t, gp, x);
      if (!ratio) continue;
      const h = replaceInner(termExpr(ratio), g, u, x);
      if (!h) continue;
      const inner = basic(h, u);
      if (!inner) continue;
      setOrderVar(u);
      const hc = canon(h);
      const k = hc.length === 1 ? hc[0].c : Q1;
      const h0 = hc.length === 1 ? termExpr({ c: Q1, f: hc[0].f }) : h;
      const Fu = inner.F;
      const F = dropBars(substitute(Fu, u, g), x);
      setOrderVar(u);
      // the rule line only when it shows a calculation (`\\frac{1}{2} \\cdot \\frac{u^{\\frac{3}{2}}}{\\frac{3}{2}}`)
      const ruleShown = /\\cdot|\\frac\{[^{}]*\}\{\\frac/.test(inner.rule) ? [inner.rule] : [];
      const innerLines = [`${coefTex(k)}${intTex(disp(h0, u), u)}`, ...ruleShown, disp(Fu, u)];
      setOrderVar(x);
      const gTex = disp(g, x);
      const gpTex = printCanon(gp, "display", x);
      const asides = [`${u} = ${gTex}`, differential(u, gpTex, x)];
      const definite = (a: Ex, b: Ex): string[] | null => {
        // the limits move with u: u(a), u(b)
        try {
          const ua = evalExact(g, new Map([[x, a]]));
          const ub = evalExact(g, new Map([[x, b]]));
          setOrderVar(u);
          const lim = { lo: exTex(ua), hi: exTex(ub) };
          const shown = disp(Fu, u);
          const br = bracketLines(shown, Fu, u, ua, ub, lim.lo, lim.hi);
          setOrderVar(x);
          if (!br) return null;
          return [...asides, `${coefTex(k)}${intTex(disp(h0, u), u, lim)}`, ...br.lines];
        } catch {
          return null;
        }
      };
      return { asides, working: innerLines, F, definite };
    }
    return null;
  };

  // --- integration by parts ---------------------------------------------------------------------

  const parts = (f: Expr, x: string, depth: number): Plan | null => {
    const t = singleTerm(f);
    if (!t) return null;
    const X = S(x);
    const xFactors = t.f.filter((g) => hasVar(g.base, x));
    const consts = t.f.filter((g) => !hasVar(g.base, x));
    const cExpr = termExpr({ c: t.c, f: consts });
    let u: Expr | null = null;
    let dv: Expr | null = null;
    const isLog = (g: Factor) => g.base.t === "fn" && (g.base.name === "ln" || g.base.name === "atan" || g.base.name === "asin") && qOne(g.e) && linearOf(g.base.arg, x) !== null;
    const isTrans = (g: Factor) => g.base.t === "fn" && ["exp", "sin", "cos"].includes(g.base.name) && qOne(g.e) && linearOf(g.base.arg, x) !== null;
    const isPower = (g: Factor) => isVar(g.base, x) && qInt(g.e) && g.e.n > 0;
    const log = xFactors.find(isLog);
    if (log && xFactors.every((g) => g === log || (isVar(g.base, x) && !qEq(g.e, q(-1))))) {
      // LIATE: the log (or inverse trig) is u, what is left is dv
      u = log.base;
      dv = mul([cExpr, ...xFactors.filter((g) => g !== log).map((g) => (qOne(g.e) ? g.base : pow(g.base, N(g.e))))]);
    } else if (xFactors.length === 2 && xFactors.some(isPower) && xFactors.some(isTrans)) {
      const p = xFactors.find(isPower)!;
      const tr = xFactors.find(isTrans)!;
      if (p.e.n > 2) return null;
      u = qOne(p.e) ? X : pow(X, N(p.e));
      dv = mul([cExpr, tr.base]);
    }
    if (!u || !dv) return null;
    const du = canonToExpr(canon(makeDiff(x)(u).val));
    const vB = basic(dv, x);
    if (!vB) return null;
    const v = vB.F;
    const w = canon(mul([v, du]));
    const W = antiderivative(canonToExpr(w), x, depth);
    if (!W) return null;
    const uv = mul([u, v]);
    const F = add([uv, neg(W)]);
    setOrderVar(x);
    const dvTex = disp(dv, x);
    const asides = [
      "\\int u \\, dv = uv - \\int v \\, du",
      `u = ${disp(u, x)}${LIST_SEP}${differential("v", dvTex, x)}`,
      `${differential("u", disp(du, x), x)}${LIST_SEP}v = ${disp(v, x)}`,
    ];
    const uvTex = disp(uv, x);
    const negW = w.length > 0 && w[0].c.n < 0;
    const wTex = printCanon(negW ? w.map((t2) => ({ ...t2, c: qNeg(t2.c) })) : w, "display", x);
    const rest = (limits?: { lo: string; hi: string }) => `${negW ? "+" : "-"} ${intTex(wTex, x, limits)}`;
    const working = [`${uvTex} ${rest()}`];
    const definite = (a: Ex, b: Ex): string[] | null => {
      const lo = exTex(a);
      const hi = exTex(b);
      const br = bracketLines(disp(F, x), F, x, a, b, lo, hi);
      if (!br) return null;
      return [...asides, `\\left[${uvTex}\\right]_{${lo}}^{${hi}} ${rest({ lo, hi })}`, ...br.lines];
    };
    return { asides, working, F, definite };
  };

  // --- identities: sin², cos², tan², tan, cot ------------------------------------------------------

  const identity = (f: Expr, x: string, depth: number): Plan | null => {
    const t = singleTerm(f);
    if (!t || t.f.length !== 1) return null;
    const g = t.f[0];
    if (g.base.t !== "fn") return null;
    const arg = g.base.arg;
    if (!linearOf(arg, x)) return null;
    const c = N(t.c);
    const two = arg.t === "sym" ? mul([I(2), arg]) : mul([I(2), arg]);
    let rewritten: Expr | null = null;
    const name = g.base.name;
    if (qEq(g.e, q(2)) && (name === "sin" || name === "cos")) {
      // sin² u = (1 - cos 2u)/2, cos² u = (1 + cos 2u)/2
      rewritten = mul([c, div(add([I(1), name === "sin" ? neg(fn("cos", two)) : fn("cos", two)]), I(2))]);
    } else if (qEq(g.e, q(2)) && name === "tan") rewritten = mul([c, add([pow(fn("sec", arg), I(2)), I(-1)])]);
    else if (qOne(g.e) && name === "tan") rewritten = mul([c, div(fn("sin", arg), fn("cos", arg))]);
    else if (qOne(g.e) && name === "cot") rewritten = mul([c, div(fn("cos", arg), fn("sin", arg))]);
    if (!rewritten) return null;
    const shown = qOne(t.c) ? (rewritten.t === "mul" ? mul(rewritten.args.slice(1)) : rewritten) : rewritten;
    const rewriteLine = intTex(tex(shown), x);
    const b = basic(rewritten, x);
    if (b) {
      const lines = [rewriteLine, b.rule, b.display];
      return {
        asides: [],
        working: lines,
        F: b.F,
        definite: (a2, b2) => {
          const lo = exTex(a2);
          const hi = exTex(b2);
          const br = bracketLines(b.display, b.F, x, a2, b2, lo, hi);
          return br ? [intTex(tex(shown), x, { lo, hi }), ...br.lines] : null;
        },
      };
    }
    // tan x = sin x / cos x: then the substitution u = cos x
    if (depth >= 2) return null;
    const sub = substitution(rewritten, x);
    if (!sub) return null;
    return { asides: [], working: [rewriteLine, ...sub.asides, ...sub.working], F: sub.F };
  };

  // --- standard forms: 1/(x² + a²), 1/√(a² - x²) ---------------------------------------------------

  const standard = (f: Expr, x: string): Plan | null => {
    const t = singleTerm(f);
    if (!t || t.f.length !== 1) return null;
    const g = t.f[0];
    const p = polyOf(g.base, x);
    if (!p || p.length !== 3 || !qZero(p[1])) return null;
    const X = S(x);
    const over = (a: Q): Expr => (qOne(a) ? X : div(X, N(a)));
    if (qEq(g.e, q(-1)) && qOne(p[2]) && p[0].n > 0) {
      // 1/(x² + a²) → (1/a) tan⁻¹(x/a)
      const a = qRoot(p[0], 2);
      if (!a) return null;
      const F = mul([N(qDiv(t.c, a)), fn("atan", over(a))]);
      const working: string[] = [];
      if (!qOne(a)) working.push(`${coefTex(t.c)}${intTex(`\\frac{1}{${x}^{2} + ${qInt(a) ? `${a.n}^{2}` : `\\left(${qLatex(a)}\\right)^{2}`}}`, x)}`);
      return { asides: [], working: [...working, disp(F, x)], F };
    }
    if (qEq(g.e, q(-1, 2)) && qEq(p[2], q(-1)) && p[0].n > 0) {
      // 1/√(a² - x²) → sin⁻¹(x/a)
      const a = qRoot(p[0], 2);
      if (!a) return null;
      const F = mul([N(t.c), fn("asin", over(a))]);
      return { asides: [], working: [disp(F, x)], F };
    }
    return null;
  };

  // --- partial fractions: distinct linear factors ------------------------------------------------

  const fractions = (f: Expr, x: string): Plan | null => {
    const t = singleTerm(f);
    if (!t) return null;
    const top = t.f.filter((g) => g.e.n > 0);
    const bottom = t.f.filter((g) => g.e.n < 0).map((g) => ({ ...g, e: qNeg(g.e) }));
    if (bottom.length === 0) return null;
    const Np = polyOf(termExpr({ c: t.c, f: top }), x);
    const Dp = polyOf(termExpr({ c: Q1, f: bottom }), x);
    if (!Np || !Dp || Dp.length < 3 || Dp.length > 4 || Np.length >= Dp.length) return null;
    const roots = rationalRoots(Dp);
    if (roots.length !== Dp.length - 1) return null;
    // D = lead · Π(qx - p): the factors a student writes, with whole numbers
    const lead = roots.reduce((acc, r) => qDiv(acc, q(r.d)), Dp[Dp.length - 1]);
    if (!qOne(lead)) return null;
    // the order a teacher writes the factors: smaller first, (x - 1) before (x + 1)
    roots.sort((r, s2) => Math.abs(r.n / r.d) - Math.abs(s2.n / s2.d) || s2.n / s2.d - r.n / r.d);
    const factor = (r: Q): Expr => (qZero(r) ? S(x) : add([r.d === 1 ? S(x) : mul([I(r.d), S(x)]), I(-r.n)]));
    const factorTex = (r: Q) => tex(factor(r));
    const letters = ["A", "B", "D"].slice(0, roots.length);
    // cover-up: B_i = N(r_i) / Π_{j≠i} (q_j r_i - p_j)
    const coeffs = roots.map((r, i) => {
      let den = Q1;
      roots.forEach((s, j) => {
        if (j !== i) den = qMul(den, qSub(qMul(q(s.d), r), q(s.n)));
      });
      return qDiv(pEval(Np, r), den);
    });
    if (coeffs.some(qZero)) return null;
    const nTex = printCanon(canon(termExpr({ c: t.c, f: top })), "display", x);
    const bracket = (r: Q) => (qZero(r) ? x : `(${factorTex(r)})`);
    const denTex = roots.map(bracket).join("");
    const decomposition = `\\frac{${nTex}}{${denTex}} = ${letters.map((L, i) => `\\frac{${L}}{${factorTex(roots[i])}}`).join(" + ")}`;
    const cleared = `${nTex} = ${letters
      .map((L, i) => {
        const others = roots.filter((_, j) => j !== i).map(bracket);
        return `${L}${others.join("")}`;
      })
      .join(" + ")}`;
    const values = letters.map((L, i) => `${L} = ${qLatex(coeffs[i])}`).join(LIST_SEP);
    // the integrand as its partial fractions, then ln of each
    const piece = (k: Q, r: Q, first: boolean): string => {
      const mag = k.n < 0 ? qNeg(k) : k;
      const body = mag.d === 1 ? `\\frac{${mag.n}}{${factorTex(r)}}` : `\\frac{${mag.n}}{${mag.d}${bracket(r)}}`;
      return first ? (k.n < 0 ? `-${body}` : body) : `${k.n < 0 ? " - " : " + "}${body}`;
    };
    const split = `\\left(${roots.map((r, i) => piece(coeffs[i], r, i === 0)).join("")}\\right)`;
    const F = add(roots.map((r, i) => mul([N(qDiv(coeffs[i], q(r.d))), fn("ln", fn("abs", factor(r)))])));
    const asides = [decomposition, cleared, values];
    const working = [intTex(split, x), disp(F, x)];
    return {
      asides,
      working,
      F,
      definite: (a, b) => {
        const lo = exTex(a);
        const hi = exTex(b);
        const br = bracketLines(disp(F, x), F, x, a, b, lo, hi);
        return br ? [...asides, intTex(split, x, { lo, hi }), ...br.lines] : null;
      },
    };
  };

  // --- dispatch ---------------------------------------------------------------------------------

  const plan = (f: Expr, x: string, depth = 0): Plan | null => {
    setOrderVar(x);
    for (const technique of [() => standard(f, x), () => identity(f, x, depth), () => substitution(f, x), () => parts(f, x, depth), () => fractions(f, x)]) {
      let p: Plan | null = null;
      try {
        p = technique();
      } catch {
        p = null;
      }
      setOrderVar(x);
      if (p && derivativeAgrees(p.F, f, x)) return p;
    }
    return null;
  };

  const tidy = (lines: readonly string[], input: string): string[] => {
    const out: string[] = [];
    let last = lineKey(input);
    for (const l of lines) {
      const k = lineKey(l);
      if (!l || k === last) continue;
      out.push(l);
      last = k;
    }
    return out;
  };

  const integrate = (integrand: Expr, x: string, constant: string): IntegralTechnique | null => {
    const p = plan(integrand, x);
    if (!p) return null;
    setOrderVar(x);
    const display = disp(p.F, x);
    const working = [...p.working];
    if (lineKey(working[working.length - 1] ?? "") !== lineKey(display)) working.push(display);
    // `+ C` on every line that is an antiderivative (not on one that still has an integral in it)
    const withC = working.map((l) => (/\\int/.test(l) || isRelationLine(l) ? l : plusC(l, constant)));
    const lines = tidy([...p.asides, ...withC], intTex(tex(integrand), x));
    // over budget: the middle working goes first, never the asides' order or the answer
    while (lines.length > MAX_LINES) {
      const i = lines.findIndex((l, k) => k > p.asides.length && k < lines.length - 1);
      if (i < 0) return null;
      lines.splice(i, 1);
    }
    return { lines, F: p.F, display };
  };

  const integrateDefinite = (integrand: Expr, x: string, a: Ex, b: Ex): DefiniteTechnique | null => {
    const p = plan(integrand, x);
    if (!p) return null;
    setOrderVar(x);
    const lo = exTex(a);
    const hi = exTex(b);
    let lines = p.definite ? p.definite(a, b) : null;
    let value: Ex | null = null;
    // the plain bracket of F when the technique has no definite form of its own (or it was not exact)
    const br = bracketLines(disp(p.F, x), p.F, x, a, b, lo, hi);
    if (!br) return null;
    value = br.value;
    if (!lines) lines = [...p.asides, ...br.lines];
    const numeric = simpson((v) => evalNum(integrand, { [x]: v }), exNum(a), exNum(b));
    if (!close(numeric, exNum(value), 1e-4)) return null;
    const out = tidy(lines, intTex(tex(integrand), x, { lo, hi }));
    if (out.length > MAX_LINES) return null;
    return { lines: out, value };
  };

  return { integrate, integrateDefinite };
}

/** The rational roots of a polynomial with rational coefficients (distinct), by the rational root theorem. */
function rationalRoots(p: Poly): Q[] {
  // scale to integers
  let l = 1;
  for (const c of p) l = (l * c.d) / gcdInt(l, c.d);
  const ints = p.map((c) => (c.n * l) / c.d);
  const a0 = Math.abs(ints[0]);
  const an = Math.abs(ints[ints.length - 1]);
  if (a0 === 0) {
    // x is a factor
    const rest = rationalRoots(p.slice(1));
    return [Q0, ...rest.filter((r) => !qZero(r))];
  }
  const divisors = (n: number) => {
    const out: number[] = [];
    for (let i = 1; i <= Math.min(n, 1000); i++) if (n % i === 0) out.push(i);
    return out;
  };
  const out: Q[] = [];
  for (const num of divisors(a0)) {
    for (const den of divisors(an)) {
      for (const s of [1, -1]) {
        const r = q(s * num, den);
        if (out.some((o) => qEq(o, r))) continue;
        if (qZero(pEval(p, r))) out.push(r);
      }
    }
  }
  return out.sort((x1, x2) => x1.n / x1.d - x2.n / x2.d);
}

function gcdInt(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

