import { describe, expect, it } from "vitest";
import { ASK_LIMITS } from "@/lib/live/ask/contracts";
import {
  MAX_BYTES_PER_SECOND,
  MAX_COMPRESSED_BYTES_PER_SECOND,
  SCRIBE_BATCH,
  TranscribeFieldsSchema,
  audioByteCap,
  audioFile,
  audioSeconds,
  billedSeconds,
  cleanTranscript,
  parseScribeReply,
  scribeForm,
  scribeRefusal,
  scribeUnreadable,
  sniffAudio,
  wavSeconds,
} from "../transcribe";

function bytesOf(...parts: Array<string | number[]>): Uint8Array {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p));
  return new Uint8Array(out);
}

/** A WAV header with a `fmt ` and a `data` chunk, plus `extra` chunks before `data`. */
function wavBytes(dataBytes: number, byteRate = 32_000, extra: Uint8Array = new Uint8Array(0)): Uint8Array {
  const head = new Uint8Array(36 + extra.length + 8);
  const v = new DataView(head.buffer);
  head.set(bytesOf("RIFF"), 0);
  head.set(bytesOf("WAVE"), 8);
  head.set(bytesOf("fmt "), 12);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16_000, true);
  v.setUint32(28, byteRate, true);
  head.set(extra, 36);
  head.set(bytesOf("data"), 36 + extra.length);
  v.setUint32(40 + extra.length, dataBytes, true);
  const out = new Uint8Array(head.length + dataBytes);
  out.set(head);
  return out;
}

