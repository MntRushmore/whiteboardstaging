/**
 * Exact values for measurement: sums of `c · π^p · √m` (c rational, m square-free), with the
 * dimension a geometry answer carries — degrees (`70^{\circ}`) and one length unit
 * (`25\pi\,\mathrm{cm}^{2}`). `25\pi`, `\frac{250\pi}{3}`, `6\sqrt{2}`, `\frac{5\sqrt{3}}{2}`,
 * `4 + 2\sqrt{3}`, `\frac{50}{\pi}` are all exact; `\tan 40^{\circ}` and `\sqrt{\frac{50}{\pi}}` are
 * not, and every operation that would leave exact arithmetic throws `NotExact` — the caller then
 * writes a decimal with `\approx`, never a rounded number presented as exact.
 *
 * Trig at the special angles (multiples of 30° and 45°, degrees by default, radians when π is
 * the angle) and the inverse functions at their values. Pure: no mathjs.
 */
import { NotAlgebra, q, qAdd, qDiv, qLatex, qMul, qNeg, type Q } from "./algebra";
import { shortExactDecimal } from "./format";
import { simplifySqrt } from "./surd";

/** The value cannot be written exactly (a non-special angle, √ of a sum, π under a root). */
export class NotExact extends Error {}
/** The value does not exist (tan 90°, sin⁻¹ 2, a zero denominator). */
export class NoValue extends Error {}

export interface VTerm {
  c: Q;
  /** power of π (negative in a denominator) */
  pi: number;
  /** square-free radicand, 1 for none */
  rad: number;
}

export interface Val {
  terms: VTerm[];
  /** degree dimension: 1 for an angle in degrees */
  deg: number;
  /** length-unit exponent (cm = 1, cm² = 2) */
  len: number;
  /** the one length unit a problem uses (`cm`), when it has one */
  unit?: string;
}

const notExact = (): never => {
  throw new NotExact();
};

function exact<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof NotAlgebra) throw new NotExact();
    throw e;
  }
}

const Z: Q = { n: 0, d: 1 };
const ONE: Q = { n: 1, d: 1 };
const qz = (a: Q): boolean => a.n === 0;
const qv = (a: Q): number => a.n / a.d;

function normTerms(terms: readonly VTerm[]): VTerm[] {
  const out: VTerm[] = [];
  for (const t of terms) {
    if (qz(t.c)) continue;
    const hit = out.find((o) => o.pi === t.pi && o.rad === t.rad);
    if (hit) hit.c = exact(() => qAdd(hit.c, t.c));
    else out.push({ ...t });
  }
  return out.filter((t) => !qz(t.c)).sort((a, b) => a.pi - b.pi || a.rad - b.rad);
}

function make(terms: readonly VTerm[], deg = 0, len = 0, unit?: string): Val {
  return { terms: normTerms(terms), deg, len, unit: len === 0 ? undefined : unit };
}

export const vQ = (c: Q, deg = 0, len = 0, unit?: string): Val => make([{ c, pi: 0, rad: 1 }], deg, len, unit);
export const vInt = (n: number): Val => vQ(exact(() => q(n)));
export const vZero = (): Val => make([]);
export const vPi = (): Val => make([{ c: ONE, pi: 1, rad: 1 }]);
/** One degree: `35^{\circ}` is 35 × this. */
export const vDegree = (): Val => vQ(ONE, 1);
/** One length unit: `5\,\mathrm{cm}` is 5 × this. */
export const vUnit = (unit: string): Val => vQ(ONE, 0, 1, unit);

export const vIsZero = (a: Val): boolean => a.terms.length === 0;
export const vNum = (a: Val): number => a.terms.reduce((s, t) => s + qv(t.c) * Math.PI ** t.pi * Math.sqrt(t.rad), 0);
export const vIsRational = (a: Val): boolean => a.terms.length === 0 || (a.terms.length === 1 && a.terms[0].pi === 0 && a.terms[0].rad === 1);
export function vRational(a: Val): Q | null {
  if (a.terms.length === 0) return Z;
  return vIsRational(a) ? a.terms[0].c : null;
}
export const vHasPi = (a: Val): boolean => a.terms.some((t) => t.pi !== 0);
export const vHasRoot = (a: Val): boolean => a.terms.some((t) => t.rad !== 1);
export const vDimless = (a: Val): Val => ({ ...a, deg: 0, len: 0, unit: undefined });
export const vSameDims = (a: Val, b: Val): boolean => a.deg === b.deg && a.len === b.len && (a.len === 0 || a.unit === b.unit);

