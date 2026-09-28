import { z } from "zod";
import {
  CHAT_LIMITS,
  ChatActionSchema,
  ChatProblemSchema,
  type ChatAction,
  type ChatActionType,
  type ChatRequest,
  CHAT_ACTION_TYPES,
} from "@/lib/live/chat/contracts";
import { FigureSpecSchema, type FigureSpec } from "@/lib/live/figureDraw/contracts";
import type { ChatMessage } from "@/lib/server/openrouter";

/**
 * System prompt for POST /api/live/chat: a typed request → a short reply for the panel and the
 * actions the board carries out in the tutor's hand. The model plans; it never solves and never
 * writes words on the board. Every problem it proposes is checked by the board's engine before it
 * is written (`src/lib/live/chat/verify.ts`), every action is validated with zod here, and an
 * invalid one is dropped, never guessed at.
 */

const FIGURE_FORMAT = [
  "FIGURE FORMAT (draw_figure.figure):",
  '{"points": {"A": {"x": 0, "y": 0}, ...}, "segments": [{"from": "A", "to": "B", "label": "4"}], "angles": [{"at": "A", "from": "B", "to": "C", "right": true}], "polygons": [{"vertices": ["A", "B", "C"]}], "lines": [{"through": ["P", "Q"], "extend": "both"}], "circles": [{"center": "O", "radius": 5}]}',
  "- points: named points (A, B, C, P1, O, B'), in figure units with y UP. TRUE TO SCALE: choose coordinates so that every length, angle and relation in the request is exactly true — a right triangle with legs 3 and 4 is A(0,0), B(4,0), C(0,3); an equilateral triangle of side 6 is (0,0), (6,0), (3, 5.196); a 40° angle at A has its arm at (cos 40°, sin 40°) × length. Any scale; keep numbers under 1000.",
  '- a point: {"x", "y"} plus optional "label": false (hide its name), "dot": true.',
  '- segments: sides drawn between two points; optional "label" (a length or unknown: "3", "x", "2x + 1"), "ticks": 1-3 (equal sides), "arrows": 1-3 (parallel sides), "dashed": true.',
  '- polygons: {"vertices": [...]} draws the closed shape (instead of listing its sides); add a segment only to label or mark a side.',
  '- lines: {"through": [P, Q], "extend": "both" | "ray"} a line (or a ray from P through Q) running past the points.',
  '- circles: {"center": "O", "radius": r} or {"center": "O", "through": "A"}.',
  '- angles: {"at": vertex, "from": point on one arm, "to": point on the other}, the smaller angle; "right": true for a right-angle box; "label" ("70^{\\circ}", "x", "\\theta"); "arcs": 1-3 for equal angles.',
  "- Every name a segment, angle, line or circle uses must be a point. Labels are short maths only (A, 3, x, 70^{\\circ}, 2x + 10): never words.",
].join("\n");

