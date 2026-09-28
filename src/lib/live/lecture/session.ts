import { isApiError } from "@/lib/api-client";
import { LIVE_RATE_LIMITS } from "../contracts";
import {
  LECTURE_LIMITS,
  LECTURE_TIMING,
  type LectureAction,
  type LectureBoard,
  type LectureRequest,
  type LectureResponse,
  type LectureRunReport,
  type LectureScreen,
  type SpeechSource,
  type SpeechState,
  type TranscriptSegment,
} from "./contracts";
import { isSalient } from "./salience";
import { isSpeechErrorCode, speechErrorCodeFor, type SpeechErrorCode } from "./speech/errors";
import { TranscriptBuffer, type TranscriptMark, type TranscriptWindow } from "./transcript";

/**
 * One lecture, from "Start listening" to Stop: the transcript as it is heard, when the director is
 * asked, and what comes back sketched on the board. Pure: the speech source, the board, the
 * director call, the clock and the timers are all injected, so the pacing is tested with fake
 * timers in node.
 *
 *  - States: starting → listening ⇄ paused → stopped, or error (listening could not start, the
 *    microphone was lost for good, the credits ran out, signed out).
 *  - Two paces. LIVE — while what was said since the last ask is salient (numbers, amounts,
 *    changes, steps, lists: `salience.ts`) or a chart or diagram was drawn or updated within
 *    `activeWindowMs` — the director is asked `liveTickMinMs` after the last ask once
 *    `liveTickMinWords` new words are in: "Q2 was up to fifteen million" reaches the chart within
 *    seconds (the first numbers of a lecture at once). Otherwise the usual `tickMinMs` /
 *    `tickMinWords` from the last ask or the start: about one ask a minute while someone talks,
 *    none in silence.
 *  - Asked the moment a committed segment makes an ask due, or at the exact moment the pace
 *    allows it (a timer set for then): no heartbeat granularity, no debounce on the way.
 *  - At most one ask at a time (a request and the drawing of its answer). A salient segment heard
 *    while one is in flight asks once more right after it (never sooner than the route's
 *    12-a-minute budget allows): the next bar is not left waiting for a whole interval.
 *  - "Draw that" (`drawThat`) asks now about the last minute of speech (`force`), as soon as
 *    `forceMinGapMs` has passed since the last ask; while one is in flight it waits for it, once.
 *  - Every final segment is saved on the current screen (`board.saveTranscript`): the words stay
 *    with the board, the audio is never kept anywhere.
 *  - `recent`: what this lecture drew on screens before the current one (the director's "drawn
 *    before"), newest first; an updated chart counts once, as it is now.
 *  - Silence for `idlePauseMs`: the session pauses itself (the microphone is let go).
 *  - Failures: 402 stops the lecture with "out of credits" (the panel shows the board's own
 *    out-of-credits panel, as the Ask panel does); 401 stops it signed out; 429 skips asks until
 *    the server's retry-after; anything else (the network, a 5xx, a timeout) keeps listening and
 *    the next ask tries again with the same unread words.
 *  - Every request carries the session's id (`session`): the route bills per minute of a session.
 */

export type LectureStatus = "starting" | "listening" | "paused" | "stopped" | "error";

/** Why a lecture ended in error: the speech codes, or a board that is not ready for it. */
export type LectureErrorCode = SpeechErrorCode | "board";

/** Something to tell the student that does not stop the lecture. */
export type LectureNotice =
  /** it paused itself: nothing heard for `idlePauseMs` */
  | { kind: "idle" }
  /** "Draw that" found nothing worth sketching (the route's first note, when it gave one) */
  | { kind: "nothing"; note?: string }
  /** "Draw that" before anything was heard */
  | { kind: "empty" }
  /** the director asked us to slow down: no asks until then */
  | { kind: "rate_limited"; retryAtMs: number }
  /** the director could not be reached; the next ask tries again */
  | { kind: "retrying" }
  /** the board could not draw what the director asked for */
  | { kind: "board_failed" };

