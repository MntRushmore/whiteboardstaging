/**
 * The words-free text of a figure: how a point's name is written, and what a label says when it is
 * a number — a side's length (`3`, `4.5`, `3\sqrt{2}`, `\frac{5}{2}`, `6 cm`) or an angle in degrees
 * (`70^{\circ}`, `70°`). Pure string work, shared by the check and the drawer.
 */

/** A point's name as the hand writes it: trailing digits become a subscript (`P1` → `P_{1}`), primes stay. */
export function nameLatex(name: string): string {
  const m = /^([A-Za-z]+)(\d+)?('*)$/.exec(name);
  if (!m) return name;
  const [, letters, digits, primes] = m;
  return `${letters}${digits ? `_{${digits}}` : ""}${primes}`;
}

const UNIT = String.raw`(?:cm|mm|km|m|in|ft|yd|units?)`;

/** The label without spacing commands, spaces and a trailing unit (`6\,\mathrm{cm}` → `6`). */
function bare(label: string): string {
  return label
    .replace(/\\[,;:! ]|~/g, "")
    .replace(new RegExp(String.raw`\\(?:mathrm|text|operatorname)\{\s*${UNIT}\s*\}$`), "")
    .replace(/\s+/g, "")
    .replace(new RegExp(`${UNIT}$`), "");
}

const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;

/** A side label's length when it is a positive number: `3`, `4.5`, `3\sqrt{2}`, `\frac{5}{2}`, `5/2`, `6 cm`. */
export function lengthOf(label: string | undefined): number | null {
  if (!label) return null;
  const s = bare(label);
  let m: RegExpExecArray | null;
  let v: number | null = null;
  if ((m = new RegExp(`^${NUM}$`).exec(s))) v = Number(m[1]);
  else if ((m = new RegExp(String.raw`^${NUM}?\\sqrt\{?${NUM}\}?$`).exec(s))) v = (m[1] ? Number(m[1]) : 1) * Math.sqrt(Number(m[2]));
  else if ((m = new RegExp(String.raw`^\\[dt]?frac\{${NUM}\}\{${NUM}\}$`).exec(s))) v = Number(m[1]) / Number(m[2]);
  else if ((m = new RegExp(`^${NUM}/${NUM}$`).exec(s))) v = Number(m[1]) / Number(m[2]);
  return v !== null && Number.isFinite(v) && v > 0 ? v : null;
}

/** An angle label's size in degrees, only when it says degrees (`70^{\circ}`, `70°`, `70^\circ`): a bare `1` names an angle. */
export function degreesOf(label: string | undefined): number | null {
  if (!label) return null;
  const s = label.replace(/\s+/g, "");
  const m = new RegExp(String.raw`^${NUM}(?:\^\{?\\circ\}?|°|\\degree|\^\{?°\}?)$`).exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** Maths words the board may carry in a label (function names, units); anything else of 3+ letters is a word. */
const MATHS_WORDS = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "log", "ln", "exp", "deg", "rad", "cm", "mm", "km", "in", "ft", "yd", "unit", "units", "min", "max"]);

/** A label that is a word (`base`, `height`, `hypotenuse`) rather than maths — the board carries no words. */
export function wordIn(label: string): string | null {
  const stripped = label.replace(/\\[A-Za-z]+/g, " ");
  for (const w of stripped.match(/[A-Za-z]{3,}/g) ?? []) {
    if (!MATHS_WORDS.has(w.toLowerCase()) && /[a-z]/.test(w)) return w;
  }
  return null;
}

/** A number for a message: at most two decimals, no trailing zeros (`2.1`, `1.33`, `90`). */
export function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}
