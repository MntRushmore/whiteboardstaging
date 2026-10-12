import { describe, expect, it } from "vitest";
import { ASK_VOICE_COPY } from "../copy";
import {
  MIC,
  chooseEngine,
  micErrorProblem,
  pickRecorderType,
  prefersMp4,
  pressKind,
  problemWords,
  recognizerErrorProblem,
  recognizerLang,
  recognizerText,
  recordingName,
  secondsLeft,
  speechLang,
  transcribeOutcome,
} from "../micLogic";

const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";

describe("the recorder's format", () => {
  it("Safari and every iPad/iPhone browser record MP4; Chrome and Edge WebM", () => {
    expect(prefersMp4(SAFARI_MAC)).toBe(true);
    expect(prefersMp4(IPAD)).toBe(true);
    expect(prefersMp4(CHROME_IOS)).toBe(true);
    expect(prefersMp4(CHROME_MAC)).toBe(false);
    expect(prefersMp4(EDGE)).toBe(false);
  });

  it("the best type the browser supports, in that order", () => {
    const supports = (types: string[]) => (t: string) => types.includes(t);
    expect(pickRecorderType(supports(["audio/webm;codecs=opus", "audio/mp4"]), false)).toBe("audio/webm;codecs=opus");
    expect(pickRecorderType(supports(["audio/webm;codecs=opus", "audio/mp4"]), true)).toBe("audio/mp4");
    expect(pickRecorderType(supports(["audio/mp4"]), false)).toBe("audio/mp4");
    expect(pickRecorderType(supports(["audio/ogg;codecs=opus"]), false)).toBe("audio/ogg;codecs=opus");
    // none known: the browser picks; no recorder at all: null
    expect(pickRecorderType(() => false, false)).toBe("");
    expect(
      pickRecorderType(() => {
        throw new Error("old browser");
      }, true),
    ).toBe("");
    expect(pickRecorderType(null, false)).toBeNull();
  });

  it("the file name follows the type", () => {
    expect(recordingName("audio/mp4")).toBe("ask.m4a");
    expect(recordingName("audio/webm;codecs=opus")).toBe("ask.webm");
    expect(recordingName("audio/ogg")).toBe("ask.ogg");
    expect(recordingName("")).toBe("ask.webm");
  });

  it("a recording is ~240 KB a minute: well inside the route's 4 MB", () => {
    expect((MIC.bitsPerSecond / 8) * (MIC.maxMs / 1000)).toBeLessThan(4_000_000 / 10);
  });
});

describe("hold or tap, and the minute", () => {
  it("held at least MIC.holdMs is hold-to-talk; shorter is a tap", () => {
    expect(pressKind(1_000, 1_000 + MIC.holdMs)).toBe("hold");
    expect(pressKind(1_000, 1_000 + MIC.holdMs - 1)).toBe("tap");
    expect(pressKind(0, 5_000)).toBe("hold");
  });

  it("the last ten seconds are counted down", () => {
    expect(secondsLeft(0)).toBeNull();
    expect(secondsLeft(MIC.maxMs - MIC.countdownMs - 1)).toBeNull();
    expect(secondsLeft(MIC.maxMs - 10_000)).toBe(10);
    expect(secondsLeft(MIC.maxMs - 2_500)).toBe(3);
    expect(secondsLeft(MIC.maxMs + 500)).toBe(0);
    expect(MIC.maxMs).toBe(60_000);
  });
});

