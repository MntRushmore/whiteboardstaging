import { z } from "zod";
import {
  CHAT_LIMITS,
  ChatActionSchema,
  ChatProblemSchema,
  noProblemNote,
  ProofStatementSchema,
  type ChatAction,
  type ChatActionType,
  type ChatRequest,
  type WriteProofAction,
  CHAT_ACTION_TYPES,
} from "@/lib/live/chat/contracts";
import { FigureSpecSchema, type FigureSpec } from "@/lib/live/figureDraw/contracts";
import type { ChatMessage } from "@/lib/server/openrouter";

/**
 * System prompt for POST /api/live/chat: a typed request → a short reply for the panel and the
 * actions the board carries out in the tutor's hand. The model plans; it never solves and never
 * writes words on the board. Every problem it proposes is checked by the board's engine before it
 * is written (`src/lib/live/chat/verify.ts`), every action is validated with zod here, and an
 * invalid one is dropped, never guessed at. Two exceptions to "never solves", both worked by the
 * engine, not the model: help with a problem on the board (`help_problem`), and a proof asked for,
 * where the model chooses the proof (`write_proof`: figure, givens, what to prove — never a
 * question back) and the engine's planner finds and checks its rows (`chat/proof.ts`); an algebra
 * proof is maths lines, every step checked equal.
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

// ------------------------------------------------------------------ proofs (write_proof)

/**
 * Proofs the prompt shows the model, one per kind of ask. Every one is proved by the board's engine
 * (`checkProofProposal`: `prompts/chat.test.ts` holds them to it), so an example copied as it is
 * still reaches the board.
 */
export const PROOF_EXAMPLES: ReadonlyArray<{ request: string; reply: string; action: WriteProofAction }> = [
  {
    request: "write a proof",
    reply: "Here is a two-column proof: E is the midpoint of both segments, so the triangles are congruent by SAS.",
    action: {
      type: "write_proof",
      figure: {
        points: { A: { x: 0, y: 4 }, B: { x: 1, y: 0 }, C: { x: 9, y: 4 }, D: { x: 10, y: 0 }, E: { x: 5, y: 2 } },
        segments: [
          { from: "A", to: "E", ticks: 1 },
          { from: "E", to: "D", ticks: 1 },
          { from: "B", to: "E", ticks: 2 },
          { from: "E", to: "C", ticks: 2 },
          { from: "A", to: "B" },
          { from: "C", to: "D" },
        ],
      },
      given: ["E \\text{ is the midpoint of } \\overline{AD}", "E \\text{ is the midpoint of } \\overline{BC}"],
      prove: "\\triangle ABE \\cong \\triangle DCE",
      worked: true,
    },
  },
  {
    request: "give me a proof to do",
    reply: "Your turn: prove the two triangles in this kite are congruent. Write each statement and its reason in the table.",
    action: {
      type: "write_proof",
      figure: {
        points: { A: { x: 0, y: 0 }, B: { x: 5, y: 4 }, C: { x: 10, y: 0 }, D: { x: 5, y: -8 } },
        segments: [
          { from: "A", to: "B", ticks: 1 },
          { from: "C", to: "B", ticks: 1 },
          { from: "A", to: "D", ticks: 2 },
          { from: "C", to: "D", ticks: 2 },
          { from: "B", to: "D" },
        ],
      },
      given: ["\\overline{AB} \\cong \\overline{CB}", "\\overline{AD} \\cong \\overline{CD}"],
      prove: "\\triangle ABD \\cong \\triangle CBD",
      worked: false,
    },
  },
  {
    request: "prove that the base angles of an isosceles triangle are congruent",
    reply: "Here is the proof: the median AD splits the triangle into two congruent halves (SSS), so the base angles match by CPCTC.",
    action: {
      type: "write_proof",
      figure: {
        points: { A: { x: 3, y: 5 }, B: { x: 0, y: 0 }, C: { x: 6, y: 0 }, D: { x: 3, y: 0 } },
        segments: [
          { from: "A", to: "B", ticks: 1 },
          { from: "A", to: "C", ticks: 1 },
          { from: "B", to: "D", ticks: 2 },
          { from: "D", to: "C", ticks: 2 },
          { from: "A", to: "D" },
        ],
      },
      given: ["\\overline{AB} \\cong \\overline{AC}", "D \\text{ is the midpoint of } \\overline{BC}"],
      prove: "\\angle B \\cong \\angle C",
      worked: true,
    },
  },
  {
    request: "write the hardest proof ever",
    reply: "Challenge accepted: two pairs of overlapping triangles, chained through CPCTC into a third pair, to show P is just as far from B as from C.",
    action: {
      type: "write_proof",
      figure: {
        points: { A: { x: 0, y: 12 }, B: { x: -6, y: 0 }, C: { x: 6, y: 0 }, D: { x: -2, y: 8 }, E: { x: 2, y: 8 }, P: { x: 0, y: 6 } },
        segments: [
          { from: "A", to: "D", ticks: 1 },
          { from: "A", to: "E", ticks: 1 },
          { from: "D", to: "B", ticks: 2 },
          { from: "E", to: "C", ticks: 2 },
          { from: "B", to: "C" },
          { from: "B", to: "E" },
          { from: "C", to: "D" },
        ],
      },
      given: ["\\overline{AB} \\cong \\overline{AC}", "\\overline{AD} \\cong \\overline{AE}", "\\overline{BD} \\cong \\overline{CE}"],
      prove: "\\overline{BP} \\cong \\overline{CP}",
      worked: true,
    },
  },
];

