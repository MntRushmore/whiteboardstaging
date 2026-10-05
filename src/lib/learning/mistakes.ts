/**
 * What kind of mistake a ringed line is, for the learning record (the Progress page's "mistakes"
 * and the tutor's "Signs tripped you up before").
 *
 * The ringed line is compared with the line above it. The classifier does not guess from the look
 * of the line: it makes each kind of mistake a testable hypothesis and keeps the first that holds —
 * "if this one term's sign were flipped, the line WOULD follow" is a sign slip. Most specific
 * first (a bracket's minus taken to its first term only, `-(x - 3)` → `-x - 3`, is also "one sign
 * off", and distributing is what the student needs to hear about):
 *
 *  1. distribution — the line is what multiplying only the FIRST term in a bracket gives:
 *     `3(x + 2) = 18` → `3x + 2 = 18`, `-(x - 3)` → `-x - 3`
 *  2. sign — flipping one term's sign anywhere in the line (or an inequality's direction) makes it
 *     follow: `2x + 3 = 11` → `2x = 11 + 3`, `-2x > 4` → `x > -2`
 *  3. both_sides — one side of the equation is unchanged while the other had an operation done to it
 *     by a number or a term from the line above: `2x + 3 = 11` → `2x = 11`, `3x = 12` → `x = 12`
 *  4. inverse_operation — a term or factor went across the = with the same operation instead of its
 *     inverse: `x + 5 = 9` → `x = 14`, `2x = 8` → `x = 16`, `3x + 5 = 2x + 9` → `5x + 5 = 9`
 *  5. combining_terms — the line is what adding two unlike terms gives: `3x + 2` → `5x`
 *  6. fractions — the line is what adding fractions across (tops and bottoms) gives:
 *     `\frac{1}{2} + \frac{1}{3}` → `\frac{2}{5}`
 *  7. exponents — the line is what a wrong power rule gives (powers multiplied instead of added, a
 *     power of a power added, a power not applied to the number in front), or it has the right
 *     number in front and the wrong power: `x^{3} \cdot x^{4}` → `x^{12}`
 *  8. arithmetic — changing one number of the line makes it follow (right steps, a number slip)
 *
 * Null when the line follows after all, when the two lines are not the same sort (an equation under
 * an expression), or when none of these explains it.
 *
 * "Follows" is judged numerically, the way a teacher checks: two expressions agree at sample values
 * of their letters; two equations in one unknown have the same roots (exact for degree ≤ 2, by a
 * scan otherwise); two inequalities hold at the same points; an equation in several letters is a
 * multiple of the other. The lines are read with the learning tree reader (`mathTree.ts`), which
 * keeps the structure the hypotheses edit (which term, which bracket), and the classifier speaks
 * only when that reading agrees with the engine's own (`latexToMath` + `compileExpr`, the mathjs
 * reading the board marks lines with) at sample points. The engine's `analyzeLine` is not called:
 * on an equation it solves (5–15 ms), past this classifier's budget of 5 ms a call.
 *
 * Pure apart from the engine; never throws.
 */
import type { LiveEngine } from "@/lib/live/contracts";
import { latexToMath, splitRelations } from "@/lib/live/engine/latex";
import type { MistakeKind } from "./hint";
import {
  allNodes,
  evaluate,
  hasVariable,
  numbersOf,
  readRelation,
  unwrap,
  variablesOf,
  type Node,
  type Override,
  type RelOp,
  type Relation,
  type Scope,
} from "./mathTree";

// ------------------------------------------------------------------ evaluators and sampling

type Ev = (s: Scope) => number;

const ev =
  (node: Node, override?: Override): Ev =>
  (s) =>
    evaluate(node, s, override);

/** Off-integer sample values (no 0, 1 or small integers, where expressions vanish or divide by zero). */
const SAMPLES = [0.731, -1.413, 2.217, 3.119, -0.587, 1.673];

function scopesFor(vars: readonly string[]): Scope[] {
  return SAMPLES.map((base, k) => Object.fromEntries(vars.map((v, j) => [v, base + 0.37 * j * (k % 2 === 0 ? 1 : -1)])));
}

