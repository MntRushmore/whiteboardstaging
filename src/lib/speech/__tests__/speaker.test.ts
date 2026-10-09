import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_PHRASES,
  FETCH_TIMEOUT_MS,
  MAX_WAIT_MS,
  PENDING_MS,
  PRIME_TRIES,
  ROUTE_DOWN_MS,
  Speaker,
  SpeechFetchError,
  pickBrowserVoice,
  silentWavDataUri,
  type AudioLike,
  type SpeakerDeps,
  type SynthLike,
  type UtteranceLike,
  type VoiceLike,
} from "../speaker";

/** The shared <audio> element: records what it was asked to play; `end()` finishes the phrase. */
class FakeAudio implements AudioLike {
  src = "";
  played: string[] = [];
  paused = 0;
  /** what the next play() does */
  mode: "ok" | "blocked" | "error" = "ok";
  private listeners = new Map<string, Set<() => void>>();
  play(): Promise<void> {
    this.played.push(this.src);
    if (this.mode === "blocked") return Promise.reject(new DOMException("needs a tap", "NotAllowedError"));
    if (this.mode === "error") {
      queueMicrotask(() => this.fire("error"));
      return Promise.reject(new DOMException("cannot decode", "NotSupportedError"));
    }
    return Promise.resolve();
  }
  pause(): void {
    this.paused++;
  }
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  end(): void {
    this.fire("ended");
  }
}

class FakeSynth implements SynthLike {
  spoken: UtteranceLike[] = [];
  cancels = 0;
  voices: VoiceLike[] = [{ name: "Samantha", lang: "en-US" }];
  /** finish each utterance as soon as it is spoken */
  auto = true;
  speak(u: UtteranceLike): void {
    this.spoken.push(u);
    if (this.auto && u.text.trim()) queueMicrotask(() => u.onend?.());
  }
  cancel(): void {
    this.cancels++;
  }
  getVoices(): VoiceLike[] {
    return this.voices;
  }
}

const utterance = (text: string): UtteranceLike => ({ text, lang: "", voice: null, rate: 1, pitch: 1, volume: 1, onend: null, onerror: null });
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

let audio: FakeAudio;
let synth: FakeSynth;
let fetchSpeech: ReturnType<typeof vi.fn<SpeakerDeps["fetchSpeech"]>>;
let revoked: string[];
let urls = 0;

