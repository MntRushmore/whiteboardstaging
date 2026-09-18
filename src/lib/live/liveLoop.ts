"use client";

import { Box, createShapeId } from "tldraw";
import type {
  Editor,
  HistoryEntry,
  JsonObject,
  Mat,
  TLDrawShape,
  TLRecord,
  TLShape,
  TLShapeId,
  TLShapePartial,
} from "tldraw";
import { isApiError } from "@/lib/api-client";
import { clientMetric } from "@/lib/logger";
import {
  GRAPH_COLORS,
  GRAPH_SHAPE_DEFAULTS,
  LIVE_LIMITS,
  LIVE_TIMING,
  MATH_SHAPE_DEFAULTS,
  isLiveMeta,
  type Annotation,
  type CapabilitiesResponse,
  type CheckLine,
  type CheckRequest,
  type GraphShape,
  type GraphShapeProps,
  type InkLine,
  type InkStroke,
  type LineAnalysis,
  type LiveController,
  type LiveEngine,
  type LiveLineState,
  type LiveShapeMeta,
  type LiveSseEvent,
  type LiveTranscript,
  type LiveTranscriptLine,
  type MathShape,
  type MathShapeProps,
  type MathTone,
  type OpenHint,
  type RecognizeRequest,
  type RecognizeResponse,
  type Rect,
  type SolveRequest,
  type UseLiveMathOptions,
} from "./contracts";
import { endsWithRelation } from "./answer";
import { getEngine as defaultGetEngine } from "./engine";
import { LIVE_COPY } from "@/components/live/copy";
import { classifyLiveFailure, sseFailure, type ClassifyContext } from "@/components/live/errorView";
import {
  clearLiveError,
  liveStore,
  markBurst,
  removeLine,
  setLine,
  setLiveError,
  type LiveError,
  type LiveErrorKind,
} from "./liveStore";
import { scheduleLiveWrite } from "./liveWrite";
import { getLiveSettings } from "./liveSettings";
import {
  HandWriter,
  handBlockOf,
  handSeedFor,
  handSizeFor,
  inlineHandSizeFor,
  placeHandPlan,
  placeHandPlanOnBaseline,
  planHandwriting,
  type HandPlan,
} from "./handwriting";
import {
  ECHO_HEIGHTS,
  ECHO_WIDTH_RELAYOUT_PX,
  echoSizeFor,
  estimateEchoWidth,
  expandRect,
  findFreeSlot,
  inlineAnswerGap,
  normalizeBBox,
  placeEcho,
  placeFloating,
  placeGraph,
  placeStep,
  PLACEMENT,
  rectMaxX,
  rectMaxY,
  rectsIntersect,
} from "./placement";
import { badgeFor, decide, localNoteFor, type PolicyDecision } from "./policy";
import { createSolveStepGuard, engineParsesStep, localAnswerFor, localAnswerStep } from "./solveSteps";
import {
  RecognizeClient,
  RecognizeTimeoutError,
  createRecognizeClient,
  fetchCapabilities as defaultFetchCapabilities,
  isAbortLike,
  recognizeFailureHints,
} from "./recognizeClient";
import { streamLiveSse as defaultStream, type StreamOptions } from "./sseClient";
import { clusterLines, rebuildFromMathShapes, unionRects, type EchoShapeSeed } from "./strokeClusters";
import { buildPayload, hashPayload } from "./strokePayload";

/**
 * The client live loop (spec §6). Everything the hook does lives here so it can be
 * driven by a headless tldraw store in tests. Only the listed editor methods are used.
 */
export interface LiveEditorLike {
  store: Editor["store"];
  getCurrentPageShapes(): TLShape[];
  getShape(id: TLShapeId): TLShape | undefined;
  getShapePageBounds(shape: TLShape | TLShapeId): Box | undefined;
  getShapePageTransform(shape: TLShape | TLShapeId): Mat;
  getViewportPageBounds(): Box;
  createShapes(shapes: TLShapePartial[]): unknown;
  updateShapes(shapes: TLShapePartial[]): unknown;
  deleteShapes(ids: TLShapeId[]): unknown;
  toImage?: Editor["toImage"];
}

export type StreamFn = (path: string, body: unknown, opts?: StreamOptions) => AsyncGenerator<LiveSseEvent, void, undefined>;

export interface LiveLoopDeps {
  recognizer: RecognizeClient;
  stream: StreamFn;
  getEngine: () => Promise<LiveEngine>;
  fetchCapabilities: () => Promise<CapabilitiesResponse>;
  now: () => number;
  /** window-like event target for online/offline; null in tests */
  events: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
  isOnline: () => boolean;
  /** per-device "tutor writes by hand" switch; off falls back to the typeset solve steps */
  handwritingEnabled: () => boolean;
  /** prefers-reduced-motion: the finished handwriting appears with no reveal animation */
  reducedMotion: () => boolean;
}

interface LineRuntime {
  checkAbort: AbortController | null;
  solveAbort: AbortController | null;
  unreadableShown: boolean;
  unreadableTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  shownHintTexts: Set<string>;
  escalation: number;
  processing: number;
  /**
   * Plot expression whose graph the student closed (header x / delete). The graph is not
   * re-created for this line until its plot expression changes. Persisted on the echo's
   * meta (`graphDismissed`) so a reload does not bring the card back.
   */
  graphDismissedExpr: string | null;
}

type CheckOpts = { userAsked: boolean; modeOverride?: "feedback" | "suggest"; forceHint?: boolean };
type SolveOpts = { onlyFirstStep?: boolean; lineId: string };

/** What `retryLastError` re-runs; captured at the moment a call fails. */
type RetryContext =
  | { kind: "capabilities" }
  | { kind: "recognize"; lineId: string }
  | { kind: "check"; lineId: string; opts: CheckOpts }
  | { kind: "solve"; lineId: string; fromLineId: string | undefined; opts: SolveOpts };

/** How one line's recognition ended, folded into the burst state by `flush`. */
/**
 * What a processed line means for the LEGACY image pipeline, which runs on an idle timer
 * whenever Live leaves the burst unclaimed. 'owned' = Live read maths here (even if it chose
 * to stay quiet, as it does for a half-written line); 'silent' = not maths, or unreadable.
 */
type LineOutcome = "owned" | "silent" | "failed";

/** Recognition failures that leave a chip under the ink (the pill carries the rest). */
const CHIP_CODES: ReadonlySet<LiveError["code"]> = new Set(["network", "upstream", "timeout", "unknown"]);

/**
 * How long the whole canvas must go without student ink before the tutor will write an
 * ANSWER (`contracts.ts` is frozen, so the constant lives with the timer that arms it).
 *
 * `LIVE_TIMING.quietMs` (600 ms) is a different question: it asks "is this line finished",
 * which is all recognition and a badge need. This one asks "has the student stopped", which
 * is what the answer needs — writing `38` under someone's nose while they are three lines
 * into a derivation answers the step they were about to take themselves.
 *
 * 2.5 s, from watching real writing: glyph-to-glyph gaps are ~0.1-0.3 s, the pen-lift between
 * lines of a derivation runs to ~1-1.5 s once you count re-positioning and a moment's thought,
 * and the quiet gate already proves 600 ms is not enough to mean "done". 2 s still caught a
 * mid-derivation pause; 5 s (the old per-line `unknownIdleMs` this replaces) is far too long
 * to wait after deliberately stopping. 2.5 s clears the natural in-flow pause and still reads
 * as "a beat later" when you put the pen down. The asymmetry is deliberate: firing late costs
 * a moment's wait, firing early takes the problem out of the student's hands.
 */
export const ANSWER_SETTLE_MS = 2500;

const CHECK_PATH = "/api/live/check";
const SOLVE_PATH = "/api/live/solve";
const UNREADABLE_NOTE = "Couldn't read this — tap to type it";
/**
 * Shown when every step the solve stream sent failed the local interlock. It goes through the
 * same path as a server-sent solve error, so the student gets the pill, the inline card and
 * the Retry they already know — and nothing is drawn.
 */
const UNUSABLE_SOLUTION = "Couldn't work this out";
const NOTATION_NOTE = "Not what you wrote? Tap to fix.";
/** Dispatched on window by the math shape's warn/ok badge: `detail: { lineId, shapeId }`. */
export const BADGE_TAP_EVENT = "live:badge-tap";
/** Echo meta key recording a dismissed graph's plot expression. */
const GRAPH_DISMISSED_META = "graphDismissed";
/**
 * Echo meta key marking `props.note` as LLM-authored (a check/solve annotation), as opposed
 * to the local engine's note. `meta` is a free-form JsonObject, so this needs no change to
 * MathShapeProps or contracts.ts. An AI note survives every local re-render — mount,
 * cascade, mode switch — and is dropped only when the line's latex changes.
 */
const AI_NOTE_META = "aiNote";

/**
 * Meta of the tutor's ANSWER ink — the handwriting that finishes a line the student ended with
 * `=`. Three keys, all on the same stroke shapes the hand writer creates:
 *
 *  - `answerFor`  the student's line, exactly as it was read, at the moment it was answered.
 *                 A line that now reads differently has been rewritten, so its answer is stale
 *                 and is erased rather than joined by a second one.
 *  - `answerLatex` what was written, so pressing Solve again recognises its own answer.
 *  - `answerAnchors` the student strokes the answer was placed against. A line answered this
 *                 way has no echo, and echoes are what `rebuild()` seeds line ids from — so
 *                 after a reload the line id is new and only the stroke ids still match.
 */
const ANSWER_SRC_META = "answerFor";
const ANSWER_LATEX_META = "answerLatex";
const ANSWER_ANCHORS_META = "answerAnchors";