function near(a: number, b: number, tol = 1e-7): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Two expressions agree wherever both are defined (at least three of the sample points). */
function sameValues(a: Ev, b: Ev, scopes: readonly Scope[]): boolean {
  let agreed = 0;
  for (const s of scopes) {
    const va = a(s);
    const vb = b(s);
    const fa = Number.isFinite(va);
    const fb = Number.isFinite(vb);
    if (fa !== fb) return false;
    if (!fa) continue;
    if (!near(va, vb)) return false;
    agreed++;
  }
  return agreed >= 3;
}

/** `a - b` is the same number at every sample point: that number, else null. */
function constantDifference(a: Ev, b: Ev, scopes: readonly Scope[]): number | null {
  let d: number | null = null;
  for (const s of scopes) {
    const v = a(s) - b(s);
    if (!Number.isFinite(v)) continue;
    if (d === null) d = v;
    else if (!near(v, d, 1e-6)) return null;
  }
  return d;
}

/** `a / b` is the same number at every sample point: that number, else null. */
function constantRatio(a: Ev, b: Ev, scopes: readonly Scope[]): number | null {
  let q: number | null = null;
  for (const s of scopes) {
    const vb = b(s);
    if (Math.abs(vb) < 1e-12) continue;
    const v = a(s) / vb;
    if (!Number.isFinite(v)) continue;
    if (q === null) q = v;
    else if (!near(v, q, 1e-6)) return null;
  }
  return q;
}

// ------------------------------------------------------------------ "follows"

interface Rel {
  l: Ev;
  r: Ev;
  op: RelOp;
}

const FLIP: Partial<Record<RelOp, RelOp>> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };

/** The real roots of g in one letter: exact for a polynomial of degree ≤ 2, else by a sign-change scan; "all" when g is 0 everywhere. */
function rootsOf(g: (x: number) => number): number[] | "all" | null {
  const c = g(0);
  const p1 = g(1);
  const m1 = g(-1);
  if ([c, p1, m1].every(Number.isFinite)) {
    const a = (p1 + m1) / 2 - c;
    const b = (p1 - m1) / 2;
    const fits = [2, 3, -2, 0.5, -3.5].every((x) => {
      const v = g(x);
      return Number.isFinite(v) && near(v, a * x * x + b * x + c, 1e-9);
    });
    if (fits) {
      const scale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c));
      if (Math.abs(a) < 1e-12 * scale) {
        if (Math.abs(b) < 1e-12 * scale) return Math.abs(c) < 1e-12 * scale ? "all" : [];
        return [-c / b];
      }
      const disc = b * b - 4 * a * c;
      if (disc < -1e-12 * scale * scale) return [];
      if (Math.abs(disc) <= 1e-12 * scale * scale) return [-b / (2 * a)];
      const sq = Math.sqrt(disc);
      return [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].sort((x, y) => x - y);
    }
  }
  // a scan from -60 to 60 for sign changes, each closed in on by bisection
  const roots: number[] = [];
  let px = -60;
  let pv = g(px);
  for (let i = 1; i <= 240; i++) {
    const x = -60 + i * 0.5;
    const v = g(x);
    if (Number.isFinite(v) && Math.abs(v) < 1e-12) roots.push(x);
    else if (Number.isFinite(pv) && Number.isFinite(v) && Math.sign(v) !== Math.sign(pv) && Math.abs(pv) > 1e-12) {
      let lo = px;
      let hi = x;
      let lv = pv;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        const mv = g(mid);
        if (!Number.isFinite(mv)) break;
        if (Math.sign(mv) === Math.sign(lv)) {
          lo = mid;
          lv = mv;
        } else hi = mid;
      }
      const r = (lo + hi) / 2;
      // a pole (1/x) changes sign too: a root has a small value there
      if (Math.abs(g(r)) < 1e-6) roots.push(r);
    }
    px = x;
    pv = v;
  }
  return roots.length > 24 ? null : roots;
}

function sameRoots(a: number[] | "all", b: number[] | "all"): boolean {
  if (a === "all" || b === "all") return a === b;
  const uniq = (rs: number[]) => rs.filter((r, i) => i === 0 || !near(r, rs[i - 1], 1e-6));
  const ua = uniq(a);
  const ub = uniq(b);
  return ua.length === ub.length && ua.every((r, i) => near(r, ub[i], 1e-6));
}

