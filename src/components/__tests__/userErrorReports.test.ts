/**
 * What each surface that shows a student an error tells the admin page (`reportUserError`,
 * src/lib/reportAppError.ts): the kind of failure, a code that says how, and our own words — never
 * the server's or the database's raw message, never what the student wrote, typed or said.
 */
import { describe, expect, it, vi } from "vitest";
import { BOARD_LOAD_COPY, loadErrorReport, loadStateFor } from "@/components/BoardLoadError";
import { chatErrorFor, CHAT_COPY, WEAK_SPOTS_COPY } from "@/components/chat/chatView";
import { chatFailureReport, chatNoteReports } from "@/components/chat/useBoardChat";
import { PRACTICE_COPY, resetPracticeBoards, runPracticeMarker } from "@/components/learning/usePracticeBoard";
import { LECTURE_COPY, lectureErrorView, lectureFailureReport } from "@/components/lecture/lectureView";
import { ASSET_COPY } from "@/components/live/copy";
import { SAVE_STATUS_COPY, saveErrorReport } from "@/components/live/SaveStatus";
import { ApiError } from "@/lib/api-client";
import { writePracticeMarker, type StorageLike } from "@/lib/learning/practiceMarker";
import { LOGIN_COPY, loginFailureReport } from "@/lib/loginErrorMessage";
import { MSG_BOARD_GONE, MSG_MERGE_FAILED, MSG_OFFLINE, MSG_SAVE_FAILED, MSG_SAVE_TIMEOUT } from "@/lib/sync";

describe("the save pill (live.save)", () => {
  const save = (status: "saved" | "dirty" | "saving" | "offline" | "merging" | "error" | "refused", message: string | null, backupFailed = false) =>
    saveErrorReport({ status, message, backupFailed });

  it("a failed write: the pill's 'Couldn't save' and the queue's failure as a code", () => {
    expect(save("error", MSG_SAVE_TIMEOUT)).toEqual({ kind: "live.save", code: "timeout", message: SAVE_STATUS_COPY.error });
    expect(save("error", MSG_BOARD_GONE)?.code).toBe("gone");
    expect(save("error", MSG_MERGE_FAILED)?.code).toBe("merge_failed");
    expect(save("error", MSG_SAVE_FAILED)?.code).toBe("save_failed");
    expect(save("error", MSG_SAVE_FAILED, true)?.code).toBe("save_failed_no_backup");
  });

  it("the database's own message never goes: only its code", () => {
    const report = save("error", 'new row violates row-level security policy for table "whiteboards" (code: 42501)');
    expect(report).toEqual({ kind: "live.save", code: "pg_42501", message: SAVE_STATUS_COPY.error });
    expect(save("error", "JWT expired (code: PGRST301)")?.code).toBe("pg_PGRST301");
    expect(save("error", "TypeError: something about {\"x\":1}")).toEqual({ kind: "live.save", code: "save_failed", message: SAVE_STATUS_COPY.error });
  });

  it("a refused save: our words when they are ours, else 'Couldn't save'", () => {
    expect(save("refused", ASSET_COPY.boardTooLarge)).toEqual({ kind: "live.save", code: "too_large", message: ASSET_COPY.boardTooLarge });
    expect(save("refused", ASSET_COPY.boardFull)).toEqual({ kind: "live.save", code: "board_full", message: ASSET_COPY.boardFull });
    expect(save("refused", "Converting circular structure to JSON")).toEqual({ kind: "live.save", code: "refused", message: SAVE_STATUS_COPY.error });
  });

  it("offline is the student's connection: nothing, unless the device could not keep a backup either (a warning)", () => {
    expect(save("offline", MSG_OFFLINE)).toBeNull();
    expect(save("offline", MSG_OFFLINE, true)).toEqual({ kind: "live.save", code: "offline_no_backup", message: SAVE_STATUS_COPY.offlineNotBackedUp, level: "warn" });
  });

  it("saved, saving, a debounced save and a merge are not errors", () => {
    for (const status of ["saved", "dirty", "saving", "merging"] as const) expect(save(status, null)).toBeNull();
  });
});

