import { describe, expect, it } from "vitest";
import {
  COACH_COUNT,
  coachNumber,
  homeView,
  initialTour,
  markerStepOf,
  markKindOf,
  needsProfile,
  questionWhyOf,
  tourReducer,
  welcomeDecision,
  type TourEvent,
  type TourState,
  type TourStep,
} from "../state";

const NEW = { course: null, onboarded_at: null } as const;
const DONE = { course: "algebra1", onboarded_at: "2026-09-28T10:00:00Z" } as const;

describe("when the welcome shows", () => {
  it("shows for a student who has not finished it and has no boards", () => {
    expect(welcomeDecision({ boards: 0, profile: NEW, localDone: false })).toBe("show");
    // a course chosen, then the tab closed before Start: still not done
    expect(welcomeDecision({ boards: 0, profile: { course: "geometry", onboarded_at: null }, localDone: false })).toBe("show");
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
    expect(welcomeDecision({ boards: 0, profile: { course: null, onboarded_at: "2026-09-01T00:00:00Z" }, localDone: false })).toBe("hide");
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

function run(events: TourEvent[], from: TourState = initialTour()): TourState {
  return events.reduce(tourReducer, from);
}

describe("coach marks", () => {
  it("starts on the problem, then shows the three marks in order", () => {
    let s = initialTour();
    expect(s).toEqual({ step: "problem", outcome: null, unread: false, unjudged: false, skipped: false });
    s = tourReducer(s, { type: "problemReady" });
    expect(s.step).toBe("write");
    s = tourReducer(s, { type: "mark", mark: "check" });
    expect(s).toMatchObject({ step: "result", outcome: "tick" });
    s = tourReducer(s, { type: "next" });
    expect(s.step).toBe("modes");
    s = tourReducer(s, { type: "next" });
    expect(s.step).toBe("ask");
    s = tourReducer(s, { type: "next" });
    expect(s).toMatchObject({ step: "done", skipped: false });
  });

  it("a ring says so, and a later tick replaces it", () => {
    const ringed = run([{ type: "problemReady" }, { type: "mark", mark: "circle" }]);
    expect(ringed).toMatchObject({ step: "result", outcome: "ring" });
    expect(tourReducer(ringed, { type: "mark", mark: "check" })).toMatchObject({ step: "result", outcome: "tick" });
  });

  it("a question mark keeps the first mark and says the line was not read", () => {
    const s = run([{ type: "problemReady" }, { type: "mark", mark: "question" }]);
    expect(s).toMatchObject({ step: "write", unread: true });
    expect(tourReducer(s, { type: "mark", mark: "check" })).toMatchObject({ step: "result", outcome: "tick", unread: false });
    // once a tick is up, a later unreadable line does not take it away
    const ticked = run([{ type: "mark", mark: "check" }, { type: "mark", mark: "question" }], s);
    expect(ticked).toMatchObject({ step: "result", outcome: "tick" });
  });

  it("a question mark on a line read but with nothing in it to check (a lone 2) asks for the whole step", () => {
    const s = run([{ type: "problemReady" }, { type: "mark", mark: "question", why: "unjudged" }]);
    expect(s).toMatchObject({ step: "write", unread: false, unjudged: true });
    // the latest question mark is the one explained
    expect(tourReducer(s, { type: "mark", mark: "question", why: "unread" })).toMatchObject({ unread: true, unjudged: false });
    expect(tourReducer(s, { type: "mark", mark: "check" })).toMatchObject({ step: "result", outcome: "tick", unread: false, unjudged: false });
  });

  it("marks count only on the first coach mark", () => {
    for (const step of ["problem", "modes", "ask"] as const) {
      const s = { ...initialTour(), step };
      expect(tourReducer(s, { type: "mark", mark: "check" })).toBe(s);
    }
  });

  it("Next moves on without waiting for a mark (no pen, Live off)", () => {
    expect(run([{ type: "problemReady" }, { type: "next" }]).step).toBe("modes");
    // nothing was written: the problem step does not hold the tour
    expect(run([{ type: "next" }]).step).toBe("write");
  });

  it("opening Ask finishes the tour on the last mark only", () => {
    expect(run([{ type: "askOpened" }], { ...initialTour(), step: "ask" })).toMatchObject({ step: "done", skipped: false });
    for (const step of ["problem", "write", "result", "modes"] as const) {
      const s = { ...initialTour(), step };
      expect(tourReducer(s, { type: "askOpened" })).toBe(s);
    }
  });

  it("skip ends it from any step, and done stays done", () => {
    for (const step of ["problem", "write", "result", "modes", "ask"] as const) {
      expect(tourReducer({ ...initialTour(), step }, { type: "skip" })).toMatchObject({ step: "done", skipped: true });
    }
    const done = run([{ type: "skip" }]);
    for (const e of [{ type: "next" }, { type: "problemReady" }, { type: "mark", mark: "check" }, { type: "askOpened" }] as TourEvent[]) {
      expect(tourReducer(done, e)).toBe(done);
    }
  });

  it("resumes where it was after a reload (a result on screen resumes at the next mark)", () => {
    expect(initialTour("modes").step).toBe("modes");
    const expected: Record<TourStep, string | null> = { problem: "problem", write: "write", result: "modes", modes: "modes", ask: "ask", done: null };
    for (const [step, marker] of Object.entries(expected)) expect(markerStepOf(step as TourStep)).toBe(marker);
  });

  it("numbers the marks 1 to 3", () => {
    expect(COACH_COUNT).toBe(3);
    expect([coachNumber("problem"), coachNumber("write"), coachNumber("result"), coachNumber("modes"), coachNumber("ask"), coachNumber("done")]).toEqual([null, 1, 1, 2, 3, null]);
  });
});

describe("reading the tutor's marks off the board", () => {
  it("knows a tick, a ring and a question mark by their meta", () => {
    const meta = (mark: string) => ({ live: true, source: "ai", lineId: "l1", mark });
    expect(markKindOf(meta("check:12,40,55,11"))).toBe("check");
    expect(markKindOf(meta("circle:12,40,55,11"))).toBe("circle");
    expect(markKindOf(meta("question:1,2,3,4"))).toBe("question");
  });

  it("ignores everything else: the tutor's writing, the student's ink, a foreign meta", () => {
    expect(markKindOf({ live: true, source: "ai", lineId: "chat" })).toBeNull();
    expect(markKindOf({ live: true, source: "echo", mark: "check:1,2,3,4" })).toBeNull();
    expect(markKindOf({ mark: "check:1,2,3,4" })).toBeNull();
    expect(markKindOf({ live: true, source: "ai", mark: "star:1,2,3,4" })).toBeNull();
    expect(markKindOf(null)).toBeNull();
    expect(markKindOf("check")).toBeNull();
  });

  it("knows why a question mark is there (a question mark from before the reason was kept: unread)", () => {
    const meta = (mark: string, markWhy?: string) => ({ live: true, source: "ai", lineId: "l1", mark, ...(markWhy ? { markWhy } : {}) });
    expect(questionWhyOf(meta("question:1,2,3,4", "unjudged"))).toBe("unjudged");
    expect(questionWhyOf(meta("question:1,2,3,4", "unread"))).toBe("unread");
    expect(questionWhyOf(meta("question:1,2,3,4"))).toBe("unread");
    expect(questionWhyOf(meta("check:1,2,3,4", "unjudged"))).toBeNull();
  });
});
