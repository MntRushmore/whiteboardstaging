/**
 * Grade-school arithmetic, read and worked EXACTLY: whole numbers, decimals, fractions and mixed
 * numbers with `+ - × ÷`, brackets and small powers, as a young student writes them and Mathpix
 * reads them. A young student's working is judged with it (`primaryWork.ts`).
 *
 * Why not mathjs: the engine's floats say `5.4 \times 0.1` is 0.5400000000000001, so `= 0.54`
 * needed a tolerance, and a tolerance cannot tell `\frac{1}{3}` from 0.33. Here every value is a
 * fraction n/d in lowest terms, so 0.54 is 27/50 whichever way it is written. And the reader keeps
 * the SHAPE of what was written — which numbers, which operations, a fraction in its lowest terms or
 * not — which is what a teacher looks at: `\frac{3}{6}` is right but not finished, `70` under
 * `18 \times 7` is a partial product.
 *
 * Pure and small: no mathjs, no DOM. Null (never a throw) for anything it does not read: letters,
 * roots, functions, relations other than `=`.
 */

/** An exact value n/d: d > 0, in lowest terms, both safe integers. */
export interface Q {
  n: number;
  d: number;
}

/** Past this, a numerator or denominator is no longer school arithmetic (and no longer exact in a double). */
const LIMIT = 1e15;

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** n/d in lowest terms, or null (d = 0, not whole, too big). */
export function q(n: number, d = 1): Q | null {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0 || Math.abs(n) > LIMIT || Math.abs(d) > LIMIT) return null;
  const g = gcd(n, d) || 1;
  const s = d < 0 ? -1 : 1;
  return { n: (s * n) / g + 0, d: (s * d) / g };
}

export const add = (a: Q, b: Q): Q | null => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Q, b: Q): Q | null => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Q, b: Q): Q | null => q(a.n * b.n, a.d * b.d);
export const div = (a: Q, b: Q): Q | null => (b.n === 0 ? null : q(a.n * b.d, a.d * b.n));

/** a^k for a whole k from 0 to 12; null otherwise. */
export function pow(a: Q, k: Q): Q | null {
  if (k.d !== 1 || k.n < 0 || k.n > 12) return null;
  let out: Q | null = { n: 1, d: 1 };
  for (let i = 0; i < k.n && out; i++) out = mul(out, a);
  return out;
}

export const eq = (a: Q, b: Q): boolean => a.n === b.n && a.d === b.d;
export const key = (a: Q): string => `${a.n}/${a.d}`;
export const isWhole = (a: Q): boolean => a.d === 1;
export const toNumber = (a: Q): number => a.n / a.d;

/** A number as written: its value and how it looks. */
export interface Written {
  value: Q;
  /** `int` 126, `dec` 0.54 / .54, `frac` \frac{3}{6}, `mixed` 2\frac{1}{3} */
  form: "int" | "dec" | "frac" | "mixed";
  /** digits after the point (`dec`) */
  places: number;
  /** a fraction's own numerator and denominator as written (`frac`, `mixed`'s fractional part) */
  top?: number;
  bottom?: number;
  /** a mixed number's whole part */
  whole?: number;
}

/** What was read: a tree of operations over written numbers. */
export type Node =
  | { t: "num"; w: Written }
  | { t: "neg"; arg: Node; value: Q }
  | { t: "op"; op: "+" | "-" | "×" | "÷" | "^"; left: Node; right: Node; value: Q }
  /** `\frac{A}{B}` of expressions (not two plain numbers): a division as written */
  | { t: "over"; top: Node; bottom: Node; value: Q };

export const valueOf = (n: Node): Q => (n.t === "num" ? n.w.value : n.value);

/** Every number written in it, left to right. */
export function numbersIn(n: Node): Written[] {
  if (n.t === "num") return [n.w];
  if (n.t === "neg") return numbersIn(n.arg);
  if (n.t === "over") return [...numbersIn(n.top), ...numbersIn(n.bottom)];
  return [...numbersIn(n.left), ...numbersIn(n.right)];
}

/** The operations in it. */
export function opsIn(n: Node): Set<string> {
  const out = new Set<string>();
  const walk = (m: Node) => {
    if (m.t === "op") {
      out.add(m.op);
      walk(m.left);
      walk(m.right);
    } else if (m.t === "neg") walk(m.arg);
    else if (m.t === "over") {
      out.add("÷");
      walk(m.top);
      walk(m.bottom);
    }
  };
  walk(n);
  return out;
}

