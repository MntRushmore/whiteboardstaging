/**
 * The header dot's count (src/lib/bugReports/unread.ts): never asked without a user, asked at most
 * every REFRESH_MS per user (one ask at a time), a failed ask keeps the last count, and /reports sets
 * it to 0 at once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {}, rpc } }));

import { bugUnreadSnapshot, refreshBugUnread, REFRESH_MS, resetBugUnread, setBugUnread } from "../unread";

const U = "11111111-2222-4333-8444-555555555555";
const T = 1_791_600_000_000;

beforeEach(() => {
  resetBugUnread();
  rpc.mockReset();
});

describe("the unread count", () => {
  it("signed out: nothing is asked, the count is 0", async () => {
    const ask = vi.fn();
    expect(await refreshBugUnread(null, ask, T)).toBeNull();
    expect(await refreshBugUnread(undefined, ask, T)).toBeNull();
    expect(await refreshBugUnread("", ask, T)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(bugUnreadSnapshot(null)).toBe(0);
  });

  it("asks my_bug_unread_count() through Supabase by default, once per REFRESH_MS", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    expect(await refreshBugUnread(U, undefined, T)).toBe(2);
    expect(rpc).toHaveBeenCalledWith("my_bug_unread_count");
    expect(bugUnreadSnapshot(U)).toBe(2);
    // a focus a moment later: the kept count, nothing asked
    expect(await refreshBugUnread(U, undefined, T + 1_000)).toBe(2);
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValue({ data: 0, error: null });
    expect(await refreshBugUnread(U, undefined, T + REFRESH_MS)).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(2);
    // someone else's count is never this user's
    expect(bugUnreadSnapshot("someone-else")).toBe(0);
  });

  it("two asks at once are one call", async () => {
    let answer: (v: { data: unknown; error: null }) => void = () => {};
    const ask = vi.fn(() => new Promise<{ data: unknown; error: null }>((r) => (answer = r)));
    const one = refreshBugUnread(U, ask, T);
    const two = refreshBugUnread(U, ask, T);
    await Promise.resolve();
    await Promise.resolve();
    answer({ data: 1, error: null });
    expect(await one).toBe(1);
    expect(await two).toBe(1);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("a failed or odd answer keeps the last count", async () => {
    setBugUnread(U, 3, T - REFRESH_MS);
    expect(await refreshBugUnread(U, async () => ({ data: null, error: { message: "offline" } }), T)).toBeNull();
    expect(await refreshBugUnread(U, async () => ({ data: "3", error: null }), T)).toBeNull();
    expect(
      await refreshBugUnread(
        U,
        () => {
          throw new Error("boom");
        },
        T,
      ),
    ).toBeNull();
    expect(bugUnreadSnapshot(U)).toBe(3);
  });

  it("/reports marks them read: 0 at once", () => {
    setBugUnread(U, 4, T);
    setBugUnread(U, 0, T);
    expect(bugUnreadSnapshot(U)).toBe(0);
  });
});
