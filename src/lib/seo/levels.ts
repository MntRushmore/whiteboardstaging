/**
 * The math library's grade and course pages and its hub (`/math`, `/math/3rd-grade`,
 * `/math/algebra-1`; docs/SEO.md): every word, and every list the pages show, in one place.
 *
 * What a page lists comes from the app itself, so it cannot drift from what Agathon teaches:
 * - a grade's skills are its path (`GRADE_PATHS`, in teaching order), a course's are its topics
 *   (`courseTopicIds`), and only skills a student can open today are listed (`isTopicId`), as the
 *   landing page's picker does;
 * - each skill's name and one-line example are the app's (`pathSkillName`, `pathSkillBlurb`), in US
 *   English (`usEnglish`);
 * - each skill's sample problem is the app's own generator's (`drawProblems`, a fixed seed), written
 *   by the board's hand on the page and given here as plain Unicode text (`mathText`), so a crawler
 *   reads the same problem a parent sees;
 * - the board on each page is the grade's or course's first starter problem and its first step,
 *   which the app's tests hold to a check mark from the tutor (src/lib/onboarding/courses.ts).
 *
 * The rest is hand-written per level: the intro, the title and description, and the questions
 * parents ask. Those follow docs/SEO.md's rules for words: true today, no ratings, counts, outcome
 * promises or "best"; no price or trial length (the page takes those from `planWords`); US English;
 * the paths loosely follow the US Common Core, and nothing here claims official alignment.
 *
 * Pure: no React, no network. Unit-tested in `__tests__/levels.test.ts`.
 */
import { DAILY_GOAL } from "@/lib/daily/contracts";
import { drawProblems } from "@/lib/learning/generators";
import { GRADES, gradeOfSkill, gradePath as gradeSkills, type Grade } from "@/lib/learning/grades";
import { courseTopicIds, isTopicId, type TopicId } from "@/lib/learning/topics";
import { siteOrigin } from "@/lib/landing/links";
import { usEnglish } from "@/lib/landing/practice";
import { COURSES, GRADE_STARTERS, STARTER_PROBLEMS } from "@/lib/onboarding/courses";
import { pathSkillBlurb, pathSkillName } from "@/lib/path/pathView";
import { LEVELS, MATH_PATH, levelPath, skillBySlug, skillPath, type Level, type SeoCourseId } from "./routes";

// ------------------------------------------------------------------ math as text

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ",
};
const SUBSCRIPT: Readonly<Record<string, string>> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "−": "₋", "(": "₍", ")": "₎", x: "ₓ",
};
/** Commands that are one symbol. */
const SYMBOLS: Readonly<Record<string, string>> = {
  times: "×", div: "÷", cdot: "·", pm: "±", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", lt: "<", gt: ">",
  to: "→", rightarrow: "→", approx: "≈", pi: "π", theta: "θ", alpha: "α", beta: "β", infty: "∞", circ: "°", degree: "°",
  square: "□", ldots: "…", cdots: "⋯", "%": "%", $: "$", "{": "{", "}": "}", "|": "|", ",": " ", ";": " ", ":": " ", " ": " ",
  "!": "", quad: " ", qquad: " ",
};
/** Symbols that are a quantity: a letter after one is a product (`\pi r^{2}` is πr²). */
const ATOMS = new Set(["pi", "theta", "alpha", "beta", "infty"]);
const FUNCTIONS = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "log", "ln", "exp", "lim", "max", "min"]);
/** Commands whose argument is plain words (units). */
const WORDS = new Set(["mathrm", "text", "textrm", "operatorname", "mathit", "mathbf"]);

/**
 * A line of the board's LaTeX as plain Unicode a parent (and a crawler) reads: `46 × 7`,
 * `3/4 + 1/6`, `x² − 5x + 6 = 0`, `√(x + 6) = 2`, `log₂ 64`, `∫₁⁴ 4x³ dx`. Covers what the app's
 * generators and starters write (tested on every topic); anything else keeps its command's name.
 */
