import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasPracticeMarker, writePracticeMarker, type StorageLike } from "@/lib/learning/practiceMarker";
import type { ChatRunReport, ChatScreen } from "@/lib/live/chat/contracts";
import { PRACTICE_COPY, resetPracticeBoards, runPracticeMarker, type PracticeRunDeps } from "../usePracticeBoard";

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

  it("the board not ready yet: it tries again, then says so quietly", async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      if (++calls < 3) throw new Error("The board is not ready yet.");
      return report(3);
    });
    const { deps, toast } = setup({ run: flaky });
    await expect(runPracticeMarker(deps)).resolves.toBe("written");
    expect(flaky).toHaveBeenCalledTimes(3);
    expect(toast).toHaveBeenCalledTimes(1);

    resetPracticeBoards();
    const never = vi.fn(async (): Promise<ChatRunReport> => {
      throw new Error("The board is not ready yet.");
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
});