function unitOf(a: Val, b: Val): string | undefined {
  if (a.unit && b.unit && a.unit !== b.unit) notExact();
  return a.unit ?? b.unit;
}

export function vAdd(a: Val, b: Val): Val {
  // zero takes the other's dimension (`0 + 70^{\circ}`)
  if (vIsZero(a)) return b;
  if (vIsZero(b)) return a;
  if (!vSameDims(a, b)) notExact();
  return make([...a.terms, ...b.terms], a.deg, a.len, unitOf(a, b));
}

export const vNeg = (a: Val): Val => ({ ...a, terms: a.terms.map((t) => ({ ...t, c: exact(() => qNeg(t.c)) })) });
export const vSub = (a: Val, b: Val): Val => vAdd(a, vNeg(b));

function termMul(x: VTerm, y: VTerm): VTerm {
  let c = exact(() => qMul(x.c, y.c));
  let rad = 1;
  if (x.rad !== 1 || y.rad !== 1) {
    const r = simplifySqrt(x.rad * y.rad);
    if (!r) notExact();
    c = exact(() => qMul(c, q(r!.k)));
    rad = r!.m;
  }
  return { c, pi: x.pi + y.pi, rad };
}

export function vMul(a: Val, b: Val): Val {
  const terms: VTerm[] = [];
  for (const x of a.terms) for (const y of b.terms) terms.push(termMul(x, y));
  return make(terms, a.deg + b.deg, a.len + b.len, unitOf(a, b));
}

export function vInv(a: Val): Val {
  if (a.terms.length === 0) throw new NoValue();
  if (a.terms.length === 2 && a.terms.every((t) => t.pi === 0)) {
    // 1 / (p + r√m) = (p - r√m) / (p² - r²m)
    const [x, y] = a.terms;
    const conj = make([x, { ...y, c: exact(() => qNeg(y.c)) }]);
    const den = vMul(a, conj);
    if (!vIsRational(vDimless(den))) notExact();
    return { ...vMul(conj, vQ(exact(() => qDiv(ONE, vRational(vDimless(den))!)))), deg: -a.deg, len: -a.len, unit: a.unit };
  }
  if (a.terms.length !== 1) notExact();
  const t = a.terms[0];
  // 1 / (c π^p √m) = √m / (c m) π^{-p}
  const c = exact(() => qDiv(ONE, qMul(t.c, q(t.rad))));
  return make([{ c, pi: -t.pi, rad: t.rad }], -a.deg, -a.len, a.unit);
}

export const vDiv = (a: Val, b: Val): Val => vMul(a, vInv(b));

export function vPowInt(a: Val, k: number): Val {
  if (!Number.isInteger(k) || Math.abs(k) > 12) notExact();
  if (k < 0) return vInv(vPowInt(a, -k));
  let out: Val = vQ(ONE);
  for (let i = 0; i < k; i++) out = vMul(out, a);
  return out;
}

/** The exact integer k-th root of a non-negative integer, or null. */
function intRoot(n: number, k: number): number | null {
  const r = Math.round(n ** (1 / k));
  for (const c of [r - 1, r, r + 1]) if (c >= 0 && c ** k === n) return c;
  return null;
}

/** √a for a non-negative value with one term and an even π power: `\sqrt{72}` = 6√2. */
export function vSqrt(a: Val): Val {
  if (a.deg % 2 !== 0 || a.len % 2 !== 0) notExact();
  if (a.terms.length === 0) return a;
  if (a.terms.length !== 1) notExact();
  const t = a.terms[0];
  if (t.rad !== 1 || t.pi % 2 !== 0 || t.c.n < 0) notExact();
  // √(n/d) = √(n d) / d
  const r = simplifySqrt(t.c.n * t.c.d);
  if (!r) notExact();
  return make([{ c: exact(() => q(r!.k, t.c.d)), pi: t.pi / 2, rad: r!.m }], a.deg / 2, a.len / 2, a.unit);
}

