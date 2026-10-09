/**
 * "Pick a topic" (2026-10-08): the home's Up next, the topic list, the "What do you want to work
 * on?" box, and the board's New topic sheet. A topic is a skill with practice problems
 * (`SKILLS`, `practiceSet.ts`); choosing one opens a topic board (or a new screen on this board)
 * where the tutor works one example and then writes a few problems, easy to hard, for the student.
 *
 * Pure: the student's course and mastery in, what to offer out. No React, no network, no
 * generators (the home lists topics before any problem is made), unit-tested in
 * `__tests__/topics.test.ts`.
 */
import type { CourseId } from "@/lib/onboarding/courseIds";
import { COURSES } from "@/lib/onboarding/courses";
import { SKILL_AREAS, SKILLS, type MasteryLevel, type SkillArea, type SkillId, type SkillProgress } from "./contracts";
import { AREA_LABELS, LEVEL_LABELS } from "./progressView";

// ------------------------------------------------------------------ which skills are topics

/** The skills with no practice problems (words, a proof or a reaction on the board; the fallback). */
export const NOT_TOPICS = ["word_problems", "proofs", "chemistry", "other"] as const satisfies readonly SkillId[];
export type TopicId = Exclude<SkillId, (typeof NOT_TOPICS)[number]>;

/** Every topic in teaching order (`SKILLS` order). `practice.test.ts` holds these to `hasPractice`. */
export const TOPIC_IDS: readonly TopicId[] = SKILLS.map((s) => s.id).filter((id): id is TopicId => !(NOT_TOPICS as readonly string[]).includes(id));

export function isTopicId(value: unknown): value is TopicId {
  return typeof value === "string" && (TOPIC_IDS as readonly string[]).includes(value);
}

export interface TopicInfo {
  /** one short line: what it is, in a student's words */
  blurb: string;
  /** words a student types for it (lower case, whole words): "quadratics", "times tables" */
  aliases: readonly string[];
}

