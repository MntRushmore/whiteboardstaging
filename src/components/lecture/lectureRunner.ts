import type { LectureRequest, LectureResponse, SpeechSource } from "@/lib/live/lecture/contracts";
import { LectureSession, timingForSpeed, type LectureErrorCode, type LectureSnapshot, type LectureTiming } from "@/lib/live/lecture/session";
import { handleStatusFor, hasLectureConsent, lectureBoardFor, rememberLectureConsent, type LectureControllerLike, type LectureHandleStatus } from "./lectureView";

/**
 * Lecture mode on one board, without React: one `LectureSession` at a time, the consent note the
 * first time on this device, starting, stopping and the scripted demo. `useLecture` is a thin
 * wrapper over it; everything here is tested in node (__tests__/lectureRunner.test.ts).
 *
 * Two stores come out of it: `coarse` (the state: off, consent, starting, listening, paused, error)
 * changes a handful of times per lecture, and `live` (the session's snapshot: the words, the
 * timer) changes all the time — so the page can hold the first and only the panel the second.
 */

export interface LectureCoarse {
  status: LectureHandleStatus;
  error: LectureErrorCode | null;
  source: SpeechSource["kind"] | null;
}

export const LECTURE_OFF: LectureCoarse = { status: "off", error: null, source: null };

/** The fast-moving part: the session's latest snapshot and when it was taken. */
export interface LectureLiveState {
  snapshot: LectureSnapshot;
  at: number;
}

export interface LectureLive {
  subscribe(cb: () => void): () => void;
  get(): LectureLiveState | null;
}

type ConsentStorage = Parameters<typeof hasLectureConsent>[0];

export interface LectureRunnerDeps {
  boardId: string;
  /** the live controller at first (the page hands over newer ones with `setController`) */
  controller?: LectureControllerLike;
  /** the microphone's speech source (`createSpeechSource`) */
  openSpeech(): Promise<SpeechSource>;
  /** a scripted source (`createScriptSource`) */
  openScript(lines: Array<{ atMs: number; text: string }>, opts?: { speed?: number }): SpeechSource;
  /** the director (`requestLecture`) */
  request(req: LectureRequest, signal: AbortSignal): Promise<LectureResponse>;
  /** where the consent is remembered (localStorage; null when unavailable) */
  storage(): ConsentStorage;
  now?(): number;
  /** session overrides for tests (timers, clock) */
  session?: { setTimeout?(fn: () => void, ms: number): ReturnType<typeof setTimeout>; clearTimeout?(t: ReturnType<typeof setTimeout>): void };
}

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

export class LectureRunner {
  private session: LectureSession | null = null;
  /** consent given in this page's life (storage may be unavailable) */
  private consented = false;
  private readonly coarseStore = store<LectureCoarse>(LECTURE_OFF);
  private readonly liveStore = store<LectureLiveState | null>(null);
  private readonly now: () => number;
  /** the live controller of the moment: a running session always reaches the newest one */
  private controller: LectureControllerLike;

  /** the state (subscribe with useSyncExternalStore) */
  readonly coarse = { subscribe: this.coarseStore.subscribe, get: this.coarseStore.get };
  /** the words, the timer, what was drawn */
  readonly live: LectureLive = { subscribe: this.liveStore.subscribe, get: this.liveStore.get };

  constructor(private readonly deps: LectureRunnerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.controller = deps.controller ?? {};
  }

  /** The page's controller changed (a new one after a remount, Live switched on or off). */
  setController(controller: LectureControllerLike): void {
    this.controller = controller;
  }

  /** First time on this device: the consent note. After that: straight to listening. */
  start = (): void => {
    if (this.running()) return;
    if (!this.consented && !hasLectureConsent(this.deps.storage())) {
      this.detach();
      this.setCoarse({ status: "consent", error: null, source: null });
      return;
    }
    this.launch(() => this.deps.openSpeech());
  };

  confirmConsent = (): void => {
    this.consented = true;
    rememberLectureConsent(this.deps.storage());
    if (this.running()) return;
    this.launch(() => this.deps.openSpeech());
  };

  cancelConsent = (): void => {
    if (this.coarseStore.get().status === "consent") this.setCoarse(LECTURE_OFF);
  };

  stop = (): void => {
    this.detach();
    this.setCoarse(LECTURE_OFF);
  };

  pause = (): void => this.session?.pause();
  resume = (): void => this.session?.resume();
  drawThat = (): void => this.session?.drawThat();

  /** dev/QA: a scripted lecture (no consent, no microphone, no token); its pacing scaled with `speed` */
  startScripted = (lines: Array<{ atMs: number; text: string }>, opts?: { speed?: number }): void => {
    this.launch(async () => this.deps.openScript(lines, opts), timingForSpeed(opts?.speed));
  };

  /** The board is gone (or another one opened): the lecture ends. */
  dispose(): void {
    this.stop();
  }

  private running(): boolean {
    const s = this.session?.snapshot().status;
    return s === "starting" || s === "listening" || s === "paused";
  }

  private launch(openSource: () => Promise<SpeechSource>, timing?: Partial<LectureTiming>): void {
    this.detach();
    const board = lectureBoardFor(() => this.controller);
    if (!board) {
      this.setCoarse({ status: "error", error: "board", source: null });
      return;
    }
    const session: LectureSession = new LectureSession({
      boardId: this.deps.boardId,
      openSource,
      board,
      timing,
      request: this.deps.request,
      ...this.deps.session,
      onChange: (snap) => {
        if (this.session !== session) return;
        this.liveStore.set({ snapshot: snap, at: this.now() });
        this.setCoarse({ status: handleStatusFor(snap), error: snap.error, source: snap.source });
      },
    });
    this.session = session;
    this.setCoarse({ status: "starting", error: null, source: null });
    void session.start();
  }

  /** Drops the current session without a trace (its last snapshot is ignored). */
  private detach(): void {
    const s = this.session;
    this.session = null;
    s?.stop();
    this.liveStore.set(null);
  }

  private setCoarse(next: LectureCoarse): void {
    const prev = this.coarseStore.get();
    if (prev.status === next.status && prev.error === next.error && prev.source === next.source) return;
    this.coarseStore.set(next);
  }
}
