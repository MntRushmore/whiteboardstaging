import type { JsonObject } from "tldraw";
import type { GraphIntent, LiveEngine, Rect } from "../contracts";
import type { FigurePlanOptions, FigurePlanResult, FigureSpec } from "../figureDraw/contracts";
import { GRAPH, graphPaceFor, planGraph, type GraphWindowHint } from "../graphing";
import { HAND_LINE_META, planHandwriting, placeHandPlan, placeHandPlanOnBaseline, type HandPlan } from "../handwriting";
import { CHAT_PROBLEM_META, problemMetaOf } from "./cells";
import type { ChatAction, ChatActionOutcome, ChatRunReport, ChatScreen, ChatWindow } from "./contracts";
import { CHAT_LIMITS, noProblemNote } from "./contracts";
import { chunkProblems, findFreeArea, joinPlans, planGrid, PROBLEM_GRID } from "./layout";
import { legibleBoxes, placeDrawingRect } from "./place";
import type * as Verify from "./verify";
import type { LecturePageMeta } from "../lecture/contracts";
import { LECTURE_BLOCK_META } from "../lecture/meta";

/**
 * The board chat's hand: runs a reply's actions on the board, one at a time, in the tutor's
 * writing — problems as a numbered grid with room to work under each, maths written as given, a
 * graph sketched like the unasked ones, a figure, a two-column proof (`proofWrite.ts`, loaded on
 * first use), a worked solution taught step by step (`teachWrite.ts`, loaded on first use), a new
 * screen, the tutor's ink cleared. Nothing a model proposed is written until the engine has read it
 * (`verify.ts`; a proof, `proof.ts`; a worked solution, `teach.ts`); what is left out comes back as
 * a note for the panel. Words only where a teacher writes them: a proof's Given / Prove and reasons
 * (in the proof reader's own vocabulary) and a worked solution's sentences; problems are numbered
 * `1.`, `2.`, … and everything else is maths.
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
  /**
   * figure boxes, largest first, down to the legible minimum: the drawer's labels stop shrinking at
   * a box ~245 px on its short side (`FIGURE.textScale.min`), so the last box has the same hand as
   * the one before it, on a smaller figure — one that fits under a problem in a grid of six
   */
  figureBoxes: [
    { w: 460, h: 380 },
    { w: 380, h: 310 },
    { w: 300, h: 250 },
    { w: 260, h: 215 },
  ],
  /** graph boxes, largest first, down to the legible minimum (the graph's labels are one size at any box) */
  graphBoxes: [GRAPH.box, ...GRAPH.fallbackBoxes],
  /** a problem set is written a little faster than a worked solution: six problems in ~8 s */
  problemPace: 1.8,
  /** how long to wait for the loop's own writing to finish before starting */
  waitStepMs: 150,
  waitMaxMs: 30_000,
  /** after adding a screen, until the loop has switched to it (one frame, normally) */
  screenWaitStepMs: 20,
  screenWaitMaxMs: 2_000,
  /**
   * `help_board` on a line still being read: how long to wait for the read (the recognizer's own
   * timeout and a moment, as Help me waits — `HELP_READ_WAIT_MS`)
   */
  readWaitMaxMs: 8_000,
} as const;

/**
 * What the board's own Help me / Solve it did with an ask from the chat (`ChatHost.helpBoard`):
 * `writing` — the help is going on the board; `nothing` — nothing of the student's on this screen to
 * help with; `busy` — the tutor is writing on it already; `reading` — the line it is about is still
 * being read (asked again in a moment); `unread` — the line could not be read as maths (it got the
 * board's "?"); `done` — it is already worked out; `off` — the tutor (Live) is switched off.
 */
export type HelpBoardResult = "writing" | "nothing" | "busy" | "reading" | "unread" | "done" | "off";

