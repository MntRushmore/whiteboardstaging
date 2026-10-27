import { describe, expect, it } from "vitest";
import { BUG_RULES, bugAnswers, matchBug, bugRule, type BugId } from "../bugs";
import { ANSWER_LINE, check, judgeStep } from "../check";
import { nudgeFor, workedFor } from "../copy";
import { generateMixed, generateSet, keysItemFromText, KEYS_SKILLS, variantItem } from "../generate";
import { answerCells, answersEqual, canonicalAnswer, patchAnswer, type MathItem } from "../item";
import { boxMax, boxStep, shrink } from "../shrink";
import { cellLabel, lookAgainWhere } from "../a11y";
import { cellById } from "../item";
import { openStep, problemReducer, rootValues, startProblem, type ProblemAction, type ProblemState } from "../session";

const item = (text: string): MathItem => {
  const it = keysItemFromText(text);
  if (!it) throw new Error(`no item for ${text}`);
  return it;
};
const run = (s: ProblemState, ...actions: ProblemAction[]) => actions.reduce(problemReducer, s);

/** Every bug: a problem where it applies, and the wrong answer a kid following it writes. */
const CASES: [BugId, string, string][] = [
  ["add_forgot_carry", "47 + 38", "75"],
  ["add_carry_twice", "47 + 38", "95"],
  ["add_whole_column_sum", "47 + 38", "715"],
  ["add_swapped_places", "47 + 38", "58"],
  ["sub_smaller_from_larger", "53 - 27", "34"],
  ["sub_forgot_borrow", "53 - 27", "30"],
  ["sub_borrow_no_reduce", "53 - 27", "36"],
  ["sub_borrow_across_zero", "403 - 128", "375"],
  ["sub_added_instead", "52 - 27", "79"],
  ["mul_added_instead", "6 x 7", "13"],
  ["mul_one_group_short", "6 x 7", "36"],
  ["mul_one_group_over", "6 x 7", "48"],
  ["mul_tens_dropped_zero", "40 x 6", "24"],
  ["mul_tens_extra_zero", "40 x 6", "2400"],
  ["mul_forgot_carry", "46 x 7", "282"],
  ["mul_carry_added_first", "46 x 7", "562"],
  ["mul_no_placeholder", "34 x 26", "272"],
  ["mul_ones_only", "34 x 26", "204"],
  ["mul_column_by_column", "34 x 26", "624"],
  ["frac_added_denominators", "2/7 + 3/7", "5/14"],
  ["frac_not_scaled_numerator", "3/4 + 1/6", "4/12"],
  ["frac_multiplied_denominators", "3/4 + 1/6", "4/24"],
  ["eqv_added_same", "3/4 = ?/12", "11"],
  ["eqv_copied_numerator", "2/5 = ?/15", "2"],
  ["eqv_wrote_factor", "2/5 = ?/15", "3"],
  ["eq_same_operation", "x + 7 = 15", "22"],
  ["eq_sign_error", "x + 7 = 15", "-8"],
  ["eq_subtracted_coefficient", "3x = 12", "9"],
];

describe("the bug library", () => {
  it("has about 25 rules, every one with a case here", () => {
    expect(BUG_RULES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(CASES.map((c) => c[0]))).toEqual(new Set(BUG_RULES.map((r) => r.id)));
  });

  it.each(CASES)("%s: generates the kid's wrong answer on %s (%s) and is matched", (id, text, wrong) => {
    const it = item(text);
    expect(bugRule(id).produce(it)).toBe(wrong);
    expect(matchBug(it, wrong)).toBe(id);
    expect(answersEqual(it, canonicalAnswer(it, wrong))).toBe(false);
    // the right answer matches no rule
    expect(matchBug(it, it.answer)).toBeNull();
  });

  it("matches a wrong fraction in any equal form, and never an equal right one", () => {
    expect(matchBug(item("3/4 + 1/6"), "5/12")).toBeNull();
    // 2/12 is 4/24 in its lowest terms: the multiplied bottoms, simplified
    expect(matchBug(item("3/4 + 1/6"), "2/12")).toBe("frac_multiplied_denominators");
    expect(matchBug(item("3/4 + 1/6"), "1/3")).toBe("frac_not_scaled_numerator");
    expect(matchBug(item("3/4 + 1/6"), "22/24")).toBeNull();
    expect(matchBug(item("2/7 + 3/7"), "10/28")).toBe("frac_added_denominators");
  });

  it("every rule's answer, on every generated problem, names a rule that gives it", () => {
    for (const skill of KEYS_SKILLS) {
      for (let seed = 1; seed <= 12; seed++) {
        for (const it of generateSet(seed, 5, skill)) {
          for (const [id, a] of Object.entries(bugAnswers(it))) {
            const named = matchBug(it, a!);
            expect(named, `${it.text}: ${id} gives ${a}`).not.toBeNull();
            expect(bugRule(named!).produce(it)).toBeDefined();
          }
        }
      }
    }
  });
});

