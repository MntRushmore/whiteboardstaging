/**
 * "The tutor writes it out" on a stacked (column) sum (docs/TUTOR-WRITES.md): the next COLUMN, as a
 * teacher does it at the board — its digit under the rule and the carry it sends over the column on
 * its left; a borrow said in words; a right digit under a wrong one; and long multiplication a row
 * at a time (46 × 3, then 46 × 20), then a rule and the rows added column by column.
 *
 *        ¹                the kid's 286 + 680, nothing under the rule yet:
 *       286               ask 1 → 6 (6 + 0 = 6)
 *     + 680               ask 2 → 6, and the 1 carried over the hundreds (8 + 8 = 16)
 *     -----               ask 3 → the last column: held back unless the answer is asked for
 *       966                       and allowed (`answer`)
 *
 * Everything here is the engine's (`engine/columnArithmetic.ts`: the read parsed, the sum worked
 * place by place) and the ink's (`stackedSums.ts`' `stackGrid`: where each column is, where the
 * answer row, a carry and a row under the answer are written). No model is ever asked. A read the
 * board is not sure of, a block the engine does not work, or a slip in long multiplication's rows
 * gets words, never digits (`unsure`, `hint`).
 *
 * What the tutor has written into the sum already comes back as its parts (`tutor`): `a2` the
 * answer's hundreds, `c2` a carry over them, `f2` a right digit under a wrong one, `r1` long
 * multiplication's second row, `rule` the rule under the rows, `s0` their sum's ones. A part is never
 * written twice, and the next ask goes on from them.
 */
import { parseStacked, placeName, placesLeft, rowPlaces, workStacked, type StackedWork } from "./engine/columnArithmetic";
import { STACK_RING_CONFIDENCE } from "./engine/columnWork";
import { handSeedFor, HAND_WRITE, inlineHandSizeFor, placeHandPlanOnBaseline, planFromStrokes, planHandwriting, type HandPlan } from "./handwriting";
import { stackGrid, type StackGrid, type StackedSum } from "./stackedSums";

export interface StackStepArgs {
  /** the line's read (`\begin{array}{r} 286 \\ +680 \\ \hline \end{array}`) */
  latex: string;
  confidence?: number;
  /** the stacked sum in the ink this line is (`clusterStrokes`' `stacks`) */
  stack: StackedSum;
  /** the parts the tutor has written into this sum (`a0`, `c1`, `r1`, `rule`, `s2` …) */
  tutor?: string[];
  /** the final answer may be written: asked for, and the grown-ups allow answers */
  answer?: boolean;
  /** the bottom of the line's ink (page px): long multiplication's next row goes under it */
  inkBottom?: number;
  /** the board's fit zoom (the hand's size) */
  zoom?: number;
  /** the line's id (the hand's seed) */
  lineId?: string;
  /** how far the read is trusted: `unsure` (a doubtful read) or `sure` is read back before digits are written from it, unless the problem is known; `confirmed` by the kid */
  trust?: "sure" | "unsure" | "confirmed";
  /** the problem the sum is the work of (the tutor's), if any: its numbers must be the rows' */
  problem?: string[];
  /** the problem is known though not in `problem` (a SAT question) */
  known?: boolean;
}

export interface StackPart {
  /** `a2`, `c3`, `f1`, `r1`, `rule`, `s0` */
  part: string;
  /** what it says (`6`; '' for a rule) */
  text: string;
  /** in the tutor's hand, placed (page px) */
  plan: HandPlan;
}

export interface StackStepResult {
  kind: "step" | "answer" | "lastStep" | "fix" | "solved" | "hint" | "unsure" | "nothing" | "readback";
  /** what to write, in order (right to left, as the sum is done); empty for words-only results */
  parts: StackPart[];
  /** what the column does, in a kid's words */
  why: string;
  /** the sum the parts belong to: its operator and numbers (`+ 286 680`) */
  key: string;
  /** the sum as read, in a kid's words (`286 + 680`): what a readback says */
  reading?: string;
}

const UNSURE = "I can't line up these columns for sure, so I won't guess. Write the numbers one under the other, then ask again.";

/** row spacing of long multiplication's rows, in digit heights */
const ROW_PITCH = 1.45;

function nothing(kind: StackStepResult["kind"], why = "", key = ""): StackStepResult {
  return { kind, parts: [], why, key };
}

