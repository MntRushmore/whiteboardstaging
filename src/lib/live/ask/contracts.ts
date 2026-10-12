import { z } from "zod";
import { LearnerHintSchema } from "@/lib/learning/hint";
import { ChatActionSchema, ChatScreenSchema } from "../chat/contracts";

/**
 * Ask, rebuilt (docs/ASK-V2.md): the board chat as a real tutor. The student types or says
 * anything, about maths or any school subject, and the tutor answers in the panel as it thinks:
 * a streamed reply in short paragraphs with rendered maths, read aloud when the student wants it.
 * When the answer needs the board, the tutor also writes on it in its hand: the same checked
 * actions as before (`ChatAction`, `src/lib/live/chat/contracts.ts`). The board stays maths.
 *
 * POST /api/live/ask streams Server-Sent Events (ASK_EVENTS). The model writes its reply first and
 * may end with ONE board block (ASK_BOARD_OPEN … ASK_BOARD_CLOSE) holding `{"actions":[…]}`; the
 * route streams the reply's text as it comes (`AskStreamSplitter`), then checks the actions with
 * the engine exactly as POST /api/live/chat does, then sends them.
 *
 * Each finished turn is saved per board (`ask_messages`), so a reload keeps the chat, and a short
 * memory of the student (`learner_memory`) carries over between boards.
 */

export const ASK_PATH = "/api/live/ask";
export const ASK_HISTORY_PATH = "/api/live/ask/history";
export const ASK_MEMORY_PATH = "/api/live/ask/memory";
/** POST: saved turns move to another screen's chat (the tutor started a new screen for them) */
export const ASK_MOVE_PATH = "/api/live/ask/history/move";
export const TRANSCRIBE_PATH = "/api/live/transcribe";

export const ASK_LIMITS = {
  /** the typed (or said) request */
  message: 1000,
  /** recent turns sent with it (both sides), and one turn's text */
  turns: 12,
  turnText: 2000,
  /** the reply as the panel shows it (Markdown-lite with $…$ maths) */
  reply: 2400,
  /** the board block's JSON, before it is parsed */
  boardBlock: 24_000,
  /** the screen's picture, as a data URL (image/jpeg or image/webp, base64) */
  imageChars: 700_000,
  /** turns kept per board (the history route returns at most this many, newest last) */
  storedTurns: 60,
  /** what the tutor remembers about one student, and one note's length */
  memoryNotes: 12,
  memoryNote: 160,
  /** a spoken request: the audio's size and length */
  audioBytes: 4_000_000,
  audioSeconds: 60,
} as const;

// ------------------------------------------------------------------ the model's output

/** The board block's tags: the reply's text is everything outside them. */
export const ASK_BOARD_OPEN = "<board>";
export const ASK_BOARD_CLOSE = "</board>";

/** The board block's JSON (each action is validated after, one by one, by `cleanChatActions`). */
export const AskBoardBlockSchema = z.object({
  actions: z.array(z.unknown()).max(12).default([]),
});

// ------------------------------------------------------------------ request

/** A screen's id: its tldraw page id (`page:…`). */
export const AskScreenIdSchema = z.string().regex(/^page:[A-Za-z0-9_-]{1,64}$/);

export const AskTurnSchema = z.object({
  role: z.enum(["user", "tutor"]),
  text: z.string().trim().min(1).max(ASK_LIMITS.turnText),
});
export type AskTurn = z.infer<typeof AskTurnSchema>;

/** A picture of the current screen (`captureAskImage`): what the read LaTeX cannot say (drawings, a photo, a PDF page). */
export const AskImageSchema = z
  .string()
  .max(ASK_LIMITS.imageChars)
  .regex(/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/, { message: "a base64 image data URL" });

export const AskScreenSchema = ChatScreenSchema.extend({
  image: AskImageSchema.optional(),
});
export type AskScreen = z.infer<typeof AskScreenSchema>;

export const AskRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  message: z.string().trim().min(1).max(ASK_LIMITS.message),
  history: z.array(AskTurnSchema).max(ASK_LIMITS.turns).default([]),
  screen: AskScreenSchema,
  /** the last problem the student typed, when it has left `history` (as the old chat's) */
  problem: z.string().trim().min(1).max(600).optional(),
  /** the student's record on the board (weak skills, recurring mistakes), as the old chat's */
  learner: LearnerHintSchema.optional(),
  /** said, not typed: the reply will be read aloud (shorter sentences, maths that reads well) */
  voice: z.boolean().optional(),
  /** the client's id for the student's message (the saved turn keeps it: a retry is not saved twice) */
  clientId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  /**
   * The screen this ask belongs to (its tldraw page id): each screen of a board has its own chat
   * (docs/ASK-V2.md, "A chat per screen"). Absent (an older client): the board's first screen.
   */
  screenId: AskScreenIdSchema.optional(),
});
export type AskRequest = z.input<typeof AskRequestSchema>;
export type AskRequestParsed = z.infer<typeof AskRequestSchema>;

// ------------------------------------------------------------------ the stream