describe("the new problems", () => {
  it("sets out a difference with a regroup row: 403 − 128", () => {
    const it = item("403 - 128");
    expect(it).toMatchObject({ kind: "difference", answer: "275", skill: "add_subtract_within_1000" });
    expect(answerCells(it).map((c) => c.id)).toEqual(["r2", "r1", "r0"]);
    // the regroup boxes: the hundreds become 3, the 0 tens become 9
    const r = check(it, { values: { g2: "3", g1: "9", r0: "5", r1: "7", r2: "2" }, answer: "" });
    expect(r.ok).toBe(true);
    expect(check(it, { values: { g1: "0" }, answer: "275" }).wrongCells).toEqual(["g1"]);
  });

  it("sets out a two-row product with the placeholder zero: 34 × 26", () => {
    const it = item("34 x 26");
    expect(it.layout.kind === "columns" && it.layout.lines.map((l) => l.id)).toEqual(["a", "b", "p0", "p1", "result"]);
    const v = { p0_0: "4", p0_1: "0", p0_2: "2", p1_0: "0", p1_1: "8", p1_2: "6", r0: "4", r1: "8", r2: "8" };
    const r = check(it, { values: v, answer: "" });
    expect(r.ok).toBe(true);
    expect(r.marks).toMatchObject({ p0: "tick", p1: "tick", result: "tick" });
    // 68 written under 204 with no placeholder: the row is ringed, the sum is the bug's
    const slip = check(it, { values: { ...v, p1_0: "8", p1_1: "6", p1_2: "", r0: "2", r1: "7", r2: "2" }, answer: "" });
    expect(slip.marks.p1).toBe("ring");
    expect(matchBug(it, slip.answer)).toBe("mul_no_placeholder");
  });

  it("takes any equal fraction for a sum and judges the two boxes together", () => {
    const it = item("3/4 + 1/6");
    expect(it.answer).toBe("11/12");
    expect(check(it, { values: { rn: "22", rd: "24" }, answer: "" }).ok).toBe(true);
    expect(check(it, { values: { rn: "4", rd: "12" }, answer: "" }).wrongCells).toEqual(["rn"]);
    expect(check(it, { values: { rn: "4", rd: "10" }, answer: "" }).wrongCells).toEqual(["rd", "rn"]);
    expect(check(it, { values: {}, answer: "11 / 12" }).ok).toBe(true);
    // the bottoms added: the 14 is ringed, the 5 on top is right
    expect(check(item("2/7 + 3/7"), { values: { rn: "5", rd: "14" }, answer: "" }).wrongCells).toEqual(["rd"]);
  });

  it("reads an equivalent fraction's answer as its top", () => {
    const it = item("3/4 = ?/12");
    expect(canonicalAnswer(it, "9/12")).toBe("9");
    expect(check(it, { values: { rn: "9" }, answer: "" }).ok).toBe(true);
  });

  it("solves an equation on typed lines: steps true for x get a tick", () => {
    const it = item("x + 7 = 15");
    expect(it.layout.kind).toBe("lines");
    expect(canonicalAnswer(it, "x = 8")).toBe("8");
    const r = check(it, { values: {}, answer: "x=8", steps: ["x + 7 - 7 = 15 - 7", "x = 15 + 7", "x = 8"] });
    expect(r.ok).toBe(true);
    expect(r.marks).toMatchObject({ "step:0": "tick", "step:1": "ring", "step:2": "tick" });
    expect(judgeStep("3x = 12", { letter: "x", value: 4 })).toBe("tick");
    expect(judgeStep("3x = 9", { letter: "x", value: 4 })).toBe("ring");
  });

  it("parses every kind, and keeps adding as it was", () => {
    expect(item("47+38").kind).toBe("sum");
    expect(item("26+?6=92").kind).toBe("missing_addend");
    expect(item("5 + x = 12")).toMatchObject({ kind: "equation", answer: "7" });
    expect(item("x - 4 = 9").answer).toBe("13");
    expect(keysItemFromText("hello")).toBeNull();
  });

  it("generates every skill: clean, different, the same for the same seed", () => {
    for (const skill of KEYS_SKILLS) {
      const a = generateSet(20261027, 5, skill);
      expect(a.map((i) => i.id)).toEqual(generateSet(20261027, 5, skill).map((i) => i.id));
      expect(new Set(a.map((i) => i.id)).size).toBe(5);
      for (const it of a) {
        expect(it.skill === skill || (skill === "add_within_100" && it.skill === "add_within_100")).toBe(true);
        expect(check(it, { values: {}, answer: it.answer }).ok, it.text).toBe(true);
      }
    }
    const mixed = generateMixed(5, ["times_tables", "add_fractions_like", "one_step_equations"]);
    expect(mixed.map((i) => i.skill)).toEqual(["times_tables", "add_fractions_like", "one_step_equations"]);
  });

  it("a Now you try keeps the shape: a two-row product gets a two-row product", () => {
    const v = variantItem(item("34 x 26"), 9)!;
    expect(v.kind).toBe("product");
    expect(v.math?.kind === "multiply" && v.math.b).toBeGreaterThanOrEqual(10);
    const e = variantItem(item("3x = 12"), 9)!;
    expect(e.math?.kind === "equation" && e.math.form).toBe("ax");
  });

  it("patches several digits of a typed answer at once", () => {
    expect(patchAnswer(item("40 x 6"), "200", 1, "24")).toBe("240");
    expect(patchAnswer(item("47 + 38"), "75", 1, "8")).toBe("85");
  });
});

