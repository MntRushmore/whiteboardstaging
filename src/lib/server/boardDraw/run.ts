/**
 * One picture-tutor run (POST /api/board/draw): Reed's system, sped up (measured 2026-10-23: ~6 s,
 * ~$0.036 a run).
 *
 *   1. TUTOR (`BOARD_DRAW_MODELS.tutor`, ~3 s): one call decides whether the kid needs help AND
 *      writes short drawing instructions (./prompts.ts). Skipped when the client sent its own
 *      `instructions` (the voice tutor's draw_on_canvas, or the kid asking).
 *   2. PAINTER (`BOARD_DRAW_MODELS.painter`, Nano Banana 2 Lite, ~3 s): Reed's prompt in its voice
 *      form (always draw) plus those instructions, over the board picture (./reed.ts).
 *   3. The picture at the board's exact size, the overlay of what the model added (./overlay.ts),
 *      and the overlay traced into ordered pen strokes for the reveal (./strokes.ts).
 *
 * Events go out through `emit` as they happen (BoardDrawEvent). `signal` is the client's request:
 * both upstream calls are aborted with it, and each has its own timeout. Returns what the route logs
 * (no kid content: lengths and numbers only).
 */
import { CreditsExhaustedError, openrouterChat, UpstreamError, type OpenRouterChatResponse } from "@/lib/server/openrouter";
import {
  BOARD_DRAW_MODELS,
  MAX_INSTRUCTIONS,
  PAINTER_TIMEOUT_MS,
  TUTOR_PREFER_MS,
  TUTOR_TIMEOUT_MS,
  type BoardDrawEvent,
  type BoardDrawMode,
  type BoardDrawSource,
  type BoardDrawTimings,
} from "./contracts";
import { dataUrlBytes, dataUrlPng, decodeRgb, encodeRgbaPng, encodeRgbPng, overlayOf, pictureAt, type Rgb } from "./overlay";
import { parseTutorReply, tutorMessages, type TutorDecision } from "./prompts";
import { pictureUrlOf, reedChatBody, reedPrompt } from "./reed";
import { readbackNote as EXACT_NUMBERS_NOTE, strayNumbersOf } from "./readback";
import { revealStrokesFine, type RevealResult } from "./strokes";

export type RunInput = {
  runId: string;
  requestId: string;
  /** the board capture as sent (a data URL) and decoded */
  imageDataUrl: string;
  board: Rgb;
  mode: BoardDrawMode;
  source: BoardDrawSource;
  instructions?: string;
  signal: AbortSignal;
  emit: (event: BoardDrawEvent) => void;
};

/** How a run ended, for the app event. */
export type RunSummary = {
  result: "done" | "none" | "error" | "aborted";
  /** null when the tutor was skipped (the client sent instructions) or never answered */
  needsHelp: boolean | null;
  tutorSkipped: boolean;
  /** which tutor's instructions were used (the slower, better one or the fast one) */
  tutorModel?: string;
  timings: BoardDrawTimings;
  costUsd: number;
  instructionsChars: number;
  overlayPx?: number;
  /** numbers the read-back found that the tutor never asked for (then the picture was painted again) */
  readbackStrays?: string[];
  /** 2 when the picture was painted again */
  paints?: number;
  strokes?: number;
  strokesDropped?: string;
  alignScore?: number;
  /** on an error: a short machine code (timeout, upstream, credits, no_picture, bad_picture, tutor_reply, internal) */
  errorCode?: string;
  upstreamStatus?: number;
  retryable?: boolean;
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** The caller's signal and a timeout, together. */
function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

/** OpenRouter's `usage.cost` (USD) when it reported one (`usage: { include: true }`). */
function costOf(data: OpenRouterChatResponse): number {
  const cost = (data.usage as { cost?: unknown } | undefined)?.cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
}

/** A 200 that carries an error instead of a choice is still an error. */
function checkReply(data: OpenRouterChatResponse): void {
  if (data.error && !data.choices?.length) {
    const status = typeof data.error.code === "number" ? data.error.code : 502;
    throw new UpstreamError(status, String(data.error.message ?? "OpenRouter returned an error"));
  }
}

function textOf(data: OpenRouterChatResponse): string {
  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((p: { text?: unknown }) => (typeof p?.text === "string" ? p.text : "")).join("");
  return "";
}

class RunError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "RunError";
  }
}

