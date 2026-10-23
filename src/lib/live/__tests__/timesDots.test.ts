import { describe, expect, it } from "vitest";
import type { InkStroke } from "../contracts";
import { layoutMath } from "@/lib/hand";
import { inkTimesDots, readVariants, timesDotVariant, withTrailingTimesDot } from "../youngHand";

/**
 * A raised multiplication dot (SAT v2 end-to-end run, 2026-10-23): a student's `A = 6 · 9`, in the
 * hand engine's ink, came back from Mathpix as `A = 6.9` and the right step was ringed; `h = 94 ·`,
 * still being written, came back `h = 94` and was judged. The ink shows which dot is which.
 */
function ink(latex: string): InkStroke[] {
  const layout = layoutMath(latex, { size: 44, seed: 1 });
  return layout.strokes.map((st, i) => {
    const pts = st.points.map((p) => ({ x: 140 + p.x * 1.36, y: 620 + p.y * 1.36 }));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { id: `shape:t${i}` as InkStroke["id"], bounds: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, segments: [pts] };
  });
}

describe("inkTimesDots", () => {
  it("a raised dot between digits is a times dot; a decimal point on the line is not", () => {
    expect(inkTimesDots(ink("A=6\\cdot9"))).toEqual({ between: 1, trailing: false });
    expect(inkTimesDots(ink("A=6.9"))).toEqual({ between: 0, trailing: false });
    expect(inkTimesDots(ink("A=\\frac{1}{2}\\cdot12\\cdot9"))).toEqual({ between: 2, trailing: false });
  });
  it("a raised dot after all the writing: the line goes on; a full stop or an i's dot does not", () => {
    expect(inkTimesDots(ink("h=94\\cdot")).trailing).toBe(true);
    expect(inkTimesDots(ink("A=\\frac{1}{2}\\cdot")).trailing).toBe(true);
    expect(inkTimesDots(ink("x=5.")).trailing).toBe(false);
    expect(inkTimesDots(ink("i=3"))).toEqual({ between: 0, trailing: false });
  });
});

describe("the reads put right", () => {
  it("a decimal point read where the ink has a raised dot is a variant with \\cdot", () => {
    expect(readVariants("A=6.9", false, [], 1)).toContain("A=6 \\cdot 9");
    expect(readVariants("A=6.9", false, [], 0)).not.toContain("A=6 \\cdot 9");
    // which of two points is the dot is unknown: no variant
    expect(timesDotVariant("2.5.4=10", 1)).toBeNull();
    // a number the work is about is never split
    expect(readVariants("A=6.9", false, ["6.9 + 1"], 1)).not.toContain("A=6 \\cdot 9");
  });
  it("a trailing raised dot Mathpix dropped keeps the line unfinished", () => {
    expect(withTrailingTimesDot("h = 94", true)).toBe("h = 94 \\cdot");
    expect(withTrailingTimesDot("h = 94 \\cdot", true)).toBe("h = 94 \\cdot");
    expect(withTrailingTimesDot("h = 94", false)).toBe("h = 94");
  });
});
