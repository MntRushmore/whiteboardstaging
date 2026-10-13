/**
 * The try board's state and its talk with the server (docs/TRY-BOARD.md; the contract is
 * src/lib/try/contracts.ts). A small store the view subscribes to (`useSyncExternalStore`), with
 * fetch, storage, the clock and the network's state passed in, so the tests drive it without a
 * browser: pen down, move, up; a quiet pause or "Check my line" sends the line to `TRY_API.check`;
 * the verdict lands on the line; "Show me a step" asks `TRY_API.help` for the tutor's next line.
 *
 * The page, one problem at a time:
 * - Lines run top to bottom under the problem, at most `maxLines`. The last line is the open one,
 *   the one the visitor writes on, until the tutor checks it right.
 * - A line is read after `QUIET_MS` without a new stroke (the board's quiet gate, longer for a
 *   finger on a phone), or at once with the button. More ink before the answer supersedes the read:
 *   its request is aborted and its answer, should it come, is dropped.
 * - `check`: a check mark, the line is kept and the next one opens. `solved`: a check mark and the
 *   finish. `ring`: a circle and a nudge (the engine's note, else the problem's hint); the next pen
 *   down, or "Erase and try again", starts the line over. `unread`: a question mark beside the ink,
 *   which is dropped (shown faint until the next pen down). `unjudged`: no mark; the line stays open
 *   and the next read takes all of it.
 * - The tutor's step from "Show me a step" goes on the open line (a circled line above it stays, as
 *   on paper) and counts as work: its LaTeX joins `work` for the next read.
 * - The first verdict writes the device's try marker (src/lib/try/marker.ts). The Join card opens
 *   after the first line checked right, when the tutor's step finishes the problem, or when the try
 *   board is off.
 * - Errors are read by their JSON code (`errorNotice`): a pause (`rate_limited`, with its wait), the
 *   board off (`unavailable`), a bug (`invalid_request`), else a read that failed just now.
 *
 * It imports the contract's types only: the contract module brings zod, which the page does not
 * otherwise load. The server's constants (`TRY_API`, `TRY_MAX_LINES`) come in through the props.
 */
import { startHref } from "@/lib/landing/links";
import type { TryBandId, TryCheckRequest, TryHelpRequest, TryInk, TryVerdict } from "@/lib/try/contracts";
import { writeTryMarker, type MarkerStorage } from "@/lib/try/marker";
import { inkBox, type InkStroke } from "./tryInk";

/** Pen up to the read, when nothing more is written. */
export const QUIET_MS = 1200;
/** A line's limits (the contract's `Coords`): strokes, and points per stroke. */
export const MAX_STROKES = 40;
export const MAX_POINTS = 1000;
/** Points closer than this to the last one kept add nothing to a stroke. */
const MIN_STEP_PX = 1;
/** The contract's verdicts (TRY_VERDICTS, pinned by a test). */
export const VERDICTS: readonly TryVerdict[] = ["check", "solved", "ring", "unread", "unjudged"];
/** A rate limit's wait when the server names none, and the longest the page waits on its own. */
const DEFAULT_RETRY_MS = 60_000;
const MAX_RETRY_MS = 60 * 60_000;

export interface TryBoardProblem {
  id: string;
  band: TryBandId;
  hint: string;
  oneStep: boolean;
}

export interface KidRow {
  kind: "kid";
  id: number;
  strokes: InkStroke[];
  /** an unread line's ink, shown faint beside its question mark until the next pen down */
  ghost: InkStroke[] | null;
  verdict: TryVerdict | null;
  /** what the reader saw, once it has read the line */
  latex: string | null;
}

export interface TutorRow {
  kind: "tutor";
  id: number;
  latex: string;
  ink: TryInk;
}

export type TryRow = KidRow | TutorRow;

export type TryNotice =
  | { kind: "check" }
  | { kind: "solved" }
  /** `note`: the engine's own words (shown as they are), else the problem's hint */
  | { kind: "ring"; nudge: string; note: boolean }
  | { kind: "unread" }
  | { kind: "unjudged" }
  | { kind: "helped"; solves: boolean }
  | { kind: "noStep" }
  | { kind: "full" }
  | { kind: "rate"; retryAfterMs: number }
  /** the reader failed just now (`upstream_error`, or anything the server did not mean): try again */
  | { kind: "upstream" }
  /** the try board is off (`unavailable`) */
  | { kind: "down" }
  | { kind: "offline" }
  | { kind: "invalid" };