/** A digit (or a few) in the hand, centred on `x`, sitting on `baselineY`. */
function digitPlan(text: string, x: number, baselineY: number, size: number, seed: number): HandPlan | null {
  const { plan, unsupported } = planHandwriting([text], { size, seed });
  if (!plan || unsupported.length > 0) return null;
  return placeHandPlanOnBaseline(plan, { x: x - plan.bounds.w / 2, baselineY });
}

/** A rule drawn by hand from x0 to x1 at y: one stroke, very slightly uneven. */
function rulePlan(x0: number, x1: number, y: number, size: number, seed: number): HandPlan | null {
  const n = Math.max(2, Math.round((x1 - x0) / 6));
  const points = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const wobble = Math.sin((seed % 97) + t * 5.3) * 0.6;
    return { x: x0 + (x1 - x0) * t, y: y + wobble + t * 0.8, z: 0.5 };
  });
  return planFromStrokes("rule", [{ points, order: 0, kind: "rule" }], size);
}

/** What one column of a sum does, in words: `8 + 8 = 16. Write 6 and carry the 1.` */
function columnWords(work: StackedWork, p: number, end: boolean): string {
  const nums = work.operands.map((n) => digitsByPlace(n, work.decimals));
  const at = (m: Map<number, number>, k: number) => m.get(k) ?? 0;
  const name = placeName(p, work.decimals);
  if (work.op === "+") {
    const carryIn = work.carries[p] ?? 0;
    const terms = nums.map((m) => at(m, p)).filter((d, i) => d !== 0 || i === 0 || nums[i].has(p));
    const sum = terms.reduce((s, d) => s + d, 0) + carryIn;
    const left = `${terms.join(" + ")}${carryIn > 0 ? ` + the ${carryIn} you carried` : ""} = ${sum}`;
    if (end || sum < 10) return `${cap(name)}: ${left}.`;
    return `${cap(name)}: ${left}. Write ${sum % 10} and carry the ${Math.floor(sum / 10)}.`;
  }
  if (work.op === "-") {
    const lent = work.carries[p] ?? 0;
    const top = at(nums[0], p) - lent;
    const bottom = at(nums[1], p);
    const lentWords = lent > 0 ? `The ${at(nums[0], p)} lent 1, so it's ${top} now. ` : "";
    if (top < bottom) {
      const next = placeName(p + 1, work.decimals);
      return `${cap(name)}: ${lentWords}${top} is less than ${bottom}, so borrow 1 from the ${next}. ${top + 10} - ${bottom} = ${top + 10 - bottom}.`;
    }
    return `${cap(name)}: ${lentWords}${top} - ${bottom} = ${top - bottom}.`;
  }
  // × by one digit
  const d = at(nums[1], 0);
  const a = at(nums[0], p);
  const carryIn = work.carries[p] ?? 0;
  const prod = a * d + carryIn;
  const left = `${a} × ${d}${carryIn > 0 ? ` + the ${carryIn} you carried` : ""} = ${prod}`;
  if (end || prod < 10) return `${cap(name)}: ${left}.`;
  return `${cap(name)}: ${left}. Write ${prod % 10} and carry the ${Math.floor(prod / 10)}.`;
}

/** The last column's words, with its digit left for the kid. */
function lastColumnWords(work: StackedWork, p: number): string {
  const name = placeName(p, work.decimals);
  const verb = work.op === "+" ? "add the" : work.op === "-" ? "take away in the" : "multiply the";
  const carried = work.op !== "-" && (work.carries[p] ?? 0) > 0 ? `, and the ${work.carries[p]} you carried` : "";
  return `One column left: ${verb} ${name}${carried}. You can do this one.`;
}

const cap = (s: string) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/** A number's digits by place, lined up on the point (place `decimals` is the ones). */
function digitsByPlace(n: string, decimals: number): Map<number, number> {
  const i = n.indexOf(".");
  const own = i === -1 ? 0 : n.length - i - 1;
  const digits = n.replace(".", "");
  const last = decimals - own;
  const out = new Map<number, number>();
  for (let k = 0; k < digits.length; k++) out.set(last + digits.length - 1 - k, Number(digits[k]));
  return out;
}