describe("the board load screen (live.load)", () => {
  it("a failed load: the heading and the gist of the detail as a code, never the detail", () => {
    const timeout = loadStateFor({ error: { code: "57014", message: "canceling statement due to statement timeout" } });
    expect(timeout.kind).toBe("error");
    expect(loadErrorReport(timeout as Exclude<typeof timeout, { kind: "ready" }>)).toEqual({ kind: "live.load", code: "load_failed_timeout", message: BOARD_LOAD_COPY.errorTitle });
    expect(loadErrorReport({ kind: "error", message: BOARD_LOAD_COPY.errorTitle, detail: "TypeError: Failed to fetch" })?.code).toBe("load_failed_network");
    expect(loadErrorReport({ kind: "error", message: BOARD_LOAD_COPY.errorTitle, detail: "something else" })?.code).toBe("load_failed");
    const restore = loadErrorReport({ kind: "error", message: BOARD_LOAD_COPY.restoreTitle, detail: "unknown record type" });
    expect(restore).toEqual({ kind: "live.load", code: "restore_failed", message: BOARD_LOAD_COPY.restoreTitle });
    expect(JSON.stringify(restore)).not.toContain("unknown record type");
  });

  it("a board that is not there is a warning; the crash screen reports the crash itself instead", () => {
    expect(loadErrorReport({ kind: "not-found", message: BOARD_LOAD_COPY.notFoundTitle })).toEqual({ kind: "live.load", code: "not_found", message: BOARD_LOAD_COPY.notFoundTitle, level: "warn" });
    expect(loadErrorReport({ kind: "error", message: BOARD_LOAD_COPY.crashTitle, detail: "x is undefined" })).toBeNull();
  });
});

