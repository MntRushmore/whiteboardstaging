/**
 * A topic board's problems (`generators/ladder.ts`, `topicSet`) and its worked example
 * (`topicExample.ts`), held to the engine like every practice problem (`practice.test.ts`): the
 * problems climb from easy to hard, the example is one the engine works out on the device (so the
 * worked example never asks a model and never costs ink), and every one is a problem the board
 * chat writes.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PROBLEM_GRID } from "@/lib/live/chat/layout";
import { verifyProblem } from "@/lib/live/chat/verify";
import type { LiveEngine } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { planHandwriting } from "@/lib/live/handwriting";
import { normalizeStep } from "@/lib/live/liveLoop";
import { difficultyOf, formsFor } from "../generators";
import { drawLadderFrom, ladderRanks, rankForms } from "../generators/ladder";
import type { Form } from "../generators/form";
import { topicSet } from "../practiceSet";
import { localWorkFor, pickLocalExample, sameStep } from "../topicExample";
import { TOPIC_IDS, TOPIC_PROBLEMS } from "../topics";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const SEEDS = [1, 2, 3];
const canDraw = (lines: readonly string[]) => planHandwriting(lines, { size: PROBLEM_GRID.size, seed: 1 }).unsupported.length === 0;

describe("difficulty and the ladder", () => {
  it("more to a problem is harder", () => {
    expect(difficultyOf(["2x + 3 = 11"])).toBeLessThan(difficultyOf(["3(2x - 1) - 2(x + 4) = 10"]));
    expect(difficultyOf(["7 \\times 8"])).toBeLessThan(difficultyOf(["23 \\times 7"]));
    expect(difficultyOf(["x + y = 4"])).toBeLessThan(difficultyOf(["x + y = 4", "x - y = 2"]));
    expect(difficultyOf(["\\sqrt{49}"])).toBeLessThan(difficultyOf(["\\sqrt{49} + \\sqrt{36}"]));
  });

  it("spreads the problems along the ranking, the first at the easiest and the last at the hardest", () => {
    expect(ladderRanks(8, 4)).toEqual([0, 2, 5, 7]);
    expect(ladderRanks(4, 4)).toEqual([0, 1, 2, 3]);
    expect(ladderRanks(2, 4)).toEqual([0, 0, 1, 1]);
    expect(ladderRanks(6, 1)).toEqual([0]);
    expect(ladderRanks(0, 4)).toEqual([]);
  });

  it("ranks a skill's forms the same way every time, easy first (the classic first problem leads)", () => {
    for (const id of TOPIC_IDS) {
      const forms = formsFor(id);
      const r = rankForms(id, forms);
      expect([...r].sort((a, b) => a - b), id).toEqual(forms.map((_, i) => i));
      expect(rankForms(id, forms), id).toEqual(r);
    }
    // same denominators before anything else; x^a · x^b before a power of a power
    expect(rankForms("fractions", formsFor("fractions"))[0]).toBe(0);
    expect(rankForms("exponent_rules", formsFor("exponent_rules"))[0]).toBe(0);
  });

  it("a form that keeps missing hands its place to the next one", () => {
    const never: Form = () => null;
    let n = 0;
    const counting: Form = () => [`x + ${++n} = ${n + 5}`];
    const ladder = drawLadderFrom("test_skill", [never, counting], 3, 1);
    expect(ladder.problems).toHaveLength(3);
    expect(ladder.examples.length).toBeGreaterThan(0);
    expect(drawLadderFrom("test_none", [never], 3, 1)).toEqual({ problems: [], examples: [] });
    expect(drawLadderFrom("test_none", [], 3, 1)).toEqual({ problems: [], examples: [] });
  });
});

describe("a topic's set", () => {
  it("4 different problems, easy to hard, and examples none of them are; the same seed, the same set", () => {
    for (const id of TOPIC_IDS) {
      for (const seed of SEEDS) {
        const set = topicSet(id, TOPIC_PROBLEMS, seed);
        expect(set.problems, `${id} ${seed}`).toHaveLength(TOPIC_PROBLEMS);
        expect(set.examples.length, `${id} ${seed}`).toBeGreaterThan(0);
        const keys = [...set.problems, ...set.examples].map((p) => p.join("; "));
        expect(new Set(keys).size, `${id} ${seed}`).toBe(keys.length);
        expect(topicSet(id, TOPIC_PROBLEMS, seed), id).toEqual(set);
      }
    }
  });

  it("the first problem is from the easiest form, like the example; the last from the hardest", () => {
    const skill = "two_step_equations";
    const forms = formsFor(skill);
    const ranked = rankForms(skill, forms);
    const set = topicSet(skill, TOPIC_PROBLEMS, 7);
    // what each problem looks like: the easiest form's ax + b = c, the hardest's \frac{ax}{b} + c = d
    expect(set.problems[0][0]).toMatch(/^\d+x \+ \d+ = -?\d+$/);
    expect(set.examples[0][0]).toMatch(/^\d+x \+ \d+ = -?\d+$/);
    expect(ranked[0]).toBe(0);
    expect(set.problems[TOPIC_PROBLEMS - 1][0]).toMatch(/^\\frac\{\d+x\}\{\d+\}/);
  });

  it("an unknown skill makes nothing", () => {
    expect(topicSet("word_problems", 4, 1)).toEqual({ skill: "word_problems", problems: [], examples: [] });
  });

  it("every problem and example is one the board chat writes (the engine checks it, the hand writes it)", () => {
    for (const id of TOPIC_IDS) {
      for (const seed of SEEDS) {
        const set = topicSet(id, TOPIC_PROBLEMS, seed);
        for (const p of [...set.problems, ...set.examples]) expect(verifyProblem(engine, p, canDraw).ok, `${id} ${seed}: ${p.join("; ")}`).toBe(true);
      }
    }
  });
});

describe("the worked example", () => {
  it("compares steps as the board does (normalizeStep)", () => {
    for (const s of ["x = 4", "\\boxed{x = 4}", "2 \\cdot 3", "\\left( x + 1 \\right)", "= \\frac{3}{4}", "x\\,=\\,2"]) expect(sameStep(s), s).toBe(normalizeStep(s));
  });

  it("every topic's example is worked out on the device: no model, no ink", () => {
    for (const id of TOPIC_IDS) {
      for (const seed of SEEDS) {
        const set = topicSet(id, TOPIC_PROBLEMS, seed);
        const example = pickLocalExample(engine, set.examples);
        expect(example, `${id} ${seed}`).not.toBeNull();
        // the very first candidate, from the easiest form
        expect(example, `${id} ${seed}`).toEqual(set.examples[0]);
        expect(localWorkFor(engine, example!).length, `${id} ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it("a candidate the engine cannot work out is passed over; none: no example", () => {
    const words = ["A train leaves at 3 and travels 60 miles"];
    expect(localWorkFor(engine, words)).toEqual([]);
    expect(pickLocalExample(engine, [words, ["2x + 3 = 11"]])).toEqual(["2x + 3 = 11"]);
    expect(pickLocalExample(engine, [words])).toBeNull();
    expect(pickLocalExample(engine, [])).toBeNull();
  });
});
