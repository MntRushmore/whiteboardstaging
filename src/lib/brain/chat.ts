/**
 * Ask's board actions for the native iPad app (docs/IPAD-NATIVE.md, Phase 3): the web board's own
 * `ChatDesk` (`src/lib/live/chat/desk.ts`) turned into a pure planner. Nothing of the desk is
 * rewritten: it runs, unchanged, against a host that is a copy of the screen in memory
 * (`PlanningHost`) instead of the tldraw editor. Everything it would do to the board is written
 * down, in order, as an operation (`ChatOp`) the app carries out with its own tutor pen; what it
 * writes goes onto the copy at once, so the next drawing of the same reply is placed clear of it,
 * exactly as on the web, where the hand has finished one block before the desk measures the next.
 *
 * Why a copy and not the app itself as the host: the desk awaits its host (`write` resolves once
 * the block is on the page). Bridging those promises into Swift would make the brain re-entrant;
 * here every promise the host hands out is already settled, so a run finishes within the microtasks
 * of one call (`chatPlan`), and the next call (`chatResult`) reads it. JavaScriptCore drains the
 * microtask queue when a call returns to the app (as node does between the test's awaits).
 *
 * What the copy cannot know, the app does when it carries the operations out:
 *  - the student moving to another screen mid-run (the app stops there, as the desk would);
 *  - Help me on the student's own work (`help_board`) and help with problem `n` (`help_problem`):
 *    the copy answers as the board would when it can (no problem `n` here: "missing"; nothing of
 *    the student's: "nothing"), and the app tells the outcome's words from what its loop did
 *    (`helpNotes`);
 *  - the loop's own writing (`handBusy`): the app waits for its pen before each operation.
 */
import type { JsonObject } from "tldraw";
import type { LiveEngine, Rect } from "@/lib/live/contracts";
import { ChatActionSchema, type ChatAction, type ChatActionOutcome, type ChatRunReport, type ChatScreen, type ChatScreenFrom } from "@/lib/live/chat/contracts";
import { problemMetaOf } from "@/lib/live/chat/cells";
import { CHAT_LINE_ID, ChatDesk, HELP_BOARD_NOTES, type ChatHost, type ChatShape, type HelpBoardResult } from "@/lib/live/chat/desk";
import { planFigure } from "@/lib/live/figureDraw/plan";
import { HAND_LINE_META, handSeedFor, type HandPlan } from "@/lib/live/handwriting";
import { ECHO_HEIGHTS, estimateEchoWidth } from "@/lib/live/placement";

/** A record on the screen as the desk sees it (`ChatShape`): page bounds, its meta, a typeset line's LaTeX. */
export interface BrainChatShape {
  id: string;
  /** "draw" (a stroke), "math", "graph", "image", "geo" — the web's shape types */
  type: string;
  meta?: Record<string, unknown> | null;
  bounds: Rect | null;
  latex?: string;
}

export interface ChatScreenArgs {
  /** everything on the current screen */
  shapes: BrainChatShape[];
  /** the current screen's id (the app's screen record) */
  pageId: string;
  /** its number on the board, from 1 */
  screenIndex?: number | null;
  /** the student's lines on this screen as read, in reading order */
  studentLines?: string[];
  /** screens the tutor started for its work, by id: the problems of the screen each came from */
  carried?: Record<string, ChatScreenFrom>;
}

export interface ChatPlanArgs extends ChatScreenArgs {
  /** the `actions` event's actions, as the route sent them (checked again here: a bad one is skipped) */
  actions: unknown[];
  /** the current screen's rect (page units) */
  screen: Rect;
  /** the tutor's handwriting is on (off: problems and lines are typeset) */
  handwriting?: boolean;
  /** screens that may still be added (the board's cap less the screens it has) */
  screensLeft?: number;
}

/** What the app does, in order. `page` is the screen it happens on: the current one, or one the run started (`new:1`, …). */
export type ChatOp =
  /** writes a placed plan (page units) in the tutor's hand as one whole block; `meta` on every stroke, `lead` on the first */
  | { op: "write"; page: string; plan: HandPlan; meta: JsonObject; lead?: JsonObject }
  /** the hand is off: typeset maths in `rect` */
  | { op: "typeset"; page: string; latex: string; rect: Rect; meta: JsonObject }
  /** adds a blank screen after the last and moves to it */
  | { op: "addScreen"; page: string }
  /** erases the tutor's writing on this screen (the board's "clear your writing") */
  | { op: "clearTutor"; page: string }
  /** the problems on the screen changed: the loop re-reads the columns under them */
  | { op: "problemsChanged"; page: string }
  /** helps with problem `n` on this screen as the loop does (`LiveLoop.chatHelp`) */
  | { op: "helpProblem"; page: string; n: number; depth: "step" | "solve" }
  /** Help me (`step`) / Solve it (`solve`) on the student's own work, as the board's button */
  | { op: "helpBoard"; page: string; depth: "step" | "solve" }
  /** a pause the desk takes between blocks (a worked solution's steps) */
  | { op: "pause"; page: string; ms: number }
  | { op: "metric"; page: string; name: string; data: Record<string, unknown> };