export function mathText(latex: string): string {
  const src = latex;
  let i = 0;

  const isLetter = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);
  const nextSolid = (): string | undefined => {
    let j = i;
    while (src[j] === " ") j++;
    return src[j];
  };

  /** a command's name, after its backslash: a run of letters, or one other character */
  function name(): string {
    if (!isLetter(src[i])) return src[i++] ?? "";
    const start = i;
    while (isLetter(src[i])) i++;
    return src.slice(start, i);
  }

  /** one argument: a `{…}` group, a command, or one character */
  function arg(): string {
    while (src[i] === " ") i++;
    if (src[i] === "{") {
      i++;
      const out = seq("}");
      i++;
      return out.replace(/\s+/g, " ").trim();
    }
    if (src[i] === "\\") {
      i++;
      return seq1(name());
    }
    return char(src[i++] ?? "");
  }

  const char = (c: string) => (c === "-" ? "−" : c);

  /** `text` as superscript or subscript characters, or `^(…)` / `_(…)` where one has none */
  function script(text: string, table: Readonly<Record<string, string>>, mark: string): string {
    const t = text.replace(/\s+/g, "");
    if (t === "°") return "°";
    if (t && [...t].every((c) => table[c])) return [...t].map((c) => table[c]).join("");
    return `${mark}(${text})`;
  }

  /** a fraction's top or bottom: a number or one letter as it is, anything else in parentheses */
  const part = (t: string) => (/^−?\d+(\.\d+)?$|^[A-Za-zπ]$/.test(t) ? t : `(${t})`);

  /** one command, with whatever arguments it takes */
  function seq1(cmd: string): string {
    if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
      const top = arg();
      const bottom = arg();
      if (top === "d" && /^d[a-z]$/.test(bottom)) return `d/${bottom} `;
      return `${part(top)}/${part(bottom)}`;
    }
    if (cmd === "sqrt") {
      let index = "";
      if (src[i] === "[") {
        const close = src.indexOf("]", i);
        index = mathText(src.slice(i + 1, close));
        i = close + 1;
      }
      const body = arg();
      const root = index === "3" ? "∛" : index === "4" ? "∜" : index ? `${script(index, SUPERSCRIPT, "^")}√` : "√";
      return root + (/^[\dA-Za-z.π]+$/.test(body) ? body : `(${body})`);
    }
    if (cmd === "left" || cmd === "right") {
      while (src[i] === " ") i++;
      if (src[i] === "\\") {
        i++;
        return SYMBOLS[name()] ?? "";
      }
      const d = src[i++] ?? "";
      return d === "." ? "" : d;
    }
    if (WORDS.has(cmd)) return arg();
    if (cmd === "int") return "∫";
    if (FUNCTIONS.has(cmd)) {
      // `\lim_{x \to 1}`: "lim x→1"
      if (cmd === "lim" && src[i] === "_") {
        i++;
        return `lim ${arg().replace(/\s+/g, "")}`;
      }
      return cmd;
    }
    if (cmd in SYMBOLS) {
      // `\pi r^{2}`: πr²; `2\pi \cdot 4` keeps its space before the dot
      if (ATOMS.has(cmd) && /[A-Za-z0-9]/.test(nextSolid() ?? "")) while (src[i] === " ") i++;
      return SYMBOLS[cmd];
    }
    return cmd;
  }

  /** everything up to `end` (or the end of the line) */
  function seq(end?: string): string {
    let out = "";
    while (i < src.length && src[i] !== end) {
      const c = src[i];
      if (c === "\\") {
        i++;
        const cmd = name();
        let piece = seq1(cmd);
        if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
          // a mixed number: 6 5/6
          if (/\d$/.test(out)) out += " ";
          // a fraction times what follows it: (1/2)(6 + 10), (2/3)x ("d/dx " ends in its space)
          const next = nextSolid();
          if (!piece.endsWith(" ") && (next === "(" || isLetter(next))) piece = `(${piece})`;
        }
        out += piece;
      } else if (c === "^" || c === "_") {
        i++;
        const t = arg();
        out += c === "^" ? script(t, SUPERSCRIPT, "^") : script(t, SUBSCRIPT, "_");
      } else if (c === "{") {
        i++;
        out += seq("}");
        i++;
      } else {
        out += char(c);
        i++;
      }
    }
    return out;
  }

  return seq().replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------------ sample problems

/**
 * The seed every sample problem is drawn with, so a page shows the same problem on every build. A
 * few skills use another seed, where the first draw is less typical of the skill than a later one
 * (a three-number sum for Adding to 10, a division under Multiplying decimals).
 */
export const SAMPLE_SEED = 1;
const SAMPLE_SEEDS: Readonly<Partial<Record<TopicId, number>>> = {
  add_within_10: 4,
  add_within_20: 2,
  subtract_within_20: 5,
  add_tens: 3,
  add_within_100: 5,
  subtract_within_100: 6,
  times_tables: 3,
  multiply_multi_digit: 4,
  negative_numbers: 8,
  multiply_fractions: 5,
  divide_fractions: 7,
  decimals_add_subtract: 6,
  decimals_multiply: 7,
  percents: 2,
  simplify_expressions: 4,
  one_step_equations: 5,
  multi_step_equations: 2,
  inequalities: 4,
  polynomials: 2,
  factoring: 4,
  quadratic_equations: 3,
  complex_numbers: 6,
  logarithms: 2,
  trig_equations: 4,
  limits: 2,
};

/** A problem: its lines as the board's LaTeX (for `HandMath`) and as plain text (for the page's words). */
export interface SampleProblem {
  latex: string[];
  text: string[];
}

export function sampleProblem(id: TopicId): SampleProblem {
  const latex = drawProblems(id, 1, SAMPLE_SEEDS[id] ?? SAMPLE_SEED)[0] ?? [];
  return { latex, text: latex.map(mathText) };
}

// ------------------------------------------------------------------ a level's skills

export interface LevelSkill {
  id: TopicId;
  /** "Times tables" */
  name: string;
  /** "Multiply facts like 6 × 7"; null when the app has none */
  blurb: string | null;
  /** the skill's page, `/math/times-tables` */
  href: string;
  problem: SampleProblem;
}

function skillOf(id: TopicId): LevelSkill {
  const blurb = pathSkillBlurb(id);
  return { id, name: usEnglish(pathSkillName(id)), blurb: blurb && usEnglish(blurb), href: skillPath(id), problem: sampleProblem(id) };
}