/** True when the relation `c` says the same as `p`; null when that cannot be told. */
function relationsAgree(p: Rel, c: Rel, vars: readonly string[], scopes: readonly Scope[]): boolean | null {
  const gp: Ev = (s) => p.l(s) - p.r(s);
  const gc: Ev = (s) => c.l(s) - c.r(s);
  if ((p.op === "=") !== (c.op === "=")) return false;
  if (p.op === "=") {
    if (vars.length === 1) {
      const v = vars[0];
      const rp = rootsOf((x) => gp({ [v]: x }));
      const rc = rootsOf((x) => gc({ [v]: x }));
      if (rp !== null && rc !== null) return sameRoots(rp, rc);
    }
    // in several letters: one is a multiple of the other
    const k = constantRatio(gc, gp, scopes);
    return k !== null && Math.abs(k) > 1e-9 ? true : vars.length === 1 ? false : null;
  }
  if (vars.length !== 1) return null;
  // inequalities: true at the same points of a grid (off the integers, away from boundaries)
  const holds = (op: RelOp, v: number) => (op === "<" ? v < 0 : op === ">" ? v > 0 : op === "<=" ? v <= 0 : op === ">=" ? v >= 0 : v !== 0);
  const name = vars[0];
  let compared = 0;
  for (let x = -30.13; x <= 30; x += 0.371) {
    const a = gp({ [name]: x });
    const b = gc({ [name]: x });
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (holds(p.op, a) !== holds(c.op, b)) return false;
    compared++;
  }
  return compared >= 10;
}

// ------------------------------------------------------------------ the two lines

interface Pair {
  mode: "expression" | "relation";
  /** expression mode: the expressions; relation mode: the left and right sides */
  p: Node[];
  c: Node[];
  op: RelOp;
  cOp: RelOp;
  vars: string[];
  scopes: Scope[];
  /** the numbers of the line above (for "an operation by a number from the line above") */
  pNumbers: number[];
}

/** Every side of the relation is the same expression (a chain of equal expressions, not an equation to solve). */
function isIdentity(r: Relation): boolean {
  const sides = r.sides.filter((s): s is Node => s !== null);
  if (sides.length < 2) return false;
  const scopes = scopesFor([...new Set(sides.flatMap((s) => variablesOf(s)))]);
  return sides.every((s) => sameValues(ev(sides[0]), ev(s), scopes));
}

function lastSide(r: Relation): Node | null {
  for (let i = r.sides.length - 1; i >= 0; i--) if (r.sides[i]) return r.sides[i];
  return null;
}

/** The two lines as a pair to compare: two expressions (a chain, `= …`), or two relations. Null when they are not comparable. */
function pairOf(previousLatex: string, latex: string): Pair | null {
  const prevTex = previousLatex.trim().replace(/=\s*$/, "");
  const curTex = latex.trim();
  const p = readRelation(prevTex);
  const continuation = /^=/.test(curTex);
  const c = readRelation(continuation ? curTex.replace(/^=\s*/, "") : curTex);
  if (!p || !c) return null;
  // a chain written on one line (`4(2x - 1) - 3x = 8x - 4 - 3x`) continued by an expression: its last side is the line above
  const chain = !continuation && c.ops.length === 0 && p.ops.length > 0 && p.ops.every((o) => o === "=") && isIdentity(p);
  if (continuation || chain || p.ops.length === 0) {
    const pe = lastSide(p);
    const ce = lastSide(c);
    if (!pe || !ce || (c.ops.length > 0 && c.ops.some((o) => o !== "="))) return null;
    return finish("expression", [pe], [ce], "=", "=");
  }
  if (p.ops.length !== 1 || c.ops.length !== 1 || !p.sides[0] || !p.sides[1] || !c.sides[0] || !c.sides[1]) return null;
  if (p.ops[0] === "!=" || c.ops[0] === "!=") return null;
  return finish("relation", [p.sides[0], p.sides[1]], [c.sides[0], c.sides[1]], p.ops[0], c.ops[0]);

  function finish(mode: Pair["mode"], pn: Node[], cn: Node[], op: RelOp, cOp: RelOp): Pair | null {
    const vars = [...new Set([...pn, ...cn].flatMap((n) => variablesOf(n)))];
    if (vars.length > 3) return null;
    const pNumbers = [...new Set(pn.flatMap((n) => numbersOf(n).map((x) => Math.abs(x.v))))].filter((x) => x !== 0);
    return { mode, p: pn, c: cn, op, cOp, vars, scopes: scopesFor(vars), pNumbers };
  }
}