/** The parts the tutor wrote, by kind: `a` → {0, 1}, `r` → {1} … */
function partsOf(tutor: readonly string[]): Record<string, Set<number>> & { rule: boolean } {
  const out: Record<string, Set<number>> & { rule: boolean } = { a: new Set(), c: new Set(), f: new Set(), r: new Set(), s: new Set(), rule: false } as never;
  for (const p of tutor) {
    if (p === "rule") out.rule = true;
    const m = /^([acfrs])(\d+)$/.exec(p);
    if (m) out[m[1]].add(Number(m[2]));
  }
  return out;
}

/**
 * The next column of a stacked sum (see the file comment), placed in its columns in the tutor's
 * hand. Words only (`hint`, `unsure`) when it cannot write digits it is sure of.
 */
export function stackStepOf(args: StackStepArgs): StackStepResult {
  const sum = args.stack;
  const read = sum ? parseStacked(args.latex) : null;
  if (!sum || !read) return nothing("unsure", UNSURE);
  if ((sum.more && !read.rows) || read.operands.length !== sum.rows.length) return nothing("unsure", UNSURE);
  const grid = stackGrid(sum, rowPlaces(read));
  const work = workStacked(read, grid.answerLast === null || read.rows ? {} : { answerLast: grid.answerLast });
  if (!work) return nothing("unsure", UNSURE);
  const key = `${read.op} ${read.operands.join(" ")}`;
  const reading = `${read.operands.join(` ${read.op === "-" ? "−" : read.op} `)}${read.answer ? ` = ${read.answer}` : ""}`;
  // the messy-handwriting guard: the digits written must be the rows as read, and the rows the problem
  if (!rowsMatchInk(sum, read, grid, work)) return nothing("unsure", UNSURE, key);
  if (args.trust === "unsure") return { ...nothing("readback", "", key), reading };
  const asked = problemNumbers(args.problem);
  if (asked) {
    const same = asked.op === read.op && [...asked.operands].sort().join(" ") === [...read.operands].map((n) => n.replace(/^0+(?=\d)/, "")).sort().join(" ");
    if (!same && args.trust !== "confirmed") return { ...nothing("readback", "", key), reading };
  } else if (!args.known && args.trust !== "confirmed" && args.trust !== undefined) {
    return { ...nothing("readback", "", key), reading };
  }
  const sure = (args.confidence ?? 1) >= STACK_RING_CONFIDENCE;
  const tutor = partsOf(args.tutor ?? []);
  const size = inlineHandSizeFor(grid.digit, args.zoom);
  const small = Math.max(HAND_WRITE.minSize, Math.round(size * 0.55));
  const seed = handSeedFor(`${args.lineId ?? key}:stack`);

  // long multiplication: a row at a time, then the rows added
  if (read.op === "×" && /^\d{2,}$/.test(read.operands[1])) return longStep(args, read.operands, work, grid, tutor, { key, size, seed, sure });

  if (work.right) return nothing("solved", "", key);
  // a wrong digit: the right one under it (only on a read the board is sure of)
  if (work.wrong !== -1) {
    if (!sure) return nothing("unsure", UNSURE, key);
    const p = work.wrong;
    if (p >= work.digits.length || tutor.f.has(p)) return nothing("hint", work.note, key);
    const plan = digitPlan(String(work.digits[p]), grid.x(p), grid.fixBaseline, size, seed);
    if (!plan) return nothing("unsure", UNSURE, key);
    return { kind: "fix", parts: [{ part: `f${p}`, text: String(work.digits[p]), plan }], why: work.note || `Check the ${placeName(p, work.decimals)} column.`, key };
  }
  const left = placesLeft(work, tutor.a);
  if (left.length === 0) return nothing("solved", "", key);
  const p = left[0];
  const end = p >= work.width - 1;
  const places = end ? left : [p];
  const final = places.length === left.length;
  if (final && !args.answer) return nothing("lastStep", lastColumnWords(work, p), key);
  const parts: StackPart[] = [];
  for (const place of places) {
    const plan = digitPlan(String(work.digits[place]), grid.x(place), grid.answerBaseline, size, seed + parts.length);
    if (!plan) return nothing("unsure", UNSURE, key);
    parts.push({ part: `a${place}`, text: String(work.digits[place]), plan });
  }
  const carry = work.op !== "-" && !end ? (work.carries[p + 1] ?? 0) : 0;
  if (carry > 0 && !grid.carried.has(p + 1) && !tutor.c.has(p + 1)) {
    const plan = digitPlan(String(carry), grid.x(p + 1), grid.carryBaseline, small, seed + 7);
    if (plan) parts.push({ part: `c${p + 1}`, text: String(carry), plan });
  }
  return { kind: final ? "answer" : "step", parts, why: columnWords(work, p, end), key };
}