export const TOPIC_INFO: Readonly<Record<TopicId, TopicInfo>> = {
  add_subtract: { blurb: "Adding and taking away numbers", aliases: ["adding", "addition", "add", "plus", "sums", "subtracting", "subtraction", "subtract", "minus", "take away", "adding and subtracting"] },
  multiply_divide: { blurb: "Times tables and sharing equally", aliases: ["multiplying", "multiplication", "multiply", "times", "times tables", "times table", "dividing", "division", "divide", "long division", "multiplying and dividing"] },
  negative_numbers: { blurb: "Numbers below zero", aliases: ["negative numbers", "negative", "negatives", "integers", "minus numbers"] },
  order_of_operations: { blurb: "Which step comes first (PEMDAS)", aliases: ["order of operations", "pemdas", "bodmas", "bidmas", "gemdas"] },
  fractions: { blurb: "Parts of a whole, like ¾ + ⅙", aliases: ["fractions", "fraction", "numerator", "denominator", "denominators", "common denominator", "mixed numbers"] },
  decimals_percents: { blurb: "Decimals, and a percent of a number", aliases: ["decimals", "decimal", "percent", "percents", "percentage", "percentages", "decimals and percents"] },
  powers_roots: { blurb: "Squares, cubes and square roots", aliases: ["powers", "power", "squares", "squared", "cubes", "cubed", "square roots", "square root", "powers and roots"] },
  simplify_expressions: { blurb: "Collect like terms, like 3x + 2x", aliases: ["simplifying", "simplify", "simplifying expressions", "like terms", "combining like terms", "collecting like terms", "expressions", "distributive property"] },
  one_step_equations: { blurb: "Solve x + 5 = 12 in one step", aliases: ["one step equations", "one step equation", "one step"] },
  two_step_equations: { blurb: "Solve equations like 2x + 3 = 11", aliases: ["two step equations", "two step equation", "two step"] },
  multi_step_equations: { blurb: "Brackets, or x on both sides", aliases: ["multi step equations", "multi step equation", "multi step", "multistep", "x on both sides", "variables on both sides"] },
  inequalities: { blurb: "Solve with <, >, ≤ and ≥", aliases: ["inequalities", "inequality"] },
  absolute_value: { blurb: "Distance from zero, like |x − 3| = 5", aliases: ["absolute value", "absolute values", "modulus"] },
  systems: { blurb: "Two equations, two unknowns", aliases: ["systems", "system of equations", "systems of equations", "simultaneous equations", "simultaneous", "elimination", "substitution"] },
  exponent_rules: { blurb: "x² · x³ and the other power rules", aliases: ["exponent rules", "exponents", "exponent", "laws of exponents", "index laws", "indices"] },
  polynomials: { blurb: "Multiply out brackets: (x + 2)(x − 3)", aliases: ["polynomials", "polynomial", "multiplying polynomials", "foil", "expanding", "expand", "expanding brackets", "binomials"] },
  factoring: { blurb: "Turn x² + 5x + 6 into brackets", aliases: ["factoring", "factorising", "factorizing", "factorise", "factorize", "factor", "factorisation", "factorization"] },
  quadratic_equations: { blurb: "Solve equations with an x²", aliases: ["quadratics", "quadratic", "quadratic equations", "quadratic equation", "quadratic formula", "completing the square"] },
  radicals: { blurb: "Simplify roots and solve √ equations", aliases: ["radicals", "radical", "surds", "surd", "simplifying roots", "radical equations"] },
  rational_expressions: { blurb: "Fractions with x in them", aliases: ["rational expressions", "rational expression", "rational equations", "algebraic fractions"] },
  complex_numbers: { blurb: "Numbers with i, where i² = −1", aliases: ["complex numbers", "complex number", "complex", "imaginary numbers", "imaginary"] },
  linear_functions: { blurb: "Slope, lines and y = mx + b", aliases: ["slope", "slopes", "gradient", "lines", "linear functions", "linear graphs", "slope intercept", "point slope", "y intercept", "graphing lines", "lines and slope"] },
  functions: { blurb: "f(x): put a number in, get one out", aliases: ["functions", "function", "f of x", "composite functions", "inverse functions", "domain and range"] },
  exponential_equations: { blurb: "Solve equations like 2ˣ = 32", aliases: ["exponential equations", "exponential equation", "exponentials", "exponential", "exponential growth", "exponential decay"] },
  logarithms: { blurb: "Logs, the opposite of powers", aliases: ["logarithms", "logarithm", "logs", "log", "natural log"] },
  angles: { blurb: "Angles on a line and around a point", aliases: ["angles", "angle", "complementary angles", "supplementary angles", "vertical angles", "complementary", "supplementary"] },
  triangles: { blurb: "The angles in a triangle make 180°", aliases: ["triangles", "triangle", "angles in a triangle", "triangle angles"] },
  pythagorean: { blurb: "a² + b² = c² in a right triangle", aliases: ["pythagoras", "pythagorean theorem", "pythagorean", "pythagoras theorem", "hypotenuse", "right triangles", "right triangle"] },
  area_perimeter: { blurb: "How much space, and the way round", aliases: ["area", "perimeter", "area and perimeter", "volume", "surface area"] },
  circles: { blurb: "Circumference and area with π", aliases: ["circles", "circle", "circumference", "radius", "diameter", "area of a circle", "area of circles"] },
  coordinate_geometry: { blurb: "Distance and midpoint of two points", aliases: ["distance formula", "midpoint", "midpoints", "coordinate geometry", "distance and midpoint", "coordinates"] },
  trig_values: { blurb: "sin, cos and tan of special angles", aliases: ["trig", "trigonometry", "sin", "cos", "tan", "sine", "cosine", "tangent", "sohcahtoa", "soh cah toa", "unit circle", "trig values", "trig ratios"] },
  trig_equations: { blurb: "Solve equations like 2 sin x = 1", aliases: ["trig equations", "trigonometric equations", "trig equation", "solving trig equations"] },
  limits: { blurb: "Where a function is heading", aliases: ["limits", "limit"] },
  derivatives: { blurb: "How fast things change: d/dx", aliases: ["derivatives", "derivative", "differentiation", "differentiate", "differentiating", "power rule", "chain rule", "product rule"] },
  integrals: { blurb: "Undo a derivative, area under a curve", aliases: ["integrals", "integral", "integration", "integrate", "integrating", "antiderivatives", "antiderivative"] },
  units: { blurb: "Change km to m, kg to g and more", aliases: ["units", "unit conversion", "unit conversions", "converting units", "conversions", "metric units", "metric"] },
};

function skillName(id: SkillId): string {
  return SKILLS.find((s) => s.id === id)?.name ?? id;
}

