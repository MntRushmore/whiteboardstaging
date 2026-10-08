import { describe, expect, it } from "vitest";
import {
  BOARDS_RETRY_MS,
  DASHBOARD_COPY,
  UNTITLED_LABEL,
  boardCountLabel,
  boardsErrorCode,
  dashboardStateFor,
  displayTitle,
  editedLabel,
  exactTimeLabel,
  filterBoards,
  groupBoards,
  recencyBucket,
  relativeTime,
  retryOnNetworkError,
  sortBoards,
  thumbnailStateFor,
  type BoardListItem,
} from "../dashboardState";
import { DEFAULT_BOARD_TITLE } from "@/lib/boards/boardTitle";

describe("dashboardStateFor", () => {
  it("shows the skeleton while loading, regardless of other fields", () => {
    expect(dashboardStateFor({ loading: true, error: null, boards: [] })).toBe("loading");
    expect(dashboardStateFor({ loading: true, error: "x", boards: [{}] })).toBe("loading");
  });

  it("shows the error panel when the fetch failed, even with stale boards", () => {
    expect(dashboardStateFor({ loading: false, error: "Couldn't load", boards: [] })).toBe("error");
    expect(dashboardStateFor({ loading: false, error: "Couldn't load", boards: [{}] })).toBe("error");
  });

  it("shows empty vs list based on boards", () => {
    expect(dashboardStateFor({ loading: false, error: null, boards: [] })).toBe("empty");
    expect(dashboardStateFor({ loading: false, error: null, boards: [{}, {}] })).toBe("list");
  });

  it("uses calm copy (no exclamation marks, no 'wrong')", () => {
    for (const text of Object.values(DASHBOARD_COPY)) {
      expect(text).not.toMatch(/!/);
      expect(text.toLowerCase()).not.toMatch(/\bwrong\b/);
    }
  });

  it("gives the empty state a single sentence", () => {
    expect(DASHBOARD_COPY.emptyHint.split(/[.?]\s/).length).toBe(1);
  });
});

// Local-time constructors keep these independent of the machine's time zone.
const NOW = new Date(2026, 8, 27, 15, 30); // Sun 27 Sep 2026, 15:30 local
const at = (d: number, h = 12, m = 0, month = 8, y = 2026) => new Date(y, month, d, h, m).toISOString();

function board(id: string, over: Partial<BoardListItem> = {}): BoardListItem {
  return { id, title: DEFAULT_BOARD_TITLE, created_at: at(1), updated_at: at(1), preview: null, version: 1, ...over };
}

describe("relativeTime / editedLabel", () => {
  it.each([
    [at(27, 15, 30, 8), "just now"],
    [at(27, 15, 29, 8), "1 min ago"],
    [at(27, 15, 25, 8), "5 min ago"],
    [at(27, 13, 20, 8), "2 h ago"],
    [at(27, 4, 5, 8), "11 h ago"],
    [at(26, 23, 50, 8), "yesterday"],
    [at(24, 9, 0, 8), "3 days ago"],
    [at(21, 9, 0, 8), "6 days ago"],
    [at(20, 9, 0, 8), "Sep 20"],
    [at(12, 9, 0, 3), "Apr 12"],
    [at(12, 9, 0, 11, 2025), "Dec 12, 2025"],
  ])("%s -> %s", (iso, label) => {
    expect(relativeTime(iso, NOW)).toBe(label);
  });

  it("treats a timestamp slightly in the future (clock skew) as just now", () => {
    expect(relativeTime(at(27, 15, 31), NOW)).toBe("just now");
  });

  it("prefixes Edited, and is empty for garbage", () => {
    expect(editedLabel(at(27, 13, 20), NOW)).toBe("Edited 2 h ago");
    expect(editedLabel("not a date", NOW)).toBe("");
    expect(exactTimeLabel("not a date")).toBe("");
    expect(exactTimeLabel(at(27, 23, 44))).toMatch(/^Sep 27, 2026, 11:44\sPM$/);
  });
});

describe("recencyBucket / groupBoards", () => {
  it("splits by calendar day: today, the six days before, earlier", () => {
    expect(recencyBucket(at(27, 0, 1), NOW)).toBe("today");
    expect(recencyBucket(at(28, 9), NOW)).toBe("today"); // future: skew
    expect(recencyBucket(at(26, 23, 59), NOW)).toBe("week");
    expect(recencyBucket(at(21, 0, 0), NOW)).toBe("week");
    expect(recencyBucket(at(20, 23, 59), NOW)).toBe("earlier");
  });

  it("groups a recency-sorted list and leaves empty groups out", () => {
    const boards = sortBoards(
      [board("old", { updated_at: at(2) }), board("t1", { updated_at: at(27, 9) }), board("t2", { updated_at: at(27, 14) })],
      "recent",
    );
    const groups = groupBoards(boards, "recent", NOW);
    expect(groups.map((g) => [g.label, g.boards.map((b) => b.id)])).toEqual([
      ["Today", ["t2", "t1"]],
      ["Earlier", ["old"]],
    ]);
  });

  it("does not group other sorts", () => {
    const boards = [board("a"), board("b")];
    expect(groupBoards(boards, "name", NOW)).toEqual([{ key: "all", label: "", boards }]);
    expect(groupBoards([], "created", NOW)).toEqual([]);
    expect(groupBoards([], "recent", NOW)).toEqual([]);
  });
});

