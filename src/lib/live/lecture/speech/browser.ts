import type { SpeechCallbacks, SpeechSource, SpeechState } from "../contracts";
import { SpeechError, type SpeechErrorCode } from "./errors";

/**
 * The browser's own recognizer (the Web Speech API: Chrome, Edge, Safari), used when the
 * deployment has no realtime recognizer (no ELEVENLABS_API_KEY). Continuous, with interim results
 * as partials, in the language the browser is set to. It stops by itself — after a silence, a
 * network blip, or every minute or so in some browsers — so while listening it is started again
 * each time it ends, backing off when it keeps ending at once.
 *
 * The recognizer is injected (`Recognition`), so the logic runs in node against a fake.
 */

/** The parts of `SpeechRecognition` this source uses. */
export interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((ev: unknown) => void) | null;
  onresult: ((ev: RecognitionResultEventLike) => void) | null;
  onerror: ((ev: { error: string; message?: string }) => void) | null;
  onend: ((ev: unknown) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface RecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ readonly isFinal: boolean; readonly length: number; readonly [i: number]: { readonly transcript: string } }>;
}

export type RecognitionCtor = new () => RecognitionLike;

type Timer = ReturnType<typeof setTimeout>;

export interface BrowserSourceDeps {
  Recognition: RecognitionCtor;
  lang?: string;
  now?(): number;
  setTimeout?(fn: () => void, ms: number): Timer;
  clearTimeout?(t: Timer): void;
}

/** A run of the recognizer shorter than this counts as a failure to keep listening. */
export const QUICK_END_MS = 1_500;
/** consecutive quick ends before the source gives up */
export const MAX_QUICK_ENDS = 8;
export function restartDelayMs(quickEnds: number): number {
  return quickEnds <= 0 ? 0 : Math.min(5_000, 250 * 2 ** (quickEnds - 1));
}

/** The recognizer's error codes that will not go away by starting it again. */
const FATAL: Record<string, SpeechErrorCode> = {
  "not-allowed": "mic-denied",
  "service-not-allowed": "unsupported",
  "audio-capture": "mic-missing",
  "language-not-supported": "unsupported",
};

/** The browser's recognizer class, when it has one. */
export function browserRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class BrowserSpeechSource implements SpeechSource {
  readonly kind = "browser" as const;

  private cb: SpeechCallbacks | null = null;
  private rec: RecognitionLike | null = null;
  private state: SpeechState = "idle";
  private startedAt = 0;
  private runStartedAt = 0;
  private partial = "";
  private quickEnds = 0;
  /** results of the current run already sent as finals */
  private finalsSent = new Set<number>();
  private timer: Timer | null = null;
  private starting: { resolve: () => void; reject: (err: Error) => void } | null = null;

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;
  private readonly clearTimer: (t: Timer) => void;

  constructor(private readonly deps: BrowserSourceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimeout ?? ((t) => clearTimeout(t));
  }

  start(cb: SpeechCallbacks): Promise<void> {
    this.cb = cb;
    this.startedAt = this.now();
    this.setState("connecting");
    return new Promise<void>((resolve, reject) => {
      this.starting = { resolve, reject };
      this.run();
    });
  }

  pause(): void {
    if (this.state !== "listening" && this.state !== "connecting" && this.state !== "reconnecting") return;
    // abort (not stop), and what was being heard becomes the final here: stop() would deliver
    // it again as the recognizer's own final — in some browsers, some of the time
    this.flushPartial();
    this.setState("paused");
    this.clearRetry();
    try {
      this.rec?.abort();
    } catch {
      /* not running */
    }
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.quickEnds = 0;
    this.setState("connecting");
    this.run();
  }

  stop(): void {
    if (!this.cb) return;
    this.flushPartial();
    this.clearRetry();
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* not running */
      }
    }
    this.setState("idle");
    this.cb = null;
    this.starting = null;
  }

  // ----------------------------------------------------------------

  private recognizer(): RecognitionLike {
    if (this.rec) return this.rec;
    const rec = new this.deps.Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = this.deps.lang || (typeof navigator !== "undefined" ? navigator.language : "") || "en-US";
    rec.onstart = () => {
      this.runStartedAt = this.now();
      this.finalsSent.clear();
      if (this.state === "connecting" || this.state === "reconnecting") this.setState("listening");
      this.starting?.resolve();
      this.starting = null;
    };
    rec.onresult = (ev) => this.onResult(ev);
    rec.onerror = (ev) => {
      const fatal = FATAL[ev.error];
      if (fatal) this.fail(fatal);
      // anything else ("no-speech", "network", "aborted"): the end that follows starts it again
    };
    rec.onend = () => this.onEnd();
    this.rec = rec;
    return rec;
  }

  private run(): void {
    try {
      this.recognizer().start();
    } catch {
      // "already started": the running one carries on
    }
  }

  private onResult(ev: RecognitionResultEventLike): void {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      const text = r.length > 0 ? r[0].transcript : "";
      if (r.isFinal) {
        if (this.finalsSent.has(i)) continue;
        this.finalsSent.add(i);
        this.partial = "";
        this.emitFinal(text);
      } else {
        interim += text;
      }
    }
    const p = interim.replace(/\s+/g, " ").trim();
    if (p !== this.partial) {
      this.partial = p;
      this.cb?.onPartial(p);
    }
  }

  private onEnd(): void {
    if (this.state === "paused" || this.state === "idle" || this.state === "error") return;
    this.flushPartial();
    const ranFor = this.now() - this.runStartedAt;
    this.quickEnds = this.runStartedAt > 0 && ranFor >= QUICK_END_MS ? 0 : this.quickEnds + 1;
    if (this.quickEnds > MAX_QUICK_ENDS) {
      this.fail("network");
      return;
    }
    this.setState("reconnecting");
    this.clearRetry();
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.state === "reconnecting") this.run();
    }, restartDelayMs(this.quickEnds));
  }

  private fail(code: SpeechErrorCode): void {
    this.flushPartial();
    this.clearRetry();
    if (this.starting) {
      this.starting.reject(new SpeechError(code));
      this.starting = null;
    }
    this.setState("error", code);
    try {
      this.rec?.abort();
    } catch {
      /* not running */
    }
  }

  private emitFinal(text: string): void {
    const t = text.replace(/\s+/g, " ").trim();
    if (t) this.cb?.onFinal({ text: t, atMs: Math.max(0, this.now() - this.startedAt) });
  }

  private flushPartial(): void {
    const p = this.partial;
    this.partial = "";
    if (p) this.emitFinal(p);
  }

  private clearRetry(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private setState(state: SpeechState, detail?: string): void {
    if (this.state === state && !detail) return;
    this.state = state;
    this.cb?.onState(state, detail);
  }
}

export function createBrowserSource(deps: BrowserSourceDeps): SpeechSource {
  return new BrowserSpeechSource(deps);
}
