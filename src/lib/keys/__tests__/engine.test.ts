import { describe, expect, it } from "vitest";
import { bugAnswers, matchBug } from "../bugs";
import { ANSWER_LINE, check, evaluate, judgeStep, stepLine } from "../check";
import { KEYS_COPY, nudgeFor } from "../copy";
import { daySeed, generateSet, itemsFromList } from "../generate";
import {
  allCells,
  answerFromWork,
  canonicalAnswer,
  carryInto,
  factItem,
  itemFromText,
  kidCells,
  missingAddendItem,
  patchAnswer,
  sumItem,
  type ColumnsLayout,
  type MathItem,
} from "../item";
import { shrink } from "../shrink";
import { carryBack, pushStep, rootStack, setValue, top } from "../stack";

const columns = (item: MathItem) => item.layout as ColumnsLayout;
const must = (item: MathItem | null): MathItem => {
  if (!item) throw new Error("no item");
  return item;
};

describe("item", () => {
  it("lays out 47 + 38 as a column with a carry row and a spare cell", () => {
    const item = sumItem(47, 38);
    expect(item.text).toBe("47 + 38");
    expect(item.answer).toBe("85");
    expect(item.skill).toBe("add_within_100");
    const layout = columns(item);
    expect(layout.places).toBe(3);
    expect(layout.lines.map((l) => l.id)).toEqual(["carry", "a", "b", "result"]);
    expect(layout.lines[2].op).toBe("+");
    const carry = layout.lines[0].cells;
    expect(carry.map((c) => c?.id ?? null)).toEqual([null, "c1", null]);
    expect(carry[1]?.expect).toBe("1");
    const result = layout.lines[3].cells;
    expect(result.map((c) => [c?.id, c?.expect, c?.spare ?? false])).toEqual([
      ["r2", "", true],
      ["r1", "8", false],
      ["r0", "5", false],
    ]);
    expect(kidCells(item).map((c) => c.id)).toEqual(["c1", "r2", "r1", "r0"]);
  });

  it("lays out 26 + ?6 = 92 with a box for the missing tens digit", () => {
    const item = must(itemFromText("26 + ?6 = 92"));
    expect(item.kind).toBe("missing_addend");
    expect(item.text).toBe("26 + ?6 = 92");
    expect(item.answer).toBe("6");
    expect(item.hidden).toEqual({ addend: 1, place: 1, template: "?6" });
    const b = columns(item).lines[2];
    expect(b.cells.map((c) => [c?.id, c?.role])).toEqual([
      ["b1", "blank"],
      ["b0", "given"],
    ]);
    expect(columns(item).lines[3].cells.map((c) => c?.value)).toEqual(["9", "2"]);
    expect(allCells(item).filter((c) => c.role === "carry").map((c) => [c.id, c.expect])).toEqual([["c1", "1"]]);
    expect(item.words).toContain("Find the missing tens digit");
  });

  it("reads problems from text and refuses ones that do not add up", () => {
    expect(itemFromText("47+38")?.answer).toBe("85");
    expect(itemFromText("47 + 38 = ?")?.answer).toBe("85");
    expect(itemFromText("?6 + 26 = 92")?.text).toBe("26 + ?6 = 92");
    expect(itemFromText("26 + ?6 = 93")).toBeNull();
    expect(itemFromText("2? + ?6 = 92")).toBeNull();
    expect(itemFromText("47 - 38")).toBeNull();
    expect(itemsFromList("26 ?6=92|47 38|nope").map((i) => i.text)).toEqual(["26 + ?6 = 92", "47 + 38"]);
  });

  it("writes a fact line with one box", () => {
    const fact = factItem([1, 2, null], 9);
    expect(fact.text).toBe("1 + 2 + ? = 9");
    expect(fact.answer).toBe("6");
    expect(fact.words).toBe("1 plus 2 plus blank equals 9");
    expect(factItem([1, 4, 3], null).answer).toBe("8");
    expect(() => factItem([1, null], null)).toThrow();
  });

  it("reads the answer from the work, and the kid's answer in the item's form", () => {
    const item = sumItem(47, 38);
    expect(answerFromWork(item, { r0: "5" })).toBeNull();
    expect(answerFromWork(item, { r0: "5", r1: "8" })).toBe("85");
    expect(answerFromWork(item, { r0: "5", r1: "1", r2: "7" })).toBe("715");
    const miss = missingAddendItem(26, 66);
    expect(canonicalAnswer(miss, "66")).toBe("6");
    expect(canonicalAnswer(miss, " 7 ")).toBe("7");
    expect(canonicalAnswer(miss, "76")).toBe("7");
    expect(canonicalAnswer(item, "085")).toBe("85");
    expect(patchAnswer(item, "75", 1, "8")).toBe("85");
    expect(patchAnswer(miss, "76", 1, "6")).toBe("66");
    expect(patchAnswer(miss, "7", 1, "6")).toBe("6");
  });

  it("knows where a carry is due", () => {
    expect(carryInto([47, 38], 1)).toBe(1);
    expect(carryInto([41, 38], 1)).toBe(0);
    expect(carryInto([78, 56], 2)).toBe(1);
  });
});

