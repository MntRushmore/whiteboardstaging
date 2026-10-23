/**
 * The bank pipeline's two prompts (scripts/sat/pipeline.ts):
 *
 *  - the WRITER (a strong model) writes a batch of original SAT-style questions for planned slots,
 *    each with a machine-checkable `verify` block (scripts/sat/cas.ts) and the mistake behind every
 *    wrong choice;
 *  - the SOLVER (a different model) answers ONE question without its answer, and flags anything
 *    that makes it unfair (two right choices, none, a figure that contradicts the words).
 *
 * Both prompts are plain text, built only from the plan and the question, so the cache key of a
 * rerun is the same and its reply is free.
 *
 * SAT v2's notes stage (scripts/sat/notes.ts, docs/SAT-V2.md "Bank additions") has two more:
 *
 *  - the NOTES WRITER writes, for a batch of live questions, the nudge, the mistake behind each
 *    wrong choice (or likely wrong grid-in) with the arithmetic of that mistake as a mathjs `check`,
 *    and the Desmos way when it really helps;
 *  - the NOTES VERIFIER (a different model) re-derives every mistake from the question, checks the
 *    nudge gives nothing away and the Desmos steps really work.
 */
import type { SatQuestion } from "../../src/lib/sat/contracts";
import type { Slot } from "./plan";

const DIFFICULTY = {
  1: "EASY (1): one or two steps, a direct application of one idea. Most students who studied get it.",
  2: "MEDIUM (2): two to four steps, or one idea used in a less obvious way (a context to translate, a figure to read carefully).",
  3: "HARD (3): several steps or two ideas combined, an unfamiliar form, or a trap a careless student falls into. Still solvable in under 2 minutes by a strong student, with no calculus and no tricks outside the SAT.",
} as const;

const FIGURE_SPEC = `FIGURES (the "figure" field: null, or ONE of these JSON objects; drawn natively by the app, never an image):
- {"kind":"table","headers":["x","f(x)"],"rows":[["0","3"],["1","5"]]}  every row has one cell per header; cells are short strings (inline $…$ LaTeX allowed).
- {"kind":"plot","x":{"min":-5,"max":5,"step":1,"label":"x"},"y":{"min":-5,"max":5,"step":1,"label":"y"},"grid":true,"items":[ITEMS]}
  ITEMS: {"type":"function","expr":"2*x+1"}   expr uses ONLY numbers, x, + - * / ( ) and ** for powers (never ^, never Math., never a minus sign directly before ** — write 9-(x-1)**2, not -(x-1)**2+9)
         {"type":"segment","from":[0,0],"to":[3,4]}
         {"type":"point","at":[2,5],"label":"(2, 5)"}   (label optional; when it is "(a, b)" it MUST equal "at")
         {"type":"bar","x":1,"height":12,"label":"Mon"}
  Every item must lie inside the axes; at most 40 grid steps per axis. For a scatterplot use point items (no labels).
- {"kind":"shape","items":[ITEMS],"note":"Note: Figure not drawn to scale."}   own units, y up; "note" optional
  ITEMS: {"type":"polygon","points":[[0,0],[4,0],[0,3]]}
         {"type":"circle","center":[0,0],"r":2}
         {"type":"segment","from":[0,0],"to":[2,0],"dashed":true}
         {"type":"label","at":[2,-0.3],"text":"4"}
         {"type":"right_angle","at":[0,0],"dirs":[[1,0],[0,1]]}
         {"type":"arc_angle","at":[4,0],"from":180,"to":143,"label":"$x^\\\\circ$"}   from/to = directions (degrees, counter-clockwise from +x) of the two rays at the vertex
  NO other keys or item types exist. Coordinates must really draw what the words say: side labels in proportion to the drawn lengths, angle arcs at the right vertices with the right sizes (or add the not-to-scale note when the numbers cannot be drawn to scale, as on the real test). A labelled length must be the length of the segment it sits next to.
The figure and the stem must agree exactly: every number in a figure that the stem also mentions is the same, and nothing in the figure contradicts the words.`;