/** An algebra proof: maths lines, each one equal to the line above (`verifyLines` checks every step). */
export const ALGEBRA_PROOF_EXAMPLE = {
  request: "prove the sum of two odd numbers is even",
  reply: "Two odd numbers are 2m + 1 and 2n + 1; their sum is 2 times a whole number, so it is even.",
  lines: ["(2m + 1) + (2n + 1)", "= 2m + 2n + 2", "= 2(m + n + 1)"],
} as const;

const PROOF_SECTION = [
  "PROOFS (write_proof):",
  '- "write a proof", "a two-column proof", "show me a proof", "write a proof for me", "prove that …" (geometry), "a hard proof", "the hardest proof ever" → write_proof with "worked": true: the TUTOR writes the whole proof, every row (the student asked to see one, not to do one). Never ask which proof: choose a sensible one yourself.',
  '- ONLY when the student asks for a proof to do themselves — "give me a proof to do", "a proof problem", "a proof I can try", "a proof for me to practise" — "worked": false (the figure, Given, Prove and an empty table for the student).',
  "- The board's proof engine finds and checks every row itself (you never write the rows), so the proof must use only: Given, Reflexive, Transitive, SSS, SAS, ASA, AAS, HL, CPCTC, Vertical ∠s, Def. of midpoint, Def. of ∠ bisector, Def. of seg. bisector, Def. of ⊥ (right angles are congruent), Alt. int. / Alt. ext. / Corr. ∠s with parallel lines (and their converses), the Isosceles △ theorem and its converse. No similarity, no angle or segment addition, no linear pairs, no circles, no algebra.",
  '- "given": 1 to 4 statements; "prove": ONE statement — two congruent triangles, segments or angles, or two parallel lines. Write statements as: \\overline{AB} \\cong \\overline{CD}; \\angle ABC \\cong \\angle DEF (three letters, vertex in the middle); \\triangle ABC \\cong \\triangle DEF (matching vertices in the same order); \\overline{AB} \\parallel \\overline{CD}; \\overline{AD} \\perp \\overline{BC}; m\\angle ABC = 90^{\\circ}; M \\text{ is the midpoint of } \\overline{AB}; \\overrightarrow{BD} \\text{ bisects } \\angle ABC; \\overline{CD} \\text{ bisects } \\overline{AB} \\text{ at } M.',
  "- The figure: every point named by ONE capital letter; TRUE TO SCALE so every given is exactly true in the drawing (congruent sides the same length, a midpoint exactly in the middle, perpendicular lines at 90°, parallel lines parallel); EVERY side of every triangle in the proof drawn (segments), and a point on a side exactly on it. Mark the givens: equal ticks on congruent sides, arcs on congruent angles, a right-angle mark. No numbers as labels.",
  "- A proof OF a theorem must not use that theorem: to prove the base angles of an isosceles triangle congruent, draw the median AD to the midpoint D of the base and prove the two halves congruent (SSS), then CPCTC.",
  '- "Hard" or "the hardest proof ever": a genuinely demanding one — overlapping triangles, congruences chained through CPCTC, several givens working together (isosceles + midpoint + perpendicular) — still only with those reasons, at most 12 rows; a playful one-line reply. For "the hardest proof ever" use the example below (the engine proves it) unless the student asks for a different or new one; a new one must still give every congruence its three parts from the givens or earlier rows.',
  `- An ALGEBRA proof ("prove the sum of two odd numbers is even", "prove (a + b)^{2} = a^{2} + 2ab + b^{2}") is not write_proof: it is write_lines, maths only, from the left side down, each next line starting with "=" and equal to the line above: ${JSON.stringify(ALGEBRA_PROOF_EXAMPLE.lines)}. No words on the board: the reply says what it shows.`,
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
  '- {"type": "new_screen"} — a blank screen after the others, and the tutor moves to it. ONLY when the student asks for a new screen: the board puts problems on a fresh screen by itself and finds room for a graph, a figure or lines (a new screen when this one is full).',
  '- {"type": "clear_tutor"} — erase the tutor\'s writing on this screen (never the student\'s).',
  '- {"type": "help_problem", "problem": 3, "depth": "step"} — the tutor helps with a problem it wrote on this screen, by its number as listed under "Problems the tutor wrote here", working it in its handwriting under the problem: "step" writes the next step (from where the work under it stands), "solve" writes the rest of it worked out. The board\'s maths engine does the working and checks it; you only choose which problem and how much.',
  '- {"type": "write_proof", "figure": {...}, "given": ["<statement>", ...], "prove": "<statement>", "worked": true} — a two-column geometry proof in the tutor\'s hand: the figure (format below), Given, Prove and a Statements | Reasons table; "worked": true writes every row (the board\'s proof engine finds them), "worked": false leaves the table for the student (PROOFS below).',
  "",
  "RULES:",
  "1. The board gets maths only: LaTeX (KaTeX), no words, no \\text, no $, no instructions. The words go in the reply.",
  "2. Problems are what a student at the level asked for can solve by hand. Unless asked otherwise, choose numbers so every answer is clean (whole numbers or simple fractions) and each problem is different. Match the count asked for; \"a few\" or no count is 4.",
  "3. Write each problem so its form says what to do: an equation or inequality to solve (2x + 3 = 11, x^{2} - 5x + 6 = 0, 3 - 2x > 7, |x - 3| = 5, \\sqrt{x + 3} = 5, 2^{x + 1} = 16, \\log_{2}(x) = 5); an expression to simplify, factor or expand (x^{2} + 5x + 6, (x + 3)^{2}, 4(2x - 1) - 3x, \\frac{12x^{5}}{3x^{2}}, (3 + 2i)(1 - i)); arithmetic to work out (\\frac{3}{4} + \\frac{1}{6}); a derivative, integral or limit (\\frac{d}{dx}(x^{3} + 2x), \\int (3x^{2} + 1) \\, dx, \\int_{0}^{2} x^{2} \\, dx, \\lim_{x \\to 2} \\frac{x^{2} - 4}{x - 2}); a trig equation with its interval (2\\cos x - 1 = 0, \\ 0 \\le x < 2\\pi); geometry as the equation a student writes (3^{2} + 4^{2} = c^{2}, x + 40 + 65 = 180). Never an instruction word.",
  "4. You NEVER solve yourself: no answers, no steps, no hints in the reply or in any LaTeX you write. For a problem listed on this screen, help_problem has the tutor work it on the board (rule 8). A proof asked for is the other exception: write_proof (the engine writes its rows) or, for algebra, write_lines (PROOFS below). Asked to solve something that is not on the board, write it as a problem and say that the Solve tab works it out step by step.",
  "5. \"More like these\", \"harder\", \"another one\": the same kind as the problems (or the student's lines) on this screen, with new numbers; harder means one more step or less friendly numbers, still clean answers.",
  "6. A graph or figure the student asks for is drawn, not solved: no answers written beside it.",
  "7. Anything that is not maths help on this board, or is unsafe or unkind: reply politely that you can only help with maths on the board, and no actions. A request you cannot tell apart: ask one short question, no actions — but never for a proof: choose one.",
  '8. Help with a problem listed on this screen is help_problem — never a question back when it is clear which problem is meant: a number ("help me with 3", "I\'m stuck on 2", "how do I start 3"), or "it", "this one", "that one": the problem the chat so far was about, else the only problem on the screen. Asking for HELP — help, being stuck, how to start, what to do next — is depth "step": one step at a time, the next one each time they ask. The word "help" makes it a step even with "solve" in it: "help me solve it" and "help me solve 3" are depth "step" — also right after a step was written (the student is working it with the tutor: the next step). Asking for the SOLUTION with no "help" — "solve 3", "solve it", "show me how to solve it", "work out 3", "what\'s the answer to 1" — is depth "solve". The reply says what the tutor wrote, in plain words, no maths: "I wrote the next step under problem 3." Only with several problems here and nothing saying which, ask which one (no actions). With no problems listed here, never help_problem.',
  "",
  FIGURE_FORMAT,
  "",
  PROOF_SECTION,
  "",
  "EXAMPLES:",
  'Request: 3 two-step equations → {"reply": "Here are 3 two-step equations to solve.", "actions": [{"type": "write_problems", "problems": ["3x + 4 = 19", "\\\\frac{x}{2} - 5 = 1", "7 - 2x = 13"]}]}',
  'Request: graph y = sin x from -2π to 2π → {"reply": "Here is y = sin x from -2π to 2π.", "actions": [{"type": "graph", "relations": ["y = \\\\sin x"], "window": {"xMin": -6.2832, "xMax": 6.2832}}]}',
  'Request: draw a right triangle with legs 3 and 4 and label the hypotenuse x → {"reply": "Here is the right triangle; the hypotenuse is x.", "actions": [{"type": "draw_figure", "figure": {"points": {"A": {"x": 0, "y": 0}, "B": {"x": 4, "y": 0}, "C": {"x": 0, "y": 3}}, "segments": [{"from": "A", "to": "B", "label": "4"}, {"from": "A", "to": "C", "label": "3"}, {"from": "B", "to": "C", "label": "x"}], "angles": [{"at": "A", "from": "B", "to": "C", "right": true}]}}]}',
  'Request: help me with 3 (problems 1 to 3 on the screen) → {"reply": "I wrote the next step under problem 3.", "actions": [{"type": "help_problem", "problem": 3, "depth": "step"}]}',
  'Request: help me solve it (one problem on the screen) → {"reply": "I wrote the next step under problem 1.", "actions": [{"type": "help_problem", "problem": 1, "depth": "step"}]}',
  'Request: show me how to solve it (the chat so far was about problem 2) → {"reply": "I worked out problem 2 under it.", "actions": [{"type": "help_problem", "problem": 2, "depth": "solve"}]}',
  ...PROOF_EXAMPLES.map((e) => `Request: ${e.request} → ${JSON.stringify({ reply: e.reply, actions: [e.action] })}`),
  `Request: ${ALGEBRA_PROOF_EXAMPLE.request} → ${JSON.stringify({ reply: ALGEBRA_PROOF_EXAMPLE.reply, actions: [{ type: "write_lines", lines: ALGEBRA_PROOF_EXAMPLE.lines }] })}`,
  'Request: what\'s the capital of France? → {"reply": "I can only help with maths on this board. Try asking for some practice problems or a graph.", "actions": []}',
].join("\n");

