/**
 * "The tutor writes it out" (docs/TUTOR-WRITES.md): when a kid is stuck, the tutor writes the NEXT
 * step of their work in its own hand, one step per ask, like a teacher at the whiteboard. This file
 * decides WHAT that step is, and refuses when it cannot prove it. Pure: no editor, no ink, no model.
 *
 *     2x + 3 = 11        the kid's work (and the tutor's own steps already written under it)
 *     2x = 8             ← one ask: "Subtract 3 from both sides."
 *     x = 4              ← the last step: only on a further ask, and only when answers are allowed
 *
 * The step always goes on from the kid's LAST RIGHT LINE (a slip under it is set aside: the right
 * step is what they should have written instead). Where it comes from:
 *
 *  - an equation or inequality: the engine's own teacher-style solve (`localSolve`), its first step
 *    that is not already on the board;
 *  - fraction arithmetic (`\frac{1}{2} + \frac{1}{3} =`): the classroom steps, one at a time — a
 *    common denominator, add the numerators, simplify; multiply across; flip and multiply; mixed
 *    numbers written as fractions first (`fractionNext`);
 *  - a whole-number product (`23 \times 4 =`): split by place value, multiply the parts, add them;
 *  - anything else the engine finishes (`nextStep`, `simplifySteps`, the line's result).
 *
 * ACCURACY IS THE POINT. Every candidate is CHECKED by the engine before it is offered
 * (`checkStep`): a relation must be equivalent to the line it follows (`analyzeLine` with that line
 * as `previous`, verdict `ok`), an expression must equal it, and it must be new (not a line already
 * written). A step the engine cannot vouch for is never written: the result is `unsure`, and the
 * board says so kindly instead. The same check is what a model's step must pass (`checkStep`).
 *
 * THE ANSWER. A step that is the final answer (`x = 4`, `\frac{5}{6}`, `92`) is held back unless
 * `answer` says the kid asked again for it and the grown-ups allow answers: `lastStep`, with words
 * that say what to do but never the answer itself.
 */
import type { AnalyzeContext, LineAnalysis, LiveEngine } from "./contracts";
import { analyzeColumn, localSolve } from "./localSolve";
import { stepKey } from "./solveSteps";

export interface TutorStepArgs {
  /** the problem heading the work (the tutor's problem lines on a problem page), if any */
  problem?: string[];
  /** the work under it, top to bottom, as read: the kid's lines and the tutor's own steps among them */
  work: string[];
  /** the final answer may be written: the kid asked for it, and the grown-ups allow answers */
  answer?: boolean;
  /**
   * How far each line of `work` is trusted as read (the messy-handwriting guard): `sure` (read with
   * no doubt), `unsure` (a low-confidence or "?" read, the second opinion disagreeing, a look-alike
   * letter), `confirmed` (the kid said it is right, or typed it), `tutor` (the tutor's own step).
   * Default: every line `sure`.
   */
  trust?: Trust[];
  /** the problem is known though not in `problem` (a SAT question): the kid's first line needs no confirming */
  known?: boolean;
}

export type Trust = "sure" | "unsure" | "confirmed" | "tutor";

export type TutorStepKind =
  /** one step to write */
  | "step"
  /** the final answer, asked for and allowed */
  | "answer"
  /** the next step is the final answer, held back (`step` holds it; the board does not write it) */
  | "lastStep"
  /** the work is finished: nothing to write */
  | "solved"
  /** the engine could not vouch for any next step: write nothing, say so */
  | "unsure"
  /** a line must be confirmed as read first (`readback`): "I read: … Is that right?" — nothing written */
  | "readback"
  /** nothing to go on (no maths read) */
  | "nothing";

export interface TutorStepResult {
  kind: TutorStepKind;
  /** the step (LaTeX): a relation, or `= …` going on from an expression */
  step: string;
  /** written after the `=` that ends the line it follows (`\frac{1}{2} + \frac{1}{3} =`), not under it */
  inline: boolean;
  /** index into problem + work of the line the step follows (the last right line); -1 for none */
  from: number;
  /** index into problem + work of a slip after `from` that the step stands in for; -1 for none */
  slip: number;
  /** what the step does, in a kid's words ("Subtract 3 from both sides.") */
  why: string;
  /** the engine checked the step (always true for `step`, `answer` and `lastStep`) */
  checked: boolean;
  /** `readback`: the index into problem + work of the line to read back; -1 otherwise */
  readback?: number;
}

const RESULT_KINDS = new Set(["equation", "expression", "inequality"]);

function safely<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

const EMPTY = (kind: TutorStepKind, from = -1, why = ""): TutorStepResult => ({ kind, step: "", inline: false, from, slip: -1, why, checked: false });

// ---------------------------------------------------------------- exact fractions