export interface TryState {
  band: TryBandId;
  problemId: string;
  rows: TryRow[];
  busy: "reading" | "helping" | null;
  /** a stroke is being written */
  drawing: boolean;
  notice: TryNotice | null;
  /** who finished the problem: the visitor's line checked `solved`, or the tutor's step */
  solved: "kid" | "tutor" | null;
  joinOpen: boolean;
  /** the tutor has checked one of the visitor's lines right on this visit (any problem) */
  checkedOnce: boolean;
  /** epoch ms until which reads are paused (a 429), else 0 */
  blockedUntil: number;
  /** the server said the try board is off (503): no read on a pause, the button still asks */
  down: boolean;
}

export interface TryDeps {
  fetch: typeof fetch;
  /** localStorage, or null where it cannot be used */
  storage: () => MarkerStorage | null;
  now: () => number;
  online: () => boolean;
  api: { check: string; help: string };
  maxLines: number;
}

/** The request body for a line: its ink moved to its own box's corner, and the box's size. */
export function checkRequest(problemId: string, work: string[], strokes: readonly InkStroke[]): TryCheckRequest | null {
  const box = inkBox(strokes);
  if (!box) return null;
  const r = (n: number) => Math.round(n * 10) / 10;
  const kept = strokes.filter((s) => s.x.length > 0).slice(0, MAX_STROKES);
  return {
    problemId,
    work,
    strokes: {
      x: kept.map((s) => s.x.slice(0, MAX_POINTS).map((x) => r(x - box.x))),
      y: kept.map((s) => s.y.slice(0, MAX_POINTS).map((y) => r(y - box.y))),
    },
    bounds: { w: Math.min(4000, Math.max(1, r(box.w))), h: Math.min(2000, Math.max(1, r(box.h))) },
  };
}

/** The lines that count as work for the next read or step: the ones checked right and the tutor's, top to bottom. */
export function workOf(rows: readonly TryRow[], maxLines: number): string[] {
  return rows
    .filter((row) => row.kind === "tutor" || row.verdict === "check" || row.verdict === "solved")
    .map((row) => row.latex ?? "")
    .filter((latex) => latex !== "")
    .slice(-maxLines);
}

/** The line the visitor writes on: the last, unless the tutor checked it right or it is the tutor's. */
export function openRow(state: Pick<TryState, "rows" | "solved">): KidRow | null {
  if (state.solved) return null;
  const last = state.rows.at(-1);
  if (!last || last.kind !== "kid" || last.verdict === "check" || last.verdict === "solved") return null;
  return last;
}

/**
 * The Join button's address: /start, the new onboarding (`startHref`), with this page's `?ref=` and
 * `utm_*` carried along, so a post's or a friend's link still says where the family came from (the
 * device's attribution keeps it too: src/lib/funnel/capture.ts). A value that looks like an email
 * address is dropped.
 */
export function joinHref(search: string | null | undefined): string {
  const from = new URLSearchParams(search ?? "");
  for (const [key, value] of [...from]) if (value.includes("@")) from.delete(key, value);
  return startHref(from.toString());
}

const emptyRow = (id: number): KidRow => ({ kind: "kid", id, strokes: [], ghost: null, verdict: null, latex: null });

type CheckAnswer = { latex: string; verdict: TryVerdict; note: string | null };
type HelpAnswer = { latex: string | null; ink: TryInk | null; solves: boolean };

function isInk(value: unknown): value is TryInk {
  if (!value || typeof value !== "object") return false;
  const ink = value as Record<string, unknown>;
  return (
    Array.isArray(ink.strokes) &&
    ink.strokes.every((s) => s && typeof s === "object" && typeof (s as Record<string, unknown>).d === "string") &&
    typeof ink.width === "number" &&
    typeof ink.height === "number"
  );
}

/** A check's answer, as the contract has it (TryCheckResponseSchema), or null. */
export function parseCheck(body: unknown): CheckAnswer | null {
  if (!body || typeof body !== "object") return null;
  const { latex, verdict, note } = body as Record<string, unknown>;
  if (typeof latex !== "string" || !VERDICTS.includes(verdict as TryVerdict)) return null;
  return { latex, verdict: verdict as TryVerdict, note: typeof note === "string" && note.trim() ? note.trim() : null };
}

