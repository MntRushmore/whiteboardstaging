import { z } from "zod";
import { DrawFigureSchema, GraphActionSchema, NewScreenSchema, WriteLinesSchema } from "../chat/contracts";

/**
 * Lecture mode: the board listens to a lecture (the microphone, as a live transcript) and the
 * tutor sketches what is worth seeing — a chart of the numbers said, a flow of the steps, a
 * cycle, a timeline, a comparison, a graph, a figure, a formula — in its own hand, on the
 * screens of the board, while the lecture goes on. Any subject. Nothing is painted by an image
 * model: the model only says WHAT to draw (data and structure, validated here with zod); the
 * planners (`chart/`, `diagram/`, `text.ts`) lay it out and the HandWriter draws it as ink.
 *
 * The pieces, and who owns them:
 *
 *  - speech (`speech/*`): microphone → transcript. ElevenLabs realtime Scribe through a
 *    single-use token from `POST /api/live/lecture/token`; the browser's own recognizer when
 *    that is not configured; a scripted source for tests, demos and QA.
 *  - the session (`session.ts`, `transcript.ts`): keeps the transcript, decides when to ask
 *    the director (`LECTURE_TIMING`), runs what comes back through the board, saves the
 *    transcript on the screen it was heard on.
 *  - the director (`POST /api/live/lecture`, `src/lib/server/prompts/lecture.ts`): recent
 *    transcript + what is already drawn → `{ actions }`, usually none.
 *  - the desk (`desk.ts`): places and writes each action on the current screen, a new screen
 *    when it is full or the topic changes; graphs, figures, formulas and new screens go through
 *    the board chat's own desk (`ChatDesk`).
 *
 * Words ARE written in lecture mode (a heading, a short note, the labels of a chart or a
 * diagram), short and plain; everywhere else the board keeps its no-words rule.
 *
 * THIS FILE IS THE SHARED CONTRACT. Change it only together with every user of it.
 */

// ------------------------------------------------------------------ limits and timing

export const LECTURE_LIMITS = {
  /** transcript sent to the director: what came before (context) and what is new (fresh) */
  contextChars: 2400,
  freshChars: 2400,
  /** actions per director reply (more are dropped) */
  actions: 3,
  /** what the director is told is already drawn: on this screen, and on the screens before */
  drawn: 12,
  recent: 8,
  whatChars: 100,
  /** a heading (a topic), a note (one key point), a label (in a chart or a diagram) */
  heading: 48,
  note: 90,
  label: 28,
  /** a node of a diagram may be a few words (wrapped onto two or three lines by the planner) */
  node: 40,
  /** transcript kept on each screen's page meta (older text is dropped from the front) */
  screenTranscriptChars: 12_000,
} as const;

export const LECTURE_TIMING = {
  /** the director is asked at most this often while listening… */
  tickMinMs: 40_000,
  /** …and only once this many new words have been heard since it was last asked */
  tickMinWords: 45,
  /** "Draw that" (a forced tick) reads this much of the latest transcript as fresh */
  forceWindowMs: 60_000,
  /** a forced tick is allowed this soon after another request */
  forceMinGapMs: 4_000,
  /** no speech for this long while listening: the session pauses itself (the mic stays yours) */
  idlePauseMs: 10 * 60_000,
  /** the director's own timeout on the client */
  requestTimeoutMs: 40_000,
} as const;

// ------------------------------------------------------------------ text on the board

/**
 * Plain words as the hand writes them: letters, digits, spaces and everyday punctuation. No
 * LaTeX (`\`), no `$`, no markup, one line (the planner wraps it). Characters the hand has no
 * glyph for are left out by the planner, never drawn as boxes.
 */
export function lectureText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[\\$<>{}\n\r\t]/.test(s), { message: "plain words only" });
}

export const HeadingTextSchema = lectureText(LECTURE_LIMITS.heading);
export const NoteTextSchema = lectureText(LECTURE_LIMITS.note);
export const LabelSchema = lectureText(LECTURE_LIMITS.label);
export const NodeTextSchema = lectureText(LECTURE_LIMITS.node);

const finite = z.number().finite();
/** a short unit written after a value or on an axis: `%`, `$`, `kg`, `°C`, `million` */
const UnitSchema = z.string().trim().min(1).max(10).refine((s) => !/[\\$<>{}]/.test(s) || s === "$", { message: "plain unit" });

// ------------------------------------------------------------------ charts

/** Categories on the x-axis, one or more series of values (one per category). */
const SeriesSchema = z.object({
  name: LabelSchema.optional(),
  values: z.array(finite).min(1).max(12),
});

