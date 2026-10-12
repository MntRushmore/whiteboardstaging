import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

import { startRecording } from "../micEngines";

/**
 * The mic is given back on every way a start can fail (`startRecording`): a live track keeps the
 * iPad's mic light on, so a recorder that cannot start must stop the stream it was handed.
 */

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function fakeRecorder(opts: { throwOnCreate?: boolean; throwOnStart?: boolean }) {
  return class {
    static isTypeSupported = () => true;
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: unknown = null;
    onstop: unknown = null;
    onerror: unknown = null;
    constructor() {
      if (opts.throwOnCreate) throw new Error("NotSupportedError");
    }
    start() {
      if (opts.throwOnStart) throw new DOMException("The recorder could not start", "InvalidStateError");
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
    }
  };
}

describe("startRecording: the mic is never left on after a failed start", () => {
  let audioClose: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    audioClose = vi.fn(async () => undefined);
    class FakeAudioContext {
      resume = async () => undefined;
      close = audioClose;
      createAnalyser() {
        return { fftSize: 0, getByteTimeDomainData: () => undefined };
      }
      createMediaStreamSource() {
        return { connect: () => undefined };
      }
    }
    vi.stubGlobal("window", { AudioContext: FakeAudioContext, MediaRecorder: undefined });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const withMic = (stream: MediaStream) => vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPad)", language: "en-US", mediaDevices: { getUserMedia: async () => stream } });

  it("recorder.start throws (iOS, a busy mic): the tracks stop and the audio context closes, and the error comes through", async () => {
    const { stream, track } = fakeStream();
    withMic(stream);
    vi.stubGlobal("MediaRecorder", fakeRecorder({ throwOnStart: true }));
    await expect(startRecording()).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(track.stop).toHaveBeenCalled();
    expect(audioClose).toHaveBeenCalled();
  });

  it("the recorder cannot be made: the same", async () => {
    const { stream, track } = fakeStream();
    withMic(stream);
    vi.stubGlobal("MediaRecorder", fakeRecorder({ throwOnCreate: true }));
    await expect(startRecording()).rejects.toThrow("NotSupportedError");
    expect(track.stop).toHaveBeenCalled();
    expect(audioClose).toHaveBeenCalled();
  });

  it("a start that works keeps the mic until it is finished or cancelled", async () => {
    const { stream, track } = fakeStream();
    withMic(stream);
    vi.stubGlobal("MediaRecorder", fakeRecorder({}));
    const rec = await startRecording();
    expect(track.stop).not.toHaveBeenCalled();
    rec.cancel();
    expect(track.stop).toHaveBeenCalled();
  });
});
