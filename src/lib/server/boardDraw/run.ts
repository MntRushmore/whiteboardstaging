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
import { evaluate, falseEquations, numberText, recheckNote } from "./arithmetic";
import { readbackNote as EXACT_NUMBERS_NOTE, strayNumbersOf } from "./readback";
import { roomLine } from "./room";
import { revealStrokes, type RevealResult } from "./strokes";
import { correctionNote, serverChecks, verifyPicture, type VerifyResult } from "./verify";

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
  /** the bench's switches (never set by the route): the checker's model; false skips the check */
  verifyModel?: string;
  verify?: boolean;
  /** the whole run's budget, ms (RUN_BUDGET_MS; tests shorten it) */
  budgetMs?: number;
};

/**
 * The whole run's budget. The route may run 60 s (maxDuration) and the painter alone is allowed 30 s,
 * so a slow painter plus the check and a repaint could reach the platform's limit with no final line.
 * At 45 s the run ends cleanly instead: Solve writes its answer when the tutor gave one, otherwise
 * `none` — never a hang, never a cut-off stream.
 */
export const RUN_BUDGET_MS = 45_000;
/** What `none` says when the budget ends a run. */
export const OUT_OF_TIME_REASON = "The tutor took too long to draw this one. Try again.";

/** What a run has learned so far, for the budget's fallback. */
type RunContext = { summary?: RunSummary; answer?: string; terminal?: boolean };

/** What the check before show did (no kid content: counts, outcomes and times). */
export type VerifySummary = {
  checks: number;
  /** the first picture: passed, failed, or the check errored (then shown: it fails open) */
  first: "pass" | "fail" | "error";
  /** the repainted picture, when the first failed */
  second?: "pass" | "fail" | "error" | "no_picture";
  problems: number;
  /** a picture that failed twice is never shown: Solve writes its answer instead, or nothing */
  withheld?: "write" | "none";
  ms: number;
  costUsd: number;
  error?: string;
};