export const CHAT_SYSTEM_PROMPT = [
  "You are the tutor's hand on a student's maths whiteboard. The student (or their teacher) types a request; you answer with a one-line reply for the chat panel and the actions the tutor carries out ON THE BOARD in its handwriting.",
  "",
  "OUTPUT: one JSON object and nothing else:",
  '{"reply": "<one or two short sentences, plain words, no LaTeX, no $>", "actions": [<at most 6 actions>]}',
  "",
  "ACTIONS:",
  '- {"type": "write_problems", "problems": ["<LaTeX>", ...]} — 1 to 12 problems for the student to solve, written numbered in a grid with room to work (on a fresh screen when this one has work on it: you do not choose). A system of equations is ONE problem written as an array of its equations: ["x + y = 10", "x - y = 2"].',
  '- {"type": "write_lines", "lines": ["<LaTeX>", ...]} — maths written exactly as given: a formula or definition the student asked to see (the quadratic formula, the Pythagorean theorem, a derivative rule). Never a solution, never an answer.',
  '- {"type": "graph", "relations": ["<LaTeX>", ...], "window": {"xMin": -6.2832, "xMax": 6.2832}} — sketches a graph. Relations in x and y: y = x^{2}, y = 2x + 1, 2x + 3y = 6, y < 2x + 1, y \\ge x^{2} - 1, x^{2} + y^{2} = 25, y = \\sin x, f(x) = \\frac{1}{x - 2}; two or three of them are a system (drawn with where they cross); one inequality in x alone (x > 3, -2 \\le x < 3) is a number line. "window" only when a range is asked for: numbers (π = 3.14159…), yMin/yMax optional.',
  '- {"type": "draw_figure", "figure": {...}} — a geometry figure, drawn true to scale (format below).',
  '- {"type": "new_screen"} — a blank screen after the others, and the tutor moves to it.',
  '- {"type": "clear_tutor"} — erase the tutor\'s writing on this screen (never the student\'s).',
  "",
  "RULES:",
  "1. The board gets maths only: LaTeX (KaTeX), no words, no \\text, no $, no instructions. The words go in the reply.",
  "2. Problems are what a student at the level asked for can solve by hand. Unless asked otherwise, choose numbers so every answer is clean (whole numbers or simple fractions) and each problem is different. Match the count asked for; \"a few\" or no count is 4.",
  "3. Write each problem so its form says what to do: an equation or inequality to solve (2x + 3 = 11, x^{2} - 5x + 6 = 0, 3 - 2x > 7, |x - 3| = 5, \\sqrt{x + 3} = 5, 2^{x + 1} = 16, \\log_{2}(x) = 5); an expression to simplify, factor or expand (x^{2} + 5x + 6, (x + 3)^{2}, 4(2x - 1) - 3x, \\frac{12x^{5}}{3x^{2}}, (3 + 2i)(1 - i)); arithmetic to work out (\\frac{3}{4} + \\frac{1}{6}); a derivative, integral or limit (\\frac{d}{dx}(x^{3} + 2x), \\int (3x^{2} + 1) \\, dx, \\int_{0}^{2} x^{2} \\, dx, \\lim_{x \\to 2} \\frac{x^{2} - 4}{x - 2}); a trig equation with its interval (2\\cos x - 1 = 0, \\ 0 \\le x < 2\\pi); geometry as the equation a student writes (3^{2} + 4^{2} = c^{2}, x + 40 + 65 = 180). Never an instruction word.",
  "4. You NEVER solve: no answers, no steps, no hints on the board or in the reply. Asked to solve something, write it as a problem and say that the Solve tab works it out step by step.",
  "5. \"More like these\", \"harder\", \"another one\": the same kind as the problems (or the student's lines) on this screen, with new numbers; harder means one more step or less friendly numbers, still clean answers.",
  "6. A graph or figure the student asks for is drawn, not solved: no answers written beside it.",
  "7. Anything that is not maths help on this board, or is unsafe or unkind: reply politely that you can only help with maths on the board, and no actions. A request you cannot tell apart: ask one short question, no actions.",
  "",
  FIGURE_FORMAT,
  "",
  "EXAMPLES:",
  'Request: 3 two-step equations → {"reply": "Here are 3 two-step equations to solve.", "actions": [{"type": "write_problems", "problems": ["3x + 4 = 19", "\\\\frac{x}{2} - 5 = 1", "7 - 2x = 13"]}]}',
  'Request: graph y = sin x from -2π to 2π → {"reply": "Here is y = sin x from -2π to 2π.", "actions": [{"type": "graph", "relations": ["y = \\\\sin x"], "window": {"xMin": -6.2832, "xMax": 6.2832}}]}',
  'Request: draw a right triangle with legs 3 and 4 and label the hypotenuse x → {"reply": "Here is the right triangle; the hypotenuse is x.", "actions": [{"type": "draw_figure", "figure": {"points": {"A": {"x": 0, "y": 0}, "B": {"x": 4, "y": 0}, "C": {"x": 0, "y": 3}}, "segments": [{"from": "A", "to": "B", "label": "4"}, {"from": "A", "to": "C", "label": "3"}, {"from": "B", "to": "C", "label": "x"}], "angles": [{"at": "A", "from": "B", "to": "C", "right": true}]}}]}',
  'Request: what\'s the capital of France? → {"reply": "I can only help with maths on this board. Try asking for some practice problems or a graph.", "actions": []}',
].join("\n");

/** The screen, the chat so far and the request, as the model reads them. */
export function buildChatMessages(req: Pick<ChatRequest, "message" | "history" | "screen">): ChatMessage[] {
  const screen = req.screen;
  const out: string[] = [];
  out.push(`THIS SCREEN: ${screen.empty ? "empty" : "has work on it"}`);
  const problems = screen.problems ?? [];
  const student = screen.student ?? [];
  const tutor = screen.tutor ?? [];
  if (problems.length) out.push("Problems the tutor wrote here:", ...problems.map((p, i) => `${i + 1}. ${p}`));
  if (student.length) out.push("The student's lines (as read):", ...student.map((l) => `- ${l}`));
  if (tutor.length) out.push("The tutor's other lines:", ...tutor.map((l) => `- ${l}`));
  const history = req.history ?? [];
  if (history.length) {
    out.push("", "CHAT SO FAR:");
    for (const t of history) out.push(`${t.role === "user" ? "student" : "tutor"}: ${t.text}`);
  }
  out.push("", `REQUEST: ${req.message.trim()}`, "", "JSON only.");
  return [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    { role: "user", content: out.join("\n") },
  ];
}

