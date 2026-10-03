"use client";

import { Box, createShapeId } from "tldraw";
import type {
  Editor,
  HistoryEntry,
  JsonObject,
  TLPage,
  Mat,
  TLDrawShape,
  TLRecord,
  TLShape,
  TLShapeId,
  TLShapePartial,
} from "tldraw";
import { isApiError, isOutOfInk } from "@/lib/api-client";
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
  type GraphIntent,
  type GraphShape,
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
  type RecognizeRequest,
  type RecognizeResponse,
  type Rect,
  type RereadRequest,
  type RereadResponse,
  type SetupRequest,
  type SetupResponse,
  type SolveRequest,
  type UseLiveMathOptions,
} from "./contracts";
import { endsWithRelation } from "./answer";
import { LIVE_COPY } from "@/components/live/copy";
import { classifyLiveFailure, sseFailure, type ClassifyContext } from "@/components/live/errorView";
import {
  clearLiveError,
  liveStore,
  removeLine,
  setLine,
  setLiveError,
  type LiveError,
  type LiveErrorKind,
} from "./liveStore";
import { liveWrite, scheduleLiveWrite } from "./liveWrite";
import { recordReread, recordRecognition } from "./liveDebug";
import { analyzeColumn, localSolve } from "./localSolve";
import { requestReread, requestSetup, type CallOptions } from "./modelCalls";
import { acceptReread, rereadTrigger } from "./readCheck";
import { isProblemProse, setupBlock, validateSetupLines, wordProblemKey } from "./wordProblem";
import { markKey, markStrokes, ringRect, type MarkKind } from "./marks";
import { inkExtendsLine } from "./celebrate";
import { addScreen, readScreenMeta, type ScreensEditor } from "@/lib/screens/screens";
import { getLiveSettings } from "./liveSettings";
import { GRAPH, chooseWindow, placeGraphBlock, planGraph, type GraphPlaceContext } from "./graphing";
import {
  HandWriter,
  handBlockOf,
  handLinesOf,
  handSeedFor,
  handSizeFor,
  inlineHandSizeFor,
  placeHandPlan,
  placeHandPlanOnBaseline,
  planFromStrokes,
  planHandwriting,
  wallMsOf,
  HAND_WRITE,
  type HandPlan,
  type HandWriteOptions,
} from "./handwriting";
import {
  ECHO_HEIGHTS,
  ECHO_WIDTH_RELAYOUT_PX,
  echoSizeFor,
  estimateEchoWidth,
  expandRect,
  findFreeSlot,
  inlineAnswerGap,
  keepInsideX,
  keepOnScreen,
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
import { badgeFor, decide, isSingleSymbolLatex, localNoteFor, unjudgedReason, type PolicyDecision, type UnjudgedReason } from "./policy";
import { createSolveStepGuard, engineParsesStep, localAnswerFor, unwrapBoxed as unwrapBoxedAnywhere } from "./solveSteps";
import {
  RecognizeClient,
  RecognizeTimeoutError,
  createRecognizeClient,
  fetchCapabilities as defaultFetchCapabilities,
  isAbortLike,
  recognizeFailureHints,
} from "./recognizeClient";
import { streamLiveSse as defaultStream, type StreamOptions } from "./sseClient";
import { assignColumns, clusterLines, rebuildFromMathShapes, unionRects, type EchoShapeSeed } from "./strokeClusters";
import { buildPayload, hashPayload } from "./strokePayload";
import { barGroups, DIAGRAM_RULES, diagramNear, labelStack, parseLabelRead, splitInk, strokeLooksDrawn, type Diagram, type InkSplit } from "./diagrams";
import { barDivisionLatex } from "./engine/operationLine";
import { parseDomainPiece } from "./engine/domain";
import { figureAnswer, labelKey, looksLikeUnknown } from "./figure";
import { HAND_LINE_META } from "./handwriting";
import { requestProof } from "./proof/client";
import type { ProofRequest, ProofResponse } from "./proof/contracts";
import { ProofDesk, tutorLinesOf, type ProofHost, type TutorFigure } from "./proof/desk";
import { PROOF_ROWS_META, proofRowsPlan } from "./proof/place";
import { PROOF_FIGURE_META, PROOF_TABLE_META, tutorFiguresOf } from "./proof/tutorFigure";
import type { PlannedRow } from "./proof/planner";
import type { BoardLine, ProofRead } from "./proof/read";
import { problemLines, problemMetaOf, readProblemCells, splitColumnsAtProblems, type ProblemCell } from "./chat/cells";
import {
  PROBLEM_WORK_META,
  currentProblem,
  pickForSolve,
  pickForStep,
  placeInCell,
  problemLineId,
  problemSteps,
  WORK_PLACE,
  type ProblemDepth,
  type ProblemPick,
  type ProblemState,
} from "./chat/work";
import type { ChatAction, ChatRunReport, ChatScreen } from "./chat/contracts";
import { CHAT_LINE_ID, ChatDesk, type ChatHost } from "./chat/desk";
// lecture mode's desk (and its planners) is loaded the first time a lecture needs it (`lectureDesk`)
import type { LectureDesk, LectureHost, LecturePlanners, LectureRunOptions, LoadLecturePlanners } from "./lecture/desk";
import type { LectureAction, LecturePageMeta, LectureRunReport, LectureScreen, LectureSpecMeta } from "./lecture/contracts";
import { appendHeard, LECTURE_BLOCK_META, LECTURE_PAGE_META } from "./lecture/meta";
// the drawer's own module, not the index: the index re-exports `checkFigure`, which the board chat's
// proof check (a lazy chunk) uses — through the index it would land in the board's first load
import { planFigure as defaultPlanFigure } from "./figureDraw/plan";
import type { FigurePlanOptions, FigurePlanResult, FigureSpec } from "./figureDraw/contracts";

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
  /** the board's current screen lives in its page meta (optional: test editors have no pages) */
  getCurrentPage?(): TLPage;
  createShapes(shapes: TLShapePartial[]): unknown;
  updateShapes(shapes: TLShapePartial[]): unknown;
  deleteShapes(ids: TLShapeId[]): unknown;
  toImage?: Editor["toImage"];
  /** the tool state (`draw.drawing`: a stroke is being drawn); optional: test editors have no tools */
  isIn?(path: string): boolean;
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
  /** POST /api/live/setup: a word problem's equations, which the local engine then solves */
  setup: (req: SetupRequest, opts: CallOptions) => Promise<SetupResponse>;
  /** POST /api/live/reread: the second reader's LaTeX for one suspicious line */
  reread: (req: RereadRequest, opts: CallOptions) => Promise<RereadResponse>;
  /** POST /api/live/proof: a proof's figure read, or one next row the planner could not find */
  proof: (req: ProofRequest, opts: CallOptions) => Promise<ProofResponse>;
  /** the figure drawer (`src/lib/live/figureDraw`): a board-chat figure spec in the tutor's hand */
  planFigure: (spec: FigureSpec, opts: FigurePlanOptions) => FigurePlanResult | null;
  /** lecture mode's planners (`src/lib/live/lecture/plan.ts`); absent, they are loaded on the first lecture run */
  lecturePlanners?: LecturePlanners | LoadLecturePlanners;
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
  /** the tutor's mark wanted on this line (`markKey`), null for none; undefined until first render */
  markKey?: string | null;
  markWriter?: HandWriter | null;
  /** its read failed for a reason that is not the handwriting (signed out, out of ink, rate limited): no "?" */
  readRefused?: boolean;
  /** when a change of its mark was scheduled (`syncMark`) and has not finished writing; 0 when none */
  markBusySince?: number;
  /** what waits for the tutor's pen to lift from this line's mark (`afterMark`) */
  afterMark?: Array<() => void>;
  /** the right next step being written beside it, for which read (`stepInFlight`); `landed` once its first write ran */
  stepWriter?: { writer: HandWriter; latex: string; landed: boolean } | null;
  /** the equation an operation line leads to, being written under it (`writeOperationResults`) */
  resultWriter?: HandWriter | null;
}

type CheckOpts = {
  userAsked: boolean;
  modeOverride?: "feedback" | "suggest";
  forceHint?: boolean;
};
/**
 * The tutor working one of the chat's problems (`workProblem`): the problem, how much to write, the
 * lines it already wrote under it (the work continues after them) and the lowest of what is written
 * there — the problem, or the tutor's last block — which the next block goes under.
 */
type ProblemWork = { cell: ProblemCell; depth: ProblemDepth; written: string[]; below: Rect };
type SolveOpts = { onlyFirstStep?: boolean; lineId: string; problem?: ProblemWork };
/** A column as `buildCheckLines` returns it: the lines with a read, their check payload, the region. */
type BuiltColumn = { lines: CheckLine[]; region: Rect; states: LiveLineState[] };
/** What Solve wrote locally: its lines, and where the block is being written (null: nothing new) and for how long. */
type LocalWritten = { steps: string[]; block: Rect | null; wallMs: number };

/** What `retryLastError` re-runs; captured at the moment a call fails. */
type RetryContext =
  | { kind: "capabilities" }
  | { kind: "recognize"; lineId: string }
  | { kind: "check"; lineId: string; opts: CheckOpts }
  | { kind: "solve"; lineId: string; fromLineId: string | undefined; opts: SolveOpts }
  | { kind: "figure"; diagramId: string; opts: SolveOpts }
  | { kind: "proof"; lineId: string; all: boolean };

/**
 * "The tutor reads the figure": how near a line must be to a drawing for Solve on it to read the
 * drawing too (page px, or this many glyphs when that is more) — `x = ?` written beside a triangle.
 */
const FIGURE_REACH_PX = 120;
const FIGURE_REACH_GLYPHS = 10;
/** a figure's crop is wider than a line's (512): its labels must stay legible */
const FIGURE_CROP_WIDTH = 768;
/**
 * Page meta key: the figure answers (`figureKey`) the student rubbed out on this screen — not
 * written again unasked, also after a reload. The last `MAX_FIGURE_DISMISSALS` are kept.
 */
const FIGURES_DISMISSED_META = "liveFiguresDismissed";
const MAX_FIGURE_DISMISSALS = 20;

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

/** The longest a mark's write may hold up what waits for it (`afterMark`): a ring takes about a second. */
const MARK_BUSY_MAX_MS = 4000;

/** How soon a quiet gate that ran out mid-stroke looks again (`armQuietTimer`). */
const QUIET_RECHECK_MS = 150;

const CHECK_PATH = "/api/live/check";
const SOLVE_PATH = "/api/live/solve";
const UNREADABLE_NOTE = "Couldn't read this — tap to type it";
/**
 * Shown when every step the solve stream sent failed the local interlock. It goes through the
 * same path as a server-sent solve error, so the student gets the pill, the inline card and
 * the Retry they already know — and nothing is drawn.
 */
const UNUSABLE_SOLUTION = "Couldn't work this out";
/** Dispatched on window by the math shape's warn/ok badge: `detail: { lineId, shapeId }`. */
export const BADGE_TAP_EVENT = "live:badge-tap";
/**
 * Echo meta key recording a graph the student erased (its `graphFor` key): not drawn again
 * unasked, also after a reload. (Boards from the typeset-card days carry a plot expression
 * here, which matches no key.)
 */
const GRAPH_DISMISSED_META = "graphDismissed";
/** on every stroke of a graph the tutor sketched: the graph's key (engine `graphFor`), so it is never drawn twice */
const GRAPH_META = "graphFor";
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
/** on the tutor's handwritten worked solution: the line LaTeX it solves */
const SOLVED_META = "solvedLatex";
/** on an echo: the line LaTeX the model flagged as wrong (a ring stays while the line reads the same) */
const AI_WARN_META = "aiWarnLatex";
/** on the tutor's handwritten next step beside a wrong line: the wrong line's LaTeX it answers */
const SUGGEST_META = "suggestFor";
/** the equation written under a right operation line (`-3 \quad -3` → `2x = 8`): what it was written for */
const OPERATION_RESULT_META = "operationResult";
/** on the strokes of a tutor's mark (tick / ring / question mark): its `markKey` */
const MARK_META = "mark";
/** on a question mark's strokes: why the tutor put it there (`UnjudgedReason`) */
const MARK_WHY_META = "markWhy";
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

/** How long heard text waits before it is written to the screen's page meta (see `pendingPageMeta`). */
export const LECTURE_META_FLUSH_MS = 15_000;

/** A page's `LECTURE_PAGE_META`, keeping only what it should hold. */
function readLecturePageMeta(meta: unknown): LecturePageMeta {
  const raw = meta && typeof meta === "object" ? (meta as Record<string, unknown>)[LECTURE_PAGE_META] : undefined;
  if (!raw || typeof raw !== "object") return {};
  const { topic, transcript, visuals } = raw as Record<string, unknown>;
  return {
    ...(typeof topic === "string" ? { topic } : {}),
    ...(typeof transcript === "string" ? { transcript } : {}),
    // each entry's spec is checked against the contract where it is used (`LectureDesk`)
    ...(visuals && typeof visuals === "object" && !Array.isArray(visuals) ? { visuals: visualsOf(visuals as Record<string, unknown>) } : {}),
  };
}

/** The entries of a page's `visuals` that have a place, a box and a seed (the spec is the desk's to check). */
function visualsOf(raw: Record<string, unknown>): Record<string, LectureSpecMeta> {
  const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const out: Record<string, LectureSpecMeta> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const at = e.at as Record<string, unknown> | undefined;
    const box = e.box as Record<string, unknown> | undefined;
    if (!at || !box || !fin(at.x) || !fin(at.y) || !fin(box.w) || !fin(box.h) || !fin(e.seed)) continue;
    out[id] = { ...(e as unknown as LectureSpecMeta), updatedAt: fin(e.updatedAt) ? e.updatedAt : 0 };
  }
  return out;
}

function defaultDeps(): LiveLoopDeps {
  const hasWindow = typeof window !== "undefined";
  return {
    recognizer: createRecognizeClient(),
    stream: defaultStream,
    // the engine's modules load with it, after the board: not part of the board's first load
    getEngine: () => import("./engine").then((m) => m.getEngine()),
    fetchCapabilities: () => defaultFetchCapabilities(),
    now: () => Date.now(),
    events: hasWindow ? window : null,
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
    handwritingEnabled: () => getLiveSettings().handwriting,
    reducedMotion: () =>
      hasWindow && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    setup: (req, opts) => requestSetup(req, opts),
    reread: (req, opts) => requestReread(req, opts),
    proof: (req, opts) => requestProof(req, opts),
    planFigure: (spec, opts) => defaultPlanFigure(spec, opts),
  };
}

