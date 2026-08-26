import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMathNotes,
  expressionToEvaluate,
  firstMathNotesLine,
  mathNotesLineResult,
} from "./mathNotes";
import { MATH_NOTES_GAP_PX, pinMathNotesResult } from "./layout";
import type { TutorMark } from "./types";

describe("evaluateMathNotes", () => {
  it("computes 36 + 2 = as 38", () => {
    assert.equal(evaluateMathNotes("36 + 2 ="), "38");
    assert.equal(evaluateMathNotes("36+2="), "38");
    assert.equal(evaluateMathNotes("36 + 2"), "38");
    assert.equal(expressionToEvaluate("36 + 2 ="), "36+2");
  });

  it("recomputes when a number changes", () => {
    assert.equal(evaluateMathNotes("36 + 3 ="), "39");
    assert.equal(evaluateMathNotes("36 + 2 = 38"), "38");
  });

  it("does not spend the solve slot on a stray digit without equals", () => {
    assert.equal(mathNotesLineResult("7"), null);
    assert.equal(mathNotesLineResult("36 + 2"), null);
    assert.equal(mathNotesLineResult("36 + 2 ="), "38");
    const picked = firstMathNotesLine([
      { latex: "7", id: "stray" },
      { latex: "36 + 2 =", id: "line" },
      { latex: "4", id: "tap" },
    ]);
    assert.equal(picked?.id, "line");
    assert.equal(picked?.result, "38");
  });

  it("stays quiet on empty latex, algebra, or unreadable work", () => {
    assert.equal(evaluateMathNotes(""), null);
    assert.equal(evaluateMathNotes("   "), null);
    assert.equal(evaluateMathNotes("3x=9"), null);
    assert.equal(evaluateMathNotes("What does a represent"), null);
  });

  it("handles times, divide, and parentheses", () => {
    assert.equal(evaluateMathNotes("3 \\times 2 ="), "6");
    assert.equal(evaluateMathNotes("8 \\div 2 ="), "4");
    assert.equal(evaluateMathNotes("3(4+2)="), "18");
    assert.equal(evaluateMathNotes("2^3="), "8");
  });
});

describe("pinMathNotesResult", () => {
  it("sits on the baseline immediately after the equals, not a 12px margin question", () => {
    const cluster = { x: 220, y: 240, w: 90, h: 36 };
    const mark: TutorMark = {
      kind: "note",
      pageId: "",
      x: 900,
      y: 10,
      w: 200,
      h: 16,
      text: "What does 'a' represent in this context?",
      problemId: 1,
      latex: "36 + 2 =",
      bbox: { x: 0, y: 0, w: 1024, h: 768 },
    };
    const pinned = pinMathNotesResult({ ...mark, text: "38" }, cluster);
    assert.equal(MATH_NOTES_GAP_PX, 6);
    assert.equal(pinned.x, 220 + 90 + 6);
    assert.equal(pinned.y, 240);
    assert.equal(pinned.h, 36);
    assert.equal(pinned.text, "38");
    assert.ok(pinned.x < 220 + 90 + 12);
  });
});