/** A level's skill ids in teaching order: a grade's path, a course's topics; only skills a student can open today. */
export function levelSkillIds(level: Level): TopicId[] {
  const ids: readonly string[] = level.kind === "grade" ? gradeSkills(level.grade) : courseTopicIds(level.course);
  return ids.filter(isTopicId);
}

export function levelSkills(level: Level): LevelSkill[] {
  return levelSkillIds(level).map(skillOf);
}

/** What a grade carries over from the grade below (its path's warm-up, `gradePath(grade, { warmUp })`); none for Kindergarten or a course. */
export function warmUpSkills(level: Level): LevelSkill[] {
  if (level.kind !== "grade" || level.grade === 0) return [];
  const own = new Set<string>(gradeSkills(level.grade));
  return gradeSkills(level.grade, { warmUp: true })
    .filter((id) => !own.has(id))
    .filter(isTopicId)
    .map(skillOf);
}

// ------------------------------------------------------------------ names and neighbors

/** "Precalculus and calculus" rather than the welcome's "Pre-calculus / Calculus": the words people search, and the page's address. */
const COURSE_NAMES: Readonly<Partial<Record<SeoCourseId, string>>> = { precalc_calc: "Precalculus and calculus" };

/** A level's name inside a sentence: "kindergarten" is lower case there ("about kindergarten math"). */
export function inSentence(name: string): string {
  return name === "Kindergarten" ? "kindergarten" : name;
}

/** "Kindergarten", "3rd grade", "Algebra 1". */
export function levelName(level: Level): string {
  if (level.kind === "grade") return GRADES.find((g) => g.id === level.grade)?.label ?? level.slug;
  return COURSE_NAMES[level.course] ?? COURSES.find((c) => c.id === level.course)?.label ?? level.slug;
}

/** The grade below, and the grade or course after, in the library's order (8th grade leads to Algebra 1). */
export function levelNeighbors(level: Level): { prev: Level | null; next: Level | null } {
  const at = LEVELS.findIndex((l) => l.slug === level.slug);
  return { prev: LEVELS[at - 1] ?? null, next: LEVELS[at + 1] ?? null };
}

/**
 * The board on the page: the level's first starter problem and its first step, which the app's
 * tests hold to a check mark from the tutor (`courses.test.ts`). A one-step starter is one line
 * (`6 × 7 = 42`); otherwise the step is written under the problem, after `=` when the problem is not
 * an equation (`1/2 + 1/3`, then `= 3/6 + 2/6`).
 */
export interface BoardLine {
  latex: string;
  text: string;
  /** the tutor checked this line */
  checked: boolean;
}

export function levelBoard(level: Level): BoardLine[] {
  const starter = level.kind === "grade" ? GRADE_STARTERS[level.grade][0] : STARTER_PROBLEMS[level.course][0];
  const problem = starter.lines[0];
  const equation = problem.includes("=");
  const lines = starter.oneStep && !equation
    ? [{ latex: `${problem} = ${starter.firstStep}`, checked: true }]
    : [
        { latex: problem, checked: false },
        { latex: equation ? starter.firstStep : `= ${starter.firstStep}`, checked: true },
      ];
  return lines.map((l) => ({ ...l, text: mathText(l.latex) }));
}

// ------------------------------------------------------------------ the words

export interface FaqItem {
  q: string;
  a: string;
}

export interface LevelCopy {
  /** <title>, before the layout's " · Agathon": the search words first */
  title: string;
  /** 120–160 characters: what the reader gets on this page */
  description: string;
  /** the h1 */
  h1: string;
  /** what kids at this level work on, in the order the path teaches it */
  intro: string;
  /** the hub card's two or three headline skills */
  headline: TopicId[];
  /** questions parents ask about this level's math */
  faq: FaqItem[];
}

