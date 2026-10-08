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

import type { InkStroke } from "./contracts";
import { isDotStroke, isLevelBar, strokeLength } from "./strokeClusters";

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

/** A number as a young student writes an answer: `14`, `-3`, `2.5`, `\frac{3}{4}`, `3/4`. */
const ANSWER_NUMBER = /^\s*-?\s*(?:\d+(?:\.\d+)?|\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\}|\d+\s*\/\s*\d+)\s*$/;

/** LaTeX with its spacing, braces and sizing taken out, to compare two writings of one sum. */
const squash = (s: string) => s.replace(/\\(?:left|right)(?![a-zA-Z])|\\[,;:! ]|[{}\s]/g, "").replace(/\\cdot|\\times/g, "×");

/**
 * The answer of a line that writes the END of the problem beside it again, then its answer: `3 = 7`
 * after `4 +` of the tutor's `4 + 3` (she rubbed out its 3 and wrote her own), `+ 3 = 7`, `3 = 17`
 * after `14 + 3`. Its answer as a line of its own (`= 7`), to judge as the answer to the problem;
 * null for anything else — the whole problem again (`4 + 3 = 7` is judged as it is written), a
 * number that is not the problem's last (`13 = 17` after `4 + 3`; `3 = 17` after `4 + 13`).
 */
export function answerAfterRestatedEnd(line: string, problem: string): string | null {
  const at = line.indexOf("=");
  if (at <= 0) return null;
  const left = squash(line.slice(0, at));
  const right = line.slice(at + 1).trim();
  if (!left || !ANSWER_NUMBER.test(right)) return null;
  const p = squash(problem);
  if (left === p || !p.endsWith(left)) return null;
  // the part written again starts a term of the problem: after its operator, or with one
  const before = p.slice(0, p.length - left.length);
  if (!/^[+\-×÷]/.test(left) && !/(?:[+\-×÷/(]|\\div)$/.test(before)) return null;
  return `= ${right}`;
}

/**
 * Nothing but level bars (and taps of the pen): `-`, `=`, `= -` — the signs of an answer, its number
 * still to come. Under one of the chat's problems such a line is not read until the number joins it
 * (`LiveLoop.withoutStrays`): Mathpix reads a lone minus as `\backslash`, and `= -` as `=`.
 */
export function isSignsOnly(strokes: readonly InkStroke[]): boolean {
  let bars = 0;
  for (const s of strokes) {
    if (isDotStroke(s)) continue;
    if (!isLevelBar(s.bounds)) return false;
    bars += 1;
  }
  return bars > 0;
}

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

// ---------------------------------------------------------------- what is on the page but no maths

/**
 * Her own tick: ONE stroke shaped like a ✓ — two straight-ish arms meeting at its lowest point, the
 * corner in the left half, the long arm reaching up to the top on the right and at least 1.3 times
 * the short one, which rises less — drawn in either direction (a young hand draws it from the top of
 * the long arm down, then up the short one). A `√` drawn without its bar is the same shape: it is
 * only taken for a tick at the end of an answer in arithmetic (`ownTicks`). A `7`, a `2`, an `L` end
 * at their lowest point or at the bottom; a `v` or a `U` has arms of one length.
 */
export function isTickStroke(s: InkStroke): boolean {
  if (s.segments.length !== 1) return false;
  const pts = s.segments[0];
  const { y, w, h } = s.bounds;
  if (pts.length < 4 || w <= 0 || h <= 0 || w > 2.5 * h || h > 2.5 * w) return false;
  let v = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].y > pts[v].y) v = i;
  if (v === 0 || v === pts.length - 1) return false;
  const corner = pts[v];
  const [left, right] = pts[0].x <= pts[pts.length - 1].x ? [pts[0], pts[pts.length - 1]] : [pts[pts.length - 1], pts[0]];
  if (corner.x <= left.x || corner.x >= right.x || corner.x - left.x > 0.5 * (right.x - left.x)) return false;
  if (right.y > y + 0.3 * h || left.y > corner.y - 0.2 * h || left.y <= right.y) return false;
  const long = Math.hypot(right.x - corner.x, right.y - corner.y);
  const short = Math.hypot(left.x - corner.x, left.y - corner.y);
  return long >= 1.3 * short && strokeLength(s) <= 1.4 * (long + short);
}

/**
 * The ticks a young student drew after her answer on this line (`isTickStroke`, its strokes): at its
 * right end, nothing of the line further right than the tick's short arm. She ticks her own sums when
 * she is done; read with her answer it is `\checkmark`, `\vee`, or — `= 11 ✓` — `=11^{2}`, and the
 * right 11 was ringed. Only in arithmetic (the caller's to know): in algebra it may be a `√`.
 */
export function ownTicks(strokes: readonly InkStroke[]): InkStroke[] {
  const rest = [...strokes];
  const ticks: InkStroke[] = [];
  for (;;) {
    const last = rest.reduce<InkStroke | null>((m, s) => (!m || s.bounds.x + s.bounds.w > m.bounds.x + m.bounds.w ? s : m), null);
    if (!last || !isTickStroke(last)) return ticks;
    const others = rest.filter((s) => s !== last);
    const reach = Math.max(-Infinity, ...others.map((s) => s.bounds.x + s.bounds.w));
    if (reach > last.bounds.x + 0.35 * last.bounds.w) return ticks;
    ticks.push(last);
    rest.splice(rest.indexOf(last), 1);
  }
}

/**
 * A line of nothing but taps of the pen: every stroke a dot (`isDotStroke`) or no bigger, either way,
 * than a quarter of the hand's glyphs (`glyph`: `medianStrokeHeight` of the screen's writing). Never
 * read — Mathpix answers `\text{-}` for one dot and "content not found" for a few — so never given a
 * "?" either. A dot that is part of a line (a decimal point, the dot of an `i`) is read with it.
 */
export function isSpeckLine(strokes: readonly InkStroke[], glyph: number): boolean {
  return strokes.length > 0 && strokes.every((s) => isDotStroke(s) || Math.max(s.bounds.w, s.bounds.h) <= 0.25 * glyph);
}