function makeSpeaker(over: Partial<SpeakerDeps> = {}): Speaker {
  return new Speaker({
    fetchSpeech,
    audio,
    synth,
    makeUtterance: utterance,
    toUrl: () => `blob:${++urls}`,
    revokeUrl: (u) => revoked.push(u),
    ...over,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  audio = new FakeAudio();
  synth = new FakeSynth();
  fetchSpeech = vi.fn<SpeakerDeps["fetchSpeech"]>(async () => new Blob(["mp3"], { type: "audio/mpeg" }));
  revoked = [];
  urls = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Speaker: the ElevenLabs voice through one shared element", () => {
  it("fetches the spoken words, plays them, and resolves 'voice' at the end", async () => {
    const speaker = makeSpeaker();
    const said = speaker.speak("Try \\frac{1}{2} of x^2");
    await flush();
    expect(fetchSpeech).toHaveBeenCalledTimes(1);
    expect(fetchSpeech.mock.calls[0][0]).toBe("Try one half of x squared");
    expect(audio.played).toEqual(["blob:1"]);
    audio.end();
    await expect(said).resolves.toBe("voice");
    expect(speaker.unlocked).toBe(true);
  });

  it("keeps recent phrases: the same words again cost no second fetch", async () => {
    const speaker = makeSpeaker();
    const first = speaker.speak("Look at line 2");
    await flush();
    audio.end();
    await first;
    const again = speaker.speak("Look at line 2");
    await flush();
    expect(fetchSpeech).toHaveBeenCalledTimes(1);
    expect(audio.played).toEqual(["blob:1", "blob:1"]);
    audio.end();
    await expect(again).resolves.toBe("voice");
  });

  it("forgets the oldest phrase past the cache's size and frees its audio", async () => {
    const speaker = makeSpeaker();
    for (let i = 0; i <= CACHE_PHRASES; i++) {
      const p = speaker.speak(`Phrase number ${i}`);
      await flush();
      audio.end();
      await p;
    }
    expect(revoked).toEqual(["blob:1"]);
  });

  it("a polite phrase (a cheer) never cuts off one being said, and is said when nothing is", async () => {
    const speaker = makeSpeaker();
    const note = speaker.speak("Check the sign on line 2.");
    await flush();
    await expect(speaker.speak("So close! Try that step again.", { polite: true })).resolves.toBe("skipped");
    expect(fetchSpeech).toHaveBeenCalledTimes(1);
    audio.end();
    await expect(note).resolves.toBe("voice");
    const cheer = speaker.speak("Nice!", { polite: true });
    await flush();
    expect(fetchSpeech.mock.calls[1][0]).toBe("Nice!");
    audio.end();
    await expect(cheer).resolves.toBe("voice");
  });

  it("a new phrase cancels the one before", async () => {
    const speaker = makeSpeaker();
    const first = speaker.speak("First hint");
    await flush();
    const second = speaker.speak("Second hint");
    await expect(first).resolves.toBe("cancelled");
    expect(audio.paused).toBeGreaterThan(0);
    await flush();
    expect(audio.played).toEqual(["blob:1", "blob:2"]);
    audio.end();
    await expect(second).resolves.toBe("voice");
  });

  it("cancels a phrase still being fetched (its request is aborted)", async () => {
    let signal: AbortSignal | undefined;
    fetchSpeech.mockImplementationOnce((_t, s) => {
      signal = s;
      return new Promise(() => undefined);
    });
    const speaker = makeSpeaker();
    const first = speaker.speak("Slow one");
    await flush();
    speaker.stop();
    await expect(first).resolves.toBe("cancelled");
    expect(signal?.aborted).toBe(true);
    expect(audio.played).toEqual([]);
  });

  it("says nothing for nothing", async () => {
    const speaker = makeSpeaker();
    await expect(speaker.speak("  $$ ")).resolves.toBe("skipped");
    expect(fetchSpeech).not.toHaveBeenCalled();
  });
});

describe("Speaker: the browser's voice when the route cannot", () => {
  it("unavailable (no key): the browser's voice, and the route is left alone for a while", async () => {
    fetchSpeech.mockRejectedValue(new SpeechFetchError("unavailable"));
    const speaker = makeSpeaker();
    await expect(speaker.speak("x - 3 = 5")).resolves.toBe("browser");
    expect(synth.spoken.map((u) => u.text)).toEqual(["x minus 3 equals 5"]);
    expect(synth.spoken[0].voice?.name).toBe("Samantha");
    expect(synth.spoken[0].lang).toBe("en-US");

    await expect(speaker.speak("Another one")).resolves.toBe("browser");
    expect(fetchSpeech).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(ROUTE_DOWN_MS + 1);
    fetchSpeech.mockResolvedValueOnce(new Blob(["mp3"]));
    const later = speaker.speak("Back again");
    await flush();
    expect(fetchSpeech).toHaveBeenCalledTimes(2);
    audio.end();
    await expect(later).resolves.toBe("voice");
  });

  it("any other failure: the browser's voice for this phrase, the route again for the next", async () => {
    fetchSpeech.mockRejectedValueOnce(new SpeechFetchError("failed"));
    const speaker = makeSpeaker();
    await expect(speaker.speak("One")).resolves.toBe("browser");
    const next = speaker.speak("Two");
    await flush();
    expect(fetchSpeech).toHaveBeenCalledTimes(2);
    audio.end();
    await expect(next).resolves.toBe("voice");
  });

  it("a route that does not answer in time: the browser's voice, and the request is dropped", async () => {
    let signal: AbortSignal | undefined;
    fetchSpeech.mockImplementationOnce((_t, s) => {
      signal = s;
      return new Promise(() => undefined);
    });
    const speaker = makeSpeaker();
    const said = speaker.speak("Slow server");
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 10);
    await expect(said).resolves.toBe("browser");
    expect(signal?.aborted).toBe(true);
    // only that phrase: the next one asks the route again
    const next = speaker.speak("Next one");
    await flush();
    expect(fetchSpeech).toHaveBeenCalledTimes(2);
    audio.end();
    await expect(next).resolves.toBe("voice");
  });

  it("audio the element cannot play goes to the browser's voice", async () => {
    audio.mode = "error";
    const speaker = makeSpeaker();
    await expect(speaker.speak("Hello there")).resolves.toBe("browser");
  });

  it("no <audio> at all: straight to the browser's voice, no fetch", async () => {
    const speaker = makeSpeaker({ audio: null });
    await expect(speaker.speak("Hello")).resolves.toBe("browser");
    expect(fetchSpeech).not.toHaveBeenCalled();
  });

  it("neither voice: failed", async () => {
    fetchSpeech.mockRejectedValue(new SpeechFetchError("unavailable"));
    const speaker = makeSpeaker({ synth: null });
    await expect(speaker.speak("Hello")).resolves.toBe("failed");
  });
});