/** A line of a two-column proof, to the line-by-line paths: nothing to compute, ring or answer (`ProofDesk` marks it). */
const PROOF_LINE: LineAnalysis = { kind: "label", math: "", resultLatex: "", verdict: "none", note: "" };

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
  private unsubscribeSession: (() => void) | null = null;
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
  /** wrong lines waiting for the student to stop before the tutor writes the right next step */
  private pendingSuggestions = new Set<string>();
  /** the handwriting reveal in flight, if any (one block at a time) */
  private writer: HandWriter | null = null;
  /** the line (`meta.lineId`) the reveal in flight writes for: a problem is not worked twice at once */
  private writerFor: string | null = null;
  /** the graph being sketched, if any (one at a time), and its key */
  private graphWriter: HandWriter | null = null;
  private graphWriterKey: string | null = null;
  /** a word problem's sketch, drawn after its working (`drawSketch`) */
  private sketchWriter: HandWriter | null = null;
  /** `engine.graphFor` by column content */
  private readonly graphMemo = new Map<string, GraphIntent | null>();
  /** graph keys the student rubbed out on this screen: not drawn again unless asked */
  private readonly dismissedGraphs = new Set<string>();
  /** any answer ink on the page at all; kept by `recount` so the common render costs nothing */
  private hasAnswerInk = false;
  /**
   * The second reader, per ink version (payload hash): absent = never asked, null = asked and
   * Mathpix's read stands, a string = its read replaced Mathpix's. Asked at most once per ink;
   * the same ink read again (from the recognition cache) gets the accepted read straight away.
   */
  private readonly rereads = new Map<string, string | null>();
  /** second readings in flight, aborted with the rest of the runtime */
  private readonly rereadAborts = new Set<AbortController>();
  /** lines being read right now (the recognizer, or the second reader): nothing to say about them yet */
  private readonly reading = new Set<string>();
  /**
   * The drawings on this screen (`splitInk`, `src/lib/live/diagrams.ts`), refreshed by every flush.
   * A drawing is never recognized, marked or joined to a line; its labels are read together, once
   * the student has stopped, as its context — and only Solve / Help, or in Solve a figure left labelled
   * with an unknown (`solveWantedFigures`), sends it to a model.
   */
  private diagrams: Diagram[] = [];
  /** the glyph scale the last split measured (page px) */
  private glyph: number = DIAGRAM_RULES.glyphMax;
  /** a drawing's labels as read, per label-ink version (the label stack's payload hash) */
  private readonly labelReads = new Map<string, string[]>();
  /** label reads in flight, per payload hash (one call however many ask) */
  private readonly labelReading = new Map<string, Promise<string[]>>();
  /** the latest label read per drawing, for the dev panel */
  private readonly labelsOf = new Map<string, string[]>();
  /** the ink touched last was a drawing or its labels, not a line: Help asks about the drawing */
  private lastTouchedDiagramId: string | null = null;
  /**
   * The figure route's reply per figure-and-labels version (`figureKey`): asking again, or the
   * unasked path at the next stop, costs no second call. null: the call failed (not tried again
   * unasked).
   */
  private readonly figureReplies = new Map<string, SetupResponse | null>();
  /** figure versions whose call is in flight */
  private readonly figuresInFlight = new Set<string>();
  /** figure answers the student rubbed out (`figureKey`): not written again unasked (page meta) */
  private readonly dismissedFigures = new Set<string>();
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
  private readonly finishWritingHandler = () => this.finishWriting();
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

  /** the two-column proofs on this screen: their marks, and the rows the tutor writes on an ask */
  private readonly proofs: ProofDesk;
  /** the strokes of a proof's T-table (`splitInk` role `table`): the tutor's rows are written across them */
  private tableStrokeIds = new Set<string>();
  /** division bars under an equation (`splitInk`): a line holding one is read as `\div n` */
  private barStrokeIds = new Set<string>();

  /** the board chat's hand: its actions, one block at a time (`src/lib/live/chat/desk.ts`) */
  private readonly chat: ChatDesk;
  /**
   * The problem the chat wrote at the top of each column the student works under it (by column):
   * the column's first line, the context its first line is checked against (`chat/cells.ts`).
   */
  private columnHeads = new Map<number, ProblemCell>();
  /** a head's lines analysed as a column, per mode (the problem does not change) */
  private readonly headMemo = new Map<string, (LineAnalysis | null)[]>();
  /**
   * The chat problem whose cell the student last wrote in (or rubbed out in), by cell key: "the
   * current problem" Solve steps, the dial and Help work on when the student has no line to act on
   * (`chat/work.ts`). Kept when they then write outside the cells; forgotten with the screen.
   */
  private touchedProblem: string | null = null;
  /** the screen the loop last took in (`start` / `switchScreen`): the chat writes only once it is this one */
  private screenSeen: string | null = null;

  /**
   * lecture mode's hand: the director's actions, one block at a time (`src/lib/live/lecture/desk.ts`),
   * loaded with the first lecture (`lectureDesk`) so no board pays for it in its first load
   */
  private lecture: LectureDesk | null = null;
  private lectureLoad: Promise<LectureDesk> | null = null;
  /**
   * Lecture page meta not yet in the store, by page: read back as if it were (`lecturePageMeta`).
   * A topic is written at once; heard text waits `LECTURE_META_FLUSH_MS` for more, so a lecture's
   * transcript does not make the autosave upload the whole board after every sentence.
   */
  private readonly pendingPageMeta = new Map<string, { patch: Partial<LecturePageMeta>; timer: ReturnType<typeof setTimeout> | null }>();

  constructor(editor: LiveEditorLike, opts: UseLiveMathOptions, deps: Partial<LiveLoopDeps> = {}) {
    this.editor = editor;
    this.opts = opts;
    this.deps = { ...defaultDeps(), ...deps };
    this.proofs = new ProofDesk(this.proofHost());
    this.chat = new ChatDesk(this.chatHost());
  }

  // ---------------------------------------------------------------- lifecycle
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.editor.store.listen((entry) => this.onChange(entry), { source: "user", scope: "document" });
    // Our own writes and the shapes' measured-size writes arrive as 'remote'. We only read
    // them to re-place shapes anchored to an echo whose width changed; nothing here ever
    // marks a burst or recognizes.
    this.unsubscribeRemote = this.editor.store.listen((entry) => this.onRemoteChange(entry), {
      source: "remote",
      scope: "document",
    });
    // Switching screens (tldraw pages) is a session change, not a document one.
    this.unsubscribeSession = this.editor.store.listen((entry) => this.onSessionChange(entry), { scope: "session" });
    this.deps.events?.addEventListener("online", this.onOnline);
    this.deps.events?.addEventListener("offline", this.onOffline);
    this.deps.events?.addEventListener(BADGE_TAP_EVENT, this.onBadgeTap);
    this.lastOnline = this.deps.isOnline();
    this.rebuild();
    this.recount();
    this.screenSeen = this.pageKey();
    void this.deps
      .getEngine()
      .then((engine) => {
        this.engine = engine;
        this.reanalyzeAll();
      })
      .catch((e) => console.warn("[live] engine failed to load", e));
    liveStore.retryHandler.set(this.retryHandler);
    liveStore.finishWriting.set(this.finishWritingHandler);
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
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.deps.events?.removeEventListener("online", this.onOnline);
    this.deps.events?.removeEventListener("offline", this.onOffline);
    this.deps.events?.removeEventListener(BADGE_TAP_EVENT, this.onBadgeTap);
    this.resetRuntime();
    // what lecture mode heard since the last write is saved with the board, not lost with the loop
    this.flushPageMeta();
    if (liveStore.retryHandler.get() === this.retryHandler) liveStore.retryHandler.set(null);
    if (liveStore.finishWriting.get() === this.finishWritingHandler) liveStore.finishWriting.set(null);
    this.resetRetry();
  }

  /**
   * Every pen of the tutor's finishes what it started, in place (`HandWriter.cancel`: a line it had
   * begun is completed, one it had not is dropped) — the solution or answer being written, a graph
   * or sketch, and each line's mark, step and operation result. On leaving a screen, and before one
   * is deleted (`deleteScreen`), so nothing half written is left behind or carried to the next one.
   */
  private finishWriting(): void {
    this.cancelHandwriting();
    for (const r of this.rt.values()) {
      r.markWriter?.cancel();
      r.stepWriter?.writer.cancel();
      r.resultWriter?.cancel();
    }
  }

  /** Timers, in-flight calls and per-line runtime: everything that belongs to the ink on screen. */
  private resetRuntime(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.settled = false;
    // Leaving the board / unmounting must not freeze a half-written step on the canvas.
    this.finishWriting();
    this.deps.recognizer.abortAll();
    for (const r of this.rt.values()) {
      r.checkAbort?.abort();
      r.solveAbort?.abort();
      if (r.unreadableTimer) clearTimeout(r.unreadableTimer);
      if (r.idleTimer) clearTimeout(r.idleTimer);
    }
    for (const ctrl of this.rereadAborts) ctrl.abort();
    this.rereadAborts.clear();
    this.reading.clear();
    this.dismissedGraphs.clear();
    this.dismissedFigures.clear();
    this.figuresInFlight.clear();
    this.diagrams = [];
    this.labelReading.clear();
    this.labelsOf.clear();
    this.lastTouchedDiagramId = null;
    this.touchedProblem = null;
    liveStore.diagrams.set([]);
    this.proofs.reset();
    this.rt.clear();
    this.dirtyStrokeIds.clear();
    this.forceRecognize.clear();
    this.offlineQueue.clear();
    this.pendingChecks.clear();
    this.pendingSolve = null;
    liveStore.offlineQueued.set(0);
    liveStore.solving.set(0);
  }

  private onSessionChange(entry: HistoryEntry<TLRecord>): void {
    for (const [from, to] of Object.values(entry.changes.updated)) {
      if (to.typeName !== "instance" || from.typeName !== "instance") continue;
      if (from.currentPageId !== to.currentPageId) {
        this.switchScreen();
        return;
      }
    }
  }

  /**
   * The student moved to another screen: Live forgets the one they left and reads this one.
   *
   * One screen is one context. Nothing on the screen they left is checked, answered or sent
   * to a model alongside this one, and a reply still streaming for it is dropped rather than
   * drawn here. This screen's lines come back from its echoes, as on a reload.
   */
  private switchScreen(): void {
    if (!this.started) return;
    this.resetRuntime();
    this.screenSeen = this.pageKey();
    liveStore.lines.set({});
    liveStore.openHints.set([]);
    clearLiveError();
    this.rebuild();
    this.recount();
    this.reanalyzeAll();
    if (liveStore.status.get() !== "offline") liveStore.status.set(this.opts.enabled ? "idle" : "paused");
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
    return setLiveError(fields);
  }

  /** The call succeeded: drop its error (if it is the one showing) and its retry state. */
  private noteSuccess(kind: LiveErrorKind, lineId?: string): void {
    const cur = liveStore.lastError.get();
    if (cur && cur.kind === kind && cur.lineId === lineId) clearLiveError();
    if (this.retryKey === `${kind}:${lineId ?? ""}`) this.resetRetry();
    // A request just came back, so the network is up. An "offline" left by a fetch that failed
    // while the browser still said online (a dropped connection; no 'online' event will ever
    // follow) ends here, and what it queued or deferred is replayed once, as on a reconnect.
    // Before, the pill kept saying "Offline" while every line was read.
    if (liveStore.status.get() === "offline" && this.deps.isOnline()) this.replayOffline();
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
        const work = ctx.opts.problem;
        if (work) {
          // one of the chat's problems: worked again from where it stands now
          const cell = this.problemCells().find((c) => c.key === work.cell.key);
          if (!cell || this.workProblem(cell, work.depth) !== "writing") clearLiveError();
          return;
        }
        const st = lines[ctx.lineId];
        if (!st?.latex) {
          clearLiveError();
          return;
        }
        if (this.pendingSolve === ctx.lineId) this.pendingSolve = null;
        this.startSolve(st.line.column, ctx.fromLineId, ctx.opts);
        return;
      }
      case "figure": {
        const figure = this.diagrams.find((d) => d.id === ctx.diagramId);
        if (!figure) {
          clearLiveError();
          return;
        }
        this.startFigure(figure, ctx.opts);
        return;
      }
      case "proof":
        if (!this.proofs.ask(ctx.lineId, null, { all: ctx.all })) clearLiveError();
        return;
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
      if (next.enabled && (next.mode === "answer" || next.mode === "suggest")) {
        // after the writing `cancelHandwriting` just finished has landed (live writes are queued)
        const mode = next.mode;
        queueMicrotask(() => {
          this.dialMovedTo(mode);
          this.dialRoseWhileStopped(mode);
        });
      }
    }
  }

  /**
   * The student moved the dial to Solve or Suggest — explicitly; a load never calls this. On a
   * screen of the chat's problems where the current problem has nothing of the student's under it
   * (`chat/work.ts`), that is asking about it: Solve works it out under it, Suggest writes its first
   * step where the student would write. Once: a problem already worked (or already given its step)
   * is left as it is, and only the current problem is touched, never every problem on the screen.
   */
  private dialMovedTo(mode: "answer" | "suggest"): void {
    if (!this.started || !this.opts.enabled || this.opts.mode !== mode) return;
    const cells = this.problemCells();
    if (cells.length === 0) return;
    const cell = currentProblem(cells, this.touchedProblem, (c) => this.problemState(c));
    if (!cell) return;
    const s = this.problemState(cell);
    if (s.work || (mode === "answer" ? s.solved : s.started)) return;
    this.workProblem(cell, mode === "answer" ? "solve" : "step");
  }

  /**
   * The dial went up to Suggest or Solve after the student had stopped writing: the answers the
   * settle writes (`renderSettled`) that the old mode held back are written now, as if the student
   * had stopped in this mode. A student stuck after a ticked `\div 2` turns the dial to Suggest
   * because they are stuck: before this, nothing came until they wrote again, which they could not.
   * Mid-writing, the settle still decides.
   */
  private dialRoseWhileStopped(mode: "answer" | "suggest"): void {
    if (!this.started || !this.opts.enabled || this.opts.mode !== mode || this.settleTimer) return;
    this.writeOperationResults();
    this.drawWantedGraphs();
    this.solveWantedFigures();
  }

  /**
   * The dial moved up to Suggest/Solve: lines already flagged amber get their check now
   * (spec ladder: mismatch + no hint yet), one per column with the lowest amber line as
   * focus, and none while a hint card is open (one-open-hint rule).
   */
  /**
   * The dial went up to Suggest / Solve: every ringed line gets the right next step written
   * beside it — from the engine, once the student has stopped. No model call: the engine
   * already knows these lines are wrong, and usually what should have come instead.
   */
  private checkMismatchesAfterLadderRise(): void {
    if (!this.engine || !this.opts.enabled) return;
    for (const st of Object.values(liveStore.lines.get())) {
      if (st.latex && (st.analysis?.verdict === "mismatch" || this.modelFlagged(st))) this.suggestNextStep(st.line.id);
    }
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

  /** Remote-sourced changes: measured echo widths. */
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
  }

  getOptions(): UseLiveMathOptions {
    return this.opts;
  }

  // ---------------------------------------------------------------- store listener
  private onChange(entry: HistoryEntry<TLRecord>): void {
    if (!this.opts.enabled) return;
    let penUp = false;
    /** a finished stroke that is not plainly a drawing (a drawing does not hold back the lines waiting to be read) */
    let writingUp = false;
    let inkChanged = false;
    let erased = false;
    /** the pen is down: a stroke in progress, which is working just as much as a finished one */
    let penDown = false;
    /** strokes the student just finished */
    const finished: TLShape[] = [];

    for (const rec of Object.values(entry.changes.added)) {
      if (!isShapeRecord(rec)) continue;
      // Undo brought back a readback the same action had deleted (Live never writes as the user)
      if (rec.type === "math" && isLiveMeta(rec.meta) && rec.meta.source === "echo") {
        this.restoredEcho(rec);
        continue;
      }
      if (!isStudentInk(rec)) continue;
      if ((rec as TLDrawShape).props.isComplete) {
        this.dirtyStrokeIds.add(rec.id);
        finished.push(rec);
        penUp = true;
        if (!this.looksDrawn(rec)) writingUp = true;
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
          finished.push(to);
          penUp = true;
          if (!this.looksDrawn(to)) writingUp = true;
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

    let problemErased = false;
    const pageId = this.editor.getCurrentPage?.()?.id;
    for (const rec of Object.values(entry.changes.removed)) {
      if (!isShapeRecord(rec)) continue;
      // shapes going with another screen (one deleted) are nothing the student rubbed out here: a
      // figure answer among them must not be "dismissed" in this screen's page meta
      if (pageId && String(rec.parentId).startsWith("page:") && rec.parentId !== pageId) continue;
      // a problem the chat wrote, rubbed out: the columns under it are read again (below)
      if (isLiveMeta(rec.meta) && problemMetaOf(rec.meta)) {
        problemErased = true;
        continue;
      }
      // the student rubbed out (part of) a graph the tutor sketched: not drawn again unasked
      const graphKey = isLiveMeta(rec.meta) ? metaString(rec.meta, GRAPH_META) : "";
      if (graphKey) {
        this.dismissGraph(graphKey, (rec.meta as LiveShapeMeta).lineId);
        continue;
      }
      // ...or of its answer about a figure: not written again unasked
      const figureAnswerKey = isLiveMeta(rec.meta) ? metaString(rec.meta, SOLVED_META) : "";
      if (figureAnswerKey.startsWith("figure:")) {
        this.dismissFigure(figureAnswerKey);
        continue;
      }
      if (isDraw(rec)) {
        const line = this.lineOfStroke(rec.id);
        if (line) {
          for (const sid of line.strokeIds) if (sid !== rec.id) this.dirtyStrokeIds.add(sid);
          this.dirtyStrokeIds.add(rec.id);
          erased = true;
          // rubbing out under a problem is working on it too (the line may be gone after the flush)
          const head = this.columnHeads.get(line.column);
          if (head) this.touchedProblem = head.key;
        } else if (this.diagramOfStroke(rec.id)) {
          // part of a drawing rubbed out: the drawings (and what counts as their labels) change
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
      }
    }

    if (problemErased) this.refreshProblemColumns();

    // Any ink at all — a stroke in progress, a finished one, ink dragged somewhere else, ink
    // rubbed out — means the student is still working, wherever on the canvas it happened.
    if (penUp || inkChanged || erased || penDown) this.markUnsettled();

    // A line the tutor ringed that the student is still writing (a pause before the last stroke of
    // the 12 read `2x = 12` as `2x = 1`): the ring comes off now, not when the line is read again.
    if (finished.length > 0) this.unringGrowingLines(finished);

    if (penUp || inkChanged || erased) {
      // The student is working again: the tutor puts the pen down (finishing what it started).
      this.cancelHandwriting();
      const rewrite = [...this.dirtyStrokeIds].some((id) => {
        const line = this.lineOfStroke(id);
        return Boolean(line && liveStore.lines.get()[line.id]?.mathShapeId);
      });
      this.pendingRewrite = this.pendingRewrite || rewrite;
      // A stroke that is plainly a drawing is not the student writing maths: the lines already
      // waiting to be read keep their time (it is sorted out at that flush, or at one of its own).
      if (penUp && !writingUp && !inkChanged && !erased && this.quietTimer) return;
      this.armQuietTimer();
    }
  }

  /**
   * Takes the ring off every ringed line these new strokes extend (`inkExtendsLine`: on its row, on
   * it or just past its right end). The verdict was on a half-written line; the re-read of the whole
   * line marks it again — a ring again if it is still wrong — instead of the old ring standing (and
   * its writer finishing it) while the student completes the line.
   */
  private unringGrowingLines(strokes: readonly TLShape[]): void {
    const inks = strokes.map((s) => this.editor.getShapePageBounds(s)).filter((b): b is Box => Boolean(b));
    for (const state of Object.values(liveStore.lines.get())) {
      if (!this.rt.get(state.line.id)?.markKey?.startsWith("circle:")) continue;
      if (inks.some((b) => inkExtendsLine(boxToRect(b), state.line.bounds))) this.syncMark(state, null);
    }
  }

  /**
   * An echo the student's Undo (or Redo) put back. Its line, if it is still here without one, takes
   * it back; a line that already has another is not given a second (this one goes). An echo whose
   * line is gone waits for the line its ink makes next (`adoptOrphanEcho`).
   */
  private restoredEcho(rec: TLShape): void {
    const lineId = (rec.props as MathShapeProps).lineId || (isLiveMeta(rec.meta) ? rec.meta.lineId : "");
    const st = liveStore.lines.get()[lineId];
    if (!st) return;
    if (!st.mathShapeId || !this.editor.getShape(st.mathShapeId)) setLine(lineId, { mathShapeId: rec.id });
    else if (st.mathShapeId !== rec.id) this.write(() => this.editor.deleteShapes([rec.id]));
  }

  /** A finished draw shape that is a drawing by its shape alone (`strokeLooksDrawn`). */
  private looksDrawn(shape: TLShape): boolean {
    const ink = this.inkOf(shape);
    return Boolean(ink && strokeLooksDrawn(ink, this.glyph));
  }

  private diagramOfStroke(strokeId: string): Diagram | null {
    return this.diagrams.find((d) => d.strokeIds.includes(strokeId as TLShapeId) || d.labels.some((l) => l.includes(strokeId as TLShapeId))) ?? null;
  }

  private armQuietTimer(delay: number = this.pendingRewrite ? LIVE_TIMING.rewriteQuietMs : LIVE_TIMING.quietMs): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      // "Never render while the pen is down": a gate that runs out while the draw tool is drawing
      // a stroke would read the line without it (the first half of an 8 read as a 0, ringed, then
      // read again and ticked). It looks again shortly; that stroke's pen-up re-arms it anyway. Only
      // the stroke being drawn counts — one left unfinished (Esc, a tool switch) never holds it.
      if (this.editor.isIn?.("draw.drawing")) {
        this.armQuietTimer(QUIET_RECHECK_MS);
        return;
      }
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
    // A line under one of the chat's problems the tutor cannot judge gets its "?" now, not mid-stroke.
    for (const lineId of Object.keys(liveStore.lines.get())) this.questionIfSettled(lineId);
    // The right next step is an answer too: it waited for the pen to stop.
    const waiting = [...this.pendingSuggestions];
    this.pendingSuggestions.clear();
    for (const lineId of waiting) this.suggestNextStep(lineId);
    // ...and so is the equation a right operation line leads to (`-3 \quad -3` → `2x = 8`)
    this.writeOperationResults();
    // and so is a graph (Solve only): `y = 2x + 1`, a system, a finished inequality's number line
    this.drawWantedGraphs();
    // A drawing's labels are its context, not something to answer: read once the student has
    // stopped, one recognizer call per drawing (and only when its labels changed).
    for (const d of this.diagrams) if (d.labels.length > 0) void this.readLabels(d);
    // ...and in Solve, a figure labelled with an unknown and left: worked out beside it, unasked
    this.solveWantedFigures();
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
      const ink = this.inkOf(shape);
      if (ink) out.push(ink);
    }
    return out;
  }

  /** A finished student stroke as ink in page coordinates, or null for anything else. */
  private inkOf(shape: TLShape): InkStroke | null {
    if (!isStudentInk(shape) || !isDraw(shape) || !shape.props.isComplete) return null;
    const bounds = this.editor.getShapePageBounds(shape);
    if (!bounds) return null;
    const transform = this.editor.getShapePageTransform(shape);
    const segments = shape.props.segments.map((seg) =>
      seg.points.map((p) => {
        const page = transform.applyToPoint(p);
        return { x: page.x, y: page.y };
      }),
    );
    return { id: shape.id, bounds: boxToRect(bounds), segments };
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
    // The drawings come back from the ink itself (pure and local): a Solve or Help right after a
    // reload must still find the figure beside the work.
    this.splitDrawings(this.collectInk(), new Set());
    this.loadFigureDismissals();
    this.columnHeads = new Map();
    const seeds: EchoShapeSeed[] = [];
    for (const shape of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(shape.meta)) continue;
      if (shape.type === "math" && shape.meta.source === "echo") {
        const props = shape.props as MathShapeProps;
        seeds.push({ shapeId: shape.id, lineId: props.lineId || shape.meta.lineId, anchorIds: props.anchorIds, latex: props.latex });
        const erased = graphDismissedOf(shape.meta);
        if (erased) this.dismissedGraphs.add(erased);
      }
    }
    if (seeds.length === 0) return;
    const bounds = this.strokeBoundsMap();
    const rebuilt = rebuildFromMathShapes(seeds, bounds);
    // a second readback of a line rebuilt from another one: one line, one echo
    const kept = new Set<string>(rebuilt.map((r) => r.mathShapeId));
    const extra = seeds.filter((s) => s.lineId && !kept.has(s.shapeId) && s.anchorIds.some((id) => bounds.has(id))).map((s) => s.shapeId);
    if (extra.length > 0) this.write(() => this.editor.deleteShapes(extra));
    // the chat's problems head the columns under them, as at every flush
    const split = new Map(this.withProblemColumns(rebuilt.map((r) => r.line)).map((l) => [l.id, l]));
    for (const r of rebuilt) r.line = split.get(r.line.id) ?? r.line;
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
        // a typeset graph card from before graphs were sketched by hand stays where it is, untracked
        graphShapeId: null,
        hintsShown: props?.note ? 1 : 0,
      };
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
    // Drawings (and their marks and labels) first: only handwriting is grouped into lines. A bar
    // under an equation with a number under it ("divide both sides") is a line of its own.
    const { split, touched: drawn } = this.splitDrawings(ink, dirty);
    const prevStates = liveStore.lines.get();
    const prevLines = Object.values(prevStates).map((s) => s.line);
    const lines = this.withProblemColumns(clusterLines(split.writing, prevLines, barGroups(split.bars, ink)));
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

    // What the student worked on last decides what Help is about: a line they wrote, or else a
    // drawing (or its labels) they drew.
    if (lines.some((l) => l.strokeIds.some((id) => dirty.has(id)))) this.lastTouchedDiagramId = null;
    else if (drawn) this.lastTouchedDiagramId = drawn.id;
    // ...and which of the chat's problems is the current one: the one they last wrote under
    for (const l of lines) {
      const head = l.strokeIds.some((id) => dirty.has(id)) ? this.columnHeads.get(l.column) : undefined;
      if (head) this.touchedProblem = head.key;
    }

    for (const { line, moveOnly } of affected) void this.processLine(line, ink, moveOnly);
  }

  /**
   * Runs `splitInk` over the screen's ink and keeps the drawings: a drawing that is gone takes the
   * tutor's answer about it with it. Returns the split and the drawing `dirty` touched, if any.
   */
  private splitDrawings(ink: InkStroke[], dirty: ReadonlySet<string>): { split: InkSplit; touched: Diagram | null } {
    // the tutor's problems are equations a division bar may be drawn under (their ink is not ink here)
    const split = splitInk(ink, this.diagrams, { equations: this.problemEquations() });
    const gone = this.diagrams.filter((d) => !split.diagrams.some((n) => n.id === d.id));
    this.diagrams = split.diagrams;
    this.glyph = split.glyph;
    this.tableStrokeIds = new Set([...split.roles].filter(([, v]) => v.role === "table").map(([id]) => id));
    this.barStrokeIds = new Set(split.bars.map((b) => b.bar));
    for (const d of gone) {
      this.labelsOf.delete(d.id);
      if (this.editor.getCurrentPageShapes().some((s) => isLiveMeta(s.meta) && s.meta.lineId === d.id)) this.deleteLineShapes(d.id);
    }
    if (this.lastTouchedDiagramId && !split.diagrams.some((d) => d.id === this.lastTouchedDiagramId)) this.lastTouchedDiagramId = null;
    const touched = split.diagrams.find((d) => [...d.strokeIds, ...d.labels.flat()].some((id) => dirty.has(id))) ?? null;
    this.publishDiagrams();
    return { split, touched };
  }

  /** The drawings as the dev panel shows them. */
  private publishDiagrams(): void {
    liveStore.diagrams.set(
      this.diagrams.map((d) => ({
        id: d.id,
        kinds: d.kinds,
        bounds: d.bounds,
        strokes: d.strokeIds.length,
        labels: d.labels.length,
        read: this.labelsOf.get(d.id) ?? null,
      })),
    );
  }

  /** Recognizes (or, for a pure move, re-places) one line; failures are recorded, never thrown. */
  private async processLine(line: InkLine, ink: InkStroke[], moveOnly: boolean): Promise<void> {
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
      return;
    }
    const hash = await hashPayload(payload);
    const state = liveStore.lines.get()[lineId];
    if (!state || rt.processing !== ticket) return;

    const prevHash = state.line.hash;
    const isMove = moveOnly && Boolean(state.latex) && (prevHash === hash || prevHash === "");
    setLine(lineId, { line: { ...line, hash } });
    if (isMove) {
      this.replaceEcho(lineId);
      return;
    }

    // New or changed ink: recognize. Whatever failed for this line before is stale now.
    this.abortLlm(lineId);
    this.clearErrorsForLine(lineId);
    rt.readRefused = false;
    this.reading.add(lineId);
    const startedAt = this.deps.now();
    const readingTimer = setTimeout(() => {
      if (liveStore.status.get() === "idle") liveStore.status.set("reading");
    }, LIVE_TIMING.readingLabelDelayMs);
    try {
      // A hash the client already knows resolves from the cache even offline.
      if (!this.deps.isOnline() && !this.deps.recognizer.peek(hash)) {
        this.queueOffline(lineId);
        return;
      }
      const req: RecognizeRequest = {
        boardId: this.opts.boardId,
        lineId,
        strokes: { x: payload.x, y: payload.y },
        bounds: { w: payload.w, h: payload.h },
      };
      if (liveStore.recognizer.get() === "vision") {
        const crop = await this.captureCrop(line.strokeIds, line.bounds);
        if (crop) req.crop = crop;
      }
      const cached = Boolean(this.deps.recognizer.peek(hash));
      const res = await this.recognizeWithCropFallback(line, req, hash);
      if (rt.processing !== ticket) return;
      this.reading.delete(lineId);
      recordRecognition({ lineId, at: this.deps.now(), sent: { ...req.strokes, ...req.bounds }, cached, response: res });
      // This very ink was read again before and the second reader's read was taken: use it now.
      const reread = this.rereads.get(hash) ?? null;
      await this.applyRecognition(lineId, res, reread);
      this.noteSuccess("recognize", lineId);
      clientMetric("live.echo.total.ms", { ms: this.deps.now() - startedAt, provider: res.provider, lineId });
      // After the read is on the board: a read that looks wrong goes to the second reader.
      if (!reread) void this.secondRead({ ...line, hash }, res);
    } catch (err) {
      if (isAbortLike(err) && !(err instanceof RecognizeTimeoutError)) return;
      if (rt.processing !== ticket) return;
      this.reading.delete(lineId);
      // Network failure (fetch throws TypeError) or the browser says offline: the offline
      // queue replays the line on reconnect. Offline, that is the whole story.
      const network = !(err instanceof RecognizeTimeoutError) && !isApiError(err) && (err instanceof TypeError || !this.deps.isOnline());
      if (network) this.queueOffline(lineId);
      if (network && !this.deps.isOnline()) return;
      if (!network) console.warn("[live] recognize failed", err);
      const failure = this.fail(err, { kind: "recognize", lineId }, { kind: "recognize", lineId });
      // Never a silent blank: transport/model trouble leaves a chip pointing at Retry; sign-in,
      // rate-limit and credit problems are the pill's job (their message is not about the line).
      if (failure && CHIP_CODES.has(failure.code)) this.applyFailedRead(lineId, LIVE_COPY.errors.recognizeChip);
      else {
        // the pill (or the out-of-ink dialog) says why; writing the line again would not help
        rt.readRefused = true;
        this.applyUnknown(lineId, "");
      }
      // a read that failed under one of the chat's problems, the student already stopped: its "?"
      this.questionIfSettled(lineId);
    } finally {
      if (rt.processing === ticket) this.reading.delete(lineId);
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
      const crop = await this.captureCrop(line.strokeIds, line.bounds);
      if (!crop) throw err;
      return await this.deps.recognizer.recognize({ ...req, crop }, hash);
    }
  }

  /** A JPEG data URL of these strokes in `bounds`, at most `maxWidth` px wide (≤ `maxCropBytes`), or undefined. */
  private async captureCrop(ids: readonly TLShapeId[], bounds: Rect, maxWidth = 512): Promise<string | undefined> {
    const toImage = this.editor.toImage;
    if (!toImage || typeof FileReader === "undefined" || bounds.w <= 0) return undefined;
    try {
      const { blob } = await toImage.call(this.editor, [...ids], {
        format: "jpeg",
        quality: 0.8,
        background: true,
        padding: 8,
        bounds: Box.From(expandRect(bounds, 8)),
        scale: Math.min(1, maxWidth / bounds.w),
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
    if (!this.opts.enabled || this.opts.mode === "off") return;
    const lines = liveStore.lines.get();
    for (const [id, userAsked] of checks) {
      // A line about to be re-recognized gets its check from the normal pipeline.
      if (skip.has(id)) continue;
      const st = lines[id];
      if (!st?.latex || st.analysis?.verdict !== "mismatch") continue;
      // The policy (mode, hints already shown, cap) decides as if asked right now.
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

  private async applyRecognition(lineId: string, res: RecognizeResponse, reread: string | null = null): Promise<void> {
    const state = liveStore.lines.get()[lineId];
    if (!state) return;
    // a division bar and the number under it: Mathpix drops the bar and reads `2` — the line is
    // "divide both sides by 2" (`engine/operationLine.ts`)
    const read = reread ?? res.latex;
    const latex = state.line.strokeIds.some((id) => this.barStrokeIds.has(id)) ? (barDivisionLatex(read) ?? read) : read;
    if (reread) setLine(lineId, { latex, confidence: Math.max(res.confidence, LIVE_LIMITS.minConfidence), provider: "reread" });
    else setLine(lineId, { latex, confidence: res.confidence, provider: res.provider });
    await this.ensureEngine();
    this.analyzeAndRender(lineId, { cascade: true });
  }

  // ---------------------------------------------------------------- the second reader
  /** The column's other lines with a read, above and below this one, top to bottom. */
  private columnNeighbours(state: LiveLineState): { above: string[]; below: string[] } {
    const col = this.columnLines(state.line.column).filter((s) => s.line.id !== state.line.id && s.latex);
    return {
      above: col.filter((s) => s.line.row < state.line.row).map((s) => s.latex),
      below: col.filter((s) => s.line.row >= state.line.row).map((s) => s.latex),
    };
  }

  /**
   * The second reader (`/api/live/reread`). Mathpix's read is already on the board; when it looks
   * wrong (`rereadTrigger`: the engine cannot read it, a symbol is implausible in its column, or
   * Mathpix was unsure), a crop of the ink goes to a vision model with that read and the column.
   * Its answer replaces Mathpix's only when `acceptReread` says so. Once per ink version, whatever
   * the outcome; never offline; never for a read that is not Mathpix's; silent when it fails.
   */
  private async secondRead(line: InkLine, res: RecognizeResponse): Promise<void> {
    const engine = this.engine;
    const hash = line.hash;
    if (!engine || !hash || res.provider !== "mathpix" || this.rereads.has(hash) || !this.deps.isOnline()) return;
    const lineId = line.id;
    const state = liveStore.lines.get()[lineId];
    if (!state || state.latex !== res.latex) return;
    const { above, below } = this.columnNeighbours(state);
    const signal = rereadTrigger({
      latex: res.latex,
      confidence: res.confidence,
      analysis: state.analysis,
      strokeCount: line.strokeIds.length,
      others: [...above, ...below],
    });
    if (!signal) return;
    this.rereads.set(hash, null);
    while (this.rereads.size > LIVE_LIMITS.cacheEntries) this.rereads.delete(this.rereads.keys().next().value as string);
    // the line must still read this way when the answer lands: new ink or a retype wins
    const current = () => {
      const cur = liveStore.lines.get()[lineId];
      return Boolean(cur && cur.line.hash === hash && cur.latex === res.latex);
    };
    const record = (r: Omit<Parameters<typeof recordReread>[1], "signal" | "mathpix">) => recordReread(lineId, { signal, mathpix: res.latex, ...r });

    const crop = await this.captureCrop(line.strokeIds, line.bounds);
    if (!crop) {
      record({ latex: "", accepted: false, error: "no crop" });
      return;
    }
    if (!current()) return;
    const ctrl = new AbortController();
    this.rereadAborts.add(ctrl);
    // being read again: no "?" on it until the second read is in
    this.reading.add(lineId);
    let reply: RereadResponse;
    try {
      reply = await this.deps.reread({ boardId: this.opts.boardId, lineId, crop, latex: res.latex, above, below }, { signal: ctrl.signal });
    } catch (err) {
      if (ctrl.signal.aborted) this.rereads.delete(hash);
      else record({ latex: "", accepted: false, error: err instanceof Error ? err.message : String(err) });
      clientMetric("live.reread.failed", { signal, lineId });
      this.rereadAborts.delete(ctrl);
      if (current() || !liveStore.lines.get()[lineId]) this.reading.delete(lineId);
      if (this.started && !ctrl.signal.aborted && current()) this.questionIfSettled(lineId);
      return;
    } finally {
      this.rereadAborts.delete(ctrl);
      if (current() || !liveStore.lines.get()[lineId]) this.reading.delete(lineId);
    }
    const accepted = acceptReread(engine, res.latex, reply.latex, [...above, ...below]);
    record({ latex: reply.latex, accepted: Boolean(accepted), model: reply.model, ms: reply.ms });
    clientMetric("live.reread", { signal, accepted: Boolean(accepted), ms: reply.ms, lineId });
    if (!accepted || !current() || !this.started) {
      // Mathpix's read stands: if the student stopped while it was being read again, its "?" is due now
      if (this.started && current()) this.questionIfSettled(lineId);
      return;
    }
    this.rereads.set(hash, accepted);
    this.applyReread(lineId, accepted, res.confidence);
  }

  /** The second reader's read replaces Mathpix's: re-analysed and re-rendered like any new read. */
  private applyReread(lineId: string, latex: string, confidence: number): void {
    const rt = this.runtime(lineId);
    // a "couldn't read this" chip waiting for the low-confidence read is not wanted any more
    if (rt.unreadableTimer) clearTimeout(rt.unreadableTimer);
    rt.unreadableTimer = null;
    setLine(lineId, { latex, provider: "reread", confidence: Math.max(confidence, LIVE_LIMITS.minConfidence) });
    this.analyzeAndRender(lineId, { cascade: true });
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
    const take = (a: LineAnalysis | null | undefined) => {
      // an operation line (`-3 \quad -3`, a bar with a 2 under it) says what the next line does: that
      // line is checked against the equation above it (`engine/operationLine.ts`)
      if (!a || a.kind === "label" || a.kind === "incomplete" || a.kind === "unknown" || a.kind === "operation") return;
      previous = a;
      if (!original && (a.kind === "equation" || a.kind === "inequality")) original = a;
    };
    // a problem the chat wrote at the top of this column is its first line
    for (const a of this.headAnalyses(state.line.column)) take(a);
    for (const s of col) {
      if (s.line.row >= state.line.row) break;
      if (!s.latex) continue;
      take(s.analysis);
    }
    return { previous, original };
  }

  // ---------------------------------------------------------------- the chat's problems as column heads
  /** The problems the chat wrote on this screen, from their strokes (`chat/cells.ts`). */
  private problemCells(): ProblemCell[] {
    const shapes: Array<{ block: string; meta: unknown; bounds: Rect }> = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(s.meta) || !problemMetaOf(s.meta)) continue;
      const b = this.editor.getShapePageBounds(s);
      if (b) shapes.push({ block: handBlockOf(s.meta), meta: s.meta, bounds: boxToRect(b) });
    }
    return readProblemCells(shapes);
  }

  /**
   * The chat's one-line problems that are an equation or an inequality, as the box of their ink:
   * a bar the student draws under one, with a number under it, is "divide both sides"
   * (`splitInk`'s `equations`), though the problem's ink is not the student's.
   */
  private problemEquations(): Rect[] {
    return this.problemCells()
      .filter((c) => c.lines.length === 1 && /=|<|>|\\[lg]eq?(?![a-zA-Z])/.test(c.lines[0]))
      .map((c) => c.head);
  }

  /** `lines` with the columns split at the chat's problems; remembers which problem heads which column. */
  private withProblemColumns(lines: InkLine[]): InkLine[] {
    const cells = this.problemCells();
    if (cells.length === 0) {
      this.columnHeads = new Map();
      return lines;
    }
    const split = splitColumnsAtProblems(lines, cells);
    this.columnHeads = split.heads;
    return split.lines;
  }

  /** The head of this column analysed as the column's first line(s), or [] with none. */
  private headAnalyses(column: number): (LineAnalysis | null)[] {
    const head = this.columnHeads.get(column);
    return head ? this.problemAnalyses(head.lines) : [];
  }

  /** A problem's lines analysed as a column in the current mode, memoised (a problem does not change). */
  private problemAnalyses(lines: readonly string[]): (LineAnalysis | null)[] {
    if (!this.engine) return [];
    const key = `${this.opts.mode}\n${lines.join("\n")}`;
    let memo = this.headMemo.get(key);
    if (!memo) {
      memo = analyzeColumn(this.engine, lines, this.opts.mode);
      this.headMemo.set(key, memo);
      while (this.headMemo.size > 64) this.headMemo.delete(this.headMemo.keys().next().value as string);
    }
    return memo;
  }

  /**
   * The chat wrote problems, or one was rubbed out: the columns are split again at the problems
   * there are now, and when any line's column or head changed every line is analysed again (a
   * line under a problem is checked against it).
   */
  private refreshProblemColumns(): void {
    if (!this.started) return;
    const states = Object.values(liveStore.lines.get());
    const before = [...this.columnHeads.entries()].map(([c, h]) => `${c}:${h.key}`).join(",");
    const next = this.withProblemColumns(assignColumns(states.map((s) => ({ ...s.line }))));
    const after = [...this.columnHeads.entries()].map(([c, h]) => `${c}:${h.key}`).join(",");
    let changed = before !== after;
    for (const l of next) {
      const st = liveStore.lines.get()[l.id];
      if (!st || (st.line.column === l.column && st.line.row === l.row)) continue;
      setLine(l.id, { line: { ...st.line, column: l.column, row: l.row } });
      changed = true;
    }
    if (changed) this.reanalyzeAll();
  }

  // ---------------------------------------------------------------- the tutor works the chat's problems
  /**
   * A line of the student's the tutor can judge: read, sure, maths it can check or reason about —
   * not a lone `2`, a label, half a line or prose (`unjudgedReason`), not a row of a proof.
   */
  private judgeable(state: LiveLineState): boolean {
    return Boolean(state.latex) && !needsLook(state) && unjudgedReason(state) === null && !this.proofs.owns(state.line.id);
  }

  /**
   * Solve steps and Help act on this line as they always have. Under one of the chat's problems it
   * must be a line the tutor can judge: a lone `2` there is not work to continue — the problem is.
   */
  private actsOn(state: LiveLineState | undefined): boolean {
    if (!state?.latex) return false;
    return this.columnHeads.has(state.line.column) ? this.judgeable(state) : !needsLook(state);
  }

  /** The student's work under a problem: their line there the tutor can judge — the one touched last, else the lowest. */
  private workUnder(cell: ProblemCell): LiveLineState | null {
    const mine = Object.values(liveStore.lines.get()).filter((s) => this.columnHeads.get(s.line.column)?.key === cell.key && this.judgeable(s));
    if (mine.length === 0) return null;
    return mine.find((s) => s.line.id === this.lastTouchedLineId) ?? mine.sort((a, b) => a.line.bounds.y - b.line.bounds.y)[mine.length - 1];
  }

  /** What the tutor has written under a problem (`problemWork`): its lines in writing order, where they are, whether the solution is among them. */
  private tutorWorkOn(cell: ProblemCell): { lines: string[]; rect: Rect | null; solved: boolean } {
    const id = problemLineId(cell);
    const hand: TLShape[] = [];
    const typeset: Array<{ latex: string; y: number }> = [];
    const rects: Rect[] = [];
    let solved = false;
    for (const s of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(s.meta) || s.meta.lineId !== id) continue;
      const kind = metaString(s.meta, PROBLEM_WORK_META);
      if (!kind) continue;
      if (kind === "solution") solved = true;
      const b = this.editor.getShapePageBounds(s);
      if (b) rects.push(boxToRect(b));
      if (s.type === "math") typeset.push({ latex: (s.props as MathShapeProps).latex, y: s.y });
      else hand.push(s);
    }
    const lines = [...handLinesOf(hand), ...typeset.sort((a, b) => a.y - b.y).map((t) => t.latex)];
    return { lines, rect: rects.length > 0 ? unionRects(rects) : null, solved };
  }

  /** Being worked on now: its block is being written, or its worked solution is on its way from the model. */
  private problemBusy(cell: ProblemCell): boolean {
    const id = problemLineId(cell);
    return (this.writer !== null && this.writerFor === id) || Boolean(this.rt.get(id)?.solveAbort);
  }

  private problemState(cell: ProblemCell): ProblemState {
    const busy = this.problemBusy(cell);
    const work = this.tutorWorkOn(cell);
    return { work: this.workUnder(cell) !== null, solved: work.solved || busy, started: work.solved || work.lines.length > 0 || busy };
  }

  /** Which of the chat's problems an ask is about (`chat/work.ts`); null with none on this screen. */
  private problemPick(depth: ProblemDepth): ProblemPick | null {
    const cells = this.problemCells();
    if (cells.length === 0) return null;
    const state = (c: ProblemCell) => this.problemState(c);
    return depth === "solve" ? pickForSolve(cells, this.touchedProblem, state) : pickForStep(cells, this.touchedProblem, state);
  }

  /**
   * The tutor works one of the chat's problems, under it, in its hand: `solve` writes the rest of it
   * worked out, `step` its next step — each continuing after what the tutor already wrote there
   * (`problemSteps`), so a second ask never writes the same thing twice. The problem's own lines
   * are the column, and the rest is Solve's path on the student's work (`solveBuilt`): `localSolve`
   * (free), a graph for an answer that graphs, and the model's worked solution (`/api/live/solve`,
   * metered there) only when the engine has nothing. Placed in the problem's cell, under the problem
   * and the tutor's last block there, clear of everything on the page (`placeInCell`).
   *
   * `from` the chat: the chat is busy writing its own reply, not a problem this could be half of.
   * Returns what happened: started, `done` (nothing left to write), `busy` (being written already).
   */
  private workProblem(cell: ProblemCell, depth: ProblemDepth, from: "board" | "chat" = "board"): "writing" | "done" | "busy" {
    if (!this.started || this.problemBusy(cell) || (from === "board" && this.chat.busy)) return "busy";
    if (depth === "solve" && this.tutorWorkOn(cell).solved) return "done";
    const run = (): "writing" | "done" | "busy" => {
      const fresh = this.problemCells().find((c) => c.key === cell.key);
      if (!this.started || !fresh || this.problemBusy(fresh)) return "busy";
      const work = this.tutorWorkOn(fresh);
      const built = this.problemColumn(fresh);
      const below = work.rect ? unionRects([fresh.head, work.rect]) : fresh.head;
      const opts: SolveOpts = { lineId: problemLineId(fresh), onlyFirstStep: depth === "step", problem: { cell: fresh, depth, written: work.lines, below } };
      clientMetric("live.problem.work", { depth, from, n: fresh.n, written: work.lines.length });
      return this.solveBuilt(built, undefined, opts) === "nothing" ? "done" : "writing";
    };
    if (this.engine) return run();
    void this.ensureEngine().then(run, () => undefined);
    return "writing";
  }

  /** A problem's lines as a column Solve can work from (`BuiltColumn`), each where it is written. */
  private problemColumn(cell: ProblemCell): BuiltColumn {
    const id = problemLineId(cell);
    const shapes: Array<{ block: string; meta: unknown; bounds: Rect; line: string }> = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(s.meta) || !problemMetaOf(s.meta)) continue;
      const b = this.editor.getShapePageBounds(s);
      if (b) shapes.push({ block: handBlockOf(s.meta), meta: s.meta, bounds: boxToRect(b), line: metaString(s.meta, HAND_LINE_META) });
    }
    const rects = problemLines(shapes, cell);
    const analyses = this.problemAnalyses(cell.lines);
    const last = cell.lines.length - 1;
    const states: LiveLineState[] = cell.lines.map((latex, i) => ({
      ...newLineState({ id: i === last ? id : `${id}:${i}`, strokeIds: [], bounds: rects[i], column: -1, row: i, hash: "" }),
      latex,
      confidence: 1,
      provider: "typed",
      analysis: analyses[i] ?? null,
    }));
    const region = expandRect(unionRects(rects), 24);
    const lines: CheckLine[] = states.map((s, i) => ({
      id: `chat-problem-${cell.n}-${i}`,
      latex: s.latex.slice(0, 2000),
      bbox: normalizeBBox(s.line.bounds, region),
      local: { kind: s.analysis?.kind ?? "unknown", verdict: s.analysis?.verdict ?? "unknown" },
    }));
    return { lines, region, states };
  }

  /** The lines to write for a problem, from a worked solution of it (`problemSteps`). */
  private problemStepsFor(work: ProblemWork, solution: readonly string[]): string[] {
    const engine = this.engine;
    const mode = this.opts.mode === "off" ? "feedback" : this.opts.mode;
    return problemSteps({
      solution,
      head: work.cell.lines,
      written: work.written,
      depth: work.depth,
      normalize: normalizeStep,
      ticked: engine
        ? (step) => {
            const a = analyzeColumn(engine, [...work.cell.lines, step], mode).at(-1);
            // the interval written again (`0^{\circ} \le x < 360^{\circ}`) is ticked, but it is not a step
            if (a?.domain && !a.math) return false;
            return a?.verdict === "ok" || Boolean(a?.solved);
          }
        : undefined,
    });
  }

  /** The meta of a block of the tutor's work on a problem: a step, or the solution (then also `solvedLatex`, the problem). */
  private problemMeta(work: ProblemWork): JsonObject {
    return work.depth === "solve"
      ? { [PROBLEM_WORK_META]: "solution", [SOLVED_META]: work.cell.lines.join(" ; ") }
      : { [PROBLEM_WORK_META]: "step" };
  }

  /**
   * Where a block of the tutor's work on a problem goes, and it starts being written: under the
   * problem (and the tutor's last block there), at the problem's left edge, in its cell — at a
   * smaller hand when the cell is tight; else anywhere clear on the screen below it. Null only when
   * the hand cannot write a glyph of it (the typeset fallback's turn).
   */
  private drawProblemWork(built: { states: LiveLineState[] }, opts: SolveOpts, work: ProblemWork, state: LiveLineState, steps: readonly string[], extraMeta?: JsonObject): { rect: Rect; wallMs: number } | null {
    // the hand the problem was written in (its ink is a digit's height of it), as large as a student's line allows
    const base = handSizeFor(state.line.bounds.h / HAND_WRITE.digitRatio);
    const seed = handSeedFor(`${opts.lineId}:${work.written.length}`);
    const at = { x: unionRects(built.states.map((s) => s.line.bounds)).x, y: rectMaxY(work.below) + WORK_PLACE.gap };
    const avoid = this.avoidRects(opts.lineId);
    let first: HandPlan | null = null;
    let slot: Rect | null = null;
    let plan: HandPlan | null = null;
    for (const size of [base, Math.round(base * 0.8), Math.round(base * 0.65)]) {
      const planned = planHandwriting(steps, { size, seed });
      if (!planned.plan || planned.unsupported.length > 0) return null;
      first ??= planned.plan;
      slot = placeInCell(planned.plan.bounds, at, work.cell.cell, avoid);
      if (slot) {
        plan = planned.plan;
        break;
      }
    }
    if (!first) return null;
    if (!slot || !plan) {
      // its cell is full: clear space on the screen, under it or beside it
      plan = first;
      slot = placeInCell(plan.bounds, at, this.placementBounds(), avoid) ?? findFreeSlot({ ...at, w: plan.bounds.w, h: plan.bounds.h }, avoid, work.below, "below");
      clientMetric("live.problem.noRoom", { lineId: opts.lineId });
    }
    const block = placeHandPlan(plan, { x: slot.x, y: slot.y });
    this.startHandwriting(block, opts.lineId, extraMeta);
    clientMetric("live.solve.hand.ms", { ms: Math.round(wallMsOf(plan)), lineId: opts.lineId });
    return { rect: block.bounds, wallMs: this.deps.reducedMotion() ? 0 : wallMsOf(plan) };
  }

  /** Solve's graph for a problem the chat wrote: its lines, the tutor's work and the new steps; sketched in its cell after the steps. */
  private problemGraph(built: BuiltColumn, opts: SolveOpts, work: ProblemWork, local: LocalWritten | null): boolean {
    if (work.depth !== "solve" || !local || local.steps.length === 0) return false;
    const intent = this.graphIntentFor([...work.cell.lines, ...work.written, ...local.steps]);
    if (!intent) return false;
    if (this.graphWriterKey === intent.key || this.graphShapesOn(new Set([opts.lineId])).some((s) => metaString(s.meta, GRAPH_META) === intent.key)) return true;
    if (this.dismissedGraphs.has(intent.key) || liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return false;
    return this.drawGraph(intent, built.states, {
      anchorLineId: opts.lineId,
      reserve: local.block ?? undefined,
      delayMs: local.block ? local.wallMs + 300 : 0,
      bounds: work.cell.cell,
    });
  }

  private analyze(state: LiveLineState): LineAnalysis | null {
    if (!this.engine || !state.latex) return null;
    // a proof's statements and reasons are checked as a proof, not one by one
    if (this.proofs.owns(state.line.id)) return PROOF_LINE;
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
   */
  private analyzeAndRender(lineId: string, opts: { cascade?: boolean; idleMs?: number; fromIdle?: boolean } = {}): void {
    const state = liveStore.lines.get()[lineId];
    if (!state) return;
    const analysis = this.analyze(state);
    const wasWarn = state.analysis?.verdict === "mismatch";
    const isWarn = analysis?.verdict === "mismatch";
    const rewritesWithWarn = isWarn ? state.rewritesWithWarn + (wasWarn && !opts.fromIdle ? 1 : 0) : 0;
    setLine(lineId, { analysis, rewritesWithWarn });
    const fresh = liveStore.lines.get()[lineId];
    if (!fresh) return;
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
    // a new read can make a proof of lines around it (or change a row's verdict): re-mark them
    this.proofs.sync();
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
    if (this.renderProofLine(state, opts)) return;
    const lineId = state.line.id;
    const rt = this.runtime(lineId);
    // The line changed under an answer the tutor had already written: that answer is stale.
    this.dropStaleAnswer(state);
    this.dropStaleOperationResult(state);
    // Its column's graph follows its maths: erased when that changed, sketched when wanted (Solve, settled).
    if (!opts.keepStatus && !decision.capped) this.syncGraph(state.line.column);
    if (!decision.echo) {
      if (state.mathShapeId || state.graphShapeId) this.deleteLineShapes(lineId, { keepAi: true });
      if (!opts.quiet) {
        // silent — unless it is under one of the chat's problems and the student has stopped: "?"
        const why = this.questionNow(state);
        this.syncMark(state, why ? "question" : null, why ?? undefined);
      }
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
          if (this.opts.mode !== "off") this.syncMark(cur, "question", "unread");
        }, LIVE_TIMING.unreadableChipMs);
      }
      return;
    }
    // A finished sum does not want its own line read back at it — it wants the answer.
    if (this.inlineAnswer(state, decision)) {
      this.syncMark(state, null);
      return;
    }
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
    // The mark IS the feedback now: a tick after a right step, a ring round a wrong one. The
    // echo that used to carry the badge only shows on hover. Mode off keeps what is there.
    if (!opts.keepStatus) {
      const ring = status === "warn" || (status !== "ok" && status !== "solved" && this.modelFlagged(state));
      const tick = status === "ok" || status === "solved";
      // a line the engine cannot read at all, under one of the chat's problems: its "?" (`questionNow`)
      const why = ring || tick ? null : this.questionNow(state);
      this.syncMark(state, ring ? "circle" : tick ? "check" : why ? "question" : null, why ?? undefined);
      this.dropStaleSuggestion(state, ring);
      if (ring && !opts.quiet) this.suggestNextStep(lineId);
    }
  }

  // ---------------------------------------------------------------- "?" under the chat's problems
  /**
   * No silent lines under a problem the tutor wrote. A line there the tutor read but cannot judge
   * (`unjudgedReason`: a lone `2`, a label, half a line, prose, LaTeX the engine cannot read, a read
   * that failed or came back unsure) gets the tutor's "?" — in Feedback, Suggest and Solve, once the
   * student has stopped writing (the settle: `renderSettled`), never mid-stroke. The student under
   * a problem is answering it, so saying nothing reads as a broken tutor.
   *
   * Everywhere else today's silence stands: students write labels and scratch numbers. And no "?"
   * on a line that is still being read (the recognizer, the second reader), whose check is in
   * flight or waiting for the network, on a row of a proof, at the shape cap, or whose read was
   * refused for a reason writing it again would not fix (signed out, out of ink). A drawing is
   * never a line, so never gets one. Why it is there rides on the mark (`meta.markWhy`).
   */
  private questionFor(state: LiveLineState): UnjudgedReason | null {
    if (!this.opts.enabled || this.opts.mode === "off") return null;
    if (!this.columnHeads.has(state.line.column)) return null;
    const id = state.line.id;
    const rt = this.rt.get(id);
    if (this.proofs.owns(id) || rt?.readRefused || rt?.checkAbort) return null;
    if (this.reading.has(id) || this.offlineQueue.has(id) || this.pendingChecks.has(id)) return null;
    if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return null;
    return unjudgedReason(state);
  }

  /**
   * The "?" a render of this line wants: once the student has stopped, or — so a re-render does not
   * take it away — while the "?" already on the page is on the line as it is now (the ink moved or
   * grew: it waits for the next stop, like the first one did).
   */
  private questionNow(state: LiveLineState): UnjudgedReason | null {
    const why = this.questionFor(state);
    if (!why) return null;
    if (this.settled) return why;
    const key = markKey("question", state.line.bounds);
    const shown = this.rt.get(state.line.id)?.markKey;
    if (shown !== undefined) return shown === key ? why : null;
    // after a reload: the one on the page
    const onPage = this.editor.getCurrentPageShapes().some((s) => isLiveMeta(s.meta) && s.meta.lineId === state.line.id && metaString(s.meta, MARK_META) === key);
    return onPage ? why : null;
  }

  /** The student has stopped: this line's "?", when it wants one. */
  private questionIfSettled(lineId: string): void {
    const state = liveStore.lines.get()[lineId];
    if (!state || !this.settled) return;
    const why = this.questionFor(state);
    if (why) this.syncMark(state, "question", why);
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
      // a lecture's notes and sketches are the student's notes, not marks on their work: an hour of
      // lecture must not use up the cap and leave the tutor unable to mark what they write
      if (metaString(s.meta, LECTURE_BLOCK_META)) continue;
      if (answerSrcOf(s.meta)) answers = true;
      const block = handBlockOf(s.meta);
      if (block) blocks.add(block);
      else n++;
    }
    this.hasAnswerInk = answers;
    liveStore.liveShapeCount.set(n + blocks.size);
  }

  /** The model called this line wrong, and the line still reads the way it did then. */
  private modelFlagged(state: LiveLineState): boolean {
    const shape = state.mathShapeId ? this.editor.getShape(state.mathShapeId) : undefined;
    return Boolean(shape && state.latex && metaString(shape.meta, AI_WARN_META) === state.latex);
  }

  /** The current screen's rect, or null on an editor without screens. */
  private screenRect(): Rect | null {
    const page = this.editor.getCurrentPage?.();
    return page ? readScreenMeta(page.meta) : null;
  }

  /**
   * The edges placement keeps inside: the screen (the whiteboard's own edge, whatever the
   * zoom), else the viewport.
   */
  private placementBounds(): Rect {
    return this.screenRect() ?? boxToRect(this.editor.getViewportPageBounds());
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
      const own = st.mathShapeId ? this.editor.getShape(st.mathShapeId) : undefined;
      // No echo of its own: an echo already on this ink that no current line owns is this line's —
      // Undo after a rub-out or a delete brings the readback back with the ink, under the id of a
      // line Live has since dropped. It is taken over, never written a second time beside it.
      const adopted = own ? undefined : this.adoptOrphanEcho(lineId, anchorIds);
      const existing = own ?? adopted;
      // The readback Undo brought back was one the student had typed over (a misread they fixed):
      // the line takes it back as typed, not the recognizer's cached misread of the same ink.
      const typed = adopted && isLiveMeta(adopted.meta) && adopted.meta.edited ? (adopted.props as MathShapeProps).latex : "";
      if (adopted && typed && typed !== wanted.latex) {
        this.editor.updateShapes([{ id: adopted.id, type: "math", props: { anchorIds, lineId }, meta: { ...(adopted.meta as LiveShapeMeta), lineId } } satisfies TLShapePartial<MathShape>]);
        setLine(lineId, { mathShapeId: adopted.id });
        queueMicrotask(() => this.retypeLine(lineId, typed));
        return;
      }
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
          Boolean(adopted) ||
          cur.latex !== props.latex ||
          cur.status !== props.status ||
          cur.resultLatex !== props.resultLatex ||
          cur.note !== props.note ||
          !sameStrokeSet(cur.anchorIds, anchorIds);
        if (adopted) setLine(lineId, { mathShapeId: adopted.id });
        if (!changed) return;
        this.editor.updateShapes([
          {
            id: existing.id,
            type: "math",
            props: { ...props, anchorIds, lineId, tone: "muted", source: "echo" },
            // `false` (not a delete) because tldraw merges meta patches shallowly.
            meta: { ...(existing.meta as LiveShapeMeta), lineId, edited: st.edited, [AI_NOTE_META]: aiNoteNow },
          } satisfies TLShapePartial<MathShape>,
        ]);
        return;
      }
      const props = wanted;
      if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard && props.latex === "") return;
      const viewport = this.placementBounds();
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

  /**
   * An echo on this line's ink that no other current line owns (one Undo brought back), or
   * undefined. Any further such echoes on the same ink are deleted: one line, one readback. Runs
   * inside a live write.
   */
  private adoptOrphanEcho(lineId: string, anchorIds: readonly string[]): TLShape | undefined {
    const lines = liveStore.lines.get();
    const ink = new Set(anchorIds);
    const found: TLShape[] = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      if (s.type !== "math" || !isLiveMeta(s.meta) || s.meta.source !== "echo") continue;
      const owner = (s.props as MathShapeProps).lineId || s.meta.lineId;
      if (owner !== lineId && lines[owner]) continue;
      if ((s.props as MathShapeProps).anchorIds.some((id) => ink.has(id))) found.push(s);
    }
    if (found.length > 1) this.editor.deleteShapes(found.slice(1).map((s) => s.id));
    return found[0];
  }

  /** Line moved: keep content, move the echo to the new slot. */
  private replaceEcho(lineId: string): void {
    // The ink moved: its mark goes with it (redrawn at the new place, same kind).
    const moved = liveStore.lines.get()[lineId];
    const kind = this.runtime(lineId).markKey?.split(":")[0] as MarkKind | undefined;
    if (moved && kind) this.syncMark(moved, kind);
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      if (!st?.mathShapeId) return;
      const shape = this.editor.getShape(st.mathShapeId);
      if (!shape || shape.type !== "math") return;
      const props = shape.props as MathShapeProps;
      const viewport = this.placementBounds();
      const candidate = placeEcho(st.line.bounds, props.latex, props.size, viewport);
      const rect = findFreeSlot({ ...candidate, w: props.w, h: props.h }, this.avoidRects(lineId), st.line.bounds);
      this.editor.updateShapes([{ id: shape.id, type: "math", x: rect.x, y: rect.y }]);
    });
  }

  // ---------------------------------------------------------------- graphs, sketched by hand
  /**
   * The maths a column's graph is computed from: the student's lines, top to bottom, then the
   * tutor's worked solution under them (its handwritten lines, its typeset steps) — so once
   * `2x + 3 > 11` is solved, its answer `x > 4` is part of the column and its number line stays.
   */
  private columnGraphLines(column: number): { states: LiveLineState[]; lines: string[] } {
    const states = this.columnLines(column).filter((s) => s.latex && !isOperationLine(s));
    const ids = new Set<string>(states.map((s) => s.line.id));
    const typeset: Array<{ latex: string; y: number }> = [];
    const hand: TLShape[] = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(s.meta) || s.meta.source !== "ai" || !ids.has(s.meta.lineId)) continue;
      if (s.type === "math") typeset.push({ latex: (s.props as MathShapeProps).latex, y: s.y });
      else if (metaString(s.meta, SOLVED_META)) hand.push(s);
    }
    const solution = [...handLinesOf(hand), ...typeset.sort((a, b) => a.y - b.y).map((t) => t.latex)];
    return { states, lines: [...states.map((s) => s.latex), ...solution] };
  }

  /** The engine's graph for these lines; memoised, because `graphFor` is pure and every render asks. */
  private graphIntentFor(lines: readonly string[]): GraphIntent | null {
    const engine = this.engine;
    if (!engine?.graphFor || lines.length === 0) return null;
    const key = lines.join("\n");
    if (this.graphMemo.has(key)) return this.graphMemo.get(key) ?? null;
    let intent: GraphIntent | null = null;
    try {
      intent = engine.graphFor(lines);
    } catch (e) {
      console.warn("[live] graphFor threw", e);
    }
    this.graphMemo.set(key, intent);
    while (this.graphMemo.size > 64) this.graphMemo.delete(this.graphMemo.keys().next().value as string);
    return intent;
  }

  /** The strokes (or the typeset card) of every graph the tutor drew for these lines. */
  private graphShapesOn(lineIds: ReadonlySet<string>): TLShape[] {
    return this.editor
      .getCurrentPageShapes()
      .filter((s) => isLiveMeta(s.meta) && lineIds.has(s.meta.lineId) && metaString(s.meta, GRAPH_META) !== "");
  }

  /**
   * Keeps a column's graph in step with its maths. A graph the column no longer wants (a line
   * changed) is erased at once. The wanted graph is an ANSWER: drawn when the student asks
   * (Solve / Help, `asked`), or unasked only in Solve once they have stopped writing, and never
   * over one they rubbed out. A graph already on the page (same key) is never drawn again.
   * Returns true when the wanted graph is on the page or on its way.
   */
  private syncGraph(
    column: number,
    opts: { asked?: boolean; intent?: GraphIntent | null; anchorLineId?: string; reserve?: Rect; delayMs?: number } = {},
  ): boolean {
    if (!this.engine?.graphFor || this.opts.mode === "off") return false;
    const { states, lines } = this.columnGraphLines(column);
    const wanted = opts.intent !== undefined ? opts.intent : this.graphIntentFor(lines);
    const existing = this.graphShapesOn(new Set<string>(states.map((s) => s.line.id)));
    // the sketch being drawn right now is not stale: its solution may still be being written above it
    const stale = existing.filter((s) => {
      const k = metaString(s.meta, GRAPH_META);
      return k !== wanted?.key && k !== this.graphWriterKey;
    });
    if (stale.length > 0) {
      this.write(() => {
        const gone = stale.map((s) => s.id).filter((id) => this.editor.getShape(id));
        if (gone.length > 0) this.editor.deleteShapes(gone);
      });
    }
    if (!wanted || states.length === 0) return false;
    if (this.graphWriterKey === wanted.key || existing.some((s) => metaString(s.meta, GRAPH_META) === wanted.key)) return true;
    // the problem this column is under has that very graph already, from the tutor working it
    const head = this.columnHeads.get(column);
    if (head && this.graphShapesOn(new Set([problemLineId(head)])).some((s) => metaString(s.meta, GRAPH_META) === wanted.key)) return true;
    if (!this.opts.enabled || liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return false;
    if (opts.asked) this.undismissGraph(wanted.key, states);
    else if (this.opts.mode !== "answer" || !this.settled || this.graphWriter || this.dismissedGraphs.has(wanted.key)) return false;
    return this.drawGraph(wanted, states, opts);
  }

  /** Solve, and the student has stopped: every column that wants a graph gets one, one sketch at a time. */
  private drawWantedGraphs(): void {
    if (!this.started || !this.opts.enabled || this.opts.mode !== "answer" || !this.engine?.graphFor || this.graphWriter) return;
    const columns = [...new Set(Object.values(liveStore.lines.get()).filter((s) => s.latex).map((s) => s.line.column))].sort((a, b) => a - b);
    for (const column of columns) {
      this.syncGraph(column);
      if (this.graphWriter) return;
    }
  }

  /**
   * Sketches the graph beside the column's work (else under it and its solution), in the tutor's
   * hand, never over anything on the page: smaller sketches are tried before giving up. With the
   * hand switched off, a function graph is the typeset card instead.
   */
  private drawGraph(intent: GraphIntent, states: LiveLineState[], opts: { anchorLineId?: string; reserve?: Rect; delayMs?: number; bounds?: Rect }): boolean {
    const anchor = states.find((s) => s.line.id === opts.anchorLineId) ?? states[states.length - 1];
    const column = unionRects(states.map((s) => s.line.bounds));
    const under = opts.reserve ? unionRects([column, opts.reserve]) : column;
    const avoid: Rect[] = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      const b = this.editor.getShapePageBounds(s);
      if (b) avoid.push(boxToRect(b));
    }
    if (opts.reserve) avoid.push(opts.reserve);
    // the screen — or, for a problem the chat wrote, its cell
    const bounds = opts.bounds ?? this.placementBounds();
    if (!this.deps.handwritingEnabled()) return this.placeGraphCard(intent, anchor, { column, under, bounds, avoid });
    const seed = handSeedFor(`graph:${intent.key}`);
    for (const box of [GRAPH.box, ...GRAPH.fallbackBoxes]) {
      const planned = planGraph(intent, { seed, box });
      if (!planned) return false;
      const slot = placeGraphBlock({ w: planned.plan.bounds.w, h: planned.plan.bounds.h }, { column, under, bounds, avoid });
      if (!slot) continue;
      this.startGraphWriter(placeHandPlan(planned.plan, { x: slot.x, y: slot.y }), anchor.line.id, intent.key, opts.delayMs ?? 0);
      clientMetric("live.graph.hand", { lineId: anchor.line.id, kind: intent.kind, ms: Math.round(wallMsOf(planned.plan)) });
      return true;
    }
    clientMetric("live.graph.noRoom", { lineId: anchor.line.id, kind: intent.kind });
    return false;
  }

  /**
   * The hand is switched off: the typeset graph card, for what it can show (functions, their
   * points). A region, a circle or a number line has no typeset form, so nothing is drawn.
   */
  private placeGraphCard(intent: GraphIntent, anchor: LiveLineState, place: GraphPlaceContext): boolean {
    if (intent.kind !== "plane" || intent.curves.some((c) => c.kind !== "function" || c.op !== "=")) return false;
    const size = { w: GRAPH_SHAPE_DEFAULTS.w, h: GRAPH_SHAPE_DEFAULTS.h };
    const slot = placeGraphBlock(size, place);
    if (!slot) return false;
    const win = chooseWindow(intent, size);
    const num = (v: number) => String(Number(v.toPrecision(4)));
    const lineId = anchor.line.id;
    this.write(() => {
      this.editor.createShapes([
        {
          id: createShapeId(),
          type: "graph",
          x: slot.x,
          y: slot.y,
          props: {
            ...GRAPH_SHAPE_DEFAULTS,
            fns: intent.curves.map((c, i) => ({ id: `f_${lineId}_${i}`, expr: c.kind === "function" ? c.expr : "", latex: c.latex, color: GRAPH_COLORS[0] })),
            points: intent.points.map((p) => ({ x: p.x, y: p.y, label: p.label ? `(${num(p.x)}, ${num(p.y)})` : "" })),
            xMin: win.xMin,
            xMax: win.xMax,
            yMin: win.yMin,
            yMax: win.yMax,
            autoY: false,
            lineId,
          },
          meta: { ...makeMeta("ai", lineId, this.deps.now()), [GRAPH_META]: intent.key },
        } satisfies TLShapePartial<GraphShape>,
      ]);
    });
    clientMetric("live.graph.typeset", { lineId });
    return true;
  }

  private startGraphWriter(plan: HandPlan, lineId: string, key: string, delayMs: number): void {
    // one sketch at a time: a sketch already under way is completed first (never left as bare axes)
    const prev = this.graphWriter;
    this.graphWriter = null;
    prev?.cancel();
    const writer = this.makeWriter();
    this.graphWriter = writer;
    this.graphWriterKey = key;
    writer.start(plan, {
      meta: makeMeta("ai", lineId, this.deps.now()),
      extraMeta: { [GRAPH_META]: key },
      delayMs,
      whole: true,
      onDone: () => {
        if (this.graphWriter === writer) this.graphWriter = null;
        // Its last strokes are in the write queued just before this one; after it the sketch is
        // on the page under its own key, and the next column that wants one may have its turn.
        this.write(() => {
          if (this.graphWriter === null && this.graphWriterKey === key) this.graphWriterKey = null;
          if (this.settled && this.graphWriter === null) this.drawWantedGraphs();
          if (this.settled && this.graphWriter === null) this.solveWantedFigures();
        });
      },
    });
  }

  /** The student rubbed out (part of) a sketched graph: not drawn again unasked, also after a reload. */
  private dismissGraph(key: string, lineId: string): void {
    if (this.dismissedGraphs.has(key)) return;
    this.dismissedGraphs.add(key);
    this.writeGraphErased(lineId, key);
  }

  /** Asked for again: the graph may come back. */
  private undismissGraph(key: string, states: readonly LiveLineState[]): void {
    if (!this.dismissedGraphs.delete(key)) return;
    for (const st of states) this.writeGraphErased(st.line.id, "", key);
  }

  private writeGraphErased(lineId: string, value: string, only?: string): void {
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      const echo = st?.mathShapeId ? this.editor.getShape(st.mathShapeId) : undefined;
      if (!echo || echo.type !== "math") return;
      const cur = graphDismissedOf(echo.meta) ?? "";
      if (cur === value || (only !== undefined && cur !== only)) return;
      this.editor.updateShapes([{ id: echo.id, type: "math", meta: { ...echo.meta, [GRAPH_DISMISSED_META]: value } }]);
    });
  }

  /**
   * The echo's measured width moved by more than ECHO_WIDTH_RELAYOUT_PX (KaTeX measured
   * after the estimate): push away AI shapes anchored to this line that the wider echo now
   * covers.
   */
  private relayoutForEcho(lineId: string): void {
    this.write(() => {
      const st = liveStore.lines.get()[lineId];
      if (!st?.mathShapeId) return;
      const echoBounds = this.editor.getShapePageBounds(st.mathShapeId);
      if (!echoBounds) return;
      const echo = boxToRect(echoBounds);
      const updates: TLShapePartial[] = [];
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
    const column = liveStore.lines.get()[lineId]?.line.column;
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
    // the rest of its column may have lost a relation its graph was drawn from
    if (column !== undefined) this.syncGraph(column);
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
    // an operation line (`-3 \quad -3`) is not a line of working for a model to check or to
    // solve from: the line after it follows from the equation above it (`isOperationLine`)
    const states = this.columnLines(column).filter((s) => s.latex && !isOperationLine(s));
    if (states.length === 0) return null;
    // a problem the chat wrote at the top of the column is its first line for the model too
    const head = this.columnHeads.get(column);
    const region = expandRect(unionRects([...states.map((s) => s.line.bounds), ...(head ? [head.head] : [])]), 24);
    const headAnalyses = this.headAnalyses(column);
    const heads: CheckLine[] = head
      ? head.lines.slice(0, 3).map((latex, i) => ({
          id: `chat-problem-${head.n}-${i}`,
          latex: latex.slice(0, 2000),
          bbox: normalizeBBox(head.head, region),
          local: { kind: headAnalyses[i]?.kind ?? "unknown", verdict: headAnalyses[i]?.verdict ?? "none" },
        }))
      : [];
    const lines: CheckLine[] = heads.concat(states.slice(-(LIVE_LIMITS.maxLinesPerCheck - heads.length)).map((s) => ({
      id: s.line.id,
      latex: s.latex.slice(0, 2000),
      bbox: normalizeBBox(s.line.bounds, region),
      local: {
        kind: s.analysis?.kind ?? "unknown",
        verdict: s.analysis?.verdict ?? "unknown",
        resultLatex: s.analysis?.resultLatex?.slice(0, 500) || undefined,
        note: s.analysis?.note?.slice(0, 200) || undefined,
      },
    })));
    return { lines, region, states };
  }

  private startCheck(column: number, focusLineId: string, opts: CheckOpts): void {
    const mode = this.opts.mode;
    if (mode === "off" || !this.opts.enabled) return;
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
            this.applyAnnotation(ev.data, focusLineId);
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

  /**
   * A model's comment on a line becomes a MARK, never words on the board: a mistake rings the
   * line (the words stay on its echo, which shows on hover), and in Suggest / Solve the tutor
   * then writes the right next step by hand once the student has stopped. Praise changes
   * nothing — a tick is only ever what the engine verified.
   */
  private applyAnnotation(a: Annotation, focusLineId: string): void {
    const lineId = a.lineId ?? focusLineId;
    const state = liveStore.lines.get()[lineId];
    if (!state) return;
    const rt = this.runtime(lineId);
    if (a.verdict === "warn" && state.analysis?.verdict === "ok") return;
    if (a.expected && this.engine && this.engine.verifyExpected(a.expected, state.latex) === "equal") return;
    if (a.kind === "praise" || a.kind === "notation") return;
    if (a.verdict !== "warn") return;
    rt.shownHintTexts.add(a.message);
    this.setEchoNote(lineId, a.message, "warn");
    this.syncMark(state, "circle");
    this.suggestNextStep(lineId);
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
      const warned = status === "warn" ? st.latex : metaString(shape.meta, AI_WARN_META);
      this.editor.updateShapes([
        {
          id: shape.id,
          type: "math",
          props,
          meta: { ...shape.meta, [AI_NOTE_META]: Boolean(note), [AI_WARN_META]: warned },
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
    const viewport = this.placementBounds();
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
  private hasHandSolution(lineId: string, latex: string): boolean {
    return this.editor
      .getCurrentPageShapes()
      .some((s) => isLiveMeta(s.meta) && s.meta.lineId === lineId && metaString(s.meta, SOLVED_META) === latex);
  }

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
    if (!this.opts.enabled) return;
    const built = this.buildCheckLines(column);
    if (!built) return;
    this.solveBuilt(built, fromLineId, opts);
  }

  /**
   * Solve on a column: the student's work (`startSolve`), or a problem the chat wrote, worked from its
   * own lines (`workProblem`). Returns which path took it: written locally, `nothing` (the local
   * path found nothing left to write), the model's (a stream, a figure or a word problem's setup),
   * or deferred until the network is back.
   */
  private solveBuilt(built: BuiltColumn, fromLineId: string | undefined, opts: SolveOpts): "local" | "nothing" | "model" | "deferred" {
    // Everything the engine can answer is written locally — by hand where the hand can draw it,
    // typeset where it cannot — and never asked of a model. `localSolve` makes that decision;
    // it is the same function the maths scoreboard (src/__eval__) measures.
    const local = this.writeLocal(built, opts);
    // A graph is part of the answer: sketched beside the steps once they are written, or on its
    // own — `y = 2x + 1` has no steps, its graph IS the answer, and no model is asked for one.
    const graphed = this.solveGraph(opts, local, built);
    if (local || graphed) return local && local.steps.length === 0 && !graphed ? "nothing" : "local";
    if (!this.deps.isOnline()) {
      this.deferLlm("solve", opts.lineId);
      return "deferred";
    }
    // A problem the chat wrote is maths the engine verified: no figure to read, no words to set up.
    if (opts.problem) {
      this.openSolveStream(built, fromLineId, opts);
      return "model";
    }
    // A drawing beside the work (`x = ?` next to a triangle): the tutor reads the figure, and only
    // when that gives nothing do the paths below get their turn.
    const figure = this.figureBeside(built);
    if (figure) {
      this.startFigure(figure, opts, { built, fromLineId });
      return "model";
    }
    this.solveWithoutFigure(built, fromLineId, opts);
    return "model";
  }

  /**
   * A word problem: a model sets it up, the engine solves the setup (`startSetup`); the worked
   * solution from the solve model is only the fallback.
   */
  private solveWithoutFigure(built: BuiltColumn, fromLineId: string | undefined, opts: SolveOpts): void {
    if (this.wordProblemLines(built, opts)) {
      this.startSetup(built, fromLineId, opts);
      return;
    }
    this.openSolveStream(built, fromLineId, opts);
  }

  // ---------------------------------------------------------------- the tutor reads the figure
  /** The drawing the student touched last, when their last ink was a drawing and not a line. */
  private touchedDiagram(): Diagram | null {
    return this.lastTouchedDiagramId ? (this.diagrams.find((d) => d.id === this.lastTouchedDiagramId) ?? null) : null;
  }

  /** The drawing beside a column of work, if one is near enough to be what it is about. */
  private figureBeside(built: { states: LiveLineState[] }): Diagram | null {
    if (this.diagrams.length === 0 || built.states.length === 0) return null;
    const column = unionRects(built.states.map((s) => s.line.bounds));
    return diagramNear(this.diagrams, column, Math.max(FIGURE_REACH_PX, FIGURE_REACH_GLYPHS * this.glyph));
  }

  /**
   * A drawing's labels as the recognizer reads them — ONE call for all of them, stacked one per
   * row (`labelStack`: side by side, `3` and `4` came back as `34`) — cached per label ink, so a
   * drawing is read again only when its labels change. [] when it has none, offline, or on failure.
   */
  private readLabels(diagram: Diagram): Promise<string[]> {
    if (diagram.labels.length === 0) return Promise.resolve([]);
    const stack = labelStack(diagram, this.collectInk(), this.glyph);
    const payload = stack ? buildPayload(stack.line, stack.strokes) : null;
    if (!payload) return Promise.resolve([]);
    return hashPayload(payload).then((hash) => {
      const known = this.labelReads.get(hash);
      if (known) {
        this.labelsOf.set(diagram.id, known);
        return known;
      }
      const pending = this.labelReading.get(hash);
      if (pending) return pending;
      const cached = Boolean(this.deps.recognizer.peek(hash));
      if (!this.deps.isOnline() && !cached) return [];
      const req: RecognizeRequest = { boardId: this.opts.boardId, lineId: diagram.id, strokes: { x: payload.x, y: payload.y }, bounds: { w: payload.w, h: payload.h } };
      const work = this.deps.recognizer
        .recognize(req, hash)
        .then((res) => {
          const rows = parseLabelRead(res.latex);
          this.labelReads.set(hash, rows);
          while (this.labelReads.size > LIVE_LIMITS.cacheEntries) this.labelReads.delete(this.labelReads.keys().next().value as string);
          this.labelsOf.set(diagram.id, rows);
          recordRecognition({ lineId: diagram.id, at: this.deps.now(), sent: { ...req.strokes, ...req.bounds }, cached, response: res });
          clientMetric("live.figure.labels", { diagramId: diagram.id, labels: diagram.labels.length, rows: rows.length, cached });
          if (this.started) this.publishDiagrams();
          // a proof beside this figure can now read it from its ink: its figure rows may earn their ticks
          if (this.started) this.proofs.sync();
          return rows;
        })
        .catch(() => [] as string[])
        .finally(() => this.labelReading.delete(hash));
      this.labelReading.set(hash, work);
      return work;
    });
  }

  /**
   * Solve / Help on a drawing, or on a line beside one — or, in Solve, a figure the student labelled
   * with an unknown and left (`solveWantedFigures`, `unasked`). A crop of the drawing and its labels
   * goes to `/api/live/setup` (a vision model; 2 ink, like a word problem), which reads the
   * figure as FACTS — which label is which angle or side, and what the drawing shows — and turns
   * them into equations (`planFigure`: `x + 40 + 65 = 180`, `2x + 10 = 70`); when its read does not
   * hold up, the model's own setup lines come instead. The board keeps nothing it cannot check
   * (`figureAnswer`): the planner's equations must solve, in the engine, to the planner's own value;
   * the model's lines must solve to a sensible size (positive; an angle under a full turn).
   * Otherwise nothing is written. The block goes under the work when asked from a line, beside the
   * figure otherwise.
   *
   * One model call per figure-and-labels version (`figureKey`): the reply is kept
   * (`figureReplies`), so asking again, or the unasked path at the next settle, costs nothing. From
   * a line, a figure that gives nothing falls back to the word problem / solve paths; asked on the
   * drawing, the pill says it could not work it out, with Retry. Unasked, every failure is silent.
   */
  private startFigure(diagram: Diagram, opts: SolveOpts, from?: { built: BuiltColumn; fromLineId: string | undefined }, unasked = false): void {
    const engine = this.engine;
    if (!this.opts.enabled) return;
    if (!engine || liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) {
      if (from) this.solveWithoutFigure(from.built, from.fromLineId, opts);
      return;
    }
    if (!this.deps.isOnline()) {
      if (from) this.deferLlm("solve", opts.lineId);
      return;
    }
    const rt = this.runtime(opts.lineId);
    // the unasked path never interrupts a solve of this figure already under way
    if (unasked && rt.solveAbort) return;
    rt.solveAbort?.abort();
    const ctrl = new AbortController();
    rt.solveAbort = ctrl;
    const errCtx = { kind: "solve" as const, lineId: opts.lineId, userAsked: true };
    const retry: RetryContext = from ? { kind: "solve", lineId: opts.lineId, fromLineId: from.fromLineId, opts } : { kind: "figure", diagramId: diagram.id, opts };
    const startedAt = this.deps.now();
    liveStore.status.set("checking");
    liveStore.solving.set(liveStore.solving.get() + 1);
    void (async () => {
      /** written: on the page; fallback: nothing usable; stop: nothing more to do */
      let outcome: "written" | "fallback" | "stop" = "fallback";
      let reason = "";
      let source = "";
      let key = "";
      let called = false;
      try {
        const labels = await this.readLabels(diagram);
        const column = from ? from.built.states.map((s) => s.latex) : [];
        key = figureKey(diagram, labels, column);
        // this figure, with these labels and beside this work, already worked out on the page: free
        const solved = !opts.onlyFirstStep && this.hasHandSolution(opts.lineId, key);
        if (solved || ctrl.signal.aborted || !this.started) outcome = "stop";
        // unasked: an answer the student rubbed out, a version already asked about and failed, or one in flight
        else if (unasked && (this.dismissedFigures.has(key) || this.figureReplies.get(key) === null || this.figuresInFlight.has(key))) outcome = "stop";
        else {
          let res = this.figureReplies.get(key) ?? null;
          if (!res) {
            const crop = await this.captureCrop([...diagram.strokeIds, ...diagram.labels.flat()], diagram.bounds, FIGURE_CROP_WIDTH);
            if (ctrl.signal.aborted || !this.started) outcome = "stop";
            else if (!crop) reason = "no crop";
            else {
              this.figuresInFlight.add(key);
              called = true;
              try {
                res = await this.deps.setup({ boardId: this.opts.boardId, lines: column, labels, crop }, { signal: ctrl.signal });
                this.rememberFigureReply(key, res);
              } catch (err) {
                // a call that reached the model and failed is not repeated unasked; a dropped connection may be
                if (!(ctrl.signal.aborted || isAbortLike(err) || this.isNetworkFailure(err))) this.rememberFigureReply(key, null);
                throw err;
              } finally {
                this.figuresInFlight.delete(key);
              }
            }
          }
          if (res && outcome !== "stop") {
            if (ctrl.signal.aborted || !this.started) outcome = "stop";
            else {
              const answer = figureAnswer(engine, res, [...labels, ...column]);
              source = answer.source;
              if (!answer.ok) reason = answer.reason;
              // the student started again while it was being read: the reply waits for the next stop
              else if (unasked && !this.unaskedFigureWelcome(diagram)) outcome = "stop";
              else {
                this.writeFigureSolution(diagram, from?.built ?? null, opts, answer.block, key);
                if (!unasked) this.undismissFigure(key);
                outcome = "written";
              }
            }
          }
        }
      } catch (err) {
        if (ctrl.signal.aborted || isAbortLike(err)) {
          outcome = "stop";
        } else if (this.isNetworkFailure(err)) {
          outcome = "stop";
          if (from) this.deferLlm("solve", opts.lineId);
        } else if (isApiError(err) && (err.code === "unauthorized" || isOutOfInk(err) || err.code === "rate_limited")) {
          outcome = "stop";
          // nothing the student asked for: no pill
          if (!unasked) this.fail(err, errCtx, retry);
        } else {
          reason = "failed";
          console.warn("[live] reading the figure failed", err);
        }
      } finally {
        if (rt.solveAbort === ctrl) rt.solveAbort = null;
        liveStore.solving.set(Math.max(0, liveStore.solving.get() - 1));
      }
      clientMetric("live.figure", { outcome, reason, source, called, unasked, ms: this.deps.now() - startedAt, lineId: opts.lineId, kinds: diagram.kinds.join(","), fromLine: Boolean(from) });
      if (outcome === "fallback" && !ctrl.signal.aborted && this.started && !unasked) {
        if (from) {
          this.solveWithoutFigure(from.built, from.fromLineId, opts);
          return;
        }
        this.fail(sseFailure({ error: "unusable_steps", message: UNUSABLE_SOLUTION }), errCtx, retry);
      }
      if (outcome === "written") this.noteSuccess("solve", opts.lineId);
      if (liveStore.status.get() !== "offline") liveStore.status.set("idle");
    })();
  }

  /** A figure's reply, kept per figure-and-labels version (null: the call failed). */
  private rememberFigureReply(key: string, res: SetupResponse | null): void {
    this.figureReplies.set(key, res);
    while (this.figureReplies.size > LIVE_LIMITS.cacheEntries) this.figureReplies.delete(this.figureReplies.keys().next().value as string);
  }

  /**
   * The figure's setup and the engine's steps (`figureAnswer`'s block) as one block in the tutor's
   * hand: under the work when asked from a line, beside the figure otherwise; typeset where the hand
   * lacks a glyph or is off. Help in Feedback / Suggest writes the first line only. Replaces the last
   * answer for the same work.
   */
  private writeFigureSolution(diagram: Diagram, built: BuiltColumn | null, opts: SolveOpts, block: readonly string[], key: string): void {
    const lines = opts.onlyFirstStep ? block.slice(0, 1) : [...block];
    const meta = opts.onlyFirstStep ? undefined : { [SOLVED_META]: key };
    const hand = this.deps.handwritingEnabled();
    if (built) {
      const state = liveStore.lines.get()[opts.lineId] ?? built.states[built.states.length - 1];
      this.clearSolveOutput(built.states.map((s) => s.line.id));
      if (hand && state && this.drawStepsByHand(built, opts, state, lines, meta)) return;
      const lastLine = built.states[built.states.length - 1].line.bounds;
      const column = unionRects(built.states.map((s) => s.line.bounds));
      lines.forEach((step, i) => this.placeSolutionStep(column, lastLine, i + 1, step, "", opts.lineId, meta));
      return;
    }
    this.clearSolveOutput([diagram.id]);
    if (hand && this.drawBesideFigure(diagram, lines, meta)) return;
    lines.forEach((step, i) => this.placeSolutionStep(diagram.bounds, diagram.bounds, i + 1, step, "", diagram.id, meta));
  }

  // ---------------------------------------------------------------- figures worked out unasked
  /**
   * Solve, and the student has stopped (the settle, as for graphs): a figure with an unknown among
   * its labels (`x`, `?`, `2x + 10`, `θ`) and nothing written beside it is worked out beside it
   * without being asked. Guards: Solve only (Feedback / Suggest only on Help); a drawing, not axes
   * or a number line (those are graphs); no line of writing within reach of it (`x = ?` beside it is
   * asked for with Solve); no Given / Prove on the screen (a proof); not while the tutor's hand is
   * busy (it comes after); once per figure-and-labels version — the reply is kept, and a version
   * whose call failed is not tried again unasked — and never again after the student rubs the answer
   * out (`dismissedFigures`, kept in the page's meta so a reload agrees). Asking brings it back.
   */
  private solveWantedFigures(): void {
    if (!this.unaskedFiguresOn() || this.writer || this.graphWriter || !this.deps.isOnline()) return;
    if (this.proofOnScreen()) return;
    for (const d of this.diagrams) {
      if (!this.figureWanted(d)) continue;
      void this.readLabels(d).then((labels) => this.maybeSolveFigure(d, labels));
    }
  }

  private unaskedFiguresOn(): boolean {
    return this.started && this.opts.enabled && this.opts.mode === "answer" && this.settled && this.engine !== null;
  }

  /** A drawing the unasked path may look at: labelled, a figure (not a graph's axes), not being solved, nothing written beside it. */
  private figureWanted(d: Diagram): boolean {
    if (d.labels.length === 0 || d.kinds.includes("axes") || d.kinds.includes("numberLine")) return false;
    return !this.runtime(d.id).solveAbort && this.nothingBeside(d);
  }

  /** No line of writing within reach of the drawing (`x = ?` beside it is a question for Solve). */
  private nothingBeside(d: Diagram): boolean {
    const reach = Math.max(FIGURE_REACH_PX, FIGURE_REACH_GLYPHS * this.glyph);
    return !Object.values(liveStore.lines.get()).some((st) => diagramNear([d], st.line.bounds, reach) !== null);
  }

  /** Still Solve, still stopped, the tutor's hand free: an unasked figure answer may be written now. */
  private unaskedFigureWelcome(d: Diagram): boolean {
    return this.unaskedFiguresOn() && !this.writer && !this.graphWriter && this.diagrams.some((x) => x.id === d.id) && this.nothingBeside(d) && !this.proofOnScreen();
  }

  /** A line on this screen that reads like a proof's (`Given`, `Prove`): its figure is the proof's. */
  private proofOnScreen(): boolean {
    return Object.values(liveStore.lines.get()).some((st) => /\b(given|prove|proof)\b/i.test(st.latex));
  }

  private maybeSolveFigure(d: Diagram, labels: readonly string[]): void {
    if (!this.unaskedFiguresOn()) return;
    const current = this.diagrams.find((x) => x.id === d.id);
    // it changed while its labels were being read: the next stop looks again
    const inkOf = (x: Diagram) => [...x.strokeIds, ...x.labels.flat()];
    if (!current || !sameStrokeSet(inkOf(current), inkOf(d))) return;
    if (!labels.some(looksLikeUnknown) || labels.some((l) => /\b(given|prove)\b/i.test(l))) return;
    const key = figureKey(d, labels, []);
    if (this.dismissedFigures.has(key) || this.figureReplies.get(key) === null || this.figuresInFlight.has(key)) return;
    if (this.hasHandSolution(d.id, key)) return;
    // an answer about this drawing as it was (its strokes or labels have changed since) is stale
    const stale = this.editor.getCurrentPageShapes().some((s) => isLiveMeta(s.meta) && s.meta.lineId === d.id && metaString(s.meta, SOLVED_META) !== "" && metaString(s.meta, SOLVED_META) !== key);
    if (stale) this.clearSolveOutput([d.id]);
    this.startFigure(d, { lineId: d.id }, undefined, true);
  }

  /** The student rubbed out (part of) the tutor's answer about a figure: not written again unasked, also after a reload. */
  private dismissFigure(key: string): void {
    if (this.dismissedFigures.has(key)) return;
    this.dismissedFigures.add(key);
    this.saveFigureDismissals();
  }

  /** Asked for again: the answer may come back unasked too. */
  private undismissFigure(key: string): void {
    if (this.dismissedFigures.delete(key)) this.saveFigureDismissals();
  }

  private loadFigureDismissals(): void {
    const meta = this.editor.getCurrentPage?.()?.meta as Record<string, unknown> | undefined;
    const list = meta?.[FIGURES_DISMISSED_META];
    if (Array.isArray(list)) for (const k of list) if (typeof k === "string") this.dismissedFigures.add(k);
  }

  private saveFigureDismissals(): void {
    const keys = [...this.dismissedFigures].slice(-MAX_FIGURE_DISMISSALS);
    // the screen they belong to, even if the student has moved on by the time this lands
    const pageId = this.editor.getCurrentPage?.()?.id;
    this.write(() => {
      const page = pageId ? (this.editor.store.get(pageId) as TLPage | undefined) : undefined;
      if (!page) return;
      this.editor.store.put([{ ...page, meta: { ...page.meta, [FIGURES_DISMISSED_META]: keys } }]);
    });
  }

  /**
   * Lays `steps` out beside the figure (right of it, level with its top; under it when the screen
   * has no room to the right) and starts the reveal. False when the hand cannot draw every step.
   */
  private drawBesideFigure(diagram: Diagram, steps: readonly string[], extraMeta?: JsonObject): boolean {
    const size = handSizeFor(3 * this.glyph);
    const { plan, unsupported } = planHandwriting(steps, { size, seed: handSeedFor(diagram.id) });
    if (!plan || unsupported.length > 0) return false;
    const b = diagram.bounds;
    const screen = this.placementBounds();
    let candidate: Rect = { x: rectMaxX(b) + PLACEMENT.sideGap, y: b.y, w: plan.bounds.w, h: plan.bounds.h };
    if (rectMaxX(candidate) > rectMaxX(screen) - PLACEMENT.viewportMargin) {
      candidate = keepInsideX({ x: b.x, y: rectMaxY(b) + PLACEMENT.stepGap, w: plan.bounds.w, h: plan.bounds.h }, screen);
    }
    const avoid = this.avoidRects(diagram.id);
    avoid.push(b);
    const slot = findFreeSlot(candidate, avoid, b, "below");
    this.startHandwriting(placeHandPlan(plan, { x: slot.x, y: slot.y }), diagram.id, extraMeta);
    clientMetric("live.figure.hand", { diagramId: diagram.id, lines: steps.length });
    return true;
  }

  /**
   * Solve's graph for this work: the column's maths plus the solution just written (so an
   * inequality's answer `x > 4` gets its number line), drawn after the steps, beside them.
   */
  private solveGraph(opts: SolveOpts, local: LocalWritten | null, built?: BuiltColumn): boolean {
    if (opts.onlyFirstStep || !this.engine?.graphFor) return false;
    if (opts.problem) return built ? this.problemGraph(built, opts, opts.problem, local) : false;
    const target = liveStore.lines.get()[opts.lineId];
    if (!target) return false;
    const column = target.line.column;
    const { states, lines } = this.columnGraphLines(column);
    const intent = this.graphIntentFor(local ? [...states.map((s) => s.latex), ...local.steps] : lines);
    if (!intent) return false;
    return this.syncGraph(column, {
      asked: true,
      intent,
      anchorLineId: opts.lineId,
      reserve: local?.block ?? undefined,
      delayMs: local?.block ? local.wallMs + 300 : 0,
    });
  }

  /**
   * The problem's lines — the column down to the asked-for line — when they are a word problem
   * (a line of prose that reads like a sentence), else null.
   */
  private wordProblemLines(built: { states: LiveLineState[] }, opts: SolveOpts): string[] | null {
    const idx = built.states.findIndex((s) => s.line.id === opts.lineId);
    const upto = idx === -1 ? built.states : built.states.slice(0, idx + 1);
    return upto.some((s) => isProblemProse(s)) ? upto.map((s) => s.latex) : null;
  }

  /**
   * Solve on a word problem: `/api/live/setup` writes the equations (LaTeX only), the local
   * engine solves them (`localSolve`), and the tutor writes the setup followed by the engine's
   * steps as ONE block under the problem — by hand, typeset where the hand lacks a glyph. A setup
   * that fails, does not validate (`validateSetupLines`) or that the engine cannot solve falls
   * back to the worked solution from `/api/live/solve`. A problem already worked out on the page
   * (`meta.solvedLatex` is the problem itself) costs nothing the second time.
   */
  private startSetup(built: BuiltColumn, fromLineId: string | undefined, opts: SolveOpts): void {
    const engine = this.engine;
    const problem = this.wordProblemLines(built, opts) ?? built.states.map((s) => s.latex);
    const key = wordProblemKey(problem);
    if (!opts.onlyFirstStep && this.hasHandSolution(opts.lineId, key)) return;
    // Nothing to check the setup with, or no room to write it: the worked solution, as before.
    if (!engine || liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) {
      this.openSolveStream(built, fromLineId, opts);
      return;
    }
    const rt = this.runtime(opts.lineId);
    rt.solveAbort?.abort();
    const ctrl = new AbortController();
    rt.solveAbort = ctrl;
    const errCtx = { kind: "solve" as const, lineId: opts.lineId, userAsked: true };
    const retry: RetryContext = { kind: "solve", lineId: opts.lineId, fromLineId, opts };
    const startedAt = this.deps.now();
    liveStore.status.set("checking");
    liveStore.solving.set(liveStore.solving.get() + 1);
    void (async () => {
      /** written: the block is on the page; fallback: ask the solve model; stop: nothing more */
      let outcome: "written" | "fallback" | "stop" = "fallback";
      let reason = "";
      try {
        const res = await this.deps.setup({ boardId: this.opts.boardId, lines: problem }, { signal: ctrl.signal });
        if (ctrl.signal.aborted || !this.started) {
          outcome = "stop";
        } else {
          const setup = validateSetupLines(engine, res.lines, problem);
          if (!setup) reason = "invalid";
          else if (this.writeSetupSolution(engine, built, opts, setup, key, res.sketch)) outcome = "written";
          else reason = "unsolved";
        }
      } catch (err) {
        if (ctrl.signal.aborted || isAbortLike(err)) {
          outcome = "stop";
        } else if (this.isNetworkFailure(err)) {
          // the same deferral as a solve that could not reach the network
          outcome = "stop";
          this.deferLlm("solve", opts.lineId);
        } else if (isApiError(err) && (err.code === "unauthorized" || isOutOfInk(err) || err.code === "rate_limited")) {
          // not the setup's fault: the solve route would say exactly the same
          outcome = "stop";
          this.fail(err, errCtx, retry);
        } else {
          reason = "failed";
          console.warn("[live] setup failed; asking for the worked solution", err);
        }
      } finally {
        if (rt.solveAbort === ctrl) rt.solveAbort = null;
        liveStore.solving.set(Math.max(0, liveStore.solving.get() - 1));
      }
      clientMetric("live.setup", { outcome, reason, ms: this.deps.now() - startedAt, lineId: opts.lineId });
      if (outcome === "fallback" && !ctrl.signal.aborted && this.started) {
        this.openSolveStream(built, fromLineId, opts);
        return;
      }
      if (outcome === "written") this.noteSuccess("solve", opts.lineId);
      if (liveStore.status.get() !== "offline") liveStore.status.set("idle");
    })();
  }

  /**
   * Solves a validated setup with the local engine and writes setup + steps as one block.
   * False when the engine cannot solve it (nothing is written; the caller falls back).
   */
  private writeSetupSolution(engine: LiveEngine, built: { states: LiveLineState[] }, opts: SolveOpts, setup: string[], key: string, sketch?: FigureSpec): boolean {
    const state = liveStore.lines.get()[opts.lineId] ?? built.states[built.states.length - 1];
    if (!state) return false;
    const hand = this.deps.handwritingEnabled();
    // Every local path may answer here, `solveLatex` included whatever the hand can draw: the block
    // is written by hand when it can be and typeset when it cannot (`drawStepsByHand` decides),
    // but an answer the engine has is never traded for a model's.
    const solved = localSolve(engine, setup, undefined, { handwriting: true });
    if (!solved.source) return false;
    const block = setupBlock(setup, solved.steps, opts.onlyFirstStep);
    // A new solution replaces the last one for this work; it never stacks beside it.
    this.clearSolveOutput(built.states.map((s) => s.line.id));
    const meta = opts.onlyFirstStep ? undefined : { [SOLVED_META]: key };
    const written = hand ? this.drawStepsByHand(built, opts, state, block, meta) : null;
    if (written) {
      clientMetric("live.setup.hand", { lineId: opts.lineId, source: solved.source, lines: block.length });
    } else {
      const lastLine = built.states[built.states.length - 1].line.bounds;
      const column = unionRects(built.states.map((s) => s.line.bounds));
      block.forEach((step, i) => this.placeSolutionStep(column, lastLine, i + 1, step, "", opts.lineId, meta));
      clientMetric("live.setup.typeset", { lineId: opts.lineId, source: solved.source, lines: block.length });
    }
    // the picture the problem describes, beside the work: only with the whole solution, not a hint
    if (sketch && !opts.onlyFirstStep) this.drawSketch(sketch, built, opts, written, meta);
    return true;
  }

  /**
   * A word problem's sketch (the setup route's `sketch`: a figure `checkFigure` passed) in the
   * tutor's hand, placed as a graph is — beside the work, else under it and its working — and
   * drawn once the working is written. It carries the solution's key, so a new solution replaces
   * it with the working. False when the hand is off or there is no room.
   */
  private drawSketch(sketch: FigureSpec, built: { states: LiveLineState[] }, opts: SolveOpts, written: { rect: Rect; wallMs: number } | null, meta: JsonObject | undefined): boolean {
    if (!this.deps.handwritingEnabled()) return false;
    const column = unionRects(built.states.map((s) => s.line.bounds));
    const under = written ? unionRects([column, written.rect]) : column;
    const avoid: Rect[] = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      const b = this.editor.getShapePageBounds(s);
      if (b) avoid.push(boxToRect(b));
    }
    if (written) avoid.push(written.rect);
    const bounds = this.placementBounds();
    const seed = handSeedFor(`sketch:${opts.lineId}`);
    for (const box of [GRAPH.box, ...GRAPH.fallbackBoxes]) {
      let res: FigurePlanResult | null = null;
      try {
        res = this.deps.planFigure(sketch, { seed, box });
      } catch {
        res = null;
      }
      if (!res) return false;
      const slot = placeGraphBlock({ w: res.plan.bounds.w, h: res.plan.bounds.h }, { column, under, bounds, avoid });
      if (!slot) continue;
      this.startSketchWriter(placeHandPlan(res.plan, { x: slot.x, y: slot.y }), opts.lineId, written ? written.wallMs + 300 : 0, meta);
      clientMetric("live.setup.sketch", { lineId: opts.lineId });
      return true;
    }
    clientMetric("live.setup.sketch.noRoom", { lineId: opts.lineId });
    return false;
  }

  private startSketchWriter(plan: HandPlan, lineId: string, delayMs: number, extraMeta: JsonObject | undefined): void {
    const prev = this.sketchWriter;
    this.sketchWriter = null;
    prev?.cancel();
    const writer = this.makeWriter();
    this.sketchWriter = writer;
    writer.start(plan, {
      meta: makeMeta("ai", lineId, this.deps.now()),
      ...(extraMeta ? { extraMeta } : {}),
      delayMs,
      whole: true,
      onDone: () => {
        if (this.sketchWriter === writer) this.sketchWriter = null;
      },
    });
  }

  /** `/api/live/solve`: the model's worked solution, checked step by step, written when the stream ends. */
  private openSolveStream(built: BuiltColumn, fromLineId: string | undefined, opts: SolveOpts): void {
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
    // Every solve is asked for (Solve steps, More help, the board chat).
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
    const restated = new Set(built.states.map((st) => normalizeStep(st.latex)));
    liveStore.status.set("checking");
    liveStore.solving.set(liveStore.solving.get() + 1);
    void (async () => {
      let failed = false;
      let doneEarly = false;
      let drawn = 0;
      let discarded = 0;
      const accepted: string[] = [];
      try {
        for await (const ev of this.deps.stream(SOLVE_PATH, req, { signal: ctrl.signal })) {
          if (ctrl.signal.aborted) break;
          if (ev.event === "step") {
            const latex = unwrapBoxed(ev.data.latex);
            // The student's own line read back to them is not a step, and neither is the step
            // before it again (the model boxes its last line as the answer, often a repeat).
            const norm = normalizeStep(latex);
            if (restated.has(norm)) continue;
            restated.add(norm);
            const verdict = guard.check(latex);
            if (!verdict.ok) {
              discarded++;
              console.warn("[live] solve step discarded", { reason: verdict.reason, introduced: verdict.introduced, latex: ev.data.latex });
              clientMetric("live.solve.step.discarded", { reason: verdict.reason ?? "", lineId: opts.lineId });
              continue;
            }
            drawn++;
            // Collected, then written as ONE handwritten block when the stream ends: the tutor
            // writes a solution, it does not deal out cards. No explanations — maths only.
            accepted.push(latex);
            // (a problem's next step is picked from the whole solution: the first may be written already)
            if (opts.onlyFirstStep && !opts.problem) {
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
        if (accepted.length > 0 && (doneEarly || !ctrl.signal.aborted)) this.writeModelSteps(built, opts, accepted, columnRect, lastLine.bounds);
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
   * The model's verified steps, replacing any earlier solution for this work: in the tutor's
   * hand when every step can be drawn, typeset only when the hand lacks a symbol.
   */
  private writeModelSteps(built: { states: LiveLineState[] }, opts: SolveOpts, steps: string[], column: Rect, lastLine: Rect): void {
    const state = liveStore.lines.get()[opts.lineId] ?? built.states[built.states.length - 1];
    if (opts.problem) {
      // the model's worked solution of a problem the chat wrote: continued after the tutor's own work there
      this.writeProblemLocal(built, opts, opts.problem, state, steps, liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard);
      return;
    }
    this.clearSolveOutput(built.states.map((s) => s.line.id));
    if (this.deps.handwritingEnabled() && state && this.drawStepsByHand(built, opts, state, steps)) return;
    steps.forEach((step, i) => this.placeSolutionStep(column, lastLine, i + 1, step, "", opts.lineId));
  }

  /**
   * Solve's local answer for the asked-for line (`localSolve`: `solveLatex` → `solveFromLines` →
   * `simplifySteps` → `localAnswerFor`), written under the work — by hand, or typeset when the
   * hand is off or lacks a glyph. Returns false only when the engine has nothing, which is the
   * one case the model is asked.
   *
   * What the page adds to the maths: a solution already on the page is not written twice (its
   * key is on the ink, `meta.solvedLatex` — the line itself for `solveLatex`, the steps
   * otherwise; for an answer, its `answerLatex`); a new solution replaces the previous one for
   * this work; at the shape cap nothing is drawn, but a known answer is still never asked of a
   * model.
   */
  private writeLocal(built: { states: LiveLineState[] }, opts: SolveOpts): LocalWritten | null {
    const engine = this.engine;
    if (!engine) return null;
    const asked = liveStore.lines.get()[opts.lineId];
    // Solve asked on an operation line (`\div 2`) solves the equation above it
    const state = asked && !isOperationLine(asked) ? asked : built.states[built.states.length - 1];
    if (!state?.latex) return null;
    const atCap = liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard;
    const hand = this.deps.handwritingEnabled();
    const idx = built.states.findIndex((s) => s.line.id === opts.lineId);
    const local = localSolve(
      engine,
      built.states.map((s) => s.latex),
      idx === -1 ? undefined : idx,
      {
        // `solveLatex` is only ever written by hand: with the hand off (or no room) its line
        // goes to the paths that can also typeset.
        handwriting: hand && !atCap,
        canDraw: (steps) => planHandwriting(steps, { size: handSizeFor(state.line.bounds.h), seed: handSeedFor(opts.lineId) }).unsupported.length === 0,
        // the chat's problem above the work, written with its interval: the work is solved in it
        domain: this.headAnalyses(state.line.column).at(-1)?.domain?.latex,
      },
    );
    if (!local.source) return null;
    if (opts.problem) return this.writeProblemLocal(built, opts, opts.problem, state, local.steps, atCap);
    const steps = opts.onlyFirstStep ? local.steps.slice(0, 1) : local.steps;
    const lastLine = built.states[built.states.length - 1].line.bounds;
    const column = unionRects(built.states.map((s) => s.line.bounds));
    const written = (block: { rect: Rect; wallMs: number } | null = null): LocalWritten => ({ steps, block: block?.rect ?? null, wallMs: block?.wallMs ?? 0 });
    /** where typeset steps land (`placeStep`): kept clear of a graph drawn beside them */
    const typesetBlock = (first: number): { rect: Rect; wallMs: number } => ({
      rect: {
        x: column.x,
        y: rectMaxY(lastLine) + PLACEMENT.stepGap,
        w: Math.max(...steps.map((st) => estimateEchoWidth(st))),
        h: Math.max(1, steps.length + first) * PLACEMENT.stepPitch,
      },
      wallMs: 0,
    });

    if (local.source === "localAnswer" && local.answer) {
      // `36 + 2 =`: the tutor may already have finished it (inline, or Solve pressed twice)
      if (this.answerBlocksFor(opts.lineId).some((s) => answerLatexOf(s.meta) === local.answer)) return written();
      if (atCap) return written();
      const handBlock = hand ? this.drawStepsByHand(built, opts, state, steps, this.answerMeta(state, local.answer)) : null;
      if (handBlock) return written(handBlock);
      this.placeSolutionStep(column, lastLine, 0, steps[0], "", opts.lineId);
      clientMetric("live.solve.local.typeset", { lineId: opts.lineId });
      return written(typesetBlock(0));
    }

    const key = local.source === "solveLatex" ? state.latex : steps.join(" ; ");
    if (!opts.onlyFirstStep && this.hasHandSolution(opts.lineId, key)) return written();
    if (atCap) return written();
    // A new solution replaces the last one for this work; it never stacks beside it.
    this.clearSolveOutput(built.states.map((s) => s.line.id));
    const meta = opts.onlyFirstStep ? undefined : { [SOLVED_META]: key };
    const handBlock = hand ? this.drawStepsByHand(built, opts, state, steps, meta) : null;
    if (handBlock) return written(handBlock);
    steps.forEach((step, i) => this.placeSolutionStep(column, lastLine, i + 1, step, "", opts.lineId));
    clientMetric("live.solve.local.typeset", { lineId: opts.lineId, source: local.source, steps: steps.length });
    return written(typesetBlock(0));
  }

  /**
   * `writeLocal` for one of the chat's problems (`workProblem`): the lines `problemSteps` picks from
   * the engine's solution of it — the next step, or the rest — by hand under the problem, typeset
   * when the hand is off or lacks a glyph, every block marked with its `problemWork` (and a solution
   * with `solvedLatex`, the problem), so nothing is written twice. Nothing left to write is an
   * answer too: `steps` is [] and no model is asked.
   */
  private writeProblemLocal(
    built: { states: LiveLineState[] },
    opts: SolveOpts,
    work: ProblemWork,
    state: LiveLineState,
    solution: readonly string[],
    atCap: boolean,
  ): LocalWritten {
    const steps = this.problemStepsFor(work, solution);
    if (steps.length === 0 || atCap) return { steps, block: null, wallMs: 0 };
    const meta = this.problemMeta(work);
    const hand = this.deps.handwritingEnabled() ? this.drawStepsByHand(built, opts, state, steps, meta) : null;
    if (hand) return { steps, block: hand.rect, wallMs: hand.wallMs };
    const column = unionRects(built.states.map((s) => s.line.bounds));
    steps.forEach((step, i) => this.placeSolutionStep(column, work.below, i + 1, step, "", opts.lineId, meta));
    clientMetric("live.solve.local.typeset", { lineId: opts.lineId, steps: steps.length });
    const w = Math.max(...steps.map((st) => estimateEchoWidth(st)));
    return { steps, block: { x: column.x, y: rectMaxY(work.below) + PLACEMENT.stepGap, w, h: steps.length * PLACEMENT.stepPitch }, wallMs: 0 };
  }

  /**
   * Deletes the tutor's worked output for this work — the lines (or the drawing) with these ids:
   * hand blocks and typeset steps, never echoes, inline answers, marks or graphs.
   */
  private clearSolveOutput(ownerIds: readonly string[]): void {
    const lineIds = new Set(ownerIds);
    const ids = this.editor
      .getCurrentPageShapes()
      .filter(
        (s) =>
          isLiveMeta(s.meta) &&
          s.meta.source === "ai" &&
          lineIds.has(s.meta.lineId) &&
          !answerSrcOf(s.meta) &&
          !metaString(s.meta, MARK_META) &&
          // a graph follows its own key (`syncGraph`), not the solution it was drawn with
          !metaString(s.meta, GRAPH_META),
      )
      .map((s) => s.id);
    if (ids.length > 0) this.write(() => this.editor.deleteShapes(ids));
  }

  /**
   * Lays `steps` out under the student's last line and starts the reveal.
   *
   * Returns null when the hand engine reports ANY `unsupported` construct for the block —
   * the safety interlock: a dropped `\frac` would show the student wrong maths, so the block
   * is never drawn partly. Otherwise where the block is being written, and for how long.
   */
  private drawStepsByHand(
    built: { states: LiveLineState[] },
    opts: SolveOpts,
    state: LiveLineState,
    steps: readonly string[],
    extraMeta?: JsonObject,
  ): { rect: Rect; wallMs: number } | null {
    if (opts.problem) return this.drawProblemWork(built, opts, opts.problem, state, steps, extraMeta);
    const size = handSizeFor(state.line.bounds.h);
    const { plan, unsupported } = planHandwriting(steps, { size, seed: handSeedFor(opts.lineId) });
    if (!plan || unsupported.length > 0) return null;

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
    // Under the work, a blocked block slides down past what is in the way; moved beside the work
    // (no room below on this screen), it slides right as an echo does.
    const placed = keepOnScreen(candidate, this.screenRect(), column);
    const slot = findFreeSlot(placed, avoid, lastLine, placed.x === candidate.x ? "below" : "right");

    const block = placeHandPlan(plan, { x: slot.x, y: slot.y });
    this.startHandwriting(block, opts.lineId, extraMeta);
    clientMetric("live.solve.hand.ms", { ms: Math.round(wallMsOf(plan)), lineId: opts.lineId });
    return { rect: block.bounds, wallMs: this.deps.reducedMotion() ? 0 : wallMsOf(plan) };
  }

  private makeWriter(): HandWriter {
    // A reveal is finished whole when the student switches screens (`switchScreen` cancels it), and
    // by then the new screen is the current page: its last strokes are put on the page it started
    // on, never on the one the student moved to.
    const page = this.editor.getCurrentPage?.()?.id;
    return new HandWriter(
      {
        write: (fn) => this.write(fn),
        createShapes: (shapes) => {
          // ...and when that screen was deleted, nowhere: tldraw would put strokes with a missing
          // parent on the current page — the rest of a step on the next screen (`deleteScreen`)
          if (page && !this.editor.store.get(page)) return;
          this.editor.createShapes(page ? shapes.map((sh) => (sh.parentId ? sh : { ...sh, parentId: page })) : shapes);
        },
        updateShapes: (shapes) => this.editor.updateShapes(shapes),
        getShape: (id) => this.editor.getShape(id),
      },
      {
        now: this.deps.now,
        reducedMotion: this.deps.reducedMotion,
      },
    );
  }

  /**
   * Puts the tutor's mark for this line on the page (tick, ring, question mark) or takes it
   * off. Redrawn only when the kind or the line's place changes; one already on the page with
   * the same key (after a reload) is kept, not written again. A question mark says why
   * (`meta.markWhy`: `unread`, write it again more clearly; `unjudged`, there is nothing in it to
   * check), for the first coach mark of the onboarding.
   *
   * A mark left on this very ink under a line id that is gone is replaced, not doubled: a line with
   * no echo (a lone `2`) is not rebuilt on a reload, and comes back with a new id when it is read.
   */
  private syncMark(state: LiveLineState, kind: MarkKind | null, why?: UnjudgedReason): void {
    const lineId = state.line.id;
    const rt = this.runtime(lineId);
    const want = kind && this.deps.handwritingEnabled() ? markKey(kind, state.line.bounds) : null;
    if (rt.markKey === want) return;
    rt.markKey = want;
    rt.markWriter?.cancel();
    rt.markWriter = null;
    rt.markBusySince = this.deps.now();
    this.write(() => {
      if (this.runtime(lineId).markKey !== want) return; // superseded before it ran
      const lines = liveStore.lines.get();
      const place = want ? want.slice(want.indexOf(":")) : null;
      const marks: TLShape[] = [];
      const orphans: TLShapeId[] = [];
      for (const s of this.editor.getCurrentPageShapes()) {
        const key = isLiveMeta(s.meta) ? metaString(s.meta, MARK_META) : "";
        if (!key || !isLiveMeta(s.meta)) continue;
        if (s.meta.lineId === lineId) marks.push(s);
        else if (place && !lines[s.meta.lineId] && key.slice(key.indexOf(":")) === place) orphans.push(s.id);
      }
      const stale = [...marks.filter((s) => metaString(s.meta, MARK_META) !== want).map((s) => s.id), ...orphans];
      if (stale.length > 0) this.editor.deleteShapes(stale);
      // nothing to write leaves the pen free for this line at once; a writer frees it when it ends
      if (!want || !kind || marks.some((s) => metaString(s.meta, MARK_META) === want)) return this.markDone(lineId, null);
      const plan = planFromStrokes(kind, markStrokes(kind, state.line.bounds, handSeedFor(`${lineId}:${want}`)), HAND_WRITE.minSize);
      if (!plan) return this.markDone(lineId, null);
      const writer = this.makeWriter();
      this.runtime(lineId).markWriter = writer;
      const extraMeta: JsonObject = { [MARK_META]: want };
      if (kind === "question") extraMeta[MARK_WHY_META] = why ?? "unread";
      writer.start(plan, { meta: makeMeta("ai", lineId, this.deps.now()), extraMeta, onDone: () => this.markDone(lineId, writer) });
    });
  }

  /**
   * Waits for the tutor's pen to lift from this line's mark when a change of it is under way, then
   * runs `fn` — one pen at a time: the step written beside a ring comes after the ring (raising the
   * dial from Off used to draw both at once). True when `fn` was queued.
   */
  private afterMark(lineId: string, fn: () => void): boolean {
    const rt = this.rt.get(lineId);
    // a write that never finished (it threw) holds nothing up for longer than a mark takes
    if (!rt?.markBusySince || this.deps.now() - rt.markBusySince > MARK_BUSY_MAX_MS) return false;
    (rt.afterMark ??= []).push(fn);
    return true;
  }

  /** This line's mark is written, or none was wanted: what waited for it goes now. */
  private markDone(lineId: string, writer: HandWriter | null): void {
    const rt = this.rt.get(lineId);
    // a newer mark took over (it cancelled this writer): its own end releases the line
    if (!rt || (writer && rt.markWriter !== writer)) return;
    rt.markBusySince = 0;
    const next = rt.afterMark?.splice(0) ?? [];
    if (next.length > 0) queueMicrotask(() => next.forEach((fn) => this.started && fn()));
  }

  private startHandwriting(plan: HandPlan, lineId: string, extraMeta?: JsonObject): void {
    this.cancelHandwriting();
    const meta = makeMeta("ai", lineId, this.deps.now());
    const writer = this.makeWriter();
    this.writer = writer;
    this.writerFor = lineId;
    writer.start(plan, {
      meta,
      extraMeta,
      onDone: () => {
        if (this.writer === writer) {
          this.writer = null;
          this.writerFor = null;
        }
        // a figure waiting for the hand to be free is written after it
        if (this.settled && this.writer === null) this.solveWantedFigures();
      },
    });
  }

  /** Ends any reveal in flight, completing the lines it had started. Never leaves half a step. */
  private cancelHandwriting(): void {
    const writer = this.writer;
    this.writer = null;
    this.writerFor = null;
    writer?.cancel();
    // a sketch under way is completed whole; one still waiting for its steps is not drawn
    const graph = this.graphWriter;
    this.graphWriter = null;
    graph?.cancel();
    const sketch = this.sketchWriter;
    this.sketchWriter = null;
    sketch?.cancel();
  }

  /** fetch rejects with a TypeError when the network is unreachable. */
  private isNetworkFailure(err: unknown): boolean {
    return err instanceof TypeError || !this.deps.isOnline();
  }

  private placeSolutionStep(column: Rect, lastLine: Rect, index: number, latex: string, explanation: string, lineId: string, extraMeta?: JsonObject): void {
    this.write(() => {
      if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return;
      const rect = keepOnScreen(
        placeStep(column, lastLine, index, latex),
        this.screenRect(),
        column,
        Math.max(0, index - 1) * PLACEMENT.stepPitch,
      );
      const slot = findFreeSlot(rect, this.avoidRects(lineId), lastLine, "below");
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
          meta: { ...makeMeta("ai", lineId, this.deps.now()), ...extraMeta },
        } satisfies TLShapePartial<MathShape>,
      ]);
    });
  }

  // ---------------------------------------------------------------- two-column proofs
  /** What `ProofDesk` needs of the loop (see `src/lib/live/proof/desk.ts`). */
  private proofHost(): ProofHost {
    return {
      lines: () =>
        Object.values(liveStore.lines.get())
          .filter((s) => s.latex && s.confidence >= LIVE_LIMITS.minConfidence)
          .map((s) => ({ id: s.line.id, latex: s.latex, bounds: s.line.bounds })),
      tutorLines: () => this.proofTutorLines(),
      tutorFigures: () => this.proofTutorFigures(),
      diagrams: () => this.diagrams,
      labelReads: (d) => this.labelsOf.get(d.id) ?? null,
      ink: (ids) => {
        const want = new Set<string>(ids);
        return this.collectInk().filter((s) => want.has(s.id));
      },
      glyph: () => this.glyph,
      enabled: () => this.started && this.opts.enabled && this.opts.mode !== "off",
      online: () => this.deps.isOnline(),
      readLabels: (d) => this.readLabels(d),
      crop: (d) => this.captureCrop([...d.strokeIds, ...d.labels.flat()], d.bounds, FIGURE_CROP_WIDTH),
      call: (req, signal) => this.deps.proof(req, { signal }),
      boardId: () => this.opts.boardId,
      rerender: (ids) => this.rerenderLines(ids),
      writeRows: (read, rows, anchor) => this.writeProofRows(read, rows, anchor),
      busy: (on) => {
        if (on) {
          liveStore.status.set("checking");
          liveStore.solving.set(liveStore.solving.get() + 1);
          return;
        }
        liveStore.solving.set(Math.max(0, liveStore.solving.get() - 1));
        if (liveStore.status.get() !== "offline") liveStore.status.set("idle");
      },
      failed: (err, lineId, all) => {
        const errCtx = { kind: "solve" as const, lineId, userAsked: true };
        const retry: RetryContext = { kind: "proof", lineId, all };
        if (err === null) this.fail(sseFailure({ error: "unusable_steps", message: UNUSABLE_SOLUTION }), errCtx, retry);
        else if (!this.isNetworkFailure(err)) this.fail(err, errCtx, retry);
      },
      succeeded: (lineId) => this.noteSuccess("solve", lineId),
      metric: (name, data) => clientMetric(name, data),
    };
  }

  /**
   * A line of a two-column proof renders as the proof checker marks its row: a tick after a verified
   * row's reason, a ring round the wrong half of a provably wrong row, nothing on the rest. Its echo
   * (the read, on hover) stays. False when the line is not in a proof.
   */
  private renderProofLine(state: LiveLineState, opts: { keepStatus?: boolean }): boolean {
    if (!state.latex || state.confidence < LIVE_LIMITS.minConfidence) return false;
    const mark = this.proofs.lineMark(state.line.id);
    if (!mark) return false;
    const keep = Boolean(opts.keepStatus) || this.opts.mode === "off";
    this.upsertEcho(state.line.id, { latex: state.latex, status: keep ? "none" : mark.status, resultLatex: "", note: "" }, { keepStatus: keep });
    if (!keep) this.syncMark(state, mark.kind);
    return true;
  }

  /** Analyses and renders these lines again (no cascade, no model): a proof formed or changed around them. */
  private rerenderLines(ids: readonly string[]): void {
    if (!this.engine) return;
    for (const id of ids) {
      const st = liveStore.lines.get()[id];
      if (!st?.latex) continue;
      setLine(id, { analysis: this.analyze(st) });
      const fresh = liveStore.lines.get()[id];
      if (fresh) this.render(fresh, this.decisionFor(fresh));
    }
  }

  /** The rows the tutor wrote on this screen, as lines of the proof (each stroke carries its line's LaTeX). */
  private proofTutorLines(): BoardLine[] {
    const shapes: Array<{ block: string; latex: string; bounds: Rect }> = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(s.meta) || !metaString(s.meta, PROOF_ROWS_META)) continue;
      const latex = metaString(s.meta, HAND_LINE_META);
      const b = this.editor.getShapePageBounds(s);
      if (latex && b) shapes.push({ block: handBlockOf(s.meta), latex, bounds: boxToRect(b) });
    }
    return tutorLinesOf(shapes);
  }

  /** The figures the tutor drew for a proof on this screen (the board chat's `write_proof`), read from their meta. */
  private proofTutorFigures(): TutorFigure[] {
    const shapes: Array<{ block: string; meta: unknown; bounds: Rect }> = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(s.meta) || !metaString(s.meta, PROOF_FIGURE_META)) continue;
      const b = this.editor.getShapePageBounds(s);
      if (b) shapes.push({ block: handBlockOf(s.meta), meta: s.meta, bounds: boxToRect(b) });
    }
    return tutorFiguresOf(shapes);
  }

  /**
   * Writes proof rows in the tutor's hand under the proof's last row: the statement in the statement
   * column, the reason in the reason column, on one line (`proofRowsPlan`). Moved down a row at a time
   * past anything in the way. False when the hand is off, at the shape cap, or there is no room.
   */
  private writeProofRows(read: ProofRead, rows: readonly PlannedRow[], anchor: string): boolean {
    if (!this.deps.handwritingEnabled() || liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return false;
    const texts = rows.map((r) => ({ statement: r.statement, reasonLatex: r.reasonLatex }));
    const size = handSizeFor(read.lineHeight);
    const seed = handSeedFor(`proof:${anchor}:${read.rows.length}:${texts.map((t) => t.statement).join(";")}`);
    const avoid: Rect[] = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      if (isLiveMeta(s.meta) && (s.meta.source === "echo" || metaString(s.meta, MARK_META))) continue;
      // a row of a T-table crosses the table's rules (the student's, or the tutor's own)
      if (this.tableStrokeIds.has(s.id) || metaString(s.meta, PROOF_TABLE_META)) continue;
      const b = this.editor.getShapePageBounds(s);
      if (b) avoid.push(boxToRect(b));
    }
    for (let shift = 0; shift <= 3; shift++) {
      const plan = proofRowsPlan(read, texts, { size, seed, shift: shift * read.rowPitch });
      if (!plan) return false;
      if (avoid.some((r) => rectsIntersect(r, plan.bounds))) continue;
      this.startHandwriting(plan, anchor, { [PROOF_ROWS_META]: JSON.stringify(texts.map((t) => ({ s: t.statement, r: t.reasonLatex }))) });
      clientMetric("live.proof.hand", { lineId: anchor, rows: rows.length });
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- the board chat
  /** What `ChatDesk` needs of the loop (see `src/lib/live/chat/desk.ts`). */
  private chatHost(): ChatHost {
    return {
      engine: () => this.ensureEngine(),
      shapes: () =>
        this.editor.getCurrentPageShapes().map((s) => {
          const b = this.editor.getShapePageBounds(s);
          return {
            id: s.id,
            type: s.type,
            meta: s.meta,
            bounds: b ? boxToRect(b) : null,
            ...(s.type === "math" ? { latex: (s.props as MathShapeProps).latex } : {}),
          };
        }),
      screen: () => this.placementBounds(),
      pageId: () => this.pageKey(),
      studentLines: () =>
        Object.values(liveStore.lines.get())
          .filter((s) => s.latex)
          .sort((a, b) => a.line.column - b.line.column || a.line.row - b.line.row)
          .map((s) => s.latex),
      handwriting: () => this.deps.handwritingEnabled(),
      handBusy: () => this.writer !== null || this.graphWriter !== null,
      write: (plan, extraMeta, leadMeta) =>
        new Promise<void>((resolve) => {
          const writer = this.makeWriter();
          this.writer = writer;
          this.writerFor = CHAT_LINE_ID;
          // a variable, not a literal: `leadMeta` is a HandWriter option from its next version on
          const options: HandWriteOptions & { leadMeta?: JsonObject } = {
            meta: makeMeta("ai", CHAT_LINE_ID, this.deps.now()),
            extraMeta,
            ...(leadMeta ? { leadMeta } : {}),
            // a problem, a graph or a figure is one thing: a cut-short reveal completes it whole
            whole: true,
            onDone: () => {
              if (this.writer === writer) {
                this.writer = null;
                this.writerFor = null;
              }
              if (leadMeta) this.stampLead(writer, leadMeta);
              // after the write queued with its last strokes (a microtask): then it is on the page
              setTimeout(resolve, 0);
            },
          };
          writer.start(plan, options);
        }),
      typeset: (latex, at, extraMeta) => {
        const rect = { x: at.x, y: at.y, w: estimateEchoWidth(latex), h: ECHO_HEIGHTS.m };
        this.write(() => {
          this.editor.createShapes([
            {
              id: createShapeId(),
              type: "math",
              x: rect.x,
              y: rect.y,
              props: { ...MATH_SHAPE_DEFAULTS, w: rect.w, h: rect.h, latex, source: "ai", tone: "accent", lineId: CHAT_LINE_ID, anchorIds: [] },
              meta: { ...makeMeta("ai", CHAT_LINE_ID, this.deps.now()), ...extraMeta },
            } satisfies TLShapePartial<MathShape>,
          ]);
        });
        return rect;
      },
      addScreen: () => {
        const ed = this.editor as unknown as Partial<ScreensEditor>;
        if (typeof ed.getPages !== "function" || typeof ed.createPage !== "function" || typeof ed.setCurrentPage !== "function" || typeof ed.run !== "function") return false;
        return addScreen(ed as ScreensEditor);
      },
      screenReady: () => !this.started || this.screenSeen === this.pageKey(),
      clearTutor: () => this.clearMarks(),
      problemsChanged: () => this.refreshProblemColumns(),
      helpProblem: (n, depth) => this.chatHelp(n, depth),
      planFigure: (spec, opts) => this.deps.planFigure(spec, opts),
      seed: (key) => handSeedFor(key),
      delay: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      metric: (name, data) => clientMetric(name, data),
      screenMeta: () => this.lecturePageMeta(),
    };
  }

  /**
   * The block's lead meta on its first stroke, when the writer has not put it there itself (a
   * HandWriter without `leadMeta`): queued after the block's last strokes (a writer's shapes get
   * their ids inside its own queued write), so the shape exists.
   */
  private stampLead(writer: HandWriter, leadMeta: JsonObject): void {
    this.write(() => {
      const id = writer.shapeIds[0];
      const shape = id ? this.editor.getShape(id) : undefined;
      if (!shape) return;
      const meta = shape.meta as Record<string, unknown>;
      if (Object.entries(leadMeta).every(([k, v]) => meta[k] === v)) return;
      this.editor.updateShapes([{ id, type: shape.type, meta: { ...shape.meta, ...leadMeta } }]);
    });
  }

  // ---------------------------------------------------------------- lecture mode
  /**
   * What `LectureDesk` needs of the loop: the chat's host (lecture mode writes with the same hand,
   * on the same screens) and the current screen's lecture page meta. Nothing here is gated on the
   * Live switch or the help mode: a lecture is sketched in Off as in Solve, as the chat writes.
   */
  private lectureHost(): LectureHost {
    return {
      ...this.chatHost(),
      screenMeta: (pageId) => this.lecturePageMeta(pageId),
      setScreenMeta: (patch, pageId) => this.setLecturePageMeta(patch, pageId),
      deleteShapes: (ids) =>
        this.write(() => {
          const live = ids.filter((id) => this.editor.getShape(id as TLShapeId)) as TLShapeId[];
          if (live.length > 0) this.editor.deleteShapes(live);
        }),
      now: () => this.deps.now(),
      // what the autosave measures (the snapshot as JSON), once per lecture block: ~10–30 ms at 3 MB
      boardBytes: () => JSON.stringify(this.editor.store.allRecords()).length,
    };
  }

  /** A screen's `LECTURE_PAGE_META` (the current one's by default), with what is waiting to be written merged in. */
  private lecturePageMeta(pageId?: string): LecturePageMeta {
    const page = pageId ? (this.editor.store.get(pageId as TLPage["id"]) as TLPage | undefined) : this.editor.getCurrentPage?.();
    if (!page) return {};
    const saved = readLecturePageMeta(page.meta);
    const pending = this.pendingPageMeta.get(page.id)?.patch;
    return pending ? { ...saved, ...pending } : saved;
  }

  /**
   * Merges into the current screen's `LECTURE_PAGE_META`. A store write like the tutor's ink
   * (`liveWrite`): saved by the autosave (a page is a document record), kept out of the student's
   * undo history. The patch belongs to the screen it was made on, even if it is written later.
   */
  private setLecturePageMeta(patch: Partial<LecturePageMeta>, pageId?: string): void {
    const page = pageId ? (this.editor.store.get(pageId as TLPage["id"]) as TLPage | undefined) : this.editor.getCurrentPage?.();
    if (!page) return;
    const cur = this.pendingPageMeta.get(page.id);
    const next = { patch: { ...cur?.patch, ...patch }, timer: cur?.timer ?? null };
    this.pendingPageMeta.set(page.id, next);
    // only heard text waits for more; a topic, a chart's spec (the next update needs it) go now
    const soon = Object.keys(patch).some((k) => k !== "transcript");
    if (soon && next.timer) {
      clearTimeout(next.timer);
      next.timer = null;
    }
    if (soon) {
      scheduleLiveWrite(this.editor as Editor, () => this.writePageMeta(page.id));
      return;
    }
    if (!next.timer) next.timer = setTimeout(() => this.flushPageMeta(page.id), LECTURE_META_FLUSH_MS);
  }

  /** Writes what is waiting for one page (or every page), now. */
  private flushPageMeta(pageId?: string): void {
    const ids = pageId ? [pageId] : [...this.pendingPageMeta.keys()];
    if (ids.length === 0) return;
    try {
      liveWrite(this.editor as Editor, () => {
        for (const id of ids) this.writePageMeta(id);
      });
    } catch {
      // inside a store listener: a moment later
      scheduleLiveWrite(this.editor as Editor, () => {
        for (const id of ids) this.writePageMeta(id);
      });
    }
  }

  /** Inside a live write: the page's pending lecture meta into its record. */
  private writePageMeta(pageId: string): void {
    const pending = this.pendingPageMeta.get(pageId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this.pendingPageMeta.delete(pageId);
    const page = this.editor.store.get(pageId as TLPage["id"]) as TLPage | undefined;
    if (!page) return;
    const raw = (page.meta as JsonObject)[LECTURE_PAGE_META];
    const merged: JsonObject = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
    // JSON only (a spec's absent fields are left out, not stored as undefined)
    for (const [k, v] of Object.entries(pending.patch)) if (v !== undefined) merged[k] = JSON.parse(JSON.stringify(v)) as JsonObject[string];
    this.editor.store.put([{ ...page, meta: { ...page.meta, [LECTURE_PAGE_META]: merged } }]);
  }

  /** Lecture mode's desk, loaded and made the first time a lecture needs it. */
  private lectureDesk(): Promise<LectureDesk> {
    this.lectureLoad ??= import("./lecture/desk").then(({ LectureDesk }) => {
      this.lecture = new LectureDesk(this.lectureHost(), this.chat, this.deps.lecturePlanners);
      return this.lecture;
    });
    return this.lectureLoad;
  }

  /**
   * The current screen in words, for the lecture director. Asked before the desk has loaded (the
   * very first tick of a lecture, a moment after the start), the screen is described from what the
   * loop knows itself: whether it is empty, and its topic.
   */
  lectureScreen(): LectureScreen {
    if (this.lecture) return this.lecture.screen();
    void this.lectureDesk();
    return { empty: this.editor.getCurrentPageShapes().length === 0, topic: this.lecturePageMeta().topic ?? null, drawn: [], room: 1, active: [] };
  }

  /**
   * The director's actions, sketched one block at a time; resolves when the last is on the page (a
   * sketch's drawings follow as they arrive, through `opts.requestSketch`).
   */
  async runLectureActions(actions: readonly LectureAction[], opts?: LectureRunOptions): Promise<LectureRunReport> {
    return (await this.lectureDesk()).run(actions, opts);
  }

  /**
   * Heard text, kept on the current screen's page meta (what "what did she say about…" is answered
   * from). The loop's own write, not the desk's: a sentence belongs to the screen it was heard on,
   * even before the desk has loaded.
   */
  saveLectureTranscript(text: string): void {
    if (!text.trim()) return;
    this.setLecturePageMeta({ transcript: appendHeard(this.lecturePageMeta().transcript ?? "", text) });
  }

  /** The current screen's id ("page" on an editor without screens). */
  private pageKey(): string {
    return this.editor.getCurrentPage?.()?.id ?? "page";
  }

  /** The current screen as maths, for a chat request: what "more like these" refers to. */
  chatScreen(): ChatScreen {
    return this.chat.picture();
  }

  /** A chat reply's actions, written one block at a time; resolves when the last is on the page. */
  runChatActions(actions: readonly ChatAction[]): Promise<ChatRunReport> {
    return this.chat.run(actions);
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

  placeMath(args: { latex: string; nearLineId?: string; tone?: MathTone; size?: { w: number; h: number } }): TLShapeId | null {
    const latex = args.latex.trim();
    if (!latex) return null;
    if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return null;
    const id = createShapeId();
    const lineId = args.nearLineId ?? "";
    this.write(() => {
      const anchor = this.anchorRect(args.nearLineId);
      const viewport = this.placementBounds();
      const size = args.size ?? { w: estimateEchoWidth(latex), h: ECHO_HEIGHTS.m };
      const candidate = keepInsideX(placeFloating(anchor, size, viewport), viewport);
      const rect = keepInsideX(anchor ? findFreeSlot(candidate, this.avoidRects(lineId), anchor) : candidate, viewport);
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
      const viewport = this.placementBounds();
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
    // a proof line is checked by the proof checker (its mark is already there): no model check
    if (this.proofs.owns(target.line.id)) return;
    // Asking means now: a result this line was holding back for the settle is written at once
    // (the mode gate still applies — asking in Feedback asks for feedback, not for the answer).
    if (target.analysis?.resultLatex) this.render(target, this.decisionFor(target, { userAsked: true }));
    this.startCheck(target.line.column, target.line.id, { userAsked: true });
  }

  requestSolve(lineId?: string): void {
    // A two-column proof: the rest of it in Solve, the next row otherwise (`ProofDesk`).
    if (this.opts.enabled && this.proofs.ask(lineId ?? this.latestLine()?.line.id ?? null, lineId ? null : this.touchedDiagram(), { all: this.opts.mode === "answer" })) return;
    // Solve with a drawing the last thing drawn: the tutor reads the figure.
    const figure = lineId ? null : this.touchedDiagram();
    if (figure && this.opts.enabled && this.opts.mode === "answer") {
      this.startFigure(figure, { lineId: figure.id });
      return;
    }
    let target = lineId ? liveStore.lines.get()[lineId] : this.latestLine();
    // The chat's problems: with no line of the student's to act on, Solve steps is about the current
    // problem — worked out under it; pressed again once it is, the next one (`chat/work.ts`).
    if (!lineId && this.opts.enabled && this.opts.mode === "answer" && !this.actsOn(target)) {
      const pick = this.problemPick("solve");
      if (pick?.kind === "tutor") {
        this.workProblem(pick.cell, "solve");
        return;
      }
      if (pick?.kind === "student") target = this.workUnder(pick.cell) ?? target;
      // every problem worked out, and the last ink is a stray mark under one: nothing to do
      else if (pick && (!target || this.columnHeads.has(target.line.column))) return;
    }
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
    // the student's last line is a right operation: the equation it leads to, and the rest from it
    if (this.opts.enabled && this.continueOperation(target, { all: true })) return;
    const col = this.columnLines(target.line.column).filter((s) => s.latex && !isOperationLine(s));
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

  /**
   * The board's one "Help" action, on the line the student touched last. Nothing here runs on
   * a timer: every branch is an explicit request.
   *
   *  - ink Live could not read as maths (a failed or low-confidence read, a diagram label, a
   *    lone symbol): "Ask about this" — a crop of that ink goes to the check model and the
   *    answer comes back as a typeset note. Same price as any check.
   *  - Solve: the worked solution (`requestSolve`), word problems included.
   *  - Feedback / Suggest: that line's next hint (`escalate`).
   */
  requestHelp(): boolean {
    if (!this.opts.enabled || this.opts.mode === "off") return false;
    // On a two-column proof (or its figure): the next row — in Solve, the rest of the proof.
    if (this.proofs.ask(this.latestLine()?.line.id ?? null, this.touchedDiagram(), { all: this.opts.mode === "answer" })) return true;
    // The student's last ink was a drawing (or its labels): the tutor reads the figure — in Solve
    // the whole setup and its answer, in Feedback / Suggest the first line of the setup. A drawing
    // never gets a "?": it is not ink that failed to read as maths.
    const figure = this.touchedDiagram();
    if (figure) {
      this.startFigure(figure, { lineId: figure.id, onlyFirstStep: this.opts.mode !== "answer" });
      return true;
    }
    const target = this.latestLine();
    // The chat's problems: with no line of the student's to help with, Help is about the current one.
    if (!this.actsOn(target) && this.helpWithProblem(target)) return true;
    // nothing on this screen to help with: the button says so
    if (!target) return false;
    if (needsLook(target)) {
      // No sentences on the board: ink the tutor cannot read as maths gets a "?" beside it
      // (write it again, larger or clearer) — not a model's paragraph about the picture.
      this.syncMark(target, "question", unjudgedReason(target) ?? "unread");
      return true;
    }
    if (this.opts.mode === "answer") this.requestSolve(target.line.id);
    else this.escalate(target.line.id);
    return true;
  }

  /**
   * Help on a screen of the chat's problems when the student's last ink is nothing to act on (none
   * at all, or a lone `2` under a problem): Solve works the current problem out under it; Feedback
   * and Suggest write its next step where the student would write — the first, then one more each
   * time. When the student has work under it after all, that work gets the help, as it always has.
   * Ink it could not read still gets its "?". False when no problem is open (today's Help decides).
   */
  private helpWithProblem(target: LiveLineState | undefined): boolean {
    const depth: ProblemDepth = this.opts.mode === "answer" ? "solve" : "step";
    const pick = this.problemPick(depth);
    if (!pick || pick.kind === "none") return false;
    if (target && needsLook(target)) this.syncMark(target, "question", unjudgedReason(target) ?? "unread");
    if (pick.kind === "tutor") {
      this.workProblem(pick.cell, depth);
      return true;
    }
    const line = this.workUnder(pick.cell);
    if (!line) return false;
    if (depth === "solve") this.requestSolve(line.line.id);
    else this.escalate(line.line.id);
    return true;
  }

  /**
   * The last line above `state` in its column that is not itself wrong: where the work was still
   * right. Never an operation line (`-3 \quad -3`): the step comes from the equation above it.
   */
  private lastGoodLineAbove(state: LiveLineState): LiveLineState | undefined {
    const above = this.columnLines(state.line.column).filter((s) => s.latex && s.line.row < state.line.row && !isOperationLine(s));
    return [...above].reverse().find((s) => s.analysis?.verdict !== "mismatch" && !this.modelFlagged(s));
  }

  /**
   * The step that should have come after the last good line, from the engine alone — the
   * student's own lines are never offered back. Null when the engine cannot say.
   */
  private rightNextStep(state: LiveLineState): string | null {
    const engine = this.engine;
    const good = this.lastGoodLineAbove(state);
    // a problem the chat wrote heads the column: a wrong first line is corrected from it
    const head = this.columnHeads.get(state.line.column)?.lines ?? [];
    if (!engine || (!good && head.length === 0)) return null;
    const column = this.columnLines(state.line.column).filter((s) => s.latex);
    const upto = good ? column.filter((s) => s.line.row <= good.line.row).map((s) => s.latex) : [];
    const lines = [...head, ...upto];
    const own = new Set(column.map((s) => normalizeStep(s.latex)));
    // The same local decision Solve makes, from the last good line: the step after it.
    const local = localSolve(engine, lines, lines.length - 1);
    return local.steps.find((st) => !own.has(normalizeStep(st))) ?? null;
  }

  /**
   * Suggest (and Solve): beside a ringed line, the tutor writes the step that should have been
   * there. It is an answer, so it waits for the student to stop writing unless they asked
   * (`now`). Engine only — a model is only asked when the student asks (`escalate`).
   * Returns whether a step was written or is waiting to be.
   */
  private suggestNextStep(lineId: string, opts: { now?: boolean; typed?: boolean } = {}): boolean {
    // Unasked, only Suggest and Solve write the step; asked (Help), any mode but Off does; typed
    // into the board chat, any mode at all.
    if (!opts.typed && (!this.opts.enabled || this.opts.mode === "off")) return false;
    if (!opts.now && this.opts.mode !== "suggest" && this.opts.mode !== "answer") return false;
    const state = liveStore.lines.get()[lineId];
    if (!state?.latex) return false;
    if (this.hasSuggestion(lineId, state.latex) || this.stepInFlight(lineId, state.latex)) return true;
    const step = this.rightNextStep(state);
    if (!step) return false;
    if (!opts.now && !this.settled) {
      this.pendingSuggestions.add(lineId);
      return true;
    }
    // one pen at a time: a ring still being drawn round the line is finished first
    if (this.afterMark(lineId, () => this.suggestNextStep(lineId, opts))) return true;
    if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return false;
    const { plan, unsupported } = planHandwriting([step], { size: handSizeFor(state.line.bounds.h), seed: handSeedFor(`${lineId}:suggest`) });
    if (!plan || unsupported.length > 0) return false;
    const ink = state.line.bounds;
    const candidate: Rect = {
      x: rectMaxX(ringRect(ink)) + PLACEMENT.sideGap / 2,
      y: ink.y + ink.h / 2 - plan.bounds.h / 2,
      w: plan.bounds.w,
      h: plan.bounds.h,
    };
    const slot = findFreeSlot(keepInsideX(candidate, this.placementBounds()), this.avoidRects(lineId), ink);
    const writer = this.makeWriter();
    const entry = { writer, latex: state.latex, landed: false };
    this.runtime(lineId).stepWriter = entry;
    writer.start(placeHandPlan(plan, { x: slot.x, y: slot.y }), {
      meta: makeMeta("ai", lineId, this.deps.now()),
      extraMeta: { [SUGGEST_META]: state.latex },
    });
    // queued after the writer's first write (live writes are microtasks): from here its strokes are
    // on the page for `hasSuggestion`
    queueMicrotask(() => (entry.landed = true));
    clientMetric("live.suggest.hand", { lineId });
    return true;
  }

  /**
   * A step for this read is being written and its strokes may not be on the page yet: two asks in
   * one tick (both queued behind a ring, or Help during it) wrote the same step twice.
   */
  private stepInFlight(lineId: string, latex: string): boolean {
    const entry = this.rt.get(lineId)?.stepWriter;
    return Boolean(entry && entry.latex === latex && (entry.writer.active || !entry.landed));
  }

  /**
   * Suggest and Solve, once the student has stopped: under a right operation line with nothing
   * under it yet, the tutor writes the equation it leads to — `2x = 8` under `-3 \quad -3`,
   * `\sin x = \frac{1}{2}` under a bar and a 2 — as the engine worked it out
   * (`LineAnalysis.operation.result`). An answer, so it waits for the settle; once, per operation.
   */
  private writeOperationResults(): void {
    if (!this.opts.enabled || (this.opts.mode !== "suggest" && this.opts.mode !== "answer") || !this.deps.handwritingEnabled()) return;
    for (const state of Object.values(liveStore.lines.get())) {
      const result = this.operationResultOf(state);
      if (!result || this.operationResultShapes(state.line.id).some((s) => metaString(s.meta, OPERATION_RESULT_META) === result)) continue;
      if (this.rt.get(state.line.id)?.resultWriter?.active || this.writerFor === state.line.id) continue;
      if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return;
      // one pen at a time: the dial raised from Off draws the operation's tick first
      if (this.afterMark(state.line.id, () => this.writeOperationResults())) continue;
      const { plan, unsupported } = planHandwriting([result], { size: handSizeFor(state.line.bounds.h), seed: handSeedFor(`${state.line.id}:result`) });
      if (!plan || unsupported.length > 0) continue;
      const slot = this.underOperation(state, plan.bounds);
      const writer = this.makeWriter();
      this.runtime(state.line.id).resultWriter = writer;
      writer.start(placeHandPlan(plan, { x: slot.x, y: slot.y }), {
        meta: makeMeta("ai", state.line.id, this.deps.now()),
        extraMeta: { [OPERATION_RESULT_META]: result },
      });
      clientMetric("live.operation.result", { lineId: state.line.id });
    }
  }

  /**
   * The equation a right operation line leads to (`\sin x = \frac{1}{2}` for a `\div 2` under
   * `2\sin x = 1`) while it is still the last thing in its column; "" once the student has written
   * under it, or when it is not a right operation line.
   */
  private operationResultOf(state: LiveLineState): string {
    const result = isOperationLine(state) && state.analysis?.verdict === "ok" ? (state.analysis.operation?.result ?? "") : "";
    if (!result) return "";
    return this.columnLines(state.line.column).some((s) => s.line.row > state.line.row) ? "" : result;
  }

  /**
   * Where a block of the tutor's goes under an operation line — or under what it already wrote
   * there (`anchor`) — level with the equation the operation works on.
   */
  private underOperation(state: LiveLineState, size: { w: number; h: number }, anchor: Rect = state.line.bounds): Rect {
    const ink = state.line.bounds;
    const above = [...this.columnLines(state.line.column)].reverse().find((s) => s.line.row < state.line.row && !isOperationLine(s));
    const candidate: Rect = { x: Math.min(ink.x, above?.line.bounds.x ?? ink.x), y: rectMaxY(anchor) + PLACEMENT.stepGap, w: size.w, h: size.h };
    const placed = keepOnScreen(candidate, this.screenRect(), anchor);
    return findFreeSlot(placed, [...this.avoidRects(state.line.id), ink, anchor], anchor, placed.x === candidate.x ? "below" : "right");
  }

  /**
   * Help or Solve on a right operation line the student stopped at. The next step is the equation
   * it leads to (`\div 2` under `2\sin x = 1` → `\sin x = \frac{1}{2}`): Help writes it — the same
   * block Suggest writes once the student stops (`writeOperationResults`) — and, asked again with
   * it on the page, the step after it. Solve writes it and the rest. Engine only, no model.
   *
   * Solve's column (`buildCheckLines`) leaves operation lines out, so under one of the chat's
   * problems, where the operation is often the student's only line, Help and Solve steps had
   * nothing to work from and did nothing. False when this is not such a line, or the engine has
   * nothing more to say about it: the usual paths take it.
   */
  private continueOperation(state: LiveLineState, opts: { all: boolean }): boolean {
    const engine = this.engine;
    const result = this.operationResultOf(state);
    if (!engine || !result) return false;
    const lineId = state.line.id;
    // its block is being written already (Suggest's, or this ask's own a moment ago)
    if (this.rt.get(lineId)?.resultWriter?.active || this.writerFor === lineId) return true;
    if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return true;
    // one pen at a time: the operation's tick is finished first
    if (this.afterMark(lineId, () => {
      const fresh = liveStore.lines.get()[lineId];
      if (fresh) this.continueOperation(fresh, opts);
    })) return true;
    const resultBlock = this.operationResultShapes(lineId).filter((s) => metaString(s.meta, OPERATION_RESULT_META) === result);
    const written = resultBlock.length > 0;
    const hand = this.deps.handwritingEnabled();
    const size = handSizeFor(state.line.bounds.h);
    const seed = handSeedFor(`${lineId}:result`);
    const canDraw = (steps: readonly string[]) => planHandwriting(steps, { size, seed }).unsupported.length === 0;
    const after = localSolve(engine, [result], 0, { handwriting: hand, canDraw, domain: this.headAnalyses(state.line.column).at(-1)?.domain?.latex });
    // the engine cannot go on from the result it already wrote: the usual paths (a model) may
    if (written && !after.source) return false;
    const rest = after.steps.filter((st) => normalizeStep(st) !== normalizeStep(result));
    const key = [result, ...rest].join(" ; ");
    // everything there is to write is on the page already
    if (this.hasHandSolution(lineId, key) || (written && rest.length === 0)) return true;
    const all = written ? rest : [result, ...rest];
    // a domain on its own (`0^{\circ} \le x < 360^{\circ}`) is not a step: it goes with the one after it
    const steps = opts.all ? all : all.slice(0, parseDomainPiece(all[0] ?? "") && all.length > 1 ? 2 : 1);
    const extraMeta: JsonObject = {
      ...(written ? {} : { [OPERATION_RESULT_META]: result }),
      ...(opts.all ? { [SOLVED_META]: key } : {}),
    };
    const anchor = written ? unionRects(resultBlock.map((s) => boxToRect(this.editor.getShapePageBounds(s)!))) : state.line.bounds;
    // A new step replaces the last one asked for here; it never stacks under it. The result
    // block stays: it is the student's next line, written for them.
    const keep = new Set(resultBlock.map((s) => s.id));
    const old = this.editor
      .getCurrentPageShapes()
      .filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai" && s.meta.lineId === lineId && !keep.has(s.id) && !metaString(s.meta, MARK_META) && !metaString(s.meta, GRAPH_META) && !answerSrcOf(s.meta))
      .map((s) => s.id);
    if (old.length > 0) this.write(() => this.editor.deleteShapes(old.filter((id) => this.editor.getShape(id))));
    const { plan, unsupported } = planHandwriting(steps, { size, seed });
    if (hand && plan && unsupported.length === 0) {
      const slot = this.underOperation(state, plan.bounds, anchor);
      this.startHandwriting(placeHandPlan(plan, { x: slot.x, y: slot.y }), lineId, extraMeta);
    } else {
      steps.forEach((step, i) => this.placeSolutionStep(anchor, anchor, i + 1, step, "", lineId, extraMeta));
    }
    clientMetric("live.operation.continue", { lineId, all: opts.all, written, steps: steps.length });
    return true;
  }

  private operationResultShapes(lineId: string): TLShape[] {
    return this.editor.getCurrentPageShapes().filter((s) => isLiveMeta(s.meta) && s.meta.lineId === lineId && metaString(s.meta, OPERATION_RESULT_META) !== "");
  }

  /** The operation line changed, or is no longer right: the equation written under it goes. */
  private dropStaleOperationResult(state: LiveLineState): void {
    const want = isOperationLine(state) && state.analysis?.verdict === "ok" ? (state.analysis.operation?.result ?? "") : "";
    const stale = this.operationResultShapes(state.line.id).filter((s) => metaString(s.meta, OPERATION_RESULT_META) !== want);
    if (stale.length === 0) return;
    this.write(() => {
      const ids = stale.map((s) => s.id).filter((id) => this.editor.getShape(id));
      if (ids.length > 0) this.editor.deleteShapes(ids);
    });
  }

  private hasSuggestion(lineId: string, latex: string): boolean {
    return this.editor
      .getCurrentPageShapes()
      .some((s) => isLiveMeta(s.meta) && s.meta.lineId === lineId && metaString(s.meta, SUGGEST_META) === latex);
  }

  /** The line was rewritten or put right: the step written beside it no longer applies. */
  private dropStaleSuggestion(state: LiveLineState, stillWrong: boolean): void {
    const lineId = state.line.id;
    if (!stillWrong) this.pendingSuggestions.delete(lineId);
    this.write(() => {
      const stale = this.editor
        .getCurrentPageShapes()
        .filter((s) => {
          if (!isLiveMeta(s.meta) || s.meta.lineId !== lineId) return false;
          const forLatex = metaString(s.meta, SUGGEST_META);
          return forLatex !== "" && (!stillWrong || forLatex !== state.latex);
        })
        .map((s) => s.id);
      if (stale.length > 0) this.editor.deleteShapes(stale);
    });
  }

  /**
   * More help on a line: the right next step by hand from the engine, straight away; when the
   * engine has none, one model step for this line (still checked, still drawn by hand).
   */
  escalate(lineId: string): void {
    const target = liveStore.lines.get()[lineId];
    if (!target || !target.latex || this.opts.mode === "off") return;
    if (this.proofs.ask(lineId, null, { all: false })) return;
    this.closeHintsFor(lineId);
    const wrong = target.analysis?.verdict === "mismatch" || this.modelFlagged(target);
    if (wrong) {
      if (this.suggestNextStep(lineId, { now: true })) return;
      const good = this.lastGoodLineAbove(target);
      if (good) {
        this.startSolve(target.line.column, good.line.id, { onlyFirstStep: true, lineId: good.line.id });
        return;
      }
    }
    // Stuck after a right operation (`\div 2` under `2\sin x = 1`): the equation it leads to, then the step after it.
    if (this.continueOperation(target, { all: false })) return;
    // Stuck on a line that is fine: when its work graphs (`y = 2x + 1`, a system, `x > 4`), the
    // graph is the help — sketched from the engine, no model asked. Otherwise the next step.
    if (this.syncGraph(target.line.column, { asked: true, anchorLineId: lineId })) return;
    this.startSolve(target.line.column, lineId, { onlyFirstStep: true, lineId });
  }

  /**
   * The board chat's "help me with 3" / "solve 3" (`help_problem`) on problem `n` of this screen.
   * With the student's work under it, their work gets the help Help and Solve steps give it: the
   * next step after their last line (the right one beside it when that line is wrong), or the rest
   * worked out from their last good line. Else the tutor works the problem itself (`workProblem`):
   * its next step after the tutor's own last one there, or the rest of it. A typed request is an
   * explicit ask: answered whatever the dial says, Off included. `done` when the student has
   * already solved it, or nothing is left to write.
   */
  private chatHelp(n: number, depth: ProblemDepth): "writing" | "done" | "busy" | "missing" {
    const cell = this.problemCells().find((c) => c.n === n);
    if (!cell) return "missing";
    const line = this.workUnder(cell);
    if (!line) return this.workProblem(cell, depth, "chat");
    if (line.analysis?.solved) return "done";
    const column = line.line.column;
    if (this.continueOperation(line, { all: depth === "solve" })) return "writing";
    if (depth === "solve") {
      const lastOk = this.columnLines(column)
        .filter((s) => s.latex)
        .reverse()
        .find((s) => s.analysis?.verdict === "ok" || s.analysis?.solved);
      return this.solveColumn(column, lastOk?.line.id ?? line.line.id, { lineId: line.line.id });
    }
    const wrong = line.analysis?.verdict === "mismatch" || this.modelFlagged(line);
    if (wrong) {
      if (this.suggestNextStep(line.line.id, { now: true, typed: true })) return "writing";
      const good = this.lastGoodLineAbove(line);
      if (good) return this.solveColumn(column, good.line.id, { onlyFirstStep: true, lineId: good.line.id });
    }
    if (this.syncGraph(column, { asked: true, anchorLineId: line.line.id })) return "writing";
    return this.solveColumn(column, line.line.id, { onlyFirstStep: true, lineId: line.line.id });
  }

  /** Solve on a column of the student's, asked for in the board chat: the Live switch does not gate it. */
  private solveColumn(column: number, fromLineId: string | undefined, opts: SolveOpts): "writing" | "busy" {
    const built = this.buildCheckLines(column);
    if (!built) return "busy";
    this.solveBuilt(built, fromLineId, opts);
    return "writing";
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
        // a lecture's notes stay: they are what the student came away with, and this is not undoable
        if (s.meta.source === "ai" && metaString(s.meta, LECTURE_BLOCK_META)) continue;
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

/** `\boxed{x = 9}` → `x = 9`: the card is the frame; a box inside it is a second one. */
export function unwrapBoxed(latex: string): string {
  return unwrapBoxedAnywhere(latex);
}

/** Comparable form of a step: spacing, `\left`/`\right` and `\cdot` vs juxtaposition ignored. */
export function normalizeStep(latex: string): string {
  return unwrapBoxed(latex)
    .replace(/\\(?:left|right|,|;|!|quad|qquad)|~|\s/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\cdot|\\times|\*/g, "");
}


/**
 * The `meta.solvedLatex` of the tutor's answer about a figure, and the version the figure route's
 * reply is kept under: the drawing's ink (its strokes, marks and labels together), its labels as
 * read and the work beside it. Asking again about the same figure costs nothing; a new stroke, label
 * or line beside it asks again. All the ink, and the labels compared loosely (`labelKey`), because
 * the split between a label and a mark can move with the glyph scale when the student writes
 * elsewhere (a degree sign touching a side): that is not a new figure.
 */
export function figureKey(diagram: Pick<Diagram, "strokeIds"> & Partial<Pick<Diagram, "labels">>, labels: readonly string[], column: readonly string[]): string {
  const ink = [...diagram.strokeIds, ...(diagram.labels ?? []).flat()].sort().join(",");
  return `figure: ${handSeedFor(ink)} | ${labels.map(labelKey).join(", ")} | ${column.join(" ; ")}`;
}

/**
 * Ink Live has nothing to reason about as maths: it could not be read (failed or
 * low-confidence), or it reads as a diagram label or a lone symbol. Prose (`text`) is a word
 * problem — readable, and its words are the question — but only when it reads like a
 * sentence: a doodle the recognizer turned into `\text{is}` is a picture, and sending it to
 * Solve as a question pays for a model to reason about nothing.
 */
export function needsLook(state: Pick<LiveLineState, "latex" | "confidence" | "analysis">): boolean {
  if (!state.latex.trim()) return true;
  if (state.confidence < LIVE_LIMITS.minConfidence) return true;
  if (state.analysis?.kind === "label") return true;
  if (state.analysis?.kind === "text" && !isProblemProse(state)) return true;
  return isSingleSymbolLatex(state.latex);
}

/**
 * A line that says what is done to both sides next — `-3 \quad -3`, `\div 2`, a bar with a `2`
 * under it (`engine/operationLine.ts`) — not a line of the working: the line after it is checked
 * against, solved from and corrected from the equation above it.
 */
export function isOperationLine(state: Pick<LiveLineState, "analysis">): boolean {
  return state.analysis?.kind === "operation";
}

export function createLiveLoop(editor: LiveEditorLike, opts: UseLiveMathOptions, deps: Partial<LiveLoopDeps> = {}): LiveLoop {
  return new LiveLoop(editor, opts, deps);
}
