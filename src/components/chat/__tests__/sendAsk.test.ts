import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reports: unknown[] = [];
vi.mock("@/lib/reportAppError", () => ({ reportUserError: (r: unknown) => reports.push(r) }));

import { AskStreamError, type AskStreamHandlers, type AskStreamOptions, type streamAsk } from "@/lib/live/ask/client";
import type { AskRequest } from "@/lib/live/ask/contracts";
import type { ChatAction, ChatRunReport, ChatScreen } from "@/lib/live/chat/contracts";
import type { LiveController } from "@/lib/live/contracts";
import { CHAT_COPY, mergeSavedChat, messagesFromHistory, retryOf, type ChatMessage } from "../chatView";
import { ASK_HISTORY_WAIT_MS, ASK_IMAGE_WAIT_MS, boardChatMessages, fetchAskHistory, loadSavedChat, resetBoardChats, sendAsk, stopAsk, type AskSpeechSink } from "../useBoardChat";

/**
 * One ask, start to end (`sendAsk`, the panel's send), against a fake stream: what the store shows,
 * what read-aloud is told (start, the whole text so far, the final text, stop), what goes to the
 * route, and what the admin page hears.
 */

const B = "board-1";
const IMAGE = "data:image/jpeg;base64,AAAA";
const EMPTY_SCREEN: ChatScreen = { empty: true, student: [], tutor: [], problems: [] };
const WORK: ChatScreen = { empty: false, student: ["2x+5=17"], tutor: [], problems: [] };
const REPORT: ChatRunReport = { outcomes: [{ type: "write_problems", ok: true }], problemsWritten: 5, problemsDropped: 0, screensAdded: 0 } as unknown as ChatRunReport;

type Step = (h: AskStreamHandlers) => void;
type StreamFake = typeof streamAsk & { requests: AskRequest[] };

/** A stream that plays `steps` (each a handler call) and resolves, as `streamAsk` does on `done`. */
function stream(steps: Step[]): StreamFake {
  const requests: AskRequest[] = [];
  const fake = (async (req: AskRequest, h: AskStreamHandlers) => {
    requests.push(req);
    for (const step of steps) {
      await Promise.resolve();
      step(h);
    }
  }) as StreamFake;
  fake.requests = requests;
  return fake;
}

