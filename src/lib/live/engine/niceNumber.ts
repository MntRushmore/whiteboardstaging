/**
 * Nice numbers: a coordinate the engine found, as the exact fraction it is (`0.49999999997` → ½).
 * On their own, with no imports, so the graph sketcher (`graphing/plan.ts`, in the board's first
 * load) can write `-\frac{1}{2}` without bringing the engine's graph reader (`graphIntent.ts`, its
 * LaTeX translator and classifier) into the board's first load with it.
 */

/** A coordinate is written only when it is p/q with q at most this. */
const MAX_DENOMINATOR = 12;

/** `v` as p/q with a small q, or null. */
export function niceRational(v: number): { p: number; q: number } | null {
  if (!Number.isFinite(v) || Math.abs(v) > 1e6) return null;
  for (let q = 1; q <= MAX_DENOMINATOR; q++) {
    const p = Math.round(v * q);
    if (Math.abs(v * q - p) < 1e-7 * Math.max(1, Math.abs(p))) return { p, q };
  }
  return null;
}

/** The exact value `v` snaps to (`0.49999999997` → `0.5`), or `v` itself. */
export function snap(v: number): number {
  const r = niceRational(v);
  if (!r) return v;
  const s = r.p / r.q;
  return Object.is(s, -0) ? 0 : s;
}

/** LaTeX of a nice number (`-\frac{1}{2}`, `3`), or null when it is not one. */
export function niceLatex(v: number): string | null {
  const r = niceRational(v);
  if (!r) return null;
  const g = gcdInt(Math.abs(r.p), r.q);
  const p = r.p / g;
  const q = r.q / g;
  if (p === 0) return "0";
  if (q === 1) return String(p);
  return `${p < 0 ? "-" : ""}\\frac{${Math.abs(p)}}{${q}}`;
}

function gcdInt(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a || 1;
}
