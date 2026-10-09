import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveEngine } from "@/lib/live/contracts";
import { LEARNING_LIMITS, type AttemptRecord, type LearningSignal, type LineMark } from "../contracts";
import { AttemptTracker, originOfKey, type TrackerDeps } from "../tracker";

// the classifiers are another agent's: here, small fakes that say what they were asked
vi.mock("../skills", () => ({
  classifyProblem: (lines: readonly string[]) => (lines.join(" ").includes("x^{2}") ? "quadratic_equations" : lines.length > 0 ? "two_step_equations" : "other"),
}));
const classifyMistake = vi.fn((_engine: LiveEngine, previous: string, latex: string): string | null => {
  void previous;
  return latex.includes("-") ? "sign" : latex.includes("=7") ? "arithmetic" : null;
});
vi.mock("../mistakes", () => ({
  classifyMistake: (engine: LiveEngine, previous: string, latex: string) => classifyMistake(engine, previous, latex),
}));

const BOARD = "board-1";
const PAGE = "page:1";
const PAGE2 = "page:2";
const INK = `${PAGE}#ink:ln_head`;
const CELL = `${PAGE}#cell:hb_1`;
const SEC = 1000;
const MIN = 60 * SEC;
const T0 = Date.parse("2026-10-04T15:00:00.000Z");

type Line = Extract<LearningSignal, { type: "line" }>;

