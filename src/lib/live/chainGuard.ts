/**
 * Guards on the second look before a ring (`LiveLoop.checkChain`; the iPad's twin is
 * LiveLoop+Chain.swift): it may take back a misread's ring, never a real slip's. A kid session,
 * 2026-10-22: `180+24=214` read at 1.00 and ringed, then re-read `180+34=214` — true — and the ring
 * came off. A re-read never changes a number the page already knows (any of the problem's; a
 * number of two digits or more of the line above's — a single digit turns up there by chance), and a sure first read (`SURE_READ`) is changed only when two re-reads say the same (the
 * routes give no per-character confidence: two agreeing looks stand in for it).
 */

/** A first read this sure is changed by the second look only when two re-reads agree. */
export const SURE_READ = 0.95;

/** The numbers in a read, in order: `\frac{12}{5} + 0.75` → `12`, `5`, `0.75`. */
export function numbersIn(latex: string): string[] {
  return latex.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * Does a re-read keep every number of the first read that the page already knows (`known`: the
 * problem's lines, the line above)? A number the student copied from the problem, read as such at
 * first, is the problem's number — a "fix" that changes it makes a slip look right.
 */
export function keepsKnownNumbers(first: string, reread: string, known: readonly string[]): boolean {
  const left = numbersIn(reread);
  const changed = numbersIn(first).filter((n) => {
    const i = left.indexOf(n);
    if (i === -1) return true;
    left.splice(i, 1);
    return false;
  });
  const knownNumbers = new Set(known.flatMap(numbersIn));
  return !changed.some((n) => knownNumbers.has(n));
}

/** The numbers the page knows for a line's second look: all of the problem's, and the line above's of two digits or more. */
export function knownNumbers(problem: readonly string[], above: string | null): string[] {
  return [...problem, ...(above ? numbersIn(above).filter((n) => n.replace(".", "").length >= 2) : [])];
}
