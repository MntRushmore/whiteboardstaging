/**
 * One equation of a figure, solved the way a geometry teacher writes it:
 *
 *   5^{2} + 12^{2} = c^{2}     \sin 30^{\circ} = \frac{x}{10}   \tan\theta = \frac{3}{4}                 7^{2} = 5^{2} + 8^{2} - 2(5)(8)\cos C
 *   25 + 144 = c^{2}           x = 10\sin 30^{\circ}            \theta = \tan^{-1}\left(\frac{3}{4}\right)  49 = 25 + 64 - 80\cos C
 *   169 = c^{2}                x = 10 \cdot \frac{1}{2}         \theta \approx 36.87^{\circ}              49 = 89 - 80\cos C
 *   c = \sqrt{169}             x = 5                                                                    80\cos C = 89 - 49
 *   c = 13                                                                                              80\cos C = 40
 *                                                                                                       \cos C = \frac{1}{2}
 *   x + 35^{\circ} + 75^{\circ} = 180^{\circ}   \frac{a}{\sin 30^{\circ}} = \frac{10}{\sin 45^{\circ}}      C = \cos^{-1}\left(\frac{1}{2}\right)
 *   x + 110^{\circ} = 180^{\circ}               a\sin 45^{\circ} = 10\sin 30^{\circ}                        C = 60^{\circ}
 *   x = 180^{\circ} - 110^{\circ}               a = \frac{10\sin 30^{\circ}}{\sin 45^{\circ}}
 *   x = 70^{\circ}                              a = 5\sqrt{2}
 *
 * The unknown appears as itself, as one power of itself (a length squared, a radius cubed) or
 * inside one trig ratio (an angle); anything else is not this module's (`null`). A proportion
 * is cross-multiplied; the numbers are worked out round by round (`geometryExpr.ts`) — except
 * that a trig ratio beside the unknown is kept written until the unknown is alone, as a teacher
 * does with the law of sines; then the power's POSITIVE root (the caller says the unknown is a
 * length) or the inverse ratio's principal angle. Exact answers stay exact (`5\sqrt{2}`,
 * `25\pi`, `60^{\circ}`); a value that is not (`12\tan 40^{\circ}`) ends in `\approx` and two
 * decimal places. Every answer is substituted back into the equation before it is returned.
 */
import { q } from "./algebra";
import {
  evalExact,
  evalNumber,
  gLatex,
  gNum,
  gSym,
  gVal,
  hasTrig,
  isClosed,
  NoValue,
  NotExact,
  reduceOnce,
  someNode,
  type G,
  type GPrint,
  type NumValue,
} from "./geometryExpr";
import { decimalLatex, unitLatex, vDimless, vDiv, vHasPi, vHasRoot, vIsRational, vLatex, vMul, vNeg, vNum, vQ, vRational, vSub, type InverseFn, type TrigFn, type Val } from "./geometryValue";
import { MAX_STEPS, StepWriter } from "./solution";

export interface EquationOptions extends GPrint {
  /** the unknown is a length (or an area, a volume): an even power takes its positive root */
  length?: boolean;
  /** inverse ratios answer in radians (π in the problem) */
  radians?: boolean;
  /** the unknown is an angle of a triangle: the principal value, never a list over a turn */
  triangleAngle?: boolean;
}

export interface EquationSolution {
  steps: string[];
  /** the answer line (the last step) */
  final: string;
  /** the answer as a number (degrees for an angle) */
  value: number;
  /** the exact answer, when there is one */
  exact: Val | null;
}

/** How the unknown appears: itself, a power of itself, or inside one trig ratio. */
type UKind = { kind: "pow"; k: number } | { kind: "fn"; name: TrigFn };

class Refuse extends Error {}
const refuse = (): never => {
  throw new Refuse();
};

