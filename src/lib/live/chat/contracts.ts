import { z } from "zod";
import { FigureSpecSchema } from "../figureDraw/contracts";

/**
 * The board chat (POST /api/live/chat): a student or teacher types a request — "5 two-step
 * equations", "graph y = sin x from -2π to 2π", "draw a right triangle with legs 3 and 4", "a new
 * screen", "clear your writing" — and the tutor carries it out ON THE BOARD, in its hand. The
 * panel shows one short reply; the board gets maths only (no words), and every problem is checked
 * by the local engine before it is written.
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
} as const;

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
});
export type ChatScreen = z.infer<typeof ChatScreenSchema>;

export const ChatRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  message: z.string().trim().min(1).max(CHAT_LIMITS.message),
  history: z.array(ChatTurnSchema).max(CHAT_LIMITS.turns).default([]),
  screen: ChatScreenSchema,
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

export const ChatActionSchema = z.discriminatedUnion("type", [
  WriteProblemsSchema,
  WriteLinesSchema,
  GraphActionSchema,
  DrawFigureSchema,
  NewScreenSchema,
  ClearTutorSchema,
  WriteProofSchema,
]);
export type ChatAction = z.infer<typeof ChatActionSchema>;
export type ChatActionType = ChatAction["type"];
export const CHAT_ACTION_TYPES = ["write_problems", "write_lines", "graph", "draw_figure", "new_screen", "clear_tutor", "write_proof"] as const satisfies readonly ChatActionType[];

// ------------------------------------------------------------------ response

export const ChatResponseSchema = z.object({
  /** one or two short sentences for the panel (never written on the board) */
  reply: z.string().min(1).max(CHAT_LIMITS.reply * 2),
  actions: z.array(ChatActionSchema).max(CHAT_LIMITS.actions),
  /** what the route dropped and why, in words for the panel ("The figure couldn't be drawn.") */
  notes: z.array(z.string().max(200)).max(8).default([]),
  /** true when every action the model proposed was dropped and the credits were given back */
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
