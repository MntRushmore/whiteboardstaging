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
import { goToProblemPage } from "./pages";
import {
  CARET_GAP_PX,
  CIRCLE_PAD_PX,
  CIRCLE_STROKE_PX,
  CIRCLE_STROKE_SCALE,
  HAND_NIB_PX,
  NOTE_FONT_SCALE,
  SOCRATIC_FONT_PX,
  SOCRATIC_GAP_PX,
  SOCRATIC_MAX_CH,
  SOCRATIC_WIDTH_PX,
  SOLVE_GAP_PX,
  SOLVE_WIDTH_PX,
  pinSocraticNote,
} from "./layout";
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

describe("overlay spacing lock", () => {
  it("keeps Simon's overlay constants", () => {
    assert.equal(SOCRATIC_GAP_PX, 12);
    assert.equal(SOCRATIC_MAX_CH, 28);
    assert.equal(SOCRATIC_FONT_PX, 14);
    assert.equal(SOCRATIC_WIDTH_PX, 28 * 14 * 0.6);
    assert.equal(CIRCLE_STROKE_PX, 1.5);
    assert.equal(HAND_NIB_PX, 2.2);
    assert.equal(CIRCLE_PAD_PX, 6);
    assert.equal(CARET_GAP_PX, 8);
    assert.equal(SOLVE_WIDTH_PX, 280);
    assert.equal(SOLVE_GAP_PX, 16);
    assert.equal(CIRCLE_STROKE_SCALE, 1.5 / 2);
    assert.equal(NOTE_FONT_SCALE, 14 / 18);
  });
});

describe("constrainMarks", () => {
  it("places one socratic question 12px right of the bbox, max 28ch", () => {
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
    assert.equal(result[0]?.x, 0 + 100 + 12);
    assert.equal(result[0]?.y, 0);
    assert.equal(result[0]?.w, 28 * 14 * 0.6);
  });

  it("pins a far-right model note back to the last cluster", () => {
    const cluster = { x: 220, y: 220, w: 151, h: 52 };
    const pinned = pinSocraticNote(
      {
        kind: "note",
        pageId: "",
        x: 972,
        y: 40,
        w: 200,
        h: 20,
        text: "What is x?",
        problemId: 1,
        latex: "3x=9",
        bbox: { x: 0, y: 0, w: 1024, h: 768 },
      },
      cluster,
    );
    assert.equal(pinned.x, 220 + 151 + 12);
    assert.equal(pinned.y, 220);
    assert.deepEqual(pinned.bbox, cluster);
  });

  it("pins the Math Notes result just after the equals on the same baseline", () => {
    const result = constrainMarks("solve", [
      mark("circle"),
      mark("note", "38"),
      mark("caret"),
      mark("note", "What does 'a' represent?"),
    ]);
    assert.deepEqual(
      result.map((m) => m.kind),
      ["note"],
    );
    assert.equal(result[0]?.text, "38");
    assert.equal(result[0]?.x, 0 + 100 + 6);
    assert.equal(result[0]?.y, 0);
    assert.equal(result[0]?.h, 40);
  });

  it("pads the feedback circle 6px around the ink and drops the caret 8px under", () => {
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
    const circle = result[0]!;
    const caret = result[1]!;
    assert.equal(circle.x, 0 - 6);
    assert.equal(circle.y, 0 - 6);
    assert.equal(circle.w, 100 + 12);
    assert.equal(circle.h, 40 + 12);
    assert.equal(caret.x, 50);
    assert.equal(caret.y, 0 + 40 + 8);
  });

  it("emits a circle and caret from the bbox when feedback omits them", () => {
    const result = constrainMarks("feedback", [mark("note", "Sign error here")]);
    assert.deepEqual(
      result.map((m) => m.kind),
      ["circle", "caret"],
    );
    assert.equal(result[0]?.x, -6);
    assert.equal(result[1]?.y, 48);
  });
});

describe("mapNormalizedMarkToPage", () => {
  it("maps 0-1 crop boxes onto the given bounds and keeps problem payload", () => {
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

  it("puts nx~0.95 on the cluster, not the page — page bounds are the far-right miss", () => {
    const cluster = { x: 220, y: 220, w: 151, h: 52 };
    const page = { x: 0, y: 0, w: 1024, h: 768 };
    const note = { kind: "note" as const, nx: 0.95, ny: 0, nw: 0.2, nh: 0.2, text: "What is x?" };
    const onCluster = mapNormalizedMarkToPage(note, "", cluster, 1, "3x=9");
    const onPage = mapNormalizedMarkToPage(note, "", page, 1, "3x=9");
    assert.equal(onCluster.x, 220 + 0.95 * 151);
    assert.ok(onCluster.x < cluster.x + cluster.w);
    assert.ok(onPage.x > 900);
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
    const outside = parseNormalizedMark({
      kind: "note",
      nx: 1.05,
      ny: 0,
      nw: 0.2,
      nh: 0.2,
      text: "What is x?",
    });
    assert.equal(outside?.nx, 1.05);
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
    assert.equal(canSelectProblem(2), true);
    assert.equal(canSelectProblem(12), true);
    assert.equal(canSelectProblem(13), false);
  });

  it("rail tap switches the current page and does not create shapes", () => {
    const pages = [
      { id: "page:1", name: "1", meta: { problemId: 1 } },
      { id: "page:2", name: "2", meta: { problemId: 2 } },
    ];
    let current = "page:1";
    const createdShapes: unknown[] = [];
    const editor = {
      getPages: () => pages,
      getCurrentPageId: () => current,
      setCurrentPage: (id: string) => {
        current = id;
      },
      updatePage: () => {},
      createPage: (page: { name: string; meta?: object }) => {
        const id = `page:${page.name}`;
        pages.push({ id, name: page.name, meta: { problemId: Number(page.name) } });
      },
      createShape: (shape: unknown) => {
        createdShapes.push(shape);
      },
    };
    goToProblemPage(editor as never, 2);
    assert.equal(current, "page:2");
    assert.equal(createdShapes.length, 0);
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