/** The value of every operation in it (its sub-expressions), innermost first. */
export function stepValues(n: Node): Q[] {
  if (n.t === "num") return [];
  if (n.t === "neg") return [...stepValues(n.arg), n.value];
  if (n.t === "over") return [...stepValues(n.top), ...stepValues(n.bottom), n.value];
  return [...stepValues(n.left), ...stepValues(n.right), n.value];
}

/**
 * The LaTeX tidied to the few things this reads: spacing, sizing and `\left`/`\right` gone, every
 * times sign `×` (`\times`, `\cdot`, `*`, an `x` between numbers), every divide sign `÷` (`\div`,
 * `/`, `:` between numbers), thousands commas dropped (`1,250`).
 */
export function tidyArithmetic(latex: string): string {
  return latex
    .replace(/\\(?:left|right|displaystyle|textstyle)(?![a-zA-Z])/g, "")
    .replace(/\\(?:[,;:! ]|quad|qquad)|~/g, " ")
    .replace(/\\[dt]frac(?![a-zA-Z])/g, "\\frac")
    .replace(/\\(?:times|cdot|ast)(?![a-zA-Z])|[*×·]/g, " × ")
    .replace(/(?<=[\d)}\]])\s*[xX]\s*(?=[\d(\\[])/g, " × ")
    .replace(/\\div(?![a-zA-Z])|÷/g, " ÷ ")
    .replace(/(?<=[\d)}\]])\s*[/:]\s*(?=[\d(\\[])/g, " ÷ ")
    .replace(/−/g, "-")
    .replace(/\\\{|\\\}/g, "")
    .replace(/(?<![\d.])(\d{1,3}(?:,\d{3})+)(?![\d,])/g, (m) => m.replace(/,/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

type Tok = { k: "num"; w: Written } | { k: "op"; v: "+" | "-" | "×" | "÷" | "^" } | { k: "(" } | { k: ")" } | { k: "frac"; top: Node; bottom: Node; plain: boolean };

/** The brace group starting at `i` (`s[i]` is `{`): its inside and the index after it, or null. */
function group(s: string, i: number): { inside: string; end: number } | null {
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) return { inside: s.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

function numberWritten(text: string): Written | null {
  const point = text.indexOf(".");
  if (point === -1) {
    const v = q(Number(text));
    return v ? { value: v, form: "int", places: 0 } : null;
  }
  const places = text.length - point - 1;
  if (places === 0 || places > 9) return null;
  const v = q(Number(text.replace(".", "")), 10 ** places);
  return v ? { value: v, form: "dec", places } : null;
}

function tokenize(s: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") {
      i++;
      continue;
    }
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(s.slice(i));
    if (num) {
      const w = numberWritten(num[0]);
      if (!w) return null;
      out.push({ k: "num", w });
      i += num[0].length;
      continue;
    }
    if (s.startsWith("\\frac", i)) {
      let j = i + 5;
      while (s[j] === " ") j++;
      const a = group(s, j);
      if (!a) return null;
      j = a.end;
      while (s[j] === " ") j++;
      const b = group(s, j);
      if (!b) return null;
      const top = parseArithmetic(a.inside);
      const bottom = parseArithmetic(b.inside);
      if (!top || !bottom) return null;
      const plain = top.t === "num" && bottom.t === "num" && top.w.form === "int" && bottom.w.form === "int";
      out.push({ k: "frac", top, bottom, plain });
      i = b.end;
      continue;
    }
    if (c === "{") {
      const g = group(s, i);
      if (!g) return null;
      out.push({ k: "(" });
      const inner = tokenize(g.inside);
      if (!inner) return null;
      out.push(...inner, { k: ")" });
      i = g.end;
      continue;
    }
    if (c === "(" || c === "[") out.push({ k: "(" });
    else if (c === ")" || c === "]") out.push({ k: ")" });
    else if (c === "+" || c === "-" || c === "×" || c === "÷" || c === "^") out.push({ k: "op", v: c });
    else return null;
    i++;
  }
  return out;
}

/** A recursive-descent reader over the tokens: `+ -` < `× ÷` (and side by side) < unary minus < `^`. */
class Reader {
  private i = 0;
  constructor(private readonly toks: Tok[]) {}

  read(): Node | null {
    const n = this.sum();
    return n && this.i === this.toks.length ? n : null;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private sum(): Node | null {
    let left = this.product();
    while (left) {
      const t = this.peek();
      if (t?.k !== "op" || (t.v !== "+" && t.v !== "-")) break;
      this.i++;
      const right = this.product();
      if (!right) return null;
      const value = (t.v === "+" ? add : sub)(valueOf(left), valueOf(right));
      if (!value) return null;
      left = { t: "op", op: t.v, left, right, value };
    }
    return left;
  }

  private product(): Node | null {
    let left = this.unary();
    while (left) {
      const t = this.peek();
      let op: "×" | "÷" | null = null;
      if (t?.k === "op" && (t.v === "×" || t.v === "÷")) {
        op = t.v;
        this.i++;
      } else if (t && (t.k === "(" || t.k === "frac" || t.k === "num") && this.adjacentTimes(left, t)) op = "×";
      if (!op) break;
      const right = this.unary();
      if (!right) return null;
      const value = (op === "×" ? mul : div)(valueOf(left), valueOf(right));
      if (!value) return null;
      left = { t: "op", op, left, right, value };
    }
    return left;
  }

  /** Two things side by side multiply (`2(3 + 4)`, `(3)(4)`) — but two numbers side by side are no product. */
  private adjacentTimes(left: Node, next: Tok): boolean {
    if (next.k === "num") return false;
    if (next.k === "frac") return left.t !== "num";
    return true;
  }

  private unary(): Node | null {
    const t = this.peek();
    if (t?.k === "op" && (t.v === "-" || t.v === "+")) {
      this.i++;
      const arg = this.unary();
      if (!arg) return null;
      if (t.v === "+") return arg;
      const value = q(-valueOf(arg).n, valueOf(arg).d);
      return value ? { t: "neg", arg, value } : null;
    }
    return this.power();
  }

  private power(): Node | null {
    const base = this.atom();
    if (!base) return null;
    const t = this.peek();
    if (t?.k !== "op" || t.v !== "^") return base;
    this.i++;
    const exp = this.atom();
    if (!exp) return null;
    const value = pow(valueOf(base), valueOf(exp));
    return value ? { t: "op", op: "^", left: base, right: exp, value } : null;
  }

  private atom(): Node | null {
    const t = this.peek();
    if (!t) return null;
    if (t.k === "num") {
      this.i++;
      // a mixed number: a whole number written right before a fraction of two whole numbers
      const next = this.peek();
      if (t.w.form === "int" && next?.k === "frac" && next.plain) {
        this.i++;
        const top = (next.top as { w: Written }).w.value.n;
        const bottom = (next.bottom as { w: Written }).w.value.n;
        const frac = q(top, bottom);
        const value = frac && add(t.w.value, frac);
        return value ? { t: "num", w: { value, form: "mixed", places: 0, whole: t.w.value.n, top, bottom } } : null;
      }
      return { t: "num", w: t.w };
    }
    if (t.k === "frac") {
      this.i++;
      const value = div(valueOf(t.top), valueOf(t.bottom));
      if (!value) return null;
      if (t.plain) {
        const top = (t.top as { w: Written }).w.value.n;
        const bottom = (t.bottom as { w: Written }).w.value.n;
        return { t: "num", w: { value, form: "frac", places: 0, top, bottom } };
      }
      return { t: "over", top: t.top, bottom: t.bottom, value };
    }
    if (t.k === "(") {
      this.i++;
      const inner = this.sum();
      if (!inner || this.peek()?.k !== ")") return null;
      this.i++;
      return inner;
    }
    return null;
  }
}

/** One side of a line read exactly (`tidyArithmetic` first), or null when it is not plain arithmetic. */
export function parseArithmetic(latex: string): Node | null {
  const toks = tokenize(tidyArithmetic(latex));
  if (!toks || toks.length === 0) return null;
  return new Reader(toks).read();
}

/**
 * A number written in its simplest form, as a teacher wants an answer: a whole number, a decimal,
 * a fraction in its lowest terms (`\frac{23}{6}` is; `\frac{3}{6}`, `\frac{4}{4}`, `\frac{6}{1}` are
 * not), a mixed number whose fraction is proper and in its lowest terms.
 */
export function inSimplestForm(w: Written): boolean {
  if (w.form === "int" || w.form === "dec") return true;
  const top = w.top ?? 0;
  const bottom = w.bottom ?? 0;
  if (bottom <= 1 || gcd(top, bottom) !== 1) return false;
  return w.form === "frac" || top < bottom;
}
