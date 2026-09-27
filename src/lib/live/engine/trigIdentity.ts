/**
 * Simplifying with the identities a student knows, one visible rewrite at a time:
 *
 *   \frac{\sin 2x}{\sin x}              1 - \sin^{2} x      \frac{1 - \cos 2x}{\sin 2x}                 \tan x \cos x
 *   = \frac{2\sin x \cos x}{\sin x}     = \cos^{2} x        = \frac{1 - (1 - 2\sin^{2} x)}{2\sin x \cos x}   = \frac{\sin x}{\cos x} \cdot \cos x
 *   = 2\cos x                                               = \frac{\sin x}{\cos x}                      = \sin x
 *                                                           = \tan x
 *
 * The identities: the double angles (sin 2u, and whichever form of cos 2u simplifies best), tan,
 * sec, csc, cot as sin and cos, the Pythagorean ones (sin² + cos² = 1, 1 + tan² = sec²,
 * 1 + cot² = csc²), and sin / cos back to tan at the end. Each candidate rewrite is simplified
 * by `calculus.ts`'s canonical form (which cancels common factors); the shortest result wins,
 * and only when it is shorter than the line the student wrote. Every line is checked against
 * the original at sample points: a wrong identity is no answer, never a wrong line.
 */
import {
  add,
  canon,
  canonToExpr,
  div,
  evalNum,
  factorOf,
  fn,
  hasVar,
  I,
  lineKey,
  mul,
  neg,
  pow,
  printCanon,
  q,
  qEq,
  qNeg,
  rationalValue,
  SAMPLES,
  setOrderVar,
  tex,
  type Canon,
  type Expr,
  type Factor,
  type Term,
} from "./calculus";

const TRIG_NAMES = new Set(["sin", "cos", "tan", "sec", "csc", "cot"]);

function hasTrig(e: Expr): boolean {
  switch (e.t) {
    case "fn":
      return TRIG_NAMES.has(e.name) || hasTrig(e.arg);
    case "add":
    case "mul":
      return e.args.some(hasTrig);
    case "div":
      return hasTrig(e.num) || hasTrig(e.den);
    case "pow":
      return hasTrig(e.base) || hasTrig(e.exp);
    case "neg":
    case "sqrt":
      return hasTrig(e.arg);
    default:
      return false;
  }
}

/** Rebuilds an Expr bottom-up with `f` applied to every node (children first). */
function mapExpr(e: Expr, f: (e: Expr) => Expr): Expr {
  let out: Expr;
  switch (e.t) {
    case "add":
      out = { t: "add", args: e.args.map((a) => mapExpr(a, f)) };
      break;
    case "mul":
      out = { t: "mul", args: e.args.map((a) => mapExpr(a, f)) };
      break;
    case "div":
      out = div(mapExpr(e.num, f), mapExpr(e.den, f));
      break;
    case "pow":
      out = pow(mapExpr(e.base, f), mapExpr(e.exp, f));
      break;
    case "neg":
      out = { t: "neg", arg: mapExpr(e.arg, f) };
      break;
    case "sqrt":
      out = { t: "sqrt", arg: mapExpr(e.arg, f) };
      break;
    case "fn":
      out = fn(e.name, mapExpr(e.arg, f));
      break;
    default:
      out = e;
  }
  return f(out);
}

/** `2u` → u (the half of a double angle), or null. */
function halfOf(arg: Expr): Expr | null {
  if (arg.t !== "mul") return null;
  const k = rationalValue(arg.args[0]);
  if (!k || !qEq(k, q(2))) return null;
  const rest = arg.args.slice(1);
  return rest.length === 1 ? rest[0] : mul(rest);
}

type CosForm = "diff" | "sin" | "cos";

/** sin 2u → 2 sin u cos u; cos 2u → cos² u - sin² u, 1 - 2 sin² u or 2 cos² u - 1. */
function doubleAngles(e: Expr, form: CosForm): Expr {
  return mapExpr(e, (n) => {
    if (n.t !== "fn" || (n.name !== "sin" && n.name !== "cos")) return n;
    const u = halfOf(n.arg);
    if (!u) return n;
    const s = fn("sin", u);
    const c = fn("cos", u);
    if (n.name === "sin") return mul([I(2), s, c]);
    if (form === "diff") return add([pow(c, I(2)), neg(pow(s, I(2)))]);
    if (form === "sin") return add([I(1), neg(mul([I(2), pow(s, I(2))]))]);
    return add([mul([I(2), pow(c, I(2))]), I(-1)]);
  });
}

