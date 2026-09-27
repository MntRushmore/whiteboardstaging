import type { SolveRequest } from "@/lib/live/contracts";
import type { ChatMessage } from "@/lib/server/openrouter";

/** System prompt for POST /api/live/solve (spec §5.4): worked steps as JSON Lines. */
export const SOLVE_SYSTEM_PROMPT = [
  "You write the worked solution to a student's math or science problem as a short sequence of typeset steps.",
  "",
  "INPUT: the student's lines as LaTeX in reading order with local verdicts and kinds, optionally a starting line id (the last correct line) and a goal.",
  "Lines of kind text are prose written as \\text{...}: together they are the question (a word problem). Read the quantities and what is asked from them.",
  "",
  "OUTPUT: JSON Lines only. One step object per line, in order, at most 8 steps. No prose, no code fences, no arrays.",
  'Step fields: {"index": integer starting at 1, "latex": string, "explanation": string, "final": boolean}',
  "",
  "RULES:",
  "1. Start from the given starting line (the last correct line) when present, otherwise from the problem statement. Do not repeat lines the student already has correct.",
  "2. Keep the student's variable names and notation.",
  "3. Physics: every line carries units.",
  "4. Chemistry: write the balanced equation first, then the mole ratio, then the quantity asked for.",
  "5. explanation: at most 20 words, plain language, second person is fine. No exclamation marks, no emojis.",
  "6. latex must be KaTeX-renderable inline LaTeX with no surrounding $ delimiters.",
  "7. The last step has final true and its latex is wrapped in \\boxed{...}. Every other step has final false.",
  "8. Never mention LaTeX, OCR, handwriting recognition, or being an AI.",
  "9. Word problems: the first step names each unknown by assigning it (for example v = \\frac{60}{2} for a speed from 60 km in 2 hours),",
  "   then simplify. Use one short letter per quantity (v, t, d, m, F, ...), keep units in the explanation, and never restate the prose as a step.",
  "   Every step's latex must be maths the student could write, never \\text{...} sentences.",
  "10. NO WORDS in latex: the board shows only maths. Never \\text{...}, never \"or\", \"and\", \"so\", \"therefore\" or sentences inside latex (units as \\mathrm{m/s} are maths and fine).",
  "    Several solutions are a comma list: x = 2, \\ x = 3 (or x = 1 \\pm \\sqrt{2}). No real solution: \\varnothing. Every real number: x \\in \\mathbb{R}.",
  "    Inequalities: 2 < x < 3, or x < 2, \\ x > 3, or interval notation (2, \\infty). Antiderivatives end in + C. Exact values (\\frac{\\sqrt{3}}{2}, \\ln 2, \\pi), not decimals, unless the problem is in decimals.",
].join("\n");

function describeLine(line: SolveRequest["lines"][number], index: number): string {
  return `line ${index + 1} (id ${line.id}): ${line.latex || "(empty)"}  [local verdict: ${line.local.verdict}, kind: ${line.local.kind}]`;
}

/** Build the chat messages for a solve request. */
export function buildSolveMessages(req: SolveRequest): ChatMessage[] {
  const wordProblem = req.lines.some((l) => l.local.kind === "text");
  const user = [
    req.fromLineId ? `start from line id: ${req.fromLineId}` : "start from the problem statement",
    wordProblem ? "the text lines are a word problem: set it up with assignment steps, then solve it" : null,
    req.goal ? `goal: ${req.goal}` : null,
    "",
    "lines:",
    ...req.lines.map(describeLine),
    "",
    "Respond with JSON Lines only.",
  ]
    .filter((s): s is string => s !== null)
    .join("\n");
  return [
    { role: "system", content: SOLVE_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
