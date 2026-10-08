import { describe, expect, it } from "vitest";
import type { AdminBoardRow } from "../contracts";
import { BOARDS_COPY, boardCountLine, boardTileView, boardsUrl, liveNowView, mergeBoardPages, safePreview } from "../boardsView";

/** Thursday 2026-10-08, 3:00 PM in New York. */
const NOW = Date.parse("2026-10-08T19:00:00Z");
const CLOCK = { now: NOW, timeZone: "America/New_York" };
const MIN = 60_000;
const at = (ms: number) => new Date(NOW + ms).toISOString();
const MAYA = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";
const n = (s: string) => s.replace(/[  ]/g, " ");

function board(i: number, over: Partial<AdminBoardRow> = {}): AdminBoardRow {
  return {
    id: `0000000${i}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    userId: MAYA,
    ownerEmail: "maya.chen@example.com",
    ownerName: "Maya Chen",
    title: "Quadratics homework",
    createdAt: at(-3 * 86_400_000),
    updatedAt: at(-2 * MIN),
    preview: "data:image/png;base64,iVBORw0KGgo=",
    version: 12,
    sizeKb: 240,
    attempts: 2,
    errors7d: 3,
    ...over,
  };
}

describe("the boards route's address", () => {
  it("adds live, a user and the next page as asked", () => {
    expect(boardsUrl()).toBe("/api/admin/boards");
    expect(boardsUrl({ live: true })).toBe("/api/admin/boards?live=1");
    expect(boardsUrl({ userId: MAYA, before: "2026-10-08T18:00:00.000Z" })).toBe(`/api/admin/boards?userId=${MAYA}&before=2026-10-08T18%3A00%3A00.000Z`);
  });
});

describe("a board tile", () => {
  it("opens the viewer, names its owner (to their page), says when and how it went", () => {
    const t = boardTileView(board(1), CLOCK);
    expect(t).toMatchObject({
      href: "/admin/boards/00000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Quadratics homework",
      untitled: false,
      ownerName: "Maya Chen",
      ownerHref: `/admin/users/${MAYA}`,
      ownerInitials: "MC",
      updated: "2 min ago",
      live: true,
      attempts: "2 problems",
      errors: "3 errors",
      size: "240 KB",
      label: "Open Quadratics homework in the viewer",
    });
    expect(n(t.updatedTitle)).toBe("Thu, Oct 8, 2026, 2:58 PM");
  });

  it("an untitled, quiet, older board", () => {
    const t = boardTileView(board(2, { title: "Untitled Whiteboard", updatedAt: at(-3 * 60 * MIN), attempts: 0, errors7d: 0, preview: null, ownerName: null }), CLOCK);
    expect(t).toMatchObject({ title: "Untitled board", untitled: true, live: false, attempts: null, errors: null, preview: null, ownerName: "maya.chen", updated: "3 h ago" });
  });

  it("shows only inline images as previews", () => {
    expect(safePreview("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(safePreview("data:image/svg+xml;charset=utf-8,%3Csvg")).toBe("data:image/svg+xml;charset=utf-8,%3Csvg");
    expect(safePreview("https://example.com/x.png")).toBeNull();
    expect(safePreview("javascript:alert(1)")).toBeNull();
    expect(safePreview(null)).toBeNull();
  });
});

describe("live now", () => {
  it("each person once (their latest board), every live board, a line that counts both", () => {
    const live = liveNowView(
      [
        board(1, { updatedAt: at(-3 * MIN) }),
        board(2, { updatedAt: at(-1 * MIN), title: "Factoring" }),
        board(3, { userId: SAM, ownerName: "Sam Okafor", ownerEmail: "sam@example.com", updatedAt: at(-4 * MIN) }),
      ],
      CLOCK,
    );
    expect(live.count).toBe(2);
    expect(live.headline).toBe("2 students on 3 boards right now");
    expect(live.people.map((p) => [p.name, p.boardTitle])).toEqual([
      ["Maya Chen", "Factoring"],
      ["Sam Okafor", "Quadratics homework"],
    ]);
    expect(live.boards.map((b) => b.title)).toEqual(["Factoring", "Quadratics homework", "Quadratics homework"]);
  });

  it("one each, one student, nobody", () => {
    expect(liveNowView([board(1)], CLOCK).headline).toBe("1 student on a board right now");
    expect(liveNowView([board(1), board(2, { userId: SAM })], CLOCK).headline).toBe("2 students on a board right now");
    expect(liveNowView([], CLOCK).headline).toBe(BOARDS_COPY.liveHeadline(0, 0));
    expect(liveNowView([], CLOCK).headline).toBe("Nobody on a board right now");
  });
});

describe("pages", () => {
  it("joins pages in order, each board once", () => {
    const merged = mergeBoardPages([[board(1), board(2)], [board(2), board(3)]]);
    expect(merged.map((b) => b.id[7])).toEqual(["1", "2", "3"]);
  });

  it("says when the end is reached", () => {
    expect(boardCountLine(48, true)).toBe("48 shown");
    expect(boardCountLine(61, false)).toBe("That's all 61 boards.");
  });
});
