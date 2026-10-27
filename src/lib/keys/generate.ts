/**
 * Keys' problems (docs/KEYS.md): from a skill and a seed, the same problems on every device. Uses the
 * learning generators' seeded Rng (`src/lib/learning/generators/rng.ts`), and picks the numbers answer
 * first, as they do, so each problem is clean by construction.
 *
 * Adding (Phase 1), `add_within_100` with a carry: two 2-digit numbers whose ones make a ten, the
 * total under 100, so the tens column is a one-digit sum with the carry in it. That keeps every bug's
 * answer distinct and the smaller problem one digit. Phase 3 adds a generator per skill below
 * (`KEYS_SKILLS`), each drawing numbers its bug rules tell apart.
 */
import type { SkillId } from "@/lib/learning/contracts";
import { makeRng, seedFrom, type Rng } from "@/lib/learning/generators/rng";
import { equationItem, equationOf, EQUATION_FORMS } from "./families/equations";
import { equivalentItem, equivalentPair, fractionSumItem, likePair, unlikePair } from "./families/fractions";
import { factPair, multiDigitPair, productItem, tensPair } from "./families/multiplication";
import { differenceItem, regroupingPair } from "./families/subtraction";
import { itemFromText, missingAddendItem, parseFrac, sumItem, type EquationForm, type MathItem } from "./item";

/** Every skill Keys can write a set for, in teaching order. */
export const KEYS_SKILLS = [
  "add_within_100",
  "subtract_within_100",
  "add_subtract_within_1000",
  "times_tables",
  "multiply_by_tens",
  "multiply_multi_digit",
  "equivalent_fractions",
  "add_fractions_like",
  "add_fractions_unlike",
  "one_step_equations",
] as const satisfies readonly SkillId[];
export type KeysSkill = (typeof KEYS_SKILLS)[number];

export function isKeysSkill(skill: string): skill is KeysSkill {
  return (KEYS_SKILLS as readonly string[]).includes(skill);
}

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

/** The `slot`-th problem of a set of this skill: each skill's own mix, easy kinds first. */
export function skillItem(r: Rng, skill: KeysSkill, slot: number): MathItem {
  switch (skill) {
    case "add_within_100":
      return generateItem(r, SET_PATTERN[slot % SET_PATTERN.length]);
    case "subtract_within_100":
      return differenceItem(...regroupingPair(r, "two_digit"));
    case "add_subtract_within_1000":
      return differenceItem(...regroupingPair(r, slot % 2 === 0 ? "three_digit" : "across_zero"));
    case "times_tables":
      return productItem(...factPair(r));
    case "multiply_by_tens":
      return productItem(...tensPair(r));
    case "multiply_multi_digit":
      return productItem(...multiDigitPair(r, slot % 3 === 2));
    case "equivalent_fractions":
      return equivalentItem(...equivalentPair(r));
    case "add_fractions_like":
      return fractionSumItem(...likePair(r));
    case "add_fractions_unlike":
      return fractionSumItem(...unlikePair(r));
    case "one_step_equations":
      return equationOf(r, EQUATION_FORMS[slot % EQUATION_FORMS.length]);
  }
}

/** Two problems that are the same problem (a sum and a missing digit of the same pair count as one). */
function sameKey(item: MathItem): string {
  return item.math ? item.id : item.addends.join("+");
}

/** A set of `count` problems for the skill, all different, the same for the same seed. */
export function generateSet(seed: number, count = SET_SIZE, skill: KeysSkill = "add_within_100"): MathItem[] {
  return generateMixed(seed, Array.from({ length: count }, () => skill));
}

/**
 * A set from a list of skills, one problem a slot (Today's practice on Keys: the path, the weak
 * spots, a comeback), all different, the same for the same seed.
 */
