/**
 * The first thing Ask's panel shows on a board with no chat yet (`AskHello`): a greeting and up to
 * four chips, built from what the tutor knows (`AskLearnerContext`), with no model call. Pure, so
 * every greeting a kid can see is tested.
 *
 *   back, with a skill    "Welcome back, Maya! Last time you worked on dividing fractions."
 *   back, notes only      "Welcome back, Maya! I remember how you like to learn. What are we working on today?"
 *   first time            "Hi Maya! I'm your tutor. Ask me anything, or write a problem on the board."
 *
 * The chips are things a kid would ask, in their words, most useful first: more of what they did
 * last time, an explanation of it, a quiz that fits their grade or course, and help with homework.
 * Each is sent as the student's message when tapped, and the tutor reads the same context, so "3
 * more like last time" means the skill named in the greeting.
 */
import { AskHelloSchema, type AskHello } from "@/lib/live/ask/contracts";
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { Grade } from "@/lib/learning/grades";
import type { AskLearnerContext } from "./store";

/** The greeting's and each chip's length (the contract's). */
const GREETING_MAX = 240;
const CHIP_MAX = 60;
const CHIPS_MAX = 4;

export const HELLO_CHIPS = {
  moreLikeLast: "3 more like last time",
  /** a new screen's first chip: more of what the board was just working on, named (the model sees only this screen's chat) */
  moreOn: (skill: string) => `3 more on ${skill}`,
  explain: (skill: string) => `Explain ${skill} to me`,
  homework: "Help me with my homework",
  whatCanYouDo: "What can you help me with?",
  funFact: "Tell me a fun math fact",
} as const;

/** A quiz that fits each grade (K–8): the heart of that grade's math, in a kid's words. */
const GRADE_QUIZ: Readonly<Record<Grade, string>> = {
  0: "Quiz me on adding to 10",
  1: "Quiz me on adding to 20",
  2: "Quiz me on 2-digit adding",
  3: "Quiz me on times tables",
  4: "Quiz me on long division",
  5: "Quiz me on fractions",
  6: "Quiz me on percents",
  7: "Quiz me on equations",
  8: "Quiz me on slope",
};

const COURSE_QUIZ: Readonly<Record<CourseId, string>> = {
  algebra1: "Quiz me on equations",
  geometry: "Quiz me on angles",
  algebra2: "Quiz me on quadratics",
  precalc_calc: "Quiz me on trig",
  other: "Quiz me on math",
};

/** Skill names that start with a name of their own: they keep their capital mid-sentence, after "the". */
const PROPER = /^(Pythagorean|Roman)\b/;

/** A catalog name read mid-sentence: "Dividing fractions" → "dividing fractions", "Pythagorean theorem" → "the Pythagorean theorem". */
export function skillInSentence(name: string): string {
  const t = name.trim();
  if (PROPER.test(t)) return `the ${t}`;
  if (!t || /^[A-Z]{2,}/.test(t)) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** The quiz chip for this student, or null without a grade or course. */
export function quizChip(ctx: Pick<AskLearnerContext, "grade" | "course">): string | null {
  if (ctx.grade !== null && ctx.grade in GRADE_QUIZ) return GRADE_QUIZ[ctx.grade as Grade];
  if (ctx.course && ctx.course in COURSE_QUIZ) return COURSE_QUIZ[ctx.course as CourseId];
  return null;
}

/** A new screen's greeting: short, the student already met the tutor on the screen before. */
export const NEW_SCREEN_GREETING = "New screen! What should we work on?";

/** Up to four chips, each once and within the contract's length, topped up from the general ones. */
function pickChips(candidates: ReadonlyArray<string | null>): string[] {
  const chips: string[] = [];
  for (const chip of candidates) {
    if (!chip || chip.length > CHIP_MAX || chips.includes(chip)) continue;
    chips.push(chip);
    if (chips.length >= CHIPS_MAX) break;
  }
  // a hello without a quiz (no grade or course) still offers four
  for (const chip of [HELLO_CHIPS.homework, HELLO_CHIPS.whatCanYouDo, HELLO_CHIPS.funFact]) {
    if (chips.length >= CHIPS_MAX) break;
    if (!chips.includes(chip)) chips.push(chip);
  }
  return chips;
}

/**
 * The hello for a screen with no chat that is not the board's first (docs/ASK-V2.md, "A chat per
 * screen"): a short line, and chips that follow from the screen before when the board's learning
 * record names what was worked on there (`ctx.recent`, read with `onBoard`: this board's skills,
 * newest first). The chip names the skill, because the tutor sees only this screen's chat: "3 more
 * on dividing fractions", not "more like the last screen".
 */
export function buildNewScreenHello(ctx: Pick<AskLearnerContext, "recent" | "grade" | "course">): AskHello {
  const last = ctx.recent.find((s) => s.trim().length > 0)?.trim() ?? null;
  const quiz = quizChip(ctx);
  const candidates = last
    ? [HELLO_CHIPS.moreOn(skillInSentence(last)), HELLO_CHIPS.explain(skillInSentence(last)), quiz, HELLO_CHIPS.homework]
    : [quiz, HELLO_CHIPS.homework, HELLO_CHIPS.whatCanYouDo, HELLO_CHIPS.funFact];
  return AskHelloSchema.parse({ greeting: NEW_SCREEN_GREETING, chips: pickChips(candidates) });
}

/** The hello for a board with no chat yet. */
export function buildAskHello(ctx: AskLearnerContext): AskHello {
  const name = ctx.name?.trim() || null;
  const last = ctx.recent.find((s) => s.trim().length > 0)?.trim() ?? null;
  const knows = ctx.memory.length > 0;

  let greeting: string;
  if (last) {
    const welcome = name ? `Welcome back, ${name}!` : "Welcome back!";
    greeting = `${welcome} Last time you worked on ${skillInSentence(last)}.`;
  } else if (knows) {
    const welcome = name ? `Welcome back, ${name}!` : "Welcome back!";
    greeting = `${welcome} I remember how you like to learn. What are we working on today?`;
  } else {
    greeting = `${name ? `Hi ${name}!` : "Hi!"} I'm your tutor. Ask me anything, or write a problem on the board.`;
  }
  // the name is at most a word of 30 letters and a skill's name a few words: never, but the contract says so
  if (greeting.length > GREETING_MAX) greeting = greeting.slice(0, GREETING_MAX);

  const quiz = quizChip(ctx);
  const candidates = last
    ? [HELLO_CHIPS.moreLikeLast, HELLO_CHIPS.explain(skillInSentence(last)), quiz, HELLO_CHIPS.homework]
    : [quiz, HELLO_CHIPS.homework, HELLO_CHIPS.whatCanYouDo, HELLO_CHIPS.funFact];
  return AskHelloSchema.parse({ greeting, chips: pickChips(candidates) });
}
