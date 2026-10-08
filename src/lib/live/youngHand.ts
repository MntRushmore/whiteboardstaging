/**
 * A young student's handwriting, as the recognizer reads it. Pure (no DOM, no tldraw, no store):
 * `liveLoop.ts` puts every read of a student's line through `readYoungHand` before it is judged.
 *
 * A child's `=` is two wobbly bars, often curved, often far apart, sometimes traced twice. Mathpix
 * reads that as almost anything but `=`: `\asymp` (a smile over a frown), `\approx` (two wavy bars),
 * `\sim` (one), `\smile` / `\frown` / `\cup` / `\cap` / `v` / `\wedge` (one curved bar), `\equiv`
 * (three), `\simeq`, `\cong`. Real reads of synthetic child-like ink, 2026-10-08:
 *
 *     two wavy bars        `\approx`       a wavy `=` then 7    `\approx 7`
 *     smile over frown     `\asymp`        one wavy bar         `\sim`
 *     a sagging bar        `\cup`          a bulging bar        `\cap`
 *     a small smile        `v`             a small frown        `\wedge`
 *     `= 9` and her tick   `=9 \vee`       `= 7` and her tick   `=7 \checkmark`
 *
 * On a real board (2026-10-06) a dot and a smiling bar came back `\smile`, shown as raw LaTeX on
 * the board, the answer beside it never judged. So, as a teacher reads a child's page:
 *
 *  - `\smile` / `\frown` (and their small forms) are never school maths: always `=`;
 *  - a relation look-alike (`\asymp`, `\approx`, `\sim` …), or two bars read stacked
 *    (`\underset{\smile}{\frown}`, `\frac{-}{-}`), ALONE on a line is an `=` waiting for its answer
 *    (`isLoneRelation`) — in arithmetic (a problem with no letters: `arithmetic`) a lone curved bar
 *    (`\cup`, `v` …) or minus too;
 *  - in arithmetic, a look-alike that starts the line (`\approx 7`, the answer to the sum beside it)
 *    or stands between two sides (`4 + 3 \asymp 7`) is `=`, and a tick she drew after her answer
 *    (`\checkmark`, `\vee`, `v`, an empty `\sqrt{}`) is no part of it;
 *  - anywhere else, only a look-alike the engine cannot read at all, between two sides of nothing
 *    but numbers, is `=`. Never `\approx`, which the engine judges as written, with a tolerance
 *    (`48 + 31 \approx 80` is right): with letters about, or decimals rounded off in algebra and
 *    precalculus (`x \approx 2.41`), an `\approx` is meant, and stays.
 */

export interface YoungReadContext {
  /**
   * The problem the line is part of has no letters — a sum, a product (`LiveLoop.arithmeticProblem`):
   * its answer is a number, and the student may be young enough to write just that.
   */
  arithmetic: boolean;
}

const commands = (names: readonly string[]) => names.map((n) => `\\\\${n}(?![a-zA-Z])`).join("|");

/** never maths at school: a bar drawn curved */
const CURVED = commands(["smile", "frown", "smallsmile", "smallfrown"]);
/** relations a wobbly `=` is read as, the engine cannot read */
const UNREADABLE = `${commands(["asymp", "sim", "simeq", "cong", "equiv", "eqsim", "backsim", "thicksim", "thickapprox", "approxeq", "doteq", "fallingdotseq", "risingdotseq", "bumpeq", "Bumpeq"])}|[≃≅≡∼]`;
/** ...and the one it reads, with a tolerance */
const APPROX = `${commands(["approx"])}|≈`;
/** what one curved bar of an `=` is read as, when it is not a relation: a set sign, a wedge, the letter v */
const BAR = `${commands(["cup", "cap", "vee", "wedge"])}|\\\\mathrm\\s*\\{\\s*v\\s*\\}|v`;

const STRONG = `(?:${CURVED}|${UNREADABLE}|${APPROX}|=|~)`;
const WEAK = `(?:${BAR}|-)`;
const STACK_PART = `(?:${CURVED}|${UNREADABLE}|${APPROX}|${BAR}|=|-)`;
const STACKED_RE = new RegExp(`\\\\(?:stackrel|overset|underset|frac|dfrac|tfrac)\\s*\\{\\s*${STACK_PART}\\s*\\}\\s*\\{\\s*${STACK_PART}\\s*\\}`, "g");
const CURVED_RE = new RegExp(CURVED, "g");
const LONE_STRONG_RE = new RegExp(`^(?:${STRONG}\\s*){1,3}$`);
const LONE_ANY_RE = new RegExp(`^(?:(?:${STRONG}|${WEAK})\\s*){1,3}$`);
/** the start of an answer: one or two look-alikes before a number (never a minus: that is `-7`) */
const LEADING_RE = new RegExp(`^(?:(?:${UNREADABLE}|${APPROX}|${BAR})\\s*){1,2}(?=\\d|\\.\\d|\\\\frac)`);
/** between two sides: after a number (or a bracket closing) and before one */
const between = (look: string) => new RegExp(`(?<=[\\d)}])\\s*(?:${look})\\s*(?=\\d|\\.\\d|[(-]|\\\\(?:frac|left))`, "g");
const MIDDLE_ANY_RE = between(`${UNREADABLE}|${APPROX}`);
const MIDDLE_UNREADABLE_RE = between(UNREADABLE);
/** a tick after the answer: `\checkmark`, `\text{✓}`, `\vee`, `v`, `V`, `\surd`, an empty `\sqrt{}` */
const TRAILING_TICK_RE = /(\d\}?)\s*(?:\\checkmark|\\text\s*\{\s*[✓✔]\s*\}|[✓✔]|\\vee(?![a-zA-Z])|\\surd(?![a-zA-Z])|\\sqrt\s*\{\s*\}|\\mathrm\s*\{\s*[vV]\s*\}|[vV])\s*$/;

/** Maths with digits and no letters: `18 + 15 - 19`, `6 \times 4`, `\frac{1}{2}` (relations allowed). */
function numbersOnly(latex: string): boolean {
  const bare = latex.replace(/\\(?:frac|dfrac|tfrac|times|div|cdot|left|right|quad|qquad|le|ge|ne|,|;|:|!)(?![a-zA-Z])/g, " ");
  return /\d/.test(bare) && !/[a-zA-Z\\]/.test(bare);
}

const tidy = (s: string) => s.replace(/=(?:\s*=)+/g, "=").replace(/\s+/g, " ").trim();

/** The line as a young student meant it (see the file comment); unchanged when nothing applies. */
export function readYoungHand(latex: string, ctx: YoungReadContext): string {
  let s = latex.replace(/⌣/g, "\\smile ").replace(/⌢/g, "\\frown ");
  // two bars read stacked, and a curved bar wherever it is
  s = tidy(s.replace(STACKED_RE, " = ").replace(CURVED_RE, " = "));
  if (LONE_STRONG_RE.test(s) || (ctx.arithmetic && LONE_ANY_RE.test(s))) return "=";
  if (ctx.arithmetic) {
    s = s.replace(TRAILING_TICK_RE, "$1").trim();
    s = s.replace(LEADING_RE, "= ");
  }
  // between two sides: in arithmetic any look-alike; anywhere, one the engine cannot read on a line of numbers
  const swapped = s.replace(ctx.arithmetic ? MIDDLE_ANY_RE : MIDDLE_UNREADABLE_RE, " = ");
  if (swapped !== s && numbersOnly(swapped)) s = swapped;
  s = tidy(s);
  return s === tidy(latex) ? latex : s;
}
