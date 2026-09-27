/**
 * When Solve may answer a quadratic with COMPLEX roots (`x = -1 \pm 2i`) instead of "no real
 * solution" (`\varnothing`). The owner's default: only when the student is already working with
 * `i` in that column — an Algebra 1 class never meets `i`, an Algebra 2 class writing `i^{2} = -1`
 * above expects it. A future per-class setting flips it by passing another value to `localSolve`
 * (`LocalSolveOptions.complexRoots`); nothing else needs to change.
 *
 * Pure string work: no mathjs, safe for the client bundle.
 */

export type ComplexRootsSetting =
  /** real roots only, always (`\varnothing` when there are none) */
  | "never"
  /** complex roots when a line of the column already uses the imaginary unit `i` (the default) */
  | "when-column-uses-i"
  /** complex roots whenever there are no real ones */
  | "always";

export const DEFAULT_COMPLEX_ROOTS: ComplexRootsSetting = "when-column-uses-i";

/**
 * The imaginary unit written as a letter of its own: `3i`, `2 + i`, `i^{2}`, `\sqrt{-1} = i` —
 * never the i of a command (`\sin`, `\pi`, `\infty`, `\int`, `\lim`) nor of a subscript or a word.
 */
export function usesImaginaryUnit(latex: string): boolean {
  const s = latex.replace(/\\[a-zA-Z]+/g, " ").replace(/_\{[^}]*\}|_[a-zA-Z0-9]/g, " ");
  return /(^|[^a-zA-Z])i(?![a-zA-Z])/.test(s);
}

/** Does this setting allow complex roots for a column (its lines down to the one solved)? */
export function allowComplexRoots(setting: ComplexRootsSetting, column: readonly string[]): boolean {
  if (setting === "always") return true;
  if (setting === "never") return false;
  return column.some(usesImaginaryUnit);
}
