import { describe, expect, it } from "vitest";
import { simpleWritable } from "../run";

describe("simpleWritable", () => {
  it("writes whole and exact answers, never a rounded one or a fraction problem's decimal (the bench, 2026-10-26)", () => {
    expect(simpleWritable("47 + 38", 85)).toBe(true);
    expect(simpleWritable("3.75 + 1.6", 5.35)).toBe(true);
    expect(simpleWritable("10 ÷ 4", 2.5)).toBe(true);
    expect(simpleWritable("8/4 + 1", 3)).toBe(true);
    expect(simpleWritable("3/4 + 2/3", 17 / 12)).toBe(false);
    expect(simpleWritable("1/2 + 1/4", 0.75)).toBe(false);
    expect(simpleWritable("10 ÷ 3", 10 / 3)).toBe(false);
  });
});
