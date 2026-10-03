import { z } from "zod";
import { DrawFigureSchema, GraphActionSchema, NewScreenSchema, plainWords, WriteLinesSchema } from "../chat/contracts";
import { LECTURE_TRANSCRIPT_CHARS } from "./meta";

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
 * LIVE: a chart or a diagram grows as the lecture goes. "Sales in Q1 were 12 million… Q2 was
 * up to 15…" draws the axes and Q1's bar, then Q2's bar is added to the SAME chart when it is
 * said (`update_chart`), by the same hand, without redrawing what did not change. The director
 * sees the screen's live visuals (`LectureScreen.active`, their specs and ids) and answers with
 * the whole new spec; the desk re-plans it in the same box and writes only the parts whose ink
 * changed (`HandLinePlan.part`). Categories announced before their numbers are drawn as empty
 * slots (`null` values), so the layout is set once and the bars fill in. While numbers or steps
 * are coming, the session asks every few seconds (`LECTURE_TIMING.liveTickMinMs`); otherwise
 * about every 40 s. Billing is per minute of lecture, not per question (`live/lecture`).
 *
 * SLIDES: the board is a slide deck the lecture builds live, in the tutor's hand. Each screen is a
 * slide: its title (`heading`) at the top, its bullets (`note`, one key point each, added as the
 * point is made) in a column on the left, and ONE visual on the right — a chart, a diagram, a graph
 * or a picture — that grows as the lecture goes. A new topic is a new slide; a slide that is full
 * (its bullets, or a second visual) goes on on the next screen as "<title> (cont.)". The director
 * is asked every few seconds while anyone is talking (`LECTURE_TIMING`), so the slide keeps up
 * with the speaker; nothing waits for them to finish.
 *
 * Words ARE written in lecture mode (a heading, a short note, the labels of a chart or a
 * diagram), short and plain; elsewhere the board writes words only in the board chat's worked
 * solutions (a sentence per step, under the same text rule) and a proof's reasons. Sketches are
 * inked in a small palette (`LECTURE_PALETTE`), filled lightly where a shape is closed.
 *
 * THIS FILE IS THE SHARED CONTRACT. Change it only together with every user of it.
 */

// ------------------------------------------------------------------ limits and timing

export const LECTURE_LIMITS = {
  /** transcript sent to the director: what came before (context) and what is new (fresh) */
  contextChars: 2400,
  freshChars: 2400,
  /** actions per director reply (more are dropped): a new slide's title, two bullets and its chart */
  actions: 4,
  /** bullets on one slide: past this the slide continues on the next screen ("… (cont.)") */
  slideBullets: 6,
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
  screenTranscriptChars: LECTURE_TRANSCRIPT_CHARS,
  /** live visuals on the screen the director may update (newest first) */
  active: 2,
  /** a block's id on the board (`LECTURE_ID_META`) */
  idChars: 40,
} as const;