/** A step's answer (TryHelpResponseSchema), or null. */
export function parseHelp(body: unknown): HelpAnswer | null {
  if (!body || typeof body !== "object") return null;
  const { latex, ink, solves } = body as Record<string, unknown>;
  if (latex !== null && typeof latex !== "string") return null;
  return { latex: typeof latex === "string" && latex ? latex : null, ink: isInk(ink) ? ink : null, solves: solves === true };
}

/**
 * What an error answer means for the page, by its JSON `error` code (TryErrorSchema), not its
 * status: the server sends a failed read as 503 `upstream_error` (Cloudflare swaps a 502's body for
 * its own page), and a crash as 500 `internal_error`, outside the contract's list. Any code it does
 * not know, or no JSON at all, is a read that failed just now, except a bare 429 or 4xx.
 */
export function errorNotice(status: number, body: unknown): TryNotice {
  const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof fields.error === "string" ? fields.error : null;
  if (code === "rate_limited" || (code === null && status === 429)) {
    const ms = fields.retryAfterMs;
    const wait = typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_RETRY_MS) : DEFAULT_RETRY_MS;
    return { kind: "rate", retryAfterMs: wait };
  }
  if (code === "unavailable") return { kind: "down" };
  if (code === "invalid_request" || (code === null && (status === 400 || status === 403 || status === 413))) return { kind: "invalid" };
  return { kind: "upstream" };
}

/** Notices that outlast new ink: the board is still paused or off. */
const STICKY: ReadonlySet<TryNotice["kind"]> = new Set(["rate", "down"]);

export class TryStore {
  private state: TryState;
  private readonly listeners = new Set<() => void>();
  private quiet: ReturnType<typeof setTimeout> | null = null;
  private unblock: ReturnType<typeof setTimeout> | null = null;
  private inflight: AbortController | null = null;
  private nextId: number;

  constructor(
    private readonly problems: readonly TryBoardProblem[],
    private readonly deps: TryDeps,
    band: TryBandId,
    initial: Partial<TryState> = {},
  ) {
    const first = problems.find((p) => p.band === band) ?? problems[0];
    const rows = initial.rows ?? [emptyRow(1)];
    this.nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
    this.state = {
      band: first?.band ?? band,
      problemId: first?.id ?? "",
      rows,
      busy: null,
      drawing: false,
      notice: null,
      solved: null,
      joinOpen: false,
      checkedOnce: false,
      blockedUntil: 0,
      down: false,
      ...initial,
    };
  }

