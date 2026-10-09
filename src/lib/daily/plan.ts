/**
 * Today's practice: which problems make up the day's set (src/lib/daily/contracts.ts). The habit
 * loop only works if the set feels right every day, so the mix is fixed and explained:
 *
 *   next    about 2   the first skills of the student's path not mastered yet: moving forward
 *   weak    about 2   their weak spots (`summary.weakSkills`, weakest first): fixing what is shaky
 *   review  about 1   a skill they have mastered: a quick win that keeps it fresh
 *
 * ordered easy to hard (earlier skills in the K–8 teaching order first, then up each skill's ladder),
 * so the set opens with something the student can do. A brand-new student, with no record yet, gets
 * all five from the first skills of their path, at the easy end of each ladder.
 *
 * Slots that cannot be filled pass to the others (no weak spot yet: more "next"; nothing mastered
 * yet: the review slot goes to "next"; the whole path mastered: the next grade's path, else
 * reviews). The same student on the same day always gets the same set (`dailySeed`), so a reload,
 * or a second device, never shuffles it.
 *
 * Generators are looked up by string id (`formsFor`, `drawLadder`): a skill with none is skipped.
 * A K–8 skill whose generator has not landed yet is drawn from its older, coarser skill instead
 * (`STAND_INS`: "Adding to 10" from "Adding and subtracting"), so the set degrades to the nearest
 * thing rather than to nothing; once the K–8 generators exist they are used directly.
 *
 * Pure (the generators are pure and seeded): unit-tested in `__tests__/plan.test.ts`. It pulls in
 * every generator, so the home loads it with a dynamic import.
 */
import { SKILLS, type MasteryLevel } from "@/lib/learning/contracts";
import { drawLadder, formsFor } from "@/lib/learning/generators";
import { hashText } from "@/lib/learning/generators/rng";
import { GRADE_IDS, GRADE_PATHS, type K8SkillId } from "@/lib/learning/grades";
import { DAILY_GOAL, type DailyPlan, type DailyProblem, type DailyReason } from "./contracts";
import { skillNameOf, type PlanSkill } from "./names";

/** What the day's set is planned from. */
export interface DailyPlanInput {
  /** the student's local date, YYYY-MM-DD (`localDay`) */
  day: string;
  /** the student: with `day`, the seed (`dailySeed`) */
  userId: string;
  /** the grade's path (`gradePath`), or a high-school course's topics (`courseTopicIds`), in teaching order */
  path: readonly string[];
  /** where to go on once every path skill is mastered: the next grade's path (empty for a course) */
  beyond?: readonly string[];
  /** each skill's mastery (`levelsOf(summary.skills)`); a skill not in it is new */
  levels: ReadonlyMap<string, MasteryLevel>;
  /** worked on and not mastered, weakest first (`summary.weakSkills`) */
  weakSkills: readonly string[];
  /** problems in the set; DAILY_GOAL */
  goal?: number;
  /** another set for the same day ("Practise more"): any words, mixed into the seed */
  salt?: string;
}

/** How many of each reason a full set has (they add up to DAILY_GOAL). */
export const DAILY_MIX: Readonly<Record<DailyReason, number>> = { next: 2, weak: 2, review: 1 };

/**
 * Problems drawn up each skill's ladder (`drawLadder`): the rungs a set picks from. Twice a skill's
 * usual number of forms, so the easy end has two rungs of each easy form, and five problems of one
 * skill for a brand-new student stay easy.
 */
export const LADDER_RUNGS = 12;

/** How far up its ladder a skill's first problem comes from (0 the bottom, 1 the top), by how well the student knows it. */
const START_AT: Readonly<Record<MasteryLevel, number>> = { new: 0, practicing: 0.25, almost: 0.45, mastered: 0.6 };
/** "Keep going": from about the middle of each ladder (the student just warmed up). */
const BONUS_AT = 0.45;

/** A set with nothing to draw from at all (an empty path): the youngest skills there are. */
export const FALLBACK_PATH: readonly string[] = ["add_subtract", "multiply_divide", "fractions"];

/**
 * The older skill a K–8 skill is drawn from while its own generator is missing (the catalog work
 * adds them). Each is the coarse skill those problems were filed under before grades existed.
 */
