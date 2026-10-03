import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { ROUTE_COSTS } from "@/lib/server/billing";
import { CHAT_TIMEOUT_MS, ChatTimeoutError, requestChat } from "@/lib/live/chat/client";
import { CHAT_COPY, CHAT_CREDITS, CHAT_SUGGESTIONS, chatErrorFor, historyFor, problemFor, runNotes, sendsOnKey, type ChatMessage } from "../chatView";

describe("board chat panel — view logic", () => {
  it("the cost note matches what the route charges", () => {
    expect(CHAT_CREDITS).toBe(ROUTE_COSTS["live/chat"]);
    expect(CHAT_COPY.cost).toBe("Each request uses 3 credits.");
  });

  it("four first asks: a problem set, a graph, a figure, more like these", () => {
    expect(CHAT_SUGGESTIONS).toHaveLength(4);
    expect(CHAT_SUGGESTIONS[3]).toMatch(/more like these/);
  });

  it("failures: out of credits (no retry, the account page), rate limited with seconds, signed out, network, anything else", () => {
    expect(chatErrorFor(new ApiError("x", 402, "credits_exhausted"))).toEqual({ kind: "credits", message: CHAT_COPY.errors.credits, retry: false });
    expect(chatErrorFor(new ApiError("x", 429, "rate_limited", undefined, 4200))).toEqual({ kind: "rate_limited", message: "That's a lot of requests. Try again in 5 s.", retry: true });
    expect(chatErrorFor(new ApiError("x", 401, "unauthorized")).kind).toBe("unauthorized");
    expect(chatErrorFor(new ApiError("x", 502, "upstream_error"))).toEqual({ kind: "other", message: CHAT_COPY.errors.other, retry: true });
    expect(chatErrorFor(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(chatErrorFor(new Error("?")).kind).toBe("other");
  });

  it("a request that never answers ends as a timeout with Retry, not a spinner", async () => {
    expect(chatErrorFor(new ChatTimeoutError())).toEqual({ kind: "timeout", message: CHAT_COPY.errors.timeout, retry: true });
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetchJson = vi.fn(
        (_path: string, _body: unknown, init?: { signal?: AbortSignal }) =>
          new Promise<unknown>((_resolve, reject) => {
            signal = init?.signal;
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      const req = { boardId: "b", message: "3 equations", history: [], screen: { empty: true, student: [], tutor: [], problems: [] } };
      const pending = requestChat(req as never, {}, fetchJson);
      const assertion = expect(pending).rejects.toBeInstanceOf(ChatTimeoutError);
      await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS + 1);
      await assertion;
      expect(signal?.aborted).toBe(true);
      // the stalled connection is cut well after the route's own 45 s limit, never before it
      expect(CHAT_TIMEOUT_MS).toBeGreaterThan(45_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a request stuck before fetch (a session read deaf to the abort) still ends as a timeout", async () => {
    vi.useFakeTimers();
    try {
      const req = { boardId: "b", message: "3 equations", history: [], screen: { empty: true, student: [], tutor: [], problems: [] } };
      const pending = requestChat(req as never, {}, vi.fn(() => new Promise<unknown>(() => undefined)));
      const assertion = expect(pending).rejects.toBeInstanceOf(ChatTimeoutError);
      await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS + 1);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("a caller's signal that is already aborted ends the request at once", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const req = { boardId: "b", message: "3 equations", history: [], screen: { empty: true, student: [], tutor: [], problems: [] } };
    await expect(requestChat(req as never, { signal: ctrl.signal }, vi.fn(() => new Promise<unknown>(() => undefined)))).rejects.toMatchObject({ name: "AbortError" });
  });

  it("closing the board mid-request aborts it as an abort, not a timeout", async () => {
    const ctrl = new AbortController();
    const fetchJson = vi.fn(
      (_path: string, _body: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<unknown>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const req = { boardId: "b", message: "3 equations", history: [], screen: { empty: true, student: [], tutor: [], problems: [] } };
    const pending = requestChat(req as never, { signal: ctrl.signal }, fetchJson);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("the chat so far: finished turns only, a failed ask left out, the last six", () => {
    const m = (role: ChatMessage["role"], text: string, state?: ChatMessage["state"]): ChatMessage => ({ id: text, role, text, state });
    const messages = [
      m("user", "3 two-step equations"),
      m("tutor", "Here are 3.", "done"),
      m("user", "graph y = x^2"),
      m("tutor", "Something went wrong.", "error"),
      m("user", "graph y = x^2"),
      m("tutor", "Here is the graph.", "writing"),
      m("user", "draw a triangle"),
      m("tutor", "", "thinking"),
    ];
    expect(historyFor(messages)).toEqual([
      { role: "user", text: "3 two-step equations" },
      { role: "tutor", text: "Here are 3." },
      { role: "user", text: "graph y = x^2" },
      { role: "tutor", text: "Here is the graph." },
      { role: "user", text: "draw a triangle" },
    ]);
    const long = Array.from({ length: 10 }, (_, i) => [m("user", `ask ${i}`), m("tutor", `reply ${i}`, "done")]).flat();
    expect(historyFor(long)).toHaveLength(6);
    expect(historyFor(long).at(-1)).toEqual({ role: "tutor", text: "reply 9" });
  });

  it("the problem the student gave, sent when the last six turns no longer hold it (the owner's conversation)", () => {
    const problem = "O is the center of the circle, R and S lie on the circle. O = (a, b), R = (a + √6, b + 5), ∠ROS is a right angle. What is RS²?";
    const asks = [problem, "now explain", "explain it step by step", "explain it by drawing", "but like the #'s"];
    const messages: ChatMessage[] = asks.flatMap((text, i) => [
      { id: `u${i}`, role: "user" as const, text },
      { id: `t${i}`, role: "tutor" as const, text: "Here is the circle.", state: "done" as const },
    ]);
    // "do the actual problem": the problem left the window three turns ago
    const history = historyFor(messages);
    expect(history.some((t) => t.text === problem)).toBe(false);
    expect(problemFor(messages, history)).toBe(problem);
    // still in the window: not sent twice
    const early = messages.slice(0, 4);
    expect(problemFor(early, historyFor(early))).toBeUndefined();
    // requests for problems, follow-ups and chit-chat are not problems; the latest problem wins
    const none: ChatMessage[] = ["5 two-step equations", "3 more like these", "graph y = x^2", "explain it step by step", "thanks!"].map((text, i) => ({ id: `n${i}`, role: "user", text }));
    expect(problemFor(none, [])).toBeUndefined();
    const two: ChatMessage[] = [
      { id: "a", role: "user", text: "solve 2x + 5 = 17 and explain it" },
      { id: "b", role: "user", text: "a right triangle has legs 6 and 8, how long is the hypotenuse?" },
      { id: "c", role: "tutor", text: "I worked it out on the board: the hypotenuse is 10." },
    ];
    expect(problemFor(two, [])).toBe("a right triangle has legs 6 and 8, how long is the hypotenuse?");
  });

  it("the board's notes, each once", () => {
    expect(runNotes(null)).toEqual([]);
    expect(
      runNotes({
        outcomes: [
          { type: "write_problems", ok: true, note: "1 of 5 problems couldn't be checked, so I left it out." },
          { type: "draw_figure", ok: false, note: "I couldn't draw that figure." },
          { type: "draw_figure", ok: false, note: "I couldn't draw that figure." },
          { type: "new_screen", ok: true },
        ],
        problemsWritten: 4,
        problemsDropped: 1,
        screensAdded: 1,
      }),
    ).toEqual(["1 of 5 problems couldn't be checked, so I left it out.", "I couldn't draw that figure."]);
  });

  it("Enter sends; Shift+Enter and an IME composition do not", () => {
    expect(sendsOnKey({ key: "Enter", shiftKey: false })).toBe(true);
    expect(sendsOnKey({ key: "Enter", shiftKey: true })).toBe(false);
    expect(sendsOnKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(sendsOnKey({ key: "a", shiftKey: false })).toBe(false);
  });
});