describe("sortBoards", () => {
  const list = [
    board("b10", { title: "Board 10", updated_at: at(20), created_at: at(3) }),
    board("u1", { updated_at: at(27), created_at: at(1) }),
    board("b2", { title: "board 2", updated_at: at(25), created_at: at(5) }),
    board("alg", { title: "x² − 5x + 6 = 0", updated_at: at(26), created_at: at(4) }),
  ];

  it("recent: last edited first", () => {
    expect(sortBoards(list, "recent").map((b) => b.id)).toEqual(["u1", "alg", "b2", "b10"]);
  });

  it("created: newest first", () => {
    expect(sortBoards(list, "created").map((b) => b.id)).toEqual(["b2", "alg", "b10", "u1"]);
  });

  it("name: A to Z, numbers numerically, case-insensitive, untitled last", () => {
    expect(sortBoards(list, "name").map((b) => b.id)).toEqual(["b2", "b10", "alg", "u1"]);
  });

  it("does not mutate its input", () => {
    const copy = [...list];
    sortBoards(list, "name");
    expect(list).toEqual(copy);
  });
});

describe("filterBoards / displayTitle", () => {
  const list = [board("a", { title: "x² − 5x + 6 = 0" }), board("b", { title: "Homework 3" }), board("c")];

  it("matches case-insensitively, across typed forms of maths", () => {
    expect(filterBoards(list, "HOMEWORK").map((b) => b.id)).toEqual(["b"]);
    expect(filterBoards(list, "x2 - 5x").map((b) => b.id)).toEqual(["a"]);
    expect(filterBoards(list, "untitled").map((b) => b.id)).toEqual(["c"]);
    expect(filterBoards(list, "  ").map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(filterBoards(list, "zebra")).toEqual([]);
  });

  it("calls a default-titled board 'Untitled board'", () => {
    expect(displayTitle(DEFAULT_BOARD_TITLE)).toBe(UNTITLED_LABEL);
    expect(displayTitle("  Homework 3 ")).toBe("Homework 3");
  });
});

describe("thumbnailStateFor / boardCountLabel", () => {
  it("shows the image, else tells a never-saved board from one without an image yet", () => {
    expect(thumbnailStateFor({ preview: "data:image/webp;base64,AA", version: 3 })).toBe("image");
    expect(thumbnailStateFor({ preview: null, version: 1 })).toBe("empty");
    expect(thumbnailStateFor({ preview: null, version: null })).toBe("empty");
    expect(thumbnailStateFor({ preview: null, version: 4 })).toBe("pending");
  });

  it("counts boards", () => {
    expect(boardCountLabel(1)).toBe("1 board");
    expect(boardCountLabel(44)).toBe("44 boards");
  });
});

describe("a board list that failed to load (live.boards)", () => {
  // what supabase-js returns when the fetch itself fails: a plain object with no code
  const dropped = { message: "TypeError: Load failed", details: "TypeError: Load failed", hint: "", code: "" };

  it("reports the database's code when it answered, `_network` when the request never reached it", () => {
    expect(boardsErrorCode("load_failed", dropped)).toBe("load_failed_network");
    expect(boardsErrorCode("load_failed", new TypeError("Failed to fetch"))).toBe("load_failed_network");
    expect(boardsErrorCode("load_failed", { message: "JWT expired", code: "PGRST301" })).toBe("load_failed_PGRST301");
    expect(boardsErrorCode("create_failed", { message: "canceling statement due to statement timeout", code: "57014" })).toBe("create_failed_57014");
    expect(boardsErrorCode("load_failed", new Error("something else"))).toBe("load_failed");
    expect(boardsErrorCode("load_failed", null)).toBe("load_failed");
  });

  it("a dropped request is read again once, after a pause", async () => {
    const pauses: number[] = [];
    const sleep = async (ms: number) => void pauses.push(ms);
    let calls = 0;
    const read = async () => {
      calls++;
      if (calls === 1) throw dropped;
      return ["board"];
    };
    await expect(retryOnNetworkError(read, { sleep })).resolves.toEqual(["board"]);
    expect(calls).toBe(2);
    expect(pauses).toEqual([BOARDS_RETRY_MS]);
  });

  it("only once: a second dropped request is the error", async () => {
    let calls = 0;
    const read = async () => {
      calls++;
      throw dropped;
    };
    await expect(retryOnNetworkError(read, { sleep: async () => {} })).rejects.toBe(dropped);
    expect(calls).toBe(2);
  });

  it("the database's answer is not retried", async () => {
    const refused = { message: "permission denied for table whiteboards", code: "42501" };
    let calls = 0;
    const read = async () => {
      calls++;
      throw refused;
    };
    await expect(retryOnNetworkError(read, { sleep: async () => {} })).rejects.toBe(refused);
    expect(calls).toBe(1);
  });
});
