import { describe, expect, it } from "vitest";
import { LIVE_COPY, waitPhrase } from "../copy";

/** Every string under a copy object, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("the help-modes explainer and the Auto switch", () => {
  it("keeps the tone: no exclamation marks, never 'wrong'", () => {
    for (const s of [...strings(LIVE_COPY.modeInfo), ...strings(LIVE_COPY.auto)]) {
      expect(s, s).not.toMatch(/!|\bwrong\b/i);
    }
  });

  it("says what Auto does, and that the tutor shows what it read", () => {
    expect(LIVE_COPY.modeInfo.autoBody).toMatch(/Auto on/);
    expect(LIVE_COPY.modeInfo.autoBody).toMatch(/Auto off/);
    expect(LIVE_COPY.modeInfo.body).toMatch(/what it read/);
  });
});

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