const CategoryChartBase = {
  title: HeadingTextSchema.optional(),
  labels: z.array(LabelSchema).min(2).max(12),
  series: z.array(SeriesSchema).min(1).max(3),
  xLabel: LabelSchema.optional(),
  yLabel: LabelSchema.optional(),
  unit: UnitSchema.optional(),
};

const seriesMatchLabels = (c: { labels: string[]; series: Array<{ values: number[] }> }) => c.series.every((s) => s.values.length === c.labels.length);

export const BarChartSchema = z.object({ kind: z.literal("bar"), ...CategoryChartBase }).refine(seriesMatchLabels, { message: "each series needs one value per label" });
export const LineChartSchema = z.object({ kind: z.literal("line"), ...CategoryChartBase }).refine(seriesMatchLabels, { message: "each series needs one value per label" });

export const PieChartSchema = z.object({
  kind: z.literal("pie"),
  title: HeadingTextSchema.optional(),
  slices: z
    .array(z.object({ label: LabelSchema, value: finite.positive() }))
    .min(2)
    .max(8),
  unit: UnitSchema.optional(),
});

export const ScatterChartSchema = z.object({
  kind: z.literal("scatter"),
  title: HeadingTextSchema.optional(),
  points: z
    .array(z.object({ x: finite, y: finite }))
    .min(3)
    .max(40),
  xLabel: LabelSchema.optional(),
  yLabel: LabelSchema.optional(),
  /** draw the least-squares line through the points */
  trend: z.boolean().optional(),
});

export const TableChartSchema = z
  .object({
    kind: z.literal("table"),
    title: HeadingTextSchema.optional(),
    columns: z.array(LabelSchema).min(2).max(4),
    rows: z.array(z.array(LabelSchema).min(2).max(4)).min(1).max(6),
  })
  .refine((t) => t.rows.every((r) => r.length === t.columns.length), { message: "each row needs one cell per column" });

export const ChartSpecSchema = z.union([BarChartSchema, LineChartSchema, PieChartSchema, ScatterChartSchema, TableChartSchema]);
export type ChartSpec = z.infer<typeof ChartSpecSchema>;
export type ChartKind = ChartSpec["kind"];
export const CHART_KINDS = ["bar", "line", "pie", "scatter", "table"] as const satisfies readonly ChartKind[];

// ------------------------------------------------------------------ diagrams

/** Steps in order, left to right (or top to bottom), joined by arrows; an arrow may carry a label. */
export const FlowDiagramSchema = z
  .object({
    kind: z.literal("flow"),
    title: HeadingTextSchema.optional(),
    steps: z.array(NodeTextSchema).min(2).max(7),
    /** one per arrow (steps.length - 1); "" for an unlabelled arrow */
    arrows: z.array(z.union([LabelSchema, z.literal("")])).optional(),
  })
  .refine((f) => !f.arrows || f.arrows.length === f.steps.length - 1, { message: "one arrow label per gap between steps" });

/** Steps round a loop (the water cycle, the Krebs cycle, a feedback loop). */
export const CycleDiagramSchema = z.object({
  kind: z.literal("cycle"),
  title: HeadingTextSchema.optional(),
  steps: z.array(NodeTextSchema).min(3).max(8),
});

/** Dated events along a line, in order. */
export const TimelineDiagramSchema = z.object({
  kind: z.literal("timeline"),
  title: HeadingTextSchema.optional(),
  events: z
    .array(z.object({ when: z.string().trim().min(1).max(16).refine((s) => !/[\\$<>{}]/.test(s)), what: NodeTextSchema }))
    .min(2)
    .max(8),
});

/** One idea in the middle, its parts round it ("three types of rock", "the causes of WWI"). */
export const HubDiagramSchema = z.object({
  kind: z.literal("hub"),
  title: HeadingTextSchema.optional(),
  center: NodeTextSchema,
  spokes: z.array(NodeTextSchema).min(2).max(8),
});

/** A hierarchy two levels deep (a classification, an outline). */
export const TreeDiagramSchema = z
  .object({
    kind: z.literal("tree"),
    title: HeadingTextSchema.optional(),
    root: NodeTextSchema,
    children: z
      .array(z.object({ text: NodeTextSchema, children: z.array(NodeTextSchema).max(4).optional() }))
      .min(1)
      .max(5),
  })
  .refine((t) => t.children.reduce((n, c) => n + Math.max(1, c.children?.length ?? 0), 0) <= 12, { message: "at most 12 leaves" });

