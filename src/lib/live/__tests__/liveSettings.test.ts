import { describe, expect, it } from "vitest";
import { autoActs, DEFAULT_LIVE_SETTINGS } from "../liveSettings";

/**
 * What the Live loop is told about Auto (`useLiveMath`'s `auto`): the student's switch, paused
 * while "Hide AI shapes" is on — Auto spends ink on checks and solves, and none of it should be
 * spent on marks and steps the student has hidden and cannot see.
 */
describe("autoActs", () => {
  it("is the Auto switch, on by default", () => {
    expect(autoActs(DEFAULT_LIVE_SETTINGS)).toBe(true);
    expect(autoActs({ ...DEFAULT_LIVE_SETTINGS, auto: false })).toBe(false);
  });

  it("pauses while AI shapes are hidden, and comes back with them", () => {
    expect(autoActs({ ...DEFAULT_LIVE_SETTINGS, hideAiShapes: true })).toBe(false);
    expect(autoActs({ ...DEFAULT_LIVE_SETTINGS, hideAiShapes: true, auto: false })).toBe(false);
    expect(autoActs({ ...DEFAULT_LIVE_SETTINGS, hideAiShapes: false })).toBe(true);
  });
});