describe("Speaker: never while the student is writing", () => {
  it("waits for the pen to rest, with the audio fetched meanwhile", async () => {
    let writing = true;
    const speaker = makeSpeaker();
    speaker.setBusyProbe(() => writing);
    const said = speaker.speak("Try again", { waitForPause: true });
    await flush();
    expect(fetchSpeech).toHaveBeenCalledTimes(1);
    expect(audio.played).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(audio.played).toEqual([]);
    writing = false;
    await vi.advanceTimersByTimeAsync(300);
    expect(audio.played).toEqual(["blob:1"]);
    audio.end();
    await expect(said).resolves.toBe("voice");
  });

  it("a phrase that waits too long is stale: skipped", async () => {
    const speaker = makeSpeaker();
    speaker.setBusyProbe(() => true);
    const said = speaker.speak("Old hint", { waitForPause: true });
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS + 500);
    await expect(said).resolves.toBe("skipped");
    expect(audio.played).toEqual([]);
  });

  it("a tap's replay does not wait", async () => {
    const speaker = makeSpeaker();
    speaker.setBusyProbe(() => true);
    const said = speaker.speak("Now");
    await flush();
    expect(audio.played).toEqual(["blob:1"]);
    audio.end();
    await expect(said).resolves.toBe("voice");
  });

  it("the probe is removed by its own remover only", () => {
    const speaker = makeSpeaker();
    const a = () => true;
    const removeA = speaker.setBusyProbe(a);
    speaker.setBusyProbe(() => false);
    removeA();
    // the second probe is still in place: a phrase does not wait
    void speaker.speak("x", { waitForPause: true });
  });
});