function unknownKind(sides: G[], u: string): UKind | null {
  const seen: UKind[] = [];
  let bad = false;
  const walk = (g: G): void => {
    if (g.k === "sym") {
      if (g.name === u) seen.push({ kind: "pow", k: 1 });
      return;
    }
    if (g.k === "fn" && g.arg.k === "sym" && g.arg.name === u) {
      if (["sin", "cos", "tan"].includes(g.name)) seen.push({ kind: "fn", name: g.name as TrigFn });
      else bad = true;
      return;
    }
    if (g.k === "pow" && g.base.k === "sym" && g.base.name === u) {
      const e = g.exp.k === "val" ? vRational(g.exp.v) : null;
      if (e && e.d === 1 && e.n >= 2 && e.n <= 3) seen.push({ kind: "pow", k: e.n });
      else bad = true;
      return;
    }
    if ((g.k === "root" || g.k === "abs" || g.k === "fn" || g.k === "pow") && someNode(g, (x) => x.k === "sym" && x.name === u)) {
      bad = true;
      return;
    }
    switch (g.k) {
      case "add":
        g.items.forEach((i) => walk(i.g));
        return;
      case "mul":
        g.items.forEach(walk);
        return;
      case "div":
        walk(g.num);
        walk(g.den);
        return;
      case "paren":
      case "neg":
        walk(g.g);
        return;
      default:
        return;
    }
  };
  sides.forEach(walk);
  if (bad || seen.length === 0) return null;
  const first = seen[0];
  const same = seen.every((s) => (s.kind === "pow" && first.kind === "pow" ? s.k === first.k : s.kind === "fn" && first.kind === "fn" ? s.name === first.name : false));
  return same ? first : null;
}

const mentions = (g: G, u: string): boolean => someNode(g, (x) => x.k === "sym" && x.name === u);
const unparen = (g: G): G => (g.k === "paren" ? unparen(g.g) : g);
const ONE_G = (): G => gNum(1);
const isOne = (g: G): boolean => g.k === "val" && vIsRational(g.v) && vRational(g.v)!.n === 1 && vRational(g.v)!.d === 1 && g.v.deg === 0 && g.v.len === 0;
const isPlainNumber = (g: G): boolean => g.k === "val" && vIsRational(g.v) && g.v.deg === 0 && g.v.len === 0;

/** `k·a` as a student writes it: the number first (`12x`), a ratio or a root after the unknown (`a\sin 45^{\circ}`, `x\sqrt{2}`). */
function product(a: G, b: G, u: string): G {
  if (isOne(a)) return b;
  if (isOne(b)) return a;
  const ua = mentions(a, u);
  const ub = mentions(b, u);
  if (ub && !ua) return isPlainNumber(unparen(a)) || unparen(a).k === "mul" ? mul(a, b) : mul(b, a);
  if (ua && !ub) return isPlainNumber(unparen(b)) || unparen(b).k === "mul" ? mul(b, a) : mul(a, b);
  // `10\sin 30^{\circ}`: a number before a ratio
  if (!ua && !ub && isPlainNumber(unparen(b)) && !isPlainNumber(unparen(a))) return mul(b, a);
  return mul(a, b);
}

function mul(a: G, b: G): G {
  const items = [...(a.k === "mul" ? a.items : [a.k === "add" ? ({ k: "paren", g: a } as G) : a]), ...(b.k === "mul" ? b.items : [b.k === "add" ? ({ k: "paren", g: b } as G) : b])];
  return { k: "mul", items };
}

/** `\frac{5}{4}` written as one number is still a fraction to cross-multiply: its top over its bottom. */
function asFraction(g: G): G {
  if (g.k !== "val" || g.v.deg !== 0 || g.v.len !== 0) return g;
  const r = vRational(g.v);
  if (!r || r.d === 1) return g;
  return { k: "div", num: gNum(r.n), den: gNum(r.d) };
}

/**
 * `\frac{a}{b} = \frac{c}{d}` → `a d = b c` (the unknown's side on the left); a side that is not
 * a fraction is over 1. Only when neither side is a sum and the unknown is in one of the four.
 */
