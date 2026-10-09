/**
 * Files a problem under one skill (`SKILLS`, `contracts.ts`): what the Progress page groups the
 * student's work by, what mastery is measured on and what "practise my weak spots" aims at.
 *
 * Deterministic and pure, no engine, well under a millisecond: the tracker files every attempt the
 * moment it starts. It reads the problem the way the board has it — LaTeX lines as Mathpix and the
 * tutor write them (`\frac`, `^{}`, `\left(`, `^{\circ}`), one line for most problems and two or
 * three for a system — with a small tree reader (`mathTree.ts`) for the problem's FORM and plain
 * patterns for what the reader does not read (calculus, units, chemistry, words). A column sum
 * (`\begin{array}` over a rule, `parseStacked`) is read as the sum written in a line, and a number
 * with thousands separators (`5,032`, `4{,}386`) as one number.
 *
 * A problem practises the most specific thing it shows, so the rules are tried in this order and
 * the first that fits wins (`other` when none does):
 *
 *  1. chemistry — an arrow between formulas (`2H_2 + O_2 \to 2H_2O`)
 *  2. integrals (`\int`), limits (`\lim`), derivatives (`\frac{d}{dx}`, `f'(x)`, `\frac{dy}{dx}`)
 *  3. proofs — `\cong`, `\parallel`, `\perp`, `\sim`, or Given/Prove words with segments or angles
 *  4. `other` for statistics, sequences and series (a list of numbers, mean, `a_n`, `\sum`)
 *  5. word problems — at least three words of prose that are not instructions ("Solve"), units or
 *     connectors ("of", "to")
 *  6. complex numbers — an `i` that is the imaginary unit, or the root of a negative
 *  7. logarithms — `\log`, `\ln`
 *  8. trig — the law of sines or cosines is triangles; an equation whose trig argument holds the
 *     unknown is trig_equations; a trig ratio of a known angle equal to an unknown side is triangles
 *     in Geometry and trig_values elsewhere; anything else trig (a value, an identity) is trig_values
 *  9. systems — two or three equations sharing their unknowns (also `\begin{cases}`, or on one line
 *     with commas or "; "); not angle facts (`m\angle 1 = m\angle 2`)
 * 10. functions — `f(x) = …`, `P(t) = …`, `f(3)`, `f(g(x))`, `f \circ g`, `f^{-1}`, and `y = …` in x
 *     that is not a line
 * 11. exponential equations — the unknown in an exponent (`2^{x + 1} = 16`), or growth and decay
 *     (`P(1 + r)^{t}`, `500(0.8)^{3}`)
 * 12. coordinate geometry — the distance or midpoint formula, a transformation of a point
 *     (`R_{90^{\circ}}(2, 3)`), a segment cut in a ratio, a triangle's area from its corners, points
 *     with a distance or midpoint asked for; two points alone in Geometry (elsewhere they are a
 *     line, rule 19)
 * 13. absolute value — `|…|`
 * 14. Pythagorean theorem — `a^{2} + b^{2} = c^{2}` with numbers or side names
 * 15. circles — π with a radius, diameter or angle (a volume or surface with π is area_perimeter),
 *     a circle's equation, arcs
 * 16. area and perimeter — `A =`, `P =`, `V =`, `SA =` formulas and numbers, or those words
 * 17. angles and triangles — degrees or `\angle`: three or more angles summing to 180 is triangles,
 *     anything else angles; with no degree sign, a sum equal to 90, 180 or 360 is angles in Geometry
 *     (triangles for three or more terms to 180 in any course); polygon angle sums
 * 18. units — `\mathrm{km}`, `\mathrm{~m/s}`, unit words after numbers, "… to …" conversions
 * 19. lines and slope — `y = mx + b` and any linear equation in x and y, slope `m`, points
 * 20. radicals — a root holding the unknown, a root that is not whole (`\sqrt{50}`), `8^{\frac{2}{3}}`
 * 21. inequalities — `<`, `>`, `\le`, `\ge`
 * 22. exponent rules — one term of powers: the same base twice, a power of a power or a product, a
 *     zero, negative or fractional exponent (`x^{3} \cdot x^{4}`, `\frac{12x^{5}}{3x^{2}}`, `2^{-3}`)
 * 23. percents and proportions with an unknown — a percent equation (`25\% \times x = 20`), or two
 *     ratios equal with one unknown alone in one of the four places (`\frac{x}{4} = \frac{9}{12}`,
 *     `\frac{6}{x} = \frac{9}{12}`, `x : 4 = 9 : 12`)
 * 24. rational expressions — the unknown under a fraction bar (equations too)
 * 25. quadratic equations — an equation of degree 2 in one unknown (degree 3 or more is factoring)
 * 26. polynomials — brackets multiplied to degree 2 or more (`(x + 3)(x - 2)`, `(x + 3)^{2}`)
 * 27. factoring — a polynomial expression of degree 2 or more with nothing to collect
 * 28. simplifying expressions — any other expression with a letter (`4(2x - 1) - 3x`)
 * 29. one-, two- and multi-step equations — a linear equation in one unknown, by the inverse steps it
 *     takes: brackets, the unknown on both sides or twice on one side make it multi-step
 * 30. arithmetic (no letters), the K–8 path's skills by their numbers (`arithmeticSkill` below): a
 *     percent; then fractions (one alone is equivalent fractions, a sum by its bottom numbers, a
 *     product or a quotient); a negative number or answer; decimals (a sum, or × ÷); a power or
 *     root; + − with × ÷ or brackets (order of operations); × and ÷ of whole numbers (times tables
 *     to 12 × 12, tens, bigger numbers; division facts to 144 ÷ 12, else long division); + and − of
 *     whole numbers by the biggest number in the working (to 10, to 20, tens, to 100, to 1000,
 *     bigger). A mix no finer skill fits (`9 \times 4 \div 6`) keeps the coarse skill.
 *
 * The course breaks the ties only a course can: two points alone (a line, or distance and midpoint
 * in Geometry), a trig ratio of a known angle (a triangle's side in Geometry), and an angle sum
 * written without degree signs (`x + 40 = 90` is angles in Geometry, a one-step equation elsewhere).
 * `__tests__/skills.test.ts` holds the classifier to a labelled corpus of the repo's real problems.
 */
import type { SkillId } from "./contracts";
import { parseStacked } from "@/lib/live/engine/columnArithmetic";
import { evaluate, hasVariable, normalizeLatex, polyDegree, readLatex, someNode, termsOf, textWords, unwrap, variablesOf, allNodes, type Node, type Reading, type Relation } from "./mathTree";

// ------------------------------------------------------------------ the problem, read

interface Line {
  /** normalized LaTeX (`mathTree.normalizeLatex`), instruction words taken out */
  tex: string;
  /** the line's tree, null when the reader does not read it */
  reading: Reading | null;
}

interface Problem {
  lines: Line[];
  /** the line the problem is about: not a given (`r = 5`), a question (`x = ?`) or a template */
  main: Line;
  /** every line's LaTeX, joined */
  all: string;
  /** lowercase words of prose: \text words and words written bare */
  words: string[];
  course: string | null;
}

/** Words that carry no topic: instructions, connectors and question words. */
const STOP_WORDS = new Set(
  (
    "a an the of to in on at by for from is are was were be been and or if it its as with what which how many much find solve simplify " +
    "evaluate factor factorise factorize expand work out show write calculate compute then so that this these those each per your you there their " +
    "when where who do does did not no than into use using value values answer given let check verify graph sketch plot draw state give " +
    "true false whole number numbers equation equations expression expressions problem question step steps please now next here"
  ).split(" "),
);

