import { describe, expect, it, vi } from "vitest";
import { outcomeOf as recordOutcome } from "@/lib/learning/contracts";
import { ANSWER_LINE } from "../check";
import { nudgeFor, numbersIn, sayable, tidyLine, workedFor } from "../copy";
import { generateSet, variantItem } from "../generate";
import { itemFromText, sumItem, type MathItem } from "../item";
import { countsOf, keysRecord, latexOf, mistakesOf, recordable, startClock, tickClock } from "../record";
import { sayLine, SayRequestSchema, type SayInput } from "../say";
import {
  isBonus,
  offersNowYouTry,
  openStep,
  outcomeOf,
  ownOf,
  perfectOf,
  problemReducer,
  setPosition,
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

describe("the help ladder", () => {
  it("climbs: a nudge, the smaller problem, the worked step; then nothing more", () => {
    const item = must(itemFromText("26 + ?6 = 92"));
    let s = run(startProblem(item), { type: "cell", id: "b1", value: "7" }, { type: "check" });
    s = run(s, { type: "help" });
    expect(s.help?.kind).toBe("nudge");
    s = run(s, { type: "help" });
    expect(s.help?.kind).toBe("smaller");
    expect(openStep(s)).not.toBeNull();
    s = run(s, { type: "help" });
    expect(s.help).toMatchObject({ kind: "worked", text: "In the tens: 1 + 2 + 6 = 9. The missing digit is 6." });
    // the smaller problem stays open under it: the kid still answers it
    expect(openStep(s)).not.toBeNull();
    const top = run(s, { type: "help" });
    expect(top.counts.helps).toBe(s.counts.helps);
    expect(s.history).toMatchObject({ nudges: 1, smaller: 1, worked: 1 });
  });

  it("goes from the nudge straight to the worked step when the bug has no smaller problem", () => {
    let s = run(startProblem(sumItem(47, 38)), { type: "answer", value: "58" }, { type: "check" });
    expect(s.bug).toBe("add_swapped_places");
    s = run(s, { type: "help" }, { type: "help" });
    expect(s.help).toMatchObject({ kind: "worked", text: "7 + 8 = 15. Write the 5 in the ones. Carry the 1 to the tens." });
  });

  it("starts again for a different slip", () => {
    let s = run(startProblem(sumItem(47, 38)), { type: "answer", value: "715" }, { type: "check" }, { type: "help" });
    expect(s.helpLevel).toBe(1);
    s = run(s, { type: "answer", value: "95" }, { type: "check" });
    expect(s.bug).toBe("add_carry_twice");
    expect(s.helpLevel).toBe(0);
    s = run(s, { type: "help" });
    expect(s.help).toMatchObject({ kind: "nudge", text: "Add the 1 you carried just once." });
  });

  it("points the nudge at the column that broke", () => {
    const s = run(startProblem(sumItem(47, 38)), { type: "cell", id: "r0", value: "5" }, { type: "cell", id: "r1", value: "7" }, { type: "check" }, { type: "help" });
    expect(s.help).toMatchObject({ kind: "nudge", point: { line: "result", place: 1 } });
  });

  it("takes the check endpoint's words for a slip no rule names, only for a nudge", () => {
    let s = run(startProblem(sumItem(47, 38)), { type: "answer", value: "83" }, { type: "check" });
    expect(s.bug).toBeNull();
    s = run(s, { type: "help" });
    expect(s.help).toMatchObject({ kind: "nudge", text: nudgeFor(s.item, null) });
    s = run(s, { type: "hint_text", text: " Look at the ones: 7 + 8 makes more than 10. " });
    expect(s.help).toMatchObject({ kind: "nudge", text: "Look at the ones: 7 + 8 makes more than 10." });
    expect(run(startProblem(sumItem(47, 38)), { type: "hint_text", text: "x" }).help).toBeNull();
  });
});

describe("the worked step", () => {
  it("works the column that broke, else the first one that carries", () => {
    const item = sumItem(47, 38);
    expect(workedFor(item, null, "r1")).toBe("1 + 4 + 3 = 8. Write the 8 in the tens.");
    expect(workedFor(item, null, "r0")).toBe("7 + 8 = 15. Write the 5 in the ones. Carry the 1 to the tens.");
    expect(workedFor(item, "add_swapped_places")).toBe("7 + 8 = 15. Write the 5 in the ones. Carry the 1 to the tens.");
    expect(workedFor(item, "add_forgot_carry")).toBe("1 + 4 + 3 = 8. Write the 8 in the tens.");
  });
});

describe("the learning record", () => {
  const meta = (closed = false) => ({ id: "11111111-1111-4111-8111-111111111111", course: null, parentId: null, clock: startClock(Date.parse("2026-10-27T10:00:00Z")), closed });

  it("a first try: one line right, no mistakes", () => {
    const s = run(startProblem(sumItem(47, 38)), { type: "cell", id: "r0", value: "5" }, { type: "cell", id: "r1", value: "8" }, { type: "check" });
    const r = keysRecord(s, meta());
    expect(r).toMatchObject({ origin: "keys", boardId: null, outcome: "first_try", skill: "add_within_100", problemLatex: "47 + 38", mistakes: {}, linesRinged: 0, hints: 0, tutorSteps: 0 });
    expect(r.linesRight).toBeGreaterThanOrEqual(1);
    expect(r.finishedAt).not.toBeNull();
  });

  it("a slip fixed alone is self corrected, with the bug's kind", () => {
    const s = run(startProblem(sumItem(47, 38)), { type: "answer", value: "715" }, { type: "check" }, { type: "answer", value: "85" }, { type: "check" });
    const r = keysRecord(s, meta());
    expect(r.outcome).toBe("self_corrected");
    expect(r.mistakes).toEqual({ concept: 1 });
    expect(r.linesRinged).toBe(1);
  });

  it("help makes it with help; every rung is counted", () => {
    let s = run(startProblem(must(itemFromText("26 + ?6 = 92"))), { type: "cell", id: "b1", value: "7" }, { type: "check" }, { type: "help" }, { type: "help" });
    s = run(s, { type: "sub_cell", id: "x", value: "6" }, { type: "sub_check" });
    const r = keysRecord(s, meta());
    expect(r).toMatchObject({ outcome: "with_help", hints: 1, tutorSteps: 1, asks: 2, mistakes: { arithmetic: 1 } });
    // the session's own outcome agrees with the record's rule
    expect(outcomeOf(s)).toBe(recordOutcome(countsOf(s), true, false, false));
  });

  it("a slip no rule names is a number slip; untouched problems are never recorded; a left one is unfinished", () => {
    const slip = run(startProblem(sumItem(47, 38)), { type: "answer", value: "83" }, { type: "check" });
    expect(mistakesOf(slip)).toEqual({ arithmetic: 1 });
    expect(recordable(startProblem(sumItem(47, 38)))).toBe(false);
    expect(recordable(slip)).toBe(true);
    expect(keysRecord(slip, meta()).outcome).toBe("in_progress");
    expect(keysRecord(slip, meta(true)).outcome).toBe("unfinished");
  });

  it("counts active time with gaps capped", () => {
    let c = startClock(0);
    c = tickClock(c, 10_000);
    c = tickClock(c, 10_000 + 10 * 60_000);
    expect(c.activeMs).toBe(10_000 + 120_000);
  });

  it("writes the problem as LaTeX", () => {
    expect(latexOf(must(itemFromText("26 + ?6 = 92")))).toBe("26 + \\square 6 = 92");
  });
});

describe("the tutor's words", () => {
  const copy = "The 1 you carried is a ten. 1 + 2 + ? = 9";

  it("takes another wording only with the same numbers and none of the words the tutor never says", () => {
    expect(numbersIn("1 + 2 + 6 = 9")).toEqual(["1", "2", "6", "9"]);
    expect(sayable("That 1 you carried counts as a ten. So 1 + 2 + ? = 9.", copy)).toBe(true);
    expect(sayable("That 1 is a ten. 1 + 2 + 6 = 9.", copy)).toBe(false);
    expect(sayable("Oops, that is wrong. 1 + 2 + ? = 9.", copy)).toBe(false);
    expect(sayable("The 1 is a ten! Wow! 1 + 2 + ? = 9", copy)).toBe(false);
    expect(sayable("The 1 is a ten. $1 + 2 + ? = 9$", copy)).toBe(false);
    expect(sayable("x".repeat(141), copy)).toBe(false);
    expect(tidyLine('  "Look at the tens"  ')).toBe("Look at the tens.");
  });

  const input: SayInput = { moment: "smaller", bug: "add_forgot_carry", problem: "26 + ?6 = 92", step: "1 + 2 + ? = 9", level: 2, grade: 2, copy };

  it("the request is the route's schema", () => {
    expect(SayRequestSchema.parse(input)).toEqual(input);
    expect(SayRequestSchema.safeParse({ ...input, bug: "DROP TABLE" }).success).toBe(false);
  });

  it("says the model's line when it is in time and fair", async () => {
    const got = await sayLine(input, async () => ({ line: "That 1 you carried is a ten. Try 1 + 2 + ? = 9", source: "model", ms: 300 }));
    expect(got).toEqual({ line: "That 1 you carried is a ten. Try 1 + 2 + ? = 9.", source: "model" });
  });

  it("says the fixed line when the reply is late, fails, changes a fact or is the copy", async () => {
    vi.useFakeTimers();
    const late = sayLine(input, (_b, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve(null))));
    await vi.advanceTimersByTimeAsync(1500);
    expect(await late).toEqual({ line: `${copy}.`, source: "copy" });
    vi.useRealTimers();
    expect((await sayLine(input, async () => Promise.reject(new Error("503")))).source).toBe("copy");
    expect((await sayLine(input, async () => ({ line: "1 + 2 + 6 = 9", source: "model", ms: 1 }))).source).toBe("copy");
    expect((await sayLine(input, async () => ({ line: copy, source: "copy", ms: 1 }))).source).toBe("copy");
  });
});