/** True when the candidate line (its sides as evaluators) follows from the line above. */
function follows(pair: Pair, pSides: Ev[], cSides: Ev[], cOp: RelOp = pair.cOp): boolean {
  if (pair.mode === "expression") return sameValues(pSides[0], cSides[0], pair.scopes);
  return relationsAgree({ l: pSides[0], r: pSides[1], op: pair.op }, { l: cSides[0], r: cSides[1], op: cOp }, pair.vars, pair.scopes) === true;
}

const sidesOf = (nodes: readonly Node[], override?: Override): Ev[] => nodes.map((n) => ev(n, override));

/** Every node of the given sides. */
function nodesIn(sides: readonly Node[]): Node[] {
  const out: Node[] = [];
  for (const s of sides) allNodes(s, out);
  return out;
}

// ------------------------------------------------------------------ does our reading agree with the engine's?

/**
 * The engine's reading of each side (mathjs, as the board marks lines) against ours, at three
 * points. False when they disagree anywhere (the classifier then says nothing); sides the engine
 * cannot compile alone (several letters, units) are not compared.
 */
function engineAgrees(engine: LiveEngine, latex: string, sides: readonly Node[]): boolean {
  let parts: string[];
  try {
    parts = splitRelations(latex.trim().replace(/^=\s*/, "").replace(/=\s*$/, "")).sides.filter((s) => s.trim() !== "");
  } catch {
    return true;
  }
  if (parts.length !== sides.length) return true;
  for (let i = 0; i < parts.length; i++) {
    const vars = variablesOf(sides[i]);
    if (vars.length > 1) continue;
    let source: string;
    try {
      const t = latexToMath(parts[i]);
      if (t.variables.length > 1 || t.hasUnits || t.hasPm) continue;
      source = t.source;
      const v = t.variables[0];
      if (v && v !== "x") {
        if (!/^[A-Za-z]$/.test(v)) continue;
        source = source.replace(new RegExp(`\\b${v}\\b`, "g"), "x");
      }
    } catch {
      continue;
    }
    const f = engine.compileExpr(source);
    if (!f) continue;
    const name = vars[0] ?? "x";
    for (const x of [0.731, -1.413, 2.217]) {
      const theirs = f(x);
      const ours = evaluate(sides[i], { [name]: x });
      if (Number.isFinite(theirs) && Number.isFinite(ours) && !near(theirs, ours, 1e-6)) return false;
    }
  }
  return true;
}

// ------------------------------------------------------------------ the hypotheses

/** 1. Flipping one term's sign (or the inequality) makes the line follow. */
function signSlip(pair: Pair): boolean {
  const p = sidesOf(pair.p);
  if (pair.mode === "relation" && pair.cOp !== "=") {
    const flipped = FLIP[pair.cOp];
    if (flipped && follows(pair, p, sidesOf(pair.c), flipped)) return true;
  }
  // a side that is one term: its sign
  for (let i = 0; i < pair.c.length; i++) {
    const side = pair.c[i];
    if (side.t === "add") continue;
    const cand = sidesOf(pair.c);
    cand[i] = (s) => -evaluate(side, s);
    if (follows(pair, p, cand)) return true;
  }
  let tried = 0;
  for (const node of nodesIn(pair.c)) {
    if (node.t !== "add") continue;
    for (let k = 0; k < node.terms.length; k++) {
      if (++tried > 24) return false;
      const override: Override = (n, s) => {
        if (n !== node) return undefined;
        let sum = 0;
        node.terms.forEach((t, j) => {
          const v = evaluate(t.node, s);
          sum += (t.neg !== (j === k)) ? -v : v;
        });
        return sum;
      };
      if (follows(pair, p, sidesOf(pair.c, override))) return true;
    }
  }
  return false;
}

/** The candidate lines above with one node's value replaced (as evaluators). */
function withOverride(pair: Pair, override: Override): Ev[] {
  return sidesOf(pair.p, override);
}

