import { describe, expect, it } from "vitest";
import { CHEERS, celebrate, INITIAL_CELEBRATE, MISS_WORDS, STREAK_FROM, streakText, type CelebrateState } from "../celebrate";

function run(marks: Array<[string, "check" | "circle"]>) {
  let state: CelebrateState = INITIAL_CELEBRATE;
  const cheers = marks.map(([line, kind]) => {
    const out = celebrate(state, line, kind);
    state = out.state;
    return out.cheer;
  });
  return { state, cheers };
}

describe("celebrate", () => {
  it("cheers a tick with a small burst, a different word each time", () => {
    const { cheers } = run([
      ["a", "check"],
      ["b", "check"],
    ]);
    expect(cheers[0]).toEqual({ tone: "win", text: CHEERS[0], streak: 1, burst: "small" });
    expect(cheers[1]).toMatchObject({ tone: "win", text: CHEERS[1], streak: 2 });
  });

  it("says nothing when the same line gets the same mark again (the tutor redrew it)", () => {
    const { state, cheers } = run([
      ["a", "check"],
      ["a", "check"],
    ]);
    expect(cheers[1]).toBeNull();
    expect(state.streak).toBe(1);
  });

  it("a ring gets a kind word and ends the streak; fixing the line cheers again", () => {
    const { state, cheers } = run([
      ["a", "check"],
      ["b", "check"],
      ["c", "circle"],
      ["c", "check"],
    ]);
    expect(cheers[2]).toEqual({ tone: "miss", text: MISS_WORDS[0] });
    expect(cheers[3]).toMatchObject({ tone: "win", streak: 1 });
    expect(state.streak).toBe(1);
  });

  it("counts the streak from three, with a big burst on the milestones", () => {
    const lines = Array.from({ length: 10 }, (_, i) => [`l${i}`, "check"] as [string, "check"]);
    const { cheers } = run(lines);
    expect(cheers[STREAK_FROM - 1]).toMatchObject({ streak: STREAK_FROM, burst: "small" });
    expect(cheers[4]).toMatchObject({ streak: 5, burst: "big" });
    expect(cheers[9]).toMatchObject({ streak: 10, burst: "big" });
    expect(streakText(5)).toBe("5 in a row!");
  });

  it("does not change the state it is given", () => {
    const before = structuredClone(INITIAL_CELEBRATE);
    celebrate(INITIAL_CELEBRATE, "a", "check");
    expect(INITIAL_CELEBRATE).toEqual(before);
  });
});
