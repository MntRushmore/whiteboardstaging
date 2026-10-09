/**
 * A young student's working under a problem with no letters, judged as a primary teacher judges it:
 * against the PROBLEM, not the line above. Behind `LiveEngine.judgeWork` (the engine's lazy chunk);
 * `columnWork.ts` asks it about every line of an arithmetic column.
 *
 * Prod's learning record (2026-10-03 to 10-08) showed why the line above is the wrong yardstick for a
 * child: `18 \times 7` worked as `10 \times 7 = 70`, `8 \times 7 = 56`, `70 + 56 = 126` — every true
 * side calculation was "the answer" (solved at the first line), and the partial products written
 * alone (`70`, `56`) were wrong answers, ringed. `144 \div 9` worked in a bracket, `17 \div 5 = 3 R
 * 2`, `= 9.` with a stray dot: never credited. So, for a problem `P` with the value `answer`:
 *
 *  - A RELATION (`A = B`, `A = B = C`) that is TRUE is never ringed. It is a step of this problem —
 *    a tick — when it is made of the problem's numbers (`knowns`: the problem's own, their place-value
 *    parts and digits, the round tens near them, common denominators, the quotient's parts …) and of
 *    results written above it (`earlier`); with `+`/`-` and `×`/`÷` together, its result must also be a
 *    step of the problem's own order (`3 + 4 = 7` under `3 + 4 \times 2` is true and no step). A true
 *    line that is no step is left unmarked, and never solves it (`6 \times 21 = 126` under `18 \times
 *    7`). It SOLVES the problem when it is a step and ends in the answer, written in its simplest form.
 *    A false relation is ringed. A running chain (`20 + 10 = 30 + 12 = 42`, `=` used as "then") is
 *    read link by link, as the child meant it.
 *  - A NUMBER ALONE (`126`, `= 126`, `7.` with a stray dot) is the answer when it is the answer: a
 *    tick, and solved in its simplest form (`\frac{3}{6}` is right, not finished). Otherwise it is a
 *    result the working makes on the way (`partials`: a partial product, a partial sum, a step of
 *    long division, a numerator over the common denominator) or one written above — no mark — or a
 *    wrong answer, ringed. A minus before the answer to a problem with no negative numbers in it is a
 *    young hand's wobbly `=` (`-11` under `5 + 6`). The quotient alone of a division that leaves a
 *    remainder is right so far: no mark.
 *  - An EXPRESSION (`70 + 56`, `\frac{3}{6} + \frac{2}{6}`) worth the answer is a right rewrite: a
 *    tick, never solved. Claimed with `=` and worth something else, it is ringed.
 *  - A REMAINDER, `3 R 2` (`R`, `r`, `\text{R}`, `\mathrm{R}`; alone or after `17 \div 5 =`): right
 *    when quotient × divisor + remainder is the dividend and the remainder is less than the divisor —
 *    a tick, and the problem solved. True but with a remainder too big (`2 R 7`) is ringed, and says
 *    why. A mixed number (`3\frac{2}{5}`) or a decimal (`3.4`) is the same answer.
 *  - A LONG-DIVISION BRACKET (`9 \longdiv{144}`, `\enclose{longdiv}`, `9)\overline{144}`), with its
 *    quotient over it (the row above, in an array; a fraction's top): the right quotient (and
 *    remainder) is a tick and solves it; the start of the right quotient, or none yet, is unmarked; a
 *    wrong quotient is ringed. The working under the bracket is never ringed: its products and
 *    differences are steps of the division.
 *  - A line built on a ringed line's numbers (`70 + 54 = 124` under a ringed `8 \times 7 = 54`) was
 *    carried on from that slip: no mark of its own.
 *
 * Null when the problem or the line is not plain arithmetic this reads (letters, roots, units, a
 * line ending in `=` asking for its answer): the column's own rules judge it then.
 */
import {
  add,
  div,
  eq,
  inSimplestForm,
  isWhole,
  key,
  mul,
  numbersIn,
  opsIn,
  parseArithmetic,
  q,
  stepValues,
  sub,
  tidyArithmetic,
  toNumber,
  valueOf,
  type Node,
  type Q,
  type Written,
} from "./exactArithmetic";

export interface PrimaryVerdict {
  verdict: "ok" | "mismatch" | "none";
  solved: boolean;
  /** a number alone (an answer, a partial result, a bracket with no quotient yet): judged, never a "?" */
  bare: boolean;
  /** carried on from a ringed line above: no mark of its own */
  carried: boolean;
  /** a relation (`10 \times 7 = 70`, `3 R 2`), not an expression or a number */
  relation: boolean;
  /** why it is ringed, in a child's words ('' when there is nothing to say) */
  note: string;
  /** the line's value, for the analysis's `math` ('' when it has none) */
  math: string;
}

