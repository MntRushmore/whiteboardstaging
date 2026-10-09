import { beforeAll, describe, expect, it } from "vitest";
import type { AnalyzeContext, LineAnalysis, LiveEngine } from "../../contracts";
import { getEngine } from "..";

/**
 * Branches of the zero-product rule (`asBranch` in `engine/index.ts`): a line that keeps some of the
 * solutions of a factored equation equal to 0 and adds none is right — `x = 7` under
 * `(x - 7)(x - 8) = 0`, `x + 9 = 0` under `x(x + 9) = 0`. Not factored, one root alone still dropped
 * the other (`x = 2` under `x^{2} = 4`). A student who wrote `x = 7` and then `x = 8`
 * beside it had both ringed (bug report 2026-10-09, an adult's quadratics board). The problem is
 * solved once the branches, under each other or beside each other on a row, cover every solution
 * with an answer.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const line = (latex: string, ctx: Partial<AnalyzeContext> = {}): LineAnalysis => engine.analyzeLine(latex, { mode: "feedback", ...ctx });

describe("one branch of a split is right", () => {
  it.each([
    ["(x-7)(x-8)=0", "x=7"],
    ["(x-7)(x-8)=0", "x=8"],
    ["(x-7)(x-8)=0", "x-7=0"],
    ["x(x+9)=0", "x=0"],
    ["x(x+9)=0", "x+9=0"],
    ["x(x+9)=0", "x=-9"],
    ["2(x-1)(x+3)=0", "x=1"],
    ["(x-2)(x+2)=0", "x=-2"],
  ])("%s, then %s: ticked, not yet solved", (above, latex) => {
    const a = line(latex, { previous: line(above) });
    expect(a.verdict).toBe("ok");
    expect(a.solved).toBe(false);
    expect(a.branch?.covers).toHaveLength(1);
  });

  it.each([
    ["(x-7)(x-8)=0", "x=9"],
    ["x^{2}-4=0", "x=3"],
    ["x(x+9)=0", "x=9"],
    ["2x=6", "x=4"],
    ["(x-7)(x-8)=0", "x-9=0"],
    // not factored: one root alone dropped the other (the ± forgotten), as before
    ["x^{2}=4", "x=2"],
    ["x^{2}-4=0", "x=-2"],
  ])("%s, then %s: a wrong answer, or a root dropped, is still ringed", (above, latex) => {
    const a = line(latex, { previous: line(above) });
    expect(a.verdict).toBe("mismatch");
    expect(a.branch).toBeUndefined();
  });

  it("both answers on one line are right and solve it, as before", () => {
    const a = line("x=7 \\quad x=8", { previous: line("(x-7)(x-8)=0") });
    expect(a).toMatchObject({ verdict: "ok", solved: true });
    expect(a.branch).toBeUndefined();
  });
});

describe("the branches together solve the problem", () => {
  const factored = () => line("(x-7)(x-8)=0", { previous: line("x^{2}-15x=-56") });

  it("x = 8 beside x = 7 on its row: right, and the problem is solved", () => {
    const f = factored();
    const seven = line("x=7", { previous: f });
    const eight = line("x=8", { previous: f, beside: [seven] });
    expect(eight).toMatchObject({ verdict: "ok", solved: true });
    expect(eight.branch?.covers.sort()).toEqual([7, 8]);
  });

  it("x = 8 under x = 7: judged against the factored line, not against x = 7", () => {
    const seven = line("x=7", { previous: factored() });
    const eight = line("x=8", { previous: seven });
    expect(eight).toMatchObject({ verdict: "ok", solved: true });
  });

  it("both answers on one line under one of them: right and solved", () => {
    const seven = line("x=7", { previous: factored() });
    expect(line("x=7 \\quad x=8", { previous: seven })).toMatchObject({ verdict: "ok", solved: true });
  });

  it("the zero-product rule: x = 0 beside x + 9 = 0, then x = -9 under it solves it", () => {
    const original = line("x^{2}+9x=0");
    const factor = line("x(x+9)=0", { previous: original, original });
    const zero = line("x=0", { previous: factor, original });
    const branch = line("x+9=0", { previous: factor, original, beside: [zero] });
    // every solution is covered, but by a factor, not an answer: not solved yet
    expect(branch).toMatchObject({ verdict: "ok", solved: false });
    const answer = line("x=-9", { previous: branch, original });
    expect(answer).toMatchObject({ verdict: "ok", solved: true });
  });

  it("a wrong answer beside a right branch is still ringed", () => {
    const f = factored();
    const seven = line("x=7", { previous: f });
    expect(line("x=9", { previous: f, beside: [seven] }).verdict).toBe("mismatch");
  });

  it("a branch of another unknown's equation is not read as one", () => {
    const seven = line("x=7", { previous: factored() });
    expect(line("y=8", { previous: seven }).branch).toBeUndefined();
  });
});