const GRADE_COPY: Readonly<Record<Grade, LevelCopy>> = {
  0: {
    title: "Kindergarten Math Practice: Adding to 10",
    description: "Kindergarten math practice: adding to 10 and taking away within 10, with a sample problem for each skill and answers to the questions parents ask.",
    h1: "Kindergarten math practice",
    intro:
      "Kindergarten math is mostly about the numbers up to 10: counting them, putting two groups together and taking some away. Agathon's kindergarten path starts with adding to 10, like 3 + 4, and then taking away within 10, like 7 − 2. Kids write each answer by hand, and the tutor checks it.",
    headline: ["add_within_10", "subtract_within_10"],
    faq: [
      {
        q: "What math should a kindergartner know?",
        a: "Kindergarten classes usually work on counting to 100, writing numbers to 20, and adding and taking away within 10. Agathon's kindergarten path practices the adding and the taking away.",
      },
      {
        q: "How can I help my kindergartner with adding?",
        a: "Use things they can hold, like blocks, snacks or fingers. Put 3 in one hand and 4 in the other, then count them all together. Once that's easy, have them start at the bigger number and count on.",
      },
      {
        q: "Does Agathon cover counting, shapes and telling time?",
        a: "Not yet. The path sticks to problems a kid can write out and the tutor can check line by line, so counting objects, shapes, clocks and coins aren't on it.",
      },
      {
        q: "What comes after kindergarten math?",
        a: "1st grade: adding and subtracting within 20, then adding tens, like 40 + 30.",
      },
    ],
  },
  1: {
    title: "1st Grade Math Practice: Facts to 20 & Adding Tens",
    description: "1st grade math practice: adding and subtracting within 20 and adding tens, in teaching order, with a sample problem for each skill and tips for parents.",
    h1: "1st grade math practice",
    intro:
      "1st grade is about fast facts and the first steps with tens. Agathon's 1st grade path goes from adding to 20, like 8 + 7, to subtracting to 20, like 15 − 8, and then adding tens, like 40 + 30. Making a 10 first, so 8 + 7 becomes 8 + 2 + 5, is the trick a lot of these facts lean on.",
    headline: ["add_within_20", "subtract_within_20", "add_tens"],
    faq: [
      {
        q: "What math should a 1st grader know?",
        a: "1st grade classes usually work on adding and subtracting within 20, tens and ones, and adding tens, like 40 + 30. Agathon's 1st grade path practices those number skills in that order.",
      },
      {
        q: "How can I help my 1st grader learn addition facts?",
        a: "Teach them to make a 10: for 8 + 7, move 2 from the 7 to the 8 to make 10, then add the 5 that's left. Doubles help too: if they know 6 + 6 = 12, then 6 + 7 is one more.",
      },
      {
        q: "Is it OK for my 1st grader to count on their fingers?",
        a: "Yes, fingers are a fine place to start. Short, regular practice helps the facts stick, and kids tend to need their fingers less as they do.",
      },
      {
        q: "What comes after 1st grade math?",
        a: "2nd grade: adding and subtracting 2-digit numbers, then 3-digit numbers.",
      },
    ],
  },
  2: {
    title: "2nd Grade Math Practice: Add & Subtract to 1,000",
    description: "2nd grade math practice: 2-digit and 3-digit adding and subtracting with regrouping, a sample problem for each skill, and tips for helping at home.",
    h1: "2nd grade math practice",
    intro:
      "2nd grade is about place value: tens and ones, then hundreds. Agathon's 2nd grade path starts with adding 2-digit numbers, like 47 + 38, then subtracting them, like 72 − 35, and ends with 3-digit adding and subtracting, like 386 + 247. This is the year kids learn to regroup, which used to be called carrying and borrowing.",
    headline: ["add_within_100", "subtract_within_100", "add_subtract_within_1000"],
    faq: [
      {
        q: "What math should a 2nd grader know?",
        a: "2nd grade classes usually work on adding and subtracting within 100, then within 1,000, using hundreds, tens and ones. Measuring, money and time are part of 2nd grade too, but they aren't on Agathon's path yet.",
      },
      {
        q: "What is regrouping?",
        a: "It's what used to be called carrying and borrowing. In 47 + 38, the ones make 15, so 10 of them become one more ten. In 72 − 35, one ten becomes 10 ones, so there are enough ones to take 5 away.",
      },
      {
        q: "How can I help my 2nd grader with 2-digit subtraction?",
        a: "Ask what each digit means before they start: in 72, the 7 means 7 tens. Then try taking it away in parts: 72 − 30 = 42, and 42 − 5 = 37.",
      },
      {
        q: "What comes after 2nd grade math?",
        a: "3rd grade: times tables, division facts and multiplying by tens, after making sure 3-digit adding and subtracting is solid.",
      },
    ],
  },
  3: {
    title: "3rd Grade Math Practice: Times Tables & Division",
    description: "3rd grade math practice: 3-digit adding and subtracting, times tables, division facts and multiplying by tens, with sample problems and parent tips.",
    h1: "3rd grade math practice",
    intro:
      "3rd grade is the year of multiplication. Agathon's 3rd grade path first makes sure 3-digit adding and subtracting is solid, then moves to times tables, like 6 × 7, division facts, like 42 ÷ 6, and multiplying by tens, like 4 × 60. Division comes right after the times tables because each division fact is a times table read backwards.",
    headline: ["times_tables", "division_facts", "multiply_by_tens"],
    faq: [
      {
        q: "What math should a 3rd grader know?",
        a: "3rd grade classes usually work on multiplication and division facts up to 10 × 10, adding and subtracting within 1,000, multiplying by tens, and the first fractions. Agathon's 3rd grade path covers the number skills; fractions start on its 4th grade path.",
      },
      {
        q: "How can I help my 3rd grader learn times tables?",
        a: "A few minutes most days tends to work better than one long session. Start with the 2s, 5s and 10s, then use facts they know to reach new ones: 6 × 7 is 5 × 7 plus one more 7, so 35 + 7 = 42.",
      },
      {
        q: "Why does division come right after times tables?",
        a: "Because 42 ÷ 6 asks what times 6 makes 42. A kid who knows 6 × 7 = 42 already knows 42 ÷ 6 = 7, so practicing the two side by side helps both.",
      },
      {
        q: "What comes after 3rd grade math?",
        a: "4th grade: 4-digit adding and subtracting, multiplying bigger numbers, long division, then equivalent fractions and adding fractions.",
      },
    ],
  },
  4: {
    title: "4th Grade Math Practice: Long Division & Fractions",
    description: "4th grade math practice: multi-digit adding, multiplying bigger numbers, long division, equivalent fractions and adding fractions, with sample problems.",
    h1: "4th grade math practice",
    intro:
      "4th grade takes the times tables into bigger numbers and starts real work with fractions. Agathon's 4th grade path goes from 4-digit adding and subtracting to multiplying bigger numbers, like 46 × 7 and 34 × 26, and long division, like 864 ÷ 4. Then come equivalent fractions, like 6/8 = 3/4, and adding fractions with the same denominator.",
    headline: ["multiply_multi_digit", "long_division", "equivalent_fractions"],
    faq: [
      {
        q: "What math should a 4th grader know?",
        a: "4th grade classes usually work on adding and subtracting multi-digit numbers, multiplying larger numbers like 34 × 26, long division, equivalent fractions and adding fractions. Agathon's 4th grade path covers those in that order.",
      },
      {
        q: "How can I help my 4th grader with long division?",
        a: "Give them the steps as a short loop: divide, multiply, subtract, bring down, and repeat. Then have them check the answer by multiplying back (216 × 4 = 864), which shows whether it's right without you giving it away.",
      },
      {
        q: "What are equivalent fractions?",
        a: "Fractions that name the same amount with different numbers, like 3/4 and 6/8. Multiplying or dividing the top and the bottom by the same number gives an equivalent fraction.",
      },
      {
        q: "What comes after 4th grade math?",
        a: "5th grade: adding fractions with different denominators, multiplying fractions, decimals, and the order of operations.",
      },
    ],
  },
  5: {
    title: "5th Grade Math Practice: Fractions & Decimals",
    description: "5th grade math practice: adding unlike fractions, multiplying fractions, decimals and the order of operations, with a sample problem for each skill.",
    h1: "5th grade math practice",
    intro:
      "5th grade is fractions and decimals. Agathon's 5th grade path starts with adding fractions with different denominators, like 3/4 + 1/6, then multiplying fractions, adding and subtracting decimals, and multiplying decimals. It ends with the order of operations, which says what to work out first in a problem like 12 − 4 ÷ 2.",
    headline: ["add_fractions_unlike", "multiply_fractions", "decimals_add_subtract"],
    faq: [
      {
        q: "What math should a 5th grader know?",
        a: "5th grade classes usually work on adding, subtracting and multiplying fractions, decimals, the order of operations, and volume. Agathon's 5th grade path covers the fractions, adding and multiplying decimals, and the order of operations.",
      },
      {
        q: "How do you add fractions with different denominators?",
        a: "Rewrite both fractions with a common denominator first. For 3/4 + 1/6, both become twelfths: 9/12 + 2/12 = 11/12.",
      },
      {
        q: "How can I help my 5th grader with decimals?",
        a: "Have them line up the decimal points before adding or subtracting, and fill empty places with zeros: 3.45 + 2.80. A quick estimate first, about 3 + 3 = 6, helps them spot an answer that's off.",
      },
      {
        q: "What comes after 5th grade math?",
        a: "6th grade: dividing fractions, percents, negative numbers, powers and square roots, and the first equations.",
      },
    ],
  },
  6: {
    title: "6th Grade Math Practice: Percents & Equations",
    description: "6th grade math practice: dividing fractions, percents, negative numbers, powers and roots, and first equations, with a sample problem for each skill.",
    h1: "6th grade math practice",
    intro:
      "6th grade is where arithmetic starts turning into algebra. Agathon's 6th grade path finishes fractions with dividing them, like 3/4 ÷ 1/2, then moves to percents, negative numbers, and powers and square roots. It ends with the first equations, like x + 5 = 12, and simplifying expressions, like 3x + 2x.",
    headline: ["divide_fractions", "percents", "one_step_equations"],
    faq: [
      {
        q: "What math should a 6th grader know?",
        a: "6th grade classes usually work on ratios and percents, dividing fractions, negative numbers, exponents, and writing and solving one-step equations. Agathon's 6th grade path practices those, along with simplifying expressions.",
      },
      {
        q: "How do you divide fractions?",
        a: "Keep the first fraction, flip the second, and multiply: 3/4 ÷ 1/2 = 3/4 × 2/1 = 6/4, which is 1 1/2. It also helps to ask what it means: how many halves fit in three quarters?",
      },
      {
        q: "How can I help my 6th grader with negative numbers?",
        a: "Draw a number line: adding moves right and subtracting moves left. A thermometer works too: if it's −3 degrees and it warms up 8 degrees, it's 5 degrees.",
      },
      {
        q: "What comes after 6th grade math?",
        a: "7th grade: proportions, two-step equations, inequalities, and area, perimeter and circles.",
      },
    ],
  },
  7: {
    title: "7th Grade Math Practice: Proportions & Equations",
    description: "7th grade math practice: proportions, negative numbers, two-step equations, inequalities, area and circles, with a sample problem for each skill.",
    h1: "7th grade math practice",
    intro:
      "7th grade works with ratios, negative numbers and equations, plus some geometry. Agathon's 7th grade path starts with proportions, like x/4 = 9/12, and negative numbers, then two-step equations, like 2x + 3 = 11, and inequalities. It finishes with area and perimeter, and the circumference and area of circles.",
    headline: ["proportions", "two_step_equations", "circles"],
    faq: [
      {
        q: "What math should a 7th grader know?",
        a: "7th grade classes usually work on proportions and percents, adding, subtracting, multiplying and dividing negative numbers, two-step equations and inequalities, and the area and circumference of circles. Agathon's 7th grade path covers each of these.",
      },
      {
        q: "What is a two-step equation?",
        a: "An equation that takes two moves to solve. In 2x + 3 = 11, take 3 from both sides to get 2x = 8, then divide both sides by 2 to get x = 4.",
      },
      {
        q: "How can I help my 7th grader with proportions?",
        a: "Ask what the two ratios have in common. In x/4 = 9/12, 9/12 is the same as 3/4, so x = 3. Cross-multiplying, 12x = 36, gets the same answer.",
      },
      {
        q: "What comes after 7th grade math?",
        a: "8th grade: exponent rules, multi-step equations, the Pythagorean theorem, lines and slope, and systems of equations.",
      },
    ],
  },
  8: {
    title: "8th Grade Math Practice: Equations, Slope & More",
    description: "8th grade math practice: exponent rules, multi-step equations, the Pythagorean theorem, slope and systems of equations, with sample problems for each.",
    h1: "8th grade math practice",
    intro:
      "8th grade gets students ready for high school algebra. Agathon's 8th grade path covers exponent rules, multi-step equations with parentheses or x on both sides, the Pythagorean theorem, lines and slope (y = mx + b), and systems of two equations.",
    headline: ["multi_step_equations", "pythagorean", "linear_functions"],
    faq: [
      {
        q: "What math should an 8th grader know?",
        a: "8th grade classes usually work on linear equations and functions, slope, systems of two equations, exponent rules, square roots and the Pythagorean theorem. Agathon's 8th grade path practices those skills.",
      },
      {
        q: "Is 8th grade math the same as Algebra 1?",
        a: "Not always. Many 8th graders take a pre-algebra course, and some take Algebra 1 in 8th grade instead. If your child is in Algebra 1, Agathon's Algebra 1 course has its own list of topics.",
      },
      {
        q: "How can I help my 8th grader with the Pythagorean theorem?",
        a: "Have them find the hypotenuse first: it's the longest side, across from the right angle. Then a² + b² = c². With legs of 3 and 4, 9 + 16 = 25, so the hypotenuse is 5.",
      },
      {
        q: "What comes after 8th grade math?",
        a: "High school: usually Algebra 1, then Geometry and Algebra 2, and later precalculus and calculus. Agathon has a course for each.",
      },
    ],
  },
};

