import { z } from "zod";
import { FigureSpecSchema } from "../figureDraw/contracts";
import { LearnerHintSchema } from "@/lib/learning/hint";

/**
 * The board chat (POST /api/live/chat): a student or teacher types a request — "5 two-step
 * equations", "graph y = sin x from -2π to 2π", "draw a right triangle with legs 3 and 4", "a new
 * screen", "clear your writing", "explain it step by step" — and the tutor carries it out ON THE
 * BOARD, in its hand. The panel shows one short reply; the board gets maths (words only where a
 * teacher writes them: a worked solution's sentences, a proof's reasons), and every problem, every
 * proof and every line of a worked solution is checked by the local engine before it is written.
 *
 * The request carries the message, a few recent turns and a compact picture of the current screen
 * (the student's lines as read, the tutor's lines, the problems it wrote, whether it is empty), so
 * "3 more like these" works. The reply is `{ reply, actions }`; the client runs the actions one at
 * a time (`LiveController.runChatActions`).
 */

export const CHAT_LIMITS = {
  /** the typed request */
  message: 500,
  /** recent turns sent with it (both sides) */
  turns: 6,
  turnText: 400,
  /** lines of the screen picture, each side */
  screenLines: 24,
  lineLatex: 300,
  /** actions per reply (more are dropped) */
  actions: 6,
  /** problems in one `write_problems` */
  problems: 12,
  /** lines of one problem (a system of equations is one problem of 2–3 lines) */
  problemLines: 3,
  /** lines of one `write_lines` */
  lines: 8,
  /** relations of one `graph` (a system is two or three) */
  relations: 3,
  reply: 280,
  /** a `write_proof`'s Given statements, and one statement's length */
  proofGivens: 4,
  proofStatement: 200,
  /** the end of a screen's lecture transcript sent with a request */
  lecture: 3000,
  /** a worked solution (`teach`): its steps, a step's sentence (asked for in ~90), a step's maths lines */
  teachSteps: 8,
  teachSay: 140,
  teachLines: 6,
  /** the problem the student typed earlier, sent when it has left the recent turns */
  problem: 600,
} as const;

/**
 * Plain words as the hand writes them: letters, digits, spaces and everyday punctuation (the maths
 * symbols the hand has — √, ², π, °, ∠ — included). No LaTeX (`\`), no `$`, no markup, one line (the
 * planner wraps it). Lecture mode's headings and notes, and a worked solution's sentences.
 */
export function plainWords(max: number, min = 1) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !/[\\$<>{}\n\r\t]/.test(s), { message: "plain words only" });
}