function crossMultiply(L: G, R: G, u: string): [G, G] | null {
  // a fraction's value is a fraction to cross-multiply only against a written fraction (`\frac{P}{24} = \frac{5}{4}`),
  // never beside the ratio already alone (`\tan\theta = \frac{3}{4}`)
  const l = unparen(R).k === "div" ? asFraction(unparen(L)) : unparen(L);
  const r = unparen(L).k === "div" ? asFraction(unparen(R)) : unparen(R);
  if (l.k === "add" || r.k === "add") return null;
  if (l.k !== "div" && r.k !== "div") return null;
  const [a, b] = l.k === "div" ? [l.num, l.den] : [l, ONE_G()];
  const [c, d] = r.k === "div" ? [r.num, r.den] : [r, ONE_G()];
  const slots = [a, b, c, d].map((g) => mentions(g, u));
  // `\frac{4}{x} = \frac{x}{9}`: the unknown in both means (or both extremes) — its square
  const bare = (g: G) => unparen(g).k === "sym" && (unparen(g) as { name: string }).name === u;
  if (slots[1] && slots[2] && !slots[0] && !slots[3] && bare(b) && bare(c)) return [{ k: "pow", base: gSym(u), exp: gNum(2) }, product(a, d, u)];
  if (slots[0] && slots[3] && !slots[1] && !slots[2] && bare(a) && bare(d)) return [{ k: "pow", base: gSym(u), exp: gNum(2) }, product(b, c, u)];
  if (slots.filter(Boolean).length !== 1) return null;
  // a·d = b·c, written with the unknown's side first
  const ad = product(a, d, u);
  const bc = product(b, c, u);
  return slots[0] || slots[3] ? [ad, bc] : [bc, ad];
}

// ---------------------------------------------------------------- linear form

interface Term {
  neg: boolean;
  /** the unknown's term: its coefficient (null for 1); a constant: its tree */
  u: boolean;
  g: G | null;
  /** the unknown written before its coefficient (`x\sqrt{2}`, `a\sin 45^{\circ}`) */
  uFirst: boolean;
}

function linear(g: G, u: string, neg = false): Term[] {
  if (!mentions(g, u)) return [{ neg, u: false, g, uFirst: false }];
  switch (g.k) {
    case "sym":
    case "pow":
    case "fn":
      return [{ neg, u: true, g: null, uFirst: false }];
    case "add":
      return g.items.flatMap((i) => linear(i.g, u, neg !== i.neg));
    case "neg":
      return linear(g.g, u, !neg);
    case "paren":
      return linear(g.g, u, neg);
    case "mul": {
      const at = g.items.findIndex((x) => mentions(x, u));
      if (g.items.some((x, i) => i !== at && mentions(x, u))) return refuse();
      const others = g.items.filter((_, i) => i !== at);
      const inner = linear(g.items[at], u, neg);
      const coef = (t: Term): G | null => {
        const parts = [...others, ...(t.g ? [t.g] : [])];
        return parts.length === 0 ? null : parts.length === 1 ? parts[0] : { k: "mul", items: parts };
      };
      return inner.map((t) =>
        t.u
          ? { neg: t.neg, u: true, g: coef(t), uFirst: at === 0 && others.length > 0 && !isPlainNumber(unparen(others[0])) }
          : { neg: t.neg, u: false, g: { k: "mul", items: [...others, t.g!] }, uFirst: false },
      );
    }
    case "div": {
      if (mentions(g.den, u)) return refuse();
      return linear(g.num, u, neg).map((t) => ({ ...t, g: { k: "div", num: t.g ?? ONE_G(), den: g.den } as G }));
    }
    default:
      return refuse();
  }
}

