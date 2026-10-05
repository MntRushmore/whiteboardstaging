"use client";

import { toast } from "sonner";
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
  type LineKind,
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
import { endsWithRelation, startsWithRelation } from "./answer";
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
import { evaluatedLineFor, givensFor, givensOf, type Given } from "./givens";
import { requestReread, requestSetup, type CallOptions } from "./modelCalls";
import { acceptChainReread, acceptReread, rereadTrigger, type RereadTrigger } from "./readCheck";
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
  joinHandPlans,
  placeHandPlan,
  placeHandPlanOnBaseline,
  planFromStrokes,
  planHandwriting,
  wallMsOf,
  HAND_PART_META,
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
import { createSolveStepGuard, engineParsesStep, localAnswerFor, mathSymbols, unwrapBoxed as unwrapBoxedAnywhere } from "./solveSteps";
import {
  RecognizeClient,
  RecognizeTimeoutError,
  createRecognizeClient,
  fetchCapabilities as defaultFetchCapabilities,
  isAbortLike,
  recognizeFailureHints,
} from "./recognizeClient";
import { streamLiveSse as defaultStream, type StreamOptions } from "./sseClient";
import { assignColumns, clusterLines, inkScale, rebuildFromMathShapes, unionRects, type ColumnOptions, type EchoShapeSeed } from "./strokeClusters";
import { buildPayload, hashPayload } from "./strokePayload";
import { barGroups, DIAGRAM_RULES, diagramNear, labelStack, parseLabelRead, splitInk, strokeLooksDrawn, type Diagram, type DiagramKind, type InkSplit } from "./diagrams";
import { barDivisionLatex } from "./engine/operationLine";
import { nextStep as stackNextStep, parseStacked, placesLeft, rowPlaces, workStacked, type StackedWork } from "./engine/columnArithmetic";
import { stackGrid, stackGroups, type StackGrid, type StackedSum } from "./stackedSums";
import { parseDomainPiece } from "./engine/domain";
import { figureAnswer, isValueLabel, labelKey, looksLikeUnknown } from "./figure";
import { HAND_LINE_META } from "./handwriting";
import { requestProof } from "./proof/client";
import type { ProofRequest, ProofResponse } from "./proof/contracts";
import { ProofDesk, tutorLinesOf, type ProofHost, type TutorFigure } from "./proof/desk";
import { PROOF_ROWS_META, proofRowsPlan } from "./proof/place";
import { PROOF_FIGURE_META, PROOF_TABLE_META, tutorFiguresOf } from "./proof/tutorFigure";
import type { PlannedRow } from "./proof/planner";
import type { BoardLine, ProofRead } from "./proof/read";
import { cellOf, problemKeyOf, problemLines, problemMetaOf, readProblemCells, splitColumnsAtProblems, type ProblemCell } from "./chat/cells";
import { nextHelpTarget, penLine, pickedLine, problemCount, problemTarget, type HelpTargetDraft } from "./helpTarget";
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
// the learning record: the bus (tiny, no imports) and the mistake kinds only; the tracker that
// listens is loaded after the board (`src/lib/learning/boardLearning.ts`)
import { learningBus } from "@/lib/learning/bus";
import { MISTAKE_KINDS } from "@/lib/learning/hint";
import type { ChatRunOrigin, LearningSignal, LineMark } from "@/lib/learning/contracts";

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
  /** what the student picked with the select tool (`helpTargetLine`); optional: test editors may have none */
  getSelectedShapeIds?(): TLShapeId[];
  /** the camera's fit zoom (`boardZoom`); optional: test editors have no camera */
  getBaseZoom?(): number;
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
  /**
   * A quiet note for the student that is not an error — Solve with nothing to work out
   * (`LIVE_COPY.solve`): the board's toast, as the ask button's "Write a line of maths first". Never
   * `liveStore.lastError`, whose red card and Retry say something failed.
   */
  notify: (message: string) => void;
}

