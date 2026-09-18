import { describe, expect, it } from "vitest";
import {
  TUTOR_INK_COLOR,
  TUTOR_INK_HEX,
  answerContinuation,
  composeAnswer,
  endsWithRelation,
  startsWithRelation,
} from "../answer";

/**
 * The reported bug, in one line: a student wrote `36 + 2 =` and the board showed
 * `36 + 2 = = 38`, because the echo prefixed the result with `=` no matter what the line
 * already ended with. Every join of a line to its answer goes through here now.
 */
describe("composing a line with its answer", () => {
  it("does not add a second relation to a line that already ends in one", () => {
    expect(answerContinuation("36 + 2 =", "38")).toBe("38");
    expect(composeAnswer("36 + 2 =", "38")).toBe("36 + 2 = 38");
    // exactly one `=` on the whole line — the thing the screenshot got wrong
    expect(composeAnswer("36 + 2 =", "38").match(/=/g)).toHaveLength(1);
  });

  it("adds the `=` when the student has not written one", () => {
    expect(answerContinuation("36 + 2", "38")).toBe("= 38");
    expect(composeAnswer("36 + 2", "38")).toBe("36 + 2 = 38");
  });

  it("leaves a result that carries its own relation alone", () => {
    expect(answerContinuation("36 + 2", "= 38")).toBe("= 38");
    expect(answerContinuation("x", "\\approx 3.14")).toBe("\\approx 3.14");
    expect(composeAnswer("36 + 2", "= 38")).toBe("36 + 2 = 38");
  });

  it("handles the whitespace and the empty cases", () => {
    expect(answerContinuation("36 + 2 =  ", "  38 ")).toBe("38");
    expect(answerContinuation("36 + 2", "   ")).toBe("");
    expect(composeAnswer("36 + 2", "")).toBe("36 + 2");
    expect(composeAnswer("", "38")).toBe("= 38");
  });

  it("reads macro relations, and does not mistake `\\left` for `\\le`", () => {
    expect(endsWithRelation("x \\approx")).toBe(true);
    expect(endsWithRelation("2x \\le")).toBe(true);
    expect(endsWithRelation("a \\to")).toBe(true);
    expect(endsWithRelation("36 + 2")).toBe(false);
    expect(endsWithRelation("\\sin(x)")).toBe(false);
    expect(startsWithRelation("\\left( x \\right)")).toBe(false);
    expect(startsWithRelation("\\leq 4")).toBe(true);
    expect(startsWithRelation("38")).toBe(false);
  });
});

describe("the tutor's colour", () => {
  it("is one calm blue, never red", () => {
    // tldraw's palette name for the handwriting, the same colour as a hex for CSS/SVG
    expect(TUTOR_INK_COLOR).toBe("blue");
    expect(TUTOR_INK_HEX).toMatch(/^#[0-9a-f]{6}$/);
    expect(TUTOR_INK_COLOR).not.toBe("red");
  });
});