describe("which way to hear", () => {
  it("record for the route; the browser's recognizer when the route is resting or there is no recorder", () => {
    expect(chooseEngine({ recorder: true, recognizer: true }, false)).toBe("recorder");
    expect(chooseEngine({ recorder: true, recognizer: true }, true)).toBe("browser");
    expect(chooseEngine({ recorder: false, recognizer: true }, false)).toBe("browser");
    // nothing else to try: the route may be back
    expect(chooseEngine({ recorder: true, recognizer: false }, true)).toBe("recorder");
    expect(chooseEngine({ recorder: false, recognizer: false }, false)).toBeNull();
  });

  it("the language: Scribe gets the browser's language, the recognizer its tag; English when unsure", () => {
    expect(speechLang("en-US")).toBe("en");
    expect(speechLang("es-419")).toBe("es");
    expect(speechLang(undefined)).toBe("en");
    expect(speechLang("??")).toBe("en");
    expect(recognizerLang("en-GB")).toBe("en-GB");
    expect(recognizerLang("")).toBe("en-US");
    expect(recognizerLang(null)).toBe("en-US");
  });
});

describe("the route's answer", () => {
  it("words, nothing heard, the browser's recognizer, wait, or an error", () => {
    expect(transcribeOutcome(200, { text: " seven times eight ", source: "elevenlabs" })).toEqual({ kind: "text", text: "seven times eight" });
    expect(transcribeOutcome(200, { text: "", source: "none" })).toEqual({ kind: "nothing" });
    expect(transcribeOutcome(200, { nope: 1 })).toEqual({ kind: "error" });
    expect(transcribeOutcome(503, { error: "speech_unavailable", message: "x" })).toEqual({ kind: "fallback" });
    expect(transcribeOutcome(503, { error: "upstream_error" })).toEqual({ kind: "error" });
    expect(transcribeOutcome(429, { error: "rate_limited", retryAfterMs: 4_000 })).toEqual({ kind: "limited", retryAfterMs: 4_000 });
    expect(transcribeOutcome(429, null)).toEqual({ kind: "limited" });
    expect(transcribeOutcome(502, null)).toEqual({ kind: "error" });
    expect(transcribeOutcome(413, { error: "invalid_request" })).toEqual({ kind: "error" });
  });

  it("the recognizer's results: its final words, else what it was still hearing", () => {
    expect(recognizerText(["what is", " seven times eight"], "")).toBe("what is seven times eight");
    expect(recognizerText([], " seven times ")).toBe("seven times");
    expect(recognizerText([" "], "")).toBe("");
  });
});

describe("what a kid is told", () => {
  it("a refused mic: a calm line, and one for the grown-up", () => {
    for (const name of ["NotAllowedError", "SecurityError", "PermissionDeniedError"]) expect(micErrorProblem({ name })).toBe("denied");
    expect(micErrorProblem({ name: "NotFoundError" })).toBe("no-mic");
    expect(micErrorProblem({ name: "NotReadableError" })).toBe("busy");
    expect(micErrorProblem({ name: "NotSupportedError" })).toBe("unsupported");
    expect(micErrorProblem(new Error("??"))).toBe("error");
    expect(micErrorProblem(null)).toBe("error");
    expect(problemWords("denied")).toEqual({ kid: ASK_VOICE_COPY.denied, grownUp: ASK_VOICE_COPY.deniedHint });
    expect(problemWords("no-mic").grownUp).toMatch(/^Grown-up:/);
    expect(problemWords("nothing")).toEqual({ kid: ASK_VOICE_COPY.nothing });
  });

  it("the recognizer's errors the same way; an abort is no problem", () => {
    expect(recognizerErrorProblem("not-allowed")).toBe("denied");
    expect(recognizerErrorProblem("service-not-allowed")).toBe("denied");
    expect(recognizerErrorProblem("audio-capture")).toBe("no-mic");
    expect(recognizerErrorProblem("no-speech")).toBe("nothing");
    expect(recognizerErrorProblem("network")).toBe("error");
    expect(recognizerErrorProblem("aborted")).toBeNull();
  });

  it("every line is short enough for a 7-year-old's bubble", () => {
    for (const p of ["denied", "no-mic", "busy", "unsupported", "nothing", "again", "error", "limited"] as const) {
      expect(problemWords(p).kid.length).toBeLessThanOrEqual(60);
    }
  });
});