export const STAND_INS: Readonly<Record<K8SkillId, string>> = {
  add_within_10: "add_subtract",
  subtract_within_10: "add_subtract",
  add_within_20: "add_subtract",
  subtract_within_20: "add_subtract",
  add_tens: "add_subtract",
  add_within_100: "add_subtract",
  subtract_within_100: "add_subtract",
  add_subtract_within_1000: "add_subtract",
  multi_digit_add_subtract: "add_subtract",
  times_tables: "multiply_divide",
  division_facts: "multiply_divide",
  multiply_by_tens: "multiply_divide",
  multiply_multi_digit: "multiply_divide",
  long_division: "multiply_divide",
  equivalent_fractions: "fractions",
  add_fractions_like: "fractions",
  add_fractions_unlike: "fractions",
  multiply_fractions: "fractions",
  divide_fractions: "fractions",
  decimals_add_subtract: "decimals_percents",
  decimals_multiply: "decimals_percents",
  percents: "decimals_percents",
  proportions: "one_step_equations",
};

function standInOf(skill: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(STAND_INS, skill) ? (STAND_INS as Readonly<Record<string, string>>)[skill] : undefined;
}

/** The seed of a student's day: the same student on the same day draws the same set (a `salt`, another one). */
export function dailySeed(userId: string, day: string, salt?: string): number {
  return hashText(salt ? `daily:${userId}:${day}:${salt}` : `daily:${userId}:${day}`);
}

/** The skill whose generator draws `skill`'s problems: itself, its stand-in, or null (none can). */
export function drawSkillFor(skill: string): string | null {
  if (formsFor(skill).length > 0) return skill;
  const standIn = standInOf(skill);
  return standIn && formsFor(standIn).length > 0 ? standIn : null;
}

/**
 * Every skill in the order a student meets it: the K–8 paths, Kindergarten first, each older coarse
 * skill at the place of the first K–8 skill it stands in for, then the rest of `SKILLS`. Only ever
 * used to sort a set easy to hard.
 */
const TEACHING_ORDER: readonly string[] = (() => {
  const out: string[] = [];
  const push = (id: string | undefined) => {
    if (id && !out.includes(id)) out.push(id);
  };
  for (const g of GRADE_IDS) {
    for (const id of GRADE_PATHS[g]) {
      push(id);
      push(standInOf(id));
    }
  }
  for (const s of SKILLS) push(s.id);
  return out;
})();

function teachingRank(skill: string): number {
  const i = TEACHING_ORDER.indexOf(skill);
  return i === -1 ? TEACHING_ORDER.length : i;
}

/** A skill the set can draw from: the skill it is about, and the generator it is drawn with. */
interface SkillPick {
  skill: string;
  draw: string;
  level: MasteryLevel;
}

/** A skill's level; a K–8 skill not in the record yet reads its stand-in's (old rows were filed there). */
function levelOf(skill: string, levels: ReadonlyMap<string, MasteryLevel>): MasteryLevel {
  const own = levels.get(skill);
  if (own) return own;
  const standIn = standInOf(skill);
  return (standIn && levels.get(standIn)) || "new";
}

/** The skills of `ids` that can be drawn, in order, one per generator (two path skills with one stand-in are one pick). */
function picksOf(ids: readonly string[], levels: ReadonlyMap<string, MasteryLevel>, taken: Set<string> = new Set()): SkillPick[] {
  const out: SkillPick[] = [];
  for (const skill of ids) {
    if (typeof skill !== "string") continue;
    const draw = drawSkillFor(skill);
    if (!draw || taken.has(draw)) continue;
    taken.add(draw);
    out.push({ skill, draw, level: levelOf(skill, levels) });
  }
  return out;
}

/** `count` problems spread over `picks` in turn: [3, 2] for five over two skills. */
function spread(picks: readonly SkillPick[], count: number): Array<{ pick: SkillPick; n: number }> {
  if (picks.length === 0 || count <= 0) return [];
  const used = picks.slice(0, Math.min(picks.length, count));
  return used.map((pick, i) => ({ pick, n: Math.floor(count / used.length) + (i < count % used.length ? 1 : 0) }));
}

