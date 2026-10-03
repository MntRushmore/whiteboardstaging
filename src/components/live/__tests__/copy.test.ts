import { describe, expect, it } from "vitest";
import { LIVE_COPY, waitPhrase } from "../copy";

describe("waitPhrase", () => {
  it.each([
    [0.2, "1 s"],
    [12, "12 s"],
    [89, "89 s"],
    [90, "2 min"],
    [600, "10 min"],
    [5_340, "89 min"],
    [12_000, "about 3 hours"],
    [86_400, "about 24 hours"],
  ])("%d s -> %s", (seconds, want) => {
    expect(waitPhrase(seconds)).toBe(want);
  });

  it("an Unlimited subscriber over the daily cap reads hours, not 12000 s", () => {
    expect(LIVE_COPY.errors.rateLimited(12_000)).toBe("Slowing down — try again in about 3 hours");
  });
});
