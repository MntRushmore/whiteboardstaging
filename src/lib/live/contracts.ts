/**
 * Live Math — single source of truth shared by client, server, shapes, engine and tests.
 * Runtime dependency: zod only. tldraw imports are type-only (erased) so this is server-safe.
 *
 * This file is FROZEN during the parallel build: every work package imports from it and
 * nobody edits it without the orchestrator. Propose changes in your report instead.
 */
import { FigureSpecSchema } from "./figureDraw/contracts";
import { z } from "zod";
import type { TLBaseShape, TLShapeId } from "tldraw";
import type { ChatAction, ChatRunReport, ChatScreen } from "./chat/contracts";
import type { LectureAction, LectureRunReport, LectureScreen } from "./lecture/contracts";
import type { LectureRunOptions } from "./lecture/desk";
import { LearnerHintSchema } from "@/lib/learning/hint";
import type { ChatRunOrigin } from "@/lib/learning/contracts";

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
  /** `-3 \quad -3`, `\div 2`, a bar with a `2` under it: what is done to both sides next (`engine/operationLine.ts`) */
  "operation",
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
  /**
   * `g(x) = f(x - 3) + 1` under the definition of f, or a right rewrite of it: a function defined
   * from another, so the next rewrite of it is checked — a wrong one is ringed
   * (`engine/transformations.ts`).
   */
  derived?: boolean;
  /**
   * An operation line (`kind: 'operation'`, `engine/operationLine.ts`): what is done to both sides
   * of the relation above it — `-3 \quad -3`, `\div 2`, a bar with the divisor under it. `result`
   * is the relation it leads to (`2x = 8`), '' when the engine cannot write it simply.
   */
  operation?: { op: "add" | "subtract" | "multiply" | "divide"; operand: string; operandMath: string; result: string };
  /**
   * The step does not follow from the last right line, but does from the ringed step above it: the
   * student carried on from their slip. Not right (no tick), and the mistake is already ringed where
   * it was made (no second ring): verdict `none`. Like a ringed step, never what a later step is
   * judged against (`liveLoop.ts`, `columnContext`).
   */
  carried?: boolean;
  /**
   * A lone number under a problem with no letters (`14` under `18 + 15 - 19`, `4` under `2 + 2`): the
   * student's answer, judged as `= 14` — a young student writes the answer, not `= 14`. Ticked (and
   * `solved`) or ringed like any step; never silent as a lone symbol, never a label.
   */
  bareAnswer?: boolean;
  /**
   * Where the unknown lives, written with the equation (`2\cos x = 1, 0^{\circ} \le x < 360^{\circ}`)
   * or on a line of its own (`engine/domain.ts`). Carried down the column: an answer under it must
   * lie inside, and lists all of its solutions there to count as solved.
   */
  domain?: LineDomain;
  /**
   * A line the student ended with `=` whose letters the column gives (`AnalyzeContext.givens`):
   * `3x + 24 =` with `x = 3` written above or under it asks for its value at x = 3. This is the
   * line with the values put in (`3(3) + 24`) — the next step, as Suggest writes it — and the
   * rest of the analysis is of that line: an `expression`, whose `resultLatex` (Solve only, as
   * for any line ending in `=`) is the value it asks for (`33`).
   */
  substituted?: string;
  /**
   * A line the student ended with `=` that the engine finishes by working it out — expanded and
   * collected (`(x - 3)(x + 2) =`), a common factor cancelled, or its letters' given values put in
   * (`substituted`): the first line of that working (`x^{2} + 2x - 3x - 6`, `3(3) + 24`), the next
   * step as Help writes it after the student's `=`. `resultLatex` (Solve only) is where the
   * working ends (`x^{2} - x - 6`, `33`).
   */
  nextStep?: string;
}
/**
 * A domain in the measure the unknown is read in: radians for an angle (`0^{\circ}` → 0,
 * `360^{\circ}` → 2π), the numbers themselves otherwise.
 */
export interface LineDomain {
  /** the unknown, as the engine names it (`x`, `theta`) */
  variable: string;
  lo: number;
  hi: number;
  loIn: boolean;
  hiIn: boolean;
  /** how the bounds were written: degrees, radians (π, or small numbers for an angle), plain numbers */
  unit: "deg" | "rad" | "plain";
  /** the domain as a chain (`0^{\circ} \le x < 360^{\circ}`) */
  latex: string;
  /** every solution inside it, in the same measure, when the engine can list them exactly */
  solutions?: number[];
}
/**
 * What `solveLatex` may know about the column it is solving in (`localSolve` passes it; every
 * field optional, so a caller with only the line passes nothing).
 */
