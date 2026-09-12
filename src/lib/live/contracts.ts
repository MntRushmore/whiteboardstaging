/**
 * Live Math — single source of truth shared by client, server, shapes, engine and tests.
 * Runtime dependency: zod only. tldraw imports are type-only (erased) so this is server-safe.
 *
 * This file is FROZEN during the parallel build: every work package imports from it and
 * nobody edits it without the orchestrator. Propose changes in your report instead.
 */
import { z } from "zod";
import type { TLBaseShape, TLShapeId } from "tldraw";

// 1. Modes, verdicts, kinds -------------------------------------------------
export const HELP_MODES = ["off", "feedback", "suggest", "answer"] as const;
export type HelpMode = (typeof HELP_MODES)[number];
export const HelpModeSchema = z.enum(HELP_MODES);

/** What an echo can display. Deliberately no 'error' / 'wrong'. */
export const LIVE_VERDICTS = ["none", "pending", "ok", "warn", "unknown", "solved"] as const;
export type LiveVerdict = (typeof LIVE_VERDICTS)[number];

export const LINE_KINDS = [
  "expression",
  "equation",
  "assignment",
  "function",
  "inequality",
  "chem",
  "point",
  "label",
  "incomplete",
  "text",
  "unknown",
] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/** Engine verdict of a line relative to the previous line in its column. */
export const ENGINE_VERDICTS = ["ok", "mismatch", "unknown", "none"] as const;
export type EngineVerdict = (typeof ENGINE_VERDICTS)[number];

// 2. Custom shapes (TS types; the tldraw T validators live in src/shapes/*) --
export const MATH_SOURCES = ["echo", "ai", "student"] as const;
export type MathSource = (typeof MATH_SOURCES)[number];
export const MATH_TONES = ["muted", "normal", "accent"] as const;
export type MathTone = (typeof MATH_TONES)[number];
export const MATH_SIZES = ["s", "m", "l"] as const;
export type MathSize = (typeof MATH_SIZES)[number];

export interface MathShapeProps {
  w: number;
  h: number;
  latex: string;
  source: MathSource;
  status: LiveVerdict;
  resultLatex: string;
  note: string;
  /** ids of the draw shapes this echo was recognized from ([] when typed) */
  anchorIds: string[];
  lineId: string;
  size: MathSize;
  tone: MathTone;
}
export type MathShape = TLBaseShape<"math", MathShapeProps>;
export const MATH_SHAPE_DEFAULTS: MathShapeProps = {
  w: 160,
  h: 44,
  latex: "",
  source: "student",
  status: "none",
  resultLatex: "",
  note: "",
  anchorIds: [],
  lineId: "",
  size: "m",
  tone: "normal",
};

