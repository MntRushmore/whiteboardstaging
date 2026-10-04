/**
 * The proofs on a screen, for the live loop (`LiveLoop` owns one `ProofDesk`). What it does:
 *
 *  - reads the proofs off the screen's lines (and the rows the tutor wrote), remembered until a
 *    line changes, and checks them (`checkProof`) with the figure read when there is one;
 *  - says what each proof line's mark is — a tick after a verified row's reason, a ring round the
 *    wrong half of a provably wrong row, nothing otherwise — so the loop renders proof lines through
 *    it instead of the engine's line-by-line analysis (which would read `\overline{AB} \cong
 *    \overline{CD}` as an equation, and `Given` as prose);
 *  - on an explicit ask (Help, Solve, a badge tap), writes the next row (Suggest, Feedback) or the
 *    rest of the proof (Solve): the engine's planner first; when it cannot finish and there is a
 *    figure, the figure is read once (`/api/live/proof` task `figure`, cached per drawing) and the
 *    planner runs again; then one model row (task `step`), written only when the checker ticks it.
 *
 * The loop is reached only through `ProofHost`, so this file has no editor or network of its own.
 */
import type { InkStroke, LiveVerdict, Rect } from "../contracts";
import { figureFromInk } from "./figureInk";
import type { Diagram } from "../diagrams";
import { diagramNear } from "../diagrams";
import type { MarkKind } from "../marks";
import { checkProof, type ProofProblem, type RowVerdict } from "./checker";
import type { ProofRequest, ProofResponse, FigureReadWire } from "./contracts";
import { parseStatement, statementLatex } from "./facts";
import { buildFigure, type FigureModel, type FigureRead } from "./figure";
import { planProof, theoremsBeingProved, type PlannedRow } from "./planner";
import { proofProblem, readProofs, type BoardLine, type ProofRead } from "./read";
import { normalizeReason, reasonLatex, resolveBisector } from "./vocab";

export interface ProofHost {
  /** the screen's lines with a confident read */
  lines(): readonly BoardLine[];
  /** the rows the tutor has written on this screen, as lines (`tutorLinesOf`) */
  tutorLines(): readonly BoardLine[];
  /**
   * The figures the tutor drew for a proof on this screen (the board chat's `write_proof`), each
   * with its read — exact, from the spec it was drawn from, so nothing is read from its ink.
   */
  tutorFigures?(): readonly TutorFigure[];
  diagrams(): readonly Diagram[];
  /** a drawing's labels as already read (one row per label), or null while they are not */
  labelReads(d: Diagram): readonly string[] | null;
  /** these strokes' ink (page coordinates) */
  ink(ids: readonly string[]): InkStroke[];
  /** the screen's glyph scale (page px) */
  glyph(): number;
  /** Live is on and the mode is not Off */
  enabled(): boolean;
  online(): boolean;
  readLabels(d: Diagram): Promise<string[]>;
  crop(d: Diagram): Promise<string | undefined>;
  call(req: ProofRequest, signal: AbortSignal): Promise<ProofResponse>;
  boardId(): string;
  /** analyse and render these lines again (their proof role or their row's verdict may have changed) */
  rerender(ids: readonly string[]): void;
  /** writes rows under the proof in the tutor's hand; false when it could not */
  writeRows(read: ProofRead, rows: readonly PlannedRow[], anchorLineId: string): boolean;
  /** an ask started: the pill says "Solving…"; returns its end, called once when the ask is over */
  busy(): () => void;
  /** the ask failed: `err` from a call, or null for "couldn't work this out" */
  failed(err: unknown, lineId: string, all: boolean): void;
  succeeded(lineId: string): void;
  metric(name: string, data: Record<string, unknown>): void;
}

/** A figure the tutor drew for a proof: its read (as a model's read of a student's drawing is) and where its ink is. */
export interface TutorFigure {
  key: string;
  read: FigureRead;
  bounds: Rect;
}

export interface ProofView {
  key: string;
  read: ProofRead;
  problem: ProofProblem;
  verdicts: RowVerdict[];
  diagram: Diagram | null;
  figure: FigureModel | null;
  /** where the figure read came from: the tutor's own figure, the ink and its labels (free), or the model */
  figureFrom: "tutor" | "ink" | "model" | null;
  /** student lines of the proof → their mark */
  marks: Map<string, MarkKind | null>;
}

