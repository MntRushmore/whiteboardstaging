import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { algebraNextStep, looksLikeAlgebra } from "./algebra";
import { firstSolveLine, mathNotesLineResult, solveNextStep } from "./mathNotes";

describe("algebra Solve path", () => {
  it("treats letters as algebra, not a quiet reject", () => {
    assert.equal(looksLikeAlgebra("x^2 - x - 12"), true);
    assert.equal(looksLikeAlgebra("3(x-2)=2x+5"), true);
    assert.equal(looksLikeAlgebra("36 + 2 ="), false);
  });

  it("factors x^2 - x - 12 on the orange Solve path", () => {
    assert.equal(algebraNextStep("x^2 - x - 12"), "(x-4)(x+3)");
    assert.equal(algebraNextStep("x^{2}-x-12"), "(x-4)(x+3)");
    assert.equal(algebraNextStep("x²-x-12"), "(x-4)(x+3)");
    assert.equal(solveNextStep("x^2 - x - 12"), "(x-4)(x+3)");
  });

  it("solves 3(x-2)=2x+5 for x", () => {
    assert.equal(algebraNextStep("3(x-2)=2x+5"), "x = 11");
    assert.equal(solveNextStep("3(x - 2) = 2x + 5"), "x = 11");
  });

  it("expands a factored pair", () => {
    assert.equal(algebraNextStep("(x-4)(x+3)"), "x^2-x-12");
  });

  it("solves one-variable linear equations", () => {
    assert.equal(algebraNextStep("3x=9"), "x = 3");
    assert.equal(algebraNextStep("2x+4=10"), "x = 3");
  });

  it("does not stay quiet just because latex has a letter", () => {
    const picked = firstSolveLine([
      { latex: "7", id: "stray" },
      { latex: "x^2 - x - 12", id: "line" },
    ]);
    assert.equal(picked?.id, "line");
    assert.equal(picked?.result, "(x-4)(x+3)");
  });

  it("keeps arithmetic Math Notes on expr= and stays quiet on a stray digit", () => {
    assert.equal(mathNotesLineResult("36 + 2 ="), "38");
    assert.equal(solveNextStep("36 + 2 ="), "38");
    assert.equal(solveNextStep("7"), null);
    assert.equal(algebraNextStep("7"), null);
  });
});