/** Units, as words or abbreviations. */
const UNIT_WORDS = new Set(
  (
    "km cm mm kg mg ml mph kmh hr hrs min mins sec secs ft yd mi lb lbs oz kph ms mps " +
    "metre metres meter meters kilometre kilometres kilometer kilometers centimetre centimetres centimeter centimeters gram grams kilogram kilograms " +
    "litre litres liter liters second seconds minute minutes hour hours foot feet inch inches mile miles pound pounds newton newtons joule joules watt watts"
  ).split(" "),
);

const FUNCTION_WORDS = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "log", "ln", "lim", "exp", "max", "min", "mod"]);

/** Quantities of physics, written in words (`speed = \frac{distance}{time}`): science, filed under units. */
const PHYSICS_WORDS = new Set(["speed", "velocity", "acceleration", "force", "mass", "density", "pressure", "energy", "momentum", "weight", "power"]);

const STATS_WORDS = new Set(["mean", "median", "mode", "range", "average", "quartile", "quartiles", "iqr", "deviation", "summary", "variance", "med"]);

/** Words that name a topic: a sentence of them ("the area of a circle with radius 5") is that topic, not a word problem. */
const TOPIC_WORDS = new Set(
  (
    "area perimeter volume surface circle circles radius diameter circumference arc chord sector slope gradient intercept intercepts line distance " +
    "midpoint angle angles triangle triangles supplementary complementary hypotenuse percent percentage derivative differentiate integral integrate " +
    "limit logarithm imaginary complex fraction fractions decimal decimals square root"
  ).split(" "),
);

/** The \text pieces of a line whose words are only instructions or connectors ("Solve:", "or"), taken out. */
function withoutInstructions(tex: string): string {
  return tex.replace(/\\(?:text|textbf|textit|textrm|mbox)\s*\{([^{}]*)\}/g, (whole, body: string) => {
    const words = body.toLowerCase().match(/[a-z]+/g) ?? [];
    return words.every((w) => STOP_WORDS.has(w)) && !/\d/.test(body) ? " " : whole;
  });
}

/** Words written bare (a typed or misread sentence), not single letters, products of letters, or function names. */
function bareWords(tex: string): string[] {
  const stripped = tex.replace(/\\(?:text|textbf|textit|textrm|mbox|mathrm|operatorname)\s*\{[^{}]*\}/g, " ").replace(/\\[A-Za-z]+/g, " ");
  return (stripped.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => /[aeiouAEIOU]/.test(w) && /^[A-Za-z][a-z]+$/.test(w));
}

/** A top-level split of `s` at any of `chars` (outside braces and brackets). */
function splitTop(s: string, chars: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && chars.includes(c) && s[i - 1] !== "\\") {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** A thousands separator as written by hand or read by Mathpix: `,`, `{,}`, or a thin space `\,`. */
const GROUP_SEP = String.raw`(?:\{,\}|\\,|,)`;
/** A whole number written in groups of three (`5,032`, `4{,}386`, `1,250,000`), not part of a decimal or a longer list. */
const GROUPED = new RegExp(String.raw`(?<![\d.,])\d{1,3}(?:${GROUP_SEP}\d{3})+(?!\d|${GROUP_SEP}\d)`, "g");

/**
 * Thousands separators taken out, so `5,032 - 687` is one number take away another (4th-grade work)
 * and not the list `5`, `032 - 687`. Only a separator before exactly three digits goes: a list
 * (`2, 4, 6`, `10,200,30`) stays a list, and one number alone in brackets with a plain comma
 * (`(1,250)`) stays a point, as `(1, 250)` is.
 */
function withoutGrouping(line: string): string {
  return line.replace(GROUPED, (num: string, at: number, s: string) => {
    if (/^\d+,\d{3}$/.test(num) && /\(\s*-?\s*$/.test(s.slice(0, at)) && /^\s*\)/.test(s.slice(at + num.length))) return num;
    return num.replace(new RegExp(GROUP_SEP, "g"), "");
  });
}

/**
 * The problem's lines as separate equations: an environment (`\begin{cases}`) split at `\\`, a
 * system written on one line split at "; " or commas, a leading label ("1)") dropped. A column sum
 * (`\begin{array}{r} 52 \\ -17 \\ \hline 35 \end{array}`, as Mathpix reads 2nd–4th graders' stacked
 * adding, taking away and multiplying, `parseStacked`) is the sum it is, written in a line without
 * the answer under the rule (`52 - 17`): its rows are not separate lines, and a `-17` row is not a
 * negative number.
 */
function splitLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = (raw ?? "").trim().replace(/^\(?\d{1,2}[.)]\s+(?=\S)/, "");
    if (!line) continue;
    const stack = parseStacked(line);
    if (stack) {
      out.push(stack.operands.join(stack.op === "×" ? " \\times " : ` ${stack.op} `));
      continue;
    }
    const env = /\\begin\s*\{(?:cases|array|aligned|align\*?|gathered|matrix)\}(?:\s*\{[^{}]*\})?([\s\S]*?)\\end\s*\{[a-z*]+\}/.exec(line);
    if (env && !/=/.test(line.slice(0, env.index))) {
      out.push(...env[1].split(/\\\\/).map((l) => l.replace(/&/g, " ").trim()).filter(Boolean));
      continue;
    }
    const semi = splitTop(line, ";").map((p) => p.trim()).filter(Boolean);
    if (semi.length > 1) {
      out.push(...semi);
      continue;
    }
    const commas = splitTop(line, ",").map((p) => p.trim());
    if (commas.length > 1 && commas.every((p) => /=/.test(p) && /[a-z]/.test(p.replace(/\\[A-Za-z]+/g, "")) && !/[<>]|\\[lg]e/.test(p))) {
      out.push(...commas);
      continue;
    }
    out.push(line);
  }
  return out;
}

const GIVEN = /^\s*(?:[A-Za-z]|\\[a-z]+|[A-Z]{2})(?:_\{?\w+\}?)?\s*=\s*-?\s*(?:\d+(?:\.\d+)?|\\frac\s*\{\d+\}\s*\{\d+\}|\d*\\pi)\s*(?:\^\s*\{?\s*\\circ\s*\}?|\\mathrm\s*\{[^{}]*\})?\s*$/;
const QUESTION = /^\s*(?:[A-Za-z]{1,3}|\\[a-z]+|\([a-z]\s*,\s*[a-z]\))(?:_\{[^{}]*\}|_\w)?\s*=\s*\??\s*$|^\s*\\text\s*\{[^{}]*\}\s*(?:=\s*\??)?\s*$|\?\s*$/;
/** A line of letters only, a formula's pattern rather than a problem: `Ax + By = C`, `y = mx + b`, `y = a(x - h)^{2} + k`. */
const TEMPLATE = /^\s*(?:Ax\s*\+\s*By\s*=\s*C|y\s*=\s*mx\s*\+\s*b|y\s*=\s*a\s*\(\s*x\s*-\s*h\s*\)\s*\^\s*\{?2\}?\s*\+\s*k|y\s*=\s*ax\s*\^\s*\{?2\}?\s*\+\s*bx\s*\+\s*c)\s*$/;

function readProblem(problemLatex: readonly string[], course: string | null): Problem | null {
  const texts = splitLines(problemLatex.map(withoutGrouping));
  if (texts.length === 0) return null;
  const words: string[] = [];
  const lines: Line[] = texts.map((raw) => {
    const bare = bareWords(raw).map((w) => w.toLowerCase());
    words.push(...textWords(raw).map((w) => w.toLowerCase()), ...bare);
    const tex = timesAsX(withoutInstructions(withoutBareInstructions(normalizeLatex(raw)))).trim();
    // a word the reader would take for a product of letters ("hello" is not h·e·l·l·o)
    const prose = bare.some((w) => !STOP_WORDS.has(w) && !FUNCTION_WORDS.has(w) && !UNIT_WORDS.has(w));
    return { tex, reading: prose ? null : readLatex(tex) };
  });
  const main = lines.find((l) => !GIVEN.test(l.tex) && !QUESTION.test(l.tex) && !TEMPLATE.test(l.tex)) ?? lines[0];
  return { lines, main, all: lines.map((l) => l.tex).join(" ; "), words, course: course ?? null };
}