/** How near (page px) a drawing must be to a proof to be its figure. */
const FIGURE_REACH = 420;

/** The key a figure read is cached under: the drawing's ink and its labels' ink. */
export function figureCacheKey(d: Pick<Diagram, "strokeIds" | "labels">): string {
  return `${[...d.strokeIds].sort().join(",")}|${d.labels.flat().sort().join(",")}`;
}

/** `\text{Given: } …` / `\text{Prove: } …` → what follows the label. */
export function stripLabel(latex: string): string {
  return latex
    .replace(/^\s*\\text\s*\{\s*(?:given|prove|show)\s*(?:that)?\s*:?\s*\}\s*:?/i, "")
    .replace(/^\s*(?:given|prove)\s*:?/i, "")
    .trim();
}

/**
 * The tutor's written proof rows as lines: its strokes grouped by block and line (`meta.handLine`),
 * and a line written twice in one block (two `Given`s) split by where its strokes are.
 */
export function tutorLinesOf(shapes: ReadonlyArray<{ block: string; latex: string; bounds: Rect }>, lineHeight = 40): BoardLine[] {
  const groups = new Map<string, Rect[]>();
  for (const s of shapes) {
    const k = `${s.block}\u0000${s.latex}`;
    const g = groups.get(k);
    if (g) g.push(s.bounds);
    else groups.set(k, [s.bounds]);
  }
  const out: BoardLine[] = [];
  for (const [k, rects] of groups) {
    const [block, latex] = k.split("\u0000");
    const sorted = [...rects].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
    const clusters: Rect[][] = [];
    for (const r of sorted) {
      const last = clusters[clusters.length - 1];
      const prev = last?.[last.length - 1];
      if (prev && r.y + r.h / 2 - (prev.y + prev.h / 2) < 0.9 * lineHeight) last.push(r);
      else clusters.push([r]);
    }
    clusters.forEach((c, i) => {
      const x0 = Math.min(...c.map((r) => r.x));
      const y0 = Math.min(...c.map((r) => r.y));
      const x1 = Math.max(...c.map((r) => r.x + r.w));
      const y1 = Math.max(...c.map((r) => r.y + r.h));
      out.push({ id: `tutor:${block}:${latex}:${i}`, latex, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, tutor: true });
    });
  }
  return out;
}

export class ProofDesk {
  private readonly host: ProofHost;
  private memoKey = "";
  private views: ProofView[] = [];
  private byLine = new Map<string, ProofView>();
  /** the model's figure reads per drawing (its ink and labels), for this screen */
  private readonly figures = new Map<string, { read: FigureReadWire; model: FigureModel }>();
  /** figures read from their own ink and labels, per drawing and label read (null: nothing readable) */
  private readonly inkFigures = new Map<string, { read: FigureReadWire; model: FigureModel } | null>();
  /** the tutor's own figures' models, per figure */
  private readonly tutorModels = new Map<string, FigureModel>();
  private readonly inflight = new Map<string, AbortController>();
  /** which proof each line belonged to at the last sync */
  private roles = new Map<string, string>();

  constructor(host: ProofHost) {
    this.host = host;
  }

  /** A new screen (or the loop stopping): forget everything, stop what is in flight. */
  reset(): void {
    for (const c of this.inflight.values()) c.abort();
    this.inflight.clear();
    this.figures.clear();
    this.inkFigures.clear();
    this.tutorModels.clear();
    this.memoKey = "";
    this.views = [];
    this.byLine.clear();
    this.roles.clear();
  }

