import { describe, expect, it } from "vitest";
import { isKeyboardDevice } from "../device";

const env = (fine: boolean, coarse: boolean, touch = 0) => ({
  matchMedia: (q: string) => ({ matches: q === "(pointer: fine)" ? fine : q === "(any-pointer: coarse)" ? coarse : false }),
  maxTouchPoints: touch,
});

describe("isKeyboardDevice", () => {
  it("a laptop or Chromebook: a fine pointer and no touch", () => {
    expect(isKeyboardDevice(env(true, false))).toBe(true);
  });
  it("not an iPad, a phone or a touch-screen laptop", () => {
    expect(isKeyboardDevice(env(false, true, 5))).toBe(false);
    expect(isKeyboardDevice(env(true, true, 10))).toBe(false);
    expect(isKeyboardDevice(env(true, false, 1))).toBe(false);
  });
  it("no window: no", () => {
    expect(isKeyboardDevice(null)).toBe(false);
    expect(isKeyboardDevice({})).toBe(false);
  });
});
