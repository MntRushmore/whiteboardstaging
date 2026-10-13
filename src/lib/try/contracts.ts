/**
 * "Try it free" (2026-10-13): a board anyone can write on at /try, with no account. A visitor
 * picks a grade band, the tutor's problem is on the page in its blue hand, the visitor writes a
 * line, and the tutor checks it — a check mark, or a circle and a nudge — the way the real board
 * does. It is the link every post and ad points at, and the "aha" a family gets before the card.
 *
 * Why: on 2026-10-12 most sign-ups reached the plan screen's card within a minute and left
 * without ever seeing the tutor check a line (docs/TRY-BOARD.md).
 *
 * The cost of a try is one handwriting read (Mathpix strokes). The check itself is the board's own
 * engine on the server (`analyzeColumn` + `badgeFor`), and "Show me a step" is the engine's local
 * solve: no model is ever called. Reads are limited per visitor and per day (`TRY_LIMITS`).
 *
 * Shared contract for the build: the server (`src/app/api/try/**`, `src/lib/server/try/**`) and
 * the page (`src/app/(platform)/try/**`, `src/components/try/**`) both read this file.
 */
import { z } from "zod";
import type { Grade } from "@/lib/learning/grades";
import type { CourseId } from "@/lib/onboarding/courseIds";

export const TRY_PATH = "/try";

export const TRY_API = {
  /** POST TryCheckRequest → TryCheckResponse: read the visitor's line and check it */
  check: "/api/try/check",
  /** POST TryHelpRequest → TryHelpResponse: the next step, in the tutor's hand */
  help: "/api/try/help",
} as const;

// ------------------------------------------------------------------ the problems

/** The grade bands the page offers, in order. Each draws its problems from the onboarding starters. */
export const TRY_BANDS = [
  { id: "k2", label: "K–2nd", grades: [0, 1, 2] as readonly Grade[], courses: [] as readonly CourseId[] },
  { id: "g35", label: "3rd–5th", grades: [3, 4, 5] as readonly Grade[], courses: [] as readonly CourseId[] },
  { id: "g68", label: "6th–8th", grades: [6, 7, 8] as readonly Grade[], courses: [] as readonly CourseId[] },
  { id: "hs", label: "High school", grades: [] as readonly Grade[], courses: ["algebra1"] as readonly CourseId[] },
] as const;
export type TryBandId = (typeof TRY_BANDS)[number]["id"];
export const DEFAULT_TRY_BAND: TryBandId = "g35";

export function isTryBand(value: unknown): value is TryBandId {
  return typeof value === "string" && TRY_BANDS.some((b) => b.id === value);
}

/**
 * One problem of the try board. `id` is stable and opaque to the client (`<band>-<n>`); the server
 * looks the problem up by it and never trusts lines sent by the page.
 */
export interface TryProblem {
  id: string;
  band: TryBandId;
  /** the problem as the tutor writes it (LaTeX, one line) */
  lines: readonly string[];
  /** a nudge in words, shown after a circle or on request (never on the board) */
  hint: string;
  /** the first right step is the answer (`3 + 4` → `7`): the page asks for "the answer", not "the next step" */
  oneStep: boolean;
}

/** At most this many lines of the visitor's own work under the problem (the page's lined pad). */
export const TRY_MAX_LINES = 5;

// ------------------------------------------------------------------ the API

const Latex = z.string().max(200);
/** the visitor's lines the tutor already checked, top to bottom, as read (never re-read) */
const Work = z.array(Latex).max(TRY_MAX_LINES);
/** one line's ink: up to 40 strokes of up to 1,000 points (a line of a child's writing is ~5–30) */
const Coords = z.array(z.array(z.number().finite()).min(1).max(1000)).min(1).max(40);

export const TryCheckRequestSchema = z.object({
  problemId: z.string().min(1).max(32),
  work: Work,
  strokes: z
    .object({ x: Coords, y: Coords })
    .refine((s) => s.x.length === s.y.length && s.x.every((xs, i) => xs.length === s.y[i].length), { message: "x/y stroke arrays must align" }),
  /** the line's ink box in CSS pixels */
  bounds: z.object({ w: z.number().positive().max(4000), h: z.number().positive().max(2000) }),
});
export type TryCheckRequest = z.infer<typeof TryCheckRequestSchema>;