/** The k-th root (k ≥ 3) of a rational that is a perfect power: `\sqrt[3]{27}` = 3. */
export function vRoot(a: Val, k: number): Val {
  if (k === 2) return vSqrt(a);
  if (a.deg % k !== 0 || a.len % k !== 0) notExact();
  const r = vRational(vDimless(a));
  if (!r) notExact();
  const sign = r!.n < 0 ? -1 : 1;
  if (sign < 0 && k % 2 === 0) throw new NoValue();
  const n = intRoot(Math.abs(r!.n), k);
  const d = intRoot(r!.d, k);
  if (n === null || d === null) notExact();
  return vQ(exact(() => q(sign * n!, d!)), a.deg / k, a.len / k, a.unit);
}

/** a^e for a rational exponent: whole powers, and ½ / ⅓ as roots. */
export function vPow(a: Val, e: Q): Val {
  if (e.d === 1) return vPowInt(a, e.n);
  return vPowInt(vRoot(a, e.d), e.n);
}

export function vAbs(a: Val): Val {
  return vNum(a) < 0 ? vNeg(a) : a;
}

// ---------------------------------------------------------------- trig

export type TrigFn = "sin" | "cos" | "tan" | "sec" | "csc" | "cot";
export type InverseFn = "asin" | "acos" | "atan";

const HALF: Q = { n: 1, d: 2 };
const half = (rad: number): Val => make([{ c: HALF, pi: 0, rad }]);

/** sin at a whole number of degrees that is a multiple of 30 or 45; NotExact elsewhere. */
function sinDeg(d: number): Val {
  const m = ((d % 360) + 360) % 360;
  if (m > 180) return vNeg(sinDeg(m - 180));
  if (m > 90) return sinDeg(180 - m);
  switch (m) {
    case 0:
      return vZero();
    case 30:
      return vQ(HALF);
    case 45:
      return half(2);
    case 60:
      return half(3);
    case 90:
      return vQ(ONE);
    default:
      return notExact();
  }
}

/** The angle in degrees (a rational) of an angle value: `30^{\circ}`, `\frac{\pi}{6}`, or a bare number (degrees, the school default). */
export function angleDegrees(a: Val): Q {
  if (a.len !== 0) notExact();
  if (a.deg === 1) {
    const r = vRational(vDimless(a));
    return r ?? notExact();
  }
  if (a.deg !== 0) notExact();
  if (a.terms.length === 0) return Z;
  if (a.terms.length === 1 && a.terms[0].pi === 1 && a.terms[0].rad === 1) return exact(() => qMul(a.terms[0].c, q(180)));
  const r = vRational(a);
  return r ?? notExact();
}

export function vTrig(name: TrigFn, angle: Val): Val {
  const d = angleDegrees(angle);
  if (d.d !== 1) notExact();
  const s = sinDeg(d.n);
  const c = sinDeg(d.n + 90);
  const inv = (x: Val): Val => {
    if (vIsZero(x)) throw new NoValue();
    return vInv(x);
  };
  switch (name) {
    case "sin":
      return s;
    case "cos":
      return c;
    case "tan":
      return vMul(s, inv(c));
    case "sec":
      return inv(c);
    case "csc":
      return inv(s);
    case "cot":
      return vMul(c, inv(s));
  }
}

const TABLE: Array<[number, number, number]> = [
  // [sin value, sin⁻¹ in degrees, tan⁻¹ angle whose tan is this value (or -1)]
  [0, 0, 0],
  [0.5, 30, -1],
  [Math.SQRT2 / 2, 45, -1],
  [Math.sqrt(3) / 2, 60, -1],
  [1, 90, 45],
];
const TAN_TABLE: Array<[number, number]> = [
  [0, 0],
  [Math.sqrt(3) / 3, 30],
  [1, 45],
  [Math.sqrt(3), 60],
];

