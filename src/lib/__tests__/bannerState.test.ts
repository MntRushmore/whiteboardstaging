import { describe, expect, it } from "vitest";
import { setupBannerStateFor } from "../bannerState";

describe("setupBannerStateFor", () => {
  it("names the hidden-on-error state explicitly", () => {
    expect(setupBannerStateFor(null, true)).toBe("hidden-error");
  });
  it("is loading before data, hidden when all keys are present, visible otherwise", () => {
    expect(setupBannerStateFor(null, false)).toBe("loading");
    expect(setupBannerStateFor({ providers: [{ present: true }] }, false)).toBe("hidden");
    expect(setupBannerStateFor({ providers: [{ present: true }, { present: false }] }, false)).toBe("visible");
  });
});
