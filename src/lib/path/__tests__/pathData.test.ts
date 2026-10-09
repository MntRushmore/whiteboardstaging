import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttemptRecord } from "@/lib/learning/contracts";

const profile = vi.fn();
const attempts = vi.fn();
vi.mock("@/lib/learning/profile", () => ({ readLearnerProfile: (id: string) => profile(id) }));
vi.mock("@/lib/learning/store", () => ({ loadAttempts: () => attempts() }));

const { loadPathData } = await import("../pathData");

const NOW = Date.parse("2026-10-09T15:00:00Z");

function attempt(i: number, skill: string, outcome: AttemptRecord["outcome"]): AttemptRecord {
  const at = new Date(NOW - i * 3_600_000).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    boardId: null,
    problemLatex: "2x + 3 = 11",
    skill,
    course: null,
    origin: "tutor",
    parentId: null,
    outcome,
    linesWritten: 2,
    linesRight: 2,
    linesRinged: 0,
    hints: 0,
    tutorSteps: 0,
    solves: 0,
    asks: 0,
    activeMs: 60_000,
    mistakes: {},
    startedAt: at,
    finishedAt: at,
    updatedAt: at,
  } as unknown as AttemptRecord;
}

describe("loadPathData", () => {
  beforeEach(() => {
    profile.mockReset();
    attempts.mockReset();
  });

  it("the profile's grade and course, and each skill's level from the record", async () => {
    profile.mockResolvedValue({ grade: 3, course: "other", displayName: "Sam", avatar: null });
    attempts.mockResolvedValue([1, 2, 3, 4].map((i) => attempt(i, "two_step_equations", "first_try")));
    const data = await loadPathData("u1", NOW);
    expect(profile).toHaveBeenCalledWith("u1");
    expect(data.status).toBe("ready");
    if (data.status !== "ready") return;
    expect(data.profile).toEqual({ grade: 3, course: "other" });
    expect(data.levels.get("two_step_equations")).toBe("mastered");
  });

  it("a record that cannot be read is failed (no path drawn), never a throw", async () => {
    profile.mockResolvedValue({ grade: 3, course: "other", displayName: null, avatar: null });
    attempts.mockRejectedValue(new Error("offline"));
    await expect(loadPathData("u1", NOW)).resolves.toEqual({ status: "failed" });
    profile.mockRejectedValue(new Error("boom"));
    await expect(loadPathData("u1", NOW)).resolves.toEqual({ status: "failed" });
  });
});
