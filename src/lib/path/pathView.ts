/**
 * The skill path (2026-10-09, "kids come back"): the student's grade's skills, or their high-school
 * course's topics, as a trail of stops in teaching order. A kid sees where they are and what comes
 * next; a grown-up sees "2 of 4 skills mastered" at a glance. The home's SkillPathCard and the top of
 * the Progress page both draw it from this view.
 *
 * Pure: the student's grade or course and their skill levels in, the trail out. No React, no
 * network, no generators (the home draws the path before any problem is made), unit-tested in
 * `__tests__/pathView.test.ts`.
 *
 * Levels come from the learning summary (`summary.skills`, read with `levelsOf`); a skill not in it is
 * `new`. The K–8 skills (`grades.ts`) take their names from K8_SKILLS here, so the path reads well
 * before or after the catalog work adds them to SKILLS, and a K–8 skill opens its topic board as
 * soon as it is a topic (`isTopicId`); until then its stop says "Coming soon".
 */
import type { CourseId } from "@/lib/onboarding/courseIds";
import { skillDef, type MasteryLevel, type SkillArea } from "@/lib/learning/contracts";
import { GRADES, gradePath, isGrade, isK8SkillId, K8_SKILLS, type Grade, type K8SkillId, type PathSkillId } from "@/lib/learning/grades";
import { LEVEL_LABELS } from "@/lib/learning/progressView";
import { courseName, courseTopicIds, isTopicId, keepMathsTogether, TOPIC_INFO, type TopicId } from "@/lib/learning/topics";
import { nextStepIndex } from "./nextStep";

// ------------------------------------------------------------------ words

export const PATH_COPY = {
  /** the home card's title, to the kid: "Your 3rd grade path" */
  homeTitle: (label: string) => `Your ${label} path`,
  /** the home card's count, to the kid */
  homeCount: (mastered: number, total: number) => `${mastered} of ${total} done`,
  /** the Progress page's header, which a grown-up reads too */
  progressTitle: (label: string, mastered: number, total: number) => `${label} path: ${mastered} of ${total} ${total === 1 ? "skill" : "skills"} mastered`,
  progressHint: "Tap a skill to practice it. Stars show how strong each one is.",
  /** the stars' key on the Progress page */
  starsKey: "What the stars mean",
  nextUp: "Next up",
  allDone: "You did it! Every skill on your path is done.",
  allDoneProgress: "Every skill on this path is mastered.",
  listLabel: (label: string) => `${label} path`,
  /** the home's "+10" stop at the end of a long path's one row: the whole path is on Progress */
  moreName: "See all",
  moreLabel: (total: number) => `See all ${total} skills`,
  moreHref: "/progress",
  comingSoonTitle: "Coming soon",
  comingSoon: (name: string) => `${name} is almost ready. Try another skill for now!`,
  pickTitle: "Pick your grade",
  pickHint: "Tell us your grade and we'll make you a path of skills.",
  pickAction: "Pick my grade",
  /** where "Pick my grade" goes: the account page's grade section (the onboarding work adds it) */
  pickHref: "/account#grade",
  /** a kid profile's grade is their grown-up's to set, on the Family page: no link, who to ask */
  kidPickTitle: "Ask your grown-up to pick your grade",
  kidPickHint: "They can set it on their Family page. Then you'll get a path of skills.",
  loading: "Loading your path",
} as const;

// ------------------------------------------------------------------ which path

/** A high-school course: one with its own path (`other` is the youngest students, or "something else"). */
export type PathCourse = Exclude<CourseId, "other">;

/**
 * Whose path to draw: the student's grade (Kindergarten to 8th), else their high-school course's
 * topics, else nothing yet ("Pick your grade"). A grade wins over a course: the welcome asks for
 * one or the other, and a grade picked later is the newer choice.
 */
export type PathSource = { kind: "grade"; grade: Grade } | { kind: "course"; course: PathCourse } | { kind: "pick" };

export function pathSourceFor(profile: { grade?: Grade | number | null; course?: CourseId | null }): PathSource {
  if (isGrade(profile.grade)) return { kind: "grade", grade: profile.grade };
  const course = profile.course;
  if (course && course !== "other" && courseTopicIds(course).length > 0) return { kind: "course", course };
  return { kind: "pick" };
}