/**
 * The rows as read agree with the ink: each row has as many glyphs as digits read (one more for the
 * operator on a row after the first), each digit sits in its column, and the answer row has as many
 * glyphs as digits read. Off (a digit read twice, two digits touching, a carry merged into a row): the
 * tutor writes no digits.
 */
function rowsMatchInk(sum: StackedSum, read: NonNullable<ReturnType<typeof parseStacked>>, grid: StackGrid, work: StackedWork): boolean {
  const places = rowPlaces(read);
  for (let i = 0; i < sum.rows.length; i++) {
    const row = sum.rows[i];
    const want = places[i];
    if (!want) return false;
    const extra = row.glyphs.length - want.digits;
    if (extra < 0 || extra > (i === 0 ? 0 : 1)) return false;
    const mine = row.glyphs.slice(row.glyphs.length - want.digits).reverse();
    for (let j = 0; j < mine.length; j++) {
      const c = mine[j].x + mine[j].w / 2;
      if (Math.abs(c - grid.x(want.last + j)) > 0.45 * grid.pitch) return false;
    }
  }
  if (sum.answer && !read.rows) {
    // (a leading zero the student wrote is dropped from `written`: one glyph more is allowed)
    const n = sum.answer.glyphs.length - work.written.size;
    if (n < 0 || n > 1) return false;
  }
  return true;
}

/** The problem's numbers and operator when it is plain arithmetic of two or more whole numbers (`286 + 680`, `46 \times 23`). */
function problemNumbers(problem: readonly string[] | undefined): { op: "+" | "-" | "×"; operands: string[] } | null {
  const line = (problem ?? []).find((l) => /\d/.test(l));
  if (!line) return null;
  const t = line.replace(/\\left|\\right|\s|\\[,;! ]/g, "").replace(/=$/, "");
  const ops = t.match(/\+|-|−|\\times|\\cdot|×|\*/g) ?? [];
  const nums = t.split(/\+|-|−|\\times|\\cdot|×|\*/).filter(Boolean);
  if (nums.length < 2 || !nums.every((n) => /^\d+(?:\.\d+)?$/.test(n)) || new Set(ops).size !== 1) return null;
  const o = ops[0];
  const op = o === "+" ? "+" : o === "-" || o === "−" ? "-" : "×";
  return { op, operands: nums.map((n) => n.replace(/^0+(?=\d)/, "")) };
}

