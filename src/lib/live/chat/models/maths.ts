/**
 * The arithmetic of the visual models, shared by the spec check (`check.ts`, which the route's gate
 * runs on the server) and the planners: a number line's step and ticks, a fraction step's
 * denominator, a number split by place value, the value of a label that is a number, and whether a
 * label that is an equation is true. Pure, no drawing code: the server imports it.
 */

const EPS = 1e-9;

/** The most ticks a number line may have: more cannot be read on a board. */
export const MAX_TICKS = 41;

/**
 * The step a number line gets when the spec gives none: 1 for whole numbers up to 20 apart (0 to 20
 * in ones), else the finest of 1–2–2.5–5 × 10ⁿ that gives at most 10 intervals (0 to 100 in tens,
 * 0 to 1 in tenths).
 */
export function autoStep(from: number, to: number): number {
  const span = to - from;
  if (!(span > 0)) return 1;
  if (Number.isInteger(from) && Number.isInteger(to) && span >= 2 && span <= 20) return 1;
  for (let e = -3; e <= 7; e++) for (const m of [1, 2, 2.5, 5]) if (span / (m * 10 ** e) <= 10 + EPS) return m * 10 ** e;
  return 10 ** 8;
}

/** How many intervals of `step` from..to spans, and whether that is a whole number (within 2% of a step). */
export function intervalsOf(from: number, to: number, step: number): { n: number; whole: boolean } {
  const exact = (to - from) / step;
  const n = Math.round(exact);
  return { n, whole: Math.abs(exact - n) <= 0.02 };
}

/**
 * The denominator a fractional step is written over (0.25 → 4, 1/3 → 3, 0.5 → 2), or 0 when the
 * ticks are whole numbers or decimals (0.1, 0.2 …: tenths are written as decimals in school).
 */
export function stepDenominator(step: number): number {
  if (Math.abs(step - Math.round(step)) < 1e-6) return 0;
  for (const d of [2, 3, 4, 5, 6, 8, 12, 16]) {
    const k = step * d;
    if (Math.abs(k - Math.round(k)) < 1e-4 * d) return d;
  }
  return 0;
}

/** A number split by place value, largest first, zeros left out: 2,305 → [2000, 300, 5]. */
export function placeParts(n: number): number[] {
  const out: number[] = [];
  const s = String(Math.round(Math.abs(n)));
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    if (d > 0) out.push(d * 10 ** (s.length - 1 - i));
  }
  return out.length ? out : [0];
}

/** How many decimal places a number has (to 6), e.g. 3.25 → 2. */
export function decimalsOf(v: number): number {
  for (let k = 0; k <= 6; k++) if (Math.abs(v * 10 ** k - Math.round(v * 10 ** k)) < 1e-6 * 10 ** k) return k;
  return 7;
}

/** Normalises a label for reading: LaTeX fractions and operators as plain text, no thousands commas. */
function plain(label: string): string {
  return label
    .trim()
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1/$2)")
    .replace(/\\times|×|·|\\cdot/g, "*")
    .replace(/\\div|÷/g, "/")
    .replace(/−|–/g, "-")
    .replace(/\{,\}/g, "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\\[ ,;!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A tiny reader of plain arithmetic: numbers (whole, decimal, `3/4`), + - * / and brackets. Null
 * when the text is anything else (a letter, a `?`, a word): only what is surely a number is judged.
 */
export function evaluate(text: string): number | null {
  // "3 x 4" as a teacher writes times
  const src = plain(text).replace(/([\d)])\s*x\s*(?=[\d(])/g, "$1*");
  if (!/^[\d\s.+\-*/()]+$/.test(src) || !/\d/.test(src)) return null;
  let i = 0;
  const peek = () => {
    while (src[i] === " ") i++;
    return src[i];
  };
  const num = (): number | null => {
    const c = peek();
    if (c === "(") {
      i++;
      const v = expr();
      if (peek() !== ")") return null;
      i++;
      return v;
    }
    if (c === "-" || c === "+") {
      i++;
      const v = num();
      return v === null ? null : c === "-" ? -v : v;
    }
    const m = /^\d+(?:\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    // a whole number then a fraction ("1 1/2"): a mixed number
    const mixed = /^ (\d+)\/(\d+)/.exec(src.slice(i));
    if (mixed && /^\d+$/.test(m[0])) {
      i += mixed[0].length;
      return Number(m[0]) + Number(mixed[1]) / Number(mixed[2]);
    }
    return Number(m[0]);
  };
  const term = (): number | null => {
    let v = num();
    while (v !== null) {
      const c = peek();
      if (c !== "*" && c !== "/") break;
      i++;
      const r = num();
      if (r === null) return null;
      v = c === "*" ? v * r : r === 0 ? null : v / r;
    }
    return v;
  };
  const expr = (): number | null => {
    let v = term();
    while (v !== null) {
      const c = peek();
      if (c !== "+" && c !== "-") break;
      i++;
      const r = term();
      if (r === null) return null;
      v = c === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = expr();
  return v !== null && peek() === undefined && Number.isFinite(v) ? v : null;
}

/** A label that is a plain number ("4", "+4", "-3", "2.5", "3/4", "\frac{3}{4}", "1 1/2", "1,234"): its value and whether it carried a sign. */
export function labelNumber(label: string): { value: number; signed: boolean } | null {
  const p = plain(label);
  const m = /^([+-])?\s*(\d+(?:\.\d+)?(?: \d+\/\d+)?|\.\d+|\d+\/\d+|\(\d+\/\d+\))$/.exec(p);
  if (!m) return null;
  const value = evaluate(m[2]);
  if (value === null) return null;
  return { value: m[1] === "-" ? -value : value, signed: m[1] !== undefined };
}

/** A label that is an equation of plain numbers ("3 × 4 = 12"): false when it is wrong, true when right, null when it is not one. */
export function equationHolds(label: string): { holds: boolean; left: number; right: number } | null {
  const sides = label.split("=");
  if (sides.length !== 2) return null;
  const left = evaluate(sides[0]);
  const right = evaluate(sides[1]);
  if (left === null || right === null) return null;
  return { holds: Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left)), left, right };
}

/** Two numbers equal to within rounding. */
export function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** A number as a person writes it in a sentence: 1234 → "1,234", 0.25 → "0.25". */
export function say(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  return Math.abs(r) >= 1000 ? r.toLocaleString("en-US", { maximumFractionDigits: 6 }) : String(r);
}