function uLatex(kind: UKind, u: string, opts: GPrint): string {
  const name = gLatex(gSym(u), opts);
  if (kind.kind === "fn") return `\\${kind.name} ${name}`;
  // `c^{2}`, `AC^{2}` (a segment's name is one letter pair), `(\angle A)^{2}`
  return kind.k === 1 ? name : `${/^[a-zA-Z]+$/.test(name) || /^[a-zA-Z]_\{\w+\}$/.test(name) ? name : `(${name})`}^{${kind.k}}`;
}

function termLatex(t: Term, kind: UKind, u: string, opts: GPrint): string {
  if (!t.u) return gLatex(t.g!, opts);
  const U = uLatex(kind, u, opts);
  if (!t.g) return U;
  const c = gLatex(t.g, opts);
  const cp = t.g.k === "add" ? `(${c})` : c;
  // `x\sqrt{2}`, `a\sin 45^{\circ}` as written; a plain number always first (`12x`)
  if (t.uFirst && !isPlainNumber(unparen(t.g))) return `${U}${/^[\\(]/.test(cp) ? "" : " \\cdot "}${cp}`;
  const space = (/^\\/.test(U) && /[a-zA-Z}]$/.test(cp)) || (/\\[a-zA-Z]+$/.test(cp) && /^[a-zA-Z]/.test(U));
  return `${cp}${space ? " " : ""}${U}`;
}

function sideLatex(terms: Term[], kind: UKind, u: string, opts: GPrint): string {
  if (terms.length === 0) return "0";
  return terms
    .map((t, i) => {
      let body = termLatex(t, kind, u, opts);
      let neg = t.neg;
      if (body.startsWith("-") && !t.u) {
        neg = !neg;
        body = body.slice(1).trimStart();
      }
      if (i === 0) return neg ? `-${body}` : body;
      return neg ? ` - ${body}` : ` + ${body}`;
    })
    .join("");
}

// ---------------------------------------------------------------- the solver

const dimsOf = (g: G): { deg: number; len: number } => {
  try {
    const v = evalExact(g);
    return { deg: v.deg, len: v.len };
  } catch {
    const n = evalNumber(g);
    return { deg: n.deg, len: 0 };
  }
};

/** The equation with its degree signs dropped (every term was in degrees). */
function stripDegrees(g: G): G {
  switch (g.k) {
    case "val":
      return g.v.deg === 0 ? g : gVal({ ...g.v, deg: 0 }, g.text);
    case "mul": {
      const items = g.items.filter((x) => !(x.k === "val" && !x.text && vIsRational(x.v) && vNum(x.v) === 1 && x.v.deg !== 0)).map(stripDegrees);
      return items.length === 0 ? gNum(1) : items.length === 1 ? items[0] : { k: "mul", items };
    }
    case "add":
      return { k: "add", items: g.items.map((i) => ({ neg: i.neg, g: stripDegrees(i.g) })) };
    case "div":
      return { k: "div", num: stripDegrees(g.num), den: stripDegrees(g.den) };
    case "paren":
      return { k: "paren", g: stripDegrees(g.g) };
    case "neg":
      return { k: "neg", g: stripDegrees(g.g) };
    default:
      return g;
  }
}

const atom = (g: G | null): boolean => g === null || g.k === "val" || (g.k === "paren" && atom(g.g));
const valOf = (g: G | null): Val => (g === null ? vQ(q(1)) : g.k === "val" ? g.v : g.k === "paren" ? valOf(g.g) : refuse());

/** One round over every tree of the equation at once (the same kind of operation everywhere). */
function roundAll(trees: Array<G | null>, frozen: (g: G) => boolean): Array<G | null> | null {
  // the kind of operation this round does is the lowest any tree offers
  const nexts = trees.map((g) => (g && !frozen(g) && isClosed(g) ? reduceOnce(g) : null));
  if (nexts.every((n) => n === null)) return null;
  return trees.map((g, i) => nexts[i] ?? g);
}

export function solveEquationG(L0: G, R0: G, u: string, opts: EquationOptions = {}): EquationSolution | null {
  try {
    return solve(L0, R0, u, opts);
  } catch (e) {
    if (e instanceof Refuse || e instanceof NotExact || e instanceof NoValue) return null;
    throw e;
  }
}