/** Some problems of one skill, before they are drawn. */
interface Slot {
  pick: SkillPick;
  why: DailyReason;
  n: number;
  /** a brand-new student: the easy end, whatever the level says */
  easy: boolean;
}

/** The skills chosen for each reason, with the slots a reason cannot fill passed on. */
function allocate(input: DailyPlanInput, goal: number): Slot[] {
  const { levels } = input;
  const path = input.path.length > 0 ? input.path : FALLBACK_PATH;
  const all = picksOf(path, levels);
  const seed = dailySeed(input.userId, input.day, input.salt);

  const brandNew = input.weakSkills.length === 0 && ![...levels.values()].some((l) => l !== "new");
  if (brandNew) {
    // the first two skills of the path, easy end: a first day that feels doable
    const first = all.length > 0 ? all : picksOf(FALLBACK_PATH, levels);
    return spread(first.slice(0, 2), goal).map(({ pick, n }) => ({ pick, n, why: "next", easy: true }));
  }

  const taken = new Set<string>();
  // next: the first two path skills not mastered (then the next grade's, once the path is done)
  let next = all.filter((p) => p.level !== "mastered");
  if (next.length === 0) next = picksOf(input.beyond ?? [], levels, new Set(all.map((p) => p.draw))).filter((p) => p.level !== "mastered");
  next = next.slice(0, 2);
  for (const p of next) taken.add(p.draw);

  // weak: weakest first, not already a "next" skill
  const weak = picksOf(input.weakSkills, levels, taken)
    .filter((p) => p.level !== "mastered")
    .slice(0, 2);

  // review: mastered skills (the path's first, then any in the record), a different one first each day
  const masteredIds = [...all.filter((p) => p.level === "mastered").map((p) => p.skill), ...[...levels.entries()].filter(([, l]) => l === "mastered").map(([id]) => id)];
  const mastered = picksOf(masteredIds, levels, taken);
  const turn = mastered.length > 0 ? seed % mastered.length : 0;
  const reviews = [...mastered.slice(turn), ...mastered.slice(0, turn)];

  // the counts, scaled to the goal; what a reason cannot fill goes to next, then weak, then review
  const scale = goal / DAILY_GOAL;
  let nNext = next.length > 0 ? Math.round(DAILY_MIX.next * scale) : 0;
  let nWeak = weak.length > 0 ? Math.round(DAILY_MIX.weak * scale) : 0;
  let nReview = reviews.length > 0 ? Math.round(DAILY_MIX.review * scale) : 0;
  let left = goal - nNext - nWeak - nReview;
  for (; left > 0; left--) {
    if (next.length > 0) nNext++;
    else if (weak.length > 0) nWeak++;
    else if (reviews.length > 0) nReview++;
    else break;
  }
  for (; left < 0; left++) {
    if (nWeak > 0) nWeak--;
    else if (nReview > 0) nReview--;
    else nNext--;
  }

  return [
    ...spread(next, nNext).map(({ pick, n }) => ({ pick, n, why: "next" as const, easy: false })),
    ...spread(weak, nWeak).map(({ pick, n }) => ({ pick, n, why: "weak" as const, easy: false })),
    // one review is today's mastered skill; more (nothing else to practise) go round them all
    ...spread(nReview > 1 ? reviews : reviews.slice(0, 1), nReview).map(({ pick, n }) => ({ pick, n, why: "review" as const, easy: false })),
  ];
}

interface Drawn extends DailyProblem {
  rank: number;
  rung: number;
}

/**
 * The day's set for one student: `goal` problems (fewer only when nothing more can be drawn; empty
 * when nothing can), easy to hard, each with why it is there. Same input, same set.
 */