/** A stream that writes a few words, then waits until it is stopped (an AbortError, as `streamAsk`). */
function stoppable(words: string): StreamFake {
  const requests: AskRequest[] = [];
  const fake = ((req: AskRequest, h: AskStreamHandlers, opts?: AskStreamOptions) => {
    requests.push(req);
    h.onDelta?.(words);
    return new Promise<void>((_, reject) => opts?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  }) as StreamFake;
  fake.requests = requests;
  return fake;
}

function speechSpy() {
  const calls: string[] = [];
  const sink: AskSpeechSink = {
    start: (id) => calls.push(`start ${id}`),
    feed: (_id, text) => calls.push(`feed ${text}`),
    finish: (_id, text) => calls.push(`finish ${text}`),
    stop: () => calls.push("stop"),
  };
  return { sink, calls };
}

function controller(over: Partial<LiveController> = {}): LiveController & { written: ChatAction[][] } {
  const written: ChatAction[][] = [];
  return {
    chatScreen: () => EMPTY_SCREEN,
    runChatActions: async (actions: readonly ChatAction[]) => {
      written.push([...actions]);
      return REPORT;
    },
    written,
    ...over,
  } as unknown as LiveController & { written: ChatAction[][] };
}

const tutorOf = () => boardChatMessages(B).at(-1)!;

describe("sendAsk: one ask, streamed", () => {
  beforeEach(() => {
    resetBoardChats();
    reports.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the words paint as they come, `reply` replaces them, read-aloud hears the whole text so far, and the saved turn's id is kept", async () => {
    const s = stream([
      (h) => h.onModel?.("anthropic/claude-haiku-5.5"),
      (h) => h.onDelta?.("To solve $2x + 5 = 17$, "),
      (h) => h.onDelta?.("take away 5. <bo"),
      (h) => h.onReply?.("To solve $2x + 5 = 17$, take away 5 from both sides. Then divide by 2."),
      (h) => h.onActions?.({ actions: [], notes: [] }),
      (h) => h.onDone?.({ model: "m", ms: 900, turnId: "turn_42" }),
    ]);
    const { sink, calls } = speechSpy();
    await sendAsk(B, "  how do I solve 2x + 5 = 17?  ", { voice: true }, { controller: controller(), speech: () => sink, stream: s });

    const [user, tutor] = boardChatMessages(B);
    expect(user).toMatchObject({ role: "user", text: "how do I solve 2x + 5 = 17?", voice: true });
    expect(tutor).toMatchObject({ role: "tutor", state: "done", text: "To solve $2x + 5 = 17$, take away 5 from both sides. Then divide by 2.", turnId: "turn_42" });
    // a new reply starts read-aloud, each word feeds the whole text so far (never the board tag's start), the reply finishes it
    expect(calls).toEqual([
      `start ${tutor.id}`,
      "feed To solve $2x + 5 = 17$, ",
      "feed To solve $2x + 5 = 17$, take away 5. ",
      "finish To solve $2x + 5 = 17$, take away 5 from both sides. Then divide by 2.",
    ]);
    // the request: the words, the clientId the user message keeps, said not typed
    expect(s.requests[0]).toMatchObject({ boardId: B, message: "how do I solve 2x + 5 = 17?", history: [], voice: true, clientId: user.clientId });
    expect(s.requests[0].clientId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(reports).toEqual([]);
  });

  it("a `done` with no turnId (saving failed) is still a finished answer, unsaved", async () => {
    const s = stream([(h) => h.onDelta?.("Hi!"), (h) => h.onReply?.("Hi!"), (h) => h.onActions?.({ actions: [], notes: [] }), (h) => h.onDone?.({ model: "m", ms: 1 })]);
    await sendAsk(B, "hello", {}, { controller: controller(), speech: () => null, stream: s });
    expect(tutorOf()).toMatchObject({ state: "done", text: "Hi!" });
    expect(tutorOf().turnId).toBeUndefined();
  });

  it("board actions are written in the tutor's hand as soon as they come, with the board's notes after", async () => {
    const actions = [{ type: "write_problems", problems: [["x+1=2"]] }] as unknown as ChatAction[];
    const ctl = controller();
    const s = stream([
      (h) => h.onDelta?.("Here are 5 two-step equations."),
      (h) => h.onReply?.("Here are 5 two-step equations."),
      (h) => h.onActions?.({ actions, notes: ["1 problem couldn't be checked, so I left it out."] }),
      (h) => h.onDone?.({ model: "m", ms: 1, turnId: "t1" }),
    ]);
    await sendAsk(B, "5 two-step equations", {}, { controller: ctl, speech: () => null, stream: s });
    expect(ctl.written).toEqual([actions]);
    expect(tutorOf()).toMatchObject({ state: "done", text: "Here are 5 two-step equations.", turnId: "t1", notes: ["1 problem couldn't be checked, so I left it out."] });
  });

  it("a picture of the screen goes with the ask only when there is work on it, and never holds it up", async () => {
    vi.useFakeTimers();
    // an empty screen: no picture asked for
    const chatImage = vi.fn(async () => IMAGE);
    let s = stream([(h) => h.onDone?.({ model: "m", ms: 1 })]);
    await sendAsk(B, "hi", {}, { controller: controller({ chatImage }), speech: () => null, stream: s });
    expect(chatImage).not.toHaveBeenCalled();
    expect(s.requests[0].screen.image).toBeUndefined();

    // work on it: the picture goes along
    s = stream([(h) => h.onDone?.({ model: "m", ms: 1 })]);
    await sendAsk(B, "what is this?", {}, { controller: controller({ chatScreen: () => WORK, chatImage }), speech: () => null, stream: s });
    expect(s.requests[0].screen).toMatchObject({ empty: false, image: IMAGE });

    // a picture slower than ASK_IMAGE_WAIT_MS: the ask goes without it
    s = stream([(h) => h.onDone?.({ model: "m", ms: 1 })]);
    const slow = () => new Promise<string | null>((r) => setTimeout(() => r(IMAGE), ASK_IMAGE_WAIT_MS * 3));
    const pending = sendAsk(B, "and this?", {}, { controller: controller({ chatScreen: () => WORK, chatImage: slow }), speech: () => null, stream: s });
    await vi.advanceTimersByTimeAsync(ASK_IMAGE_WAIT_MS + 10);
    await pending;
    expect(s.requests[0].screen.image).toBeUndefined();

    // none to give (null), or not an image data URL: none sent
    s = stream([(h) => h.onDone?.({ model: "m", ms: 1 })]);
    await sendAsk(B, "again", {}, { controller: controller({ chatScreen: () => WORK, chatImage: async () => "https://example.com/x.png" }), speech: () => null, stream: s });
    expect(s.requests[0].screen.image).toBeUndefined();
  });

  it("Stop keeps what came, silences read-aloud, and is never reported as a failure", async () => {
    const s = stoppable("Sunlight is made of ");
    const { sink, calls } = speechSpy();
    const pending = sendAsk(B, "why is the sky blue?", {}, { controller: controller(), speech: () => sink, stream: s });
    await vi.waitFor(() => expect(s.requests).toHaveLength(1));
    stopAsk(B);
    await pending;
    expect(tutorOf()).toMatchObject({ state: "done", stopped: true, text: "Sunlight is made of" });
    expect(calls.at(-1)).toBe("stop");
    expect(reports).toEqual([]);
  });

  it("a failure mid-stream: one calm line with Try again, read-aloud stopped, a `live.chat` report with the stream's code", async () => {
    const s = stream([(h) => h.onDelta?.("Let's"), () => {
      throw new AskStreamError({ code: "upstream", message: "The tutor had a hiccup.", status: 502 });
    }]);
    const { sink, calls } = speechSpy();
    await sendAsk(B, "explain fractions", { voice: true }, { controller: controller(), speech: () => sink, stream: s });
    expect(tutorOf()).toMatchObject({ state: "error", text: CHAT_COPY.errors.other, retryText: "explain fractions", error: { kind: "other", retry: true } });
    expect(calls.at(-1)).toBe("stop");
    expect(reports).toEqual([expect.objectContaining({ kind: "live.chat", code: "stream_upstream", message: CHAT_COPY.errors.other, boardId: B })]);
    // never what the student asked
    expect(JSON.stringify(reports)).not.toContain("fractions");
  });

  it("a drop after the board started writing: the words stay, the writing finishes once, done with a note — never Try again", async () => {
    const actions = [{ type: "write_problems", problems: [["x+1=2"]] }] as unknown as ChatAction[];
    let finishRun: () => void = () => {};
    const written: ChatAction[][] = [];
    const ctl = controller({
      runChatActions: (a: readonly ChatAction[]) => {
        written.push([...a]);
        return new Promise<ChatRunReport>((resolve) => {
          finishRun = () => resolve(REPORT);
        });
      },
    } as Partial<LiveController>);
    const s = stream([
      (h) => h.onDelta?.("Here are 5 two-step equations."),
      (h) => h.onReply?.("Here are 5 two-step equations."),
      (h) => h.onActions?.({ actions, notes: [] }),
      () => {
        throw new AskStreamError({ code: "upstream", message: "dropped", status: 502 });
      },
    ]);
    const { sink, calls } = speechSpy();
    const asking = sendAsk(B, "5 two-step equations", {}, { controller: ctl, speech: () => sink, stream: s });
    // the hand is still writing: the ask is not over (busy), and nothing says it failed
    await vi.waitFor(() => expect(written).toHaveLength(1));
    await Promise.resolve();
    expect(tutorOf()).toMatchObject({ state: "writing", text: "Here are 5 two-step equations." });
    await sendAsk(B, "another", {}, { controller: ctl, speech: () => null, stream: s });
    expect(boardChatMessages(B).filter((m) => m.role === "user")).toHaveLength(1);
    finishRun();
    await asking;

    const tutor = tutorOf();
    expect(tutor).toMatchObject({ state: "done", text: "Here are 5 two-step equations.", notes: [CHAT_COPY.cutOff] });
    expect(tutor.error).toBeUndefined();
    expect(tutor.retryText).toBeUndefined();
    // nothing to try again: the problems are written once
    expect(retryOf(boardChatMessages(B), tutor.id)).toBeNull();
    expect(written).toHaveLength(1);
    // the words were final: read aloud to the end, not cut off
    expect(calls).toContain("finish Here are 5 two-step equations.");
    expect(calls).not.toContain("stop");
    // heard of as a warning, with the stream's code
    expect(reports).toEqual([expect.objectContaining({ kind: "live.chat", code: "stream_upstream", level: "warn" })]);
  });

  it("Try again sends the same words with the same clientId (the route saves it once), said if it was said", async () => {
    const fail = stream([() => {
      throw new AskStreamError({ code: "timeout", message: "slow", status: 504 });
    }]);
    await sendAsk(B, "what is a ratio?", { voice: true }, { controller: controller(), speech: () => null, stream: fail });
    const messages = boardChatMessages(B);
    const again = retryOf(messages, messages[1].id)!;
    expect(again).toMatchObject({ text: "what is a ratio?", prior: [], local: false, voice: true, clientId: messages[0].clientId });

    const ok = stream([(h) => h.onReply?.("A ratio compares two amounts."), (h) => h.onDone?.({ model: "m", ms: 1, turnId: "t" })]);
    await sendAsk(B, again.text, { prior: again.prior, voice: again.voice, clientId: again.clientId }, { controller: controller(), speech: () => null, stream: ok });
    expect(ok.requests[0].clientId).toBe(messages[0].clientId);
    // the failed ask and its error are replaced, not kept beside the new one
    expect(boardChatMessages(B).map((m) => m.role)).toEqual(["user", "tutor"]);
    expect(tutorOf()).toMatchObject({ state: "done", text: "A ratio compares two amounts." });
  });

  it("the chat so far goes with the next ask: finished turns, a stopped one as far as it got, never a failed one", async () => {
    const prior: ChatMessage[] = [
      { id: "1", role: "user", text: "hi" },
      { id: "2", role: "tutor", text: "Hi! What are we working on?", state: "done" },
      { id: "3", role: "user", text: "why?" },
      { id: "4", role: "tutor", text: CHAT_COPY.errors.network, state: "error", retryText: "why?" },
    ];
    const s = stream([(h) => h.onDone?.({ model: "m", ms: 1 })]);
    await sendAsk(B, "fractions", { prior }, { controller: controller(), speech: () => null, stream: s });
    expect(s.requests[0].history).toEqual([
      { role: "user", text: "hi" },
      { role: "tutor", text: "Hi! What are we working on?" },
    ]);
  });

  it("before the board is up: its own words and code, nothing sent", async () => {
    const s = stream([]);
    await sendAsk(B, "hi", {}, { controller: {} as LiveController, speech: () => null, stream: s });
    expect(s.requests).toHaveLength(0);
    expect(tutorOf()).toMatchObject({ state: "error", text: CHAT_COPY.errors.board });
    expect(reports).toEqual([expect.objectContaining({ kind: "live.chat", code: "board_not_ready" })]);
  });

  it("one ask at a time per board: a second send while one is going does nothing", async () => {
    const s = stoppable("Hmm");
    const first = sendAsk(B, "one", {}, { controller: controller(), speech: () => null, stream: s });
    await vi.waitFor(() => expect(s.requests).toHaveLength(1));
    await sendAsk(B, "two", {}, { controller: controller(), speech: () => null, stream: s });
    expect(boardChatMessages(B).filter((m) => m.role === "user").map((m) => m.text)).toEqual(["one"]);
    stopAsk(B);
    await first;
  });
});

describe("fetchAskHistory: the saved chat, read when the panel opens", () => {
  const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const read = (r: Response | Error) =>
    fetchAskHistory(B, new AbortController().signal, (async (url: string) => {
      expect(url).toBe(`/api/live/ask/history?boardId=${B}`);
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as Parameters<typeof fetchAskHistory>[2]);

  it("the turns (oldest first) or, for a board with none, the hello", async () => {
    const turns = [
      { id: "a", role: "user", text: "hi", notes: [], wrote: [], at: "2026-10-11T10:00:00Z" },
      { id: "b", role: "tutor", text: "Hello!", notes: [], wrote: [], at: "2026-10-11T10:00:01Z" },
    ];
    expect(await read(res(200, { turns, hello: null }))).toMatchObject({ history: { turns: [{ id: "a" }, { id: "b" }], hello: null }, retry: false });
    const hello = { greeting: "Hi Maya! I'm your tutor.", chips: ["Quiz me on fractions"] };
    expect(await read(res(200, { turns: [], hello }))).toEqual({ history: { turns: [], hello }, retry: false });
  });

  it("not the student's board (404) is none for good; the route's 502, a 429 or a dropped connection try again on the next open", async () => {
    expect(await read(res(404, { error: "not_found" }))).toEqual({ history: null, retry: false });
    expect(await read(res(502, { error: "upstream_error" }))).toEqual({ history: null, retry: true });
    expect(await read(res(429, { error: "rate_limited" }))).toEqual({ history: null, retry: true });
    expect(await read(new TypeError("Failed to fetch"))).toEqual({ history: null, retry: true });
    // an answer that is not the contract's is none
    expect(await read(res(200, { turns: "nope" }))).toEqual({ history: null, retry: false });
  });

  it("the saved turns become finished messages the next ask sends as the chat so far", () => {
    const msgs = messagesFromHistory([
      { id: "a", role: "user", text: "5 two-step equations", notes: [], wrote: [], at: "x" },
      { id: "b", role: "tutor", text: "Here are 5.", notes: ["1 couldn't be checked."], wrote: ["write_problems"], at: "y" },
    ]);
    expect(msgs).toEqual([
      { id: "saved_a", role: "user", text: "5 two-step equations", saved: true },
      { id: "saved_b", role: "tutor", text: "Here are 5.", notes: ["1 couldn't be checked."], state: "done", saved: true },
    ]);
  });
});

describe("the saved chat and an ask typed as the panel opens", () => {
  const SAVED = {
    turns: [
      { id: "a", role: "user", text: "How do I add 1/2 and 1/4?", notes: [], wrote: [], at: "x" },
      { id: "b", role: "tutor", text: "Make the bottoms match: 1/2 is 2/4, so 2/4 + 1/4 = 3/4.", notes: [], wrote: [], at: "y" },
    ],
    hello: null,
  };
  /** A history route that answers when told to. */
  function slowHistory() {
    let answer: () => void = () => {};
    const fetchImpl = (() =>
      new Promise<Response>((resolve) => {
        answer = () => resolve(new Response(JSON.stringify(SAVED), { status: 200, headers: { "Content-Type": "application/json" } }));
      })) as unknown as Parameters<typeof loadSavedChat>[1];
    return { fetchImpl, answer: () => answer() };
  }

  beforeEach(() => {
    resetBoardChats();
    reports.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the ask waits for it (a moment): the saved turns go first in the chat and with the ask", async () => {
    const h = slowHistory();
    const loading = loadSavedChat(B, h.fetchImpl);
    const s = stream([(h2) => h2.onReply?.("Yes! Now try 1/3 + 1/3."), (h2) => h2.onDone?.({ model: "m", ms: 1, turnId: "t" })]);
    const asking = sendAsk(B, "can I have another one?", {}, { controller: controller(), speech: () => null, stream: s });
    await Promise.resolve();
    expect(s.requests).toHaveLength(0);
    h.answer();
    await loading;
    await asking;
    expect(s.requests[0].history).toEqual([
      { role: "user", text: "How do I add 1/2 and 1/4?" },
      { role: "tutor", text: "Make the bottoms match: 1/2 is 2/4, so 2/4 + 1/4 = 3/4." },
    ]);
    expect(boardChatMessages(B).map((m) => m.text)).toEqual([
      "How do I add 1/2 and 1/4?",
      "Make the bottoms match: 1/2 is 2/4, so 2/4 + 1/4 = 3/4.",
      "can I have another one?",
      "Yes! Now try 1/3 + 1/3.",
    ]);
  });

  it("a saved chat slower than ASK_HISTORY_WAIT_MS: the ask goes without it, and the turns still land first", async () => {
    vi.useFakeTimers();
    const h = slowHistory();
    const loading = loadSavedChat(B, h.fetchImpl);
    const s = stream([(h2) => h2.onReply?.("Sure."), (h2) => h2.onDone?.({ model: "m", ms: 1 })]);
    const asking = sendAsk(B, "hi", {}, { controller: controller(), speech: () => null, stream: s });
    await vi.advanceTimersByTimeAsync(ASK_HISTORY_WAIT_MS + 10);
    await asking;
    expect(s.requests[0].history).toEqual([]);
    h.answer();
    await loading;
    expect(boardChatMessages(B).map((m) => m.role)).toEqual(["user", "tutor", "user", "tutor"]);
    expect(boardChatMessages(B)[0].saved).toBe(true);
  });

  it("a read retried after asks in this tab: the older saved turns go first, this tab's exchanges are never added twice, nor sent twice", async () => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    // the first read fails (the route's 502): a later open tries again
    await loadSavedChat(B, (async () => json({ error: "upstream_error" }, 502)) as unknown as Parameters<typeof loadSavedChat>[1]);
    expect(boardChatMessages(B)).toEqual([]);

    // meanwhile, two asks in this tab: one saved (`done.turnId`), one whose `done` never came (saved all the same)
    await sendAsk(B, "what is 3/4 of 8?", {}, { controller: controller(), speech: () => null, stream: stream([(h) => h.onReply?.("It is 6."), (h) => h.onDone?.({ model: "m", ms: 1, turnId: "t3" })]) });
    await sendAsk(B, "and of 12?", {}, { controller: controller(), speech: () => null, stream: stream([(h) => h.onReply?.("It is 9."), (h) => h.onDone?.({ model: "m", ms: 1 })]) });

    // the retried read: the older chat, then this tab's two exchanges as the route saved them
    const turns = [
      ...SAVED.turns,
      { id: "u3", role: "user", text: "what is 3/4 of 8?", notes: [], wrote: [], at: "z1" },
      { id: "t3", role: "tutor", text: "It is 6.", notes: [], wrote: [], at: "z2" },
      { id: "u4", role: "user", text: "and of 12?", notes: [], wrote: [], at: "z3" },
      { id: "t4", role: "tutor", text: "It is 9.", notes: [], wrote: [], at: "z4" },
    ];
    await loadSavedChat(B, (async () => json({ turns, hello: null })) as unknown as Parameters<typeof loadSavedChat>[1]);
    expect(boardChatMessages(B).map((m) => m.text)).toEqual(["How do I add 1/2 and 1/4?", "Make the bottoms match: 1/2 is 2/4, so 2/4 + 1/4 = 3/4.", "what is 3/4 of 8?", "It is 6.", "and of 12?", "It is 9."]);
    expect(boardChatMessages(B).slice(0, 2).every((m) => m.saved)).toBe(true);

    // the next ask carries each exchange once
    const s = stream([(h) => h.onReply?.("It is 12."), (h) => h.onDone?.({ model: "m", ms: 1 })]);
    await sendAsk(B, "and of 16?", {}, { controller: controller(), speech: () => null, stream: s });
    expect(s.requests[0].history.map((t) => t.text)).toEqual(["How do I add 1/2 and 1/4?", "Make the bottoms match: 1/2 is 2/4, so 2/4 + 1/4 = 3/4.", "what is 3/4 of 8?", "It is 6.", "and of 12?", "It is 9."]);
  });

  it("mergeSavedChat: this tab's exchanges found by turn id or by their words; an older one with the same words stays", () => {
    const saved = messagesFromHistory([
      { id: "a", role: "user", text: "5 adding problems", notes: [], wrote: [], at: "x" },
      { id: "b", role: "tutor", text: "Here are 5.", notes: [], wrote: [], at: "x" },
      { id: "c", role: "user", text: "why?", notes: [], wrote: [], at: "x" },
      { id: "d", role: "tutor", text: "Because.", notes: [], wrote: [], at: "x" },
      { id: "e", role: "user", text: "5 adding problems", notes: [], wrote: [], at: "x" },
      { id: "f", role: "tutor", text: "Here are 5.", notes: [], wrote: [], at: "x" },
    ]);
    // the same words asked yesterday and today: only today's (the newest) is this tab's
    const today: ChatMessage[] = [
      { id: "1", role: "user", text: "5 adding problems", clientId: "c1" },
      { id: "2", role: "tutor", text: "Here are 5.", state: "done" },
    ];
    expect(mergeSavedChat(saved, today).map((m) => m.id)).toEqual(["saved_a", "saved_b", "saved_c", "saved_d", "1", "2"]);
    // by turn id: everything from it on is this tab's
    const byId: ChatMessage[] = [
      { id: "1", role: "user", text: "why?", clientId: "c1" },
      { id: "2", role: "tutor", text: "Because.", state: "done", turnId: "d" },
      { id: "3", role: "user", text: "5 adding problems", clientId: "c2" },
      { id: "4", role: "tutor", text: "Here are 5.", state: "done", turnId: "f" },
    ];
    expect(mergeSavedChat(saved, byId).map((m) => m.id)).toEqual(["saved_a", "saved_b", "1", "2", "3", "4"]);
    // a failed or stopped ask in this tab was never saved: the whole saved chat goes first
    const failed: ChatMessage[] = [
      { id: "1", role: "user", text: "why?" },
      { id: "2", role: "tutor", text: CHAT_COPY.errors.other, state: "error", retryText: "why?" },
    ];
    expect(mergeSavedChat(saved, failed)).toHaveLength(8);
    // nothing in this tab, or the saved chat already in it
    expect(mergeSavedChat(saved, [])).toEqual(saved);
    expect(mergeSavedChat(saved, [...saved])).toEqual(saved);
  });

  it("read once a session: a second open does not read it again, nor add the turns twice", async () => {
    let reads = 0;
    const fetchImpl = (async () => {
      reads++;
      return new Response(JSON.stringify(SAVED), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as Parameters<typeof loadSavedChat>[1];
    await Promise.all([loadSavedChat(B, fetchImpl), loadSavedChat(B, fetchImpl)]);
    await loadSavedChat(B, fetchImpl);
    expect(reads).toBe(1);
    expect(boardChatMessages(B)).toHaveLength(2);
  });
});