describe("generate", () => {
  it("is the same for the same seed and different for another", () => {
    expect(generateSet(7).map((i) => i.text)).toEqual(generateSet(7).map((i) => i.text));
    expect(generateSet(7).map((i) => i.text)).not.toEqual(generateSet(8).map((i) => i.text));
  });

  it("makes five different carrying problems under 100, sums and missing digits", () => {
    for (let seed = 0; seed < 300; seed++) {
      const set = generateSet(seed);
      expect(set).toHaveLength(5);
      expect(set.map((i) => i.kind)).toEqual(["sum", "sum", "missing_addend", "sum", "missing_addend"]);
      expect(new Set(set.map((i) => i.addends.join("+"))).size).toBe(5);
      for (const item of set) {
        const [a, b] = item.addends;
        expect(a).toBeGreaterThanOrEqual(11);
        expect(b).toBeGreaterThanOrEqual(11);
        expect(item.total).toBeLessThan(100);
        expect(carryInto(item.addends, 1)).toBe(1);
        expect(item.skill).toBe("add_within_100");
        // every bug that applies gives its own answer, none the right one
        const answers = Object.values(bugAnswers(item));
        expect(new Set(answers).size).toBe(answers.length);
        expect(answers).not.toContain(item.answer);
        // and "forgot the carry" always has a smaller problem
        expect(shrink(item, "add_forgot_carry")).not.toBeNull();
      }
    }
  });

  it("seeds a day from its date", () => {
    expect(daySeed(new Date("2026-10-27T12:00:00Z"))).toBe(20261027);
  });
});

describe("check", () => {
  const item = sumItem(47, 38);

  it("ticks a right column and the answer it carries", () => {
    const r = check(item, { values: { r0: "5", r1: "8", c1: "1" }, answer: "" });
    expect(r).toMatchObject({ ready: true, ok: true, answer: "85", answerOk: true, wrongCells: [], firstBadLine: null });
    expect(r.marks).toEqual({ result: "tick", [ANSWER_LINE]: "tick" });
  });

  it("rings the cell that broke; the answer carried from it gets no mark", () => {
    const r = check(item, { values: { r0: "5", r1: "7" }, answer: "75" });
    expect(r.ok).toBe(false);
    expect(r.wrongCells).toEqual(["r1"]);
    expect(r.firstBadLine).toBe("result");
    expect(r.marks).toEqual({ result: "ring" });
  });

  it("rings an answer typed on its own", () => {
    const r = check(item, { values: {}, answer: "75" });
    expect(r.wrongCells).toEqual([]);
    expect(r.emptyCells).toEqual(["r1", "r0"]);
    expect(r.marks).toEqual({ [ANSWER_LINE]: "ring" });
    expect(r.firstBadLine).toBe(ANSWER_LINE);
  });

  it("judges carries only when filled, and leaves empty cells alone", () => {
    expect(check(item, { values: { c1: "2", r0: "5", r1: "8" }, answer: "" }).wrongCells).toEqual(["c1"]);
    expect(check(item, { values: { r0: "5" }, answer: "" }).ready).toBe(false);
    expect(check(item, { values: { r0: "5", r1: "8", r2: "0" }, answer: "" }).ok).toBe(true);
    expect(check(item, { values: { r0: "5", r1: "8", r2: "1" }, answer: "" }).wrongCells).toEqual(["r2"]);
  });

  it("judges typed steps as sums", () => {
    const r = check(item, { values: { r0: "5", r1: "8" }, answer: "", steps: ["7 + 8 = 15", "4 + 3 = 8", "carry the 1", "1 + 4 + 3 ="] });
    expect(r.marks[stepLine(0)]).toBe("tick");
    expect(r.marks[stepLine(1)]).toBe("ring");
    expect(r.marks[stepLine(2)]).toBeUndefined();
    expect(r.marks[stepLine(3)]).toBeUndefined();
    // a false step is ringed but does not undo a right answer
    expect(r.ok).toBe(true);
    expect(r.firstBadLine).toBe(stepLine(1));
  });

  it("evaluates plain arithmetic only", () => {
    expect(judgeStep("6 × 2 = 12")).toBe("tick");
    expect(judgeStep("12 ÷ 4 = 3 = 1 + 2")).toBe("tick");
    expect(judgeStep("(1+2)*3 = 10")).toBe("ring");
    expect(evaluate("2+3*4")).toBe(14);
    expect(evaluate("-3+5")).toBe(2);
    expect(evaluate("4/0")).toBeNull();
    expect(evaluate("2+")).toBeNull();
    expect(evaluate("y+2")).toBeNull();
  });
});

