import { beforeEach, describe, expect, it, vi } from "vitest";

const reports: unknown[] = [];
vi.mock("@/lib/reportAppError", () => ({ reportUserError: (r: unknown) => reports.push(r) }));

import type { AskStreamHandlers, streamAsk } from "@/lib/live/ask/client";
import { ASK_MOVE_PATH, type AskRequest } from "@/lib/live/ask/contracts";
import type { ChatAction, ChatRunReport, ChatScreen } from "@/lib/live/chat/contracts";
import type { ChatScreenChange, LiveController } from "@/lib/live/contracts";
import { CHAT_COPY, helloFor, moveExchange, threadKey, type ChatMessage } from "../chatView";
import {
  boardChatMessages,
  boardChatScreen,
  chatMessagesFor,
  fetchAskHistory,
  followChatScreen,
  historyScreenOf,
  loadSavedChat,
  moveSavedTurns,
  resetBoardChats,
  screenOf,
  sendAsk,
  type moveSavedTurns as MoveSaved,
} from "../useBoardChat";

/**
 * Ask's chat per screen (docs/ASK-V2.md, "A chat per screen"), the panel's side: a thread per screen,
 * the ask going to the screen it was sent from with only that screen's chat, the saved chat read per
 * screen (the first screen's with the turns saved before), a new screen's hello, and an exchange
 * whose board actions start a new screen moving there with them — here at once, and on the server
 * with its saved turns.
 */

const B = "b1000000-0000-4000-8000-000000000001";
const S1 = "page:page";
const S2 = "page:second";
const S3 = "page:third";
const EMPTY_SCREEN: ChatScreen = { empty: true, student: [], tutor: [], problems: [] };
const REPORT: ChatRunReport = { outcomes: [{ type: "write_problems", ok: true }], problemsWritten: 5, problemsDropped: 0, screensAdded: 0 } as unknown as ChatRunReport;
const FIVE = [{ type: "write_problems", problems: [["x+1=2"]] }] as unknown as ChatAction[];