describe("Ask's speech-to-text request", () => {
  it("Scribe batch, the same model family as lecture mode's realtime one", () => {
    expect(SCRIBE_BATCH.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(SCRIBE_BATCH.model).toBe("scribe_v2");
  });

  it("sniffAudio: the browsers' containers by their bytes, nothing else", () => {
    expect(sniffAudio(bytesOf([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))).toBe("webm");
    expect(sniffAudio(bytesOf([0, 0, 0, 0x20], "ftypM4A "))).toBe("mp4");
    expect(sniffAudio(bytesOf("RIFF", [0, 0, 0, 0], "WAVE"))).toBe("wav");
    expect(sniffAudio(bytesOf("OggS", [0]))).toBe("ogg");
    expect(sniffAudio(bytesOf("ID3", [4, 0]))).toBe("mpeg");
    expect(sniffAudio(bytesOf([0xff, 0xf1, 0x50]))).toBe("mpeg");
    expect(sniffAudio(bytesOf([0x89], "PNG"))).toBeNull();
    expect(sniffAudio(bytesOf("RIFF", [0, 0, 0, 0], "AVI "))).toBeNull();
    expect(sniffAudio(new Uint8Array(0))).toBeNull();
    expect(audioFile("mp4")).toEqual({ type: "audio/mp4", name: "ask.m4a" });
  });

  it("wavSeconds: from the header, past extra chunks, capped by the bytes present", () => {
    expect(wavSeconds(wavBytes(64_000))).toBe(2);
    const list = bytesOf("LIST", [4, 0, 0, 0], "INFO");
    expect(wavSeconds(wavBytes(32_000, 32_000, list))).toBe(1);
    // a streamed WAV's placeholder size: what is there counts
    const streamed = wavBytes(16_000);
    new DataView(streamed.buffer).setUint32(40, 0xffffffff, true);
    expect(wavSeconds(streamed)).toBe(0.5);
    expect(wavSeconds(bytesOf("OggS"))).toBeNull();
  });

  it("audioSeconds: a WAV's own length; else the longer of the client's and the size's", () => {
    expect(audioSeconds("wav", wavBytes(96_000), 1)).toEqual({ seconds: 3, exact: true });
    // a compressed recording at 128 kbit/s (the most the browsers record speech at)
    expect(audioSeconds("webm", new Uint8Array(MAX_COMPRESSED_BYTES_PER_SECOND * 4), 1)).toEqual({ seconds: 4, exact: false });
    expect(audioSeconds("mp4", new Uint8Array(MAX_COMPRESSED_BYTES_PER_SECOND * 4), 1)).toEqual({ seconds: 4, exact: false });
    expect(audioSeconds("webm", new Uint8Array(1_000), 6.5)).toEqual({ seconds: 6.5, exact: false });
    // a WAV whose header cannot say: 16 kHz 16-bit
    expect(audioSeconds("wav", bytesOf("RIFF", [0, 0, 0, 0], "WAVE", new Array(MAX_BYTES_PER_SECOND * 2 - 12).fill(0)), 0)).toEqual({ seconds: 2, exact: false });
  });

  it("audioByteCap: a WAV (its header says its length) up to 4 MB; a compressed recording up to 1.2 MB, over 60 s at 128 kbit/s", () => {
    expect(audioByteCap("wav")).toBe(ASK_LIMITS.audioBytes);
    for (const kind of ["webm", "mp4", "ogg", "mpeg"] as const) expect(audioByteCap(kind)).toBe(ASK_LIMITS.compressedAudioBytes);
    expect(ASK_LIMITS.compressedAudioBytes).toBeLessThan(ASK_LIMITS.audioBytes);
    expect(ASK_LIMITS.compressedAudioBytes).toBeGreaterThan(MAX_COMPRESSED_BYTES_PER_SECOND * ASK_LIMITS.audioSeconds);
  });

  it("billedSeconds: whole seconds, at least one", () => {
    expect(billedSeconds(0)).toBe(1);
    expect(billedSeconds(2)).toBe(2);
    expect(billedSeconds(2.01)).toBe(3);
  });

  it("scribeForm: the file, the model, no sound tags, one speaker, the language when known", () => {
    const form = scribeForm(new Uint8Array([1, 2, 3]), "mp4", "es");
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("tag_audio_events")).toBe("false");
    expect(form.get("diarize")).toBe("false");
    expect(form.get("language_code")).toBe("es");
    expect((form.get("file") as File).name).toBe("ask.m4a");
    expect(scribeForm(new Uint8Array([1]), "webm").get("language_code")).toBeNull();
  });

  it("TranscribeFieldsSchema: the language of a tag, a number of seconds, nothing else", () => {
    expect(TranscribeFieldsSchema.parse({ lang: "en-US", seconds: "3.25" })).toEqual({ lang: "en", seconds: 3.25 });
    expect(TranscribeFieldsSchema.parse({ lang: "zh_Hant_TW" })).toEqual({ lang: "zh" });
    expect(TranscribeFieldsSchema.parse({})).toEqual({});
    expect(TranscribeFieldsSchema.safeParse({ lang: "e" }).success).toBe(false);
    expect(TranscribeFieldsSchema.safeParse({ lang: "en&x=1" }).success).toBe(false);
    expect(TranscribeFieldsSchema.safeParse({ seconds: "-1" }).success).toBe(false);
    expect(TranscribeFieldsSchema.safeParse({ seconds: "NaN" }).success).toBe(false);
    expect(TranscribeFieldsSchema.safeParse({ other: "x" }).success).toBe(false);
  });

  it("parseScribeReply: the words, the language, where the last word ended", () => {
    expect(
      parseScribeReply({
        text: " What is  seven times eight? ",
        language_code: "eng",
        words: [
          { text: "What", end: 0.4, type: "word" },
          { text: " ", type: "spacing" },
          { text: "eight?", end: 1.9, type: "word" },
        ],
      }),
    ).toEqual({ text: "What is seven times eight?", language: "eng", heardSeconds: 1.9 });
    expect(parseScribeReply({ text: "" })).toEqual({ text: "", language: null, heardSeconds: null });
    // the real reply's own length (scribe_v2, 2026-10-11) wins over the last word's end
    expect(parseScribeReply({ text: "What is seven times eight?", language_code: "eng", audio_duration_secs: 1.2435, words: [{ text: "eight?", end: 1.18, type: "word" }] })?.heardSeconds).toBe(1.2435);
    expect(parseScribeReply({ detail: "nope" })).toBeNull();
    expect(parseScribeReply(null)).toBeNull();
  });

  it("cleanTranscript: sound tags go, maths in brackets stays, capped on a word", () => {
    expect(cleanTranscript("(laughs) what is ten minus three [music]")).toBe("what is ten minus three");
    expect(cleanTranscript("is it (2 plus 3) times 4")).toBe("is it (2 plus 3) times 4");
    const long = cleanTranscript("word ".repeat(400));
    expect(long.length).toBeLessThanOrEqual(ASK_LIMITS.message);
    expect(long.endsWith("word")).toBe(true);
  });

  it("scribeRefusal: key and quota refusals; anything else is not one", () => {
    expect(scribeRefusal(401, { detail: { status: "missing_permissions", message: "speech_to_text" } })).toEqual({ kind: "key", detail: "missing_permissions: speech_to_text" });
    expect(scribeRefusal(401, { detail: { status: "quota_exceeded" } })?.kind).toBe("quota");
    expect(scribeRefusal(403, null)).toEqual({ kind: "key", detail: "" });
    expect(scribeRefusal(422, {})).toBeNull();
    expect(scribeRefusal(500, {})).toBeNull();
    expect(scribeUnreadable(422)).toBe(true);
    expect(scribeUnreadable(400)).toBe(true);
    expect(scribeUnreadable(500)).toBe(false);
  });
});
