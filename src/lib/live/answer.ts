/**
 * What the tutor writes when it answers a line, and in what colour.
 *
 * Two small pure concerns that the loop, the hand and the math shape all have to agree on.
 *
 * ## Composition
 *
 * A student wrote `36 + 2 =` and the echo put `36 + 2 = = 38` on their board: the shape
 * renders `props.latex` and then `props.resultLatex` behind a hard-coded `=`. A line that
 * already ends in a relation does not need another one — the answer that *continues* it is
 * `38`. Same the other way round: a result that is itself a relation (`= 38`) is not prefixed
 * a second time. Every place that joins a line to its answer goes through here.
 *
 * ## Colour
 *
 * Student ink is black. The tutor answers in the calm blue the AI shapes already use — never
 * red, which reads as a mark against the student's work rather than as help. One colour, two
 * spellings, because tldraw's `draw` shape takes a palette NAME and CSS takes a hex.
 */

/** tldraw `draw`-shape colour of everything the tutor writes by hand (palette blue, #4465e9). */
export const TUTOR_INK_COLOR = "blue" as const;

/** The same colour for CSS / SVG: the accent of the typeset AI shapes. */
export const TUTOR_INK_HEX = "#3b82f6";

/**
 * Relation operators a line can end with (or an answer can start with), longest spelling
 * first so `\neq` is not read as `\ne`.
 */
const RELATIONS = [
  "\\approx", "\\Rightarrow", "\\rightarrow", "\\implies", "\\equiv", "\\neq", "\\ne",
  "\\leq", "\\le", "\\geq", "\\ge", "\\to", "=", "<", ">",
] as const;

/** The relation at `i`, or null. A macro relation must end at a non-letter (`\le` vs `\left`). */
function relationAt(latex: string, i: number): string | null {
  for (const op of RELATIONS) {
    if (!latex.startsWith(op, i)) continue;
    if (op.startsWith("\\") && /[a-zA-Z]/.test(latex[i + op.length] ?? "")) continue;
    return op;
  }
  return null;
}

/** `= 38`, `\approx 3.14`: an answer that already carries its own relation. */
export function startsWithRelation(latex: string): boolean {
  return relationAt((latex ?? "").trimStart(), 0) !== null;
}

/** `36 + 2 =`: the student asked for the answer and there is nothing left to add. */
export function endsWithRelation(latex: string): boolean {
  const s = (latex ?? "").trimEnd();
  return RELATIONS.some((op) => s.endsWith(op));
}

/**
 * The piece that goes AFTER the student's line: the bare answer when their line already ends
 * in a relation (or the answer brings its own), otherwise the answer behind an `=`.
 */
export function answerContinuation(lineLatex: string, answer: string): string {
  const a = (answer ?? "").trim();
  if (!a) return "";
  if (startsWithRelation(a) || endsWithRelation(lineLatex ?? "")) return a;
  return `= ${a}`;
}

/** The whole line with its answer, as one string: never two relations in a row. */
export function composeAnswer(lineLatex: string, answer: string): string {
  const line = (lineLatex ?? "").trim();
  const cont = answerContinuation(line, answer);
  if (!cont) return line;
  if (!line) return cont;
  return `${line} ${cont}`;
}
