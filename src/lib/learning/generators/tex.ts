/**
 * LaTeX builders for practice problems, in the board chat's conventions (`prompts/chat.ts` rules
 * 2–3): `x^{2}`, `\frac{x}{2}`, braces on every exponent and subscript, one space around `+`, `-`,
 * `=` and the relations, a coefficient of 1 left out and a minus written as a minus (`3x - 5`, never
 * `3x + -5`).
 */

/** One term of a sum: a coefficient and its letter part (`""` for a constant). */
export type Term = readonly [coefficient: number, letters: string];

/** A coefficient on a letter part: 1 → `x`, -1 → `-x`, 3 → `3x`; a constant as itself. */
export function coef(c: number, letters: string): string {
  if (letters === "") return String(c);
  if (c === 1) return letters;
  if (c === -1) return `-${letters}`;
  return `${c}${letters}`;
}

/** Terms joined with their signs, zero terms left out: [[3, "x^{2}"], [-5, "x"], [6, ""]] → `3x^{2} - 5x + 6`. */
export function terms(parts: readonly Term[]): string {
  let out = "";
  for (const [c, letters] of parts) {
    if (c === 0) continue;
    if (!out) out = coef(c, letters);
    else out += c < 0 ? ` - ${coef(-c, letters)}` : ` + ${coef(c, letters)}`;
  }
  return out || "0";
}

/** `ax + b` */
export function lin(a: number, b: number, v = "x"): string {
  return terms([
    [a, v],
    [b, ""],
  ]);
}

/** A polynomial from its coefficients, highest power first: [1, -5, 6] → `x^{2} - 5x + 6`. */
export function poly(coefs: readonly number[], v = "x"): string {
  const top = coefs.length - 1;
  return terms(coefs.map((c, i): Term => [c, top - i === 0 ? "" : top - i === 1 ? v : `${v}^{${top - i}}`]));
}

/** `\frac{a}{b}` */
export function frac(a: number | string, b: number | string): string {
  return `\\frac{${a}}{${b}}`;
}

/** A negative number in brackets, as it is written inside a product or after a minus: `(-3)`. */
export function par(v: number): string {
  return v < 0 ? `(${v})` : String(v);
}

/** `+ 3` / `- 3`: a number written after another term. */
export function plus(v: number): string {
  return v < 0 ? `- ${-v}` : `+ ${v}`;
}

/** `70^{\circ}` */
export function deg(v: number | string): string {
  return `${v}^{\\circ}`;
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

/** A decimal from a whole number of tenths or hundredths, with no trailing zeros: (25, 1) → `2.5`. */
export function dec(units: number, places: number): string {
  const s = (units / 10 ** places).toFixed(places);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** True when a whole number is a perfect square. */
export function isSquare(n: number): boolean {
  if (n < 0) return false;
  const r = Math.round(Math.sqrt(n));
  return r * r === n;
}

/** `a + bi` with the board's signs (`3 - 2i`, `-1 + i`, `4i`, `5`). */
export function complex(a: number, b: number): string {
  return terms([
    [a, ""],
    [b, "i"],
  ]);
}
