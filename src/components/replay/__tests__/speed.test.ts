import { describe, expect, it } from "vitest";
import { speedFor } from "../player";

describe("speedFor", () => {
  it("the slowest speed that fits the target, from a floor; the fastest when none does", () => {
    expect(speedFor(5_000, 25_000)).toBe(1);
    expect(speedFor(86_000, 25_000, 2)).toBe(4);
    expect(speedFor(637_000, 120_000, 2)).toBe(8);
    expect(speedFor(1_811_000, 25_000, 2)).toBe(16);
    expect(speedFor(0, 25_000, 2)).toBe(2);
  });
});
