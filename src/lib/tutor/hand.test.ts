import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planTutorInk } from "./hand/plan";
import {
  ADVANCE_PX,
  baselineJitter,
  composeHandwriting,
  pickAlternates,
} from "./hand/compose";
import { ATLAS, ATLAS_CALC_EXTRAS, COMMON_LETTERS, hasGlyph, isGreekChar } from "./hand/atlas";
import { composeDiagram, DIAGRAM_KINDS } from "./hand/diagrams";
import { DEMO_PROBLEMS, socraticOpener } from "./problems";
import {
  DEFAULT_ASSISTANCE_MODE,
  TUTOR_BACKUP_MODEL,
  TUTOR_DEBOUNCE_MS,
  TUTOR_FLASH_MODEL,
  TUTOR_LAYER_META,
  TUTOR_PENDING_META,
  isPendingTutorMeta,
} from "./types";
import { latexFromMathpix, toMathpixStrokePayload } from "./mathpix";
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
    for (const extra of ATLAS_CALC_EXTRAS) {
      assert.equal(hasGlyph(extra), true, `missing calc extra ${extra}`);
    }
    const allowed = new Set<string>(ATLAS_CALC_EXTRAS);
    for (const key of Object.keys(ATLAS)) {
      if (allowed.has(key)) continue;
      assert.equal(isGreekChar(key), false, `Greek slipped into atlas: ${key}`);
    }
  });

  it("composes d/dx as one ligature", () => {
    const ink = composeHandwriting("d/dx", { maxWidth: 400, seed: 2, size: 14 });
    assert.ok(ink.segments.length >= 3);
    assert.ok(ink.width < 40);
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

  it("adds angle arcs and tick marks on geometry feedback, not extra letters", () => {
    const geo = mark("circle");
    geo.problemId = 9;
    const plans = planTutorInk(geo, "feedback");
    assert.ok(plans.length >= 3);
    assert.ok(plans.every((p) => p.kind === "draw"));
  });
});

describe("demo set", () => {
  it("lands Simon's 12 verbatim with Socratic default", () => {
    assert.equal(DEMO_PROBLEMS.length, 12);
    assert.deepEqual(
      DEMO_PROBLEMS.map((p) => [p.id, p.subject, p.title, p.socratic, p.diagram ?? ""]),
      [
        [1, "algebra", "Solve for x: 3(x - 2) = 2x + 5", "What happens if you distribute the 3 first?", ""],
        [2, "algebra", "Factor: x^2 - x - 12", "Which two numbers multiply to -12 and add to -1?", ""],
        [
          3,
          "algebra",
          "A rectangle is 3 more than twice its width. The perimeter is 46. Find the sides.",
          "If width is w, how do you write the length?",
          "",
        ],
        [
          4,
          "algebra",
          "Solve: (x + 1) / (x - 2) = 3",
          "What value of x would make this fraction undefined?",
          "",
        ],
        [5, "calculus", "Find d/dx [x^3 - 4x]", "What is the derivative of x^n?", ""],
        [
          6,
          "calculus",
          "If f(x) = (2x + 1)(x^2), find f'(x).",
          "Product, or do you want to expand first?",
          "",
        ],
        [
          7,
          "calculus",
          "Evaluate ∫ (3x^2 - 2) dx",
          "What power do you add when you undo a derivative?",
          "",
        ],
        [
          8,
          "calculus",
          "Water drains from an inverted cone. Height is 3 times the radius. When h = 6, dh/dt = -2. Find dr/dt.",
          "What is the volume of a cone, and which two quantities are changing?",
          "",
        ],
        [
          9,
          "geometry",
          "Triangle ABC has angle A = 47° and angle B = 62°. Find angle C.",
          "What do the three angles of a triangle add to?",
          "triangle",
        ],
        [
          10,
          "geometry",
          "Line l is parallel to line m, transversal t. One interior angle is 118°. Find the alternate interior angle.",
          "If the lines are parallel, what is true of alternate interior angles?",
          "parallel-transversal",
        ],
        [
          11,
          "geometry",
          "A right triangle has legs 6 and 8. Find the hypotenuse.",
          "Which side is across from the right angle?",
          "right-triangle",
        ],
        [
          12,
          "geometry",
          "Two similar triangles have scale factor 2:3. The smaller has a side of 10. Find the matching side on the larger.",
          "Which triangle gets the 3 in 2:3?",
          "similar-triangles",
        ],
      ],
    );
    assert.equal(DEFAULT_ASSISTANCE_MODE, "suggest");
    assert.equal(TUTOR_DEBOUNCE_MS, 2000);
    assert.equal(TUTOR_FLASH_MODEL, "google/gemini-2.5-flash");
    assert.equal(TUTOR_BACKUP_MODEL, "openai/gpt-4.1-mini");
    assert.equal(socraticOpener(1), "What happens if you distribute the 3 first?");
    assert.equal(
      socraticOpener(8),
      "What is the volume of a cone, and which two quantities are changing?",
    );
    const payload = toMathpixStrokePayload([
      { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    ]);
    assert.deepEqual(payload.strokes.strokes.x, [[1, 3]]);
    assert.deepEqual(payload.strokes.strokes.y, [[2, 4]]);
    assert.equal(latexFromMathpix({ latex_styled: "3x^{2}" }), "3x^{2}");
    assert.equal(latexFromMathpix({ text: "\\( 3 x^{2} \\)" }), "3 x^{2}");
    assert.equal(DEMO_PROBLEMS[7]?.title.startsWith("Water drains from an inverted cone."), true);
    assert.equal(
      isPendingTutorMeta({ [TUTOR_LAYER_META]: true, [TUTOR_PENDING_META]: true }),
      true,
    );
    assert.equal(
      isPendingTutorMeta({ [TUTOR_LAYER_META]: true, [TUTOR_PENDING_META]: false }),
      false,
    );
    for (const kind of DIAGRAM_KINDS) {
      const ink = composeDiagram(kind);
      assert.ok(ink.segments.length >= 3, kind);
    }
  });
});