function solve(L0: G, R0: G, u: string, opts: EquationOptions): EquationSolution | null {
  const input = `${gLatex(L0, opts)} = ${gLatex(R0, opts)}`;
  const writer = new StepWriter((s) => s.replace(/\\left|\\right|\\,|\s|[{}]/g, ""), input);
  // `\frac{A}{20} = \left(\frac{3}{2}\right)^{2}`: the numbers worked out first, then cross-multiplied
  let [L1, R1] = [L0, R0];
  const proportionSide = (g: G) => unparen(g).k === "div" && mentions(g, u);
  for (const side of [0, 1] as const) {
    const g = side === 0 ? L1 : R1;
    const other = side === 0 ? R1 : L1;
    // (a fraction as written, `\frac{8}{12}`, is cross-multiplied as it stands)
    if (!isClosed(g) || atom(g) || unparen(g).k === "div" || hasTrig(g) || !proportionSide(other)) continue;
    let cur = g;
    for (let guard = 0; guard < 12; guard++) {
      const next = reduceOnce(cur);
      if (!next) break;
      cur = next;
    }
    if (!atom(cur)) continue;
    if (side === 0) L1 = cur;
    else R1 = cur;
    writer.write(`${gLatex(L1, opts)} = ${gLatex(R1, opts)}`);
  }
  const crossedFirst = crossMultiply(L1, R1, u);
  const kind = unknownKind(crossedFirst ?? [L1, R1], u);
  if (!kind) return null;
  if (kind.kind === "pow" && kind.k === 2 && !opts.length) return null;

  let L = L1;
  let R = R1;
  const crossed = crossedFirst;
  if (crossed) {
    [L, R] = crossed;
    writer.write(`${gLatex(L, opts)} = ${gLatex(R, opts)}`);
  }
  let left = linear(L, u);
  let right = linear(R, u);
  const print = () => `${sideLatex(left, kind, u, opts)} = ${sideLatex(right, kind, u, opts)}`;

  // every term in degrees (`(2x + 10)^{\circ} = 70^{\circ}`): the unknown is a plain number
  const all = [...left, ...right];
  if (all.every((t) => (t.u ? t.g !== null && dimsOf(t.g).deg === 1 : t.g !== null && dimsOf(t.g).deg === 1))) {
    const strip = (t: Term): Term => {
      const g = t.g ? stripDegrees(t.g) : null;
      // `x^{\circ}` is x: its coefficient was only the degree sign
      return { ...t, g: t.u && g !== null && isOne(g) ? null : g };
    };
    left = left.map(strip);
    right = right.map(strip);
    writer.write(print());
  }

  // a trig ratio beside the unknown stays written until the unknown is alone (law of sines)
  const isolateFirst = all.some((t) => t.u && t.g !== null && hasTrig(t.g));
  const frozen = (g: G) => isolateFirst && hasTrig(g);
  for (let guard = 0; guard < 12; guard++) {
    const trees = [...left, ...right].map((t) => t.g);
    const next = roundAll(trees, frozen);
    if (!next) break;
    const all2 = [...left, ...right].map((t, i) => ({ ...t, g: next[i] }));
    left = all2.slice(0, left.length);
    right = all2.slice(left.length);
    writer.write(print(), true);
  }
  // collect: the numbers on each side into one, the unknown's terms into one
  // (each merged term stands where the first of its kind was: `49 = 89 - 80\cos C`)
  const collectSide = (terms: Term[]): Term[] => {
    const us = terms.filter((t) => t.u);
    const atoms = terms.filter((t) => !t.u && atom(t.g));
    let uMerged: Term | null = null;
    let kMerged: Term | null = null;
    if (us.length > 1) {
      if (!us.every((t) => atom(t.g))) refuse();
      uMerged = coefTerm(us.map((t) => (t.neg ? vNeg(valOf(t.g)) : valOf(t.g))).reduce((a, b) => addV(a, b)));
    }
    if (atoms.length > 1) {
      const c = atoms.map((t) => (t.neg ? vNeg(valOf(t.g)) : valOf(t.g))).reduce((a, b) => addV(a, b));
      kMerged = { neg: vNum(c) < 0, u: false, g: gVal(vNum(c) < 0 ? vNeg(c) : c), uFirst: false };
    }
    const out: Term[] = [];
    for (const t of terms) {
      if (t.u && uMerged) {
        if (t === us[0]) out.push(uMerged);
        continue;
      }
      if (!t.u && atom(t.g) && kMerged) {
        if (t === atoms[0]) out.push(kMerged);
        continue;
      }
      out.push(t);
    }
    const kept = out.filter((t) => t.u || !(atom(t.g) && vNum(valOf(t.g)) === 0));
    return kept.length > 0 ? kept : out.slice(0, 1);
  };
  const cl = collectSide(left);
  const cr = collectSide(right);
  if (cl.length !== left.length || cr.length !== right.length) {
    left = cl;
    right = cr;
    writer.write(print());
  }

  // move: the unknown alone on the left with a positive coefficient, the numbers on the right
  const coefOf = (terms: Term[]): { g: G | null; val: Val | null; neg: boolean } | null => {
    const t = terms.find((x) => x.u);
    if (!t) return null;
    return { g: t.g, val: atom(t.g) ? valOf(t.g) : null, neg: t.neg };
  };
  const cL = coefOf(left);
  const cR = coefOf(right);
  const kL = left.filter((t) => !t.u);
  const kR = right.filter((t) => !t.u);
  let A: G | null;
  let flip: boolean;
  if (cL && cR) {
    if (!cL.val || !cR.val) return null;
    const a = vSub(cL.neg ? vNeg(cL.val) : cL.val, cR.neg ? vNeg(cR.val) : cR.val);
    if (vNum(a) === 0) return null;
    flip = vNum(a) < 0;
    A = gVal(flip ? vNeg(a) : a);
  } else if (cL) {
    flip = cL.neg;
    A = cL.g;
  } else if (cR) {
    flip = !cR.neg;
    A = cR.g;
  } else return null;
  // B = (the other side's numbers) - (the unknown side's numbers), as written
  const [from, to] = flip ? [kR, kL] : [kL, kR];
  const moved: Term[] = [...to, ...from.map((t) => ({ ...t, neg: !t.neg }))];
  if (flip && !cL && cR) {
    // `169 = c^{2}`: the unknown's side becomes the left, nothing crosses
  }
  const Aone = A === null || isOne(A);
  const uText = uLatex(kind, u, opts);
  const aText = (g: G | null) => (g === null || isOne(g) ? uText : termLatex({ neg: false, u: true, g, uFirst: Boolean(g && !isPlainNumber(unparen(g))) }, kind, u, opts));
  const bG = (terms: Term[]): G => (terms.length === 0 ? gNum(0) : terms.length === 1 && !terms[0].neg ? terms[0].g! : { k: "add", items: terms.map((t) => ({ neg: t.neg, g: t.g! })) });
  let B: G = bG(moved);
  if (cL && cR) {
    // `2x - x = 70^{\circ} - 30^{\circ}`: the unknown's terms to one side, the numbers to the other, as written
    // (the side that keeps its sign is the one the unknown ends on: `5x - 3x = 10 + 30` from `3x + 10 = 5x - 30`)
    const [keep, cross] = flip ? [cR, cL] : [cL, cR];
    const termOf = (c: typeof cL, neg: boolean): Term => ({ neg, u: true, g: c.g, uFirst: Boolean(c.g && !isPlainNumber(unparen(c.g))) });
    writer.write(`${sideLatex([termOf(keep, keep.neg), termOf(cross, !cross.neg)], kind, u, opts)} = ${gLatex(B, opts)}`, true);
  }
  if (kL.length > 0 && kR.length > 0 && !(cL && cR)) writer.write(`${aText(A)} = ${gLatex(B, opts)}`);
  let worked = 0;
  for (let guard = 0; guard < 12; guard++) {
    const next = frozen(B) ? null : reduceOnce(B);
    if (!next) break;
    B = next;
    worked++;
    writer.write(`${aText(A)} = ${gLatex(B, opts)}`, true);
  }
  // `5x - 2x = 9` → `3x = 9`: the unknown's terms collected, before dividing
  if (cL && cR && worked === 0 && !Aone) writer.write(`${aText(A)} = ${gLatex(B, opts)}`);

  // divide by the coefficient
  let V: G = B;
  if (!Aone) {
    const Ag = A!;
    const div: G = { k: "div", num: B, den: Ag };
    const exactA = atom(Ag) && atom(B);
    if (exactA && vIsRational(vDimless(valOf(Ag)))) {
      V = gVal(divV(valOf(B), valOf(Ag)));
    } else if (exactA && nestedFraction(gLatex(div, opts))) {
      // `\frac{36\pi}{\frac{4\pi}{3}}` is not a line anyone writes: the quotient at once
      V = gVal(vDiv(valOf(B), valOf(Ag)));
    } else {
      writer.write(`${uText} = ${gLatex(div, opts)}`);
      if (exactA && valOf(Ag).terms.length === 1 && valOf(Ag).terms[0].rad !== 1 && valOf(Ag).terms[0].pi === 0 && vIsRational(valOf(B))) {
        // `\frac{10}{\sqrt{2}}` → `\frac{10\sqrt{2}}{2}`: the root out of the denominator
        const t = valOf(Ag).terms[0];
        const root: G = { k: "root", arg: gNum(t.rad), n: 2 };
        const top: G = { k: "mul", items: [B, root] };
        const bottom = gVal(vQ(q(t.c.n * t.rad, t.c.d)));
        writer.write(`${uText} = ${gLatex({ k: "div", num: top, den: bottom }, opts)}`, true);
      }
      V = div;
      for (let guard = 0; guard < 16; guard++) {
        const next = reduceOnce(V);
        if (!next) break;
        V = next;
        const text = gLatex(V, opts);
        if (!nestedFraction(text) || atom(V)) writer.write(`${uText} = ${text}`, true);
      }
    }
    if (atom(V)) writer.write(`${uText} = ${gLatex(V, opts)}`);
  } else if (atom(V) && !((kind.kind === "fn" || kind.k > 1) && alone(left, right))) writer.write(`${uText} = ${gLatex(V, opts)}`);

  // the power's positive root, or the ratio's angle
  const name = gLatex(gSym(u), opts);
  let answer: G;
  if (kind.kind === "pow" && kind.k > 1) {
    const value = evalNumber(V).n;
    if (!(value > 0)) return null;
    answer = { k: "root", arg: V, n: kind.k };
    writer.write(`${name} = ${gLatex(answer, opts)}`);
    for (let guard = 0; guard < 12; guard++) {
      const next = reduceOnce(answer);
      if (!next) break;
      answer = next;
      writer.write(`${name} = ${gLatex(answer, opts)}`, !atom(next));
    }
  } else if (kind.kind === "fn") {
    const inv = `a${kind.name}` as InverseFn;
    const v = evalNumber(V).n;
    if (!Number.isFinite(v)) return null;
    if (kind.name !== "tan" && Math.abs(v) > 1 + 1e-12) return null;
    if (opts.triangleAngle && (v <= 0 && kind.name !== "cos")) return null;
    answer = { k: "fn", name: inv, arg: V };
    writer.write(`${name} = ${gLatex(answer, opts)}`);
    try {
      const exactAngle = evalExact(answer, { radians: opts.radians });
      answer = gVal(exactAngle);
      writer.write(`${name} = ${gLatex(answer, opts)}`);
    } catch (e) {
      if (!(e instanceof NotExact)) throw e;
    }
  } else answer = V;

  // the answer: exact, or a decimal with ≈
  let exact: Val | null = null;
  let value: NumValue;
  if (atom(answer)) {
    exact = valOf(answer);
    value = { n: vNum(exact), deg: exact.deg, pi: false };
    if (opts.decimals && (vHasPi(exact) || vHasRoot(exact))) writer.write(`${name} \\approx ${approxLatex(value.n, exact)}`);
  } else {
    value = evalNumber(answer, new Map(), { radians: opts.radians });
    if (!Number.isFinite(value.n)) return null;
    const dims = { deg: value.deg, len: dimsLen(answer) };
    writer.write(`${name} \\approx ${approxLatex(value.n, { deg: dims.deg, len: dims.len, unit: unitName(answer) })}`);
  }

  // checked: the answer back in the equation as the student wrote it
  const scope = new Map<string, NumValue>([[u, { n: value.n, deg: kind.kind === "fn" && !opts.radians ? 0 : value.deg, pi: false }]]);
  if (kind.kind === "fn") scope.set(u, { n: value.n, deg: opts.radians ? 0 : 1, pi: Boolean(opts.radians) });
  const l = evalNumber(L0, scope).n;
  const r = evalNumber(R0, scope).n;
  if (!Number.isFinite(l) || !Number.isFinite(r) || Math.abs(l - r) > 1e-6 * Math.max(1, Math.abs(l), Math.abs(r))) return null;

  const steps = writer.lines(MAX_STEPS);
  if (steps.length === 0) return null;
  return { steps, final: steps[steps.length - 1], value: value.n, exact };
}