describe("Speaker: iOS needs a tap before any sound", () => {
  it("a blocked phrase is kept, and said when the first tap unlocks the element", async () => {
    audio.mode = "blocked";
    const speaker = makeSpeaker();
    await expect(speaker.speak("Here is a hint")).resolves.toBe("blocked");
    expect(speaker.unlocked).toBe(false);

    audio.mode = "ok";
    speaker.unlock();
    expect(audio.played[1]).toMatch(/^data:audio\/wav;base64,/);
    await flush();
    expect(speaker.unlocked).toBe(true);
    // the kept phrase, from the cache (no second fetch)
    expect(audio.played[2]).toBe("blob:1");
    expect(fetchSpeech).toHaveBeenCalledTimes(1);
    // and the browser's voice was primed inside the same tap
    expect(synth.spoken[0]).toMatchObject({ text: " ", volume: 0 });
  });

  it("a blocked phrase that is too old by the tap is dropped", async () => {
    audio.mode = "blocked";
    const speaker = makeSpeaker();
    await speaker.speak("Old hint");
    vi.advanceTimersByTime(PENDING_MS + 1);
    audio.mode = "ok";
    speaker.unlock();
    await flush();
    expect(audio.played).toHaveLength(2); // the hint, then the silence: nothing after
  });

  it("unlock({ voice: false }) (a touch's pointerdown) leaves the browser's voice unprimed; the next gesture primes it", () => {
    const speaker = makeSpeaker();
    speaker.unlock({ voice: false });
    expect(synth.spoken).toEqual([]);
    expect(speaker.voiceUnlocked).toBe(false);
    speaker.unlock();
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]).toMatchObject({ text: " ", volume: 0 });
  });

  it("a primer iOS drops without a word is tried again on the next gesture; primed once the browser has said one", async () => {
    const speaker = makeSpeaker();
    speaker.unlock();
    await flush();
    // the fake says nothing for " ": like iOS outside a real gesture, no end and no error
    expect(speaker.voiceUnlocked).toBe(false);
    speaker.unlock();
    expect(synth.spoken).toHaveLength(2);
    synth.spoken[1].onend?.();
    expect(speaker.voiceUnlocked).toBe(true);
    speaker.unlock();
    expect(synth.spoken).toHaveLength(2);
  });

  it("a browser that never reports a primer's end gets PRIME_TRIES of them, not one on every tap", () => {
    const speaker = makeSpeaker();
    for (let i = 0; i < PRIME_TRIES + 5; i++) speaker.unlock();
    expect(synth.spoken).toHaveLength(PRIME_TRIES);
    expect(speaker.voiceUnlocked).toBe(true);
  });

  it("with no browser voice there is nothing to prime", () => {
    expect(makeSpeaker({ synth: null }).voiceUnlocked).toBe(true);
  });

  it("unlock does nothing while a phrase is playing, or once unlocked", async () => {
    const speaker = makeSpeaker();
    const said = speaker.speak("Playing");
    await flush();
    speaker.unlock();
    expect(audio.played).toEqual(["blob:1"]);
    audio.end();
    await said;
    speaker.unlock();
    expect(audio.played).toEqual(["blob:1"]);
  });
});

describe("pickBrowserVoice", () => {
  const v = (name: string, lang: string): VoiceLike => ({ name, lang });

  it("natural English voices first, American before British", () => {
    expect(pickBrowserVoice([v("Daniel", "en-GB"), v("Samantha", "en-US"), v("Thomas", "fr-FR")])?.name).toBe("Samantha");
    expect(pickBrowserVoice([v("Google US English", "en-US"), v("Microsoft Aria Online (Natural) - English (United States)", "en-US")])?.name).toContain("Natural");
    expect(pickBrowserVoice([v("Google UK English Female", "en-GB"), v("Some Voice", "en-US")])?.name).toBe("Google UK English Female");
  });

  it("never a novelty voice, and none when nothing is English", () => {
    expect(pickBrowserVoice([v("Zarvox", "en-US"), v("Bad News", "en-US"), v("Karen", "en-AU")])?.name).toBe("Karen");
    expect(pickBrowserVoice([v("Zarvox", "en-US")])).toBeNull();
    expect(pickBrowserVoice([v("Amélie", "fr-CA")])).toBeNull();
    expect(pickBrowserVoice([])).toBeNull();
  });

  it("reads underscores in language tags (Android)", () => {
    expect(pickBrowserVoice([v("English United States", "en_US")])?.name).toBe("English United States");
  });
});

describe("silentWavDataUri", () => {
  it("is a valid little WAV of silence", () => {
    const uri = silentWavDataUri(10, 8000);
    const bytes = Uint8Array.from(atob(uri.split(",")[1]), (c) => c.charCodeAt(0));
    const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
    const view = new DataView(bytes.buffer);
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 12)).toBe("WAVE");
    expect(text(36, 40)).toBe("data");
    expect(view.getUint32(4, true)).toBe(46);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(40, true)).toBe(10);
    expect([...bytes.slice(44)]).toEqual(Array(10).fill(128));
  });
});