/** The skills on a path, in teaching order. */
export function pathSkillIds(source: Exclude<PathSource, { kind: "pick" }>): PathSkillId[] {
  return source.kind === "grade" ? gradePath(source.grade) : courseTopicIds(source.course);
}

// ------------------------------------------------------------------ a stop's look

/**
 * The picture on a stop: the operation for the arithmetic a young kid knows by its sign (+, −, ×, ÷,
 * a fraction, a percent), else the skill's area, as the topic picker draws it.
 */
export type PathIcon = "add" | "subtract" | "addSubtract" | "multiply" | "divide" | "fraction" | "decimal" | "percent" | "ratio" | SkillArea;

const K8_ICONS: Readonly<Record<K8SkillId, PathIcon>> = {
  add_within_10: "add",
  subtract_within_10: "subtract",
  add_within_20: "add",
  subtract_within_20: "subtract",
  add_tens: "add",
  add_within_100: "add",
  subtract_within_100: "subtract",
  add_subtract_within_1000: "addSubtract",
  times_tables: "multiply",
  division_facts: "divide",
  multiply_by_tens: "multiply",
  multi_digit_add_subtract: "addSubtract",
  multiply_multi_digit: "multiply",
  long_division: "divide",
  equivalent_fractions: "fraction",
  add_fractions_like: "fraction",
  add_fractions_unlike: "fraction",
  multiply_fractions: "fraction",
  divide_fractions: "fraction",
  decimals_add_subtract: "decimal",
  decimals_multiply: "decimal",
  percents: "percent",
  proportions: "ratio",
};

/** The older, coarse arithmetic skills get their sign too. */
const SKILL_ICONS: Readonly<Record<string, PathIcon>> = {
  add_subtract: "addSubtract",
  multiply_divide: "multiply",
  negative_numbers: "subtract",
  fractions: "fraction",
  decimals_percents: "percent",
};

export function pathIcon(id: string): PathIcon {
  if (isK8SkillId(id)) return K8_ICONS[id];
  return SKILL_ICONS[id] ?? skillDef(id)?.area ?? "arithmetic";
}

/** A skill's name: K8_SKILLS for a K–8 skill, else SKILLS. */
export function pathSkillName(id: string): string {
  if (isK8SkillId(id)) return K8_SKILLS[id].name;
  return skillDef(id)?.name ?? id;
}

/** A skill's one line: K8_SKILLS for a K–8 skill, else the topic's blurb, else none. */
export function pathSkillBlurb(id: string): string | null {
  if (isK8SkillId(id)) return keepMathsTogether(K8_SKILLS[id].blurb);
  return isTopicId(id) && TOPIC_INFO[id] ? keepMathsTogether(TOPIC_INFO[id].blurb) : null;
}

export type Stars = 0 | 1 | 2 | 3;

/** Stars for a level: none for New, one for Practicing, two for Almost there, three for Mastered. */
export const LEVEL_STARS: Readonly<Record<MasteryLevel, Stars>> = { new: 0, practicing: 1, almost: 2, mastered: 3 };
export const MAX_STARS = 3;

// ------------------------------------------------------------------ the view

/** A stop is done (mastered), the current one (the first not mastered), or still to come. */
export type PathNodeState = "done" | "current" | "upcoming";

export interface PathNode {
  id: PathSkillId;
  /** 1-based place on the path */
  step: number;
  name: string;
  blurb: string | null;
  icon: PathIcon;
  level: MasteryLevel;
  levelLabel: string;
  state: PathNodeState;
  stars: Stars;
  /** the topic board a tap opens, or null while the skill has no problems yet ("Coming soon") */
  topic: TopicId | null;
  /** the stop as a screen reader says it: "Times tables, step 2 of 4. Next up. Practicing, 1 of 3 stars." */
  label: string;
}

