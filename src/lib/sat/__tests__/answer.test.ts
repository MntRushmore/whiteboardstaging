/**
 * Grid-in rules (docs/SAT-MODE.md "SPR rules", src/lib/sat/answer.ts): the length limits, no mixed
 * numbers, every listed form right, equal values written another way right, a short decimal wrong.
 */
import { describe, expect, it } from "vitest";
import { isCorrect, isSprCorrect, sprFormatOk, sprValue } from "@/lib/sat/answer";

describe("sprFormatOk", () => {
  it("takes whole numbers, decimals and fractions within 5 characters (6 with a minus)", () => {
    for (const s of ["7", "123", "0.75", ".75", "3/4", "12/35", "-2", "-1/2", "-.375", "-12.5", "99999", "-99999"]) expect(sprFormatOk(s), s).toBe(true);
  });
  it("refuses what cannot be gridded in", () => {
    for (const s of ["123456", "-123456", "1 1/2", "3/0", "1/2/3", "x", "", "--2", "2-", "0.12345", "1,000", "+3"]) expect(sprFormatOk(s), s).toBe(false);
  });
});

describe("sprValue", () => {
  it("reads fractions and decimals", () => {
    expect(sprValue("3/4")).toBe(0.75);
    expect(sprValue("-1/2")).toBe(-0.5);
    expect(sprValue(".6667")).toBeCloseTo(0.6667, 9);
    expect(sprValue("nope")).toBeNull();
  });
});

describe("isSprCorrect", () => {
  const twoThirds = ["2/3", ".6666", ".6667", "0.666", "0.667"];
  it("accepts every listed form", () => {
    for (const s of twoThirds) expect(isSprCorrect(s, twoThirds), s).toBe(true);
  });
  it("refuses a decimal less precise than the grid allows", () => {
    expect(isSprCorrect(".67", twoThirds)).toBe(false);
    expect(isSprCorrect(".66", twoThirds)).toBe(false);
  });
  it("accepts an equal value written another way, as the test does", () => {
    expect(isSprCorrect("6/8", ["3/4", ".75"])).toBe(true);
    expect(isSprCorrect("1.50", ["1.5", "3/2"])).toBe(true);
    expect(isSprCorrect(" 14 ", ["14"])).toBe(true);
  });
  it("refuses a wrong value and an ungriddable answer", () => {
    expect(isSprCorrect("15", ["14"])).toBe(false);
    expect(isSprCorrect("14.000", ["14"])).toBe(false); // 6 characters: does not fit the grid
  });
});

describe("isCorrect", () => {
  it("compares an mcq key, ignoring case", () => {
    expect(isCorrect({ format: "mcq", answer: { key: "B" } }, "b")).toBe(true);
    expect(isCorrect({ format: "mcq", answer: { key: "B" } }, "C")).toBe(false);
  });
  it("checks an spr against its accepted forms", () => {
    expect(isCorrect({ format: "spr", answer: { accepted: ["90"] } }, "90")).toBe(true);
    expect(isCorrect({ format: "spr", answer: { accepted: ["90"] } }, "0.9")).toBe(false);
  });
});
