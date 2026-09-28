import { describe, expect, it } from "vitest";
import { cleanSetupReply, cleanSketch, SetupReplySchema, SETUP_SYSTEM_PROMPT } from "../setup";

/** A 10 ft ladder, its foot 6 ft from the wall: the wall is the unknown h (drawn 8 tall). */
const LADDER = {
  points: { A: { x: 0, y: 0 }, B: { x: 0, y: 8 }, C: { x: 6, y: 0 } },
  polygons: [{ vertices: ["A", "B", "C"] }],
  segments: [
    { from: "A", to: "C", label: "6" },
    { from: "B", to: "C", label: "10" },
    { from: "A", to: "B", label: "h" },
  ],
  angles: [{ at: "A", from: "B", to: "C", right: true }],
};

describe("a word problem's sketch", () => {
  it("the prompt asks for one only when the problem describes a picture", () => {
    expect(SETUP_SYSTEM_PROMPT).toContain('"sketch"');
    expect(SETUP_SYSTEM_PROMPT).toMatch(/never its value/);
  });

  it("a figure the drawer passes reaches the board", () => {
    const out = cleanSetupReply(SetupReplySchema.parse({ unknown: "h", lines: ["h^{2} + 6^{2} = 10^{2}"], sketch: LADDER }));
    expect(out.lines).toEqual(["h^{2} + 6^{2} = 10^{2}"]);
    expect(out.sketch?.points.B).toEqual({ x: 0, y: 8 });
    expect(out.sketchDropped).toBeUndefined();
  });

  it("no sketch is fine: the working is all there is", () => {
    const out = cleanSetupReply(SetupReplySchema.parse({ unknown: "x", lines: ["2x + 5 = 17"] }));
    expect(out.sketch).toBeUndefined();
    expect(out.sketchDropped).toBeUndefined();
  });

  it("one the drawer would not pass is left out, and why is kept", () => {
    // drawn out of proportion: the 6 side as long as the 10 side
    const stretched = { ...LADDER, points: { ...LADDER.points, C: { x: 12, y: 0 } } };
    expect(cleanSketch(stretched).sketch).toBeUndefined();
    expect(cleanSketch(stretched).sketchDropped).toMatch(/labelled|drawn/);
    // a word on the board
    const worded = { ...LADDER, segments: [{ from: "A", to: "B", label: "\\text{wall}" }] };
    expect(cleanSketch(worded).sketch).toBeUndefined();
    // not a figure at all
    expect(cleanSketch({ points: "nope" }).sketchDropped).toBeTruthy();
    expect(cleanSketch(undefined)).toEqual({});
  });
});