export interface PathView {
  kind: "grade" | "course";
  /** "3rd grade", "Kindergarten", "Algebra 1" */
  label: string;
  /** the short chip: "3rd", "K", "Algebra 1" */
  chip: string;
  nodes: PathNode[];
  /** the next skill's index in `nodes` (the first not mastered), or -1 with every skill mastered */
  currentIndex: number;
  mastered: number;
  total: number;
  allDone: boolean;
  /** the home card's title and count, to the kid */
  homeTitle: string;
  homeCount: string;
  /** the Progress page's header: "3rd grade path: 2 of 4 skills mastered" */
  progressTitle: string;
}

function stateWords(state: PathNodeState, level: MasteryLevel, stars: Stars): string {
  const strength = level === "new" ? "Not started yet" : `${LEVEL_LABELS[level]}, ${stars} of ${MAX_STARS} stars`;
  return state === "current" ? `${PATH_COPY.nextUp}. ${strength}.` : `${strength}.`;
}

function nodeLabel(name: string, step: number, total: number, state: PathNodeState, level: MasteryLevel, stars: Stars, topic: TopicId | null): string {
  const soon = topic ? "" : ` ${PATH_COPY.comingSoonTitle}.`;
  return `${name}, step ${step} of ${total}. ${stateWords(state, level, stars)}${soon}`;
}

/**
 * The path for a grade or a course, from each skill's level: every stop with its stars and whether
 * it is done, the current one (the first not mastered, in teaching order) or still to come; how many
 * are mastered; and the words for the home card and the Progress page. A mastered skill later on the
 * path is done wherever it is; the current stop is always the first one not mastered.
 */
export function buildPathView(source: Exclude<PathSource, { kind: "pick" }>, levels: ReadonlyMap<string, MasteryLevel>): PathView {
  const ids = pathSkillIds(source);
  const total = ids.length;
  const levelOf = (id: string): MasteryLevel => levels.get(id) ?? "new";
  // the first not mastered, past review the student has shown they can skip (`nextStepIndex`)
  const currentIndex = nextStepIndex(ids.map(levelOf));
  const nodes = ids.map((id, i): PathNode => {
    const level = levelOf(id);
    const state: PathNodeState = level === "mastered" ? "done" : i === currentIndex ? "current" : "upcoming";
    const stars = LEVEL_STARS[level];
    const name = pathSkillName(id);
    const topic = isTopicId(id) ? id : null;
    return {
      id,
      step: i + 1,
      name,
      blurb: pathSkillBlurb(id),
      icon: pathIcon(id),
      level,
      levelLabel: LEVEL_LABELS[level],
      state,
      stars,
      topic,
      label: nodeLabel(name, i + 1, total, state, level, stars, topic),
    };
  });
  const mastered = nodes.filter((n) => n.state === "done").length;
  const grade = source.kind === "grade" ? GRADES.find((g) => g.id === source.grade) : undefined;
  const label = grade ? grade.label : (courseName(source.kind === "course" ? source.course : null) ?? "Course");
  const chip = grade ? grade.short : label;
  return {
    kind: source.kind,
    label,
    chip,
    nodes,
    currentIndex,
    mastered,
    total,
    allDone: total > 0 && currentIndex === -1,
    homeTitle: PATH_COPY.homeTitle(label),
    homeCount: PATH_COPY.homeCount(mastered, total),
    progressTitle: PATH_COPY.progressTitle(label, mastered, total),
  };
}

/**
 * The path for a profile, or null when there is none to draw yet (no grade and no high-school
 * course: the "Pick your grade" card) or it has no skills.
 */
export function pathFor(profile: { grade?: Grade | number | null; course?: CourseId | null }, levels: ReadonlyMap<string, MasteryLevel>): PathView | null {
  const source = pathSourceFor(profile);
  if (source.kind === "pick") return null;
  const view = buildPathView(source, levels);
  return view.total > 0 ? view : null;
}

/**
 * Whether a link of the trail, from stop `index` to the next one, is walked (drawn in colour): up to
 * the current stop, or all of it once every skill is mastered.
 */
export function linkWalked(view: Pick<PathView, "currentIndex" | "allDone">, index: number): boolean {
  return view.allDone || index + 1 <= view.currentIndex;
}
