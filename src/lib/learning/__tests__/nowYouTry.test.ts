import { describe, expect, it } from "vitest";
import type { AttemptRecord } from "../contracts";
import {
  initialNowYouTry,
  NOW_YOU_TRY,
  NOW_YOU_TRY_COPY,
  nowYouTryReducer,
  problemLines,
  seedOf,
  wantsOffer,
  type NowYouTryEvent,
  type NowYouTryState,
} from "../nowYouTry";

const T0 = Date.parse("2026-10-04T15:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function rec(id: string, over: Partial<AttemptRecord> & { start?: number; update?: number; finish?: number | null } = {}): AttemptRecord {
  const { start = T0, update = start, finish = null, ...rest } = over;
  return {
    id,
    boardId: "b1",
    problemLatex: "2x + 3 = 11",
    skill: "two_step_equations",
    course: null,
    origin: "student",
    parentId: null,
    outcome: "in_progress",
    mistakes: {},
    activeMs: 0,
    startedAt: iso(start),
    updatedAt: iso(update),
    finishedAt: finish === null ? null : iso(finish),
    linesWritten: 0,
    linesRight: 0,
    linesRinged: 0,
    hints: 0,
    tutorSteps: 0,
    solves: 0,
    asks: 0,
    ...rest,
  };
}

const attempt = (record: AttemptRecord, now = Date.parse(record.updatedAt), tour = false): NowYouTryEvent => ({ type: "attempt", record, now, tour });

function run(events: NowYouTryEvent[], from: NowYouTryState = initialNowYouTry()): NowYouTryState {
  return events.reduce(nowYouTryReducer, from);
}

/** A's problem is worked and then solved by the tutor at T0 + 60 s. */
const started = rec("A", { start: T0, update: T0 });
const solved = rec("A", { start: T0, update: T0 + 60_000, finish: T0 + 60_000, outcome: "tutor_solved", solves: 1 });

describe("Now you try: when it is offered", () => {
  it("the tutor solving a problem offers one more like it, once its problem exists", () => {
    const s = run([attempt(started), attempt(solved)]);
    expect(s.offer).toBeNull();
    expect(s.pending).toMatchObject({ attemptId: "A", problem: ["2x + 3 = 11"], since: T0 + 60_000, seed: seedOf("A") });
    const shown = nowYouTryReducer(s, { type: "variant", attemptId: "A", problem: ["3x + 4 = 19"] });
    expect(shown.pending).toBeNull();
    expect(shown.offer).toEqual({ attemptId: "A", problem: ["3x + 4 = 19"], since: T0 + 60_000 });
  });

  it("help that got the student to the answer offers one too, and so do taught and Now-you-try problems", () => {
    const helped = rec("H", { start: T0, update: T0 + 5_000, finish: T0 + 5_000, outcome: "with_help", hints: 1, linesWritten: 3, linesRight: 3 });
    expect(run([attempt(helped)]).pending?.attemptId).toBe("H");
    const taught = rec("T", { origin: "teach", update: T0 + 5_000, finish: T0 + 5_000, outcome: "tutor_solved" });
    expect(run([attempt(taught)]).pending?.attemptId).toBe("T");
    // the loop goes on until they get one alone
    const again = rec("N", { origin: "now_you_try", parentId: "A", update: T0 + 5_000, finish: T0 + 5_000, outcome: "with_help", hints: 2, linesWritten: 2 });
    expect(run([attempt(again)]).pending?.attemptId).toBe("N");
  });

  it("solving it alone, being in progress or left unfinished offers nothing", () => {
    for (const outcome of ["first_try", "self_corrected", "in_progress", "unfinished"] as const) {
      const s = run([attempt(rec("A", { update: T0 + 1_000, finish: outcome === "in_progress" ? null : T0 + 1_000, outcome, linesWritten: 3 }))]);
      expect(s.pending, outcome).toBeNull();
      expect(s.decided, outcome).toEqual([]);
    }
  });

  it("a system's lines come back from the record's joined LaTeX", () => {
    expect(problemLines("x + y = 5; x - y = 1")).toEqual(["x + y = 5", "x - y = 1"]);
    expect(problemLines("2x + 3 = 11")).toEqual(["2x + 3 = 11"]);
    expect(problemLines("  ")).toEqual([]);
    const sys = rec("S", { problemLatex: "x + y = 5; x - y = 1", update: T0 + 1_000, finish: T0 + 1_000, outcome: "tutor_solved" });
    expect(run([attempt(sys)]).pending?.problem).toEqual(["x + y = 5", "x - y = 1"]);
  });

  it("no problem like it (variantOf found none): nothing shows", () => {
    const s = nowYouTryReducer(run([attempt(started), attempt(solved)]), { type: "variant", attemptId: "A", problem: null });
    expect(s.offer).toBeNull();
    expect(s.pending).toBeNull();
    expect(nowYouTryReducer(run([attempt(solved)]), { type: "variant", attemptId: "A", problem: [] }).offer).toBeNull();
  });

  it("a problem worked out for an attempt no longer pending is dropped", () => {
    const s = run([attempt(solved)]);
    expect(nowYouTryReducer(s, { type: "variant", attemptId: "other", problem: ["x = 1"] })).toBe(s);
  });

  it("not during the onboarding tour", () => {
    const s = run([attempt(solved, T0 + 60_000, true)]);
    expect(s.pending).toBeNull();
    expect(s.offer).toBeNull();
  });

  it("not for an outcome that is old news when it arrives (a record published again after a reload)", () => {
    const late = T0 + 60_000 + NOW_YOU_TRY.freshMs + 1;
    expect(run([attempt(solved, late)]).pending).toBeNull();
    expect(run([attempt(solved, T0 + 60_000 + NOW_YOU_TRY.freshMs)]).pending?.attemptId).toBe("A");
  });

  it("an empty problem offers nothing", () => {
    expect(run([attempt(rec("E", { problemLatex: "", update: T0 + 1, finish: T0 + 1, outcome: "tutor_solved" }))]).pending).toBeNull();
  });
});