export interface LectureStats {
  /** time spent listening (pauses not counted) */
  elapsedMs: number;
  /** words heard */
  words: number;
  /** blocks sketched (headings, notes, charts, diagrams, graphs, figures, formulas); an update is not a new one */
  sketches: number;
  /** the newest sketch's one-line summary ("bar chart: GDP growth by year") */
  lastWhat: string | null;
  /** whether `lastWhat` was drawn anew or an existing chart or diagram was updated */
  lastVerb: "drew" | "updated";
  /** the words being heard right now */
  partial: string;
  /** the last finished lines, oldest first */
  lines: string[];
}

export interface LectureSnapshot {
  status: LectureStatus;
  source: SpeechSource["kind"] | null;
  speech: SpeechState;
  error: LectureErrorCode | null;
  notice: LectureNotice | null;
  /** the director is being asked */
  thinking: boolean;
  /** "Draw that" was asked for and has not been answered yet */
  forcing: boolean;
  /** the board is writing a sketch */
  drawing: boolean;
  /** what is being written is an update of a chart or a diagram already there (else a new sketch) */
  updating: "chart" | "diagram" | null;
  /** a chart or diagram this lecture drew or updated is live (within `activeWindowMs`) */
  liveVisual: boolean;
  /** the pace the director is being asked at now */
  pace: "live" | "normal";
  stats: LectureStats;
}

export type LectureTiming = { -readonly [K in keyof typeof LECTURE_TIMING]: number };

type Timer = ReturnType<typeof setTimeout>;

export interface LectureSessionDeps {
  boardId: string;
  /** the speech source (asks for a token, may fall back): `createSpeechSource`, or a script */
  openSource(): Promise<SpeechSource>;
  board: LectureBoard;
  /** the director (`requestLecture`) */
  request(req: LectureRequest, signal: AbortSignal): Promise<LectureResponse>;
  /** the pacing (default `LECTURE_TIMING`); a scripted demo at 4× speed scales it */
  timing?: Partial<LectureTiming>;
  /** the session's id (default: a random one) */
  sessionId?: string;
  now?(): number;
  setTimeout?(fn: () => void, ms: number): Timer;
  clearTimeout?(t: Timer): void;
  onChange?(snapshot: LectureSnapshot): void;
}

/** How often the clock is looked at while listening (the timer, idle). */
export const HEARTBEAT_MS = 1_000;
/** The last finished lines the panel shows. */
export const TICKER_LINES = 2;
/** A 429 without a retry-after waits this long. */
export const DEFAULT_RETRY_AFTER_MS = 30_000;
/**
 * A follow-up ask (a salient segment heard while one was in flight) goes right after it, but never
 * sooner than this after the previous ask began: the route's budget (`liveLecture`, 12 a minute)
 * spread evenly, so a lecture full of numbers is never turned away with a 429.
 */
export const FOLLOW_UP_GAP_MS = Math.ceil(LIVE_RATE_LIMITS.liveLecture.windowMs / LIVE_RATE_LIMITS.liveLecture.limit);

const VISUAL_TYPES: ReadonlySet<LectureAction["type"]> = new Set(["chart", "diagram", "update_chart", "update_diagram"]);
const UPDATE_TYPES: ReadonlySet<LectureAction["type"]> = new Set(["update_chart", "update_diagram"]);

/** A random session id for `LectureRequest.session` (/^[A-Za-z0-9_-]{8,40}$/). */
export function newLectureSessionId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/**
 * The pacing for a script played `speed` times faster: the waits measured in lecture time (the
 * ask intervals, the live window, the force gap, the idle pause) shrink with it, so a 4× demo asks
 * the director as often per minute of script as a real lecture would. The forced window is read
 * from the script's own times and the request timeout is a network matter, so both stay as they are.
 */
export function timingForSpeed(speed = 1): LectureTiming {
  const s = speed > 0 && Number.isFinite(speed) ? speed : 1;
  return {
    ...LECTURE_TIMING,
    tickMinMs: LECTURE_TIMING.tickMinMs / s,
    liveTickMinMs: LECTURE_TIMING.liveTickMinMs / s,
    activeWindowMs: LECTURE_TIMING.activeWindowMs / s,
    forceMinGapMs: LECTURE_TIMING.forceMinGapMs / s,
    idlePauseMs: LECTURE_TIMING.idlePauseMs / s,
  };
}