export const LATEX_RULES = `MARKDOWN AND LATEX (stem, choices, steps, desmos tip):
- Inline math $…$, display math $$…$$. ONLY these commands: \\frac \\sqrt \\cdot \\le \\ge \\ne \\pi \\theta \\sin \\cos \\tan \\circ \\overline \\angle \\triangle, plus ^ _ { } and plain symbols (+ - = < > ( ) | , .).
- NOT allowed anywhere: \\dfrac \\times \\div \\left \\right \\text \\% \\, \\approx \\pm \\infty \\cdots \\ldots \\begin, \\mathrm, \\degree, Greek letters other than \\pi and \\theta.
- Degrees: $40^\\circ$. Multiplication: \\cdot. Percent: write 15% OUTSIDE math. Money: write "12 dollars" or "12.50 dollars" — NEVER a "$" sign for money (it breaks the math parser).
- Put each piece of math inside $…$; never LaTeX outside dollars.
- A step's "math" field is bare LaTeX WITHOUT dollar signs (or null).`;

const SPR_RULES = `GRID-IN (spr) ANSWERS:
- The answer is ONE number. A positive answer fits in 5 characters, a negative one in 6 (the minus counts): "1234", "3/4", ".75", "-12.5", "-1/2".
- Fractions and decimals are both fine; NO mixed numbers, NO commas, NO units, NO percent signs, NO π, NO roots. If the natural answer is irrational, ask for something rational instead (e.g. "the value of k when the arc is kπ").
- "answer" lists EVERY form a correct grid-in could take: for 3/4 → ["3/4",".75","0.75"]; for 2/3 → ["2/3",".6666",".6667","0.666","0.667"]; for 7 → ["7"]; for 2.5 → ["2.5","5/2"]. Each form at most 5 characters (6 with a minus). A repeating decimal is listed truncated AND rounded to fill the grid.
- The stem says what to enter if it could be unclear ("Enter your answer without the percent sign.").`;

export const WRITER_SYSTEM = `You write ORIGINAL SAT-style math questions (the digital SAT's math section) for Agathon, a free iPad study tool for 15–18 year olds. Every question you write will be checked by an independent solver and a numeric checker, and a human spot-checks them.

ORIGINALITY IS NON-NEGOTIABLE:
- Never reproduce, paraphrase or lightly edit a College Board, Khan Academy, Bluebook, official practice test or any published SAT question, its wording, its numbers or its figures. Invent your own context, names, numbers and figures every time.
- Use the setting you are given for each word problem. Vary sentence structure; do not reuse a template across questions in the batch.

QUALITY:
- Exactly one correct answer, unambiguous wording, realistic numbers, the style and length of real SAT items (most stems 1–4 sentences).
- Multiple choice: four choices A–D. Each wrong choice comes from a REAL common mistake (sign error, wrong operation, solving for the wrong quantity, a reversed ratio, forgetting a step); say which mistake in "distractors". Choices in a sensible order (numbers ascending, as the SAT does). Spread the correct key across A–D.
- The question must not give the answer away, and must be solvable from the stem (and figure) alone.
- Solutions: 2–6 short steps a 16-year-old can follow, each a sentence ("text") with optional bare LaTeX ("math"). No filler.
- "desmos_tip": a single sentence on how to do it on the test-day graphing calculator (Desmos) ONLY when graphing or a regression genuinely helps (systems, intersections, zeros, max/min, regression); otherwise null.

${LATEX_RULES}

${SPR_RULES}

${FIGURE_SPEC}

VERIFY (for the numeric checker; not shown to students):
- {"kind":"value","expr":"..."}: (never just the answer typed as a number: the expression must do the arithmetic from the givens) when the correct answer is a single number (every grid-in, and multiple choice whose correct choice is a number such as $\\frac{4}{7}$, $12$, $4\\pi$ or $2\\sqrt{3}$). "expr" is a mathjs expression computing that exact value from the question's givens (e.g. "(212-4*20)/3", "16/28", "sqrt(8^2+15^2)", "120/360*2*pi*6"). Compute it independently of your answer, from the givens.
- {"kind":"expression","target":"..."}: when the choices are expressions in x (equivalent expressions, rewriting functions). "target" is a mathjs expression in x equal to the correct choice, built from the stem's expression (e.g. "(2x+3)*(x-4)").
- {"kind":"none"}: when neither fits (interpretation questions, choices that are sentences, equations or ordered pairs).

OUTPUT: only a JSON object, no prose:
{"questions":[{"slot":"<slot id>","stem":"...","figure":null,"choices":["…","…","…","…"],"answer":"C","distractors":{"A":"…","B":"…","D":"…"},"steps":[{"text":"…","math":"…"}],"desmos_tip":null,"verify":{"kind":"value","expr":"…"}}]}
For a grid-in: "choices": null, "answer": ["…","…"], "distractors": null.
One object per slot, in the order given, with the slot id copied exactly.`;