function areaOf(id: SkillId): SkillArea {
  return SKILLS.find((s) => s.id === id)?.area ?? "algebra";
}

// ------------------------------------------------------------------ the student's course

/**
 * The topics of a course, in teaching order. Course `other` (the youngest students, or "something
 * else") and an unknown course start with the numbers: every arithmetic topic.
 */
export function courseTopicIds(course: CourseId | null | undefined): TopicId[] {
  if (!course || course === "other") return TOPIC_IDS.filter((id) => areaOf(id) === "arithmetic");
  return TOPIC_IDS.filter((id) => (SKILLS.find((s) => s.id === id)?.courses as readonly CourseId[] | undefined)?.includes(course));
}

/** "Algebra 1", or null for course `other` and an unknown one (their list is "Numbers"). */
export function courseName(course: CourseId | null | undefined): string | null {
  if (!course || course === "other") return null;
  return COURSES.find((c) => c.id === course)?.label ?? null;
}

/** Each skill's level from the learning summary (`summary.skills`); a skill not in it is `new`. */
export function levelsOf(skills: readonly Pick<SkillProgress, "skill" | "level">[]): Map<SkillId, MasteryLevel> {
  return new Map(skills.map((s) => [s.skill, s.level]));
}

// ------------------------------------------------------------------ what to offer

export interface TopicView {
  id: TopicId;
  name: string;
  blurb: string;
  area: SkillArea;
  level: MasteryLevel;
  levelLabel: string;
}

/** A blurb's bit of maths kept on one line: an operator holds on to what is either side of it (`(x + 2)(x − 3)`). */
export function keepMathsTogether(text: string): string {
  return text.replace(/ ([+\-−=·×÷<>≤≥]) /g, " $1 ");
}

export function topicView(id: TopicId, levels: ReadonlyMap<string, MasteryLevel>): TopicView {
  const level = levels.get(id) ?? "new";
  return { id, name: skillName(id), blurb: keepMathsTogether(TOPIC_INFO[id].blurb), area: areaOf(id), level, levelLabel: LEVEL_LABELS[level] };
}

export interface UpNextChoice {
  /** the next topic of the course not mastered yet, in teaching order (the first of the course for a new student) */
  next: TopicView | null;
  /** the weakest topic the student has worked on and not mastered (other than `next`), or null */
  weakest: TopicView | null;
}

/**
 * Up next: the first topic of the student's course they have not mastered, in teaching order
 * (`SKILLS`) — with every one of them mastered, the first not mastered of all the others — and their
 * weakest spot (`summary.weakSkills`, weakest first) as a second, smaller offer.
 */
export function upNext(course: CourseId | null | undefined, levels: ReadonlyMap<string, MasteryLevel>, weakSkills: readonly string[] = []): UpNextChoice {
  const open = (id: TopicId) => levels.get(id) !== "mastered";
  const mine = courseTopicIds(course);
  const nextId = mine.find(open) ?? TOPIC_IDS.find((id) => !mine.includes(id) && open(id)) ?? null;
  const weakId = weakSkills.find((id): id is TopicId => isTopicId(id) && id !== nextId && open(id)) ?? null;
  return { next: nextId ? topicView(nextId, levels) : null, weakest: weakId ? topicView(weakId, levels) : null };
}

export interface TopicGroup {
  area: SkillArea;
  label: string;
  topics: TopicView[];
}

function grouped(ids: readonly TopicId[], levels: ReadonlyMap<string, MasteryLevel>): TopicGroup[] {
  const out: TopicGroup[] = [];
  for (const area of SKILL_AREAS) {
    const topics = ids.filter((id) => areaOf(id) === area).map((id) => topicView(id, levels));
    if (topics.length > 0) out.push({ area, label: AREA_LABELS[area], topics });
  }
  return out;
}

/**
 * The topic list: the student's course first (`mine`, by area, in teaching order), and every other
 * topic under "Other topics" (`others`): a 4th grader sees the numbers first, an Algebra 1 student
 * can still pick Adding and subtracting.
 */
export function topicGroups(course: CourseId | null | undefined, levels: ReadonlyMap<string, MasteryLevel>): { mine: TopicGroup[]; others: TopicGroup[] } {
  const mine = courseTopicIds(course);
  return { mine: grouped(mine, levels), others: grouped(TOPIC_IDS.filter((id) => !mine.includes(id)), levels) };
}