/** The unknown's power or ratio alone against one number (`169 = c^{2}`): nothing to write before its root. */
function alone(left: Term[], right: Term[]): boolean {
  const one = (a: Term[], b: Term[]) => a.length === 1 && a[0].u && a[0].g === null && !a[0].neg && b.length === 1 && !b[0].u && atom(b[0].g) && !b[0].neg;
  return one(left, right) || one(right, left);
}

function coefTerm(c: Val): Term {
  const neg = vNum(c) < 0;
  const abs = neg ? vNeg(c) : c;
  const one = vIsRational(abs) && vNum(abs) === 1;
  return { neg, u: true, g: one ? null : gVal(abs), uFirst: !vIsRational(abs) };
}

function addV(a: Val, b: Val): Val {
  return vSub(a, vNeg(b));
}

function divV(a: Val, b: Val): Val {
  const r = vRational(vDimless(b));
  if (!r || r.n === 0) return refuse();
  return { ...vMul(a, vQ(q(r.d, r.n))), deg: a.deg - b.deg, len: a.len - b.len };
}

const nestedFraction = (s: string): boolean => /\\frac\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\\frac/.test(s) || /\\frac\{(?:[^{}]|\{[^{}]*\})*\}\{(?:[^{}]|\{[^{}]*\})*\\frac/.test(s);

function dimsLen(g: G): number {
  let len = 0;
  someNode(g, (x) => {
    if (x.k === "val" && x.v.len !== 0) len = Math.max(len, x.v.len);
    return false;
  });
  return len;
}

function unitName(g: G): string | undefined {
  let unit: string | undefined;
  someNode(g, (x) => {
    if (x.k === "val" && x.v.unit) unit = x.v.unit;
    return false;
  });
  return unit;
}

/** `10.07`, `36.87^{\circ}`, `78.54\,\mathrm{cm}^{2}`. */
export function approxLatex(n: number, dims: { deg: number; len: number; unit?: string }): string {
  const body = decimalLatex(n);
  if (dims.deg === 1) return `${body}^{\\circ}`;
  if (dims.len !== 0 && dims.unit) return `${body}\\,${unitLatex(dims.unit, dims.len)}`;
  return body;
}

export { vLatex };
