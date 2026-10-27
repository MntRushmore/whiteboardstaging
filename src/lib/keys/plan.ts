/**
 * Today's practice on Keys (docs/KEYS.md, Phase 4): the same day's set the board gets
 * (`planDailySet`: the kid's grade path, their weak spots and a review, the same for the same kid on
 * the same day), with each skill turned into one Keys can write, and a spaced comeback first when
 * one is due (`comebacks.ts`).
 *
 * A skill Keys cannot write (the youngest adding, division, decimals, algebra past one step) is
 * swapped for the nearest Keys skill on the kid's path. When fewer than three of the set's skills
 * can be written on Keys at all, the set is not Keys' (`keysable: false`) and Home keeps the board.
 *
 * Pure: unit-tested.
 */
import type { DailyPlan, DailyReason } from "@/lib/daily/contracts";
import { DAILY_GOAL } from "@/lib/daily/contracts";
import type { Comeback } from "./comebacks";
import { isKeysSkill, KEYS_SKILLS, type KeysSkill } from "./generate";

/** The Keys skill that practises a path skill, or null when Keys has nothing close. */
const NEAREST: Readonly<Record<string, KeysSkill>> = {
  add_subtract: "add_within_100",
  add_subtract_within_1000: "add_subtract_within_1000",
  multi_digit_add_subtract: "add_subtract_within_1000",
  multiply_divide: "times_tables",
  fractions: "add_fractions_like",
  two_step_equations: "one_step_equations",
};

export function keysSkillFor(skill: string): KeysSkill | null {
  if (isKeysSkill(skill)) return skill;
  return NEAREST[skill] ?? null;
}

export interface KeysPlan {
  skills: KeysSkill[];
  why: (DailyReason | "comeback")[];
  /** the comeback the set opens with, if one was due */
  comeback: Comeback | null;
  /** enough of the day's set fits Keys for Home to send a laptop here */
  keysable: boolean;
}

/** Keys' set for the day from the board's (`planDailySet`) and the comebacks due today. */
export function planKeysSet(plan: DailyPlan, comebacks: readonly Comeback[], path: readonly string[] = []): KeysPlan {
  const goal = Math.max(1, plan.problems.length || DAILY_GOAL);
  const mapped = plan.problems.map((p) => ({ skill: keysSkillFor(p.skill), why: p.why as DailyReason }));
  const fits = mapped.filter((m) => m.skill !== null).length;
  // what fills a slot Keys cannot write: the set's own Keys skills first, then the path's
  const fill = [...new Set([...mapped.map((m) => m.skill).filter((s): s is KeysSkill => s !== null), ...path.map(keysSkillFor).filter((s): s is KeysSkill => s !== null)])];
  if (fill.length === 0) fill.push(KEYS_SKILLS[0]);
  let k = 0;
  const skills: KeysSkill[] = [];
  const why: KeysPlan["why"] = [];
  for (const m of mapped) {
    skills.push(m.skill ?? fill[k++ % fill.length]);
    why.push(m.why);
  }
  while (skills.length < goal) {
    skills.push(fill[k++ % fill.length]);
    why.push("next");
  }
  // a comeback opens the set as its warm-up, in place of the review (else the last slot)
  const comeback = comebacks.find((c) => isKeysSkill(c.skill)) ?? null;
  if (comeback) {
    const at = why.indexOf("review");
    const drop = at >= 0 ? at : skills.length - 1;
    skills.splice(drop, 1);
    why.splice(drop, 1);
    skills.unshift(comeback.skill as KeysSkill);
    why.unshift("comeback");
  }
  return { skills, why, comeback, keysable: fits >= Math.min(3, goal) };
}