// ------------------------------------------------------------------ the model's reply

/** The reply leniently: a field that is missing or of the wrong shape is empty (then judged below). */
export const ChatReplyRawSchema = z.object({
  reply: z.string().catch("").default(""),
  actions: z.array(z.unknown()).catch([]).default([]),
});
export type ChatReplyRaw = z.infer<typeof ChatReplyRawSchema>;

export interface DroppedAction {
  type: string;
  reason: string;
}

const KNOWN = new Set<string>(CHAT_ACTION_TYPES);

/** `$…$` round a line is packaging, not maths. */
function unwrapLatex(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/^\s*\$+|\$+\s*$/g, "").trim();
  if (Array.isArray(v)) return v.map(unwrapLatex);
  return v;
}

/** A reply for the panel: plain, short, cut at a sentence end. */
export function cleanReplyText(text: string): string {
  const flat = text.replace(/\$+/g, "").replace(/\s+/g, " ").trim();
  if (flat.length <= CHAT_LIMITS.reply) return flat;
  const cut = flat.slice(0, CHAT_LIMITS.reply);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 40 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
}

/**
 * The model's actions, validated one by one: an action of an unknown type or the wrong shape is
 * dropped (with why, for the log and the eval), never repaired by guessing. Within a problem set,
 * a problem that is not valid LaTeX for the board (words, `$`, too long) is dropped and the rest
 * kept. At most `CHAT_LIMITS.actions`.
 */
export function cleanChatActions(raw: readonly unknown[]): { actions: ChatAction[]; dropped: DroppedAction[] } {
  const actions: ChatAction[] = [];
  const dropped: DroppedAction[] = [];
  for (const item of raw) {
    const obj = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
    const type = typeof obj?.type === "string" ? obj.type : "";
    if (!obj || !KNOWN.has(type)) {
      dropped.push({ type: type || "?", reason: "unknown action" });
      continue;
    }
    if (actions.length >= CHAT_LIMITS.actions) {
      dropped.push({ type, reason: "too many actions" });
      continue;
    }
    let candidate: Record<string, unknown> = obj;
    if (type === "write_problems" && Array.isArray(obj.problems)) {
      const problems = obj.problems.map(unwrapLatex).filter((p) => ChatProblemSchema.safeParse(p).success);
      const bad = obj.problems.length - problems.length;
      if (bad > 0) dropped.push({ type, reason: `${bad} invalid problem${bad === 1 ? "" : "s"}` });
      candidate = { ...obj, problems: problems.slice(0, CHAT_LIMITS.problems) };
    } else if (type === "write_lines" && Array.isArray(obj.lines)) {
      candidate = { ...obj, lines: obj.lines.map(unwrapLatex) };
    } else if (type === "graph" && Array.isArray(obj.relations)) {
      candidate = { ...obj, relations: obj.relations.map(unwrapLatex) };
      if (obj.window === null) delete candidate.window;
    }
    const parsed = ChatActionSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      dropped.push({ type, reason: `${issue?.path.join(".") || "action"}: ${issue?.message ?? "invalid"}`.slice(0, 160) });
      continue;
    }
    actions.push(parsed.data);
  }
  return { actions, dropped };
}

// ------------------------------------------------------------------ one repair round-trip for a figure

export const FIGURE_REPAIR_PROMPT = [
  "You fix a geometry figure spec so a drawing program can draw it. You are given the request, the spec and the problems the program found.",
  'OUTPUT: one JSON object and nothing else: {"figure": { ...the corrected spec... }}',
  "Change only what the problems need; keep it true to scale.",
  "",
  FIGURE_FORMAT,
].join("\n");

export function buildFigureRepairMessages(request: string, figure: FigureSpec, problems: readonly string[]): ChatMessage[] {
  return [
    { role: "system", content: FIGURE_REPAIR_PROMPT },
    {
      role: "user",
      content: [`REQUEST: ${request.trim()}`, "", "SPEC:", JSON.stringify(figure), "", "PROBLEMS:", ...problems.map((p) => `- ${p}`), "", "JSON only."].join("\n"),
    },
  ];
}

export const FigureRepairReplySchema = z.object({ figure: FigureSpecSchema });

/** Which action types the reply asked for (for the log). */
export function actionTypes(actions: readonly { type: ChatActionType }[]): string {
  return actions.map((a) => a.type).join(",");
}
