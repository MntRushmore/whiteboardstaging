import { describe, expect, it } from "vitest";
import type { TLShape, TLShapeId, TLShapePartial } from "tldraw";
import { HAND_WRITE, HandWriter, paceFor, planHandwriting, wallMsOf, type HandPlan } from "../handwriting";

/**
 * A long solution is written faster. The engine has the answer in under 0.1 s; at a natural pace
 * the tutor then took 4 s for a typical answer but 16 s at p95 and 26 s for the longest block on
 * the maths scoreboard. Short answers keep their handwriting feel; long ones finish in seconds.
 */

const { naturalUpToMs, maxWallMs, maxPace } = HAND_WRITE.pacing;

describe("paceFor", () => {
  it("leaves a short block at a natural pace", () => {
    expect(paceFor(1500)).toBe(1);
    expect(paceFor(naturalUpToMs)).toBe(1);
  });

  it("writes the time past the natural span three times faster", () => {
    const natural = naturalUpToMs + 3000;
    expect(natural / paceFor(natural)).toBeCloseTo(naturalUpToMs + 1000, 6);
  });

  it("never takes longer than the cap on the wall clock", () => {
    for (const natural of [8000, 12000, 16500, 26500]) {
      expect(natural / paceFor(natural)).toBeLessThanOrEqual(maxWallMs + 1e-6);
    }
  });

  it("never moves the pen faster than the maximum pace (then it may take longer)", () => {
    expect(paceFor(60000)).toBe(maxPace);
    expect(60000 / paceFor(60000)).toBeGreaterThan(maxWallMs);
  });
});

describe("a long worked solution is on the board within seconds", () => {
  const LONG = [
    "3x + 2y = 16",
    "9x + 6y = 48",
    "4x + 6y = 28",
    "5x = 20",
    "x = 4",
    "3(4) + 2y = 16",
    "12 + 2y = 16",
    "2y = 4",
  ];

  it("plans a long block with a pace, and a short one without", () => {
    const long = planHandwriting(LONG, { size: 28, seed: 1 }).plan!;
    expect(long.totalMs).toBeGreaterThan(naturalUpToMs);
    expect(long.pace).toBeGreaterThan(1);
    expect(wallMsOf(long)).toBeLessThanOrEqual(maxWallMs + 1e-6);
    const short = planHandwriting(["x = 4"], { size: 28, seed: 1 }).plan!;
    expect(short.pace).toBe(1);
    expect(wallMsOf(short)).toBe(short.totalMs);
  });

  it("the writer finishes a long block at its wall time, not its natural time", () => {
    const plan: HandPlan = planHandwriting(LONG, { size: 28, seed: 1 }).plan!;
    let clock = 0;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const shapes = new Map<string, TLShape>();
    const writer = new HandWriter(
      {
        write: (fn) => fn(),
        createShapes: (ps: TLShapePartial[]) => ps.forEach((p) => shapes.set(p.id, p as unknown as TLShape)),
        updateShapes: () => undefined,
        getShape: (id: TLShapeId) => shapes.get(id),
      },
      {
        now: () => clock,
        setTimer: (fn, ms) => {
          timers.push({ at: clock + ms, fn });
          return timers.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => undefined,
        reducedMotion: () => false,
      },
    );
    let done = false;
    writer.start(plan, { meta: { live: true, source: "ai", lineId: "l1", createdAt: 0 }, onDone: () => (done = true) });
    const runUntil = (t: number) => {
      while (timers.length && timers[0].at <= t) {
        const next = timers.shift()!;
        clock = next.at;
        next.fn();
      }
      clock = t;
    };
    runUntil(wallMsOf(plan) * 0.5);
    expect(done).toBe(false);
    runUntil(wallMsOf(plan) + 2 * HAND_WRITE.frameMs);
    expect(done).toBe(true);
    // at a natural pace it would still be writing
    expect(wallMsOf(plan) + 2 * HAND_WRITE.frameMs).toBeLessThan(plan.totalMs);
  });
});
