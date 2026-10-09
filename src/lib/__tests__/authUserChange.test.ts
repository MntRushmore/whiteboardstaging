import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { isOtherUser, isSwitchingProfileHere, markProfileSwitch, watchAuthUser } from "../authUserChange";

const session = (id: string) => ({ user: { id } }) as unknown as Session;

const calls = vi.hoisted(() => ({ switching: [] as boolean[], setSession: vi.fn(), assign: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  authedFetch: vi.fn(async () => new Response(JSON.stringify({ access_token: "a", refresh_token: "r" }), { status: 200 })),
  apiErrorFromResponse: vi.fn(),
}));
// the switch's session call notes whether its tab was marked at that moment
vi.mock("@/lib/supabase", async () => {
  const change = await import("../authUserChange");
  return {
    supabase: {
      auth: {
        setSession: (...args: unknown[]) => {
          calls.switching.push(change.isSwitchingProfileHere());
          return calls.setSession(...args);
        },
      },
    },
  };
});

afterEach(() => {
  markProfileSwitch(false);
});

describe("isOtherUser", () => {
  it("only one person to another counts", () => {
    expect(isOtherUser("parent", "ben")).toBe(true);
    expect(isOtherUser("ben", "ben")).toBe(false);
    expect(isOtherUser(null, "ben")).toBe(false);
    expect(isOtherUser("ben", null)).toBe(false);
    expect(isOtherUser(null, null)).toBe(false);
  });
});

describe("a tab whose signed-in user changes under it", () => {
  function tab(as: string | null) {
    const leave = vi.fn();
    const watch = watchAuthUser({ leave });
    watch.settle(as ? session(as) : null);
    const event = (e: AuthChangeEvent, id: string | null) => watch.change(e, id ? session(id) : null);
    return { leave, event };
  }

  it("another tab switched profile (SIGNED_IN as the kid, by BroadcastChannel): it leaves for the home, once, and takes nothing in", () => {
    const { leave, event } = tab("parent");
    expect(event("SIGNED_IN", "ben")).toBe(false);
    expect(leave).toHaveBeenCalledTimes(1);
    // whatever follows (a refresh, the hidden tab re-reading storage) is ignored: the page is going
    expect(event("TOKEN_REFRESHED", "ben")).toBe(false);
    expect(event("SIGNED_IN", "parent")).toBe(false);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("the kid's tab after the grown-up's PIN elsewhere leaves too", () => {
    const { leave, event } = tab("ben");
    expect(event("SIGNED_IN", "parent")).toBe(false);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("a hidden tab coming back re-reads storage (SIGNED_IN with the stored session): another user there leaves too", () => {
    const { leave, event } = tab("parent");
    expect(event("INITIAL_SESSION", "parent")).toBe(true);
    expect(event("SIGNED_IN", "parent")).toBe(true);
    expect(leave).not.toHaveBeenCalled();
    expect(event("SIGNED_IN", "ava")).toBe(false);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("a sign-in from signed out, token refreshes and the same user updated: nothing leaves", () => {
    const { leave, event } = tab(null);
    expect(event("INITIAL_SESSION", null)).toBe(true);
    expect(event("SIGNED_IN", "parent")).toBe(true);
    expect(event("TOKEN_REFRESHED", "parent")).toBe(true);
    expect(event("USER_UPDATED", "parent")).toBe(true);
    expect(leave).not.toHaveBeenCalled();
  });

  it("signed out, then someone else signs in: the page has already gone to /login, nothing leaves", () => {
    const { leave, event } = tab("parent");
    expect(event("SIGNED_OUT", null)).toBe(true);
    expect(event("SIGNED_IN", "ben")).toBe(true);
    expect(leave).not.toHaveBeenCalled();
  });

  it("the tab doing the switch takes the new session: it is already loading its own destination", () => {
    const { leave, event } = tab("parent");
    markProfileSwitch(true);
    expect(isSwitchingProfileHere()).toBe(true);
    expect(event("SIGNED_IN", "ben")).toBe(true);
    expect(leave).not.toHaveBeenCalled();
  });
});

describe("switchProfile marks its own tab", () => {
  afterEach(() => {
    calls.switching.length = 0;
    calls.setSession.mockReset();
    vi.unstubAllGlobals();
  });

  it("before it takes the new session, and keeps the mark while the page reloads", async () => {
    vi.stubGlobal("window", { location: { assign: calls.assign } });
    calls.setSession.mockResolvedValue({ error: null });
    const { switchProfile } = await import("../family/client");
    await switchProfile("ben", { dest: "/progress" });
    expect(calls.switching).toEqual([true]);
    expect(calls.assign).toHaveBeenCalledWith("/progress");
    expect(isSwitchingProfileHere()).toBe(true);
  });

  it("drops the mark when the session is refused, so a later switch elsewhere still moves this tab", async () => {
    vi.stubGlobal("window", { location: { assign: calls.assign } });
    calls.setSession.mockResolvedValue({ error: new Error("refused") });
    const { switchProfile } = await import("../family/client");
    await expect(switchProfile("ben")).rejects.toThrow("refused");
    expect(calls.switching).toEqual([true]);
    expect(isSwitchingProfileHere()).toBe(false);

    calls.setSession.mockRejectedValue(new Error("offline"));
    await expect(switchProfile("ben")).rejects.toThrow("offline");
    expect(isSwitchingProfileHere()).toBe(false);
  });
});
