import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampConfidence,
  constrainMarks,
  downsamplePoints,
  mapNormalizedMarkToPage,
  parseJsonObject,
  parseNormalizedMark,
  parseTutorMode,
  richTextToPlain,
} from "./normalize";
import { expandCluster, padBounds, unionBounds } from "./geometry";
import {
  canSelectProblem,
  createProblemSet,
  extractLatex,
  markProblemFinished,
  recordInkOnProblem,
} from "./problems";
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

describe("parseTutorMode", () => {
  it("keeps known modes and falls back otherwise", () => {
    assert.equal(parseTutorMode("socratic", "feedback"), "socratic");
    assert.equal(parseTutorMode("solve", "socratic"), "solve");
    assert.equal(parseTutorMode("nope", "feedback"), "feedback");
  });
});

describe("constrainMarks", () => {
  it("limits socratic to one margin question", () => {
    const result = constrainMarks("socratic", [
      mark("underline"),
      mark("circle"),
      mark("note", "What is the coefficient of x?"),
      mark("note", "Second question"),
      mark("caret"),
    ]);
    assert.deepEqual(
      result.map((m) => m.kind),
      ["note"],
    );
    assert.equal(result[0]?.text, "What is the coefficient of x?");
  });

  it("pins solve notes to the right of the work", () => {
    const result = constrainMarks("solve", [
      mark("circle"),
      mark("note", "x = 2"),
      mark("caret"),
      mark("note", "check: 2+2=4"),
    ]);
    assert.deepEqual(
      result.map((m) => m.kind),
      ["note", "note"],
    );
    assert.equal(result[0]?.x, 120);
    assert.equal(result[1]?.y, 32);
  });

  it("keeps only a circle and caret in feedback", () => {
    const result = constrainMarks("feedback", [
      mark("circle"),
      mark("underline"),
      mark("caret"),
      mark("note", "Sign error here"),
    ]);
    assert.deepEqual(
      result.map((m) => m.kind),
      ["circle", "caret"],
    );
  });
});

describe("mapNormalizedMarkToPage", () => {
  it("maps 0-1 crop boxes onto page bounds and keeps problem payload", () => {
    const page = mapNormalizedMarkToPage(
      { kind: "circle", nx: 0.25, ny: 0.5, nw: 0.2, nh: 0.1 },
      "page:abc",
      { x: 100, y: 200, w: 400, h: 100 },
      3,
      "x^2",
    );
    assert.equal(page.pageId, "page:abc");
    assert.equal(page.x, 200);
    assert.equal(page.y, 250);
    assert.equal(page.w, 80);
    assert.equal(page.h, 10);
    assert.equal(page.problemId, 3);
    assert.equal(page.latex, "x^2");
  });
});

describe("parse helpers", () => {
  it("reads fenced JSON and normalized marks", () => {
    const obj = parseJsonObject('```json\n{"latex":"x=2","confidence":0.9}\n```');
    assert.equal(obj.latex, "x=2");
    assert.equal(clampConfidence(1.4), 1);
    assert.equal(clampConfidence("nope"), 0);
    const parsed = parseNormalizedMark({
      kind: "caret",
      nx: 0.1,
      ny: 0.8,
      nw: 0.05,
      nh: 0.1,
    });
    assert.equal(parsed?.kind, "caret");
  });

  it("extracts plain text from tldraw rich text", () => {
    assert.equal(
      richTextToPlain({
        type: "doc",
        content: [{ type: "text", text: "2x+3" }],
      }),
      "2x+3",
    );
  });

  it("downsamples long strokes", () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ x: i, y: i }));
    const out = downsamplePoints(pts, 20);
    assert.equal(out.length, 20);
    assert.equal(out[0]?.x, 0);
    assert.equal(out[19]?.x, 199);
  });
});

describe("expandCluster", () => {
  it("flood-fills nearby boxes and ignores distant ones", () => {
    const ids = expandCluster(
      [
        { id: "shape:a" as never, bounds: { x: 0, y: 0, w: 20, h: 20 } },
        { id: "shape:b" as never, bounds: { x: 30, y: 0, w: 20, h: 20 } },
        { id: "shape:c" as never, bounds: { x: 400, y: 0, w: 20, h: 20 } },
      ],
      ["shape:a" as never],
      40,
    );
    assert.deepEqual(ids.sort(), ["shape:a", "shape:b"]);
  });

  it("unions and pads bounds", () => {
    const union = unionBounds([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 5, w: 10, h: 10 },
    ]);
    assert.deepEqual(union, { x: 0, y: 0, w: 30, h: 15 });
    const padded = padBounds({ x: 10, y: 10, w: 20, h: 20 }, 4);
    assert.deepEqual(padded, { x: 6, y: 6, w: 28, h: 28 });
  });
});

describe("problem pages", () => {
  it("treats every number as a page you can open", () => {
    assert.equal(canSelectProblem(1), true);
    assert.equal(canSelectProblem(12), true);
    assert.equal(canSelectProblem(13), false);
  });

  it("records ink on the current page only", () => {
    const first = recordInkOnProblem(
      createProblemSet(),
      1,
      { x: 0, y: 0, w: 40, h: 20 },
      "2x+3=7",
    );
    assert.equal(first[0]?.latex, "2x+3=7");
    const farOnSamePage = recordInkOnProblem(
      first,
      1,
      { x: 400, y: 0, w: 40, h: 20 },
      "",
    );
    assert.equal(farOnSamePage[0]?.latex, "2x+3=7");
    assert.equal(farOnSamePage[1]?.latex, "");
  });

  it("marks a page done when leaving it after work", () => {
    const written = recordInkOnProblem(
      createProblemSet(),
      1,
      { x: 0, y: 0, w: 40, h: 20 },
      "2x+3=7",
    );
    const left = markProblemFinished(written, 1);
    assert.equal(left[0]?.finished, true);
    assert.equal(left[1]?.finished, false);
  });

  it("reuses previous latex when the new cluster has no text", () => {
    assert.equal(extractLatex("", "x=2"), "x=2");
    assert.equal(extractLatex(" y=3 ", "x=2"), "y=3");
  });
});
