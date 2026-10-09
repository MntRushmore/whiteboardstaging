/**
 * The clock of "Save video"'s real-time pass (recordReplay.ts): when each frame is due, and what
 * happens when the page is hidden while the canvas is being recorded.
 *
 * A hidden page's timers are suspended (iOS) or slowed to about one a second (Chrome), while
 * MediaRecorder's clock keeps running: the video would hold one picture for as long as the page was
 * away, then rush the overdue frames out back to back with no chance to capture them, and still be
 * offered as ready. So the pacer pauses the recorder the moment the page is hidden
 * (`visibilitychange`), waits at the next frame until it is visible again, then resumes the recorder
 * and moves its own clock on by the time away: the video carries on from the same frame, as if
 * nothing happened. Where the recorder cannot pause, the recording is stopped with
 * RecordingInterruptedError (the caller says "keep this tab open") rather than handed over spoiled.
 *
 * A stall the page did not report (a slow decode, a busy main thread) moves the clock on too, once
 * the loop is more than `maxLagFrames` behind, so frames are never rushed out to catch up.
 *
 * Pure of the DOM: the recorder, the document and the clock are passed in (tests use fakes).
 */

/** What the pacer needs of a MediaRecorder. */
export interface PausableRecorder {
  readonly state: "inactive" | "recording" | "paused";
  pause(): void;
  resume(): void;
}

/** What it needs of the document. */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** The page was hidden mid-recording and the recorder could not pause or resume: the video would be spoiled. */
export class RecordingInterruptedError extends Error {
  constructor() {
    super("The page was hidden while the video was recording.");
    this.name = "RecordingInterruptedError";
  }
}

export interface RecordPacer {
  /** Starts the clock and the watch on the page; call right after the recorder starts. */
  start(): void;
  /**
   * Before painting a frame: while the page is (or was) hidden, waits with the recorder paused until
   * it is visible again, then resumes it. Returns early when `signal` aborts (the caller checks it).
   * Throws RecordingInterruptedError when the recorder could not pause or resume.
   */
  beforeFrame(signal?: AbortSignal): Promise<void>;
  /** After painting frame `i` (0-based): how long to wait before the next one (0 when it is due). */
  waitAfter(i: number): number;
  /** Stops watching the page. */
  dispose(): void;
}

export function createRecordPacer(opts: { recorder: PausableRecorder; doc: VisibilitySource; frameMs: number; now?: () => number; maxLagFrames?: number }): RecordPacer {
  const { recorder, doc, frameMs } = opts;
  const now = opts.now ?? (() => performance.now());
  const maxLagMs = (opts.maxLagFrames ?? 4) * frameMs;
  let t0 = 0;
  /** when the recorder was paused for a hidden page; null while recording */
  let pausedAt: number | null = null;
  let interrupted = false;
  let wake: (() => void) | null = null;

  const pauseForHidden = () => {
    if (pausedAt !== null) return;
    pausedAt = now();
    if (recorder.state !== "recording") return;
    try {
      recorder.pause();
    } catch {
      interrupted = true;
    }
  };
  const onVisibility = () => {
    if (doc.hidden) pauseForHidden();
    else {
      const w = wake;
      wake = null;
      w?.();
    }
  };

  return {
    start() {
      t0 = now();
      doc.addEventListener("visibilitychange", onVisibility);
      if (doc.hidden) pauseForHidden();
    },

    async beforeFrame(signal) {
      if (doc.hidden) pauseForHidden();
      if (pausedAt === null) return;
      if (interrupted) throw new RecordingInterruptedError();
      if (doc.hidden) {
        await new Promise<void>((resolve) => {
          const done = () => {
            signal?.removeEventListener("abort", done);
            resolve();
          };
          wake = done;
          signal?.addEventListener("abort", done, { once: true });
        });
        if (signal?.aborted) return;
      }
      // visible again: the clock skips the time away, and the recorder carries on from this frame
      t0 += now() - pausedAt;
      pausedAt = null;
      if (recorder.state === "paused") {
        try {
          recorder.resume();
        } catch {
          throw new RecordingInterruptedError();
        }
      }
    },

    waitAfter(i) {
      const wait = t0 + (i + 1) * frameMs - now();
      if (wait < -maxLagMs) {
        // far behind for a reason the page did not report: move on rather than rush frames out
        t0 -= wait;
        return 0;
      }
      return Math.max(0, wait);
    },

    dispose() {
      doc.removeEventListener("visibilitychange", onVisibility);
      const w = wake;
      wake = null;
      w?.();
    },
  };
}