/** True when the student's line says what the candidate line above says (and the candidate differs from the real one). */
function matches(pair: Pair, candidate: Ev[]): boolean {
  const c = sidesOf(pair.c);
  if (pair.mode === "expression") return sameValues(candidate[0], c[0], pair.scopes) && !sameValues(candidate[0], sidesOf(pair.p)[0], pair.scopes);
  const cand: Pair = pair;
  return follows(cand, candidate, c) && !follows(cand, candidate, sidesOf(pair.p), pair.op);
}

/** 2. Only the first term in a bracket was multiplied. */
function distribution(pair: Pair): boolean {
  for (const node of nodesIn(pair.p)) {
    if (node.t === "mul") {
      const k = node.factors.findIndex((f) => !f.div && f.node.t === "paren" && unwrap(f.node).t === "add");
      if (k === -1 || node.factors.length < 2) continue;
      const inner = unwrap(node.factors[k].node);
      if (inner.t !== "add" || inner.terms.length < 2) continue;
      const override: Override = (n, s) => {
        if (n !== node) return undefined;
        let m = 1;
        node.factors.forEach((f, j) => {
          if (j === k) return;
          const v = evaluate(f.node, s);
          m = f.div ? m / v : m * v;
        });
        return inner.terms.reduce((sum, t, j) => {
          const v = (t.neg ? -1 : 1) * evaluate(t.node, s);
          return sum + (j === 0 ? m * v : v);
        }, 0);
      };
      if (matches(pair, withOverride(pair, override))) return true;
    }
    if (node.t === "add") {
      // -(x - 3) → -x - 3: the minus taken to the first term only
      for (let k = 0; k < node.terms.length; k++) {
        const term = node.terms[k];
        const inner = term.node.t === "paren" ? unwrap(term.node) : null;
        if (!term.neg || !inner || inner.t !== "add" || inner.terms.length < 2) continue;
        const override: Override = (n, s) => {
          if (n !== node) return undefined;
          return node.terms.reduce((sum, t, j) => {
            if (j !== k) return sum + (t.neg ? -1 : 1) * evaluate(t.node, s);
            return sum + inner.terms.reduce((acc, it, i) => acc + (i === 0 ? -1 : 1) * (it.neg ? -1 : 1) * evaluate(it.node, s), 0);
          }, 0);
        };
        if (matches(pair, withOverride(pair, override))) return true;
      }
    }
  }
  return false;
}

function isOperand(pair: Pair, value: number): boolean {
  const a = Math.abs(value);
  return a > 1e-12 && pair.pNumbers.some((n) => near(n, a, 1e-9));
}

/** The terms of the line above (every term of every sum, and each side), as evaluators: what an operation "by a term" can use. */
function termsAbove(pair: Pair): Ev[] {
  const out: Ev[] = sidesOf(pair.p);
  for (const n of nodesIn(pair.p)) if (n.t === "add") for (const t of n.terms) out.push(ev(t.node));
  return out.slice(0, 24);
}

/** 3. One side unchanged; the other had an operation done to it by a number or a term from the line above. */
function bothSides(pair: Pair): boolean {
  if (pair.mode !== "relation" || pair.op !== "=" || pair.cOp !== "=") return false;
  const [l1, r1] = sidesOf(pair.p);
  const [l2, r2] = sidesOf(pair.c);
  const terms = termsAbove(pair);
  const changedBy = (before: Ev, after: Ev) => {
    const d = constantDifference(before, after, pair.scopes);
    if (d !== null && isOperand(pair, d)) return true;
    // 3x + 5 = 2x + 9 → x + 5 = 2x + 9: 2x taken from one side only
    const diff: Ev = (s) => before(s) - after(s);
    if (d === null && terms.some((t) => sameValues(diff, t, pair.scopes) || sameValues(diff, (s) => -t(s), pair.scopes))) return true;
    const q = constantRatio(before, after, pair.scopes);
    return q !== null && !near(q, 1) && (isOperand(pair, q) || isOperand(pair, 1 / q));
  };
  if (sameValues(l1, l2, pair.scopes) && !sameValues(r1, r2, pair.scopes)) return changedBy(r1, r2);
  if (sameValues(r1, r2, pair.scopes) && !sameValues(l1, l2, pair.scopes)) return changedBy(l1, l2);
  return false;
}

