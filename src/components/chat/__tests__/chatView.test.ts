import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { ROUTE_COSTS } from "@/lib/server/billing";
import { CHAT_COPY, CHAT_CREDITS, CHAT_SUGGESTIONS, chatErrorFor, historyFor, runNotes, sendsOnKey, type ChatMessage } from "../chatView";

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