/** The panel's words for each `help_board` that wrote nothing (plain, for a 7-year-old). */
export const HELP_BOARD_NOTES: Record<Exclude<HelpBoardResult, "writing" | "reading">, string> = {
  nothing: "There's nothing of yours to help with on this screen yet.",
  busy: "I'm still writing on your work. Ask me again when I'm done.",
  unread: "I can't read your last line yet. Try writing it again, a little bigger.",
  done: "That one is already solved on the board.",
  off: "The tutor is switched off on this board, so I can't see your work.",
};

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
  /**
   * Writes a placed plan as ONE whole block (a cancel completes it); resolves once it is on the page.
   * `extraMeta` goes on every stroke; `leadMeta` on the first stroke only (what needs saying once —
   * a lecture note's summary — not ~70 times over in the saved board).
   */
  write(plan: HandPlan, extraMeta: JsonObject, leadMeta?: JsonObject): Promise<void>;
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
  /**
   * Helps with problem `n` on this screen, in the tutor's hand under it (`LiveLoop.chatHelp`): its
   * next step, or the rest worked out, from where the work under it stands. `missing`: no problem
   * `n` here; `done`: nothing left to write; `busy`: it is being written already.
   */
  helpProblem(n: number, depth: "step" | "solve"): "writing" | "done" | "busy" | "missing";
  /**
   * Help me (`step`) / Solve it (`solve`) on the student's own work on this screen, as the board's
   * button does it (`LiveLoop.chatHelpBoard`), whatever the dial says. Absent: nothing to help with.
   */
  helpBoard?(depth: "step" | "solve"): HelpBoardResult;
  planFigure(spec: FigureSpec, opts: FigurePlanOptions): FigurePlanResult | null;
  seed(key: string): number;
  delay(ms: number): Promise<void>;
  metric?(name: string, data: Record<string, unknown>): void;
  /** the current screen's lecture page meta (`LECTURE_PAGE_META`): its transcript feeds `picture().lecture` */
  screenMeta?(): LecturePageMeta;
}

type Report = ChatRunReport;

/**
 * The end of a text, at most `max` characters, starting at a word: what was said last is what
 * a question about a lecture is about, and half a word at the front only reads as noise.
 */