/** 4. What left one side went to the other with the same operation, not its inverse. */
function inverseOperation(pair: Pair): boolean {
  if (pair.mode !== "relation" || pair.op !== "=" || pair.cOp !== "=") return false;
  const [l1, r1] = sidesOf(pair.p);
  const [l2, r2] = sidesOf(pair.c);
  const zero: Ev = () => 0;
  const one: Ev = () => 1;
  // additive: x + 5 = 9 → x = 14, 3x + 5 = 2x + 9 → 5x + 5 = 9 (what left one side arrived on the other with its sign)
  const dl: Ev = (s) => l1(s) - l2(s);
  const dr: Ev = (s) => r2(s) - r1(s);
  if (!sameValues(dl, zero, pair.scopes) && sameValues(dl, dr, pair.scopes)) return true;
  // multiplicative: 2x = 8 → x = 16 (the left divided by 2, the right multiplied by 2)
  const ql: Ev = (s) => l1(s) / l2(s);
  const qr: Ev = (s) => r2(s) / r1(s);
  return !sameValues(ql, one, pair.scopes) && sameValues(ql, qr, pair.scopes);
}

/** A term's number in front (its value with every letter 1) and its letters (`3x^{2}` → 3 and x²), or null. */
function monomial(node: Node, neg: boolean): { coef: number; key: string; part: Ev } | null {
  const vars = variablesOf(node);
  const ones = Object.fromEntries(vars.map((v) => [v, 1]));
  const coef = (neg ? -1 : 1) * evaluate(node, ones);
  if (!Number.isFinite(coef) || Math.abs(coef) < 1e-12) return null;
  // its letters and powers, from how it grows with each letter
  const powers: string[] = [];
  for (const v of vars) {
    const at = (x: number) => Math.abs(evaluate(node, { ...ones, [v]: x }));
    const p = Math.log(at(3) / at(2)) / Math.log(1.5);
    if (!Number.isFinite(p) || !near(at(5) / at(2), Math.pow(2.5, p), 1e-6)) return null;
    const rounded = Math.round(p * 1000) / 1000;
    if (rounded !== 0) powers.push(`${v}^${rounded}`);
  }
  return { coef, key: powers.join(""), part: (s) => evaluate(node, s) / ((neg ? -1 : 1) * coef) };
}

/** 5. Two unlike terms added as if alike: 3x + 2 → 5x. */
function combiningTerms(pair: Pair): boolean {
  for (const node of nodesIn(pair.p)) {
    if (node.t !== "add" || node.terms.length < 2 || node.terms.length > 8) continue;
    const monos = node.terms.map((t) => monomial(t.node, t.neg));
    for (let i = 0; i < monos.length; i++) {
      for (let j = i + 1; j < monos.length; j++) {
        const a = monos[i];
        const b = monos[j];
        if (!a || !b || a.key === b.key) continue;
        for (const part of [a.part, b.part]) {
          const override: Override = (n, s) => {
            if (n !== node) return undefined;
            let sum = (a.coef + b.coef) * part(s);
            node.terms.forEach((t, k) => {
              if (k !== i && k !== j) sum += (t.neg ? -1 : 1) * evaluate(t.node, s);
            });
            return sum;
          };
          if (matches(pair, withOverride(pair, override))) return true;
        }
      }
    }
  }
  return false;
}

