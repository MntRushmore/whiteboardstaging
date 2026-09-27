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
import type { LiveVerdict, Rect } from "../contracts";
import type { Diagram } from "../diagrams";
import { diagramNear } from "../diagrams";
import type { MarkKind } from "../marks";
import { checkProof, type ProofProblem, type RowVerdict } from "./checker";
import type { ProofRequest, ProofResponse, FigureReadWire } from "./contracts";
import { parseStatement, statementLatex } from "./facts";
import { buildFigure, type FigureModel } from "./figure";
import { planProof, type PlannedRow } from "./planner";
import { proofProblem, readProofs, type BoardLine, type ProofRead } from "./read";
import { normalizeReason, reasonLatex, resolveBisector } from "./vocab";

export interface ProofHost {
  /** the screen's lines with a confident read */
  lines(): readonly BoardLine[];
  /** the rows the tutor has written on this screen, as lines (`tutorLinesOf`) */
  tutorLines(): readonly BoardLine[];
  diagrams(): readonly Diagram[];
  /** Live is on, the mode is not Off and the voice tutor is not talking */
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
  busy(on: boolean): void;
  /** the ask failed: `err` from a call, or null for "couldn't work this out" */
  failed(err: unknown, lineId: string, all: boolean): void;
  succeeded(lineId: string): void;
  metric(name: string, data: Record<string, unknown>): void;
}

export interface ProofView {
  key: string;
  read: ProofRead;
  problem: ProofProblem;
  verdicts: RowVerdict[];
  diagram: Diagram | null;
  figure: FigureModel | null;
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
  /** figure reads per drawing (its ink and labels), for this screen */
  private readonly figures = new Map<string, { read: FigureReadWire; model: FigureModel }>();
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
    this.memoKey = "";
    this.views = [];
    this.byLine.clear();
    this.roles.clear();
  }

  /** The proofs on the screen, read again only when a line (or a figure read) changed. */
  proofs(): readonly ProofView[] {
    const lines = [...this.host.lines(), ...this.host.tutorLines()];
    const diagrams = this.host.diagrams();
    const sig = JSON.stringify([
      lines.map((l) => [l.id, l.latex, Math.round(l.bounds.x), Math.round(l.bounds.y), Math.round(l.bounds.w), Math.round(l.bounds.h)]),
      diagrams.map((d) => [d.id, figureCacheKey(d)]),
      [...this.figures.keys()],
    ]);
    if (sig === this.memoKey) return this.views;
    this.memoKey = sig;
    this.views = readProofs(lines).map((read) => {
      const problem = proofProblem(read);
      const diagram = diagramNear(diagrams, read.bounds, FIGURE_REACH);
      const figure = diagram ? (this.figures.get(figureCacheKey(diagram))?.model ?? null) : null;
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
      return { key, read, problem, verdicts, diagram, figure, marks };
    });
    this.byLine = new Map();
    for (const v of this.views) for (const id of v.read.lineIds) this.byLine.set(id, v);
    return this.views;
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
    this.host.busy(true);
    let source = "planner";
    try {
      let view = start;
      let plan = planProof(this.trusted(view), view.figure);
      if (plan === null && view.diagram && !view.figure && this.host.online()) {
        const read = await this.readFigure(view, ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (read) {
          source = "planner+figure";
          this.host.rerender(view.read.lineIds);
          view = this.proofs().find((v) => v.key === key) ?? view;
          plan = planProof(this.trusted(view), view.figure);
        }
      }
      if (plan === null && this.host.online()) {
        source = "model";
        plan = await this.modelRow(view, ctrl.signal);
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
      this.host.busy(false);
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

  /** One model row, kept only when the checker ticks it. */
  private async modelRow(view: ProofView, signal: AbortSignal): Promise<PlannedRow[] | null> {
    const prove = stripLabel(view.read.prove[0]?.latex ?? "");
    if (!prove) return null;
    const trusted = this.trusted(view);
    const rows = view.read.rows
      .filter((_, i) => view.verdicts[i]?.verdict !== "wrong")
      .map((r) => ({ statement: (r.statement ?? r.merged)?.latex ?? "", reason: r.reason?.latex ?? "" }))
      .filter((r) => r.statement);
    const figure = view.diagram ? this.figures.get(figureCacheKey(view.diagram))?.read : undefined;
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
    const verdict = checkProof(next, view.figure)[next.rows.length - 1];
    if (verdict?.verdict !== "ok") return null;
    return [{ facts: statement.facts, statement: written, reason, reasonLatex: reasonLatex(reason) }];
  }
}
