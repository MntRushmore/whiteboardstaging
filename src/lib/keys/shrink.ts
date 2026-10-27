/**
 * The smaller problem (docs/KEYS.md, "Help me"): from a named bug and the cell that broke, the one
 * step the kid missed, as its own little problem the tutor writes under the work, with a
 * manipulative when one helps. Its answer goes back up into that cell (`stack.ts`).
 *
 * Adding (Phase 1) has "forgot the carry"; Phase 3's families have theirs in `families/shrinks.ts`.
 */
import type { BugId } from "./bugs";
import type { LeadKey } from "./copy";
import { shrinkFamily } from "./families/shrinks";
import { answerCells, carryInto, cellById, digitAt, factItem, lineOfCell, type MathItem, type Op } from "./item";

/**
 * Base-ten blocks: groups of rods (a ten) or cubes (a one). The box's group is the kid's to build
 * (Space adds one, Backspace takes one away). `op` is the sign before a group (`+` when absent).
 */
export interface BaseTenBlocks {
  kind: "base_ten";
  unit: "ten" | "one";
  /** in the order of the smaller problem's line; `box` is the group the kid builds */
  groups: { count: number; carried?: boolean; box?: boolean; op?: Op | "=" }[];
}

/** Fraction bars: a bar of `parts` with the tutor's shaded parts, and the kid's bar to shade (Space shades one more). */
export interface FractionBars {
  kind: "fraction_bar";
  parts: number;
  /** the tutor's shading, in order (a second group in tomato) */
  shaded: { count: number; carried?: boolean }[];
  /** a bar above to match (an equivalent fraction's `3/4`): its parts and shading */
  match?: { parts: number; shaded: number };
}

/** A number line: the kid moves the marker (← →, Space a step on); the box is where it stands. */
export interface NumberLine {
  kind: "number_line";
  min: number;
  max: number;
  /** where the marker starts (the number the step starts from) */
  start: number;
}

/** An area model: `rows × cols` squares, split after `split` columns; Space shades one more row (the box is rows × cols). */
export interface AreaModel {
  kind: "area";
  rows: number;
  cols: number;
  /** a split after this many columns (`6 × 7` is `6 × 5` and `6 × 2`); 0 for none */
  split: number;
}

export type Manipulative = BaseTenBlocks | FractionBars | NumberLine | AreaModel;

/** What one Space adds to the box, and how far it goes. */
export function boxStep(m: Manipulative | null): number {
  return m?.kind === "area" ? m.cols : 1;
}

export function boxMax(m: Manipulative | null, answer: number): number {
  if (!m) return Math.max(9, answer);
  switch (m.kind) {
    case "area":
      return m.rows * m.cols;
    case "number_line":
      return m.max;
    case "fraction_bar":
      return m.parts;
    case "base_ten":
      return Math.max(answer + 4, 9);
  }
}

/** The box's value before the kid moves anything (a number line's marker starts on its first number). */
export function boxStart(m: Manipulative | null): number {
  return m?.kind === "number_line" ? m.start : 0;
}

export interface SubStep {
  bug: BugId;
  /** the tutor's lead line (`KEYS_COPY.lead`) */
  lead: LeadKey;
  /** the lead in words with this problem's numbers (`"40 is 4 tens."`), when it has some; else `lead`'s copy */
  leadText?: string;
  /** the smaller problem */
  item: MathItem;
  manipulative: Manipulative | null;
  /**
   * Where its answer goes back up: the parent's cell (its lowest place when it takes several digits,
   * `spill` the cells from that place up), cells the tutor fixes with it (`also`: a fraction's
   * denominator), or the answer row (`answer`: an equation's).
   */
  target: { cellId: string; place: number; spill?: string[]; also?: Record<string, string>; answer?: boolean };
  /** the parent line it is written under */
  under: string;
}

/**
 * The smaller problem for this bug, or null when it has none (the ladder then goes to the worked
 * step). `cellId` is the cell that broke; without it, the first place the slip happens.
 */
export function shrink(item: MathItem, bug: BugId, cellId?: string): SubStep | null {
  if (item.math) return shrinkFamily(item, bug, cellId);
  if (bug !== "add_forgot_carry" || item.addends.length !== 2) return null;
  const [a, b] = item.addends;

  if (item.kind === "missing_addend" && item.hidden) {
    const place = item.hidden.place;
    const carry = carryInto(item.addends, place);
    if (carry !== 1) return null;
    const cell = answerCells(item)[0];
    const fact = factItem([1, digitAt(a, place), null], digitAt(item.total, place));
    return {
      bug,
      lead: "carry_is_ten",
      item: fact,
      manipulative: { kind: "base_ten", unit: "ten", groups: [{ count: 1, carried: true }, { count: digitAt(a, place) }, { count: Number(fact.answer), box: true }] },
      target: { cellId: cell.id, place },
      under: lineOfCell(item, cell.id) ?? "b",
    };
  }

  if (item.kind === "sum") {
    const broken = cellId ? cellById(item, cellId) : undefined;
    const place = broken && broken.role === "digit" && !broken.spare ? broken.place : firstCarryPlace(item);
    if (place === null || carryInto(item.addends, place) !== 1) return null;
    const total = 1 + digitAt(a, place) + digitAt(b, place);
    // A column that carries again needs a ten and some ones: not a one-digit box. Phase 3.
    if (total > 9) return null;
    const fact = factItem([1, digitAt(a, place), digitAt(b, place)], null);
    return {
      bug,
      lead: "carry_is_ten",
      item: fact,
      manipulative: {
        kind: "base_ten",
        unit: "ten",
        groups: [{ count: 1, carried: true }, { count: digitAt(a, place) }, { count: digitAt(b, place) }, { count: total, box: true }],
      },
      target: { cellId: `r${place}`, place },
      under: "result",
    };
  }
  return null;
}

function firstCarryPlace(item: MathItem): number | null {
  for (let p = 1; p < 4; p++) if (carryInto(item.addends, p)) return p;
  return null;
}