export const LECTURE_TIMING = {
  /**
   * SLIDES: the director is asked at most this often while anyone is talking (each point becomes a
   * bullet on the slide as it is made)…
   */
  tickMinMs: 6_000,
  /** …once this many new words have been heard since it was last asked */
  tickMinWords: 12,
  /**
   * LIVE: while what is said is salient (numbers, amounts, years, percentages, steps — "first",
   * "next", "then") or a live visual on the screen was drawn or updated within `activeWindowMs`,
   * the director is asked this often, once `liveTickMinWords` new words have been committed.
   */
  liveTickMinMs: 4_000,
  liveTickMinWords: 4,
  activeWindowMs: 150_000,
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
 * glyph for are left out by the planner, never drawn as boxes. The board chat's worked solutions
 * write their sentences under the same rule (`plainWords`, shared).
 */
export const lectureText = (max: number) => plainWords(max);

export const HeadingTextSchema = lectureText(LECTURE_LIMITS.heading);
export const NoteTextSchema = lectureText(LECTURE_LIMITS.note);
export const LabelSchema = lectureText(LECTURE_LIMITS.label);
export const NodeTextSchema = lectureText(LECTURE_LIMITS.node);

const finite = z.number().finite();
/** a short unit written after a value or on an axis: `%`, `$`, `kg`, `°C`, `million`, `$ million`, `£bn` */
const UnitSchema = z.string().trim().min(1).max(12).refine((s) => !/[\\<>{}]/.test(s), { message: "plain unit" });

// ------------------------------------------------------------------ charts

/**
 * Categories on the x-axis, one or more series of values (one per category). `null` is a value
 * not said yet: the category's slot is drawn (its label, no bar), so when the number comes the
 * bar fills in without the chart being laid out again.
 */
const SeriesSchema = z.object({
  name: LabelSchema.optional(),
  values: z.array(finite.nullable()).min(1).max(12),
});

const CategoryChartBase = {
  title: HeadingTextSchema.optional(),
  labels: z.array(LabelSchema).min(2).max(12),
  series: z.array(SeriesSchema).min(1).max(3),
  xLabel: LabelSchema.optional(),
  yLabel: LabelSchema.optional(),
  unit: UnitSchema.optional(),
};

const seriesMatchLabels = (c: { labels: string[]; series: Array<{ values: Array<number | null> }> }) => c.series.every((s) => s.values.length === c.labels.length);
/** a chart with no number said yet is not a chart */
const someValue = (c: { series: Array<{ values: Array<number | null> }> }) => c.series.some((s) => s.values.some((v) => v !== null));

export const BarChartSchema = z
  .object({ kind: z.literal("bar"), ...CategoryChartBase })
  .refine(seriesMatchLabels, { message: "each series needs one value per label" })
  .refine(someValue, { message: "a chart needs at least one value" });
export const LineChartSchema = z
  .object({ kind: z.literal("line"), ...CategoryChartBase })
  .refine(seriesMatchLabels, { message: "each series needs one value per label" })
  .refine(someValue, { message: "a chart needs at least one value" });

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
    /** "" is a cell not said yet (drawn empty, filled in by an update) */
    rows: z.array(z.array(z.union([LabelSchema, z.literal("")])).min(2).max(4)).min(1).max(6),
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
/** A bullet on the slide: one key point or definition, as the lecturer made it ("Mitochondria make ATP"). */
export const NoteActionSchema = z.object({ type: z.literal("note"), text: NoteTextSchema });
export const ChartActionSchema = z.object({ type: z.literal("chart"), chart: ChartSpecSchema });
export const DiagramActionSchema = z.object({ type: z.literal("diagram"), diagram: DiagramSpecSchema });

/** A block's id on the board, as the director was told it (`LectureScreen.active`). */
export const LectureBlockIdSchema = z.string().trim().min(1).max(LECTURE_LIMITS.idChars);
/**
 * LIVE: the chart `target` on this screen, as it should now be — the WHOLE new spec (the Q2 bar
 * added, a value corrected, a series added). Same kind as before. The desk writes only what
 * changed; a target not on the screen any more is drawn as a new chart.
 */
export const UpdateChartSchema = z.object({ type: z.literal("update_chart"), target: LectureBlockIdSchema, chart: ChartSpecSchema });
/** LIVE: the diagram `target`, as it should now be (a step added to the flow, an event to the timeline). */
export const UpdateDiagramSchema = z.object({ type: z.literal("update_diagram"), target: LectureBlockIdSchema, diagram: DiagramSpecSchema });

// ------------------------------------------------------------------ free drawing

/**
 * FREE DRAWING: a picture of anything — "a futuristic police officer on a rooftop", "a plant cell",
 * "a medieval castle" — or a comic strip of up to four panels, drawn as ink by the tutor's hand
 * like everything else (never an image model's picture). The director only says WHAT each panel
 * shows (`prompt`, plain words) and what is written under it (`caption`); the illustrator
 * (`POST /api/live/lecture/sketch`) draws each panel as vector strokes (`SketchDrawing`), and the
 * planners (`sketch/`) turn those into hand-drawn ink in the panel's frame. The frames and captions
 * go on the board first; each drawing fills its frame when it arrives.
 */
export const LECTURE_SKETCH_LIMITS = {
  panels: 4,
  prompt: 240,
  /** what every panel of one sketch shares (the characters, the setting, the style), sent with each */
  cast: 400,
  /** a drawing, after the illustrator's vectors are sampled (the route drops what is past these) */
  strokes: 400,
  pointsPerStroke: 600,
  points: 24_000,
  labels: 16,
} as const;

export const SketchPanelSchema = z.object({
  /** what the panel shows, in plain words: the subject, what it is doing, where; no text to write in it */
  prompt: z.string().trim().min(3).max(LECTURE_SKETCH_LIMITS.prompt),
  /** written under the panel (a comic's caption, a picture's label) */
  caption: NoteTextSchema.optional(),
});

/**
 * A picture (one panel) or a comic strip (2–4 panels, in reading order). `cast` describes what the
 * panels share — "Officer Vega: tall, visor helmet, long coat; a neon city at night" — so the
 * separately drawn panels show the same character in the same world.
 */
export const SketchActionSchema = z.object({
  type: z.literal("sketch"),
  title: HeadingTextSchema.optional(),
  cast: z.string().trim().max(LECTURE_SKETCH_LIMITS.cast).optional(),
  panels: z.array(SketchPanelSchema).min(1).max(LECTURE_SKETCH_LIMITS.panels),
});
export type SketchAction = z.infer<typeof SketchActionSchema>;

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
  UpdateChartSchema,
  UpdateDiagramSchema,
  SketchActionSchema,
  GraphActionSchema,
  DrawFigureSchema,
  WriteLinesSchema,
  NewScreenSchema,
]);
export type LectureAction = z.infer<typeof LectureActionSchema>;
export type LectureActionType = LectureAction["type"];
export const LECTURE_ACTION_TYPES = ["heading", "note", "chart", "diagram", "update_chart", "update_diagram", "sketch", "graph", "draw_figure", "write_lines", "new_screen"] as const satisfies readonly LectureActionType[];

