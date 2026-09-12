import type { SolveRequest } from "@/lib/live/contracts";
import type { ChatMessage } from "@/lib/server/openrouter";

/** System prompt for POST /api/live/solve (spec §5.4): worked steps as JSON Lines. */
export const SOLVE_SYSTEM_PROMPT = [
  "You write the worked solution to a student's math or science problem as a short sequence of typeset steps.",
  "",
  "INPUT: the student's lines as LaTeX in reading order with local verdicts, optionally a starting line id (the last correct line) and a goal.",
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
].join("\n");

function describeLine(line: SolveRequest["lines"][number], index: number): string {
  return `line ${index + 1} (id ${line.id}): ${line.latex || "(empty)"}  [local verdict: ${line.local.verdict}, kind: ${line.local.kind}]`;
}

/** Build the chat messages for a solve request. */
export function buildSolveMessages(req: SolveRequest): ChatMessage[] {
  const user = [
    req.fromLineId ? `start from line id: ${req.fromLineId}` : "start from the problem statement",
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