function metaString(meta: unknown, key: string): string {
  if (typeof meta !== "object" || meta === null) return "";
  const v = (meta as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

/** The student line this shape is the tutor's answer to, or "" when it is not answer ink. */
function answerSrcOf(meta: unknown): string {
  return metaString(meta, ANSWER_SRC_META);
}

function answerLatexOf(meta: unknown): string {
  return metaString(meta, ANSWER_LATEX_META);
}

function answerAnchorsOf(meta: unknown): string[] {
  if (typeof meta !== "object" || meta === null) return [];
  const v = (meta as Record<string, unknown>)[ANSWER_ANCHORS_META];
  return Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : [];
}

function graphDismissedOf(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null) return null;
  const v = (meta as Record<string, unknown>)[GRAPH_DISMISSED_META];
  return typeof v === "string" && v ? v : null;
}

/** True when this echo's `props.note` came from the model and must outlive a re-analysis. */
export function isAiNote(meta: unknown): boolean {
  return typeof meta === "object" && meta !== null && (meta as Record<string, unknown>)[AI_NOTE_META] === true;
}

function isShapeRecord(r: unknown): r is TLShape {
  return typeof r === "object" && r !== null && (r as { typeName?: string }).typeName === "shape";
}

function isDraw(shape: TLShape): shape is TLDrawShape {
  return shape.type === "draw";
}

function isStudentInk(shape: TLShape): boolean {
  if (!isDraw(shape)) return false;
  if (shape.isLocked) return false;
  const meta = shape.meta as { isProtected?: unknown } | undefined;
  if (meta?.isProtected) return false;
  return !isLiveMeta(shape.meta);
}

function boxToRect(b: Box): Rect {
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

function sameStrokeSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function makeMeta(source: LiveShapeMeta["source"], lineId: string, now: number, extra?: Partial<LiveShapeMeta>): LiveShapeMeta {
  return { live: true, source, lineId, createdAt: now, ...extra };
}

function defaultDeps(): LiveLoopDeps {
  const hasWindow = typeof window !== "undefined";
  return {
    recognizer: createRecognizeClient(),
    stream: defaultStream,
    getEngine: defaultGetEngine,
    fetchCapabilities: () => defaultFetchCapabilities(),
    now: () => Date.now(),
    events: hasWindow ? window : null,
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
    handwritingEnabled: () => getLiveSettings().handwriting,
    reducedMotion: () =>
      hasWindow && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

function newLineState(line: InkLine): LiveLineState {
  return {
    line,
    latex: "",
    confidence: 0,
    provider: "none",
    analysis: null,
    mathShapeId: null,
    graphShapeId: null,
    hintsShown: 0,
    rewritesWithWarn: 0,
    edited: false,
    updatedAt: Date.now(),
  };
}

export class LiveLoop implements LiveController {
  readonly editor: LiveEditorLike;
  private opts: UseLiveMathOptions;
  private readonly deps: LiveLoopDeps;
  private engine: LiveEngine | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeRemote: (() => void) | null = null;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  /** the canvas-level settle clock: running means the student is still considered to be working */
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * True once no student ink has touched the canvas for `ANSWER_SETTLE_MS`. Starts false so a
   * mount / reload renders exactly as it does today: nothing is answered until the student
   * has written something and then stopped.
   */
  private settled = false;
  private dirtyStrokeIds = new Set<string>();
  private pendingRewrite = false;
  private readonly rt = new Map<string, LineRuntime>();
  /** lines whose recognition could not reach the network; replayed on reconnect (no cap) */
  private readonly offlineQueue = new Set<string>();
  /** lines the next flush must recognize even when their stroke set is unchanged */
  private readonly forceRecognize = new Set<string>();
  /** LLM checks asked for while offline (focus line id -> userAsked); re-run once after reconnect */
  private readonly pendingChecks = new Map<string, boolean>();
  private pendingSolve: string | null = null;
  /** the handwriting reveal in flight, if any (one block at a time) */
  private writer: HandWriter | null = null;
  /** any answer ink on the page at all; kept by `recount` so the common render costs nothing */
  private hasAnswerInk = false;
  private lastOnline: boolean | null = null;
  private lastTouchedLineId: string | null = null;
  private started = false;
  /** the failed call the pill's Retry re-runs */
  private retryContext: RetryContext | null = null;
  /** `${kind}:${lineId}` of the call whose retries are being counted */
  private retryKey: string | null = null;
  /** how many times the student pressed Retry for `retryKey` */
  private retryAttempt = 0;
  private readonly retryHandler = () => this.retryLastError();
  private readonly onOnline = () => this.setOnline(true);
  private readonly onOffline = () => this.setOnline(false);
  private readonly onBadgeTap = (e: Event): void => {
    const detail = ((e as CustomEvent<{ lineId?: unknown; shapeId?: unknown }>).detail ?? {}) as {
      lineId?: unknown;
      shapeId?: unknown;
    };
    let lineId = typeof detail.lineId === "string" ? detail.lineId : "";
    if (!lineId && typeof detail.shapeId === "string") {
      const found = Object.values(liveStore.lines.get()).find((st) => st.mathShapeId === detail.shapeId);
      lineId = found?.line.id ?? "";
    }
    if (lineId) this.handleBadgeTap(lineId);
  };

  constructor(editor: LiveEditorLike, opts: UseLiveMathOptions, deps: Partial<LiveLoopDeps> = {}) {
    this.editor = editor;
    this.opts = opts;
    this.deps = { ...defaultDeps(), ...deps };
  }

  // ---------------------------------------------------------------- lifecycle
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.editor.store.listen((entry) => this.onChange(entry), { source: "user", scope: "document" });
    // Our own writes and the shapes' measured-size writes arrive as 'remote'. We only read
    // them to re-place shapes anchored to an echo whose width changed and to notice a
    // graph closed from its header; nothing here ever marks a burst or recognizes.
    this.unsubscribeRemote = this.editor.store.listen((entry) => this.onRemoteChange(entry), {
      source: "remote",
      scope: "document",
    });
    this.deps.events?.addEventListener("online", this.onOnline);
    this.deps.events?.addEventListener("offline", this.onOffline);
    this.deps.events?.addEventListener(BADGE_TAP_EVENT, this.onBadgeTap);
    this.lastOnline = this.deps.isOnline();
    this.rebuild();
    this.recount();
    void this.deps
      .getEngine()
      .then((engine) => {
        this.engine = engine;
        this.reanalyzeAll();
      })
      .catch((e) => console.warn("[live] engine failed to load", e));
    liveStore.retryHandler.set(this.retryHandler);
    this.fetchCaps();
    liveStore.status.set(this.opts.enabled ? "idle" : "paused");
  }

  /** GET /api/live/recognize: recognizer kind + warmup. A failure while online is shown and retryable. */
  private fetchCaps(): void {
    void this.deps
      .fetchCapabilities()
      .then((caps) => {
        // a loop stopped while the request was in flight must not write to the store
        if (!this.started) return;
        liveStore.recognizer.set(caps.recognizer);
        this.noteSuccess("capabilities");
      })
      .catch((err: unknown) => {
        // offline: recognizer stays 'unknown' and nothing is shown (classify returns null)
        if (this.started) this.fail(err, { kind: "capabilities" }, { kind: "capabilities" });
      });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeRemote?.();
    this.unsubscribeRemote = null;
    this.deps.events?.removeEventListener("online", this.onOnline);
    this.deps.events?.removeEventListener("offline", this.onOffline);
    this.deps.events?.removeEventListener(BADGE_TAP_EVENT, this.onBadgeTap);
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.settled = false;
    // Leaving the board / unmounting must not freeze a half-written step on the canvas.
    this.cancelHandwriting();
    this.deps.recognizer.abortAll();
    for (const r of this.rt.values()) {
      r.checkAbort?.abort();
      r.solveAbort?.abort();
      if (r.unreadableTimer) clearTimeout(r.unreadableTimer);
      if (r.idleTimer) clearTimeout(r.idleTimer);
    }
    this.rt.clear();
    this.dirtyStrokeIds.clear();
    this.forceRecognize.clear();
    this.offlineQueue.clear();
    this.pendingChecks.clear();
    this.pendingSolve = null;
    liveStore.offlineQueued.set(0);
    liveStore.solving.set(0);
    if (liveStore.retryHandler.get() === this.retryHandler) liveStore.retryHandler.set(null);
    this.resetRetry();
  }

  // ---------------------------------------------------------------- errors + retry
  /**
   * Records a failed call as the visible error (unless it is a plain network failure while
   * offline, which the offline queue owns) and remembers how to retry it. Repeated failures
   * of the same call after Retry carry the attempt count in the message.
   */
  private fail(err: unknown, ctx: Omit<ClassifyContext, "online" | "attempts">, retry: RetryContext): LiveError | null {
    const key = `${ctx.kind}:${ctx.lineId ?? ""}`;
    const attempts = this.retryKey === key ? this.retryAttempt + 1 : 1;
    const fields = classifyLiveFailure(err, { ...ctx, online: this.deps.isOnline(), attempts });
    if (!fields) return null;
    if (this.retryKey !== key) {
      this.retryKey = key;
      this.retryAttempt = 0;
    }
    this.retryContext = retry;
    // Recognition (or the capabilities probe) failed for the ink Live owns: the burst is
    // 'failed', so the legacy image pipeline waits instead of spending credits during an
    // outage. Low confidence and non-math ink never get here (they end 'unhandled').
    if (ctx.kind === "recognize" || ctx.kind === "capabilities") {
      const burst = liveStore.lastBurst.get()?.state;
      if (burst === "pending" || burst === "failed") {
        markBurst("failed");
        fields.detail = LIVE_COPY.errors.recognizePaused;
      }
    }
    return setLiveError(fields);
  }

  /** The call succeeded: drop its error (if it is the one showing) and its retry state. */
  private noteSuccess(kind: LiveErrorKind, lineId?: string): void {
    const cur = liveStore.lastError.get();
    if (cur && cur.kind === kind && cur.lineId === lineId) clearLiveError();
    if (this.retryKey === `${kind}:${lineId ?? ""}`) this.resetRetry();
  }

  private resetRetry(): void {
    this.retryContext = null;
    this.retryKey = null;
    this.retryAttempt = 0;
  }

  /** New ink or typed text on a line makes any error about it stale. */
  private clearErrorsForLine(lineId: string): void {
    if (liveStore.lastError.get()?.lineId === lineId) clearLiveError();
  }

  /**
   * Re-runs the failed call behind `liveStore.lastError`: recognition flushes the line now
   * (no quiet gate), check/solve reopen one stream with the same options, capabilities
   * re-fetch. Success clears the error; another failure updates it with the attempt count.
   */
  retryLastError(): void {
    const err = liveStore.lastError.get();
    const ctx = this.retryContext;
    if (!err || !ctx || !this.started) return;
    this.retryAttempt++;
    const lines = liveStore.lines.get();
    switch (ctx.kind) {
      case "capabilities":
        this.fetchCaps();
        return;
      case "recognize":
        this.recognizeNow(ctx.lineId);
        return;
      case "check": {
        const st = lines[ctx.lineId];
        if (!st?.latex) {
          clearLiveError();
          return;
        }
        this.pendingChecks.delete(ctx.lineId);
        this.startCheck(st.line.column, ctx.lineId, ctx.opts);
        return;
      }
      case "solve": {
        const st = lines[ctx.lineId];
        if (!st?.latex) {
          clearLiveError();
          return;
        }
        if (this.pendingSolve === ctx.lineId) this.pendingSolve = null;
        this.startSolve(st.line.column, ctx.fromLineId, ctx.opts);
        return;
      }
    }
  }

  /** Recognizes one line immediately with its current ink, bypassing the quiet gate. */
  private recognizeNow(lineId: string): void {
    const st = liveStore.lines.get()[lineId];
    if (!st) {
      clearLiveError();
      return;
    }
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    this.pendingRewrite = false;
    if (this.offlineQueue.delete(lineId)) liveStore.offlineQueued.set(this.offlineQueue.size);
    for (const sid of st.line.strokeIds) this.dirtyStrokeIds.add(sid);
    this.forceRecognize.add(lineId);
    this.flush();
  }

  setOptions(next: UseLiveMathOptions): void {
    const prev = this.opts;
    this.opts = next;
    // navigator.onLine may have flipped without a window event reaching us (tests, or a
    // hook re-render after a failed fetch): treat the current answer as the truth.
    this.setOnline(this.deps.isOnline());
    if (prev.enabled !== next.enabled) {
      liveStore.status.set(next.enabled ? "idle" : "paused");
      if (!next.enabled) {
        this.deps.recognizer.abortAll();
        for (const r of this.rt.values()) r.checkAbort?.abort();
        this.cancelHandwriting();
      }
    }
    if (prev.mode !== next.mode) {
      this.cancelHandwriting();
      this.reanalyzeAll();
      const hintsMode = (m: UseLiveMathOptions["mode"]) => m === "suggest" || m === "answer";
      if (hintsMode(next.mode) && !hintsMode(prev.mode)) this.checkMismatchesAfterLadderRise();
    }
  }

  /**
   * The dial moved up to Suggest/Solve: lines already flagged amber get their check now
   * (spec ladder: mismatch + no hint yet), one per column with the lowest amber line as
   * focus, and none while a hint card is open (one-open-hint rule).
   */
  private checkMismatchesAfterLadderRise(): void {
    if (!this.engine || !this.opts.enabled || this.opts.voiceActive) return;
    if (liveStore.openHints.get().length > 0) return;
    const focusByColumn = new Map<number, LiveLineState>();
    const all = Object.values(liveStore.lines.get()).sort(
      (a, b) => a.line.column - b.line.column || a.line.row - b.line.row,
    );
    for (const st of all) {
      if (!st.latex || st.analysis?.verdict !== "mismatch") continue;
      if (st.hintsShown >= LIVE_LIMITS.maxHintsPerLine) continue;
      if (!this.decisionFor(st).runLlmCheck) continue;
      focusByColumn.set(st.line.column, st);
    }
    for (const st of focusByColumn.values()) this.startCheck(st.line.column, st.line.id, { userAsked: false });
  }

  /** Badge tapped on an echo: a check in every mode; a second tap in Suggest/Solve escalates. */
  private handleBadgeTap(lineId: string): void {
    const st = liveStore.lines.get()[lineId];
    if (!st?.latex || !this.opts.enabled) return;
    const mode = this.opts.mode;
    if (mode === "off") return;
    const rt = this.runtime(lineId);
    if ((mode === "suggest" || mode === "answer") && st.hintsShown > 0 && rt.escalation < 2) {
      this.escalate(lineId);
      return;
    }
    this.requestCheck(lineId);
  }

  /** Remote-sourced changes: measured echo widths and graphs closed from their header. */
  private onRemoteChange(entry: HistoryEntry<TLRecord>): void {
    if (!this.started) return;
    const lines = liveStore.lines.get();
    for (const [from, to] of Object.values(entry.changes.updated)) {
      if (!isShapeRecord(to) || !isShapeRecord(from) || to.type !== "math" || !isLiveMeta(to.meta)) continue;
      const fp = from.props as MathShapeProps;
      const tp = to.props as MathShapeProps;
      if (Math.abs(tp.w - fp.w) <= ECHO_WIDTH_RELAYOUT_PX) continue;
      const lineId = tp.lineId || to.meta.lineId;
      if (lines[lineId]?.mathShapeId === to.id) this.relayoutForEcho(lineId);
    }
    for (const rec of Object.values(entry.changes.removed)) {
      if (!isShapeRecord(rec) || rec.type !== "graph" || !isLiveMeta(rec.meta)) continue;
      const lineId = (rec.props as GraphShapeProps).lineId || rec.meta.lineId;
      const st = lines[lineId];
      // Our own deletes null the id inside the same write; a still-recorded id means the
      // student closed the card.
      if (st?.graphShapeId === rec.id) this.markGraphDismissed(lineId);
    }
  }

  getOptions(): UseLiveMathOptions {
    return this.opts;
  }

  // ---------------------------------------------------------------- store listener
  private onChange(entry: HistoryEntry<TLRecord>): void {
    if (!this.opts.enabled) return;
    let penUp = false;
    let inkChanged = false;
    let erased = false;
    /** the pen is down: a stroke in progress, which is working just as much as a finished one */
    let penDown = false;

    for (const rec of Object.values(entry.changes.added)) {
      if (!isShapeRecord(rec) || !isStudentInk(rec)) continue;
      if ((rec as TLDrawShape).props.isComplete) {
        this.dirtyStrokeIds.add(rec.id);
        penUp = true;
      } else penDown = true;
    }

    for (const [from, to] of Object.values(entry.changes.updated)) {
      if (!isShapeRecord(to) || !isShapeRecord(from)) continue;
      if (isDraw(to)) {
        if (!isStudentInk(to)) continue;
        const f = from as TLDrawShape;
        if (!to.props.isComplete) penDown = true;
        if (!f.props.isComplete && to.props.isComplete) {
          this.dirtyStrokeIds.add(to.id);
          penUp = true;
        } else if (
          to.props.isComplete &&
          (f.x !== to.x || f.y !== to.y || f.props.segments !== to.props.segments || f.parentId !== to.parentId)
        ) {
          this.dirtyStrokeIds.add(to.id);
          inkChanged = true;
        }
        continue;
      }
      if (to.type === "math" && isLiveMeta(to.meta)) {
        const fp = from.props as MathShapeProps;
        const tp = to.props as MathShapeProps;
        if (fp.latex !== tp.latex && tp.lineId && liveStore.lines.get()[tp.lineId]) {
          this.retypeLine(tp.lineId, tp.latex);
        }
      }
    }

    for (const rec of Object.values(entry.changes.removed)) {
      if (!isShapeRecord(rec)) continue;
      if (isDraw(rec)) {
        const line = this.lineOfStroke(rec.id);
        if (line) {
          for (const sid of line.strokeIds) if (sid !== rec.id) this.dirtyStrokeIds.add(sid);
          this.dirtyStrokeIds.add(rec.id);
          erased = true;
        }
        continue;
      }
      if (isLiveMeta(rec.meta)) {
        const lineId = rec.meta.lineId;
        const st = liveStore.lines.get()[lineId];
        if (!st) continue;
        if (st.mathShapeId === rec.id) setLine(lineId, { mathShapeId: null });
        if (st.graphShapeId === rec.id) this.markGraphDismissed(lineId);
      }
    }

    // Any ink at all — a stroke in progress, a finished one, ink dragged somewhere else, ink
    // rubbed out — means the student is still working, wherever on the canvas it happened.
    if (penUp || inkChanged || erased || penDown) this.markUnsettled();

    if (penUp || inkChanged || erased) {
      // The student is working again: the tutor puts the pen down (finishing what it started).
      this.cancelHandwriting();
      if (penUp) markBurst("pending");
      const rewrite = [...this.dirtyStrokeIds].some((id) => {
        const line = this.lineOfStroke(id);
        return Boolean(line && liveStore.lines.get()[line.id]?.mathShapeId);
      });
      this.pendingRewrite = this.pendingRewrite || rewrite;
      this.armQuietTimer();
    }
  }

  private armQuietTimer(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    const delay = this.pendingRewrite ? LIVE_TIMING.rewriteQuietMs : LIVE_TIMING.quietMs;
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      this.pendingRewrite = false;
      this.flush();
    }, delay);
  }

  /**
   * The student touched the canvas: restart the settle clock.
   *
   * An answer that was waiting for the clock is CANCELLED, not queued — the timer is simply
   * re-armed from now, so there is no backlog of answers to land in a rush when they finally
   * stop. (An answer already being written is stopped by `cancelHandwriting` on the same
   * change, which finishes the stroke it is mid-way through rather than leaving half a glyph.)
   */
  private markUnsettled(): void {
    this.settled = false;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.settled = true;
      this.renderSettled();
    }, ANSWER_SETTLE_MS);
  }

  /**
   * The student has stopped writing everywhere: render the lines that were holding an answer.
   *
   * Only `render` re-runs. Nothing here re-recognizes, re-analyses or opens a model call — a
   * settle cannot make the tutor say something NEW, it can only place the answer the local
   * engine already had and the ladder was keeping back.
   */
  private renderSettled(): void {
    if (!this.opts.enabled || !this.engine) return;
    for (const state of Object.values(liveStore.lines.get())) {
      if (!state.latex || !state.analysis?.resultLatex) continue;
      this.render(state, this.decisionFor(state));
    }
  }

  private lineOfStroke(strokeId: string): InkLine | null {
    for (const st of Object.values(liveStore.lines.get())) {
      if (st.line.strokeIds.includes(strokeId as TLShapeId)) return st.line;
    }
    return null;
  }

  // ---------------------------------------------------------------- ink collection
  collectInk(): InkStroke[] {
    const out: InkStroke[] = [];
    for (const shape of this.editor.getCurrentPageShapes()) {
      if (!isStudentInk(shape) || !isDraw(shape) || !shape.props.isComplete) continue;
      const bounds = this.editor.getShapePageBounds(shape);
      if (!bounds) continue;
      const transform = this.editor.getShapePageTransform(shape);
      const segments = shape.props.segments.map((seg) =>
        seg.points.map((p) => {
          const page = transform.applyToPoint(p);
          return { x: page.x, y: page.y };
        }),
      );
      out.push({ id: shape.id, bounds: boxToRect(bounds), segments });
    }
    return out;
  }

  private strokeBoundsMap(): Map<string, Rect> {
    const map = new Map<string, Rect>();
    for (const shape of this.editor.getCurrentPageShapes()) {
      if (!isStudentInk(shape)) continue;
      const b = this.editor.getShapePageBounds(shape);
      if (b) map.set(shape.id, boxToRect(b));
    }
    return map;
  }

  /** Seeds lines from existing echoes so a reload never re-recognizes. */
  private rebuild(): void {
    const seeds: EchoShapeSeed[] = [];
    const graphs = new Map<string, TLShapeId>();
    for (const shape of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(shape.meta)) continue;
      if (shape.type === "math" && shape.meta.source === "echo") {
        const props = shape.props as MathShapeProps;
        seeds.push({ shapeId: shape.id, lineId: props.lineId || shape.meta.lineId, anchorIds: props.anchorIds, latex: props.latex });
      } else if (shape.type === "graph" && shape.meta.source === "echo") {
        const props = shape.props as GraphShapeProps;
        graphs.set(props.lineId || shape.meta.lineId, shape.id);
      }
    }
    if (seeds.length === 0) return;
    const rebuilt = rebuildFromMathShapes(seeds, this.strokeBoundsMap());
    const next: Record<string, LiveLineState> = { ...liveStore.lines.get() };
    for (const r of rebuilt) {
      const shape = this.editor.getShape(r.mathShapeId);
      const props = shape?.props as MathShapeProps | undefined;
      next[r.line.id] = {
        ...newLineState(r.line),
        latex: r.latex,
        confidence: 1,
        provider: shape && isLiveMeta(shape.meta) && shape.meta.edited ? "typed" : "none",
        edited: Boolean(shape && isLiveMeta(shape.meta) && shape.meta.edited),
        mathShapeId: r.mathShapeId,
        graphShapeId: graphs.get(r.line.id) ?? null,
        hintsShown: props?.note ? 1 : 0,
      };
      const dismissed = graphDismissedOf(shape?.meta);
      if (dismissed && !graphs.has(r.line.id)) this.runtime(r.line.id).graphDismissedExpr = dismissed;
    }
    liveStore.lines.set(next);
  }

  private runtime(lineId: string): LineRuntime {
    let r = this.rt.get(lineId);
    if (!r) {
      r = {
        checkAbort: null,
        solveAbort: null,
        unreadableShown: false,
        unreadableTimer: null,
        idleTimer: null,
        shownHintTexts: new Set(),
        escalation: 0,
        processing: 0,
        graphDismissedExpr: null,
      };
      this.rt.set(lineId, r);
    }
    return r;
  }

  // ---------------------------------------------------------------- flush (quiet gate fired)
  flush(): void {
    if (!this.opts.enabled) {
      this.dirtyStrokeIds.clear();
      return;
    }
    // Queued-while-offline lines ride along with the next flush once the network is back
    // (a failed fetch queues a line without any 'online' event ever following).
    if (this.offlineQueue.size > 0 && this.deps.isOnline()) this.absorbOfflineQueue();
    const dirty = new Set(this.dirtyStrokeIds);
    this.dirtyStrokeIds.clear();
    const force = new Set(this.forceRecognize);
    this.forceRecognize.clear();
    const ink = this.collectInk();
    const prevStates = liveStore.lines.get();
    const prevLines = Object.values(prevStates).map((s) => s.line);
    const lines = clusterLines(ink, prevLines);
    const nextIds = new Set(lines.map((l) => l.id));

    for (const prev of prevLines) if (!nextIds.has(prev.id)) this.dropLine(prev.id);

    const affected: Array<{ line: InkLine; moveOnly: boolean }> = [];
    for (const line of lines) {
      const prev = prevStates[line.id];
      if (!prev) {
        setLine(line.id, { ...newLineState(line) });
        affected.push({ line, moveOnly: false });
        continue;
      }
      const same = sameStrokeSet(prev.line.strokeIds, line.strokeIds);
      const forced = force.has(line.id);
      const touched = forced || line.strokeIds.some((id) => dirty.has(id)) || !same;
      setLine(line.id, { line: { ...line, hash: same ? prev.line.hash : "" } });
      if (touched) affected.push({ line: { ...line, hash: same ? prev.line.hash : "" }, moveOnly: same && !forced });
    }

    if (affected.length === 0) {
      if (liveStore.lastBurst.get()?.state === "pending") markBurst("unhandled");
      return;
    }
    let owned = false;
    let failed = false;
    void Promise.all(
      affected.map(async ({ line, moveOnly }) => {
        const outcome = await this.processLine(line, ink, moveOnly);
        owned = owned || outcome === "owned";
        failed = failed || outcome === "failed";
      }),
    ).then(() => {
      // 'failed' is re-evaluated here so a successful Retry turns it into 'handled' (or
      // 'unhandled' when the retried read is non-math) and hands the legacy pipeline back.
      const cur = liveStore.lastBurst.get()?.state;
      if (cur === "pending" || cur === "failed") markBurst(owned ? "handled" : failed ? "failed" : "unhandled");
    });
  }

  /**
   * 'owned' when Live read maths on this line, 'failed' when recognition itself failed
   * (a visible recognize error was recorded), otherwise 'silent'.
   */
  private async processLine(line: InkLine, ink: InkStroke[], moveOnly: boolean): Promise<LineOutcome> {
    const lineId = line.id;
    const rt = this.runtime(lineId);
    const ticket = ++rt.processing;
    this.lastTouchedLineId = lineId;
    if (rt.unreadableTimer) clearTimeout(rt.unreadableTimer);
    if (rt.idleTimer) clearTimeout(rt.idleTimer);
    rt.unreadableTimer = null;
    rt.idleTimer = null;
    this.closeHintsFor(lineId);

    const payload = buildPayload(line, ink);
    if (!payload) {
      this.applyUnknown(lineId, "Too much ink for one line");
      return "silent";
    }
    const hash = await hashPayload(payload);
    const state = liveStore.lines.get()[lineId];
    if (!state || rt.processing !== ticket) return state?.mathShapeId ? "owned" : "silent";

    const prevHash = state.line.hash;
    const isMove = moveOnly && Boolean(state.latex) && (prevHash === hash || prevHash === "");
    setLine(lineId, { line: { ...line, hash } });
    if (isMove) {
      this.replaceEcho(lineId);
      return state.mathShapeId ? "owned" : "silent";
    }

    // New or changed ink: recognize. Whatever failed for this line before is stale now.
    this.abortLlm(lineId);
    this.clearErrorsForLine(lineId);
    const startedAt = this.deps.now();
    const readingTimer = setTimeout(() => {
      if (liveStore.status.get() === "idle") liveStore.status.set("reading");
    }, LIVE_TIMING.readingLabelDelayMs);
    try {
      // A hash the client already knows resolves from the cache even offline.
      if (!this.deps.isOnline() && !this.deps.recognizer.peek(hash)) {
        this.queueOffline(lineId);
        return "silent";
      }
      const req: RecognizeRequest = {
        boardId: this.opts.boardId,
        lineId,
        strokes: { x: payload.x, y: payload.y },
        bounds: { w: payload.w, h: payload.h },
      };
      if (liveStore.recognizer.get() === "vision") {
        const crop = await this.captureCrop(line);
        if (crop) req.crop = crop;
      }
      const res = await this.recognizeWithCropFallback(line, req, hash);
      if (rt.processing !== ticket) return liveStore.lines.get()[lineId]?.mathShapeId ? "owned" : "silent";
      const owned = await this.applyRecognition(lineId, res);
      this.noteSuccess("recognize", lineId);
      clientMetric("live.echo.total.ms", { ms: this.deps.now() - startedAt, provider: res.provider, lineId });
      return owned ? "owned" : "silent";
    } catch (err) {
      if (isAbortLike(err) && !(err instanceof RecognizeTimeoutError)) return "silent";
      if (rt.processing !== ticket) return "silent";
      // Network failure (fetch throws TypeError) or the browser says offline: the offline
      // queue replays the line on reconnect. Offline, that is the whole story.
      const network = !(err instanceof RecognizeTimeoutError) && !isApiError(err) && (err instanceof TypeError || !this.deps.isOnline());
      if (network) this.queueOffline(lineId);
      if (network && !this.deps.isOnline()) return "silent";
      if (!network) console.warn("[live] recognize failed", err);
      const failure = this.fail(err, { kind: "recognize", lineId }, { kind: "recognize", lineId });
      // Never a silent blank: transport/model trouble leaves a chip pointing at Retry; sign-in,
      // rate-limit and credit problems are the pill's job (their message is not about the line).
      if (failure && CHIP_CODES.has(failure.code)) this.applyFailedRead(lineId, LIVE_COPY.errors.recognizeChip);
      else this.applyUnknown(lineId, "");
      return failure ? "failed" : "silent";
    } finally {
      clearTimeout(readingTimer);
      if (this.deps.recognizer.inFlight === 0 && liveStore.status.get() === "reading") liveStore.status.set("idle");
    }
  }

  /**
   * One recognize call, plus at most ONE retry carrying a crop.
   *
   * The server answers `recognizer_failed` + `needsCrop` when its stroke recognizer produced
   * nothing and we sent no image to fall back on — the case a broken Mathpix used to turn
   * into a dead end (every line 502, no vision fallback ever reachable). `recognizerDown`
   * (Mathpix rejected our credentials) additionally flips the recognizer for the rest of the
   * session so the next line attaches its crop on the FIRST attempt instead of paying a
   * failed round-trip each time. A retry that also fails is rethrown and lands in the normal
   * failure path ("Couldn't read this line — tap Retry"); there is never a second retry.
   */
  private async recognizeWithCropFallback(
    line: InkLine,
    req: RecognizeRequest,
    hash: string,
  ): Promise<RecognizeResponse> {
    try {
      return await this.deps.recognizer.recognize(req, hash);
    } catch (err) {
      const hints = recognizeFailureHints(err);
      if (hints.recognizerDown && liveStore.recognizer.get() !== "vision") liveStore.recognizer.set("vision");
      if (!hints.needsCrop || req.crop) throw err;
      const crop = await this.captureCrop(line);
      if (!crop) throw err;
      return await this.deps.recognizer.recognize({ ...req, crop }, hash);
    }
  }

  private async captureCrop(line: InkLine): Promise<string | undefined> {
    const toImage = this.editor.toImage;
    if (!toImage || typeof FileReader === "undefined" || line.bounds.w <= 0) return undefined;
    try {
      const { blob } = await toImage.call(this.editor, line.strokeIds, {
        format: "jpeg",
        quality: 0.8,
        background: true,
        padding: 8,
        bounds: Box.From(expandRect(line.bounds, 8)),
        scale: Math.min(1, 512 / line.bounds.w),
      });
      if (blob.size > LIVE_LIMITS.maxCropBytes) return undefined;
      return await new Promise<string | undefined>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
        reader.onerror = () => resolve(undefined);
        reader.readAsDataURL(blob);
      });
    } catch {
      return undefined;
    }
  }

  // ---------------------------------------------------------------- offline queue
  private queueOffline(lineId: string): void {
    liveStore.status.set("offline");
    this.offlineQueue.add(lineId);
    liveStore.offlineQueued.set(this.offlineQueue.size);
  }

  /** Connectivity changed (window event, or `isOnline()` read in setOptions). */
  setOnline(online: boolean): void {
    if (this.lastOnline === online) return;
    this.lastOnline = online;
    if (online) this.replayOffline();
    else liveStore.status.set("offline");
  }

  /**
   * Back online: every queued line and every still-unrecognized line goes through the
   * normal pipeline again (re-clustered, re-hashed, cache first), then the pending LLM
   * work runs for lines the current policy still allows.
   */
  private replayOffline(): void {
    const replaying = this.absorbOfflineQueue();
    if (liveStore.status.get() === "offline") liveStore.status.set("idle");
    if (this.dirtyStrokeIds.size > 0) this.armQuietTimer();
    this.replayPendingLlm(replaying);
  }

  /**
   * Moves the offline queue (plus unrecognized lines) into the dirty set for the next
   * flush. Lines whose ink was erased while offline are dropped with their echo.
   * Returns the ids that will be recognized.
   */
  private absorbOfflineQueue(): Set<string> {
    const lines = liveStore.lines.get();
    const candidates = new Set(this.offlineQueue);
    for (const st of Object.values(lines)) if (st.provider === "none" && st.latex === "") candidates.add(st.line.id);
    this.offlineQueue.clear();
    liveStore.offlineQueued.set(0);
    const replaying = new Set<string>();
    for (const id of candidates) {
      const st = lines[id];
      if (!st) continue;
      const alive = st.line.strokeIds.filter((sid) => {
        const shape = this.editor.getShape(sid);
        return Boolean(shape && isStudentInk(shape));
      });
      if (alive.length === 0) {
        this.dropLine(id);
        continue;
      }
      for (const sid of alive) this.dirtyStrokeIds.add(sid);
      this.forceRecognize.add(id);
      replaying.add(id);
    }
    return replaying;
  }

  /** Runs the LLM work asked for while offline, once, for lines the policy still allows. */
  private replayPendingLlm(skip: ReadonlySet<string>): void {
    const checks = [...this.pendingChecks];
    this.pendingChecks.clear();
    const solve = this.pendingSolve;
    this.pendingSolve = null;
    if (!this.opts.enabled || this.opts.voiceActive || this.opts.mode === "off") return;
    const lines = liveStore.lines.get();
    for (const [id, userAsked] of checks) {
      // A line about to be re-recognized gets its check from the normal pipeline.
      if (skip.has(id)) continue;
      const st = lines[id];
      if (!st?.latex || st.analysis?.verdict !== "mismatch") continue;
      // The policy (mode, hints already shown, voice, cap) decides as if asked right now.
      if (!this.decisionFor(st, { userAsked }).runLlmCheck) continue;
      this.startCheck(st.line.column, id, { userAsked });
    }
    if (solve && !skip.has(solve) && this.opts.mode === "answer" && lines[solve]?.latex) this.requestSolve(solve);
  }

  /** LLM stream could not start (offline / fetch TypeError): remember it, never spin. */
  private deferLlm(kind: "check" | "solve", lineId: string, userAsked = false): void {
    if (kind === "check") this.pendingChecks.set(lineId, userAsked || (this.pendingChecks.get(lineId) ?? false));
    else this.pendingSolve = lineId;
    liveStore.status.set("offline");
  }

  // ---------------------------------------------------------------- analysis + render
  private async ensureEngine(): Promise<LiveEngine> {
    if (this.engine) return this.engine;
    this.engine = await this.deps.getEngine();
    return this.engine;
  }

  private async applyRecognition(lineId: string, res: RecognizeResponse): Promise<boolean> {
    const state = liveStore.lines.get()[lineId];
    if (!state) return false;
    setLine(lineId, { latex: res.latex, confidence: res.confidence, provider: res.provider });
    await this.ensureEngine();
    return this.analyzeAndRender(lineId, { cascade: true });
  }

  private applyUnknown(lineId: string, note: string): void {
    const state = liveStore.lines.get()[lineId];
    if (!state) return;
    setLine(lineId, {
      latex: "",
      confidence: 0,
      provider: "none",
      analysis: { kind: "unknown", math: "", resultLatex: "", verdict: "unknown", note },
    });
    this.deleteLineShapes(lineId, { keepAi: true });
  }

  /** Recognition failed for reasons a retry can fix: keep the line, show a chip that says so. */
  private applyFailedRead(lineId: string, note: string): void {
    const state = liveStore.lines.get()[lineId];
    if (!state) return;
    setLine(lineId, {
      latex: "",
      confidence: 0,
      provider: "none",
      analysis: { kind: "unknown", math: "", resultLatex: "", verdict: "unknown", note },
    });
    if (state.graphShapeId) this.deleteGraph(lineId);
    this.upsertEcho(lineId, { latex: "", status: "unknown", resultLatex: "", note });
  }

  private columnLines(column: number): LiveLineState[] {
    return Object.values(liveStore.lines.get())
      .filter((s) => s.line.column === column)
      .sort((a, b) => a.line.row - b.line.row);
  }

  private columnContext(state: LiveLineState): { previous?: LineAnalysis; original?: LineAnalysis } {
    const col = this.columnLines(state.line.column);
    let previous: LineAnalysis | undefined;
    let original: LineAnalysis | undefined;
    for (const s of col) {
      if (s.line.row >= state.line.row) break;
      if (!s.analysis || !s.latex) continue;
      if (s.analysis.kind === "label" || s.analysis.kind === "incomplete" || s.analysis.kind === "unknown") continue;
      previous = s.analysis;
      if (!original && (s.analysis.kind === "equation" || s.analysis.kind === "inequality")) original = s.analysis;
    }
    return { previous, original };
  }

  private analyze(state: LiveLineState): LineAnalysis | null {
    if (!this.engine || !state.latex) return null;
    try {
      return this.engine.analyzeLine(state.latex, { ...this.columnContext(state), mode: this.opts.mode });
    } catch (e) {
      console.warn("[live] analyzeLine threw", e);
      return { kind: "unknown", math: "", resultLatex: "", verdict: "unknown", note: "" };
    }
  }

  private decisionFor(state: LiveLineState, extra: { userAsked?: boolean; idleMs?: number } = {}): PolicyDecision {
    return decide({
      mode: this.opts.mode,
      voiceActive: this.opts.voiceActive,
      analysis: state.analysis,
      latex: state.latex,
      confidence: state.confidence,
      idleMs: extra.idleMs ?? this.deps.now() - state.updatedAt,
      settled: this.settled,
      userAsked: extra.userAsked ?? false,
      hintsShownForLine: state.hintsShown,
      openHintCount: liveStore.openHints.get().length,
      rewritesWithWarn: state.rewritesWithWarn,
      liveShapeCount: liveStore.liveShapeCount.get(),
    });
  }

  /**
   * Runs the engine for one line, renders the echo/graph, cascades to the rows below
   * (their `previous` changed) and starts an LLM check when the ladder permits.
   * Returns true when the line has (or will have) an echo.
   */
  private analyzeAndRender(lineId: string, opts: { cascade?: boolean; idleMs?: number; fromIdle?: boolean } = {}): boolean {
    const state = liveStore.lines.get()[lineId];
    if (!state) return false;
    const analysis = this.analyze(state);
    const wasWarn = state.analysis?.verdict === "mismatch";
    const isWarn = analysis?.verdict === "mismatch";
    const rewritesWithWarn = isWarn ? state.rewritesWithWarn + (wasWarn && !opts.fromIdle ? 1 : 0) : 0;
    setLine(lineId, { analysis, rewritesWithWarn });
    const fresh = liveStore.lines.get()[lineId];
    if (!fresh) return false;
    const decision = this.decisionFor(fresh, { idleMs: opts.idleMs });
    this.render(fresh, decision);

    if (opts.cascade) {
      for (const below of this.columnLines(fresh.line.column)) {
        if (below.line.row <= fresh.line.row || !below.latex) continue;
        const a = this.analyze(below);
        setLine(below.line.id, { analysis: a });
        const b = liveStore.lines.get()[below.line.id];
        if (b) this.render(b, this.decisionFor(b));
      }
    }

    if (decision.echo && !opts.fromIdle) this.armIdleTimer(lineId);
    if (decision.runLlmCheck) this.startCheck(fresh.line.column, lineId, { userAsked: false });
    // Ownership, not visibility: a silent half-written line is still Live's, and saying
    // otherwise is what handed it to the legacy image model.
    return decision.owned;
  }

  private armIdleTimer(lineId: string): void {
    const rt = this.runtime(lineId);
    if (rt.idleTimer) clearTimeout(rt.idleTimer);
    if (this.opts.mode === "off") return;
    const state = liveStore.lines.get()[lineId];
    if (!state?.analysis) return;
    // Only the LLM check waits on this timer now. The answer used to as well ('answer' mode
    // plus a resultLatex, after `unknownIdleMs`), but a per-line idle is the wrong clock for
    // it: it kept running while the student wrote the next three lines, and then answered the
    // first one under them. The canvas-level settle (`markUnsettled`) owns the answer instead.
    if (state.analysis.verdict !== "unknown") return;
    // `updatedAt` is bumped by every setLine (including our own scheduled writes), so the
    // per-line processing ticket is the "ink or text changed since" signal.
    const ticket = rt.processing;
    rt.idleTimer = setTimeout(() => {
      rt.idleTimer = null;
      const cur = liveStore.lines.get()[lineId];
      if (!cur || rt.processing !== ticket || !this.opts.enabled) return;
      this.analyzeAndRender(lineId, { idleMs: LIVE_TIMING.unknownIdleMs, fromIdle: true });
    }, LIVE_TIMING.unknownIdleMs);
  }

  /**
   * Re-runs the engine for every line (mount, mode change). In mode 'off' the persisted
   * badges/notes of existing echoes are left untouched: the dial resets to Off on every
   * load and must not wipe the student's green checks (only new lines get badge none).
   */
  private reanalyzeAll(): void {
    if (!this.engine) return;
    const keepStatus = this.opts.mode === "off";
    const all = Object.values(liveStore.lines.get()).sort(
      (a, b) => a.line.column - b.line.column || a.line.row - b.line.row,
    );
    for (const st of all) {
      if (!st.latex) continue;
      const analysis = this.analyze(st);
      setLine(st.line.id, { analysis });
      const fresh = liveStore.lines.get()[st.line.id];
      if (fresh) this.render(fresh, this.decisionFor(fresh), { quiet: true, keepStatus });
    }
  }

  private render(
    state: LiveLineState,
    decision: PolicyDecision,
    opts: { quiet?: boolean; keepStatus?: boolean } = {},
  ): void {
    const lineId = state.line.id;
    const rt = this.runtime(lineId);
    // The line changed under an answer the tutor had already written: that answer is stale.
    this.dropStaleAnswer(state);
    if (!decision.echo) {
      if (state.mathShapeId || state.graphShapeId) this.deleteLineShapes(lineId, { keepAi: true });
      if (
        state.latex !== "" &&
        state.confidence < LIVE_LIMITS.minConfidence &&
        !rt.unreadableShown &&
        !rt.unreadableTimer &&
        !opts.quiet
      ) {
        const ticket = rt.processing;
        rt.unreadableTimer = setTimeout(() => {
          rt.unreadableTimer = null;
          const cur = liveStore.lines.get()[lineId];
          if (!cur || rt.processing !== ticket || !this.opts.enabled) return;
          rt.unreadableShown = true;
          this.upsertEcho(lineId, { latex: "", status: "unknown", resultLatex: "", note: UNREADABLE_NOTE });
        }, LIVE_TIMING.unreadableChipMs);
      }
      return;
    }
    // A finished sum does not want its own line read back at it — it wants the answer.
    if (this.inlineAnswer(state, decision)) return;
    const analysis = state.analysis;
    const status = decision.capped ? "none" : decision.badge;
    const resultLatex = decision.showResult && analysis ? analysis.resultLatex : "";
    let note = "";
    if (status === "warn") note = localNoteFor(analysis, this.opts.mode);
    if (analysis?.chem && this.opts.mode !== "off") {
      if (!analysis.chem.balanced) {
        // The balanced equation is an answer: only Solve reveals it; the other modes get
        // the local "Count the atoms" nudge, as does Solve when the balancer had no result.
        const balanced = analysis.chem.balancedLatex.trim();
        note =
          decision.revealChemBalance && balanced ? `Balanced: ${balanced}` : localNoteFor(analysis, this.opts.mode);
      } else if (status === "ok") {
        note = analysis.note;
      }
    }
    this.upsertEcho(lineId, { latex: state.latex, status, resultLatex, note }, { keepStatus: opts.keepStatus });
    if (analysis?.plot && !decision.capped) {
      if (rt.graphDismissedExpr !== null && rt.graphDismissedExpr !== analysis.plot.expr) this.clearGraphDismissed(lineId);
      if (rt.graphDismissedExpr === null) this.upsertGraph(lineId, analysis.plot);
    } else if (state.graphShapeId) this.deleteGraph(lineId);
  }

  // ---------------------------------------------------------------- shape writes
  private write(fn: () => void): void {
    // Only `store.mergeRemoteChanges` is used; Editor and the test double both provide it.
    scheduleLiveWrite(this.editor as Editor, () => {
      fn();
      this.recount();
    });
  }

  /**
   * Live shapes on the page, for the cap and the pill's "lots of marks" warning. The tutor's
   * handwriting is one draw shape per stroke, so a written block counts as ONE mark (its
   * `meta.handBlock` key), not as its thirteen strokes.
   */
  private recount(): void {
    let n = 0;
    let answers = false;
    const blocks = new Set<string>();
    for (const s of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(s.meta)) continue;
      if (answerSrcOf(s.meta)) answers = true;
      const block = handBlockOf(s.meta);
      if (block) blocks.add(block);
      else n++;
    }
    this.hasAnswerInk = answers;
    liveStore.liveShapeCount.set(n + blocks.size);
  }

  private avoidRects(lineId: string, exclude?: ReadonlySet<string>): Rect[] {
    const st = liveStore.lines.get()[lineId];
    const own = new Set<string>(st ? [...st.line.strokeIds, st.mathShapeId ?? "", st.graphShapeId ?? ""] : []);
    const out: Rect[] = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      if (own.has(s.id) || exclude?.has(s.id)) continue;
      const b = this.editor.getShapePageBounds(s);
      if (b) out.push(boxToRect(b));
    }
    return out;
  }

  private upsertEcho(
    lineId: string,
    wanted: Pick<MathShapeProps, "latex" | "status" | "resultLatex" | "note">,
    opts: { keepStatus?: boolean } = {},
  ): void {
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      if (!st) return;
      const size = echoSizeFor(st.line.bounds.h);
      const anchorIds = st.line.strokeIds as string[];
      const existing = st.mathShapeId ? this.editor.getShape(st.mathShapeId) : undefined;
      if (existing && existing.type === "math") {
        const cur = existing.props as MathShapeProps;
        // BUG-4: a note the model wrote is not something the local engine can reproduce.
        // Keep it while the line reads the same — otherwise `reanalyzeAll` on mount wrote
        // note:"" over the persisted hint and the autosave made the loss permanent.
        const wasAiNote = isAiNote(existing.meta);
        const keepAiNote = wasAiNote && Boolean(wanted.latex) && cur.latex === wanted.latex;
        // mode 'off' keeps status AND note untouched, so the provenance flag rides along too
        const aiNoteNow = opts.keepStatus ? wasAiNote : keepAiNote;
        const props = opts.keepStatus
          ? { ...wanted, status: cur.status, note: cur.note }
          : keepAiNote
            ? { ...wanted, note: cur.note }
            : wanted;
        const changed =
          cur.latex !== props.latex ||
          cur.status !== props.status ||
          cur.resultLatex !== props.resultLatex ||
          cur.note !== props.note ||
          !sameStrokeSet(cur.anchorIds, anchorIds);
        if (!changed) return;
        this.editor.updateShapes([
          {
            id: existing.id,
            type: "math",
            props: { ...props, anchorIds, lineId, tone: "muted", source: "echo" },
            // `false` (not a delete) because tldraw merges meta patches shallowly.
            meta: { ...(existing.meta as LiveShapeMeta), edited: st.edited, [AI_NOTE_META]: aiNoteNow },
          } satisfies TLShapePartial<MathShape>,
        ]);
        return;
      }
      const props = wanted;
      if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard && props.latex === "") return;
      const viewport = boxToRect(this.editor.getViewportPageBounds());
      const candidate = placeEcho(st.line.bounds, props.latex || UNREADABLE_NOTE, size, viewport);
      const rect = findFreeSlot(candidate, this.avoidRects(lineId), st.line.bounds);
      const id = createShapeId();
      const full: MathShapeProps = {
        ...MATH_SHAPE_DEFAULTS,
        ...props,
        w: rect.w,
        h: rect.h,
        source: "echo",
        anchorIds,
        lineId,
        size,
        tone: "muted",
      };
      this.editor.createShapes([
        {
          id,
          type: "math",
          x: rect.x,
          y: rect.y,
          props: full,
          meta: makeMeta("echo", lineId, this.deps.now(), { edited: st.edited }),
        } satisfies TLShapePartial<MathShape>,
      ]);
      setLine(lineId, { mathShapeId: id });
    });
  }

  /** Line moved: keep content, move the echo (and graph) to the new slot. */
  private replaceEcho(lineId: string): void {
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      if (!st?.mathShapeId) return;
      const shape = this.editor.getShape(st.mathShapeId);
      if (!shape || shape.type !== "math") return;
      const props = shape.props as MathShapeProps;
      const viewport = boxToRect(this.editor.getViewportPageBounds());
      const candidate = placeEcho(st.line.bounds, props.latex, props.size, viewport);
      const rect = findFreeSlot({ ...candidate, w: props.w, h: props.h }, this.avoidRects(lineId), st.line.bounds);
      const updates: TLShapePartial[] = [{ id: shape.id, type: "math", x: rect.x, y: rect.y }];
      if (st.graphShapeId) {
        const g = this.editor.getShape(st.graphShapeId);
        if (g) {
          const gp = g.props as GraphShapeProps;
          const gr = placeGraph(st.line.bounds, rect, { w: gp.w, h: gp.h }, viewport);
          updates.push({ id: g.id, type: "graph", x: gr.x, y: gr.y });
        }
      }
      this.editor.updateShapes(updates);
    });
  }

  private upsertGraph(lineId: string, plot: { expr: string; latex: string }): void {
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      if (!st) return;
      const fn = { id: `f_${lineId}`, expr: plot.expr, latex: plot.latex, color: GRAPH_COLORS[0] };
      const existing = st.graphShapeId ? this.editor.getShape(st.graphShapeId) : undefined;
      if (st.graphShapeId && !existing) {
        // Recorded id is gone from the store and we did not delete it: the student closed it.
        this.markGraphDismissed(lineId, plot.expr);
        return;
      }
      if (existing && existing.type === "graph") {
        const cur = existing.props as GraphShapeProps;
        if (cur.fns[0]?.expr === plot.expr) return;
        this.editor.updateShapes([
          { id: existing.id, type: "graph", props: { fns: [fn, ...cur.fns.slice(1)] } } satisfies TLShapePartial<GraphShape>,
        ]);
        return;
      }
      if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return;
      const viewport = boxToRect(this.editor.getViewportPageBounds());
      const echo = st.mathShapeId ? this.editor.getShapePageBounds(st.mathShapeId) : undefined;
      const rect = placeGraph(
        st.line.bounds,
        echo ? boxToRect(echo) : null,
        { w: GRAPH_SHAPE_DEFAULTS.w, h: GRAPH_SHAPE_DEFAULTS.h },
        viewport,
      );
      const id = createShapeId();
      this.editor.createShapes([
        {
          id,
          type: "graph",
          x: rect.x,
          y: rect.y,
          props: { ...GRAPH_SHAPE_DEFAULTS, fns: [fn], lineId, title: "" },
          meta: makeMeta("echo", lineId, this.deps.now()),
        } satisfies TLShapePartial<GraphShape>,
      ]);
      setLine(lineId, { graphShapeId: id });
    });
  }

  private deleteGraph(lineId: string): void {
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      if (!st?.graphShapeId) return;
      if (this.editor.getShape(st.graphShapeId)) this.editor.deleteShapes([st.graphShapeId]);
      setLine(lineId, { graphShapeId: null });
    });
  }

  /**
   * The student closed the graph: remember the plot expression so the card is not
   * re-created on the next render of this line (cascade, mode switch, reload).
   */
  private markGraphDismissed(lineId: string, expr?: string): void {
    const st = liveStore.lines.get()[lineId];
    if (!st) return;
    const dismissed = expr ?? st.analysis?.plot?.expr ?? "";
    this.runtime(lineId).graphDismissedExpr = dismissed;
    if (st.graphShapeId) setLine(lineId, { graphShapeId: null });
    this.writeGraphDismissedMeta(lineId, dismissed);
  }

  private clearGraphDismissed(lineId: string): void {
    const rt = this.rt.get(lineId);
    if (rt) rt.graphDismissedExpr = null;
    this.writeGraphDismissedMeta(lineId, "");
  }

  private writeGraphDismissedMeta(lineId: string, value: string): void {
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      if (!st?.mathShapeId) return;
      const echo = this.editor.getShape(st.mathShapeId);
      if (!echo || echo.type !== "math") return;
      if ((graphDismissedOf(echo.meta) ?? "") === value) return;
      this.editor.updateShapes([{ id: echo.id, type: "math", meta: { ...echo.meta, [GRAPH_DISMISSED_META]: value } }]);
    });
  }

  /**
   * The echo's measured width moved by more than ECHO_WIDTH_RELAYOUT_PX (KaTeX measured
   * after the estimate): re-place the graph to its right and push away AI shapes anchored
   * to this line that the wider echo now covers.
   */
  private relayoutForEcho(lineId: string): void {
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      if (!st?.mathShapeId) return;
      const echoBounds = this.editor.getShapePageBounds(st.mathShapeId);
      if (!echoBounds) return;
      const echo = boxToRect(echoBounds);
      const viewport = boxToRect(this.editor.getViewportPageBounds());
      const updates: TLShapePartial[] = [];
      if (st.graphShapeId) {
        const g = this.editor.getShape(st.graphShapeId);
        if (g && g.type === "graph") {
          const gp = g.props as GraphShapeProps;
          const gr = placeGraph(st.line.bounds, echo, { w: gp.w, h: gp.h }, viewport);
          if (Math.abs(gr.x - g.x) > 0.5 || Math.abs(gr.y - g.y) > 0.5) {
            updates.push({ id: g.id, type: "graph", x: gr.x, y: gr.y });
          }
        }
      }
      for (const s of this.editor.getCurrentPageShapes()) {
        if (s.type !== "math" || !isLiveMeta(s.meta) || s.meta.source !== "ai" || s.meta.lineId !== lineId) continue;
        const b = this.editor.getShapePageBounds(s);
        if (!b || !rectsIntersect(echo, boxToRect(b))) continue;
        // avoidRects() leaves out this line's own echo; here the echo is exactly the obstacle.
        const avoid = [echo, ...this.avoidRects(lineId, new Set([s.id]))];
        const slot = findFreeSlot(boxToRect(b), avoid, st.line.bounds);
        if (slot.x !== b.x || slot.y !== b.y) updates.push({ id: s.id, type: "math", x: slot.x, y: slot.y });
      }
      if (updates.length > 0) this.editor.updateShapes(updates);
    });
  }

  /** Deletes the echo + graph (+ AI shapes unless keepAi) of a line. */
  private deleteLineShapes(lineId: string, opts: { keepAi?: boolean } = {}): void {
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      const ids = new Set<TLShapeId>();
      if (st?.mathShapeId && this.editor.getShape(st.mathShapeId)) ids.add(st.mathShapeId);
      if (st?.graphShapeId && this.editor.getShape(st.graphShapeId)) ids.add(st.graphShapeId);
      if (!opts.keepAi) {
        for (const s of this.editor.getCurrentPageShapes()) {
          if (isLiveMeta(s.meta) && s.meta.lineId === lineId) ids.add(s.id);
        }
      }
      if (ids.size > 0) this.editor.deleteShapes([...ids]);
      if (st) setLine(lineId, { mathShapeId: null, graphShapeId: null });
    });
  }

  private dropLine(lineId: string): void {
    this.abortLlm(lineId);
    this.cancelHandwriting();
    const rt = this.rt.get(lineId);
    if (rt) {
      if (rt.unreadableTimer) clearTimeout(rt.unreadableTimer);
      if (rt.idleTimer) clearTimeout(rt.idleTimer);
      this.rt.delete(lineId);
    }
    this.deleteLineShapes(lineId);
    removeLine(lineId);
    if (this.retryContext && "lineId" in this.retryContext && this.retryContext.lineId === lineId) this.resetRetry();
  }

  private abortLlm(lineId: string): void {
    const rt = this.rt.get(lineId);
    if (!rt) return;
    rt.checkAbort?.abort();
    rt.checkAbort = null;
    rt.solveAbort?.abort();
    rt.solveAbort = null;
  }

  private closeHintsFor(lineId: string): void {
    const hints = liveStore.openHints.get();
    if (hints.some((h) => h.lineId === lineId)) liveStore.openHints.set(hints.filter((h) => h.lineId !== lineId));
  }

  // ---------------------------------------------------------------- LLM check
  private buildCheckLines(column: number): { lines: CheckLine[]; region: Rect; states: LiveLineState[] } | null {
    const states = this.columnLines(column).filter((s) => s.latex);
    if (states.length === 0) return null;
    const region = expandRect(unionRects(states.map((s) => s.line.bounds)), 24);
    const lines: CheckLine[] = states.slice(-LIVE_LIMITS.maxLinesPerCheck).map((s) => ({
      id: s.line.id,
      latex: s.latex.slice(0, 2000),
      bbox: normalizeBBox(s.line.bounds, region),
      local: {
        kind: s.analysis?.kind ?? "unknown",
        verdict: s.analysis?.verdict ?? "unknown",
        resultLatex: s.analysis?.resultLatex?.slice(0, 500) || undefined,
        note: s.analysis?.note?.slice(0, 200) || undefined,
      },
    }));
    return { lines, region, states };
  }

  private startCheck(column: number, focusLineId: string, opts: CheckOpts): void {
    const mode = this.opts.mode;
    if (mode === "off" || this.opts.voiceActive || !this.opts.enabled) return;
    const checkMode: "feedback" | "suggest" = opts.modeOverride ?? (mode === "feedback" ? "feedback" : "suggest");
    const built = this.buildCheckLines(column);
    if (!built) return;
    if (!this.deps.isOnline()) {
      this.deferLlm("check", focusLineId, opts.userAsked);
      return;
    }
    const rt = this.runtime(focusLineId);
    rt.checkAbort?.abort();
    const ctrl = new AbortController();
    rt.checkAbort = ctrl;
    const req: CheckRequest = {
      boardId: this.opts.boardId,
      mode: checkMode,
      region: built.region,
      lines: built.lines,
      focusLineId,
      userAsked: opts.userAsked,
    };
    const startedAt = this.deps.now();
    const errCtx = { kind: "check" as const, lineId: focusLineId, userAsked: opts.userAsked };
    const retry: RetryContext = { kind: "check", lineId: focusLineId, opts };
    liveStore.status.set("checking");
    void (async () => {
      let first = true;
      let failed = false;
      try {
        for await (const ev of this.deps.stream(CHECK_PATH, req, { signal: ctrl.signal })) {
          if (ctrl.signal.aborted) break;
          if (ev.event === "annotation") {
            if (first) {
              first = false;
              clientMetric("live.check.ttfa.ms", { ms: this.deps.now() - startedAt, lineId: focusLineId });
            }
            this.applyAnnotation(ev.data, focusLineId, checkMode, opts.forceHint ?? false);
          } else if (ev.event === "error") {
            failed = true;
            console.warn("[live] check error", ev.data);
            this.fail(sseFailure(ev.data), errCtx, retry);
          }
        }
      } catch (err) {
        if (!isAbortLike(err) && !ctrl.signal.aborted) {
          failed = true;
          // A network failure is also deferred so a reconnect replays it once, as before.
          if (this.isNetworkFailure(err)) this.deferLlm("check", focusLineId, opts.userAsked);
          else console.warn("[live] check failed", err);
          if (this.deps.isOnline()) this.fail(err, errCtx, retry);
        }
      } finally {
        if (rt.checkAbort === ctrl) rt.checkAbort = null;
        if (!failed && !ctrl.signal.aborted) this.noteSuccess("check", focusLineId);
        if (liveStore.status.get() === "checking") liveStore.status.set("idle");
      }
    })();
  }

  private applyAnnotation(a: Annotation, focusLineId: string, checkMode: "feedback" | "suggest", forceHint: boolean): void {
    const lineId = a.lineId ?? focusLineId;
    const state = liveStore.lines.get()[lineId];
    if (!state) return;
    const rt = this.runtime(lineId);
    if (a.verdict === "warn" && state.analysis?.verdict === "ok") return;
    if (a.expected && this.engine && this.engine.verifyExpected(a.expected, state.latex) === "equal") return;

    if (a.kind === "praise") {
      if (state.analysis?.verdict === "ok" || state.analysis?.solved) this.setEchoNote(lineId, a.message);
      return;
    }
    if (a.kind === "notation") {
      this.setEchoNote(lineId, NOTATION_NOTE);
      return;
    }
    // An explicit escalation (badge tap / "More help") re-shows the hint even when the model repeats itself,
    // so the card never just vanishes with no new help.
    if (!forceHint && rt.shownHintTexts.has(a.message)) return;

    if (a.verdict === "warn") {
      this.setEchoNote(lineId, a.message, "warn");
    } else if (checkMode === "feedback") {
      this.setEchoNote(lineId, a.message);
    }

    if (checkMode === "suggest") {
      const decision = this.decisionFor(state, { userAsked: true });
      const allow = forceHint ? liveStore.openHints.get().every((h) => h.lineId !== lineId) : decision.allowHint;
      if (!allow) return;
      const hint: OpenHint = {
        id: `h_${lineId}_${this.deps.now().toString(36)}`,
        lineId,
        message: a.message,
        question: a.question ?? "",
        level: rt.escalation,
        createdAt: this.deps.now(),
      };
      liveStore.openHints.set([...liveStore.openHints.get(), hint]);
      rt.shownHintTexts.add(a.message);
      setLine(lineId, { hintsShown: state.hintsShown + 1 });
      if (a.verdict !== "warn") this.setEchoNote(lineId, a.message);
    } else {
      rt.shownHintTexts.add(a.message);
    }
  }

  /**
   * Persists the shown text into the echo's note (work log) and optionally its status.
   * Every caller is an LLM annotation (warn / praise / notation / hint), so the note is
   * stamped `meta.aiNote`: the local engine must not overwrite it on the next re-analysis.
   */
  private setEchoNote(lineId: string, note: string, status?: MathShapeProps["status"]): void {
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      if (!st?.mathShapeId) return;
      const shape = this.editor.getShape(st.mathShapeId);
      if (!shape || shape.type !== "math") return;
      const props: Partial<MathShapeProps> = { note };
      if (status) props.status = status;
      this.editor.updateShapes([
        {
          id: shape.id,
          type: "math",
          props,
          meta: { ...shape.meta, [AI_NOTE_META]: Boolean(note) },
        } satisfies TLShapePartial<MathShape>,
      ]);
    });
  }

  /**
   * The student rewrote this line's text themselves, so a model note about the old text is
   * stale. (A re-recognition drops it through `upsertEcho`'s latex comparison; a retype
   * cannot, because the student's edit already changed `props.latex` in place.)
   */
  private clearAiNote(lineId: string): void {
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      if (!st?.mathShapeId) return;
      const shape = this.editor.getShape(st.mathShapeId);
      if (!shape || shape.type !== "math" || !isAiNote(shape.meta)) return;
      this.editor.updateShapes([
        {
          id: shape.id,
          type: "math",
          props: { note: "" },
          meta: { ...shape.meta, [AI_NOTE_META]: false },
        } satisfies TLShapePartial<MathShape>,
      ]);
    });
  }

  // ---------------------------------------------------------------- the answer at the end of a line
  /**
   * The calculator case: a line the local engine can evaluate that the student finished with
   * `=`. That trailing `=` is a question, not a statement — so the tutor answers it, in its own
   * hand, in its own colour, continuing their line. It does NOT read the line back to them:
   * for a finished sum the answer *is* the confirmation that it was read right.
   *
   * Returns true when the typeset echo must stand down — the answer is on the page, or it is
   * about to be and a restatement would only flash and vanish. False falls through to today's
   * echo (with the result composed by `answerContinuation`, so never a doubled `=`): the hand
   * switch is off, the hand engine cannot draw this answer, or there is no room beside their
   * work. The student is never left with nothing where they asked for an answer.
   */
  private inlineAnswer(state: LiveLineState, decision: PolicyDecision): boolean {
    if (!this.engine || decision.capped || !this.deps.handwritingEnabled()) return false;
    const answer = this.calculatorAnswerFor(state);
    if (!answer) return false;
    const lineId = state.line.id;
    if (this.answerBlocksFor(lineId).length === 0) {
      // Planned even while the reveal is still waiting, so a line whose answer the hand cannot
      // draw keeps its echo from the start rather than showing nothing for the idle delay.
      const plan = this.planInlineAnswer(state, answer);
      if (!plan) return false;
      if (decision.showResult) {
        this.dropEcho(lineId);
        this.startHandwriting(plan, lineId, this.answerMeta(state, answer));
        clientMetric("live.answer.hand", { lineId });
        return true;
      }
    }
    this.dropEcho(lineId);
    return true;
  }

  /**
   * The answer to a line the student ended with `=`, when the local engine already has one.
   *
   * Only a plain `expression`: an equation is a claim to check, not a sum to finish, and its
   * echo (badge included) is exactly the feedback that is still wanted. `analysis.resultLatex`
   * carries the mode gate — the engine only fills it in for a trailing `=` in Solve.
   */
  private calculatorAnswerFor(state: LiveLineState): string | null {
    if (!this.engine || !state.latex) return null;
    const analysis = state.analysis;
    if (!analysis || analysis.kind !== "expression" || !analysis.resultLatex) return null;
    if (!endsWithRelation(state.latex)) return null;
    return localAnswerFor(this.engine, state.latex, this.columnContext(state));
  }

  /**
   * Where the answer goes: after the student's last glyph, on their writing line, in a hand
   * the size of their own. Null when the hand cannot draw it, when it would run off the
   * viewport, or when something is already there — continuing their line means writing in
   * exactly that spot, so there is no second-choice slot to fall back on, only the echo.
   */
  private planInlineAnswer(state: LiveLineState, answer: string): HandPlan | null {
    const ink = state.line.bounds;
    const size = inlineHandSizeFor(ink.h);
    const { plan, unsupported } = planHandwriting([answer], { size, seed: handSeedFor(`${state.line.id}:answer`) });
    if (!plan || unsupported.length > 0) return null;
    const placed = placeHandPlanOnBaseline(plan, {
      x: rectMaxX(ink) + inlineAnswerGap(ink.h),
      baselineY: rectMaxY(ink),
    });
    const viewport = boxToRect(this.editor.getViewportPageBounds());
    if (rectMaxX(placed.bounds) > rectMaxX(viewport) - PLACEMENT.viewportMargin) return null;
    if (this.avoidRects(state.line.id).some((r) => rectsIntersect(r, placed.bounds))) return null;
    return placed;
  }

  private answerMeta(state: LiveLineState, answer: string): JsonObject {
    return {
      [ANSWER_SRC_META]: state.latex,
      [ANSWER_LATEX_META]: answer,
      [ANSWER_ANCHORS_META]: [...state.line.strokeIds],
    };
  }

  /** The tutor's answer ink for this line: by line id, or by the student strokes it was hung on. */
  private answerBlocksFor(lineId: string): TLShape[] {
    if (!this.hasAnswerInk) return [];
    const own = new Set<string>(liveStore.lines.get()[lineId]?.line.strokeIds ?? []);
    const out: TLShape[] = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(s.meta) || !answerSrcOf(s.meta)) continue;
      if (s.meta.lineId === lineId || answerAnchorsOf(s.meta).some((id) => own.has(id))) out.push(s);
    }
    return out;
  }

  /** Rewriting the line replaces its answer: the old one goes before the new one is written. */
  private dropStaleAnswer(state: LiveLineState): void {
    if (!this.hasAnswerInk) return;
    const stale = this.answerBlocksFor(state.line.id).filter((s) => answerSrcOf(s.meta) !== state.latex);
    if (stale.length === 0) return;
    this.write(() => {
      const ids = stale.map((s) => s.id).filter((id) => this.editor.getShape(id));
      if (ids.length > 0) this.editor.deleteShapes(ids);
    });
  }

  /** The tutor answered this line instead of restating it: the typeset echo stands down. */
  private dropEcho(lineId: string): void {
    const st = liveStore.lines.get()[lineId];
    if (!st?.mathShapeId && !st?.graphShapeId) return;
    this.deleteLineShapes(lineId, { keepAi: true });
  }

  // ---------------------------------------------------------------- solve
  private startSolve(column: number, fromLineId: string | undefined, opts: SolveOpts): void {
    if (!this.opts.enabled || this.opts.voiceActive) return;
    const built = this.buildCheckLines(column);
    if (!built) return;
    // The engine can solve most school lines itself, and the tutor can write that out by hand:
    // no model, no credits, no network. Anything it cannot draw falls through to the stream.
    if (this.writeSolutionByHand(built, opts)) return;
    // ...and where the line is not an equation at all but a sum with an answer (`36 + 2 =`),
    // the engine still has that answer. It is written locally whatever the hand switch says:
    // deterministic maths NEVER goes through a model.
    if (this.writeLocalAnswer(built, opts)) return;
    if (!this.deps.isOnline()) {
      this.deferLlm("solve", opts.lineId);
      return;
    }
    const rt = this.runtime(opts.lineId);
    rt.solveAbort?.abort();
    const ctrl = new AbortController();
    rt.solveAbort = ctrl;
    const req: SolveRequest = {
      boardId: this.opts.boardId,
      region: built.region,
      lines: built.lines,
      fromLineId,
    };
    const lastLine = built.states[built.states.length - 1].line;
    const columnRect = unionRects(built.states.map((s) => s.line.bounds));
    // Every solve is asked for (Solve steps, More help, the voice tutor).
    const errCtx = { kind: "solve" as const, lineId: opts.lineId, userAsked: true };
    const retry: RetryContext = { kind: "solve", lineId: opts.lineId, fromLineId, opts };
    // Nothing the model says is drawn on the student's page until the local engine has read it.
    const engine = this.engine;
    const guard = createSolveStepGuard({
      sourceLatex: built.states.map((s) => s.latex),
      // No engine yet (it loads with the first recognition) means nothing to check with: the
      // step is not held back on a technicality, the symbol rule still applies.
      parses: engine ? (latex) => engineParsesStep(engine, latex) : () => true,
    });
    liveStore.status.set("checking");
    liveStore.solving.set(liveStore.solving.get() + 1);
    void (async () => {
      let failed = false;
      let doneEarly = false;
      let drawn = 0;
      let discarded = 0;
      try {
        for await (const ev of this.deps.stream(SOLVE_PATH, req, { signal: ctrl.signal })) {
          if (ctrl.signal.aborted) break;
          if (ev.event === "step") {
            const verdict = guard.check(ev.data.latex);
            if (!verdict.ok) {
              discarded++;
              console.warn("[live] solve step discarded", { reason: verdict.reason, introduced: verdict.introduced, latex: ev.data.latex });
              clientMetric("live.solve.step.discarded", { reason: verdict.reason ?? "", lineId: opts.lineId });
              continue;
            }
            drawn++;
            this.placeSolutionStep(columnRect, lastLine.bounds, ev.data.index, ev.data.latex, ev.data.explanation, opts.lineId);
            if (opts.onlyFirstStep) {
              doneEarly = true;
              ctrl.abort();
              break;
            }
          } else if (ev.event === "error") {
            failed = true;
            console.warn("[live] solve error", ev.data);
            this.fail(sseFailure(ev.data), errCtx, retry);
          }
        }
        // The model answered, but nothing it said survived the interlock. Better to say so than
        // to leave the student staring at a page where Solve visibly did nothing.
        if (!failed && drawn === 0 && discarded > 0) {
          failed = true;
          this.fail(sseFailure({ error: "unusable_steps", message: UNUSABLE_SOLUTION }), errCtx, retry);
        }
      } catch (err) {
        if (!isAbortLike(err) && !ctrl.signal.aborted) {
          failed = true;
          if (this.isNetworkFailure(err)) this.deferLlm("solve", opts.lineId);
          else console.warn("[live] solve failed", err);
          if (this.deps.isOnline()) this.fail(err, errCtx, retry);
        }
      } finally {
        if (rt.solveAbort === ctrl) rt.solveAbort = null;
        liveStore.solving.set(Math.max(0, liveStore.solving.get() - 1));
        if (!failed && (doneEarly || !ctrl.signal.aborted)) this.noteSuccess("solve", opts.lineId);
        if (liveStore.status.get() !== "offline") liveStore.status.set("idle");
      }
    })();
  }

  /**
   * Writes the worked steps under the student's last line in the tutor's hand.
   *
   * Returns false — and the caller falls back to today's typeset solve stream — when the
   * per-device switch is off, the local engine cannot solve this line, or the hand engine
   * reports ANY `unsupported` construct for the block. That last one is the safety interlock:
   * a dropped `\frac` would show the student wrong maths, so the block is never drawn partly.
   */
  private writeSolutionByHand(built: { states: LiveLineState[] }, opts: SolveOpts): boolean {
    if (!this.deps.handwritingEnabled() || !this.engine) return false;
    if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return false;
    const state = liveStore.lines.get()[opts.lineId] ?? built.states[built.states.length - 1];
    if (!state?.latex) return false;

    let solved: { latex: string; steps: string[] } | null = null;
    try {
      solved = this.engine.solveLatex(state.latex);
    } catch (e) {
      console.warn("[live] solveLatex threw", e);
      return false;
    }
    if (!solved || solved.steps.length === 0) return false;
    const steps = (opts.onlyFirstStep ? solved.steps.slice(0, 1) : solved.steps).slice(0, LIVE_LIMITS.maxSolveSteps);
    return this.drawStepsByHand(built, opts, state, steps);
  }

  /**
   * Finishes a line the engine can simply evaluate — `36 + 2 =` → `= 38`, and the same for
   * units, a conversion or a derivative.
   *
   * `solveLatex` covers relations with an unknown and nothing else, so before this existed a
   * plain sum fell through to `/api/live/solve`, and what the model answered was drawn on the
   * student's page as fact. There is no reason to ask anyone: `analyzeLine(..., { mode:
   * 'answer' })` already knows. Returns true whenever an answer was found, whether it was
   * written by hand or typeset — never false in a way that lets arithmetic reach the model.
   */
  private writeLocalAnswer(built: { states: LiveLineState[] }, opts: SolveOpts): boolean {
    if (!this.engine) return false;
    const state = liveStore.lines.get()[opts.lineId] ?? built.states[built.states.length - 1];
    if (!state?.latex) return false;
    const answer = localAnswerFor(this.engine, state.latex, this.columnContext(state));
    if (!answer) return false;
    // The tutor has already written this answer — the line finished itself as the student
    // wrote it, or Solve was pressed twice. Answering again would stack a second copy; there
    // is still nothing to ask a model.
    if (this.answerBlocksFor(opts.lineId).some((s) => answerLatexOf(s.meta) === answer)) return true;
    // At the shape cap nothing more is drawn — but a model call would be just as capped, and
    // this answer is already known, so the stream is still not worth opening.
    if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return true;

    const step = localAnswerStep(answer);
    const meta = this.answerMeta(state, answer);
    if (this.deps.handwritingEnabled() && this.drawStepsByHand(built, opts, state, [step], meta)) return true;
    // The hand switch is off, or the answer needs a glyph the hand atlas has no stroke for.
    // The answer is still the engine's, so it is typeset locally rather than asked for.
    const lastLine = built.states[built.states.length - 1].line.bounds;
    this.placeSolutionStep(unionRects(built.states.map((s) => s.line.bounds)), lastLine, 0, step, "", opts.lineId);
    clientMetric("live.solve.local.typeset", { lineId: opts.lineId });
    return true;
  }

  /**
   * Lays `steps` out under the student's last line and starts the reveal.
   *
   * Returns false when the hand engine reports ANY `unsupported` construct for the block —
   * the safety interlock: a dropped `\frac` would show the student wrong maths, so the block
   * is never drawn partly.
   */
  private drawStepsByHand(
    built: { states: LiveLineState[] },
    opts: SolveOpts,
    state: LiveLineState,
    steps: readonly string[],
    extraMeta?: JsonObject,
  ): boolean {
    const size = handSizeFor(state.line.bounds.h);
    const { plan, unsupported } = planHandwriting(steps, { size, seed: handSeedFor(opts.lineId) });
    if (!plan || unsupported.length > 0) return false;

    const lastLine = built.states[built.states.length - 1].line.bounds;
    const column = unionRects(built.states.map((s) => s.line.bounds));
    const candidate: Rect = {
      x: column.x,
      y: rectMaxY(lastLine) + PLACEMENT.stepGap,
      w: plan.bounds.w,
      h: plan.bounds.h,
    };
    // avoidRects skips this line's own ink and echo; for a block written *under* the work they
    // are obstacles like any other, so they go back in.
    const avoid = this.avoidRects(opts.lineId);
    avoid.push(state.line.bounds);
    const echo = this.echoRect(opts.lineId);
    if (echo) avoid.push(echo);
    const slot = findFreeSlot(candidate, avoid, lastLine);

    this.startHandwriting(placeHandPlan(plan, { x: slot.x, y: slot.y }), opts.lineId, extraMeta);
    clientMetric("live.solve.hand.ms", { ms: Math.round(plan.totalMs), lineId: opts.lineId });
    return true;
  }

  private startHandwriting(plan: HandPlan, lineId: string, extraMeta?: JsonObject): void {
    this.cancelHandwriting();
    const meta = makeMeta("ai", lineId, this.deps.now());
    const writer = new HandWriter(
      {
        write: (fn) => this.write(fn),
        createShapes: (shapes) => this.editor.createShapes(shapes),
        updateShapes: (shapes) => this.editor.updateShapes(shapes),
        getShape: (id) => this.editor.getShape(id),
      },
      {
        now: this.deps.now,
        reducedMotion: this.deps.reducedMotion,
      },
    );
    this.writer = writer;
    writer.start(plan, {
      meta,
      extraMeta,
      onDone: () => {
        if (this.writer === writer) this.writer = null;
      },
    });
  }

  /** Ends any reveal in flight, completing the lines it had started. Never leaves half a step. */
  private cancelHandwriting(): void {
    const writer = this.writer;
    this.writer = null;
    writer?.cancel();
  }

  /** fetch rejects with a TypeError when the network is unreachable. */
  private isNetworkFailure(err: unknown): boolean {
    return err instanceof TypeError || !this.deps.isOnline();
  }

  private placeSolutionStep(column: Rect, lastLine: Rect, index: number, latex: string, explanation: string, lineId: string): void {
    this.write(() => {
      if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return;
      const rect = placeStep(column, lastLine, index, latex);
      const slot = findFreeSlot(rect, this.avoidRects(lineId), lastLine);
      this.editor.createShapes([
        {
          id: createShapeId(),
          type: "math",
          x: slot.x,
          y: slot.y,
          props: {
            ...MATH_SHAPE_DEFAULTS,
            w: slot.w,
            h: slot.h,
            latex,
            note: explanation,
            source: "ai",
            tone: "accent",
            lineId,
            anchorIds: [],
          },
          meta: makeMeta("ai", lineId, this.deps.now()),
        } satisfies TLShapePartial<MathShape>,
      ]);
    });
  }

  // ---------------------------------------------------------------- LiveController
  getTranscript(): LiveTranscript {
    const states = Object.values(liveStore.lines.get())
      .filter((s) => s.latex)
      .sort((a, b) => a.line.column - b.line.column || a.line.row - b.line.row);
    const lines: LiveTranscriptLine[] = states.map((s) => ({
      id: s.line.id,
      latex: s.latex,
      verdict: s.analysis ? (s.analysis.solved ? "solved" : badgeFor(this.opts.mode === "off" ? "feedback" : this.opts.mode, s.analysis)) : "unknown",
      resultLatex: s.analysis?.resultLatex ?? "",
      note: s.analysis?.note ?? "",
      column: s.line.column,
    }));
    const ok = lines.filter((l) => l.verdict === "ok").length;
    const warn = lines.filter((l) => l.verdict === "warn").length;
    const solved = lines.some((l) => l.verdict === "solved");
    const summary =
      lines.length === 0
        ? "No math lines on the board yet."
        : `${lines.length} line${lines.length === 1 ? "" : "s"}; ${ok} check out, ${warn} need another look${solved ? "; solved" : ""}.`;
    return { lines, summary };
  }

  placeMath(args: { latex: string; nearLineId?: string; tone?: MathTone }): TLShapeId | null {
    const latex = args.latex.trim();
    if (!latex) return null;
    if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return null;
    const id = createShapeId();
    const lineId = args.nearLineId ?? "";
    this.write(() => {
      const anchor = this.anchorRect(args.nearLineId);
      const viewport = boxToRect(this.editor.getViewportPageBounds());
      const size = { w: estimateEchoWidth(latex), h: ECHO_HEIGHTS.m };
      const candidate = placeFloating(anchor, size, viewport);
      const rect = anchor ? findFreeSlot(candidate, this.avoidRects(lineId), anchor) : candidate;
      this.editor.createShapes([
        {
          id,
          type: "math",
          x: rect.x,
          y: rect.y,
          props: { ...MATH_SHAPE_DEFAULTS, w: rect.w, h: rect.h, latex, source: "ai", tone: args.tone ?? "accent", lineId, anchorIds: [] },
          meta: makeMeta("ai", lineId, this.deps.now()),
        } satisfies TLShapePartial<MathShape>,
      ]);
    });
    return id;
  }

  plotFunction(args: { expr: string; xMin?: number; xMax?: number; nearLineId?: string }): TLShapeId | null {
    const expr = args.expr.trim();
    if (!expr) return null;
    if (this.engine && this.engine.compileExpr(expr) === null) return null;
    if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return null;
    const id = createShapeId();
    const lineId = args.nearLineId ?? "";
    const xMin = args.xMin ?? GRAPH_SHAPE_DEFAULTS.xMin;
    const xMax = args.xMax ?? GRAPH_SHAPE_DEFAULTS.xMax;
    if (!(xMax > xMin)) return null;
    this.write(() => {
      const anchor = this.anchorRect(args.nearLineId);
      const viewport = boxToRect(this.editor.getViewportPageBounds());
      const size = { w: GRAPH_SHAPE_DEFAULTS.w, h: GRAPH_SHAPE_DEFAULTS.h };
      const rect = anchor ? placeGraph(anchor, this.echoRect(args.nearLineId), size, viewport) : placeFloating(null, size, viewport);
      this.editor.createShapes([
        {
          id,
          type: "graph",
          x: rect.x,
          y: rect.y,
          props: {
            ...GRAPH_SHAPE_DEFAULTS,
            fns: [{ id: `f_${id}`, expr, latex: expr, color: GRAPH_COLORS[0] }],
            xMin,
            xMax,
            lineId,
          },
          meta: makeMeta("ai", lineId, this.deps.now()),
        } satisfies TLShapePartial<GraphShape>,
      ]);
    });
    return id;
  }

  private anchorRect(lineId: string | undefined): Rect | null {
    const target = lineId ? liveStore.lines.get()[lineId] : this.latestLine();
    if (!target) return null;
    const rects = [target.line.bounds];
    const echo = target.mathShapeId ? this.editor.getShapePageBounds(target.mathShapeId) : undefined;
    if (echo) rects.push(boxToRect(echo));
    return unionRects(rects);
  }

  private echoRect(lineId: string | undefined): Rect | null {
    const st = lineId ? liveStore.lines.get()[lineId] : undefined;
    const b = st?.mathShapeId ? this.editor.getShapePageBounds(st.mathShapeId) : undefined;
    return b ? boxToRect(b) : null;
  }

  private latestLine(): LiveLineState | undefined {
    const all = liveStore.lines.get();
    if (this.lastTouchedLineId && all[this.lastTouchedLineId]) return all[this.lastTouchedLineId];
    return Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  requestCheck(lineId?: string): void {
    const target = lineId ? liveStore.lines.get()[lineId] : this.latestLine();
    if (!target || !target.latex) return;
    if (this.opts.mode === "off") return;
    // Asking means now: a result this line was holding back for the settle is written at once
    // (the mode gate still applies — asking in Feedback asks for feedback, not for the answer).
    if (target.analysis?.resultLatex) this.render(target, this.decisionFor(target, { userAsked: true }));
    this.startCheck(target.line.column, target.line.id, { userAsked: true });
  }

  requestSolve(lineId?: string): void {
    const target = lineId ? liveStore.lines.get()[lineId] : this.latestLine();
    if (!target || !target.latex) return;
    if (this.opts.mode !== "answer") {
      this.requestCheck(target.line.id);
      return;
    }
    // A line the student ended with `=` is finished where they left off, not restated under
    // their work. Normally that waits for them to stop writing; pressing Solve IS stopping,
    // so it is written now. Ahead of `startSolve`, which would otherwise not yet see it
    // (live writes land on a microtask) and would draw a second copy underneath.
    if (this.answerLineNow(target)) return;
    const col = this.columnLines(target.line.column).filter((s) => s.latex);
    const lastOk = [...col].reverse().find((s) => s.analysis?.verdict === "ok" || s.analysis?.solved);
    this.startSolve(target.line.column, lastOk?.line.id ?? target.line.id, { lineId: target.line.id });
  }

  /**
   * The student asked for the answer to a line they ended with `=`: no settle wait, no model.
   *
   * True when the line is answered — or already was — so the caller has nothing left to do.
   * False when there is no local answer, or the hand cannot place one beside their work; both
   * fall through to the ordinary Solve path, which types it or writes it underneath instead.
   */
  private answerLineNow(state: LiveLineState): boolean {
    if (!state.analysis?.resultLatex) return false;
    const decision = this.decisionFor(state, { userAsked: true });
    return decision.showResult && this.inlineAnswer(state, decision);
  }

  /** feedback -> suggest -> one solve step for THIS line; the global mode never changes. */
  escalate(lineId: string): void {
    const target = liveStore.lines.get()[lineId];
    if (!target || !target.latex || this.opts.mode === "off") return;
    const rt = this.runtime(lineId);
    this.closeHintsFor(lineId);
    if (rt.escalation === 0) {
      rt.escalation = 1;
      this.startCheck(target.line.column, lineId, { userAsked: true, modeOverride: "suggest", forceHint: true });
      return;
    }
    if (rt.escalation === 1) {
      rt.escalation = 2;
      const col = this.columnLines(target.line.column).filter((s) => s.latex && s.line.row < target.line.row);
      const lastOk = [...col].reverse().find((s) => s.analysis?.verdict === "ok");
      this.startSolve(target.line.column, lastOk?.line.id ?? lineId, { onlyFirstStep: true, lineId });
    }
  }

  dismissHint(hintId: string): void {
    liveStore.openHints.set(liveStore.openHints.get().filter((h) => h.id !== hintId));
  }

  /** Removes AI shapes and hint text; echoes stay (their badges reset). */
  clearMarks(): void {
    this.cancelHandwriting();
    liveStore.openHints.set([]);
    for (const r of this.rt.values()) {
      r.shownHintTexts.clear();
      r.escalation = 0;
    }
    const lines = liveStore.lines.get();
    for (const id of Object.keys(lines)) setLine(id, { hintsShown: 0, rewritesWithWarn: 0 });
    this.write(() => {
      const ids: TLShapeId[] = [];
      const resets: TLShapePartial<MathShape>[] = [];
      for (const s of this.editor.getCurrentPageShapes()) {
        if (!isLiveMeta(s.meta)) continue;
        if (s.meta.source === "ai") ids.push(s.id);
        else if (s.type === "math") {
          const p = s.props as MathShapeProps;
          if (p.note || (p.status !== "none" && p.status !== "solved" && p.status !== "ok")) {
            resets.push({
              id: s.id,
              type: "math",
              props: { note: "", status: p.status === "warn" ? "none" : p.status },
              // the note is gone, so its provenance must go with it
              meta: { ...s.meta, [AI_NOTE_META]: false },
            });
          }
        }
      }
      if (ids.length) this.editor.deleteShapes(ids);
      if (resets.length) this.editor.updateShapes(resets);
    });
  }

  /** Student typed over an echo (or the unreadable chip): trust the text, skip recognition. */
  retypeLine(lineId: string, latex: string): void {
    const state = liveStore.lines.get()[lineId];
    if (!state) return;
    const rt = this.runtime(lineId);
    rt.processing++;
    this.deps.recognizer.abortLine(lineId);
    this.abortLlm(lineId);
    this.closeHintsFor(lineId);
    this.clearErrorsForLine(lineId);
    this.clearAiNote(lineId);
    setLine(lineId, { latex, provider: "typed", edited: true, confidence: latex.trim() ? 1 : 0 });
    void this.ensureEngine().then(() => {
      if (liveStore.lines.get()[lineId]?.latex !== latex) return;
      this.analyzeAndRender(lineId, { cascade: true });
    });
  }
}

export function createLiveLoop(editor: LiveEditorLike, opts: UseLiveMathOptions, deps: Partial<LiveLoopDeps> = {}): LiveLoop {
  return new LiveLoop(editor, opts, deps);
}