// ------------------------------------------------------------------ the director's request

/** A live visual on the screen: its id and its spec as drawn now (what an update starts from). */
export const ActiveVisualSchema = z.union([
  z.object({ id: LectureBlockIdSchema, chart: ChartSpecSchema }),
  z.object({ id: LectureBlockIdSchema, diagram: DiagramSpecSchema }),
]);
export type ActiveVisual = z.infer<typeof ActiveVisualSchema>;

/** What is on the current screen, in words: what not to draw again, and whether there is room. */
export const LectureScreenSchema = z.object({
  empty: z.boolean(),
  /** this screen's heading (the topic), when it has one */
  topic: HeadingTextSchema.nullable().default(null),
  /** one line per thing drawn here, from `describeLectureAction` ("bar chart: GDP growth by year") */
  drawn: z.array(z.string().max(LECTURE_LIMITS.whatChars)).max(LECTURE_LIMITS.drawn).default([]),
  /** roughly how much of the screen is still free, 0..1 */
  room: z.number().min(0).max(1),
  /** LIVE: the charts and diagrams on this screen the director may update, newest first */
  active: z.array(ActiveVisualSchema).max(LECTURE_LIMITS.active).default([]),
});
export type LectureScreen = z.infer<typeof LectureScreenSchema>;

export const LectureRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  /**
   * One listening session (a random id the session makes when it starts). Billing is per minute
   * of a session: the first request in each wall-clock minute is charged, the rest of that minute
   * are not (`live/lecture`).
   */
  session: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
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
  /** true when everything the model proposed was dropped and the ink was given back */
  refunded: z.boolean().optional(),
  /** true when this request started a new billed minute (ink was taken) */
  charged: z.boolean().optional(),
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
  /** the block's id on the board (`LECTURE_ID_META`), for a chart or a diagram drawn or updated */
  id?: string;
  /** the one-line summary of what was drawn (`describeLectureAction`), when it was */
  what?: string;
  note?: string;
}

export interface LectureRunReport {
  outcomes: LectureActionOutcome[];
  screensAdded: number;
}

// ------------------------------------------------------------------ on the page

// the meta keys (shape: block kind, summary, id; page: `LecturePageMeta`) live in `meta.ts`
export { LECTURE_BLOCK_META, LECTURE_ID_META, LECTURE_PAGE_META, LECTURE_WHAT_META } from "./meta";

/**
 * A live chart or diagram, kept on its screen's page meta (`LecturePageMeta.visuals`, by id): what
 * it shows, and the box and seed it was planned in, so an update re-plans it exactly the same way
 * and only the parts that changed are redrawn. On the page, not on a stroke: a stroke carrying it
 * could be the very part an update erases. An entry whose strokes are all gone (the student erased
 * the chart) is not live any more.
 */
export interface LectureSpecMeta {
  chart?: ChartSpec;
  diagram?: DiagramSpec;
  box: { w: number; h: number };
  seed: number;
  /** page coordinates of the plan's top-left when it was placed */
  at: { x: number; y: number };
  /** epoch ms of the last draw or update (live while within `LECTURE_TIMING.activeWindowMs`) */
  updatedAt: number;
}

/**
 * The inks of lecture sketches (tldraw colours). The first is the tutor's own; series and
 * regions take the next ones in order. Never red: red means "wrong" on this board.
 */
export const LECTURE_PALETTE = ["blue", "orange", "green", "violet", "light-blue", "yellow"] as const;
export type LectureInk = (typeof LECTURE_PALETTE)[number] | "black" | "grey";

export interface LecturePageMeta {
  /** the screen's heading */
  topic?: string;
  /** what was heard while this screen was the current one (capped, oldest dropped) */
  transcript?: string;
  /** the screen's charts and diagrams, by `LECTURE_ID_META` id */
  visuals?: Record<string, LectureSpecMeta>;
}

// ------------------------------------------------------------------ summaries

const CHART_NAMES: Record<ChartKind, string> = { bar: "bar chart", line: "line chart", pie: "pie chart", scatter: "scatter plot", table: "table" };
const DIAGRAM_NAMES: Record<DiagramKind, string> = { flow: "flow", cycle: "cycle", timeline: "timeline", hub: "concept map", tree: "tree", venn: "Venn diagram" };