// ------------------------------------------------------------------ the words box

/** Text in a student's own words, as the matcher reads it: lower case, words and spaces only. */
export function normalizeWords(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-‐‑–—_/]/g, " ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that ask the tutor for something a topic board is not: an explanation, or this very problem. */
const ASK_WORDS = new Set(["how", "why", "what", "explain", "mean", "means", "difference", "check", "wrong", "homework", "worksheet", "question", "questions", "problem", "prove", "proof", "word"]);
/** Typed maths ("solve 2x + 3 = 7"): the tutor reads it, not the matcher. */
const MATHS = /[0-9=+*^<>√∫π²³]/;
/** More words than this is more than a topic: the tutor reads it. */
const MAX_TOPIC_WORDS = 8;

interface AliasHit {
  skill: TopicId;
  start: number;
  end: number;
}

function hitsIn(words: string): AliasHit[] {
  const padded = ` ${words} `;
  const hits: AliasHit[] = [];
  for (const id of TOPIC_IDS) {
    for (const alias of TOPIC_INFO[id].aliases) {
      const a = normalizeWords(alias);
      // the alias, or the alias with an s or es on the end, as whole words
      for (const form of [a, `${a}s`, `${a}es`]) {
        let at = padded.indexOf(` ${form} `);
        while (at !== -1) {
          hits.push({ skill: id, start: at, end: at + form.length });
          at = padded.indexOf(` ${form} `, at + 1);
        }
      }
    }
  }
  // a hit inside a longer one of another topic is that topic's word ("trig" in "trig equations")
  return hits.filter((h) => !hits.some((o) => o.skill !== h.skill && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
}

/**
 * The one topic a few typed words name ("fractions", "test on quadratics Friday", "times tables"),
 * or null: none named, two named ("area of triangles"), typed maths, a question for the tutor
 * ("how do I add fractions"), or too many words to be just a topic. Null sends the words to Ask.
 */
export function matchTopic(text: string): TopicId | null {
  if (MATHS.test(text)) return null;
  const words = normalizeWords(text);
  if (!words) return null;
  const list = words.split(" ");
  if (list.length > MAX_TOPIC_WORDS || list.some((w) => ASK_WORDS.has(w))) return null;
  const skills = new Set(hitsIn(words).map((h) => h.skill));
  return skills.size === 1 ? [...skills][0] : null;
}

/** The longest board name the box makes. */
export const TOPIC_TITLE_MAX = 60;

/** A board's name from the student's words: tidied, a capital first, at most 60 characters at a word. */
export function topicBoardTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  let title = clean;
  if (title.length > TOPIC_TITLE_MAX) {
    const cut = title.slice(0, TOPIC_TITLE_MAX - 1);
    const space = cut.lastIndexOf(" ");
    title = `${(space > TOPIC_TITLE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
  }
  return title.charAt(0).toLocaleUpperCase() + title.slice(1);
}

// ------------------------------------------------------------------ words

/** How many problems a topic board writes after its worked example. */
export const TOPIC_PROBLEMS = 4;

export const TOPIC_COPY = {
  upNext: "Up next",
  weakest: "Keep at it",
  weakestHint: "Your trickiest topic lately",
  start: "Start",
  practise: "Practise",
  allDone: "You've mastered every topic. Pick any one to keep it fresh!",
  askTitle: "What do you want to work on?",
  askPlaceholder: "Fractions, or “test on quadratics Friday”",
  askGo: "Go",
  /** under the box, when the words name one topic: it opens that topic's board */
  askTopic: (name: string) => `We'll start you on ${name}.`,
  /** under the box, otherwise: Ask gets the words */
  askTutor: "The tutor will read this and start your board there.",
  browse: "Pick a topic",
  browseHint: "Each topic starts with one worked example, then a few for you to try.",
  mine: (course: string | null) => (course ? `Your course: ${course}` : "Start with numbers"),
  others: "Other topics",
  othersHint: "Anything else you want to work on",
  sheetTitle: "Pick a topic",
  sheetHint: "It goes on a new screen of this board.",
  failedTitle: "That topic didn't open",
  failedFallback: "The board was not created. Try again in a moment.",
  noProblems: "There are no problems for that topic yet.",
  loadFailed: "Couldn't load your topics just now. You can still pick one.",
} as const;
