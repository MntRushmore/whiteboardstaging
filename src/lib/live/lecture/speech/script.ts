import type { SpeechCallbacks, SpeechSource, SpeechState } from "../contracts";
import { cleanSpeech } from "../transcript";

/**
 * A lecture read from a script instead of the microphone: each line becomes a final at its
 * `atMs`, and a few growing partials lead up to it so the panel looks as it does live. For tests,
 * demos and QA (`useLecture().startScripted`, and `window.__agathonLectureScript` in development):
 * no microphone, no token, no credit for listening — the director is still asked as usual.
 *
 * `speed` runs the script faster (2 = twice as fast); `atMs` in the finals stays the script's
 * own time, so a transcript window means the same thing at any speed. Pausing holds the script's
 * clock; resuming carries on where it was.
 */

export interface ScriptLine {
  atMs: number;
  text: string;
}

export interface ScriptSourceOptions {
  speed?: number;
  /** partials shown before each line's final (default 3) */
  partials?: number;
  now?(): number;
  setTimeout?(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout?(t: ReturnType<typeof setTimeout>): void;
}

/** script time between the partials that lead up to a line (and before its final) */
export const SCRIPT_PARTIAL_GAP_MS = 400;

type ScriptEvent = { t: number; kind: "partial" | "final"; text: string };

/** The script as timed events: for each line, growing partials over the words, then the final. */
export function scriptEvents(lines: readonly ScriptLine[], partials = 3): ScriptEvent[] {
  const sorted = [...lines].map((l) => ({ atMs: Math.max(0, l.atMs), text: cleanSpeech(l.text) })).filter((l) => l.text).sort((a, b) => a.atMs - b.atMs);
  const events: ScriptEvent[] = [];
  let prev = -Infinity;
  for (const line of sorted) {
    const words = line.text.split(" ");
    const n = Math.min(partials, Math.max(0, words.length - 1));
    for (let k = n; k >= 1; k--) {
      const t = line.atMs - k * SCRIPT_PARTIAL_GAP_MS;
      // never before the previous line's final: its partials would interleave
      if (t <= prev) continue;
      const upTo = Math.max(1, Math.round((words.length * (n - k + 1)) / (n + 1)));
      events.push({ t, kind: "partial", text: words.slice(0, upTo).join(" ") });
    }
    events.push({ t: line.atMs, kind: "final", text: line.text });
    prev = line.atMs;
  }
  return events;
}

export class ScriptSource implements SpeechSource {
  readonly kind = "script" as const;

  private cb: SpeechCallbacks | null = null;
  private readonly events: ScriptEvent[];
  private next = 0;
  /** script time reached when the clock last (re)started, and the wall time it did */
  private scriptAt = 0;
  private wallAt = 0;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: SpeechState = "idle";

  private readonly speed: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (t: ReturnType<typeof setTimeout>) => void;

  constructor(lines: readonly ScriptLine[], opts: ScriptSourceOptions = {}) {
    this.events = scriptEvents(lines, opts.partials ?? 3);
    this.speed = opts.speed && opts.speed > 0 && Number.isFinite(opts.speed) ? opts.speed : 1;
    this.now = opts.now ?? (() => Date.now());
    this.setTimer = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimeout ?? ((t) => clearTimeout(t));
  }

  async start(cb: SpeechCallbacks): Promise<void> {
    this.cb = cb;
    this.setState("connecting");
    this.scriptAt = 0;
    this.next = 0;
    this.run();
    this.setState("listening");
  }

  pause(): void {
    if (!this.running) return;
    this.scriptAt = this.scriptNow();
    this.running = false;
    this.clear();
    this.setState("paused");
  }

  resume(): void {
    if (this.running || !this.cb || this.state !== "paused") return;
    this.run();
    this.setState("listening");
  }

  stop(): void {
    this.running = false;
    this.clear();
    this.setState("idle");
    this.cb = null;
  }

  /** true once every line has been heard */
  get done(): boolean {
    return this.next >= this.events.length;
  }

  private scriptNow(): number {
    return this.running ? this.scriptAt + (this.now() - this.wallAt) * this.speed : this.scriptAt;
  }

  private run(): void {
    this.wallAt = this.now();
    this.running = true;
    this.schedule();
  }

  private schedule(): void {
    this.clear();
    const ev = this.events[this.next];
    if (!ev || !this.running) return;
    const wait = Math.max(0, (ev.t - this.scriptNow()) / this.speed);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.fire();
    }, wait);
  }

  private fire(): void {
    if (!this.running) return;
    const at = this.scriptNow();
    // everything due by now (a slow timer can owe more than one)
    while (this.next < this.events.length && this.events[this.next].t <= at + 0.5) {
      const ev = this.events[this.next++];
      if (ev.kind === "partial") this.cb?.onPartial(ev.text);
      else this.cb?.onFinal({ text: ev.text, atMs: ev.t });
    }
    this.schedule();
  }

  private clear(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private setState(state: SpeechState): void {
    if (this.state === state) return;
    this.state = state;
    this.cb?.onState(state);
  }
}

export function createScriptSource(lines: Array<{ atMs: number; text: string }>, opts?: { speed?: number }): SpeechSource {
  return new ScriptSource(lines, opts);
}