/** The principal angle in degrees of sin⁻¹ / cos⁻¹ / tan⁻¹ at an exact value; NotExact off the table, NoValue out of range. */
export function vInverseDegrees(name: InverseFn, v: Val): number {
  if (v.deg !== 0 || v.len !== 0) notExact();
  const x = vNum(v);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-12;
  if (name === "atan") {
    const hit = TAN_TABLE.find(([t]) => near(Math.abs(x), t));
    if (!hit) return notExact();
    return x < 0 ? -hit[1] : hit[1];
  }
  if (Math.abs(x) > 1 + 1e-12) throw new NoValue();
  const hit = TABLE.find(([t]) => near(Math.abs(x), t));
  if (!hit) return notExact();
  const asin = x < 0 ? -hit[1] : hit[1];
  return name === "asin" ? asin : 90 - asin;
}

// ---------------------------------------------------------------- printing

export interface PrintOptions {
  /** the column works in decimals: rationals that terminate are written as decimals */
  decimals?: boolean;
}

function qText(c: Q, opts: PrintOptions): string {
  if (opts.decimals && c.d !== 1) {
    const d = shortExactDecimal(qv(c));
    if (d !== null) return d;
  }
  return qLatex(c);
}

/** One term without its sign: `25\pi`, `\frac{250\pi}{3}`, `6\sqrt{2}`, `\frac{\sqrt{3}}{2}`, `\frac{50}{\pi}`. */
function termBody(t: VTerm, opts: PrintOptions): string {
  const c = { n: Math.abs(t.c.n), d: t.c.d };
  const top: string[] = [];
  const bottom: string[] = [];
  const pi = (p: number) => (p === 1 ? "\\pi" : `\\pi^{${p}}`);
  if (t.pi > 0) top.push(pi(t.pi));
  if (t.pi < 0) bottom.push(pi(-t.pi));
  if (t.rad !== 1) top.push(`\\sqrt{${t.rad}}`);
  if (opts.decimals && c.d !== 1 && shortExactDecimal(qv(c)) !== null) {
    // `6.25\pi`: a decimal coefficient in a column of decimals
    const coef = shortExactDecimal(qv(c))!;
    const body = [coef, ...top].join("");
    return bottom.length ? `\\frac{${body}}{${bottom.join("")}}` : body;
  }
  if (top.length === 0 && bottom.length === 0) return qLatex(c);
  const num = [c.n === 1 && top.length > 0 ? "" : String(c.n), ...top].join("");
  const den = [c.d === 1 ? "" : String(c.d), ...bottom].join("");
  return den ? `\\frac{${num}}{${den}}` : num;
}

/** The number part of a value: `25\pi`, `4 + 2\sqrt{3}`, `-\frac{1}{2}`, `0`. */
export function vNumberLatex(a: Val, opts: PrintOptions = {}): string {
  if (a.terms.length === 0) return "0";
  const parts = a.terms.map((t, i) => {
    const body = t.pi === 0 && t.rad === 1 ? qText({ n: Math.abs(t.c.n), d: t.c.d }, opts) : termBody(t, opts);
    const neg = t.c.n < 0;
    if (i === 0) return neg ? `-${body}` : body;
    return neg ? ` - ${body}` : ` + ${body}`;
  });
  return parts.join("");
}

/** The value as a teacher writes it, with its degree sign or unit: `70^{\circ}`, `25\pi\,\mathrm{cm}^{2}`. */
export function vLatex(a: Val, opts: PrintOptions = {}): string {
  const n = vNumberLatex(a, opts);
  if (a.deg === 1) {
    const plain = /^-?\d+(?:\.\d+)?$/.test(n);
    return plain ? `${n}^{\\circ}` : `\\left(${n}\\right)^{\\circ}`;
  }
  if (a.deg !== 0) notExact();
  if (a.len !== 0 && a.unit) return `${n}\\,${unitLatex(a.unit, a.len)}`;
  return n;
}

/** `\mathrm{cm}`, `\mathrm{cm}^{2}`. */
export function unitLatex(unit: string, power: number): string {
  return power === 1 ? `\\mathrm{${unit}}` : `\\mathrm{${unit}}^{${power}}`;
}

/** A value to `places` decimal places (hundredths by default), as a rounded answer is written: `10.07`, `36.87`, `14.00`. */
export function decimalLatex(n: number, places = 2): string {
  const r = Math.round(n * 10 ** places) / 10 ** places;
  const s = r.toFixed(places);
  return /^-0(?:\.0+)?$/.test(s) ? s.slice(1) : s;
}
