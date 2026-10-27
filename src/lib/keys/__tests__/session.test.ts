import { describe, expect, it } from "vitest";
import { ANSWER_LINE } from "../check";
import { KEYS_COPY } from "../copy";
import { itemFromText, sumItem, type MathItem } from "../item";
import { afterDigit, carryFor, firstCell, gridMove, intentFor, isBottomRow } from "../keymap";
import {
  openStep,
  outcomeOf,
  ownOf,
  problemReducer,
  rootValues,
  setReducer,
  starsOf,
  startProblem,
  startSet,
  type ProblemAction,
  type ProblemState,
  type SetAction,
} from "../session";

const must = (item: MathItem | null): MathItem => {
  if (!item) throw new Error("no item");
  return item;
};
const run = (s: ProblemState, ...actions: ProblemAction[]) => actions.reduce(problemReducer, s);

/** What the page shows in its banner for a state (KeysPage reads the same fields). */
function banner(s: ProblemState): string | null {
  if (s.notice === "write_first") return KEYS_COPY.writeFirst;
  if (s.phase === "done") return KEYS_COPY.gotIt;
  if (s.phase === "look_again" || s.subMark === "ring") return KEYS_COPY.lookAgain;
  return null;
}

describe("the journey: 26 + ?6 = 92", () => {
  it("7 → forgot the carry → Look again → Help me → 1 + 2 + ? = 9 → 6 → carried back up → tick → You got it.", () => {
    let s = startProblem(must(itemFromText("26 + ?6 = 92")));
    expect(s.phase).toBe("working");

    // The kid types 7 in the box and presses Enter twice: the answer row takes it, then it is checked.
    s = run(s, { type: "cell", id: "b1", value: "7" }, { type: "fill_answer" });
    expect(s.answer).toBe("7");
    expect(s.marks).toEqual({});
    s = run(s, { type: "check" });
    expect(s.phase).toBe("look_again");
    expect(s.bug).toBe("add_forgot_carry");
    expect(s.ringed).toEqual(["b1"]);
    expect(s.marks).toEqual({ b: "ring" });
    expect(s.marks[ANSWER_LINE]).toBeUndefined();
    expect(banner(s)).toBe("Look again.");

    // Help me, the first rung: a nudge, pointing at the tens column.
    s = run(s, { type: "help" });
    expect(s.help).toEqual({ kind: "nudge", text: "Did you add the 1 you carried?", under: "b", point: { line: "b", place: 1 } });
    expect(s.helpLevel).toBe(1);

    // Help me again: the smaller problem, under the line that broke, in the tutor's hand.
    s = run(s, { type: "help" });
    expect(s.phase).toBe("helping");
    expect(s.helpLevel).toBe(2);
    const open = openStep(s)!;
    expect(open.step.item.text).toBe("1 + 2 + ? = 9");
    expect(KEYS_COPY.lead[open.step.lead]).toBe("The 1 you carried is a ten.");
    expect(open.step.under).toBe("b");
    const blocks = open.step.manipulative;
    expect(blocks?.kind === "base_ten" ? blocks.groups.map((g) => g.count) : null).toEqual([1, 2, 6]);

    // A slip in the smaller problem gets its own Look again.
    s = run(s, { type: "sub_cell", id: "x", value: "7" }, { type: "sub_check" });
    expect(s.subMark).toBe("ring");
    expect(banner(s)).toBe("Look again.");
    expect(openStep(s)).not.toBeNull();

    // 6: carried back up into the big problem, which is checked again.
    s = run(s, { type: "sub_cell", id: "x", value: "6" }, { type: "sub_check" });
    expect(openStep(s)).toBeNull();
    expect(s.carried).toEqual({ cellId: "b1", value: "6" });
    expect(rootValues(s).b1).toBe("6");
    expect(s.answer).toBe("6");
    expect(s.solvedSteps.map((x) => [x.step.item.text, x.value])).toEqual([["1 + 2 + ? = 9", "6"]]);
    expect(s.phase).toBe("done");
    expect(s.marks).toEqual({ b: "tick", [ANSWER_LINE]: "tick" });
    expect(s.ringed).toEqual([]);
    expect(banner(s)).toBe("You got it.");
    expect(outcomeOf(s)).toBe("with_help");
  });
});

