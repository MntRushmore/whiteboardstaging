import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHEERS, celebrate, INITIAL_CELEBRATE, inkExtendsLine, MarkSettler, markLine, MISS_SETTLE_MS, MISS_WORDS, SETTLE_MS, STREAK_FROM, streakText, type CelebrateState } from "../celebrate";

function run(marks: Array<[string, "check" | "circle"]>) {
  let state: CelebrateState = INITIAL_CELEBRATE;
  const cheers = marks.map(([line, kind]) => {
    const out = celebrate(state, line, kind);
    state = out.state;
    return out.cheer;
  });
  return { state, cheers };
}

describe("celebrate", () => {
  it("cheers a tick with a small burst, a different word each time", () => {
    const { cheers } = run([
      ["a", "check"],
      ["b", "check"],
    ]);
    expect(cheers[0]).toEqual({ tone: "win", text: CHEERS[0], streak: 1, burst: "small" });
    expect(cheers[1]).toMatchObject({ tone: "win", text: CHEERS[1], streak: 2 });
  });

  it("says nothing when the same line gets the same mark again (the tutor redrew it)", () => {
    const { state, cheers } = run([
      ["a", "check"],
      ["a", "check"],
    ]);
    expect(cheers[1]).toBeNull();
    expect(state.streak).toBe(1);
  });

  it("a ring gets a kind word and ends the streak; fixing the line cheers again", () => {
    const { state, cheers } = run([
      ["a", "check"],
      ["b", "check"],
      ["c", "circle"],
      ["c", "check"],
    ]);
    expect(cheers[2]).toEqual({ tone: "miss", text: MISS_WORDS[0] });
    expect(cheers[3]).toMatchObject({ tone: "win", streak: 1 });
    expect(state.streak).toBe(1);
  });

  it("counts the streak from three, with a big burst on the milestones", () => {
    const lines = Array.from({ length: 10 }, (_, i) => [`l${i}`, "check"] as [string, "check"]);
    const { cheers } = run(lines);
    expect(cheers[STREAK_FROM - 1]).toMatchObject({ streak: STREAK_FROM, burst: "small" });
    expect(cheers[4]).toMatchObject({ streak: 5, burst: "big" });
    expect(cheers[9]).toMatchObject({ streak: 10, burst: "big" });
    expect(streakText(5)).toBe("5 in a row!");
  });

  it("does not change the state it is given", () => {
    const before = structuredClone(INITIAL_CELEBRATE);
    celebrate(INITIAL_CELEBRATE, "a", "check");
    expect(INITIAL_CELEBRATE).toEqual(before);
  });
});

/**
 * A student lifts the pen mid-line (before the last stroke of the 12 in `2x = 12`): the half line
 * is read as `2x = 1` and ringed, then finished and ticked about 1.3 s later. The ring must not
 * say "So close!" or reset the streak (found by the film session).
 */
describe("MarkSettler: when a mark counts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** the verdicts that came out of the marks and strokes fed in */
  function settler() {
    const verdicts: Array<[string, string]> = [];
    const s = new MarkSettler((lineId, kind) => verdicts.push([lineId, kind]));
    return { s, verdicts };
  }
  // `markKey` of a line at (100, 200), 160 x 40 px: 4 px units
  const RING = "circle:25,50,40,10";
  const TICK = "check:25,50,40,10";

  it("a tick counts after a moment; a ring only after the line has stood for MISS_SETTLE_MS", () => {
    const { s, verdicts } = settler();
    s.mark("a", "check", TICK);
    vi.advanceTimersByTime(SETTLE_MS + 1);
    expect(verdicts).toEqual([["a", "check"]]);
    s.mark("b", "circle", RING);
    vi.advanceTimersByTime(SETTLE_MS + 1);
    expect(verdicts).toHaveLength(1);
    vi.advanceTimersByTime(MISS_SETTLE_MS);
    expect(verdicts).toEqual([
      ["a", "check"],
      ["b", "circle"],
    ]);
  });

  it("a pause mid-line: the ring is dropped when the finished line is ticked — only the tick counts", () => {
    const { s, verdicts } = settler();
    s.mark("l2", "circle", RING); // `2x = 1`, ringed during the pause
    vi.advanceTimersByTime(1600); // she finishes the 12; it is read again and ticked ~1.3 s on
    s.markRemoved("l2", "circle");
    s.mark("l2", "check", TICK);
    vi.advanceTimersByTime(MISS_SETTLE_MS + 1);
    expect(verdicts).toEqual([["l2", "check"]]);
  });

  it("new ink on the ringed line (its right end) drops the waiting ring; ink on the next line does not", () => {
    const { s, verdicts } = settler();
    s.mark("l2", "circle", RING);
    // a stroke under it, on the next line: the ring stands...
    s.ink({ x: 100, y: 270, w: 30, h: 40 });
    // ...the last stroke of the 12, just past its right end: it goes
    s.ink({ x: 268, y: 202, w: 14, h: 38 });
    vi.advanceTimersByTime(MISS_SETTLE_MS + 1);
    expect(verdicts).toEqual([]);

    s.mark("l3", "circle", RING);
    s.ink({ x: 100, y: 270, w: 30, h: 40 });
    vi.advanceTimersByTime(MISS_SETTLE_MS + 1);
    expect(verdicts).toEqual([["l3", "circle"]]);
  });

  it("the streak survives a pause: the ring is dropped and the tick continues it", () => {
    const { s, verdicts } = settler();
    let state = INITIAL_CELEBRATE;
    const feed = () => {
      for (const [line, kind] of verdicts.splice(0)) state = celebrate(state, line, kind as "check" | "circle").state;
    };
    for (const line of ["a", "b"]) {
      s.mark(line, "check", TICK);
      vi.advanceTimersByTime(SETTLE_MS + 1);
    }
    feed();
    s.mark("c", "circle", RING);
    vi.advanceTimersByTime(1000);
    s.ink({ x: 268, y: 202, w: 14, h: 38 });
    s.mark("c", "check", TICK);
    vi.advanceTimersByTime(MISS_SETTLE_MS + 1);
    feed();
    expect(state.streak).toBe(3);
    expect(state.misses).toBe(0);
  });

  it("reads the line back from a mark's key", () => {
    expect(markLine(RING)).toEqual({ x: 100, y: 200, w: 160, h: 40 });
    expect(markLine("circle:nope")).toBeNull();
    expect(inkExtendsLine({ x: 268, y: 202, w: 14, h: 38 }, { x: 100, y: 200, w: 160, h: 40 })).toBe(true);
    expect(inkExtendsLine({ x: 400, y: 202, w: 14, h: 38 }, { x: 100, y: 200, w: 160, h: 40 })).toBe(false);
  });
});
