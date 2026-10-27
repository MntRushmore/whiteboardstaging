import { z } from "zod";
import type { ChatMessage } from "@/lib/server/openrouter";
import type { SayRequest } from "@/lib/keys/say";

/**
 * System prompt for POST /api/keys/say (docs/KEYS.md, Phase 2): the Keys tutor's one line, said in
 * a coach's voice for a young kid. The page has already decided everything (the slip, the help, the
 * numbers) and sends its own fixed line; the model only says it another way. The route checks the
 * reply (`sayable`) and keeps the fixed line when it changes a fact.
 */
export const KEYS_SAY_SYSTEM_PROMPT = [
  "You are the tutor in a maths practice app for kids aged 5 to 12. You write ONE short line the kid reads under their work.",
  "You get the tutor's line already written. Say the same thing in your own words, for the kid's grade: short and sure, like a kind coach.",
  "Rules:",
  "- Keep every number exactly as given, the same count of each, and add no number.",
  "- Keep the meaning: the same hint, the same step, the same place (ones, tens, hundreds). Never give more of the answer than the line does.",
  "- One or two short sentences, at most 16 words. Full stops. No exclamation marks unless it is a cheer, then at most one.",
  "- US English. Plain words a 7-year-old knows. No LaTeX, no symbols but + - = ? and the numbers, no emoji, no quotes.",
  "- Never say wrong, incorrect, mistake, easy, just or oops. Never say the kid's name or yours.",
  "- Moments: look_again (a line broke; say where to look), nudge (point at the column), smaller (introduce the smaller problem), worked (walk through the step), praise (a cheer).",
  'JSON only: {"line": string}.',
].join("\n");

export const KeysSayReplySchema = z.object({
  line: z.string().max(400).catch(""),
});

export function buildKeysSayMessages(req: SayRequest): ChatMessage[] {
  const grade = req.grade === null ? "unknown" : req.grade === 0 ? "Kindergarten" : `grade ${req.grade}`;
  const text = [
    `Moment: ${req.moment}`,
    `Kid's grade: ${grade}`,
    `Problem: ${req.problem}`,
    ...(req.step ? [`Smaller problem: ${req.step}`] : []),
    ...(req.bug ? [`What went wrong (for you only): ${req.bug.replace(/_/g, " ")}`] : []),
    `The tutor's line: ${req.copy}`,
    "JSON only.",
  ].join("\n");
  return [
    { role: "system", content: KEYS_SAY_SYSTEM_PROMPT },
    { role: "user", content: text },
  ];
}