/** How a run ended, for the app event. */
export type RunSummary = {
  result: "done" | "none" | "write" | "error" | "aborted";
  /** null when the tutor was skipped (the client sent instructions) or never answered */
  needsHelp: boolean | null;
  tutorSkipped: boolean;
  /** which tutor's instructions were used (the slower, better one or the fast one) */
  tutorModel?: string;
  timings: BoardDrawTimings;
  costUsd: number;
  instructionsChars: number;
  overlayPx?: number;
  /** the tutor found the work finished and right (a checkmark) */
  correct?: boolean;
  /** Solve on plain arithmetic: the expression the server worked out (no picture painted) */
  simple?: string;
  /** sums in the tutor's instructions that were wrong (then it was asked again) */
  tutorWrongSums?: string[];
  /** true when the re-asked tutor's answer replaced the wrong one */
  tutorRechecked?: boolean;
  /** numbers the read-back found that the tutor never asked for (then the picture was painted again) */
  readbackStrays?: string[];
  /** 2 when the picture was painted again */
  paints?: number;
  /** the first picture didn't line up with the board (then it was painted again) */
  misaligned?: boolean;
  /** the check before show (./verify.ts) */
  verify?: VerifySummary;
  /** the run hit RUN_BUDGET_MS and ended with a fallback (`write` or `none`) */
  outOfTime?: boolean;
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
/** Below this the picture doesn't line up with the board (good runs score 0.9–1). */
export const MIN_ALIGN = 0.7;

/** What a second painting is told after a picture that moved the page. */
const KEEP_STILL_NOTE =
  "Your last picture moved or redrew the page. Return the SAME image at the same size and framing, every existing mark exactly where it is, and only add new marks in empty space.";

/** Added to the instructions of a picture with counts (one the check before show will hold it to). */
export const PAINTER_PICTURE_NOTE =
  "Draw exactly the counts asked for and count them as you draw; equal parts are equal in size; shade a part with close dark diagonal lines, never a pale fill.";

/** Solve's final answer as the iPad writes it: "5/6" as a fraction, "85" as "= 85", "x = 5" as it is. */
export function answerLatex(answer: string): string | null {
  const a = answer.trim().replace(/^=\s*/, "");
  if (!a || a.length > 40 || !/\d/.test(a)) return null;
  // only maths: digits, letters for a variable or a unit, signs, a fraction slash, a decimal point
  if (!/^[\w\s.,+\-−=/×÷^()°%]+$/.test(a)) return null;
  // words don't go through the maths hand ("2/3 is bigger" would come out "isbigger"); a unit can
  if (/[a-zA-Z]{3,}/.test(a)) return null;
  const tex = a.replace(/(\d+)\s*\/\s*(\d+)/g, "\\frac{$1}{$2}").replace(/×/g, "\\times ").replace(/÷/g, "\\div ").replace(/−/g, "-");
  return /=/.test(tex) ? tex : `= ${tex}`;
}

async function askTutor(model: string, input: RunInput, summary: RunSummary, stop: AbortSignal, note?: string): Promise<TutorAnswer> {
  const data = await openrouterChat(
    {
      model,
      messages: note
        ? [...tutorMessages(input.mode, input.imageDataUrl, roomLine(input.board)), { role: "user", content: note }]
        : tutorMessages(input.mode, input.imageDataUrl, roomLine(input.board)),
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

/**
 * Whether a plain-arithmetic answer can be written as a number: exact (no rounding), and not a
 * fraction problem with a fractional answer. 3/4 + 2/3 was written "= 1.4167" (the picture bench,
 * 2026-10-26): a kid adding fractions wants 17/12, so the tutor works those out on the page instead.
 */
export function simpleWritable(expression: string, value: number): boolean {
  if (Number.isInteger(value)) return true;
  if (/\/|\\frac/.test(expression)) return false;
  return Math.abs(Math.round(value * 10_000) / 10_000 - value) < 1e-9;
}

/**
 * One run, held to its budget (RUN_BUDGET_MS). Past it, the run's upstream calls are stopped, nothing
 * more it emits goes out, and the run ends with Solve's answer written (`write`) when the tutor gave
 * one, otherwise `none` with OUT_OF_TIME_REASON. A client that went away gets nothing.
 */
export async function runBoardDraw(input: RunInput): Promise<RunSummary> {
  const t0 = now();
  const budget = new AbortController();
  const ctx: RunContext = {};
  let over = false;
  const emit = (e: BoardDrawEvent) => {
    if (over) return;
    if (e.type !== "status") ctx.terminal = true;
    input.emit(e);
  };
  const run = runWithin({ ...input, signal: AbortSignal.any([input.signal, budget.signal]), emit }, ctx);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), input.budgetMs ?? RUN_BUDGET_MS)));
  const first = await Promise.race([run, late]);
  clearTimeout(timer);
  if (first !== "late" || ctx.terminal || input.signal.aborted) return first === "late" ? run : first;
  over = true;
  budget.abort();
  run.catch(() => {});
  const summary = ctx.summary!;
  summary.outOfTime = true;
  summary.timings.totalMs = Math.round(now() - t0);
  summary.costUsd = Math.round(summary.costUsd * 1e6) / 1e6;
  const latex = input.mode === "answer" && ctx.answer ? answerLatex(ctx.answer) : null;
  if (latex) {
    summary.result = "write";
    input.emit({ type: "write", latex, expression: ctx.answer! });
  } else {
    summary.result = "none";
    input.emit({ type: "none", reason: OUT_OF_TIME_REASON });
  }
  // a copy: the stopped run may still touch its own summary as its calls unwind
  return { ...summary, timings: { ...summary.timings }, ...(summary.verify ? { verify: { ...summary.verify } } : {}) };
}

