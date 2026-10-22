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

import type { InkStroke, LiveEngine, Rect } from "./contracts";
import { isDotStroke, isLevelBar, strokeLength } from "./strokeClusters";

export interface YoungReadContext {
  /**
   * The problem the line is part of has no letters — a sum, a product (`LiveLoop.arithmeticProblem`):
   * its answer is a number, and the student may be young enough to write just that.
   */
  arithmetic: boolean;
  /**
   * The signs the line starts with as its INK has them (`leadingSigns`: `=`, `-`, `=-`), when it is
   * known. In arithmetic the ink has the last word on an answer's signs: Mathpix read a wobbly `=`
   * (a wave and a bar) as one minus, `-54` for `= 54`, and the right answer was ringed.
   */
  signs?: string | null;
  /**
   * In arithmetic, is this read the problem's right answer? (the caller's engine: `problem = read`
   * holds). A read a child's glyph made nonsense of (`9,08` for 9108, her tick read into it, `-4
   * \quad-`) is taken as the one number it can only be — and only when that number is right
   * (`misreadVariants`): a nonsense read never becomes a wrong answer, so never a ring.
   */
  rightAnswer?: (latex: string) => boolean;
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
/** the start of an answer: one or two look-alikes before a number, or its minus (never a minus alone: that is `-7`) */
const LEADING_RE = new RegExp(`^(?:(?:${UNREADABLE}|${APPROX}|${BAR})\\s*){1,2}(?=-?\\s*(?:\\d|\\.\\d|\\\\frac))`);
/** an answer as read: its signs (`=`, `-`, in any number and order), then a number without one */
const SIGNED_ANSWER_RE = /^((?:\s*[=-])*)\s*(\d+(?:\.\d+)?|\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\})$/;
/** between two sides: after a number (or a bracket closing) and before one */
const between = (look: string) => new RegExp(`(?<=[\\d)}])\\s*(?:${look})\\s*(?=\\d|\\.\\d|[(-]|\\\\(?:frac|left))`, "g");
const MIDDLE_ANY_RE = between(`${UNREADABLE}|${APPROX}`);
const MIDDLE_UNREADABLE_RE = between(UNREADABLE);
/** a tick after the answer: `\checkmark`, `\text{✓}`, `\vee`, `v`, `V`, `\surd`, an empty `\sqrt{}` */
const TRAILING_TICK_RE = /(\d\}?)\s*(?:\\checkmark|\\text\s*\{\s*[✓✔]\s*\}|[✓✔]|\\vee(?![a-zA-Z])|\\surd(?![a-zA-Z])|\\sqrt\s*\{\s*\}|\\mathrm\s*\{\s*[vV]\s*\}|[vV])\s*$/;

/** ...and the ticks no maths could be, anywhere: `\checkmark`, `✓`, an empty `\sqrt{}` (a `√` with no bar over anything) */
const TRAILING_SURE_TICK_RE = /(\d\}?)\s*(?:\\checkmark|\\text\s*\{\s*[✓✔]\s*\}|[✓✔]|\\sqrt\s*\{\s*\})\s*$/;

/**
 * A child's numbers Mathpix took for words (`\text { 767-336 }`, `\text { = } 431`, `\text { 5/6 }`,
 * `\text { 3R3 }`, `\text { -9 }`; real reads of the Training Center's bench, 2026-10-21): text of
 * nothing but digits, signs and brackets — or a remainder's `R` between two numbers — is maths. Words
 * (`\text{apples}`, `\text { O }`) stay.
 */
function mathsOfText(latex: string): string {
  return latex.replace(/\\text\s*\{([^{}]*)\}/g, (m, inner: string) => {
    const t = inner.trim();
    if (/^\d+\s*[Rr]\s*\d+$/.test(t)) return ` ${t} `;
    if (/^[\d\s.,+\-=/()×÷:<>]+$/.test(t) && /[\d=+\-<>]/.test(t)) return ` ${t} `;
    return m;
  });
}

/**
 * A long-division bracket as Mathpix reads one with its quotient over it: the divisor and its bracket
 * taken for words (`\text { 9) }`, a 9 read `g`), the quotient over the overline read as a fraction's
 * top (`\frac{16}{144}`). Put as the bracket the engine reads (`primaryWork.ts`):
 * `\begin{array}{r} 16 \\ 9)\overline{144} \end{array}`. Nothing else is changed.
 */
