import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planTutorInk } from "./hand/plan";
import {
  ADVANCE_PX,
  baselineJitter,
  composeHandwriting,
  pickAlternates,
} from "./hand/compose";
import { ATLAS, COMMON_LETTERS, hasGlyph, isGreekChar } from "./hand/atlas";
import { mulberry32 } from "./hand/path";
import { splitSolveNote } from "./hand/solve";
import { constrainMarks } from "./normalize";
import type { TutorMark } from "./types";

function mark(kind: TutorMark["kind"], text?: string): TutorMark {
  return {
    kind,
    pageId: "page:1",
    x: 10,
    y: 20,
    w: 40,
    h: 16,
    text,
    problemId: 1,
    latex: "2x+3=7",
    bbox: { x: 0, y: 0, w: 100, h: 40 },
  };
}

describe("teacher-hand atlas", () => {
  it("covers latin, digits, locked punctuation, and a few arrows — no Greek", () => {
    for (const ch of "What happens if you distribute the 3 first?") {
      if (ch === " ") continue;
      assert.equal(hasGlyph(ch), true, `missing glyph ${ch}`);
    }
    for (const ch of "0123456789+−×÷=().,?→←↑↓") {
      assert.equal(hasGlyph(ch), true, `missing glyph ${ch}`);
    }
    for (const key of Object.keys(ATLAS)) {
      assert.equal(isGreekChar(key), false, `Greek slipped into atlas: ${key}`);
    }
  });

  it("gives common letters 2–3 alternates and never stamps the same twice in a row", () => {
    for (const ch of COMMON_LETTERS) {
      const n = ATLAS[ch]?.length ?? 0;
      assert.ok(n >= 2 && n <= 3, `${ch} has ${n} alts`);
    }
    const alts = pickAlternates("eeeeeeee", 11);
    for (let i = 1; i < alts.length; i++) {
      assert.notEqual(alts[i], alts[i - 1]);
    }
  });

  it("advances 4px and never sits dead on the line", () => {
    assert.equal(ADVANCE_PX, 4);
    const ink = composeHandwriting("+", { maxWidth: 400, seed: 1, size: 14 });
    assert.equal(ink.width, ATLAS["+"][0]!.advance + ADVANCE_PX);
    const rng = mulberry32(99);
    for (let i = 0; i < 80; i++) {
      const j = baselineJitter(rng);
      assert.notEqual(j, 0);
      assert.ok(Math.abs(j) >= 0.4);
    }
  });

  it("composes a question as polylines, not a text box", () => {
    const ink = composeHandwriting("What is the coefficient of x?", {
      maxWidth: 28 * 14 * 0.6,
      seed: 7,
    });
    assert.ok(ink.segments.length > 8);
    assert.ok(ink.segments.every((s) => s.points.length >= 2));
    assert.ok(ink.width <= 28 * 14 * 0.6 + 20);
  });

  it("wraps long copy inside the 28ch column", () => {
    const ink = composeHandwriting(
      "Which two numbers multiply to negative twelve and add to negative one?",
      { maxWidth: 28 * 14 * 0.6, seed: 3 },
    );
    assert.ok(ink.height > 18);
    assert.ok(ink.width <= 28 * 14 * 0.6 + 24);
  });
});

describe("splitSolveNote", () => {
  it("keeps lead-in words and typesets the equation", () => {
    assert.deepEqual(splitSolveNote("check: 2x+3=7"), {
      leadIn: "check:",
      math: "2x+3=7",
    });
    assert.deepEqual(splitSolveNote("so $x=2$"), {
      leadIn: "so",
      math: "x=2",
    });
    assert.deepEqual(splitSolveNote("so x=2"), {
      leadIn: "so",
      math: "x=2",
    });
    assert.deepEqual(splitSolveNote("x = 2"), {
      leadIn: "",
      math: "x = 2",
    });
    assert.deepEqual(splitSolveNote("What is the coefficient of x?"), {
      leadIn: "What is the coefficient of x?",
      math: "",
    });
  });
});

describe("planTutorInk", () => {
  it("turns socratic copy into draw strokes only", () => {
    const [note] = constrainMarks("socratic", [
      mark("note", "What is the coefficient of x?"),
    ]);
    const plans = planTutorInk(note!, "socratic");
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.kind, "draw");
    assert.ok(plans[0]?.kind === "draw" && plans[0].segments.length > 0);
  });

  it("splits solve notes into hand lead-in and katex", () => {
    const [note] = constrainMarks("solve", [mark("note", "check: x=2")]);
    const plans = planTutorInk(note!, "solve");
    assert.deepEqual(
      plans.map((p) => p.kind),
      ["draw", "katex"],
    );
    assert.equal(plans[1]?.kind === "katex" && plans[1].latex, "x=2");
  });

  it("draws the feedback circle and caret as strokes", () => {
    const marks = constrainMarks("feedback", [mark("circle"), mark("caret")]);
    const circle = planTutorInk(marks[0]!, "feedback");
    const caret = planTutorInk(marks[1]!, "feedback");
    assert.equal(circle[0]?.kind, "draw");
    assert.equal(circle[0]?.kind === "draw" && circle[0].closed, true);
    assert.equal(caret[0]?.kind, "draw");
    assert.equal(caret[0]?.kind === "draw" && caret[0].closed, false);
  });
});