async function runWithin(input: RunInput, ctx: RunContext): Promise<RunSummary> {
  const t0 = now();
  const { signal, emit, board } = input;
  const timings: BoardDrawTimings = { tutorMs: 0, paintMs: 0, diffMs: 0, traceMs: 0, totalMs: 0 };
  const summary: RunSummary = { result: "error", needsHelp: null, tutorSkipped: false, timings, costUsd: 0, instructionsChars: 0 };
  ctx.summary = summary;
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
  let correct = false;
  let simple: { expression: string; latex: string } | null = null;
  let checks: string[] = [];
  let answer: string | undefined;
  if (input.instructions !== undefined && instructions) {
    summary.tutorSkipped = true;
  } else {
    const t = now();
    try {
      let decision = await askTutors(input, summary);
      // its sums, checked before anything is painted: a wrong one goes back to the better tutor once,
      // told which (the fast tutor's column sum of 1,385 + 2,749 was wrong, 2026-10-26)
      // (Solve's own working only: Feedback and Suggest quote the student's wrong sum on purpose —
      // "6 + 4 = 11" sent a feedback note back to be redone, 2026-10-26)
      const wrong = decision.needsHelp && input.mode === "answer" ? falseEquations(decision.instructions) : [];
      if (wrong.length > 0) {
        summary.tutorWrongSums = wrong.slice(0, 4);
        try {
          const again = await askTutor(BOARD_DRAW_MODELS.tutor, input, summary, signal, recheckNote(wrong));
          if (!again.decision.needsHelp || falseEquations(again.decision.instructions).length === 0) {
            decision = again.decision;
            summary.tutorModel = again.model;
            summary.tutorRechecked = true;
          }
        } catch {
          // the first answer stands
        }
      }
      summary.needsHelp = decision.needsHelp;
      instructions = decision.instructions;
      correct = decision.correct === true;
      checks = decision.checks ?? [];
      answer = decision.answer;
      ctx.answer = answer;
      // Solve on plain arithmetic: worked out here, never by a model, and written by the iPad's hand
      if (input.mode === "answer" && decision.simple) {
        const value = evaluate(decision.simple);
        if (value !== null && simpleWritable(decision.simple, value)) {
          const n = numberText(value);
          simple = { expression: decision.simple, latex: decision.wroteEquals ? n : `= ${n}` };
        }
      }
    } catch (err) {
      timings.tutorMs = Math.round(now() - t);
      return fail(err, "tutor");
    }
    timings.tutorMs = Math.round(now() - t);
    if (signal.aborted) return fail(null, "tutor");
    // a pen-lift may hear "no help"; so may a request (Draw now) with nothing to add: forced to paint
    // with no instructions, the painter invented a whole new drawing over a solved page (2026-10-26).
    // Finished right work is a checkmark however it was asked for, never another nudge (the 11-13 demo).
    if (summary.needsHelp === false && (input.source === "auto" || !instructions || correct)) {
      summary.result = "none";
      if (correct) summary.correct = true;
      emit({ type: "none", reason: correct ? "The work is right." : "The tutor saw nothing that needs help.", ...(correct ? { correct: true } : {}) });
      return finish(summary);
    }
  }
  if (simple) {
    summary.result = "write";
    summary.simple = simple.expression;
    emit({ type: "write", latex: simple.latex, expression: simple.expression });
    return finish(summary);
  }
  summary.instructionsChars = instructions.length;
  emit({ type: "status", stage: "drawing", instructions });

  // 2–4. paint, diff and trace; once more when the read-back finds a number the tutor never asked for
  type Painted = { overlayPng: Buffer; overlayRgba: Uint8Array; picturePng: Buffer; reveal: RevealResult; align: number };
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
    let overlayRgba: Uint8Array;
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
        overlayRgba = overlay.rgba;
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
    const reveal = revealStrokes(mask, board.width, board.height);
    timings.traceMs = reveal.ms;
    summary.strokes = reveal.strokes.length;
    if (reveal.dropped) summary.strokesDropped = reveal.dropped;
    if (signal.aborted) return bail(null, "after");
    return { overlayPng, overlayRgba, picturePng, reveal, align: summary.alignScore ?? 1 };
  };
  // A picture that failed its check twice: Solve writes its final answer in the tutor's hand (the
  // `write` event, as plain arithmetic does); anything else shows nothing. Never a wrong picture.
  const withhold = (): RunSummary => {
    const v = summary.verify!;
    const latex = input.mode === "answer" && answer ? answerLatex(answer) : null;
    v.withheld = latex ? "write" : "none";
    if (latex) {
      summary.result = "write";
      emit({ type: "write", latex, expression: answer! });
    } else {
      summary.result = "none";
      emit({ type: "none", reason: "The picture didn't come out right, so the tutor kept it to itself." });
    }
    return finish(summary);
  };
  // a picture with counts gets the painter rule that its shading and counts are kept to
  const firstPrompt = reedPrompt(input.mode, "voice", instructions ? (checks.length ? `${instructions}\n${PAINTER_PICTURE_NOTE}` : instructions) : null);
  const first = await paintOnce(firstPrompt, fail);
  if (!first || !("overlayPng" in first)) return first ?? fail(null, "after");
  let painted: Painted = first;
  // A picture that doesn't line up with the board: the painter moved or redrew the page, and its
  // "additions" are the student's own writing shifted (the owner's board, 2026-10-27: alignment 0.30,
  // their question copied in blue over their work). Painted once more, told to keep everything still;
  // still off, nothing is shown rather than ink over the work.
  if (painted.align < MIN_ALIGN && !signal.aborted) {
    summary.paints = 2;
    summary.misaligned = true;
    const again = await paintOnce(`${firstPrompt}\n\n${KEEP_STILL_NOTE}`, (err, stage) => (signal.aborted ? fail(err, stage) : null));
    if (again && !("overlayPng" in again)) return again;
    if (!again || again.align < MIN_ALIGN) {
      return fail(new RunError("misaligned", "The drawing didn't line up with the board. Try again.", true), "after");
    }
    painted = again;
  }
  // CHECK BEFORE SHOW (./verify.ts), with the read-back at the same time: a picture that fails is
  // painted once more with the corrections; one that fails again is never shown
  const verifyChecks = input.verify === false ? [] : [...checks, ...serverChecks(input.mode, answer)];
  const check = (p: Painted) =>
    verifyPicture({ board, overlayRgba: p.overlayRgba, instructions, checks: verifyChecks, mode: input.mode, signal, requestId: input.requestId, model: input.verifyModel });
  const [v1, strays] = await Promise.all([
    verifyChecks.length > 0 ? check(painted) : Promise.resolve(null),
    input.mode !== "feedback" ? strayNumbersOf(painted.overlayPng, board.width, board.height, instructions, signal, input.requestId) : Promise.resolve([] as string[]),
  ]);
  if (signal.aborted) return fail(null, "after");
  const verdict = (v: VerifyResult) => (v.error ? "error" : v.ok ? "pass" : "fail") as "pass" | "fail" | "error";
  if (v1) summary.verify = { checks: verifyChecks.length, first: verdict(v1), problems: v1.problems.length, ms: v1.ms, costUsd: v1.costUsd, ...(v1.error ? { error: v1.error } : {}) };
  if (v1) summary.costUsd += v1.costUsd;
  const failedCheck = v1 !== null && !v1.ok;
  if (strays.length > 0) summary.readbackStrays = strays.slice(0, 8);
  if (failedCheck || strays.length > 0) {
    summary.paints = (summary.paints ?? 1) + 1;
    const notes = [failedCheck ? correctionNote(v1!.problems, verifyChecks) : "", strays.length > 0 ? EXACT_NUMBERS_NOTE : ""].filter(Boolean).join("\n\n");
    // the second painting is held to the same check; a first that passed stays when the second doesn't
    const again = await paintOnce(`${firstPrompt}\n\n${notes}`, (err, stage) => (signal.aborted ? fail(err, stage) : null));
    if (again && !("overlayPng" in again)) return again;
    if (verifyChecks.length === 0) {
      if (again) painted = again;
    } else {
      const v2 = again && again.align >= MIN_ALIGN ? await check(again) : null;
      if (signal.aborted) return fail(null, "after");
      const vs = summary.verify!;
      vs.second = v2 ? verdict(v2) : "no_picture";
      if (v2) {
        summary.costUsd += v2.costUsd;
        vs.ms += v2.ms;
        vs.costUsd += v2.costUsd;
        if (v2.error) vs.error = v2.error;
      }
      if (again && v2?.ok) painted = again;
      else if (failedCheck) return withhold();
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