/** tan, sec, csc, cot as sin and cos. */
function toSinCos(e: Expr): Expr {
  return mapExpr(e, (n) => {
    if (n.t !== "fn") return n;
    const s = fn("sin", n.arg);
    const c = fn("cos", n.arg);
    switch (n.name) {
      case "tan":
        return div(s, c);
      case "cot":
        return div(c, s);
      case "sec":
        return div(I(1), c);
      case "csc":
        return div(I(1), s);
      default:
        return n;
    }
  });
}

const trigFactor = (f: Factor): { name: string; argKey: string } | null =>
  f.base.t === "fn" && TRIG_NAMES.has(f.base.name) ? { name: f.base.name, argKey: tex(f.base.arg) } : null;

/** A term split into c · R · name(u)^2, for each squared trig factor in it. */
function squares(t: Term): Array<{ name: string; arg: Expr; rest: Term; restKey: string }> {
  const out: Array<{ name: string; arg: Expr; rest: Term; restKey: string }> = [];
  t.f.forEach((f, i) => {
    const tf = trigFactor(f);
    if (!tf || !qEq(f.e, q(2))) return;
    const rest: Term = { c: t.c, f: t.f.filter((_, j) => j !== i) };
    out.push({ name: tf.name, arg: (f.base as { arg: Expr }).arg, rest, restKey: keyOf(rest.f) });
  });
  return out;
}

const keyOf = (fs: readonly Factor[]): string =>
  fs
    .map((f) => `${f.key}^${f.e.n}/${f.e.d}`)
    .sort()
    .join("*");

/**
 * The Pythagorean identities on a canonical sum, until none applies:
 *   c·R·sin² + c·R·cos² → c·R;   c·R - c·R·sin² → c·R·cos² (and cos → sin);
 *   c·R·sec² - c·R → c·R·tan²;   c·R + c·R·tan² → c·R·sec² (and csc / cot the same).
 */
function pythagoras(A: Canon): Canon {
  let terms = [...A];
  for (let guard = 0; guard < 8; guard++) {
    let changed = false;
    outer: for (let i = 0; i < terms.length; i++) {
      for (let j = 0; j < terms.length; j++) {
        if (i === j) continue;
        const ti = terms[i];
        const tj = terms[j];
        const replace = (t: Term) => {
          terms = terms.filter((_, k) => k !== i && k !== j);
          terms.push(t);
          changed = true;
        };
        for (const a of squares(ti)) {
          const withSquare = (name: string, rest: Term): Term => ({ c: rest.c, f: [...rest.f, factorOf(fn(name as "sin", a.arg), q(2))] });
          // c·R·sin² + c·R·cos² → c·R
          for (const b of squares(tj)) {
            if (tex(a.arg) !== tex(b.arg) || a.restKey !== b.restKey || !qEq(a.rest.c, b.rest.c)) continue;
            if ((a.name === "sin" && b.name === "cos") || (a.name === "cos" && b.name === "sin")) {
              replace(a.rest);
              break outer;
            }
          }
          // c·R and -c·R·sin²: c·R·cos²
          const restKey = keyOf(tj.f);
          if (restKey === a.restKey && qEq(tj.c, qNeg(a.rest.c))) {
            const other: Record<string, string> = { sin: "cos", cos: "sin" };
            if (other[a.name]) {
              replace(withSquare(other[a.name], tj));
              break outer;
            }
            // c·R·sec² - c·R → c·R·tan²; c·R·csc² - c·R → c·R·cot²
            const minus: Record<string, string> = { sec: "tan", csc: "cot" };
            if (minus[a.name]) {
              replace(withSquare(minus[a.name], { c: a.rest.c, f: a.rest.f }));
              break outer;
            }
          }
          // c·R + c·R·tan² → c·R·sec²; c·R + c·R·cot² → c·R·csc²
          if (restKey === a.restKey && qEq(tj.c, a.rest.c)) {
            const plus: Record<string, string> = { tan: "sec", cot: "csc" };
            if (plus[a.name]) {
              replace(withSquare(plus[a.name], tj));
              break outer;
            }
          }
        }
      }
    }
    if (!changed) break;
    terms = canon(canonToExpr(terms));
  }
  return terms;
}

/** Pythagoras inside every sum of an expression (`\frac{\cos^{2} x}{1 - \sin^{2} x}`), structure kept. */
function pythagorasInside(e: Expr): Expr {
  return mapExpr(e, (n) => {
    if (n.t !== "add" || !hasTrig(n)) return n;
    try {
      const A = canon(n);
      const P = pythagoras(A);
      return P.length < A.length ? canonToExpr(P) : n;
    } catch {
      return n;
    }
  });
}