export function planDailySet(input: DailyPlanInput): DailyPlan {
  const goal = Math.max(1, Math.min(20, Math.floor(typeof input.goal === "number" && Number.isFinite(input.goal) ? input.goal : DAILY_GOAL)));
  const seed = dailySeed(input.userId, input.day, input.salt);
  const ladders = new Map<string, string[][]>();
  const ladderOf = (draw: string): string[][] => {
    let ladder = ladders.get(draw);
    if (!ladder) {
      try {
        ladder = drawLadder(draw, LADDER_RUNGS, seed).problems;
      } catch {
        ladder = [];
      }
      ladders.set(draw, ladder);
    }
    return ladder;
  };
  // rungs already used, by generator: two slots of one skill climb its ladder
  const used = new Map<string, Set<number>>();
  const seen = new Set<string>();

  const takeRung = (draw: string, at: number): { lines: string[]; rung: number } | null => {
    const ladder = ladderOf(draw);
    if (ladder.length === 0) return null;
    const taken = used.get(draw) ?? new Set<number>();
    used.set(draw, taken);
    const start = Math.round(Math.max(0, Math.min(1, at)) * (ladder.length - 1));
    // up the ladder from the start, then back down below it
    const rungs = [...ladder.keys()];
    const order = [...rungs.filter((k) => k >= start), ...rungs.filter((k) => k < start).reverse()];
    for (const k of order) {
      const key = ladder[k].join("; ");
      if (taken.has(k) || seen.has(key)) continue;
      taken.add(k);
      seen.add(key);
      return { lines: [...ladder[k]], rung: k };
    }
    return null;
  };

  const drawn: Drawn[] = [];
  const slots = allocate(input, goal);
  const add = (slot: Slot, at: number): boolean => {
    const got = takeRung(slot.pick.draw, at);
    if (!got) return false;
    drawn.push({ skill: slot.pick.skill, lines: got.lines, why: slot.why, rank: teachingRank(slot.pick.skill), rung: got.rung });
    return true;
  };
  for (const slot of slots) {
    const at = slot.easy ? 0 : START_AT[slot.pick.level];
    for (let i = 0; i < slot.n && add(slot, at); i++);
  }
  // a ladder that ran short: fill up from the skills already in the set, in order
  for (const slot of slots) while (drawn.length < goal && add(slot, 0));

  const problems = drawn
    .slice(0, goal)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.rank - b.p.rank || a.p.rung - b.p.rung || a.i - b.i)
    .map(({ p }) => ({ skill: p.skill, lines: p.lines, why: p.why }));
  return { day: input.day, goal: problems.length > 0 ? problems.length : goal, problems };
}

/** The set's skills in the order they come, each once, for the home card's "In today's set". */
export function planSkills(plan: DailyPlan): PlanSkill[] {
  const out: PlanSkill[] = [];
  for (const p of plan.problems) {
    const seen = out.find((s) => s.skill === p.skill);
    if (seen) {
      seen.problems++;
      continue;
    }
    const name = skillNameOf(p.skill);
    if (name) out.push({ skill: p.skill, name, why: p.why, problems: 1 });
  }
  return out;
}

/** How many problems "Keep going" adds after the day's goal. */
export const BONUS_PROBLEMS = 3;

/**
 * "Keep going" after the goal: `count` more problems from the day's skills (in turn, from about the
 * middle of each ladder: the student just warmed up), none of them a problem in `exclude`. Same
 * seed, same problems. Empty when none of the skills can be drawn.
 */
export function bonusProblems(skills: readonly string[], seed: number, count: number = BONUS_PROBLEMS, exclude: readonly (readonly string[])[] = []): string[][] {
  let picks = picksOf(skills, new Map());
  if (picks.length === 0) picks = picksOf(FALLBACK_PATH, new Map());
  if (picks.length === 0) return [];
  const seen = new Set(exclude.map((p) => p.join("; ")));
  const bonusSeed = hashText(`bonus:${seed}`);
  const ladders = picks.map((p) => {
    try {
      return drawLadder(p.draw, LADDER_RUNGS, bonusSeed).problems;
    } catch {
      return [];
    }
  });
  const out: string[][] = [];
  // from the middle of each ladder up (then round to its foot), the skills in turn
  for (let step = 0; out.length < count && step < LADDER_RUNGS; step++) {
    for (const ladder of ladders) {
      if (out.length >= count) break;
      if (ladder.length === 0) continue;
      const p = ladder[(Math.round(BONUS_AT * (ladder.length - 1)) + step) % ladder.length];
      const key = p.join("; ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([...p]);
    }
  }
  return out;
}