  /** The proofs on the screen, read again only when a line (or a figure read) changed. */
  proofs(): readonly ProofView[] {
    const lines = [...this.host.lines(), ...this.host.tutorLines()];
    const diagrams = this.host.diagrams();
    const tutorFigures = this.host.tutorFigures?.() ?? [];
    const sig = JSON.stringify([
      lines.map((l) => [l.id, l.latex, Math.round(l.bounds.x), Math.round(l.bounds.y), Math.round(l.bounds.w), Math.round(l.bounds.h)]),
      diagrams.map((d) => [d.id, figureCacheKey(d), this.host.labelReads(d)]),
      [...this.figures.keys()],
      tutorFigures.map((f) => [f.key, Math.round(f.bounds.x), Math.round(f.bounds.y), Math.round(f.bounds.w), Math.round(f.bounds.h)]),
    ]);
    if (sig === this.memoKey) return this.views;
    this.memoKey = sig;
    this.views = readProofs(lines).map((read) => {
      const problem = proofProblem(read);
      const diagram = diagramNear(diagrams, read.bounds, FIGURE_REACH);
      // the tutor's own figure beside it is exact; else the figure as its own ink reads
      // (deterministic, free); the model's read only when there is neither
      const fromTutor = this.tutorFigure(tutorFigures, read.bounds);
      const fromInk = !fromTutor && diagram ? (this.inkFigure(diagram, pointNames(problem))?.model ?? null) : null;
      const fromModel = !fromTutor && diagram && !fromInk ? (this.figures.get(figureCacheKey(diagram))?.model ?? null) : null;
      const figure = fromTutor ?? fromInk ?? fromModel;
      const figureFrom = fromTutor ? ("tutor" as const) : fromInk ? ("ink" as const) : fromModel ? ("model" as const) : null;
      const verdicts = checkProof(problem, figure);
      const marks = new Map<string, MarkKind | null>();
      for (const id of read.lineIds) marks.set(id, null);
      read.rows.forEach((row, i) => {
        const v = verdicts[i];
        if (!v) return;
        const at = (l: BoardLine | null) => (l && !l.tutor ? l.id : null);
        if (v.verdict === "ok") {
          const id = at(row.merged) ?? at(row.reason);
          if (id) marks.set(id, "check");
        } else if (v.verdict === "wrong") {
          const id = at(row.merged) ?? (v.part === "statement" ? at(row.statement) : at(row.reason)) ?? at(row.statement) ?? at(row.reason);
          if (id) marks.set(id, "circle");
        }
      });
      const key = read.lineIds[0] ?? `proof:${Math.round(read.bounds.x)},${Math.round(read.bounds.y)}`;
      return { key, read, problem, verdicts, diagram, figure, figureFrom, marks };
    });
    this.byLine = new Map();
    for (const v of this.views) for (const id of v.read.lineIds) this.byLine.set(id, v);
    return this.views;
  }

  /** The model of the tutor's figure nearest the proof (within reach), cached per figure; null when none. */
  private tutorFigure(figures: readonly TutorFigure[], near: Rect): FigureModel | null {
    let best: TutorFigure | null = null;
    let bestGap = Infinity;
    for (const f of figures) {
      const b = f.bounds;
      const gap = Math.hypot(Math.max(0, b.x - (near.x + near.w), near.x - (b.x + b.w)), Math.max(0, b.y - (near.y + near.h), near.y - (b.y + b.h)));
      if (gap <= FIGURE_REACH && gap < bestGap) {
        best = f;
        bestGap = gap;
      }
    }
    if (!best) return null;
    let model = this.tutorModels.get(best.key);
    if (!model) {
      model = buildFigure(best.read);
      this.tutorModels.set(best.key, model);
    }
    return model;
  }

  /**
   * The figure read from its own ink and its labels as read (`figureFromInk`), cached per drawing
   * and label read; null when the labels are not read yet, their rows do not match the labels one
   * to one, or nothing readable comes out.
   */
  private inkFigure(d: Diagram, names: readonly string[]): { read: FigureReadWire; model: FigureModel } | null {
    const reads = this.host.labelReads(d);
    if (!reads || reads.length !== d.labels.length) return null;
    const key = `${figureCacheKey(d)}|${reads.join("\u0001")}|${names.join("")}`;
    const known = this.inkFigures.get(key);
    if (known !== undefined) return known;
    const bounds = (ids: readonly string[]): Rect => {
      const ink = this.host.ink(ids);
      const x0 = Math.min(...ink.map((s) => s.bounds.x));
      const y0 = Math.min(...ink.map((s) => s.bounds.y));
      return { x: x0, y: y0, w: Math.max(...ink.map((s) => s.bounds.x + s.bounds.w)) - x0, h: Math.max(...ink.map((s) => s.bounds.y + s.bounds.h)) - y0 };
    };
    const labels = d.labels.map((ids, i) => ({ text: reads[i], bounds: bounds(ids) })).filter((l) => Number.isFinite(l.bounds.x));
    const read = figureFromInk(this.host.ink(d.strokeIds), labels, this.host.glyph(), names);
    const out = read ? { read: read as FigureReadWire, model: buildFigure(read) } : null;
    this.inkFigures.set(key, out);
    return out;
  }

