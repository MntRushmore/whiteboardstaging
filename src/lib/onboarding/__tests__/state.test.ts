import { describe, expect, it } from "vitest";
import { homeView, needsProfile, welcomeDecision } from "../state";

const NEW = { course: null, grade: null, onboarded_at: null } as const;
const DONE = { course: "algebra1", grade: null, onboarded_at: "2026-09-28T10:00:00Z" } as const;

describe("when the welcome shows", () => {
  it("shows for a student who has not finished it and has no boards", () => {
    expect(welcomeDecision({ boards: 0, profile: NEW, localDone: false })).toBe("show");
    // a course chosen, then the tab closed before Start: still not done
    expect(welcomeDecision({ boards: 0, profile: { course: "geometry", grade: null, onboarded_at: null }, localDone: false })).toBe("show");
    expect(welcomeDecision({ boards: 0, profile: { course: "other", grade: 2, onboarded_at: null }, localDone: false })).toBe("show");
  });

  it("never shows to a student with boards (existing users are never forced into it)", () => {
    expect(welcomeDecision({ boards: 1, profile: NEW, localDone: false })).toBe("hide");
    expect(welcomeDecision({ boards: 12, profile: "loading", localDone: false })).toBe("hide");
  });

  it("never shows once finished or skipped, on the profile or on this device", () => {
    expect(welcomeDecision({ boards: 0, profile: DONE, localDone: false })).toBe("hide");
    expect(welcomeDecision({ boards: 0, profile: NEW, localDone: true })).toBe("hide");
    expect(welcomeDecision({ boards: "loading", profile: "loading", localDone: true })).toBe("hide");
  });

  it("an account backfilled by the migration (onboarded_at = created_at) with no boards does not see it", () => {
    expect(welcomeDecision({ boards: 0, profile: { course: null, grade: null, onboarded_at: "2026-09-01T00:00:00Z" }, localDone: false })).toBe("hide");
  });

  it("waits (checking) while the boards or the profile are loading", () => {
    expect(welcomeDecision({ boards: "loading", profile: "loading", localDone: false })).toBe("checking");
    expect(welcomeDecision({ boards: 0, profile: "loading", localDone: false })).toBe("checking");
  });

  it("stays hidden whenever the answer is unavailable: a failed read, no profile row, no migration", () => {
    expect(welcomeDecision({ boards: "error", profile: NEW, localDone: false })).toBe("hide");
    expect(welcomeDecision({ boards: 0, profile: "error", localDone: false })).toBe("hide");
    expect(welcomeDecision({ boards: 0, profile: null, localDone: false })).toBe("hide");
  });

  it("reads the profile only for a student with no boards who has not finished on this device", () => {
    expect(needsProfile({ boards: 0, localDone: false })).toBe(true);
    expect(needsProfile({ boards: 3, localDone: false })).toBe(false);
    expect(needsProfile({ boards: "loading", localDone: false })).toBe(false);
    expect(needsProfile({ boards: "error", localDone: false })).toBe(false);
    expect(needsProfile({ boards: 0, localDone: true })).toBe(false);
  });
});

describe("the boards home view", () => {
  it("folds the welcome into the dashboard's state", () => {
    expect(homeView("empty", "show")).toBe("welcome");
    expect(homeView("empty", "hide")).toBe("empty");
    // no flash of the empty state while the profile is read
    expect(homeView("empty", "checking")).toBe("loading");
    for (const s of ["loading", "error", "list"] as const) {
      for (const w of ["checking", "show", "hide"] as const) expect(homeView(s, w)).toBe(s);
    }
  });
});