interface LineRuntime {
  checkAbort: AbortController | null;
  solveAbort: AbortController | null;
  unreadableShown: boolean;
  unreadableTimer: ReturnType<typeof setTimeout> | null;
  shownHintTexts: Set<string>;
  escalation: number;
  processing: number;
  /** the tutor's mark wanted on this line (`markKey`), null for none; undefined until first render */
  markKey?: string | null;
  /**
   * its ring was taken off because new ink looked like more of this line (`unringGrowingLines`):
   * its strokes then, so the next flush can tell whether that ink really joined it
   */
  unrungStrokes?: readonly string[] | null;
  markWriter?: HandWriter | null;
  /** its read failed for a reason that is not the handwriting (signed out, out of ink, rate limited): no "?" */
  readRefused?: boolean;
  /** the ink version (`hash`) whose failed read was already tried once more on its own (`retryReadSoon`) */
  readRetriedHash?: string;
  /** that one more try, waiting `READ_RETRY_MS` */
  readRetryTimer?: ReturnType<typeof setTimeout> | null;
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

/**
 * The column with one line read again together with the ink on its row (`solveLineWithRow`): its
 * latex, its box grown to the row (the work goes under all of it), and what the model is told the
 * engine made of it. The store's line is not changed: its ink is still only its own strokes.
 */
function withLineRead(built: BuiltColumn, lineId: string, read: { latex: string; kind: LineKind; row: { bounds: Rect } }): BuiltColumn {
  return {
    ...built,
    lines: built.lines.map((l) => (l.id === lineId ? { ...l, latex: read.latex.slice(0, 2000), local: { kind: read.kind, verdict: "unknown" } } : l)),
    states: built.states.map((s) =>
      s.line.id === lineId ? { ...s, latex: read.latex, analysis: null, line: { ...s.line, bounds: unionRects([s.line.bounds, read.row.bounds]) } } : s,
    ),
  };
}
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
 * What the student asked for, read off the call that failed, so its error card can say so
 * (`errorCardTitle`): Help me and More help ask for one step (`onlyFirstStep`, a proof's next
 * row), which is a hint; Solve it asks for the rest. Reads and capability calls ask for nothing.
 */
function askedFor(retry: RetryContext): LiveError["asked"] {
  switch (retry.kind) {
    case "check":
      return retry.opts.forceHint ? "hint" : "check";
    case "solve":
    case "figure":
      return retry.opts.onlyFirstStep ? "hint" : "solve";
    case "proof":
      return retry.all ? "solve" : "hint";
    default:
      return undefined;
  }
}

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
/** The closed shapes `splitInk` recognizes (`Diagram.kinds`): a drawing with one is a figure (`isRealFigure`). */
const FIGURE_SHAPES: ReadonlySet<DiagramKind> = new Set<DiagramKind>(["triangle", "quadrilateral", "polygon", "circle"]);
/**
 * Help tapped while the latest line is still being read: how often it looks whether the read has
 * landed, and for how long at most — the recognizer's own timeout and a moment more.
 */
const HELP_READ_POLL_MS = 100;
const HELP_READ_WAIT_MS = LIVE_TIMING.recognizeTimeoutMs + 1_000;

/** Recognition failures that leave a chip under the ink (the pill carries the rest). */
const CHIP_CODES: ReadonlySet<LiveError["code"]> = new Set(["network", "upstream", "timeout", "unknown"]);

/**
 * A read that failed the way a blip fails (it timed out, or the server answered 5xx) is tried once
 * more on its own this long after, before the student is told (`retryReadSoon`).
 */
const READ_RETRY_MS = 1500;

/**
 * A failed read worth one more try of the same ink: a timeout or a server error. Not a
 * `recognizer_failed` (the recognizer, with a crop, could not read this ink: it would not read it
 * the second time either), nor a 4xx, which says the request itself was refused. A dropped request
 * (fetch's TypeError) is the offline queue's to replay.
 */
/**
 * How long the offline queue waits before it is replayed on its own while the browser still says
 * online, one wait per replay in a row that found the network unreachable (the last repeats).
 */
const OFFLINE_REPLAY_MS = [2000, 4000, 8000, 15_000] as const;

function transientReadFailure(err: unknown): boolean {
  if (err instanceof RecognizeTimeoutError) return true;
  return isApiError(err) && err.status >= 500 && err.code !== "recognizer_failed";
}

/**
 * How long the whole canvas must go without student ink before the tutor will write an
 * ANSWER — or, with Auto on, do anything else it does unasked (`LIVE_TIMING.settleMs`).
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
export const ANSWER_SETTLE_MS = LIVE_TIMING.settleMs;

/** What Auto in Solve finishes unasked: a line with a next step to write (not a label, a lone number, a graph). */
const AUTO_SOLVE_KINDS: ReadonlySet<LineKind> = new Set<LineKind>(["equation", "expression", "inequality"]);
/** ...and what Auto in Suggest writes the next step of, once stuck: those, and a right `-3 \quad -3` */
const AUTO_STEP_KINDS: ReadonlySet<LineKind> = new Set<LineKind>([...AUTO_SOLVE_KINDS, "operation"]);

/** The longest a mark's write may hold up what waits for it (`afterMark`): a ring takes about a second. */
const MARK_BUSY_MAX_MS = 4000;

/** How soon a quiet gate that ran out mid-stroke looks again (`armQuietTimer`). */
const QUIET_RECHECK_MS = 150;

const CHECK_PATH = "/api/live/check";
const SOLVE_PATH = "/api/live/solve";
const UNREADABLE_NOTE = "Couldn't read this — tap to type it";
/**
 * Shown when every step the solve stream sent failed the local interlock, or a figure's reply did
 * not hold up. It goes through the same path as a server-sent solve error, so the student gets the
 * pill, the inline card and the Retry they already know — and nothing is drawn. It says what to
 * try next: the usual reason is a line or a drawing the tutor could not make sense of.
 */
const SOLVE_FAILED = LIVE_COPY.solve.failed;
/** The same failure for a proof's next row the checker could not confirm (`ProofDesk`). */
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
/**
 * on Help's next step after the `=` of a line the engine works out (`LineAnalysis.nextStep`:
 * `3(3) + 24` after `3x + 24 =` over `x = 3`, `x^{2} + 2x - 3x - 6` after `(x - 3)(x + 2) =`): the
 * line, and any values it was evaluated at, that it was written for (`answerSourceOf`)
 */
const NEXT_STEP_META = "nextStepFor";
/**
 * On the digits the tutor writes into a stacked sum (`writeStackDigits`): the sum they belong to —
 * its operator and numbers (`stackKey`) — and, per digit, where it is (`HAND_PART_META`: `a2` the
 * answer's hundreds, `c2` a carry over them, `f2` a right digit under a wrong one). A column the
 * tutor wrote is not written again, and a sum rewritten takes the tutor's digits with it.
 */
const STACK_META = "stackFor";
/**
 * A wrong digit in a stacked sum is ringed only on a read this sure of it: a child's sum ringed for
 * a digit Mathpix misread is worse than one left unmarked (the second reader, which re-reads a line
 * before its ring, reads one line, not a block). Mathpix read every stacked block at ~1.
 */
const STACK_RING_CONFIDENCE = 0.85;
/** between two digits of a stacked sum the tutor writes, a beat (not a whole line's pause) */
const STACK_DIGIT_GAP_MS = 200;
/**
 * A read that is a stacked sum's last row over its answer, read as a fraction: no one writes a
 * fraction whose numerator starts with `+` or `x` — `\frac{+680}{966}` is `+ 680` over a rule over
 * `966`. Should `stackedSums.ts` ever miss the layout, the line is still never answered as a
 * fraction (`= 0.7039`): it is treated as a stacked sum this cannot work, quiet.
 */
const MISREAD_STACK = /^\s*\\frac\s*\{\s*(?:\+|\\times(?![a-zA-Z])|\\cdot(?![a-zA-Z]))/;
/** on the strokes of a tutor's mark (tick / ring / question mark): its `markKey` */
const MARK_META = "mark";
/** on a question mark's strokes: why the tutor put it there (`UnjudgedReason`) */
const MARK_WHY_META = "markWhy";
const ANSWER_ANCHORS_META = "answerAnchors";

/** A stacked sum on the board, worked (`LiveLoop.stackWork`). */
interface StackState {
  sum: StackedSum;
  grid: StackGrid;
  work: StackedWork;
  /** its operator and numbers: what the tutor's digits in it belong to (`STACK_META`) */
  key: string;
}

/** A digit the tutor writes into a stacked sum: on the answer row (`a`), as a carry (`c`), under a wrong answer (`f`). */
interface StackItem {
  row: "a" | "c" | "f";
  place: number;
  digit: string;
}

function metaString(meta: unknown, key: string): string {
  if (typeof meta !== "object" || meta === null) return "";
  const v = (meta as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

/** The student line this shape is the tutor's answer to, or "" when it is not answer ink. */
function answerSrcOf(meta: unknown): string {
  return metaString(meta, ANSWER_SRC_META);
}

/**
 * What an answer to this line is an answer TO (`answerFor`): the line as read — and, for a line
 * evaluated at the values its column gives (`LineAnalysis.substituted`), those values too
 * (`3x+24= @ 3(3)+24`). `x = 3` rewritten as `x = 4` leaves `3x + 24 =` reading the same, and its
 * `33` would otherwise stay beside it.
 */
function answerSourceOf(state: Pick<LiveLineState, "latex" | "analysis">): string {
  const at = state.analysis?.substituted;
  return at ? `${state.latex} @ ${at}` : state.latex;
}

/** `3x + 24 =`, `36 + 2 =`: a line the student ended with `=` (not `\le`, `<=`, `!=`). */
function endsWithEquals(latex: string): boolean {
  return /=\s*$/.test(latex) && !/[<>!]=\s*$/.test(latex);
}

/** `= 3(x + 8)` → `3(x + 8)`: a step's leading relation, which the line it continues already ends with. */
function withoutRelation(step: string): string {
  return step.replace(/^\s*=\s*/, "").trim() || step;
}

/**
 * `3x + 24 = 3(x + 8)`: a block continuing `line` (it ends with `=`), its first step restated as
 * that line, for a block that cannot be written beside or straight under it.
 */
function restated(line: string, steps: readonly string[]): string[] {
  if (steps.length === 0) return [];
  return [`${line.replace(/=\s*$/, "").trim()} ${steps[0].trim()}`, ...steps.slice(1)];
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

/** A number, as a young student writes an answer: `14`, `-3`, `2.5`, `\frac{3}{4}`, `3/4` (an `=` before it allowed). */
const BARE_NUMBER = /^\s*=?\s*-?\s*(?:\d+(?:\.\d+)?|\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\}|\d+\s*\/\s*\d+)\s*$/;
/** The same, as the last side of a line (`7 + 5 = 12`'s `12`): the line ends in the answer. */
const PLAIN_NUMBER = /^\s*-?\s*(?:\d+(?:\.\d+)?|\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\}|\d+\s*\/\s*\d+)\s*$/;

/** What follows a line's last `=` (the whole line when it has none). */
function lastSide(latex: string): string {
  const at = latex.lastIndexOf("=");
  return at === -1 ? latex : latex.slice(at + 1);
}

/** Maths with digits and no letters: arithmetic (`18 + 15 - 19`, `6 \times 4 = 24`, `\frac{1}{2} + \frac{1}{4}`). */
function isArithmetic(latex: string): boolean {
  const bare = latex.replace(/\\(?:frac|dfrac|tfrac|times|div|cdot|left|right|quad|qquad|,|;|:|!)/g, " ");
  return /\d/.test(bare) && !/[a-zA-Z\\]/.test(bare);
}

/** A step the engine rings (it does not follow), or one carried on from such a step (`LineAnalysis.carried`). */
function isSlip(a: LineAnalysis): boolean {
  return a.verdict === "mismatch" || Boolean(a.carried);
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
    notify: (message) => {
      toast(message);
    },
  };
}

/** A line of a two-column proof, to the line-by-line paths: nothing to compute, ring or answer (`ProofDesk` marks it). */
const PROOF_LINE: LineAnalysis = { kind: "label", math: "", resultLatex: "", verdict: "none", note: "" };

/** Where the problems a chat run writes come from when its caller does not say (`runChatActions`). */
const CHAT_PROBLEM_ORIGIN: ChatRunOrigin = { origin: "tutor_problem" };
/** The most of each thing the learning record remembers per session (lines, keys, problems told). */
const LEARN_MEMORY = 2000;
/** Line kinds that are not a problem's statement: its head line is the first line of another kind (`learnProblemOf`). */
const LEARN_NOT_HEAD: ReadonlySet<LineKind> = new Set<LineKind>(["label", "unknown", "operation"]);

/** Forgets the oldest entries past `max` (a Map or a Set keeps insertion order). */
function forgetOldest(memory: Set<string> | Map<string, unknown>, max = LEARN_MEMORY): void {
  while (memory.size > max) memory.delete(memory.keys().next().value as string);
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

/** One line of a ring's second look (`checkChain`): the second reader's answer, and its read if believable. */
interface ChainRead {
  state: LiveLineState;
  reply: RereadResponse;
  latex: string | null;
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
  /** Auto in Suggest: `stuckMs` of no ink, then the next step (`autoStuck`) */
  private stuckTimer: ReturnType<typeof setTimeout> | null = null;
  /** what Auto has done, per problem state (`autoKey`): every unasked action, and its ink, at most once */
  private readonly autoDone = new Set<string>();
  /** lines Auto started work on: their failures stay quiet, and new ink stops their answers (`autoRun`) */
  private readonly autoLines = new Set<string>();
  /** the student asked since they last wrote: Auto adds no answer of its own on top (`noteAsked`) */
  private askedSinceInk = false;
  /** Auto off: the lines of the problems the student asked about, as they read then (`autoFor`) */
  private readonly askedLines = new Map<string, string>();
  /** a line's readback, shown after its read (`showReadback`) */
  private readonly readbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private dirtyStrokeIds = new Set<string>();
  private pendingRewrite = false;
  private readonly rt = new Map<string, LineRuntime>();
  /** lines whose recognition could not reach the network; replayed on reconnect (no cap) */
  private readonly offlineQueue = new Set<string>();
  /** the queue's next replay while the browser says online (`scheduleOfflineReplay`) */
  private offlineReplayTimer: ReturnType<typeof setTimeout> | null = null;
  /** how many replays in a row have found the network still unreachable (picks the next wait) */
  private offlineReplayStep = 0;
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
  /**
   * Rings waiting for a second look (`holdRing`): the step's line id → the key of the pair of inks
   * (the line above's and its own) being read again. A pair in `chainsDone` had its second look;
   * its ring is drawn at once from then on.
   */
  private readonly chainHolds = new Map<string, string>();
  private readonly chainsDone = new Set<string>();
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
  /** the line read last, whatever made it read again: Help's line only before the pen has written (`helpTargetLine`) */
  private lastTouchedLineId: string | null = null;
  /**
   * The student's last FRESH pen stroke on this screen, and the line it was last seen in: where Help
   * acts (`helpTargetLine`). Only the pen moves it — a stroke rubbed out, dragged, brought back by
   * Undo or synced from elsewhere does not. Null until the pen writes on this screen.
   */
  private penStrokeId: string | null = null;
  private penLineId: string | null = null;
  /** the student's strokes rubbed out on this screen: one coming back is Undo, not the pen */
  private readonly goneStrokeIds = new Set<string>();
  /**
   * Which came last, the pen or a pick with the select tool (a count of both): the newer one decides
   * (`picked`). tldraw keeps a selection, unseen, while the pen writes elsewhere; it is no pick then.
   */
  private penSeq = 0;
  private pickSeq = 0;
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
  /** the stacked sums on this screen (`splitInk`, `stackedSums.ts`): each one line of its own, worked by `stackWork` */
  private stacks: StackedSum[] = [];
  /** marks on a drawing (`splitInk` role `mark`: an angle arc, a right-angle box, a tick): a figure's (`isRealFigure`) */
  private markStrokeIds = new Set<string>();
  /** Help waiting for the latest line's read to land before it acts (`helpAfterRead`) */
  private helpWaitTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Which runtime this is: bumped by `resetRuntime` (a screen left or deleted, the loop stopped).
   * Work begun before a reset was about the ink on screen then: what it brings back after it is
   * dropped (`askAboutDrawing`), and its end does not count itself off the pill's `solving`, which
   * the reset already zeroed (`solvingStarted`).
   */
  private generation = 0;

  /** the board chat's hand: its actions, one block at a time (`src/lib/live/chat/desk.ts`) */
  private readonly chat: ChatDesk;
  /**
   * The problem the chat wrote at the top of each column the student works under it (by column):
   * the column's first line, the context its first line is checked against (`chat/cells.ts`).
   */
  private columnHeads = new Map<number, ProblemCell>();
  /**
   * The lines each line has been one problem with (by id: the others of its column at some
   * assignment). A gap that opens between them later — a line between them rubbed out, the tutor's
   * working there rubbed out — does not part them (`ColumnOptions.together`): the steps under it
   * would be judged with nothing above them, and Solve would start them over. Forgotten with the
   * screen; a reload starts from the ink as it is.
   */
  private problemMates = new Map<string, Set<string>>();
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

  // ---- the learning record (`src/lib/learning`, `learningBus`): what this loop tells it
  /** the problem key each student line was given (`learnKeyFor`); a line keeps its key for the session */
  private readonly learnKeys = new Map<string, string>();
  /** what the record was last told about each line (`learnLine`): a line says something only when that changes */
  private readonly learnSent = new Map<string, string>();
  /**
   * Lines whose ink was read in this session (`applyRecognition`, a retype): new work. A line brought
   * back from its readback (a load, a screen switch) is not, until a line of its problem is.
   */
  private readonly learnFresh = new Set<string>();
  /** the chat's problems the record was told about, by problem key (`learnProblemWritten`) */
  private readonly learnProblems = new Set<string>();
  /**
   * The origin of each chat run asked for and not yet finished, oldest first (`runChatActions`): runs
   * are written one at a time, in order, so the run being written is always the first here.
   */
  private readonly chatOrigins: ChatRunOrigin[] = [];
  /** Auto is acting (`autoRun`): what is written meanwhile is Auto's */
  private learnAuto = false;

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
    this.publishHelpTarget();
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
    // the board is closed: the problems on it are over, as far as the learning record goes
    this.learn({ type: "closed", at: this.deps.now(), boardId: this.opts.boardId });
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
    this.generation++;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    if (this.helpWaitTimer) clearTimeout(this.helpWaitTimer);
    this.helpWaitTimer = null;
    this.settled = false;
    if (this.stuckTimer) clearTimeout(this.stuckTimer);
    this.stuckTimer = null;
    for (const t of this.readbackTimers.values()) clearTimeout(t);
    this.readbackTimers.clear();
    liveStore.readbacks.set({});
    this.autoLines.clear();
    this.askedLines.clear();
    this.askedSinceInk = false;
    // Leaving the board / unmounting must not freeze a half-written step on the canvas.
    this.finishWriting();
    this.deps.recognizer.abortAll();
    for (const r of this.rt.values()) {
      r.checkAbort?.abort();
      r.solveAbort?.abort();
      if (r.unreadableTimer) clearTimeout(r.unreadableTimer);
      if (r.readRetryTimer) clearTimeout(r.readRetryTimer);
    }
    for (const ctrl of this.rereadAborts) ctrl.abort();
    this.rereadAborts.clear();
    this.chainHolds.clear();
    this.reading.clear();
    this.dismissedGraphs.clear();
    this.dismissedFigures.clear();
    this.figuresInFlight.clear();
    this.diagrams = [];
    this.stacks = [];
    this.labelReading.clear();
    this.labelsOf.clear();
    this.lastTouchedDiagramId = null;
    this.touchedProblem = null;
    this.problemMates.clear();
    this.penStrokeId = null;
    this.penLineId = null;
    this.goneStrokeIds.clear();
    liveStore.helpTarget.set(null);
    liveStore.diagrams.set([]);
    this.proofs.reset();
    this.rt.clear();
    this.dirtyStrokeIds.clear();
    this.forceRecognize.clear();
    this.offlineQueue.clear();
    if (this.offlineReplayTimer) clearTimeout(this.offlineReplayTimer);
    this.offlineReplayTimer = null;
    this.offlineReplayStep = 0;
    this.pendingChecks.clear();
    this.pendingSolve = null;
    liveStore.offlineQueued.set(0);
    liveStore.solving.set(0);
  }

  private onSessionChange(entry: HistoryEntry<TLRecord>): void {
    let picked = false;
    for (const [from, to] of Object.values(entry.changes.updated)) {
      // a tap or a lasso with the select tool: Help may now act on another problem
      if (from.typeName === "instance_page_state" && to.typeName === "instance_page_state") {
        if (from.selectedShapeIds === to.selectedShapeIds) continue;
        picked = true;
        // something newly picked; a shape leaving the selection (rubbed out, say) picks nothing
        if (to.selectedShapeIds.some((id) => !from.selectedShapeIds.includes(id))) this.pickSeq = this.penSeq + 1;
        continue;
      }
      if (to.typeName !== "instance" || from.typeName !== "instance") continue;
      if (from.currentPageId !== to.currentPageId) {
        this.switchScreen();
        return;
      }
    }
    if (picked) this.publishHelpTarget();
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
    // the learning record: the problems on the screen the student left are over (for now)
    this.learn({ type: "screen", at: this.deps.now(), boardId: this.opts.boardId, pageId: this.screenSeen });
    liveStore.lines.set({});
    liveStore.openHints.set([]);
    clearLiveError();
    this.rebuild();
    this.recount();
    this.reanalyzeAll();
    this.publishHelpTarget();
    if (liveStore.status.get() !== "offline") liveStore.status.set(this.opts.enabled ? "idle" : "paused");
  }

  // ---------------------------------------------------------------- errors + retry
  /**
   * Records a failed call as the visible error (unless it is a plain network failure while
   * offline, which the offline queue owns) and remembers how to retry it. Repeated failures
   * of the same call after Retry carry the attempt count in the message.
   */
  private fail(err: unknown, ctx: Omit<ClassifyContext, "online" | "attempts">, retry: RetryContext): LiveError | null {
    // What Auto did unasked fails without a word: nothing for the student to retry, and no ink
    // dialog they did not ask for. Logged for us; their own ask on it shows its errors again.
    if (ctx.lineId && ctx.kind !== "recognize" && this.autoLines.has(ctx.lineId)) {
      console.warn(`[live] auto ${ctx.kind} failed`, err);
      clientMetric("live.auto.failed", { kind: ctx.kind, lineId: ctx.lineId });
      return null;
    }
    const key = `${ctx.kind}:${ctx.lineId ?? ""}`;
    const attempts = this.retryKey === key ? this.retryAttempt + 1 : 1;
    const fields = classifyLiveFailure(err, { ...ctx, online: this.deps.isOnline(), attempts });
    if (!fields) return null;
    if (this.retryKey !== key) {
      this.retryKey = key;
      this.retryAttempt = 0;
    }
    this.retryContext = retry;
    const asked = askedFor(retry);
    return setLiveError(asked ? { ...fields, asked } : fields);
  }

  /** The call succeeded: drop its error (if it is the one showing) and its retry state. */
  private noteSuccess(kind: LiveErrorKind, lineId?: string): void {
    const cur = liveStore.lastError.get();
    if (cur && cur.kind === kind && cur.lineId === lineId) clearLiveError();
    if (this.retryKey === `${kind}:${lineId ?? ""}`) this.resetRetry();
    // the network answered: the offline queue's next replay on its own waits the shortest time again
    this.offlineReplayStep = 0;
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
    // Retry is an ask: its failure is shown, whatever Auto did on the line since
    this.autoLines.clear();
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
    // Help in Solve may pick another of the chat's problems than a step would; Live off has none
    if (prev.enabled !== next.enabled || prev.mode !== next.mode) this.publishHelpTarget();
    const autoChanged = this.autoOn(prev) !== this.autoOn(next);
    if (autoChanged && !this.autoOn()) {
      // Auto off: what it was about to do, or had not finished asking for, stops (a hand already
      // writing finishes its line); the marks on the page stay
      this.autoInk();
    } else if (autoChanged && next.enabled) {
      // Auto on: the lines get their marks, and what is due at a pause is done now if the student is stopped
      this.reanalyzeAll();
      if (next.mode === "suggest" || next.mode === "answer") this.checkMismatchesAfterLadderRise();
    }
    // the dial moved, or Auto came on: the checks the old state never ran are due (the bug was that
    // an unknown line read in Off, or before a dial change, was never checked at all)
    if ((autoChanged || prev.mode !== next.mode) && next.enabled) queueMicrotask(() => this.autoResume());
  }

  /**
   * The student moved the dial to Solve or Suggest — explicitly; a load never calls this. On a
   * screen of the chat's problems where the current problem has nothing of the student's under it
   * (`chat/work.ts`), that is asking about it: Solve works it out under it, Suggest writes its first
   * step where the student would write. Once: a problem already worked (or already given its step)
   * is left as it is, and only the current problem is touched, never every problem on the screen.
   */
  private dialMovedTo(mode: "answer" | "suggest"): void {
    if (!this.started || !this.opts.enabled || this.opts.mode !== mode || !this.autoOn()) return;
    const cells = this.problemCells();
    if (cells.length === 0) return;
    const cell = currentProblem(cells, this.targetProblem(), (c) => this.problemState(c));
    if (!cell) return;
    const s = this.problemState(cell);
    if (s.work || (mode === "answer" ? s.solved : s.started)) return;
    // Auto's, for the learning record: the student moved the dial, nobody asked about this problem
    this.learnAuto = true;
    try {
      this.workProblem(cell, mode === "answer" ? "solve" : "step");
    } finally {
      this.learnAuto = false;
    }
  }

  /**
   * The dial went up to Suggest or Solve after the student had stopped writing: the answers the
   * settle writes (`renderSettled`) that the old mode held back are written now, as if the student
   * had stopped in this mode. A student stuck after a ticked `\div 2` turns the dial to Suggest
   * because they are stuck: before this, nothing came until they wrote again, which they could not.
   * Mid-writing, the settle still decides.
   */
  private dialRoseWhileStopped(mode: "answer" | "suggest"): void {
    if (!this.started || !this.opts.enabled || this.opts.mode !== mode || this.settleTimer || !this.autoOn()) return;
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
      if (st.latex && this.autoFor(st) && (st.analysis?.verdict === "mismatch" || this.modelFlagged(st))) this.suggestNextStep(st.line.id);
    }
  }

  /** Badge tapped on an echo: a check in every mode; a second tap in Suggest/Solve escalates. */
  private handleBadgeTap(lineId: string): void {
    const st = liveStore.lines.get()[lineId];
    if (!st?.latex || !this.opts.enabled) return;
    const mode = this.opts.mode;
    if (mode === "off") return;
    this.noteAsked(lineId);
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
        // a stroke made in one frame (a dot) is the pen; one the student had rubbed out is Undo
        if (!this.goneStrokeIds.has(rec.id)) this.wrote(rec.id);
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
          this.wrote(to.id);
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
        if (isStudentInk(rec)) this.goneStrokeIds.add(rec.id);
        const line = this.lineOfStroke(rec.id);
        if (line) {
          for (const sid of line.strokeIds) if (sid !== rec.id) this.dirtyStrokeIds.add(sid);
          this.dirtyStrokeIds.add(rec.id);
          erased = true;
          // rubbing out under a problem is working on it too (the line may be gone after the flush) —
          // until the pen has written on this screen: then the problem is where it wrote last
          const head = this.columnHeads.get(line.column);
          if (head && !this.penStrokeId) this.touchedProblem = head.key;
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
      const rt = this.rt.get(state.line.id);
      if (!rt?.markKey?.startsWith("circle:")) continue;
      if (!inks.some((b) => inkExtendsLine(boxToRect(b), state.line.bounds))) continue;
      // the clustering has the last word on whether this ink is more of the line (`reringUnchanged`)
      rt.unrungStrokes = [...state.line.strokeIds];
      // (the learning record waits for the read of the whole line: this is no verdict)
      this.syncMark(state, null, undefined, false);
    }
  }

  /**
   * The flush's clustering says which ringed lines the new ink really joined. `inkExtendsLine` is a
   * guess made as the stroke lands (on the row, up to two line heights past the end), and ink just
   * past a line that clusters as a line of its own (`2x = 1`, then `y` written a gap to the right)
   * left the line it guessed at un-ringed for good: its strokes had not changed, so it was never
   * read again, and only a read puts a ring back. A line whose strokes are the ones it had when its
   * ring came off gets the ring back now; a line that did grow is read again, and the read marks it.
   */
  private reringUnchanged(lines: readonly InkLine[], force: ReadonlySet<string>): void {
    for (const line of lines) {
      const rt = this.rt.get(line.id);
      const before = rt?.unrungStrokes;
      if (!rt || !before) continue;
      rt.unrungStrokes = null;
      // something marked it again since (a re-render): that mark stands
      if (rt.markKey !== null || force.has(line.id) || this.opts.mode === "off") continue;
      if (!sameStrokeSet(before, line.strokeIds)) continue;
      const state = liveStore.lines.get()[line.id];
      if (state) this.syncMark(state, "circle");
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
   * So is one of Auto's still on its way from a model (`autoInk`).
   */
  private markUnsettled(): void {
    this.autoInk();
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
   * Only `render` re-runs, and nothing here re-recognizes or re-analyses: a settle places the
   * answers the local engine already had and the ladder was keeping back. The one thing it adds
   * is Auto's (`autoPause`): the model asked about what the engine could not judge, and in Solve
   * the problem finished — at most once per state of the problem. With Auto off, none of it: the
   * unasked answers below wait for an ask.
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
    if (this.autoOn()) this.writeOperationResults();
    // and so is a graph (Solve only): `y = 2x + 1`, a system, a finished inequality's number line
    this.drawWantedGraphs();
    // A drawing's labels are its context, not something to answer: read once the student has
    // stopped, one recognizer call per drawing (and only when its labels changed).
    for (const d of this.diagrams) if (d.labels.length > 0) void this.readLabels(d);
    // ...and in Solve, a figure labelled with an unknown and left: worked out beside it, unasked
    if (this.autoOn()) this.solveWantedFigures();
    // Auto's turn comes after what the settle just wrote has landed (live writes are queued), so
    // Solve's finish sees an answer the settle wrote rather than writing it a second time
    queueMicrotask(() => {
      if (this.settled) this.autoPause();
    });
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
    const anchored = new Set(seeds.flatMap((s) => s.anchorIds));
    const rebuilt = rebuildFromMathShapes(seeds, bounds, this.columnOptions(anchored));
    // a second readback of a line rebuilt from another one: one line, one echo
    const kept = new Set<string>(rebuilt.map((r) => r.mathShapeId));
    const extra = seeds.filter((s) => s.lineId && !kept.has(s.shapeId) && s.anchorIds.some((id) => bounds.has(id))).map((s) => s.shapeId);
    if (extra.length > 0) this.write(() => this.editor.deleteShapes(extra));
    // the chat's problems head the columns under them, as at every flush
    const split = new Map(this.withProblemColumns(rebuilt.map((r) => r.line)).map((l) => [l.id, l]));
    for (const r of rebuilt) r.line = split.get(r.line.id) ?? r.line;
    this.rememberProblems(rebuilt.map((r) => r.line));
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
    // What was on this screen before this session — a reload, the first visit to a screen — had its
    // pauses then: Auto does not pay for a model check of it again (`autoDone` is in memory, so
    // every new session checked every unjudged line on screen at its first pause, and every screen
    // at its first visit). Remembered as checked, per state of its column (`autoKey`): a line above
    // it rewritten now is a new problem, and is checked as one.
    for (const r of rebuilt) {
      const st = next[r.line.id];
      if (st.latex) this.autoOnce(this.autoKey("check", st));
    }
  }

  private runtime(lineId: string): LineRuntime {
    let r = this.rt.get(lineId);
    if (!r) {
      r = {
        checkAbort: null,
        solveAbort: null,
        unreadableShown: false,
        unreadableTimer: null,
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
    // Where the student last WROTE: their last pen stroke, not ink rubbed out, dragged or brought
    // back by Undo (`helpTargetLine`). Before the pen has written on this screen, what they touched.
    const wrote: ReadonlySet<string> = this.penStrokeId ? new Set([this.penStrokeId]) : dirty;
    // Drawings (and their marks and labels) first: only handwriting is grouped into lines. A bar
    // under an equation with a number under it ("divide both sides") is a line of its own.
    const { split, touched: drawn } = this.splitDrawings(ink, wrote);
    const prevStates = liveStore.lines.get();
    const prevLines = Object.values(prevStates).map((s) => s.line);
    // what the columns know besides the lines: what fills a gap under one, and which lines were one problem
    const inLines = new Set<string>([...split.writing.map((s) => s.id), ...split.bars.flatMap((b) => [b.bar, ...b.divisor]), ...split.stacks.flatMap((s) => s.strokeIds)]);
    const columns = this.columnOptions(inLines);
    // a division bar with its divisor, and a stacked sum, are a line each whatever the clusterer makes of them
    const fixed = [...barGroups(split.bars, ink), ...stackGroups(split.stacks, ink)];
    const lines = this.withProblemColumns(clusterLines(split.writing, prevLines, fixed, { zoom: this.boardZoom(), columns }));
    this.rememberProblems(lines);
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
    // a ring taken off for ink that turned out to be a line of its own goes back on
    this.reringUnchanged(lines, force);

    // What the student wrote last decides what Help is about: a line they wrote, or else a
    // drawing (or its labels) they drew. A carry over a stacked sum is that sum's.
    const carried = split.stacks.find((s) => s.marks.some((id) => wrote.has(id)));
    const pen = lines.find((l) => l.strokeIds.some((id) => wrote.has(id))) ?? (carried && lines.find((l) => l.strokeIds.includes(carried.rule)));
    if (pen) this.lastTouchedDiagramId = null;
    else if (drawn) this.lastTouchedDiagramId = drawn.id;
    if (pen && this.penStrokeId) this.penLineId = pen.id;
    // ...and which of the chat's problems is the current one: the one they last wrote under
    for (const l of lines) {
      const head = l.strokeIds.some((id) => wrote.has(id)) ? this.columnHeads.get(l.column) : undefined;
      if (head) this.touchedProblem = head.key;
    }

    for (const { line, moveOnly } of affected) void this.processLine(line, ink, moveOnly);
    this.publishHelpTarget();
  }

  /**
   * Runs `splitInk` over the screen's ink and keeps the drawings: a drawing that is gone takes the
   * tutor's answer about it with it. Returns the split and the drawing `dirty` touched, if any.
   */
  private splitDrawings(ink: InkStroke[], dirty: ReadonlySet<string>): { split: InkSplit; touched: Diagram | null } {
    // the tutor's problems are equations a division bar may be drawn under (their ink is not ink here)
    const split = splitInk(ink, this.diagrams, { equations: this.problemEquations(), zoom: this.boardZoom() });
    const gone = this.diagrams.filter((d) => !split.diagrams.some((n) => n.id === d.id));
    this.diagrams = split.diagrams;
    this.glyph = split.glyph;
    this.tableStrokeIds = new Set([...split.roles].filter(([, v]) => v.role === "table").map(([id]) => id));
    this.barStrokeIds = new Set(split.bars.map((b) => b.bar));
    this.stacks = split.stacks;
    this.markStrokeIds = new Set([...split.roles].filter(([, v]) => v.role === "mark").map(([id]) => id));
    for (const d of gone) {
      this.labelsOf.delete(d.id);
      if (this.editor.getCurrentPageShapes().some((s) => isLiveMeta(s.meta) && s.meta.lineId === d.id)) this.deleteLineShapes(d.id);
    }
    if (this.lastTouchedDiagramId && !split.diagrams.some((d) => d.id === this.lastTouchedDiagramId)) this.lastTouchedDiagramId = null;
    const touched = split.diagrams.find((d) => [...d.strokeIds, ...d.labels.flat()].some((id) => dirty.has(id))) ?? null;
    this.publishDiagrams();
    return { split, touched };
  }

  /**
   * The board's fit zoom: what the drawing / writing split and the columns size handwriting by
   * (`inkScale`). A board is a 1600 x 900 screen fitted to the window, so a phone shows it at ~0.2
   * and the same hand is five times bigger in page px there; the fit, not the current zoom, so
   * pinching in to write does not change how the lines already written are read. None on an editor
   * without a camera (tests): a desktop.
   */
  private boardZoom(): number | undefined {
    return this.editor.getBaseZoom?.();
  }

  /**
   * How much bigger in page px the tutor's hand is on this board than on a desktop (`inkScale` of the
   * fit zoom): what the gaps that set its writing off from the student's are multiplied by, so a
   * block sized for a phone (`handSizeFor(h, zoom)`) is not squeezed against their ink. 1 on a desktop.
   */
  private handScale(): number {
    return inkScale(this.boardZoom());
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
    if (rt.readRetryTimer) clearTimeout(rt.readRetryTimer);
    rt.unreadableTimer = null;
    rt.readRetryTimer = null;
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
    // ...and so is its "couldn't read this": the new read earns its own "?" (after the same delay)
    // if it is unsure too. Left set, a second unsure read lost its "?" for good: the render took it
    // off and the delay that puts it back never ran again.
    rt.unreadableShown = false;
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
      // A dropped request while the browser says online (Safari's "Load failed"): the queue's own
      // replay, 2 s from now (`scheduleOfflineReplay`), is this ink's one more try; the pill says
      // "Offline — 1 line waiting" meanwhile. Only when that fails too is it shown on the line.
      if (network && rt.readRetriedHash !== hash) {
        rt.readRetriedHash = hash;
        return;
      }
      if (!network) console.warn("[live] recognize failed", err);
      // Most failed reads are a blip (a timeout, a 502): the same ink is read once more on its own
      // before the student hears about it. Meanwhile the line counts as still being read (no "?").
      if (!network && this.retryReadSoon(lineId, hash, err)) {
        this.reading.add(lineId);
        return;
      }
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
      if (rt.processing === ticket && !rt.readRetryTimer) this.reading.delete(lineId);
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

  /**
   * One more read of the same ink, on its own, `READ_RETRY_MS` after a failure that is usually a
   * blip (`transientReadFailure`). Once per ink version: when that read fails too, the failure is
   * shown (the pill, the chip, the "?"), and Retry is the student's. New ink on the line, or the
   * line rubbed out, cancels it (processLine takes over). False when this failure gets no retry.
   *
   * The retry joins the quiet gate's flush when the student is mid-line, so it never reads their
   * half-written next line early.
   */
  private retryReadSoon(lineId: string, hash: string, err: unknown): boolean {
    const rt = this.runtime(lineId);
    if (!transientReadFailure(err) || rt.readRetriedHash === hash) return false;
    rt.readRetriedHash = hash;
    const ticket = rt.processing;
    if (rt.readRetryTimer) clearTimeout(rt.readRetryTimer);
    rt.readRetryTimer = setTimeout(() => {
      rt.readRetryTimer = null;
      if (rt.processing !== ticket) return;
      const st = liveStore.lines.get()[lineId];
      if (!st || !this.started || !this.opts.enabled) {
        this.reading.delete(lineId);
        return;
      }
      for (const sid of st.line.strokeIds) this.dirtyStrokeIds.add(sid);
      this.forceRecognize.add(lineId);
      if (!this.quietTimer) this.armQuietTimer(0);
    }, READ_RETRY_MS);
    return true;
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
    if (this.deps.isOnline()) this.scheduleOfflineReplay();
  }

  /**
   * A request that failed although the browser says online (Safari's "Load failed", a connection
   * the OS has not noticed dropping) queues its line, and no 'online' event will ever come to
   * replay it. It used to wait for the student's next ink or the next request that got through:
   * the last line they wrote before stopping stayed unread for good. The queue is now replayed on
   * its own, 2 s after, then 4, 8 and every 15 s while it keeps failing, as long as the browser
   * says online (offline, the 'online' event replays it). A success anywhere starts the waits over.
   * The replay rides the next flush, so a student mid-line keeps their quiet gate.
   */
  private scheduleOfflineReplay(): void {
    if (this.offlineReplayTimer || !this.started) return;
    const wait = OFFLINE_REPLAY_MS[Math.min(this.offlineReplayStep, OFFLINE_REPLAY_MS.length - 1)];
    this.offlineReplayStep++;
    this.offlineReplayTimer = setTimeout(() => {
      this.offlineReplayTimer = null;
      if (!this.started || !this.deps.isOnline() || this.offlineQueue.size === 0) return;
      // `flush` absorbs the queue (online) into the reads it makes
      if (!this.quietTimer) this.armQuietTimer(0);
    }, wait);
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

  /**
   * LLM stream could not start (offline / fetch TypeError): remember it, never spin — but only what
   * the student asked for. Auto's own work (an unasked check, a solve on a line Auto started:
   * `autoLines`) is dropped, not put off. Queued, a solve Safari's "Load failed" dropped was replayed
   * by the next read that got through (`noteSuccess` → `replayOffline`) as `requestSolve`, with none
   * of Auto's guards — no pause, nothing asked since, the switch maybe off by then — and wrote under
   * the student's pen mid-line; and the "Offline" it set told them about a call they never made. So
   * nothing of Auto's ever waits here, and `autoInk` has nothing to clear: the next state of the
   * problem gets Auto's next try.
   */
  private deferLlm(kind: "check" | "solve", lineId: string, userAsked = false): void {
    const asked = kind === "check" ? userAsked : !this.autoLines.has(lineId);
    if (!asked) return;
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
    // ink read in this session: new work for the learning record
    this.learnFresh.add(lineId);
    forgetOldest(this.learnFresh);
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
    // a stacked sum is a block, not a line for the second reader; a doubtful read of it stays quiet
    // (`stackAnalysis`) — and one misread as a fraction is not read again into a "plainer" fraction
    if (this.stackOf(line) || MISREAD_STACK.test(res.latex)) return;
    const state = liveStore.lines.get()[line.id];
    if (!state || state.latex !== res.latex) return;
    const { above, below } = this.columnNeighbours(state);
    const others = [...above, ...below];
    const signal = rereadTrigger({
      latex: res.latex,
      confidence: res.confidence,
      analysis: state.analysis,
      strokeCount: line.strokeIds.length,
      others,
    });
    if (!signal) return;
    await this.readAgain(line, res, { signal, above, below, others });
  }

  /**
   * One line to the second reader, its answer believed as always (`acceptReread`, given the column
   * as `others`): a read taken is re-analysed and re-rendered (`applyReread`). True when replaced.
   */
  private async readAgain(
    line: InkLine,
    read: { latex: string; confidence: number },
    opts: { signal: RereadTrigger; above: string[]; below: string[]; others: readonly string[] },
  ): Promise<boolean> {
    const reply = await this.askAgain(line, read, opts);
    if (!reply || !this.engine) return false;
    const accepted = acceptReread(this.engine, read.latex, reply.latex, opts.others);
    this.recordAgain(line.id, opts.signal, read.latex, reply, Boolean(accepted));
    const current = this.readsAs(line.id, line.hash, read.latex);
    if (!accepted || !current || !this.started) {
      if (this.started && current) this.readStands(line.id);
      return false;
    }
    this.rereads.set(line.hash, accepted);
    this.applyReread(line.id, accepted, read.confidence);
    return true;
  }

  /**
   * The second reader's answer for one line: a crop of its ink, `read` (Mathpix's, on the board
   * now) and the lines `above` / `below` sent with it. Marks the ink as asked before anything is
   * awaited, so it is never asked twice. Null — and silent — when there is no crop, the request
   * fails, or the line was written on or retyped meanwhile.
   */
  private async askAgain(
    line: InkLine,
    read: { latex: string },
    opts: { signal: RereadTrigger; above: string[]; below: string[] },
  ): Promise<RereadResponse | null> {
    const hash = line.hash;
    if (!hash) return null;
    const lineId = line.id;
    const { signal } = opts;
    this.rereads.set(hash, null);
    while (this.rereads.size > LIVE_LIMITS.cacheEntries) this.rereads.delete(this.rereads.keys().next().value as string);
    // the line must still read this way when the answer lands: new ink or a retype wins
    const current = () => this.readsAs(lineId, hash, read.latex);
    const crop = await this.captureCrop(line.strokeIds, line.bounds);
    if (!crop) {
      recordReread(lineId, { signal, mathpix: read.latex, latex: "", accepted: false, error: "no crop" });
      return null;
    }
    if (!current()) return null;
    const ctrl = new AbortController();
    this.rereadAborts.add(ctrl);
    // being read again: no "?" on it until the second read is in
    this.reading.add(lineId);
    try {
      const reply = await this.deps.reread({ boardId: this.opts.boardId, lineId, crop, latex: read.latex, above: opts.above, below: opts.below }, { signal: ctrl.signal });
      return current() ? reply : null;
    } catch (err) {
      if (ctrl.signal.aborted) this.rereads.delete(hash);
      else recordReread(lineId, { signal, mathpix: read.latex, latex: "", accepted: false, error: err instanceof Error ? err.message : String(err) });
      clientMetric("live.reread.failed", { signal, lineId });
      if (this.started && !ctrl.signal.aborted && current()) {
        this.reading.delete(lineId);
        this.readStands(lineId);
      }
      return null;
    } finally {
      this.rereadAborts.delete(ctrl);
      if (current() || !liveStore.lines.get()[lineId]) this.reading.delete(lineId);
    }
  }

  /** The line still holds this ink, read this way. */
  private readsAs(lineId: string, hash: string, latex: string): boolean {
    const cur = liveStore.lines.get()[lineId];
    return Boolean(cur && cur.line.hash === hash && cur.latex === latex);
  }

  /** The dev panel and the metrics: what the second reader answered, and whether it was taken. */
  private recordAgain(lineId: string, signal: RereadTrigger, mathpix: string, reply: RereadResponse, accepted: boolean): void {
    recordReread(lineId, { signal, mathpix, latex: reply.latex, accepted, model: reply.model, ms: reply.ms });
    clientMetric("live.reread", { signal, accepted, ms: reply.ms, lineId });
  }

  // ---------------------------------------------------------------- a ring waits for a second look
  /**
   * The line a step is judged against (`columnContext`'s `previous`) when it is the student's own
   * ink: null when that is a problem the chat wrote, which has nothing to misread.
   */
  private previousLine(state: LiveLineState): LiveLineState | null {
    let previous: LiveLineState | null = null;
    for (const s of this.columnLines(state.line.column)) {
      if (s.line.row >= state.line.row) break;
      const a = s.analysis;
      if (!s.latex || !a || a.kind === "label" || a.kind === "incomplete" || a.kind === "unknown" || a.kind === "operation" || this.stackOf(s.line)) continue;
      // a ringed step (or one carried on from it) is not what the next step is judged against
      if (isSlip(a)) continue;
      previous = s;
    }
    return previous;
  }

  /**
   * The problem `state` is in has no letters: a sum, a product, a fraction to work out (one of the
   * chat's, or the student's own first line — `state` itself when it is that line). Arithmetic: its
   * answer is a number, and a young student writes just the number.
   */
  private arithmeticProblem(state: LiveLineState): boolean {
    const head = this.columnHeads.get(state.line.column);
    const lines = head ? head.lines : [this.columnLines(state.line.column).find((s) => s.latex && s.line.row <= state.line.row)?.latex ?? state.latex];
    return lines.length > 0 && lines.every(isArithmetic);
  }

  /**
   * The step right above `state` when it is a slip (ringed, or carried on from one): what a step that
   * does not follow from the last right line may have carried on from (`analyze`). Undefined when the
   * step above is right, or there is none.
   */
  private slipAbove(state: LiveLineState): LineAnalysis | undefined {
    let last: LineAnalysis | undefined;
    for (const s of this.columnLines(state.line.column)) {
      if (s.line.row >= state.line.row) break;
      const a = s.analysis;
      if (!s.latex || !a || a.kind === "label" || a.kind === "incomplete" || a.kind === "unknown" || a.kind === "operation" || this.stackOf(s.line)) continue;
      last = a;
    }
    return last && isSlip(last) ? last : undefined;
  }

  /**
   * Does this step's ring wait (`render`)? The engine says the step does not follow from the line
   * above — and on messy ink that is as often a misread as a slip (a problem's `12` read as `17`
   * rings the right step under it). So when either line is a read of Mathpix's the second reader
   * has not seen, both are read again first (`checkChain`), and the ring waits for them, at most
   * `chainHoldMs`. Once per pair of inks; never offline, and never for a line under one of the
   * chat's problems with nothing of the student's above it.
   */
  private holdRing(state: LiveLineState): boolean {
    const lineId = state.line.id;
    // a stacked sum is judged on its own, not against a line above (its ring needs a sure read instead)
    if (this.stackOf(state.line)) return false;
    const above = this.previousLine(state);
    if (!above || !above.line.hash || !state.line.hash) return false;
    const key = `${above.line.hash}|${state.line.hash}`;
    if (this.chainHolds.get(lineId) === key) return true;
    if (this.chainsDone.has(key) || !this.engine || !this.started || !this.deps.isOnline()) return false;
    const due = [above, state].filter((s) => s.provider === "mathpix" && !this.rereads.has(s.line.hash));
    if (due.length === 0) return false;
    this.chainHolds.set(lineId, key);
    void this.checkChain(lineId, key, due);
    return true;
  }

  /**
   * The second look before a ring (`holdRing`): the step and the line it follows, read again side
   * by side. A line sent for a reason of its own (`rereadTrigger`) is read as the second reader
   * always reads it. Any other goes WITHOUT the column (shown the next line, a model can make a
   * line "follow" by changing it), and its read is taken only when it is a near transcription
   * (`acceptChainReread`) AND it makes the step follow (`chainFix`): the second look can take a
   * ring back, never move one — on very messy ink the model misreads too (`+` read as `-`, a `3`
   * dropped), and a "fix" that leaves the step wrong only ringed more of the student's right work.
   * Then the step is drawn as it reads now (`releaseRing`): ticked, or ringed after all.
   */
  private async checkChain(lineId: string, key: string, due: LiveLineState[]): Promise<void> {
    const ids = [...new Set([...due.map((s) => s.line.id), lineId])];
    const hashes = new Map(ids.map((id) => [id, liveStore.lines.get()[id]?.line.hash]));
    for (const id of ids) this.reading.add(id);
    const timer = setTimeout(() => this.releaseRing(lineId, key), LIVE_TIMING.chainHoldMs);
    clientMetric("live.reread.chain", { lineId, lines: due.length });
    const looked = await Promise.all(
      due.map(async (s): Promise<ChainRead | null> => {
        const { above, below } = this.columnNeighbours(s);
        const others = [...above, ...below];
        const signal = rereadTrigger({ latex: s.latex, confidence: s.confidence, analysis: s.analysis, strokeCount: s.line.strokeIds.length, others });
        if (signal) {
          await this.readAgain(s.line, s, { signal, above, below, others });
          return null;
        }
        const reply = await this.askAgain(s.line, s, { signal: "chain", above: [], below: [] });
        const latex = reply && this.engine ? acceptChainReread(this.engine, s.latex, reply.latex, others) : null;
        return reply ? { state: s, reply, latex } : null;
      }),
    );
    clearTimeout(timer);
    const reads = looked.filter((r): r is ChainRead => r !== null);
    const take = this.started ? this.chainFix(lineId, reads) : [];
    for (const r of reads) this.recordAgain(r.state.line.id, "chain", r.state.latex, r.reply, take.includes(r));
    for (const r of take) {
      if (!r.latex || !this.readsAs(r.state.line.id, r.state.line.hash, r.state.latex)) continue;
      this.rereads.set(r.state.line.hash, r.latex);
      this.applyReread(r.state.line.id, r.latex, r.state.confidence);
    }
    for (const id of ids) {
      const cur = liveStore.lines.get()[id];
      if (!cur || cur.line.hash === hashes.get(id)) this.reading.delete(id);
    }
    this.releaseRing(lineId, key);
  }

  /**
   * The fewest of the second look's reads that make the step follow from the line above — one of
   * them alone first, the line above's before the step's, then both. None: Mathpix's reads stand.
   */
  private chainFix(lineId: string, reads: ChainRead[]): ChainRead[] {
    const step = liveStore.lines.get()[lineId];
    const above = step ? this.previousLine(step) : null;
    if (!step || !above) return [];
    const options = reads.filter((r) => r.latex && liveStore.lines.get()[r.state.line.id]?.latex === r.state.latex);
    options.sort((a, b) => (a.state.line.id === above.line.id ? -1 : b.state.line.id === above.line.id ? 1 : 0));
    const sets = [...options.map((r) => [r]), ...(options.length > 1 ? [options] : [])];
    for (const set of sets) {
      const read = (s: LiveLineState) => set.find((r) => r.state.line.id === s.line.id)?.latex ?? s.latex;
      if (this.follows(step, above, read(above), read(step))) return set;
    }
    return [];
  }

  /** Would the step follow from the line above, the two read as given? The engine, as `analyze` asks it. */
  private follows(step: LiveLineState, above: LiveLineState, aboveLatex: string, stepLatex: string): boolean {
    const engine = this.engine;
    if (!engine) return false;
    const mode = this.opts.mode;
    try {
      const ctx = this.columnContext(step);
      const previous = aboveLatex === above.latex ? ctx.previous : engine.analyzeLine(aboveLatex, { ...this.columnContext(above), mode });
      const original = ctx.original === above.analysis ? previous : ctx.original;
      const a = engine.analyzeLine(stepLatex, { previous, original, mode });
      return a.verdict === "ok" || Boolean(a.solved);
    } catch {
      return false;
    }
  }

  /** The second look is over (or took too long): the step is drawn as it reads now. */
  private releaseRing(lineId: string, key: string): void {
    if (this.chainHolds.get(lineId) !== key) return;
    this.chainHolds.delete(lineId);
    this.chainsDone.add(key);
    while (this.chainsDone.size > LIVE_LIMITS.cacheEntries) this.chainsDone.delete(this.chainsDone.values().next().value as string);
    const cur = liveStore.lines.get()[lineId];
    if (!cur || !this.started) return;
    this.render(cur, this.decisionFor(cur));
    // no ring after all: the problem may be Auto's to finish at this pause
    if (this.settled) this.autoPause();
  }

  /**
   * The second reader is done and Mathpix's read stands: what waited for it is due now if the
   * student stopped meanwhile — its "?", and Auto's check of its column (`autoChecks` skips a line
   * still being read; an accepted read gets both from `analyzeAndRender`).
   */
  private readStands(lineId: string): void {
    this.questionIfSettled(lineId);
    const state = liveStore.lines.get()[lineId];
    if (state && this.settled) this.autoChecks(state.line.column);
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

  /**
   * Recognition failed for reasons a retry can fix: keep the line, and say so on it. The chip
   * points at Retry, but a readback only shows while the pen is NOT in hand (MathShapeUtil), and on
   * a writing board it nearly always is: so the line also gets the tutor's "?", the same mark an
   * unreadable line gets, which a successful read (Retry, the offline replay) replaces.
   */
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
    const fresh = liveStore.lines.get()[lineId];
    if (fresh && this.opts.mode !== "off") this.syncMark(fresh, "question", "unread");
  }

  private columnLines(column: number): LiveLineState[] {
    return Object.values(liveStore.lines.get())
      .filter((s) => s.line.column === column)
      .sort((a, b) => a.line.row - b.line.row);
  }

  private columnContext(state: LiveLineState): { previous?: LineAnalysis; original?: LineAnalysis; givens?: Record<string, string> } {
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
      // a stacked sum is a problem of its own: no line under it follows from it
      if (!s.latex || this.stackOf(s.line)) continue;
      // a ringed step is not what the next one is judged against: the last right line is. A fix
      // written under a slip (`3x = 5` ringed, then `3x = 15`) follows from `3x - 5 = 10` and is ticked
      if (s.analysis && isSlip(s.analysis)) continue;
      take(s.analysis);
    }
    // the values the rest of the column gives its letters, above it or under it (`givens.ts`):
    // `3x + 24 =` over `x = 3` asks for 33
    const index = col.findIndex((s) => s.line.id === state.line.id);
    const givens = index === -1 ? undefined : givensFor(this.columnGivens(col), index);
    return givens ? { previous, original, givens } : { previous, original };
  }

  /** The values a column's lines give its letters (`givens.ts`), indexed as `col`. */
  private columnGivens(col: readonly LiveLineState[]): Given[] {
    return givensOf(
      col.map((s) => s.latex),
      col.map((s) => s.analysis),
    );
  }

  /**
   * The line an ask about `state` is for. The student asked on a value they gave — `x = 3` under
   * `3x + 24 =`, or the `3` of an `x =` read apart from it — and the column has a line evaluated
   * at it (`LineAnalysis.substituted`): that line is the question, finished where they left off
   * (`33` after its `=`). The given is no step to go on from: asked on it, Solve went to a model,
   * which wrote `= 3(x+8)` under the `x = 3`. Any other line is asked about as it is.
   */
  private askedLine<T extends LiveLineState | undefined>(state: T): T | LiveLineState {
    if (!state) return state;
    const col = this.columnLines(state.line.column);
    const index = col.findIndex((s) => s.line.id === state.line.id);
    if (index === -1) return state;
    const at = evaluatedLineFor(
      col.map((s) => s.latex),
      col.map((s) => s.analysis),
      this.columnGivens(col),
      index,
    );
    return at === -1 ? state : col[at];
  }

  /**
   * A value given in this column appeared, changed or went (`x = 3` read, rewritten, rubbed out):
   * the lines it evaluates (`3x + 24 =`, wherever they are in the column) are analysed again — and
   * the lines under each, whose line above changed — and re-rendered: the answer written for the
   * old value goes (`dropStaleAnswer`), the new one is written as any answer is. A line ending in
   * `=` is the only kind that reads the givens (`AnalyzeContext.givens`).
   */
  private refreshEvaluated(column: number, skipLineId?: string): void {
    if (!this.engine) return;
    const col = this.columnLines(column).filter((s) => s.latex);
    const first = col.findIndex((s) => {
      if (s.line.id === skipLineId || !/=\s*$/.test(s.latex)) return false;
      const a = this.analyze(s);
      const b = s.analysis;
      return (a?.kind ?? "") !== (b?.kind ?? "") || (a?.substituted ?? "") !== (b?.substituted ?? "") || (a?.resultLatex ?? "") !== (b?.resultLatex ?? "");
    });
    if (first === -1) return;
    for (const s of col.slice(first)) {
      const cur = liveStore.lines.get()[s.line.id];
      if (!cur?.latex) continue;
      setLine(cur.line.id, { analysis: this.analyze(cur) });
      const fresh = liveStore.lines.get()[cur.line.id];
      if (fresh) this.render(fresh, this.decisionFor(fresh));
    }
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

  // ---------------------------------------------------------------- problems one under another
  /**
   * What the columns know besides the student's lines (`assignColumns`). A blank gap under a column
   * starts a new problem; what fills one is not blank:
   *  - the tutor's writing there (its steps, answers, readbacks, marks, graphs; hidden or not) that
   *    was on the page BEFORE the line under it was written: a student going on under the tutor's
   *    step is still in that problem, but working the problem above into the gap over a problem
   *    already written below does not join the two. tldraw stacks every new shape above all the
   *    others, so "before" is a lower index than the line's first stroke — also after a reload;
   *  - the student's ink that is in no line (`inLines`): a drawing, a table.
   * And the lines that were one problem before stay one (`problemMates`), as do the lines under one
   * of the chat's problems: its cell is the problem, gap or no gap (`chat/cells.ts`).
   */
  private columnOptions(inLines: ReadonlySet<string>): ColumnOptions {
    // read off the page only when a gap is wide enough to ask (most flushes never do), once
    let ink: { tutor: Array<{ rect: Rect; index: string }>; other: Rect[] } | null = null;
    const pageInk = () => {
      if (ink) return ink;
      ink = { tutor: [], other: [] };
      for (const s of this.editor.getCurrentPageShapes()) {
        const live = isLiveMeta(s.meta);
        // the chat's problems head columns of their own (`withProblemColumns`)
        if (live ? Boolean(problemMetaOf(s.meta)) : !isStudentInk(s) || inLines.has(s.id)) continue;
        const b = this.editor.getShapePageBounds(s);
        if (!b) continue;
        if (live) ink.tutor.push({ rect: boxToRect(b), index: s.index });
        else ink.other.push(boxToRect(b));
      }
      return ink;
    };
    const byLine = new Map<string, Rect[]>();
    let cells: ProblemCell[] | null = null;
    const cellKey = (line: InkLine) => cellOf(line.bounds, (cells ??= this.problemCells()))?.key ?? null;
    return {
      filled: (line) => {
        const known = byLine.get(line.id);
        if (known) return known;
        // when the line was written: its first stroke's place in the stack
        let first = "";
        for (const id of line.strokeIds) {
          const index = this.editor.getShape(id)?.index;
          if (index && (first === "" || index < first)) first = index;
        }
        const { tutor, other } = pageInk();
        const rects = [...other, ...tutor.filter((t) => first !== "" && t.index < first).map((t) => t.rect)];
        byLine.set(line.id, rects);
        return rects;
      },
      together: (line, other) => {
        if (this.problemMates.get(line.id)?.has(other.id)) return true;
        const cell = cellKey(line);
        return cell !== null && cell === cellKey(other);
      },
    };
  }

  /** Remembers which lines are one problem now (`problemMates`), and forgets the lines that are gone. */
  private rememberProblems(lines: readonly InkLine[]): void {
    const ids = new Set(lines.map((l) => l.id));
    for (const [id, mates] of this.problemMates) {
      if (!ids.has(id)) this.problemMates.delete(id);
      else for (const m of mates) if (!ids.has(m)) mates.delete(m);
    }
    const byColumn = new Map<number, string[]>();
    for (const l of lines) byColumn.set(l.column, [...(byColumn.get(l.column) ?? []), l.id]);
    for (const column of byColumn.values()) {
      if (column.length < 2) continue;
      for (const id of column) {
        const mates = this.problemMates.get(id) ?? new Set<string>();
        for (const m of column) if (m !== id) mates.add(m);
        this.problemMates.set(id, mates);
      }
    }
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
    const next = this.withProblemColumns(
      assignColumns(
        states.map((s) => ({ ...s.line })),
        this.columnOptions(new Set(states.flatMap((s) => s.line.strokeIds))),
      ),
    );
    this.rememberProblems(next);
    const after = [...this.columnHeads.entries()].map(([c, h]) => `${c}:${h.key}`).join(",");
    let changed = before !== after;
    for (const l of next) {
      const st = liveStore.lines.get()[l.id];
      if (!st || (st.line.column === l.column && st.line.row === l.row)) continue;
      setLine(l.id, { line: { ...st.line, column: l.column, row: l.row } });
      changed = true;
    }
    if (changed) this.reanalyzeAll();
    this.publishHelpTarget();
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

  /** The student's work under a problem: their line there the tutor can judge — the one picked or written in last, else the lowest. */
  private workUnder(cell: ProblemCell): LiveLineState | null {
    const mine = Object.values(liveStore.lines.get()).filter((s) => this.columnHeads.get(s.line.column)?.key === cell.key && this.judgeable(s));
    if (mine.length === 0) return null;
    const last = (this.picked()?.line ?? this.wroteLine())?.line.id;
    return mine.find((s) => s.line.id === last) ?? mine.sort((a, b) => a.line.bounds.y - b.line.bounds.y)[mine.length - 1];
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
    return { work: this.workUnder(cell) !== null, solved: work.solved || busy, started: work.solved || work.lines.length > 0 || busy, busy };
  }

  /** Which of the chat's problems an ask is about (`chat/work.ts`); null with none on this screen. */
  private problemPick(depth: ProblemDepth): ProblemPick | null {
    const cells = this.problemCells();
    if (cells.length === 0) return null;
    const state = (c: ProblemCell) => this.problemState(c);
    const touched = this.targetProblem();
    return depth === "solve" ? pickForSolve(cells, touched, state) : pickForStep(cells, touched, state);
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
      const result = this.solveBuilt(built, undefined, opts) === "nothing" ? "done" : "writing";
      // the problem being written is the one an ask is about now: the outline follows (quietly)
      this.publishHelpTarget({ quiet: true });
      return result;
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
    // the hand the problem was written in (its ink is a digit's height of it), as large as a student's
    // line allows — the chat's problem, laid out on the board's own 1600 x 900 screen, so no zoom here
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
    // a stacked sum is worked column by column, never as a line (its rule is no fraction bar)
    if (this.stackLike(state)) return this.stackAnalysis(state);
    try {
      const ctx = this.columnContext(state);
      let a = this.engine.analyzeLine(state.latex, { ...ctx, mode: this.opts.mode });
      // arithmetic (no letters anywhere in the problem): a lone number is the answer, and a right
      // plain number — or a true fact, `7 + 5 = 12` — is the problem solved
      if (this.arithmeticProblem(state)) {
        if (ctx.previous && BARE_NUMBER.test(state.latex)) {
          const answer = this.engine.analyzeLine(`= ${state.latex.trim()}`, { ...ctx, mode: this.opts.mode });
          if (answer.verdict === "ok" || answer.verdict === "mismatch") a = { ...answer, bareAnswer: true };
        }
        if (a.verdict === "ok" && !a.solved && PLAIN_NUMBER.test(lastSide(state.latex))) a = { ...a, solved: true };
      }
      if (a.verdict !== "mismatch" || a.solved) return a;
      // not right from the last right line: carried on from the slip right above it? Then the
      // mistake is that slip's (ringed already), and this step gets no mark of its own
      const slip = this.slipAbove(state);
      if (!slip) return a;
      const fromSlip = this.engine.analyzeLine(state.latex, { ...ctx, previous: slip, mode: this.opts.mode });
      return fromSlip.verdict === "ok" ? { ...a, verdict: "none", carried: true } : a;
    } catch (e) {
      console.warn("[live] analyzeLine threw", e);
      return { kind: "unknown", math: "", resultLatex: "", verdict: "unknown", note: "" };
    }
  }

  private decisionFor(state: LiveLineState, extra: { userAsked?: boolean; settled?: boolean } = {}): PolicyDecision {
    return decide({
      mode: this.opts.mode,
      analysis: state.analysis,
      latex: state.latex,
      confidence: state.confidence,
      settled: extra.settled ?? this.settled,
      auto: this.autoFor(state),
      userAsked: extra.userAsked ?? false,
      hintsShownForLine: state.hintsShown,
      openHintCount: liveStore.openHints.get().length,
      rewritesWithWarn: state.rewritesWithWarn,
      liveShapeCount: liveStore.liveShapeCount.get(),
    });
  }

  /**
   * Runs the engine for one line (every caller is a read: the recognizer, the second reader, a
   * retype), renders the echo/graph, cascades to the rows below (their `previous` changed), shows
   * what was read, and — once the student has paused — runs Auto's model check on the column.
   */
  private analyzeAndRender(lineId: string, opts: { cascade?: boolean } = {}): void {
    const state = liveStore.lines.get()[lineId];
    if (!state) return;
    const analysis = this.analyze(state);
    const wasWarn = state.analysis?.verdict === "mismatch";
    const isWarn = analysis?.verdict === "mismatch";
    const rewritesWithWarn = isWarn ? state.rewritesWithWarn + (wasWarn ? 1 : 0) : 0;
    setLine(lineId, { analysis, rewritesWithWarn });
    const fresh = liveStore.lines.get()[lineId];
    if (!fresh) return;
    const decision = this.decisionFor(fresh);
    this.render(fresh, decision);
    if (decision.echo && this.opts.mode !== "off") this.showReadback(lineId);

    if (opts.cascade) {
      for (const below of this.columnLines(fresh.line.column)) {
        if (below.line.row <= fresh.line.row || !below.latex) continue;
        const a = this.analyze(below);
        setLine(below.line.id, { analysis: a });
        const b = liveStore.lines.get()[below.line.id];
        if (b) this.render(b, this.decisionFor(b));
      }
    }
    // a value this line gives (`x = 3`) may finish a line above it too (`3x + 24 =`)
    this.refreshEvaluated(fresh.line.column, lineId);

    // A read that lands after the pause is due at once; one before it waits for the settle
    // (`autoPause`). The whole column: a line whose line above just changed is checked again.
    if (this.settled) this.autoChecks(fresh.line.column);
    // a new read can make a proof of lines around it (or change a row's verdict): re-mark them
    this.proofs.sync();
  }

  /**
   * "The tutor saw it": a line just read shows its typeset readback for `readbackMs`, even with
   * the pen in hand (`MathShapeUtil` hides it while the student writes otherwise) — a line with
   * nothing to judge too (`2 \times 2`, a first `x + 5 = 9`), Auto on or off. Nothing is written
   * for it: the echo is on the page already, so it costs no shape and nothing in the saved board.
   */
  private showReadback(lineId: string): void {
    const prev = this.readbackTimers.get(lineId);
    if (prev) clearTimeout(prev);
    liveStore.readbacks.set({ ...liveStore.readbacks.get(), [lineId]: this.deps.now() });
    this.readbackTimers.set(
      lineId,
      setTimeout(() => {
        this.readbackTimers.delete(lineId);
        const { [lineId]: _shown, ...rest } = liveStore.readbacks.get();
        void _shown;
        liveStore.readbacks.set(rest);
      }, LIVE_TIMING.readbackMs),
    );
  }

  // ---------------------------------------------------------------- Auto
  //
  // The Auto switch beside the dial. On (the default), the tutor acts by itself once the student
  // pauses: ticks and rings as the engine judges (they never wait), a model check of what the
  // engine cannot judge, Suggest's next step when they stay stuck, Solve finishing the problem.
  // Off, it acts only when asked (`noteAsked`): the lines are still read back, nothing more.
  //
  // Every unasked action goes through the entry points the button uses (`requestSolve`,
  // `requestHelp`, `startCheck`), so Auto and the button act on the same target the same way.
  // Auto spends ink, so each action runs at most once per state of its problem (`autoKey`),
  // never with no ink left, never offline, and fails without a word (`fail`).

  /** The Auto switch (absent: on). */
  private autoOn(opts: UseLiveMathOptions = this.opts): boolean {
    return opts.auto !== false;
  }

  /**
   * Auto acts on this line: the switch is on, or — off — the student asked about its problem
   * (`noteAsked`) and the line still reads as it did then.
   */
  private autoFor(state: LiveLineState): boolean {
    return this.autoOn() || this.askedLines.get(state.line.id) === state.latex;
  }

  /**
   * Auto may spend now: switched on, Live running in a help mode, the engine loaded, online and
   * ink left. With no ink an unasked call would only open the ink dialog unasked; offline nothing
   * is put off for later — the next pause looks again.
   */
  private autoReady(): boolean {
    if (!this.started || !this.opts.enabled || this.opts.mode === "off" || !this.autoOn() || !this.engine || !this.deps.isOnline()) return false;
    const ink = liveStore.inkBalance.get();
    return !(ink !== null && ink <= 0) && liveStore.lastError.get()?.code !== "ink";
  }

  /**
   * A problem as Auto remembers what it did about it: the screen and its column down to this line.
   * The same problem, unchanged, is never paid for twice — after a dial change, or a trip to
   * another screen and back, too. A line under it, or a line above it rewritten, is a new state.
   */
  private autoKey(kind: "check" | "solve" | "step", state: LiveLineState): string {
    const column = this.columnLines(state.line.column).filter((s) => s.line.row <= state.line.row && s.latex);
    // a line evaluated at a value written under it (`3x + 24 =` over `x = 3`) is another problem at another value
    const at = state.analysis?.substituted ? ` @ ${state.analysis.substituted}` : "";
    return `${kind}|${this.pageKey()}|${column.map((s) => s.latex).join("\n")}${at}`;
  }

  /** True the first time this key is seen (and remembers it). */
  private autoOnce(key: string): boolean {
    if (this.autoDone.has(key)) return false;
    this.autoDone.add(key);
    if (this.autoDone.size > LIVE_LIMITS.cacheEntries) this.autoDone.delete(this.autoDone.values().next().value as string);
    return true;
  }

  /**
   * The student has paused (the settle) — or `stopped` when the dial moved, or Auto came on, while
   * they were not writing: the model checks what the engine cannot judge, and in Solve the latest
   * problem is finished. Suggest's next step waits for the longer stuck pause (`autoStuck`).
   */
  private autoPause(stopped = this.settled): void {
    this.autoChecks(undefined, stopped);
    this.autoSolve();
  }

  /**
   * Auto's model check, in every help mode: the lines the engine cannot judge (`runLlmCheck`:
   * verdict unknown, a kind the model can reason about), once the student has paused. One check
   * per column — the model reads the whole column and may annotate any line of it — about its
   * lowest such line, and once per state of the column down to each line: a line whose line above
   * changed is checked again, an unchanged one never is. A ring it brings is drawn by
   * `applyAnnotation` (Suggest and Solve then write the right step beside it, as for the engine's).
   *
   * Not a line still being read (`reading`, as `autoWorkable`): its latex is the read before the
   * ink changed, and the check paid for that stale read. Its own read, when it lands after the
   * pause, checks its column (`analyzeAndRender`).
   */
  private autoChecks(column?: number, stopped = this.settled): void {
    if (!this.autoReady()) return;
    const due = new Map<number, LiveLineState[]>();
    for (const st of Object.values(liveStore.lines.get())) {
      if ((column !== undefined && st.line.column !== column) || !st.latex || this.reading.has(st.line.id) || this.rt.get(st.line.id)?.checkAbort) continue;
      if (!this.decisionFor(st, { settled: stopped }).runLlmCheck || this.autoDone.has(this.autoKey("check", st))) continue;
      due.set(st.line.column, [...(due.get(st.line.column) ?? []), st]);
    }
    for (const lines of due.values()) {
      const focus = lines.reduce((a, b) => (b.line.row > a.line.row ? b : a));
      for (const st of lines) this.autoOnce(this.autoKey("check", st));
      this.autoLines.add(focus.line.id);
      clientMetric("live.auto", { kind: "check", mode: this.opts.mode, lineId: focus.line.id });
      this.startCheck(focus.line.column, focus.line.id, { userAsked: false });
    }
  }

  /**
   * Auto in Solve, at the pause: the latest problem finished, as Solve it finishes it
   * (`requestSolve` picks the path: the engine, a graph, a model). Once per state of the problem;
   * never on a line with nothing to solve (a label, a lone number, unreadable ink, prose, a solved
   * line), never in a column with a ring (the right step beside the ring is Solve's answer there),
   * never over the tutor's hand already writing (the settle may just have started an answer, a
   * graph or a figure) and never right after the student asked.
   */
  private autoSolve(): void {
    if (this.opts.mode !== "answer" || !this.autoReady() || !this.autoMayAnswer()) return;
    const target = this.autoTarget();
    if (!target || !this.autoWorkable(target, AUTO_SOLVE_KINDS) || !this.autoOnce(this.autoKey("solve", target))) return;
    this.autoRun("solve", target, () => this.solveTarget());
  }

  /**
   * Auto in Suggest: the student has stayed paused for `stuckMs` on a problem that is not finished
   * (its latest line right, or with nothing above to judge it by, but not solved): its next step,
   * written as Help me writes it (`requestHelp`). Once per line, as it reads.
   */
  private autoStuck(): void {
    this.stuckTimer = null;
    if (this.opts.mode !== "suggest" || !this.autoReady() || !this.autoMayAnswer()) return;
    const target = this.autoTarget();
    if (!target || !this.autoWorkable(target, AUTO_STEP_KINDS) || !this.autoOnce(this.autoKey("step", target))) return;
    this.autoRun("step", target, () => this.help());
  }

  /**
   * The line Auto finishes or writes the next step of: the line of the student's last FRESH pen
   * stroke on this screen, in this session — never `helpTargetLine`'s fallbacks, which are for an
   * ask. Before the pen has written here (a load, a screen switch) that fallback is the line read
   * last, i.e. whichever line was rebuilt from its readback last: turning the dial to Solve, or
   * Auto on, solved an old problem nobody was working on. And never a pick with the select tool:
   * a pick is how the student aims Help me / Solve it, and tldraw keeps it, unseen, through what
   * comes next — the next pause solved a problem tapped minutes before. While a pick wins
   * (`picked`), Auto leaves the problem to the student's ask; the pen writing takes it back.
   * Explicit asks keep `helpTargetLine`.
   */
  private autoTarget(): LiveLineState | undefined {
    if (!this.penStrokeId || this.picked()) return undefined;
    // the `x = 3` just written under `3x + 24 =` is that line's value, not a problem of its own (`askedLine`)
    return this.askedLine(penLine(liveStore.lines.get(), this.penStrokeId, this.penLineId) ?? undefined);
  }

  /** Suggest's stuck pause starts again from now (Auto on; it looks at the mode again when it ends). */
  private armStuck(): void {
    if (this.stuckTimer) clearTimeout(this.stuckTimer);
    this.stuckTimer = this.autoOn() && this.opts.mode === "suggest" ? setTimeout(() => this.autoStuck(), LIVE_TIMING.stuckMs) : null;
  }

  /**
   * An answer may be written unasked now: the student did not just ask, the tutor's hand is free,
   * and their last ink was a line, not a drawing (a figure is Solve's to read: `solveWantedFigures`).
   */
  private autoMayAnswer(): boolean {
    return !this.askedSinceInk && !this.writer && !this.graphWriter && liveStore.solving.get() === 0 && !this.touchedDiagram();
  }

  /**
   * A line Auto may continue: maths the tutor can judge, of a kind with a next step, not solved, no
   * ring in its column, no model check of it still out (it may ring it) — and not a `36 + 2 =` the
   * engine answers (the settle wrote that answer, after their `=` or in the readback).
   *
   * Nor a lone expression with no `=` after it — `2x + 3` half written, `x^{2} + 3x + 5` already as
   * simple as it goes (`engine.alreadySimplest`), `2x + 3x` — which asks nothing until the student
   * says what they want of it; Solve it still answers it, asked. Only arithmetic the engine works
   * out is finished unasked: `2 \times 2` → `= 4` (`arithmeticAnswer`).
   */
  private autoWorkable(state: LiveLineState, kinds: ReadonlySet<LineKind>): boolean {
    // a stacked sum: a column left to write, and nothing wrong in it (`stackLeft`)
    if (this.stackLike(state)) return this.stackLeft(state, kinds === AUTO_STEP_KINDS);
    const a = state.analysis;
    const id = state.line.id;
    if (!a || !kinds.has(a.kind) || a.solved || !this.judgeable(state) || this.reading.has(id) || this.rt.get(id)?.checkAbort) return false;
    if (a.resultLatex && endsWithRelation(state.latex)) return false;
    if (a.kind === "expression" && !endsWithRelation(state.latex) && !this.arithmeticAnswer(state)) return false;
    return !this.columnLines(state.line.column).some((s) => s.analysis?.verdict === "mismatch" || this.modelFlagged(s));
  }

  /** A line of numbers alone (no letter in it) that the engine evaluates (`localAnswerFor`): `2 \times 2`, `36 + 2`. */
  private arithmeticAnswer(state: LiveLineState): boolean {
    if (!this.engine || mathSymbols(state.latex).length > 0) return false;
    return localAnswerFor(this.engine, state.latex, this.columnContext(state)) !== null;
  }

  /**
   * Runs an unasked action through the help entry points. What it starts is Auto's: its failure
   * stays quiet (`fail`), and new ink stops it (`autoInk`), so an answer nobody asked for never
   * lands after the student started writing again.
   */
  private autoRun(kind: "solve" | "step", target: LiveLineState, act: () => void): void {
    const before = new Map([...this.rt].map(([id, r]) => [id, r.solveAbort]));
    this.autoLines.add(target.line.id);
    // what is written while it acts is Auto's, for the learning record (`learnAutoFor`)
    this.learnAuto = true;
    try {
      act();
    } finally {
      this.learnAuto = false;
    }
    for (const [id, r] of this.rt) if (r.solveAbort && r.solveAbort !== before.get(id)) this.autoLines.add(id);
    clientMetric("live.auto", { kind, mode: this.opts.mode, lineId: target.line.id });
  }

  /** The student is writing again: Auto's answers not yet written are stopped, and the stuck pause starts over. */
  private autoInk(): void {
    this.askedSinceInk = false;
    for (const id of this.autoLines) this.rt.get(id)?.solveAbort?.abort();
    this.armStuck();
  }

  /**
   * The dial moved, or Auto came on, while the student was stopped (no settle running): Auto picks
   * up as if they had paused in this mode — the checks the old mode did not run, Solve's finish,
   * Suggest's stuck pause from now. Mid-writing, the settle decides as usual.
   */
  private autoResume(): void {
    if (!this.started || !this.opts.enabled || this.settleTimer) return;
    this.autoPause(true);
    this.armStuck();
  }

  /**
   * The student asked: Help me, Solve it, a badge, More help (the controller calls this first). What
   * fails from here is theirs to see, so Auto's quiet ends, and Auto adds no answer of its own until
   * they write again. With Auto off, the problem they asked about — the line's column, or the line
   * Help acts on — gets its marks now: asking for help is also asking how it is going.
   */
  noteAsked(lineId?: string): void {
    // the learning record: an explicit ask about this problem (before what it changes below)
    this.learnAsk(lineId);
    this.autoLines.clear();
    this.askedSinceInk = true;
    if (this.autoOn() || !this.opts.enabled || this.opts.mode === "off") return;
    const target = lineId ? liveStore.lines.get()[lineId] : this.helpTargetLine();
    if (!target) return;
    for (const st of this.columnLines(target.line.column)) {
      if (this.askedLines.get(st.line.id) === st.latex) continue;
      this.askedLines.set(st.line.id, st.latex);
      // its marks (and in Suggest / Solve a ring's right step): an answer is the ask's own to
      // write — rendered as if mid-writing, so the ask that follows does not find this one
      // half-landed and write it a second time
      if (st.latex) this.render(st, this.decisionFor(st, { settled: false }));
    }
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
    this.dropStaleNextStep(state);
    this.dropStaleOperationResult(state);
    this.dropStaleStack(state);
    // Its column's graph follows its maths: erased when that changed, sketched when wanted (Solve, settled).
    if (!opts.keepStatus && !decision.capped) this.syncGraph(state.line.column);
    if (!decision.echo) {
      if (state.mathShapeId || state.graphShapeId) this.deleteLineShapes(lineId, { keepAi: true });
      if (!opts.quiet) {
        // silent — unless it is under one of the chat's problems and the student has stopped: "?"
        const why = this.questionNow(state);
        // ...or this very read already earned its "couldn't read this" "?": a re-render of it (the
        // line above was read again) keeps the "?" instead of taking it off
        const unread = !why && rt.unreadableShown && this.opts.mode !== "off" && this.unreadableRead(state);
        this.syncMark(state, why || unread ? "question" : null, why ?? (unread ? "unread" : undefined));
      }
      if (this.unreadableRead(state) && !rt.unreadableShown && !rt.unreadableTimer && !opts.quiet) {
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
    // a step about to be ringed waits while it and the line above are read again (`holdRing`)
    const held = decision.badge === "warn" && !opts.keepStatus && this.holdRing(state);
    const status = decision.capped || held ? "none" : decision.badge;
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
      // With Auto off the line's own verdict still says which mark already on the page fits it
      // (`syncMark` keeps that one and writes none unasked); the echo shows none (`status`).
      const auto = this.autoFor(state);
      const marked = auto || decision.capped ? status : badgeFor(this.opts.mode, analysis);
      const ring = marked === "warn" || (marked !== "ok" && marked !== "solved" && this.modelFlagged(state));
      const tick = marked === "ok" || marked === "solved";
      // a line the engine cannot read at all, under one of the chat's problems: its "?" (`questionNow`)
      const why = ring || tick ? null : this.questionNow(state);
      this.syncMark(state, ring ? "circle" : tick ? "check" : why ? "question" : null, why ?? undefined);
      this.dropStaleSuggestion(state, ring);
      if (ring && !opts.quiet && auto) this.suggestNextStep(lineId);
    }
  }

  /** A read the recognizer was unsure of: the "couldn't read this" chip and "?" are for it. */
  private unreadableRead(state: LiveLineState): boolean {
    return state.latex !== "" && state.confidence < LIVE_LIMITS.minConfidence;
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
   * The tutor's marks on the page, for the cap and the pill's "lots of marks" warning: what Clear
   * marks takes away. The tutor's handwriting is one draw shape per stroke, so a written block
   * counts as ONE mark (its `meta.handBlock` key), not as its thirteen strokes.
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
      // Nor is a readback: the student's own line, one per line, which Clear marks leaves alone.
      // Counted, every line used two of the cap (its readback and its tick), so after about 30
      // lines nothing new was marked, and Clear marks could not bring the page back under it.
      if (s.meta.source === "echo") continue;
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
    else if (this.opts.mode !== "answer" || !this.settled || !this.autoOn() || this.graphWriter || this.dismissedGraphs.has(wanted.key)) return false;
    return this.drawGraph(wanted, states, opts);
  }

  /** Solve with Auto on, and the student has stopped: every column that wants a graph gets one, one sketch at a time. */
  private drawWantedGraphs(): void {
    if (!this.started || !this.opts.enabled || this.opts.mode !== "answer" || !this.autoOn() || !this.engine?.graphFor || this.graphWriter) return;
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
          if (this.settled && this.graphWriter === null && this.autoOn()) this.solveWantedFigures();
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
      this.rt.delete(lineId);
    }
    this.deleteLineShapes(lineId);
    removeLine(lineId);
    // the rest of its column may have lost a relation its graph was drawn from, or a value a line
    // ending in `=` was evaluated at (its answer goes with it)
    if (column !== undefined) {
      this.refreshEvaluated(column);
      this.syncGraph(column);
    }
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
    // solve from: the line after it follows from the equation above it (`isOperationLine`); a
    // stacked sum is the engine's alone (`stackAnalysis`), and no line of anyone else's working
    const states = this.columnLines(column).filter((s) => s.latex && !isOperationLine(s) && !this.stackLike(s));
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
    // what the tutor knows about this student (their weak skills, the mistakes they keep making),
    // once the board has loaded it (`learningBus`); absent until then, so the request is as it was
    const learner = learningBus.learner();
    const req: CheckRequest = {
      boardId: this.opts.boardId,
      mode: checkMode,
      region: built.region,
      lines: built.lines,
      focusLineId,
      userAsked: opts.userAsked,
      ...(learner ? { learner } : {}),
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
            this.applyAnnotation(ev.data, focusLineId, opts.userAsked);
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
  private applyAnnotation(a: Annotation, focusLineId: string, userAsked = false): void {
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
    // the learning record: the kind of mistake the model saw — and, asked for, its words are a hint
    this.learnAnnotation(state, a, userAsked);
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
        // the learning record: the tutor answered it — the student's ask, or the settle's (Auto)
        this.learnInlineAnswer(state);
        return true;
      }
      // Auto off: no answer is coming at the pause (Solve it brings it), so the readback stays
      if (!this.autoFor(state)) return false;
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
    // after the step Help wrote there (`3x + 24 = 3(3) + 24`) the line goes on from it: `= 33`
    const put = this.nextStepRect(state);
    const end = put ? rectMaxX(unionRects([ink, put])) : rectMaxX(ink);
    const text = put && !startsWithRelation(answer) ? `= ${answer}` : answer;
    const size = inlineHandSizeFor(ink.h, this.boardZoom());
    const { plan, unsupported } = planHandwriting([text], { size, seed: handSeedFor(`${state.line.id}:answer`) });
    if (!plan || unsupported.length > 0) return null;
    const placed = placeHandPlanOnBaseline(plan, {
      x: end + inlineAnswerGap(ink.h),
      baselineY: rectMaxY(ink),
    });
    const viewport = this.placementBounds();
    if (rectMaxX(placed.bounds) > rectMaxX(viewport) - PLACEMENT.viewportMargin) return null;
    if (this.avoidRects(state.line.id).some((r) => rectsIntersect(r, placed.bounds))) return null;
    return placed;
  }

  /** Where Help's next step for this line is (`writeNextStep`), when it is on the page for the line as it reads now. */
  private nextStepRect(state: LiveLineState): Rect | null {
    const key = answerSourceOf(state);
    const rects: Rect[] = [];
    for (const s of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(s.meta) || s.meta.lineId !== state.line.id || metaString(s.meta, NEXT_STEP_META) !== key) continue;
      const b = this.editor.getShapePageBounds(s);
      if (b) rects.push(boxToRect(b));
    }
    return rects.length > 0 ? unionRects(rects) : null;
  }

  /**
   * Help me on a line the student ended with `=` that the engine works out (`LineAnalysis.nextStep`),
   * in Feedback and Suggest: the first line of that working, written after their `=`, where they
   * left off — the values put in for `3x + 24 =` over `x = 3` (`3x + 24 = 3(3) + 24`), one expansion
   * for `(x - 3)(x + 2) =` (`= x^{2} + 2x - 3x - 6`) — and the rest is theirs to do. By hand beside
   * their line, as `inlineAnswer` writes an answer; where it cannot go there, as any step
   * continuing that line goes (`drawStepsByHand`: under it, or restated under the work — never
   * under the `x = 3`, where `= 3(3) + 24` would read as `x = 3 = 3(3) + 24`). Asked again with it
   * on the page, nothing new. False when the engine has no such step for the line.
   */
  private writeNextStep(state: LiveLineState): boolean {
    const step = state.analysis?.nextStep;
    if (!step) return false;
    if (this.nextStepRect(state) || this.writerFor === state.line.id) return true;
    if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return false;
    const meta: JsonObject = { [NEXT_STEP_META]: answerSourceOf(state) };
    const inline = this.deps.handwritingEnabled() ? this.planInlineAnswer(state, step) : null;
    if (inline) {
      this.startHandwriting(inline, state.line.id, meta);
      clientMetric("live.nextStep.hand", { lineId: state.line.id });
      this.learnWrote(state.line.id, "step");
      return true;
    }
    const built = this.buildCheckLines(state.line.column);
    if (!built) return false;
    const steps = [`= ${step}`];
    const opts: SolveOpts = { lineId: state.line.id, onlyFirstStep: true };
    if (!(this.deps.handwritingEnabled() && this.drawStepsByHand(built, opts, state, steps, meta, state))) this.typesetSteps(built, opts, steps, meta, state);
    clientMetric("live.nextStep.under", { lineId: state.line.id });
    this.learnWrote(state.line.id, "step");
    return true;
  }

  /** The line rewritten, its given value changed, or nothing to work out any more: Help's step for it goes. */
  private dropStaleNextStep(state: LiveLineState): void {
    const want = state.analysis?.nextStep ? answerSourceOf(state) : "";
    const stale = this.editor
      .getCurrentPageShapes()
      .filter((s) => isLiveMeta(s.meta) && s.meta.lineId === state.line.id && metaString(s.meta, NEXT_STEP_META) !== "" && metaString(s.meta, NEXT_STEP_META) !== want);
    if (stale.length === 0) return;
    this.write(() => {
      const ids = stale.map((s) => s.id).filter((id) => this.editor.getShape(id));
      if (ids.length > 0) this.editor.deleteShapes(ids);
    });
  }

  private answerMeta(state: LiveLineState, answer: string): JsonObject {
    return {
      [ANSWER_SRC_META]: answerSourceOf(state),
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
    const stale = this.answerBlocksFor(state.line.id).filter((s) => answerSrcOf(s.meta) !== answerSourceOf(state));
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
    const graphBefore = this.graphWriter;
    const local = this.writeLocal(built, opts);
    // A graph is part of the answer: sketched beside the steps once they are written, or on its
    // own — `y = 2x + 1` has no steps, its graph IS the answer, and no model is asked for one.
    const graphed = this.solveGraph(opts, local, built);
    // the learning record: the tutor wrote something new (not what was on the page already)
    if (local?.block || (this.graphWriter && this.graphWriter !== graphBefore)) this.learnSolveWritten(opts);
    if (local || graphed) return local && local.steps.length === 0 && !graphed ? "nothing" : "local";
    // A lone expression already as simple as it goes (`2x^{2}`): there is nothing to solve, and a
    // model asked for its "solution" wrote the line back (dropped) or nothing — Solve looked dead.
    // The student is told what would make it a question instead.
    if (!opts.problem && this.alreadySimplest(built, opts)) {
      this.noteFor(opts.lineId, LIVE_COPY.solve.simplest);
      clientMetric("live.solve.simplest", { lineId: opts.lineId });
      return "nothing";
    }
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
      // ...unless it is no figure and sits on the row of the line asked about: the line's own big
      // writing, taken from it (`solveLineWithRow`)
      const row = this.engine && !this.isRealFigure(figure) ? this.inkRowOf(figure) : null;
      const asked = liveStore.lines.get()[opts.lineId];
      if (row && asked && built.states.some((s) => s.line.id === opts.lineId) && row.strokes.some((st) => asked.line.strokeIds.includes(st.id))) {
        this.solveLineWithRow(figure, row, built, fromLineId, opts);
        return "model";
      }
      this.startFigure(figure, opts, { built, fromLineId });
      return "model";
    }
    this.solveWithoutFigure(built, fromLineId, opts);
    return "model";
  }

  /**
   * A quiet note (`deps.notify`) about a request — only one the student made. Auto's own try at a
   * line (`autoLines`) that turns out to ask nothing says nothing: "This is as simple as it gets"
   * popped up unasked when Auto in Solve looked at `x^{2} + 3x + 5`, or Suggest's stuck pause at a
   * half-written `2x + 3`, as if the student had pressed something.
   */
  private noteFor(lineId: string, message: string): void {
    if (this.autoLines.has(lineId)) return;
    this.deps.notify(message);
  }

  /**
   * Solve's line is a lone expression in letters with nothing left to do to it (`engine.alreadySimplest`)
   * — written alone, or ended with `=` (`x^{2} + 3x + 5 =` asks no more than `x^{2} + 3x + 5`: the
   * engine leaves it unfinished, and Solve went on to ask a model about it).
   */
  private alreadySimplest(built: BuiltColumn, opts: SolveOpts): boolean {
    const asked = liveStore.lines.get()[opts.lineId] ?? built.states[built.states.length - 1];
    if (!asked?.latex) return false;
    const unfinished = asked.analysis?.kind === "incomplete" && endsWithEquals(asked.latex);
    if (asked.analysis?.kind !== "expression" && !unfinished) return false;
    return this.engine?.alreadySimplest?.(unfinished ? asked.latex.replace(/=\s*$/, "") : asked.latex) === true;
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

  /**
   * Solve / Help with a drawing the last thing touched. A real figure (`isRealFigure`) is read as a
   * figure (`startFigure`). Anything else is first read as a line of maths (`solveInkAsMaths`):
   * `2x2` written large on a phone was taken for three drawings, the figure model was asked what the
   * "figure" asks, said nothing, and the student got "Couldn't work this out" for 2 × 2. Only when
   * the ink is not maths the engine can answer does the figure model get its turn.
   */
  private askAboutDrawing(diagram: Diagram, opts: SolveOpts): void {
    if (this.isRealFigure(diagram) || !this.engine) {
      this.startFigure(diagram, opts);
      return;
    }
    // the pill says "Solving…" while the ink is read, as it does for the figure
    liveStore.status.set("checking");
    const ended = this.solvingStarted();
    const gen = this.generation;
    void this.solveInkAsMaths(diagram, opts, gen)
      .catch((err) => {
        console.warn("[live] reading the drawing as maths failed", err);
        return false;
      })
      .then((settled) => {
        // asked on a screen the student has left (or deleted): nothing more, here
        if (!ended()) return;
        if (!settled && this.started && this.diagrams.some((d) => d.id === diagram.id)) {
          this.startFigure(diagram, opts);
          return;
        }
        if (liveStore.status.get() !== "offline") liveStore.status.set("idle");
      });
  }

  /**
   * The drawing's ink — and the non-figure drawings and writing on its row, which is how large
   * writing comes apart (`inkRowOf`) — read as ONE line of maths, and answered by the engine alone
   * (`localSolve`): `= 4` beside `2x2`, or the note that `2x^{2}` has nothing to do. Never a model's
   * answer: ink that is not clearly maths goes on to the figure. True when that settled it (written,
   * a note, or the loop stopped); false: read it as a figure.
   *
   * `gen`: the runtime it was asked in. A screen switch (or delete) while the ink is hashed or read
   * settles it with nothing written: `= 4` for the screen the student left was written on the one
   * they went to (the writer writes on the current page).
   */
  private async solveInkAsMaths(diagram: Diagram, opts: SolveOpts, gen = this.generation): Promise<boolean> {
    const engine = this.engine;
    if (!engine) return false;
    const read = await this.readInkRow(diagram, this.inkRowOf(diagram), gen);
    if (read === "gone") return true;
    if (!read) return false;
    const { latex, row } = read;
    const hand = this.deps.handwritingEnabled();
    const local = localSolve(engine, [latex], 0, { handwriting: hand });
    clientMetric("live.figure.asMaths", { diagramId: diagram.id, source: local.source ?? "", kinds: diagram.kinds.join(","), strokes: row.strokes.length });
    if (local.source && local.steps.length > 0) {
      const key = `ink: ${latex}`;
      if (opts.onlyFirstStep || !this.hasHandSolution(diagram.id, key)) {
        if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return true;
        // beside the whole row of ink, not just the piece of it that was touched
        this.writeFigureSolution({ ...diagram, bounds: row.bounds }, null, opts, local.steps, key);
      }
      this.noteSuccess("solve", diagram.id);
      return true;
    }
    if (engine.alreadySimplest?.(latex)) {
      this.noteFor(opts.lineId, LIVE_COPY.solve.simplest);
      return true;
    }
    return false;
  }

  /**
   * A row of ink (`inkRowOf`) read as ONE line of maths: its latex and the engine's kind for it when
   * the recognizer is sure it is maths and the engine reads an expression, an equation or an
   * inequality — or a line left open for its answer (`incomplete`: `(x+y)^{2} =`, which `localSolve`
   * finishes); null when it is not (a picture's read); "gone" when the screen was left or the loop
   * stopped while it was hashed or read (`gen`: the runtime it was asked in).
   */
  private async readInkRow(
    diagram: Diagram,
    row: { strokes: InkStroke[]; bounds: Rect },
    gen: number,
  ): Promise<{ latex: string; kind: LineKind; row: { strokes: InkStroke[]; bounds: Rect } } | null | "gone"> {
    const engine = this.engine;
    if (!engine) return null;
    const gone = () => !this.started || this.generation !== gen;
    const line: InkLine = { id: diagram.id, strokeIds: row.strokes.map((st) => st.id), bounds: row.bounds, column: 0, row: 0, hash: "" };
    const payload = buildPayload(line, row.strokes);
    if (!payload) return null;
    const hash = await hashPayload(payload);
    if (gone()) return "gone";
    if (!this.deps.isOnline() && !this.deps.recognizer.peek(hash)) return null;
    const req: RecognizeRequest = { boardId: this.opts.boardId, lineId: `ink_${diagram.id}`, strokes: { x: payload.x, y: payload.y }, bounds: { w: payload.w, h: payload.h } };
    let res: RecognizeResponse;
    try {
      res = await this.deps.recognizer.recognize(req, hash);
    } catch {
      return gone() ? "gone" : null;
    }
    if (gone()) return "gone";
    const latex = (res.latex ?? "").trim();
    // a read the recognizer is not sure of is a picture's, not a line's
    if (!latex || res.kind !== "math" || res.confidence < LIVE_LIMITS.minConfidence) return null;
    let kind: LineAnalysis["kind"] | null = null;
    try {
      kind = engine.analyzeLine(latex, { mode: "answer" }).kind;
    } catch {
      kind = null;
    }
    if (kind !== "expression" && kind !== "equation" && kind !== "inequality" && kind !== "incomplete") return null;
    return { latex, kind, row };
  }

  /**
   * Solve on a line with a drawing on its row that is no figure (`isRealFigure`: open strokes with
   * nothing on them) — the line's own big writing, taken from it. `(x+y)^2 =` written 220 px tall on
   * a desktop had the strokes of its `x` taken for a drawing: the line was read without them, the
   * figure model was asked what the "figure" asks and rightly said nothing, and the worked solution
   * then asked for the line named an `x` the line did not have — the step interlock threw it away as
   * a symbol from nowhere, and the student got "Couldn't solve this one — try writing it again a bit
   * clearer" for a line they had written perfectly well.
   *
   * Now the row — the line and the drawing, and whatever else of no figure is level with them — is
   * read as ONE line (`readInkRow`), and Solve goes on with that line in place of the torn one: the
   * engine's answer under the work, or its note that there is nothing to do, else the model (the
   * word problem / worked solution paths), whose steps are checked against the whole line. Only ink
   * that does not read as maths goes to the figure model, as any drawing beside the work does.
   */
  private solveLineWithRow(figure: Diagram, row: { strokes: InkStroke[]; bounds: Rect }, built: BuiltColumn, fromLineId: string | undefined, opts: SolveOpts): void {
    // the pill says "Solving…" while the row is read, as it does for the figure
    liveStore.status.set("checking");
    const ended = this.solvingStarted();
    const gen = this.generation;
    void this.readInkRow(figure, row, gen)
      .catch((err) => {
        console.warn("[live] reading the line with the ink on its row failed", err);
        return null;
      })
      .then((read) => {
        // asked on a screen the student has left (or deleted): nothing more, here
        if (!ended() || read === "gone" || !this.started) return;
        if (!read) {
          if (this.diagrams.some((d) => d.id === figure.id)) this.startFigure(figure, opts, { built, fromLineId });
          else this.solveWithoutFigure(built, fromLineId, opts);
          return;
        }
        const whole = withLineRead(built, opts.lineId, read);
        clientMetric("live.solve.inkRow", { lineId: opts.lineId, diagramId: figure.id, kinds: figure.kinds.join(","), strokes: read.row.strokes.length });
        if (this.writeRowLocal(figure, whole, opts, read.latex)) {
          if (liveStore.status.get() !== "offline") liveStore.status.set("idle");
          return;
        }
        if (!this.deps.isOnline()) {
          this.deferLlm("solve", opts.lineId);
          return;
        }
        this.solveWithoutFigure(whole, fromLineId, opts);
      });
  }

  /**
   * `solveLineWithRow`'s engine half: the column with the line read whole (`whole`) solved locally
   * (`localSolve`) and written under the work, or the note that the line has nothing to do. False
   * when the engine has nothing: the model is asked.
   */
  private writeRowLocal(figure: Diagram, whole: BuiltColumn, opts: SolveOpts, latex: string): boolean {
    const engine = this.engine;
    if (!engine) return false;
    const idx = whole.states.findIndex((s) => s.line.id === opts.lineId);
    const local = localSolve(
      engine,
      whole.states.map((s) => s.latex),
      idx === -1 ? undefined : idx,
      { handwriting: this.deps.handwritingEnabled() },
    );
    if (local.source && local.steps.length > 0) {
      const key = `ink: ${latex}`;
      if ((opts.onlyFirstStep || !this.hasHandSolution(opts.lineId, key)) && liveStore.liveShapeCount.get() < LIVE_LIMITS.maxLiveShapesPerBoard) {
        this.writeFigureSolution(figure, whole, opts, local.steps, key);
      }
      this.noteSuccess("solve", opts.lineId);
      return true;
    }
    if (engine.alreadySimplest?.(latex)) {
      this.noteFor(opts.lineId, LIVE_COPY.solve.simplest);
      return true;
    }
    return false;
  }

  /**
   * The drawing's strokes and labels, and every stroke on the same row as them that is no figure's:
   * level with the ink gathered so far (overlapping half its height) and within a glyph-sized gap of
   * it, grown until nothing more joins. `2x2` written with a finger came apart into a `2` (a
   * drawing), an `x` (labels, or a line of its own) and a `2`: read alone, the touched piece is `2`.
   */
  private inkRowOf(diagram: Diagram): { strokes: InkStroke[]; bounds: Rect } {
    const ink = this.collectInk();
    const figures = new Set<string>(this.diagrams.filter((d) => d.id !== diagram.id && this.isRealFigure(d)).flatMap((d) => [...d.strokeIds, ...d.labels.flat()]));
    const members = new Set<string>([...diagram.strokeIds, ...diagram.labels.flat()]);
    const own = ink.filter((st) => members.has(st.id));
    let box = own.length > 0 ? unionRects(own.map((st) => st.bounds)) : diagram.bounds;
    for (let grown = true; grown; ) {
      grown = false;
      for (const st of ink) {
        if (members.has(st.id) || figures.has(st.id)) continue;
        const b = st.bounds;
        const overlap = Math.min(b.y + b.h, box.y + box.h) - Math.max(b.y, box.y);
        const gap = Math.max(0, b.x - (box.x + box.w), box.x - (b.x + b.w));
        if (overlap < 0.5 * Math.min(b.h, box.h) || gap > Math.max(box.h, 2 * this.glyph)) continue;
        members.add(st.id);
        box = unionRects([box, b]);
        grown = true;
      }
    }
    return { strokes: ink.filter((st) => members.has(st.id)), bounds: box };
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
   * drawing, the pill says it could not work it out, with Retry — unless the model said nothing on it
   * asks for anything (`reason: "nothing_asked"`), which is no failure: a quiet note on what to write
   * (`deps.notify`). Unasked, every outcome but an answer is silent.
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
    const ended = this.solvingStarted();
    void (async () => {
      /** written: on the page; fallback: nothing usable; nothing: the model says nothing is asked; stop: nothing more to do */
      let outcome: "written" | "fallback" | "nothing" | "stop" = "fallback";
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
            // the model read it and nothing on it asks for anything: not a failure, nothing to write
            else if (res.reason === "nothing_asked") outcome = "nothing";
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
        ended();
      }
      clientMetric("live.figure", { outcome, reason, source, called, unasked, ms: this.deps.now() - startedAt, lineId: opts.lineId, kinds: diagram.kinds.join(","), fromLine: Boolean(from) });
      if ((outcome === "fallback" || outcome === "nothing") && !ctrl.signal.aborted && this.started && !unasked) {
        if (from) {
          this.solveWithoutFigure(from.built, from.fromLineId, opts);
          return;
        }
        // Asked on the drawing. Nothing asked is what to write next, quietly — the red card and its
        // Retry would say something broke, and asking again would only be told the same.
        if (outcome === "nothing") this.noteFor(opts.lineId, LIVE_COPY.solve.nothingAsked);
        else this.fail(sseFailure({ error: "unusable_steps", message: SOLVE_FAILED }), errCtx, retry);
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
      // the learning record: the tutor's answer about the work (a drawing's own answer is no problem's)
      this.learnSolveWritten(opts);
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

  /**
   * A drawing the unasked path may look at: labelled, a real figure (`isRealFigure`; not a graph's
   * axes), not being solved, nothing written beside it. Every pause in Solve used to send any
   * labelled "drawing" to the figure model — writing the board took for a drawing included — and
   * every such call came back with nothing.
   */
  private figureWanted(d: Diagram): boolean {
    if (d.labels.length === 0 || d.kinds.includes("axes") || d.kinds.includes("numberLine")) return false;
    return this.isRealFigure(d) && !this.runtime(d.id).solveAbort && this.nothingBeside(d);
  }

  /**
   * A drawing that is a figure, as `splitInk` sees it: a closed shape (a triangle, a quadrilateral,
   * a polygon, a circle), or lines carrying marks (an angle arc, a right-angle box, ticks) — angles
   * on a line, parallel lines. Axes and a number line are drawings too, a graph's. What is left —
   * open strokes with nothing on them — is as likely to be large writing (`2x2` written with a
   * finger on a phone came out as three "drawings") as a picture.
   */
  private isRealFigure(d: Diagram): boolean {
    if (d.kinds.some((k) => FIGURE_SHAPES.has(k) || k === "axes" || k === "numberLine")) return true;
    return d.strokeIds.some((id) => this.markStrokeIds.has(id));
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
    if (!unaskedFigureLabels(labels)) return;
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
    const size = handSizeFor(3 * this.glyph, this.boardZoom());
    const k = this.handScale();
    const { plan, unsupported } = planHandwriting(steps, { size, seed: handSeedFor(diagram.id) });
    if (!plan || unsupported.length > 0) return false;
    const b = diagram.bounds;
    const screen = this.placementBounds();
    let candidate: Rect = { x: rectMaxX(b) + PLACEMENT.sideGap * k, y: b.y, w: plan.bounds.w, h: plan.bounds.h };
    if (rectMaxX(candidate) > rectMaxX(screen) - PLACEMENT.viewportMargin) {
      candidate = keepInsideX({ x: b.x, y: rectMaxY(b) + PLACEMENT.stepGap * k, w: plan.bounds.w, h: plan.bounds.h }, screen);
    }
    const avoid = this.avoidRects(diagram.id);
    avoid.push(b);
    const slot = findFreeSlot(candidate, avoid, b, "below", k);
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
    const ended = this.solvingStarted();
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
        ended();
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
    this.learnSolveWritten(opts);
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
    // A line the student ended with `=` is the question: the model is told which one, so it finishes
    // that line (its step is written after that `=`, `continuedLine`) rather than "going on" from the
    // `x = 3` under it — which is how `= 3(x+8)` came to be written under an `x = 3`.
    const asks = this.askingLine(built, opts.lineId);
    const req: SolveRequest = {
      boardId: this.opts.boardId,
      region: built.region,
      lines: built.lines,
      fromLineId,
      ...(asks ? { goal: `what line id ${asks.line.id} equals (${asks.latex.slice(0, 80)}): continue it after its =, using any values the other lines give`.slice(0, 200) } : {}),
    };
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
    const ended = this.solvingStarted();
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
        if (accepted.length > 0 && (doneEarly || !ctrl.signal.aborted)) this.writeModelSteps(built, opts, accepted);
        // The model answered, but nothing it said survived the interlock. Better to say so than
        // to leave the student staring at a page where Solve visibly did nothing.
        if (!failed && drawn === 0 && discarded > 0) {
          failed = true;
          this.fail(sseFailure({ error: "unusable_steps", message: SOLVE_FAILED }), errCtx, retry);
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
        ended();
        if (!failed && (doneEarly || !ctrl.signal.aborted)) this.noteSuccess("solve", opts.lineId);
        if (liveStore.status.get() !== "offline") liveStore.status.set("idle");
      }
    })();
  }

  /**
   * The model's verified steps, replacing any earlier solution for this work: in the tutor's
   * hand when every step can be drawn, typeset only when the hand lacks a symbol.
   */
  private writeModelSteps(built: { states: LiveLineState[] }, opts: SolveOpts, steps: string[]): void {
    const state = liveStore.lines.get()[opts.lineId] ?? built.states[built.states.length - 1];
    if (opts.problem) {
      // the model's worked solution of a problem the chat wrote: continued after the tutor's own work there
      const written = this.writeProblemLocal(built, opts, opts.problem, state, steps, liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard);
      if (written.block) this.learnSolveWritten(opts);
      return;
    }
    // the learning record: the model's steps for the student's work, written below
    this.learnSolveWritten(opts);
    this.clearSolveOutput(built.states.map((s) => s.line.id));
    if (this.deps.handwritingEnabled() && state && this.drawStepsByHand(built, opts, state, steps)) return;
    this.typesetSteps(built, opts, steps);
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
        canDraw: (steps) => planHandwriting(steps, { size: handSizeFor(state.line.bounds.h, this.boardZoom()), seed: handSeedFor(opts.lineId) }).unsupported.length === 0,
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
      // `3x + 24 =` over `x = 3`: the answer is that line's, finished after its `=` (`drawStepsByHand`)
      const line = local.line === undefined ? undefined : built.states[local.line];
      const answered = line ?? state;
      // `36 + 2 =`: the tutor may already have finished it (inline, or Solve pressed twice)
      if (this.answerBlocksFor(answered.line.id).some((s) => answerLatexOf(s.meta) === local.answer)) return written();
      if (atCap) return written();
      const meta = this.answerMeta(answered, local.answer);
      const handBlock = hand ? this.drawStepsByHand(built, opts, state, steps, meta, line) : null;
      if (handBlock) return written(handBlock);
      this.typesetSteps(built, opts, steps, line ? meta : undefined, line, 0);
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
   * A block that continues a line the student ended with `=` (`continuedLine`: it starts with
   * `=`, `= 3(x + 8)`) is that line's, wherever the work goes on under it. The owner's board
   * wrote the model's `= 3(x+8)` for `3x + 24 =` on the free row under the `x = 3` below it, where
   * it read `x = 3 = 3(x+8)`. So when that line is not the last of the work: one step goes after its
   * `=`, as `inlineAnswer` writes `38` after `36 + 2 =`; else the block goes straight under it when
   * it fits there as it is; else under the work as any block, its first line restated as that line
   * (`3x + 24 = 3(x + 8)`), which reads as nothing else. `continues` names the line (Solve's
   * answer to the line the givens evaluate, `localSolve`'s `line`); without it, the asked-for line
   * when it ends with `=`, else the nearest line above it that does.
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
    continues?: LiveLineState,
  ): { rect: Rect; wallMs: number } | null {
    if (opts.problem) return this.drawProblemWork(built, opts, opts.problem, state, steps, extraMeta);
    // the student's size, on this board (`handSizeFor`'s zoom: a phone's writing is 5x a desktop's in page px)
    const size = handSizeFor(state.line.bounds.h, this.boardZoom());
    const k = this.handScale();
    const wall = (plan: HandPlan) => (this.deps.reducedMotion() ? 0 : wallMsOf(plan));
    const cont = this.continuedLine(built, opts.lineId, steps, continues);
    if (cont && steps.length === 1) {
      const inline = this.planInlineAnswer(cont, withoutRelation(steps[0]));
      if (inline) {
        this.startHandwriting(inline, opts.lineId, extraMeta);
        return { rect: inline.bounds, wallMs: wall(inline) };
      }
    }
    const seed = handSeedFor(opts.lineId);
    let { plan, unsupported } = planHandwriting(steps, { size, seed });
    if (!plan || unsupported.length > 0) return null;

    const lastLine = built.states[built.states.length - 1].line.bounds;
    const column = unionRects(built.states.map((s) => s.line.bounds));
    // avoidRects skips this line's own ink and echo; for a block written *under* the work they
    // are obstacles like any other, so they go back in — and so does every line of the work.
    const avoid = this.avoidRects(opts.lineId);
    avoid.push(state.line.bounds, ...built.states.map((s) => s.line.bounds));
    const echo = this.echoRect(opts.lineId);
    if (echo) avoid.push(echo);
    if (cont) {
      // straight under the line it continues, when it fits there without moving
      const under: Rect = { x: cont.line.bounds.x, y: rectMaxY(cont.line.bounds) + PLACEMENT.stepGap * k, w: plan.bounds.w, h: plan.bounds.h };
      if (!avoid.some((r) => rectsIntersect(r, under))) {
        const block = placeHandPlan(plan, { x: under.x, y: under.y });
        this.startHandwriting(block, opts.lineId, extraMeta);
        return { rect: block.bounds, wallMs: wall(plan) };
      }
      // under the work, its first line restated as the line it continues
      ({ plan, unsupported } = planHandwriting(restated(cont.latex, steps), { size, seed }));
      if (!plan || unsupported.length > 0) return null;
    }
    const candidate: Rect = {
      x: column.x,
      y: rectMaxY(lastLine) + PLACEMENT.stepGap * k,
      w: plan.bounds.w,
      h: plan.bounds.h,
    };
    // Under the work, a blocked block slides down past what is in the way; moved beside the work
    // (no room below on this screen), it slides right as an echo does.
    const placed = keepOnScreen(candidate, this.screenRect(), column, 0, PLACEMENT.sideGap * k);
    const slot = findFreeSlot(placed, avoid, lastLine, placed.x === candidate.x ? "below" : "right", k);

    const block = placeHandPlan(plan, { x: slot.x, y: slot.y });
    this.startHandwriting(block, opts.lineId, extraMeta);
    clientMetric("live.solve.hand.ms", { ms: Math.round(wallMsOf(plan)), lineId: opts.lineId });
    return { rect: block.bounds, wallMs: wall(plan) };
  }

  /**
   * The typeset form of `drawStepsByHand` (the hand is off, or lacks a glyph): `placeSolutionStep`
   * under the work from step `first` on — a block continuing a line ending in `=` straight under
   * that line when it fits there, else restated as it (`3x + 24 = 33`). Never under a later line,
   * where `= 33` read as the end of the `x = 3` above it.
   */
  private typesetSteps(built: { states: LiveLineState[] }, opts: SolveOpts, steps: readonly string[], extraMeta?: JsonObject, continues?: LiveLineState, first = 1): void {
    const lastLine = built.states[built.states.length - 1].line.bounds;
    const column = unionRects(built.states.map((s) => s.line.bounds));
    const cont = this.continuedLine(built, opts.lineId, steps, continues);
    if (!cont) {
      steps.forEach((step, i) => this.placeSolutionStep(column, lastLine, i + first, step, "", opts.lineId, extraMeta));
      return;
    }
    const block: Rect = {
      x: column.x,
      y: rectMaxY(cont.line.bounds) + PLACEMENT.stepGap,
      w: Math.max(...steps.map((st) => estimateEchoWidth(st))),
      h: steps.length * PLACEMENT.stepPitch,
    };
    const avoid = [...this.avoidRects(opts.lineId), ...built.states.map((s) => s.line.bounds)];
    const fits = !avoid.some((r) => rectsIntersect(r, block));
    const lines = fits ? steps : restated(cont.latex, steps);
    lines.forEach((step, i) => this.placeSolutionStep(column, fits ? cont.line.bounds : lastLine, i + 1, step, "", opts.lineId, extraMeta));
  }

  /**
   * The line the student ended with `=` that `steps` continue, when it is not the last line of the
   * work (under the last line, a block is straight under it already): `continues` when given,
   * else `askingLine`'s. Null when the block does not start with `=` (`3(3) + 24`, `x = 4`: a line
   * of its own).
   */
  private continuedLine(built: { states: LiveLineState[] }, askedId: string, steps: readonly string[], continues?: LiveLineState): LiveLineState | null {
    if (steps.length === 0 || !/^\s*=/.test(steps[0])) return null;
    const cont = continues && endsWithEquals(continues.latex) ? continues : this.askingLine(built, askedId);
    const last = built.states[built.states.length - 1];
    return cont && last && last.line.id !== cont.line.id ? cont : null;
  }

  /**
   * The line of the work that asks what it equals: the asked-for line when the student ended it with
   * `=`, else the nearest line above it that they did (`3x + 24 =` over the `x = 3` Solve was asked
   * on). Null when no line of the work ends with `=`.
   */
  private askingLine(built: { states: LiveLineState[] }, askedId: string): LiveLineState | null {
    const states = built.states;
    const asked = states.findIndex((s) => s.line.id === askedId);
    for (let i = asked === -1 ? states.length - 1 : asked; i >= 0; i--) if (endsWithEquals(states[i].latex)) return states[i];
    return null;
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
   *
   * With Auto off, nothing is written on a line the student has not asked about (`autoFor`): a mark
   * already on the page that still fits it stays (a tick from before, after a reload), one that no
   * longer fits still goes (a ring on a line they have since put right).
   */
  private syncMark(state: LiveLineState, kind: MarkKind | null, why?: UnjudgedReason, learn = true): void {
    // the learning record hears the mark decided, drawn or not (the hand off, Auto off, the cap)
    if (learn) this.learnLine(state, kind);
    const lineId = state.line.id;
    const rt = this.runtime(lineId);
    const at = kind ? this.markRect(state, kind) : state.line.bounds;
    const want = kind && this.deps.handwritingEnabled() ? markKey(kind, at) : null;
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
      if (!this.autoFor(state)) {
        // unasked with Auto off: none written, and none remembered, so an ask writes it
        this.runtime(lineId).markKey = null;
        return this.markDone(lineId, null);
      }
      const plan = planFromStrokes(kind, markStrokes(kind, at, handSeedFor(`${lineId}:${want}`)), HAND_WRITE.minSize);
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
          // a problem's work finished: the next ask is about the next problem, and the outline says so
          if (lineId.startsWith("problem:")) this.publishHelpTarget({ quiet: true });
        }
        // a figure waiting for the hand to be free is written after it
        if (this.settled && this.writer === null && this.autoOn()) this.solveWantedFigures();
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

  /**
   * One more request the pill's "Solving…" counts (`liveStore.solving`). The function returned
   * counts it off, once, and says whether it was still this runtime's: after a reset (`generation`:
   * a screen left or deleted) the count was zeroed with it, and counting off the old screen's request
   * took one of the new screen's — a solve in flight there looked finished, and Auto, which waits
   * for none (`autoMayAnswer`), started another alongside it.
   */
  private solvingStarted(): () => boolean {
    const gen = this.generation;
    liveStore.solving.set(liveStore.solving.get() + 1);
    let open = true;
    return () => {
      const mine = gen === this.generation;
      if (open && mine) liveStore.solving.set(Math.max(0, liveStore.solving.get() - 1));
      open = false;
      return mine;
    };
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
      busy: () => {
        liveStore.status.set("checking");
        const ended = this.solvingStarted();
        return () => {
          if (ended() && liveStore.status.get() !== "offline") liveStore.status.set("idle");
        };
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
    const size = handSizeFor(read.lineHeight, this.boardZoom());
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
          // the screen the block is written on (the learning record's problem key)
          const page = this.pageKey();
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
              // one of the chat's problems, on the page: the learning record has a new problem
              this.learnProblemWritten(extraMeta, page, writer);
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
        // a problem typeset (the hand is off): the learning record has a new problem
        this.learnProblemWritten(extraMeta, this.pageKey(), null);
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

  /**
   * A chat reply's actions, written one block at a time; resolves when the last is on the page.
   * `from`: where the problems it writes come from, for the learning record (the board chat's own by
   * default; the onboarding's starter, a practice board, Now you try say so).
   */
  runChatActions(actions: readonly ChatAction[], from?: ChatRunOrigin): Promise<ChatRunReport> {
    // typed into the chat is asked for: what fails is shown, whatever Auto did on those lines
    this.autoLines.clear();
    this.chatOrigins.push(from ?? CHAT_PROBLEM_ORIGIN);
    const run = this.chat.run(actions);
    // Its origin goes when it ends — before the next run starts (`ChatDesk.exclusive` chains each on
    // the one before, and this reaction is queued ahead of that one's start).
    void run.then(
      (report) => {
        this.chatOrigins.shift();
        this.learnChatRun(actions, report);
      },
      () => {
        this.chatOrigins.shift();
      },
    );
    return run;
  }

  // ---------------------------------------------------------------- the learning record
  //
  // What the board tells the learning tracker (`learningBus`, `src/lib/learning`), at the moments the
  // loop already knows about: a problem the chat wrote, a line's mark decided or changed, a mistake
  // the model named, the tutor's help, the tutor finishing a problem, a screen left, the board
  // closed. Each is cheap, and none is ever thrown into the loop: the record is never worth the board.
  //
  // `problemKey` names one problem on one screen, and stays the same while the problem is there:
  //  - one of the chat's problems: `<page>#cell:<cell key>`. The cell's key is the problem's own hand
  //    block, on every stroke of it (`readProblemCells`): it outlives the student's work under it,
  //    the columns being clustered again and a reload, and every line under it is in its column;
  //  - the student's own: `<page>#ink:<line id>`, the id of its column's head line when the problem
  //    was first seen. Every line of the column keeps the key it was given (`learnKeys`), and a line
  //    new to it takes the key of its topmost line that has one: so the key outlives the head being
  //    rewritten (a new id), lines added, rubbed out or read again, and the column being clustered
  //    again (a problem's lines stay together, `problemMates`). A problem below a blank gap is a new
  //    column with a key of its own. Line ids survive a reload (the readback keeps them);
  //  - a worked solution the chat taught: `<page>#teach:<seed of its steps>`.
  // Never the tutor's own ink (it is no line), a readback brought back by a load or a screen switch
  // (`learnFresh`), a proof's rows, or lecture mode's writing.

  /** Tells the learning record (`learningBus`); never throws into the loop. */
  private learn(signal: LearningSignal): void {
    try {
      learningBus.emit(signal);
    } catch {
      // the record is never worth the board
    }
  }

  /** What is being written for this line is Auto's: it is acting now (`autoRun`), or a solve it started lands. */
  private learnAutoFor(lineId: string): boolean {
    return this.learnAuto || this.autoLines.has(lineId);
  }

  /** The learning record's key for the problem a student line is in (see above). */
  private learnKeyFor(state: LiveLineState): string {
    const page = this.pageKey();
    const head = this.columnHeads.get(state.line.column);
    if (head) return `${page}#cell:${head.key}`;
    // a line keeps the key it was given, even in a column clustered together with another problem
    const own = this.learnKeys.get(state.line.id);
    if (own) return own;
    const col = this.columnLines(state.line.column);
    let key: string | undefined;
    for (const s of col) {
      key = this.learnKeys.get(s.line.id);
      if (key) break;
    }
    key ??= `${page}#ink:${(col[0] ?? state).line.id}`;
    for (const s of col) if (!this.learnKeys.has(s.line.id)) this.learnKeys.set(s.line.id, key);
    if (!this.learnKeys.has(state.line.id)) this.learnKeys.set(state.line.id, key);
    forgetOldest(this.learnKeys);
    return key;
  }

  /** The problem a line is in, as LaTeX: one of the chat's, or the student's head line (the first that is not a label, an operation or unread). */
  private learnProblemOf(state: LiveLineState): string[] {
    const head = this.columnHeads.get(state.line.column);
    if (head) return [...head.lines];
    const col = this.columnLines(state.line.column).filter((s) => s.latex);
    const first = col.find((s) => !LEARN_NOT_HEAD.has(s.analysis?.kind ?? "unknown")) ?? col[0];
    return first ? [first.latex] : [];
  }

  /** One of the chat's problems, as the record names it. */
  private learnCell(cell: ProblemCell): { key: string; problem: string[] } {
    return { key: `${this.pageKey()}#cell:${cell.key}`, problem: [...cell.lines] };
  }

  /** The problem `lineId` is in: a line of the student's, or one of the chat's problems (`problem:<key>`, the tutor working it). */
  private learnTargetOf(lineId: string): { key: string; problem: string[] } | null {
    const state = liveStore.lines.get()[lineId];
    if (state) return { key: this.learnKeyFor(state), problem: this.learnProblemOf(state) };
    const cell = lineId.startsWith("problem:") ? this.problemCells().find((c) => problemLineId(c) === lineId) : undefined;
    return cell ? this.learnCell(cell) : null;
  }

  /**
   * The mark the record takes for a line: the one decided (`syncMark`'s, drawn or not). In Off, or at
   * the shape cap, the tutor draws no tick or ring at all: then the one its verdict gives, as
   * Feedback would draw it — a student working with the dial at Off still has a record.
   */
  private learnMarkOf(state: LiveLineState, decided: MarkKind | null): LineMark {
    if (this.opts.mode !== "off" && liveStore.liveShapeCount.get() < LIVE_LIMITS.maxLiveShapesPerBoard) return decided;
    if (decided === "question") return decided;
    const badge = badgeFor("feedback", state.analysis);
    if (badge === "ok" || badge === "solved") return "check";
    return badge === "warn" || this.modelFlagged(state) ? "circle" : decided;
  }

  /** A first line under one of the chat's one-line problems: the problem is the line above it. */
  private learnHeadAbove(state: LiveLineState): string | undefined {
    const head = this.columnHeads.get(state.line.column);
    return head && head.lines.length === 1 ? head.lines[0] : undefined;
  }

  /**
   * A student line's mark was decided (`syncMark`): the record hears the line when what it says about
   * it changes — its read, its kind, its mark, whether it is the answer — and only for work of this
   * session: a line brought back from its readback says nothing until a line of its problem is new.
   */
  private learnLine(given: LiveLineState, decided: MarkKind | null): void {
    try {
      const state = liveStore.lines.get()[given.line.id];
      if (!this.started || !state?.latex) return;
      const id = state.line.id;
      const mark = this.learnMarkOf(state, decided);
      const solved = Boolean(state.analysis?.solved) && mark === "check";
      const kind = state.analysis?.kind ?? "unknown";
      const problemKey = this.learnKeyFor(state);
      const said = `${problemKey}\n${state.latex}\n${kind}\n${mark ?? ""}\n${solved}`;
      // most renders change nothing: they stop here
      if (this.learnSent.get(id) === said) return;
      if (this.proofs.owns(id)) return;
      // a readback stays quiet, and unsent, until a line of its problem is new: then it is told
      if (!this.learnFresh.has(id) && !this.columnLines(state.line.column).some((s) => this.learnFresh.has(s.line.id))) return;
      this.learnSent.set(id, said);
      forgetOldest(this.learnSent);
      const previous = this.previousLine(state)?.latex ?? this.learnHeadAbove(state);
      this.learn({
        type: "line",
        at: this.deps.now(),
        boardId: this.opts.boardId,
        pageId: this.pageKey(),
        problemKey,
        problemLatex: this.learnProblemOf(state),
        lineId: id,
        latex: state.latex,
        kind,
        ...(previous ? { previousLatex: previous } : {}),
        mark,
        solved,
      });
    } catch {
      // the record is never worth the board
    }
  }

  /** The tutor wrote for a problem: its next step, or the rest of it — which finishes it. */
  private learnTutor(target: { key: string; problem: string[] } | null, depth: "step" | "solve", auto: boolean): void {
    if (!target) return;
    const at = this.deps.now();
    this.learn({ type: "help", at, problemKey: target.key, help: depth === "step" ? "next_step" : "solve", auto });
    if (depth === "solve") {
      this.learn({ type: "tutor_solved", at, boardId: this.opts.boardId, pageId: this.pageKey(), problemKey: target.key, problemLatex: target.problem });
    }
  }

  /** The tutor wrote for the problem `lineId` is in (`learnTutor`). */
  private learnWrote(lineId: string, depth: "step" | "solve", auto: boolean = this.learnAutoFor(lineId)): void {
    try {
      this.learnTutor(this.learnTargetOf(lineId), depth, auto);
    } catch {
      // the record is never worth the board
    }
  }

  /** Solve's paths wrote something new for `opts` (`solveBuilt` and the model's replies): a step (Help), or the rest. */
  private learnSolveWritten(opts: SolveOpts): void {
    try {
      const target = opts.problem ? this.learnCell(opts.problem.cell) : this.learnTargetOf(opts.lineId);
      this.learnTutor(target, opts.onlyFirstStep ? "step" : "solve", this.learnAutoFor(opts.lineId));
    } catch {
      // the record is never worth the board
    }
  }

  /** The answer after a line's `=`, written by the tutor (`inlineAnswer`): the line, then the tutor finishing it. */
  private learnInlineAnswer(state: LiveLineState): void {
    // the line first: render marks it only after the answer has started
    this.learnLine(state, null);
    // asked (Solve it) since the student last wrote, or the settle's own
    this.learnWrote(state.line.id, "solve", !this.askedSinceInk);
  }

  /** A graph sketched as Help's answer on a line that is fine: a hint. */
  private learnHint(lineId: string): void {
    try {
      const target = this.learnTargetOf(lineId);
      if (target) this.learn({ type: "help", at: this.deps.now(), problemKey: target.key, help: "hint", auto: this.learnAutoFor(lineId) });
    } catch {
      // the record is never worth the board
    }
  }

  /**
   * A model check rang a line (`applyAnnotation`): the kind of mistake it named, when it is one the
   * record counts — and, when the student asked for the check, its words (the line's note) are a hint.
   * A check Auto ran is a mark like the engine's ring, not help.
   */
  private learnAnnotation(state: LiveLineState, a: Annotation, userAsked: boolean): void {
    try {
      const target = this.learnTargetOf(state.line.id);
      if (!target) return;
      const at = this.deps.now();
      const kind = (MISTAKE_KINDS as readonly string[]).includes(a.kind) ? (a.kind as (typeof MISTAKE_KINDS)[number]) : null;
      if (kind) this.learn({ type: "mistake", at, problemKey: target.key, lineId: state.line.id, kind, source: "model" });
      if (userAsked) this.learn({ type: "help", at, problemKey: target.key, help: "hint", auto: false });
    } catch {
      // the record is never worth the board
    }
  }

  /**
   * An explicit ask (`noteAsked`: Help me, Solve it, a check, a badge): about the line asked on, else
   * what Help would act on — the line written last (its problem), or one of the chat's problems.
   */
  private learnAsk(lineId?: string): void {
    try {
      if (!this.started || !this.opts.enabled || this.opts.mode === "off") return;
      let target: { key: string; problem: string[] } | null = null;
      if (lineId) target = this.learnTargetOf(lineId);
      else if (!this.helpTargetDiagram()) {
        const line = this.askedLine(this.helpTargetLine());
        if (line && (this.actsOn(line) || this.columnHeads.has(line.line.column))) target = this.learnTargetOf(line.line.id);
        else {
          const pick = this.problemPick(this.opts.mode === "answer" ? "solve" : "step");
          if (pick && pick.kind !== "none") target = this.learnCell(pick.cell);
          else if (line) target = this.learnTargetOf(line.line.id);
        }
      }
      if (target) this.learn({ type: "help", at: this.deps.now(), problemKey: target.key, help: "ask", auto: false });
    } catch {
      // the record is never worth the board
    }
  }

  /** A chat request about one of the chat's problems (`chatHelp`): an ask. */
  private learnAskCell(cell: ProblemCell): void {
    try {
      this.learn({ type: "help", at: this.deps.now(), problemKey: this.learnCell(cell).key, help: "ask", auto: false });
    } catch {
      // the record is never worth the board
    }
  }

  /**
   * One of the chat's problems was written (`chatHost.write` / `typeset`, a block carrying its problem
   * meta): a new problem, from where the run writing it says (`chatOrigins`). Its key is the block's,
   * read off its strokes once they are on the page (the writer's last write is queued just before).
   */
  private learnProblemWritten(meta: JsonObject | undefined, page: string, writer: HandWriter | null): void {
    try {
      const p = problemMetaOf(meta);
      if (!p) return;
      const at = this.deps.now();
      const from = this.chatOrigins[0] ?? CHAT_PROBLEM_ORIGIN;
      const tell = (block: string) => {
        const problemKey = `${page}#cell:${problemKeyOf(block, p)}`;
        if (this.learnProblems.has(problemKey)) return;
        this.learnProblems.add(problemKey);
        forgetOldest(this.learnProblems);
        this.learn({
          type: "problem",
          at,
          boardId: this.opts.boardId,
          pageId: page,
          problemKey,
          problemLatex: [...p.lines],
          origin: from.origin,
          ...(from.parentId ? { parentId: from.parentId } : {}),
        });
      };
      if (!writer) {
        tell("");
        return;
      }
      queueMicrotask(() => {
        try {
          const block = writer.shapeIds.map((id) => handBlockOf(this.editor.getShape(id)?.meta)).find(Boolean) ?? "";
          tell(block);
        } catch {
          // the record is never worth the board
        }
      });
    } catch {
      // the record is never worth the board
    }
  }

  /** A chat run ended: each worked solution it taught (`teach`) is a problem the tutor solved. */
  private learnChatRun(actions: readonly ChatAction[], report: ChatRunReport): void {
    try {
      actions.forEach((action, i) => {
        if (action.type !== "teach" || !report.outcomes[i]?.ok) return;
        const maths = action.steps.flatMap((s) => s.math ?? []);
        const problem = maths.length > 0 ? [maths[0]] : action.answer ? [action.answer] : [];
        if (problem.length === 0) return;
        const page = this.pageKey();
        const problemKey = `${page}#teach:${handSeedFor(`${JSON.stringify(action.steps).slice(0, 400)}|${action.answer ?? ""}`)}`;
        const at = this.deps.now();
        const base = { at, boardId: this.opts.boardId, pageId: page, problemKey, problemLatex: problem };
        this.learn({ type: "problem", ...base, origin: "teach" });
        this.learn({ type: "help", at, problemKey, help: "solve", auto: false });
        this.learn({ type: "tutor_solved", ...base, origin: "teach" });
      });
    } catch {
      // the record is never worth the board
    }
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

  // ---------------------------------------------------------------- which problem Help acts on
  /**
   * The line Help me and Solve it act on (and Check, Solve steps and the chat's "help me" on the
   * student's own work): what they picked with the select tool when that holds a line of theirs, else
   * the line they last wrote in with the pen (`src/lib/live/helpTarget.ts`). Rubbing out, dragging,
   * Undo or a remote change elsewhere re-read lines, but never move it. A pick of one of the chat's
   * problems is the student's work under it — undefined with none yet, and Help then works the
   * problem itself (`targetProblem`); a pick of a drawing is the drawing (`helpTargetDiagram`).
   */
  helpTargetLine(): LiveLineState | undefined {
    const picked = this.picked();
    if (!picked) return this.wroteLine();
    if (picked.line) return picked.line;
    const cell = picked.problem ? this.problemCells().find((c) => c.key === picked.problem) : undefined;
    return (cell && this.workUnder(cell)) || undefined;
  }

  /** A fresh stroke of the student's pen: Help follows it (over an older pick). */
  private wrote(strokeId: string): void {
    this.penStrokeId = strokeId;
    this.penSeq = this.pickSeq + 1;
  }

  /** The line the pen last wrote in on this screen; before it has written there, the line read last. */
  private wroteLine(): LiveLineState | undefined {
    return penLine(liveStore.lines.get(), this.penStrokeId, this.penLineId) ?? this.latestLine();
  }

  /** The drawing Help reads: the one picked, else the one drawn last — none when something else is picked. */
  private helpTargetDiagram(): Diagram | null {
    const picked = this.picked();
    return picked ? picked.diagram : this.touchedDiagram();
  }

  /** The chat's problem an ask is about ("the current problem", `chat/work.ts`): the one picked, else the one written under last. */
  private targetProblem(): string | null {
    return this.picked()?.problem ?? this.touchedProblem;
  }

  /**
   * What the student picked with the select tool (a tap, a lasso), when Help can act on it: a line
   * of theirs — its ink, its readback, anything the tutor wrote for it — one of the chat's problems
   * (or the tutor's work under one), or a drawing. Null with nothing selected, nothing of these (a
   * sticky note, a picture), or a pick the pen has written since: Help follows the pen.
   */
  private picked(): { line: LiveLineState | null; diagram: Diagram | null; problem: string | null } | null {
    const ids = this.penSeq > this.pickSeq ? [] : (this.editor.getSelectedShapeIds?.() ?? []);
    if (ids.length === 0) return null;
    const lines = liveStore.lines.get();
    const byStroke = new Map<string, LiveLineState>();
    for (const st of Object.values(lines)) for (const sid of st.line.strokeIds) byStroke.set(sid, st);
    const mine: LiveLineState[] = [];
    let diagram: Diagram | null = null;
    let problem: string | null = null;
    for (const id of ids) {
      const shape = this.editor.getShape(id);
      if (!shape) continue;
      if (!isLiveMeta(shape.meta)) {
        const st = byStroke.get(id);
        if (st) mine.push(st);
        else diagram ??= this.diagramOfStroke(id);
        continue;
      }
      const lineId = shape.meta.lineId;
      const p = problemMetaOf(shape.meta);
      if (p) problem ??= problemKeyOf(handBlockOf(shape.meta), p);
      // the tutor's work under one of the chat's problems (`problemLineId`)
      else if (lineId.startsWith("problem:")) problem ??= lineId.slice("problem:".length);
      else if (lines[lineId]) mine.push(lines[lineId]);
      else diagram ??= this.diagrams.find((d) => d.id === lineId) ?? null;
    }
    const line = pickedLine(mine);
    if (line) return { line, diagram: null, problem: this.columnHeads.get(line.line.column)?.key ?? null };
    if (problem) return { line: null, diagram: null, problem };
    return diagram ? { line: null, diagram, problem: null } : null;
  }

  /**
   * Publishes the problem the ask button would act on now (`liveStore.helpTarget`) for the outline
   * around it (`ProblemHighlight`): after every flush, a change of selection, mode or screen.
   */
  private publishHelpTarget(opts: { quiet?: boolean } = {}): void {
    const prev = liveStore.helpTarget.get();
    const next = nextHelpTarget(prev, this.started && this.opts.enabled ? this.helpTargetNow() : null, this.deps.now(), opts);
    if (next !== prev) liveStore.helpTarget.set(next);
  }

  /** What `requestHelp` would act on, in its order — a drawing, the target line's column, one of the chat's problems — without acting. */
  private helpTargetNow(): HelpTargetDraft | null {
    const states = Object.values(liveStore.lines.get());
    const cells = this.problemCells();
    const headed = new Set([...this.columnHeads.values()].map((h) => h.key));
    const base = { by: this.picked() ? ("selection" as const) : ("pen" as const), problems: problemCount(states, cells.filter((c) => !headed.has(c.key)).length) };
    const figure = this.helpTargetDiagram();
    if (figure) return { ...base, key: `d:${figure.id}`, column: -1, bounds: figure.bounds };
    const line = this.helpTargetLine();
    let column = line ? line.line.column : null;
    let cell: ProblemCell | null = null;
    // a line still being read is the one Help waits for; one read that it cannot act on hands over to the chat's problems
    if (cells.length > 0 && (!line || (line.analysis && !this.actsOn(line)))) {
      const pick = this.problemPick(this.opts.mode === "answer" ? "solve" : "step");
      if (pick && pick.kind !== "none") {
        const work = pick.kind === "student" ? this.workUnder(pick.cell) : null;
        if (pick.kind === "tutor" || pick.kind === "busy" || work) {
          cell = pick.cell;
          column = work ? work.line.column : null;
        }
      }
    }
    const target = problemTarget(states, column, cell ?? (column === null ? null : (this.columnHeads.get(column) ?? null)));
    return target && { ...base, ...target };
  }

  requestCheck(lineId?: string): void {
    const target = lineId ? liveStore.lines.get()[lineId] : this.helpTargetLine();
    if (!target || !target.latex) return;
    if (this.opts.mode === "off") return;
    // a proof line is checked by the proof checker (its mark is already there): no model check
    if (this.proofs.owns(target.line.id)) return;
    // a stacked sum is checked by the engine, column by column: its marks, now (no model is asked)
    if (this.stackLike(target)) {
      this.render(target, this.decisionFor(target, { userAsked: true }));
      return;
    }
    // Asking means now: a result this line was holding back for the settle is written at once
    // (the mode gate still applies — asking in Feedback asks for feedback, not for the answer).
    if (target.analysis?.resultLatex) this.render(target, this.decisionFor(target, { userAsked: true }));
    this.startCheck(target.line.column, target.line.id, { userAsked: true });
  }

  requestSolve(lineId?: string): void {
    // asked about the problem the student is on (not a given line): the outline shows which (`ProblemHighlight`)
    if (!lineId) liveStore.askedAt.set(this.deps.now());
    this.solveTarget(lineId);
    // the outline is around what the ask acts on: as it is now, not as the last flush left it
    if (!lineId) this.publishHelpTarget();
  }

  /**
   * Solve it, on `lineId` or the problem the student is on, without saying it was asked: Auto's own
   * solve goes through here, so the outline round the ask button's problem (`askedAt`) shows for the
   * student's ask and not, unasked, at every pause.
   */
  private solveTarget(lineId?: string): void {
    // A two-column proof: the rest of it in Solve, the next row otherwise (`ProofDesk`).
    if (this.opts.enabled && this.proofs.ask(lineId ?? this.helpTargetLine()?.line.id ?? null, lineId ? null : this.helpTargetDiagram(), { all: this.opts.mode === "answer" })) return;
    // Solve with a drawing the last thing drawn (or picked): the tutor reads the figure.
    const figure = lineId ? null : this.helpTargetDiagram();
    if (figure && this.opts.enabled && this.opts.mode === "answer") {
      this.askAboutDrawing(figure, { lineId: figure.id });
      return;
    }
    // asked on the `x = 3` under `3x + 24 =`: the line it evaluates is the question (`askedLine`)
    let target = this.askedLine(lineId ? liveStore.lines.get()[lineId] : this.helpTargetLine());
    // The chat's problems: with no line of the student's to act on, Solve steps is about the current
    // problem — worked out under it; pressed again once it is, the next one (`chat/work.ts`).
    if (!lineId && this.opts.enabled && this.opts.mode === "answer" && !this.actsOn(target)) {
      const pick = this.problemPick("solve");
      // the tutor is writing the current problem's work already: that is the answer to this ask
      if (pick?.kind === "busy") return;
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
    // a stacked sum: the digits still missing, in their columns — never a fraction's decimal
    if (this.stackLike(target)) {
      if (this.opts.enabled) this.solveStack(target);
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
   * The board's one "Help" action, on the problem the student is working on: the one they picked
   * with the select tool, else the one they last wrote in (`helpTargetLine`). Nothing here runs on
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
    liveStore.askedAt.set(this.deps.now());
    const helped = this.help();
    // the outline is around what the ask acts on: as it is now, not as the last flush left it
    this.publishHelpTarget();
    return helped;
  }

  /** Help me, without saying it was asked (`askedAt`): Auto's stuck step in Suggest (see `solveTarget`). */
  private help(): boolean {
    if (!this.opts.enabled || this.opts.mode === "off") return false;
    // The line it is about is still being read: Help acts once the read lands, not on the empty
    // read the line has now — that drew a "?" ("write it again") beside ink nobody had read yet.
    if (this.helpAfterRead()) return true;
    return this.helpNow();
  }

  /**
   * Help tapped while the latest line is still being read (`reading`): it waits for that read — at
   * most the recognizer's own timeout and a moment (`HELP_READ_WAIT_MS`) — then helps with what was
   * read; a read that never lands gets what an unread line gets. A second tap joins the wait. True
   * while Help is waiting; false when there is nothing in flight to wait for.
   */
  private helpAfterRead(): boolean {
    const target = this.helpTargetLine();
    if (!target || !this.reading.has(target.line.id)) return false;
    if (this.helpWaitTimer) return true;
    const lineId = target.line.id;
    const deadline = this.deps.now() + HELP_READ_WAIT_MS;
    const look = () => {
      this.helpWaitTimer = null;
      if (!this.started) return;
      if (this.reading.has(lineId) && this.deps.now() < deadline) {
        this.helpWaitTimer = setTimeout(look, HELP_READ_POLL_MS);
        return;
      }
      this.helpNow();
    };
    this.helpWaitTimer = setTimeout(look, HELP_READ_POLL_MS);
    clientMetric("live.help.waitRead", { lineId });
    return true;
  }

  /** `requestHelp` on what is on the page now. */
  private helpNow(): boolean {
    if (!this.opts.enabled || this.opts.mode === "off") return false;
    // On a two-column proof (or its figure): the next row — in Solve, the rest of the proof.
    if (this.proofs.ask(this.helpTargetLine()?.line.id ?? null, this.helpTargetDiagram(), { all: this.opts.mode === "answer" })) return true;
    // The student's last ink was a drawing (or its labels): the tutor reads the figure — in Solve
    // the whole setup and its answer, in Feedback / Suggest the first line of the setup. A drawing
    // never gets a "?": it is not ink that failed to read as maths.
    const figure = this.helpTargetDiagram();
    if (figure) {
      this.askAboutDrawing(figure, { lineId: figure.id, onlyFirstStep: this.opts.mode !== "answer" });
      return true;
    }
    // asked on the `x = 3` under `3x + 24 =` (or the lone `3` of an `x =` read apart): that line (`askedLine`)
    const target = this.askedLine(this.helpTargetLine());
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
    // the tutor is writing the current problem's work already: the help is on its way
    if (pick.kind === "busy") return true;
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
    // its ring is waiting for a second look (`holdRing`): the ring, if it comes, asks again
    if (!opts.now && !opts.typed && this.chainHolds.has(lineId)) return true;
    // a stacked sum's step is the right digit, under the wrong one in its column (`stackFix`)
    const stacked = this.stackOf(state.line) !== null;
    const fix = stacked ? this.stackFix(state) : null;
    const step = stacked ? null : this.rightNextStep(state);
    if (!step && !fix) return false;
    if (!opts.now && !this.settled) {
      this.pendingSuggestions.add(lineId);
      return true;
    }
    // one pen at a time: a ring still being drawn round the line is finished first
    if (this.afterMark(lineId, () => this.suggestNextStep(lineId, opts))) return true;
    if (liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return false;
    if (fix) {
      if (!this.writeStackDigits(state, fix.s, fix.items, { [SUGGEST_META]: state.latex, [STACK_META]: fix.s.key }) || !this.writer) return false;
      const entry = { writer: this.writer, latex: state.latex, landed: false };
      this.runtime(lineId).stepWriter = entry;
      queueMicrotask(() => (entry.landed = true));
      return true;
    }
    if (!step) return false;
    const { plan, unsupported } = planHandwriting([step], { size: handSizeFor(state.line.bounds.h, this.boardZoom()), seed: handSeedFor(`${lineId}:suggest`) });
    if (!plan || unsupported.length > 0) return false;
    const ink = state.line.bounds;
    const k = this.handScale();
    const candidate: Rect = {
      x: rectMaxX(ringRect(ink)) + (PLACEMENT.sideGap * k) / 2,
      y: ink.y + ink.h / 2 - plan.bounds.h / 2,
      w: plan.bounds.w,
      h: plan.bounds.h,
    };
    const slot = findFreeSlot(keepInsideX(candidate, this.placementBounds()), this.avoidRects(lineId), ink, "right", k);
    const writer = this.makeWriter();
    const entry = { writer, latex: state.latex, landed: false };
    this.runtime(lineId).stepWriter = entry;
    writer.start(placeHandPlan(plan, { x: slot.x, y: slot.y }), {
      meta: makeMeta("ai", lineId, this.deps.now()),
      extraMeta: { [SUGGEST_META]: state.latex },
    });
    // the learning record: the tutor wrote the step — unasked beside a ring (Auto), or asked (Help, the chat)
    this.learnWrote(lineId, "step", !opts.now && !opts.typed ? true : this.learnAutoFor(lineId));
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
      const { plan, unsupported } = planHandwriting([result], { size: handSizeFor(state.line.bounds.h, this.boardZoom()), seed: handSeedFor(`${state.line.id}:result`) });
      if (!plan || unsupported.length > 0) continue;
      const slot = this.underOperation(state, plan.bounds);
      const writer = this.makeWriter();
      this.runtime(state.line.id).resultWriter = writer;
      writer.start(placeHandPlan(plan, { x: slot.x, y: slot.y }), {
        meta: makeMeta("ai", state.line.id, this.deps.now()),
        extraMeta: { [OPERATION_RESULT_META]: result },
      });
      clientMetric("live.operation.result", { lineId: state.line.id });
      // the learning record: the student's next line, written for them at the pause
      this.learnWrote(state.line.id, "step", true);
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
    const k = this.handScale();
    const candidate: Rect = { x: Math.min(ink.x, above?.line.bounds.x ?? ink.x), y: rectMaxY(anchor) + PLACEMENT.stepGap * k, w: size.w, h: size.h };
    const placed = keepOnScreen(candidate, this.screenRect(), anchor, 0, PLACEMENT.sideGap * k);
    return findFreeSlot(placed, [...this.avoidRects(state.line.id), ink, anchor], anchor, placed.x === candidate.x ? "below" : "right", k);
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
    const size = handSizeFor(state.line.bounds.h, this.boardZoom());
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
    this.learnWrote(lineId, opts.all ? "solve" : "step");
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

  // ---------------------------------------------------------------- stacked (column) sums
  //
  // `286` over `+ 680`, a rule, `966` under it: one line (`stackedSums.ts`), read as an array and
  // worked column by column (`engine/columnArithmetic.ts`) — never as a fraction (the `= 0.7039`
  // the owner saw), never by a model. Marked as any line is, in every mode: a tick after a right
  // answer, a ring round the first wrong digit (rightmost first) with its note on the readback,
  // nothing on a partial answer that is right so far. Help writes the next column's digit and its
  // carry, Solve the digits still missing — in the student's hand, in their columns.

  /** The stacked sum this line is (its rule is one of the line's strokes), or null. */
  private stackOf(line: InkLine): StackedSum | null {
    return this.stacks.find((s) => line.strokeIds.includes(s.rule)) ?? null;
  }

  /** A stacked sum, or a read of one as a fraction (`MISREAD_STACK`): the engine's column work alone, never a line's. */
  private stackLike(state: LiveLineState): boolean {
    return this.stackOf(state.line) !== null || MISREAD_STACK.test(state.latex);
  }

  /**
   * The stacked sum on this line, worked: the read parsed, its columns found in the ink, the
   * student's answer judged where its digits sit. Null when the read is not a sum this can work
   * (long multiplication, a misread, a negative difference) or does not match the ink (a row more
   * or fewer than Mathpix read).
   */
  private stackWork(state: LiveLineState): StackState | null {
    const sum = this.stackOf(state.line);
    const read = sum && !sum.more ? parseStacked(state.latex) : null;
    if (!sum || !read || read.operands.length !== sum.rows.length) return null;
    const grid = stackGrid(sum, rowPlaces(read));
    const work = workStacked(read, grid.answerLast === null ? {} : { answerLast: grid.answerLast });
    return work ? { sum, grid, work, key: `${read.op} ${read.operands.join(" ")}` } : null;
  }

  /**
   * A stacked sum's analysis: complete and right is `solved` (a tick); a wrong digit is a `mismatch`
   * with its note (a ring) — only on a read sure of it (`STACK_RING_CONFIDENCE`); empty or right so
   * far is nothing yet. A sum this cannot work is `unknown`: read back, never marked, never
   * answered, never sent to a model.
   */
  private stackAnalysis(state: LiveLineState): LineAnalysis {
    const quiet: LineAnalysis = { kind: "unknown", math: "", resultLatex: "", verdict: "unknown", note: "" };
    const work = this.stackWork(state)?.work;
    if (!work) return quiet;
    const wrong = work.wrong !== -1;
    if (wrong && state.confidence < STACK_RING_CONFIDENCE) return quiet;
    return {
      kind: wrong || work.right ? "equation" : "expression",
      math: "",
      resultLatex: "",
      verdict: wrong ? "mismatch" : work.right ? "ok" : "none",
      note: work.note,
      ...(work.right ? { solved: true } : {}),
    };
  }

  /** What the tutor has written into this sum already, by row (`STACK_META`, `HAND_PART_META`). */
  private tutorStackPlaces(state: LiveLineState, key: string): Record<StackItem["row"], Set<number>> {
    const out = { a: new Set<number>(), c: new Set<number>(), f: new Set<number>() };
    for (const s of this.editor.getCurrentPageShapes()) {
      if (!isLiveMeta(s.meta) || s.meta.lineId !== state.line.id || metaString(s.meta, STACK_META) !== key) continue;
      const m = /^([acf])(\d+)$/.exec(metaString(s.meta, HAND_PART_META));
      if (m) out[m[1] as StackItem["row"]].add(Number(m[2]));
    }
    return out;
  }

  /**
   * The sum was rewritten (another number, another operator), or is no sum any more (its rule rubbed
   * out): the digits the tutor wrote into it go. A read that does not parse for a moment keeps them.
   */
  private dropStaleStack(state: LiveLineState): void {
    const stacked = this.stackOf(state.line) !== null;
    const read = stacked ? parseStacked(state.latex) : null;
    if (stacked && !read) return;
    const key = read ? `${read.op} ${read.operands.join(" ")}` : "";
    const stale = this.editor
      .getCurrentPageShapes()
      .filter((s) => isLiveMeta(s.meta) && s.meta.lineId === state.line.id && metaString(s.meta, STACK_META) !== "" && metaString(s.meta, STACK_META) !== key);
    if (stale.length === 0) return;
    this.write(() => {
      const ids = stale.map((s) => s.id).filter((id) => this.editor.getShape(id));
      if (ids.length > 0) this.editor.deleteShapes(ids);
    });
  }

  /**
   * Where a line's mark goes: round the line, or after it — and on a stacked sum, round the first
   * wrong digit where the student wrote it, and after the answer row, level with it.
   */
  private markRect(state: LiveLineState, kind: MarkKind): Rect {
    const sum = kind === "question" ? null : this.stackOf(state.line);
    const answer = sum?.answer?.rect;
    if (!answer) return state.line.bounds;
    if (kind === "check") return { ...answer, w: rectMaxX(state.line.bounds) - answer.x };
    const s = this.stackWork(state);
    return (s && s.work.wrong !== -1 && s.grid.answerGlyph(s.work.wrong)) || answer;
  }

  /** Auto may go on with this stacked sum: read, nothing wrong, and a column (in Suggest: a next column) left. */
  private stackLeft(state: LiveLineState, step: boolean): boolean {
    const id = state.line.id;
    const s = this.reading.has(id) || this.rt.get(id)?.checkAbort ? null : this.stackWork(state);
    if (!s || s.work.wrong !== -1) return false;
    const tutor = this.tutorStackPlaces(state, s.key).a;
    return step ? stackNextStep(s.work, tutor) !== null : placesLeft(s.work, tutor).length > 0;
  }

  /**
   * Help on a stacked sum (Help me in Feedback and Suggest, Suggest's stuck pause): a wrong digit
   * gets the right one under it (`suggestNextStep`, as any ring gets its step); else the next column
   * — its digit under the rule and the carry it sends over the column on its left, unless the
   * student carried it already. Nothing on a sum this cannot work, or a doubtful read of one.
   */
  private helpStack(state: LiveLineState): void {
    const s = this.stackWork(state);
    if (!s) return;
    if (s.work.wrong !== -1) {
      if (state.analysis?.verdict === "mismatch") this.suggestNextStep(state.line.id, { now: true });
      return;
    }
    const step = stackNextStep(s.work, this.tutorStackPlaces(state, s.key).a);
    if (!step) return;
    const items: StackItem[] = step.digits.map((d) => ({ row: "a", place: d.place, digit: String(d.digit) }));
    if (step.carry && !s.grid.carried.has(step.carry.place)) items.push({ row: "c", place: step.carry.place, digit: String(step.carry.digit) });
    this.writeStackDigits(state, s, items, { [STACK_META]: s.key });
  }

  /**
   * Solve on a stacked sum: the digits still missing under the rule, right to left, each followed by
   * the carry it sends on (not one the student wrote, nor over the empty column left of the sum),
   * and the point of a decimal answer — or, under a wrong answer, the right one on a row under it,
   * column for column. Nothing when it is all written.
   */
  private solveStack(state: LiveLineState): void {
    const s = this.stackWork(state);
    if (!s) return;
    const { work, grid } = s;
    if (work.wrong !== -1 && state.analysis?.verdict !== "mismatch") return;
    const tutor = this.tutorStackPlaces(state, s.key);
    const items: StackItem[] = [];
    if (work.wrong !== -1) {
      for (let p = 0; p < work.digits.length; p++) if (!tutor.f.has(p)) items.push({ row: "f", place: p, digit: String(work.digits[p]) });
    } else {
      for (const p of placesLeft(work, tutor.a)) {
        items.push({ row: "a", place: p, digit: String(work.digits[p]) });
        if (p === work.decimals - 1 && !work.answer.includes(".")) items.push({ row: "a", place: p + 0.5, digit: "." });
        const carry = work.op === "-" ? 0 : (work.carries[p + 1] ?? 0);
        if (carry > 0 && p + 1 < work.width && !grid.carried.has(p + 1) && !tutor.c.has(p + 1)) items.push({ row: "c", place: p + 1, digit: String(carry) });
      }
    }
    this.writeStackDigits(state, s, items, { [STACK_META]: s.key });
  }

  /** The right digit for the first wrong place of a ringed stacked sum (Suggest beside a ring), or null. */
  private stackFix(state: LiveLineState): { s: StackState; items: StackItem[] } | null {
    const s = state.analysis?.verdict === "mismatch" ? this.stackWork(state) : null;
    const p = s?.work.wrong ?? -1;
    if (!s || p < 0 || p >= s.work.digits.length || this.tutorStackPlaces(state, s.key).f.has(p)) return null;
    return { s, items: [{ row: "f", place: p, digit: String(s.work.digits[p]) }] };
  }

  /**
   * Writes digits into a stacked sum in the student's hand, each centred in its column: on the answer
   * row (`a`), small over the top row (`c`, a carry), or on a row under the answer (`f`) — one block,
   * in the order given (right to left, as the sum is done), a beat between digits. False when the
   * hand is off, cannot draw them, or the shape cap is reached.
   */
  private writeStackDigits(state: LiveLineState, s: StackState, items: readonly StackItem[], meta: JsonObject): boolean {
    if (items.length === 0 || !this.deps.handwritingEnabled() || liveStore.liveShapeCount.get() >= LIVE_LIMITS.maxLiveShapesPerBoard) return false;
    const { grid } = s;
    const size = inlineHandSizeFor(grid.digit, this.boardZoom());
    const seed = handSeedFor(`${state.line.id}:stack`);
    const plans: HandPlan[] = [];
    for (const it of items) {
      const { plan, unsupported } = planHandwriting([it.digit], { size: it.row === "c" ? Math.max(HAND_WRITE.minSize, Math.round(size * 0.55)) : size, seed: seed + plans.length });
      if (!plan || unsupported.length > 0) return false;
      const baselineY = it.row === "c" ? grid.carryBaseline : it.row === "f" ? grid.fixBaseline : grid.answerBaseline;
      plans.push(placeHandPlanOnBaseline(plan, { x: grid.x(it.place) - plan.bounds.w / 2, baselineY }));
    }
    const block = joinHandPlans(plans, STACK_DIGIT_GAP_MS, items.map((it) => `${it.row}${it.place}`));
    if (!block) return false;
    this.startHandwriting(block, state.line.id, meta);
    clientMetric("live.stack.write", { lineId: state.line.id, digits: items.length });
    return true;
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
  escalate(askedId: string): void {
    // on the `x = 3` under `3x + 24 =`: help with the line it evaluates (`askedLine`)
    const target = this.askedLine(liveStore.lines.get()[askedId]);
    if (!target || !target.latex || this.opts.mode === "off") return;
    const lineId = target.line.id;
    if (this.proofs.ask(lineId, null, { all: false })) return;
    this.closeHintsFor(lineId);
    // a stacked sum: its next column (or the right digit under a wrong one), from the engine alone
    if (this.stackLike(target)) return this.helpStack(target);
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
    // Stuck on a line ending in `=` the engine works out: its first step, after their `=` (`3x + 24 =` over
    // `x = 3` → `3(3) + 24`; `(x - 3)(x + 2) =` → `x^{2} + 2x - 3x - 6`).
    if (this.writeNextStep(target)) return;
    // Stuck on a line that is fine: when its work graphs (`y = 2x + 1`, a system, `x > 4`), the
    // graph is the help — sketched from the engine, no model asked. Otherwise the next step.
    const graphBefore = this.graphWriter;
    if (this.syncGraph(target.line.column, { asked: true, anchorLineId: lineId })) {
      // the learning record: a graph sketched as the help is a hint
      if (this.graphWriter && this.graphWriter !== graphBefore) this.learnHint(lineId);
      return;
    }
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
    // the learning record: a chat request about this problem is an ask
    this.learnAskCell(cell);
    const line = this.workUnder(cell);
    if (!line) return this.workProblem(cell, depth, "chat");
    if (line.analysis?.solved) return "done";
    const column = line.line.column;
    if (this.stackLike(line)) {
      if (depth === "solve") this.solveStack(line);
      else this.helpStack(line);
      return "writing";
    }
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
    const graphBefore = this.graphWriter;
    if (this.syncGraph(column, { asked: true, anchorLineId: line.line.id })) {
      if (this.graphWriter && this.graphWriter !== graphBefore) this.learnHint(line.line.id);
      return "writing";
    }
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
    // typed in this session: new work for the learning record
    this.learnFresh.add(lineId);
    forgetOldest(this.learnFresh);
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
 * A figure's labels that ask for something, clearly enough to work it out unasked: an unknown
 * (`x`, `?`, `2x + 10`, `θ`) and something known to find it from — another value with a number in it
 * (`40°`, `5`, `3x`). A lone `x`, `x` and `y`, vertex names, a proof's Given / Prove: not sent.
 */
export function unaskedFigureLabels(labels: readonly string[]): boolean {
  if (labels.some((l) => /\b(given|prove)\b/i.test(l))) return false;
  const unknowns = labels.filter(looksLikeUnknown);
  if (unknowns.length === 0) return false;
  const numbered = labels.filter((l) => isValueLabel(l) && /\d/.test(l));
  // something to find it from: a number that is not the unknown itself (`2x + 10` alone is not), or
  // a second expression in it (`x` and `3x` on a straight line)
  return numbered.some((l) => !looksLikeUnknown(l)) || (numbered.length > 0 && unknowns.length > 1);
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
  // a young student's answer to a sum (`4` under `2 + 2`): judged, not a label or a lone symbol
  if (state.analysis?.bareAnswer) return false;
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