interface Q {
  n: number;
  d: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;
const q = (n: number, d = 1): Q => (d < 0 ? { n: -n, d: -d } : { n, d });
const reduce = (x: Q): Q => {
  const g = gcd(x.n, x.d);
  return q(x.n / g, x.d / g);
};
const add = (a: Q, b: Q): Q => reduce(q(a.n * b.d + b.n * a.d, a.d * b.d));
const mul = (a: Q, b: Q): Q => reduce(q(a.n * b.n, a.d * b.d));

/** A number as a kid writes it in a sentence: `1/2`, `3`. */
const words = (x: Q) => (x.d === 1 ? String(x.n) : `${x.n}/${x.d}`);

/** One operand of a fraction sum as written. */
interface Operand {
  /** whole part of a mixed number (`2` of `2\frac{1}{2}`), or the integer itself; null for a plain fraction */
  whole: number | null;
  /** the fraction part; null for an integer */
  frac: { n: number; d: number } | null;
  neg: boolean;
}

const value = (o: Operand): Q => {
  const f = o.frac ? q(o.frac.n, o.frac.d) : q(0);
  const v = o.whole !== null ? add(q(o.whole), f) : f;
  return o.neg ? q(-v.n, v.d) : v;
};
const isMixed = (o: Operand) => o.whole !== null && o.frac !== null;
const isInt = (o: Operand) => o.frac === null;

type Op = "+" | "-" | "×" | "÷";

/** `\frac{a}{b}` (`\dfrac`, `\tfrac`), with its numerator and denominator positive whole numbers. */
const FRAC = /^\\[dt]?frac\s*\{\s*(\d{1,6})\s*\}\s*\{\s*(\d{1,6})\s*\}/;

function tidy(latex: string): string {
  return latex
    .replace(/\\left|\\right/g, "")
    .replace(/\\(?:[,;:! ]|quad|qquad)|~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Numeric fraction arithmetic as written: operands (whole numbers, fractions, mixed numbers) joined
 * by `+ - × ÷`. Null for anything else (a letter, a bracket, a power, a decimal).
 */
export function parseFractionSum(latex: string): { operands: Operand[]; ops: Op[] } | null {
  let s = tidy(latex);
  if (!s || /[a-zA-Z\\^_().]/.test(s.replace(/\\(?:[dt]?frac|times|cdot|div)(?![a-zA-Z])/g, ""))) return null;
  const operands: Operand[] = [];
  const ops: Op[] = [];
  let expectOperand = true;
  let neg = false;
  while (s.length > 0) {
    s = s.trimStart();
    if (expectOperand) {
      if (s.startsWith("-") && operands.length === 0 && !neg) {
        neg = true;
        s = s.slice(1);
        continue;
      }
      let whole: number | null = null;
      const int = /^\d{1,7}/.exec(s);
      if (int) {
        whole = Number(int[0]);
        s = s.slice(int[0].length).trimStart();
      }
      const f = FRAC.exec(s);
      let frac: Operand["frac"] = null;
      if (f) {
        frac = { n: Number(f[1]), d: Number(f[2]) };
        if (frac.d === 0) return null;
        s = s.slice(f[0].length);
      }
      if (whole === null && frac === null) return null;
      // a decimal point is not this file's
      if (s.trimStart().startsWith(".")) return null;
      operands.push({ whole, frac, neg });
      neg = false;
      expectOperand = false;
      continue;
    }
    const m = /^(\+|-|−|\\times(?![a-zA-Z])|\\cdot(?![a-zA-Z])|×|\\div(?![a-zA-Z])|÷)/.exec(s);
    if (!m) return null;
    const t = m[1];
    ops.push(t === "+" ? "+" : t === "-" || t === "−" ? "-" : t === "\\div" || t === "÷" ? "÷" : "×");
    s = s.slice(t.length);
    expectOperand = true;
  }
  if (expectOperand || operands.length === 0 || operands.length !== ops.length + 1) return null;
  return { operands, ops };
}

/** A value as written in a step: `\frac{5}{6}`, `-\frac{1}{4}`, `3`. */
function fracLatex(x: Q): string {
  if (x.d === 1) return String(x.n);
  return `${x.n < 0 ? "-" : ""}\\frac{${Math.abs(x.n)}}{${x.d}}`;
}

/** An operand as a plain fraction (`2\frac{1}{2}` → `\frac{5}{2}`, `3` stays `3`). */
function asFraction(o: Operand): string {
  if (isInt(o)) return `${o.neg ? "-" : ""}${o.whole}`;
  const v = value(o);
  return `${v.n < 0 ? "-" : ""}\\frac{${Math.abs(v.n)}}{${v.d}}`;
}

const opLatex: Record<Op, string> = { "+": "+", "-": "-", "×": "\\times", "÷": "\\div" };

/** An unreduced fraction as written (`\frac{3}{6}`), sign in front. */
const rawFrac = (n: number, d: number) => `${n < 0 ? "-" : ""}\\frac{${Math.abs(n)}}{${d}}`;

/**
 * The next classroom step of numeric fraction arithmetic, or null when it is as simple as it gets
 * (a whole number, or a fraction in lowest terms) or not fraction arithmetic this file works.
 * Two operands (and a lone fraction to simplify); longer sums are left to the engine's answer.
 */
export function fractionNext(latex: string): { latex: string; why: string; final: boolean } | null {
  const p = parseFractionSum(latex);
  if (!p) return null;
  const done = (x: Q) => ({ latex: fracLatex(x), final: true });
  if (p.operands.length === 1) {
    const o = p.operands[0];
    if (isInt(o)) return null;
    const v = reduce(value(o));
    if (isMixed(o)) {
      // a mixed number in lowest terms is an answer
      const f = o.frac!;
      const g = gcd(f.n, f.d);
      if (g === 1 && f.n < f.d) return null;
      if (f.n >= f.d) return null;
      return { latex: `${o.neg ? "-" : ""}${o.whole}\\frac{${f.n / g}}{${f.d / g}}`, why: `Simplify: divide the top and bottom by ${g}.`, final: true };
    }
    const f = o.frac!;
    const g = gcd(f.n, f.d);
    if (f.d === 1) return { ...done(v), why: `A denominator of 1 is a whole number.` };
    if (g === 1) return null;
    return { ...done(v), why: `Simplify: divide the top and bottom by ${g}.` };
  }
  if (p.operands.length !== 2) return null;
  const [a, b] = p.operands;
  const op = p.ops[0];
  const total = op === "+" ? add(value(a), value(b)) : op === "-" ? add(value(a), q(-value(b).n, value(b).d)) : op === "×" ? mul(value(a), value(b)) : value(b).n === 0 ? null : mul(value(a), q(value(b).d, value(b).n));
  if (!total) return null;
  // nothing but whole numbers: not fraction work (`23 \times 4`, `36 + 2`)
  if (isInt(a) && isInt(b)) return null;
  // mixed numbers are written as fractions first
  if (isMixed(a) || isMixed(b)) {
    return { latex: `${asFraction(a)} ${opLatex[op]} ${asFraction(b)}`, why: "Write the mixed numbers as fractions first.", final: false };
  }
  const fa = isInt(a) ? q(value(a).n, 1) : q((a.neg ? -1 : 1) * a.frac!.n, a.frac!.d);
  const fb = isInt(b) ? q(value(b).n, 1) : q((b.neg ? -1 : 1) * b.frac!.n, b.frac!.d);
  if (op === "×") {
    const n = fa.n * fb.n;
    const d = fa.d * fb.d;
    const raw = rawFrac(n, d);
    // `\frac{6}{20}`: a step of its own when it simplifies; the answer when it does not
    if (gcd(n, d) > 1 || d === 1) return { latex: raw, why: "Multiply the numerators, and multiply the denominators.", final: false };
    return { ...done(total), why: "Multiply the numerators, and multiply the denominators." };
  }
  if (op === "÷") {
    if (fb.n === 0) return null;
    const flip = q(fb.d, fb.n);
    return { latex: `${rawFrac(fa.n, fa.d).replace(/^(-?)\\frac\{(\d+)\}\{1\}$/, "$1$2")} \\times ${rawFrac(flip.n, flip.d).replace(/^(-?)\\frac\{(\d+)\}\{1\}$/, "$1$2")}`, why: `Dividing by ${words(q(Math.abs(fb.n), fb.d))} is the same as multiplying by ${words(q(fb.d, Math.abs(fb.n)))}. Flip it and multiply.`, final: false };
  }
  // + and -
  if (fa.d === fb.d) {
    const n = op === "+" ? fa.n + fb.n : fa.n - fb.n;
    const raw = rawFrac(n, fa.d);
    const verb = op === "+" ? "add" : "subtract";
    if (gcd(n, fa.d) > 1 || fa.d === 1) return { latex: raw, why: `The denominators match, so ${verb} the numerators.`, final: false };
    return { ...done(total), why: `The denominators match, so ${verb} the numerators.` };
  }
  const L = lcm(fa.d, fb.d);
  const ma = L / fa.d;
  const mb = L / fb.d;
  return {
    latex: `${rawFrac(fa.n * ma, L)} ${opLatex[op]} ${rawFrac(fb.n * mb, L)}`,
    why: `Make the denominators the same: ${L}.`,
    final: false,
  };
}

// ---------------------------------------------------------------- whole-number products

/**
 * `23 \times 4` by place value: `20 \times 4 + 3 \times 4`, then `80 + 12`, then `92`. The number
 * split is the one with more digits (the second when they tie). Null when neither has two digits.
 */
export function productNext(latex: string): { latex: string; why: string; final: boolean } | null {
  const s = tidy(latex);
  const m = /^(\d{1,6})\s*(?:\\times|\\cdot|×|\*)\s*(\d{1,6})$/.exec(s);
  if (m) {
    const [a, b] = [m[1], m[2]];
    const splitB = b.length >= a.length;
    const big = splitB ? b : a;
    const other = splitB ? a : b;
    if (big.length < 2) return null;
    const parts = [...big].map((d, i) => Number(d) * 10 ** (big.length - 1 - i)).filter((v) => v > 0);
    if (parts.length < 2) return null;
    const terms = parts.map((v) => (splitB ? `${other} \\times ${v}` : `${v} \\times ${other}`));
    return { latex: terms.join(" + "), why: `Split ${big} into ${parts.join(" + ")}, and multiply each part by ${other}.`, final: false };
  }
  // `20 \times 4 + 3 \times 4` → `80 + 12`
  const terms = s.split(/\s*\+\s*/);
  if (terms.length >= 2 && terms.every((t) => /^\d{1,6}\s*(?:\\times|\\cdot|×)\s*\d{1,6}$/.test(t))) {
    const values = terms.map((t) => {
      const [x, y] = t.split(/\s*(?:\\times|\\cdot|×)\s*/).map(Number);
      return x * y;
    });
    return { latex: values.join(" + "), why: "Multiply each part.", final: false };
  }
  if (terms.length >= 2 && terms.every((t) => /^\d{1,7}$/.test(t))) {
    const total = terms.reduce((sum, t) => sum + Number(t), 0);
    return { latex: String(total), why: `Add the parts: ${terms.join(" + ")}.`, final: true };
  }
  return null;
}

// ---------------------------------------------------------------- why, for equations

/** A side of a relation as a line `a·x + b` in its unknown, or null when it is not linear. */
function linearOf(engine: LiveEngine, side: string, variable: string): { a: number; b: number } | null {
  // a lone number or term (`8`, `2x`) reads as a label: as a sum it is an expression
  let an = safely(() => engine.analyzeLine(side, { mode: "answer" }));
  if (!an || an.kind !== "expression" || !an.math) an = safely(() => engine.analyzeLine(`${side} + 0`, { mode: "answer" }));
  if (!an || an.kind !== "expression" || !an.math) return null;
  const expr = variable === "x" ? an.math : an.math.replace(new RegExp(`\\b${variable}\\b`, "g"), "x");
  const f = engine.compileExpr(expr);
  if (!f) return null;
  const b = f(0);
  const a = f(1) - b;
  const ok = [2, -3, 0.5].every((t) => Math.abs(f(t) - (a * t + b)) < 1e-9 * Math.max(1, Math.abs(a * t + b)));
  return ok && Number.isFinite(a) && Number.isFinite(b) ? { a: round(a), b: round(b) } : null;
}

const round = (v: number) => Math.round(v * 1e9) / 1e9;

function sides(latex: string): [string, string] | null {
  const parts = latex.split(/=|<|>|\\(?:le|ge|leq|geq|lt|gt|neq)(?![a-zA-Z])/);
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return null;
  return [parts[0].trim(), parts[1].trim()];
}

function num(v: number): string {
  if (Number.isInteger(v)) return String(v);
  // a fraction a kid would say
  for (let d = 2; d <= 12; d++) if (Number.isInteger(round(v * d))) return `${round(v * d)}/${d}`;
  return String(v);
}

function termWords(coef: number, variable: string): string {
  const c = Math.abs(coef);
  return `${c === 1 ? "" : num(c)}${variable}`;
}

/**
 * What a step did to an equation, in a kid's words: `Subtract 3 from both sides.`, `Divide both
 * sides by 2.`, `Multiply out the brackets.` — read off the two lines as lines `a·x + b` on each side.
 * '' when it is something else (the board then says only that this is the next step).
 */
export function equationWhy(engine: LiveEngine, from: string, step: string, variable = "x"): string {
  const s1 = sides(from);
  const s2 = sides(step);
  if (!s1 || !s2) return "";
  const [l1, r1, l2, r2] = [linearOf(engine, s1[0], variable), linearOf(engine, s1[1], variable), linearOf(engine, s2[0], variable), linearOf(engine, s2[1], variable)];
  if (!l1 || !r1 || !l2 || !r2) return "";
  const before = [l1.a, l1.b, r1.a, r1.b];
  const after = [l2.a, l2.b, r2.a, r2.b];
  // each side unchanged in value: the writing changed
  if (before.every((v, i) => Math.abs(v - after[i]) < 1e-9)) {
    if (/\(/.test(from) && !/\(/.test(step)) return "Multiply out the brackets.";
    if (/\\frac/.test(from) && !/\\frac/.test(step)) return "Clear the fractions.";
    return "Combine like terms on each side.";
  }
  // both sides scaled by the same number
  const ratios = before.map((v, i) => (Math.abs(v) < 1e-12 ? (Math.abs(after[i]) < 1e-12 ? null : NaN) : after[i] / v)).filter((r): r is number => r !== null);
  if (ratios.length > 0 && ratios.every((r) => Number.isFinite(r) && Math.abs(r - ratios[0]) < 1e-6) && Math.abs(ratios[0] - 1) > 1e-6) {
    const r = ratios[0];
    if (Math.abs(r - -1) < 1e-6) return "Multiply both sides by -1.";
    const inv = 1 / r;
    if (Math.abs(inv - Math.round(inv)) < 1e-6) return `Divide both sides by ${num(Math.round(inv))}.`;
    return `Multiply both sides by ${num(Math.abs(r - Math.round(r)) < 1e-6 ? Math.round(r) : r)}.`;
  }
  // the same thing added to both sides
  const dv = l2.a - l1.a;
  const dc = l2.b - l1.b;
  if (Math.abs(dv - (r2.a - r1.a)) < 1e-9 && Math.abs(dc - (r2.b - r1.b)) < 1e-9) {
    const parts: string[] = [];
    if (Math.abs(dv) > 1e-9) parts.push(dv < 0 ? `subtract ${termWords(dv, variable)} from both sides` : `add ${termWords(dv, variable)} to both sides`);
    if (Math.abs(dc) > 1e-9) parts.push(dc < 0 ? `subtract ${num(-dc)} from both sides` : `add ${num(dc)} to both sides`);
    if (parts.length === 2) parts[1] = parts[1].replace(/ (?:from|to) both sides$/, "");
    if (parts.length > 0) {
      const text = parts.join(", and ");
      return `${text[0].toUpperCase()}${text.slice(1)}.`;
    }
  }
  return "";
}

// ---------------------------------------------------------------- the check

/** An expression's side: the last side of a chain (`a = b = c` → `c`), or the line before its `=`. */
function lastSide(latex: string): string {
  const t = latex.trim().replace(/=\s*$/, "");
  const parts = t.split("=");
  return parts[parts.length - 1].trim();
}

const endsWithEquals = (latex: string) => /=\s*$/.test(latex);
const isRelation = (latex: string) => /=|<|>|\\(?:le|ge|leq|geq|lt|gt|neq)(?![a-zA-Z])/.test(latex.replace(/=\s*$/, "").replace(/^\s*=/, ""));

/**
 * Is `step` a right next step after `from` (the line it follows), by the engine alone? A relation
 * must be equivalent to `from` (`analyzeLine` with `from` as `previous`, verdict `ok`; `original` the
 * problem's first relation, so a step judged against the start agrees); `= …` (or a bare expression)
 * must equal `from`'s expression. Never the same as a line already written (`written`). The check a
 * model's step must pass too.
 */
export function checkStep(
  engine: LiveEngine,
  from: string,
  step: string,
  opts: { fromAnalysis?: LineAnalysis | null; original?: LineAnalysis | null; written?: readonly string[] } = {},
): { ok: boolean; analysis: LineAnalysis | null; why: string } {
  const s = step.trim();
  if (!s) return { ok: false, analysis: null, why: "empty" };
  const key = stepKey(s.replace(/^=\s*/, ""));
  const seen = new Set((opts.written ?? []).flatMap((l) => [stepKey(l), stepKey(lastSide(l))]));
  if (seen.has(key)) return { ok: false, analysis: null, why: "already written" };
  const continuing = /^\s*=/.test(s);
  // an expression going on: equal to the expression it follows
  if (continuing || (!isRelation(s) && !isRelation(from))) {
    const base = lastSide(from);
    const expr = s.replace(/^\s*=\s*/, "");
    const prev = safely(() => engine.analyzeLine(base, { mode: "answer" }));
    if (!prev || prev.kind !== "expression") return { ok: false, analysis: null, why: "no expression to go on from" };
    const a = safely(() => engine.analyzeLine(expr, { mode: "answer", previous: prev }));
    if (!a || a.kind !== "expression" || a.verdict !== "ok") return { ok: false, analysis: a, why: `not equal (${a?.verdict ?? "unread"})` };
    if (stepKey(expr) === stepKey(base)) return { ok: false, analysis: a, why: "no change" };
    return { ok: true, analysis: a, why: "" };
  }
  if (stepKey(s) === stepKey(from)) return { ok: false, analysis: null, why: "no change" };
  const previous = opts.fromAnalysis ?? safely(() => engine.analyzeLine(from, { mode: "answer" }));
  if (!previous || !RESULT_KINDS.has(previous.kind)) return { ok: false, analysis: null, why: "nothing to follow" };
  const ctx: AnalyzeContext = { mode: "answer", previous, ...(opts.original ? { original: opts.original } : {}) };
  const a = safely(() => engine.analyzeLine(s, ctx));
  if (!a || a.verdict !== "ok") return { ok: false, analysis: a, why: `does not follow (${a?.verdict ?? "unread"})` };
  return { ok: true, analysis: a, why: "" };
}

/** Every side of the line the same expression in its letter (`5(x + 5) - 2x = 5x + 25 - 2x`). */
function isRewriteChain(engine: LiveEngine, line: string): boolean {
  if (/<|>|\\(?:le|ge|leq|geq|lt|gt|neq)(?![a-zA-Z])/.test(line)) return false;
  const sides = line.split("=").map((x) => x.trim());
  if (sides.length < 2 || sides.some((x) => !x)) return false;
  const first = sampled(engine, sides[0]);
  if (!first) return false;
  const a0 = safely(() => engine.analyzeLine(sides[0], { mode: "answer" }));
  if (!a0?.math || !/[a-zA-Z]/.test(a0.math.replace(/\b(?:pi|e)\b/g, ""))) return false;
  return sides.slice(1).every((x) => {
    const v = sampled(engine, x);
    return v !== null && v.every((y, k) => Math.abs(y - first[k]) <= 1e-9 * Math.max(1, Math.abs(first[k])));
  });
}

/** A value as simple as it goes: a whole number, a decimal, a fraction in lowest terms, a mixed number. */
function isFinalValue(latex: string): boolean {
  const s = tidy(latex.replace(/^\s*=\s*/, ""));
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return true;
  const p = parseFractionSum(s);
  return p !== null && p.operands.length === 1 && fractionNext(s) === null;
}

// ---------------------------------------------------------------- the next step

/**
 * The next step of the work (see the file comment). `problem` heads the column; `work` is the kid's
 * lines with the tutor's own steps among them, as they sit top to bottom.
 */
export function nextTutorStep(engine: LiveEngine, args: TutorStepArgs): TutorStepResult {
  const problem = (args.problem ?? []).filter((l) => typeof l === "string");
  const lines = [...problem, ...args.work.filter((l) => typeof l === "string")];
  if (lines.every((l) => !l.trim())) return EMPTY("nothing");
  // a line that starts with `=` goes on from the line above it (the tutor's `= \frac{5}{6}` under a chain)
  for (let i = 1; i < lines.length; i++) {
    if (/^\s*=/.test(lines[i]) && lines[i - 1]?.trim()) lines[i] = `${lastSide(lines[i - 1])} ${lines[i].trim()}`;
  }
  const analyses = analyzeColumn(engine, lines, "answer");
  const usable = (i: number) => {
    const a = analyses[i];
    return Boolean(lines[i]?.trim()) && a !== null && (RESULT_KINDS.has(a.kind) || a.kind === "assignment");
  };
  const guard = guardWork(engine, lines, analyses, problem.length, args, usable);
  if (guard.readback !== -1) return { ...EMPTY("readback"), readback: guard.readback };
  // the last right line, and a slip after it (by the problem when there is one to go by, else line by line)
  let from = guard.from;
  let slip = guard.slip;
  if (from === -1) {
    for (let i = 0; i < lines.length; i++) if (usable(i) && analyses[i]!.verdict !== "mismatch") from = i;
    for (let i = from + 1; i < lines.length && from !== -1; i++) {
      if (usable(i) && analyses[i]!.verdict === "mismatch") {
        slip = i;
        break;
      }
    }
  }
  if (from === -1) return EMPTY(lines.some((l, i) => l.trim() && analyses[i]?.kind === "text") ? "unsure" : "nothing", -1, UNSURE);
  const a = analyses[from]!;
  const line = lines[from];
  if (a.solved) return EMPTY("solved", from);
  const written = lines.filter((l) => l.trim());
  const original = analyses.find((x, i) => i <= from && x && (x.kind === "equation" || x.kind === "inequality")) ?? null;

  // numeric work that ends in its answer (`\frac{1}{2} + \frac{1}{3} = \frac{5}{6}`) is finished
  const numeric = !/[a-zA-Z]/.test(line.replace(/\\[a-zA-Z]+/g, ""));
  if (numeric && /=/.test(line) && !endsWithEquals(line) && isFinalValue(lastSide(line))) return EMPTY("solved", from);

  const candidates: Array<{ latex: string; why: string; final?: boolean; inline?: boolean }> = [];
  const isExpressionLine = a.kind === "expression" || (endsWithEquals(line) && !isRelation(line));
  if (isExpressionLine || (a.kind === "equation" && numeric)) {
    // numeric work: a chain going on (`\frac{1}{2} + \frac{1}{3} = \frac{3}{6} + \frac{2}{6}`), or a line ending in `=`
    const expr = lastSide(line);
    const inline = endsWithEquals(line);
    const next = fractionNext(expr) ?? productNext(expr);
    if (next) candidates.push({ latex: `= ${next.latex}`, why: next.why, final: next.final, inline });
    if (a.nextStep) candidates.push({ latex: `= ${a.nextStep}`, why: "", inline });
    const simplified = safely(() => engine.simplifySteps?.(expr) ?? null);
    if (simplified?.[0]) candidates.push({ latex: simplified[0].startsWith("=") ? simplified[0] : `= ${simplified[0]}`, why: "", inline });
    const result = a.resultLatex || safely(() => engine.analyzeLine(`${expr} =`, { mode: "answer" }))?.resultLatex || "";
    if (result) candidates.push({ latex: `= ${result}`, why: "", final: isFinalValue(result), inline });
  } else if (a.kind === "equation" && isRewriteChain(engine, line)) {
    // `3x + 6x - 5 = 9x - 5`: rewrites of one expression, not an equation to solve — its next
    // simplification, or it is as simple as it gets
    const next = safely(() => engine.simplifySteps?.(lastSide(line)) ?? null);
    if (!next?.length) return EMPTY("solved", from);
    for (const n of next) candidates.push({ latex: n.startsWith("=") ? n : `= ${n}`, why: "Simplify." });
  } else if (a.kind === "equation" || a.kind === "inequality" || a.kind === "assignment") {
    // the engine's solve from the last right line (a slip under it set aside)
    const upto = lines.slice(0, from + 1);
    const solved = safely(() => localSolve(engine, upto, from, { handwriting: true }));
    for (const s of solved?.steps ?? []) candidates.push({ latex: s, why: "" });
  }

  for (const c of candidates) {
    // a lone expression's `=` step is written after the line's own `=`; on a new line it is `= …`
    const checked = checkStep(engine, line, c.latex, { fromAnalysis: a, original, written });
    if (!checked.ok) continue;
    const isRel = isRelation(c.latex) && !/^\s*=/.test(c.latex);
    const final = c.final ?? (isRel ? checked.analysis?.solved === true : isFinalValue(c.latex));
    const why = c.why || (isRel ? equationWhy(engine, line, c.latex, a.variable ?? "x") : "") || "";
    const step = c.latex.trim();
    const inline = Boolean(c.inline) && from === lines.length - 1;
    const base = { step: inline ? step.replace(/^=\s*/, "") : step, inline, from, slip, checked: true };
    if (final && !args.answer) return { ...base, kind: "lastStep", why: lastWords(why) };
    return { ...base, kind: final ? "answer" : "step", why: why || NEXT };
  }
  return { ...EMPTY("unsure", from, UNSURE), slip };
}

// ---------------------------------------------------------------- the messy-handwriting guard

/**
 * A misread line must never become a right step for the wrong problem (`2x + 3 = 11` read as
 * `2x + 3 = 17`: the tutor would write `2x = 14`, checked, in its own pen). Before any step:
 *
 *  1. Every line of the kid's that is read with doubt (`unsure`) is read back first.
 *  2. The ANCHOR is the problem: the tutor's (`problem`), else the kid's first line. A kid's anchor on a
 *     free board is read back once ("I read: … Is that right?") unless the kid has confirmed it.
 *  3. Every later line is held to the anchor: an equation with the same solutions (the engine's
 *     `analyzeLine` with the anchor as `previous`), an expression with the same value. A line that
 *     differs is a slip or a misread: read back unless the kid confirmed it (then it is a slip: the
 *     right step goes beside it, from the last line that agrees).
 *
 * `from` is the last line that agrees with the anchor (-1: no anchor to go by, the caller's own rule).
 */
function guardWork(
  engine: LiveEngine,
  lines: readonly string[],
  analyses: readonly (LineAnalysis | null)[],
  P: number,
  args: TutorStepArgs,
  usable: (i: number) => boolean,
): { readback: number; from: number; slip: number } {
  const trustOf = (i: number): Trust => (i < P ? "tutor" : (args.trust?.[i - P] ?? "sure"));
  const none = { readback: -1, from: -1, slip: -1 };
  // 1. a doubtful read is read back before anything is written from it
  for (let i = P; i < lines.length; i++) if (lines[i].trim() && trustOf(i) === "unsure") return { ...none, readback: i };
  // 2. the anchor: the tutor's problem (its first maths line), else the kid's first line
  let anchor = -1;
  if (P > 0) {
    const maths = [...Array(P).keys()].filter(usable);
    // a problem of more than one line (a system, givens): no one line to hold the work to
    if (maths.length !== 1) return none;
    anchor = maths[0];
  } else {
    for (let i = 0; i < lines.length; i++) if (usable(i)) { anchor = i; break; }
    if (anchor === -1) return none;
    if (!args.known && trustOf(anchor) === "sure") return { ...none, readback: anchor };
  }
  // 3. every later line against the anchor
  let from = anchor;
  for (let i = anchor + 1; i < lines.length; i++) {
    if (!usable(i)) continue;
    if (trustOf(i) === "tutor") {
      from = i;
      continue;
    }
    const same = sameAsAnchor(engine, lines[anchor], analyses[anchor]!, lines[i]);
    if (same === "same") from = i;
    else if (same === "different" || analyses[i]?.verdict === "mismatch") {
      if (trustOf(i) === "confirmed") return { readback: -1, from, slip: i };
      return { ...none, readback: i };
    }
    // a step it cannot hold to the problem (`5x = 2y` under `5x - 4 = 21`: 5x = 25 misread?): read back
    else if (isRelation(lines[i]) && trustOf(i) === "sure") return { ...none, readback: i };
    // anything else it cannot hold to the problem (a side calculation, a misread operation line): never
    // what the step goes on from
  }
  return { readback: -1, from, slip: -1 };
}

/** An expression in one letter at a few values of it, or null. */
function sampled(engine: LiveEngine, side: string): number[] | null {
  let a = safely(() => engine.analyzeLine(side, { mode: "answer" }));
  if (!a || a.kind !== "expression" || !a.math) a = safely(() => engine.analyzeLine(`${side} + 0`, { mode: "answer" }));
  if (!a || a.kind !== "expression" || !a.math) return null;
  const letters = [...new Set(a.math.replace(/\b(?:pi|e)\b/g, "").match(/\b[a-zA-Z]\b/g) ?? [])];
  if (letters.length > 1) return null;
  const expr = letters.length === 1 && letters[0] !== "x" ? a.math.replace(new RegExp(`\\b${letters[0]}\\b`, "g"), "x") : a.math;
  const f = engine.compileExpr(expr);
  if (!f) return null;
  const out = [-2.5, 0.5, 1.75, 3].map((t) => f(t));
  return out.every(Number.isFinite) ? out : null;
}

/** A number's value by the engine (`label` reads of a bare number taken as a sum), or null. */
function numericValue(engine: LiveEngine, side: string): number | null {
  let a = safely(() => engine.analyzeLine(side, { mode: "answer" }));
  if (!a || a.kind !== "expression" || !a.math) a = safely(() => engine.analyzeLine(`${side} + 0`, { mode: "answer" }));
  if (!a || a.kind !== "expression" || !a.math || /[a-zA-Z]/.test(a.math.replace(/\b(?:pi|e)\b/g, ""))) return null;
  const f = engine.compileExpr(a.math);
  const v = f ? f(0) : NaN;
  return Number.isFinite(v) ? v : null;
}

/**
 * Does `line` say the same as the anchor? An equation or inequality: equivalent (the engine's verdict
 * with the anchor as `previous`). A numeric expression: every side of the line has its value.
 */
export function sameAsAnchor(engine: LiveEngine, anchorLatex: string, anchor: LineAnalysis, line: string): "same" | "different" | "unknown" {
  const numeric = (l: string) => !/[a-zA-Z]/.test(l.replace(/\\[a-zA-Z]+/g, ""));
  if (numeric(anchorLatex) && (anchor.kind === "expression" || endsWithEquals(anchorLatex) || anchor.kind === "equation")) {
    if (!numeric(line)) return "unknown";
    const want = numericValue(engine, lastSide(anchorLatex.split("=")[0] || anchorLatex));
    if (want === null) return "unknown";
    const sides = line.replace(/=\s*$/, "").split("=").map((x) => x.trim()).filter(Boolean);
    if (sides.length === 0) return "unknown";
    for (const side of sides) {
      const v = numericValue(engine, side);
      if (v === null) return "unknown";
      if (Math.abs(v - want) > 1e-9 * Math.max(1, Math.abs(want))) return "different";
    }
    return "same";
  }
  if (anchor.kind === "expression") {
    // an expression in a letter: every side of the line takes its values
    const sides = line.replace(/=\s*$/, "").split("=").map((x) => x.trim()).filter(Boolean);
    if (sides.length === 0 || /<|>|\\(?:le|ge|leq|geq|lt|gt|neq)(?![a-zA-Z])/.test(line)) return "unknown";
    const base = sampled(engine, lastSide(anchorLatex));
    if (!base) return "unknown";
    for (const side of sides) {
      const v = sampled(engine, side);
      if (!v) return "unknown";
      if (v.some((y, k) => Math.abs(y - base[k]) > 1e-9 * Math.max(1, Math.abs(base[k])))) return "different";
    }
    return "same";
  }
  if (anchor.kind !== "equation" && anchor.kind !== "inequality") return "unknown";
  if (!isRelation(line)) return "unknown";
  const a = safely(() => engine.analyzeLine(line, { mode: "answer", previous: anchor, original: anchor }));
  if (!a) return "unknown";
  if (a.verdict === "ok") return "same";
  if (a.verdict === "mismatch") return "different";
  return "unknown";
}

/** A kid's words when the engine cannot vouch for a step. */
export const UNSURE = "I'm not sure of the next step here, so I won't guess. Try asking in Ask, or tap Hint.";
/** A step with no words of its own. */
export const NEXT = "Here's the next step.";

/** The last step's words, with the answer left for the kid. */
function lastWords(why: string): string {
  return why ? `One step left: ${why[0].toLowerCase()}${why.slice(1)} You can do this one.` : "Just one step left. You can do this one.";
}
