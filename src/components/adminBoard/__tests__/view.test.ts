import { describe, expect, it } from "vitest";
import { AdminBoardDocSchema, type AdminAttempt, type AdminEvent } from "@/lib/admin/contracts";
import { devFixtureDoc } from "@/lib/replay/devFixture";
import { attemptRows, boardMetaParts, eventRows, historyRows, liveAgo, problemText, shouldAutoFollow } from "../view";

const NOW = Date.UTC(2026, 9, 8, 18, 0);
const clock = { now: NOW, timeZone: "America/New_York" };

describe("problemText", () => {
  it("reads a problem's LaTeX as plain text", () => {
    expect(problemText("\\frac{3}{4}+\\frac{1}{8}")).toBe("3/4 + 1/8");
    expect(problemText("12\\times 13")).toBe("12 × 13");
    expect(problemText("2x+5=17")).toBe("2x + 5 = 17");
    expect(problemText("\\frac{x+1}{2}=\\sqrt{9}")).toBe("(x + 1)/2 = √(9)");
    expect(problemText("x^{2}-4\\le 0")).toBe("x^(2) − 4 ≤ 0");
    expect(problemText("\\left(3\\cdot 4\\right)\\div 2")).toBe("(3 · 4) ÷ 2");
  });
});

describe("the side panel", () => {
  it("attempts: the problem, its outcome, what it took", () => {
    const attempts: AdminAttempt[] = [
      { id: "a", boardId: null, problemLatex: "\\frac{1}{2}", skill: "s", outcome: "self_corrected", hints: 0, solves: 0, linesRinged: 1, activeMs: 240_000, startedAt: new Date(NOW - 3_600_000).toISOString(), finishedAt: null },
      { id: "b", boardId: null, problemLatex: "1+1", skill: "s", outcome: "with_help", hints: 2, solves: 1, linesRinged: 0, activeMs: 20_000, startedAt: new Date(NOW - 60_000).toISOString(), finishedAt: null },
    ];
    const rows = attemptRows(attempts, clock);
    expect(rows[0]).toMatchObject({ problem: "1/2", outcome: { label: "Fixed it", tone: "good" }, detail: "1 ring · 4 min", when: "1:00 PM" });
    expect(rows[1]).toMatchObject({ problem: "1 + 1", outcome: { label: "With help", tone: "help" }, detail: "2 hints · 1 solve · under a minute" });
  });

  it("errors: oldest first, noise left out, a readable title", () => {
    const base: AdminEvent = { id: 1, at: new Date(NOW - 10_000).toISOString(), source: "live", level: "error", kind: "live.solve", code: null, message: "Solve failed", route: null, userId: null, userEmail: null, boardId: null, requestId: null, meta: null, release: null, noise: false };
    const rows = eventRows([base, { ...base, id: 2, at: new Date(NOW - 20_000).toISOString(), level: "warn" }, { ...base, id: 3, noise: true }], clock);
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(rows[1]).toMatchObject({ title: "Solve failed", level: "error", at: NOW - 10_000 });
  });

  it("saved versions, and the header's facts", () => {
    const doc = devFixtureDoc("synthetic", { now: NOW });
    expect(historyRows(doc.history, clock)[0].label).toBe("Before a restore · version 39");
    const parts = boardMetaParts(doc.board, clock);
    expect(parts[0]).toMatch(/^Created Oct 6, /);
    expect(parts[3]).toBe("version 42");
  });

  it("follows by itself a board saved in the last two minutes, and says how fresh it is", () => {
    expect(shouldAutoFollow(new Date(NOW - 60_000).toISOString(), NOW)).toBe(true);
    expect(shouldAutoFollow(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe(false);
    expect(shouldAutoFollow("garbage", NOW)).toBe(false);
    expect(liveAgo(new Date(NOW - 3_000).toISOString(), NOW)).toBe("updated 3 s ago");
    expect(liveAgo(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("updated 5 min ago");
  });
});

describe("the dev fixture", () => {
  it("is shaped exactly like the admin API's board doc", () => {
    for (const name of ["synthetic", "untimed", "live"] as const) expect(AdminBoardDocSchema.safeParse(devFixtureDoc(name, { now: NOW })).success, name).toBe(true);
    expect(AdminBoardDocSchema.safeParse(devFixtureDoc("file", { now: NOW, snapshot: { document: { store: {} } } })).success).toBe(true);
  });

  it("the live one grows between reads and keeps its old strokes as they were", () => {
    const a = devFixtureDoc("live", { now: NOW + 1_000 });
    const b = devFixtureDoc("live", { now: NOW + 13_000 });
    expect(b.board.version).toBeGreaterThan(a.board.version);
    const storeA = (a.snapshot as { document: { store: Record<string, unknown> } }).document.store;
    const storeB = (b.snapshot as { document: { store: Record<string, unknown> } }).document.store;
    expect(Object.keys(storeB).length).toBeGreaterThan(Object.keys(storeA).length);
    expect(storeB["shape:syn0"]).toEqual(storeA["shape:syn0"]);
  });
});
