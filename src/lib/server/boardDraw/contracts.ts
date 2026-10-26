/**
 * The picture tutor's contract (POST /api/board/draw, POST /api/board/draw/outcome), shared with the
 * native iPad client (built against this in its own worktree: change it only together with it).
 *
 * POST /api/board/draw — Authorization: Bearer <Supabase access token>; ADMIN ONLY for now.
 *   { image: "data:image/png;base64,…"   white background, long side ≤ 1600 px (bigger: 413)
 *     mode: "feedback" | "suggest" | "answer",
 *     source: "auto" | "voice",           auto = pen-lift trigger (the tutor may say no help);
 *                                         voice = the tutor or the kid asked (always draws)
 *     instructions?: string,              ≤ 1000 chars: skip the tutor and paint these
 *     boardId?: string, clientRunId: string }
 *
 * 200, Content-Type application/x-ndjson: one JSON object a line, flushed as it happens
 * (`BoardDrawEvent`): `status` reading → `status` drawing → `done` | `none` | `error`.
 * The client cancels by aborting the request; both upstream calls stop with it.
 *
 * POST /api/board/draw/outcome — admin only. { runId, outcome } → 204.
 */
import { z } from "zod";

/** The models, by job. The tutor decides and writes the instructions; the painter draws them. */
export const BOARD_DRAW_MODELS = {
  tutor: "google/gemini-3.8-flash",
  /**
   * Asked at the same time as `tutor`, used when `tutor` has not answered within TUTOR_PREFER_MS.
   * On the zero-data-retention (Vertex) endpoints the app must use, 3.8 Flash took 3.2 s, 5.1 s and
   * once 91 s; 3.1 Flash Lite 1.0–1.2 s, with the same three boards right (2026-10-23). 3.8 Flash
   * stays first because its instructions are better (it asks for the diagram on a Solve board).
   */
  tutorFast: "google/gemini-3.1-flash-lite",
  /** Nano Banana 2 Lite */
  painter: "google/gemini-3.1-flash-lite-image",
} as const;

/** Each upstream call gives up after this long (the caller's abort stops it sooner). */
export const TUTOR_TIMEOUT_MS = 15_000;
/**
 * How long the run waits for `tutor` before it takes `tutorFast`'s answer instead. 4 s handed a
 * quarter of runs to the fast tutor (its p90 is 3.8 s), whose arithmetic is weaker (2026-10-26).
 */
export const TUTOR_PREFER_MS = 7_000;
export const PAINTER_TIMEOUT_MS = 30_000;

/** The board picture's long side, at most (px); bigger is a 413. */
export const MAX_IMAGE_SIDE = 1600;
/** …and its short side, at least (px): smaller is not a board. */
export const MIN_IMAGE_SIDE = 16;
/** A board picture as a data URL, at most (characters): a 1600 px board is far under it as PNG. */
export const MAX_IMAGE_DATA_URL_CHARS = 8_000_000;
/** Client-given instructions, at most. */
export const MAX_INSTRUCTIONS = 1000;

/**
 * Per-user caps while it is admin-only (the rate limiter's buckets `boardDraw` and `boardDrawDay`,
 * src/lib/server/rate-limit.ts, which read these).
 */
export const BOARD_DRAW_PER_10_MIN = 30;
export const BOARD_DRAW_PER_DAY = 200;

/** The strokes the done event carries for the hand-drawn reveal, at most (more: `strokes: []`). */
export const MAX_REVEAL_STROKES = 400;
export const MAX_REVEAL_POINTS = 12_000;

export const BoardDrawModeSchema = z.enum(["feedback", "suggest", "answer"]);
export type BoardDrawMode = z.infer<typeof BoardDrawModeSchema>;
export const BoardDrawSourceSchema = z.enum(["auto", "voice"]);
export type BoardDrawSource = z.infer<typeof BoardDrawSourceSchema>;

export const BoardDrawRequestSchema = z.object({
  image: z
    .string()
    .max(MAX_IMAGE_DATA_URL_CHARS, "Image is too large.")
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, "Image must be a base64 data URL (image/png, image/jpeg or image/webp)."),
  mode: BoardDrawModeSchema,
  source: BoardDrawSourceSchema,
  instructions: z.string().max(MAX_INSTRUCTIONS, `Instructions must be ${MAX_INSTRUCTIONS} characters or fewer.`).optional(),
  boardId: z.string().max(100).optional(),
  clientRunId: z.string().min(1).max(100),
});
export type BoardDrawRequest = z.infer<typeof BoardDrawRequestSchema>;

export const BOARD_DRAW_OUTCOMES = ["accepted", "rejected", "cancelled", "shown"] as const;
export const BoardDrawOutcomeSchema = z.object({
  runId: z.string().min(1).max(100),
  outcome: z.enum(BOARD_DRAW_OUTCOMES),
});
export type BoardDrawOutcome = z.infer<typeof BoardDrawOutcomeSchema>;

export type BoardDrawTimings = { tutorMs: number; paintMs: number; diffMs: number; traceMs: number; totalMs: number };

/** One pen stroke of the reveal, in the overlay's pixels: flat [x0, y0, x1, y1, …] (0.1 px), and its thickness. */
export type RevealStroke = { points: number[]; width: number };

/** The stream's lines. */
export type BoardDrawEvent =
  | { type: "status"; stage: "reading"; runId: string }
  | { type: "status"; stage: "drawing"; instructions: string }
  | { type: "none"; reason: string }
  | {
      type: "done";
      overlay: string;
      picture: string;
      width: number;
      height: number;
      instructions: string;
      timings: BoardDrawTimings;
      costUsd: number;
      strokes: RevealStroke[];
    }
  | { type: "error"; message: string; retryable: boolean };

/** The app event kinds (app_events.kind) these routes write. */
export const BOARD_DRAW_EVENT = "board_draw";
export const BOARD_DRAW_OUTCOME_EVENT = "board_draw_outcome";
