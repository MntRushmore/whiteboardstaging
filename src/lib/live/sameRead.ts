/**
 * Do two reads of one handwritten line say the same thing? The recognize route's second opinion
 * (docs/PROBLEM-PAGES.md, "The second opinion"): Mathpix's strokes read against Mathpix v3/text's read
 * of the line's crop. Disagreement is the board's reason to ask the kid "Is this right?" — the best
 * trigger the SuperNet-201 eval found (docs/eval/mpx-supernet.md: about 2.7 % of lines asked, 71 % of
 * misreads caught). It is never a reason to swap one read for the other.
 *
 * A spelling comparison, not maths: the two readers write the same maths differently (`3 x=15` and
 * `3x = 15`, `x^{2}` and `x^2`, `\left(`, `\text { 12-5 }`), and those must agree; `0=5` and `a=5`
 * must not. Pure, server-safe.
 */
export function flatRead(latex: string): string {
  let s = latex
    // a read wrapped in text mode is its text (v3/text's `\text { 12-5 }`)
    .replace(/\\(?:text|mathrm|textrm|mbox|operatorname)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\left|\\right|\\displaystyle/g, "")
    // spacing commands
    .replace(/\\[,;:! ]|\\quad|\\qquad/g, "")
    // one product sign
    .replace(/\\cdot(?![a-zA-Z])/g, "\\times")
    // the readers' relations spelt alike
    .replace(/\\leq(?![a-zA-Z])/g, "\\le")
    .replace(/\\geq(?![a-zA-Z])/g, "\\ge")
    .replace(/\\neq(?![a-zA-Z])/g, "\\ne")
    .replace(/\\rightarrow(?![a-zA-Z])/g, "\\to");
  s = s.replace(/\s+/g, "");
  // braces round one token: `x^{2}` is `x^2`, `\frac{1}{x}` keeps its braces' meaning either way
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/([_^])\{([A-Za-z0-9])\}/g, "$1$2");
    if (next === s) break;
    s = next;
  }
  // a full stop at the end is the kid's, not the maths
  return s.replace(/\.$/, "");
}

/** The two reads are the same maths as written (see `flatRead`). An empty read agrees with nothing. */
export function sameRead(a: string, b: string): boolean {
  const fa = flatRead(a);
  const fb = flatRead(b);
  return fa.length > 0 && fa === fb;
}