export function writerPrompt(batch: readonly Slot[]): string {
  const s0 = batch[0];
  const lines = batch.map((s, i) => {
    const fig = s.figure ? `include a ${s.figure} figure that the question needs` : "no figure";
    return `${i + 1}. slot "${s.id}": format ${s.format === "mcq" ? "multiple choice (mcq)" : "grid-in (spr)"}; ${fig}; setting (if a word problem): ${s.context}; build it around one or two of these numbers if they fit (change them freely if not): ${numberHints(s.id).join(", ")}`;
  });
  return `Write ${batch.length} question${batch.length > 1 ? "s" : ""}.

Domain: ${s0.domain}. Skill: ${s0.skill}.
Difficulty: ${DIFFICULTY[s0.difficulty]}

Slots:
${lines.join("\n")}

Make the questions in this batch clearly different from each other (different structures, not just different numbers), and avoid the stock textbook examples (other batches write questions for this same skill: fresh numbers and forms keep the bank from repeating itself). Not every question needs a word problem: about half of algebra and advanced-math questions are pure equations or expressions; the setting is for the ones that are word problems.`;
}

/** A few numbers per slot, from its id, so batches written in parallel do not all reach for the same ones. */
export function numberHints(id: string): number[] {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    out.push(2 + (h % 58));
  }
  return [...new Set(out)];
}

export const SOLVER_SYSTEM = `You are an expert SAT math tutor checking a practice question before students see it. Solve it yourself, carefully and independently, then check the question is fair.

Return only a JSON object:
{"work":"<brief working, at most 8 lines>","answer":"<for multiple choice: the single letter A, B, C or D; for a grid-in: the number as a student would enter it, e.g. 3/4 or -2.5 or 14>","issues":[]}

"issues": list ONLY real problems, each a short sentence, from this set of kinds:
- "no correct choice" / "more than one correct choice"
- "ambiguous wording" (two reasonable readings give different answers)
- "figure contradicts the text" (a labelled length, angle, point or value in the figure disagrees with the words, or the drawing is impossible for the stated numbers without a not-to-scale note)
- "missing information" (cannot be solved from what is given)
- "not SAT math" (needs calculus, or knowledge outside the SAT)
- "grid-in answer does not fit" (not expressible in 5 characters, or 6 with a minus)
Leave "issues" empty when the question is fine. Do not flag style preferences.`;

/** The question as the solver sees it: no answer, no solution. */
export function solverPrompt(q: Pick<SatQuestion, "format" | "stem" | "figure" | "choices">): string {
  const parts = [`Question (${q.format === "mcq" ? "multiple choice" : "grid-in: the student types a number"}):`, q.stem];
  if (q.figure) parts.push(`\nFigure, as JSON (the app draws it; a "shape" uses its own units with y up; "arc_angle" marks the angle between ray directions from/to in degrees):\n${JSON.stringify(q.figure)}`);
  if (q.choices) parts.push(`\nChoices:\n${q.choices.map((c) => `${c.key}) ${c.text}`).join("\n")}`);
  return parts.join("\n");
}

// ------------------------------------------------------------------ SAT v2: the notes stage