  /** Is this line part of a proof? */
  owns(lineId: string): boolean {
    this.proofs();
    return this.byLine.has(lineId);
  }

  /** The mark and the echo's status for a proof line; undefined when the line is not in a proof. */
  lineMark(lineId: string): { kind: MarkKind | null; status: LiveVerdict } | undefined {
    this.proofs();
    const view = this.byLine.get(lineId);
    if (!view) return undefined;
    const kind = view.marks.get(lineId) ?? null;
    return { kind, status: kind === "check" ? "ok" : kind === "circle" ? "warn" : "none" };
  }

  /**
   * After a line was read: the lines whose proof role changed (a line just became part of a proof,
   * or left one) and every proof line (a row's verdict depends on the rows above it) are rendered
   * again. Marks are idempotent, so this costs nothing when nothing changed.
   */
  sync(): void {
    const views = this.proofs();
    const now = new Map<string, string>();
    for (const v of views) for (const id of v.read.lineIds) now.set(id, v.key);
    const ids = new Set<string>(now.keys());
    for (const [id, key] of this.roles) if (now.get(id) !== key) ids.add(id);
    this.roles = now;
    if (ids.size > 0) this.host.rerender([...ids]);
  }

  /**
   * An explicit ask on a proof line (or on a drawing beside a proof): writes the next row, or all the
   * rows still to write (`all`, Solve). False when there is no proof to ask about — the caller's own
   * paths run then.
   */
  ask(lineId: string | null, diagram: Diagram | null, opts: { all: boolean }): boolean {
    if (!this.host.enabled()) return false;
    const views = this.proofs();
    let view = lineId ? this.byLine.get(lineId) : undefined;
    if (diagram) view = views.find((v) => v.diagram?.id === diagram.id) ?? view;
    // nothing of the student's on the screen to ask about, and one proof there: a proof the tutor
    // set up (the board chat's `write_proof`) and not begun — Help writes its first row
    if (!view && lineId === null && !diagram && views.length === 1) view = views[0];
    if (!view) return false;
    void this.run(view, opts.all, lineId && view.read.lineIds.includes(lineId) ? lineId : (view.read.lineIds[0] ?? lineId ?? view.key));
    return true;
  }

  /** The rows the planner may build on: every row not ringed. */
  private trusted(view: ProofView): ProofProblem {
    return { ...view.problem, rows: view.problem.rows.filter((r, i) => view.verdicts[i]?.verdict !== "wrong" && r.statement?.complete) };
  }