describe("a problem", () => {
  const item = sumItem(47, 38);

  it("is a first try when it is right at the first check", () => {
    const s = run(startProblem(item), { type: "cell", id: "r0", value: "5" }, { type: "cell", id: "r1", value: "8" }, { type: "check" });
    expect(s.phase).toBe("done");
    expect(s.answer).toBe("85");
    expect(outcomeOf(s)).toBe("first_try");
  });

  it("keeps the answer row with the column it was filled from, until the kid types in it", () => {
    let s = run(startProblem(item), { type: "cell", id: "r0", value: "8" }, { type: "cell", id: "r1", value: "5" }, { type: "fill_answer" });
    expect(s).toMatchObject({ answer: "58", answerFromWork: true });
    s = run(s, { type: "check" });
    expect(s.bug).toBe("add_swapped_places");
    s = run(s, { type: "cell", id: "r0", value: "5" }, { type: "cell", id: "r1", value: "8" });
    expect(s.answer).toBe("85");
    s = run(s, { type: "fill_answer" }, { type: "check" });
    expect(s.phase).toBe("done");
    expect(outcomeOf(s)).toBe("self_corrected");

    const typed = run(startProblem(item), { type: "answer", value: "84" }, { type: "cell", id: "r0", value: "5" }, { type: "cell", id: "r1", value: "8" }, { type: "fill_answer" });
    expect(typed).toMatchObject({ answer: "84", answerFromWork: false });
  });

  it("waits for an answer before it judges", () => {
    const s = run(startProblem(item), { type: "cell", id: "r0", value: "5" }, { type: "check" });
    expect(s.notice).toBe("write_first");
    expect(s.phase).toBe("working");
    expect(s.counts.checks).toBe(0);
    expect(banner(s)).toBe(KEYS_COPY.writeFirst);
  });

  it("takes a line's ring off when the kid types in it, and is self-corrected when fixed", () => {
    let s = run(startProblem(item), { type: "cell", id: "r0", value: "5" }, { type: "cell", id: "r1", value: "9" }, { type: "check" });
    expect(s.bug).toBe("add_carry_twice");
    expect(s.marks.result).toBe("ring");
    s = run(s, { type: "cell", id: "r1", value: "8" });
    expect(s.marks.result).toBeUndefined();
    expect(s.ringed).toEqual([]);
    expect(s.phase).toBe("working");
    s = run(s, { type: "check" });
    expect(s.phase).toBe("done");
    expect(outcomeOf(s)).toBe("self_corrected");
  });

  it("nudges in words for a bug with no smaller problem", () => {
    let s = run(startProblem(item), { type: "answer", value: "715" }, { type: "check" });
    expect(s.bug).toBe("add_whole_column_sum");
    expect(s.marks).toEqual({ [ANSWER_LINE]: "ring" });
    s = run(s, { type: "help" });
    expect(s.help).toEqual({ kind: "nudge", text: "15 ones is 1 ten and 5 ones. Write the 5. Carry the 1.", under: ANSWER_LINE, point: { line: ANSWER_LINE, place: null } });
    s = run(s, { type: "answer", value: "85" }, { type: "check" });
    expect(s.phase).toBe("done");
    expect(s.help).toBeNull();
    expect(outcomeOf(s)).toBe("with_help");
  });

  it("checks first when Help me comes before any check", () => {
    const right = run(startProblem(item), { type: "answer", value: "85" }, { type: "help" });
    expect(right.phase).toBe("done");
    expect(outcomeOf(right)).toBe("first_try");
    const empty = run(startProblem(item), { type: "help" });
    expect(empty.help).toEqual({ kind: "nudge", text: "Start with the ones. What is 7 + 8?", under: "result", point: { line: "result", place: 0 } });
  });

  it("patches an answer typed on its own when the carry comes back", () => {
    let s = run(startProblem(item), { type: "answer", value: "75" }, { type: "check" }, { type: "help" }, { type: "help" });
    expect(openStep(s)?.step.item.text).toBe("1 + 4 + 3 = ?");
    s = run(s, { type: "sub_cell", id: "x", value: "8" }, { type: "sub_check" });
    expect(rootValues(s).r1).toBe("8");
    expect(s.answer).toBe("85");
    expect(s.phase).toBe("done");
  });

  it("closes an open smaller problem when the kid fixes the cell by hand", () => {
    let s = run(startProblem(item), { type: "cell", id: "r0", value: "5" }, { type: "cell", id: "r1", value: "7" }, { type: "check" }, { type: "help" }, { type: "help" });
    expect(openStep(s)).not.toBeNull();
    s = run(s, { type: "cell", id: "r1", value: "8" }, { type: "answer", value: "" }, { type: "check" });
    expect(s.phase).toBe("done");
    expect(openStep(s)).toBeNull();
  });

  it("keeps steps: Enter adds a line, an empty one can go, their marks come off", () => {
    let s = run(startProblem(item), { type: "step", index: 0, value: "7 + 8 = 16" }, { type: "add_step", after: 0 }, { type: "step", index: 1, value: "x" });
    expect(s.steps).toEqual(["7 + 8 = 16", "x"]);
    s = run(s, { type: "answer", value: "85" }, { type: "cell", id: "r1", value: "8" });
    s = run(s, { type: "remove_step", index: 1 });
    expect(s.steps).toEqual(["7 + 8 = 16"]);
    s = run(s, { type: "remove_step", index: 0 });
    expect(s.steps).toHaveLength(1);
  });

  it("ignores typing once it is done", () => {
    const done = run(startProblem(item), { type: "answer", value: "85" }, { type: "check" });
    expect(run(done, { type: "answer", value: "1" })).toBe(done);
  });
});

