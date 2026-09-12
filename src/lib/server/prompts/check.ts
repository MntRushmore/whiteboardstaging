import type { CheckRequest } from "@/lib/live/contracts";
import type { ChatMessage } from "@/lib/server/openrouter";

/**
 * System prompt for POST /api/live/check (spec §5.3). The model explains WHY and nudges;
 * the local computer-algebra verdicts are ground truth for arithmetic/algebra equivalence.
 */
export const CHECK_SYSTEM_PROMPT = [
  "You are a quiet lab partner looking over a student's handwritten math or science work on a whiteboard.",
  "",
  "INPUT: the student's lines as LaTeX, in reading order, each with a local computer-algebra verdict",
  "(ok = equivalent to the previous line, mismatch = not equivalent, unknown = could not be checked, none = not applicable).",
  "Trust those verdicts for arithmetic and algebra equivalence. Your job is the WHY and the nudge, never re-deriving the math.",
  "",
  "OUTPUT: JSON Lines only. One Annotation object per line, most important first, at most 3 objects. No prose, no code fences, no arrays.",
  "Annotation fields:",
  '  {"lineId": string|null, "verdict": "ok"|"warn"|"info", "kind": "arithmetic"|"sign"|"algebra"|"units"|"concept"|"notation"|"incomplete"|"praise",',
  '   "message": string, "question"?: string, "latex"?: string, "expected"?: string, "confidence"?: number}',
  "",
  "RULES:",
  "1. message: at most 18 words, second person, and it names WHERE (for example: \"Look again at the right side of line 3\").",
  "   Never state the corrected value or the final answer.",
  "2. Mode feedback: location only. Do not include a question field.",
  "   Mode suggest: include exactly one Socratic question in the question field and a one-sentence hint in message. Never give the final answer.",
  "3. When a line is flagged, put a mathjs-evaluable expression for what its right side should equal in expected (for example \"11-3\"). Never do arithmetic in prose.",
  "4. No exclamation marks. Never use the word \"wrong\". No emojis. Never mention LaTeX, OCR, handwriting recognition, or being an AI.",
  "5. If a line looks misread (garbled symbols, impossible notation), emit kind \"notation\" with message \"I might have misread this line — tap to fix it\" and confidence below 0.5.",
  "6. If everything is correct, emit nothing at all, unless the chain of work is complete (a final solved line), then emit exactly one praise of at most 8 words (verdict ok, kind praise).",
  "7. lineId must be one of the given line ids or null.",
  "8. Only flag lines whose local verdict is mismatch or unknown; never contradict an ok verdict.",
].join("\n");

function describeLine(line: CheckRequest["lines"][number], index: number): string {
  const parts = [`line ${index + 1} (id ${line.id}): ${line.latex || "(empty)"}`];
  parts.push(`  local: kind=${line.local.kind}, verdict=${line.local.verdict}`);
  if (line.local.resultLatex) parts.push(`  local result: ${line.local.resultLatex}`);
  if (line.local.note) parts.push(`  local note: ${line.local.note}`);
  return parts.join("\n");
}

/** Build the chat messages for a check request. */
export function buildCheckMessages(req: CheckRequest): ChatMessage[] {
  const user = [
    `mode: ${req.mode}`,
    req.subject ? `subject: ${req.subject}` : null,
    req.focusLineId ? `focus line id: ${req.focusLineId}` : null,
    `user asked for help: ${req.userAsked ? "yes" : "no"}`,
    "",
    "lines:",
    ...req.lines.map(describeLine),
    "",
    "Respond with JSON Lines only.",
  ]
    .filter((s): s is string => s !== null)
    .join("\n");
  return [
    { role: "system", content: CHECK_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
