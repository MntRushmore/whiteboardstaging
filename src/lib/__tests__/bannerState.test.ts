import { describe, expect, it } from "vitest";
import { creditsBannerStateFor, setupBannerStateFor } from "../bannerState";

describe("creditsBannerStateFor", () => {
  it("names the hidden-on-error state explicitly", () => {
    expect(creditsBannerStateFor(null, true, 3)).toBe("hidden-error");
    expect(creditsBannerStateFor({ remaining: 1 }, true, 3)).toBe("hidden-error");
  });
  it("is loading before data, hidden when healthy, visible when low", () => {
    expect(creditsBannerStateFor(null, false, 3)).toBe("loading");
    expect(creditsBannerStateFor({ remaining: 10 }, false, 3)).toBe("hidden");
    expect(creditsBannerStateFor({ remaining: 3 }, false, 3)).toBe("visible");
    expect(creditsBannerStateFor({ remaining: 0 }, false, 3)).toBe("visible");
  });
});

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
