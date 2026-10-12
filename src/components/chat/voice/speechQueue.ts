/**
 * Ask's replies read aloud as they stream: the queue between the panel's stream and the voice
 * (docs/ASK-V2.md, part "voice"). `useAskSpeech` wraps it for React; the voice itself is the read
 * aloud speaker (`src/lib/speech/speaker.ts`: Hope on ElevenLabs for a plan, the browser's voice
 * otherwise), injected so all of this runs in node against a fake (`__tests__/speechQueue.test.ts`).
 *
 *  - A reply's first sentence is said the moment it is whole; the ones after are gathered into
 *    phrases while the one before is said, and the next phrase's audio is fetched ahead
 *    (`prefetch`), so there is no wait between them. Phrases grow (`phraseLimit`: one sentence,
 *    then ~80, ~160, ASK_SPEECH.phraseChars characters): the voice makes a phrase's audio in about
 *    the time it takes to say a shorter one, so each is ready as the one before ends, and a long
 *    reply still costs few requests. (Measured 2026-10-11: a 15-character first sentence played for
 *    1.4 s while a 94-character second phrase took 1.6 s to make: a 0.6 s gap.)
 *  - `finish` says what is left: the final reply's sentences that were not said already (the final
 *    text is the stream's, cleaned or capped, or a replacement), never one twice.
 *  - At most ASK_SPEECH.maxReplyChars are said of one reply (the ElevenLabs balance); the rest stays
 *    on the screen.
 *  - A new reply (`start`) or `stop` silences whatever is being said, the board's own hints too
 *    (one voice at a time). When the voice is cut short by something else, cannot play, or fails,
 *    the rest of that reply is dropped rather than said out of the blue later.
 *  - Off (`setEnabled(false)`), sentences are only noted as shown, so switching it on mid-reply
 *    goes on from the next one. `replay` says one message whatever the setting.
 */
import { ASK_SPEECH, fitWords, sentenceKey, sentenceWords, splitLong, takeSentences } from "./speechChunks";

/** How a phrase ended (the read aloud speaker's `SpeakOutcome`). */
export type PhraseOutcome = "voice" | "browser" | "cancelled" | "skipped" | "blocked" | "failed";

/** What the queue needs from the voice. */
export interface PhraseSpeaker {
  /** says the words (cancelling whatever was being said); resolves when they end */
  speak(words: string): Promise<PhraseOutcome>;
  /** fetches the words' audio ahead of `speak` */
  prefetch?(words: string): void;
  stop(): void;
}

export interface AskSpeechQueueOptions {
  /** the voice, once loaded (a dynamic import the first time) */
  speaker(): Promise<PhraseSpeaker>;
  maxReplyChars?: number;
  phraseChars?: number;
}

interface Reply {
  id: string;
  /** a replay: said whatever the setting */
  forced: boolean;
  /** the stream so far */
  text: string;
  /** where the next sentence of `text` starts */
  cursor: number;
  /** the sentences taken so far (`sentenceKey`): never said twice */
  keys: Set<string>;
  /** words waiting to be said, each at most a phrase */
  queue: string[];
  /** the phrase after the one being said, already being fetched */
  next: string | null;
  /** characters given to the voice so far */
  chars: number;
  /** phrases formed so far (each may be longer than the one before: `phraseLimit`) */
  phrases: number;
  speaking: boolean;
  finished: boolean;
  /** nothing more is said of this reply (its characters are spent, or the voice stopped) */
  over: boolean;
}

/**
 * The most characters the reply's phrase number `n` (from 0) may join sentences up to: 0 for the
 * first (its first sentence alone: the shorter, the sooner the voice starts), then ~80, ~160, and
 * `max` from there. One sentence longer than that is still one phrase (`splitLong` caps it at `max`).
 */
export function phraseLimit(n: number, max: number = ASK_SPEECH.phraseChars): number {
  return n <= 0 ? 0 : Math.min(max, 80 * 2 ** (n - 1));
}

/** Ids remembered as started, so a late `finish` of a stopped reply is not said after all. */
const REMEMBERED_IDS = 50;

export class AskSpeechQueue {
  private reply: Reply | null = null;
  private enabled = true;
  private loading: Promise<PhraseSpeaker> | null = null;
  private loaded: PhraseSpeaker | null = null;
  private replays = 0;
  private readonly seen: string[] = [];
  private readonly maxReplyChars: number;
  private readonly phraseChars: number;

  constructor(private readonly opts: AskSpeechQueueOptions) {
    this.maxReplyChars = opts.maxReplyChars ?? ASK_SPEECH.maxReplyChars;
    this.phraseChars = opts.phraseChars ?? ASK_SPEECH.phraseChars;
  }

  /** Read aloud on or off. Off stops what is being said. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on && this.reply && !this.reply.forced) this.stop();
  }

  /** A new reply: whatever is being said stops. */
  start(id: string): void {
    this.stop();
    this.remember(id);
    this.reply = { id, forced: false, text: "", cursor: 0, keys: new Set(), queue: [], next: null, chars: 0, phrases: 0, speaking: false, finished: false, over: false };
  }

