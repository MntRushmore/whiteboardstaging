import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPracticeMarker, writePracticeMarker, type StorageLike } from "@/lib/learning/practiceMarker";
import type { ChatRunReport, ChatScreen } from "@/lib/live/chat/contracts";
import { createLoopGate } from "@/lib/live/loopGate";
import {
  BOARD_READY_MS,
  boardLifeDeps,
  onPracticeRunEnd,
  practicePending,
  PRACTICE_COPY,
  resetPracticeBoards,
  runPracticeMarker,
  TOPIC_PAUSE_MS,
  writePracticeSet,
  type PracticeRunDeps,
} from "../usePracticeBoard";

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const NOW = 1_000_000;
const PROBLEMS = [["2x + 3 = 11"], ["5x - 4 = 21"], ["x + y = 5", "x - y = 1"]];
const report = (written: number): ChatRunReport => ({ outcomes: [{ type: "write_problems", ok: written > 0 }], problemsWritten: written, problemsDropped: 0, screensAdded: 0 });
const EMPTY_SCREEN: ChatScreen = { empty: true, student: [], tutor: [], problems: [] };

function setup(over: Partial<PracticeRunDeps> = {}) {
  const storage = memory();
  writePracticeMarker({ boardId: "b1", skill: "two_step_equations", problems: PROBLEMS, createdAt: NOW - 1000 }, storage);
  const toast = vi.fn();
  const prepare = vi.fn();
  // the marker is already gone when the problems are written (a reload mid-write finds none)
  const run = vi.fn(async () => {
    expect(hasPracticeMarker("b1", storage)).toBe(false);
    return report(PROBLEMS.length);
  });
  const deps: PracticeRunDeps = {
    boardId: "b1",
    run,
    screen: () => EMPTY_SCREEN,
    skillName: (id) => (id === "two_step_equations" ? "Two-step equations" : null),
    toast,
    prepare,
    storage,
    now: () => NOW,
    wait: async () => undefined,
    ...over,
  };
  return { storage, toast, prepare, run, deps };
}