/** Instruction words typed bare ("solve 2x + 3 = 11") taken out, and function names typed bare ("sin x") made commands. */
function withoutBareInstructions(tex: string): string {
  return tex
    .replace(/(?<![A-Za-z\\])(sin|cos|tan|sec|csc|cot|log|ln)(?![A-Za-z])/g, "\\$1 ")
    .replace(/(?<![A-Za-z\\])([A-Za-z]{3,})(?![A-Za-z])(\s*:)?/g, (w, word: string) => (STOP_WORDS.has(word.toLowerCase()) ? " " : w));
}

/** `7 x 8` typed by a young student is 7 × 8 when the line is nothing but numbers and x's between them. */
function timesAsX(tex: string): string {
  return /^\s*\d+(?:\.\d+)?(?:\s*[xX]\s*\d+(?:\.\d+)?)+\s*=?\s*$/.test(tex) ? tex.replace(/[xX]/g, "*") : tex;
}

// ------------------------------------------------------------------ small readings

function relationOf(line: Line): Relation | null {
  return line.reading && line.reading.items.length === 1 ? line.reading.items[0] : null;
}

/** The line's sides when it is one equation with something on both sides (`2x + 3 = 11`). */
function equationSides(line: Line): [Node, Node] | null {
  const r = relationOf(line);
  if (!r || r.ops.length !== 1 || r.ops[0] !== "=" || !r.sides[0] || !r.sides[1]) return null;
  return [r.sides[0], r.sides[1]];
}

/** The line as one expression: no relation, or a trailing `=` (`2(x + 4) - 3x =`). */
function expressionOf(line: Line): Node | null {
  const r = relationOf(line);
  if (!r) return null;
  if (r.ops.length === 0) return r.sides[0];
  if (r.ops.length === 1 && r.ops[0] === "=" && r.sides[0] && !r.sides[1]) return r.sides[0];
  return null;
}

/** Every node of every line's tree. */
function nodesOf(p: Problem): Node[] {
  const out: Node[] = [];
  for (const l of p.lines) for (const item of l.reading?.items ?? []) for (const s of item.sides) if (s) allNodes(s, out);
  return out;
}

function lettersOf(p: Problem): string[] {
  const out = new Set<string>();
  for (const l of p.lines) for (const item of l.reading?.items ?? []) for (const s of item.sides) for (const v of variablesOf(s)) out.add(v);
  return [...out];
}

function hasWord(p: Problem, ...words: string[]): boolean {
  return p.words.some((w) => words.includes(w));
}

const DEGREES = /\^\s*\{?\s*\\circ\s*\}?|\\angle|\\measuredangle/;
const POINT = /\(\s*-?\s*\d+(?:\.\d+)?\s*,\s*-?\s*\d+(?:\.\d+)?\s*\)/g;
const TRIG = /\\(?:sin|cos|tan|sec|csc|cot|arcsin|arccos|arctan)(?![A-Za-z])|(?<![A-Za-z\\])(?:sin|cos|tan)(?![A-Za-z])/;

function isValue(node: Node, value: number): boolean {
  return !hasVariable(node) && Math.abs(evaluate(node, {}) - value) < 1e-9;
}

// ------------------------------------------------------------------ the rules, in order

