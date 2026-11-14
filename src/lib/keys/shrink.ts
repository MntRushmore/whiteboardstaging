/**
 * The smaller problem (docs/KEYS.md, "Help me"): from a named bug and the cell that broke, the one
 * step the kid missed, as its own little problem the tutor writes under the work, with base-ten
 * blocks. Its answer goes back up into that cell (`stack.ts`).
 */
import type { BugId } from "./bugs";
import type { LeadKey } from "./copy";
import { answerCells, carryInto, cellById, digitAt, factItem, lineOfCell, type MathItem } from "./item";

/** Base-ten blocks: groups of rods, one rod a ten. The box's group is the kid's to build. */
export interface BaseTenBlocks {
  kind: "base_ten";
  unit: "ten";
  /** in the order of the smaller problem's line; `box` is the group the kid builds */
  groups: { count: number; carried?: boolean; box?: boolean }[];
}

export interface SubStep {
  bug: BugId;
  /** the tutor's lead line (`KEYS_COPY.lead`) */
  lead: LeadKey;
  /** the smaller problem */
  item: MathItem;
  manipulative: BaseTenBlocks | null;
  /** the parent's cell its answer goes back into, and that cell's place */
  target: { cellId: string; place: number };
  /** the parent line it is written under */
  under: string;
}

/**
 * The smaller problem for this bug, or null when there is none yet (only "forgot the carry" has
 * one in Phase 1). `cellId` is the cell that broke; without it, the first place a carry goes.
 */
export function shrink(item: MathItem, bug: BugId, cellId?: string): SubStep | null {
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
