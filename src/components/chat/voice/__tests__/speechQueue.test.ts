import { beforeEach, describe, expect, it } from "vitest";
import { AskSpeechQueue, phraseLimit, type PhraseOutcome, type PhraseSpeaker } from "../speechQueue";

/** The voice: records what it was asked; `end()` finishes the phrase being said. */
class FakeVoice implements PhraseSpeaker {
  said: string[] = [];
  prefetched: string[] = [];
  stops = 0;
  private current: ((o: PhraseOutcome) => void) | null = null;
  speak(words: string): Promise<PhraseOutcome> {
    // a new phrase cancels the one before, like the read aloud speaker
    this.current?.("cancelled");
    this.said.push(words);
    return new Promise((resolve) => (this.current = resolve));
  }
  prefetch(words: string): void {
    this.prefetched.push(words);
  }
  stop(): void {
    this.stops++;
    this.current?.("cancelled");
    this.current = null;
  }
  get speaking(): boolean {
    return this.current !== null;
  }
  end(outcome: PhraseOutcome = "voice"): void {
    const done = this.current;
    this.current = null;
    done?.(outcome);
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

let voice: FakeVoice;
let queue: AskSpeechQueue;

beforeEach(() => {
  voice = new FakeVoice();
  queue = new AskSpeechQueue({ speaker: async () => voice });
});

/** Ends phrases until nothing is being said; returns what was said. */
async function sayAll(): Promise<string[]> {
  await flush();
  for (let i = 0; i < 20 && voice.speaking; i++) {
    voice.end();
    await flush();
  }
  return voice.said;
}

describe("AskSpeechQueue: a reply said as it streams", () => {
  it("says the first sentence as soon as it is whole, before the reply is done", async () => {
    queue.start("r1");
    queue.feed("r1", "Good question");
    await flush();
    expect(voice.said).toEqual([]);
    queue.feed("r1", "! Let's count");
    await flush();
    expect(voice.said).toEqual(["Good question!"]);
  });

  it("the sentences after are gathered into phrases while the first is said, each fetched ahead", async () => {
    queue.start("r1");
    queue.feed("r1", "Nice! ");
    await flush();
    queue.feed("r1", "First add the ones. ");
    await flush();
    // a few words waiting are not yet worth a request while more may join them
    expect(voice.prefetched).toEqual([]);
    queue.feed("r1", "Then add the tens. ");
    await flush();
    expect(voice.prefetched).toEqual(["First add the ones. Then add the tens."]);
    queue.finish("r1", "Nice! First add the ones. Then add the tens. What do you get? Tell me.");
    voice.end();
    await flush();
    // the next one is fetched as soon as this one starts
    expect(voice.prefetched).toEqual(["First add the ones. Then add the tens.", "What do you get? Tell me."]);
    expect(await sayAll()).toEqual(["Nice!", "First add the ones. Then add the tens.", "What do you get? Tell me."]);
  });

  it("phrases grow: the first sentence alone, then up to ~80, ~160 and 240 characters", async () => {
    expect([0, 1, 2, 3, 4, 9].map((n) => phraseLimit(n))).toEqual([0, 80, 160, 240, 240, 240]);
    const reply = Array.from({ length: 24 }, (_, i) => `Step ${i + 1} is short.`).join(" "); // ~17-18 each
    queue.start("r");
    queue.finish("r", reply);
    const said = await sayAll();
    expect(said[0]).toBe("Step 1 is short.");
    expect(said[1].length).toBeLessThanOrEqual(80);
    expect(said[1].length).toBeGreaterThan(50);
    expect(said[2].length).toBeLessThanOrEqual(160);
    expect(said[2].length).toBeGreaterThan(120);
    for (const p of said.slice(3)) expect(p.length).toBeLessThanOrEqual(240);
    expect(said.join(" ")).toBe(reply);
  });

  it("feed takes the whole text so far as well as the new piece", async () => {
    queue.start("a");
    queue.feed("a", "One. ");
    queue.feed("a", "One. Two. ");
    queue.feed("a", " Three.");
    queue.finish("a", "One. Two. Three.");
    expect(await sayAll()).toEqual(["One.", "Two. Three."]);
  });

  it("finish says only what was not said: the streamed tail, never a sentence twice, even cleaned", async () => {
    queue.start("r1");
    queue.feed("r1", "**Great** job. What is $7 \\times 8$? It is");
    await flush();
    queue.finish("r1", "Great job! What is $7 \\times 8$? It is 56.");
    expect(await sayAll()).toEqual(["Great job.", "What is 7 times 8? It is 56."]);
  });

  it("a final text that replaced the stream is said (its new sentences)", async () => {
    queue.start("r1");
    queue.feed("r1", "Let me think. ");
    await flush();
    queue.finish("r1", "Sorry, I couldn't do that one. Try asking again.");
    expect(await sayAll()).toEqual(["Let me think.", "Sorry, I couldn't do that one. Try asking again."]);
  });

  it("maths is said in words; markup, list markers and the board block are not said", async () => {
    queue.start("r1");
    queue.finish("r1", '1. Add $\\frac{1}{2}$ and $\\frac{1}{4}$.\n2. **Write** it down. <board>{"actions":[]}</board>');
    expect(await sayAll()).toEqual(["Add one half and one quarter.", "Write it down."]);
  });

  it("a reply that never streamed (finish alone) is said all the same", async () => {
    queue.finish("solo", "Hi there. Ready?");
    expect(await sayAll()).toEqual(["Hi there.", "Ready?"]);
  });
});

describe("AskSpeechQueue: the ElevenLabs balance", () => {
  it("at most ~700 characters of one reply are said, ending on a sentence", async () => {
    const sentence = "This sentence is exactly sixty characters long, more or less."; // 61
    const reply = Array.from({ length: 20 }, () => sentence).map((s, i) => s.replace("This", `Line ${i}`)).join(" ");
    queue.start("long");
    queue.finish("long", reply);
    const said = await sayAll();
    const chars = said.reduce((n, p) => n + p.length, 0);
    expect(chars).toBeLessThanOrEqual(700);
    expect(chars).toBeGreaterThan(600);
    for (const p of said) {
      expect(p.length).toBeLessThanOrEqual(240);
      expect(p.endsWith(".")).toBe(true);
    }
    expect(queue.waiting).toEqual([]);
  });

  it("streamed text is never sent twice: each sentence once, across feed and finish", async () => {
    queue.start("r");
    const reply = "One. Two. Three. Four. Five.";
    for (let i = 1; i <= reply.length; i++) queue.feed("r", reply.slice(0, i));
    queue.finish("r", reply);
    const said = await sayAll();
    expect(said.join(" ")).toBe("One. Two. Three. Four. Five.");
    const prefetchedNotSaid = voice.prefetched.filter((p) => !said.includes(p));
    expect(prefetchedNotSaid).toEqual([]);
  });

  it("a very long sentence is cut where a voice can breathe, each piece a phrase", async () => {
    queue.start("r");
    queue.finish("r", `${"we add the ones, then the tens, ".repeat(12)}and that is all.`);
    const said = await sayAll();
    expect(said.length).toBeGreaterThan(1);
    for (const p of said) expect(p.length).toBeLessThanOrEqual(240);
  });
});

describe("AskSpeechQueue: stopping", () => {
  it("a new reply stops the one being said; the old reply's late pieces are ignored", async () => {
    queue.start("old");
    queue.feed("old", "This is the old one. ");
    await flush();
    expect(voice.speaking).toBe(true);
    queue.start("new");
    expect(voice.stops).toBe(1);
    expect(voice.speaking).toBe(false);
    queue.feed("old", "More old words. ");
    queue.finish("old", "This is the old one. More old words.");
    queue.finish("new", "And the new one.");
    expect(await sayAll()).toEqual(["This is the old one.", "And the new one."]);
  });

  it("stop silences it, and a late finish of that reply is not said after all", async () => {
    queue.start("r");
    queue.feed("r", "First. Second. ");
    await flush();
    queue.stop();
    expect(voice.stops).toBe(1);
    queue.finish("r", "First. Second. Third.");
    expect(await sayAll()).toEqual(["First."]);
  });

  it("cut short by another voice (or blocked, or failed): the rest of that reply is dropped", async () => {
    for (const outcome of ["cancelled", "blocked", "failed"] as const) {
      voice = new FakeVoice();
      queue = new AskSpeechQueue({ speaker: async () => voice });
      queue.start("r");
      queue.finish("r", "First. Second. Third.");
      await flush();
      voice.end(outcome);
      await flush();
      expect(voice.said).toEqual(["First."]);
      expect(queue.waiting).toEqual([]);
    }
  });

  it("the browser's voice saying it goes on to the next phrase", async () => {
    queue.start("r");
    queue.finish("r", "First. Second.");
    await flush();
    voice.end("browser");
    await flush();
    expect(voice.said).toEqual(["First.", "Second."]);
  });
});

describe("AskSpeechQueue: read aloud off, and replay", () => {
  it("off: nothing is said, and switching on mid-reply goes on from the next sentence", async () => {
    queue.setEnabled(false);
    queue.start("r");
    queue.feed("r", "Already on the screen. ");
    await flush();
    expect(voice.said).toEqual([]);
    queue.setEnabled(true);
    queue.feed("r", "Said from here. ");
    queue.finish("r", "Already on the screen. Said from here. And this.");
    expect(await sayAll()).toEqual(["Said from here.", "And this."]);
  });

  it("switching off stops what is being said", async () => {
    queue.start("r");
    queue.finish("r", "First. Second.");
    await flush();
    queue.setEnabled(false);
    expect(voice.stops).toBe(1);
    await flush();
    expect(voice.said).toEqual(["First."]);
  });

  it("replay says one message again, whatever the setting, from its start", async () => {
    queue.setEnabled(false);
    queue.replay("Seven times eight is $56$. Well done!");
    expect(await sayAll()).toEqual(["Seven times eight is 56.", "Well done!"]);
    queue.replay("Seven times eight is $56$. Well done!");
    expect(await sayAll()).toEqual(["Seven times eight is 56.", "Well done!", "Seven times eight is 56.", "Well done!"]);
  });

  it("a voice that failed to load says nothing and tries again next time", async () => {
    let fail = true;
    queue = new AskSpeechQueue({
      speaker: async () => {
        if (fail) throw new Error("chunk load failed");
        return voice;
      },
    });
    queue.start("a");
    queue.finish("a", "Hello.");
    await flush();
    expect(voice.said).toEqual([]);
    fail = false;
    queue.start("b");
    queue.finish("b", "Hello again.");
    expect(await sayAll()).toEqual(["Hello again."]);
  });
});
