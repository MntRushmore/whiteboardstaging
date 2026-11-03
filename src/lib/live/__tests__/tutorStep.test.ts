/**
 * "The tutor writes it out" (docs/TUTOR-WRITES.md): which step the tutor writes next, one per ask,
 * each checked by the engine — and the answer held back until it is asked for and allowed.
 */
import { all, create } from "mathjs";
import { describe, expect, it } from "vitest";
import { createEngine } from "../engine";
import { checkStep, equationWhy, fractionNext, nextTutorStep, productNext, type TutorStepResult } from "../tutorStep";

const engine = createEngine({ create, all } as unknown as Parameters<typeof createEngine>[0]);

/**
 * A kid who asks again and again: each step the tutor writes joins the work (an inline one goes on
 * the kid's own line), until the answer is all that is left. Returns what was written, in order,
 * and the result that stopped it.
 */
function askUntilDone(problem: string[], work: string[], answer = false): { written: string[]; last: TutorStepResult } {
  const lines = [...work];
  const written: string[] = [];
  for (let i = 0; i < 8; i++) {
    const r = nextTutorStep(engine, { problem, work: lines, answer });
    if (r.kind !== "step" && r.kind !== "answer") return { written, last: r };
    written.push(r.step);
    if (r.inline) lines[lines.length - 1] = `${lines[lines.length - 1]} ${r.step}`;
    else lines.push(r.step);
    if (r.kind === "answer") return { written, last: r };
  }
  throw new Error("never finished");
}

describe("multi-step equations", () => {
  it("writes one step, the next one on the next ask, and holds the answer back", () => {
    const first = nextTutorStep(engine, { work: ["2x + 3 = 11"] });
    expect(first).toMatchObject({ kind: "step", step: "2x = 8", inline: false, from: 0, slip: -1, checked: true });
    expect(first.why).toBe("Subtract 3 from both sides.");
    const second = nextTutorStep(engine, { work: ["2x + 3 = 11", "2x = 8"] });
    expect(second.kind).toBe("lastStep");
    expect(second.step).toBe("x = 4");
    expect(second.why).toBe("One step left: divide both sides by 2. You can do this one.");
    expect(second.why).not.toContain("4");
  });

  it("writes the answer only when it is asked for and allowed", () => {
    const r = nextTutorStep(engine, { work: ["2x + 3 = 11", "2x = 8"], answer: true });
    expect(r).toMatchObject({ kind: "answer", step: "x = 4", checked: true });
  });

  it("says the work is finished when it is", () => {
    expect(nextTutorStep(engine, { work: ["2x + 3 = 11", "2x = 8", "x = 4"] }).kind).toBe("solved");
  });

  it("goes on from the problem on a problem page, before the kid has written anything", () => {
    const r = nextTutorStep(engine, { problem: ["2x + 3 = 11"], work: [] });
    expect(r).toMatchObject({ kind: "step", step: "2x = 8", from: 0 });
  });

  it("goes on from the last right line, never from a slip", () => {
    const r = nextTutorStep(engine, { work: ["2x + 3 = 11", "2x = 9"] });
    expect(r).toMatchObject({ kind: "step", step: "2x = 8", from: 0, slip: 1 });
  });

  it("names what each step does", () => {
    const { written } = askUntilDone([], ["5x - 7 = 2x + 8"], true);
    expect(written).toEqual(["5x - 2x = 8 + 7", "3x = 15", "x = 5"]);
    expect(nextTutorStep(engine, { work: ["5x - 7 = 2x + 8"] }).why).toBe("Subtract 2x from both sides, and add 7.");
    expect(nextTutorStep(engine, { work: ["3(x - 2) = 12"] })).toMatchObject({ step: "3x - 6 = 12", why: "Multiply out the brackets." });
    expect(nextTutorStep(engine, { work: ["\\frac{x}{3} + 2 = 5"] })).toMatchObject({ step: "x + 6 = 15", why: "Multiply both sides by 3." });
  });

  it("every step it writes follows from the one before (the engine's check)", () => {
    for (const start of ["2x + 3 = 11", "3(x - 2) = 12", "5x - 7 = 2x + 8", "\\frac{x}{3} + 2 = 5", "4x - 9 = 3", "7 = 2y - 5"]) {
      const { written, last } = askUntilDone([], [start], true);
      expect(last.kind, start).toBe("answer");
      let prev = start;
      for (const step of written) {
        expect(checkStep(engine, prev, step).ok, `${prev} → ${step}`).toBe(true);
        prev = step;
      }
    }
  });
});