const BRACKET_READ_RE = /^\s*(?:\\text\s*\{\s*([0-9gq]{1,3})\s*\)\s*\}|(\d{1,3})\s*\))\s*\\[dt]?frac\s*\{\s*(\d+)\s*\}\s*\{\s*(\d+)\s*\}\s*$/;
function bracketOfRead(latex: string): string {
  const m = BRACKET_READ_RE.exec(latex);
  if (!m) return latex;
  const divisor = (m[1] ?? m[2]).replace(/[gq]/g, "9");
  return `\\begin{array}{r} ${m[3]} \\\\ ${divisor})\\overline{${m[4]}} \\end{array}`;
}

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
 * An answer read as its signs and a number (`-54`, `=3`, `=-10`), its signs as the ink has them
 * (`signs`, `leadingSigns`) when Mathpix read no more signs than the ink has: a wobbly `=` read as a
 * minus (`-54` → `= 54`), a minus it dropped (`=3` → `= -3` when the ink is `=` then `-`), the two
 * swapped (`-=3`). Never a sign taken away that the ink may have had: with more signs read than the
 * ink's bars say (`=-3` for ink of one `=`), the read stands.
 */
function withSignsOfInk(s: string, signs: string | null | undefined): string {
  if (!signs) return s;
  const m = SIGNED_ANSWER_RE.exec(s);
  if (!m) return s;
  const read = m[1].replace(/\s/g, "");
  if (read === signs || read.length > signs.length) return s;
  return signs.startsWith("=") ? `= ${signs.slice(1)}${m[2]}` : `${signs}${m[2]}`;
}

/**
 * The signs a line starts with, as its INK has them — `=`, `-` or `=-` — or null when it starts with
 * no bar, is nothing but bars, or its bars say nothing clear. Its level bars (`isLevelBar`) before its
 * first glyph, left to right: bars one over another (overlapping across a third of the shorter) are
 * one sign — two levels an `=`, one a `-` (a bar traced twice is still one) — and a bar beside them is
 * another. A young hand's `=` is a wave and a bar half over it, `= -` two bars and a third well to
 * their right; Mathpix reads them as it likes (`-54`, `=3`).
 */
export function leadingSigns(strokes: readonly InkStroke[]): string | null {
  const ink = strokes.filter((s) => !isDotStroke(s));
  const glyphs = ink.filter((s) => !isLevelBar(s.bounds));
  if (glyphs.length === 0) return null;
  const lead = glyphs.reduce((m, s) => (s.bounds.x < m.bounds.x ? s : m)).bounds;
  // wholly before the first glyph (touching it at most): a 7's top bar drawn on its own spans the 7
  const bars = ink
    .filter((s) => isLevelBar(s.bounds) && s.bounds.x + s.bounds.w <= lead.x + 0.3 * lead.w)
    .map((s) => s.bounds)
    .sort((a, b) => a.x - b.x);
  if (bars.length === 0) return null;
  const groups: Rect[][] = [];
  for (const b of bars) {
    const g = groups[groups.length - 1];
    const over = g?.some((o) => Math.min(o.x + o.w, b.x + b.w) - Math.max(o.x, b.x) >= Math.min(o.w, b.w) / 3);
    if (g && over) g.push(b);
    else groups.push([b]);
  }
  let signs = "";
  for (const g of groups) {
    // the levels of a group: bars whose heights overlap (within a few px) are one
    let levels = 0;
    let bottom = -Infinity;
    for (const b of [...g].sort((p, q) => p.y - q.y)) {
      if (b.y > bottom + 3) levels += 1;
      bottom = Math.max(bottom, b.y + b.h);
    }
    if (levels > 2) return null;
    signs += levels === 2 ? "=" : "-";
  }
  return signs === "=" || signs === "-" || signs === "=-" ? signs : null;
}

/**
 * The line's ink starts with a minus: its leftmost level bar in the middle of the line's height, no
 * other ink to the left of it at that height (a `5` whose tail curls out under it is fine), no bar
 * over or under it (an `=`), no stroke through it (a `+`), and writing within a glyph's height to its
 * right. The stroke a read that starts with no sign has left out (`readVariants`' `minus`).
 */
