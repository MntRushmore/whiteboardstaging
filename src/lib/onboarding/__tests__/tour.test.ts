import { describe, expect, it } from "vitest";
import { CHAT_PROBLEM_META } from "@/lib/live/chat/cells";
import { isTutorWork, markKindOf, questionWhyOf } from "../marks";
import { askProgress, COACH_COUNT, coachNumber, initialTour, markerStepOf, tourAutoAtEnd, tourAutoBefore, tourReducer, type TourEvent, type TourState, type TourStep } from "../tour";

function run(events: TourEvent[], from: TourState = initialTour()): TourState {
  return events.reduce(tourReducer, from);
}

describe("coach marks", () => {
  it("starts on the problem, then has the student write, ask for help and ask for more, then celebrates", () => {
    let s = initialTour();
    expect(s).toEqual({ step: "problem", outcome: null, unread: false, unjudged: false, help: "waiting", asks: 0, askFrom: 0, skipped: false });
    s = tourReducer(s, { type: "problemReady" });
    expect(s.step).toBe("write");
    s = tourReducer(s, { type: "mark", mark: "check" });
    expect(s).toMatchObject({ step: "result", outcome: "tick" });
    s = tourReducer(s, { type: "next" });
    expect(s).toMatchObject({ step: "help", help: "waiting" });
    s = tourReducer(s, { type: "helpAsked", ok: true });
    expect(s).toMatchObject({ step: "help", help: "asked", asks: 1 });
    s = tourReducer(s, { type: "tutorWrote" });
    expect(s.step).toBe("helped");
    s = tourReducer(s, { type: "next" });
    expect(s.step).toBe("ask");
    s = tourReducer(s, { type: "askOpened" });
    expect(s.step).toBe("asking");
    s = tourReducer(s, { type: "askAnswered" });
    expect(s.step).toBe("finish");
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

  it("ticks and rings count only on the first coach mark", () => {
    for (const step of ["problem", "help", "helped", "ask", "asking", "finish"] as const) {
      const s = { ...initialTour(), step };
      expect(tourReducer(s, { type: "mark", mark: "check" })).toBe(s);
      expect(tourReducer(s, { type: "mark", mark: "circle" })).toBe(s);
    }
  });

  it("Next moves on without waiting for the board (no pen, Live off, offline)", () => {
    expect(run([{ type: "problemReady" }, { type: "next" }]).step).toBe("help");
    // nothing was written: the problem step does not hold the tour
    expect(run([{ type: "next" }]).step).toBe("write");
    expect(run([{ type: "next" }], { ...initialTour(), step: "help" }).step).toBe("ask");
    expect(run([{ type: "next" }], { ...initialTour(), step: "ask" }).step).toBe("finish");
    expect(run([{ type: "next" }], { ...initialTour(), step: "asking" }).step).toBe("finish");
  });
});

describe("coach mark 2: Help me", () => {
  const help = { ...initialTour(), step: "help" } as const;

  it("waits for the tutor to write for the student's own Help me — not for what it writes by itself (Auto)", () => {
    // Auto's step at a pause, or Solve finishing the problem, is not the lesson "tap Help me"
    expect(tourReducer(help, { type: "tutorWrote" })).toBe(help);
    const empty = tourReducer(help, { type: "helpAsked", ok: false });
    expect(tourReducer(empty, { type: "tutorWrote" })).toBe(empty);
    const unread = tourReducer(help, { type: "mark", mark: "question" });
    expect(tourReducer(unread, { type: "tutorWrote" })).toBe(unread);
    expect(run([{ type: "helpAsked", ok: true }, { type: "tutorWrote" }], help).step).toBe("helped");
  });

  it("says so when Help me found nothing to help with, and a later tap that works clears it", () => {
    const empty = tourReducer(help, { type: "helpAsked", ok: false });
    expect(empty).toMatchObject({ step: "help", help: "empty" });
    expect(tourReducer(empty, { type: "helpAsked", ok: true })).toMatchObject({ help: "asked", asks: 2 });
  });

  it("says so when Help me answered with a question mark (ink it could not read)", () => {
    expect(tourReducer(help, { type: "mark", mark: "question" })).toMatchObject({ step: "help", help: "unread" });
  });

  it("offers Next once an ask has taken a while, and only after an ask", () => {
    expect(tourReducer(help, { type: "helpSlow" })).toBe(help);
    const asked = tourReducer(help, { type: "helpAsked", ok: true });
    expect(tourReducer(asked, { type: "helpSlow" })).toMatchObject({ help: "slow" });
    const empty = tourReducer(help, { type: "helpAsked", ok: false });
    expect(tourReducer(empty, { type: "helpSlow" })).toBe(empty);
    // still written after all: the step is the lesson
    expect(run([{ type: "helpSlow" }, { type: "tutorWrote" }], asked).step).toBe("helped");
  });

  it("counts each tap, so each one restarts the wait", () => {
    expect(run([{ type: "helpAsked", ok: true }, { type: "helpAsked", ok: true }], help).asks).toBe(2);
  });

  it("a student who taps Help me before writing goes straight to what it wrote", () => {
    const write = run([{ type: "problemReady" }]);
    // the tutor's own writing in coach mark 1 (an answer after "=") is not the student's doing
    expect(tourReducer(write, { type: "tutorWrote" })).toBe(write);
    const asked = tourReducer(write, { type: "helpAsked", ok: true });
    expect(asked).toMatchObject({ step: "write", help: "asked" });
    expect(tourReducer(asked, { type: "tutorWrote" }).step).toBe("helped");
    // ...and a tap that found nothing leaves coach mark 1 where it was
    expect(tourReducer(write, { type: "helpAsked", ok: false })).toMatchObject({ step: "write", help: "empty" });
  });

  it("coach mark 2 starts fresh after coach mark 1, and Help me is not counted elsewhere", () => {
    const asked = run([{ type: "problemReady" }, { type: "helpAsked", ok: false }, { type: "mark", mark: "check" }, { type: "next" }]);
    expect(asked).toMatchObject({ step: "help", help: "waiting" });
    for (const step of ["problem", "result", "helped", "ask", "asking", "finish"] as const) {
      const s = { ...initialTour(), step };
      expect(tourReducer(s, { type: "helpAsked", ok: true })).toBe(s);
      if (step !== "result") expect(tourReducer(s, { type: "tutorWrote" })).toBe(s);
    }
  });
});

describe("Auto during the tour", () => {
  it("remembers the student's own setting when the tour turns Auto on — a tour resumed after a reload keeps the first one", () => {
    expect(tourAutoBefore(false, undefined)).toBe(false);
    expect(tourAutoBefore(true, undefined)).toBe(true);
    // reloaded mid-tour: Auto is on because the tour turned it on; the student's setting is the remembered one
    expect(tourAutoBefore(true, false)).toBe(false);
  });

  it("gives it back when the tour ends, finished or skipped — unless the student switched it themselves", () => {
    // off before, on for the tour: off again
    expect(tourAutoAtEnd(false, true)).toBe(false);
    // on before: nothing to give back
    expect(tourAutoAtEnd(true, true)).toBeNull();
    // the student switched it off during the tour: theirs already
    expect(tourAutoAtEnd(false, false)).toBeNull();
    // a tour from before this was remembered: left as it is
    expect(tourAutoAtEnd(undefined, true)).toBeNull();
  });
});

describe("coach mark 3: Ask", () => {
  it("opening the panel moves on to what to tap in it, remembering what it held; closing it goes back", () => {
    const asking = run([{ type: "askOpened", messages: 4 }], { ...initialTour(), step: "ask" });
    expect(asking).toMatchObject({ step: "asking", askFrom: 4 });
    expect(run([{ type: "askOpened" }], { ...initialTour(), step: "ask" }).askFrom).toBe(0);
    expect(tourReducer(asking, { type: "askClosed" }).step).toBe("ask");
    expect(tourReducer(asking, { type: "askAnswered" }).step).toBe("finish");
  });

  it("only the Ask steps listen to the panel", () => {
    for (const step of ["problem", "write", "result", "help", "helped", "finish"] as const) {
      const s = { ...initialTour(), step };
      for (const e of [{ type: "askOpened" }, { type: "askClosed" }, { type: "askAnswered" }] as TourEvent[]) expect(tourReducer(s, e)).toBe(s);
    }
    const ask = { ...initialTour(), step: "ask" } as const;
    expect(tourReducer(ask, { type: "askAnswered" })).toBe(ask);
  });

  it("follows the student's ask in the panel from where coach mark 3 opened it", () => {
    const before = [
      { role: "user", text: "5 two-step equations" },
      { role: "tutor", state: "done" },
    ];
    expect(askProgress([], 0)).toBe("waiting");
    // an answer from before this coach mark is not this ask's
    expect(askProgress(before, 2)).toBe("waiting");
    expect(askProgress([...before, { role: "user" }, { role: "tutor", state: "thinking" }], 2)).toBe("busy");
    expect(askProgress([...before, { role: "user" }, { role: "tutor", state: "writing" }], 2)).toBe("busy");
    expect(askProgress([...before, { role: "user" }, { role: "tutor", state: "done" }], 2)).toBe("answered");
    // a failed ask (out of ink, offline) ends the wait too: the student did ask
    expect(askProgress([{ role: "user" }, { role: "tutor", state: "error" }], 0)).toBe("answered");
    expect(askProgress([{ role: "user" }], -3)).toBe("busy");
  });
});

describe("the end of the tour", () => {
  it("the finish card's button ends it as finished, Esc there too", () => {
    const finish = { ...initialTour(), step: "finish" } as const;
    expect(tourReducer(finish, { type: "next" })).toMatchObject({ step: "done", skipped: false });
    expect(tourReducer(finish, { type: "skip" })).toMatchObject({ step: "done", skipped: false });
    for (const e of [{ type: "problemReady" }, { type: "tutorWrote" }, { type: "askAnswered" }, { type: "helpAsked", ok: true }] as TourEvent[]) {
      expect(tourReducer(finish, e)).toBe(finish);
    }
  });

  it("skip ends it from any coach mark, and done stays done", () => {
    for (const step of ["problem", "write", "result", "help", "helped", "ask", "asking"] as const) {
      expect(tourReducer({ ...initialTour(), step }, { type: "skip" })).toMatchObject({ step: "done", skipped: true });
    }
    const done = run([{ type: "skip" }]);
    for (const e of [{ type: "next" }, { type: "problemReady" }, { type: "mark", mark: "check" }, { type: "askOpened" }, { type: "tutorWrote" }, { type: "skip" }] as TourEvent[]) {
      expect(tourReducer(done, e)).toBe(done);
    }
  });

  it("resumes where it was after a reload (a coach mark saying what happened resumes at the next one)", () => {
    expect(initialTour("help").step).toBe("help");
    const expected: Record<TourStep, string | null> = {
      problem: "problem",
      write: "write",
      result: "help",
      help: "help",
      helped: "ask",
      ask: "ask",
      asking: "ask",
      finish: null,
      done: null,
    };
    for (const [step, marker] of Object.entries(expected)) expect(markerStepOf(step as TourStep)).toBe(marker);
  });

  it("numbers the coach marks 1 to 3 (the finish card is not one)", () => {
    expect(COACH_COUNT).toBe(3);
    const steps: TourStep[] = ["problem", "write", "result", "help", "helped", "ask", "asking", "finish", "done"];
    expect(steps.map(coachNumber)).toEqual([null, 1, 1, 2, 2, 3, 3, null, null]);
  });
});

describe("reading the tutor's writing off the board", () => {
  it("knows a step, a solution, a graph the tutor wrote", () => {
    expect(isTutorWork({ live: true, source: "ai", lineId: "l1", suggestFor: "2x = 9" })).toBe(true);
    expect(isTutorWork({ live: true, source: "ai", lineId: "l1", problemWork: "step" })).toBe(true);
    expect(isTutorWork({ live: true, source: "ai", lineId: "l1", operationResult: "2x = 8" })).toBe(true);
    expect(isTutorWork({ live: true, source: "ai", lineId: "chat" })).toBe(true);
  });

  it("ignores marks, the chat's problems, the student's ink and anything foreign", () => {
    expect(isTutorWork({ live: true, source: "ai", lineId: "l1", mark: "check:1,2,3,4" })).toBe(false);
    expect(isTutorWork({ live: true, source: "ai", lineId: "chat", [CHAT_PROBLEM_META]: { n: 1, lines: ["2x + 3 = 11"] } })).toBe(false);
    expect(isTutorWork({ live: true, source: "echo", lineId: "l1" })).toBe(false);
    expect(isTutorWork({})).toBe(false);
    expect(isTutorWork(null)).toBe(false);
    expect(isTutorWork("ai")).toBe(false);
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
