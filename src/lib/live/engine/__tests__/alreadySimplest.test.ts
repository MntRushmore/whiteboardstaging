import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "..";

/**
 * Solve on a lone expression with nothing left to do (`2x^{2}`): the board says so instead of
 * asking a model for a "solution" of it (which came back as nothing, or as the line again). The
 * engine is sure only of polynomials it reads term by term, written as it would write them.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("engine.alreadySimplest", () => {
  it.each(["2x^{2}", "2 x^{2}", "3x+2", "x^{2}+3x+5", "2a+3b", "x^{2}y", "-4y"])("%s is as simple as it gets", (latex) => {
    expect(engine.alreadySimplest?.(latex)).toBe(true);
  });

  it.each([
    // something to collect, expand, cancel or factor: the engine's own steps
    "3x+2x",
    "2(x+1)",
    "x^{2}-1",
    "\\frac{8x^{3}}{2x^{2}}",
    // one term, but not in its simplest form, and the engine has no steps for it: a model's turn
    "\\frac{8x}{2}",
    "x \\cdot x",
    // not a polynomial, or nothing in letters
    "\\sin x",
    "\\sqrt{16x^{2}}",
    "2+2",
    "2x2",
    "36",
    // a relation is solved, not simplified
    "2x+3=11",
    "x^{2}=4",
    "",
  ])("%s is not", (latex) => {
    expect(engine.alreadySimplest?.(latex)).toBe(false);
  });
});
