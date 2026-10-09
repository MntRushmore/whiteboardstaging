/**
 * What the weekly report says a grown-up can DO next week: one sentence per skill, written for a
 * parent at the kitchen table rather than for the student at the board (the Progress page's
 * MISTAKES tips talk to the student). A parent who reads "Quiz one table at dinner" can act on it
 * tonight; "keep practising" helps nobody. Pure data and two lookups.
 *
 * Which sentence: when the week shows a mistake the student keeps making in that skill (twice or
 * more, LEARNING_LIMITS.recurringMistake), the mistake's own tip (MISTAKES), since that is the thing
 * to fix; otherwise the skill's line here, else its area's.
 */
import { LEARNING_LIMITS, MISTAKES, MISTAKE_KINDS, skillDef, type MistakeKind, type SkillArea } from "@/lib/learning/contracts";
import { isK8SkillId, K8_SKILLS } from "@/lib/learning/grades";

/** A skill's name as a parent reads it ("Times tables"), from SKILLS and K8_SKILLS; the id when unknown. */
export function skillName(id: string): string {
  if (isK8SkillId(id)) return K8_SKILLS[id].name;
  return skillDef(id)?.name ?? id;
}

/** One thing a grown-up can do with the kid for a skill, by skill id. */
export const SKILL_TIPS: Readonly<Record<string, string>> = {
  add_within_10: "Make 10 with fingers or snacks: ask how many more 6 needs to reach 10.",
  subtract_within_10: "Act it out with small things: start with 8, take 3 away, and count what's left together.",
  add_within_20: "Say doubles out loud together, like 7 + 7, then the near ones, like 7 + 8.",
  subtract_within_20: "Ask them to count up instead of back: 15 − 8 is “from 8, how many to 15?”",
  add_tens: "Count by tens together in the car or on a walk, starting from a different ten each time.",
  add_within_100: "Ask them to add the tens first and then the ones: 47 + 38 is 70, and 15 more.",
  subtract_within_100: "Ask them to check each answer by adding back: 37 + 35 should give 72 again.",
  add_subtract_within_1000: "Ask them to line up hundreds, tens and ones in columns before they start.",
  multi_digit_add_subtract: "Ask them to guess the answer roughly first, so a slip stands out at the end.",
  add_subtract: "Ask them to check each answer by doing the opposite sum.",
  times_tables: "Quiz one times table at dinner, out of order, like the 7s: three questions a night is plenty.",
  division_facts: "Turn each division into a times question: 42 ÷ 6 is “6 times what makes 42?”",
  multiply_by_tens: "Ask them to multiply without the zeros first, then put them back: 4 × 60 is 4 × 6, then a zero.",
  multiply_multi_digit: "Ask them to estimate first (46 × 7 is about 50 × 7) and compare at the end.",
  long_division: "Say the steps together: divide, multiply, subtract, bring down, then again.",
  multiply_divide: "Ask them to say the times fact behind each step out loud.",
  negative_numbers: "Use a thermometer or a number line to show what going below zero means.",
  order_of_operations: "Ask them to circle what comes first (brackets, then × and ÷) before working anything out.",
  equivalent_fractions: "Fold paper or cut a pizza: show that 2 of 4 pieces is the same as 1 of 2.",
  add_fractions_like: "Remind them the bottom number stays the same: only the top numbers are added.",
  add_fractions_unlike: "Ask them to find one bottom number both fractions can use before adding anything.",
  multiply_fractions: "Top times top, bottom times bottom, then simplify: ask them to say it as they go.",
  divide_fractions: "Keep, change, flip: keep the first fraction, change ÷ to ×, flip the second.",
  fractions: "Cook together and talk about the fractions in the recipe: half a cup, a quarter of a teaspoon.",
  decimals_add_subtract: "Ask them to line up the decimal points first, filling any gaps with zeros.",
  decimals_multiply: "Ask them to multiply as whole numbers, then count the decimal places back in.",
  percents: "Spot percents together when shopping: 10% off $40 is $4 off.",
  proportions: "Use a recipe: if 2 cups make 4 pancakes, how many cups make 10?",
  decimals_percents: "Spot prices and discounts together when shopping, and work them out in your heads.",
  powers_roots: "Ask what 5² means in words (5 times 5) before working it out.",
  one_step_equations: "Ask them what was done to x, and how to undo it.",
  two_step_equations: "Ask them to undo the adding or taking away first, then the multiplying.",
  simplify_expressions: "Ask them to underline the terms that match (same letter, same power) before combining.",
  word_problems: "Ask them to say the question in their own words before writing anything.",
};

/** For a skill with no line of its own: its area's. */
const AREA_TIPS: Readonly<Record<SkillArea, string>> = {
  arithmetic: "Ask them to estimate first, then check the answer against it.",
  algebra: "Ask them to write one small step per line, so each change is easy to check.",
  functions: "Ask them to sketch a quick graph to see whether an answer makes sense.",
  geometry: "Ask them to draw and label the picture before writing any numbers.",
  trig: "Ask them to sketch the triangle or the unit circle before working anything out.",
  calculus: "Ask them to name the rule they're using before each step.",
  science: "Ask them to write the units on every line.",
};

/** The line for a skill on its own (no mistake to fix). */
export function skillTip(id: string): string {
  return SKILL_TIPS[id] ?? AREA_TIPS[skillDef(id)?.area ?? "arithmetic"];
}

/**
 * The tip for next week's skill: the mistake made most often in it this week, when it was made
 * at least LEARNING_LIMITS.recurringMistake times, else the skill's own line.
 */
export function focusTip(id: string, mistakes: Partial<Record<MistakeKind, number>>): string {
  let top: MistakeKind | null = null;
  for (const kind of MISTAKE_KINDS) {
    const n = mistakes[kind] ?? 0;
    if (n >= LEARNING_LIMITS.recurringMistake && (top === null || n > (mistakes[top] ?? 0))) top = kind;
  }
  return top ? MISTAKES[top].tip : skillTip(id);
}