/** Any failure as what the client reads (`message`, `retryable`) and what the log keeps (`code`). */
function classify(err: unknown, stage: "tutor" | "painter" | "after"): RunError {
  if (err instanceof RunError) return err;
  const what = stage === "tutor" ? "The tutor" : stage === "painter" ? "The drawing" : "The drawing";
  if (err instanceof Error && err.name === "TimeoutError") return new RunError("timeout", `${what} took too long.`, true);
  if (err instanceof CreditsExhaustedError) return new RunError("credits", "The tutor is unavailable right now.", false, 402);
  if (err instanceof UpstreamError) {
    const retryable = err.status >= 500 || err.status === 429 || err.status === 408;
    return new RunError("upstream", `${what} failed (${err.status}).`, retryable, err.status);
  }
  return new RunError("internal", "Something went wrong drawing on the board.", stage !== "after");
}

type TutorAnswer = { model: string; decision: TutorDecision };

/** One tutor call: the decision, or a throw (upstream error, timeout, unreadable reply). */
async function askTutor(model: string, input: RunInput, summary: RunSummary, stop: AbortSignal): Promise<TutorAnswer> {
  const data = await openrouterChat(
    {
      model,
      messages: tutorMessages(input.mode, input.imageDataUrl),
      temperature: 0,
      max_tokens: 1500, // 500 cut off 4 of 9 Solve (cone) replies in the fast-chain check: the kid saw nothing
      reasoning: { effort: "minimal" },
      provider: { sort: "latency" },
      usage: { include: true },
    },
    { signal: AbortSignal.any([withTimeout(input.signal, TUTOR_TIMEOUT_MS), stop]), requestId: input.requestId, title: "Agathon Board Draw - tutor" },
  );
  checkReply(data);
  summary.costUsd += costOf(data);
  const decision = parseTutorReply(textOf(data), MAX_INSTRUCTIONS);
  if (!decision) throw new RunError("tutor_reply", "The tutor's answer could not be read.", true);
  return { model, decision };
}

/**
 * Both tutors at once: `tutor`'s answer when it comes within TUTOR_PREFER_MS, otherwise
 * `tutorFast`'s (and `tutor`'s after all if the fast one fails). The one not used is stopped.
 */
async function askTutors(input: RunInput, summary: RunSummary): Promise<TutorDecision> {
  const stopBest = new AbortController();
  const stopFast = new AbortController();
  const best = askTutor(BOARD_DRAW_MODELS.tutor, input, summary, stopBest.signal);
  const fast = askTutor(BOARD_DRAW_MODELS.tutorFast, input, summary, stopFast.signal);
  best.catch(() => {});
  fast.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), TUTOR_PREFER_MS)));
  const first = await Promise.race([best.then((a) => a, () => "failed" as const), late]);
  clearTimeout(timer);
  let answer: TutorAnswer;
  if (first !== "late" && first !== "failed") {
    answer = first;
    stopFast.abort();
  } else {
    try {
      answer = await fast;
      stopBest.abort();
    } catch (fastErr) {
      if (first === "failed") throw fastErr;
      answer = await best; // still running: its own timeout bounds the wait
    }
  }
  summary.tutorModel = answer.model;
  return answer.decision;
}