/** sin^a / cos^a → tan^a at the end (cot, sec, csc only when the student used them). */
function backToTan(A: Canon, used: ReadonlySet<string>): Canon {
  return A.map((t) => {
    let f = [...t.f];
    const find = (name: string, sign: 1 | -1, argKey?: string) =>
      f.findIndex((x) => {
        const tf = trigFactor(x);
        return tf && tf.name === name && Math.sign(x.e.n) === sign && (!argKey || tf.argKey === argKey);
      });
    for (let guard = 0; guard < 4; guard++) {
      const si = find("sin", 1);
      if (si < 0) break;
      const s = f[si];
      const ci = f.findIndex((x) => {
        const tf = trigFactor(x);
        return tf && tf.name === "cos" && tf.argKey === tex((s.base as { arg: Expr }).arg) && qEq(x.e, qNeg(s.e));
      });
      if (ci < 0) break;
      const tan = factorOf(fn("tan", (s.base as { arg: Expr }).arg), s.e);
      f = f.filter((_, k) => k !== si && k !== ci).concat(tan);
    }
    const swaps: Array<[string, string]> = [];
    if (used.has("cot")) swaps.push(["cos", "cot"]);
    if (used.has("sec")) swaps.push(["cos", "sec"]);
    if (used.has("csc")) swaps.push(["sin", "csc"]);
    for (const [from, to] of swaps) {
      if (to === "cot") {
        const ci = find("cos", 1);
        if (ci < 0) continue;
        const c = f[ci];
        const si = f.findIndex((x) => trigFactor(x)?.name === "sin" && qEq(x.e, qNeg(c.e)) && trigFactor(x)?.argKey === trigFactor(c)?.argKey);
        if (si < 0) continue;
        f = f.filter((_, k) => k !== si && k !== ci).concat(factorOf(fn("cot", (c.base as { arg: Expr }).arg), c.e));
      } else {
        const i = find(from, -1);
        if (i < 0) continue;
        const r = f[i];
        f = f.filter((_, k) => k !== i).concat(factorOf(fn(to as "sec", (r.base as { arg: Expr }).arg), qNeg(r.e)));
      }
    }
    return { c: t.c, f };
  });
}

function usedNames(e: Expr, out = new Set<string>()): Set<string> {
  mapExpr(e, (n) => {
    if (n.t === "fn") out.add(n.name);
    return n;
  });
  return out;
}

/** e and f are the same function of x (sampled). */
function same(e: Expr, f: Expr, x: string): boolean {
  let checked = 0;
  for (const p of SAMPLES) {
    const a = evalNum(e, { [x]: p });
    const b = evalNum(f, { [x]: p });
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 1e8 || Math.abs(b) > 1e8) continue;
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) return false;
    checked++;
  }
  return checked >= 4;
}

/**
 * The lines that simplify `e` (an expression in x with trig in it), or null when the identities
 * do not make it simpler. Bare lines, as `simplifySteps` returns them.
 */
export function identitySteps(e: Expr, x: string, input: string): string[] | null {
  if (!hasTrig(e) || !hasVar(e, x)) return null;
  setOrderVar(x);
  const used = usedNames(e);
  const original = lineKey(input);
  // the line as the engine prints it (`\sin(x)` is `\sin x`): reprinting is not simplifying
  const reprinted = lineKey(tex(e));
  type Candidate = { lines: string[]; final: string };
  const candidates: Candidate[] = [];
  const forms: CosForm[] = ["diff", "sin", "cos"];
  for (const convert of [false, true]) {
    for (const form of forms) {
      try {
        const rewritten = doubleAngles(convert ? toSinCos(e) : e, form);
        const inside = pythagorasInside(rewritten);
        const C = canon(inside);
        const P = pythagoras(C);
        const T = backToTan(P, used);
        const shown: Array<{ tex: string; expr: Expr }> = [
          { tex: tex(rewritten), expr: rewritten },
          { tex: tex(inside), expr: inside },
          { tex: printCanon(C, "display", x), expr: canonToExpr(C) },
          { tex: printCanon(P, "display", x), expr: canonToExpr(P) },
          { tex: printCanon(T, "display", x), expr: canonToExpr(T) },
        ];
        const lines: string[] = [];
        let last = original;
        let ok = true;
        for (const s of shown) {
          const k = lineKey(s.tex);
          if (k === last || k === reprinted) continue;
          if (!same(s.expr, e, x)) {
            ok = false;
            break;
          }
          lines.push(s.tex);
          last = k;
        }
        if (!ok || lines.length === 0) continue;
        candidates.push({ lines, final: lines[lines.length - 1] });
      } catch {
        // a rewrite the canonical form cannot take: not a candidate
      }
    }
  }
  if (candidates.length === 0) return null;
  const size = (s: string) => lineKey(s).length;
  candidates.sort((a, b) => size(a.final) - size(b.final) || a.lines.length - b.lines.length);
  const best = candidates[0];
  // only a simplification: shorter than what the student wrote
  if (size(best.final) >= Math.min(size(input), reprinted.length)) return null;
  return best.lines.slice(-4);
}
