import { describe, expect, it } from "vitest";
import { canRecordVideo, fitInside, pickVideoFormat, planVideo, VIDEO, videoFileName, videoSize } from "../video";

describe("planVideo", () => {
  it("plays a long lesson fast enough to last about the target", () => {
    const plan = planVideo(300_000, { fps: 20, targetMs: 15_000 });
    expect(plan.speed).toBe(20);
    expect(plan.times).toHaveLength(300);
    expect(plan.times[plan.times.length - 1]).toBe(300_000);
    // in order, evenly spaced on the replay's clock
    expect(plan.times[1] - plan.times[0]).toBeCloseTo(1000);
    expect(plan.durationMs).toBe(15_000 + VIDEO.holdMs + VIDEO.endCardMs);
  });

  it("never stretches a short replay: 1x at least", () => {
    const plan = planVideo(4_000, { fps: 20, targetMs: 15_000 });
    expect(plan.speed).toBe(1);
    expect(plan.times).toHaveLength(80);
    expect(plan.times[plan.times.length - 1]).toBe(4_000);
  });

  it("has a frame, a hold and an end card even for an empty replay", () => {
    const plan = planVideo(0);
    expect(plan.times).toEqual([0]);
    expect(plan.holdFrames).toBeGreaterThan(0);
    expect(plan.endFrames).toBeGreaterThan(0);
    expect(planVideo(Number.NaN).times).toEqual([0]);
  });
});

describe("videoSize", () => {
  it("picks the frame closest to the ink's shape", () => {
    expect(videoSize(0.6)).toEqual({ width: 1080, height: 1350 });
    expect(videoSize(1.05)).toEqual({ width: 1080, height: 1080 });
    expect(videoSize(2.2)).toEqual({ width: 1280, height: 720 });
    expect(videoSize(0)).toEqual({ width: 1080, height: 1350 });
  });
});

describe("fitInside", () => {
  it("scales a picture into a box, centred", () => {
    expect(fitInside(200, 100, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(fitInside(50, 100, { x: 10, y: 10, w: 100, h: 100 })).toEqual({ x: 35, y: 10, w: 50, h: 100 });
  });
});

describe("pickVideoFormat", () => {
  it("prefers MP4, falls back to WebM, and says when there is none", () => {
    expect(pickVideoFormat(() => true)?.extension).toBe("mp4");
    expect(pickVideoFormat((t) => t.startsWith("video/webm"))).toEqual({ mimeType: "video/webm;codecs=vp9", extension: "webm" });
    expect(pickVideoFormat(() => false)).toBeNull();
    expect(
      pickVideoFormat(() => {
        throw new Error("no");
      }),
    ).toBeNull();
  });

  it("cannot record where there is no MediaRecorder (the server, the tests)", () => {
    expect(canRecordVideo()).toBe(false);
  });

  it("names the file without the student's name", () => {
    expect(videoFileName("2026-10-09", "mp4")).toBe("agathon-replay-2026-10-09.mp4");
  });
});