const COURSE_COPY: Readonly<Record<SeoCourseId, LevelCopy>> = {
  algebra1: {
    title: "Algebra 1 Practice: Equations, Slope & Factoring",
    description: "Algebra 1 practice: equations, inequalities, systems, exponents, factoring, quadratics, slope and functions, with a sample problem for each topic.",
    h1: "Algebra 1 practice",
    intro:
      "Algebra 1 is about solving equations and reading functions and graphs. Agathon's Algebra 1 topics start with the number skills algebra leans on, like negative numbers and the order of operations, then go from one-step to multi-step equations, inequalities and absolute value, systems, exponent rules, polynomials, factoring and quadratic equations, and finish with lines and slope and functions.",
    headline: ["multi_step_equations", "factoring", "linear_functions"],
    faq: [
      {
        q: "What's in Algebra 1?",
        a: "Solving equations and inequalities, systems of equations, exponents, polynomials and factoring, quadratic equations, and linear functions and their graphs. Agathon's Algebra 1 course starts with the number skills these lean on.",
      },
      {
        q: "How can I help my child with Algebra 1?",
        a: "Ask them to write every step, not just the answer, since slips in algebra often hide in a skipped step. Checking an answer by putting it back into the equation is a habit worth building.",
      },
      {
        q: "Does Agathon just solve the problem for them?",
        a: "Not unless they ask. The tutor checks each line they write, Help me gives a hint or writes the next step, and the full worked solution only appears if they choose Solve it.",
      },
      {
        q: "What comes after Algebra 1?",
        a: "Usually Geometry, then Algebra 2.",
      },
    ],
  },
  geometry: {
    title: "Geometry Practice: Angles, Triangles & Circles",
    description: "High school geometry practice: angles, triangle angles, the Pythagorean theorem, area and perimeter, circles, and distance and midpoint, with samples.",
    h1: "Geometry practice",
    intro:
      "Agathon's Geometry topics are the problems students work out step by step: angles on a line and around a point, the angles in a triangle, the Pythagorean theorem, area and perimeter, the circumference and area of circles, and the distance and midpoint of two points on a grid.",
    headline: ["angles", "pythagorean", "circles"],
    faq: [
      {
        q: "What's in high school Geometry?",
        a: "Angle relationships, triangles, the Pythagorean theorem, area and perimeter, circles, coordinate geometry and proofs. Agathon's Geometry practice covers the problems worked out line by line, from angle facts to distance and midpoint.",
      },
      {
        q: "How can I help my teen with geometry?",
        a: "Have them draw and label the figure before writing anything. Once it's labeled, many problems turn into an equation: angles on a straight line add up to 180°, so x + 65° = 180°.",
      },
      {
        q: "What is the distance formula?",
        a: "It finds the distance between two points: d = √((x₂ − x₁)² + (y₂ − y₁)²). It's the Pythagorean theorem in disguise: the two differences are the legs of a right triangle.",
      },
      {
        q: "What comes after Geometry?",
        a: "Usually Algebra 2.",
      },
    ],
  },
  algebra2: {
    title: "Algebra 2 Practice: Quadratics, Radicals & Logs",
    description: "Algebra 2 practice: quadratics, radicals, rational expressions, complex numbers, exponential equations and logarithms, with a sample problem for each.",
    h1: "Algebra 2 practice",
    intro:
      "Algebra 2 picks up where Algebra 1 ends and goes further. Agathon's Algebra 2 topics start with equations, inequalities and systems, then factoring and quadratic equations, before the new material: radicals, rational expressions, complex numbers, functions, exponential equations and logarithms.",
    headline: ["quadratic_equations", "radicals", "logarithms"],
    faq: [
      {
        q: "What's in Algebra 2?",
        a: "Quadratics and polynomials, radicals, rational expressions, complex numbers, and exponential and logarithmic functions. Agathon's Algebra 2 topics start with the equations, inequalities and systems from Algebra 1.",
      },
      {
        q: "What is a complex number?",
        a: "A number with a real part and an imaginary part, like 3 + 4i, where i² = −1. They come up when a quadratic equation has no real solutions.",
      },
      {
        q: "How do logarithms relate to exponents?",
        a: "A logarithm asks for the exponent: log₂ 32 = 5 because 2⁵ = 32. Rewriting a log as a power is usually the first step.",
      },
      {
        q: "What comes after Algebra 2?",
        a: "Precalculus, then calculus.",
      },
    ],
  },
  precalc_calc: {
    title: "Precalculus & Calculus Practice Problems",
    description: "Precalculus and calculus practice: functions, exponentials and logs, trig values and equations, limits, derivatives and integrals, with sample problems.",
    h1: "Precalculus and calculus practice",
    intro:
      "This course covers precalculus and the start of calculus. Agathon's topics go from functions, exponential equations and logarithms to the trig values of special angles and trig equations, then on to limits, derivatives and integrals.",
    headline: ["trig_values", "limits", "derivatives"],
    faq: [
      {
        q: "What's in precalculus?",
        a: "Functions, exponential and logarithmic equations, and trigonometry: the unit circle, the trig values of special angles, and trig equations. It sets up calculus.",
      },
      {
        q: "What calculus does Agathon cover?",
        a: "Limits, derivatives and integrals, as problems worked by hand: a limit like lim x→1 (x² + 3x), a derivative like d/dx (5e³ˣ), and an integral like ∫ (8x + 1) dx.",
      },
      {
        q: "How can I help my teen with trig?",
        a: "Have them learn the two special triangles, 45-45-90 and 30-60-90, instead of memorizing a table: sin 30° = 1/2 and tan 45° = 1 come straight from them.",
      },
    ],
  },
};

