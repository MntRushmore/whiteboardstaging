import { describe, expect, it } from "vitest";
import {
  gradeFromProfile,
  needsGrade,
  parseSimpleBoardStore,
  rememberChoice,
  rememberGrade,
  SIMPLE_BOARD_KEY,
  SIMPLE_BOARD_MAX_USERS,
  simpleBoardByDefault,
  simpleBoardOn,
} from "../simpleBoard";

/**
 * Who gets the simple board. Prod is mostly 5-to-10-year-olds, but an older student handed a toy
 * bar would leave: these rules are pinned rather than read off the board.
 */

const PROFILE = { grade: null, course: null, displayName: null, avatar: null };

describe("simpleBoardByDefault", () => {
  it("is on from Kindergarten to 3rd grade", () => {
    for (const grade of [0, 1, 2, 3]) expect(simpleBoardByDefault(grade)).toBe(true);
  });

  it("is off from 4th grade, for a high-school course (no grade) and for an unknown grade", () => {
    for (const grade of [4, 5, 6, 7, 8]) expect(simpleBoardByDefault(grade)).toBe(false);
    expect(simpleBoardByDefault(null)).toBe(false);
    expect(simpleBoardByDefault(undefined)).toBe(false);
    expect(simpleBoardByDefault(-1)).toBe(false);
    expect(simpleBoardByDefault(2.5)).toBe(false);
  });
});

describe("the device's memory", () => {
  it("lives under agathon.simpleBoard", () => {
    expect(SIMPLE_BOARD_KEY).toBe("agathon.simpleBoard");
  });

  it("is not known on a first board (the grown-up bar meanwhile), then the grade decides", () => {
    expect(simpleBoardOn(undefined)).toBe(null);
    expect(simpleBoardOn(rememberGrade({}, "kid", 1).kid)).toBe(true);
    expect(simpleBoardOn(rememberGrade({}, "teen", null).teen)).toBe(false);
  });

  it("lets the switch win over the grade, both ways, and stops reading the grade once it has", () => {
    const kid = rememberChoice(rememberGrade({}, "kid", 1), "kid", false);
    expect(simpleBoardOn(kid.kid)).toBe(false);
    expect(needsGrade(kid.kid)).toBe(false);
    // a grade read after the choice changes nothing
    expect(simpleBoardOn(rememberGrade(kid, "kid", 0).kid)).toBe(false);
    const teen = rememberChoice(rememberGrade({}, "teen", null), "teen", true);
    expect(simpleBoardOn(teen.teen)).toBe(true);
    expect(needsGrade(undefined)).toBe(true);
    expect(needsGrade(rememberGrade({}, "kid", 2).kid)).toBe(true);
  });

  it("follows a grade that changed (a kid moved up to 4th grade)", () => {
    const before = rememberGrade({}, "kid", 3);
    expect(simpleBoardOn(rememberGrade(before, "kid", 4).kid)).toBe(false);
  });

  it("keeps each user of a shared tablet apart: a 1st grader's board does not follow her brother", () => {
    let store = rememberGrade({}, "sister", 1);
    store = rememberGrade(store, "brother", 7);
    store = rememberChoice(store, "sister", false);
    expect(simpleBoardOn(store.brother)).toBe(false);
    expect(simpleBoardOn(store.sister)).toBe(false);
    store = rememberChoice(store, "brother", true);
    expect(simpleBoardOn(store.brother)).toBe(true);
    expect(simpleBoardOn(store.sister)).toBe(false);
  });

  it("keeps the newest users only, so the key never grows without bound", () => {
    let store = {};
    for (let i = 0; i < SIMPLE_BOARD_MAX_USERS + 5; i++) store = rememberGrade(store, `u${i}`, 1);
    expect(Object.keys(store)).toHaveLength(SIMPLE_BOARD_MAX_USERS);
    expect(Object.keys(store)).not.toContain("u0");
    // a user seen again moves to the newest end, and is not the next to go
    store = rememberChoice(store, "u5", false);
    store = rememberGrade(store, "new", 2);
    expect(Object.keys(store)).toContain("u5");
    expect(Object.keys(store)).not.toContain("u6");
  });

  it("does not rewrite the key when the grade says what it said before", () => {
    const store = rememberGrade({}, "kid", 1);
    expect(rememberGrade(store, "kid", 2)).toBe(store);
  });

  it("reads back what it wrote, and anything unreadable as nothing", () => {
    const store = rememberChoice(rememberGrade({}, "a", 1), "b", true);
    expect(parseSimpleBoardStore(JSON.stringify(store))).toEqual(store);
    for (const raw of [null, "", "on", "{", "[1,2]", "null", '"x"']) expect(parseSimpleBoardStore(raw)).toEqual({});
    expect(parseSimpleBoardStore(JSON.stringify({ a: { choice: "maybe" }, b: { byGrade: "yes" }, c: { choice: "off" }, d: [] }))).toEqual({ c: { choice: "off" } });
  });
});

describe("gradeFromProfile", () => {
  it("takes the grade a profile has, and a high-school course as no grade", () => {
    expect(gradeFromProfile({ ...PROFILE, grade: 2, displayName: "Mia" })).toBe(2);
    expect(gradeFromProfile({ ...PROFILE, course: "algebra1" })).toBe(null);
  });

  it("treats a profile of nothing but nulls as unknown: a failed read must not turn a kid's board off", () => {
    // readLearnerProfile never throws: offline it answers this, as for a student who skipped the welcome
    expect(gradeFromProfile(PROFILE)).toBe("unknown");
  });
});
