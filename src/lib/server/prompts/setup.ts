import { z } from "zod";
import type { SetupRequest } from "@/lib/live/contracts";
import type { ChatMessage } from "@/lib/server/openrouter";

/**
 * System prompt for POST /api/live/setup: a word problem → the equations a student writes under
 * it. "The model understands, the engine calculates": the reply is only the setup, never the
 * arithmetic, and the board's local engine solves it (`localSolve`), exactly as Solve would.
 *
 * Adapted from the model benchmark's job-1 prompt (`WORD_SETUP_SYSTEM_PROMPT` in
 * src/__eval__/models/wordProblems.ts, docs/eval/models.md), where every model scored 24–25 of
 * 25. Two additions for the board: maths the student already wrote under the problem arrives as
 * ordinary lines (keep its letters), and a problem that cannot be set up this way answers with no
 * lines, so the board falls back to the worked solution instead of drawing a guess.
 */
export const SETUP_SYSTEM_PROMPT = [
  "You turn a school word problem into the maths a student writes under it, so that a calculator can solve it. You never calculate.",
  "",
  "INPUT: the problem as the student's lines, top to bottom (prose arrives as \\text{...}; any other line is maths the student already wrote).",
  'OUTPUT: one JSON object and nothing else: {"unknown": "<the letter of the quantity asked for>", "lines": ["<LaTeX>", ...]}',
  "",
  "RULES:",
  "1. lines set the problem up, top to bottom, at most 4: one equation in one unknown, or two or three simultaneous linear equations, or an assignment of the asked-for quantity to an unsimplified expression.",
  "2. One short letter per quantity (x, n, t, v, p, ...). Keep any letter the problem or the student already uses. The unknown must appear in the lines.",
  "3. Never compute: leave the arithmetic unsimplified (v = \\frac{150}{2.5}, not v = 60). No line may state the answer.",
  "4. Numbers only: no units, no \\text, no words, no $ delimiters. Write percentages as decimals (15% is 0.15).",
  "5. KaTeX-renderable LaTeX, one equation per line.",
  '6. If the lines are not a problem you can set up this way, answer {"unknown": "", "lines": []}.',
].join("\n");

/** The model's reply, leniently: a missing field is empty (the route then answers 502 and refunds). */
export const SetupReplySchema = z.object({
  unknown: z.string().max(40).catch("").default(""),
  lines: z.array(z.unknown()).catch([]).default([]),
});
export type SetupReply = z.infer<typeof SetupReplySchema>;

/** At most this many setup lines reach the board (the prompt asks for at most 4). */
export const MAX_SETUP_LINES = 4;

/** Build the chat messages for a setup request. */
export function buildSetupMessages(req: Pick<SetupRequest, "lines">): ChatMessage[] {
  const lines = req.lines.map((l) => l.trim()).filter(Boolean);
  return [
    { role: "system", content: SETUP_SYSTEM_PROMPT },
    { role: "user", content: ["Problem lines:", ...lines, "", "JSON only."].join("\n") },
  ];
}

/**
 * The setup lines as the board receives them: strings only, `$` delimiters and surrounding space
 * off, empty and over-long lines dropped, at most `MAX_SETUP_LINES`. Nothing here judges the
 * maths: the client parses every line with the engine and solves the setup before drawing it.
 */
export function cleanSetupReply(reply: SetupReply): { lines: string[]; unknown: string } {
  const lines = reply.lines
    .filter((l): l is string => typeof l === "string")
    .map((l) => l.replace(/^\s*\$+|\$+\s*$/g, "").trim())
    .filter((l) => l.length > 0 && l.length <= 500)
    .slice(0, MAX_SETUP_LINES);
  const unknown = reply.unknown.replace(/[\\{}\s$]/g, "").slice(0, 20);
  return { lines, unknown };
}
