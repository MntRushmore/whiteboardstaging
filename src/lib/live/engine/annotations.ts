/**
 * A child's notes of what they do to both sides — `+2   +2` under `x - 2 = 5`, `×4  ×4` beside
 * `x/4 = 3`, `÷3` under a bar — are written so close to the equation that one read often holds both
 * (the real-ink bench, docs/REAL-INK-BENCH.md): `\frac{x}{4}=3 \quad \times 4`, or an array whose
 * second row is `+2+2`. Judged as written, that is a false equation, and right work was ringed. The
 * notes are the child's, not maths to judge: the equation is judged without them.
 */

/** One operation on a number: `+2`, `- 7`, `\times 4`, `\div -7`, `\cdot 3`. */
const OP = String.raw`(?:[+\-]|\\times|\\div|\\cdot|÷|×)\s*-?\s*\d+(?:\.\d+)?`;
const GAP = String.raw`(?:\\q?quad|\\[,;:!]|~|\s)*`;
/** A row that is only operations: `+2+2`, `\times 4 \quad \times 4`, `-10 \quad -10`. */
const NOTES_ROW = new RegExp(String.raw`^\s*${OP}(?:${GAP}${OP})*\s*$`);
/** An equation's row, then its notes after a wide gap or a times or divide sign. */
const TRAILING_NOTES = new RegExp(String.raw`^(.*=\s*[^=]*?\S)\s*(?:(?:\\q?quad)${GAP}${OP}(?:${GAP}${OP})*|${GAP}(?:\\times|\\div|÷|×)\s*-?\s*\d+(?:${GAP}(?:\\times|\\div|÷|×)\s*-?\s*\d+)*)\s*$`);
const ROWS = /^\s*\\begin\{(array|aligned|gathered)\}(?:\{[^{}]*\})?([\s\S]*)\\end\{\1\}\s*$/;

/**
 * The equation a read holds with the child's operation notes taken out; the read itself when it holds
 * no equation, no notes, or more than one equation (rows of real working, judged as they are).
 */
export function withoutOperationNotes(latex: string): string {
  const rows = ROWS.exec(latex);
  if (rows) {
    const parts = rows[2].split(/\\\\/).map((r) => r.replace(/&/g, "").trim()).filter((r) => r.length > 0);
    const notes = parts.filter((r) => NOTES_ROW.test(r));
    const rest = parts.filter((r) => !NOTES_ROW.test(r));
    if (notes.length > 0 && rest.length === 1 && rest[0].includes("=")) return withoutOperationNotes(rest[0]);
    return latex;
  }
  const m = TRAILING_NOTES.exec(latex);
  if (!m) return latex;
  // `x = 3 \times 4` is a product, not a note: a times or divide sign needs a gap before it, or a
  // second note after it (`3 \times 4 \times 4` reads as notes only when the line was right without)
  const head = m[1].trim();
  const tail = latex.slice(m[1].length);
  if (!/\\q?quad/.test(tail) && !/(?:\\times|\\div|÷|×)[^]*?(?:\\times|\\div|÷|×)/.test(tail)) return latex;
  return head;
}