/** Two things compared: what is only one's, what they share, what is only the other's. */
export const VennDiagramSchema = z
  .object({
    kind: z.literal("venn"),
    title: HeadingTextSchema.optional(),
    left: LabelSchema,
    right: LabelSchema,
    leftOnly: z.array(LabelSchema).max(4).default([]),
    both: z.array(LabelSchema).max(4).default([]),
    rightOnly: z.array(LabelSchema).max(4).default([]),
  })
  .refine((v) => v.leftOnly.length + v.both.length + v.rightOnly.length > 0, { message: "a comparison needs at least one item" });

export const DiagramSpecSchema = z.union([FlowDiagramSchema, CycleDiagramSchema, TimelineDiagramSchema, HubDiagramSchema, TreeDiagramSchema, VennDiagramSchema]);
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;
export type DiagramKind = DiagramSpec["kind"];
export const DIAGRAM_KINDS = ["flow", "cycle", "timeline", "hub", "tree", "venn"] as const satisfies readonly DiagramKind[];

// ------------------------------------------------------------------ actions

/** A new topic: written at the top of a screen, underlined. A screen with anything on it → a new screen first. */
export const HeadingActionSchema = z.object({ type: z.literal("heading"), text: HeadingTextSchema });
/** One key point or definition, a short line with a bullet ("Mitochondria make ATP"). */
export const NoteActionSchema = z.object({ type: z.literal("note"), text: NoteTextSchema });
export const ChartActionSchema = z.object({ type: z.literal("chart"), chart: ChartSpecSchema });
export const DiagramActionSchema = z.object({ type: z.literal("diagram"), diagram: DiagramSpecSchema });

/**
 * Everything the director can ask for. `graph` (a function or relation the engine can plot),
 * `draw_figure` (geometry, to scale), `write_lines` (maths, checked by the engine) and
 * `new_screen` are the board chat's own actions and run through its desk unchanged.
 */
export const LectureActionSchema = z.discriminatedUnion("type", [
  HeadingActionSchema,
  NoteActionSchema,
  ChartActionSchema,
  DiagramActionSchema,
  GraphActionSchema,
  DrawFigureSchema,
  WriteLinesSchema,
  NewScreenSchema,
]);
export type LectureAction = z.infer<typeof LectureActionSchema>;
export type LectureActionType = LectureAction["type"];
export const LECTURE_ACTION_TYPES = ["heading", "note", "chart", "diagram", "graph", "draw_figure", "write_lines", "new_screen"] as const satisfies readonly LectureActionType[];

// ------------------------------------------------------------------ the director's request

/** What is on the current screen, in words: what not to draw again, and whether there is room. */
export const LectureScreenSchema = z.object({
  empty: z.boolean(),
  /** this screen's heading (the topic), when it has one */
  topic: HeadingTextSchema.nullable().default(null),
  /** one line per thing drawn here, from `describeLectureAction` ("bar chart: GDP growth by year") */
  drawn: z.array(z.string().max(LECTURE_LIMITS.whatChars)).max(LECTURE_LIMITS.drawn).default([]),
  /** roughly how much of the screen is still free, 0..1 */
  room: z.number().min(0).max(1),
});
export type LectureScreen = z.infer<typeof LectureScreenSchema>;

export const LectureRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  /** what was said before `fresh` (already seen by the director), oldest first */
  context: z.string().max(LECTURE_LIMITS.contextChars).default(""),
  /** what was said since the director was last asked (or the last minute, for "Draw that") */
  fresh: z.string().trim().min(1).max(LECTURE_LIMITS.freshChars),
  screen: LectureScreenSchema,
  /** what was drawn on the screens before this one, newest first */
  recent: z.array(z.string().max(LECTURE_LIMITS.whatChars)).max(LECTURE_LIMITS.recent).default([]),
  /** "Draw that": the student asked for a picture of what was just said; the director should draw something if anything fits */
  force: z.boolean().default(false),
});
export type LectureRequest = z.input<typeof LectureRequestSchema>;

export const LectureResponseSchema = z.object({
  actions: z.array(LectureActionSchema).max(LECTURE_LIMITS.actions),
  /** what the route dropped and why (logged; shown only after "Draw that") */
  notes: z.array(z.string().max(200)).max(8).default([]),
  /** true when everything the model proposed was dropped and the credit was given back */
  refunded: z.boolean().optional(),
  model: z.string(),
  ms: z.number(),
});
export type LectureResponse = z.infer<typeof LectureResponseSchema>;

// ------------------------------------------------------------------ the speech token