function chemistry(p: Problem): SkillId | null {
  const formulaSide = (s: string) => {
    const t = s
      .replace(/\((?:aq|s|l|g)\)/g, "")
      .replace(/\\(?:mathrm|text|rm)\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\(?:left|right|cdot)|[\s{}_^+\-\d()[\]]/g, "");
    return t.length > 0 && /^(?:[A-Z][a-z]?)+$/.test(t);
  };
  for (const l of p.lines) {
    if (/\\lim/.test(l.tex)) continue;
    const parts = l.tex.split(/\\(?:long)?rightarrow|\\to(?![A-Za-z])|->|\\rightleftharpoons|⟶|→/);
    if (parts.length === 2 && parts.every(formulaSide)) return "chemistry";
    // with an = when the formulas carry subscripts: 2H_2 + O_2 = 2H_2O
    const eq = l.tex.split("=");
    if (eq.length === 2 && /[A-Z][a-z]?_\s*\{?\d/.test(l.tex) && eq.every(formulaSide)) return "chemistry";
  }
  return null;
}

function calculus(p: Problem): SkillId | null {
  if (/\\(?:int|iint|oint)(?![A-Za-z])/.test(p.all)) return "integrals";
  if (/\\lim(?![A-Za-z])/.test(p.all)) return "limits";
  if (/\\frac\s*\{\s*d\s*(?:\^\s*\{?\d\}?)?\s*[A-Za-z]?\s*\}\s*\{\s*d\s*[A-Za-z]\s*(?:\^\s*\{?\d\}?)?\s*\}/.test(p.all)) return "derivatives";
  if (/(?<![A-Za-z\\])[fghy]\s*(?:'|\^\s*\{\s*\\prime\s*\}|\\prime)/.test(p.all)) return "derivatives";
  if (hasWord(p, "derivative", "differentiate", "integral", "integrate", "limit")) {
    return hasWord(p, "derivative", "differentiate") ? "derivatives" : hasWord(p, "limit") ? "limits" : "integrals";
  }
  return null;
}

function proofs(p: Problem): SkillId | null {
  // m_{\perp}, m_{\parallel}: the slope of a perpendicular or parallel line, not a statement
  if (/\\(?:cong|parallel|perp|sim|therefore)(?![A-Za-z])/.test(p.all.replace(/_\s*\{\s*\\(?:perp|parallel)\s*\}/g, ""))) return "proofs";
  if (/\\(?:overline|overrightarrow|angle|triangle)/.test(p.all) && hasWord(p, "prove", "given", "bisects", "bisect", "midpoint", "congruent", "parallel", "perpendicular")) return "proofs";
  if (hasWord(p, "prove", "proof")) return "proofs";
  return null;
}

function statistics(p: Problem): SkillId | null {
  if (/\\sum|\\bar\s*\{|\\ldots|\\dots|\\cdots|\bIQR\b|Q_\s*\{?[123]\}?|\\sigma\s*=|(?<![A-Za-z])a_\s*\{?(?:n|\d+)\}?|(?<![A-Za-z])S_\s*\{?\d+\}?\s*=/.test(p.all)) return "other";
  if (hasWord(p, ...STATS_WORDS)) return "other";
  // a list of three or more numbers
  for (const l of p.lines) {
    const items = splitTop(l.tex.replace(/^\(|\)$/g, ""), ",").map((s) => s.trim());
    if (items.length >= 3 && items.every((s) => /^-?\s*\d+(?:\.\d+)?$/.test(s))) return "other";
  }
  return null;
}

function wordProblems(p: Problem): SkillId | null {
  const content = p.words.filter((w) => !STOP_WORDS.has(w) && !UNIT_WORDS.has(w) && !FUNCTION_WORDS.has(w) && !TOPIC_WORDS.has(w) && !STATS_WORDS.has(w));
  return content.length >= 3 ? "word_problems" : null;
}

function complexNumbers(p: Problem): SkillId | null {
  if (/\\sqrt\s*\{\s*-/.test(p.all) || hasWord(p, "imaginary", "complex")) return "complex_numbers";
  const stripped = p.all.replace(/\\(?:text|mathrm|operatorname)\s*\{[^{}]*\}/g, " ").replace(/_\s*\{[^{}]*\}|_\s*\w/g, " ").replace(/\\[A-Za-z]+/g, " ");
  return /(?<![A-Za-z])i(?![A-Za-z])/.test(stripped) ? "complex_numbers" : null;
}

function logarithms(p: Problem): SkillId | null {
  return /\\(?:log|ln|lg)(?![A-Za-z])|(?<![A-Za-z\\])(?:log|ln)(?![A-Za-z])/.test(p.all) || hasWord(p, "logarithm", "logarithms") ? "logarithms" : null;
}

/** The text each trig function applies to: its bracket, or what follows up to an operator. */
function trigArguments(tex: string): string[] {
  const out: string[] = [];
  const re = /\\(?:sin|cos|tan|sec|csc|cot|arcsin|arccos|arctan)(?![A-Za-z])|(?<![A-Za-z\\])(?:sin|cos|tan)(?![A-Za-z])/g;
  for (let m = re.exec(tex); m; m = re.exec(tex)) {
    let i = m.index + m[0].length;
    // a power on the function (\sin^{2}, \sin^{-1})
    const pow = /^\s*\^\s*(?:\{[^{}]*\}|\S)/.exec(tex.slice(i));
    if (pow) i += pow[0].length;
    const rest = tex.slice(i).trimStart();
    if (rest.startsWith("(")) {
      let depth = 0;
      let j = 0;
      for (; j < rest.length; j++) {
        if (rest[j] === "(") depth++;
        else if (rest[j] === ")" && --depth === 0) break;
      }
      out.push(rest.slice(1, j));
    } else out.push(/^[^+\-=<>≤≥,;)]*/.exec(rest)![0].split(/\\(?:sin|cos|tan|sec|csc|cot)/)[0]);
  }
  return out;
}

function hasLetter(tex: string): boolean {
  return /[A-Za-z]/.test(
    tex
      .replace(/\\(?:alpha|beta|gamma|theta|phi|varphi|vartheta)(?![A-Za-z])/g, "v")
      .replace(/\\(?:circ|pi|frac|sqrt|left|right|cdot|degree)(?![A-Za-z])/g, "")
      .replace(/\\[A-Za-z]+/g, ""),
  );
}

/** An equation with something on both sides (not `\sin 30^{\circ} =`, not `x = ?`). */
function hasEquation(tex: string): boolean {
  const sides = splitTop(tex, "=");
  return sides.length >= 2 && sides.every((s) => s.trim() !== "" && s.trim() !== "?");
}

/** `f(x) = …`, `P(t) = …`: a function defined by name. */
const FUNCTION_DEFINITION = /^\s*[A-Za-z](?:_\{?\w+\}?)?\s*\(\s*[a-z]\s*\)\s*=/;

/** `y = …` or `f(x) = …` with the variable on the right: a function to graph or describe, not an equation to solve. */
function definesFunction(tex: string): boolean {
  const m = /^\s*(?:y|[A-Za-z]\s*\(\s*([a-z])\s*\))\s*=(.*)$/.exec(tex);
  return m !== null && new RegExp(`(?<![A-Za-z\\\\])${m[1] ?? "x"}(?![A-Za-z])`).test(m[2]);
}

function trig(p: Problem): SkillId | null {
  if (!TRIG.test(p.all)) return null;
  // the law of cosines (c^{2} = a^{2} + b^{2} - 2ab\cos C) and the law of sines (a / \sin A = b / \sin B)
  if (/-\s*2\s*(?:\(?\s*[A-Za-z\d.]+\s*\)?\s*){1,2}\\cos/.test(p.all)) return "triangles";
  if (hasEquation(p.main.tex) && /\\frac\s*\{[^{}]*\}\s*\{\s*\\(?:sin|cos)|\\frac\s*\{\s*\\(?:sin|cos)[^{}]*\}\s*\{[^{}]*\}\s*=/.test(p.main.tex) && (p.main.tex.match(/\\(?:sin|cos)/g) ?? []).length >= 2) return "triangles";
  const line = p.lines.find((l) => TRIG.test(l.tex)) ?? p.main;
  if (definesFunction(line.tex)) return "functions";
  if (hasEquation(line.tex.split(/,\s*(?=[^,]*(?:≤|≥|<|>|\\in))/)[0])) {
    const args = trigArguments(line.tex);
    if (args.some(hasLetter)) return "trig_equations";
    return p.course === "geometry" ? "triangles" : "trig_values";
  }
  return "trig_values";
}

function systems(p: Problem): SkillId | null {
  // m∠1 = 3x + 10, m∠2 = 5x - 30, m∠1 = m∠2: an angle fact, worked as one equation
  if (DEGREES.test(p.all)) return null;
  const equations = p.lines.filter((l) => {
    if (GIVEN.test(l.tex) || QUESTION.test(l.tex) || TEMPLATE.test(l.tex) || FUNCTION_DEFINITION.test(l.tex) || !hasEquation(l.tex) || /\\pi/.test(l.tex)) return false;
    return /[A-Za-z]/.test(l.tex.replace(/\\[A-Za-z]+/g, ""));
  });
  if (equations.length < 2 || equations.length !== p.lines.length) return null;
  const letters = new Set<string>();
  for (const l of equations) for (const v of l.reading ? l.reading.items.flatMap((i) => i.sides.flatMap((s) => variablesOf(s))) : (l.tex.match(/[a-z]/g) ?? [])) letters.add(v);
  return letters.size >= 2 ? "systems" : null;
}

function functions(p: Problem): SkillId | null {
  if (p.lines.some((l) => FUNCTION_DEFINITION.test(l.tex))) return "functions";
  if (/(?<![A-Za-z\\])[fgh]\s*(?:\^\s*\{\s*-\s*1\s*\}\s*)?\(/.test(p.all)) return "functions";
  if (/\\circ/.test(p.all.replace(/\^\s*\{?\s*\\circ\s*\}?/g, ""))) return "functions";
  // y = something in x that is not a line
  const eq = equationSides(p.main);
  if (eq && eq[0].t === "var" && eq[0].name === "y") {
    const vars = variablesOf(eq[1]);
    if (vars.includes("x") && vars.every((v) => v === "x") && polyDegree(eq[1]) !== 1) return "functions";
  }
  return null;
}

function exponential(p: Problem): SkillId | null {
  if (nodesOf(p).some((n) => n.t === "pow" && hasVariable(n.exp))) return "exponential_equations";
  if (/\^\s*\{[^{}]*[A-Za-z][^{}]*\}/.test(p.all.replace(/\^\s*\{\s*\\(?:circ|prime)\s*\}/g, "").replace(/\\[A-Za-z]+/g, ""))) return "exponential_equations";
  // growth and decay: P(1 + r)^{t}, 500(0.8)^{3}
  if (/\(\s*1\s*[+-]\s*(?:\\frac\s*\{\s*)?r/.test(p.all) || /\d\s*\(\s*\d*\.\d+\s*\)\s*\^/.test(p.all)) return "exponential_equations";
  return null;
}

function absoluteValue(p: Problem): SkillId | null {
  return /\|/.test(p.all) ? "absolute_value" : null;
}

function coordinateGeometry(p: Problem): SkillId | null {
  if (/\\sqrt\s*\{\s*\(\s*[^()]*-[^()]*\)\s*\^\s*\{?\s*2\s*\}?\s*\+\s*\(\s*[^()]*-[^()]*\)\s*\^\s*\{?\s*2/.test(p.all)) return "coordinate_geometry";
  if (/\(\s*\\frac\s*\{[^{}]*\+[^{}]*\}\s*\{\s*2\s*\}\s*,\s*\\frac\s*\{[^{}]*\+[^{}]*\}\s*\{\s*2\s*\}\s*\)/.test(p.all)) return "coordinate_geometry";
  if (/(?<![A-Za-z\\])[RrTD]_\s*(?:\{(?:[^{}]|\{[^{}]*\})*\}|\w)\s*\(|\(\s*x\s*,\s*y\s*\)\s*(?:\\to|\\rightarrow|->)/.test(p.all)) return "coordinate_geometry";
  // a segment cut in a ratio (AP : PB = 2 : 3), the area of a triangle from its corners (½|x₁(y₂ − y₃) + …|)
  if (/[A-Z]{2}\s*:\s*[A-Z]{2}/.test(p.all) || /\\frac\s*\{\s*1\s*\}\s*\{\s*2\s*\}\s*\|/.test(p.all)) return "coordinate_geometry";
  const points = p.all.match(POINT) ?? [];
  if (points.length === 0) return null;
  if (hasWord(p, "distance", "midpoint")) return "coordinate_geometry";
  const others = p.lines.filter((l) => l.tex.replace(POINT, "").replace(/[A-Z]\s*(?=,|$)|[,\s\\]/g, "").trim() !== "");
  // a slope, or a line's equation, is asked of the points: lines and slope (rule 19)
  if (others.some((l) => /^\s*m\b|^\s*m_|=\s*C\s*$|^\s*y\s*=/.test(l.tex)) || hasWord(p, "slope", "gradient", "line")) return null;
  if (others.some((l) => /^\s*(?:[A-Z]{2}|d|M)\s*=/.test(l.tex))) return "coordinate_geometry";
  if (others.length === 0 && points.length >= 2 && p.course === "geometry") return "coordinate_geometry";
  return null;
}

function pythagorean(p: Problem): SkillId | null {
  if (hasWord(p, "hypotenuse", "pythagoras", "pythagorean")) return "pythagorean";
  const T = String.raw`(?:\d+(?:\.\d+)?|[A-Za-z]{1,2}|\([^()]*\))`;
  const SQ = String.raw`${T}\^\{?2\}?`;
  const sum = new RegExp(String.raw`^(${T})\^\{?2\}?\+(${T})\^\{?2\}?=${SQ}$`);
  const rev = new RegExp(String.raw`^${SQ}=(${T})\^\{?2\}?\+(${T})\^\{?2\}?$`);
  for (const l of p.lines) {
    const flat = l.tex.replace(/\s+/g, "");
    const m = sum.exec(flat) ?? rev.exec(flat);
    // x^{2} + y^{2} = r^{2} is a circle
    if (m && !(/x/.test(m[1]) && /y/.test(m[2]))) return "pythagorean";
  }
  return null;
}

function circles(p: Problem): SkillId | null {
  if (/\\pi/.test(p.all)) {
    const solid = p.lines.some((l) => /^\s*(?:V|SA|LA|TSA|L)\s*=/.test(l.tex)) || /r\s*\^\s*\{?3/.test(p.all) || (/(?<![A-Za-z\\])h(?![A-Za-z])/.test(p.all) && /(?<![A-Za-z\\])r(?![A-Za-z])/.test(p.all));
    return solid ? "area_perimeter" : "circles";
  }
  if (/\(\s*x\s*[+-][^()]*\)\s*\^\s*\{?2\}?\s*\+\s*\(\s*y\s*[+-][^()]*\)\s*\^\s*\{?2/.test(p.all)) return "circles";
  if (/(?<![A-Za-z])x\s*\^\s*\{?2\}?/.test(p.main.tex) && /(?<![A-Za-z])y\s*\^\s*\{?2\}?/.test(p.main.tex) && hasEquation(p.main.tex)) return "circles";
  if (/\\(?:widehat|overarc|arc|frown)/.test(p.all)) return "circles";
  if (hasWord(p, "circle", "circles", "radius", "diameter", "circumference", "arc", "chord", "sector")) return "circles";
  return null;
}

function areaPerimeter(p: Problem): SkillId | null {
  if (p.lines.some((l) => /^\s*(?:A|P|V|SA|LA|TSA|L)\s*=\s*[^\s?]/.test(l.tex) && !GIVEN.test(l.tex))) return "area_perimeter";
  return hasWord(p, "area", "perimeter", "volume", "surface") ? "area_perimeter" : null;
}

/** The terms of a sum equal to `total` on the other side, all positive, or null. */
function sumTo(line: Line, totals: readonly number[]): { terms: number; total: number; letter: boolean } | null {
  const eq = equationSides(line);
  if (eq) {
    for (const [sum, other] of [eq, [eq[1], eq[0]] as [Node, Node]]) {
      const total = totals.find((t) => isValue(other, t));
      if (total === undefined) continue;
      const terms = termsOf(sum);
      if (terms.length >= 2 && terms.every((t) => !t.neg)) return { terms: terms.length, total, letter: hasVariable(sum) };
    }
    return null;
  }
  // read by hand when the tree is not there: x + 35^{\circ} + 75^{\circ} = 180^{\circ}
  const sides = splitTop(line.tex, "=");
  if (sides.length !== 2) return null;
  for (const [sum, other] of [sides, [sides[1], sides[0]]]) {
    const n = Number(other.replace(/\^\s*\{?\s*\\circ\s*\}?/g, "").trim());
    const total = totals.find((t) => t === n);
    if (total === undefined) continue;
    const plus = splitTop(sum, "+");
    if (plus.length >= 2 && !splitTop(sum, "-").slice(1).length) return { terms: plus.length, total, letter: /[A-Za-z]/.test(sum.replace(/\\(?:circ|angle)/g, "")) };
  }
  return null;
}

function anglesTriangles(p: Problem): SkillId | null {
  if (/\(\s*n\s*-\s*2\s*\)/.test(p.all) && /180/.test(p.all)) return "angles";
  if (/\\frac\s*\{\s*360/.test(p.all)) return "angles";
  const degrees = DEGREES.test(p.all);
  const s = sumTo(p.main, degrees || p.course === "geometry" ? [90, 180, 360] : [180]);
  if (s && s.total === 180 && s.terms >= 3) return "triangles";
  if (degrees) return /\\triangle/.test(p.all) || hasWord(p, "triangle") ? "triangles" : "angles";
  if (s && p.course === "geometry" && s.letter) return "angles";
  if (hasWord(p, "triangle", "triangles")) return "triangles";
  if (hasWord(p, "angle", "angles", "supplementary", "complementary")) return "angles";
  return null;
}

function units(p: Problem): SkillId | null {
  if (/\\mathrm\s*\{/.test(p.all)) return "units";
  if (p.words.some((w) => UNIT_WORDS.has(w) || PHYSICS_WORDS.has(w))) return "units";
  if (/\d\s*(?:km|cm|mm|kg|mg|mph|ml|mL|ft|min|hr|m\/s|km\/h)(?![A-Za-z])/.test(p.all.replace(/\\[A-Za-z]+/g, " "))) return "units";
  return null;
}

function linearFunctions(p: Problem): SkillId | null {
  if (hasWord(p, "slope", "gradient", "intercept", "intercepts")) return "linear_functions";
  if (p.lines.some((l) => /^\s*m(?:_\s*\{[^{}]*\})?\s*=/.test(l.tex) || TEMPLATE.test(l.tex))) return "linear_functions";
  if (/\\frac\s*\{\s*y_/.test(p.all)) return "linear_functions";
  if ((p.all.match(POINT) ?? []).length > 0) return "linear_functions";
  const eq = equationSides(p.main);
  if (eq) {
    const vars = new Set([...variablesOf(eq[0]), ...variablesOf(eq[1])]);
    if (vars.size === 2 && vars.has("x") && vars.has("y")) {
      const d0 = polyDegree(eq[0]);
      const d1 = polyDegree(eq[1]);
      if (d0 !== null && d1 !== null && d0 <= 1 && d1 <= 1) return "linear_functions";
    }
  }
  return null;
}

function radicals(p: Problem): SkillId | null {
  for (const n of nodesOf(p)) {
    if (n.t === "sqrt") {
      if (hasVariable(n.arg)) return "radicals";
      const v = evaluate(n, {});
      if (Number.isFinite(v) && Math.abs(v - Math.round(v)) > 1e-9) return "radicals";
    }
    if (n.t === "pow" && !hasVariable(n.base)) {
      const e = evaluate(n.exp, {});
      if (Number.isFinite(e) && !Number.isInteger(e)) return "radicals";
    }
  }
  // a line the reader did not read: a root with a letter under it (\pi and the like are not letters)
  const plain = p.all.replace(/\\(?:pi|circ|cdot|times|left|right)(?![A-Za-z])/g, " ");
  if (!p.lines.every((l) => l.reading) && /\\sqrt\s*(?:\[[^\]]*\])?\s*\{[^{}]*[A-Za-z]/.test(plain)) return "radicals";
  return null;
}

function inequalities(p: Problem): SkillId | null {
  return /[<>≤≥]/.test(p.all.replace(/->/g, "")) ? "inequalities" : null;
}

/** The key of a power's base, for "the same base twice": a letter, or a number. */
function baseKeys(node: Node, out: string[]): void {
  const n = unwrap(node);
  if (n.t === "var") out.push(n.name);
  else if (n.t === "pow") {
    const b = unwrap(n.base);
    if (b.t === "var") out.push(b.name);
    else if (b.t === "num") out.push(`#${b.v}`);
    else baseKeys(b, out);
  } else if (n.t === "mul") for (const f of n.factors) baseKeys(f.node, out);
  else if (n.t === "frac") {
    baseKeys(n.num, out);
    baseKeys(n.den, out);
  }
}

function exponentRules(p: Problem): SkillId | null {
  const expr = expressionOf(p.main);
  if (!expr) return null;
  const root = expr.t === "add" && expr.terms.length === 1 ? expr.terms[0].node : expr;
  if (root.t === "add") return null;
  const nodes = allNodes(root);
  // one term: no sums inside (a negative sign is fine)
  if (nodes.some((n) => n.t === "add" && n.terms.length > 1)) return null;
  const pows = nodes.filter((n): n is Extract<Node, { t: "pow" }> => n.t === "pow");
  if (pows.length === 0) return null;
  for (const pw of pows) {
    const e = evaluate(pw.exp, {});
    if (!Number.isFinite(e)) continue;
    if (e <= 0) return "exponent_rules";
    if (!Number.isInteger(e) && hasVariable(pw.base)) return "exponent_rules";
    const b = unwrap(pw.base);
    const inner = b.t === "add" && b.terms.length === 1 ? unwrap(b.terms[0].node) : b;
    if (inner.t === "mul" || inner.t === "pow" || inner.t === "frac") return "exponent_rules";
  }
  const keys: string[] = [];
  baseKeys(root, keys);
  return new Set(keys).size < keys.length ? "exponent_rules" : null;
}

/** A whole number written as one (`7`, `386`), not a decimal, a sign or a bracket; else null. */
function wholeOf(node: Node): number | null {
  const n = bare(node);
  return n.t === "num" && Number.isInteger(n.v) && n.v >= 0 && !n.raw.includes(".") ? n.v : null;
}

/** A sum of one unsigned term is that term (the reader wraps a lone number that way). */
function bare(node: Node): Node {
  return node.t === "add" && node.terms.length === 1 && !node.terms[0].neg ? node.terms[0].node : node;
}

/** One place of a ratio: a number, or a letter alone. */
function ratioPart(node: Node): "num" | "var" | null {
  const n = bare(node);
  if (n.t === "num") return "num";
  if (n.t === "var") return "var";
  return null;
}

/** A side that is one ratio, `\frac{a}{b}` or `a / b`: its two places, or null. */
function ratioOf(node: Node): [Node, Node] | null {
  const n = bare(node);
  if (n.t === "frac") return [n.num, n.den];
  if (n.t === "mul" && n.factors.length === 2 && !n.factors[0].div && n.factors[1].div) return [n.factors[0].node, n.factors[1].node];
  return null;
}

const NUMBER_OR_LETTER = String.raw`(?:\d+(?:\.\d+)?|[a-z])`;
const COLON_PROPORTION = new RegExp(String.raw`^${NUMBER_OR_LETTER}\s*:\s*${NUMBER_OR_LETTER}\s*=\s*${NUMBER_OR_LETTER}\s*:\s*${NUMBER_OR_LETTER}$`);

/**
 * Percents and proportions with an unknown (6th and 7th grade): a percent equation in one letter
 * (`25\% \times x = 20`, `x\% \times 80 = 20`), or two ratios equal with the one unknown alone in
 * one of the four places (`\frac{x}{4} = \frac{9}{12}`, `\frac{6}{x} = \frac{9}{12}`, `x : 4 = 9 : 12`).
 * Before rational expressions and the one-step equations, which would otherwise take them.
 */
function ratios(p: Problem): SkillId | null {
  const tex = p.main.tex;
  if (/%/.test(p.all) && lettersOf(p).length === 1 && hasEquation(tex)) return "percents";
  const flat = tex.replace(/\s+/g, " ").trim();
  if (COLON_PROPORTION.test(flat) && (flat.match(/[a-z]/g) ?? []).length === 1) return "proportions";
  const eq = equationSides(p.main);
  if (!eq) return null;
  const sides = eq.map(ratioOf);
  if (!sides[0] || !sides[1]) return null;
  const parts = [...sides[0], ...sides[1]].map(ratioPart);
  return parts.every((k) => k !== null) && parts.filter((k) => k === "var").length === 1 ? "proportions" : null;
}

function rationalExpressions(p: Problem): SkillId | null {
  for (const n of nodesOf(p)) {
    if (n.t === "frac" && hasVariable(n.den)) return "rational_expressions";
    if (n.t === "mul" && n.factors.some((f) => f.div && hasVariable(f.node))) return "rational_expressions";
  }
  return null;
}

function quadraticEquations(p: Problem): SkillId | null {
  const eq = equationSides(p.main);
  if (!eq) return null;
  const vars = new Set([...variablesOf(eq[0]), ...variablesOf(eq[1])]);
  if (vars.size !== 1) return null;
  const d0 = polyDegree(eq[0]);
  const d1 = polyDegree(eq[1]);
  if (d0 === null || d1 === null) return null;
  const d = Math.max(d0, d1);
  return d === 2 ? "quadratic_equations" : d > 2 ? "factoring" : null;
}

/** Brackets holding a letter, multiplied by something else with a letter, or raised to a power ≥ 2. */
function multipliesBrackets(node: Node): boolean {
  return someNode(node, (n) => {
    if (n.t === "mul") {
      const withLetter = n.factors.filter((f) => !f.div && hasVariable(f.node));
      return withLetter.length >= 2 && withLetter.some((f) => unwrap(f.node).t === "add" && f.node.t === "paren");
    }
    if (n.t === "pow" && n.base.t === "paren" && unwrap(n.base).t === "add" && hasVariable(n.base)) {
      const e = evaluate(n.exp, {});
      return Number.isInteger(e) && e >= 2;
    }
    return false;
  });
}

function polynomials(p: Problem): SkillId | null {
  const expr = expressionOf(p.main);
  if (!expr) return null;
  if (multipliesBrackets(expr)) return "polynomials";
  // (3x^{2} + 2x - 1) - (x^{2} - 4x + 5): polynomials added or taken away
  const brackets = termsOf(expr).filter((t) => t.node.t === "paren" && unwrap(t.node).t === "add");
  if (brackets.length >= 2 && brackets.some((t) => (polyDegree(t.node) ?? 0) >= 2)) return "polynomials";
  return null;
}

/** A term's letters and powers (`3x^{2}y` → `x^2y^1`), for "like terms". */
function monomialKey(node: Node): string | null {
  const powers = new Map<string, number>();
  const visit = (n: Node, k: number): boolean => {
    const u = unwrap(n);
    if (u.t === "num" || u.t === "const" || u.t === "mixed") return true;
    if (u.t === "var") {
      powers.set(u.name, (powers.get(u.name) ?? 0) + k);
      return true;
    }
    if (u.t === "pow") {
      const e = evaluate(u.exp, {});
      return Number.isInteger(e) && visit(u.base, k * e);
    }
    if (u.t === "mul") return u.factors.every((f) => visit(f.node, f.div ? -k : k));
    if (u.t === "frac") return visit(u.num, k) && visit(u.den, -k);
    if (u.t === "add" && u.terms.length === 1) return visit(u.terms[0].node, k);
    return false;
  };
  if (!visit(node, 1)) return null;
  return [...powers.entries()]
    .filter(([, e]) => e !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([v, e]) => `${v}^${e}`)
    .join("");
}

function factoring(p: Problem): SkillId | null {
  const expr = expressionOf(p.main);
  if (!expr || !hasVariable(expr)) return null;
  const d = polyDegree(expr);
  if (d === null || d < 2) return null;
  const terms = termsOf(expr);
  if (terms.length < 2) return null;
  if (someNode(expr, (n) => n.t === "paren" && hasVariable(n))) return null;
  const keys = terms.map((t) => monomialKey(t.node));
  if (keys.some((k) => k === null) || new Set(keys).size < keys.length) return null;
  return "factoring";
}

function simplifyExpressions(p: Problem): SkillId | null {
  const expr = expressionOf(p.main);
  return expr && hasVariable(expr) ? "simplify_expressions" : null;
}

/** The inverse steps a linear equation in one unknown takes (3 means "three or more"). */
function inverseSteps(left: Node, right: Node): number {
  const lv = hasVariable(left);
  const rv = hasVariable(right);
  if (lv && rv) return 3;
  const side = lv ? left : right;
  const terms = termsOf(side);
  const withLetter = terms.filter((t) => hasVariable(t.node));
  if (withLetter.length !== 1) return 3;
  const constants = terms.length - 1;
  let steps = constants === 0 ? 0 : constants === 1 ? 1 : 2;
  const term = withLetter[0];
  const node = term.node;
  if (node.t === "paren") return 3;
  if (node.t === "var") steps += term.neg ? 1 : 0;
  else if (node.t === "mul") {
    if (node.factors.some((f) => hasVariable(f.node) && f.node.t === "paren" && unwrap(f.node).t === "add")) return 3;
    steps += 1;
  } else if (node.t === "frac") {
    const num = unwrap(node.num);
    if (num.t === "add" && num.terms.length > 1) {
      if (num.terms.filter((t) => hasVariable(t.node)).length > 1) return 3;
      steps += 2;
    } else steps += 1;
  } else steps += 1;
  return steps;
}

function linearEquations(p: Problem): SkillId | null {
  const eq = equationSides(p.main);
  if (!eq) return null;
  const vars = new Set([...variablesOf(eq[0]), ...variablesOf(eq[1])]);
  if (vars.size !== 1) return null;
  const d0 = polyDegree(eq[0]);
  const d1 = polyDegree(eq[1]);
  if (d0 === null || d1 === null || Math.max(d0, d1) !== 1) return null;
  const steps = inverseSteps(eq[0], eq[1]);
  // `x = 4` has nothing left to undo: an answer (or a given), not a problem to practise
  if (steps === 0) return null;
  return steps === 1 ? "one_step_equations" : steps === 2 ? "two_step_equations" : "multi_step_equations";
}

// ------------------------------------------------------------------ arithmetic: the K–8 skills

/**
 * The working of a line of numbers: the expression itself, or the side of `=` with an operation in
 * it (`7 + 5 = 12` is about 7 + 5; `36 + 2 =` is 36 + 2). Null for a line the reader did not read.
 */
function workingOf(line: Line): Node | null {
  const r = relationOf(line);
  if (!r || r.ops.some((op) => op !== "=")) return null;
  const sides = r.sides.filter((s): s is Node => s !== null);
  return sides.find((s) => bare(s).t !== "num") ?? sides[0] ?? null;
}

/** A fraction of whole numbers (`\frac{3}{4}`), or a mixed number: its bottom number; else null. */
function denominatorOf(node: Node): number | null {
  const n = bare(node);
  if (n.t === "mixed") return n.den;
  if (n.t === "frac") {
    const num = wholeOf(n.num);
    const den = wholeOf(n.den);
    return num !== null && den !== null && den > 0 ? den : null;
  }
  return null;
}

/** `3/4` written with a slash: its bottom number; else null. */
function slashDenominator(node: Node): number | null {
  const n = bare(node);
  if (n.t !== "mul" || n.factors.length !== 2 || n.factors[0].div || !n.factors[1].div) return null;
  const den = wholeOf(n.factors[1].node);
  return wholeOf(n.factors[0].node) !== null && den !== null && den > 0 ? den : null;
}

/**
 * A fraction problem's skill: one fraction or mixed number alone is equivalent fractions (written
 * simpler, or as a fraction); a sum or difference is like or unlike by its bottom numbers (a whole
 * number counts as over 1); a product or quotient of fractions and whole numbers is multiplying or
 * dividing. A mix of those keeps the coarse `fractions`.
 */
function fractionSkill(work: Node | null): SkillId {
  if (!work) return "fractions";
  const n = bare(work);
  if (denominatorOf(n) !== null) return "equivalent_fractions";
  if (n.t === "add" && n.terms.length > 1) {
    const dens: number[] = [];
    for (const t of n.terms) {
      const d = denominatorOf(t.node) ?? slashDenominator(t.node) ?? (wholeOf(t.node) !== null ? 1 : null);
      if (d === null) return "fractions";
      dens.push(d);
    }
    return new Set(dens).size === 1 ? "add_fractions_like" : "add_fractions_unlike";
  }
  if (n.t === "mul" && n.factors.length > 1) {
    if (!n.factors.every((f) => denominatorOf(f.node) !== null || wholeOf(f.node) !== null)) return "fractions";
    return n.factors.some((f) => f.div) ? "divide_fractions" : "multiply_fractions";
  }
  return "fractions";
}

/** A number as written (`3.45`, `7`), not negative; else null. */
function numberOf(node: Node): number | null {
  const n = bare(node);
  return n.t === "num" && n.v >= 0 ? n.v : null;
}

/** Decimals: a sum or difference of numbers, or × and ÷ of numbers (the point moving, `5.4 \times 0.1`, too). */
function decimalSkill(work: Node | null): SkillId {
  const n = work ? bare(work) : null;
  if (n?.t === "add" && n.terms.length > 1 && n.terms.every((t) => numberOf(t.node) !== null)) return "decimals_add_subtract";
  if (n?.t === "mul" && n.factors.length > 1 && n.factors.every((f) => numberOf(f.node) !== null)) return "decimals_multiply";
  return "decimals_percents";
}

/** A whole number without its trailing zeros: 60 → 6, 400 → 4. */
function withoutZeros(n: number): number {
  let v = n;
  while (v >= 10 && v % 10 === 0) v /= 10;
  return v;
}

const isPowerOfTen = (n: number) => n === 10 || n === 100 || n === 1000 || n === 10_000;

/**
 * × and ÷ of whole numbers. A product: times tables when every number is 12 or less, multiplying by
 * tens when only their trailing zeros make them bigger (`4 \times 60`, `30 \times 50`), else bigger
 * numbers. A quotient `a ÷ b`: a division fact when it comes out whole with b and the answer 12 or
 * less, else long division; a whole number over a power of ten that does not come out whole is the
 * point moving (`68 \div 1000`, decimals); with a slash it is a fraction (`68 / 1000`, as
 * `\frac{68}{1000}`). A mix of × and ÷ keeps the coarse `multiply_divide`.
 */
function productSkill(work: Node | null, tex: string): SkillId {
  const n = work ? bare(work) : null;
  if (n?.t !== "mul" || n.factors.length < 2) return "multiply_divide";
  const nums = n.factors.map((f) => wholeOf(f.node));
  if (nums.some((v) => v === null)) return "multiply_divide";
  const values = nums as number[];
  if (n.factors.every((f) => !f.div)) {
    if (values.every((v) => v <= 12)) return "times_tables";
    if (values.every((v) => withoutZeros(v) <= 12)) return "multiply_by_tens";
    return "multiply_multi_digit";
  }
  if (n.factors.length === 2 && n.factors[1].div) {
    const [a, b] = values;
    if (b === 0) return "multiply_divide";
    if (a % b === 0) return b <= 12 && a / b <= 12 ? "division_facts" : "long_division";
    if (/\//.test(tex) && !/\\div/.test(tex)) return "equivalent_fractions";
    return isPowerOfTen(b) ? "decimals_multiply" : "long_division";
  }
  return "multiply_divide";
}

/**
 * + and − of whole numbers, by the biggest number in the working (what is written, every running
 * total and the answer): to 10, to 20 (adding, or taking away when there is a minus), tens (every
 * number taken away a multiple of 10 and at most one number added that is not: `40 + 30`,
 * `34 + 20`, `56 - 30`), to 100, to 1000, then bigger. A running total below zero keeps the coarse
 * `add_subtract`.
 */
function sumSkill(work: Node | null): SkillId {
  const n = work ? bare(work) : null;
  if (n?.t !== "add" || n.terms.length < 2 || n.terms[0].neg) return "add_subtract";
  const values = n.terms.map((t) => wholeOf(t.node));
  if (values.some((v) => v === null)) return "add_subtract";
  let running = 0;
  let biggest = 0;
  let lowest = 0;
  n.terms.forEach((t, i) => {
    const v = values[i]!;
    running += t.neg ? -v : v;
    biggest = Math.max(biggest, v, running);
    lowest = Math.min(lowest, running);
  });
  if (lowest < 0) return "add_subtract";
  const minus = n.terms.some((t) => t.neg);
  if (biggest <= 10) return minus ? "subtract_within_10" : "add_within_10";
  if (biggest <= 20) return minus ? "subtract_within_20" : "add_within_20";
  if (biggest <= 100) {
    const takesTens = n.terms.every((t, i) => !t.neg || values[i]! % 10 === 0);
    const addsOneOther = n.terms.filter((t, i) => !t.neg && values[i]! % 10 !== 0).length <= 1;
    if (takesTens && addsOneOther) return "add_tens";
    return minus ? "subtract_within_100" : "add_within_100";
  }
  return biggest <= 1000 ? "add_subtract_within_1000" : "multi_digit_add_subtract";
}

/** `3/4`: a fraction of whole numbers written with a slash (not a bracket over a number, `(5 + 3)/2`, not `1/2.5`). */
const SLASH_FRACTION = /(?<![\d)}])(\d+)\s*\/\s*(\d+)(?![\d.])/;

/** The line with its slash fractions written as bars (`3/4 * 8` → `\frac{3}{4} * 8`), read again. */
function withBars(line: Line): Line {
  const tex = line.tex.replace(new RegExp(SLASH_FRACTION.source, "g"), "\\frac{$1}{$2}");
  return { tex, reading: readLatex(tex) };
}

function arithmetic(p: Problem): SkillId | null {
  if (lettersOf(p).length > 0) return null;
  // a line the reader did not read must have no letters either (its commands are not letters)
  if (/[A-Za-z]/.test(p.all.replace(/\\text\s*\{[^{}]*\}/g, " ").replace(/\\[A-Za-z]+/g, " "))) return null;
  if (/%/.test(p.all)) return "percents";
  const nodes = nodesOf(p);
  const read = p.lines.every((l) => l.reading);
  // the working the K–8 skills are told apart by; null (the coarse skill) for a line not read
  const work = read ? workingOf(p.main) : null;
  const isPlain = (n: Node) => {
    const u = n.t === "add" && n.terms.length === 1 ? n.terms[0].node : n;
    return u.t === "num";
  };
  if (nodes.some((n) => n.t === "mixed" || (n.t === "frac" && isPlain(n.num) && isPlain(n.den))) || (!read && /\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\}/.test(p.all))) return fractionSkill(work);
  if (SLASH_FRACTION.test(p.all)) {
    if (/[+-]/.test(p.all)) return fractionSkill(work);
    // × or ÷ with a slash fraction (`3/4 \times 8`, `6 \div 1/3`): the reader takes the slash for
    // one more ÷ (3 ÷ 4 × 8), so the line is read again with its fractions written as bars
    if (/[*÷]/.test(p.all)) return fractionSkill(read ? workingOf(withBars(p.main)) : null);
  }
  const negative =
    nodes.some((n) => n.t === "add" && n.terms[0].neg) ||
    p.lines.some((l) => l.reading?.items.some((it) => it.sides.some((s) => s !== null && evaluate(s, {}) < -1e-12))) ||
    (!read && /(?:^|[(=*/+])\s*-\s*\d/.test(p.all));
  if (negative) return "negative_numbers";
  if (/\d\.\d|(?<!\d)\.\d/.test(p.all)) return decimalSkill(work);
  if (nodes.some((n) => n.t === "pow" || n.t === "sqrt") || (!read && /\^|\\sqrt/.test(p.all))) return "powers_roots";
  const adds = nodes.some((n) => n.t === "add" && n.terms.length > 1) || (!read && /\d\s*[+-]\s*\d/.test(p.all));
  const muls = nodes.some((n) => n.t === "mul" || n.t === "frac") || (!read && /[*/÷]/.test(p.all));
  const brackets = nodes.some((n) => n.t === "paren") || (!read && /[()]/.test(p.all));
  if ((adds && muls) || brackets) return "order_of_operations";
  if (muls) return productSkill(work, p.main.tex);
  if (adds) return sumSkill(work);
  return null;
}

const RULES: readonly ((p: Problem) => SkillId | null)[] = [
  chemistry,
  calculus,
  proofs,
  statistics,
  wordProblems,
  complexNumbers,
  logarithms,
  trig,
  systems,
  functions,
  exponential,
  coordinateGeometry,
  absoluteValue,
  pythagorean,
  circles,
  areaPerimeter,
  anglesTriangles,
  units,
  linearFunctions,
  radicals,
  inequalities,
  exponentRules,
  ratios,
  rationalExpressions,
  quadraticEquations,
  polynomials,
  factoring,
  simplifyExpressions,
  linearEquations,
  arithmetic,
];

/**
 * The skill a problem practises, from its LaTeX lines (and the student's course as a tie-breaker:
 * `2x + 3 = 11` is `two_step_equations` in any course). Deterministic, pure, no engine, < 1 ms.
 * `other` when nothing fits.
 */
export function classifyProblem(problemLatex: readonly string[], course?: string | null): SkillId {
  try {
    const p = readProblem(problemLatex.slice(0, 8).map((l) => String(l ?? "").slice(0, 500)), course ?? null);
    if (!p) return "other";
    for (const rule of RULES) {
      const skill = rule(p);
      if (skill) return skill;
    }
  } catch {
    // a problem the rules cannot read is filed as other maths, never an error on the board
  }
  return "other";
}