  // ---------------------------------------------------------------- the store

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): TryState => this.state;

  private set(patch: Partial<TryState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setOpen(patch: Partial<KidRow>, rest: Partial<TryState> = {}): void {
    const rows = this.state.rows.slice();
    const last = rows.at(-1);
    if (last?.kind === "kid") rows[rows.length - 1] = { ...last, ...patch };
    this.set({ rows, ...rest });
  }

  problem(): TryBoardProblem | null {
    return this.problems.find((p) => p.id === this.state.problemId) ?? null;
  }

  bandProblems(band: TryBandId = this.state.band): TryBoardProblem[] {
    return this.problems.filter((p) => p.band === band);
  }

  // ---------------------------------------------------------------- problems

  /** Start `problemId` afresh: no lines, nothing pending. The Join card, a pause and an outage stay. */
  start(problemId: string): void {
    const problem = this.problems.find((p) => p.id === problemId);
    if (!problem) return;
    this.cancel();
    this.nextId += 1;
    const notice = this.state.notice && STICKY.has(this.state.notice.kind) ? this.state.notice : null;
    this.set({ band: problem.band, problemId, rows: [emptyRow(this.nextId)], busy: null, drawing: false, solved: null, notice });
  }

  selectBand(band: TryBandId): void {
    if (band === this.state.band) return;
    const first = this.bandProblems(band)[0];
    if (first) this.start(first.id);
  }

  /** The band's next problem, round again after the last. */
  nextProblem(): void {
    const list = this.bandProblems();
    if (list.length === 0) return;
    const at = list.findIndex((p) => p.id === this.state.problemId);
    this.start(list[(at + 1) % list.length].id);
  }

  // ---------------------------------------------------------------- the pen

  /** A pen down at (x, y) in the open line's CSS px. False when the line takes no ink now. */
  penDown(x: number, y: number): boolean {
    const row = openRow(this.state);
    if (!row || this.state.busy === "helping" || this.state.drawing) return false;
    // a circled or unread line starts over; a half line ("keep going") keeps its ink
    const fresh = row.verdict === "ring";
    const strokes = fresh ? [] : row.strokes;
    if (strokes.length >= MAX_STROKES) return false;
    this.clearQuiet();
    this.abortRead();
    const notice = this.state.notice && STICKY.has(this.state.notice.kind) ? this.state.notice : null;
    this.setOpen({ strokes: [...strokes, { x: [x], y: [y] }], ghost: null, verdict: null, latex: null }, { drawing: true, busy: null, notice });
    return true;
  }

  /** More of the stroke being written. */
  penMove(points: ReadonlyArray<{ x: number; y: number }>): void {
    const row = openRow(this.state);
    if (!this.state.drawing || !row || points.length === 0) return;
    const last = row.strokes.at(-1);
    if (!last) return;
    const xs = last.x.slice();
    const ys = last.y.slice();
    for (const p of points) {
      if (xs.length >= MAX_POINTS) break;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const dx = p.x - xs[xs.length - 1];
      const dy = p.y - ys[ys.length - 1];
      if (dx * dx + dy * dy < MIN_STEP_PX * MIN_STEP_PX) continue;
      xs.push(p.x);
      ys.push(p.y);
    }
    if (xs.length === last.x.length) return;
    this.setOpen({ strokes: [...row.strokes.slice(0, -1), { x: xs, y: ys }] });
  }

  /** The pen lifted: the line is read after a quiet pause, unless reads are paused or off. */
  penUp(): void {
    if (!this.state.drawing) return;
    this.set({ drawing: false });
    if (this.state.down || this.deps.now() < this.state.blockedUntil) return;
    this.quiet = setTimeout(() => {
      this.quiet = null;
      void this.check();
    }, QUIET_MS);
  }

  /** "Erase and try again": the open line, empty. */
  erase(): void {
    if (!openRow(this.state)) return;
    this.clearQuiet();
    this.abortRead();
    const notice = this.state.notice && STICKY.has(this.state.notice.kind) ? this.state.notice : null;
    this.setOpen({ strokes: [], ghost: null, verdict: null, latex: null }, { busy: null, drawing: false, notice });
  }

  // ---------------------------------------------------------------- the server

  /** Read and check the open line now (the quiet pause, or "Check my line"). */
  async check(): Promise<void> {
    const row = openRow(this.state);
    if (!row || row.strokes.length === 0 || row.verdict !== null || this.state.busy || this.state.drawing) return;
    this.clearQuiet();
    if (this.deps.now() < this.state.blockedUntil) {
      this.set({ notice: { kind: "rate", retryAfterMs: this.state.blockedUntil - this.deps.now() } });
      return;
    }
    if (!this.deps.online()) {
      this.set({ notice: { kind: "offline" } });
      return;
    }
    const body = checkRequest(this.state.problemId, workOf(this.state.rows, this.deps.maxLines), row.strokes);
    if (!body) return;
    const controller = new AbortController();
    this.inflight = controller;
    this.set({ busy: "reading", notice: null });
    const answer = await this.post(this.deps.api.check, body, controller);
    if (this.inflight !== controller) return; // superseded by more ink, another problem, or erased
    this.inflight = null;
    if (answer.kind === "error") {
      this.fail(answer.notice);
      return;
    }
    const result = parseCheck(answer.body);
    if (!result) {
      this.fail({ kind: "upstream" });
      return;
    }
    this.verdict(row.id, result);
  }

  /** "Show me a step": the tutor's next line, on the open line. */
  async help(): Promise<void> {
    const row = openRow(this.state);
    if (!row || this.state.busy || this.state.drawing) return;
    this.clearQuiet();
    if (!this.deps.online()) {
      this.set({ notice: { kind: "offline" } });
      return;
    }
    const problemId = this.state.problemId;
    const body: TryHelpRequest = { problemId, work: workOf(this.state.rows, this.deps.maxLines) };
    const controller = new AbortController();
    this.inflight = controller;
    this.set({ busy: "helping", notice: null });
    const answer = await this.post(this.deps.api.help, body, controller);
    if (this.inflight !== controller) return;
    this.inflight = null;
    if (answer.kind === "error") {
      this.fail(answer.notice);
      return;
    }
    const step = parseHelp(answer.body);
    if (!step) {
      this.fail({ kind: "upstream" });
      return;
    }
    if (!step.latex || !step.ink) {
      this.set({ busy: null, notice: { kind: "noStep" } });
      return;
    }
    // the tutor's line goes on the open line; a circled line stays above it, as on paper, while there is room
    const rows = this.state.rows.slice();
    const keepRing = row.verdict === "ring" && rows.length < this.deps.maxLines;
    if (!keepRing) rows.pop();
    this.nextId += 1;
    rows.push({ kind: "tutor", id: this.nextId, latex: step.latex, ink: step.ink });
    if (step.solves) {
      // the tutor's line is the answer: the problem is finished, as when the visitor's own line is
      this.set({ rows, busy: null, solved: "tutor", joinOpen: true, notice: { kind: "helped", solves: true } });
      return;
    }
    this.set({ rows, busy: null, notice: { kind: "helped", solves: false } });
    this.openNext();
  }

  /** The network is back: an offline notice goes. */
  online(): void {
    if (this.state.notice?.kind === "offline") this.set({ notice: null });
  }

  /** Timers and requests stop (the view unmounts). */
  dispose(): void {
    this.cancel();
    if (this.unblock) clearTimeout(this.unblock);
    this.unblock = null;
  }

  // ---------------------------------------------------------------- inside

  private async post(url: string, body: unknown, controller: AbortController): Promise<{ kind: "ok"; body: unknown } | { kind: "error"; notice: TryNotice }> {
    let response: Response;
    try {
      response = await this.deps.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return { kind: "error", notice: this.deps.online() ? { kind: "upstream" } : { kind: "offline" } };
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) return { kind: "error", notice: errorNotice(response.status, json) };
    return { kind: "ok", body: json };
  }

  private fail(notice: TryNotice): void {
    const patch: Partial<TryState> = { busy: null, notice };
    if (notice.kind === "rate") {
      patch.blockedUntil = this.deps.now() + notice.retryAfterMs;
      if (this.unblock) clearTimeout(this.unblock);
      this.unblock = setTimeout(() => {
        this.unblock = null;
        this.set({ blockedUntil: 0, notice: this.state.notice?.kind === "rate" ? null : this.state.notice });
      }, notice.retryAfterMs);
    }
    if (notice.kind === "down") {
      patch.down = true;
      patch.joinOpen = true;
    }
    this.set(patch);
  }

  private verdict(rowId: number, { latex, verdict, note }: CheckAnswer): void {
    const row = openRow(this.state);
    if (!row || row.id !== rowId) return;
    this.mark(verdict);
    const problem = this.problem();
    const settled = { busy: null, down: false } as const;
    switch (verdict) {
      case "check":
        this.setOpen({ verdict, latex }, { ...settled, joinOpen: true, checkedOnce: true, notice: { kind: "check" } });
        this.openNext();
        return;
      case "solved":
        this.setOpen({ verdict, latex }, { ...settled, joinOpen: true, checkedOnce: true, solved: "kid", notice: { kind: "solved" } });
        return;
      case "ring":
        this.setOpen({ verdict, latex }, { ...settled, notice: note ? { kind: "ring", nudge: note, note: true } : { kind: "ring", nudge: problem?.hint ?? "", note: false } });
        return;
      case "unread":
        this.setOpen({ verdict, latex: null, ghost: row.strokes, strokes: [] }, { ...settled, notice: { kind: "unread" } });
        return;
      case "unjudged":
        // nothing to mark yet: the line stays open, and the next read takes all of it
        this.setOpen({ verdict: null, latex: null }, { ...settled, notice: { kind: "unjudged" } });
        return;
    }
  }

  /** A new open line under the last, or the page is full. */
  private openNext(): void {
    if (this.state.rows.length >= this.deps.maxLines) {
      this.set({ notice: this.state.notice?.kind === "check" || this.state.notice?.kind === "helped" ? { kind: "full" } : this.state.notice });
      return;
    }
    this.nextId += 1;
    this.set({ rows: [...this.state.rows, emptyRow(this.nextId)] });
  }

  /** The device's try marker, on every verdict (it only ever merges upward). */
  private mark(verdict: TryVerdict): void {
    try {
      writeTryMarker(this.deps.storage(), { checked: verdict === "check" || verdict === "solved", solved: verdict === "solved" }, new Date(this.deps.now()));
    } catch {
      // storage is a nicety here: the board works without it
    }
  }

  private clearQuiet(): void {
    if (this.quiet) clearTimeout(this.quiet);
    this.quiet = null;
  }

  private abortRead(): void {
    if (this.inflight) this.inflight.abort();
    this.inflight = null;
  }

  private cancel(): void {
    this.clearQuiet();
    this.abortRead();
  }
}
