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
import type { TutorMark } from "./types";

function mark(kind: TutorMark["kind"], text?: string): TutorMark {
  return { kind, pageId: "page:1", x: 10, y: 20, w: 40, h: 16, text };
}

describe("parseTutorMode", () => {
  it("keeps known modes and falls back otherwise", () => {
    assert.equal(parseTutorMode("socratic", "feedback"), "socratic");
    assert.equal(parseTutorMode("solve", "socratic"), "solve");
    assert.equal(parseTutorMode("nope", "feedback"), "feedback");
  });
});

describe("constrainMarks", () => {
  it("limits socratic to one note and optional circle", () => {
    const result = constrainMarks("socratic", [
      mark("underline"),
      mark("circle"),
      mark("circle"),
      mark("note", "What is the coefficient of x?"),
      mark("note", "Second question"),
      mark("arrow"),
    ]);
    assert.deepEqual(
      result.map((m) => m.kind),
      ["circle", "note"],
    );
    assert.equal(result[1]?.text, "What is the coefficient of x?");
  });

  it("keeps only step notes in solve mode", () => {
    const result = constrainMarks("solve", [
      mark("circle"),
      mark("note", "x = 2"),
      mark("underline"),
      mark("note", "check: 2+2=4"),
    ]);
    assert.deepEqual(
      result.map((m) => m.kind),
      ["note", "note"],
    );
  });

  it("keeps feedback decorations plus one note", () => {
    const result = constrainMarks("feedback", [
      mark("circle"),
      mark("underline"),
      mark("underline"),
      mark("arrow"),
      mark("note", "Sign error here"),
      mark("note", "Also this"),
    ]);
    assert.equal(result.filter((m) => m.kind === "note").length, 1);
    assert.ok(result.every((m) => m.kind !== "arrow"));
    assert.equal(result[result.length - 1]?.text, "Sign error here");
  });
});

describe("mapNormalizedMarkToPage", () => {
  it("maps 0-1 crop boxes onto page bounds", () => {
    const page = mapNormalizedMarkToPage(
      { kind: "circle", nx: 0.25, ny: 0.5, nw: 0.2, nh: 0.1 },
      "page:abc",
      { x: 100, y: 200, w: 400, h: 100 },
    );
    assert.equal(page.pageId, "page:abc");
    assert.equal(page.x, 200);
    assert.equal(page.y, 250);
    assert.equal(page.w, 80);
    assert.equal(page.h, 10);
  });
});

describe("parse helpers", () => {
  it("reads fenced JSON and normalized marks", () => {
    const obj = parseJsonObject('```json\n{"latex":"x=2","confidence":0.9}\n```');
    assert.equal(obj.latex, "x=2");
    assert.equal(clampConfidence(1.4), 1);
    assert.equal(clampConfidence("nope"), 0);
    const mark = parseNormalizedMark({
      kind: "note",
      nx: 0.8,
      ny: 0.1,
      nw: 0.2,
      nh: 0.2,
      text: "Why?",
    });
    assert.equal(mark?.kind, "note");
    assert.equal(mark?.text, "Why?");
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