export interface ChatPlanResult {
  ops: ChatOp[];
  report: ChatRunReport;
  /** each screen the run started (`new:n`) that carries the problems of the screen it came from */
  carried: Record<string, ChatScreenFrom>;
  /** actions that were not actions (skipped before the run) */
  skipped: number;
  /** the desk threw part-way (a bug): the operations before it still stand */
  failed?: string;
  /** the panel's words for each Help me outcome that wrote nothing (`HELP_BOARD_NOTES`) */
  helpNotes: Record<string, string>;
}

const isLive = (meta: unknown) => Boolean(meta && typeof meta === "object" && (meta as Record<string, unknown>).live === true);

/** The page bounds of a stroke's points (a hand plan's stroke, relative to its line). */
function pointsRect(points: ReadonlyArray<{ x: number; y: number }>, dx: number, dy: number): Rect | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0 + dx, y: y0 + dy, w: x1 - x0, h: y1 - y0 };
}

/**
 * The screen in memory, as the desk's host. Every promise is settled when it is handed out; the
 * hand is never busy (the app waits for its own pen), a new screen is ready at once.
 */
export class PlanningHost implements ChatHost {
  readonly ops: ChatOp[] = [];
  private page: string;
  private screens = 0;
  private shapesNow: ChatShape[];
  private readonly lines: string[];
  private readonly hand: boolean;
  private left: number;
  private readonly rect: Rect;
  private readonly index: number | null;
  private seq = 0;

  constructor(
    args: ChatPlanArgs,
    private readonly brainEngine: () => LiveEngine,
  ) {
    this.page = args.pageId;
    this.rect = { ...args.screen };
    this.shapesNow = args.shapes.map((s) => ({ id: s.id, type: s.type, meta: s.meta ?? {}, bounds: s.bounds ?? null, ...(s.latex !== undefined ? { latex: s.latex } : {}) }));
    this.lines = [...(args.studentLines ?? [])];
    this.hand = args.handwriting !== false;
    this.left = Math.max(0, Math.floor(args.screensLeft ?? 0));
    this.index = typeof args.screenIndex === "number" && args.screenIndex >= 1 ? args.screenIndex : null;
  }

  /** The screens this run started, in order. */
  get started(): string[] {
    return this.ops.filter((o): o is Extract<ChatOp, { op: "addScreen" }> => o.op === "addScreen").map((o) => o.page);
  }

  engine(): Promise<LiveEngine> {
    return Promise.resolve(this.brainEngine());
  }

  shapes(): ChatShape[] {
    return this.shapesNow;
  }

  screen(): Rect {
    return { ...this.rect };
  }

  pageId(): string {
    return this.page;
  }

  screenIndex(): number | null {
    return this.index === null ? null : this.index + this.screens;
  }

  studentLines(): string[] {
    // a screen the run started has none of the student's work
    return this.screens === 0 ? this.lines : [];
  }

  handwriting(): boolean {
    return this.hand;
  }

  handBusy(): boolean {
    return false;
  }

  write(plan: HandPlan, extraMeta: JsonObject, leadMeta?: JsonObject): Promise<void> {
    const meta: JsonObject = { live: true, source: "ai", lineId: CHAT_LINE_ID, ...extraMeta };
    this.ops.push({ op: "write", page: this.page, plan, meta: { ...extraMeta }, ...(leadMeta ? { lead: { ...leadMeta } } : {}) });
    // each stroke a shape, as the web's hand writes them, so the next block keeps clear of this one
    for (const line of plan.lines) {
      for (const stroke of line.strokes) {
        const bounds = pointsRect(stroke.points, line.x, line.y);
        if (!bounds) continue;
        this.shapesNow.push({ id: `planned:${++this.seq}`, type: "draw", meta: { ...meta, [HAND_LINE_META]: line.latex }, bounds });
      }
    }
    return Promise.resolve();
  }

  typeset(latex: string, at: { x: number; y: number }, extraMeta: JsonObject): Rect {
    // the web board's own estimate (`LiveLoop.chatHost.typeset`)
    const rect = { x: at.x, y: at.y, w: estimateEchoWidth(latex), h: ECHO_HEIGHTS.m };
    this.ops.push({ op: "typeset", page: this.page, latex, rect, meta: { ...extraMeta } });
    this.shapesNow.push({ id: `planned:${++this.seq}`, type: "math", meta: { live: true, source: "ai", lineId: CHAT_LINE_ID, ...extraMeta }, bounds: rect, latex });
    return rect;
  }

  addScreen(): boolean {
    if (this.left <= 0) return false;
    this.left--;
    this.screens++;
    this.page = `new:${this.screens}`;
    this.shapesNow = [];
    this.ops.push({ op: "addScreen", page: this.page });
    return true;
  }

  screenReady(): boolean {
    return true;
  }

  clearTutor(): void {
    // the web's `clearMarks`: the tutor's writing goes, a lecture's notes stay
    this.shapesNow = this.shapesNow.filter((s) => {
      const meta = (s.meta ?? {}) as Record<string, unknown>;
      return !(isLive(meta) && meta.source === "ai" && !meta.lectureBlock);
    });
    this.ops.push({ op: "clearTutor", page: this.page });
  }

