/**
 * Taking away with regrouping (docs/KEYS.md, Phase 3): `52 − 27`, `403 − 128`, in columns. Over the
 * top number, a regroup row: at each place that can lend, the top digit as it is after regrouping (the
 * 5 tens of 52 become 4 when the ones borrow a ten; the 0 tens of 403 become 9). Those cells are
 * optional, like carries.
 */
import type { SkillId } from "@/lib/learning/contracts";
import type { Rng } from "@/lib/learning/generators/rng";
import { digitCount, type Cell, type ColumnLine, type MathItem } from "../item";
import { digitsOf, givenRow, kidRow } from "./columns";

/** The top number's digits after regrouping, ones first (the right way: each borrow takes 1 from the place left). */
export function regrouped(top: number, bottom: number): { digits: number[]; lent: boolean[] } {
  const t = digitsOf(top);
  const b = digitsOf(bottom, t.length);
  const digits = [...t];
  const lent = t.map(() => false);
  for (let p = 0; p < t.length; p++) {
    if (digits[p] < b[p]) {
      // borrow from the first place left that has something to lend, regrouping through zeros
      let q = p + 1;
      while (q < t.length && digits[q] === 0) q++;
      if (q >= t.length) break;
      digits[q] -= 1;
      lent[q] = true;
      for (let k = q - 1; k > p; k--) {
        digits[k] += 9;
        lent[k] = true;
      }
      digits[p] += 10;
    }
  }
  return { digits, lent };
}

/** Does this place need a borrow (its top digit is smaller than the bottom's, as written)? */
export function needsBorrow(top: number, bottom: number, place: number): boolean {
  const t = digitsOf(top);
  const b = digitsOf(bottom, t.length);
  return (t[place] ?? 0) < (b[place] ?? 0);
}

function skillFor(top: number): SkillId {
  return top < 100 ? "subtract_within_100" : top < 1000 ? "add_subtract_within_1000" : "multi_digit_add_subtract";
}

/** `top − bottom` in columns, the kid writes the difference. */
export function differenceItem(top: number, bottom: number): MathItem {
  if (bottom > top || bottom < 0) throw new Error("differenceItem: bottom must be at most top");
  const total = top - bottom;
  const places = digitCount(top);
  const { digits } = regrouped(top, bottom);
  const regroupCells: (Cell | null)[] = [];
  for (let p = places - 1; p >= 0; p--) {
    // a regroup box over every place that could lend (not the ones): its digit after regrouping
    regroupCells.push(p >= 1 ? { id: `g${p}`, role: "carry", place: p, expect: String(digits[p]) } : null);
  }
  const regroup: ColumnLine = { id: "regroup", role: "carry", cells: regroupCells };
  const text = `${top} − ${bottom}`;
  return {
    id: `sub:${top}-${bottom}`,
    skill: skillFor(top),
    kind: "difference",
    text,
    words: `${top} minus ${bottom}`,
    addends: [top, bottom],
    total,
    answer: String(total),
    math: { kind: "subtract", top, bottom },
    layout: {
      kind: "columns",
      places,
      lines: [regroup, givenRow("a", top, places), givenRow("b", bottom, places, "−"), kidRow("result", total, places, "result", undefined, "r")],
    },
  };
}

/**
 * A difference that regroups. `across_zero`: three digits with a 0 in the tens that must lend
 * (`403 − 128`). Ones apart by anything but 5, so "smaller from larger" and "did not reduce" never
 * give the same answer.
 */
export function regroupingPair(r: Rng, kind: "two_digit" | "three_digit" | "across_zero"): [number, number] {
  for (let i = 0; i < 200; i++) {
    let top: number;
    let bottom: number;
    if (kind === "two_digit") {
      top = r.int(3, 9) * 10 + r.int(0, 8);
      bottom = r.int(1, Math.floor(top / 10) - 1) * 10 + r.int((top % 10) + 1, 9);
    } else if (kind === "three_digit") {
      top = r.int(3, 9) * 100 + r.int(1, 9) * 10 + r.int(0, 8);
      bottom = r.int(1, Math.floor(top / 100) - 1) * 100 + r.int(0, (Math.floor(top / 10) % 10) - 1) * 10 + r.int((top % 10) + 1, 9);
    } else {
      top = r.int(3, 9) * 100 + r.int(0, 8);
      bottom = r.int(1, Math.floor(top / 100) - 1) * 100 + r.int(1, 9) * 10 + r.int((top % 10) + 1, 9);
    }
    const onesGap = (bottom % 10) - (top % 10);
    if (bottom < top && onesGap !== 5 && onesGap > 0) return [top, bottom];
  }
  return [52, 27];
}
