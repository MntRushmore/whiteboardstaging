/**
 * mathjs values / nodes -> LaTeX for the echo result chips.
 * Numbers: integers exact, otherwise 4 significant figures; units as `31.36\,\mathrm{N}`.
 * Pure TypeScript, no mathjs import at runtime (type-only).
 */
import type { MathNode, Unit } from "mathjs";

export const SIGNIFICANT_FIGURES = 4;

const UNIT_NAME_LATEX: Record<string, string> = {
  ohm: "\\Omega",
  degC: "^{\\circ}\\mathrm{C}",
  degF: "^{\\circ}\\mathrm{F}",
  celsius: "^{\\circ}\\mathrm{C}",
  fahrenheit: "^{\\circ}\\mathrm{F}",
  deg: "^{\\circ}",
  degree: "^{\\circ}",
  mu: "\\mu",
  angstrom: "\\text{\\AA}",
  hour: "h",
  minute: "min",
  second: "s",
  gram: "g",
  meter: "m",
  metre: "m",
  liter: "L",
  litre: "L",
  mole: "mol",
};

interface RationalHit {
  n: number;
  d: number;
}

/** Small-denominator rational approximation, or null. */
export function asSmallFraction(value: number, maxDenominator = 64): RationalHit | null {
  if (!Number.isFinite(value)) return null;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  for (let d = 2; d <= maxDenominator; d++) {
    const n = abs * d;
    const r = Math.round(n);
    if (r !== 0 && Math.abs(n - r) < 1e-9 * Math.max(1, r)) {
      const g = gcd(r, d);
      if (d / g === 1) return null;
      return { n: (sign * r) / g, d: d / g };
    }
  }
  return null;
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export interface NumberFormatOptions {
  /** show 1/3 as \frac{1}{3} when the value is a small rational */
  preferFraction?: boolean;
  sigFigs?: number;
}

/** Strip float noise: 31.360000000000003 -> 31.36 */
export function tidyNumber(value: number, sigFigs = SIGNIFICANT_FIGURES): number {
  if (!Number.isFinite(value)) return value;
  if (Number.isInteger(value)) return value;
  const rounded = Number(value.toPrecision(Math.max(sigFigs, 12)));
  if (Number.isInteger(rounded)) return rounded;
  return Number(value.toPrecision(sigFigs));
}

/** Decimal-correct rounding to `sig` significant figures (293.15 -> 293.2, not 293.1). */
export function roundSignificant(value: number, sig: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const exp = Math.floor(Math.log10(Math.abs(value)));
  const shift = sig - 1 - exp;
  const shifted = Number(`${value}e${shift}`);
  return Number(`${Math.round(shifted)}e${-shift}`);
}

export function formatNumberLatex(value: number, opts: NumberFormatOptions = {}): string {
  const sig = opts.sigFigs ?? SIGNIFICANT_FIGURES;
  if (Number.isNaN(value)) return "\\text{undefined}";
  if (value === Infinity) return "\\infty";
  if (value === -Infinity) return "-\\infty";
  const noiseFree = Number(value.toPrecision(12));
  if (Number.isInteger(noiseFree) && Math.abs(noiseFree) < 1e15) return String(noiseFree);
  if (opts.preferFraction) {
    const frac = asSmallFraction(noiseFree);
    if (frac) {
      const sign = frac.n < 0 ? "-" : "";
      return `${sign}\\frac{${Math.abs(frac.n)}}{${frac.d}}`;
    }
  }
  const abs = Math.abs(noiseFree);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) {
    const exp = Math.floor(Math.log10(abs));
    const mantissa = roundSignificant(noiseFree / 10 ** exp, sig);
    const mant = Math.abs(mantissa) === 10 ? (mantissa > 0 ? 1 : -1) : mantissa;
    const e = Math.abs(mantissa) === 10 ? exp + 1 : exp;
    return `${trimZeros(mant.toPrecision(sig))} \\times 10^{${e}}`;
  }
  return trimZeros(roundSignificant(noiseFree, sig).toPrecision(sig));
}

function trimZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}

function unitPartLatex(prefix: string, name: string, power: number): string {
  const abs = Math.abs(power);
  const base = UNIT_NAME_LATEX[name] ?? name;
  const body = `${prefix}${base}`;
  return abs === 1 ? body : `${body}^{${abs}}`;
}

interface UnitPart {
  prefix: { name: string };
  unit: { name: string };
  power: number;
}

