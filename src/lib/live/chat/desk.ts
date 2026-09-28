import type { JsonObject } from "tldraw";
import type { GraphIntent, LiveEngine, Rect } from "../contracts";
import type { FigurePlanOptions, FigurePlanResult, FigureSpec } from "../figureDraw/contracts";
import { GRAPH, graphPaceFor, planGraph, type GraphWindowHint } from "../graphing";
import { HAND_LINE_META, planHandwriting, placeHandPlan, placeHandPlanOnBaseline, type HandPlan } from "../handwriting";
import { CHAT_PROBLEM_META, problemMetaOf } from "./cells";
import type { ChatAction, ChatActionOutcome, ChatRunReport, ChatScreen, ChatWindow, WriteProofAction } from "./contracts";
import { CHAT_LIMITS } from "./contracts";
import { chunkProblems, findFreeArea, joinPlans, planGrid, PROBLEM_GRID } from "./layout";
import { verifyLines, verifyProblem } from "./verify";

/**
 * The board chat's hand: runs a reply's actions on the board, one at a time, in the tutor's
 * writing — problems as a numbered grid with room to work under each, maths written as given, a
 * graph sketched like the unasked ones, a figure, a two-column proof (`proofWrite.ts`, loaded on
 * first use), a new screen, the tutor's ink cleared. Nothing a model proposed is written until the
 * engine has read it (`verify.ts`; a proof, `proof.ts`); what is left out comes back as a note for
 * the panel. No words on the board: numbers are `1.`, `2.`, … (a proof's Given / Prove and reasons
 * are the one exception, in the proof reader's own vocabulary).
 *
 * The loop is the host (`LiveLoop.chatHost`), as it is for `ProofDesk`: it owns the editor, the
 * writer and the screens; this file decides what goes where.
 */

/** meta of the chat's other writing: the kind of block (`lines`, `graph`, `figure`) */
export const CHAT_BLOCK_META = "chatBlock";
/** meta.lineId of everything the chat writes (no student line has it) */
export const CHAT_LINE_ID = "chat";

export const CHAT_WRITE = {
  /** hand size of `write_lines`: a formula is read from across the room, like a problem */
  linesSize: 44,
  /** hand size of a graph's equations above it */
  graphLabelSize: 34,
  /** space between a graph's equations and the graph */
  graphLabelGap: 14,
  /** figure boxes, largest first */
  figureBoxes: [
    { w: 460, h: 380 },
    { w: 380, h: 310 },
    { w: 300, h: 250 },
  ],
  /** a problem set is written a little faster than a worked solution: six problems in ~8 s */
  problemPace: 1.8,
  /** how long to wait for the loop's own writing to finish before starting */
  waitStepMs: 150,
  waitMaxMs: 30_000,
  /** after adding a screen, until the loop has switched to it (one frame, normally) */
  screenWaitStepMs: 20,
  screenWaitMaxMs: 2_000,
} as const;

export interface ChatShape {
  id: string;
  type: string;
  meta: unknown;
  bounds: Rect | null;
  /** a typeset maths shape's LaTeX */
  latex?: string;
}

export interface ChatHost {
  engine(): Promise<LiveEngine>;
  /** every shape on the current screen, with its page bounds */
  shapes(): ChatShape[];
  /** the current screen's rect (the viewport on an editor without screens) */
  screen(): Rect;
  /** the current screen's id: a run stops when the student moves to another one */
  pageId(): string;
  /** the student's lines on this screen as read, in reading order */
  studentLines(): string[];
  handwriting(): boolean;
  /** the loop's own hand is writing (a worked solution, an answer): the chat waits its turn */
  handBusy(): boolean;
  /** writes a placed plan as ONE whole block (a cancel completes it); resolves once it is on the page */
  write(plan: HandPlan, extraMeta: JsonObject): Promise<void>;
  /** the hand is off: typeset maths at `at` instead */
  typeset(latex: string, at: { x: number; y: number }, extraMeta: JsonObject): Rect;
  /** adds a blank screen after the last and moves to it; false at the cap */
  addScreen(): boolean;
  /**
   * The loop has taken the current screen in. Its store listener runs a frame after a screen
   * switch and puts down any pen in flight — a block started before that would be dropped.
   */
  screenReady(): boolean;
  /** erases the tutor's ink on this screen */
  clearTutor(): void;
  /** the problems on the screen changed: the loop re-reads the columns under them */
  problemsChanged(): void;
  planFigure(spec: FigureSpec, opts: FigurePlanOptions): FigurePlanResult | null;
  seed(key: string): number;
  delay(ms: number): Promise<void>;
  metric?(name: string, data: Record<string, unknown>): void;
}

