/**
 * Keys' problems (docs/KEYS.md): from a skill and a seed, the same problems on every device. Uses the
 * learning generators' seeded Rng (`src/lib/learning/generators/rng.ts`), and picks the numbers answer
 * first, as they do, so each problem is clean by construction.
 *
 * Phase 1 has one skill, `add_within_100` with a carry: two 2-digit numbers whose ones make a ten,
 * the total under 100, so the tens column is a one-digit sum with the carry in it. That keeps every
 * bug's answer distinct and the smaller problem one digit.
 */
import type { SkillId } from "@/lib/learning/contracts";
import { makeRng, seedFrom, type Rng } from "@/lib/learning/generators/rng";
import { itemFromText, missingAddendItem, sumItem, type MathItem } from "./item";

export const KEYS_SKILLS = ["add_within_100"] as const satisfies readonly SkillId[];
export type KeysSkill = (typeof KEYS_SKILLS)[number];

export const SET_SIZE = 5;

/** The order of kinds in a set: two sums to warm up, then a missing digit, then one of each. */
const SET_PATTERN: readonly MathItem["kind"][] = ["sum", "sum", "missing_addend", "sum", "missing_addend"];

/** Two 2-digit numbers that carry into the tens, total under 100. */
function carryingPair(r: Rng): [number, number] {
  const at = r.int(1, 7);
  const bt = r.int(1, 8 - at);
  const ao = r.int(2, 9);
  const bo = r.int(Math.max(1, 10 - ao), 9);
  return [at * 10 + ao, bt * 10 + bo];
}

/** One problem of this kind. */
export function generateItem(r: Rng, kind: MathItem["kind"]): MathItem {
  const [a, b] = carryingPair(r);
  return kind === "missing_addend" ? missingAddendItem(a, b, 1) : sumItem(a, b);
}

/** A set of `count` problems for the skill, all different, the same for the same seed. */
export function generateSet(seed: number, count = SET_SIZE, skill: KeysSkill = "add_within_100"): MathItem[] {
  const r = makeRng(seedFrom(seed, `keys:${skill}`));
  const items: MathItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; items.length < count && i < count * 50; i++) {
    const kind = SET_PATTERN[items.length % SET_PATTERN.length];
    const item = generateItem(r, kind);
    // Different numbers each time (a sum and a missing digit of the same pair count as the same).
    const key = item.addends.join("+");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

/** Today's seed: the date as a number (2026-10-27 is 20261027), so a set lasts the day. */
export function daySeed(date: Date): number {
  return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/** The page's `?p=` QA list: `26+?6=92|47+38`. Unknown entries are skipped. */
export function itemsFromList(list: string): MathItem[] {
  return list
    .split("|")
    .map((t) => itemFromText(t.replace(/ (?=\d|\?)/g, "+").replace(/\+{2,}/g, "+")))
    .filter((i): i is MathItem => i !== null);
}

/**
 * "Now you try" (`src/lib/learning/nowYouTry.ts`'s rule, on Keys): after a problem done with help, one
 * more like it: the same kind of problem, new numbers, a different answer. The same attempt always
 * gets the same one (`seed` is `seedOf(attemptId)`). Null when none can be drawn.
 */
export function variantItem(item: MathItem, seed: number): MathItem | null {
  const r = makeRng(seedFrom(seed, `keys:variant:${item.id}`));
  for (let i = 0; i < 40; i++) {
    const next = item.kind === "fact" ? null : generateItem(r, item.kind);
    if (!next) return null;
    if (next.answer !== item.answer && next.addends.join("+") !== item.addends.join("+")) return next;
  }
  return null;
}
