import type { SetupRequest } from "@/lib/live/contracts";
import type { ChatMessage } from "@/lib/server/openrouter";

/**
 * System prompt for POST /api/live/setup WITH a crop: "the tutor reads the figure". The student
 * drew a figure (a triangle with its sides labelled, angles marked, a circle and its radius, a
 * rectangle, a number line, axes) and asked about it — Solve / Help on the drawing, or on a line
 * beside it such as `x = ?`. A vision model reads the image and writes the maths a student writes
 * beside the figure; exactly like a word problem's setup, it never calculates: the reply is checked
 * by the client (`validateSetupLines`) and solved by the local engine.
 *
 * The engine's constraints shape the rules: it reads single letters, not `\angle A`; it solves
 * `x + 40 + 65 = 180` but not the same line with degree signs; and a length must come out positive,
 * so Pythagoras is written as the equation and then the unknown as a square root.
 */
export const FIGURE_SYSTEM_PROMPT = [
  "You read a student's hand-drawn maths figure — a triangle, angles, a circle, a rectangle, a number line, axes — and write the maths a student writes beside it to find what it asks. You never calculate.",
  "",
  "INPUT: an image of the figure with its labels; the labels as a handwriting reader read them (they may be misread: the image is the truth); the student's lines beside the figure, top to bottom, if any (a line like x = ? names what is asked).",
  'OUTPUT: one JSON object and nothing else: {"unknown": "<the letter asked for>", "lines": ["<LaTeX>", ...]}',
  "",
  "RULES:",
  "1. lines set the problem up from the figure, top to bottom, at most 4: the relation the figure shows (Pythagoras, the angles of a triangle, angles on a straight line, a perimeter or an area with the lengths in), then, when the unknown is squared, the unknown alone.",
  "2. Use the figure's own letters: a side labelled x is x, a vertex angle A is A. One letter per quantity. No \\angle, no \\triangle, no words, no units.",
  "3. Angles are plain numbers of degrees, without the degree sign: x + 40 + 65 = 180.",
  "4. Never compute: leave the arithmetic unsimplified, and never state the answer. A length found by Pythagoras is the equation, then the unknown as a square root: x^{2} = 3^{2} + 4^{2}, x = \\sqrt{3^{2} + 4^{2}}.",
  "5. KaTeX-renderable LaTeX, one relation per line; EVERY line contains =, < or >.",
  '6. If the figure asks nothing you can set up this way (no unknown marked, or not a figure), answer {"unknown": "", "lines": []}.',
].join("\n");

function numbered(lines: readonly string[]): string {
  return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

/** Build the multimodal messages for a figure (image first, as the reread route sends it). */
export function buildFigureMessages(req: Pick<SetupRequest, "lines" | "labels" | "crop">): ChatMessage[] {
  const labels = (req.labels ?? []).map((l) => l.trim()).filter(Boolean);
  const lines = req.lines.map((l) => l.trim()).filter(Boolean);
  const text = [
    labels.length > 0 ? `Labels read on the figure: ${labels.join(", ")}` : "Labels read on the figure: none",
    lines.length > 0 ? `The student's lines beside it, top to bottom:\n${numbered(lines)}` : "No lines beside it.",
    "JSON only.",
  ].join("\n");
  return [
    { role: "system", content: FIGURE_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: req.crop ?? "" } },
        { type: "text", text },
      ],
    },
  ];
}

/** Minimal reasoning for the models that take it (Anthropic's thinking is off by default). */
export function figureReasoning(model: string): "low" | undefined {
  return model.startsWith("anthropic/") ? undefined : "low";
}
