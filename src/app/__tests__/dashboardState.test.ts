import { describe, expect, it } from "vitest";
import { DASHBOARD_COPY, dashboardStateFor } from "../dashboardState";

describe("dashboardStateFor", () => {
  it("shows the skeleton while loading, regardless of other fields", () => {
    expect(dashboardStateFor({ loading: true, error: null, boards: [] })).toBe("loading");
    expect(dashboardStateFor({ loading: true, error: "x", boards: [{}] })).toBe("loading");
  });

  it("shows the error panel when the fetch failed, even with stale boards", () => {
    expect(dashboardStateFor({ loading: false, error: "Couldn't load", boards: [] })).toBe("error");
    expect(dashboardStateFor({ loading: false, error: "Couldn't load", boards: [{}] })).toBe("error");
  });

  it("shows empty vs list based on boards", () => {
    expect(dashboardStateFor({ loading: false, error: null, boards: [] })).toBe("empty");
    expect(dashboardStateFor({ loading: false, error: null, boards: [{}, {}] })).toBe("list");
  });

  it("uses calm copy (no exclamation marks, no 'wrong')", () => {
    for (const text of Object.values(DASHBOARD_COPY)) {
      expect(text).not.toMatch(/!/);
      expect(text.toLowerCase()).not.toMatch(/\bwrong\b/);
    }
  });
});