describe("the smaller problems and the words", () => {
  /**
   * Every bug with a smaller problem (the kid typed only the answer): its line, what goes back up
   * (cells, or the answer row), and whether that solves the problem (a borrow fixed in the ones can
   * leave the tens to look at again).
   */
  const SMALLER: [BugId, string, string, string, Record<string, string>, boolean][] = [
    ["sub_forgot_borrow", "53 - 27", "30", "13 − 7 = ?", { r0: "6" }, false],
    ["sub_smaller_from_larger", "53 - 27", "34", "13 − 7 = ?", { r0: "6" }, false],
    ["sub_borrow_no_reduce", "53 - 27", "36", "5 − 1 − 2 = ?", { r1: "2" }, true],
    ["sub_borrow_across_zero", "403 - 128", "375", "4 − 1 − 1 = ?", { r2: "2" }, true],
    ["mul_added_instead", "6 x 7", "13", "30 + 12 = ?", { r0: "2", r1: "4" }, true],
    ["mul_tens_dropped_zero", "40 x 6", "24", "4 × 6 = ?", { r0: "0", r1: "4", r2: "2" }, true],
    ["mul_tens_extra_zero", "40 x 6", "2400", "4 × 6 = ?", { r0: "0", r1: "4", r2: "2", r3: "" }, true],
    ["mul_forgot_carry", "46 x 7", "282", "4 × 7 + 4 = ?", { r1: "2", r2: "3" }, true],
    ["mul_no_placeholder", "34 x 26", "272", "34 × 20 = ?", { p1_0: "0", p1_1: "8", p1_2: "6" }, false],
    ["frac_added_denominators", "2/7 + 3/7", "5/14", "2 + 3 = ?", { rn: "5", rd: "7" }, true],
    ["frac_not_scaled_numerator", "3/4 + 1/6", "4/12", "9 + 2 = ?", { rn: "11", rd: "12" }, true],
    ["eqv_added_same", "3/4 = ?/12", "11", "3 × 3 = ?", { rn: "9" }, true],
    ["eq_same_operation", "x + 7 = 15", "22", "15 − 7 = ?", {}, true],
    ["eq_subtracted_coefficient", "3x = 12", "9", "12 ÷ 3 = ?", {}, true],
  ];

  it.each(SMALLER)("%s on %s: %s → the smaller problem %s, its answer back up", (bug, text, wrong, smaller, cells, solves) => {
    let s = run(startProblem(item(text)), { type: "answer", value: wrong }, { type: "check" });
    expect(s.bug).toBe(bug);
    s = run(s, { type: "help" }, { type: "help" });
    const open = openStep(s);
    expect(open?.step.item.text).toBe(smaller);
    s = run(s, { type: "sub_cell", id: "x", value: open!.step.item.answer }, { type: "sub_check" });
    expect(openStep(s)).toBeNull();
    expect(rootValues(s)).toMatchObject(cells);
    expect(s.phase === "done", `${s.answer} ${JSON.stringify(rootValues(s))}`).toBe(solves);
    if (!solves) expect(s.phase).toBe("look_again");
  });

  it("the manipulatives build the box with Space: an area model adds a row at a time", () => {
    const step = shrink(item("6 x 7"), "mul_added_instead")!;
    expect(step.manipulative).toEqual({ kind: "area", rows: 6, cols: 7, split: 5 });
    expect(boxStep(step.manipulative)).toBe(7);
    expect(boxMax(step.manipulative, 42)).toBe(42);
    const line = shrink(item("x + 7 = 15"), "eq_same_operation")!;
    expect(line.manipulative).toMatchObject({ kind: "number_line", start: 15 });
    expect(line.target).toMatchObject({ answer: true });
    expect(shrink(item("2/7 + 3/7"), "frac_added_denominators")!.target.also).toEqual({ rd: "7" });
  });

  it("every bug has a nudge and a worked step in the tutor's words, never 'wrong'", () => {
    for (const [id, text] of CASES) {
      const it = item(text);
      for (const line of [nudgeFor(it, id), workedFor(it, id), nudgeFor(it, null)]) {
        expect(line.length, `${id}: ${line}`).toBeGreaterThan(5);
        expect(line).not.toMatch(/wrong|incorrect|!/i);
      }
    }
    expect(nudgeFor(item("52 - 27"), "sub_forgot_borrow")).toBe("2 is less than 7. Regroup: 1 ten is 10 ones.");
    expect(workedFor(item("52 - 27"), "sub_forgot_borrow")).toBe("After regrouping, the ones have 12. 12 − 7 = 5. Write the 5 in the ones.");
    expect(workedFor(item("x + 7 = 15"), null)).toBe("x = 15 − 7 = 8.");
  });

  it("an equation's answer row is where its help points", () => {
    const s = run(startProblem(item("x + 7 = 15")), { type: "answer", value: "22" }, { type: "check" }, { type: "help" });
    expect(s.help).toMatchObject({ kind: "nudge", under: ANSWER_LINE, text: "To undo + 7, take 7 away." });
  });
});