describe("AttemptTracker", () => {
  let now: number;
  let ids: number;
  let published: AttemptRecord[];
  let saved: AttemptRecord[][];
  let save: TrackerDeps["save"];
  let tracker: AttemptTracker;

  function make(over: Partial<TrackerDeps> = {}): AttemptTracker {
    return new AttemptTracker({
      now: () => now,
      newId: () => `att-${++ids}`,
      course: "algebra1",
      save: (records) => save(records),
      publish: (r) => published.push(r),
      engine: async () => ({}) as LiveEngine,
      ...over,
    });
  }

  beforeEach(() => {
    now = T0;
    ids = 0;
    published = [];
    saved = [];
    save = async (records) => {
      saved.push([...records]);
    };
    classifyMistake.mockClear();
    tracker = make();
  });

  /** A student line signal at `at` (s after T0). */
  function line(at: number, lineId: string, latex: string, mark: LineMark, opts: Partial<Line> = {}): Line {
    return { type: "line", at: T0 + at * SEC, boardId: BOARD, pageId: PAGE, problemKey: INK, problemLatex: ["2x+3=11"], lineId, latex, kind: "equation", mark, solved: false, ...opts };
  }
  const help = (at: number, kind: Extract<LearningSignal, { type: "help" }>["help"], key = INK, auto = false): LearningSignal => ({ type: "help", at: T0 + at * SEC, problemKey: key, help: kind, auto });
  const latest = () => published.at(-1)!;
  const feed = (...signals: LearningSignal[]) => signals.forEach((s) => tracker.handle(s));

  describe("outcomes", () => {
    it("first try: solved with no ring and no help", () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=8", "check"), line(20, "c", "x=4", "check", { solved: true }));
      expect(latest()).toMatchObject({
        id: "att-1",
        boardId: BOARD,
        problemLatex: "2x+3=11",
        skill: "two_step_equations",
        course: "algebra1",
        origin: "student",
        parentId: null,
        outcome: "first_try",
        linesWritten: 3,
        linesRight: 2,
        linesRinged: 0,
        hints: 0,
        tutorSteps: 0,
        solves: 0,
        asks: 0,
        startedAt: new Date(T0).toISOString(),
        finishedAt: new Date(T0 + 20 * SEC).toISOString(),
      });
    });

    it("self-corrected: a ring, then the answer, no help", () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=7", "circle", { previousLatex: "2x+3=11" }), line(20, "b2", "2x=8", "check"), line(30, "c", "x=4", "check", { solved: true }));
      expect(latest()).toMatchObject({ outcome: "self_corrected", linesWritten: 4, linesRinged: 1, linesRight: 2 });
    });

    it("with help: a hint, a step or a solve before the answer", () => {
      feed(line(0, "a", "2x+3=11", null), help(5, "hint"), line(10, "b", "2x=8", "check"), line(20, "c", "x=4", "check", { solved: true }));
      expect(latest()).toMatchObject({ outcome: "with_help", hints: 1 });
      tracker = make();
      feed(line(0, "a", "2x+3=11", null), help(5, "next_step", INK, true), line(20, "c", "x=4", "check", { solved: true }));
      expect(latest()).toMatchObject({ outcome: "with_help", tutorSteps: 1 });
    });

    it("an ask alone is not help: the outcome is the student's", () => {
      feed(line(0, "a", "2x+3=11", null), help(5, "ask"), line(20, "c", "x=4", "check", { solved: true }));
      expect(latest()).toMatchObject({ outcome: "first_try", asks: 1 });
    });

    it("tutor solved: the tutor finished before the student did — and a later answer of theirs does not change it", () => {
      feed(line(0, "a", "2x+3=11", null), help(5, "ask"), help(5, "solve"), { type: "tutor_solved", at: T0 + 5 * SEC, boardId: BOARD, pageId: PAGE, problemKey: INK, problemLatex: ["2x+3=11"] });
      expect(latest()).toMatchObject({ outcome: "tutor_solved", solves: 1, asks: 1, finishedAt: new Date(T0 + 5 * SEC).toISOString() });
      feed(line(30, "c", "x=4", "check", { solved: true }));
      expect(latest()).toMatchObject({ outcome: "tutor_solved", linesWritten: 2 });
    });

    it("the tutor solving a problem the student already solved leaves it theirs", () => {
      feed(line(0, "a", "2x+3=11", null), line(20, "c", "x=4", "check", { solved: true }), { type: "tutor_solved", at: T0 + 30 * SEC, boardId: BOARD, pageId: PAGE, problemKey: INK, problemLatex: [] });
      expect(latest()).toMatchObject({ outcome: "first_try" });
    });

    it("answered, it stays answered — but a ring or help after the answer is part of how it went, and when it finished stays", () => {
      feed(line(0, "a", "2x+3=11", null), line(20, "c", "x=4", "check", { solved: true }));
      expect(latest()).toMatchObject({ outcome: "first_try", finishedAt: new Date(T0 + 20 * SEC).toISOString() });
      feed(line(30, "d", "x=5", "circle"));
      expect(latest()).toMatchObject({ outcome: "self_corrected", linesRinged: 1, finishedAt: new Date(T0 + 20 * SEC).toISOString() });
      feed(help(31, "next_step"));
      expect(latest()).toMatchObject({ outcome: "with_help", linesRinged: 1, tutorSteps: 1, finishedAt: new Date(T0 + 20 * SEC).toISOString() });
      // the answer read again as something else never takes the answer back
      feed(line(40, "c", "x=9", "circle"));
      expect(latest()).toMatchObject({ outcome: "with_help", linesRight: 0, linesRinged: 2 });
    });

    it("prod's rows, replayed: never `first_try` beside a ring (13 × 4, 5 + 8, 7 + 8)", () => {
      // `13 \times 4`: the answer ticked, then two lines ringed under it and its tick taken off
      const key = `${PAGE}#cell:hb_13x4`;
      const at = (s: number, id: string, latex: string, mark: LineMark, solved = false) => line(s, id, latex, mark, { problemKey: key, problemLatex: [], solved });
      feed({ type: "problem", at: T0, boardId: BOARD, pageId: PAGE, problemKey: key, problemLatex: ["13 \\times 4"], origin: "tutor_problem" });
      feed(at(5, "p", "52", "check", true), at(10, "q", "40", "circle"), at(12, "r", "12", "circle"), at(14, "p", "32", "circle"));
      expect(latest()).toMatchObject({ problemLatex: "13 \\times 4", outcome: "self_corrected", linesRight: 0, linesRinged: 3 });
    });

    it("the stored outcome is always outcomeOf over the stored counts, whatever order the signals come in", () => {
      const marks: LineMark[] = [null, "check", "circle", "question"];
      let seed = 7;
      const rand = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
      };
      for (let run = 0; run < 60; run++) {
        published = [];
        tracker = make();
        for (let i = 0; i < 12; i++) {
          const roll = rand(10);
          if (roll < 6) {
            const mark = marks[rand(marks.length)];
            feed(line(i, `l${rand(5)}`, `x=${rand(9)}`, mark, { solved: mark === "check" && rand(3) === 0 }));
          } else if (roll < 8) feed(help(i, (["hint", "next_step", "solve", "ask"] as const)[rand(4)]));
          else if (roll < 9) feed({ type: "tutor_solved", at: T0 + i * SEC, boardId: BOARD, pageId: PAGE, problemKey: INK, problemLatex: [] });
          else feed({ type: "screen", at: T0 + i * SEC, boardId: BOARD, pageId: rand(2) === 0 ? PAGE2 : PAGE });
        }
        for (const r of published) {
          const help = r.hints + r.tutorSteps + r.solves;
          if (r.outcome === "first_try") expect(r.linesRinged === 0 && help === 0, JSON.stringify(r)).toBe(true);
          if (r.outcome === "self_corrected") expect(r.linesRinged > 0 && help === 0, JSON.stringify(r)).toBe(true);
          if (r.outcome === "with_help") expect(help > 0, JSON.stringify(r)).toBe(true);
          if (r.outcome === "in_progress") expect(r.finishedAt).toBeNull();
          else expect(r.finishedAt).not.toBeNull();
        }
      }
    });

    it("in progress until closed; unfinished when the screen is left; open again (in progress) when its screen comes back", () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=8", "check"));
      expect(latest()).toMatchObject({ outcome: "in_progress", finishedAt: null });
      feed({ type: "screen", at: T0 + 20 * SEC, boardId: BOARD, pageId: PAGE2 });
      expect(latest()).toMatchObject({ outcome: "unfinished", finishedAt: new Date(T0 + 20 * SEC).toISOString() });
      const id = latest().id;
      feed({ type: "screen", at: T0 + 40 * SEC, boardId: BOARD, pageId: PAGE });
      // coming back says nothing; the next line opens it again
      expect(latest().outcome).toBe("unfinished");
      feed(line(50, "c", "x=4", "check", { solved: true }));
      expect(latest()).toMatchObject({ id, outcome: "first_try", finishedAt: new Date(T0 + 50 * SEC).toISOString(), linesWritten: 3 });
    });

    it("the board closing ends every attempt on it", () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=8", "check"));
      feed({ type: "closed", at: T0 + 20 * SEC, boardId: BOARD });
      expect(latest()).toMatchObject({ outcome: "unfinished" });
    });

    it("idle for 30 minutes: closed by the tick", () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=8", "check"));
      const before = published.length;
      tracker.tick(T0 + 10 * SEC + LEARNING_LIMITS.idleCloseMs - 1);
      expect(published).toHaveLength(before);
      tracker.tick(T0 + 10 * SEC + LEARNING_LIMITS.idleCloseMs);
      expect(latest()).toMatchObject({ outcome: "unfinished" });
      // a later line opens it again: the same attempt
      feed(line(10 + LEARNING_LIMITS.idleCloseMs / SEC + 60, "c", "x=4", "check", { solved: true }));
      expect(latest()).toMatchObject({ id: "att-1", outcome: "first_try" });
    });
  });

  describe("counting lines", () => {
    it("a line counts once however often it is read; it is ringed once; right is its latest mark", () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=7", "circle"), line(12, "b", "2x=7", "circle"), line(14, "b", "2x=9", "circle"), line(20, "b", "2x=8", "check"));
      expect(latest()).toMatchObject({ linesWritten: 2, linesRinged: 1, linesRight: 1 });
      feed(line(30, "b", "2x=6", "circle"));
      expect(latest()).toMatchObject({ linesWritten: 2, linesRinged: 1, linesRight: 0 });
    });

    it("the same signal twice changes nothing (and publishes nothing)", () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=8", "check"));
      const n = published.length;
      feed(line(10, "b", "2x=8", "check"), line(40, "b", "2x=8", "check"));
      expect(published).toHaveLength(n);
      expect(latest().activeMs).toBe(10 * SEC);
    });
  });

  describe("mistakes", () => {
    it("a ringed line with the line above it is classified locally (async)", async () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=-8", "circle", { previousLatex: "2x+3=11" }));
      expect(latest().mistakes).toEqual({});
      await vi.waitFor(() => expect(latest().mistakes).toEqual({ sign: 1 }));
      expect(classifyMistake).toHaveBeenCalledWith(expect.anything(), "2x+3=11", "2x=-8");
    });

    it("no line above, or no engine: nothing to compare", async () => {
      feed(line(0, "a", "2x=-8", "circle"));
      tracker = make({ engine: undefined });
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=-8", "circle", { previousLatex: "2x+3=11" }));
      await Promise.resolve();
      expect(classifyMistake).not.toHaveBeenCalled();
    });

    it("the model's mistake for the read wins: the local one that lands after it is dropped", async () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=-8", "circle", { previousLatex: "2x+3=11" }), { type: "mistake", at: T0 + 10 * SEC, problemKey: INK, lineId: "b", kind: "arithmetic", source: "model" });
      expect(latest().mistakes).toEqual({ arithmetic: 1 });
      await new Promise((r) => setTimeout(r, 0));
      expect(latest().mistakes).toEqual({ arithmetic: 1 });
    });

    it("each kind once per line; a line read again is classified again, and keeps what it had", async () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=-8", "circle", { previousLatex: "2x+3=11" }), line(20, "c", "x=-4", "check", { previousLatex: "2x=-8" }));
      await vi.waitFor(() => expect(latest().mistakes).toEqual({ sign: 1 }));
      feed(line(30, "b", "2x=7", "circle", { previousLatex: "2x+3=11" }));
      await vi.waitFor(() => expect(latest().mistakes).toEqual({ sign: 1, arithmetic: 1 }));
      // the same slip again on that line is not a new one
      feed(line(40, "b", "2x=-6", "circle", { previousLatex: "2x+3=11" }));
      await new Promise((r) => setTimeout(r, 0));
      expect(latest().mistakes).toEqual({ sign: 1, arithmetic: 1 });
    });

    it("a ringed line under a ringed line is a correction: not compared with the wrong line", async () => {
      // 3x - 5 = 10, then 3x = -5 (ringed), then the fix 3x = 15 written under it (ringed by the board too)
      feed(line(0, "a", "3x-5=10", null), line(10, "b", "3x=-5", "circle", { previousLatex: "3x-5=10" }), line(20, "c", "3x=15", "circle", { previousLatex: "3x=-5" }));
      await vi.waitFor(() => expect(latest().mistakes).toEqual({ sign: 1 }));
      await new Promise((r) => setTimeout(r, 0));
      expect(classifyMistake).toHaveBeenCalledTimes(1);
      expect(latest().linesRinged).toBe(2);
    });

    it("a model mistake for a read the board already classified replaces that read's", async () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=-8", "circle", { previousLatex: "2x+3=11" }));
      await vi.waitFor(() => expect(latest().mistakes).toEqual({ sign: 1 }));
      feed({ type: "mistake", at: T0 + 12 * SEC, problemKey: INK, lineId: "b", kind: "distribution", source: "model" });
      expect(latest().mistakes).toEqual({ distribution: 1 });
    });

    it("a mistake about a problem it does not know is dropped", () => {
      feed({ type: "mistake", at: T0, problemKey: "nope", lineId: "x", kind: "sign", source: "model" });
      expect(published).toEqual([]);
    });
  });

  describe("active time", () => {
    it("the gaps between its events, each capped at maxGapMs", () => {
      feed(line(0, "a", "2x+3=11", null), line(30, "b", "2x=8", "check"), line(30 + 600, "c", "x=4", "check", { solved: true }));
      expect(latest().activeMs).toBe(30 * SEC + LEARNING_LIMITS.maxGapMs);
    });

    it("a student's first line counts the time since the board's last event; a problem given starts the clock at nothing", () => {
      feed({ type: "problem", at: T0, boardId: BOARD, pageId: PAGE, problemKey: CELL, problemLatex: ["2x + 3 = 11"], origin: "tutor_problem" });
      feed(line(40, "a", "2x=8", "check", { problemKey: CELL, problemLatex: ["2x + 3 = 11"] }));
      expect(latest()).toMatchObject({ activeMs: 40 * SEC, origin: "tutor_problem" });
    });

    it("time spent on another problem is not this one's", () => {
      const OTHER = `${PAGE}#ink:ln_other`;
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=8", "check"));
      // 60 s on the other problem
      feed(line(20, "o1", "3x=9", null, { problemKey: OTHER, problemLatex: ["3x=9"] }), line(70, "o2", "x=3", "check", { problemKey: OTHER, problemLatex: ["3x=9"], solved: true }));
      feed(line(80, "c", "x=4", "check", { solved: true }));
      const first = published.filter((r) => r.id === "att-1").at(-1)!;
      const other = published.filter((r) => r.id === "att-2").at(-1)!;
      expect(first.activeMs).toBe(10 * SEC + 10 * SEC);
      expect(other.activeMs).toBe(10 * SEC + 50 * SEC);
    });

    it("a problem set written at once: each problem's clock starts when the student starts it", () => {
      const CELL2 = `${PAGE}#cell:hb_2`;
      feed(
        { type: "problem", at: T0, boardId: BOARD, pageId: PAGE, problemKey: CELL, problemLatex: ["2x + 3 = 11"], origin: "tutor_problem" },
        { type: "problem", at: T0 + 2 * SEC, boardId: BOARD, pageId: PAGE, problemKey: CELL2, problemLatex: ["3x = 12"], origin: "tutor_problem" },
      );
      feed(line(32, "a", "2x=8", "check", { problemKey: CELL, problemLatex: ["2x + 3 = 11"] }));
      feed(line(52, "b", "x=4", "check", { problemKey: CELL2, problemLatex: ["3x = 12"], solved: true }));
      expect(published.filter((r) => r.id === "att-1").at(-1)!.activeMs).toBe(30 * SEC);
      expect(published.filter((r) => r.id === "att-2").at(-1)!.activeMs).toBe(20 * SEC);
    });
  });

  describe("what is recorded", () => {
    it("a problem written and never touched is never recorded (nor saved)", async () => {
      feed({ type: "problem", at: T0, boardId: BOARD, pageId: PAGE, problemKey: CELL, problemLatex: ["2x + 3 = 11"], origin: "practice" });
      feed({ type: "screen", at: T0 + MIN, boardId: BOARD, pageId: PAGE2 });
      feed({ type: "closed", at: T0 + 2 * MIN, boardId: BOARD });
      await tracker.flush();
      expect(published).toEqual([]);
      expect(saved).toEqual([]);
      expect(tracker.attemptIdFor(CELL)).toBeUndefined();
    });

    it("one the tutor solved or taught is", () => {
      const TEACH = `${PAGE}#teach:123`;
      feed(
        { type: "problem", at: T0, boardId: BOARD, pageId: PAGE, problemKey: TEACH, problemLatex: ["2x + 3 = 11"], origin: "teach" },
        help(0, "solve", TEACH),
        { type: "tutor_solved", at: T0, boardId: BOARD, pageId: PAGE, problemKey: TEACH, problemLatex: ["2x + 3 = 11"], origin: "teach" },
      );
      expect(latest()).toMatchObject({ origin: "teach", outcome: "tutor_solved", solves: 1, linesWritten: 0 });
    });

    it("a column of lines the tutor could not judge (a label, scratch) is not; one judged line makes it one", () => {
      feed(line(0, "a", "\\text{Name}", null, { kind: "label" }), line(5, "b", "2", "question", { kind: "expression" }));
      expect(published).toEqual([]);
      feed(line(10, "c", "2x=8", "check"));
      expect(latest()).toMatchObject({ linesWritten: 3, linesRight: 1 });
    });

    it("a problem given with any line under it is", () => {
      feed({ type: "problem", at: T0, boardId: BOARD, pageId: PAGE, problemKey: CELL, problemLatex: ["2x + 3 = 11"], origin: "starter" });
      feed(line(20, "a", "2", "question", { problemKey: CELL, problemLatex: ["2x + 3 = 11"], kind: "expression" }));
      expect(latest()).toMatchObject({ origin: "starter", linesWritten: 1, outcome: "in_progress" });
    });

    it("help before the problem's first line is counted when its attempt starts", () => {
      feed(help(0, "ask"), help(1, "next_step", INK, true), line(10, "a", "2x+3=11", null));
      expect(latest()).toMatchObject({ asks: 1, tutorSteps: 1 });
    });
  });

  describe("where a problem came from", () => {
    it("the chat's problem, its origin and parent from the problem signal", () => {
      feed({ type: "problem", at: T0, boardId: BOARD, pageId: PAGE, problemKey: CELL, problemLatex: ["x^{2} = 9"], origin: "now_you_try", parentId: "att-0" });
      feed(line(10, "a", "x=3", "check", { problemKey: CELL, problemLatex: ["x^{2} = 9"], solved: true }));
      expect(latest()).toMatchObject({ origin: "now_you_try", parentId: "att-0", problemLatex: "x^{2} = 9", skill: "quadratic_equations", outcome: "first_try" });
      expect(tracker.attemptIdFor(CELL)).toBe(latest().id);
    });

    it("its first line before the problem signal: the problem still says where it came from", () => {
      feed(line(0, "a", "2x=8", "check", { problemKey: CELL, problemLatex: ["2x + 3 = 11"] }));
      expect(latest().origin).toBe("tutor_problem");
      feed({ type: "problem", at: T0 + SEC, boardId: BOARD, pageId: PAGE, problemKey: CELL, problemLatex: ["2x + 3 = 11"], origin: "practice" });
      expect(latest()).toMatchObject({ origin: "practice", linesWritten: 1 });
    });

    it("the key says what it can: the chat's (from before this session), the student's own, a taught one", () => {
      expect(originOfKey(CELL)).toBe("tutor_problem");
      expect(originOfKey(INK)).toBe("student");
      expect(originOfKey(`${PAGE}#teach:1`)).toBe("teach");
    });

    it("the student's own problem is its head line as read now: read again, its skill too", () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=8", "check"));
      expect(latest()).toMatchObject({ problemLatex: "2x+3=11", skill: "two_step_equations" });
      feed(line(20, "c", "x=2", "check", { problemLatex: ["x^{2}=4"] }));
      expect(latest()).toMatchObject({ problemLatex: "x^{2}=4", skill: "quadratic_equations" });
    });

    it("a system's lines are joined; the problem's LaTeX is capped", () => {
      feed({ type: "problem", at: T0, boardId: BOARD, pageId: PAGE, problemKey: CELL, problemLatex: ["x + y = 5", "x - y = 1"], origin: "tutor_problem" });
      feed(line(10, "a", "2x=6", "check", { problemKey: CELL, problemLatex: [] }));
      expect(latest().problemLatex).toBe("x + y = 5; x - y = 1");
      tracker = make();
      feed(line(0, "a", "2x=8", "check", { problemLatex: ["x".repeat(900)] }));
      expect(latest().problemLatex).toHaveLength(LEARNING_LIMITS.problemLatex);
    });
  });

  describe("saving", () => {
    it("flush saves what changed since the last save, in one batch", async () => {
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=8", "check"));
      await tracker.flush();
      expect(saved).toHaveLength(1);
      expect(saved[0].map((r) => [r.id, r.linesWritten])).toEqual([["att-1", 2]]);
      await tracker.flush();
      expect(saved).toHaveLength(1);
      feed(line(20, "c", "x=4", "check", { solved: true }));
      expect(tracker.pending().map((r) => r.outcome)).toEqual(["first_try"]);
      await tracker.flush();
      expect(saved[1].map((r) => r.outcome)).toEqual(["first_try"]);
      expect(tracker.pending()).toEqual([]);
    });

    it("a failed save rejects and keeps them for the next", async () => {
      save = async () => {
        throw Object.assign(new Error("offline"), { code: "network" });
      };
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=8", "check"));
      await expect(tracker.flush()).rejects.toMatchObject({ code: "network" });
      expect(tracker.pending()).toHaveLength(1);
      save = async (records) => {
        saved.push([...records]);
      };
      await tracker.flush();
      expect(saved).toHaveLength(1);
      expect(tracker.pending()).toEqual([]);
    });

    it("one save at a time: a flush during one waits, then saves what changed meanwhile", async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      save = async (records) => {
        saved.push([...records]);
        if (saved.length === 1) await gate;
      };
      feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=8", "check"));
      const first = tracker.flush();
      await vi.waitFor(() => expect(saved).toHaveLength(1));
      // being saved: still pending (the device keeps it until the save lands)
      expect(tracker.pending()).toHaveLength(1);
      feed(line(20, "c", "x=4", "check", { solved: true }));
      const second = tracker.flush();
      release();
      await Promise.all([first, second]);
      expect(saved.map((b) => b.map((r) => r.linesWritten))).toEqual([[2], [3]]);
    });

    it("the records it holds (for the learner hint) are the recorded ones only", () => {
      feed(line(0, "a", "\\text{Name}", null, { kind: "label", problemKey: `${PAGE}#ink:lbl` }), line(10, "b", "2x=8", "check"));
      expect(tracker.records().map((r) => r.id)).toEqual(["att-2"]);
    });
  });

  it("a bad signal is dropped, never thrown", () => {
    expect(() => tracker.handle({ type: "line" } as unknown as LearningSignal)).not.toThrow();
    expect(() => tracker.handle(null as unknown as LearningSignal)).not.toThrow();
  });

  it("the published record is a copy: changing it changes nothing", () => {
    feed(line(0, "a", "2x+3=11", null), line(10, "b", "2x=8", "check"));
    latest().mistakes.sign = 9;
    latest().linesWritten = 99;
    feed(line(20, "c", "x=4", "check", { solved: true }));
    expect(latest()).toMatchObject({ linesWritten: 3, mistakes: {} });
  });
});