/** What a reply's actions will do on the board, for the panel: update a chart, a diagram, or sketch anew. */
export function updatingKind(actions: readonly LectureAction[]): "chart" | "diagram" | null {
  const drawn = actions.filter((a) => a.type !== "new_screen");
  if (drawn.length === 0 || !drawn.every((a) => UPDATE_TYPES.has(a.type))) return null;
  return drawn.some((a) => a.type === "update_chart") ? "chart" : "diagram";
}

const EMPTY_STATS: LectureStats = { elapsedMs: 0, words: 0, sketches: 0, lastWhat: null, lastVerb: "drew", partial: "", lines: [] };

export class LectureSession {
  /** one id per lecture: the route bills per minute of it */
  readonly sessionId: string;

  private readonly timing: LectureTiming;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;
  private readonly clearTimer: (t: Timer) => void;

  private readonly transcript = new TranscriptBuffer();
  private mark: TranscriptMark = TranscriptBuffer.START;
  private source: SpeechSource | null = null;
  private listeners = new Set<(s: LectureSnapshot) => void>();

  private status: LectureStatus = "starting";
  private speech: SpeechState = "idle";
  private error: LectureErrorCode | null = null;
  private notice: LectureNotice | null = null;
  private partial = "";
  private sketches = 0;
  private lastWhat: string | null = null;
  private lastVerb: "drew" | "updated" = "drew";
  /** every block this lecture drew, oldest first, an updated one moved to the end (`recent` reads it) */
  private drawn: Array<{ id?: string; what: string }> = [];
  /** when a chart or diagram was last drawn or updated (the live pace holds for `activeWindowMs`) */
  private lastVisualAt: number | null = null;
  private pace: "live" | "normal" = "normal";

  /** a request is in flight or its answer is being drawn */
  private busy = false;
  private thinking = false;
  private drawing = false;
  private updating: "chart" | "diagram" | null = null;
  private forceQueued = false;
  /** the ask in flight is a "Draw that" */
  private forceInFlight = false;
  /** a salient segment was heard while an ask was in flight: ask once more right after it */
  private followUp = false;
  private inflight: AbortController | null = null;

  /** the pace's clock: the last ask, or the start (the first normal ask comes `tickMinMs` in) */
  private lastRequestAt = 0;
  /** the last ask actually sent (the force and follow-up gaps are measured from it) */
  private lastAskAt: number | null = null;
  private lastFinalAt = 0;
  private retryAt = 0;
  private listenedMs = 0;
  private listeningSince: number | null = null;

  private heartbeat: Timer | null = null;
  private forceTimer: Timer | null = null;
  /** set for the moment the next ask becomes due (the pace's wait, a retry-after, the follow-up gap) */
  private dueTimer: Timer | null = null;
  private ended = false;
  private snap: LectureSnapshot;

  constructor(private readonly deps: LectureSessionDeps) {
    this.sessionId = deps.sessionId ?? newLectureSessionId();
    this.timing = { ...LECTURE_TIMING, ...deps.timing };
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimeout ?? ((t) => clearTimeout(t));
    this.snap = this.build();
    if (deps.onChange) this.listeners.add(deps.onChange);
  }

  // ---------------------------------------------------------------- public

  snapshot(): LectureSnapshot {
    return this.snap;
  }