describe("fractions", () => {
  it("adds unlike fractions in classroom steps, one per ask", () => {
    const first = nextTutorStep(engine, { work: ["\\frac{1}{2} + \\frac{1}{3} ="] });
    expect(first).toMatchObject({ kind: "step", step: "\\frac{3}{6} + \\frac{2}{6}", inline: true, why: "Make the denominators the same: 6." });
    const second = nextTutorStep(engine, { work: ["\\frac{1}{2} + \\frac{1}{3} = \\frac{3}{6} + \\frac{2}{6}"] });
    expect(second).toMatchObject({ kind: "lastStep", step: "= \\frac{5}{6}", inline: false });
    expect(second.why).not.toContain("5");
    expect(nextTutorStep(engine, { work: ["\\frac{1}{2} + \\frac{1}{3} = \\frac{3}{6} + \\frac{2}{6}", "= \\frac{5}{6}"] }).kind).toBe("solved");
  });

  it("multiplies across, flips to divide, simplifies, and turns mixed numbers into fractions", () => {
    expect(askUntilDone([], ["\\frac{3}{4} \\times \\frac{2}{5} ="], true).written).toEqual(["\\frac{6}{20}", "= \\frac{3}{10}"]);
    expect(askUntilDone([], ["\\frac{2}{3} \\div \\frac{4}{9} ="], true).written).toEqual(["\\frac{2}{3} \\times \\frac{9}{4}", "= \\frac{18}{12}", "= \\frac{3}{2}"]);
    expect(askUntilDone([], ["2\\frac{1}{2} + 1\\frac{3}{4} ="], true).written).toEqual([
      "\\frac{5}{2} + \\frac{7}{4}",
      "= \\frac{10}{4} + \\frac{7}{4}",
      "= \\frac{17}{4}",
    ]);
    expect(askUntilDone([], ["\\frac{5}{6} - \\frac{1}{4} ="], true).written).toEqual(["\\frac{10}{12} - \\frac{3}{12}", "= \\frac{7}{12}"]);
    expect(fractionNext("\\frac{6}{8}")).toMatchObject({ latex: "\\frac{3}{4}", final: true, why: "Simplify: divide the top and bottom by 2." });
  });

  it("goes on from the kid's last right step, not a slip", () => {
    const r = nextTutorStep(engine, { work: ["\\frac{1}{2} + \\frac{1}{3} = \\frac{3}{6} + \\frac{2}{6}", "= \\frac{5}{12}"] });
    expect(r).toMatchObject({ kind: "lastStep", step: "= \\frac{5}{6}", slip: 1 });
  });

  it("every fraction step equals what it follows", () => {
    for (const start of ["\\frac{1}{2} + \\frac{1}{3}", "\\frac{3}{4} \\times \\frac{2}{5}", "\\frac{2}{3} \\div \\frac{4}{9}", "2\\frac{1}{2} + 1\\frac{3}{4}", "\\frac{7}{8} - \\frac{1}{2}", "3 \\times \\frac{2}{9}"]) {
      const { written } = askUntilDone([], [`${start} =`], true);
      let prev = start;
      for (const step of written) {
        const expr = step.replace(/^=\s*/, "");
        expect(checkStep(engine, prev, `= ${expr}`).ok, `${prev} → ${expr}`).toBe(true);
        prev = expr;
      }
    }
  });
});

describe("multiplication across the line", () => {
  it("splits by place value, multiplies the parts, adds them", () => {
    expect(productNext("23 \\times 4")).toMatchObject({ latex: "20 \\times 4 + 3 \\times 4", why: "Split 23 into 20 + 3, and multiply each part by 4." });
    const { written, last } = askUntilDone([], ["46 \\times 23 ="], true);
    expect(written).toEqual(["46 \\times 20 + 46 \\times 3", "= 920 + 138", "= 1058"]);
    expect(last.kind).toBe("answer");
    expect(nextTutorStep(engine, { work: ["46 \\times 23 = 46 \\times 20 + 46 \\times 3", "= 920 + 138"] }).kind).toBe("lastStep");
  });
});

describe("what it refuses", () => {
  it("never writes a step the engine cannot vouch for", () => {
    expect(checkStep(engine, "2x + 3 = 11", "2x = 14").ok).toBe(false);
    expect(checkStep(engine, "\\frac{1}{2} + \\frac{1}{3}", "= \\frac{2}{5}").ok).toBe(false);
    expect(checkStep(engine, "2x + 3 = 11", "2x + 3 = 11").ok).toBe(false);
    expect(checkStep(engine, "2x + 3 = 11", "2x = 8", { written: ["2x + 3 = 11", "2x = 8"] }).ok).toBe(false);
  });

  it("says it is unsure when nothing it can check comes next", () => {
    const r = nextTutorStep(engine, { work: ["\\text{how many apples are left}"] });
    expect(["unsure", "nothing"]).toContain(r.kind);
    expect(r.step).toBe("");
  });

  it("has nothing to say about an empty page", () => {
    expect(nextTutorStep(engine, { work: [] }).kind).toBe("nothing");
  });
});

describe("why, for equations", () => {
  it("reads what changed on both sides", () => {
    expect(equationWhy(engine, "2x + 3 = 11", "2x = 8")).toBe("Subtract 3 from both sides.");
    expect(equationWhy(engine, "x - 4 = 6", "x = 10")).toBe("Add 4 to both sides.");
    expect(equationWhy(engine, "2x = 8", "x = 4")).toBe("Divide both sides by 2.");
    expect(equationWhy(engine, "5x = 2x + 9", "3x = 9")).toBe("Subtract 2x from both sides.");
    expect(equationWhy(engine, "2x + 3x = 10", "5x = 10")).toBe("Combine like terms on each side.");
  });
});
