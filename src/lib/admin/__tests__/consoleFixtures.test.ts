import { describe, expect, it } from "vitest";
import {
  ADMIN_API,
  ADMIN_ROUTES,
  AdminBoardListSchema,
  AdminBugListSchema,
  AdminIssueListSchema,
  AdminOverviewSchema,
  AdminUserDetailSchema,
  AdminUserListSchema,
} from "../contracts";
import { FIXTURE_USER_IDS, FixtureServer, boardPicture, buildWorld, userDetailAt } from "../fixtures/consoleFixtures";

/** Thursday 2026-10-08, 3:00 PM in New York. */
const NOW = Date.parse("2026-10-08T19:00:00Z");
const server = () => new FixtureServer(() => NOW);

describe("the console's fixtures (the dev ?fixtures=1 and these tests)", () => {
  it("answer every route in the contract's shape", () => {
    const s = server();
    expect(AdminOverviewSchema.safeParse(s.answer(ADMIN_ROUTES.overview, "GET", null, "1").json).success).toBe(true);
    expect(AdminUserListSchema.safeParse(s.answer(ADMIN_API.users, "GET", null, "1").json).success).toBe(true);
    for (const id of FIXTURE_USER_IDS) {
      const r = AdminUserDetailSchema.safeParse(s.answer(ADMIN_API.user(id), "GET", null, "1").json);
      expect(r.success, id).toBe(true);
    }
    expect(AdminBoardListSchema.safeParse(s.answer(ADMIN_API.boards, "GET", null, "1").json).success).toBe(true);
    expect(AdminBoardListSchema.safeParse(s.answer(`${ADMIN_API.boards}?live=1`, "GET", null, "1").json).success).toBe(true);
    expect(AdminBugListSchema.safeParse(s.answer(ADMIN_API.bugs, "GET", null, "1").json).success).toBe(true);
    for (const days of [1, 7, 30]) {
      const r = AdminIssueListSchema.safeParse(s.answer(`${ADMIN_API.issues}?days=${days}`, "GET", null, "1").json);
      expect(r.success).toBe(true);
      if (r.success) for (const i of r.data.issues) expect(i.perDay).toHaveLength(days);
    }
  });

  it("a week of ~24 accounts, four of them on a board now, a few new bugs and a regressed issue", () => {
    const w = buildWorld(NOW);
    expect(w.users).toHaveLength(24);
    expect(w.users.filter((u) => u.isAdmin)).toHaveLength(1);
    const live = server().answer(`${ADMIN_API.boards}?live=1`, "GET", null, "1").json as { boards: unknown[] };
    expect(live.boards).toHaveLength(4);
    expect(w.bugs.filter((b) => b.status === "new")).toHaveLength(4);
    expect(w.issues.some((i) => i.regressed)).toBe(true);
    expect(w.issues.some((i) => i.noise)).toBe(true);
    expect(userDetailAt(w, "nobody", NOW)).toBeNull();
  });

  it("pages the boards with nextBefore", () => {
    const s = server();
    const first = s.answer(ADMIN_API.boards, "GET", null, "1").json as { boards: { id: string; updatedAt: string }[]; nextBefore: string | null };
    expect(first.boards).toHaveLength(24);
    expect(first.nextBefore).toBe(first.boards[23].updatedAt);
    const second = s.answer(`${ADMIN_API.boards}?before=${encodeURIComponent(first.nextBefore!)}`, "GET", null, "1").json as { boards: { id: string }[] };
    expect(second.boards.length).toBeGreaterThan(0);
    expect(second.boards.some((b) => first.boards.some((f) => f.id === b.id))).toBe(false);
  });

  it("keeps a PATCH, fails one whose note says fail, serves screenshots, and has empty and error modes", () => {
    const s = server();
    expect(s.answer(ADMIN_API.bug("bug_001"), "PATCH", { status: "fixed" }, "1").status).toBe(200);
    const bugs = s.answer(ADMIN_API.bugs, "GET", null, "1").json as { bugs: { id: string; status: string; resolvedAt: string | null }[] };
    expect(bugs.bugs.find((b) => b.id === "bug_001")).toMatchObject({ status: "fixed", resolvedAt: new Date(NOW).toISOString() });
    expect(s.answer(ADMIN_API.bug("bug_002"), "PATCH", { status: "seen", note: "this will fail" }, "1").status).toBe(500);
    const fp = buildWorld(NOW).issues[0].fingerprint;
    expect(s.answer(ADMIN_API.issues, "PATCH", { fingerprint: fp, status: "muted" }, "1").status).toBe(200);
    const issues = s.answer(`${ADMIN_API.issues}?days=30`, "GET", null, "1").json as { issues: { fingerprint: string; status: string }[] };
    expect(issues.issues.find((i) => i.fingerprint === fp)?.status).toBe("muted");
    expect(s.answer(ADMIN_API.bugScreenshot("bug_001"), "GET", null, "1").svg).toContain("<svg");
    expect(s.answer(ADMIN_API.bugScreenshot("bug_003"), "GET", null, "1").status).toBe(404);
    expect((s.answer(ADMIN_API.users, "GET", null, "empty").json as { users: unknown[] }).users).toEqual([]);
    expect(s.answer(ADMIN_API.users, "GET", null, "error").status).toBe(500);
  });

  it("draws board pictures as inline SVG data URLs", () => {
    expect(boardPicture(3)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(boardPicture(3))).toContain("<text");
  });
});