describe("practice board: the Progress page's marker", () => {
  beforeEach(() => resetPracticeBoards());

  it("writes the marker's problems once, tagged practice, with a toast naming the skill", async () => {
    const { deps, run, toast, prepare, storage } = setup();
    await expect(runPracticeMarker(deps)).resolves.toBe("written");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith([{ type: "write_problems", problems: PROBLEMS }], { origin: "practice" });
    expect(toast).toHaveBeenCalledWith("Let's practise Two-step equations!");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(hasPracticeMarker("b1", storage)).toBe(false);
  });

  it("a second run in the same tab (React's double effects, a remount) writes nothing", async () => {
    const { deps, run } = setup();
    const [a, b] = await Promise.all([runPracticeMarker(deps), runPracticeMarker(deps)]);
    expect([a, b].sort()).toEqual(["already", "written"]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a reload (a fresh tab's state, the same storage) finds no marker and writes nothing", async () => {
    const { deps, run } = setup();
    await runPracticeMarker(deps);
    resetPracticeBoards();
    await expect(runPracticeMarker(deps)).resolves.toBe("none");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a marker that could not be cleared (storage refused) is still never written twice: problems on the screen are left out", async () => {
    const run = vi.fn(async () => report(PROBLEMS.length));
    const { deps, storage } = setup({ run });
    const stuck: StorageLike = {
      getItem: storage.getItem,
      setItem: storage.setItem,
      removeItem: () => {
        throw new Error("denied");
      },
    };
    await expect(runPracticeMarker({ ...deps, storage: stuck })).resolves.toBe("written");
    resetPracticeBoards();
    const onScreen: ChatScreen = { empty: false, student: [], tutor: [], problems: PROBLEMS.map((p) => p.join("; ")) };
    await expect(runPracticeMarker({ ...deps, storage: stuck, screen: () => onScreen })).resolves.toBe("already");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("only the problems not yet on the screen are written", async () => {
    const { deps, run } = setup({ screen: () => ({ ...EMPTY_SCREEN, empty: false, problems: ["2x + 3 = 11"] }) });
    await runPracticeMarker(deps);
    expect(run).toHaveBeenCalledWith([{ type: "write_problems", problems: PROBLEMS.slice(1) }], { origin: "practice" });
  });

  it("no marker, an expired one, or another board's: nothing happens", async () => {
    const { deps, run, toast } = setup();
    await expect(runPracticeMarker({ ...deps, boardId: "b2" })).resolves.toBe("none");
    await expect(runPracticeMarker({ ...deps, now: () => NOW + 25 * 60 * 60_000 })).resolves.toBe("none");
    expect(run).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("a run that throws on a board that is up (a chunk that did not load): it tries again, then says so quietly", async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      if (++calls < 3) throw new Error("Failed to fetch dynamically imported module");
      return report(3);
    });
    const { deps, toast } = setup({ run: flaky });
    await expect(runPracticeMarker(deps)).resolves.toBe("written");
    expect(flaky).toHaveBeenCalledTimes(3);
    expect(toast).toHaveBeenCalledTimes(1);

    resetPracticeBoards();
    const never = vi.fn(async (): Promise<ChatRunReport> => {
      throw new Error("Failed to fetch dynamically imported module");
    });
    const second = setup({ run: never });
    await expect(runPracticeMarker(second.deps)).resolves.toBe("failed");
    expect(never).toHaveBeenCalledTimes(4);
    expect(second.toast).toHaveBeenLastCalledWith(PRACTICE_COPY.failed);
  });

  it("nothing written (the engine refused every problem): a quiet toast", async () => {
    const { deps, toast } = setup({ run: vi.fn(async () => report(0)) });
    await expect(runPracticeMarker(deps)).resolves.toBe("failed");
    expect(toast).toHaveBeenLastCalledWith(PRACTICE_COPY.failed);
  });

  it("the toast without a known skill name", () => {
    expect(PRACTICE_COPY.start(null)).toBe("Let's practise!");
    expect(PRACTICE_COPY.start("Fractions")).toBe("Let's practise Fractions!");
  });

  it("pending from the marker until the run ends (a Today's practice board waits for it), then says so", async () => {
    let finish: (r: ChatRunReport) => void = () => {};
    const run = vi.fn(() => new Promise<ChatRunReport>((resolve) => (finish = resolve)));
    const { deps, storage } = setup({ run });
    const ended = vi.fn();
    const stop = onPracticeRunEnd(ended);
    // the marker is there: the run is still to come
    expect(practicePending("b1", storage)).toBe(true);
    const running = runPracticeMarker(deps);
    // the marker is gone, the problems are being written: still pending
    expect(practicePending("b1", storage)).toBe(true);
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(practicePending("b1", storage)).toBe(true);
    expect(ended).not.toHaveBeenCalled();
    finish(report(2));
    await expect(running).resolves.toBe("written");
    expect(practicePending("b1", storage)).toBe(false);
    expect(ended).toHaveBeenCalledWith("b1");
    stop();
    // another board's run, or none at all: never pending
    expect(practicePending("b2", storage)).toBe(false);
  });

  it("a run that fails still ends (nothing waits for it forever)", async () => {
    const { deps, storage } = setup({ run: vi.fn(async (): Promise<ChatRunReport> => Promise.reject(new Error("The board is not ready yet."))) });
    const ended = vi.fn();
    const stop = onPracticeRunEnd(ended);
    await expect(runPracticeMarker(deps)).resolves.toBe("failed");
    expect(ended).toHaveBeenCalledWith("b1");
    expect(practicePending("b1", storage)).toBe(false);
    stop();
  });
});

describe("topic board: a worked example, then the problems", () => {
  beforeEach(() => resetPracticeBoards());

  const EXAMPLES = [["3x + 1 = 7"], ["4x + 2 = 10"]];
  const topicSetup = (over: Partial<PracticeRunDeps> = {}) => {
    const s = setup(over);
    writePracticeMarker({ boardId: "b1", skill: "two_step_equations", problems: PROBLEMS, examples: EXAMPLES, createdAt: NOW - 1000 }, s.storage);
    return s;
  };

  it("works the example the engine answers (taught, not practice), waits, then writes the problems (tagged practice)", async () => {
    const waits: number[] = [];
    const named = vi.fn();
    const pickExample = vi.fn(async (c: readonly string[][]) => [...c[0]]);
    const { deps, run, toast } = topicSetup({ pickExample, nameScreen: named, wait: async (ms) => void waits.push(ms) });
    await expect(runPracticeMarker(deps)).resolves.toBe("written");
    expect(pickExample).toHaveBeenCalledWith(EXAMPLES);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(
      1,
      [
        { type: "write_problems", problems: [["3x + 1 = 7"]] },
        { type: "help_problem", problem: 1, depth: "solve" },
      ],
      { origin: "teach" },
    );
    expect(run).toHaveBeenNthCalledWith(2, [{ type: "write_problems", problems: PROBLEMS }], { origin: "practice" });
    expect(waits).toEqual([TOPIC_PAUSE_MS]);
    expect(toast.mock.calls.map((c) => c[0])).toEqual([PRACTICE_COPY.watch("Two-step equations"), PRACTICE_COPY.yourTurn]);
    // each screen written on is named for the topic
    expect(named).toHaveBeenCalledTimes(2);
    expect(named).toHaveBeenCalledWith("two_step_equations");
  });

  it("no example the engine answers on the device: the problems alone, as a practice board (never a model)", async () => {
    const { deps, run, toast } = topicSetup({ pickExample: async () => null });
    await expect(runPracticeMarker(deps)).resolves.toBe("written");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith([{ type: "write_problems", problems: PROBLEMS }], { origin: "practice" });
    expect(toast).toHaveBeenCalledWith(PRACTICE_COPY.start("Two-step equations"));
  });

  it("an example that did not go on the board: no pause, the problems still go on", async () => {
    const waits: number[] = [];
    let n = 0;
    const run = vi.fn(async () => report(n++ === 0 ? 0 : PROBLEMS.length));
    const { deps } = topicSetup({ run, pickExample: async (c) => [...c[0]], wait: async (ms) => void waits.push(ms) });
    await expect(runPracticeMarker(deps)).resolves.toBe("written");
    expect(run).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([]);
  });

  it("a board with work on it already (a marker that could not be cleared): no second example", async () => {
    const pickExample = vi.fn(async (c: readonly string[][]) => [...c[0]]);
    const { deps, run } = topicSetup({ pickExample, screen: () => ({ ...EMPTY_SCREEN, empty: false, problems: ["3x + 1 = 7"] }) });
    await runPracticeMarker(deps);
    expect(pickExample).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("nothing written: the topic's own quiet toast", async () => {
    const { deps, toast } = topicSetup({ run: vi.fn(async () => report(0)), pickExample: async () => null });
    await expect(runPracticeMarker(deps)).resolves.toBe("failed");
    expect(toast).toHaveBeenLastCalledWith(PRACTICE_COPY.topicFailed);
  });
});

describe("New topic on a board (writePracticeSet over a screen with work)", () => {
  it("starts on a new screen: the chat's own new_screen leads the first run", async () => {
    const run = vi.fn(async (actions: readonly unknown[]) => report(actions.length > 0 ? 1 : 0));
    const set = { skill: "fractions", problems: [["\\frac{1}{5} + \\frac{2}{5}"]], examples: [["\\frac{1}{4} + \\frac{2}{4}"]] };
    const base = { run, skillName: () => "Fractions", toast: vi.fn(), wait: async () => undefined };
    await writePracticeSet(set, { ...base, pickExample: async (c) => [...c[0]] }, { newScreen: true });
    expect(run.mock.calls[0][0][0]).toEqual({ type: "new_screen" });
    // the problems go on the screen after the example's (the executor's rule): no second new_screen
    expect(run.mock.calls[1][0]).toEqual([{ type: "write_problems", problems: set.problems }]);

    run.mockClear();
    await writePracticeSet(set, { ...base, pickExample: async () => null }, { newScreen: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual([{ type: "new_screen" }, { type: "write_problems", problems: set.problems }]);
  });
});

/**
 * The board's lifetime (`LiveController.whenReady` / `boardClosed`, src/lib/live/loopGate.ts). Prod,
 * 2026-10-12: a kid on an iPad picked "3-digit adding and subtracting" from the home, the board
 * wrote and worked "469 + 62", and the kid left during the 4 s look at it (its exit title, learning
 * flush and save all landed ~2 s into the look). The run went on against the closed board: "Now
 * you try!" over the home page, four tries at a controller with no loop, then "Couldn't write the
 * problems for that topic" and live.practice `board_not_ready` reported from "/".
 */
describe("the board's lifetime: a run waits for the board, and ends quietly once the kid has left", () => {
  beforeEach(() => resetPracticeBoards());
  afterEach(() => vi.useRealTimers());

  const EXAMPLES = [["3x + 1 = 7"]];
  /** A board's gate as `useLiveMath` keeps it, and a run against it as the real controller behaves: no loop, it throws. */
  function board(boardId = "b1") {
    const gate = createLoopGate();
    const controller = { whenReady: (id: string, ms: number) => gate.whenReady(id, ms), boardClosed: (id: string) => gate.closed(id) };
    const leave = async () => {
      // the board unmounts: the loop stops (and the cleanup's verdict lands a microtask later)
      gate.close();
      await Promise.resolve();
    };
    const run = vi.fn(async (): Promise<ChatRunReport> => {
      if (gate.closed(boardId)) throw new Error("The board is not ready yet.");
      return report(PROBLEMS.length);
    });
    return { gate, leave, run, life: boardLifeDeps(boardId, controller) };
  }
  const topicMarker = (storage: StorageLike) =>
    writePracticeMarker({ boardId: "b1", skill: "two_step_equations", problems: PROBLEMS, examples: EXAMPLES, createdAt: NOW - 1000 }, storage);

  it("the kid leaves during the look at the worked example: no \"Now you try!\", no retries, no failure toast, nothing reported", async () => {
    const b = board();
    b.gate.open("b1");
    const reportFailure = vi.fn();
    const metric = vi.fn();
    const waits: number[] = [];
    const { deps, toast, storage } = setup({
      ...b.life,
      run: b.run,
      reportFailure,
      metric,
      pickExample: async (c) => [...c[0]],
      // the look at the example: the kid taps Back before it is over
      wait: async (ms) => {
        waits.push(ms);
        await b.leave();
      },
    });
    topicMarker(storage);
    await expect(runPracticeMarker(deps)).resolves.toBe("abandoned");
    // the example only: the problems were never tried on the closed board
    expect(b.run).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls.map((c) => c[0])).toEqual([PRACTICE_COPY.watch("Two-step equations")]);
    expect(reportFailure).not.toHaveBeenCalled();
    expect(waits).toEqual([TOPIC_PAUSE_MS]);
    expect(metric).toHaveBeenCalledWith("learning.practice.board.abandoned", { skill: "two_step_equations", topic: true, example: true });
  });

  it("without the board's gate the same leave was a failure toasted and reported (the bug)", async () => {
    const b = board();
    b.gate.open("b1");
    const reportFailure = vi.fn();
    const { deps, toast, storage } = setup({
      run: b.run,
      reportFailure,
      pickExample: async (c) => [...c[0]],
      wait: async (ms) => {
        if (ms === TOPIC_PAUSE_MS) await b.leave();
      },
    });
    topicMarker(storage);
    await expect(runPracticeMarker(deps)).resolves.toBe("failed");
    expect(toast).toHaveBeenCalledWith(PRACTICE_COPY.yourTurn);
    expect(toast).toHaveBeenLastCalledWith(PRACTICE_COPY.topicFailed);
    expect(reportFailure).toHaveBeenCalledTimes(1);
  });

  it("a board not up yet when the run starts (a slow iPad): the run waits for it — no sleeps, no retries — and reads the screen once it is up", async () => {
    const b = board();
    const wait = vi.fn(async () => undefined);
    const screen = vi.fn(() => EMPTY_SCREEN);
    const { deps, toast } = setup({ ...b.life, run: b.run, wait, screen });
    const running = runPracticeMarker(deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(b.run).not.toHaveBeenCalled();
    expect(screen).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    b.gate.open("b1");
    await expect(running).resolves.toBe("written");
    expect(b.run).toHaveBeenCalledTimes(1);
    expect(screen).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("the kid leaves before the board is even up: nothing is said or written", async () => {
    const b = board();
    const { deps, toast } = setup({ ...b.life, run: b.run });
    const running = runPracticeMarker(deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await b.leave();
    await expect(running).resolves.toBe("abandoned");
    expect(b.run).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("a board whose loop never comes up: one quiet failure at the ceiling, reported as board_not_ready", async () => {
    vi.useFakeTimers();
    const b = board();
    const reportFailure = vi.fn();
    const { deps, toast } = setup({ ...b.life, run: b.run, reportFailure });
    let result: string | null = null;
    void runPracticeMarker(deps).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(BOARD_READY_MS - 1);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe("failed");
    expect(b.run).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(PRACTICE_COPY.failed);
    expect(reportFailure).toHaveBeenCalledWith("board_not_ready", PRACTICE_COPY.failed);
  });

  it("New topic, the kid leaves while the problems are being written: the cut-short run is no failure (thrown or nothing written)", async () => {
    const set = { skill: "fractions", problems: [["\\frac{1}{5} + \\frac{2}{5}"]] };
    for (const cut of ["throws", "none"] as const) {
      const b = board();
      b.gate.open("b1");
      const wait = vi.fn(async () => undefined);
      const reportFailure = vi.fn();
      const toast = vi.fn();
      // the loop stops under the hand: the write ends early
      const run = vi.fn(async (): Promise<ChatRunReport> => {
        await b.leave();
        if (cut === "throws") throw new Error("The editor is gone");
        return report(0);
      });
      await expect(writePracticeSet(set, { ...b.life, run, skillName: () => "Fractions", toast, reportFailure, wait }, { newScreen: true })).resolves.toBe("abandoned");
      expect(run).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
      expect(reportFailure).not.toHaveBeenCalled();
      // the toast as it started, nothing after
      expect(toast.mock.calls.map((c) => c[0])).toEqual([PRACTICE_COPY.start("Fractions")]);
    }
  });

  it("another board in its place (the same controller, a new board's loop): a run for the first one stops", async () => {
    const b = board("b1");
    b.gate.open("b1");
    b.gate.close();
    b.gate.open("b2");
    await Promise.resolve();
    const { deps, toast } = setup({ ...b.life, run: b.run });
    await expect(runPracticeMarker(deps)).resolves.toBe("abandoned");
    expect(b.run).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