export async function runBoardDraw(input: RunInput): Promise<RunSummary> {
  const t0 = now();
  const { signal, emit, board } = input;
  const timings: BoardDrawTimings = { tutorMs: 0, paintMs: 0, diffMs: 0, traceMs: 0, totalMs: 0 };
  const summary: RunSummary = { result: "error", needsHelp: null, tutorSkipped: false, timings, costUsd: 0, instructionsChars: 0 };
  const finish = (s: RunSummary): RunSummary => {
    timings.totalMs = Math.round(now() - t0);
    summary.costUsd = Math.round(summary.costUsd * 1e6) / 1e6;
    return s;
  };
  const fail = (err: unknown, stage: "tutor" | "painter" | "after"): RunSummary => {
    if (signal.aborted) {
      summary.result = "aborted";
      return finish(summary);
    }
    const e = classify(err, stage);
    summary.result = "error";
    summary.errorCode = e.code;
    summary.retryable = e.retryable;
    if (e.upstreamStatus !== undefined) summary.upstreamStatus = e.upstreamStatus;
    emit({ type: "error", message: e.message, retryable: e.retryable });
    return finish(summary);
  };

  emit({ type: "status", stage: "reading", runId: input.runId });

  // 1. the tutor: needs help? and what to draw
  let instructions = input.instructions?.trim().slice(0, MAX_INSTRUCTIONS) ?? "";
  if (input.instructions !== undefined && instructions) {
    summary.tutorSkipped = true;
  } else {
    const t = now();
    try {
      const decision = await askTutors(input, summary);
      summary.needsHelp = decision.needsHelp;
      instructions = decision.instructions;
    } catch (err) {
      timings.tutorMs = Math.round(now() - t);
      return fail(err, "tutor");
    }
    timings.tutorMs = Math.round(now() - t);
    if (signal.aborted) return fail(null, "tutor");
    // a pen-lift may hear "no help"; a request (voice) always draws, with Reed's prompt alone if need be
    if (summary.needsHelp === false && input.source === "auto") {
      summary.result = "none";
      emit({ type: "none", reason: "The tutor saw nothing that needs help." });
      return finish(summary);
    }
  }
  summary.instructionsChars = instructions.length;
  emit({ type: "status", stage: "drawing", instructions });

  // 2–4. paint, diff and trace; once more when the read-back finds a number the tutor never asked for
  type Painted = { overlayPng: Buffer; picturePng: Buffer; reveal: RevealResult };
  const paintOnce = async (prompt: string, bail: (err: unknown, stage: "painter" | "after") => RunSummary | null): Promise<Painted | RunSummary | null> => {
    // 2. the painter: Reed's prompt (voice form: always an image) plus the instructions
    let pictureBytes: Buffer;
    {
      const t = now();
      try {
        const body = {
          ...reedChatBody(BOARD_DRAW_MODELS.painter, input.imageDataUrl, prompt),
          provider: { sort: "latency" },
          usage: { include: true },
        };
        const data = await openrouterChat(body, { signal: withTimeout(signal, PAINTER_TIMEOUT_MS), requestId: input.requestId, title: "Agathon Board Draw - painter" });
        checkReply(data);
        summary.costUsd += costOf(data);
        const url = pictureUrlOf(data.choices?.[0]?.message);
        if (!url) throw new RunError("no_picture", "no picture", true);
        pictureBytes = dataUrlBytes(url);
      } catch (err) {
        timings.paintMs = Math.round(now() - t);
        return bail(err, "painter");
      }
      timings.paintMs = Math.round(now() - t);
    }
    if (signal.aborted) return bail(null, "painter");

    // 3. the picture at the board's size, and what the model added
    let overlayPng: Buffer;
    let picturePng: Buffer;
    let mask: Uint8Array;
    {
      const t = now();
      try {
        let pic: Rgb;
        try {
          pic = await decodeRgb(pictureBytes);
        } catch {
          throw new RunError("bad_picture", "no picture", true);
        }
        const atSize = await pictureAt(pictureBytes, board.width, board.height);
        picturePng = await encodeRgbPng(atSize);
        const overlay = overlayOf(board, pic);
        overlayPng = await encodeRgbaPng(board.width, board.height, overlay.rgba);
        mask = overlay.mask;
        summary.overlayPx = overlay.addedPx;
        summary.alignScore = Math.round(overlay.alignment.score * 1000) / 1000;
      } catch (err) {
        timings.diffMs = Math.round(now() - t);
        return bail(err, "after");
      }
      timings.diffMs = Math.round(now() - t);
    }
    if (signal.aborted) return bail(null, "after");

    // 4. the reveal's strokes (never fails the run: `[]` and the client fades in)
    const reveal = await revealStrokesFine(mask, board.width, board.height);
    timings.traceMs = reveal.ms;
    summary.strokes = reveal.strokes.length;
    if (reveal.dropped) summary.strokesDropped = reveal.dropped;
    if (signal.aborted) return bail(null, "after");
    return { overlayPng, picturePng, reveal };
  };
  const firstPrompt = reedPrompt(input.mode, "voice", instructions || null);
  const first = await paintOnce(firstPrompt, fail);
  if (!first || !("overlayPng" in first)) return first ?? fail(null, "after");
  let painted: Painted = first;
  if (input.mode !== "feedback") {
    const strays = await strayNumbersOf(painted.overlayPng, board.width, board.height, instructions, signal, input.requestId);
    if (strays.length > 0 && !signal.aborted) {
      summary.readbackStrays = strays.slice(0, 8);
      summary.paints = 2;
      // a second painting that fails keeps the first (only an abort still ends the run)
      const again = await paintOnce(`${firstPrompt}\n\n${EXACT_NUMBERS_NOTE}`, (err, stage) => (signal.aborted ? fail(err, stage) : null));
      if (again && !("overlayPng" in again)) return again;
      if (again) painted = again;
    }
  }
  const { overlayPng, picturePng, reveal } = painted;

  summary.result = "done";
  finish(summary);
  emit({
    type: "done",
    overlay: dataUrlPng(overlayPng),
    picture: dataUrlPng(picturePng),
    width: board.width,
    height: board.height,
    instructions,
    timings: { ...timings },
    costUsd: summary.costUsd,
    strokes: reveal.strokes,
  });
  return summary;
}