describe("what a screen reader hears", () => {
  it("names every cell by where it is and what it holds", () => {
    const sum = item("47 + 38");
    expect(cellLabel(sum, cellById(sum, "r1")!, "", false)).toBe("Tens digit of the answer, empty");
    expect(cellLabel(sum, cellById(sum, "r0")!, "5", true)).toBe("Ones digit of the answer, 5. Look again.");
    expect(cellLabel(sum, cellById(sum, "c1")!, "", false)).toBe("Carry into the tens, empty");
    const sub = item("403 - 128");
    expect(cellLabel(sub, cellById(sub, "g1")!, "9", false)).toBe("Tens digit after regrouping, 9");
    const long = item("34 x 26");
    expect(cellLabel(long, cellById(long, "p1_0")!, "", false)).toBe("Ones digit of the second row, empty");
    const frac = item("2/7 + 3/7");
    expect(cellLabel(frac, cellById(frac, "rd")!, "7", false)).toBe("Bottom of your fraction (the denominator), 7");
    expect(cellLabel(item("26 + ?6 = 92"), cellById(item("26 + ?6 = 92"), "b1")!, "", false)).toBe("Missing tens digit, empty");
    expect(lookAgainWhere(sum, ["r1"])).toBe("Look again at the tens digit of the answer.");
  });
});
