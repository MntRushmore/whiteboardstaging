import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { ROUTE_COSTS } from "@/lib/server/billing";
import { CHAT_TIMEOUT_MS, ChatTimeoutError, requestChat } from "@/lib/live/chat/client";
import { ASK_LIMITS, AskRequestSchema, type AskStoredTurn } from "@/lib/live/ask/contracts";
import { AskStreamError, AskTimeoutError } from "@/lib/live/ask/client";
import { MORE_LIKE_THESE } from "@/lib/onboarding/tourCopy";
import {
  canStop,
  CHAT_COPY,
  CHAT_INK,
  CHAT_SUGGESTIONS,
  chatErrorFor,
  gradeBand,
  helloFor,
  historyFor,
  isAbort,
  MAX_CHIPS,
  messagesFromHistory,
  MORE_LIKE_THESE_CHIP,
  problemFor,
  runNotes,
  sendsOnKey,
  shownReply,
  SUGGESTIONS,
  tutorStatus,
  WEAK_SPOTS_COPY,
  type ChatMessage,
} from "../chatView";

describe("board chat panel — view logic", () => {
  it("the cost note matches what the route charges", () => {
    expect(CHAT_INK).toBe(ROUTE_COSTS["live/chat"]);
    expect(CHAT_COPY.cost).toBe("Each question uses 3 ink.");
  });

  it("failures: out of ink (no retry, the plan), rate limited with seconds, signed out, network, anything else", () => {
    expect(chatErrorFor(new ApiError("x", 402, "ink_empty"))).toEqual({ kind: "ink", message: CHAT_COPY.errors.ink, retry: false });
    expect(chatErrorFor(new ApiError("x", 503, "upstream_error"))).toMatchObject({ kind: "other", retry: true });
    expect(chatErrorFor(new ApiError("x", 429, "rate_limited", undefined, 4200))).toEqual({ kind: "rate_limited", message: "That's a lot of questions. Try again in 5 s.", retry: true });
    expect(chatErrorFor(new ApiError("x", 401, "unauthorized")).kind).toBe("unauthorized");
    expect(chatErrorFor(new ApiError("x", 502, "upstream_error"))).toEqual({ kind: "other", message: CHAT_COPY.errors.other, retry: true });
    expect(chatErrorFor(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(chatErrorFor(new Error("?")).kind).toBe("other");
  });

  it("the stream's own failures: an error event by its code, a quiet stream as a timeout", () => {
    const ev = (code: string, status?: number) => new AskStreamError({ code, message: "x", ...(status ? { status } : {}) });
    expect(chatErrorFor(ev("credits_exhausted"))).toMatchObject({ kind: "ink", retry: false });
    expect(chatErrorFor(ev("anything", 402)).kind).toBe("ink");
    expect(chatErrorFor(ev("rate_limited", 429)).kind).toBe("rate_limited");
    expect(chatErrorFor(ev("timeout"))).toMatchObject({ kind: "timeout", retry: true });
    expect(chatErrorFor(ev("upstream"))).toEqual({ kind: "other", message: CHAT_COPY.errors.other, retry: true });
    expect(chatErrorFor(ev("incomplete"))).toMatchObject({ kind: "other", retry: true });
    expect(chatErrorFor(new AskTimeoutError())).toMatchObject({ kind: "timeout", retry: true });
  });

  it("a Stop (or a closed board) is an abort, not a failure", () => {
    expect(isAbort(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbort(new AskTimeoutError())).toBe(false);
    expect(isAbort(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("the old route's client still ends a stalled request as a timeout (it stays in the repo)", async () => {
    expect(chatErrorFor(new ChatTimeoutError())).toEqual({ kind: "timeout", message: CHAT_COPY.errors.timeout, retry: true });
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

  it("the chat so far: finished turns only (a stopped reply as far as it got), a failed ask left out, the last twelve", () => {
    const m = (role: ChatMessage["role"], text: string, state?: ChatMessage["state"], extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: text, role, text, state, ...extra });
    const messages = [
      m("user", "3 two-step equations"),
      m("tutor", "Here are 3.", "done"),
      m("user", "graph y = x^2"),
      m("tutor", "Something went wrong.", "error"),
      m("user", "graph y = x^2"),
      m("tutor", "Here is the graph.", "writing"),
      m("user", "why is the sky blue?"),
      m("tutor", "Sunlight bounces", "done", { stopped: true }),
      m("user", "draw a triangle"),
      m("tutor", "Let me dr", "streaming"),
    ];
    expect(historyFor(messages)).toEqual([
      { role: "user", text: "3 two-step equations" },
      { role: "tutor", text: "Here are 3." },
      { role: "user", text: "graph y = x^2" },
      { role: "tutor", text: "Here is the graph." },
      { role: "user", text: "why is the sky blue?" },
      { role: "tutor", text: "Sunlight bounces" },
      { role: "user", text: "draw a triangle" },
    ]);
    const long = Array.from({ length: 20 }, (_, i) => [m("user", `ask ${i}`), m("tutor", `reply ${i}`, "done")]).flat();
    expect(historyFor(long)).toHaveLength(ASK_LIMITS.turns);
    expect(ASK_LIMITS.turns).toBe(12);
    expect(historyFor(long).at(-1)).toEqual({ role: "tutor", text: "reply 19" });
  });

  it("a tutor's whole explanation goes back, up to 2000 characters, and the request it makes is valid", () => {
    const long = `Step 1. ${"Multiply both sides by 4. ".repeat(120)}`;
    const turns = historyFor([
      { id: "u", role: "user", text: "explain it slowly" },
      { id: "t", role: "tutor", text: long, state: "done" },
    ]);
    expect(turns[1].text.length).toBeLessThanOrEqual(ASK_LIMITS.turnText);
    expect(turns[1].text.length).toBeGreaterThan(1900);
    const req = { boardId: "b1", message: "and then?", history: turns, screen: { empty: true, student: [], tutor: [], problems: [] }, clientId: "cm_x_1", voice: true };
    expect(AskRequestSchema.safeParse(req).success).toBe(true);
  });

  it("the problem the student gave, sent when the turns sent no longer hold it (the owner's conversation)", () => {
    const problem = "O is the center of the circle, R and S lie on the circle. O = (a, b), R = (a + √6, b + 5), ∠ROS is a right angle. What is RS²?";
    const asks = [problem, ...Array.from({ length: 7 }, (_, i) => `explain it again ${i}`)];
    const messages: ChatMessage[] = asks.flatMap((text, i) => [
      { id: `u${i}`, role: "user" as const, text },
      { id: `t${i}`, role: "tutor" as const, text: "Here is the circle.", state: "done" as const },
    ]);
    // "do the actual problem": the problem left the window of twelve turns
    const history = historyFor(messages);
    expect(history.some((t) => t.text === problem)).toBe(false);
    expect(problemFor(messages, history)).toBe(problem);
    // still in the window: not sent twice
    const early = messages.slice(0, 4);
    expect(problemFor(early, historyFor(early))).toBeUndefined();
    // requests for problems, follow-ups and chit-chat are not problems
    const none: ChatMessage[] = ["5 two-step equations", "3 more like these", "graph y = x^2", "explain it step by step", "thanks!"].map((text, i) => ({ id: `n${i}`, role: "user", text }));
    expect(problemFor(none, [])).toBeUndefined();
  });

  it("the saved chat becomes finished messages, notes kept, marked as saved", () => {
    const turns: AskStoredTurn[] = [
      { id: "1", role: "user", text: "5 adding problems", notes: [], wrote: [], at: "2026-10-11T10:00:00Z" },
      { id: "2", role: "tutor", text: "Here are 5!", notes: ["1 of 5 problems couldn't be checked, so I left it out."], wrote: ["write_problems"], at: "2026-10-11T10:00:02Z" },
      { id: "3", role: "tutor", text: "  ", notes: [], wrote: [], at: "2026-10-11T10:00:03Z" },
    ];
    expect(messagesFromHistory(turns)).toEqual([
      { id: "saved_1", role: "user", text: "5 adding problems", saved: true },
      { id: "saved_2", role: "tutor", text: "Here are 5!", notes: ["1 of 5 problems couldn't be checked, so I left it out."], state: "done", saved: true },
    ]);
    // and they are the chat so far for the next ask
    expect(historyFor(messagesFromHistory(turns))).toEqual([
      { role: "user", text: "5 adding problems" },
      { role: "tutor", text: "Here are 5!" },
    ]);
  });

  it("the reply as shown never holds the board block, nor the start of its tag", () => {
    expect(shownReply("Here you go!")).toBe("Here you go!");
    expect(shownReply('Here you go! <board>{"actions":[]}</board>')).toBe("Here you go! ");
    expect(shownReply("Here you go! <bo")).toBe("Here you go! ");
    expect(shownReply("a < b")).toBe("a < b");
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

  it("a tutor message's status line, and Stop only while words can still come", () => {
    expect(tutorStatus({ role: "tutor", state: "thinking" })).toBe("thinking");
    expect(tutorStatus({ role: "tutor", state: "streaming" })).toBe("streaming");
    expect(tutorStatus({ role: "tutor", state: "writing" })).toBe("writing");
    expect(tutorStatus({ role: "tutor", state: "done" })).toBeNull();
    expect(tutorStatus({ role: "user" })).toBeNull();
    const tutor = (state: ChatMessage["state"]): ChatMessage[] => [
      { id: "u", role: "user", text: "hi" },
      { id: "t", role: "tutor", text: "", state },
    ];
    expect(canStop(tutor("thinking"))).toBe(true);
    expect(canStop(tutor("streaming"))).toBe(true);
    // the board's writing finishes once started; a finished or failed reply has nothing to stop
    expect(canStop(tutor("writing"))).toBe(false);
    expect(canStop(tutor("done"))).toBe(false);
    expect(canStop(tutor("error"))).toBe(false);
    expect(canStop([])).toBe(false);
  });

  it("Enter sends; Shift+Enter and an IME composition do not", () => {
    expect(sendsOnKey({ key: "Enter", shiftKey: false })).toBe(true);
    expect(sendsOnKey({ key: "Enter", shiftKey: true })).toBe(false);
    expect(sendsOnKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(sendsOnKey({ key: "a", shiftKey: false })).toBe(false);
  });
});

describe("the hello and its chips", () => {
  it("grade bands: K–2, 3–5, 6–8, and high school or not known", () => {
    expect([0, 1, 2].map(gradeBand)).toEqual(["k2", "k2", "k2"]);
    expect([3, 4, 5].map(gradeBand)).toEqual(["g35", "g35", "g35"]);
    expect([6, 7, 8].map(gradeBand)).toEqual(["g68", "g68", "g68"]);
    expect(gradeBand(null)).toBe("hs");
    expect(gradeBand(undefined)).toBe("hs");
  });

  it("every band offers something for the board and one question from beyond maths (the chat helps with any subject)", () => {
    for (const chips of Object.values(SUGGESTIONS)) {
      expect(chips.length).toBeGreaterThanOrEqual(3);
      expect(chips.some((c) => /^\d+ /.test(c))).toBe(true);
      for (const c of chips) expect(c.length).toBeLessThanOrEqual(30);
    }
    expect(SUGGESTIONS.k2).toContain("Why is the sky blue?");
    // a young kid's first asks are a young kid's: no algebra, no graphs
    expect(SUGGESTIONS.k2.join(" ")).not.toMatch(/equation|graph|x²/i);
    expect(SUGGESTIONS.g35.join(" ")).not.toMatch(/equation|graph|x²/i);
  });

  it("no hello of the tutor's own: the friendly default and the grade's chips", () => {
    expect(helloFor({ hello: null, grade: 1, screenHasWork: false })).toEqual({ greeting: CHAT_COPY.hello, chips: [...SUGGESTIONS.k2] });
    expect(helloFor({ hello: null, grade: 7, screenHasWork: false }).chips).toEqual([...SUGGESTIONS.g68]);
    expect(helloFor({ hello: null, grade: null, screenHasWork: false }).chips).toEqual([...SUGGESTIONS.hs]);
  });

  it("the tutor's own hello and chips, when it has them", () => {
    const hello = { greeting: "Welcome back, Maya! Last time you worked on dividing fractions.", chips: ["3 more like last time", "Practice my weak spots"] };
    expect(helloFor({ hello, grade: 5, screenHasWork: true })).toEqual({ greeting: hello.greeting, chips: hello.chips });
    // an empty hello is none
    expect(helloFor({ hello: { greeting: " ", chips: [] }, grade: 5, screenHasWork: false }).greeting).toBe(CHAT_COPY.hello);
    // a greeting with no chips of its own gets the grade's
    expect(helloFor({ hello: { greeting: "Hi Sam!", chips: [] }, grade: 4, screenHasWork: false })).toEqual({ greeting: "Hi Sam!", chips: [...SUGGESTIONS.g35] });
  });

  it("work on the screen: “3 more like these” comes first (the guided board's coach mark taps it), at most four chips", () => {
    const chips = helloFor({ hello: null, grade: 2, screenHasWork: true }).chips;
    expect(chips[0]).toBe(MORE_LIKE_THESE_CHIP);
    expect(chips.length).toBeLessThanOrEqual(MAX_CHIPS);
    expect(MORE_LIKE_THESE_CHIP).toBe(MORE_LIKE_THESE);
    expect(CHAT_SUGGESTIONS).toContain(MORE_LIKE_THESE);
    const own = helloFor({ hello: { greeting: "Hi!", chips: ["a", "b", "c", "d"] }, grade: 2, screenHasWork: true }).chips;
    expect(own).toEqual([MORE_LIKE_THESE_CHIP, "a", "b", "c"]);
  });

  it("the tutor's “Practice my weak spots” is not shown twice beside the device's own chip", () => {
    const hello = { greeting: "Hi!", chips: [WEAK_SPOTS_COPY.chip, "5 adding problems"] };
    expect(helloFor({ hello, grade: 1, screenHasWork: false, weakSpot: true }).chips).toEqual(["5 adding problems"]);
    expect(helloFor({ hello, grade: 1, screenHasWork: false, weakSpot: false }).chips).toEqual([WEAK_SPOTS_COPY.chip, "5 adding problems"]);
  });
});