/** LaTeX as the hand writes it: short, no `$` delimiters, no words (`\text{…}` is refused). */
export const ChatLatexSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHAT_LIMITS.lineLatex)
  .refine((s) => !/\$/.test(s), { message: "no $ delimiters" })
  .refine((s) => !/\\(?:text[a-z]*|mbox|mathrm\{[A-Za-z]{3,}|operatorname\{[A-Za-z]{5,})/.test(s), { message: "no words on the board" });

// ------------------------------------------------------------------ request

export const ChatTurnSchema = z.object({
  role: z.enum(["user", "tutor"]),
  text: z.string().trim().min(1).max(CHAT_LIMITS.turnText),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/** What is on the current screen, as maths: what "more like these" and "graph that" refer to. */
export const ChatScreenSchema = z.object({
  /** nothing on the screen at all (no ink, no tutor writing, no image) */
  empty: z.boolean(),
  /** the student's lines as read (LaTeX), in reading order */
  student: z.array(z.string().max(CHAT_LIMITS.lineLatex)).max(CHAT_LIMITS.screenLines).default([]),
  /** the tutor's handwritten lines (worked steps, formulas), in writing order; problems are below */
  tutor: z.array(z.string().max(CHAT_LIMITS.lineLatex)).max(CHAT_LIMITS.screenLines).default([]),
  /** the problems the chat wrote on this screen, in order (a system is its lines joined by "; ") */
  problems: z.array(z.string().max(CHAT_LIMITS.lineLatex * CHAT_LIMITS.problemLines)).max(CHAT_LIMITS.problems).default([]),
  /**
   * each problem's number as written on the board, in the order of `problems` ("help me with 7" on
   * a screen holding 5–8 of a set). Absent (an older client): 1, 2, 3… in order.
   */
  numbers: z.array(z.number().int().min(1).max(999)).max(CHAT_LIMITS.problems).optional(),
  /**
   * The end of what lecture mode heard while this screen was the current one (its page meta), so
   * "what did she say about X?" can be answered in the panel. Absent: no lecture on this screen.
   */
  lecture: z.string().max(CHAT_LIMITS.lecture).optional(),
});
export type ChatScreen = z.infer<typeof ChatScreenSchema>;

export const ChatRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  message: z.string().trim().min(1).max(CHAT_LIMITS.message),
  history: z.array(ChatTurnSchema).max(CHAT_LIMITS.turns).default([]),
  screen: ChatScreenSchema,
  /**
   * The last problem the student typed, when it is no longer in `history` ("do the actual problem"
   * six turns after the problem was asked): what "it" is.
   */
  problem: z.string().trim().min(1).max(CHAT_LIMITS.problem).optional(),
  /** what the tutor knows about this student: "practice my weak spots" and recurring mistakes */
  learner: LearnerHintSchema.optional(),
});
export type ChatRequest = z.input<typeof ChatRequestSchema>;

// ------------------------------------------------------------------ actions

/**
 * A problem the student solves: one line (`2x + 3 = 11`, `x^{2} + 5x + 6`, `\frac{d}{dx}(x^{3})`)
 * or a system (2–3 equations). Written numbered, in a grid with room to work under each.
 */
export const ChatProblemSchema = z.union([ChatLatexSchema.transform((s) => [s]), z.array(ChatLatexSchema).min(1).max(CHAT_LIMITS.problemLines)]);

export const WriteProblemsSchema = z.object({
  type: z.literal("write_problems"),
  problems: z.array(ChatProblemSchema).min(1).max(CHAT_LIMITS.problems),
});

/** Maths written as given (a formula, a definition): `x = \frac{-b \pm \sqrt{b^{2} - 4ac}}{2a}`. */
export const WriteLinesSchema = z.object({
  type: z.literal("write_lines"),
  lines: z.array(ChatLatexSchema).min(1).max(CHAT_LIMITS.lines),
});

const finite = z.number().finite();
export const ChatWindowSchema = z
  .object({ xMin: finite, xMax: finite, yMin: finite.optional(), yMax: finite.optional() })
  .refine((w) => w.xMax > w.xMin && w.xMax - w.xMin <= 1000, { message: "xMax must be above xMin" })
  .refine((w) => w.yMin === undefined || w.yMax === undefined || (w.yMax > w.yMin && w.yMax - w.yMin <= 1000), { message: "yMax must be above yMin" });
export type ChatWindow = z.infer<typeof ChatWindowSchema>;

/** One relation or a system: `y = x^{2}`, `y < 2x + 1`, `x^{2} + y^{2} = 25`, two lines. */
export const GraphActionSchema = z.object({
  type: z.literal("graph"),
  relations: z.array(ChatLatexSchema).min(1).max(CHAT_LIMITS.relations),
  window: ChatWindowSchema.optional(),
});

/** A geometry figure, true to scale (`src/lib/live/figureDraw/contracts.ts`). */
export const DrawFigureSchema = z.object({
  type: z.literal("draw_figure"),
  figure: FigureSpecSchema,
});

export const NewScreenSchema = z.object({ type: z.literal("new_screen") });
/** Erase the tutor's ink on this screen (its writing, marks, graphs, figures). */
export const ClearTutorSchema = z.object({ type: z.literal("clear_tutor") });

/**
 * Help with a problem the chat wrote on this screen, by its number on the board: the tutor works it
 * under the problem in its hand — `step`, the next step (continuing from the student's last good
 * line under it, else from the tutor's own last step there, else the first); `solve`, the rest of it
 * worked out. The engine does the maths (`LiveLoop.chatHelp`); the model only says which and how
 * much. A number not on the screen is dropped with a note.
 */
export const HelpProblemSchema = z.object({
  type: z.literal("help_problem"),
  problem: z.number().int().min(1).max(999),
  depth: z.enum(["step", "solve"]),
});

/**
 * One statement of a two-column proof as the proof reader reads a student's
 * (`src/lib/live/proof/facts.ts`): `\overline{AB} \cong \overline{CB}`, `\triangle ABD \cong
 * \triangle CBD`, `M \text{ is the midpoint of } \overline{AB}`. Words only as that reader reads
 * them — the board never writes the model's words: the statement is parsed into facts and written
 * back in the reader's own forms (`chat/proof.ts`).
 */
export const ProofStatementSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHAT_LIMITS.proofStatement)
  .refine((s) => !/\$/.test(s), { message: "no $ delimiters" });

/**
 * A two-column proof, written by the tutor (`worked`, the default) or set up for the student to do
 * (`worked: false`: the figure, `Given:`, `Prove:` and an empty Statements | Reasons table). Nothing
 * of it reaches the board until the engine's proof planner has proved it with the figure's own
 * geometry (`checkProofProposal`); a worked proof's rows are the planner's, every one ticked by the
 * checker.
 */
export const WriteProofSchema = z.object({
  type: z.literal("write_proof"),
  figure: FigureSpecSchema,
  given: z.array(ProofStatementSchema).min(1).max(CHAT_LIMITS.proofGivens),
  prove: ProofStatementSchema,
  worked: z.boolean().default(true),
});
export type WriteProofAction = z.infer<typeof WriteProofSchema>;

/**
 * One step of a worked solution: what happens, in a sentence (`say`, plain words), and the maths
 * of it (`math`, LaTeX lines): a line, then lines starting with `=` that continue it
 * (`OR = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}`, `= \sqrt{31}`), or equations solved line by line.
 */
export const TeachStepSchema = z.object({
  say: plainWords(CHAT_LIMITS.teachSay, 0),
  math: z.array(ChatLatexSchema).max(CHAT_LIMITS.teachLines).default([]),
});

/**
 * A worked solution, written on the board the way a teacher writes one: the figure (true to scale,
 * the given numbers labelled) top right, the steps down the left — each sentence in the tutor's
 * hand, its maths under it — and the answer last, boxed. Nothing is written until the engine has
 * checked every line of maths (`chat/teach.ts`): one it cannot check is sent back once, else dropped.
 */
export const TeachSchema = z.object({
  type: z.literal("teach"),
  figure: FigureSpecSchema.optional(),
  steps: z.array(TeachStepSchema).min(1).max(CHAT_LIMITS.teachSteps),
  answer: ChatLatexSchema.optional(),
});
export type TeachAction = z.infer<typeof TeachSchema>;

export const ChatActionSchema = z.discriminatedUnion("type", [
  WriteProblemsSchema,
  WriteLinesSchema,
  GraphActionSchema,
  DrawFigureSchema,
  NewScreenSchema,
  ClearTutorSchema,
  HelpProblemSchema,
  WriteProofSchema,
  TeachSchema,
]);
export type ChatAction = z.infer<typeof ChatActionSchema>;
export type ChatActionType = ChatAction["type"];
export const CHAT_ACTION_TYPES = ["write_problems", "write_lines", "graph", "draw_figure", "new_screen", "clear_tutor", "help_problem", "write_proof", "teach"] as const satisfies readonly ChatActionType[];

/** The note for help asked about a problem that is not on this screen (the route's, and the board's). */
export function noProblemNote(n: number): string {
  return `There's no problem ${n} on this screen.`;
}

// ------------------------------------------------------------------ response

export const ChatResponseSchema = z.object({
  /** one or two short sentences for the panel (never written on the board) */
  reply: z.string().min(1).max(CHAT_LIMITS.reply * 2),
  actions: z.array(ChatActionSchema).max(CHAT_LIMITS.actions),
  /** what the route dropped and why, in words for the panel ("The figure couldn't be drawn.") */
  notes: z.array(z.string().max(200)).max(8).default([]),
  /** true when every action the model proposed was dropped and the ink was given back */
  refunded: z.boolean().optional(),
  model: z.string(),
  ms: z.number(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// ------------------------------------------------------------------ the board's side

/** What running one action did on the board. */
export interface ChatActionOutcome {
  type: ChatActionType;
  ok: boolean;
  /** a short note for the panel when something was left out ("2 of 5 problems couldn't be checked…") */
  note?: string;
}

export interface ChatRunReport {
  outcomes: ChatActionOutcome[];
  /** problems written, and dropped because the engine could not check them (or the hand write them) */
  problemsWritten: number;
  problemsDropped: number;
  /** screens the tutor added */
  screensAdded: number;
}