/** `m/s^2`, `N`, `kg\,m/s^{2}`; angles as `^{\circ}` */
export function unitSymbolsLatex(unit: Unit): string {
  const parts = (unit as unknown as { units: UnitPart[] }).units;
  if (!parts || parts.length === 0) return "";
  const num = parts.filter((p) => p.power > 0);
  const den = parts.filter((p) => p.power < 0);
  const numTex = num.map((p) => unitPartLatex(p.prefix.name, p.unit.name, p.power)).join("\\,");
  const denTex = den.map((p) => unitPartLatex(p.prefix.name, p.unit.name, p.power)).join("\\,");
  if (den.length === 0) return numTex;
  const denWrapped = den.length > 1 ? `(${denTex})` : denTex;
  return `${numTex || "1"}/${denWrapped}`;
}

export function unitToLatex(unit: Unit, opts: NumberFormatOptions = {}): string {
  const parts = (unit as unknown as { units: UnitPart[] }).units ?? [];
  const value = unit.toNumber();
  const num = formatNumberLatex(value, { ...opts, preferFraction: false });
  if (parts.length === 0) return num;
  const symbols = unitSymbolsLatex(unit);
  if (parts.length === 1 && parts[0].power === 1 && parts[0].unit.name.startsWith("deg") && parts[0].unit.name.length <= 4) {
    // 30 deg -> 30^{\circ}; 20 degC -> 20^{\circ}\mathrm{C}
    return `${num}${UNIT_NAME_LATEX[parts[0].unit.name] ?? symbols}`;
  }
  return `${num}\\,\\mathrm{${symbols}}`;
}

/** Cleans mathjs `toTex` output for KaTeX and for variables mathjs mistakes for units. */
export function cleanTex(tex: string): string {
  return tex
    .replace(/\\_/g, "_")
    .replace(/\\mathrm\{([a-zA-Z])\}/g, "$1")
    .replace(/\{\s+/g, "{")
    .replace(/~/g, " ")
    .replace(/\\cdot\s*10\^\{/g, "\\times 10^{")
    .replace(/\s+/g, " ")
    .trim();
}

export function nodeToLatex(node: MathNode): string {
  return cleanTex(node.toTex({ parenthesis: "auto" }));
}

interface ComplexLike {
  re: number;
  im: number;
}

function isComplexLike(v: unknown): v is ComplexLike {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as ComplexLike).re === "number" &&
    typeof (v as ComplexLike).im === "number" &&
    !("units" in (v as object))
  );
}

function isUnitLike(v: unknown): v is Unit {
  return typeof v === "object" && v !== null && "units" in (v as object) && typeof (v as Unit).toNumber === "function";
}

function isNodeLike(v: unknown): v is MathNode {
  return typeof v === "object" && v !== null && typeof (v as MathNode).toTex === "function" && "type" in (v as object);
}

export function complexToLatex(c: ComplexLike, opts: NumberFormatOptions = {}): string {
  const re = tidyNumber(c.re);
  const im = tidyNumber(c.im);
  if (Math.abs(im) < 1e-12) return formatNumberLatex(re, opts);
  const imAbs = Math.abs(im);
  const imTex = imAbs === 1 ? "" : formatNumberLatex(imAbs, opts);
  if (Math.abs(re) < 1e-12) return `${im < 0 ? "-" : ""}${imTex}i`;
  return `${formatNumberLatex(re, opts)} ${im < 0 ? "-" : "+"} ${imTex}i`;
}

/** Any mathjs evaluation result -> LaTeX string ('' when it cannot be shown). */
export function valueToLatex(value: unknown, opts: NumberFormatOptions = {}): string {
  if (typeof value === "number") return formatNumberLatex(value, opts);
  if (typeof value === "boolean") return value ? "\\text{true}" : "\\text{false}";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return `\\text{${value.replace(/[{}\\]/g, "")}}`;
  if (isUnitLike(value)) return unitToLatex(value, opts);
  if (isComplexLike(value)) return complexToLatex(value, opts);
  if (isNodeLike(value)) return nodeToLatex(value);
  if (Array.isArray(value)) {
    return `\\left[${value.map((v) => valueToLatex(v, opts)).join(",\\ ")}\\right]`;
  }
  if (typeof value === "object" && value !== null) {
    const rec = value as { toArray?: () => unknown[]; valueOf?: () => unknown; n?: number | bigint; d?: number | bigint; s?: number | bigint };
    if (typeof rec.toArray === "function") return valueToLatex(rec.toArray(), opts);
    if ((typeof rec.n === "number" || typeof rec.n === "bigint") && (typeof rec.d === "number" || typeof rec.d === "bigint")) {
      const n = Number(rec.n);
      const d = Number(rec.d);
      const sign = Number(rec.s ?? 1) < 0 ? "-" : "";
      return d === 1 ? `${sign}${n}` : `${sign}\\frac{${n}}{${d}}`;
    }
    if (typeof rec.valueOf === "function") {
      const prim = rec.valueOf();
      if (typeof prim === "number") return formatNumberLatex(prim, opts);
    }
  }
  return "";
}