export function levelCopy(level: Level): LevelCopy {
  return level.kind === "grade" ? GRADE_COPY[level.grade] : COURSE_COPY[level.course];
}

/** The words every level page shares, for a level's name ("3rd grade", "Algebra 1"). */
export const LIBRARY_COPY = {
  /** the breadcrumb's first two steps */
  home: "Agathon",
  library: "Math",
  start: "See the path",
  boardLabel: "On the board",
  boardNote: "A right step gets the tutor's check mark.",
  pathEyebrow: "The path",
  pathTitle: (name: string, course: boolean) => (course ? `The ${name} topics` : `The ${inSentence(name)} path`),
  pathLede: (count: number, course: boolean) =>
    `${count} ${course ? (count === 1 ? "topic" : "topics") : count === 1 ? "skill" : "skills"}, in the order Agathon teaches them. Each one has its own page with a worked example and practice problems.`,
  sample: "Sample problem",
  open: "Worked example and practice",
  warmEyebrow: "Warm-up",
  warmTitle: (below: string) => `Carried over from ${inSentence(below)}`,
  warmBody: (below: string, name: string) =>
    `${name} builds on these ${inSentence(below)} skills. If one of them is still shaky, its page has a worked example and practice problems to start with.`,
  howEyebrow: "How it works",
  howTitle: "How practice works on Agathon",
  how: (name: string, course: boolean) => [
    {
      title: "A short set each day",
      body: `Today's practice is ${DAILY_GOAL} problems a day from the ${inSentence(name)} ${course ? "topics" : "path"}: the next skills, a weak spot or two, and one they've already mastered, to keep it fresh. Stars as they go, and a streak for every day they keep it up.`,
    },
    {
      title: "The tutor checks each line",
      body: "Kids write each step by hand, with a pencil, a finger or a mouse. A right step gets a blue check mark; a slip gets a circle and a nudge to try again, never a red X.",
    },
    {
      title: "Help me gives hints, not answers",
      body: "Stuck? Help me gives a Hint or writes the Next step beside theirs. The full worked solution only appears if they choose Solve it.",
    },
    {
      title: "Grown-ups see progress",
      body: "Stars show how strong each skill is, Progress shows their week, and a weekly report sums it up, so you know how it's going without sitting beside them.",
    },
  ],
  faqEyebrow: "Questions",
  faqTitle: (name: string, course: boolean) => (course ? `Questions parents ask about ${name}` : `Questions parents ask about ${inSentence(name)} math`),
  /** the neighbors' links */
  prev: "Before this",
  next: "After this",
  levelLink: (name: string, course: boolean) => (course ? name : `${name} math`),
  allLevels: "Every grade and course",
} as const;