type StreamFake = typeof streamAsk & { requests: AskRequest[] };
function stream(steps: Array<(h: AskStreamHandlers) => void>): StreamFake {
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

/** A board with screens (tldraw pages, in order) that tells of moves, as `useLiveMath`'s controller does. */
function board(pages: string[] = [S1, S2], over: Partial<LiveController> = {}) {
  const order = [...pages];
  let current = order[0];
  const listeners = new Set<(id: string, how: ChatScreenChange) => void>();
  const move = (id: string, tutor = false) => {
    if (!order.includes(id)) order.push(id);
    current = id;
    for (const cb of [...listeners]) cb(id, { tutor });
  };
  const controller = {
    chatScreen: () => EMPTY_SCREEN,
    chatScreenId: () => current,
    chatScreenIndex: () => order.indexOf(current) + 1,
    onChatScreenChange: (cb: (id: string, how: ChatScreenChange) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    runChatActions: async () => REPORT,
    ...over,
  } as unknown as LiveController;
  return { controller, move, listeners };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Fetch = Parameters<typeof loadSavedChat>[1];

beforeEach(() => {
  resetBoardChats();
  reports.length = 0;
});

describe("threads: one per screen", () => {
  it("an ask goes in the thread of the screen it is sent from, names that screen, and carries only that screen's chat", async () => {
    const { controller } = board();
    // screen 2 already has a chat of its own: never sent with screen 1's ask
    await sendAsk(B, "what is 6 x 7?", { screen: { id: S2, index: 2 } }, { controller, speech: () => null, stream: stream([(h) => h.onReply?.("42!"), (h) => h.onDone?.({ model: "m", ms: 1 })]) });
    const s = stream([(h) => h.onReply?.("Make the bottoms match."), (h) => h.onDone?.({ model: "m", ms: 1, turnId: "t1", userTurnId: "u1" })]);
    await sendAsk(B, "how do I add 1/2 and 1/4?", {}, { controller, speech: () => null, stream: s });

    expect(s.requests[0]).toMatchObject({ screenId: S1, history: [] });
    expect(boardChatMessages(B, S1).map((m) => m.text)).toEqual(["how do I add 1/2 and 1/4?", "Make the bottoms match."]);
    expect(boardChatMessages(B, S2).map((m) => m.text)).toEqual(["what is 6 x 7?", "42!"]);
    // the board's one thread (a controller that does not say) is another thread again
    expect(boardChatMessages(B)).toEqual([]);

    // the next ask on screen 2 carries screen 2's chat only
    const next = stream([(h) => h.onReply?.("48."), (h) => h.onDone?.({ model: "m", ms: 1 })]);
    await sendAsk(B, "and 6 x 8?", { screen: { id: S2, index: 2 } }, { controller, speech: () => null, stream: next });
    expect(next.requests[0].history).toEqual([
      { role: "user", text: "what is 6 x 7?" },
      { role: "tutor", text: "42!" },
    ]);
    expect(next.requests[0].screenId).toBe(S2);
  });

  it("a board that does not say which screen it is on keeps one thread, and asks without a screen", async () => {
    const s = stream([(h) => h.onReply?.("Hi!"), (h) => h.onDone?.({ model: "m", ms: 1 })]);
    await sendAsk(B, "hi", {}, { controller: { chatScreen: () => EMPTY_SCREEN, runChatActions: async () => REPORT } as unknown as LiveController, speech: () => null, stream: s });
    expect(s.requests[0].screenId).toBeUndefined();
    expect(boardChatMessages(B).map((m) => m.text)).toEqual(["hi", "Hi!"]);
    expect(screenOf({} as LiveController)).toEqual({ id: null, index: null });
  });

  it("following the board: the screen it is on, and the messages of that screen's thread", async () => {
    const { controller, move, listeners } = board([S1]);
    await sendAsk(B, "hi on 1", {}, { controller, speech: () => null, stream: stream([(h) => h.onReply?.("Hello, screen 1!"), (h) => h.onDone?.({ model: "m", ms: 1 })]) });
    const off = followChatScreen(B, controller);
    expect(boardChatScreen(B)).toEqual({ id: S1, index: 1 });
    expect(chatMessagesFor(B).map((m) => m.text)).toEqual(["hi on 1", "Hello, screen 1!"]);
    // the student adds screen 2 with "+": a fresh thread
    move(S2);
    expect(boardChatScreen(B)).toEqual({ id: S2, index: 2 });
    expect(chatMessagesFor(B)).toEqual([]);
    // back on screen 1: its chat is back
    move(S1);
    expect(chatMessagesFor(B).map((m) => m.text)).toEqual(["hi on 1", "Hello, screen 1!"]);
    off();
    expect(listeners.size).toBe(0);
  });
});

describe("the saved chat, per screen", () => {
  it("the history route is asked for the screen's chat, the first screen's with first=1", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return json({ turns: [], hello: null });
    }) as unknown as Fetch;
    await fetchAskHistory(B, new AbortController().signal, fetchImpl, historyScreenOf({ id: S1, index: 1 }));
    await fetchAskHistory(B, new AbortController().signal, fetchImpl, historyScreenOf({ id: S2, index: 2 }));
    await fetchAskHistory(B, new AbortController().signal, fetchImpl, null);
    expect(urls).toEqual([
      `/api/live/ask/history?boardId=${B}&screenId=${encodeURIComponent(S1)}&first=1`,
      `/api/live/ask/history?boardId=${B}&screenId=${encodeURIComponent(S2)}&first=0`,
      `/api/live/ask/history?boardId=${B}`,
    ]);
    // a screen whose place is not known is taken as the first (its older turns are not lost)
    expect(historyScreenOf({ id: S3, index: null })).toEqual({ id: S3, first: true });
    expect(historyScreenOf({ id: null, index: null })).toBeNull();
  });

  it("each screen's saved turns land in its own thread, read once a session per screen", async () => {
    let reads = 0;
    const fetchImpl = (async (url: string) => {
      reads++;
      const second = url.includes(encodeURIComponent(S2));
      return json({
        turns: second ? [{ id: "b", role: "user", text: "on two", notes: [], wrote: [], at: "x", screenId: S2 }] : [{ id: "a", role: "user", text: "on one", notes: [], wrote: [], at: "x", screenId: null }],
        hello: null,
      });
    }) as unknown as Fetch;
    await loadSavedChat(B, fetchImpl, { id: S1, index: 1 });
    await loadSavedChat(B, fetchImpl, { id: S2, index: 2 });
    await loadSavedChat(B, fetchImpl, { id: S1, index: 1 });
    expect(reads).toBe(2);
    expect(boardChatMessages(B, S1).map((m) => m.text)).toEqual(["on one"]);
    expect(boardChatMessages(B, S2).map((m) => m.text)).toEqual(["on two"]);
  });

  it("a new screen's hello: the server's line and chips; without it, the panel's own new-screen line", () => {
    const own = { greeting: "New screen! What should we work on?", chips: ["3 more on dividing fractions", "Explain dividing fractions to me"] };
    expect(helloFor({ hello: own, grade: 5, screenHasWork: false, screenIndex: 2 })).toEqual({ greeting: own.greeting, chips: own.chips });
    expect(helloFor({ hello: null, grade: 5, screenHasWork: false, screenIndex: 2 }).greeting).toBe(CHAT_COPY.newScreen);
    expect(helloFor({ hello: null, grade: 5, screenHasWork: false, screenIndex: 1 }).greeting).toBe(CHAT_COPY.hello);
    expect(helloFor({ hello: null, grade: 5, screenHasWork: false }).greeting).toBe(CHAT_COPY.hello);
    // work on the new screen: "3 more like these" leads, and the server's "3 more on…" gives way to it
    expect(helloFor({ hello: own, grade: 5, screenHasWork: true, screenIndex: 2 }).chips).toEqual(["3 more like these", "Explain dividing fractions to me"]);
  });
});

