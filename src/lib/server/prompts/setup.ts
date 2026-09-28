import { z } from "zod";
import type { SetupRequest } from "@/lib/live/contracts";
import type { ChatMessage } from "@/lib/server/openrouter";
import { checkFigure } from "@/lib/live/figureDraw/check";
import { FigureSpecSchema, type FigureSpec } from "@/lib/live/figureDraw/contracts";

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
  'OUTPUT: one JSON object and nothing else: {"unknown": "<the letter of the quantity asked for>", "lines": ["<LaTeX>", ...], "sketch": <optional figure, rule 7>}',
  "",
  "RULES:",
  "1. lines set the problem up, top to bottom, at most 4: one equation in one unknown, or two or three simultaneous linear equations, or an assignment of the asked-for quantity to an unsimplified expression.",
  "2. One short letter per quantity (x, n, t, v, p, ...). Keep any letter the problem or the student already uses. The unknown must appear in the lines.",
  "3. Never compute: leave the arithmetic unsimplified (v = \\frac{150}{2.5}, not v = 60). No line may state the answer.",
  "4. Numbers only: no units, no \\text, no words, no $ delimiters. Write percentages as decimals (15% is 0.15).",
  "5. KaTeX-renderable LaTeX, one equation per line. EVERY line contains =, < or > (an equation, inequality or assignment); never a bare expression such as w + 3.",
  '6. If the lines are not a problem you can set up this way, answer {"unknown": "", "lines": []}.',
  "7. When the problem describes a picture — a triangle or right triangle (a ladder against a wall, a ramp, a shadow, a kite string), angles of a shape or at a point, a rectangle or other polygon with sizes, a circle — also return \"sketch\", the figure a teacher draws beside the working. Otherwise leave \"sketch\" out.",
  '   sketch: {"points": {"A": {"x": 0, "y": 0}, ...}, "polygons": [{"vertices": ["A", "B", "C"]}], "segments": [{"from": "A", "to": "B", "label": "6"}], "angles": [{"at": "A", "from": "B", "to": "C", "right": true}, {"at": "B", "from": "A", "to": "C", "label": "40^{\\circ}"}], "circles": [{"center": "O", "radius": 5}]}.',
  "   Coordinates true to scale for the problem's numbers, y up; capital letters for points. Label each given length or angle with its number (no units; degrees as 40^{\\circ}) and the asked-for quantity with its letter from lines — never its value. Mark right angles. Labels are short maths only, never words.",
].join("\n");

/** The model's reply, leniently: a missing field is empty (the route then answers 502 and refunds). */
export const SetupReplySchema = z.object({
  unknown: z.string().max(40).catch("").default(""),
  lines: z.array(z.unknown()).catch([]).default([]),
  sketch: z.unknown().optional(),
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
export function cleanSetupReply(reply: SetupReply): { lines: string[]; unknown: string; sketch?: FigureSpec; sketchDropped?: string } {
  const lines = reply.lines
    .filter((l): l is string => typeof l === "string")
    .map((l) => l.replace(/^\s*\$+|\$+\s*$/g, "").trim())
    .filter((l) => l.length > 0 && l.length <= 500)
    .slice(0, MAX_SETUP_LINES);
  const unknown = reply.unknown.replace(/[\\{}\s$]/g, "").slice(0, 20);
  const sketch = cleanSketch(reply.sketch);
  return { lines, unknown, ...sketch };
}

/**
 * The sketch as the board receives it: only a figure the drawer passes (`checkFigure`: every name
 * defined, labels in proportion to the drawing, maths the hand can write). One that does not is
 * left out — the working is still written — and why is kept for the log.
 */
export function cleanSketch(raw: unknown): { sketch?: FigureSpec; sketchDropped?: string } {
  if (raw === undefined || raw === null) return {};
  const parsed = FigureSpecSchema.safeParse(raw);
  if (!parsed.success) return { sketchDropped: parsed.error.issues[0]?.message ?? "not a figure" };
  const problems = checkFigure(parsed.data);
  if (problems.length > 0) return { sketchDropped: problems[0] };
  return { sketch: parsed.data };
}
