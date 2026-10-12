import { describe, expect, it } from "vitest";
import {
  LEGACY_SIMPLE_BOARD_KEYS,
  parseSimpleBoardStore,
  rememberChoice,
  SIMPLE_BOARD_KEY,
  SIMPLE_BOARD_MAX_USERS,
  simpleBoardByDefault,
  simpleBoardOn,
} from "../simpleBoard";

/**
 * Who gets the simple board: every student, unless a grown-up switches it off on the device. These
 * rules are pinned rather than read off the board.
 */

describe("simpleBoardByDefault", () => {
  it("is on for everyone: every grade, a high-school course, a grade not known (the grade is not read)", () => {
    expect(simpleBoardByDefault()).toBe(true);
    // nothing remembered for this user: the default, at once (no profile to wait for)
    expect(simpleBoardOn(undefined)).toBe(true);
    expect(simpleBoardOn({})).toBe(true);
  });
});

describe("the device's memory", () => {
  it("lives under a new key, so everyone lands on the simple board once", () => {
    expect(SIMPLE_BOARD_KEY).toBe("agathon.simpleBoard.v2");
    expect(LEGACY_SIMPLE_BOARD_KEYS).toContain("agathon.simpleBoard");
    expect(LEGACY_SIMPLE_BOARD_KEYS).not.toContain(SIMPLE_BOARD_KEY);
  });

  it("ignores the first key's grades: an older student's remembered `byGrade: false` is not a choice", () => {
    // what the first key held for a 7th grader and a high-school student, read as if it were this one
    const legacy = JSON.stringify({ teen: { byGrade: false }, hs: { byGrade: false }, kid: { byGrade: true } });
    const store = parseSimpleBoardStore(legacy);
    expect(store).toEqual({});
    expect(simpleBoardOn(store.teen)).toBe(true);
    expect(simpleBoardOn(store.hs)).toBe(true);
  });

  it("lets the grown-up switch win, both ways", () => {
    const off = rememberChoice({}, "teen", false);
    expect(simpleBoardOn(off.teen)).toBe(false);
    expect(simpleBoardOn(rememberChoice(off, "teen", true).teen)).toBe(true);
  });

  it("keeps each user of a shared tablet apart: one kid's switch does not follow her brother", () => {
    let store = rememberChoice({}, "sister", false);
    expect(simpleBoardOn(store.sister)).toBe(false);
    expect(simpleBoardOn(store.brother)).toBe(true);
    store = rememberChoice(store, "brother", true);
    expect(simpleBoardOn(store.brother)).toBe(true);
    expect(simpleBoardOn(store.sister)).toBe(false);
  });

  it("keeps the newest users only, so the key never grows without bound", () => {
    let store = {};
    for (let i = 0; i < SIMPLE_BOARD_MAX_USERS + 5; i++) store = rememberChoice(store, `u${i}`, i % 2 === 0);
    expect(Object.keys(store)).toHaveLength(SIMPLE_BOARD_MAX_USERS);
    expect(Object.keys(store)).not.toContain("u0");
    // a user seen again moves to the newest end, and is not the next to go
    store = rememberChoice(store, "u5", false);
    store = rememberChoice(store, "new", true);
    expect(Object.keys(store)).toContain("u5");
    expect(Object.keys(store)).not.toContain("u6");
  });

  it("reads back what it wrote, and anything unreadable as nothing", () => {
    const store = rememberChoice(rememberChoice({}, "a", false), "b", true);
    expect(parseSimpleBoardStore(JSON.stringify(store))).toEqual(store);
    for (const raw of [null, "", "on", "{", "[1,2]", "null", '"x"']) expect(parseSimpleBoardStore(raw)).toEqual({});
    expect(parseSimpleBoardStore(JSON.stringify({ a: { choice: "maybe" }, b: { byGrade: "yes" }, c: { choice: "off", byGrade: true }, d: [] }))).toEqual({ c: { choice: "off" } });
  });
});