export interface SolveOptions {
  /** the column's lines down to the one being solved: a function defined above is not a product */
  column?: readonly string[];
  /** write complex roots (`x = -1 \pm 2i`) instead of `\varnothing` — see `engine/complexSetting.ts` */
  complexRoots?: boolean;
}

export interface AnalyzeContext {
  previous?: LineAnalysis;
  original?: LineAnalysis;
  mode: HelpMode;
  /**
   * The values other lines of the column give its letters (`givens.ts`: `x = 3` written above or
   * under, or read apart as `x =` and `3`), letter → the value as written (`{ x: "3" }`). Only a
   * line ending in `=` uses them: every letter of it given, it asks for its value there
   * (`LineAnalysis.substituted`). Absent: no line gives any.
   */
  givens?: Readonly<Record<string, string>>;
}

/**
 * What the tutor graphs for a column of work (engine `graphFor`): the maths only, in data
 * coordinates. `src/lib/live/graphing` turns it into the strokes of a hand-drawn sketch (the
 * window, the ticks, the curves), so nothing here knows about the page.
 */
export type GraphRelOp = "=" | "<" | ">" | "<=" | ">=";
/** `y op f(x)`: a function, a line in any form solved for y, or the boundary of a region */
export interface GraphFunctionCurve {
  kind: "function";
  /** the relation as the student wrote it */
  latex: string;
  /** y as a function of the horizontal variable; NaN where it is not real */
  f: (x: number) => number;
  /** mathjs source of f in `x` (the typeset fallback compiles it) */
  expr: string;
  op: GraphRelOp;
  /** a transformation's parent: drawn dotted, under its image */
  role?: "parent";
  /** the function's name (`f`, `g`), written beside its curve when there are two */
  name?: string;
}
/** `(x - cx)^2 + (y - cy)^2 op r^2` */
export interface GraphCircleCurve {
  kind: "circle";
  latex: string;
  cx: number;
  cy: number;
  r: number;
  op: GraphRelOp;
}
export type GraphCurve = GraphFunctionCurve | GraphCircleCurve;
export interface GraphKeyPoint {
  x: number;
  y: number;
  /** `(0, 1)`, written beside the dot; '' when a coordinate is not exact (a dot only) */
  label: string;
  /** a hole is drawn as an open circle, the curve broken round it */
  role: "intercept" | "vertex" | "intersection" | "center" | "endpoint" | "turning" | "hole";
}
export interface GraphAsymptote {
  /** vertical: `x = at`; horizontal: `y = at`; oblique: `y = slope·x + at` (drawn dashed, with its equation) */
  axis: "vertical" | "horizontal" | "oblique";
  at: number;
  slope?: number;
  /** a transformation's parent's: its curve breaks there, but only the image's are drawn */
  hidden?: boolean;
}
export interface PlaneGraphIntent {
  kind: "plane";
  /** stable across rewrites of the same maths: the page never draws one twice */
  key: string;
  /** the horizontal variable (`x`, or `t` for `g(t) = …`) */
  variable: string;
  curves: GraphCurve[];
  points: GraphKeyPoint[];
  asymptotes: GraphAsymptote[];
  /** a transformation: from the parent's key point to where it lands, drawn as an arrow */
  arrows?: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
}
/** One piece of a one-variable solution set; null is ±∞. */
export interface NumberLineInterval {
  from: number | null;
  to: number | null;
  fromClosed: boolean;
  toClosed: boolean;
}
export interface NumberLineIntent {
  kind: "numberLine";
  key: string;
  variable: string;
  intervals: NumberLineInterval[];
  /** every finite endpoint, with its LaTeX as the answer wrote it (`\frac{3}{2}`) */
  marks: Array<{ at: number; latex: string }>;
}
export type GraphIntent = PlaneGraphIntent | NumberLineIntent;
export interface LiveEngine {
  analyzeLine(latex: string, ctx: AnalyzeContext): LineAnalysis;
  /** compiled y=f(x) sampler for graph shapes; null when the expression does not parse */
  compileExpr(expr: string): ((x: number) => number) | null;
  /** local solve of a single-variable equation or linear inequality, with teacher-style steps; null when unsupported (LLM path) */
  solveLatex(latex: string, opts?: SolveOptions): { latex: string; steps: string[] } | null;
  /**
   * Solve for an unknown using the lines above it (a known value substituted in, or two
   * linear equations); `x = ?` names the unknown. Null when that is not possible locally.
   * Optional so engine doubles in tests need not implement it.
   */
  solveFromLines?(lines: readonly string[]): { latex: string; steps: string[] } | null;
  /**
   * Simplifies an expression in an unknown (no relation, or a trailing `=`) the way a teacher
   * writes it: `3(x+2) - x` → [`3x + 6 - x`, `2x + 6`]. Bare expressions, no leading `=`. Null
   * when there is nothing to expand or collect. Optional so engine doubles need not implement it.
   */
  simplifySteps?(latex: string): string[] | null;
  /**
   * An expression in letters already written as simply as it goes (`2x^{2}`, `3x + 2`, `x^{2} + 3x +
   * 5`): a polynomial with nothing to expand, collect, cancel or factor, in the form the engine would
   * write it. False for anything it cannot be sure of (`\frac{8x}{2}`, `\sin x`, a relation, a
   * number). Optional so engine doubles need not implement it.
   */
  alreadySimplest?(latex: string): boolean;
  /**
   * What to graph for a column of work (the student's lines, then any solution under them),
   * top to bottom: `y = f(x)` / `f(x) = …`, a line in any form, two or three of them (with where
   * they cross), a region (`y < 2x + 1`), a circle, or — from the last line — a one-variable
   * inequality answer as a number line. Null when there is nothing to graph. Optional so engine
   * doubles need not implement it.
   */
  graphFor?(lines: readonly string[]): GraphIntent | null;
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
  /**
   * Dev only (never in production, see `liveDebugEnabled` in the recognize route): the
   * recognizer's raw output, so the Live debug panel can show what Mathpix actually said.
   */
  debug: z.record(z.string(), z.unknown()).optional(),
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
export const CheckRequestSchema = z
  .object({
    boardId: z.string().min(1).max(64),
    mode: z.enum(["feedback", "suggest"]),
    subject: z.enum(SUBJECTS).optional(),
    region: RectSchema,
    lines: z.array(CheckLineSchema).min(1).max(40),
    focusLineId: z.string().max(64).optional(),
    userAsked: z.boolean().default(false),
    /**
     * "Ask about this": a data:image crop of the focus line's ink, sent only when the student
     * pressed Help on ink Live could not read as maths (a diagram, a sketch, unreadable
     * writing). Same size cap as RecognizeRequest's crop. Never on an automatic check.
     */
    crop: z.string().startsWith("data:image/").max(280_000).optional(),
    /** what the tutor knows about this student (their weak skills, the mistakes they keep making) */
    learner: LearnerHintSchema.optional(),
  })
  .refine((r) => !r.crop || (r.userAsked && Boolean(r.focusLineId)), {
    message: "crop is only accepted on an explicit request for a focus line",
    path: ["crop"],
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

/**
 * POST /api/live/setup — a word problem turned into the maths a student writes under it. The
 * model only SETS UP (assignments / equations, no arithmetic done, no words); the local engine
 * then solves the setup on the client exactly as Solve would, and only when it cannot does the
 * board fall back to /api/live/solve.
 */
export const SetupRequestSchema = z
  .object({
    boardId: z.string().min(1).max(64),
    /** the column's lines top to bottom, as read: prose (`\text{…}`) and any maths the student wrote */
    lines: z.array(z.string().max(2000)).max(40).default([]),
    /**
     * "The tutor reads the figure": a data:image crop of a hand-drawn figure and its labels (the
     * client's `captureCrop`, same cap as recognize), sent only when the student asks (Solve / Help
     * on the drawing, or on a line beside it). With it the route reads the image with a vision
     * model; `lines` are then the lines beside the figure, possibly none.
     */
    crop: z.string().startsWith("data:image/").max(280_000).optional(),
    /** the figure's labels as the recognizer read them, one per label (`A`, `3`, `40^{\circ}`); only with `crop` */
    labels: z.array(z.string().max(200)).max(40).optional(),
  })
  .refine((r) => r.lines.length > 0 || Boolean(r.crop), { message: "a problem needs lines or a figure", path: ["lines"] })
  .refine((r) => !r.labels || Boolean(r.crop), { message: "labels only come with a figure crop", path: ["labels"] });
export type SetupRequest = z.infer<typeof SetupRequestSchema>;
export const SetupResponseSchema = z
  .object({
    /**
     * A word problem that describes a picture (a ladder against a wall, two angles of a triangle, a
     * rectangle's sides): the figure the tutor draws beside the working, true to scale, labelled with
     * the problem's numbers and the unknown's letter (`src/lib/live/figureDraw`). Only ever a spec
     * that `checkFigure` passed; absent otherwise.
     */
    sketch: FigureSpecSchema.optional(),
    /**
     * LaTeX only: assignments / equations, one short letter per quantity, top to bottom. Empty only
     * with `reason: "nothing_asked"`.
     */
    lines: z.array(z.string().min(1).max(500)).max(6),
    /**
     * `nothing_asked`: the model read the problem (or the figure) and nothing in it asks for
     * anything — no unknown, no lines (`{"unknown": "", "lines": []}`: a `2x2` the board took for a
     * drawing). Not a failure: the board says what to write instead of showing an error, and the
     * call is refunded like one. Absent on every reply with lines.
     */
    reason: z.literal("nothing_asked").optional(),
    /** the letter of the asked-for quantity, when the model named one */
    unknown: z.string().max(20).optional(),
    model: z.string(),
    ms: z.number(),
    /**
     * With a figure crop: where `lines` came from. `facts`: the model's structured read of the figure,
     * turned into equations by `planFigure` (src/lib/live/figure), one stage per unknown, each with
     * the value the board's engine must agree with. `lines`: the model's own free-form setup (the
     * read did not hold up: `reason`), kept by the board only when its engine solves it to a sensible
     * size (`kind`: what the labels say is asked). Absent: a word problem, or an older server.
     */
    figure: z
      .object({
        source: z.enum(["facts", "lines"]),
        reason: z.string().max(300).optional(),
        kind: z.enum(["angle", "length"]).optional(),
        stages: z
          .array(z.object({ letter: z.string().min(1).max(20), lines: z.array(z.string().min(1).max(500)).min(1).max(6), value: z.number(), kind: z.enum(["angle", "length"]) }))
          .max(3)
          .optional(),
      })
      .optional(),
  })
  .refine((r) => r.lines.length > 0 || r.reason === "nothing_asked", { message: "a setup has lines unless nothing is asked", path: ["lines"] });
export type SetupResponse = z.infer<typeof SetupResponseSchema>;

/**
 * POST /api/live/reread — the second reader: a vision model looks at the ink of ONE line that
 * Mathpix may have misread, with Mathpix's LaTeX and the column's other lines, and returns what
 * is written. Only ever sent on a signal (`src/lib/live/readCheck.ts`), at most once per ink.
 */
export const RereadRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  lineId: z.string().min(1).max(64),
  /** data:image crop of the line's ink (the client's `captureCrop`), same cap as recognize */
  crop: z.string().startsWith("data:image/").max(280_000),
  /** Mathpix's LaTeX for the line */
  latex: z.string().min(1).max(2000),
  /** the column's lines above it, top to bottom, as read */
  above: z.array(z.string().max(2000)).max(40).default([]),
  /** the column's lines below it (a line rewritten mid-column), top to bottom */
  below: z.array(z.string().max(2000)).max(40).default([]),
});
export type RereadRequest = z.input<typeof RereadRequestSchema>;
export const RereadResponseSchema = z.object({
  latex: z.string().max(2000),
  /** the model's own claim that it changed the read (the client compares for itself) */
  changed: z.boolean(),
  model: z.string(),
  ms: z.number(),
});
export type RereadResponse = z.infer<typeof RereadResponseSchema>;

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
 * `error` is the machine code (unauthorized | invalid_request | rate_limited | ink_empty |
 * upstream_error | feature_unavailable | internal_error | recognizer_failed).
 */
export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  retryAfterMs: z.number().optional(),
  issues: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

// 6. Server configuration (model ids verified on OpenRouter 2026-09-27) ------
/**
 * Solve is only reached for maths the local engine cannot do, and every step it returns is
 * checked by the engine before it is drawn. Chosen on the model benchmark (docs/eval/models.md,
 * `npm run eval:models`): GPT-5.4 mini matched Sonnet 5 on right answers (22 vs 23 of 25 shown
 * to the student) at 2.5 s p50 and about 40 % of the cost; DeepSeek v4.1 Flash is the fallback
 * only when it fails (21/25, cheapest). The owner chose a US provider as primary.
 */
/**
 * Setup (word problem → equations) is benchmark job 1: every model scored 24–25/25, so latency,
 * cost and a US primary decide — GPT-5.4 mini, with DeepSeek v4.1 Flash (25/25, cheapest) as the
 * fallback from another provider. Reread (the second reader for messy ink) is job 3: Gemini 3.1
 * Flash Lite fixed 14/18 real Mathpix misreads and broke 0/20 correct reads at ~0.9 s; Haiku 4.5
 * (another provider, also 0 breaks) is its fallback.
 */
export const LIVE_MODELS = {
  check: "google/gemini-3.5-flash",
  checkFallback: "anthropic/claude-haiku-4.5",
  solve: "openai/gpt-5.4-mini",
  solveFallback: "deepseek/deepseek-v4.1-flash",
  vision: "google/gemini-3.1-flash-lite",
  setup: "openai/gpt-5.4-mini",
  setupFallback: "deepseek/deepseek-v4.1-flash",
  reread: "google/gemini-3.1-flash-lite",
  rereadFallback: "anthropic/claude-haiku-4.5",
  /**
   * A hand-drawn figure (a crop) read as facts (`npm run eval:figures`, docs/eval/figures.md, 47
   * figures): Gemini 3.1 Flash Lite 47/47 right, none wrong, 1.1 s p50, ~$0.0009 a figure; Gemini 3.5
   * Flash Lite 45/47 (2 wrong) is the fallback — Haiku 4.5, the reread's fallback, wrote 4 wrong
   * answers of 47 at nearly three times the cost. Both are Google's (a US provider); OpenRouter
   * routes each to more than one Google endpoint.
   */
  figure: "google/gemini-3.1-flash-lite",
  figureFallback: "google/gemini-3.5-flash-lite",
  /**
   * Two-column proofs (POST /api/live/proof, `src/lib/live/proof`): reading a proof's figure (which
   * points lie on which lines) and, when the engine's planner cannot finish a proof, one next row —
   * which the client's checker must tick before it is written. The setup pair: US primary, the
   * cheapest capable fallback from another provider; both read images.
   */
  proof: "openai/gpt-5.4-mini",
  proofFallback: "deepseek/deepseek-v4.1-flash",
  /**
   * The board chat (POST /api/live/chat, `src/lib/live/chat`): a typed request → a reply and the
   * actions the tutor writes (problems, lines, a graph, a figure spec). Chosen on `npm run
   * eval:chat` (docs/eval/chat.md): US primary, the cheapest capable fallback from another provider.
   */
  chat: "openai/gpt-5.4-mini",
  chatFallback: "deepseek/deepseek-v4.1-flash",
  /**
   * Lecture mode's director (POST /api/live/lecture, `src/lib/live/lecture`): recent transcript →
   * what to sketch or update (a chart's data, a diagram's steps, a heading), usually nothing. On
   * `npm run eval:lecture` (docs/eval/lecture.md) DeepSeek v4.1 Flash matched GPT-5.4 mini on every
   * score — live sequences 66/66 each, single ticks 90/90 vs 89/90 — at 0.6 s vs 1.7 s p50 and
   * about a fifth of the cost ($0.00023 vs $0.00126 a tick). A lecture asks every few seconds for
   * an hour, so the owner chose it as the primary here (2026-09-29), with GPT-5.4 mini (a US
   * provider) as the fallback.
   */
  lecture: "deepseek/deepseek-v4.1-flash",
  lectureFallback: "openai/gpt-5.4-mini",
  /**
   * Lecture mode's illustrator (POST /api/live/lecture/sketch): a panel described in words → a
   * small SVG the route turns into ink strokes. Chosen BY EYE on `npm run eval:sketch`
   * (docs/eval/sketch.md: 19 drawings a round, the owner's four-panel comic among them, rendered as
   * the board inks them): Gemini 3.8 Flash drew nearly as well as Sonnet 5.5 (8.4 vs 8.7 of 9) and
   * is the only good one inside the 10–15 s a panel should take (7 s p50, 13 s p95, $0.009 a
   * drawing). Sonnet 5.5, the best-looking but always reasoning (20 s p50, 36 s p95, $0.029), is the
   * fallback, with the time the primary did not use. Both US providers.
   */
  sketch: "google/gemini-3.8-flash",
  sketchFallback: "anthropic/claude-sonnet-5.5",
} as const;

/** Per-user limits for the live routes (the existing LIMITS table in src/lib/server/rate-limit.ts covers the legacy routes). */
export const LIVE_RATE_LIMITS = {
  liveRecognize: { limit: 120, windowMs: 60_000 },
  liveCheck: { limit: 30, windowMs: 60_000 },
  liveSolve: { limit: 10, windowMs: 60_000 },
  /** one per Solve on a word problem, like solve itself */
  liveSetup: { limit: 10, windowMs: 60_000 },
  /** only on a suspicious read, at most once per ink; a quarter of the recognize budget is ample */
  liveReread: { limit: 30, windowMs: 60_000 },
  /** a proof's figure read (once per figure) and a next row when the planner cannot finish: two per ask at most */
  liveProof: { limit: 20, windowMs: 60_000 },
  /** the board chat: typed by hand, one request at a time */
  liveChat: { limit: 12, windowMs: 60_000 },
  /** lecture mode's director: a tick every ~4 s while numbers or steps are coming (else ~20 s), plus "Draw that" */
  liveLecture: { limit: 20, windowMs: 60_000 },
  /** lecture mode's recognizer tokens: one per speech session (a reconnect opens another) */
  liveListen: { limit: 6, windowMs: 60_000 },
  /** lecture mode's illustrator: one request per panel, a comic strip is four at once */
  liveSketch: { limit: 12, windowMs: 60_000 },
  /** a board's smart name: a few per board session (`useBoardAutoTitle`), uncharged, so kept low */
  liveTitle: { limit: 10, windowMs: 60_000 },
} as const;
export type LiveRateLimitRoute = keyof typeof LIVE_RATE_LIMITS;

// 7. Timing and limits ------------------------------------------------------
export const LIVE_TIMING = {
  quietMs: 600, // pen-up -> recognize; resets on new ink in the same line
  rewriteQuietMs: 450, // when the line already has an echo
  /**
   * The pause: no student ink ANYWHERE on the canvas for this long (the loop's settle). Answers
   * wait for it, and so does everything Auto does unasked — a model check of a line the engine
   * cannot judge, Solve finishing the problem. `ANSWER_SETTLE_MS` in liveLoop.ts explains 2.5 s.
   */
  settleMs: 2500,
  /**
   * Auto in Suggest: the student has stayed paused this long on a problem that is not finished,
   * so the tutor writes its next step (once per line). Long enough to be "stuck", not "thinking".
   */
  stuckMs: 6000,
  /** a line just read: its typeset readback shows this long, even with the pen in hand */
  readbackMs: 2500,
  unreadableChipMs: 3000, // low confidence: "Couldn't read this" chip only after this
  /** a ring waits at most this long for the step and its line above to be read again (`acceptChainReread`) */
  chainHoldMs: 4000,
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
  /** `reread`: Mathpix's read was replaced by the second reader's (`/api/live/reread`) */
  provider: "mathpix" | "vision" | "reread" | "typed" | "none";
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
  /**
   * The board's one "Help" action, on the latest line: Solve writes the solution, Feedback /
   * Suggest escalate that line's hint. Ink Live could not read as maths goes to the check
   * model with a crop of the ink ("Ask about this"). Always explicit; never fired on a timer.
   * False when there is nothing on the screen to help with yet (or help is Off).
   */
  requestHelp(): boolean;
  escalate(lineId: string): void;
  dismissHint(hintId: string): void;
  clearMarks(): void;
  retypeLine(lineId: string, latex: string): void;
  /**
   * The board chat (`src/lib/live/chat`): the current screen as maths, sent with a request so "3
   * more like these" works, and a reply's actions run one block at a time in the tutor's hand
   * (problems checked by the engine first). Optional, so a controller double need not have them.
   */
  chatScreen?(): ChatScreen;
  runChatActions?(actions: readonly ChatAction[], from?: ChatRunOrigin): Promise<ChatRunReport>;
  /**
   * Lecture mode (`src/lib/live/lecture`): the current screen in words for the director, the
   * director's actions sketched one block at a time (`LectureDesk`), and heard text saved on the
   * current screen's page meta. Optional, like the chat's. `opts` carries the session's way to the
   * illustrator for a sketch's panels (`LectureRunOptions`).
   */
  lectureScreen?(): LectureScreen;
  runLectureActions?(actions: readonly LectureAction[], opts?: LectureRunOptions): Promise<LectureRunReport>;
  saveLectureTranscript?(text: string): void;
}
export interface UseLiveMathOptions {
  boardId: string;
  mode: HelpMode;
  enabled: boolean;
  /**
   * Auto (the bar's switch, per device): on, the tutor acts by itself once the student pauses —
   * marks, model checks, Suggest's next step, Solve finishing the problem; off, only when they ask.
   * Absent means on.
   */
  auto?: boolean;
}