/** The problem as the working is judged against it. */
interface Problem {
  /** the problem's line, tidied (a line that IS the problem is not working on it) */
  squashed: string;
  answer: Q;
  /** `+`/`-` together with `×`/`÷`/`^`: the order of the steps matters */
  mixed: boolean;
  /** a negative number written in it */
  negative: boolean;
  /** `a \div b` of whole numbers: what a remainder or a bracket is judged against */
  division: { a: number; b: number } | null;
  /** a decimal point in it */
  decimals: boolean;
  /** numbers a step of this problem is made of */
  knowns: Set<string>;
  /** results the working makes on the way: a number alone that is one of them is no wrong answer */
  partials: Set<string>;
}

/** What the lines above say: results written right (`earlier`), and those of a ringed line (`carried`). */
interface History {
  earlier: Set<string>;
  carried: Set<string>;
}

const NOTE_WRONG = "Re-check the arithmetic here";

// ---------------------------------------------------------------- numbers and their parts

/** A value as a terminating decimal string (`0.54`, `126`), or null (`\frac{1}{3}`). */
function decimalString(v: Q): string | null {
  let d = v.d;
  let places = 0;
  while (d % 10 === 0) {
    d /= 10;
    places++;
  }
  while (d % 2 === 0 || d % 5 === 0) {
    if (d % 2 === 0) d /= 2;
    else d /= 5;
    places++;
  }
  if (d !== 1 || places > 9) return null;
  const s = Math.abs(v.n * (10 ** places / v.d)).toString();
  const whole = places === 0 ? s : s.length > places ? s.slice(0, s.length - places) : "0";
  const frac = places === 0 ? "" : s.padStart(places, "0").slice(-places);
  return `${v.n < 0 ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Place-value parts of a terminating decimal: `4807` → 4000, 800, 7; `3.25` → 3, 0.2, 0.05 (no zeros). */
function placeParts(v: Q): Q[] {
  const s = decimalString(v);
  if (!s) return [];
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const out: Q[] = [];
  for (let i = 0; i < whole.length; i++) {
    const p = q(Number(whole[i]) * 10 ** (whole.length - 1 - i));
    if (p && p.n !== 0) out.push(p);
  }
  for (let i = 0; i < frac.length; i++) {
    const p = q(Number(frac[i]), 10 ** (i + 1));
    if (p && p.n !== 0) out.push(p);
  }
  return out;
}

/** Its digits, as numbers. */
function digitsOf(v: Q): Q[] {
  const s = decimalString(v) ?? "";
  return [...s.replace(/[-.]/g, "")].map((c) => q(Number(c))).filter((x): x is Q => x !== null);
}

/** A decimal with its point taken out (`5.4` → 54, `0.1` → 1); the number itself when whole. */
function withoutPoint(v: Q): Q | null {
  const s = decimalString(v);
  return s ? q(Number(s.replace(/[-.]/g, "").replace(/^0+(?=\d)/, ""))) : null;
}

/** The round tens either side of a whole number, and hundreds from 50 up (`18` → 10, 20; `198` → 190, 200, 100). */
function roundsNear(v: Q): Q[] {
  if (!isWhole(v) || v.n <= 0) return [];
  const n = v.n;
  const out = [Math.floor(n / 10) * 10, Math.ceil(n / 10) * 10 + (n % 10 === 0 ? 10 : 0)];
  if (n >= 50) out.push(Math.floor(n / 100) * 100, Math.ceil(n / 100) * 100);
  return [...new Set(out)].filter((r) => r > 0 && r !== n).map((r) => q(r)!);
}

/** The digits of two numbers lined up by place (on the point), right to left: a sum's columns. */
function columnsOf(a: Q, b: Q): Array<[number, number]> {
  const split = (v: Q) => {
    const [whole, frac = ""] = (decimalString(v) ?? "").replace("-", "").split(".");
    return { whole, frac };
  };
  const x = split(a);
  const y = split(b);
  const places = Math.max(x.frac.length, y.frac.length);
  const width = Math.max(x.whole.length, y.whole.length);
  const pad = (s: { whole: string; frac: string }) => s.whole.padStart(width, "0") + s.frac.padEnd(places, "0");
  const dx = pad(x);
  const dy = pad(y);
  return [...dx].map((c, i) => [Number(c), Number(dy[i])] as [number, number]).reverse();
}

/** How the problem's numbers are written: as fractions (a `\frac` or a mixed number anywhere), decimals, or whole. */
type Writing = "fraction" | "decimal" | "whole";

function lcm(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) [x, y] = [y, x % y];
  return (a / x) * b;
}

// ---------------------------------------------------------------- the problem's knowns and partials

/**
 * The steps one operation of two values is worked in, as a primary class works it: `k` takes the
 * numbers such a step is made of, `p` the results it makes on the way. `p` is held back on purpose
 * (a lone number that is one of them is never ringed): none for two small numbers (`4 + 3`, `6 \times
 * 7`), whose only result is the answer.
 */
function strategies(op: string, a: Q, b: Q, writing: Writing, k: (v: Q | null) => void, p: (v: Q | null) => void): void {
  const both = (v: Q | null) => {
    k(v);
    p(v);
  };
  for (const x of [a, b]) {
    k(x);
    placeParts(x).forEach(k);
    digitsOf(x).forEach(k);
    for (const r of roundsNear(x)) {
      k(r);
      k(sub(r, x));
      k(sub(x, r));
    }
    k(withoutPoint(x));
  }
  const fractions = writing === "fraction" && (!isWhole(a) || !isWhole(b));
  const decimals = writing === "decimal" && (!isWhole(a) || !isWhole(b));
  const big = Math.max(Math.abs(toNumber(a)), Math.abs(toNumber(b))) >= 10;
  [10, 100, 1000].forEach((n) => k(q(n)));

  if (fractions) {
    // over a common denominator: the least, and the two multiplied
    const da = a.d;
    const db = b.d;
    for (const den of new Set([lcm(da, db), da * db])) {
      k(q(den));
      const na = (a.n * den) / da;
      const nb = (b.n * den) / db;
      both(q(na));
      both(q(nb));
      both(q(op === "-" ? na - nb : na + nb));
    }
    for (const x of [a, b]) {
      k(q(x.n));
      k(q(x.d));
      const whole = q(Math.trunc(x.n / x.d));
      if (whole) {
        both(whole);
        both(sub(x, whole));
      }
    }
    both(a);
    both(b);
    const wa = Math.trunc(a.n / a.d);
    const wb = Math.trunc(b.n / b.d);
    if (op === "+" || op === "-") {
      both(q(op === "+" ? wa + wb : wa - wb));
      const fa = sub(a, q(wa)!);
      const fb = sub(b, q(wb)!);
      if (fa && fb) both(op === "+" ? add(fa, fb) : sub(fa, fb));
    }
    if (op === "×") {
      both(q(a.n * b.n));
      both(q(a.d * b.d));
    }
    if (op === "÷" && b.n !== 0) {
      const flip = q(b.d, b.n);
      both(flip);
      if (flip) {
        both(q(a.n * flip.n));
        both(q(a.d * flip.d));
      }
    }
    return;
  }

  if (op === "+" || op === "-") {
    // making ten, doubles: the small facts a sum of two small numbers is worked with
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const up = roundsNear(x).find((r) => toNumber(r) > toNumber(x));
      const gap = up && sub(up, x);
      if (gap) k(sub(y, gap));
      k(mul(x, q(2)!));
    }
    k(sub(a, b));
    k(sub(b, a));
    // the ones of the first, taken away first (12 - 2 = 10, 10 - 3 = 7)
    const ones = isWhole(a) ? q(Math.abs(a.n) % 10) : null;
    if (ones) k(sub(b, ones));
    if (!big && !decimals) return;
    const pa = placeParts(a);
    const pb = placeParts(b);
    // place by place: tens with tens, ones with ones
    const shape = (x: Q) => (decimalString(x) ?? "").replace(/[1-9]/g, "0");
    for (const x of pa) for (const y of pb) if (shape(x) === shape(y)) both(op === "+" ? add(x, y) : sub(x, y));
    // a column's digits, with or without the carry / borrow (with decimals, a whole number alone is
    // no column of a decimal answer: a step's numbers only)
    const column = decimals ? k : both;
    for (const [x, y] of columnsOf(a, b)) {
      if (op === "+") {
        column(q(x + y));
        column(q(x + y + 1));
      } else {
        column(q(x - y));
        column(q(10 + x - y));
        column(q(x - 1 - y));
      }
    }
    // on from the first number, a place of the second at a time (and the other way round, adding)
    const run = (from: Q, parts: Q[], f: (x: Q, y: Q) => Q | null) => {
      let acc: Q | null = from;
      for (const part of parts) {
        acc = acc && f(acc, part);
        both(acc);
      }
    };
    run(a, pb, op === "+" ? add : sub);
    if (op === "+") run(b, pa, add);
    // a round number taken away, then the difference given back
    for (const r of roundsNear(b)) both(op === "+" ? add(a, r) : sub(a, r));
    if (decimals) {
      // the sum in hundredths (345 + 280 = 625): a step a line may be made of, but written alone it
      // is the answer with its point lost — a wrong answer, ringed
      const places = Math.max(...[a, b].map((x) => (decimalString(x)?.split(".")[1] ?? "").length));
      const scale = q(10 ** places)!;
      const A = mul(a, scale);
      const B = mul(b, scale);
      if (A && B) {
        k(A);
        k(B);
        k(op === "+" ? add(A, B) : sub(A, B));
      }
    }
    return;
  }

  if (op === "×") {
    const A = withoutPoint(a);
    const B = withoutPoint(b);
    if (decimals && A && B) {
      // the digits multiplied, the point put back after (`12 \times 3 = 36`, then 3.6), and a tenth
      // as a tenth of it (`5.4 \div 10`): steps a line may be made of — but a number alone that is
      // one of them is the answer with its point lost or moved (`36`, `0.054`): a wrong answer
      k(mul(A, B));
      for (const [x, y] of [
        [A, B],
        [B, A],
      ] as const)
        for (const part of placeParts(y)) k(mul(x, part));
      for (const e of [10, 100, 1000]) {
        for (const x of [a, b]) {
          k(mul(x, q(e)!));
          k(div(x, q(e)!));
        }
      }
    }
    if (!big && !decimals) return;
    const pa = placeParts(a);
    const pb = placeParts(b);
    // the grid: every place of one by every place of the other
    for (const x of [...pa, a]) for (const y of [...pb, b]) both(mul(x, y));
    for (const x of digitsOf(a)) for (const y of digitsOf(b)) both(mul(x, y));
    // long multiplication's rows, with and without the zero that holds the place
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      for (const d of digitsOf(y)) both(mul(x, d));
      const rows = placeParts(y).map((part) => mul(x, part));
      for (const order of [rows, [...rows].reverse()]) {
        let acc: Q | null = q(0);
        for (const r of order) {
          acc = acc && r && add(acc, r);
          both(acc);
        }
      }
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) if (rows[i] && rows[j]) both(add(rows[i]!, rows[j]!));
    }
    let acc: Q | null = q(0);
    for (const x of pa)
      for (const y of pb) {
        acc = acc && add(acc, mul(x, y)!);
        both(acc);
      }
    // round up (or down) and give back: 20 × 7 - 2 × 7 (a number of two digits or more)
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      if (toNumber(x) < 10) continue;
      for (const r of roundsNear(x)) {
        both(mul(r, y));
        const gap = sub(r, x);
        if (gap) both(mul(gap.n < 0 ? q(-gap.n, gap.d)! : gap, y));
      }
    }
    return;
  }

  if (op === "÷" && isWhole(a) && isWhole(b) && a.n >= 0 && b.n > 0) {
    const quotient = Math.floor(a.n / b.n);
    k(q(quotient));
    k(q(a.n % b.n));
    placeParts(q(quotient)!).forEach(k);
    digitsOf(q(quotient)!).forEach(k);
    // long division, a digit at a time: what is divided, what comes off, what is left
    let cur = 0;
    for (const ch of String(a.n)) {
      cur = cur * 10 + Number(ch);
      const d = Math.floor(cur / b.n);
      both(q(cur));
      both(q(d * b.n));
      cur -= d * b.n;
      both(q(cur));
    }
    // in chunks: the quotient a place at a time
    let left = a.n;
    for (const part of placeParts(q(quotient)!)) {
      both(q(part.n * b.n));
      left -= part.n * b.n;
      both(q(left));
    }
    for (let m = 1; m <= 12; m++) both(q(b.n * m));
    both(q(b.n * 10));
    both(q(b.n * 100));
    return;
  }

  if (op === "÷") {
    // a decimal divided: by a power of ten, or the digits divided and the point put back
    const A = withoutPoint(a);
    if (A) both(div(A, b));
  }
}

/** The tree's operations of two values each, worked as `strategies` says (outermost last). */
function walkStrategies(n: Node, writing: Writing, k: (v: Q | null) => void, p: (v: Q | null) => void): void {
  if (n.t === "num") return;
  if (n.t === "neg") return walkStrategies(n.arg, writing, k, p);
  if (n.t === "over") {
    walkStrategies(n.top, writing, k, p);
    walkStrategies(n.bottom, writing, k, p);
    return strategies("÷", valueOf(n.top), valueOf(n.bottom), writing, k, p);
  }
  walkStrategies(n.left, writing, k, p);
  walkStrategies(n.right, writing, k, p);
  if (n.op !== "^") strategies(n.op, valueOf(n.left), valueOf(n.right), writing, k, p);
}

/** How a problem's numbers are written (`Writing`). */
function writingOf(tree: Node): Writing {
  const forms = numbersIn(tree).map((w) => w.form);
  if (forms.some((f) => f === "frac" || f === "mixed")) return "fraction";
  return forms.includes("dec") ? "decimal" : "whole";
}

/** `18 \times 7 =`, `18 \times 7 = ?`, `= \square`, `= \underline{\quad}`: the problem without the place for its answer. */
function problemSide(latex: string): string | null {
  const s = latex.replace(/=\s*(?:\?|\\square|\\Box|\\boxed\s*\{\s*\}|\\underline\s*\{[^{}]*\}|\\_+|_+|\\ldots|\.\.\.)?\s*$/, "").trim();
  return s && !s.includes("=") ? s : null;
}

const squash = (s: string) => tidyArithmetic(s).replace(/\s+/g, "");

/** Problems read, by their line: every line of a column is judged against the same one, on every render. */
const problemMemo = new Map<string, Problem | null>();

/** The problem read for judging the working under it, or null when it is not arithmetic this reads. */
export function readProblem(lines: readonly string[]): Problem | null {
  if (lines.length !== 1) return null;
  if (!problemMemo.has(lines[0])) {
    problemMemo.set(lines[0], readProblemLine(lines[0]));
    while (problemMemo.size > 64) problemMemo.delete(problemMemo.keys().next().value as string);
  }
  return problemMemo.get(lines[0]) ?? null;
}

function readProblemLine(line: string): Problem | null {
  const side = problemSide(line);
  const tree = side ? parseArithmetic(side) : null;
  if (!side || !tree) return null;
  const answer = valueOf(tree);
  const knowns = new Set<string>();
  const partials = new Set<string>();
  const k = (v: Q | null) => {
    if (v) knowns.add(key(v));
  };
  const p = (v: Q | null) => {
    if (v) partials.add(key(v));
  };
  for (const w of numbersIn(tree)) {
    k(w.value);
    if (w.top !== undefined) k(q(w.top));
    if (w.bottom !== undefined) k(q(w.bottom));
    if (w.whole !== undefined) k(q(w.whole));
  }
  k(answer);
  for (const v of stepValues(tree)) {
    k(v);
    p(v);
  }
  const writing = writingOf(tree);
  walkStrategies(tree, writing, k, p);
  // a lone number to simplify or convert (`\frac{6}{8}`, `2\frac{1}{3}`): its own pieces
  if (tree.t === "num") strategies("+", answer, q(0)!, writing, k, () => undefined);
  for (const v of partials) knowns.add(v);
  const ops = opsIn(tree);
  const division = tree.t === "op" && tree.op === "÷" && isWhole(valueOf(tree.left)) && isWhole(valueOf(tree.right)) && valueOf(tree.right).n > 0 ? { a: valueOf(tree.left).n, b: valueOf(tree.right).n } : null;
  return {
    squashed: squash(side),
    answer,
    mixed: (ops.has("+") || ops.has("-")) && (ops.has("×") || ops.has("÷") || ops.has("^")),
    negative: /-/.test(tidyArithmetic(side).replace(/(?<=[\d)}\]])\s*-/g, "")),
    division,
    decimals: /\d\.\d|(?<!\d)\.\d/.test(side),
    knowns,
    partials,
  };
}

// ---------------------------------------------------------------- reading a line

/** A stray mark around a lone number: a dot, a comma, a tick-like prime, a dot read as a times sign. */
const STRAY_AFTER = /(?:\s*(?:\.|,|'|`|\\prime|\^\s*\{\s*(?:\\prime|\\circ|\\cdot|\.|,)\s*\}|\^\s*(?:\\prime|\\circ)|_\s*\{\s*[.,]\s*\}|\\cdot|\\bullet|\\cdots|\\ldots|\\dots))+\s*$/;
const STRAY_BEFORE = /^\s*(?:\\cdot|\\bullet|'|,)\s*/;
const LONE = /^\s*(=\s*)?(-\s*)?(\d+(?:\.\d+)?|\.\d+|\d*\s*\\[dt]?frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\})\s*$/;