const POLYGON_NAMES: Record<number, string> = { 3: "triangle", 4: "quadrilateral", 5: "pentagon", 6: "hexagon" };

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
    case "sketch":
      return clip(`${a.panels.length > 1 ? `comic (${a.panels.length} panels)` : "sketch"}: ${a.title ?? a.panels.map((p) => p.prompt).join("; ")}`);
    case "update_chart":
      return describeLectureAction({ type: "chart", chart: a.chart });
    case "update_diagram":
      return describeLectureAction({ type: "diagram", diagram: a.diagram });
    case "graph":
      return clip(`graph: ${a.relations.join("; ")}`);
    case "draw_figure": {
      // named by its shapes ("triangle ABC", "circle O"), else its points, so two figures differ
      const f = a.figure;
      const shapes = [
        ...(f.polygons ?? []).map((p) => `${POLYGON_NAMES[p.vertices.length] ?? "polygon"} ${p.vertices.join("")}`),
        ...(f.circles ?? []).map((c) => `circle ${c.center}`),
      ];
      return clip(`figure: ${shapes.length > 0 ? shapes.join(", ") : Object.keys(f.points).join(", ")}`);
    }
    case "write_lines":
      return clip(`formula: ${a.lines.join("; ")}`);
    case "new_screen":
      return "new screen";
  }
}

// ------------------------------------------------------------------ the illustrator

/**
 * `POST /api/live/lecture/sketch`: one panel drawn. The route asks the illustrator model for a
 * small SVG, parses the subset it allows (paths, lines, polylines, polygons, rects, circles,
 * ellipses, groups with transforms, text) and samples it into `SketchDrawing` — so the client
 * never parses markup a model wrote.
 */
export const SketchRequestSchema = z.object({
  boardId: z.string().min(1).max(64),
  /** the lecture session (billing is per panel drawn) */
  session: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
  prompt: z.string().trim().min(3).max(LECTURE_SKETCH_LIMITS.prompt),
  cast: z.string().trim().max(LECTURE_SKETCH_LIMITS.cast).optional(),
  /** a comic's panel ("panel 2 of 4") or a single picture */
  panel: z.object({ index: z.number().int().min(0).max(3), of: z.number().int().min(1).max(4) }).optional(),
  /** width / height of the frame it will fill (the drawing is composed for it) */
  aspect: z.number().min(0.4).max(2.5),
});
export type SketchRequest = z.input<typeof SketchRequestSchema>;

/** a coordinate in the drawing's box (x to 1000, y to `h`, which may be up to 2500 for a tall panel), with a little overshoot */
const Coord = z.number().finite().min(-50).max(2550);

/**
 * A drawing in its own box: x from 0 to 1000, y from 0 to `h` (1000 / aspect), y down. Each stroke
 * is one pen-down polyline, already sampled (curves flattened); `closed` joins its ends, and a
 * closed stroke may be filled with a pale tint of its colour. Labels are words the picture needs
 * (a sign, a name), written by the tutor's hand at (x, y), centred.
 */
export const SketchStrokeSchema = z.object({
  points: z.array(z.tuple([Coord, Coord])).min(2).max(LECTURE_SKETCH_LIMITS.pointsPerStroke),
  closed: z.boolean().default(false),
  color: z.enum([...LECTURE_PALETTE, "black", "grey"]).optional(),
  fill: z.boolean().default(false),
});
export const SketchLabelSchema = z.object({ text: LabelSchema, x: Coord, y: Coord, size: z.number().min(10).max(200).optional() });
export const SketchDrawingSchema = z
  .object({
    w: z.literal(1000),
    h: z.number().min(300).max(2500),
    strokes: z.array(SketchStrokeSchema).min(1).max(LECTURE_SKETCH_LIMITS.strokes),
    labels: z.array(SketchLabelSchema).max(LECTURE_SKETCH_LIMITS.labels).default([]),
  })
  .refine((d) => d.strokes.reduce((n, s) => n + s.points.length, 0) <= LECTURE_SKETCH_LIMITS.points, { message: "too many points" })
  .refine((d) => d.strokes.every((s) => s.points.every(([x, y]) => x <= 1050 && y <= d.h + 50)) && d.labels.every((l) => l.x <= 1050 && l.y <= d.h + 50), {
    message: "a point outside the drawing's box",
  });
export type SketchDrawing = z.infer<typeof SketchDrawingSchema>;
export type SketchStroke = z.infer<typeof SketchStrokeSchema>;

export const SketchResponseSchema = z.object({
  drawing: SketchDrawingSchema,
  model: z.string(),
  ms: z.number(),
  charged: z.boolean().optional(),
});
export type SketchResponse = z.infer<typeof SketchResponseSchema>;
