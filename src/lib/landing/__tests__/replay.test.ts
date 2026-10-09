import { describe, expect, it } from "vitest";
import { BOARD_LINES, type InkLine } from "../boardInk";
import { pathBounds, REPLAY_TIMING, replayTimeline, stackLines, strokeMs } from "../replay";
import { CHEERS, MISS_WORDS } from "@/lib/live/celebrate";

const line = (over: Partial<InkLine> = {}): InkLine => ({
  latex: "1+1=2",
  width: 100,
  height: 30,
  inkX: 0,
  inkRight: 80,
  kid: [
    { d: "M0 0L10 0", len: 10 },
    { d: "M0 0L0 200", len: 200 },
  ],
  mark: { kind: "tick", stroke: { d: "M90 10L95 20L100 0", len: 30 } },
  ...over,
});

describe("strokeMs", () => {
  it("takes longer for a longer stroke, within bounds", () => {
    expect(strokeMs({ d: "", len: 0 })).toBe(REPLAY_TIMING.minStrokeMs);
    expect(strokeMs({ d: "", len: 50 })).toBe(Math.round(50 * REPLAY_TIMING.msPerUnit));
    expect(strokeMs({ d: "", len: 10_000 })).toBe(REPLAY_TIMING.maxStrokeMs);
  });
});

describe("stackLines", () => {
  it("puts each line under the last, the writing lined up on the left", () => {
    const places = stackLines([line(), line({ height: 50, inkX: 20 }), line()], 10);
    expect(places).toEqual([
      { x: -0, y: 0 },
      { x: -20, y: 40 },
      { x: -0, y: 100 },
    ]);
  });
});

describe("replayTimeline", () => {
  it("writes every stroke in order, one after another, and marks each line after it", () => {
    const { lines, endMs } = replayTimeline([line(), line()], stackLines([line(), line()], 10));
    const all = lines.flatMap((l) => l.strokes);
    for (let i = 1; i < all.length; i++) {
      expect(all[i].delayMs).toBeGreaterThanOrEqual(all[i - 1].delayMs + all[i - 1].durationMs);
    }
    expect(lines.map((l) => l.strokes.map((s) => s.ink))).toEqual([
      ["student", "student", "tutor"],
      ["student", "student", "tutor"],
    ]);
    const last = all.at(-1)!;
    expect(endMs).toBe(last.delayMs + last.durationMs);
    expect(all[0].delayMs).toBe(REPLAY_TIMING.startMs);
  });

  it("says what the board says, in the board's order", () => {
    const { lines } = replayTimeline(BOARD_LINES, stackLines(BOARD_LINES, 30));
    expect(lines.map((l) => l.mark)).toEqual(["tick", "ring", "tick", "tick", "tick"]);
    expect(lines.map((l) => l.cheer.text)).toEqual([CHEERS[0], MISS_WORDS[0], CHEERS[1], CHEERS[2], CHEERS[3]]);
    // three right in a row after the slip
    expect(lines.map((l) => l.cheer.streak)).toEqual([null, null, null, null, "3 in a row!"]);
  });

  it("shows a cheer when its mark is drawn; the try-again stays up", () => {
    const { lines } = replayTimeline(BOARD_LINES, stackLines(BOARD_LINES, 30));
    for (const l of lines) {
      const mark = l.strokes.at(-1)!;
      expect(l.cheer.showMs).toBe(mark.delayMs + mark.durationMs);
      if (l.cheer.tone === "win") expect(l.cheer.hideMs).toBe(l.cheer.showMs + REPLAY_TIMING.cheerMs);
      else expect(l.cheer.hideMs).toBeNull();
    }
  });

  it("is over in about fifteen seconds", () => {
    const { endMs } = replayTimeline(BOARD_LINES, stackLines(BOARD_LINES, 30));
    expect(endMs).toBeGreaterThan(5_000);
    expect(endMs).toBeLessThan(15_000);
  });
});

describe("BOARD_LINES", () => {
  it("is the tutor's real marks: four ticks and one ring, each after its line's writing", () => {
    expect(BOARD_LINES.map((l) => l.mark.kind)).toEqual(["tick", "ring", "tick", "tick", "tick"]);
    for (const l of BOARD_LINES) {
      expect(l.kid.length).toBeGreaterThan(0);
      for (const s of [...l.kid, l.mark.stroke]) expect(s.d).toMatch(/^M-?\d/);
    }
  });
});

describe("pathBounds", () => {
  it("finds the box round a path", () => {
    expect(pathBounds("M90 10L95 20L100 0")).toEqual({ minX: 90, minY: 0, maxX: 100, maxY: 20 });
    expect(pathBounds("M-2.5 4L3 -1")).toEqual({ minX: -2.5, minY: -1, maxX: 3, maxY: 4 });
    expect(pathBounds("")).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});