export interface GraphFn {
  id: string;
  expr: string;
  latex: string;
  color: string;
}
export interface GraphPoint {
  x: number;
  y: number;
  label: string;
}
export interface GraphShapeProps {
  w: number;
  h: number;
  fns: GraphFn[];
  points: GraphPoint[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  autoY: boolean;
  grid: boolean;
  title: string;
  lineId: string;
}
export type GraphShape = TLBaseShape<"graph", GraphShapeProps>;
export const GRAPH_SHAPE_DEFAULTS: GraphShapeProps = {
  w: 240,
  h: 200,
  fns: [],
  points: [],
  xMin: -10,
  xMax: 10,
  yMin: -10,
  yMax: 10,
  autoY: true,
  grid: true,
  title: "",
  lineId: "",
};
export const GRAPH_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#7c3aed", "#ea580c", "#0891b2"] as const;

/** meta of every shape the Live layer creates (type alias → assignable to JsonObject). */
export type LiveShapeMeta = {
  live: true;
  source: "echo" | "ai";
  lineId: string;
  createdAt: number;
  hintLevel?: number;
  edited?: boolean;
};
export function isLiveMeta(meta: unknown): meta is LiveShapeMeta {
  return typeof meta === "object" && meta !== null && (meta as { live?: unknown }).live === true;
}

// 3. Ink geometry (client only, tldraw page coordinates) ---------------------
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface InkStroke {
  id: TLShapeId;
  bounds: Rect;
  /** one polyline per draw segment, page coords */
  segments: Array<Array<{ x: number; y: number }>>;
}
export interface InkLine {
  /** stable across bursts: reused when >= 50 % of strokeIds overlap a previous line */
  id: string;
  strokeIds: TLShapeId[];
  bounds: Rect;
  column: number;
  row: number;
  /** sha-1 of the normalized stroke payload (recognition cache key) */
  hash: string;
}
export interface StrokePayload {
  x: number[][];
  y: number[][];
  w: number;
  h: number;
}

// 4. Local engine -----------------------------------------------------------
export interface LineAnalysis {
  kind: LineKind;
  /** mathjs source, '' when unparseable */
  math: string;
  /** '' when nothing should be shown (calculator rule) */
  resultLatex: string;
  verdict: EngineVerdict;
  note: string;
  variable?: string;
  solutions?: string[];
  plot?: { expr: string; latex: string };
  chem?: { balanced: boolean; balancedLatex: string };
  units?: { ok: boolean };
  solved?: boolean;
  error?: string;
}
export interface AnalyzeContext {
  previous?: LineAnalysis;
  original?: LineAnalysis;
  mode: HelpMode;
}
export interface LiveEngine {
  analyzeLine(latex: string, ctx: AnalyzeContext): LineAnalysis;
  /** compiled y=f(x) sampler for graph shapes; null when the expression does not parse */
  compileExpr(expr: string): ((x: number) => number) | null;
  /** local solve of a single-variable equation; null when unsupported (LLM path) */
  solveLatex(latex: string): { latex: string; steps: string[] } | null;
  /** verifies an LLM `expected` claim (mathjs expr) against the student's line */
  verifyExpected(expected: string, latex: string): "equal" | "unequal" | "unknown";
  balance(equation: string): { coeffs: number[]; latex: string } | null;
  /** calculator input: '3.2*4.5', '5 km/h to m/s', 'd/dx x^3', 'balance Fe+O2->Fe2O3' */
  calculate(input: string): { latex: string } | null;
}

// 5. API contracts (zod is the source of truth) ------------------------------
export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
});
const Coords = z.array(z.array(z.number()).min(1).max(2000)).min(1).max(80);
export const RecognizeRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  lineId: z.string().min(1).max(64),
  strokes: z
    .object({ x: Coords, y: Coords })
    .refine((s) => s.x.length === s.y.length && s.x.every((xs, i) => xs.length === s.y[i].length), {
      message: "x/y stroke arrays must align",
    }),
  bounds: z.object({ w: z.number().positive(), h: z.number().positive() }),
  /** data:image/jpeg;base64 crop, only when the recognizer is 'vision' (<= 200 KB raw) */
  crop: z.string().startsWith("data:image/").max(280_000).optional(),
  hint: z.enum(["math", "chem", "physics"]).optional(),
});
export type RecognizeRequest = z.infer<typeof RecognizeRequestSchema>;
export const RecognizeResponseSchema = z.object({
  latex: z.string(),
  text: z.string(),
  kind: z.enum(["math", "chem", "text", "unknown"]),
  confidence: z.number().min(0).max(1),
  provider: z.enum(["mathpix", "vision"]),
  ms: z.number(),
});
export type RecognizeResponse = z.infer<typeof RecognizeResponseSchema>;
export const CapabilitiesResponseSchema = z.object({
  recognizer: z.enum(["mathpix", "vision"]),
  liveEnabled: z.boolean(),
  models: z.object({ check: z.string(), solve: z.string(), vision: z.string() }),
});
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;

export const CheckLineSchema = z.object({
  id: z.string().min(1).max(64),
  latex: z.string().max(2000),
  /** [x0,y0,x1,y1] normalized 0..1 inside `region`; reading order only, never placement */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  local: z.object({
    kind: z.enum(LINE_KINDS),
    verdict: z.enum(ENGINE_VERDICTS),
    resultLatex: z.string().max(500).optional(),
    note: z.string().max(200).optional(),
  }),
});
export type CheckLine = z.infer<typeof CheckLineSchema>;
export const SUBJECTS = ["algebra", "geometry", "calculus", "physics", "chemistry", "other"] as const;
export const CheckRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  mode: z.enum(["feedback", "suggest"]),
  subject: z.enum(SUBJECTS).optional(),
  region: RectSchema,
  lines: z.array(CheckLineSchema).min(1).max(40),
  focusLineId: z.string().max(64).optional(),
  userAsked: z.boolean().default(false),
});
export type CheckRequest = z.infer<typeof CheckRequestSchema>;
export const ANNOTATION_KINDS = [
  "arithmetic",
  "sign",
  "algebra",
  "units",
  "concept",
  "notation",
  "incomplete",
  "praise",
] as const;
export const AnnotationSchema = z.object({
  lineId: z.string().max(64).nullable(),
  verdict: z.enum(["ok", "warn", "info"]),
  kind: z.enum(ANNOTATION_KINDS),
  /** <= 18 words, second person, names WHERE; never the corrected value below Solve */
  message: z.string().min(1).max(200),
  question: z.string().max(200).optional(),
  latex: z.string().max(500).optional(),
  /** mathjs expression the line's right side should equal; verified locally before display */
  expected: z.string().max(200).optional(),
  confidence: z.number().min(0).max(1).default(0.8),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const SolveRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  region: RectSchema,
  lines: z.array(CheckLineSchema).min(1).max(40),
  fromLineId: z.string().max(64).optional(),
  goal: z.string().max(200).optional(),
});
export type SolveRequest = z.infer<typeof SolveRequestSchema>;
export const SolveStepSchema = z.object({
  index: z.number().int().min(1).max(8),
  latex: z.string().min(1).max(500),
  explanation: z.string().max(200),
  final: z.boolean(),
});
export type SolveStep = z.infer<typeof SolveStepSchema>;

