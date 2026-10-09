/**
 * Read aloud's speaker: says one phrase at a time, in the ElevenLabs voice when the speak route
 * answers and in the browser's own voice when it does not.
 *
 * Why it works this way:
 *  - ONE shared <audio> element. iOS Safari plays sound only from an element a user gesture has
 *    played once ("unlocked"); a fresh element per phrase would be blocked every time. `unlock()` is
 *    called inside the first tap on the board (it plays a few milliseconds of silence) and every
 *    later hint plays through the same element. A hint that came before any tap is kept a moment
 *    (`PENDING_MS`) and said once the tap unlocks the element.
 *  - A new phrase cancels the one before: two hints never talk over each other, and a replay tap
 *    starts the phrase again.
 *  - Never while the student is writing: an automatic phrase (`waitForPause`) waits until the
 *    board's probe says the pen has rested (`setBusyProbe`); its audio is fetched meanwhile, so it
 *    plays the moment the pen stops. One that waits too long (`MAX_WAIT_MS`) is dropped as stale.
 *  - Recent phrases are kept as audio (`CACHE_PHRASES`): a replay, or the same coach mark again,
 *    costs no second ElevenLabs call.
 *  - The route says "unavailable" (no key on this deployment, or a key ElevenLabs refuses): the
 *    browser's voice for the next ROUTE_DOWN_MS, without asking again for every phrase. A rate
 *    limit waits out its Retry-After the same way.
 *
 * The browser parts (the element, speechSynthesis, the fetch, object URLs, timers) are injected,
 * so all of this runs in node against fakes (`__tests__/speaker.test.ts`).
 */
import { spokenText } from "./spoken";

/** How a phrase ended. */
export type SpeakOutcome =
  /** the ElevenLabs voice said it to the end */
  | "voice"
  /** the browser's voice said it */
  | "browser"
  /** a newer phrase (or `stop`) cut it short */
  | "cancelled"
  /** nothing to say, or it waited too long for the pen to rest */
  | "skipped"
  /** the browser refused to play without a tap first (iOS): kept for the unlock */
  | "blocked"
  /** neither voice could say it */
  | "failed";

/** What the speaker needs from an <audio> element. */
export interface AudioLike {
  src: string;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended" | "error", fn: () => void): void;
  removeEventListener(type: "ended" | "error", fn: () => void): void;
}

/** A speechSynthesis voice. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
}

/** A SpeechSynthesisUtterance. */
export interface UtteranceLike {
  text: string;
  lang: string;
  voice: VoiceLike | null;
  rate: number;
  pitch: number;
  volume: number;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
}

/** window.speechSynthesis. */
export interface SynthLike {
  speak(u: UtteranceLike): void;
  cancel(): void;
  getVoices(): VoiceLike[];
}

/** Why the speak route gave no audio. */
export type SpeechFetchFailure = "unavailable" | "limited" | "auth" | "failed";

/** The speak route's refusal, as the speaker acts on it. */
export class SpeechFetchError extends Error {
  constructor(
    readonly kind: SpeechFetchFailure,
    readonly retryAfterMs?: number,
  ) {
    super(`speak route: ${kind}`);
    this.name = "SpeechFetchError";
  }
}

type Timer = unknown;

export interface SpeakerDeps {
  /** POST /api/live/speak with these words: the MP3, or a SpeechFetchError */
  fetchSpeech(text: string, signal: AbortSignal): Promise<Blob>;
  /** the one shared element (null: no <audio> here, the browser's voice only) */
  audio: AudioLike | null;
  synth: SynthLike | null;
  makeUtterance(text: string): UtteranceLike;
  toUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  now?(): number;
  setTimeout?(fn: () => void, ms: number): Timer;
  /** a counter for the bug report's log (`clientMetric`) */
  metric?(name: string, fields: Record<string, unknown>): void;
}

