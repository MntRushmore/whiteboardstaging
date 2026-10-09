/**
 * "Save video"'s real-time clock (src/components/replay/recordPacer.ts): frames on time, the
 * recorder paused while the page is hidden and resumed where it left off, and a recorder that cannot
 * pause stopping the video rather than handing over a spoiled one. A fake recorder, document and
 * clock; no DOM.
 */
import { describe, expect, it } from "vitest";
import { createRecordPacer, RecordingInterruptedError, type PausableRecorder, type VisibilitySource } from "../recordPacer";

const FRAME = 50;

function setup(over: { pauseThrows?: boolean } = {}) {
  let t = 1000;
  const calls: string[] = [];
  const recorder: PausableRecorder & { state: PausableRecorder["state"] } = {
    state: "recording",
    pause() {
      calls.push("pause");
      if (over.pauseThrows) throw new Error("not supported");
      this.state = "paused";
    },
    resume() {
      calls.push("resume");
      this.state = "recording";
    },
  };
  const listeners = new Set<() => void>();
  const doc: VisibilitySource & { hidden: boolean } = {
    hidden: false,
    addEventListener: (_type, fn) => void listeners.add(fn),
    removeEventListener: (_type, fn) => void listeners.delete(fn),
  };
  const setHidden = (hidden: boolean) => {
    doc.hidden = hidden;
    for (const fn of [...listeners]) fn();
  };
  const pacer = createRecordPacer({ recorder, doc, frameMs: FRAME, now: () => t });
  return {
    pacer,
    recorder,
    calls,
    listeners,
    setHidden,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const settled = async <T>(p: Promise<T>) => {
  let done = false;
  void p.then(() => (done = true), () => (done = true));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return done;
};

describe("createRecordPacer", () => {
  it("spaces frames by the frame time while the page stays visible", async () => {
    const s = setup();
    s.pacer.start();
    await s.pacer.beforeFrame();
    s.advance(10); // painting took 10 ms
    expect(s.pacer.waitAfter(0)).toBe(40);
    s.advance(40);
    await s.pacer.beforeFrame();
    s.advance(5);
    expect(s.pacer.waitAfter(1)).toBe(45);
    expect(s.calls).toEqual([]);
  });

  it("pauses the recorder the moment the page is hidden, waits, then resumes on the same frame", async () => {
    const s = setup();
    s.pacer.start();
    await s.pacer.beforeFrame();
    s.advance(10);
    expect(s.pacer.waitAfter(0)).toBe(40);
    // hidden during the sleep: the recorder pauses at once, not when the loop wakes
    s.setHidden(true);
    expect(s.calls).toEqual(["pause"]);
    s.advance(1000); // a throttled timer wakes the loop a second later
    const next = s.pacer.beforeFrame();
    expect(await settled(next)).toBe(false); // still hidden: frame 1 waits
    s.advance(30_000);
    s.setHidden(false);
    await next;
    expect(s.calls).toEqual(["pause", "resume"]);
    expect(s.recorder.state).toBe("recording");
    // the clock skipped the 31 s away: frame 1 is not 31 s late, so nothing is rushed out (frame 2
    // is due a frame after frame 1's turn on the moved clock, which frame 0's cut-short turn shifts)
    s.advance(5);
    expect(s.pacer.waitAfter(1)).toBe(85);
    s.advance(85);
    await s.pacer.beforeFrame();
    expect(s.pacer.waitAfter(2)).toBe(50);
  });

  it("back before the loop woke: no wait, but the recorder resumes and the clock skips the time away", async () => {
    const s = setup();
    s.pacer.start();
    await s.pacer.beforeFrame();
    s.setHidden(true);
    s.advance(400);
    s.setHidden(false);
    s.advance(600);
    await s.pacer.beforeFrame();
    expect(s.calls).toEqual(["pause", "resume"]);
    expect(s.pacer.waitAfter(0)).toBe(50);
  });

  it("starts paused when the page is already hidden as recording begins (the drawing pass ran in the background)", async () => {
    const s = setup();
    s.setHidden(true);
    s.pacer.start();
    expect(s.calls).toEqual(["pause"]);
    const first = s.pacer.beforeFrame();
    expect(await settled(first)).toBe(false);
    s.setHidden(false);
    await first;
    expect(s.calls).toEqual(["pause", "resume"]);
  });

  it("stops with RecordingInterruptedError when the recorder cannot pause", async () => {
    const s = setup({ pauseThrows: true });
    s.pacer.start();
    s.setHidden(true);
    await expect(s.pacer.beforeFrame()).rejects.toBeInstanceOf(RecordingInterruptedError);
  });

  it("stops waiting when the video is cancelled", async () => {
    const s = setup();
    const abort = new AbortController();
    s.pacer.start();
    s.setHidden(true);
    const next = s.pacer.beforeFrame(abort.signal);
    expect(await settled(next)).toBe(false);
    abort.abort();
    await next;
    expect(s.calls).toEqual(["pause"]);
  });

  it("moves on after a stall the page did not report, rather than rushing frames out", () => {
    const s = setup();
    s.pacer.start();
    s.advance(20);
    expect(s.pacer.waitAfter(0)).toBe(30);
    s.advance(30 + 500); // a 500 ms stall
    expect(s.pacer.waitAfter(1)).toBe(0);
    // the next frame is a frame's time later, not due at once
    s.advance(5);
    expect(s.pacer.waitAfter(2)).toBe(45);
    // a small lag is caught up as usual: the late frame goes at once, the next one on time
    s.advance(45 + 60);
    expect(s.pacer.waitAfter(3)).toBe(0);
    expect(s.pacer.waitAfter(4)).toBe(40);
  });

  it("stops watching the page when disposed", () => {
    const s = setup();
    s.pacer.start();
    expect(s.listeners.size).toBe(1);
    s.pacer.dispose();
    expect(s.listeners.size).toBe(0);
  });
});