describe("Now you try", () => {
  it("offers one more like it after a problem done with help, put right after it", () => {
    const items = generateSet(7, 3);
    let s = startSet(items);
    const act = (...a: SetAction[]) => (s = a.reduce(setReducer, s));
    const wrong = String(Number(items[0].answer) + 10);
    act({ type: "answer", value: wrong }, { type: "check" }, { type: "help" }, { type: "answer", value: items[0].answer }, { type: "check" });
    expect(s.outcomes[0]).toBe("with_help");
    expect(offersNowYouTry(s)).toBe(true);
    const variant = must(variantItem(items[0], 42));
    expect(variant.kind).toBe(items[0].kind);
    expect(variant.answer).not.toBe(items[0].answer);
    expect(variantItem(items[0], 42)?.id).toBe(variant.id);

    act({ type: "now_you_try", item: variant });
    expect(s.index).toBe(1);
    expect(isBonus(s)).toBe(true);
    expect(setPosition(s)).toEqual({ n: 1, count: 3 });
    expect(offersNowYouTry(s)).toBe(false);
    act({ type: "answer", value: variant.answer }, { type: "check" });
    expect(starsOf(s)).toBe(1);
    act({ type: "next" });
    expect(s.problem.item.id).toBe(items[1].id);
    expect(setPosition(s)).toEqual({ n: 2, count: 3 });
    // only once after that problem
    expect(setReducer({ ...s, index: 0 }, { type: "now_you_try", item: variant }).items).toHaveLength(4);
  });

  it("the perfect sticker is 5 for 5 on your own", () => {
    const items = generateSet(3, 2);
    let s = startSet(items);
    for (const it of items) {
      s = setReducer(s, { type: "answer", value: it.answer });
      s = setReducer(s, { type: "check" });
      s = setReducer(s, { type: "next" });
    }
    expect(s.finished).toBe(true);
    expect(perfectOf(s)).toBe(true);
    expect(ownOf(s)).toBe(2);
  });

  it("the answer row is where help points when the work has no slip", () => {
    const s = run(startProblem(sumItem(47, 38)), { type: "answer", value: "84" }, { type: "check" }, { type: "help" });
    expect(s.help).toMatchObject({ under: ANSWER_LINE });
  });
});