export function generateMixed(seed: number, skills: readonly KeysSkill[]): MathItem[] {
  const items: MathItem[] = [];
  const seen = new Set<string>();
  const slots = new Map<string, number>();
  for (const skill of skills) {
    const r = makeRng(seedFrom(seed, `keys:${skill}:${items.length}`));
    for (let i = 0; i < 50; i++) {
      const slot = slots.get(skill) ?? 0;
      const item = skillItem(r, skill, slot);
      if (seen.has(sameKey(item))) continue;
      seen.add(sameKey(item));
      slots.set(skill, slot + 1);
      items.push(item);
      break;
    }
  }
  return items;
}

/** Today's seed: the date as a number (2026-10-27 is 20261027), so a set lasts the day. */
export function daySeed(date: Date): number {
  return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/**
 * Any Keys problem from its text (the page's `?p=` QA list and the tests): adding (`47+38`,
 * `26+?6=92`), taking away (`52-27`), multiplying (`6x7`, `34*26`), fractions (`2/7+3/7`,
 * `3/4=?/12`) and one-step equations (`x+7=15`, `x-4=9`, `5+x=12`, `3x=12`). Null for anything else.
 */
export function keysItemFromText(text: string): MathItem | null {
  const t = text.replace(/\s+/g, "").replace(/[−–—]/g, "-").replace(/[×*X]/g, "x");
  try {
    const sub = /^(\d{1,4})-(\d{1,4})$/.exec(t);
    if (sub && Number(sub[2]) <= Number(sub[1])) return differenceItem(Number(sub[1]), Number(sub[2]));
    const mul = /^(\d{1,4})x(\d{1,2})$/.exec(t);
    if (mul) return productItem(Number(mul[1]), Number(mul[2]));
    const fsum = /^(\d+\/\d+)\+(\d+\/\d+)$/.exec(t);
    if (fsum) {
      const [l, r] = [parseFrac(fsum[1]), parseFrac(fsum[2])];
      return l && r ? fractionSumItem(l, r) : null;
    }
    const eqv = /^(\d+\/\d+)=\?\/(\d+)$/.exec(t);
    if (eqv) {
      const from = parseFrac(eqv[1]);
      return from ? equivalentItem(from, Number(eqv[2])) : null;
    }
    const eq = /^(?:x([+-])(\d+)|(\d+)\+x|(\d+)x)=(\d+)$/.exec(t);
    if (eq) {
      const [, sign, a1, a2, a3, b] = eq;
      const form: EquationForm = a3 ? "ax" : a2 ? "a+x" : sign === "-" ? "x-a" : "x+a";
      return equationItem(form, Number(a1 ?? a2 ?? a3), Number(b));
    }
  } catch {
    return null;
  }
  return itemFromText(text);
}

/** The page's `?p=` QA list: `26+?6=92|47+38|52-27`. Unknown entries are skipped. */
export function itemsFromList(list: string): MathItem[] {
  return list
    .split("|")
    .map((t) => keysItemFromText(t.replace(/ (?=\d|\?)/g, "+").replace(/\+{2,}/g, "+")))
    .filter((i): i is MathItem => i !== null);
}

/**
 * "Now you try" (`src/lib/learning/nowYouTry.ts`'s rule, on Keys): after a problem done with help, one
 * more like it: the same kind of problem, new numbers, a different answer. The same attempt always
 * gets the same one (`seed` is `seedOf(attemptId)`). Null when none can be drawn.
 */
export function variantItem(item: MathItem, seed: number): MathItem | null {
  if (item.kind === "fact") return null;
  const r = makeRng(seedFrom(seed, `keys:variant:${item.id}`));
  const shape = (x: MathItem) => `${x.kind}:${x.layout.kind === "columns" ? x.layout.lines.map((l) => l.role).join(",") : ""}:${x.math?.kind === "equation" ? x.math.form : ""}`;
  for (let i = 0; i < 80; i++) {
    const next = item.math ? (isKeysSkill(item.skill) ? skillItem(r, item.skill, i) : null) : generateItem(r, item.kind);
    if (!next) return null;
    if (shape(next) === shape(item) && next.answer !== item.answer && sameKey(next) !== sameKey(item)) return next;
  }
  return null;
}