describe("the tutor starts a new screen: the exchange goes with it", () => {
  it("heard as the tutor's while the actions run: the exchange moves into the new screen's thread at once, then on the server with both saved turns", async () => {
    const moves: Array<[string, readonly string[], string]> = [];
    const moveSaved = (async (boardId: string, ids: readonly string[], screenId: string) => {
      moves.push([boardId, ids, screenId]);
      return true;
    }) as typeof MoveSaved;
    let seenDuringRun: string[] = [];
    const b = board([S1]);
    const { controller } = board([S1], {
      runChatActions: async () => {
        // more problems on a full screen: the desk starts screen 2 and writes there
        b.move(S2, true);
        seenDuringRun = boardChatMessages(B, S2).map((m) => `${m.role}:${m.state ?? ""}`);
        return { ...REPORT, screensAdded: 1 };
      },
    });
    Object.assign(controller, { chatScreenId: b.controller.chatScreenId, chatScreenIndex: b.controller.chatScreenIndex, onChatScreenChange: b.controller.onChatScreenChange });
    await loadSavedChat(B, (async () => json({ turns: [{ id: "old", role: "user", text: "an older ask on 1", notes: [], wrote: [], at: "x" }], hello: null })) as unknown as Fetch, { id: S1, index: 1 });

    const s = stream([
      (h) => h.onReply?.("Here are 5 more, on a new screen."),
      (h) => h.onActions?.({ actions: FIVE, notes: [] }),
      (h) => h.onDone?.({ model: "m", ms: 1, turnId: "turn-t", userTurnId: "turn-u" }),
    ]);
    await sendAsk(B, "5 more problems", {}, { controller, speech: () => null, stream: s, moveSaved });

    // asked from screen 1, and saved there by the route
    expect(s.requests[0].screenId).toBe(S1);
    // while the hand was writing on screen 2, the exchange was already in screen 2's chat
    expect(seenDuringRun).toEqual(["user:", "tutor:writing"]);
    expect(boardChatMessages(B, S2).map((m) => m.text)).toEqual(["5 more problems", "Here are 5 more, on a new screen."]);
    expect(boardChatMessages(B, S2)[1]).toMatchObject({ state: "done", turnId: "turn-t" });
    // screen 1 keeps the rest of its chat
    expect(boardChatMessages(B, S1).map((m) => m.text)).toEqual(["an older ask on 1"]);
    // the saved turns follow, both of them
    expect(moves).toEqual([[B, ["turn-u", "turn-t"], S2]]);
  });

  it("not heard (a controller that does not tell): screensAdded moves it to the screen the board is on after the run", async () => {
    let current = S1;
    const moves: string[] = [];
    const controller = {
      chatScreen: () => EMPTY_SCREEN,
      chatScreenId: () => current,
      chatScreenIndex: () => (current === S1 ? 1 : 2),
      runChatActions: async () => {
        current = S2;
        return { ...REPORT, screensAdded: 1 };
      },
    } as unknown as LiveController;
    const s = stream([(h) => h.onReply?.("Here you go."), (h) => h.onActions?.({ actions: FIVE, notes: [] }), (h) => h.onDone?.({ model: "m", ms: 1, turnId: "t", userTurnId: "u" })]);
    await sendAsk(B, "more please", {}, { controller, speech: () => null, stream: s, moveSaved: (async (_b: string, _ids: readonly string[], to: string) => moves.push(to) > 0) as typeof MoveSaved });
    expect(boardChatMessages(B, S1)).toEqual([]);
    expect(boardChatMessages(B, S2).map((m) => m.text)).toEqual(["more please", "Here you go."]);
    expect(moves).toEqual([S2]);
  });

  it("the student moving during the run never takes the exchange; nor a screen change before the actions start", async () => {
    const b = board([S1, S3]);
    const moveSaved = vi.fn(async () => true);
    const controller = {
      ...b.controller,
      chatScreenId: b.controller.chatScreenId,
      chatScreenIndex: b.controller.chatScreenIndex,
      onChatScreenChange: b.controller.onChatScreenChange,
      runChatActions: async () => {
        // the student goes to screen 3 mid-writing: the board stops; the exchange stays on screen 1
        b.move(S3, false);
        return { ...REPORT, screensAdded: 0, outcomes: [{ type: "write_problems", ok: false, note: "I stopped because you moved to another screen." }] };
      },
    } as unknown as LiveController;
    const s = stream([
      (h) => {
        // a tutor-made screen heard before this ask wrote anything is not this ask's
        b.move(S2, true);
        h.onReply?.("Here are 5.");
      },
      (h) => h.onActions?.({ actions: FIVE, notes: [] }),
      (h) => h.onDone?.({ model: "m", ms: 1, turnId: "t", userTurnId: "u" }),
    ]);
    await sendAsk(B, "5 problems", { screen: { id: S1, index: 1 } }, { controller, speech: () => null, stream: s, moveSaved });
    expect(boardChatMessages(B, S1).map((m) => m.text)).toEqual(["5 problems", "Here are 5."]);
    expect(boardChatMessages(B, S2)).toEqual([]);
    expect(boardChatMessages(B, S3)).toEqual([]);
    expect(moveSaved).not.toHaveBeenCalled();
    // the ask is over: nobody listens for screens any more
    expect(b.listeners.size).toBe(0);
  });

  it("an exchange that was not saved (no turn ids) moves here only; nothing is asked of the server", async () => {
    const b = board([S1]);
    const moveSaved = vi.fn(async () => true);
    const controller = {
      ...b.controller,
      chatScreenId: b.controller.chatScreenId,
      chatScreenIndex: b.controller.chatScreenIndex,
      onChatScreenChange: b.controller.onChatScreenChange,
      runChatActions: async () => {
        b.move(S2, true);
        return { ...REPORT, screensAdded: 1 };
      },
    } as unknown as LiveController;
    const s = stream([(h) => h.onReply?.("Here."), (h) => h.onActions?.({ actions: FIVE, notes: [] }), (h) => h.onDone?.({ model: "m", ms: 1 })]);
    await sendAsk(B, "more", {}, { controller, speech: () => null, stream: s, moveSaved });
    expect(boardChatMessages(B, S2).map((m) => m.text)).toEqual(["more", "Here."]);
    expect(moveSaved).not.toHaveBeenCalled();
  });

  it("moveExchange: only the exchange moves, in order, after what the new screen holds, never doubled", () => {
    const from: ChatMessage[] = [
      { id: "1", role: "user", text: "hi" },
      { id: "2", role: "tutor", text: "Hi!", state: "done" },
      { id: "3", role: "user", text: "5 more" },
      { id: "4", role: "tutor", text: "Here.", state: "writing" },
    ];
    const to: ChatMessage[] = [{ id: "4", role: "tutor", text: "Here.", state: "writing" }];
    const moved = moveExchange(from, to, ["3", "4"]);
    expect(moved.from.map((m) => m.id)).toEqual(["1", "2"]);
    expect(moved.to.map((m) => m.id)).toEqual(["3", "4"]);
    expect(threadKey(B, S2)).toBe(`${B}#${S2}`);
    expect(threadKey(B, null)).toBe(B);
  });

  it("moveSavedTurns: POSTs the ids to the move route; a failure is a quiet warning for the admin page", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const ok = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return json({ moved: 2 });
    }) as unknown as Fetch;
    expect(await moveSavedTurns(B, ["u", "t", "u"], S2, ok)).toBe(true);
    expect(calls[0].url).toBe(ASK_MOVE_PATH);
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ boardId: B, turnIds: ["u", "t"], screenId: S2 });
    expect(reports).toEqual([]);

    expect(await moveSavedTurns(B, ["u"], S2, (async () => json({ error: "not_found" }, 404)) as unknown as Fetch)).toBe(false);
    expect(await moveSavedTurns(B, ["u"], S2, (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as Fetch)).toBe(false);
    expect(reports).toEqual([
      expect.objectContaining({ kind: "live.chat", code: "move_http_404", level: "warn", boardId: B }),
      expect.objectContaining({ kind: "live.chat", code: "move_network", level: "warn", boardId: B }),
    ]);
    // nothing to move: nothing asked
    expect(await moveSavedTurns(B, [], S2, ok)).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