export function inkLeadsWithMinus(strokes: readonly InkStroke[]): boolean {
  const ink = strokes.filter((s) => !isDotStroke(s));
  const glyphs = ink.filter((s) => !isLevelBar(s.bounds));
  if (glyphs.length === 0) return false;
  const top = Math.min(...glyphs.map((s) => s.bounds.y));
  const h = Math.max(...glyphs.map((s) => s.bounds.y + s.bounds.h)) - top;
  const bars = ink
    .filter((s) => isLevelBar(s.bounds))
    .filter((s) => {
      const cy = s.bounds.y + s.bounds.h / 2;
      return cy >= top + 0.25 * h && cy <= top + 0.8 * h;
    })
    .sort((p, q) => p.bounds.x - q.bounds.x);
  const bar = bars[0];
  if (!bar) return false;
  const { x, w } = bar.bounds;
  const cy = bar.bounds.y + bar.bounds.h / 2;
  const points = (s: InkStroke) => s.segments.flat();
  const others = ink.filter((s) => s !== bar);
  // nothing further left at its height, nothing through it
  if (others.some((s) => points(s).some((p) => p.x < x + 0.7 * w && Math.abs(p.y - cy) <= 0.2 * h))) return false;
  // no bar over or under it
  if (others.some((s) => isLevelBar(s.bounds) && Math.min(s.bounds.x + s.bounds.w, x + w) - Math.max(s.bounds.x, x) >= Math.min(s.bounds.w, w) / 3)) return false;
  // writing right after it
  const next = Math.min(...glyphs.flatMap((s) => points(s).filter((p) => p.x >= x + 0.5 * w && Math.abs(p.y - cy) <= 0.5 * h).map((p) => p.x)));
  return Number.isFinite(next) && next - (x + w) <= h;
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

/**
 * A read that is a whole number with a bar over it (`\overline{544}`, `= \overline{544}`): in
 * arithmetic, the rule of a stacked sum or product over its answer, read into it. Never after a `)`
 * (a long-division bracket) or a decimal point (a repeating decimal): the whole read is the number.
 */
const OVERLINED_ANSWER_RE = /^(\s*=?\s*-?\s*)\\overline\s*\{\s*(\d+)\s*\}\s*$/;

/** A number's commas as thousands separators: `1,500`, `12,345,678` (and no comma at all). */
const THOUSANDS_RE = /^\d{1,3}(?:,\d{3})+$/;

/**
 * What a nonsense read of a young student's answer may have been (`YoungReadContext.rightAnswer`
 * picks one only when it is right):
 *  - a comma between digits that no thousands separator could be (`9,08`): a short `1` (or a tap
 *    of the pen) read as a comma — `9108`, `908`;
 *  - a spaced tail of a stroke or two after the number (`-4 \quad-`, `27 \quad ,`): her own tick
 *    or a stray, read into the answer — the number alone.
 * Plain numbers only (`ANSWER_NUMBER`); empty when nothing applies.
 */
export function misreadVariants(read: string): string[] {
  const out = new Set<string>();
  const lead = /^\s*=\s*/.exec(read)?.[0] ?? "";
  const body = read.slice(lead.length).trim();
  const number = /^-?\s*[\d,]+$/.exec(body)?.[0];
  if (number && /\d,\d/.test(number) && !THOUSANDS_RE.test(number.replace(/^-\s*/, ""))) {
    out.add(lead + number.replace(/(?<=\d),(?=\d)/g, "1"));
    out.add(lead + number.replace(/(?<=\d),(?=\d)/g, ""));
  }
  const tail = /^(-?\s*(?:\d+(?:\.\d+)?|\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\}))\s*(?:\\q?quad|\\[,;:]|~)\s*[-,.'`^~|/]?\s*(?:\\(?:prime|vee|wedge))?\s*$/.exec(body);
  if (tail) out.add(lead + tail[1].trim());
  return [...out].filter((v) => v !== read && ANSWER_NUMBER.test(v.slice(lead.length)));
}

/**
 * `YoungReadContext.rightAnswer` for an arithmetic problem of one line: the read, its `=` aside, is a
 * plain number (`ANSWER_NUMBER`) and `problem = number` holds. Undefined for a problem of more lines.
 */
export function rightAnswerTo(engine: LiveEngine, problem: readonly string[]): ((latex: string) => boolean) | undefined {
  if (problem.length !== 1) return undefined;
  return (latex) => {
    const answer = latex.replace(/^\s*=\s*/, "").trim();
    if (!ANSWER_NUMBER.test(answer)) return false;
    try {
      return engine.analyzeLine(`${problem[0]} = ${answer}`, { mode: "feedback" }).verdict === "ok";
    } catch {
      return false;
    }
  };
}

/** An exponent that is nothing but a plus, a term after it (`5 x^{+} 20`): never meant — the `+` written a little high (an ion's `Na^{+}` has none). */
const SIGN_EXPONENT_RE = /(?<=[\da-zA-Z)}])\s*\^\s*\{\s*\+\s*\}(?=\s*[\da-zA-Z(\\])/g;
/** A `\times` with nothing before it (`\times=2`, `(\times + 1)`): no product — her `x`. */
const LONE_TIMES_RE = /(^|[=(+\-]\s*)\\times(?![a-zA-Z])(?=\s*(?:[=+\-)]|$))/g;
/** A left arrow and what follows it (`2 x=11-3 \Longleftarrow 9`): a note at the side, pointing back. */
const LEFT_ARROW_TAIL_RE = /\s*\\(?:Long|long)?(?:left|Left)arrow(?![a-zA-Z]).*$/;

/**
 * Out of arithmetic, what a messy read of a child's step may have been (real-ink bench, 2026-10-22):
 * a plus written high, read as an exponent (`5 x^{+} 20`); her `x` read as a times sign with nothing
 * to multiply (`\times=2`); a note at the side behind a left arrow (`2 x=11-3 \Longleftarrow 9`); and,
 * when her ink starts with a minus right before its first glyph (`minus`: `inkLeadsWithMinus`), that
 * minus, which the read dropped (`-5x + 20 - 6x` read `5 x^{+} 20-6 x`: the right step was ringed).
 * Each alone, then all together; none drops a number that `keep` (the problem, the line above) has.
 * They are only ever taken to find a step RIGHT (`judgeLine`, the loop's second look before a ring),
 * and each is a confusion of what the ink shows: a variant never makes a ring or a "?".
 */
export function readVariants(read: string, minus = false, keep: readonly string[] = []): string[] {
  // never a number taken out that the problem or the line above has (a side note's `9` may go; a
  // `9` the work is about may not): a variant must not make right what the ink does not say
  const kept = new Set(keep.flatMap(numbersIn));
  const steps: Array<(s: string) => string> = [
    (s) => s.replace(SIGN_EXPONENT_RE, " + "),
    (s) => s.replace(LONE_TIMES_RE, "$1x"),
    (s) => {
      const noted = s.replace(LEFT_ARROW_TAIL_RE, "");
      return /[=<>]|\\(?:le|ge|leq|geq)(?![a-zA-Z])/.test(noted) ? noted : s;
    },
    (s) => (minus && /^(?:\d|[a-zA-Z(]|\\(?:frac|left|sqrt)(?![a-zA-Z]))/.test(s.trim()) ? `-${s.trim()}` : s),
  ];
  const out: string[] = [];
  const before = numbersIn(read);
  const add = (v: string) => {
    const t = tidy(v);
    if (t === tidy(read) || out.includes(t)) return;
    // the same numbers, in order, but for some a side note held that nothing above has
    const after = numbersIn(t);
    let k = 0;
    for (const n of before) {
      if (n === after[k]) k += 1;
      else if (kept.has(n)) return;
    }
    if (k === after.length) out.push(t);
  };
  for (const step of steps) add(step(read));
  add(steps.reduce((s, step) => step(s), read));
  return out;
}

/** The numbers written in a read, unsigned, in order (`12`, `3.5`). */
function numbersIn(latex: string): string[] {
  return latex.match(/\d+(?:\.\d+)?/g) ?? [];
}

/** The line as a young student meant it (see the file comment); unchanged when nothing applies. */
export function readYoungHand(latex: string, ctx: YoungReadContext): string {
  // her numbers read as words, her long division's bracket read as words and a fraction
  let s = bracketOfRead(mathsOfText(latex)).replace(/⌣/g, "\\smile ").replace(/⌢/g, "\\frown ");
  // two bars read stacked, and a curved bar wherever it is
  s = tidy(s.replace(STACKED_RE, " = ").replace(CURVED_RE, " = "));
  if (LONE_STRONG_RE.test(s) || (ctx.arithmetic && LONE_ANY_RE.test(s))) return "=";
  if (ctx.arithmetic) {
    s = s.replace(TRAILING_TICK_RE, "$1").trim();
    s = s.replace(LEADING_RE, "= ");
    s = withSignsOfInk(s, ctx.signs);
    s = s.replace(OVERLINED_ANSWER_RE, "$1$2");
  } else {
    // in algebra too, a tick no maths could be (`x=4 \sqrt{ }`: a `√` over nothing is her ✓)
    s = s.replace(TRAILING_SURE_TICK_RE, "$1").trim();
  }
  // between two sides: in arithmetic any look-alike; anywhere, one the engine cannot read on a line of numbers
  const swapped = s.replace(ctx.arithmetic ? MIDDLE_ANY_RE : MIDDLE_UNREADABLE_RE, " = ");
  if (swapped !== s && numbersOnly(swapped)) s = swapped;
  s = tidy(s);
  // a nonsense read of her answer that can only have been the right number (`misreadVariants`)
  if (ctx.arithmetic && ctx.rightAnswer && !ctx.rightAnswer(s)) {
    const meant = misreadVariants(s).find((v) => ctx.rightAnswer?.(v));
    if (meant) return meant;
  }
  return s === tidy(latex) ? latex : s;
}

// ---------------------------------------------------------------- what is on the page but no maths

/**
 * Her own tick: ONE stroke shaped like a ✓ — two straight-ish arms meeting at its lowest point, the
 * corner in the left half, the long arm reaching up to the top on the right and at least 1.3 times
 * the short one, which rises less — drawn in either direction (a young hand draws it from the top of
 * the long arm down, then up the short one), its short arm slanting or straight down. A `√` drawn without its bar is the same shape: it is
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
  // the short arm may come straight down (the corner right under where it starts: a real child's ✓)
  if (corner.x < left.x - 0.05 * w || corner.x >= right.x || corner.x - left.x > 0.5 * (right.x - left.x)) return false;
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