/** How often a waiting phrase looks at the pen. */
const PAUSE_POLL_MS = 250;
/** A phrase still waiting for the pen after this long is stale: dropped. */
export const MAX_WAIT_MS = 20_000;
/** A phrase the browser blocked (no tap yet) is said at the unlock if it is at most this old. */
export const PENDING_MS = 10_000;
/** After "unavailable", the browser's voice for this long before the route is asked again. */
export const ROUTE_DOWN_MS = 10 * 60_000;
/** Phrases kept as audio. */
export const CACHE_PHRASES = 24;
/** The browser's voice: a little slower than its default, for young listeners. */
const BROWSER_RATE = 0.95;

/**
 * Voices that are jokes or robots (macOS's novelty voices, eSpeak's): never a tutor's voice,
 * whatever their language says.
 */
const NOVELTY_VOICES =
  /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Junior|Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley|espeak)\b/i;
/** Natural-sounding English voices by platform, best first. */
const PREFERRED_VOICES = [
  /\b(Natural|Neural)\b/i, // Edge's online voices: "Microsoft Aria Online (Natural)"
  /\b(Premium|Enhanced)\b/i, // downloaded Apple voices
  /^Samantha\b/i, // macOS / iOS default
  /^Google US English\b/i, // Chrome
  /^Microsoft (Aria|Jenny|Ava|Emma|Michelle|Zira)\b/i, // Windows
  /^(Karen|Moira|Tessa|Serena|Daniel|Allison|Ava|Susan|Victoria)\b/i,
  /^Google UK English Female\b/i,
];

/**
 * The browser voice to fall back on: English, natural rather than robotic, American first (the
 * students are), never a novelty voice. null when there is no English voice (the browser then uses
 * its default with `lang` en-US).
 */