/**
 * What the tutor does with the line:
 * - `check`: a right step (a check mark beside it);
 * - `solved`: right, and the problem is done (a check mark, then the finish);
 * - `ring`: a slip (a circle round it, and `note` or the problem's hint);
 * - `unread`: the reader could not make it out (a question mark: write it a little bigger);
 * - `unjudged`: read, but nothing in it to check yet (half a step): no mark, write the whole line.
 */
export const TRY_VERDICTS = ["check", "solved", "ring", "unread", "unjudged"] as const;
export type TryVerdict = (typeof TRY_VERDICTS)[number];

export const TryCheckResponseSchema = z.object({
  /** what the reader saw ('' when it saw nothing) */
  latex: z.string(),
  verdict: z.enum(TRY_VERDICTS),
  /** the engine's note for a circled line, in words; null when it has none */
  note: z.string().nullable(),
});
export type TryCheckResponse = z.infer<typeof TryCheckResponseSchema>;

export const TryHelpRequestSchema = z.object({
  problemId: z.string().min(1).max(32),
  work: Work,
});
export type TryHelpRequest = z.infer<typeof TryHelpRequestSchema>;

/** A line in the tutor's hand, drawn by the server's hand engine (`handInk`), ready for an SVG. */
export const TryInkSchema = z.object({
  strokes: z.array(z.object({ d: z.string(), weight: z.number(), atMs: z.number(), forMs: z.number() })),
  width: z.number(),
  height: z.number(),
  baseline: z.number(),
  durationMs: z.number(),
});
export type TryInk = z.infer<typeof TryInkSchema>;

export const TryHelpResponseSchema = z.object({
  /** the next step after the visitor's work; null when the engine has none (or it is already solved) */
  latex: z.string().nullable(),
  /** that step in the tutor's hand; null with it */
  ink: TryInkSchema.nullable(),
  /** the step finishes the problem */
  solves: z.boolean(),
});
export type TryHelpResponse = z.infer<typeof TryHelpResponseSchema>;

/**
 * Errors are JSON `{ error, retryAfterMs? }`:
 * - 400 `invalid_request` (a body that is not the schema, an unknown problem id);
 * - 429 `rate_limited` with `retryAfterMs` (this visitor's reads, or the day's for everyone);
 * - 502 `upstream_error` (the reader failed);
 * - 503 `unavailable` (no reader configured, or TRY_ENABLED=0).
 */
export const TryErrorSchema = z.object({
  error: z.enum(["invalid_request", "rate_limited", "upstream_error", "unavailable"]),
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export type TryError = z.infer<typeof TryErrorSchema>;

// ------------------------------------------------------------------ limits

/**
 * A visitor (by IP; `cf-connecting-ip` first, since www.agathon.app sits behind Cloudflare) gets
 * `perVisitor` reads per `windowMs`; everyone together gets `perDay` reads a UTC day (env
 * TRY_DAILY_READS overrides it), so a bot cannot run up the reader's bill. Help costs no read and
 * has its own, looser per-visitor bucket.
 */
export const TRY_LIMITS = {
  read: { limit: 40, windowMs: 60 * 60_000 },
  help: { limit: 60, windowMs: 60 * 60_000 },
  perDay: 3000,
} as const;

// ------------------------------------------------------------------ after the try

/**
 * The device remembers a try (localStorage `TRY_MARKER_KEY`, `{ at, checked, solved }`) so that,
 * once the visitor makes an account, the app records the funnel step `try_board` with that meta —
 * the admin Funnel can then say how many tried the free board first, and how many of them started
 * a trial.
 */
export const TRY_MARKER_KEY = "agathon.try";
export interface TryMarker {
  /** ISO time of the first line checked */
  at: string;
  /** the tutor checked at least one line right */
  checked: boolean;
  /** a problem was finished */
  solved: boolean;
}