  /**
   * More of reply `id` as it streams: the new piece, or the whole text so far (a text that starts
   * with everything fed before is taken as the whole). Whole sentences are said as they complete.
   */
  feed(id: string, text: string): void {
    const r = this.reply;
    if (!r || r.id !== id || r.finished || !text) return;
    if (r.text && text.startsWith(r.text)) r.text = text;
    else r.text += text;
    const { sentences, next } = takeSentences(r.text, r.cursor, false);
    r.cursor = next;
    this.take(r, sentences);
  }

  /** Reply `id` is final: what it says that was not said yet is said now. */
  finish(id: string, finalText: string): void {
    let r = this.reply;
    if (!r || r.id !== id) {
      // never started (a reply that did not stream): start it now, unless it was stopped
      if (this.seen.includes(id)) return;
      this.start(id);
      r = this.reply!;
    }
    if (r.finished) return;
    r.finished = true;
    this.take(r, takeSentences(finalText, 0, true).sentences);
  }

  /** Says one message again (its speaker button), whatever the setting. */
  replay(text: string): void {
    const id = `replay:${++this.replays}`;
    this.start(id);
    this.reply!.forced = true;
    this.finish(id, text);
  }

  /** Silence: what is being said stops, and nothing waiting is said. */
  stop(): void {
    this.reply = null;
    this.loaded?.stop();
  }

  /** What is waiting to be said (tests and the QA handle). */
  get waiting(): readonly string[] {
    const r = this.reply;
    return r ? [...(r.next ? [r.next] : []), ...r.queue] : [];
  }

  // ---------------------------------------------------------------- inside

  private remember(id: string): void {
    this.seen.push(id);
    if (this.seen.length > REMEMBERED_IDS) this.seen.shift();
  }

  /** New sentences: noted, and queued as words when read aloud is on. */
  private take(r: Reply, sentences: string[]): void {
    for (const sentence of sentences) {
      const key = sentenceKey(sentence);
      if (!key || r.keys.has(key)) continue;
      r.keys.add(key);
      if (r.over || (!this.enabled && !r.forced)) continue;
      r.queue.push(...splitLong(sentenceWords(sentence), this.phraseChars));
    }
    this.pump(r);
  }

  /** Says the next phrase when nothing is being said; else gets the one after ready. */
  private pump(r: Reply): void {
    // (once `over`, the queue is empty: only a phrase already formed is still said)
    if (r !== this.reply) return;
    if (r.speaking) {
      this.prepareNext(r);
      return;
    }
    const phrase = r.next ?? this.form(r);
    r.next = null;
    if (!phrase) return;
    r.speaking = true;
    void this.say(r, phrase);
    this.prepareNext(r);
  }

  /**
   * The phrase after the one being said, fetched ahead: once the reply is complete, or a quarter of
   * that phrase's size is waiting (while it still streams, sentences that come soon after join it
   * instead). The second phrase goes almost at once: the first sentence is short, and its audio
   * ends soon.
   */
  private prepareNext(r: Reply): void {
    if (r.next || !r.queue.length || r.over) return;
    if (!r.finished && r.queue.join(" ").length < phraseLimit(r.phrases, this.phraseChars) / 4) return;
    const next = this.form(r);
    r.next = next;
    if (next) {
      void this.speaker().then(
        (s) => {
          if (r === this.reply && r.next === next) s.prefetch?.(next);
        },
        () => undefined,
      );
    }
  }

  /** Waiting words joined into one phrase, within its size (`phraseLimit`) and what is left of the reply's characters. */
  private form(r: Reply): string | null {
    let phrase = "";
    const limit = phraseLimit(r.phrases, this.phraseChars);
    while (r.queue.length) {
      const words = r.queue[0];
      const joined = phrase ? `${phrase} ${words}` : words;
      if (phrase && (limit === 0 || joined.length > limit)) break;
      if (r.chars + joined.length > this.maxReplyChars) {
        // the reply's characters run out here. It stops at a sentence's end, unless nothing of it
        // was said yet (one very long first sentence): that is cut to fit, on a sentence or a word
        const fitted = r.chars === 0 && !phrase ? fitWords(words, this.maxReplyChars) : "";
        if (fitted) phrase = fitted;
        r.queue = [];
        r.over = true;
        break;
      }
      phrase = joined;
      r.queue.shift();
    }
    if (!phrase) return null;
    r.chars += phrase.length;
    r.phrases++;
    return phrase;
  }

  private speaker(): Promise<PhraseSpeaker> {
    this.loading ??= this.opts.speaker().then(
      (s) => (this.loaded = s),
      (err: unknown) => {
        this.loading = null; // a chunk that failed to load (offline): the next reply tries again
        throw err;
      },
    );
    return this.loading;
  }

  private async say(r: Reply, phrase: string): Promise<void> {
    let outcome: PhraseOutcome;
    try {
      const speaker = await this.speaker();
      if (r !== this.reply) return;
      outcome = await speaker.speak(phrase);
    } catch {
      outcome = "failed";
    }
    if (r !== this.reply) return;
    r.speaking = false;
    if (outcome === "cancelled" || outcome === "blocked" || outcome === "failed") {
      // cut short by another voice, waiting for a tap (iOS), or no voice at all: the rest would
      // come out of the blue later, so it is dropped; the speaker button says it again
      r.over = true;
      r.queue = [];
      r.next = null;
      return;
    }
    this.pump(r);
  }
}