/** A live question as both notes prompts show it (no notes of its own). */
function questionBlock(q: Pick<SatQuestion, "id" | "format" | "stem" | "figure" | "choices" | "answer">): string {
  const parts = [`### ${q.id} (${q.format === "mcq" ? "multiple choice" : "grid-in"})`, q.stem];
  if (q.figure) parts.push(`Figure (JSON; a "shape" uses its own units with y up):\n${JSON.stringify(q.figure)}`);
  if (q.choices) parts.push(`Choices:\n${q.choices.map((c) => `${c.key}) ${c.text}`).join("\n")}`);
  parts.push(`Correct answer: ${"key" in q.answer ? q.answer.key : q.answer.accepted.join(" or ")}`);
  return parts.join("\n");
}

export const NOTES_WRITER_SYSTEM = `You write short teaching notes for ORIGINAL SAT-style math practice questions in Agathon, a free iPad study tool for 15–18 year olds. Every note is checked by a second model and by arithmetic; a note that fails is thrown away, so write only what you have worked out and are sure of.

For each question you get the question, its correct answer, its worked solution, and (multiple choice) the question author's own guess at the mistake behind each wrong choice: that guess may be wrong, so work it through yourself.

Write, per question:
1. "nudge": ONE short question or pointer in a calm tutor's voice that gets a stuck student moving: what to look at, or the first move. At most 110 characters. It must NOT give the answer away: never the answer, never the correct letter, never the key number the question asks for or a number one trivial step from it. A question is best ("What's the slope between the two labeled points?", "What could you do to both sides to get x alone?").
2. "whys" (multiple choice only): for EACH WRONG choice, the ONE specific slip that produces EXACTLY that choice, so a student who picked it recognises what they did. Work the slip through from the question and make sure it lands on that choice. Style: past tense with no subject, then a colon and the arithmetic of the slip, at most 130 characters (e.g. "Swapped rise and run: $(2-0)/(0-4)$." or "Added 7 instead of subtracting it: $3x = 4$."). Name a concrete slip (a sign, an operation, a step skipped, the wrong quantity found, a ratio reversed), never a vague one ("mishandled the division", "factored incorrectly", "added a factor"), and never just restate the choice. With it, "check": a mathjs expression that computes that WRONG CHOICE ITSELF from the question's numbers by following the slip (e.g. "(11+7)/3"); when the choice is an expression in x, the WHOLE expression in x the slip produces (e.g. "x^2+12*x-9*x-108", never just one coefficient); null when the choice is not a number or an expression in x (a sentence, an equation, an ordered pair, an inequality). If no single natural slip gives a choice, write null for that choice: never invent a far-fetched one.
3. "common_wrong" (grid-in only): 0 to 3 wrong answers students really enter, each a valid grid-in (at most 5 characters, 6 with a minus; a fraction or a decimal; no mixed numbers, units or commas) that is NOT a correct answer, with "why" (same style, at most 130 characters) and "check" (a mathjs expression computing that wrong value from the question's numbers by following the mistake). Fewer is fine; [] when nothing is likely.
4. "desmos_steps": the Desmos way, ONLY when the test-day graphing calculator genuinely makes this question faster or safer (a system, an intersection, zeros, a maximum or minimum, a regression, checking a solution by graphing both sides). Then 2 to 4 steps, each {"text": what to do (at most 120 characters), "math": exactly what to type in Desmos as plain math such as "y=3x-7" or "y=11" (no dollar signs), or null}. Otherwise null. A one-step arithmetic or a reading question gets null.

${LATEX_RULES}
Every number or expression in "nudge", "why" and "text" that needs math formatting goes inside $…$. Money is "dollars", never a dollar sign.

OUTPUT: only a JSON object, no prose:
{"notes":[{"id":"<question id>","nudge":"…","whys":{"A":{"why":"…","check":"…"},"C":{"why":"…","check":null},"D":null},"common_wrong":null,"desmos_steps":null}]}
For a grid-in: "whys": null and "common_wrong": [{"answer":"…","why":"…","check":"…"}] (or []).
One object per question, in the order given, with the id copied exactly.`;