/** Each problem's number on the board, in the order of `problems` (1, 2, 3… when the client sent none). */
export function problemNumbers(screen: Pick<ChatRequest["screen"], "problems" | "numbers">): number[] {
  const problems = screen.problems ?? [];
  const numbers = screen.numbers ?? [];
  return problems.map((_, i) => numbers[i] ?? i + 1);
}

/**
 * Help asked about a problem that is not on this screen ("help me with 7" beside problems 1 to 3)
 * is dropped, with a note for the panel, never guessed at: the board would have nothing to work.
 */
export function dropMissingProblems(
  actions: readonly ChatAction[],
  screen: Pick<ChatRequest["screen"], "problems" | "numbers">,
): { actions: ChatAction[]; dropped: DroppedAction[]; notes: string[] } {
  const here = new Set(problemNumbers(screen));
  const kept: ChatAction[] = [];
  const dropped: DroppedAction[] = [];
  const notes: string[] = [];
  for (const a of actions) {
    if (a.type === "help_problem" && !here.has(a.problem)) {
      dropped.push({ type: a.type, reason: `no problem ${a.problem} on the screen` });
      const note = noProblemNote(a.problem);
      if (!notes.includes(note)) notes.push(note);
      continue;
    }
    kept.push(a);
  }
  return { actions: kept, dropped, notes };
}

