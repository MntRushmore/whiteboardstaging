import { describe, expect, it } from "vitest";
import { LECTURE_LIMITS, LECTURE_TIMING, LectureRequestSchema } from "../contracts";
import { cleanSpeech, countWords, tailChars, TranscriptBuffer } from "../transcript";

const words = (n: number, w = "word") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");

function buffer(...segments: Array<[number, string]>): TranscriptBuffer {
  const t = new TranscriptBuffer();
  for (const [atMs, text] of segments) t.add({ atMs, text });
  return t;
}

describe("countWords", () => {
  it("counts words between spaces, whatever the spacing", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("The mitochondria  make\tATP.")).toBe(4);
    expect(countWords("GDP grew 4% in 1920 — a record")).toBe(8);
  });

  it("scripts without spaces count two characters a word", () => {
    expect(countWords("光合作用发生在叶绿体中")).toBe(6); // 11 characters
    expect(countWords("こんにちは")).toBe(3);
    expect(countWords("DNA 是 遗传物质")).toBe(4); // "DNA" + 是 (1) + 遗传物质 (2)
  });
});

describe("tailChars", () => {
  it("keeps short text as it is (whitespace collapsed)", () => {
    expect(tailChars("  a  b ", 10)).toBe("a b");
    expect(cleanSpeech(" x\n y ")).toBe("x y");
  });

  it("keeps the newest characters, starting at a word", () => {
    const text = "alpha beta gamma delta epsilon";
    const out = tailChars(text, 10); // "ta epsilon": the cut "ta" goes
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out).toBe("epsilon");
    expect(tailChars(text, 14)).toBe("delta epsilon"); // the cut falls on the space
    expect(tailChars(text, 13)).toBe("delta epsilon"); // …or just after it
    expect(tailChars(text, 20)).toBe("gamma delta epsilon");
  });

  it("never drops most of the window for one long word", () => {
    const long = "x".repeat(50);
    expect(tailChars(`${long} end`, 30)).toHaveLength(30);
  });
});

describe("TranscriptBuffer", () => {
  it("textSince: only what is new since a mark (no context)", () => {
    const t = buffer([0, "Before."]);
    const mark = t.mark();
    expect(t.textSince(mark)).toBe("");
    t.add({ atMs: 1, text: "After  one." });
    t.add({ atMs: 2, text: "After two." });
    expect(t.textSince(mark)).toBe("After one. After two.");
    expect(t.textSince(TranscriptBuffer.START)).toBe("Before. After one. After two.");
  });

  it("ignores empty segments and counts words", () => {
    const t = new TranscriptBuffer();
    expect(t.add({ atMs: 0, text: "  " })).toBe(false);
    expect(t.isEmpty).toBe(true);
    expect(t.add({ atMs: 100, text: "Light is absorbed." })).toBe(true);
    expect(t.add({ atMs: 900, text: "Then water is split." })).toBe(true);
    expect(t.totalWords).toBe(7);
    expect(t.lastAtMs).toBe(900);
    expect(t.lastLines(1)).toEqual(["Then water is split."]);
    expect(t.lastLines(5)).toEqual(["Light is absorbed.", "Then water is split."]);
    expect(t.lastLines(0)).toEqual([]);
  });

  it("the director's window: what is new since the mark is fresh, what came before is context", () => {
    const t = buffer([0, "Today: photosynthesis."], [5_000, "It happens in the chloroplast."]);
    expect(t.window(TranscriptBuffer.START)).toEqual({ context: "", fresh: "Today: photosynthesis. It happens in the chloroplast." });
    const mark = t.mark();
    expect(t.wordsSince(mark)).toBe(0);
    expect(t.window(mark)).toEqual({ context: "Today: photosynthesis. It happens in the chloroplast.", fresh: "" });

    t.add({ atMs: 9_000, text: "First, light is absorbed by chlorophyll." });
    expect(t.wordsSince(mark)).toBe(6);
    expect(t.window(mark)).toEqual({
      context: "Today: photosynthesis. It happens in the chloroplast.",
      fresh: "First, light is absorbed by chlorophyll.",
    });
  });

  it("fresh keeps its newest freshChars, context its newest contextChars, both starting at a word", () => {
    const t = new TranscriptBuffer();
    for (let i = 0; i < 60; i++) t.add({ atMs: i * 1000, text: `old${i} ${words(10, "a")}` });
    const mark = t.mark();
    for (let i = 0; i < 60; i++) t.add({ atMs: 60_000 + i * 1000, text: `new${i} ${words(10, "b")}` });
    const w = t.window(mark);
    expect(w.fresh.length).toBeLessThanOrEqual(LECTURE_LIMITS.freshChars);
    expect(w.context.length).toBeLessThanOrEqual(LECTURE_LIMITS.contextChars);
    expect(w.fresh.endsWith("b9")).toBe(true); // the newest words are kept
    expect(w.fresh).toContain("new59");
    expect(w.fresh).not.toContain("old");
    expect(w.context.endsWith("a9")).toBe(true); // context ends where fresh begins
    expect(w.context).toContain("old59");
    expect(w.context).not.toContain("new");
    expect(w.fresh.startsWith(" ")).toBe(false);
    // …and the request the session builds from it is valid
    const req = LectureRequestSchema.safeParse({ boardId: "b", session: "sess_12345678", ...w, screen: { empty: true, room: 1 } });
    expect(req.success).toBe(true);
  });

  it("the forced window is the last minute of speech, measured back from the newest segment", () => {
    const t = buffer([0, "Intro words."], [30_000, "Early point."], [100_000, "Supply rises."], [130_000, "Prices fall."], [150_000, "Demand shifts."]);
    const w = t.forcedWindow(LECTURE_TIMING.forceWindowMs);
    expect(w.fresh).toBe("Supply rises. Prices fall. Demand shifts.");
    expect(w.context).toBe("Intro words. Early point.");
  });

  it("after a long silence the forced window is still the last thing said", () => {
    const t = buffer([0, "A."], [10_000, "B."], [500_000, "The last point."]);
    expect(t.forcedWindow(60_000)).toEqual({ context: "A. B.", fresh: "The last point." });
    expect(new TranscriptBuffer().forcedWindow()).toEqual({ context: "", fresh: "" });
  });

  it("a segment exactly at the window's edge is inside it", () => {
    const t = buffer([0, "edge."], [60_000, "last."]);
    expect(t.forcedWindow(60_000).fresh).toBe("edge. last.");
  });

  it("drops old segments but keeps counting words since a mark", () => {
    const t = new TranscriptBuffer();
    const start = t.mark();
    for (let i = 0; i < 1000; i++) t.add({ atMs: i, text: "two words" });
    expect(t.totalWords).toBe(2000);
    expect(t.wordsSince(start)).toBe(2000);
    // an old mark reads from the oldest segment still kept, within the limits
    const w = t.window(start);
    expect(w.context).toBe("");
    expect(w.fresh.length).toBeLessThanOrEqual(LECTURE_LIMITS.freshChars);
    const mid = t.mark();
    t.add({ atMs: 2000, text: "newest line" });
    expect(t.wordsSince(mid)).toBe(2);
    expect(t.window(mid).fresh).toBe("newest line");
  });
});