/**
 * The route's events, in order: `model` (which model answers; again if the fallback takes over
 * before any text), `delta`* (the reply's text as written), `reply` (the reply as finally shown:
 * cleaned, capped, or replaced when nothing could be done), `actions` (once; possibly none),
 * `done`. Or `error` at any point, after which nothing else comes.
 *
 * Errors BEFORE the stream starts (signed out, rate limited, out of ink, bad request) are the usual
 * JSON error responses (`errorResponse`), so `apiJson`'s ApiError mapping still applies.
 */
export const ASK_EVENTS = {
  model: "model",
  delta: "delta",
  reply: "reply",
  actions: "actions",
  done: "done",
  error: "error",
} as const;

export const AskModelEventSchema = z.object({ model: z.string() });
export const AskDeltaEventSchema = z.object({ text: z.string() });
export const AskReplyEventSchema = z.object({ text: z.string().max(ASK_LIMITS.reply * 2) });
export const AskActionsEventSchema = z.object({
  actions: z.array(ChatActionSchema).max(12),
  /** what was left out, in words for the panel ("The figure couldn't be drawn.") */
  notes: z.array(z.string().max(200)).max(8).default([]),
});
export const AskDoneEventSchema = z.object({
  model: z.string(),
  ms: z.number(),
  /** every proposed action was dropped and the ink given back */
  refunded: z.boolean().optional(),
  /** the saved tutor turn's id (absent when saving failed: the chat goes on, unsaved) */
  turnId: z.string().optional(),
});
export const AskErrorEventSchema = z.object({
  /** an `errorResponse` code (`upstream`, `credits_exhausted`, `timeout`, …) */
  code: z.string(),
  message: z.string(),
  status: z.number().int().optional(),
});
export type AskActionsEvent = z.infer<typeof AskActionsEventSchema>;
export type AskDoneEvent = z.infer<typeof AskDoneEventSchema>;
export type AskErrorEvent = z.infer<typeof AskErrorEventSchema>;

// ------------------------------------------------------------------ saved chat and memory

/** One saved turn, as GET /api/live/ask/history returns it (oldest first). */
export const AskStoredTurnSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "tutor"]),
  text: z.string(),
  /** a tutor turn's notes ("2 of 5 problems couldn't be checked…") */
  notes: z.array(z.string()).default([]),
  /** a tutor turn: the kinds of action it wrote on the board (`write_problems`, `graph`…), never their content */
  wrote: z.array(z.string()).default([]),
  at: z.string(),
  /** the screen whose chat it is in (null: saved before chats were per screen — the first screen's) */
  screenId: z.string().nullable().optional(),
});
export type AskStoredTurn = z.infer<typeof AskStoredTurnSchema>;

/** The first thing the panel shows on a board with no chat yet: built from what the tutor knows, no model call. */
export const AskHelloSchema = z.object({
  /** "Welcome back, Maya! Last time you worked on dividing fractions." */
  greeting: z.string().max(240),
  /** up to 4 first asks, most useful first ("3 more like last time", "Practice my weak spots") */
  chips: z.array(z.string().max(60)).max(4),
});
export type AskHello = z.infer<typeof AskHelloSchema>;

/**
 * POST ASK_MOVE_PATH: the tutor's own actions started a new screen (more problems on a full one),
 * so the exchange that asked for it moves into the new screen's chat with them.
 */
export const AskMoveRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  turnIds: z.array(z.string().min(1).max(64)).min(1).max(4),
  screenId: AskScreenIdSchema,
});
export type AskMoveRequest = z.infer<typeof AskMoveRequestSchema>;

/** GET ASK_HISTORY_PATH?boardId=&screenId= → that screen's chat (oldest first) and, when it has none, a hello. */
export const AskHistoryResponseSchema = z.object({
  turns: z.array(AskStoredTurnSchema).max(ASK_LIMITS.storedTurns),
  /** only for a board with no turns yet */
  hello: AskHelloSchema.nullable(),
});
export type AskHistoryResponse = z.infer<typeof AskHistoryResponseSchema>;

/**
 * What the tutor remembers about one student across boards: short notes about how they learn
 * ("Gets stuck on borrowing across a zero", "Likes word problems about animals", "Asked for
 * shorter hints"). Never personal details (school, address, family, contact): the notes are
 * written by a model told so, and checked (`memoryNoteAllowed`).
 */
export const LearnerMemorySchema = z.object({
  notes: z.array(z.string().trim().min(1).max(ASK_LIMITS.memoryNote)).max(ASK_LIMITS.memoryNotes),
  updatedAt: z.string().nullable(),
});
export type LearnerMemory = z.infer<typeof LearnerMemorySchema>;

/** GET /api/live/ask/memory → LearnerMemory; DELETE clears it (the account page's "What Ask remembers"). */
export const AskMemoryResponseSchema = LearnerMemorySchema;

// ------------------------------------------------------------------ speech in

/** POST /api/live/transcribe (multipart `audio`, optional `lang`) → the words said. */
export const TranscribeResponseSchema = z.object({
  text: z.string().max(ASK_LIMITS.message),
  /** `elevenlabs` (Scribe) or `none` (nothing heard) */
  source: z.enum(["elevenlabs", "none"]),
});
export type TranscribeResponse = z.infer<typeof TranscribeResponseSchema>;