  private async run(start: ProofView, all: boolean, anchor: string): Promise<void> {
    const key = start.key;
    this.inflight.get(key)?.abort();
    const ctrl = new AbortController();
    this.inflight.set(key, ctrl);
    const done = this.host.busy();
    let source = "planner";
    try {
      let view = start;
      // a figure whose labels are not read yet: read them (one recognizer call, cached), so the
      // figure can be read from its own ink
      if (view.diagram && !view.figure && this.host.online()) {
        await this.host.readLabels(view.diagram);
        if (ctrl.signal.aborted) return;
        view = this.proofs().find((v) => v.key === key) ?? view;
        if (view.figure) {
          source = "planner+ink figure";
          this.host.rerender(view.read.lineIds);
        }
      }
      let figure = view.figure;
      // a proof the tutor set up was checked without the theorem it proves: Help continues so
      const without = view.figureFrom === "tutor" ? theoremsBeingProved(view.problem, figure) : [];
      let plan = planProof(this.trusted(view), figure, { without });
      // still short: the model reads the figure (once per drawing), and the planner tries with that
      if (plan === null && view.diagram && this.host.online()) {
        const read = await this.readFigure(view, ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (read && read !== figure) {
          source = "planner+model figure";
          view = this.proofs().find((v) => v.key === key) ?? view;
          this.host.rerender(view.read.lineIds);
          figure = read;
          plan = planProof(this.trusted(view), figure);
        }
      }
      if (plan === null && this.host.online()) {
        source = "model";
        plan = await this.modelRow(view, figure, ctrl.signal);
        if (ctrl.signal.aborted) return;
      }
      this.host.metric("live.proof.ask", { source: plan ? source : "none", rows: plan?.length ?? 0, all });
      if (plan === null) {
        this.host.failed(null, anchor, all);
        return;
      }
      if (plan.length === 0) {
        this.host.succeeded(anchor);
        return;
      }
      if (this.host.writeRows(view.read, all ? plan : plan.slice(0, 1), anchor)) this.host.succeeded(anchor);
      else this.host.failed(null, anchor, all);
    } catch (err) {
      if (ctrl.signal.aborted || (err instanceof Error && err.name === "AbortError")) return;
      this.host.failed(err, anchor, all);
    } finally {
      if (this.inflight.get(key) === ctrl) this.inflight.delete(key);
      done();
    }
  }

  /** Reads the proof's figure once (cached per drawing); null when there is nothing to read. */
  private async readFigure(view: ProofView, signal: AbortSignal): Promise<FigureModel | null> {
    const d = view.diagram;
    if (!d) return null;
    const cacheKey = figureCacheKey(d);
    const known = this.figures.get(cacheKey);
    if (known) return known.model;
    const labels = await this.host.readLabels(d);
    const crop = await this.host.crop(d);
    if (!crop || signal.aborted) return null;
    const res = await this.host.call(
      {
        boardId: this.host.boardId(),
        task: "figure",
        givens: view.read.given.map((l) => stripLabel(l.latex)),
        prove: stripLabel(view.read.prove[0]?.latex ?? ""),
        labels,
        crop,
      },
      signal,
    );
    if (!res.figure) return null;
    const model = buildFigure(res.figure);
    this.figures.set(cacheKey, { read: res.figure, model });
    this.memoKey = "";
    this.host.metric("live.proof.figure", { points: Object.keys(res.figure.points).length, lines: res.figure.lines.length, ms: res.ms, model: res.model });
    return model;
  }

  /** One model row, kept only when the checker ticks it (with the best figure read there is). */
  private async modelRow(view: ProofView, figureModel: FigureModel | null, signal: AbortSignal): Promise<PlannedRow[] | null> {
    const prove = stripLabel(view.read.prove[0]?.latex ?? "");
    if (!prove) return null;
    const trusted = this.trusted(view);
    const rows = view.read.rows
      .filter((_, i) => view.verdicts[i]?.verdict !== "wrong")
      .map((r) => ({ statement: (r.statement ?? r.merged)?.latex ?? "", reason: r.reason?.latex ?? "" }))
      .filter((r) => r.statement);
    // what the figure shows, as read (its ink first, the model's read otherwise)
    const figure = view.diagram ? (this.inkFigure(view.diagram, pointNames(view.problem))?.read ?? this.figures.get(figureCacheKey(view.diagram))?.read) : undefined;
    const crop = view.diagram ? await this.host.crop(view.diagram) : undefined;
    if (signal.aborted) return null;
    const res = await this.host.call(
      {
        boardId: this.host.boardId(),
        task: "step",
        givens: view.read.given.map((l) => stripLabel(l.latex)),
        prove,
        rows: rows.slice(-30),
        ...(figure ? { figure } : {}),
        ...(crop ? { crop } : {}),
      },
      signal,
    );
    if (!res.row) return null;
    const statement = parseStatement(res.row.statement);
    const reason = resolveBisector(normalizeReason(res.row.reason), statement.facts.some((f) => f.t === "angCong"));
    const written = statementLatex(statement.facts);
    this.host.metric("live.proof.step", { model: res.model, ms: res.ms, parsed: statement.complete && Boolean(reason), writable: Boolean(written) });
    if (!statement.complete || !reason || !written) return null;
    const next: ProofProblem = { ...trusted, rows: [...trusted.rows, { statement, reason }] };
    const verdict = checkProof(next, figureModel)[next.rows.length - 1];
    if (verdict?.verdict !== "ok") return null;
    return [{ facts: statement.facts, statement: written, reason, reasonLatex: reasonLatex(reason) }];
  }
}

/** The points a proof speaks of: every single capital in its parsed givens, prove and rows. */
function pointNames(problem: ProofProblem): string[] {
  const names = new Set<string>();
  for (const m of JSON.stringify([problem.givens, problem.prove, problem.rows]).matchAll(/"([A-Z])"/g)) names.add(m[1]);
  return [...names].sort();
}