type Report = ChatRunReport;

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** A graph intent seen through a requested window: key points outside it are left out. */
export function windowedIntent(intent: GraphIntent, win: ChatWindow | undefined): GraphIntent {
  if (!win || intent.kind !== "plane") return intent;
  const inY = (y: number) => (win.yMin === undefined || y >= win.yMin) && (win.yMax === undefined || y <= win.yMax);
  return {
    ...intent,
    points: intent.points.filter((p) => p.x >= win.xMin && p.x <= win.xMax && inY(p.y)),
    asymptotes: intent.asymptotes.filter((a) => (a.axis === "vertical" ? a.at >= win.xMin && a.at <= win.xMax : inY(a.at))),
  };
}

export class ChatDesk {
  private readonly host: ChatHost;
  private tail: Promise<unknown> = Promise.resolve();
  private expectedPage = "";
  private running = 0;

  constructor(host: ChatHost) {
    this.host = host;
  }

  /** Actions are being written (the panel's "writing" state). */
  get busy(): boolean {
    return this.running > 0;
  }

  // ---------------------------------------------------------------- the screen, for the request

  /** What is on this screen, as maths: the student's lines, the tutor's lines, the problems. */
  picture(): ChatScreen {
    const shapes = this.host.shapes();
    const problems = new Map<number, string>();
    const tutor: Array<{ latex: string; y: number }> = [];
    const seen = new Set<string>();
    for (const s of shapes) {
      const p = problemMetaOf(s.meta);
      if (p) {
        if (!problems.has(p.n)) problems.set(p.n, p.lines.join("; "));
        continue;
      }
      const meta = (s.meta ?? {}) as Record<string, unknown>;
      if (meta.live !== true || meta.source !== "ai") continue;
      // marks, graphs and figures are drawings: their "lines" are labels, not maths
      if (meta.mark || meta.graphFor || meta[CHAT_BLOCK_META] === "graph" || meta[CHAT_BLOCK_META] === "figure") continue;
      const latex = typeof meta[HAND_LINE_META] === "string" ? (meta[HAND_LINE_META] as string) : (s.latex ?? "");
      if (!latex || seen.has(latex)) continue;
      seen.add(latex);
      tutor.push({ latex, y: s.bounds?.y ?? 0 });
    }
    const cap = (list: string[]) => list.slice(0, CHAT_LIMITS.screenLines).map((l) => l.slice(0, CHAT_LIMITS.lineLatex));
    return {
      empty: shapes.length === 0,
      student: cap(this.host.studentLines()),
      tutor: cap(tutor.sort((a, b) => a.y - b.y).map((t) => t.latex)),
      problems: [...problems.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l).slice(0, CHAT_LIMITS.problems),
    };
  }

  // ---------------------------------------------------------------- running a reply