describe("Now you try: once per attempt", () => {
  it("the same attempt published again (more updates, closed) is not offered twice", () => {
    const shown = nowYouTryReducer(run([attempt(started), attempt(solved)]), { type: "variant", attemptId: "A", problem: ["3x + 4 = 19"] });
    const dismissed = nowYouTryReducer(shown, { type: "dismiss" });
    expect(dismissed.offer).toBeNull();
    const closed = rec("A", { start: T0, update: T0 + 70_000, finish: T0 + 60_000, outcome: "tutor_solved", solves: 1, activeMs: 9_000 });
    const after = run([attempt(closed), attempt(solved)], dismissed);
    expect(after.pending).toBeNull();
    expect(after.offer).toBeNull();
    expect(after.decided).toEqual(["A"]);
  });

  it("an attempt passed over (the tour, new work) is settled too: a later update never brings it back", () => {
    const s = run([attempt(solved, T0 + 60_000, true), attempt(solved, T0 + 61_000, false)]);
    expect(s.pending).toBeNull();
    expect(s.decided).toEqual(["A"]);
  });

  it("an offer published again while it shows stays", () => {
    const shown = nowYouTryReducer(run([attempt(solved)]), { type: "variant", attemptId: "A", problem: ["x + 1 = 2"] });
    const again = nowYouTryReducer(shown, attempt(rec("A", { update: T0 + 65_000, finish: T0 + 60_000, outcome: "tutor_solved" })));
    expect(again.offer).toEqual(shown.offer);
  });

  it("remembers a bounded number of attempts", () => {
    let s = initialNowYouTry();
    for (let i = 0; i < NOW_YOU_TRY.remember + 20; i++) {
      s = nowYouTryReducer(s, attempt(rec(`a${i}`, { start: T0 + i, update: T0 + i, finish: T0 + i, outcome: "tutor_solved" })));
    }
    expect(s.decided).toHaveLength(NOW_YOU_TRY.remember);
    expect(Object.keys(s.seen)).toHaveLength(NOW_YOU_TRY.remember);
    expect(s.decided.at(-1)).toBe(`a${NOW_YOU_TRY.remember + 19}`);
  });
});

describe("Now you try: not once the student has moved on", () => {
  it("another problem started after this one finished: no offer", () => {
    const next = rec("B", { start: T0 + 61_000, update: T0 + 61_000 });
    // B's start arrived first; A's outcome is published late
    const s = run([attempt(started), attempt(next), attempt(solved, T0 + 62_000)]);
    expect(s.pending).toBeNull();
    expect(s.decided).toEqual(["A"]);
  });

  it("another problem written on after this one finished: no offer", () => {
    const b0 = rec("B", { start: T0 - 10_000, update: T0 - 10_000 });
    const b1 = rec("B", { start: T0 - 10_000, update: T0 + 61_000, linesWritten: 1 });
    expect(run([attempt(b0), attempt(started), attempt(b1), attempt(solved, T0 + 62_000)]).pending).toBeNull();
  });

  it("problems of the same set, untouched since they were written, do not count as new work", () => {
    const set = ["P1", "P2", "P3"].map((id) => rec(id, { start: T0, update: T0 }));
    const p2 = rec("P2", { start: T0, update: T0 + 40_000, finish: T0 + 40_000, outcome: "tutor_solved" });
    // a tutor-side update of another (closed when the screen changed) is not the student's work either
    const p3closed = rec("P3", { start: T0, update: T0 + 41_000, finish: T0 + 41_000, outcome: "unfinished" });
    const s = run([...set.map((r) => attempt(r)), attempt(p2), attempt(p3closed)]);
    expect(s.pending?.attemptId).toBe("P2");
  });

  it("work on the problem itself after it finished is not moving on", () => {
    const own = rec("A", { start: T0, update: T0 + 65_000, finish: T0 + 60_000, outcome: "tutor_solved", linesWritten: 2 });
    const shown = nowYouTryReducer(run([attempt(started), attempt(solved)]), { type: "variant", attemptId: "A", problem: ["x = 2"] });
    expect(nowYouTryReducer(shown, attempt(own)).offer?.attemptId).toBe("A");
  });

  it("wantsOffer reads the same rules directly", () => {
    const s = run([attempt(started)]);
    expect(wantsOffer(s, solved, T0 + 60_000, false)).toBe(true);
    expect(wantsOffer(s, solved, T0 + 60_000, true)).toBe(false);
    expect(wantsOffer({ ...s, decided: ["A"] }, solved, T0 + 60_000, false)).toBe(false);
  });
});

