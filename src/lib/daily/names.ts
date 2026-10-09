/**
 * The names a student reads for the skills of a day's set ("In today's set" on the home card).
 * Apart from the planner so the card can name a set it did not plan (Continue, from this device's
 * note) without fetching every generator. Pure data lookups.
 */
import { skillDef } from "@/lib/learning/contracts";
import { isK8SkillId, K8_SKILLS } from "@/lib/learning/grades";
import type { DailyReason } from "./contracts";

/** A skill of the day's set as the home card lists it. */
export interface PlanSkill {
  skill: string;
  /** what the student reads ("Times tables") */
  name: string;
  /** why its first problem is in the set; unknown for a set read back from a note */
  why?: DailyReason;
  problems: number;
}

/** A skill's name for a student: a K–8 skill's (`K8_SKILLS`), else the skill table's, else null. */
export function skillNameOf(skill: string): string | null {
  if (isK8SkillId(skill)) return K8_SKILLS[skill].name;
  return skillDef(skill)?.name ?? null;
}

/** Skills by id, named, once each, in order (a note's list): no reasons, one problem each at least. */
export function namedSkills(skills: readonly string[]): PlanSkill[] {
  const out: PlanSkill[] = [];
  for (const skill of skills) {
    if (out.some((s) => s.skill === skill)) continue;
    const name = skillNameOf(skill);
    if (name) out.push({ skill, name, problems: 1 });
  }
  return out;
}