describe("the Ask panel (live.chat)", () => {
  const BOARD = "0b6f8a52-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

  it("a failed ask: the panel's words, the failure as a code, the board", () => {
    const cases: Array<[unknown, string]> = [
      [new ApiError("out", 402, "ink_empty"), "ink"],
      [new ApiError("slow down", 429, "rate_limited", undefined, 5000), "rate_limited"],
      [new ApiError("sign in", 401, "unauthorized"), "unauthorized"],
      [new TypeError("Failed to fetch"), "network"],
      [Object.assign(new Error("timed out"), { name: "TimeoutError" }), "timeout"],
      [new ApiError("Something went wrong on our side", 503, "upstream_error"), "upstream"],
      [new ApiError("bad", 400, "invalid_request"), "invalid_request"],
      [new ApiError("bad", 413), "http_413"],
      [new Error("anything else"), "unknown"],
    ];
    for (const [err, code] of cases) {
      const error = chatErrorFor(err);
      expect(chatFailureReport(error, err, BOARD)).toEqual({ kind: "live.chat", code, message: error.message, boardId: BOARD });
    }
  });

  it("never what the student asked, never the server's message", () => {
    const err = new ApiError("Prompt 'solve 2x+5=17 for Mia' was refused", 500);
    const report = chatFailureReport(chatErrorFor(err), err);
    expect(report).toEqual({ kind: "live.chat", code: "upstream", message: CHAT_COPY.errors.other });
  });

  it("the tutor's notes that something could not be done are warnings; notes about the board are not reported", () => {
    const notes = chatNoteReports(
      {
        outcomes: [
          { type: "graph", ok: false, note: "I couldn't graph that." },
          { type: "write_problems", ok: true, note: "2 of 5 problems couldn't be checked, so I left them out." },
          { type: "write_lines", ok: false, note: "There's no room left on this board." },
          { type: "help_problem", ok: false, note: "I'm still writing on problem 2." },
          { type: "new_screen", ok: true },
        ],
        problemsWritten: 3,
        problemsDropped: 2,
        screensAdded: 0,
      },
      BOARD,
    );
    expect(notes).toEqual([
      { kind: "live.chat", code: "note_graph", message: "I couldn't graph that.", level: "warn", boardId: BOARD },
      { kind: "live.chat", code: "note_write_problems", message: "2 of 5 problems couldn't be checked, so I left them out.", level: "warn", boardId: BOARD },
    ]);
    expect(chatNoteReports(null)).toEqual([]);
  });

  it("the weak-spots chip's failure has its own words (reported by the hook as weak_spots_*)", () => {
    expect(WEAK_SPOTS_COPY.failed).toMatch(/couldn't/i);
  });
});

describe("a practice board (live.practice)", () => {
  function memory(): StorageLike {
    const map = new Map<string, string>();
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
  }
  const setup = (run: () => Promise<never> | Promise<{ outcomes: []; problemsWritten: number; problemsDropped: number; screensAdded: number }>) => {
    resetPracticeBoards();
    const storage = memory();
    writePracticeMarker({ boardId: "b1", skill: "two_step_equations", problems: [["2x + 3 = 11"]], createdAt: 999_000 }, storage);
    const reportFailure = vi.fn();
    const toast = vi.fn();
    return {
      reportFailure,
      toast,
      deps: { boardId: "b1", run, skillName: () => null, toast, reportFailure, storage, now: () => 1_000_000, wait: async () => undefined },
    };
  };

  it("the failure toast is reported once, with why", async () => {
    const none = setup(async () => ({ outcomes: [], problemsWritten: 0, problemsDropped: 1, screensAdded: 0 }));
    await expect(runPracticeMarker(none.deps)).resolves.toBe("failed");
    expect(none.reportFailure).toHaveBeenCalledTimes(1);
    expect(none.reportFailure).toHaveBeenCalledWith("none_written", PRACTICE_COPY.failed);

    const notReady = setup(async () => {
      throw new Error("The board is not ready yet.");
    });
    await expect(runPracticeMarker(notReady.deps)).resolves.toBe("failed");
    expect(notReady.reportFailure).toHaveBeenCalledTimes(1);
    expect(notReady.reportFailure).toHaveBeenCalledWith("board_not_ready", PRACTICE_COPY.failed);
  });

  it("problems written: nothing reported", async () => {
    const ok = setup(async () => ({ outcomes: [], problemsWritten: 1, problemsDropped: 0, screensAdded: 0 }));
    await expect(runPracticeMarker(ok.deps)).resolves.toBe("written");
    expect(ok.reportFailure).not.toHaveBeenCalled();
  });
});

describe("lecture mode (live.lecture)", () => {
  it("the error that ended it: its code and words; the student's device or settings are info", () => {
    expect(lectureFailureReport({ error: lectureErrorView("network") }, null)).toEqual({ kind: "live.lecture", code: "network", message: LECTURE_COPY.errors.network });
    expect(lectureFailureReport({ error: lectureErrorView("mic-denied") }, null)).toEqual({ kind: "live.lecture", code: "mic-denied", message: LECTURE_COPY.errors["mic-denied"], level: "info" });
    expect(lectureFailureReport({ error: lectureErrorView("ink") }, null)).toMatchObject({ code: "ink" });
  });

  it("a notice that something failed; quiet notices are not reported", () => {
    expect(lectureFailureReport({ error: null }, { kind: "retrying" })).toMatchObject({ code: "retrying", message: LECTURE_COPY.notices.retrying });
    expect(lectureFailureReport({ error: null }, { kind: "board_failed" })).toMatchObject({ code: "board_failed" });
    expect(lectureFailureReport({ error: null }, { kind: "sketch_failed", failed: 1, panels: 4 })).toMatchObject({ code: "sketch_failed", message: LECTURE_COPY.notices.sketchFailed(1, 4) });
    const a = lectureFailureReport({ error: null }, { kind: "rate_limited", retryAtMs: 5000 });
    const b = lectureFailureReport({ error: null }, { kind: "rate_limited", retryAtMs: 9000 });
    expect(a).toEqual(b);
    for (const notice of [{ kind: "idle" }, { kind: "nothing", note: "what the teacher said" }, { kind: "empty" }] as const) {
      expect(lectureFailureReport({ error: null }, notice)).toBeNull();
    }
    expect(lectureFailureReport({ error: null }, null)).toBeNull();
  });
});

describe("sign in (live.auth)", () => {
  it("our failures, by action; never the student's own mistakes", () => {
    expect(loginFailureReport(new TypeError("Failed to fetch"), "signin")).toEqual({ kind: "live.auth", code: "signin_network", message: LOGIN_COPY.network });
    expect(loginFailureReport({ status: 429, code: "over_request_rate_limit", message: "Too many" }, "forgot")).toEqual({
      kind: "live.auth",
      code: "forgot_rate_limited",
      message: LOGIN_COPY.rateLimited,
      level: "warn",
    });
    expect(loginFailureReport({ status: 500, message: "Database error saving new user" }, "signup")).toEqual({
      kind: "live.auth",
      code: "signup_signup_refused",
      message: LOGIN_COPY.signupRefused,
    });
    // the server's own words never go (they can carry the address)
    const other = loginFailureReport({ status: 500, message: "Internal error for someone@example.com" }, "signin");
    expect(other).toEqual({ kind: "live.auth", code: "signin_other", message: LOGIN_COPY.fallback });
    expect(loginFailureReport({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" }, "signin")).toBeNull();
    expect(loginFailureReport({ status: 422, code: "weak_password", message: "Password should be at least 6 characters" }, "reset")).toBeNull();
  });
});
