/**
 * An in-memory ReportStore for the report's route and server tests: two families (a grown-up with
 * two kids, another grown-up with one) and a solo student, their profiles, a week of rows and some
 * boards. Every call is a spy, so a test can say what was (and was not) read.
 */
import { vi } from "vitest";
import type { FamilyLinks } from "@/lib/family/members";
import type { ReportAttemptRow, ReportDailyRow } from "../build";
import type { ReplayBoard, ReportProfile, ReportStore } from "../server";

export const IDS = {
  parent: "10000000-0000-4000-8000-000000000001",
  kidA: "10000000-0000-4000-8000-000000000002",
  kidB: "10000000-0000-4000-8000-000000000003",
  otherParent: "20000000-0000-4000-8000-000000000001",
  otherKid: "20000000-0000-4000-8000-000000000002",
  solo: "30000000-0000-4000-8000-000000000001",
} as const;

export const BOARDS = {
  kidA: "b0000000-0000-4000-8000-00000000000a",
  kidB: "b0000000-0000-4000-8000-00000000000b",
  parent: "b0000000-0000-4000-8000-00000000000c",
  otherKid: "b0000000-0000-4000-8000-00000000000d",
  deleted: "b0000000-0000-4000-8000-00000000000e",
} as const;

let n = 0;
export function row(userBoard: string, at: string, over: Partial<ReportAttemptRow> = {}): ReportAttemptRow {
  n++;
  return {
    id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    board_id: userBoard,
    problem_latex: "6 \\times 7",
    skill: "times_tables",
    course: null,
    origin: "practice",
    outcome: "first_try",
    lines_written: 2,
    active_ms: 90_000,
    mistakes: {},
    started_at: at,
    updated_at: at,
    finished_at: at,
    ...over,
  };
}

export type FakeReportStore = ReportStore & {
  families: Map<string, string[]>;
  profileRows: Map<string, ReportProfile>;
  attemptRows: Map<string, ReportAttemptRow[]>;
  dailyRows: Map<string, ReportDailyRow[]>;
  boards: Map<string, { ownerId: string; deleted: boolean; title: string }>;
};

export function makeFakeStore(): FakeReportStore {
  const families = new Map<string, string[]>([
    [IDS.parent, [IDS.kidA, IDS.kidB]],
    [IDS.otherParent, [IDS.otherKid]],
  ]);
  const profile = (displayName: string | null, grade: number | null, avatar: string | null = null): ReportProfile => ({ displayName, avatar, grade, course: null, optedOut: false });
  const profileRows = new Map<string, ReportProfile>([
    [IDS.parent, profile("Sam", null)],
    [IDS.kidA, profile("Maya", 3, "fox")],
    [IDS.kidB, profile("Leo", 1, "owl")],
    [IDS.otherParent, profile("Other", null)],
    [IDS.otherKid, profile("Zed", 4, "cat")],
    [IDS.solo, profile(null, 7)],
  ]);
  const attemptRows = new Map<string, ReportAttemptRow[]>([
    [IDS.kidA, [row(BOARDS.kidA, "2026-10-05T20:00:00Z"), row(BOARDS.kidA, "2026-10-06T20:00:00Z"), row(BOARDS.deleted, "2026-10-06T21:00:00Z"), row(BOARDS.deleted, "2026-10-06T21:05:00Z")]],
    [IDS.kidB, [row(BOARDS.kidB, "2026-10-07T20:00:00Z", { skill: "add_within_20", problem_latex: "8 + 7", outcome: "with_help" })]],
    [IDS.otherKid, [row(BOARDS.otherKid, "2026-10-06T20:00:00Z")]],
  ]);
  const dailyRows = new Map<string, ReportDailyRow[]>([[IDS.kidA, [{ day: "2026-10-05", completed_at: "2026-10-05T21:00:00Z" }, { day: "2026-10-06", completed_at: "2026-10-06T21:00:00Z" }]]]);
  const boards = new Map<string, { ownerId: string; deleted: boolean; title: string }>([
    [BOARDS.kidA, { ownerId: IDS.kidA, deleted: false, title: "Times tables" }],
    [BOARDS.kidB, { ownerId: IDS.kidB, deleted: false, title: "Adding" }],
    [BOARDS.parent, { ownerId: IDS.parent, deleted: false, title: "Mine" }],
    [BOARDS.otherKid, { ownerId: IDS.otherKid, deleted: false, title: "Zed's" }],
    [BOARDS.deleted, { ownerId: IDS.kidA, deleted: true, title: "Gone" }],
  ]);

  const store: FakeReportStore = {
    families,
    profileRows,
    attemptRows,
    dailyRows,
    boards,
    links: vi.fn(async (userId: string): Promise<FamilyLinks | null> => {
      for (const [parentId, kids] of families) {
        if (parentId === userId || kids.includes(userId)) return { parentId, kids: [...kids] };
      }
      return null;
    }),
    profiles: vi.fn(async (ids: readonly string[]) => new Map(ids.filter((id) => profileRows.has(id)).map((id) => [id, { ...profileRows.get(id)! }]))),
    attempts: vi.fn(async (userId: string, since: string, until: string) =>
      (attemptRows.get(userId) ?? []).filter((a) => a.started_at >= since && a.started_at < until).sort((a, b) => b.started_at.localeCompare(a.started_at)),
    ),
    daily: vi.fn(async (userId: string, untilDay: string) => (dailyRows.get(userId) ?? []).filter((d) => d.day <= untilDay)),
    liveBoards: vi.fn(async (ids: readonly string[]) => new Set(ids.filter((id) => boards.get(id) && !boards.get(id)!.deleted))),
    boardOwner: vi.fn(async (id: string) => {
      const b = boards.get(id);
      return b && !b.deleted ? b.ownerId : null;
    }),
    board: vi.fn(async (id: string): Promise<ReplayBoard | null> => {
      const b = boards.get(id);
      return b && !b.deleted ? { id, ownerId: b.ownerId, title: b.title, updatedAt: "2026-10-07T21:00:00.000Z", snapshot: { document: { store: {} } } } : null;
    }),
    setOptOut: vi.fn(async (userId: string, optedOut: boolean) => {
      const p = profileRows.get(userId);
      if (p) p.optedOut = optedOut;
    }),
  };
  return store;
}
