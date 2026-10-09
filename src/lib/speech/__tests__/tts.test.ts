import { describe, expect, it } from "vitest";
import { SPEAK_MAX_CHARS } from "../contracts";
import { SpeakRequestSchema, TTS, ttsBody, ttsRefusal, ttsUrl, voiceIdOr } from "../tts";

describe("read aloud's ElevenLabs request", () => {
  it("the natural low-latency model, MP3, English", () => {
    expect(TTS.model).toBe("eleven_v4_turbo");
    expect(ttsUrl("abcDEF0123456789wxyz")).toBe("https://api.elevenlabs.io/v1/text-to-speech/abcDEF0123456789wxyz/stream?output_format=mp3_44100_64");
    expect(ttsBody("Hello")).toEqual({ text: "Hello", model_id: "eleven_v4_turbo", language_code: "en", voice_settings: TTS.voiceSettings });
  });

  it("voiceIdOr: the configured voice when it looks like one, else the default", () => {
    expect(voiceIdOr(undefined)).toEqual({ voiceId: TTS.defaultVoiceId, ignored: false });
    expect(voiceIdOr("  ")).toEqual({ voiceId: TTS.defaultVoiceId, ignored: false });
    expect(voiceIdOr("EXAVITQu4vr4xnSDxMaL")).toEqual({ voiceId: "EXAVITQu4vr4xnSDxMaL", ignored: false });
    expect(voiceIdOr("../secrets")).toEqual({ voiceId: TTS.defaultVoiceId, ignored: true });
    expect(voiceIdOr("abc")).toEqual({ voiceId: TTS.defaultVoiceId, ignored: true });
  });

  it("ttsRefusal: key, quota and voice refusals; anything else is an upstream error", () => {
    expect(ttsRefusal(401, { detail: { status: "missing_permissions", message: "missing the permission text_to_speech" } })).toEqual({
      kind: "key",
      detail: "missing_permissions: missing the permission text_to_speech",
    });
    expect(ttsRefusal(401, { detail: { status: "quota_exceeded", message: "quota" } })?.kind).toBe("quota");
    expect(ttsRefusal(403, null)).toEqual({ kind: "key", detail: "" });
    expect(ttsRefusal(404, { detail: { status: "voice_not_found" } })?.kind).toBe("voice");
    expect(ttsRefusal(400, { detail: "A voice with that id does not exist" })?.kind).toBe("voice");
    expect(ttsRefusal(400, { detail: "bad text" })).toBeNull();
    expect(ttsRefusal(429, {})).toBeNull();
    expect(ttsRefusal(500, "oops")).toBeNull();
  });

  it("SpeakRequestSchema: plain text, trimmed, at most SPEAK_MAX_CHARS, nothing else", () => {
    expect(SpeakRequestSchema.parse({ text: "  Hi  " })).toEqual({ text: "Hi" });
    expect(SpeakRequestSchema.safeParse({ text: "" }).success).toBe(false);
    expect(SpeakRequestSchema.safeParse({ text: "x".repeat(SPEAK_MAX_CHARS + 1) }).success).toBe(false);
    expect(SpeakRequestSchema.safeParse({ text: "x".repeat(SPEAK_MAX_CHARS) }).success).toBe(true);
    expect(SpeakRequestSchema.safeParse({ text: "a\u0000b" }).success).toBe(false);
    expect(SpeakRequestSchema.safeParse({ text: "line one\nline two" }).success).toBe(true);
    expect(SpeakRequestSchema.safeParse({ text: "hi", extra: 1 }).success).toBe(false);
  });
});
