import { z } from "zod";
import type { ChatMessage } from "@/lib/server/openrouter";

/**
 * System prompt for POST /api/live/title: a board's name from the maths on it. The name is what a
 * student (often 5 to 10 years old) finds the board by on their home screen, so it names the topic
 * or skill in their words, not the first equation.
 */
export const TITLE_SYSTEM_PROMPT = [
  "You name a student's whiteboard in a maths tutoring app for kids and teens. You get the maths on the board as LaTeX, in reading order: a problem first when there is one, then the student's working.",
  "Reply with a short name for what the board is about: the topic or skill being practised, in 2 to 5 plain words, sentence case, like the label a student writes on a notebook.",
  "Be specific when the board is: \"Solving trig equations\", not \"Trigonometry\" or \"Maths\".",
  "No LaTeX, no symbols, no quotes, no equations. A number only when it is the topic (\"7 times table\").",
  "Examples:",
  "- 2\\sin x = 1 -> Solving trig equations",
  "- x^{2}-5x+6=0 ; (x-2)(x-3)=0 -> Factoring quadratics",
  "- \\frac{3}{4}+\\frac{1}{8} -> Adding fractions",
  "- 7 \\times 8 = 56 ; 7 \\times 9 = 63 -> 7 times table",
  "- \\frac{d}{dx}\\left(x^{3}+2x\\right) -> Derivatives of polynomials",
  "- a^{2}+b^{2}=c^{2} ; 3^{2}+4^{2}=c^{2} -> Pythagorean theorem",
  "- \\text{A train travels } 120 \\text{ miles in } 2 \\text{ hours} -> Speed word problem",
  "- 2x+3y=12 ; x-y=1 -> Systems of equations",
  'If there is nothing you can name (scribbles, a lone number), return null. JSON only: {"title": string | null}.',
].join("\n");

export const TitleReplySchema = z.object({
  title: z.string().max(200).nullable().catch(null),
});
export type TitleReply = z.infer<typeof TitleReplySchema>;

export function buildTitleMessages(lines: readonly string[]): ChatMessage[] {
  const text = [`The board, top to bottom:`, ...lines.map((l, i) => `${i + 1}. ${l}`), "JSON only."].join("\n");
  return [
    { role: "system", content: TITLE_SYSTEM_PROMPT },
    { role: "user", content: text },
  ];
}
