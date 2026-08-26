import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideSocraticAnswer } from "./answer";
import type { TutorMark } from "./types";

const bbox = { x: 10, y: 20, w: 80, h: 30 };

function note(text: string): TutorMark {
  return {
    kind: "note",
    pageId: "",
    x: 100,
    y: 20,
    w: 40,
    h: 16,
    text,
    problemId: 1,
    latex: "3x=9",
    bbox,
  };
}

describe("decideSocraticAnswer", () => {
  it("stays quiet without a last stroke cluster", () => {
    const decision = decideSocraticAnswer(0, "3x=9", [note("What is x?")]);
    assert.deepEqual(decision, { action: "quiet", reason: "no-cluster" });
  });

  it("stays quiet on a Mathpix miss (empty latex)", () => {
    const decision = decideSocraticAnswer(2, "", [note("What is x?")]);
    assert.deepEqual(decision, { action: "quiet", reason: "mathpix-miss" });
  });

  it("stays quiet on a Mathpix miss (whitespace latex)", () => {
    const decision = decideSocraticAnswer(2, "   ", [note("What is x?")]);
    assert.deepEqual(decision, { action: "quiet", reason: "mathpix-miss" });
  });

  it("stays quiet on a Flash miss (no usable note)", () => {
    const circle: TutorMark = {
      kind: "circle",
      pageId: "",
      x: 10,
      y: 20,
      w: 80,
      h: 30,
      problemId: 1,
      latex: "3x=9",
      bbox,
    };
    const decision = decideSocraticAnswer(2, "3x=9", [circle]);
    assert.deepEqual(decision, { action: "quiet", reason: "flash-miss" });
  });

  it("keeps exactly one Socratic note when Mathpix returns latex", () => {
    const decision = decideSocraticAnswer(2, "3x=9", [
      note("What happens if you divide first?"),
      note("And then?"),
    ]);
    assert.equal(decision.action, "socratic");
    if (decision.action !== "socratic") return;
    assert.equal(decision.marks.length, 1);
    assert.equal(decision.marks[0]?.kind, "note");
    assert.equal(decision.marks[0]?.text, "What happens if you divide first?");
  });
});