export function pickBrowserVoice(voices: readonly VoiceLike[]): VoiceLike | null {
  let best: VoiceLike | null = null;
  let bestScore = 0;
  for (const v of voices) {
    const lang = v.lang.replace("_", "-").toLowerCase();
    if (!lang.startsWith("en") || NOVELTY_VOICES.test(v.name)) continue;
    let score = lang === "en-us" ? 3 : lang === "en-gb" || lang === "en-au" || lang === "en-ca" ? 2 : 1;
    const rank = PREFERRED_VOICES.findIndex((re) => re.test(v.name));
    if (rank >= 0) score += 20 - rank;
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

/**
 * A few milliseconds of silence as a WAV data URI (8 kHz, 8-bit, mono): what `unlock` plays inside
 * the first tap, so the shared element may play later on iOS. Built here rather than shipped as a
 * file: no request, and 44 bytes of header are easy to get right.
 */
export function silentWavDataUri(samples = 400, rate = 8000): string {
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // bytes per second
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit silence is the midpoint
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

let silentWav: string | null = null;

interface ActivePhrase {
  id: number;
  abort: AbortController;
  finish(outcome: SpeakOutcome): void;
}

export class Speaker {
  private seq = 0;
  private active: ActivePhrase | null = null;
  /** spoken words -> object URL of their MP3, oldest first */
  private readonly cache = new Map<string, string>();
  private playingUrl: string | null = null;
  private stopAudio: (() => void) | null = null;
  private stopSynth: (() => void) | null = null;
  private routeDownUntil = 0;
  private busy: (() => boolean) | null = null;
  private pending: { words: string; at: number } | null = null;
  private audioUnlocked = false;
  private unlocking = false;
  private synthUnlocked = false;

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;

  constructor(private readonly deps: SpeakerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  }

  /** True once the shared element has played (a tap unlocked it, or the browser allowed it anyway). */
  get unlocked(): boolean {
    return this.audioUnlocked;
  }

  /**
   * What says "the student is writing" (the board's pen; `penIsResting`). Returns a function that
   * removes it again (only if it is still the one set).
   */
  setBusyProbe(probe: () => boolean): () => void {
    this.busy = probe;
    return () => {
      if (this.busy === probe) this.busy = null;
    };
  }

  /**
   * Says `text` (made speakable first: `spokenText`), cancelling whatever was being said. With
   * `waitForPause`, it starts only once the pen rests. Resolves with how it ended; never rejects.
   */
  speak(text: string, opts: { waitForPause?: boolean } = {}): Promise<SpeakOutcome> {
    const words = spokenText(text);
    if (!words) return Promise.resolve("skipped");
    this.stop();
    const id = ++this.seq;
    const abort = new AbortController();
    return new Promise<SpeakOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: SpeakOutcome) => {
        if (settled) return;
        settled = true;
        if (this.active?.id === id) this.active = null;
        this.deps.metric?.("speech.said", { outcome, chars: words.length });
        resolve(outcome);
      };
      this.active = { id, abort, finish };
      void this.run(id, words, opts.waitForPause === true, abort.signal, finish).catch(() => finish("failed"));
    });
  }

  /** Stops the phrase being said (or fetched, or waiting for the pen). */
  stop(): void {
    const active = this.active;
    this.active = null;
    this.stopAudio?.();
    this.stopSynth?.();
    if (active) {
      active.abort.abort();
      active.finish("cancelled");
    }
  }

  /**
   * Call inside a user gesture (a tap, a key): plays a moment of silence through the shared element
   * so iOS lets it play later, and primes the browser's voice the same way. Then says a phrase the
   * browser blocked a moment ago, if there is one. Cheap to call on every gesture until it worked.
   */
  unlock(): void {
    const audio = this.deps.audio;
    if (audio && !this.audioUnlocked && !this.unlocking && !this.stopAudio) {
      this.unlocking = true;
      silentWav ??= silentWavDataUri();
      audio.src = silentWav;
      audio
        .play()
        .then(() => {
          this.audioUnlocked = true;
          this.sayPending();
        })
        .catch(() => undefined)
        .finally(() => {
          this.unlocking = false;
        });
    }
    const synth = this.deps.synth;
    if (synth && !this.synthUnlocked && !this.stopSynth) {
      this.synthUnlocked = true;
      try {
        const u = this.deps.makeUtterance(" ");
        u.volume = 0;
        synth.speak(u);
      } catch {
        this.synthUnlocked = false;
      }
    }
  }

  // ---------------------------------------------------------------- one phrase

  private isCurrent(id: number): boolean {
    return this.active?.id === id;
  }

  private async run(id: number, words: string, waitForPause: boolean, signal: AbortSignal, finish: (o: SpeakOutcome) => void): Promise<void> {
    // fetched while the pen still moves: ready the moment it rests
    const url = this.audioUrl(words, signal);
    if (waitForPause && !(await this.pause(id))) {
      finish(this.isCurrent(id) ? "skipped" : "cancelled");
      return;
    }
    const ready = await url;
    if (!this.isCurrent(id)) return finish("cancelled");
    if (ready) {
      const played = await this.playAudio(ready);
      if (played === "voice" || played === "cancelled") return finish(played);
      if (played === "blocked") {
        this.pending = { words, at: this.now() };
        return finish("blocked");
      }
      // the element could not play it (a decode error): the browser's voice instead
    }
    if (!this.isCurrent(id)) return finish("cancelled");
    const said = await this.playBrowser(words);
    if (said === "blocked") this.pending = { words, at: this.now() };
    finish(said);
  }

  /** Resolves true once the pen rests; false when cancelled meanwhile or it waited too long. */
  private pause(id: number): Promise<boolean> {
    const started = this.now();
    return new Promise((resolve) => {
      const look = () => {
        if (!this.isCurrent(id)) return resolve(false);
        if (!this.busy?.()) return resolve(true);
        if (this.now() - started >= MAX_WAIT_MS) return resolve(false);
        this.setTimer(look, PAUSE_POLL_MS);
      };
      look();
    });
  }

  /** The phrase's MP3 as an object URL (the cache first), or null to use the browser's voice. */
  private async audioUrl(words: string, signal: AbortSignal): Promise<string | null> {
    const hit = this.cache.get(words);
    if (hit) {
      this.cache.delete(words);
      this.cache.set(words, hit);
      return hit;
    }
    if (!this.deps.audio || this.now() < this.routeDownUntil) return null;
    try {
      const blob = await this.deps.fetchSpeech(words, signal);
      const url = this.deps.toUrl(blob);
      this.remember(words, url);
      return url;
    } catch (err) {
      if (signal.aborted) return null;
      const kind = err instanceof SpeechFetchError ? err.kind : "failed";
      if (kind === "unavailable") this.routeDownUntil = this.now() + ROUTE_DOWN_MS;
      if (kind === "limited") this.routeDownUntil = this.now() + Math.max(1_000, err instanceof SpeechFetchError ? (err.retryAfterMs ?? 60_000) : 60_000);
      this.deps.metric?.("speech.fallback", { reason: kind });
      return null;
    }
  }

  private remember(words: string, url: string): void {
    this.cache.set(words, url);
    while (this.cache.size > CACHE_PHRASES) {
      const [oldest, oldUrl] = this.cache.entries().next().value as [string, string];
      this.cache.delete(oldest);
      if (oldUrl !== this.playingUrl) this.deps.revokeUrl(oldUrl);
    }
  }

  /** Plays through the shared element: "voice" at its end, "blocked" without a tap yet, "failed" otherwise. */
  private playAudio(url: string): Promise<"voice" | "cancelled" | "blocked" | "failed"> {
    const audio = this.deps.audio;
    if (!audio) return Promise.resolve("failed");
    return new Promise((resolve) => {
      let settled = false;
      const done = (outcome: "voice" | "cancelled" | "blocked" | "failed") => {
        if (settled) return;
        settled = true;
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        if (this.stopAudio === stop) this.stopAudio = null;
        if (this.playingUrl === url) this.playingUrl = null;
        resolve(outcome);
      };
      const onEnded = () => done("voice");
      const onError = () => done("failed");
      const stop = () => {
        try {
          audio.pause();
        } catch {
          /* nothing playing */
        }
        done("cancelled");
      };
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
      this.stopAudio = stop;
      this.playingUrl = url;
      audio.src = url;
      audio
        .play()
        .then(() => {
          this.audioUnlocked = true;
        })
        .catch((err: unknown) => {
          const name = err instanceof Error || (typeof err === "object" && err !== null) ? (err as { name?: string }).name : undefined;
          if (name === "AbortError") return; // our own pause, or a newer src: `stop` already settled it
          done(name === "NotAllowedError" ? "blocked" : "failed");
        });
    });
  }

  /** Says it with speechSynthesis in a natural English voice. */
  private playBrowser(words: string): Promise<"browser" | "cancelled" | "blocked" | "failed"> {
    const synth = this.deps.synth;
    if (!synth) return Promise.resolve("failed");
    return new Promise((resolve) => {
      let settled = false;
      const done = (outcome: "browser" | "cancelled" | "blocked" | "failed") => {
        if (settled) return;
        settled = true;
        if (this.stopSynth === stop) this.stopSynth = null;
        resolve(outcome);
      };
      const stop = () => {
        try {
          synth.cancel();
        } catch {
          /* nothing queued */
        }
        done("cancelled");
      };
      try {
        const u = this.deps.makeUtterance(words);
        const voice = pickBrowserVoice(synth.getVoices());
        u.voice = voice;
        u.lang = voice?.lang ?? "en-US";
        u.rate = BROWSER_RATE;
        u.pitch = 1;
        u.volume = 1;
        u.onend = () => done("browser");
        u.onerror = (ev) => done(ev?.error === "interrupted" || ev?.error === "canceled" ? "cancelled" : ev?.error === "not-allowed" ? "blocked" : "failed");
        this.stopSynth = stop;
        // Chrome keeps a queue that can stall: start from an empty one
        synth.cancel();
        synth.speak(u);
      } catch {
        done("failed");
      }
    });
  }

  /** A phrase the browser blocked a moment ago, said now that a tap unlocked the element. */
  private sayPending(): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending || this.active || this.now() - pending.at > PENDING_MS) return;
    void this.speak(pending.words, { waitForPause: true });
  }
}