  subscribe(fn: (s: LectureSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Opens the source and starts listening. Never throws: a failure is the `error` status. */
  async start(): Promise<void> {
    if (this.status !== "starting" || this.source) return;
    this.emit();
    let source: SpeechSource;
    try {
      source = await this.deps.openSource();
    } catch (err) {
      this.fail(speechErrorCodeFor(err));
      return;
    }
    if (this.ended) {
      source.stop();
      return;
    }
    this.source = source;
    try {
      await source.start({
        onPartial: (text) => this.onPartial(text),
        onFinal: (seg) => this.onFinal(seg),
        onState: (state, detail) => this.onSpeechState(state, detail),
      });
    } catch (err) {
      this.fail(speechErrorCodeFor(err));
      return;
    }
    if (this.ended) return;
    const now = this.now();
    this.status = "listening";
    this.listeningSince = now;
    this.lastRequestAt = now;
    this.lastFinalAt = now;
    this.beat();
    this.emit();
    this.maybeTick(); // a script (or a fast recognizer) may already have said something
  }

  pause(): void {
    this.pauseFor(null);
  }

  resume(): void {
    if (this.status !== "paused" || this.ended) return;
    const now = this.now();
    this.status = "listening";
    this.listeningSince = now;
    this.lastFinalAt = now;
    if (this.notice?.kind === "idle") this.notice = null;
    this.source?.resume();
    this.beat();
    this.emit();
    this.maybeTick();
  }

  /** Ends the lecture. What was being heard is still saved (the source turns it into a final). */
  stop(): void {
    if (this.ended) return;
    // ended first: the source's last final (flushed by its stop) is saved but asks nothing
    this.freezeClock();
    this.ended = true;
    this.status = "stopped";
    this.clearTimers();
    this.inflight?.abort();
    this.source?.stop();
    this.emit();
  }

  /** "Draw that": ask the director about the last minute of speech, now (or as soon as it may). */
  drawThat(): void {
    if (this.ended || (this.status !== "listening" && this.status !== "paused")) return;
    if (this.transcript.isEmpty) {
      this.notice = { kind: "empty" };
      this.emit();
      return;
    }
    if (this.forceQueued) return;
    this.forceQueued = true;
    if (this.notice?.kind === "nothing" || this.notice?.kind === "empty") this.notice = null;
    this.emit();
    this.tryForce();
  }

  /** What this lecture drew that is not on the current screen, newest first (the director's `recent`). */
  recentFor(screen: Pick<LectureScreen, "drawn">): string[] {
    const here = new Set(screen.drawn);
    const out: string[] = [];
    for (let i = this.drawn.length - 1; i >= 0 && out.length < LECTURE_LIMITS.recent; i--) {
      const what = this.drawn[i].what.slice(0, LECTURE_LIMITS.whatChars);
      if (!here.has(what) && !out.includes(what)) out.push(what);
    }
    return out;
  }

  // ---------------------------------------------------------------- speech

  private onPartial(text: string): void {
    if (this.ended) return;
    if (text === this.partial) return;
    this.partial = text;
    this.emit();
  }

  private onFinal(seg: TranscriptSegment): void {
    // a stop's (or a failure's) last words still arrive — the source flushes them — and are saved
    this.partial = "";
    if (!this.transcript.add(seg)) {
      this.emit();
      return;
    }
    this.lastFinalAt = this.now();
    try {
      this.deps.board.saveTranscript(seg.text);
    } catch {
      /* the board may be between screens; the words are still in the session */
    }
    if (this.ended) return;
    // heard while an ask is in flight: a number or a step is worth one more ask right after it
    if (this.busy && !this.forceInFlight && isSalient(seg.text)) this.followUp = true;
    this.maybeTick();
    this.emit();
  }

  private onSpeechState(state: SpeechState, detail?: string): void {
    if (this.ended) return;
    this.speech = state;
    if (state === "error") {
      this.fail(isSpeechErrorCode(detail) ? detail : "recognizer");
      return;
    }
    this.emit();
  }

  // ---------------------------------------------------------------- pacing

  private beat(): void {
    if (this.heartbeat !== null) this.clearTimer(this.heartbeat);
    this.heartbeat = this.setTimer(() => {
      this.heartbeat = null;
      if (this.ended || this.status !== "listening") return;
      if (this.now() - this.lastFinalAt >= this.timing.idlePauseMs) {
        this.pauseFor({ kind: "idle" });
        return;
      }
      this.emit(); // the timer moves on (and a live visual's window closes)
      this.beat();
    }, HEARTBEAT_MS);
  }

  private visualIsLive(now: number): boolean {
    return this.lastVisualAt !== null && now - this.lastVisualAt < this.timing.activeWindowMs;
  }

  /** Asks the director now if an ask is due, else sets a timer for the moment it will be. */
  private maybeTick(): void {
    this.clearDue();
    if (this.ended || this.status !== "listening" || this.busy || this.forceQueued) return;
    const now = this.now();
    const fresh = this.transcript.textSince(this.mark);
    this.pace = this.visualIsLive(now) || (fresh !== "" && isSalient(fresh)) ? "live" : "normal";
    if (!fresh) {
      this.followUp = false;
      return;
    }
    let dueAt: number;
    if (this.followUp) {
      dueAt = Math.max((this.lastAskAt ?? 0) + FOLLOW_UP_GAP_MS, this.retryAt);
    } else {
      const live = this.pace === "live";
      if (this.transcript.wordsSince(this.mark) < (live ? this.timing.liveTickMinWords : this.timing.tickMinWords)) return;
      // the live pace counts from the last ask (the first numbers of a lecture go at once); the
      // usual pace from the last ask or the start, so an introduction is not asked about at once
      const since = live ? (this.lastAskAt ?? Number.NEGATIVE_INFINITY) : this.lastRequestAt;
      dueAt = Math.max(since + (live ? this.timing.liveTickMinMs : this.timing.tickMinMs), this.retryAt);
    }
    if (dueAt > now) {
      this.dueTimer = this.setTimer(() => {
        this.dueTimer = null;
        this.maybeTick();
      }, dueAt - now);
      return;
    }
    this.followUp = false;
    void this.tick(false);
  }

  private clearDue(): void {
    if (this.dueTimer !== null) this.clearTimer(this.dueTimer);
    this.dueTimer = null;
  }

  private tryForce(): void {
    if (!this.forceQueued || this.busy || this.ended) return;
    const now = this.now();
    const at = Math.max(this.lastAskAt === null ? 0 : this.lastAskAt + this.timing.forceMinGapMs, this.retryAt);
    if (at > now) {
      if (this.forceTimer === null) {
        this.forceTimer = this.setTimer(() => {
          this.forceTimer = null;
          this.tryForce();
        }, at - now);
      }
      return;
    }
    this.forceQueued = false;
    // "Draw that" reads the whole last minute: it answers a pending follow-up too
    this.followUp = false;
    this.clearDue();
    void this.tick(true);
  }

  private async tick(force: boolean): Promise<void> {
    const win: TranscriptWindow = force ? this.transcript.forcedWindow(this.timing.forceWindowMs) : this.transcript.window(this.mark);
    if (!win.fresh) {
      if (force) this.notice = { kind: "empty" };
      this.emit();
      return;
    }
    let screen: LectureScreen;
    try {
      screen = this.deps.board.screen();
    } catch {
      this.fail("board");
      return;
    }
    const readTo = this.transcript.mark();
    const ctrl = new AbortController();
    this.busy = true;
    this.thinking = true;
    this.forceInFlight = force;
    this.inflight = ctrl;
    this.lastRequestAt = this.now();
    this.lastAskAt = this.lastRequestAt;
    this.emit();
    const timeout = this.setTimer(() => ctrl.abort(), this.timing.requestTimeoutMs);

    let res: LectureResponse | null = null;
    try {
      res = await this.deps.request(
        { boardId: this.deps.boardId, session: this.sessionId, context: win.context, fresh: win.fresh, screen, recent: this.recentFor(screen), force },
        ctrl.signal,
      );
    } catch (err) {
      this.clearTimer(timeout);
      if (!this.ended) this.requestFailed(err);
      this.settle();
      return;
    }
    this.clearTimer(timeout);
    this.thinking = false;
    if (this.ended) {
      this.settle();
      return;
    }
    this.mark = readTo;
    if (this.notice?.kind === "retrying" || this.notice?.kind === "rate_limited") this.notice = null;

    if (res.actions.length > 0) {
      this.drawing = true;
      this.updating = updatingKind(res.actions);
      this.emit();
      try {
        this.record(await this.deps.board.run(res.actions));
      } catch {
        this.notice = { kind: "board_failed" };
      }
    } else if (force) {
      this.notice = { kind: "nothing", ...(res.notes[0] ? { note: res.notes[0] } : {}) };
    }
    this.settle();
  }

  /** The ask (and its drawing) is over: a queued "Draw that", a follow-up, or the pace decides the next. */
  private settle(): void {
    this.busy = false;
    this.thinking = false;
    this.drawing = false;
    this.updating = null;
    this.forceInFlight = false;
    this.inflight = null;
    if (!this.ended) {
      if (this.forceQueued) this.tryForce();
      else this.maybeTick();
    }
    this.emit();
  }

  private requestFailed(err: unknown): void {
    if (isApiError(err)) {
      if (err.status === 402 || err.code === "credits_exhausted") {
        this.fail("credits");
        return;
      }
      if (err.status === 401 || err.code === "unauthorized") {
        this.fail("unauthorized");
        return;
      }
      if (err.status === 429 || err.code === "rate_limited") {
        this.retryAt = this.now() + (err.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS);
        this.notice = { kind: "rate_limited", retryAtMs: this.retryAt };
        return;
      }
    }
    // the network, a 5xx, a timeout, an answer that did not parse: the next ask tries again
    this.notice = { kind: "retrying" };
    // …at the pace's next turn, not straight away (a follow-up would retry a failing route at once)
    this.followUp = false;
  }

  private record(report: LectureRunReport): void {
    const now = this.now();
    for (const o of report.outcomes) {
      if (!o.ok || o.type === "new_screen") continue;
      if (VISUAL_TYPES.has(o.type)) this.lastVisualAt = now;
      if (!o.what) continue;
      const update = UPDATE_TYPES.has(o.type);
      // an updated chart is one sketch, as it is now: its old summary goes, the new one is the newest
      const before = o.id ? this.drawn.findIndex((d) => d.id === o.id) : -1;
      if (before >= 0) this.drawn.splice(before, 1);
      this.drawn.push({ id: o.id, what: o.what });
      if (!update || before < 0) this.sketches++;
      this.lastWhat = o.what;
      this.lastVerb = update ? "updated" : "drew";
    }
    if (this.drawn.length > 200) this.drawn.splice(0, this.drawn.length - 200);
  }

  // ---------------------------------------------------------------- state

  private pauseFor(notice: LectureNotice | null): void {
    if (this.status !== "listening" || this.ended) return;
    // paused first: the partial the source flushes as a final must not start an ask
    this.freezeClock();
    this.status = "paused";
    if (notice) this.notice = notice;
    if (this.heartbeat !== null) this.clearTimer(this.heartbeat);
    this.heartbeat = null;
    this.clearDue();
    this.source?.pause();
    this.emit();
  }

  private fail(code: LectureErrorCode): void {
    if (this.ended) return;
    this.freezeClock();
    this.ended = true;
    this.status = "error";
    this.error = code;
    this.clearTimers();
    this.inflight?.abort();
    this.source?.stop();
    this.emit();
  }

  private freezeClock(): void {
    if (this.listeningSince !== null) this.listenedMs += this.now() - this.listeningSince;
    this.listeningSince = null;
  }

  private clearTimers(): void {
    if (this.heartbeat !== null) this.clearTimer(this.heartbeat);
    if (this.forceTimer !== null) this.clearTimer(this.forceTimer);
    this.heartbeat = null;
    this.forceTimer = null;
    this.clearDue();
    this.forceQueued = false;
    this.followUp = false;
  }

  private build(): LectureSnapshot {
    const now = this.now();
    const stats: LectureStats =
      this.transcript.isEmpty && !this.partial && this.sketches === 0 && this.listeningSince === null && this.listenedMs === 0
        ? EMPTY_STATS
        : {
            elapsedMs: this.listenedMs + (this.listeningSince !== null ? now - this.listeningSince : 0),
            words: this.transcript.totalWords,
            sketches: this.sketches,
            lastWhat: this.lastWhat,
            lastVerb: this.lastVerb,
            partial: this.partial,
            lines: this.transcript.lastLines(TICKER_LINES),
          };
    return {
      status: this.status,
      source: this.source?.kind ?? null,
      speech: this.speech,
      error: this.error,
      notice: this.notice,
      thinking: this.thinking,
      forcing: this.forceQueued || this.forceInFlight,
      drawing: this.drawing,
      updating: this.drawing ? this.updating : null,
      liveVisual: !this.ended && this.visualIsLive(now),
      pace: this.pace,
      stats,
    };
  }

  private emit(): void {
    this.snap = this.build();
    for (const l of this.listeners) l(this.snap);
  }
}