/** A lone number with the strays a young hand leaves round it taken off (`7.` → `7`, `= 9^{\prime}` → `= 9`); else as it was. */
function withoutStrays(latex: string): string {
  const s = latex.replace(STRAY_BEFORE, "").replace(STRAY_AFTER, "");
  return s !== latex && LONE.test(s) ? s : latex;
}

/** `3 R 2`, `17 \div 5 = 3 \text{ R } 2`: the quotient and remainder, and the division before them if written. */
function readRemainder(latex: string): { left: string | null; quotient: number; remainder: number } | null {
  const s = latex.replace(/\\(?:text|mathrm|operatorname|textrm|mathbf|mbox)\s*\{\s*([^{}]*?)\s*\}/g, " $1 ").replace(/\s+/g, " ").trim();
  const m = /^(?:(.+?)=)?\s*(\d+)\s*(?:R|r|rem|remainder)\s*(\d+)$/.exec(s);
  if (!m) return null;
  return { left: m[1]?.trim() || null, quotient: Number(m[2]), remainder: Number(m[3]) };
}

/** A long-division bracket: the divisor, the dividend under it, the quotient over it (and its remainder), as read. */
interface Bracket {
  divisor: number;
  dividend: number;
  quotient: string | null;
}

const BRACKETS = [
  /(\d+)\s*\\longdiv\s*\{\s*([\d\s]+)\}/,
  /(\d+)\s*\\longdiv\s*(\d+)/,
  /(\d+)\s*\\enclose\s*\{\s*longdiv\s*\}\s*\{\s*([\d\s]+)\}/,
  /(\d+)\s*\\overline\s*\{\s*\\?\)\s*([\d\s]+)\}/,
  /(\d+)\s*\\?\)\s*\\overline\s*\{\s*([\d\s]+)\}/,
  /(\d+)\s*\\right\s*\)\s*\{?\s*(\d+)/,
];