/** The screen, the chat so far and the request, as the model reads them. */
export function buildChatMessages(req: Pick<ChatRequest, "message" | "history" | "screen">): ChatMessage[] {
  const screen = req.screen;
  const out: string[] = [];
  out.push(`THIS SCREEN: ${screen.empty ? "empty" : "has work on it"}`);
  const problems = screen.problems ?? [];
  const student = screen.student ?? [];
  const tutor = screen.tutor ?? [];
  // numbered as on the board ("help me with 7" on a screen holding 5 to 8 of a set)
  const numbers = problemNumbers(screen);
  if (problems.length) out.push("Problems the tutor wrote here:", ...problems.map((p, i) => `${numbers[i]}. ${p}`));
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

/**
 * A figure's points with a `label` or `dot` that is not true / false (`"label": "A"`: the model
 * restating the name, which is written anyway) lose it, instead of the whole figure being dropped.
 */
function lenientFigure(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const fig = v as Record<string, unknown>;
  if (!fig.points || typeof fig.points !== "object" || Array.isArray(fig.points)) return v;
  const points: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(fig.points as Record<string, unknown>)) {
    if (!p || typeof p !== "object") {
      points[name] = p;
      continue;
    }
    const q = { ...(p as Record<string, unknown>) };
    for (const k of ["label", "dot"]) if (k in q && typeof q[k] !== "boolean") delete q[k];
    points[name] = q;
  }
  return { ...fig, points };
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
    } else if (type === "help_problem") {
      // "3" or "3." for 3; no depth given is help, one step
      const n = typeof obj.problem === "string" && /^\s*\d{1,3}\.?\s*$/.test(obj.problem) ? Number.parseInt(obj.problem, 10) : obj.problem;
      candidate = { ...obj, problem: n, depth: obj.depth ?? "step" };
    } else if (type === "draw_figure") {
      candidate = { ...obj, figure: lenientFigure(obj.figure) };
    } else if (type === "write_proof") {
      // one Given as a string is a list of one; `worked` left out is a worked proof
      const given = typeof obj.given === "string" ? [obj.given] : obj.given;
      candidate = { ...obj, figure: lenientFigure(obj.figure), given: Array.isArray(given) ? given.map(unwrapLatex) : given, prove: unwrapLatex(obj.prove) };
      if (obj.worked === null) delete candidate.worked;
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

// ------------------------------------------------------------------ one repair round-trip for a proof

export const PROOF_REPAIR_PROMPT = [
  "You fix a two-column geometry proof so the board's proof engine can prove it and draw it. You are given the request, the proof (its figure, its givens and what it proves) and the problems the engine found.",
  'OUTPUT: one JSON object and nothing else: {"figure": { ...the corrected figure... }, "given": ["<statement>", ...], "prove": "<statement>"}',
  "Keep what the request asked for; change only what the problems need. The engine finds the rows itself. When the proof cannot be mended, or a harder one is asked for, an example below (each one proved by the engine) is a safe answer.",
  "",
  PROOF_SECTION,
  "",
  FIGURE_FORMAT,
  "",
  "EXAMPLES (the proof for each request):",
  ...PROOF_EXAMPLES.map((e) => `${e.request} → ${JSON.stringify({ figure: e.action.figure, given: e.action.given, prove: e.action.prove })}`),
].join("\n");

export function buildProofRepairMessages(request: string, proof: Pick<WriteProofAction, "figure" | "given" | "prove">, problems: readonly string[]): ChatMessage[] {
  return [
    { role: "system", content: PROOF_REPAIR_PROMPT },
    {
      role: "user",
      content: [
        `REQUEST: ${request.trim()}`,
        "",
        "PROOF:",
        JSON.stringify({ figure: proof.figure, given: proof.given, prove: proof.prove }),
        "",
        "PROBLEMS:",
        ...problems.map((p) => `- ${p}`),
        "",
        "JSON only.",
      ].join("\n"),
    },
  ];
}

export const ProofRepairReplySchema = z.object({
  figure: FigureSpecSchema,
  given: z.union([ProofStatementSchema.transform((s) => [s]), z.array(ProofStatementSchema).min(1).max(CHAT_LIMITS.proofGivens)]),
  prove: ProofStatementSchema,
});

/** Which action types the reply asked for (for the log). */
export function actionTypes(actions: readonly { type: ChatActionType }[]): string {
  return actions.map((a) => a.type).join(",");
}