export const SseMetaSchema = z.object({ requestId: z.string(), model: z.string() });
export const SseDoneSchema = z.object({ count: z.number(), ms: z.number() });
export const SseErrorSchema = z.object({ error: z.string(), message: z.string() });
export type LiveSseEvent =
  | { event: "meta"; data: z.infer<typeof SseMetaSchema> }
  | { event: "annotation"; data: Annotation }
  | { event: "step"; data: SolveStep }
  | { event: "done"; data: z.infer<typeof SseDoneSchema> }
  | { event: "error"; data: z.infer<typeof SseErrorSchema> };

/**
 * Body of every non-2xx response from /api/* (matches src/lib/server/auth.ts `json()`):
 * `error` is the machine code (unauthorized | invalid_request | rate_limited | credits_exhausted |
 * upstream_error | voice_unavailable | feature_unavailable | internal_error | recognizer_failed).
 */
export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  retryAfterMs: z.number().optional(),
  issues: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

// 6. Server configuration (model ids verified on OpenRouter 2026-09-11) ------
export const LIVE_MODELS = {
  check: "google/gemini-3.5-flash",
  checkFallback: "anthropic/claude-haiku-4.5",
  solve: "anthropic/claude-sonnet-5",
  solveFallback: "openai/gpt-5.4-mini",
  vision: "google/gemini-3.1-flash-lite",
} as const;

/** Per-user limits for the live routes (the existing LIMITS table in src/lib/server/rate-limit.ts covers the legacy routes). */
export const LIVE_RATE_LIMITS = {
  liveRecognize: { limit: 120, windowMs: 60_000 },
  liveCheck: { limit: 30, windowMs: 60_000 },
  liveSolve: { limit: 10, windowMs: 60_000 },
} as const;
export type LiveRateLimitRoute = keyof typeof LIVE_RATE_LIMITS;

// 7. Timing and limits ------------------------------------------------------
export const LIVE_TIMING = {
  quietMs: 600, // pen-up -> recognize; resets on new ink in the same line
  rewriteQuietMs: 450, // when the line already has an echo
  unknownIdleMs: 5000, // Feedback: LLM check for 'unknown' only after this idle
  unreadableChipMs: 3000, // low confidence: "Couldn't read this" chip only after this
  legacyIdleMs: 4000, // legacy image pipeline debounce while Live is on (2000 when off)
  recognizeTimeoutMs: 6000,
  checkWatchdogMs: 4000, // no model bytes -> fallback model
  pillFadeMs: 1500,
  readingLabelDelayMs: 600, // show "Reading…" only when recognition exceeds this
} as const;
export const LIVE_LIMITS = {
  minConfidence: 0.6,
  maxLiveShapesPerBoard: 60,
  maxLinesPerCheck: 40,
  maxStrokesPerLine: 80,
  maxPointsPerStroke: 2000,
  maxCropBytes: 200_000,
  maxHintsPerLine: 1,
  maxSolveSteps: 8,
  normalizedLineHeight: 180,
  rdpEpsilon: 0.75,
  cacheEntries: 500,
} as const;
export const LIVE_KILL_SWITCH = process.env.NEXT_PUBLIC_LIVE_MATH === "0";

// 8. Client live state and controller ---------------------------------------
export type LiveStatus = "idle" | "reading" | "checking" | "offline" | "paused" | "error";
export type RecognizerKind = "mathpix" | "vision" | "unknown";
export interface LiveLineState {
  line: InkLine;
  latex: string;
  confidence: number;
  provider: "mathpix" | "vision" | "typed" | "none";
  analysis: LineAnalysis | null;
  mathShapeId: TLShapeId | null;
  graphShapeId: TLShapeId | null;
  hintsShown: number;
  rewritesWithWarn: number;
  edited: boolean;
  updatedAt: number;
}
export interface OpenHint {
  id: string;
  lineId: string;
  message: string;
  question: string;
  level: number;
  createdAt: number;
}
export type BurstState = "pending" | "handled" | "unhandled";
export interface LiveBurst {
  at: number;
  state: BurstState;
}
export interface LiveTranscriptLine {
  id: string;
  latex: string;
  verdict: LiveVerdict;
  resultLatex: string;
  note: string;
  column: number;
}
export interface LiveTranscript {
  lines: LiveTranscriptLine[];
  summary: string;
}
export interface LiveController {
  getTranscript(): LiveTranscript;
  placeMath(args: { latex: string; nearLineId?: string; tone?: MathTone }): TLShapeId | null;
  plotFunction(args: { expr: string; xMin?: number; xMax?: number; nearLineId?: string }): TLShapeId | null;
  requestCheck(lineId?: string): void;
  requestSolve(lineId?: string): void;
  escalate(lineId: string): void;
  dismissHint(hintId: string): void;
  clearMarks(): void;
  retypeLine(lineId: string, latex: string): void;
}
export interface UseLiveMathOptions {
  boardId: string;
  mode: HelpMode;
  enabled: boolean;
  voiceActive: boolean;
}