/** 6. Fractions added across (tops and bottoms), or over one bottom, or over the product of the bottoms. */
function fractionSlip(pair: Pair): boolean {
  for (const node of nodesIn(pair.p)) {
    if (node.t !== "add") continue;
    const fracs = node.terms.map((t, k) => ({ t, k })).filter(({ t }) => unwrap(t.node).t === "frac");
    for (let x = 0; x < fracs.length; x++) {
      for (let y = x + 1; y < fracs.length; y++) {
        const fa = unwrap(fracs[x].t.node) as Extract<Node, { t: "frac" }>;
        const fb = unwrap(fracs[y].t.node) as Extract<Node, { t: "frac" }>;
        const sa = fracs[x].t.neg ? -1 : 1;
        const sb = fracs[y].t.neg ? -1 : 1;
        const tops = (s: Scope) => sa * evaluate(fa.num, s) + sb * evaluate(fb.num, s);
        const bottoms: ((s: Scope) => number)[] = [
          (s) => evaluate(fa.den, s) + evaluate(fb.den, s),
          // taken away across: 5/6 − 1/4 → 4/2
          (s) => sa * evaluate(fa.den, s) + sb * evaluate(fb.den, s),
          (s) => evaluate(fa.den, s) * evaluate(fb.den, s),
          (s) => evaluate(fa.den, s),
          (s) => evaluate(fb.den, s),
        ];
        for (const bottom of bottoms) {
          const override: Override = (n, s) => {
            if (n !== node) return undefined;
            let sum = tops(s) / bottom(s);
            node.terms.forEach((t, k) => {
              if (k !== fracs[x].k && k !== fracs[y].k) sum += (t.neg ? -1 : 1) * evaluate(t.node, s);
            });
            return sum;
          };
          if (matches(pair, withOverride(pair, override))) return true;
        }
      }
    }
  }
  return false;
}

/** A power's base and exponent (a letter alone is its first power). */
function powerParts(node: Node): { base: Node; exp: (s: Scope) => number; key: string } | null {
  const n = unwrap(node);
  const keyOf = (b: Node) => {
    const u = unwrap(b);
    return u.t === "var" ? u.name : u.t === "num" ? `#${u.v}` : null;
  };
  if (n.t === "pow") {
    const key = keyOf(n.base);
    return key ? { base: n.base, exp: (s) => evaluate(n.exp, s), key } : null;
  }
  if (n.t === "var") return { base: n, exp: () => 1, key: n.name };
  return null;
}

/** 7. A wrong power rule, or the right number in front with the wrong power. */
function exponentSlip(pair: Pair): boolean {
  for (const node of nodesIn(pair.p)) {
    // x^{3} · x^{4} → x^{12} (powers multiplied); 2^{3} · 2^{4} → 4^{7} (bases multiplied)
    if (node.t === "mul") {
      const parts = node.factors.map((f) => (f.div ? null : powerParts(f.node)));
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i];
          const b = parts[j];
          if (!a || !b || a.key !== b.key) continue;
          const rest = (s: Scope) =>
            node.factors.reduce((m, f, k) => (k === i || k === j ? m : f.div ? m / evaluate(f.node, s) : m * evaluate(f.node, s)), 1);
          const wrong: ((s: Scope) => number)[] = [
            (s) => Math.pow(evaluate(a.base, s), a.exp(s) * b.exp(s)),
            (s) => Math.pow(evaluate(a.base, s) * evaluate(b.base, s), a.exp(s) + b.exp(s)),
          ];
          for (const w of wrong) if (matches(pair, withOverride(pair, (n, s) => (n === node ? rest(s) * w(s) : undefined)))) return true;
        }
      }
    }
    if (node.t === "pow") {
      const inner = unwrap(node.base);
      // (x^{2})^{3} → x^{5} (powers added)
      if (inner.t === "pow") {
        const w = (s: Scope) => Math.pow(evaluate(inner.base, s), evaluate(inner.exp, s) + evaluate(node.exp, s));
        if (matches(pair, withOverride(pair, (n, s) => (n === node ? w(s) : undefined)))) return true;
      }
      // (2x^{3})^{2} → 2x^{6} (the power not applied to the number in front)
      if (inner.t === "mul") {
        const k = inner.factors.findIndex((f) => !f.div && !hasVariable(f.node));
        if (k !== -1 && hasVariable(inner)) {
          const w = (s: Scope) =>
            evaluate(inner.factors[k].node, s) *
            Math.pow(
              inner.factors.reduce((m, f, j) => (j === k ? m : f.div ? m / evaluate(f.node, s) : m * evaluate(f.node, s)), 1),
              evaluate(node.exp, s),
            );
          if (matches(pair, withOverride(pair, (n, s) => (n === node ? w(s) : undefined)))) return true;
        }
      }
    }
    // x^{6} / x^{2} → x^{3} (powers divided)
    if (node.t === "frac") {
      const a = powerParts(node.num);
      const b = powerParts(node.den);
      if (a && b && a.key === b.key) {
        const w = (s: Scope) => Math.pow(evaluate(a.base, s), a.exp(s) / b.exp(s));
        if (matches(pair, withOverride(pair, (n, s) => (n === node ? w(s) : undefined)))) return true;
      }
    }
  }
  // the right number in front and the wrong power: x^{3} · x^{4} → x^{12}
  if (pair.mode === "expression" && pair.vars.length > 0) {
    const a = monomial(pair.p[0], false);
    const b = monomial(pair.c[0], false);
    if (a && b && near(a.coef, b.coef, 1e-9) && a.key !== b.key) return true;
  }
  return false;
}