export function notesWriterPrompt(batch: ReadonlyArray<SatQuestion & { distractors?: Record<string, string> | null }>): string {
  return `Write the notes for these ${batch.length} question${batch.length > 1 ? "s" : ""}.\n\n${batch
    .map((q) => {
      const parts = [questionBlock(q)];
      parts.push(`Worked solution:\n${q.solution.steps.map((s, i) => `${i + 1}. ${s.text}${s.math ? ` [${s.math}]` : ""}`).join("\n")}`);
      if (q.solution.desmos_tip) parts.push(`Desmos tip already written: ${q.solution.desmos_tip}`);
      if (q.distractors && Object.keys(q.distractors).length) parts.push(`The author's guess at each wrong choice's mistake (check it):\n${Object.entries(q.distractors).map(([k, v]) => `${k}: ${v}`).join("\n")}`);
      return parts.join("\n");
    })
    .join("\n\n")}`;
}

export const NOTES_VERIFIER_SYSTEM = `You check teaching notes written for SAT-style math practice questions before students see them. Be strict: a wrong note teaches a wrong lesson, and a note you reject is simply not shown.

For each question you get the question, its correct answer and the notes. Check each note YOURSELF:
- "nudge": ok only if it is mathematically correct and relevant, AND it does not give the answer away (it must not state or all but state the answer, the correct choice, or the number the question asks for).
- each "why" (one per wrong multiple-choice option): re-derive it. Apply EXACTLY the mistake it describes to the question and compute what a student would get. ok only if (1) that result is exactly the value or expression of that choice, (2) the mistake is one specific, real slip a student could make, and (3) it is stated clearly enough that a student who picked that choice would recognise it. Reject a vague why ("mishandled the division", "factored incorrectly", "forced a wrong factor pair") and one that only describes the choice instead of the slip ("Expanding gives $45x^2+25x-20$, which has an extra x-term" says what is wrong with the choice, not what the student did). Put what you got in "result".
- each "common_wrong" (grid-in): the same: apply the mistake, compute the result; ok only if the result equals that wrong answer and that answer is really wrong.
- "desmos_steps": ok only if typing and reading those steps in the Desmos graphing calculator really leads to the correct answer, and each step is accurate.
Give a short "reason" whenever ok is false.

OUTPUT: only a JSON object, no prose:
{"checks":[{"id":"<question id>","nudge":{"ok":true,"reason":""},"whys":{"A":{"result":"…","ok":true,"reason":""}},"common_wrong":{"<answer>":{"result":"…","ok":false,"reason":"…"}},"desmos_steps":{"ok":true,"reason":""}}]}
Include only the notes that are present (no "whys" for a grid-in, no "desmos_steps" when there are none). One object per question, in the order given, with the id copied exactly.`;

export type NotesForCheck = {
  nudge?: string;
  whys?: Record<string, string>;
  common_wrong?: Array<{ answer: string; why: string }>;
  desmos_steps?: Array<{ text: string; math: string | null }>;
};

export function notesVerifierPrompt(batch: ReadonlyArray<{ q: SatQuestion; notes: NotesForCheck }>): string {
  return `Check the notes for these ${batch.length} question${batch.length > 1 ? "s" : ""}.\n\n${batch
    .map(({ q, notes }) => {
      const parts = [questionBlock(q), "Notes:"];
      if (notes.nudge) parts.push(`nudge: ${notes.nudge}`);
      for (const [k, v] of Object.entries(notes.whys ?? {})) parts.push(`why ${k} (the student picked ${k}): ${v}`);
      for (const w of notes.common_wrong ?? []) parts.push(`common_wrong ${w.answer}: ${w.why}`);
      if (notes.desmos_steps) parts.push(`desmos_steps:\n${notes.desmos_steps.map((s, i) => `  ${i + 1}. ${s.text}${s.math ? ` [type: ${s.math}]` : ""}`).join("\n")}`);
      return parts.join("\n");
    })
    .join("\n\n")}`;
}