/** `POST /api/live/lecture/token` → a short-lived credential the browser opens the recognizer with. */
export const ListenTokenResponseSchema = z.object({
  provider: z.literal("elevenlabs"),
  token: z.string().min(1),
  /** the websocket to open, token and query already on it */
  url: z.string().url(),
  /** epoch ms after which the token can no longer open a session */
  expiresAt: z.number(),
});
export type ListenTokenResponse = z.infer<typeof ListenTokenResponseSchema>;
/** The token route answers 503 with this error code when ELEVENLABS_API_KEY is not set: the client falls back to the browser's recognizer. */
export const LISTEN_NOT_CONFIGURED = "listen_not_configured";

// ------------------------------------------------------------------ the client side

/** One finished piece of the transcript (a sentence or so, as the recognizer commits it). */
export interface TranscriptSegment {
  text: string;
  /** ms since the lecture started when it was heard */
  atMs: number;
}

export type SpeechState = "idle" | "connecting" | "listening" | "paused" | "reconnecting" | "error";

export interface SpeechCallbacks {
  /** the words being heard right now (replaced by the next partial, cleared by a final) */
  onPartial(text: string): void;
  onFinal(segment: TranscriptSegment): void;
  onState(state: SpeechState, detail?: string): void;
}

/** A source of transcript: the microphone through a recognizer, or a script. */
export interface SpeechSource {
  readonly kind: "elevenlabs" | "browser" | "script";
  start(cb: SpeechCallbacks): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}

/** What the board does for the session (the live loop implements it, `LiveController.lecture*`). */
export interface LectureBoard {
  /** the current screen, for the director */
  screen(): LectureScreen;
  /** runs the actions on the board, one block at a time; resolves when the last is on the page */
  run(actions: readonly LectureAction[]): Promise<LectureRunReport>;
  /** appends heard text to the current screen's saved transcript (`LECTURE_PAGE_META`) */
  saveTranscript(text: string): void;
}

export interface LectureActionOutcome {
  type: LectureActionType;
  ok: boolean;
  /** the one-line summary of what was drawn (`describeLectureAction`), when it was */
  what?: string;
  note?: string;
}

export interface LectureRunReport {
  outcomes: LectureActionOutcome[];
  screensAdded: number;
}

// ------------------------------------------------------------------ on the page

/** shape meta: the kind of lecture block (`heading`, `note`, `chart`, `diagram`) */
export const LECTURE_BLOCK_META = "lectureBlock";
/** shape meta: the block's one-line summary (`describeLectureAction`) */
export const LECTURE_WHAT_META = "lectureWhat";
/** page (screen) meta: `LecturePageMeta` */
export const LECTURE_PAGE_META = "lecture";

export interface LecturePageMeta {
  /** the screen's heading */
  topic?: string;
  /** what was heard while this screen was the current one (capped, oldest dropped) */
  transcript?: string;
}

// ------------------------------------------------------------------ summaries

const CHART_NAMES: Record<ChartKind, string> = { bar: "bar chart", line: "line chart", pie: "pie chart", scatter: "scatter plot", table: "table" };
const DIAGRAM_NAMES: Record<DiagramKind, string> = { flow: "flow", cycle: "cycle", timeline: "timeline", hub: "concept map", tree: "tree", venn: "Venn diagram" };

function clip(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= LECTURE_LIMITS.whatChars ? t : `${t.slice(0, LECTURE_LIMITS.whatChars - 1)}…`;
}

/** One line saying what an action draws, for the director's "already drawn" and for the panel. */
export function describeLectureAction(a: LectureAction): string {
  switch (a.type) {
    case "heading":
      return clip(`heading: ${a.text}`);
    case "note":
      return clip(`note: ${a.text}`);
    case "chart": {
      const c = a.chart;
      const about = c.title ?? (c.kind === "pie" ? c.slices.map((s) => s.label).join(", ") : c.kind === "table" ? c.columns.join(" / ") : c.kind === "scatter" ? `${c.yLabel ?? "y"} vs ${c.xLabel ?? "x"}` : c.labels.join(", "));
      return clip(`${CHART_NAMES[c.kind]}: ${about}`);
    }
    case "diagram": {
      const d = a.diagram;
      const about =
        d.title ??
        (d.kind === "flow" || d.kind === "cycle"
          ? d.steps.join(" → ")
          : d.kind === "timeline"
            ? d.events.map((e) => e.when).join(", ")
            : d.kind === "hub"
              ? d.center
              : d.kind === "tree"
                ? d.root
                : `${d.left} vs ${d.right}`);
      return clip(`${DIAGRAM_NAMES[d.kind]}: ${about}`);
    }
    case "graph":
      return clip(`graph: ${a.relations.join("; ")}`);
    case "draw_figure":
      return "geometry figure";
    case "write_lines":
      return clip(`formula: ${a.lines.join("; ")}`);
    case "new_screen":
      return "new screen";
  }
}