/** Long multiplication (`46 × 23`): its rows, one per ask, then a rule and their sum column by column. */
function longStep(
  args: StackStepArgs,
  operands: string[],
  work: StackedWork,
  grid: StackGrid,
  tutor: ReturnType<typeof partsOf>,
  o: { key: string; size: number; seed: number; sure: boolean },
): StackStepResult {
  const [top, bottom] = operands;
  const topN = Number(top);
  const bottomDigits = [...bottom].reverse().map(Number);
  // the standard rows: the top number times each nonzero digit of the bottom one, in its place
  const want: Array<{ value: number; digit: number; place: number }> = [];
  bottomDigits.forEach((d, place) => {
    if (d !== 0) want.push({ value: topN * d * 10 ** place, digit: d, place });
  });
  const product = topN * Number(bottom);
  const long = work.long;
  if ((long && long.wrong !== -1) || work.wrong !== -1) {
    if (!o.sure) return nothing("unsure", UNSURE, o.key);
    return nothing("hint", work.note || `Check the rows: each one is ${top} times a digit of ${bottom}.`, o.key);
  }
  // the kid's rows so far: the rows under the first rule (the answer row alone is the first row)
  const read = parseStacked(args.latex);
  const kidRows = read?.rows ?? (read?.answer ? [read.answer] : []);
  // a finished, right product
  if (work.right) return nothing("solved", "", o.key);
  if (kidRows.length > want.length || (read?.rows && read.answer)) return nothing("hint", `Add the rows to finish. Together they make ${top} × ${bottom}.`, o.key);
  const dH = grid.digit;
  const firstBaseline = grid.answerBaseline;
  const kidBottom = args.inkBottom ?? firstBaseline;
  const rowBaseline = (k: number) => (kidRows.length === 0 ? firstBaseline + k * ROW_PITCH * dH : Math.max(firstBaseline + k * ROW_PITCH * dH, kidBottom + (k - kidRows.length + 1) * ROW_PITCH * dH - 0.2 * dH));
  const k = kidRows.length + [...tutor.r].filter((r) => r >= kidRows.length).length;
  if (k < want.length) {
    const row = want[k];
    const text = String(row.value);
    const zeros = row.place > 0 ? ` The ${row.place === 1 ? "0 holds the ones place" : `${row.place} zeros hold the places`}.` : "";
    const why = `${cap(placeName(row.place, 0))} row: ${top} × ${row.digit * 10 ** row.place} = ${row.value}.${zeros}`;
    if (want.length === 1 && !args.answer) return nothing("lastStep", `Multiply ${top} by ${bottom}. You can do this one.`, o.key);
    const parts: StackPart[] = [];
    const baseline = rowBaseline(k);
    const digits = [...text].reverse();
    for (let pl = 0; pl < digits.length; pl++) {
      const plan = digitPlan(digits[pl], grid.x(pl), baseline, o.size, o.seed + k * 10 + pl);
      if (!plan) return nothing("unsure", UNSURE, o.key);
      parts.push({ part: pl === digits.length - 1 ? `r${k}` : `r${k}.${pl}`, text: digits[pl], plan });
    }
    // the row's id is on its last digit written (its leftmost), so a row cut short is written again
    return { kind: want.length === 1 ? "answer" : "step", parts, why, key: o.key };
  }
  // every row is there: a rule under them, and their sum column by column
  const rowsBottom = rowBaseline(want.length - 1);
  const ruleY = rowsBottom + 0.35 * dH;
  const sumBaseline = ruleY + 0.35 * dH + dH;
  const sumDigits = [...String(product)].reverse().map(Number);
  // the carries of adding the rows
  const carries: number[] = [0];
  for (let p = 0; p < sumDigits.length; p++) {
    const s = want.reduce((t, r) => t + (Math.floor(r.value / 10 ** p) % 10), 0) + carries[p];
    carries.push(Math.floor(s / 10));
  }
  const left: number[] = [];
  for (let p = 0; p < sumDigits.length; p++) if (!tutor.s.has(p)) left.push(p);
  if (left.length === 0) return nothing("solved", "", o.key);
  const p = left[0];
  const end = p >= Math.max(...want.map((r) => String(r.value).length)) - 1;
  const places = end ? left : [p];
  const final = places.length === left.length;
  const terms = want.map((r) => Math.floor(r.value / 10 ** p) % 10);
  const s = terms.reduce((t, d) => t + d, 0) + carries[p];
  const name = placeName(p, 0);
  if (final && !args.answer) return nothing("lastStep", `One column left: add the ${name}${carries[p] ? `, and the ${carries[p]} you carried` : ""}. You can do this one.`, o.key);
  const parts: StackPart[] = [];
  if (!tutor.rule) {
    const x0 = grid.x(sumDigits.length - 1) - 0.75 * grid.pitch;
    const x1 = grid.x(0) + 0.6 * grid.pitch;
    const plan = rulePlan(x0, x1, ruleY, o.size, o.seed);
    if (plan) parts.push({ part: "rule", text: "", plan });
  }
  for (const place of places) {
    const plan = digitPlan(String(sumDigits[place]), grid.x(place), sumBaseline, o.size, o.seed + 50 + place);
    if (!plan) return nothing("unsure", UNSURE, o.key);
    parts.push({ part: `s${place}`, text: String(sumDigits[place]), plan });
  }
  const sumWords = `${terms.join(" + ")}${carries[p] ? ` + the ${carries[p]} you carried` : ""} = ${s}`;
  const why = `${!tutor.rule ? "Now add the rows. " : ""}${cap(name)}: ${sumWords}.${!end && s >= 10 ? ` Write ${s % 10} and carry the ${Math.floor(s / 10)}.` : ""}`;
  return { kind: final ? "answer" : "step", parts, why, key: o.key };
}