// ------------------------------------------------------------------ the hub

export const HUB_COPY = {
  title: "Math Practice for Kids: Kindergarten to 8th Grade",
  description: "Math practice for kids from kindergarten to 8th grade, plus high school courses: each grade's skills in teaching order, with a sample problem for each one.",
  h1: "Math practice for kids, Kindergarten to 8th grade",
  lede: "Every grade's skills in the order Agathon teaches them, each with a sample problem. Pick a grade to see its whole path; every skill on it has a worked example and practice problems.",
  start: "See the grades",
  gradesEyebrow: "By grade",
  gradesTitle: "Pick a grade",
  coursesEyebrow: "High school",
  coursesTitle: "High school courses",
  coursesLede: "Older students pick the course they're taking.",
  cardLink: (name: string, course: boolean) => (course ? "See its topics" : `See ${inSentence(name)} math`),
  howEyebrow: "How it works",
  howTitle: "Like paper. But it writes back.",
} as const;

// ------------------------------------------------------------------ structured data (JSON-LD)

/** The site's origin for absolute URLs in structured data (NEXT_PUBLIC_SITE_URL, else production). */
export function siteUrl(path: string): string {
  return new URL(path, siteOrigin(process.env.NEXT_PUBLIC_SITE_URL)).toString();
}