  problemsChanged(): void {
    this.ops.push({ op: "problemsChanged", page: this.page });
  }

  helpProblem(n: number, depth: "step" | "solve"): "writing" | "done" | "busy" | "missing" {
    const here = this.shapesNow.some((s) => problemMetaOf(s.meta)?.n === n);
    if (!here) return "missing";
    this.ops.push({ op: "helpProblem", page: this.page, n, depth });
    return "writing";
  }

  helpBoard(depth: "step" | "solve"): HelpBoardResult {
    // the student's own work: a line read, or ink of theirs (not the tutor's)
    const theirs = this.studentLines().length > 0 || this.shapesNow.some((s) => !isLive(s.meta) && s.type === "draw");
    if (!theirs) return "nothing";
    this.ops.push({ op: "helpBoard", page: this.page, depth });
    return "writing";
  }

  planFigure: ChatHost["planFigure"] = (spec, opts) => planFigure(spec, opts);

  seed(key: string): number {
    return handSeedFor(key);
  }

  delay(ms: number): Promise<void> {
    if (ms > 0) this.ops.push({ op: "pause", page: this.page, ms });
    return Promise.resolve();
  }

  metric(name: string, data: Record<string, unknown>): void {
    this.ops.push({ op: "metric", page: this.page, name, data });
  }
}

/** The actions that are actions (the route checked them; a client checks again before writing). */
export function cleanActions(raw: unknown[]): { actions: ChatAction[]; skipped: number } {
  const actions: ChatAction[] = [];
  let skipped = 0;
  for (const a of Array.isArray(raw) ? raw : []) {
    const parsed = ChatActionSchema.safeParse(a);
    if (parsed.success) actions.push(parsed.data);
    else skipped++;
  }
  return { actions, skipped };
}

/**
 * Plans a reply's actions on a copy of the screen: what the web board's desk would write, where,
 * and in what order (`ChatOp`s), with the run's report — the same desk, the same placement, the
 * same checks by the same engine.
 */
export async function planChat(args: ChatPlanArgs, engine: () => LiveEngine): Promise<ChatPlanResult> {
  const { actions, skipped } = cleanActions(args.actions);
  const host = new PlanningHost(args, engine);
  const desk = new ChatDesk(host);
  for (const [page, from] of Object.entries(args.carried ?? {})) desk.carry(page, from);
  let report: ChatRunReport = { outcomes: [], problemsWritten: 0, problemsDropped: 0, screensAdded: 0 };
  let failed: string | undefined;
  try {
    report = await desk.run(actions);
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
    report.screensAdded = host.started.length;
  }
  const carried: Record<string, ChatScreenFrom> = {};
  for (const page of host.started) {
    const from = desk.carriedFrom(page);
    if (from) carried[page] = from;
  }
  return { ops: host.ops, report, carried, skipped, ...(failed ? { failed } : {}), helpNotes: { ...HELP_BOARD_NOTES } };
}

/** What is on the current screen as maths, for an ask's `screen` (`ChatDesk.picture`). */
export function chatPicture(args: ChatScreenArgs, engine: () => LiveEngine): ChatScreen {
  const host = new PlanningHost({ ...args, actions: [], screen: { x: 0, y: 0, w: 1600, h: 900 } }, engine);
  const desk = new ChatDesk(host);
  for (const [page, from] of Object.entries(args.carried ?? {})) desk.carry(page, from);
  return desk.picture();
}

// ------------------------------------------------------------------ one run at a time, across two calls

let tickets = 0;
const runs = new Map<number, { done: boolean; result?: ChatPlanResult; error?: string }>();

/** Starts a plan; its result is read with `takeChatPlan` on the next call (the run settles in between). */
export function startChatPlan(args: ChatPlanArgs, engine: () => LiveEngine): { ticket: number } {
  const ticket = ++tickets;
  const slot: { done: boolean; result?: ChatPlanResult; error?: string } = { done: false };
  runs.set(ticket, slot);
  planChat(args, engine).then(
    (result) => {
      slot.done = true;
      slot.result = result;
    },
    (e: unknown) => {
      slot.done = true;
      slot.error = e instanceof Error ? e.message : String(e);
    },
  );
  return { ticket };
}

/** A plan's result, once (null while it runs, which a run whose host settles everything never is). */
export function takeChatPlan(ticket: number): { done: boolean; result?: ChatPlanResult; error?: string } {
  const slot = runs.get(ticket);
  if (!slot) return { done: true, error: `no chat plan ${ticket}` };
  if (slot.done) runs.delete(ticket);
  return slot;
}

/** An outcome's words, for the app's own Help me outcome (`help_board` that wrote nothing). */
export function helpBoardOutcome(result: HelpBoardResult): ChatActionOutcome {
  if (result === "writing") return { type: "help_board", ok: true };
  const why = result === "reading" ? "busy" : result;
  return { type: "help_board", ok: false, note: HELP_BOARD_NOTES[why], why };
}