/** 8. Changing one number of the line makes it follow. */
function arithmeticSlip(pair: Pair): boolean {
  const p = sidesOf(pair.p);
  const nums = nodesIn(pair.c).filter((n): n is Extract<Node, { t: "num" }> => n.t === "num").slice(0, 12);
  // the point to solve for the right number at: a sample point, or a root of the line above
  let at: Scope | null = pair.scopes[0];
  if (pair.mode === "relation") {
    if (pair.vars.length !== 1) return false;
    const v = pair.vars[0];
    const roots = rootsOf((x) => p[0]({ [v]: x }) - p[1]({ [v]: x }));
    if (!roots || roots === "all" || roots.length === 0) at = null;
    else at = { [v]: roots[roots.length - 1] };
  }
  if (!at) return false;
  const point = at;
  for (const num of nums) {
    const withValue = (tau: number) => sidesOf(pair.c, (n) => (n === num ? tau : undefined));
    const gap = (tau: number) => {
      const sides = withValue(tau);
      return pair.mode === "expression" ? sides[0](point) - p[0](point) : sides[0](point) - sides[1](point);
    };
    // the number that closes the gap, by two secant steps
    let t0 = num.v;
    let t1 = num.v + 1;
    let g0 = gap(t0);
    let g1 = gap(t1);
    for (let k = 0; k < 2 && Number.isFinite(g0) && Number.isFinite(g1) && Math.abs(g1 - g0) > 1e-12; k++) {
      const t2 = t1 - (g1 * (t1 - t0)) / (g1 - g0);
      t0 = t1;
      g0 = g1;
      t1 = t2;
      g1 = gap(t1);
    }
    const tau = t1;
    if (!Number.isFinite(tau) || near(tau, num.v, 1e-9)) continue;
    if (follows(pair, p, withValue(tau))) return true;
  }
  return false;
}

/**
 * A ringed line compared with the line above it (both as read, LaTeX): `sign` when flipping one
 * term's sign makes it right, `distribution` when only the first term in brackets was multiplied,
 * and so on (`MISTAKE_KINDS`). Null when it cannot tell. Pure apart from the engine, < 5 ms.
 */
export function classifyMistake(engine: LiveEngine, previousLatex: string, latex: string): MistakeKind | null {
  try {
    if (typeof previousLatex !== "string" || typeof latex !== "string" || previousLatex.length > 400 || latex.length > 400) return null;
    const pair = pairOf(previousLatex, latex);
    if (!pair) return null;
    // the line follows after all: no mistake to name
    if (follows(pair, sidesOf(pair.p), sidesOf(pair.c))) return null;
    if (!engineAgrees(engine, previousLatex, pair.p) || !engineAgrees(engine, latex, pair.c)) return null;
    if (distribution(pair)) return "distribution";
    if (signSlip(pair)) return "sign";
    if (bothSides(pair)) return "both_sides";
    if (inverseOperation(pair)) return "inverse_operation";
    if (combiningTerms(pair)) return "combining_terms";
    if (fractionSlip(pair)) return "fractions";
    if (exponentSlip(pair)) return "exponents";
    if (arithmeticSlip(pair)) return "arithmetic";
    return null;
  } catch {
    return null;
  }
}

/** A check annotation's kind as a mistake kind; null for kinds that are not mistakes (praise, notation, incomplete). */
export function mistakeFromAnnotation(kind: string): MistakeKind | null {
  switch (kind) {
    case "arithmetic":
    case "sign":
    case "algebra":
    case "units":
    case "concept":
      return kind;
    default:
      return null;
  }
}