export function tailAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  if (/\s/.test(text[text.length - max - 1] ?? "")) return cut.trimStart();
  const at = cut.search(/\s/);
  return at === -1 ? cut : cut.slice(at + 1).trimStart();
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** A drawing that goes with a problem on this screen (`near`): a graph, a figure or a visual model. */
export function isNearDrawing(action: ChatAction): action is Extract<ChatAction, { type: "graph" | "draw_figure" | "draw_model" }> {
  return (action.type === "graph" || action.type === "draw_figure" || action.type === "draw_model") && action.near !== undefined;
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
  private verify: Promise<typeof Verify> | null = null;

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
      // marks, graphs and figures are drawings: their "lines" are labels, not maths; a lecture's
      // heading, notes and sketches are words (the transcript below says what they were about)
      if (meta.mark || meta.graphFor || meta[CHAT_BLOCK_META] === "graph" || meta[CHAT_BLOCK_META] === "figure" || meta[LECTURE_BLOCK_META]) continue;
      const latex = typeof meta[HAND_LINE_META] === "string" ? (meta[HAND_LINE_META] as string) : (s.latex ?? "");
      if (!latex || seen.has(latex)) continue;
      seen.add(latex);
      tutor.push({ latex, y: s.bounds?.y ?? 0 });
    }
    const cap = (list: string[]) => list.slice(0, CHAT_LIMITS.screenLines).map((l) => l.slice(0, CHAT_LIMITS.lineLatex));
    const numbered = [...problems.entries()].sort((a, b) => a[0] - b[0]).slice(0, CHAT_LIMITS.problems);
    const heard = (this.host.screenMeta?.().transcript ?? "").replace(/\s+/g, " ").trim();
    return {
      empty: shapes.length === 0,
      student: cap(this.host.studentLines()),
      tutor: cap(tutor.sort((a, b) => a.y - b.y).map((t) => t.latex)),
      problems: numbered.map(([, l]) => l),
      // as numbered on the board: "help me with 7" on a screen holding 5 to 8
      ...(numbered.length > 0 ? { numbers: numbered.map(([n]) => n) } : {}),
      // "what did she say about enzymes?": the end of what lecture mode heard on this screen
      ...(heard ? { lecture: tailAtWord(heard, CHAT_LIMITS.lecture) } : {}),
    };
  }

  // ---------------------------------------------------------------- running a reply

  /** Runs the actions in order, one block at a time; a second reply waits for the first. */
  run(actions: readonly ChatAction[]): Promise<Report> {
    return this.exclusive(() => this.runNow(actions));
  }

  /**
   * Runs `fn` in this desk's turn: after the reply being written, before the next. Lecture mode
   * writes its own blocks this way (`LectureDesk`), so a reply and a lecture sketch never measure
   * the same free space and write into it at once. `fn` must not call `run`: it would wait for itself.
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async runNow(actions: readonly ChatAction[]): Promise<Report> {
    this.running++;
    const report: Report = { outcomes: [], problemsWritten: 0, problemsDropped: 0, screensAdded: 0 };
    try {
      const engine = await this.host.engine();
      this.expectedPage = this.host.pageId();
      // a drawing of a problem on this screen goes beside it: a new screen in the same reply would
      // take the student away from that problem (the prompt says so; this holds if a model forgets)
      const nearDrawings = actions.filter(isNearDrawing).map((a) => a.type);
      for (const action of actions) {
        if (this.host.pageId() !== this.expectedPage) {
          report.outcomes.push({ type: action.type, ok: false, note: "I stopped because you moved to another screen." });
          break;
        }
        if (action.type === "new_screen" && nearDrawings.length > 0) {
          this.host.metric?.("live.chat.newScreen.ignored", { drawings: nearDrawings.join(",") });
          report.outcomes.push({ type: "new_screen", ok: false, why: "near_drawing" });
          continue;
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
        return this.graph(action.relations, action.window, engine, report, action.near);
      case "draw_figure":
        return this.figure(action.figure, report, action.near);
      case "new_screen":
        return (await this.newScreen(report)) ? { type: "new_screen", ok: true } : { type: "new_screen", ok: false, note: "This board already has the most screens it can hold." };
      case "clear_tutor":
        await this.waitForHand();
        this.host.clearTutor();
        this.host.problemsChanged();
        return { type: "clear_tutor", ok: true };
      case "help_problem":
        return this.helpProblem(action.problem, action.depth);
      case "draw_model":
        // CONTRACT STUB (docs/ASK-V2.md, "Drawing"): the models part draws it (planners in src/lib/live/chat/models)
        return { type: "draw_model", ok: false, note: "I can't draw that yet." };
      case "help_board":
        return this.helpBoard(action.depth);
      case "write_proof":
        return (await import("./proofWrite")).writeProof(this.writerDesk(report), action);
      case "teach":
        return (await import("./teachWrite")).writeTeach(this.writerDesk(report), action);
    }
  }

  // ---------------------------------------------------------------- help with a problem

  /**
   * "Help me with 3", "solve it": the tutor works problem `n` on this screen under it, in its hand —
   * the engine's working, not the model's (`LiveLoop.chatHelp`) — after any writing already under
   * way, and the run goes on once it is written.
   */
  private async helpProblem(n: number, depth: "step" | "solve"): Promise<ChatActionOutcome> {
    await this.waitForHand();
    const res = this.host.helpProblem(n, depth);
    if (res === "missing") return { type: "help_problem", ok: false, note: noProblemNote(n) };
    if (res === "done") return { type: "help_problem", ok: false, note: `Problem ${n} is already worked out on the board.` };
    if (res === "busy") return { type: "help_problem", ok: false, note: `I'm still writing on problem ${n}.` };
    await this.waitForHand();
    this.host.metric?.("live.chat.help", { depth });
    return { type: "help_problem", ok: true };
  }

  /**
   * "Is this right?", "help me with this", "what's next?", "solve it" about the student's OWN work
   * (`help_board`): exactly what the board's Help me (`step`) and Solve it (`solve`) buttons do
   * (`ChatHost.helpBoard`), after any writing already under way; a line still being read is waited
   * for, as the button waits. Honest about what happened: written, nothing of theirs here, busy, a
   * line it could not read, already worked out, or the tutor switched off.
   */
  private async helpBoard(depth: "step" | "solve"): Promise<ChatActionOutcome> {
    await this.waitForHand();
    const ask = (): HelpBoardResult => this.host.helpBoard?.(depth) ?? "nothing";
    let res = ask();
    for (let waited = 0; res === "reading" && waited < CHAT_WRITE.readWaitMaxMs; waited += CHAT_WRITE.waitStepMs) {
      await this.host.delay(CHAT_WRITE.waitStepMs);
      res = ask();
    }
    this.host.metric?.("live.chat.helpBoard", { depth, outcome: res });
    if (res === "writing") {
      await this.waitForHand();
      return { type: "help_board", ok: true };
    }
    const why = res === "reading" ? "busy" : res;
    return { type: "help_board", ok: false, note: HELP_BOARD_NOTES[why], why };
  }

  /**
   * What the writers loaded on first use lend of the desk: a two-column proof (`proofWrite.ts`) and
   * a worked solution (`teachWrite.ts`) are checked, laid out and written there.
   */
  private writerDesk(report: Report) {
    return {
      host: this.host,
      screenEmpty: () => this.screenEmpty(),
      newScreen: () => this.newScreen(report),
      waitForHand: () => this.waitForHand(),
      writeBlock: (plan: HandPlan, meta: JsonObject) => this.writeBlock(plan, meta),
      onScreen: () => this.host.pageId() === this.expectedPage,
      obstacles: () => this.obstacles(),
    };
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

  /**
   * The interlock (`verify.ts`, with the worksheet blanks it reads, `engine/blanks.ts`), loaded with
   * the first problem or line the chat writes, never with the board (its first load is budgeted,
   * docs/BUNDLE.md); the engine it checks with is loaded then anyway.
   */
  private verifier(): Promise<typeof Verify> {
    this.verify ??= import("./verify");
    return this.verify;
  }

  /** The hand's interlock, the one the route's gate runs too (`handCanWrite`); typeset maths can say anything. */
  private canDraw(v: typeof Verify): (lines: readonly string[]) => boolean {
    return (lines) => !this.host.handwriting() || v.handCanWrite(lines);
  }

  /** A place for a block of this size on this screen, else on a new one. */
  private async placeFor(size: { w: number; h: number }, report: Report): Promise<Rect | null> {
    const here = findFreeArea(size, this.host.screen(), this.obstacles());
    if (here) return here;
    if (!(await this.newScreen(report))) return null;
    return findFreeArea(size, this.host.screen(), this.obstacles());
  }

  /**
   * Where a drawing goes (docs/ASK-V2.md, "Placement"): a figure, a graph or a visual model that can
   * be planned at several sizes (`boxes`, largest first, down to its legible minimum). It stays on
   * THIS screen whenever any size fits anywhere (`placeDrawingRect`): beside problem `near` — right
   * of its line in its cell, else in the cell's work room under it, else anywhere free on the
   * screen — and without `near` anywhere free. Only when nothing fits even at the smallest size is a
   * new screen started, the drawing at its largest there. Never over the student's ink, a problem or
   * the tutor's writing. Answers the plan placed, or null when it fits nowhere (nor on a new
   * screen), or `plan` planned it in no box.
   */
  private async placeDrawing(
    plan: (box: { w: number; h: number }) => HandPlan | null,
    opts: { near?: number; boxes: readonly { w: number; h: number }[] },
    report: Report,
  ): Promise<HandPlan | null> {
    const plans = legibleBoxes(opts.boxes).map((box) => {
      try {
        return plan(box);
      } catch {
        return null;
      }
    });
    const largest = plans.find((p): p is HandPlan => p !== null);
    if (!largest) return null;
    // what is on the screen once the loop's own writing is on it
    await this.waitForHand();
    const near = opts.near !== undefined ? this.problemOnScreen(opts.near) : null;
    const sizes = plans.map((p) => (p ? { w: p.bounds.w, h: p.bounds.h } : null));
    const here = placeDrawingRect({ screen: this.host.screen(), ink: this.inkRects(), cells: this.cellRects(), near, sizes });
    const metric = (spot: string, size: number) =>
      this.host.metric?.("live.chat.place", { spot, size, near: opts.near !== undefined, ...(opts.near !== undefined ? { found: near !== null } : {}) });
    if (here) {
      metric(here.spot, here.index);
      return placeHandPlan(plans[here.index]!, { x: here.rect.x, y: here.rect.y });
    }
    // nothing fits on this screen even at the smallest: a new one, the drawing at its largest
    if (!(await this.newScreen(report))) {
      metric("none", -1);
      return null;
    }
    const slot = findFreeArea({ w: largest.bounds.w, h: largest.bounds.h }, this.host.screen(), this.obstacles());
    metric(slot ? "new_screen" : "none", slot ? plans.indexOf(largest) : -1);
    return slot ? placeHandPlan(largest, { x: slot.x, y: slot.y }) : null;
  }

  /** Problem `n` on this screen: its cell and where its ink is (its number and lines); null when it is not here. */
  private problemOnScreen(n: number): { cell: Rect; head: Rect } | null {
    let cell: Rect | null = null;
    let head: Rect | null = null;
    for (const s of this.host.shapes()) {
      const p = problemMetaOf(s.meta);
      if (!p || p.n !== n || !s.bounds) continue;
      // one problem per number on a screen; another block of the same number (an old one) is not it
      if (cell && (cell.x !== p.cell.x || cell.y !== p.cell.y)) continue;
      cell ??= p.cell;
      const b = s.bounds;
      head = head ? unionRect(head, b) : { ...b };
    }
    return cell && head ? { cell, head } : null;
  }

  /** The bounds of everything on this screen: the student's ink, the problems, the tutor's writing. */
  private inkRects(): Rect[] {
    return this.host.shapes().flatMap((s) => (s.bounds ? [s.bounds] : []));
  }

  /** Each problem's cell on this screen, once. */
  private cellRects(): Rect[] {
    const cells = new Map<string, Rect>();
    for (const s of this.host.shapes()) {
      const p = problemMetaOf(s.meta);
      if (p) cells.set(`${p.cell.x},${p.cell.y}`, p.cell);
    }
    return [...cells.values()];
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
    const verify = await this.verifier();
    const canDraw = this.canDraw(verify);
    const kept: string[][] = [];
    let unchecked = 0;
    const reasons: string[] = [];
    for (const p of problems) {
      const v = verify.verifyProblem(engine, p, canDraw);
      // as checked: in the board's own form (a worksheet's blank as the box the hand draws)
      if (v.ok) kept.push(v.lines);
      else {
        unchecked++;
        reasons.push(v.reason);
        this.host.metric?.("live.chat.problem.dropped", { reason: v.reason });
      }
    }
    // why, for the report (`note_write_problems_<why>`): the engine's commonest reason
    const why = verify.commonestReason(reasons) ?? undefined;
    if (kept.length === 0) {
      report.problemsDropped += unchecked;
      return { type: "write_problems", ok: false, note: `I couldn't check ${plural(problems.length, "that problem", "those problems")}, so I didn't write ${plural(problems.length, "it", "them")}.`, ...(why ? { why } : {}) };
    }
    const hand = this.host.handwriting();
    // A problem too wide for a screen even alone, at the smallest hand, is left out by itself: the
    // grid of its screen used to come back empty (`planGrid`: null) and every problem on it went.
    const screen = this.host.screen();
    const fitting = hand ? kept.filter((lines) => planGrid(screen, 1, (_, size) => this.problemWidth(lines, 99, size)) !== null) : kept;
    const tooWide = kept.length - fitting.length;
    kept.splice(0, kept.length, ...fitting);
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
    const unplaced = kept.length - written + tooWide;
    report.problemsWritten += written;
    report.problemsDropped += unchecked + unplaced;
    if (written > 0) this.host.problemsChanged();
    this.host.metric?.("live.chat.problems", { written, unchecked, unplaced, screens: report.screensAdded });
    const notes: string[] = [];
    if (unchecked > 0) notes.push(`${unchecked} of ${problems.length} problems couldn't be checked, so I left ${plural(unchecked, "it", "them")} out.`);
    if (stopped) notes.push(stopped);
    else if (unplaced > 0) notes.push(`${unplaced} ${plural(unplaced, "problem", "problems")} didn't fit, so I left ${plural(unplaced, "it", "them")} out.`);
    return { type: "write_problems", ok: written > 0, ...(notes.length ? { note: notes.join(" ") } : {}), ...(unchecked > 0 && why ? { why } : {}) };
  }

  // ---------------------------------------------------------------- lines

  private async writeLines(lines: readonly string[], engine: LiveEngine, report: Report): Promise<ChatActionOutcome> {
    const verify = await this.verifier();
    const v = verify.verifyLines(engine, lines, this.canDraw(verify));
    if (!v.ok) {
      const note = v.reason === "false" ? "I left out lines that didn't check out." : v.reason === "unchecked" ? "I couldn't check those lines, so I didn't write them." : "I couldn't write that on the board.";
      return { type: "write_lines", ok: false, note, why: v.reason };
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
    // one size (a formula is written at the size a problem is read at), anywhere free, a new screen last
    const placed = await this.placeDrawing(() => plan, { boxes: [{ w: plan.bounds.w, h: plan.bounds.h }] }, report);
    if (!placed) return { type: "write_lines", ok: false, note: "There's no room left on this board." };
    await this.writeBlock(placed, meta);
    return { type: "write_lines", ok: true };
  }

  // ---------------------------------------------------------------- graphs

  private async graph(relations: readonly string[], win: ChatWindow | undefined, engine: LiveEngine, report: Report, near?: number): Promise<ChatActionOutcome> {
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
    const labelH = labelPlan ? labelPlan.bounds.h + CHAT_WRITE.graphLabelGap : 0;
    let planned = false;
    // the equation, then the sketch under it, as one block (placed as a whole by `placeDrawing`)
    const plan = (box: { w: number; h: number }): HandPlan | null => {
      const g = planGraph(shown, { seed, box, window: hint });
      if (!g) return null;
      planned = true;
      return joinPlans([...(labelPlan ? [placeHandPlan(labelPlan, { x: 0, y: 0 })] : []), placeHandPlan(g.plan, { x: 0, y: labelH })], 300, graphPaceFor);
    };
    const placed = await this.placeDrawing(plan, { near, boxes: CHAT_WRITE.graphBoxes }, report);
    if (!placed) return planned ? { type: "graph", ok: false, note: "There's no room left for the graph." } : cannot;
    await this.writeBlock(placed, { [CHAT_BLOCK_META]: "graph", chatGraph: intent.key });
    this.host.metric?.("live.chat.graph", { kind: intent.kind, window: Boolean(win), near: near !== undefined });
    return { type: "graph", ok: true };
  }

  // ---------------------------------------------------------------- figures

  private async figure(spec: FigureSpec, report: Report, near?: number): Promise<ChatActionOutcome> {
    const cannot: ChatActionOutcome = { type: "draw_figure", ok: false, note: "I couldn't draw that figure." };
    if (!this.host.handwriting()) return { type: "draw_figure", ok: false, note: "The tutor's handwriting is switched off, so I can't draw a figure." };
    const seed = this.host.seed(`chat:figure:${JSON.stringify(spec).slice(0, 400)}`);
    let planned = false;
    // a box the drawer cannot plan in is no reason to give up on a figure it drew in another
    const plan = (box: { w: number; h: number }): HandPlan | null => {
      let res: FigurePlanResult | null = null;
      try {
        res = this.host.planFigure(spec, { seed, box });
      } catch {
        res = null;
      }
      if (res) planned = true;
      return res?.plan ?? null;
    };
    const placed = await this.placeDrawing(plan, { near, boxes: CHAT_WRITE.figureBoxes }, report);
    if (!placed) return planned ? { type: "draw_figure", ok: false, note: "There's no room left for the figure." } : cannot;
    await this.writeBlock(placed, { [CHAT_BLOCK_META]: "figure" });
    return { type: "draw_figure", ok: true };
  }
}