/** The bracket on this line, or null. */
function readBracket(latex: string): Bracket | null {
  for (const re of BRACKETS) {
    const m = re.exec(latex);
    if (!m) continue;
    const divisor = Number(m[1]);
    const dividend = Number(m[2].replace(/\s+/g, ""));
    if (!divisor || !Number.isFinite(dividend)) return null;
    const tidyQuotient = (s: string) => {
      const t = s.replace(/\\(?:overline|underline|text|mathrm)\s*\{([^{}]*)\}/g, "$1").replace(/[{}&]/g, " ").replace(/\s+/g, " ").trim();
      return /^\d+(?:\s*(?:R|r)\s*\d+)?$/.test(t) ? t : null;
    };
    // over it: the row above in an array, or a fraction's top
    let quotient: string | null = null;
    const frac = /^\s*\\[dt]?frac\s*\{\s*([^{}]*)\}\s*\{/.exec(latex);
    if (frac) quotient = tidyQuotient(frac[1]);
    const array = /\\begin\{(?:array|aligned|gathered|matrix|tabular)\}(?:\{[^{}]*\})?([\s\S]*)\\end\{/.exec(latex);
    if (array) {
      const rows = array[1].split(/\\\\/).map((r) => r.replace(/\\hline/g, "").trim());
      const at = rows.findIndex((r) => re.test(r));
      if (at > 0) quotient = tidyQuotient(rows[at - 1]);
    }
    return { divisor, dividend, quotient };
  }
  return null;
}

/** Every number a line holds, and the values of its sides: what the lines under it may build on. */
function valuesIn(nodes: readonly Node[]): Q[] {
  return nodes.flatMap((n) => [...numbersIn(n).map((w) => w.value), valueOf(n)]);
}

interface Judged extends PrimaryVerdict {
  /** a step of this problem (a relation): what the lines under it may build on */
  step: boolean;
  values: Q[];
}

function verdictOf(v: Partial<Judged> & Pick<Judged, "verdict">): Judged {
  return { solved: false, bare: false, carried: false, relation: false, note: "", math: "", step: false, values: [], ...v };
}

/** The value as a mathjs source (`126`, `27 / 50`). */
const mathOf = (v: Q) => (v.d === 1 ? String(v.n) : `${v.n} / ${v.d}`);

/** The answer, as written: the exact value — or, for an answer with no end (`10 \div 3`), a decimal rounded right. */
function isTheAnswer(p: Problem, w: Written): boolean {
  if (eq(w.value, p.answer)) return true;
  if (w.form !== "dec" || decimalString(p.answer) !== null) return false;
  return Math.abs(toNumber(w.value) - toNumber(p.answer)) <= 0.5 * 10 ** -w.places + 1e-12;
}

/** The number the line's tree is, when it is one alone (`126`, `-11`, `3\frac{5}{6}`). */
function loneNumber(n: Node): { w: Written; negative: boolean } | null {
  if (n.t === "num") return { w: n.w, negative: false };
  if (n.t === "neg" && n.arg.t === "num") return { w: n.arg.w, negative: true };
  return null;
}

/** A remainder line judged (see the file comment). */
function judgeRemainder(p: Problem | null, r: NonNullable<ReturnType<typeof readRemainder>>): Judged | null {
  let a: number;
  let b: number;
  let own = true;
  const left = r.left ? parseArithmetic(r.left) : null;
  if (r.left && !left) return null;
  if (left && left.t === "op" && left.op === "÷" && isWhole(valueOf(left.left)) && isWhole(valueOf(left.right))) {
    a = valueOf(left.left).n;
    b = valueOf(left.right).n;
    own = !p?.division || p.division.a !== a || p.division.b !== b;
  } else if (!left && p?.division) {
    ({ a, b } = p.division);
    own = false;
  } else return null;
  if (b <= 0) return null;
  const values = [q(r.quotient)!, q(r.remainder)!, q(a)!, q(b)!];
  const math = `${r.quotient} * ${b} + ${r.remainder}`;
  if (r.quotient * b + r.remainder !== a) return verdictOf({ verdict: "mismatch", relation: true, note: NOTE_WRONG, values, math });
  if (r.remainder >= b) return verdictOf({ verdict: "mismatch", relation: true, note: `The remainder must be less than ${b}.`, values, math });
  // right: the problem's own division answered, or another one written out right
  return verdictOf({ verdict: "ok", solved: !own, relation: true, step: true, values, math });
}

/** A long-division bracket judged (see the file comment). */
function judgeBracket(p: Problem | null, br: Bracket): Judged {
  const values = [q(br.divisor)!, q(br.dividend)!];
  const math = `${br.dividend} / ${br.divisor}`;
  // the bracket of another division than the problem's: a step of it, never ringed
  if (p?.division && (p.division.a !== br.dividend || p.division.b !== br.divisor)) return verdictOf({ verdict: "none", bare: true, values, math });
  const quotient = Math.floor(br.dividend / br.divisor);
  const remainder = br.dividend % br.divisor;
  if (!br.quotient) return verdictOf({ verdict: "none", bare: true, values, math });
  const m = /^(\d+)(?:\s*(?:R|r)\s*(\d+))?$/.exec(br.quotient);
  if (!m) return verdictOf({ verdict: "none", bare: true, values, math });
  const written = Number(m[1]);
  const rest = m[2] === undefined ? null : Number(m[2]);
  values.push(q(written)!);
  if (written === quotient && (rest === remainder || (rest === null && remainder === 0))) return verdictOf({ verdict: "ok", solved: true, bare: true, step: true, values, math });
  // the quotient started right (its first digits), or right with its remainder still to come
  if ((written === quotient && rest === null) || (String(quotient).startsWith(m[1]) && m[1].length < String(quotient).length && rest === null)) {
    return verdictOf({ verdict: "none", bare: true, values, math });
  }
  return verdictOf({ verdict: "mismatch", bare: true, note: rest !== null && rest >= br.divisor ? `The remainder must be less than ${br.divisor}.` : NOTE_WRONG, values, math });
}

/** A number of the working: one of the problem's, or a result written right above. */
const knownIn = (p: Problem, h: History, v: Q) => p.knowns.has(key(v)) || h.earlier.has(key(v));
/** A result the working makes on the way, or one written right above. */
const partialIn = (p: Problem, h: History, v: Q) => p.partials.has(key(v)) || h.earlier.has(key(v));

/** One line of the working judged against the problem, with what the lines above it said. */
function judgeOne(p: Problem, h: History, latex: string): Judged | null {
  const tidy = withoutStrays(latex);
  if (/=\s*$/.test(tidy) || /\\(?:approx|neq?|le|ge|leq|geq|lt|gt)(?![a-zA-Z])|[<>≤≥≈]/.test(tidy)) return null;
  const remainder = readRemainder(tidy);
  if (remainder) return judgeRemainder(p, remainder);
  const claim = /^\s*=/.test(tidy);
  const sides = tidy.replace(/^\s*=\s*/, "").split("=");
  const trees = sides.map((s) => parseArithmetic(s));
  if (trees.some((t) => t === null)) return null;
  const nodes = trees as Node[];

  if (nodes.length === 1) {
    const n = nodes[0];
    const v = valueOf(n);
    const lone = loneNumber(n);
    const values = valuesIn(nodes);
    if (lone) {
      const w = lone.w;
      const math = mathOf(v);
      if (!lone.negative && isTheAnswer(p, w)) return verdictOf({ verdict: "ok", solved: inSimplestForm(w), bare: true, step: true, values, math });
      // a young hand's `=` read as a minus: `-11` under `5 + 6`
      if (lone.negative && !p.negative && toNumber(p.answer) > 0 && isTheAnswer(p, w)) return verdictOf({ verdict: "ok", solved: inSimplestForm(w), bare: true, step: true, values, math });
      if (lone.negative && isTheAnswer(p, { ...w, value: v })) return verdictOf({ verdict: "ok", solved: inSimplestForm(w), bare: true, step: true, values, math });
      // the quotient of a division that leaves a remainder: right so far
      if (!lone.negative && p.division && p.division.a % p.division.b !== 0 && eq(v, q(Math.floor(p.division.a / p.division.b))!)) {
        return verdictOf({ verdict: "none", bare: true, step: true, values, math });
      }
      if (partialIn(p, h, w.value) || partialIn(p, h, v)) return verdictOf({ verdict: "none", bare: true, step: true, values, math });
      if (h.carried.has(key(w.value)) || h.carried.has(key(v))) return verdictOf({ verdict: "none", bare: true, carried: true, values, math });
      return verdictOf({ verdict: "mismatch", bare: true, values, math });
    }
    // an expression: a rewrite of the problem when it is worth the answer
    if (eq(v, p.answer)) return verdictOf({ verdict: "ok", step: true, values, math: mathOf(v) });
    if (claim && !partialIn(p, h, v)) return verdictOf({ verdict: "mismatch", note: NOTE_WRONG, values, math: mathOf(v) });
    return verdictOf({ verdict: "none", values, math: mathOf(v) });
  }

  // a relation: true link by link — or a running chain, each link starting with the value before it
  const vals = nodes.map(valueOf);
  const values = valuesIn(nodes);
  const math = vals.map(mathOf).join(" == ");
  const leadsWith = (n: Node, v: Q): boolean => {
    let m: Node = n;
    while (m.t === "op" && m.op !== "^") m = m.left;
    return n.t === "op" && m.t === "num" && eq(m.w.value, v);
  };
  const linked = vals.every((v, i) => i === 0 || eq(v, vals[i - 1]) || leadsWith(nodes[i], vals[i - 1]));
  const strict = vals.every((v) => eq(v, vals[0]));
  if (!strict && !linked) return verdictOf({ verdict: "mismatch", relation: true, note: NOTE_WRONG, values, math });
  const last = nodes[nodes.length - 1];
  const value = vals[vals.length - 1];
  // what it is made of: every number before its last side
  const used = nodes.slice(0, -1).flatMap((n) => numbersIn(n).map((w) => w.value));
  if (claim) used.push(p.answer);
  const fromProblem = used.every((v) => knownIn(p, h, v));
  const fromSlip = !fromProblem && used.every((v) => knownIn(p, h, v) || h.carried.has(key(v)));
  // with the order of operations in play, a step is one of the problem's own (or its answer)
  const inOrder = !p.mixed || partialIn(p, h, value) || eq(value, p.answer);
  if (fromSlip) return verdictOf({ verdict: "none", relation: true, carried: true, values, math });
  if (!fromProblem || !inOrder) return verdictOf({ verdict: "none", relation: true, values, math });
  const lone = loneNumber(last);
  const solved = lone !== null && !lone.negative && isTheAnswer(p, lone.w) && inSimplestForm(lone.w);
  return verdictOf({ verdict: "ok", solved, relation: true, step: true, values, math });
}

/** The lines above, folded in order: results written right, and results of a ringed (or carried) line. */
function historyOf(p: Problem, above: readonly string[]): History {
  const h: History = { earlier: new Set(), carried: new Set() };
  for (const line of above) {
    if (!line || squash(line) === p.squashed) continue;
    const j = judgeOne(p, h, line) ?? judgeBracketLine(p, line);
    if (!j) continue;
    const into = j.verdict === "mismatch" || j.carried ? h.carried : j.verdict === "ok" || j.step ? h.earlier : null;
    if (into) for (const v of j.values) into.add(key(v));
  }
  return h;
}

function judgeBracketLine(p: Problem | null, latex: string): Judged | null {
  const br = readBracket(latex);
  return br ? judgeBracket(p, br) : null;
}

/**
 * A young student's line of working judged against the problem it is under (see the file comment):
 * `problem` its lines (one, with no letters), `above` the student's lines over it in the column.
 * Null when it is not such a line. A big decimal point read as a times dot (`0 \cdot 54` for `0.54`)
 * is read as the point when that reading is right and the other is not.
 */
export function judgePrimaryLine(problem: readonly string[], above: readonly string[], latex: string): PrimaryVerdict | null {
  const p = readProblem(problem);
  // a bracket carries its own problem (a child's own long division)
  const bracket = judgeBracketLine(p, latex);
  if (bracket) return strip(bracket);
  if (!p || squash(latex) === p.squashed) return null;
  const h = historyOf(p, above);
  const judged = judgeOne(p, h, latex);
  if (p.decimals && /\d\s*\\cdot\s*\d/.test(latex) && judged?.verdict !== "ok") {
    const point = judgeOne(p, h, latex.replace(/(\d)\s*\\cdot\s*(\d)/g, "$1.$2"));
    if (point?.verdict === "ok") return strip(point);
  }
  return judged ? strip(judged) : null;
}

function strip(j: Judged): PrimaryVerdict {
  return { verdict: j.verdict, solved: j.solved, bare: j.bare, carried: j.carried, relation: j.relation, note: j.note, math: j.math };
}