describe("Now you try: what clears it", () => {
  const showing = () => nowYouTryReducer(run([attempt(started), attempt(solved)]), { type: "variant", attemptId: "A", problem: ["3x + 4 = 19"] });

  it("a screen change", () => {
    const s = nowYouTryReducer(showing(), { type: "screen" });
    expect(s.offer).toBeNull();
    // and one being worked out never shows
    const pending = nowYouTryReducer(run([attempt(solved)]), { type: "screen" });
    expect(nowYouTryReducer(pending, { type: "variant", attemptId: "A", problem: ["x = 1"] }).offer).toBeNull();
  });

  it("a new problem attempt starting", () => {
    const s = nowYouTryReducer(showing(), attempt(rec("C", { start: T0 + 90_000, update: T0 + 90_000 })));
    expect(s.offer).toBeNull();
    const pending = nowYouTryReducer(run([attempt(solved)]), attempt(rec("C", { start: T0 + 61_000 })));
    expect(pending.pending).toBeNull();
  });

  it("the student writing on another problem", () => {
    const b0 = rec("B", { start: T0 - 5_000, update: T0 - 5_000 });
    const base = nowYouTryReducer(run([attempt(b0), attempt(started), attempt(solved)]), { type: "variant", attemptId: "A", problem: ["x = 3"] });
    expect(base.offer).not.toBeNull();
    expect(nowYouTryReducer(base, attempt(rec("B", { start: T0 - 5_000, update: T0 + 80_000, linesWritten: 1 }))).offer).toBeNull();
  });

  it("Not now, and taking it", () => {
    expect(nowYouTryReducer(showing(), { type: "dismiss" }).offer).toBeNull();
    expect(nowYouTryReducer(showing(), { type: "take" }).offer).toBeNull();
  });

  it("the problem it wrote (origin now_you_try) starting does not bring it back", () => {
    const taken = nowYouTryReducer(showing(), { type: "take" });
    const child = rec("N", { origin: "now_you_try", parentId: "A", start: T0 + 70_000, update: T0 + 70_000 });
    const s = nowYouTryReducer(taken, attempt(child));
    expect(s.offer).toBeNull();
    expect(s.pending).toBeNull();
  });

  it("at most one offer: a newer one replaces it", () => {
    const set = rec("B", { start: T0 - 1_000, update: T0 + 90_000, finish: T0 + 90_000, outcome: "tutor_solved" });
    const s = nowYouTryReducer(showing(), attempt(set));
    expect(s.offer).toBeNull();
    expect(s.pending?.attemptId).toBe("B");
    expect(nowYouTryReducer(s, { type: "variant", attemptId: "B", problem: ["y = 1"] }).offer?.attemptId).toBe("B");
  });

  it("nothing to clear leaves the state as it is", () => {
    const s = run([attempt(started)]);
    expect(nowYouTryReducer(s, { type: "screen" })).toBe(s);
    expect(nowYouTryReducer(s, { type: "dismiss" })).toBe(s);
  });
});

describe("Now you try: copy and seeds", () => {
  it("the button and its close say what the owner asked for", () => {
    expect(NOW_YOU_TRY_COPY.go).toBe("Now you try one!");
    expect(NOW_YOU_TRY_COPY.notNow).toBe("Not now");
    // a screen reader's name holds the words on the button
    expect(NOW_YOU_TRY_COPY.goLabel.startsWith("Now you try one")).toBe(true);
    expect(NOW_YOU_TRY_COPY.notNowLabel.startsWith(NOW_YOU_TRY_COPY.notNow)).toBe(true);
  });

  it("seeds are stable per attempt and differ between attempts", () => {
    expect(seedOf("abc")).toBe(seedOf("abc"));
    expect(seedOf("abc")).not.toBe(seedOf("abd"));
    expect(seedOf("abc")).toBeGreaterThanOrEqual(0);
    expect(seedOf("abc")).toBeLessThanOrEqual(0x7fffffff);
  });
});