type Thing = Record<string, unknown>;

function breadcrumbs(steps: { name: string; path: string }[]): Thing {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: steps.map((s, i) => ({ "@type": "ListItem", position: i + 1, name: s.name, item: siteUrl(s.path) })),
  };
}

/** A level page's breadcrumb: Agathon › Math › 3rd grade. */
export function levelCrumbs(level: Level): { name: string; path: string }[] {
  return [
    { name: LIBRARY_COPY.home, path: "/" },
    { name: LIBRARY_COPY.library, path: MATH_PATH },
    { name: levelName(level), path: levelPath(level) },
  ];
}

export const HUB_CRUMBS: readonly { name: string; path: string }[] = [
  { name: LIBRARY_COPY.home, path: "/" },
  { name: LIBRARY_COPY.library, path: MATH_PATH },
];

const WEBSITE = (): Thing => ({ "@type": "WebSite", name: "Agathon", url: siteUrl("/") });

/** A grade's or course's page: a CollectionPage with the ItemList of its skills, its breadcrumb, and its questions. */
export function levelJsonLd(level: Level): Thing[] {
  const copy = levelCopy(level);
  const url = siteUrl(levelPath(level));
  const skills = levelSkills(level);
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${url}#page`,
      url,
      name: copy.h1,
      description: copy.description,
      inLanguage: "en-US",
      isPartOf: WEBSITE(),
      educationalLevel: levelName(level),
      mainEntity: {
        "@type": "ItemList",
        name: LIBRARY_COPY.pathTitle(levelName(level), level.kind === "course"),
        itemListOrder: "https://schema.org/ItemListOrderAscending",
        numberOfItems: skills.length,
        itemListElement: skills.map((s, i) => ({ "@type": "ListItem", position: i + 1, name: s.name, url: siteUrl(s.href) })),
      },
    },
    breadcrumbs(levelCrumbs(level)),
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: copy.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];
}

/** The hub: a CollectionPage with the ItemList of every grade and course, and its breadcrumb. */
export function hubJsonLd(): Thing[] {
  const url = siteUrl(MATH_PATH);
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${url}#page`,
      url,
      name: HUB_COPY.h1,
      description: HUB_COPY.description,
      inLanguage: "en-US",
      isPartOf: WEBSITE(),
      mainEntity: {
        "@type": "ItemList",
        name: "Grades and courses",
        itemListOrder: "https://schema.org/ItemListOrderAscending",
        numberOfItems: LEVELS.length,
        itemListElement: LEVELS.map((l, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: LIBRARY_COPY.levelLink(levelName(l), l.kind === "course"),
          url: siteUrl(levelPath(l)),
        })),
      },
    },
    breadcrumbs([...HUB_CRUMBS]),
  ];
}

// ------------------------------------------------------------------ the share card

/** What a `/math/[slug]` page's share card says: its name, a line above it, and a sample problem. */
export interface CardWords {
  eyebrow: string;
  title: string;
  problem: string[];
}

/** The level's or the skill's card words; null for an unknown slug. */
export function cardWords(slug: string): CardWords | null {
  const level = LEVELS.find((l) => l.slug === slug);
  if (level) {
    const copy = levelCopy(level);
    const count = levelSkillIds(level).length;
    return {
      // "4 skills in teaching order", "17 topics in teaching order"
      eyebrow: `${count} ${level.kind === "course" ? "topics" : "skills"} in teaching order`,
      title: copy.h1,
      problem: sampleProblem(copy.headline[0]).latex,
    };
  }
  const id = skillBySlug(slug);
  if (!id) return null;
  return { eyebrow: skillHome(id), title: usEnglish(pathSkillName(id)), problem: sampleProblem(id).latex };
}

/** Where a skill is taught first: "4th grade math", or its first course ("Algebra 2"). */
export function skillHome(id: TopicId): string {
  const grade = gradeOfSkill(id);
  if (grade !== null) return `${GRADES.find((g) => g.id === grade)?.label ?? ""} math`;
  const course = LEVELS.find((l) => l.kind === "course" && levelSkillIds(l).includes(id));
  return course ? levelName(course) : "Math practice";
}