describe("bugs", () => {
  it("names each of the four addition bugs on 47 + 38", () => {
    const item = sumItem(47, 38);
    expect(bugAnswers(item)).toEqual({
      add_forgot_carry: "75",
      add_carry_twice: "95",
      add_whole_column_sum: "715",
      add_swapped_places: "58",
    });
    expect(matchBug(item, "75")).toBe("add_forgot_carry");
    expect(matchBug(item, "95")).toBe("add_carry_twice");
    expect(matchBug(item, "715")).toBe("add_whole_column_sum");
    expect(matchBug(item, "58")).toBe("add_swapped_places");
    expect(matchBug(item, "85")).toBeNull();
    expect(matchBug(item, "84")).toBeNull();
    expect(matchBug(item, "")).toBeNull();
  });

  it("names the carry bugs on a missing digit", () => {
    const item = must(itemFromText("26 + ?6 = 92"));
    expect(bugAnswers(item)).toEqual({ add_forgot_carry: "7", add_carry_twice: "5" });
    expect(matchBug(item, "7")).toBe("add_forgot_carry");
    expect(matchBug(item, "76")).toBe("add_forgot_carry");
    expect(matchBug(item, "5")).toBe("add_carry_twice");
    expect(matchBug(item, "6")).toBeNull();
  });

  it("never matches a rule that gives the right answer", () => {
    // 44 + 33 has no carry: forgetting it, adding it twice and swapping 77 all give 77.
    const item = sumItem(44, 33);
    expect(bugAnswers(item)).toEqual({});
    expect(matchBug(item, "77")).toBeNull();
  });

  it("works past two digits", () => {
    expect(bugAnswers(sumItem(78, 56))).toEqual({
      add_forgot_carry: "124",
      add_carry_twice: "144",
      add_whole_column_sum: "1214",
      add_swapped_places: "143",
    });
  });
});

describe("shrink", () => {
  it("writes 1 + 2 + ? = 9 for 26 + ?6 = 92, with tens to build", () => {
    const item = must(itemFromText("26 + ?6 = 92"));
    const step = shrink(item, "add_forgot_carry", "b1");
    expect(step).not.toBeNull();
    expect(step!.item.text).toBe("1 + 2 + ? = 9");
    expect(step!.item.answer).toBe("6");
    expect(step!.lead).toBe("carry_is_ten");
    expect(KEYS_COPY.lead[step!.lead]).toBe("The 1 you carried is a ten.");
    expect(step!.target).toEqual({ cellId: "b1", place: 1 });
    expect(step!.under).toBe("b");
    expect(step!.manipulative).toEqual({
      kind: "base_ten",
      unit: "ten",
      groups: [{ count: 1, carried: true }, { count: 2 }, { count: 6, box: true }],
    });
  });

  it("writes 1 + 4 + 3 = ? for 47 + 38", () => {
    const step = shrink(sumItem(47, 38), "add_forgot_carry", "r1");
    expect(step!.item.text).toBe("1 + 4 + 3 = ?");
    expect(step!.target).toEqual({ cellId: "r1", place: 1 });
    expect(step!.under).toBe("result");
  });

  it("has nothing yet for the other bugs, or a column that carries again", () => {
    expect(shrink(sumItem(47, 38), "add_carry_twice")).toBeNull();
    expect(shrink(sumItem(47, 38), "add_swapped_places")).toBeNull();
    expect(shrink(sumItem(78, 56), "add_forgot_carry", "r1")).toBeNull();
  });
});

describe("stack", () => {
  it("carries a solved smaller problem's answer back into its cell", () => {
    const item = must(itemFromText("26 + ?6 = 92"));
    const step = shrink(item, "add_forgot_carry", "b1")!;
    let stack = pushStep(rootStack(item, { b1: "7" }), step);
    expect(stack).toHaveLength(2);
    expect(carryBack(stack)).toBeNull();
    stack = setValue(stack, "x", "5");
    expect(carryBack(stack)).toBeNull();
    stack = setValue(stack, "x", "6");
    const back = carryBack(stack)!;
    expect(back).toMatchObject({ cellId: "b1", place: 1, value: "6" });
    expect(back.stack).toHaveLength(1);
    expect(top(back.stack).values).toEqual({ b1: "6" });
    expect(back.solved.values).toEqual({ x: "6" });
  });

  it("has nothing to carry from the big problem alone", () => {
    expect(carryBack(rootStack(sumItem(47, 38)))).toBeNull();
  });
});

describe("copy", () => {
  it("nudges by bug, in a coach's words, never 'wrong'", () => {
    const item = sumItem(47, 38);
    const lines = [null, "add_forgot_carry", "add_carry_twice", "add_whole_column_sum", "add_swapped_places"].map((b) =>
      nudgeFor(item, b as Parameters<typeof nudgeFor>[1]),
    );
    expect(lines[0]).toBe("Start with the ones. What is 7 + 8?");
    expect(lines[3]).toBe("15 ones is 1 ten and 5 ones. Write the 5. Carry the 1.");
    expect(JSON.stringify([lines, KEYS_COPY]).toLowerCase()).not.toContain("wrong");
    expect(nudgeFor(must(itemFromText("26 + ?6 = 92")), null)).toBe("Start with the ones. 6 + 6 is 12. Where does the 1 go?");
  });
});