describe("the set", () => {
  const items = ["47 + 38", "26 + ?6 = 92", "15 + 27"].map((t) => must(itemFromText(t)));

  it("fills the stars pill problem by problem and ends on All done", () => {
    let s = startSet(items);
    const act = (...a: SetAction[]) => (s = a.reduce(setReducer, s));
    expect(starsOf(s)).toBe(0);
    act({ type: "next" });
    expect(s.index).toBe(0);

    act({ type: "answer", value: "85" }, { type: "check" });
    expect(starsOf(s)).toBe(1);
    act({ type: "next" });
    expect(s.index).toBe(1);
    expect(s.problem.item.text).toBe("26 + ?6 = 92");

    act({ type: "cell", id: "b1", value: "7" }, { type: "check" }, { type: "help" }, { type: "help" }, { type: "sub_cell", id: "x", value: "6" }, { type: "sub_check" });
    expect(s.outcomes.slice(0, 2)).toEqual(["first_try", "with_help"]);
    act({ type: "next" }, { type: "answer", value: "52" }, { type: "check" }, { type: "answer", value: "42" }, { type: "check" });
    expect(s.outcomes).toEqual(["first_try", "with_help", "self_corrected"]);
    expect(starsOf(s)).toBe(3);
    expect(ownOf(s)).toBe(2);
    act({ type: "next" });
    expect(s.finished).toBe(true);
    act({ type: "answer", value: "1" });
    expect(s.finished).toBe(true);
    act({ type: "restart", items });
    expect(s).toMatchObject({ index: 0, finished: false });
    expect(starsOf(s)).toBe(0);
  });
});

describe("the keyboard map", () => {
  const sum = sumItem(47, 38);
  const miss = must(itemFromText("26 + ?6 = 92"));

  it("turns keys into intents by slot", () => {
    expect(intentFor({ key: "7" }, "cell")).toEqual({ type: "digit", digit: "7" });
    expect(intentFor({ key: "c" }, "cell")).toEqual({ type: "carry" });
    expect(intentFor({ key: "?" }, "cell")).toEqual({ type: "help" });
    expect(intentFor({ key: "?" }, "step")).toEqual({ type: "help" });
    expect(intentFor({ key: "Enter" }, "answer")).toEqual({ type: "enter" });
    expect(intentFor({ key: "Enter", ctrlKey: true }, "step")).toEqual({ type: "check" });
    expect(intentFor({ key: "Enter", metaKey: true }, "cell")).toEqual({ type: "check" });
    expect(intentFor({ key: " " }, "box")).toEqual({ type: "add_block" });
    expect(intentFor({ key: "Backspace" }, "box")).toEqual({ type: "erase" });
    expect(intentFor({ key: "ArrowLeft" }, "cell")).toEqual({ type: "move", dir: "left" });
    expect(intentFor({ key: "Tab" }, "cell")).toBeNull();
    expect(intentFor({ key: "r", ctrlKey: true }, "cell")).toBeNull();
    expect(intentFor({ key: "5" }, "step")).toBeNull();
    expect(intentFor({ key: "c" }, "step")).toBeNull();
    expect(intentFor({ key: "ArrowLeft" }, "answer")).toBeNull();
  });

  it("starts in the ones and fills right to left", () => {
    expect(firstCell(sum)).toBe("r0");
    expect(afterDigit(sum, "r0")).toBe("r1");
    expect(afterDigit(sum, "r1")).toBe("r2");
    expect(afterDigit(sum, "r2")).toBeNull();
    expect(firstCell(miss)).toBe("b1");
  });

  it("opens the carry over this column or the next one left, and comes back down", () => {
    expect(carryFor(sum, "r0")).toBe("c1");
    expect(carryFor(sum, "r1")).toBe("c1");
    expect(carryFor(sum, "c1")).toBeNull();
    expect(afterDigit(sum, "c1")).toBe("r1");
    expect(carryFor(miss, "b1")).toBe("c1");
    expect(afterDigit(miss, "c1")).toBe("b1");
  });

  it("moves with arrows between the kid's cells", () => {
    expect(gridMove(sum, "r0", "left")).toBe("r1");
    expect(gridMove(sum, "r1", "right")).toBe("r0");
    expect(gridMove(sum, "r0", "right")).toBeNull();
    expect(gridMove(sum, "r1", "up")).toBe("c1");
    expect(gridMove(sum, "r0", "up")).toBe("c1");
    expect(gridMove(sum, "c1", "down")).toBe("r1");
    expect(isBottomRow(sum, "r0")).toBe(true);
    expect(isBottomRow(sum, "c1")).toBe(false);
    expect(gridMove(miss, "b1", "up")).toBe("c1");
  });
});