  /** Runs the actions in order, one block at a time; a second reply waits for the first. */
  run(actions: readonly ChatAction[]): Promise<Report> {
    const next = this.tail.then(() => this.runNow(actions));
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async runNow(actions: readonly ChatAction[]): Promise<Report> {
    this.running++;
    const report: Report = { outcomes: [], problemsWritten: 0, problemsDropped: 0, screensAdded: 0 };
    try {
      const engine = await this.host.engine();
      this.expectedPage = this.host.pageId();
      for (const action of actions) {
        if (this.host.pageId() !== this.expectedPage) {
          report.outcomes.push({ type: action.type, ok: false, note: "I stopped because you moved to another screen." });
          break;
        }
        report.outcomes.push(await this.runOne(action, engine, report));
      }
    } finally {
      this.running--;
    }
    return report;
  }

  private async runOne(action: ChatAction, engine: LiveEngine, report: Report): Promise<ChatActionOutcome> {
    switch (action.type) {
      case "write_problems":
        return this.writeProblems(action.problems, engine, report);
      case "write_lines":
        return this.writeLines(action.lines, engine, report);
      case "graph":
        return this.graph(action.relations, action.window, engine, report);
      case "draw_figure":
        return this.figure(action.figure, report);
      case "new_screen":
        return (await this.newScreen(report)) ? { type: "new_screen", ok: true } : { type: "new_screen", ok: false, note: "This board already has the most screens it can hold." };
      case "clear_tutor":
        await this.waitForHand();
        this.host.clearTutor();
        this.host.problemsChanged();
        return { type: "clear_tutor", ok: true };
      case "write_proof":
        return this.proof(action, report);
    }
  }

  /** A two-column proof: checked, laid out and written by `proofWrite.ts`, loaded on first use. */
  private async proof(action: WriteProofAction, report: Report): Promise<ChatActionOutcome> {
    const { writeProof } = await import("./proofWrite");
    return writeProof(
      {
        host: this.host,
        screenEmpty: () => this.screenEmpty(),
        newScreen: () => this.newScreen(report),
        waitForHand: () => this.waitForHand(),
        writeBlock: (plan, meta) => this.writeBlock(plan, meta),
        onScreen: () => this.host.pageId() === this.expectedPage,
      },
      action,
    );
  }

  // ---------------------------------------------------------------- helpers

  private async newScreen(report: Report): Promise<boolean> {
    await this.waitForHand();
    if (!this.host.addScreen()) return false;
    this.expectedPage = this.host.pageId();
    report.screensAdded++;
    // nothing is written until the loop has moved to the new screen with us
    for (let waited = 0; !this.host.screenReady() && waited < CHAT_WRITE.screenWaitMaxMs; waited += CHAT_WRITE.screenWaitStepMs) {
      await this.host.delay(CHAT_WRITE.screenWaitStepMs);
    }
    return true;
  }

  private screenEmpty(): boolean {
    return this.host.shapes().length === 0;
  }

  /** What free space must stay clear of: everything on the screen, and the whole of each problem's cell (the student works there). */
  private obstacles(): Rect[] {
    const out: Rect[] = [];
    const cells = new Set<string>();
    for (const s of this.host.shapes()) {
      if (s.bounds) out.push(s.bounds);
      const p = problemMetaOf(s.meta);
      const key = p ? `${p.cell.x},${p.cell.y}` : "";
      if (p && !cells.has(key)) {
        cells.add(key);
        out.push(p.cell);
      }
    }
    return out;
  }

  private async waitForHand(): Promise<void> {
    let waited = 0;
    while (this.host.handBusy() && waited < CHAT_WRITE.waitMaxMs) {
      await this.host.delay(CHAT_WRITE.waitStepMs);
      waited += CHAT_WRITE.waitStepMs;
    }
  }

  private async writeBlock(plan: HandPlan, extraMeta: JsonObject): Promise<void> {
    await this.waitForHand();
    await this.host.write(plan, extraMeta);
  }

  private canDraw = (lines: readonly string[]): boolean => {
    if (!this.host.handwriting()) return true;
    return planHandwriting(lines, { size: PROBLEM_GRID.size, seed: 1 }).unsupported.length === 0;
  };

  /** A place for a block of this size on this screen, else on a new one. */
  private async placeFor(size: { w: number; h: number }, report: Report): Promise<Rect | null> {
    const here = findFreeArea(size, this.host.screen(), this.obstacles());
    if (here) return here;
    if (!(await this.newScreen(report))) return null;
    return findFreeArea(size, this.host.screen(), this.obstacles());
  }

  // ---------------------------------------------------------------- problems

  /** The number and the problem, placed at the top of its cell, as one plan (null: the hand cannot write it). */
  private problemPlan(lines: readonly string[], n: number, cell: Rect, size: number): HandPlan | null {
    const seed = this.host.seed(`chat:problem:${n}:${lines.join(";")}`);
    const num = planHandwriting([`${n}.`], { size, seed });
    const body = planHandwriting(lines, { size, seed: seed + 1 });
    if (!num.plan || !body.plan || body.unsupported.length > 0) return null;
    const pad = PROBLEM_GRID.cellPad;
    const gap = size * PROBLEM_GRID.numberGap;
    const placedBody = placeHandPlan(body.plan, { x: cell.x + pad + num.plan.bounds.w + gap, y: cell.y + pad });
    const first = placedBody.lines[0];
    const placedNum = placeHandPlanOnBaseline(num.plan, { x: cell.x + pad, baselineY: first.y + first.baseline });
    const joined = joinPlans([placedNum, placedBody], 250);
    if (!joined) return null;
    return { ...joined, pace: Math.max(joined.pace ?? 1, CHAT_WRITE.problemPace) };
  }

  private problemWidth(lines: readonly string[], n: number, size: number): number {
    const num = planHandwriting([`${n}.`], { size, seed: 1 });
    const body = planHandwriting(lines, { size, seed: 1 });
    if (!num.plan || !body.plan) return Infinity;
    return num.plan.bounds.w + size * PROBLEM_GRID.numberGap + body.plan.bounds.w;
  }

  private async writeProblems(problems: readonly string[][], engine: LiveEngine, report: Report): Promise<ChatActionOutcome> {
    const kept: string[][] = [];
    let unchecked = 0;
    for (const p of problems) {
      const v = verifyProblem(engine, p, this.canDraw);
      if (v.ok) kept.push(p.map((l) => l.trim()));
      else {
        unchecked++;
        this.host.metric?.("live.chat.problem.dropped", { reason: v.reason });
      }
    }
    if (kept.length === 0) {
      report.problemsDropped += unchecked;
      return { type: "write_problems", ok: false, note: `I couldn't check ${plural(problems.length, "that problem", "those problems")}, so I didn't write ${plural(problems.length, "it", "them")}.` };
    }
    const hand = this.host.handwriting();
    let written = 0;
    let n = 1;
    let index = 0;
    let stopped = "";
    const chunks = chunkProblems(kept.length);
    for (let ci = 0; ci < chunks.length && !stopped; ci++) {
      const items = kept.slice(index, index + chunks[ci]);
      index += items.length;
      await this.waitForHand();
      // a screen with anything on it keeps its work: the problems go on a fresh one
      if ((ci > 0 || !this.screenEmpty()) && !(await this.newScreen(report))) {
        stopped = "This board already has the most screens it can hold.";
        break;
      }
      const grid = planGrid(this.host.screen(), items.length, (i, size) => (hand ? this.problemWidth(items[i], n + i, size) : 0));
      for (let i = 0; grid && i < items.length; i++) {
        if (this.host.pageId() !== this.expectedPage) {
          stopped = "I stopped because you moved to another screen.";
          break;
        }
        const lines = items[i];
        const cell = grid.cells[i];
        const meta: JsonObject = { [CHAT_PROBLEM_META]: { n: n + i, lines, cell: { ...cell } } };
        if (hand) {
          const plan = this.problemPlan(lines, n + i, cell, grid.size);
          if (!plan) continue;
          await this.writeBlock(plan, meta);
        } else {
          const pad = PROBLEM_GRID.cellPad;
          const first = this.host.typeset(`${n + i}.\\ \\ ${lines[0]}`, { x: cell.x + pad, y: cell.y + pad }, meta);
          let y = first.y + first.h + 6;
          for (const extra of lines.slice(1)) y += this.host.typeset(extra, { x: first.x + 34, y }, meta).h + 6;
        }
        written++;
      }
      n += items.length;
    }
    const unplaced = kept.length - written;
    report.problemsWritten += written;
    report.problemsDropped += unchecked + unplaced;
    if (written > 0) this.host.problemsChanged();
    this.host.metric?.("live.chat.problems", { written, unchecked, unplaced, screens: report.screensAdded });
    const notes: string[] = [];
    if (unchecked > 0) notes.push(`${unchecked} of ${problems.length} problems couldn't be checked, so I left ${plural(unchecked, "it", "them")} out.`);
    if (stopped) notes.push(stopped);
    else if (unplaced > 0) notes.push(`${unplaced} ${plural(unplaced, "problem", "problems")} didn't fit, so I left ${plural(unplaced, "it", "them")} out.`);
    return { type: "write_problems", ok: written > 0, ...(notes.length ? { note: notes.join(" ") } : {}) };
  }

  // ---------------------------------------------------------------- lines

  private async writeLines(lines: readonly string[], engine: LiveEngine, report: Report): Promise<ChatActionOutcome> {
    const v = verifyLines(engine, lines, this.canDraw);
    if (!v.ok) {
      const note = v.reason === "false" ? "I left out lines that didn't check out." : v.reason === "unchecked" ? "I couldn't check those lines, so I didn't write them." : "I couldn't write that on the board.";
      return { type: "write_lines", ok: false, note };
    }
    const clean = lines.map((l) => l.trim()).filter(Boolean);
    const meta: JsonObject = { [CHAT_BLOCK_META]: "lines" };
    if (!this.host.handwriting()) {
      const est = { w: 420, h: clean.length * 56 };
      const slot = await this.placeFor(est, report);
      if (!slot) return { type: "write_lines", ok: false, note: "There's no room left on this board." };
      let y = slot.y;
      for (const l of clean) y += this.host.typeset(l, { x: slot.x, y }, meta).h + 8;
      return { type: "write_lines", ok: true };
    }
    const { plan } = planHandwriting(clean, { size: CHAT_WRITE.linesSize, seed: this.host.seed(`chat:lines:${clean.join(";")}`) });
    if (!plan) return { type: "write_lines", ok: false, note: "I couldn't write that on the board." };
    await this.waitForHand();
    const slot = await this.placeFor({ w: plan.bounds.w, h: plan.bounds.h }, report);
    if (!slot) return { type: "write_lines", ok: false, note: "There's no room left on this board." };
    await this.writeBlock(placeHandPlan(plan, { x: slot.x, y: slot.y }), meta);
    return { type: "write_lines", ok: true };
  }

  // ---------------------------------------------------------------- graphs

  private async graph(relations: readonly string[], win: ChatWindow | undefined, engine: LiveEngine, report: Report): Promise<ChatActionOutcome> {
    const clean = relations.map((r) => r.trim()).filter(Boolean);
    const cannot: ChatActionOutcome = { type: "graph", ok: false, note: "I couldn't graph that." };
    if (!this.host.handwriting()) return { type: "graph", ok: false, note: "The tutor's handwriting is switched off, so I can't sketch a graph." };
    let intent: GraphIntent | null = null;
    try {
      intent = engine.graphFor?.(clean) ?? null;
    } catch {
      intent = null;
    }
    if (!intent) return cannot;
    const shown = windowedIntent(intent, win);
    const hint: GraphWindowHint | undefined = win && shown.kind === "plane" ? { ...win } : undefined;
    const seed = this.host.seed(`chat:graph:${intent.key}`);
    const label = planHandwriting(clean, { size: CHAT_WRITE.graphLabelSize, seed: seed + 7 });
    const labelPlan = label.plan && label.unsupported.length === 0 ? label.plan : null;
    await this.waitForHand();
    const tryPlace = (): { plan: HandPlan } | null => {
      for (const box of [GRAPH.box, ...GRAPH.fallbackBoxes]) {
        const g = planGraph(shown, { seed, box, window: hint });
        if (!g) return null;
        const labelH = labelPlan ? labelPlan.bounds.h + CHAT_WRITE.graphLabelGap : 0;
        const size = { w: Math.max(g.plan.bounds.w, labelPlan?.bounds.w ?? 0), h: g.plan.bounds.h + labelH };
        const slot = findFreeArea(size, this.host.screen(), this.obstacles());
        if (!slot) continue;
        const parts = [...(labelPlan ? [placeHandPlan(labelPlan, { x: slot.x, y: slot.y })] : []), placeHandPlan(g.plan, { x: slot.x, y: slot.y + labelH })];
        const plan = joinPlans(parts, 300, graphPaceFor);
        return plan ? { plan } : null;
      }
      return null;
    };
    let placed = tryPlace();
    if (!placed && planGraph(shown, { seed, window: hint }) && (await this.newScreen(report))) placed = tryPlace();
    if (!placed) return planGraph(shown, { seed, window: hint }) ? { type: "graph", ok: false, note: "There's no room left for the graph." } : cannot;
    await this.writeBlock(placed.plan, { [CHAT_BLOCK_META]: "graph", chatGraph: intent.key });
    this.host.metric?.("live.chat.graph", { kind: intent.kind, window: Boolean(win) });
    return { type: "graph", ok: true };
  }

  // ---------------------------------------------------------------- figures

  private async figure(spec: FigureSpec, report: Report): Promise<ChatActionOutcome> {
    const cannot: ChatActionOutcome = { type: "draw_figure", ok: false, note: "I couldn't draw that figure." };
    if (!this.host.handwriting()) return { type: "draw_figure", ok: false, note: "The tutor's handwriting is switched off, so I can't draw a figure." };
    const seed = this.host.seed(`chat:figure:${JSON.stringify(spec).slice(0, 400)}`);
    await this.waitForHand();
    const plans: HandPlan[] = [];
    for (const box of CHAT_WRITE.figureBoxes) {
      let res: FigurePlanResult | null = null;
      try {
        res = this.host.planFigure(spec, { seed, box });
      } catch {
        res = null;
      }
      if (!res) return cannot;
      plans.push(res.plan);
      const slot = findFreeArea({ w: res.plan.bounds.w, h: res.plan.bounds.h }, this.host.screen(), this.obstacles());
      if (!slot) continue;
      await this.writeBlock(placeHandPlan(res.plan, { x: slot.x, y: slot.y }), { [CHAT_BLOCK_META]: "figure" });
      return { type: "draw_figure", ok: true };
    }
    if (!(await this.newScreen(report))) return { type: "draw_figure", ok: false, note: "There's no room left for the figure." };
    const slot = findFreeArea({ w: plans[0].bounds.w, h: plans[0].bounds.h }, this.host.screen(), this.obstacles());
    if (!slot) return cannot;
    await this.writeBlock(placeHandPlan(plans[0], { x: slot.x, y: slot.y }), { [CHAT_BLOCK_META]: "figure" });
    return { type: "draw_figure", ok: true };
  }
}
