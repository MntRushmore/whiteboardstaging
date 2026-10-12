"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { authedFetch, errorTrace, isApiError } from "@/lib/api-client";
import type { UserErrorInput } from "@/lib/clientErrors";
import type { LiveController } from "@/lib/live/contracts";
import type { ChatRunReport } from "@/lib/live/chat/contracts";
import { ASK_HISTORY_PATH, ASK_MOVE_PATH, AskHistoryResponseSchema, AskImageSchema, type AskHello, type AskHistoryResponse, type AskRequest } from "@/lib/live/ask/contracts";
import { AskStreamError, streamAsk } from "@/lib/live/ask/client";
import { learningBus } from "@/lib/learning/bus";
import {
  chatErrorFor,
  CHAT_COPY,
  historyFor,
  isAbort,
  mergeSavedChat,
  messagesFromHistory,
  moveExchange,
  problemFor,
  retryOf,
  runNotes,
  shownReply,
  threadKey,
  WEAK_SPOTS_COPY,
  weakSpotPractice,
  weakSpotSkill,
  type ChatError,
  type ChatMessage,
  type ChatScreenRef,
  type PracticeSource,
  type WeakSpot,
} from "./chatView";
import type { AskSpeech } from "./voice/useAskSpeech";
import { reportUserError } from "@/lib/reportAppError";

/**
 * The board chat's state (Ask, docs/ASK-V2.md): a store of the module's own, so closing the panel
 * or moving between boards keeps the chat, and the saved chat (`GET /api/live/ask/history`) fills
 * it on the first view after a reload. One ask at a time per board, streamed: the tutor's words
 * paint as they come (one render a frame), then its board actions run in its hand.
 *
 * A chat per screen ("A chat per screen"). Each screen of a board (a tldraw page) has its own thread,
 * kept under `threadKey(boardId, screenId)`; the panel shows the thread of the screen the board is
 * on (`useChatScreen`, from `LiveController.chatScreenId` and `onChatScreenChange`), and reads its
 * saved chat the first time it is shown. An ask belongs to the screen it was sent from. When the
 * tutor's own actions start a new screen while an ask's actions run (more problems on a full
 * screen), the exchange moves into the new screen's thread with them, here at once and on the
 * server after (`POST ASK_MOVE_PATH` with its saved turns). A board whose controller does not say
 * which screen it is on keeps one thread for the board (`threadKey(boardId, null)`), as before.
 */

/** the saved chat (at most 60 turns) and this session's on top */
const MAX_MESSAGES = 100;
const EMPTY: ChatMessage[] = [];
const NO_SCREEN: ChatScreenRef = { id: null, index: null };
/** each thread's messages (`threadKey`) */
const histories = new Map<string, ChatMessage[]>();
/** each board's ask in flight: what Stop aborts (also from a panel opened again since) */
const inflight = new Map<string, AbortController>();
/** boards with an ask or a weak-spots run going (the panel's busy): one at a time per board, whichever screen */
const busyBoards = new Set<string>();
/** each thread's saved hello: undefined while it loads, null for none */
const hellos = new Map<string, AskHello | null>();
/** threads whose saved chat was read (or is being read) this session */
const historyRead = new Map<string, "loading" | "done">();
/** the screen each board is on, as its controller last said (`useChatScreen`) */
const screens = new Map<string, ChatScreenRef>();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  listeners.forEach((l) => l());
}

function setHistory(key: string, next: ChatMessage[]): void {
  histories.set(key, next.slice(-MAX_MESSAGES));
  notify();
}

function patch(key: string, id: string, fn: (m: ChatMessage) => Partial<ChatMessage>): void {
  const cur = histories.get(key) ?? EMPTY;
  setHistory(
    key,
    cur.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)),
  );
}

function setBusy(boardId: string, busy: boolean): void {
  if (busy) busyBoards.add(boardId);
  else busyBoards.delete(boardId);
  notify();
}

let seq = 0;
/** An id for a message, and a user message's `clientId` (AskRequestSchema: `[A-Za-z0-9_-]{1,64}`). */
const nextId = () => `cm_${Date.now().toString(36)}_${++seq}`;

class BoardNotReadyError extends Error {}

/** How long the screen's picture may hold an ask up (`LiveController.chatImage`): after this it goes without one. */
export const ASK_IMAGE_WAIT_MS = 1200;

/** `promise`'s value, or null once `ms` have passed or it fails: the picture never holds an ask up. */
export function settleWithin<T>(promise: Promise<T | null> | undefined, ms: number): Promise<T | null> {
  if (!promise) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v ?? null);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** One paint a frame: the stream's words land in the store at most once per animation frame. */
function frameBatcher(paint: () => void): { schedule: () => void; flush: () => void } {
  let pending: number | ReturnType<typeof setTimeout> | null = null;
  const raf = typeof requestAnimationFrame === "function";
  const run = () => {
    pending = null;
    paint();
  };
  return {
    schedule() {
      if (pending !== null) return;
      pending = raf ? requestAnimationFrame(run) : setTimeout(run, 16);
    },
    flush() {
      if (pending !== null) {
        if (raf) cancelAnimationFrame(pending as number);
        else clearTimeout(pending as ReturnType<typeof setTimeout>);
        pending = null;
      }
    },
  };
}

/**
 * A failed ask as the admin page hears of it (`live.chat`): the panel's own words and a code — the
 * chat error's kind, or for the rest the API's error code (a 5xx is `upstream`), the stream's
 * `error` event code, `board_not_ready` before the board is up. Never what the student asked.
 */
export function chatFailureReport(error: ChatError, err: unknown, boardId?: string): UserErrorInput {
  let code: string = error.kind;
  if (err instanceof BoardNotReadyError) code = "board_not_ready";
  else if (error.kind === "other") {
    if (isApiError(err)) code = err.status >= 500 ? "upstream" : err.code || `http_${err.status}`;
    else if (err instanceof AskStreamError) code = /^[a-z0-9_]{1,40}$/.test(err.event.code) ? `stream_${err.event.code}` : "stream_error";
    else code = "unknown";
  }
  return { kind: "live.chat", code, message: error.message, ...(boardId ? { boardId } : {}), ...errorTrace(err) };
}

/**
 * The tutor's notes on a run that say something it promised could not be done ("I couldn't graph
 * that.", "2 of 5 problems couldn't be checked…"), as warnings for the admin page (`live.chat`,
 * `note_<action>`, and why when the board said: `note_write_problems_unsolved`). Not the notes about the board or the student ("There's no room left", "I'm
 * still writing on problem 2"): those are not failures.
 */
export function chatNoteReports(report: ChatRunReport | null, boardId?: string): UserErrorInput[] {
  if (!report) return [];
  return report.outcomes
    .filter((o): o is typeof o & { note: string } => typeof o.note === "string" && /\bcouldn't\b/i.test(o.note))
    .map((o) => ({ kind: "live.chat" as const, code: `note_${o.type}${o.why ? `_${o.why}` : ""}`, message: o.note, level: "warn" as const, ...(boardId ? { boardId } : {}) }));
}

/** The practice problems' generators: loaded the first time the chip may show, never with the board. */
function loadPractice(): Promise<PracticeSource> {
  return import("@/lib/learning/practiceSet");
}

const randomSeed = () => Math.floor(Math.random() * 0x7fffffff);

// ------------------------------------------------------------------ the screen the board is on

/** The screen the controller says the board is on (none: it does not say, or is not up). Never throws. */
export function screenOf(controller: LiveController | null | undefined): ChatScreenRef {
  try {
    const id = controller?.chatScreenId?.() ?? null;
    if (!id) return NO_SCREEN;
    const index = controller?.chatScreenIndex?.() ?? null;
    return { id, index: typeof index === "number" && index >= 1 ? index : null };
  } catch {
    return NO_SCREEN;
  }
}

/** Keeps the board's screen (a new object only when it changed, so the store's snapshot stays put). */
function setScreen(boardId: string, next: ChatScreenRef, tell = true): boolean {
  const cur = screens.get(boardId);
  if (cur && cur.id === next.id && cur.index === next.index) return false;
  screens.set(boardId, next);
  if (tell) notify();
  return true;
}

/** The screen a board is on, as the chat last heard (outside React: tests). */
export function boardChatScreen(boardId: string): ChatScreenRef {
  return screens.get(boardId) ?? NO_SCREEN;
}

// ------------------------------------------------------------------ the saved chat

/** Which screen's saved chat to read: its id, and whether it is the board's first (its turns saved without a screen are). */
export interface HistoryScreen {
  id: string;
  first: boolean;
}

/** The history route's query for a screen (none: the whole board's chat, as an older board reads it). */
export function historyScreenOf(screen: ChatScreenRef | null | undefined): HistoryScreen | null {
  return screen?.id ? { id: screen.id, first: (screen.index ?? 1) === 1 } : null;
}

/**
 * The saved chat of a board's screen (`GET /api/live/ask/history`), or null for none. A board that is
 * not the student's (404) has none, quietly. `retry` says whether a later view may try again (a
 * dropped connection, the route's 502, being rate limited) rather than never on this screen this
 * session. Without a screen: the whole board's chat.
 */
export async function fetchAskHistory(
  boardId: string,
  signal: AbortSignal,
  fetchImpl: typeof authedFetch = authedFetch,
  screen: HistoryScreen | null = null,
): Promise<{ history: AskHistoryResponse | null; retry: boolean }> {
  const at = screen ? `&screenId=${encodeURIComponent(screen.id)}&first=${screen.first ? 1 : 0}` : "";
  let res: Response;
  try {
    res = await fetchImpl(`${ASK_HISTORY_PATH}?boardId=${encodeURIComponent(boardId)}${at}`, { signal });
  } catch (err) {
    if (isAbort(err)) throw err;
    return { history: null, retry: true };
  }
  if (!res.ok) return { history: null, retry: res.status >= 500 || res.status === 429 };
  const parsed = AskHistoryResponseSchema.safeParse(await res.json().catch(() => null));
  return { history: parsed.success ? parsed.data : null, retry: false };
}

/**
 * Moves saved turns into another screen's chat on the server (`POST ASK_MOVE_PATH`): the tutor's own
 * actions started that screen during the ask. True when the route took it. A failure is a warning
 * for the admin page, never the student's problem: the exchange is already in the new screen's chat
 * here, and after a reload it shows on the screen it was asked from.
 */
export async function moveSavedTurns(boardId: string, turnIds: readonly string[], screenId: string, fetchImpl: typeof authedFetch = authedFetch): Promise<boolean> {
  const ids = [...new Set(turnIds.filter(Boolean))].slice(0, 4);
  if (ids.length === 0) return false;
  let ok = false;
  let code = "move_failed";
  try {
    const res = await fetchImpl(ASK_MOVE_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boardId, turnIds: ids, screenId }) });
    ok = res.ok;
    if (!ok) code = `move_http_${res.status}`;
  } catch {
    code = "move_network";
  }
  if (!ok) reportUserError({ kind: "live.chat", code, message: "The chat could not follow the tutor to the new screen.", level: "warn", boardId });
  return ok;
}

/** What the chat needs of read-aloud (`useAskSpeech`): told as each reply streams. */
export type AskSpeechSink = Pick<AskSpeech, "start" | "feed" | "finish" | "stop">;

export interface SendOptions {
  /** said into the mic: the reply will be read aloud (shorter sentences, maths that reads well) */
  voice?: boolean;
}

export interface BoardChat {
  /** the current screen's thread */
  messages: ChatMessage[];
  /** a request is in flight or its actions are being written (on any screen of the board) */
  busy: boolean;
  send: (text: string, opts?: SendOptions) => Promise<void>;
  /** Stop: ends the reply being written (what came stays); the board's writing, once started, finishes */
  stop: () => void;
  /** sends a failed request again (its user message and the error are replaced) */
  retry: (messageId: string) => void;
  /** "Practice my weak spots": the skill a tap would practice, once known; null shows no chip */
  weakSpot: WeakSpot | null;
  /** the chip, tapped: problems on that skill, made and written on the device (no model, no ink) */
  practiceWeakSpots: () => Promise<void>;
  /** the screen's saved hello (null: none); `loading` while its saved chat is being read */
  hello: { loading: boolean; hello: AskHello | null };
  /** the screen whose chat this is (the header's "Screen 2"); no id: one chat for the board */
  screen: ChatScreenRef;
}

/** What one ask needs besides its words: the board, read-aloud as it is now, and (tests) the stream and the move. */
export interface AskDeps {
  controller: LiveController;
  /** read-aloud as it is at each word (null once the panel is closed: a closed panel speaks no more) */
  speech: () => AskSpeechSink | null;
  /** tests: the stream (default `streamAsk`) */
  stream?: typeof streamAsk;
  /** tests: the server's move of the saved turns (default `moveSavedTurns`) */
  moveSaved?: typeof moveSavedTurns;
}

/**
 * The send's own options: a retry's place in the chat and its user message's id (saved once), and
 * the screen it is sent from (default: the one the controller says the board is on).
 */
export type AskSendOptions = SendOptions & { prior?: ChatMessage[]; clientId?: string; screen?: ChatScreenRef };

/**
 * While an exchange's board actions run, a screen the tutor's own actions start takes the exchange
 * with it: its messages leave the thread they were in for the new screen's (`where.key` follows
 * them, so the rest of the ask lands there). `writing`: the actions have started (a screen the
 * student moves to, or one started before, never takes it).
 */
function followTutorScreens(boardId: string, controller: LiveController, where: { key: string }, ids: readonly string[], writing: () => boolean): { moved: () => string | null; moveTo: (screenId: string) => void; stop: () => void } {
  let movedTo: string | null = null;
  const moveTo = (screenId: string) => {
    const to = threadKey(boardId, screenId);
    if (to === where.key) return;
    const moved = moveExchange(histories.get(where.key) ?? EMPTY, histories.get(to) ?? EMPTY, ids);
    histories.set(where.key, moved.from);
    histories.set(to, moved.to.slice(-MAX_MESSAGES));
    where.key = to;
    movedTo = screenId;
    notify();
  };
  let off: (() => void) | undefined;
  try {
    off = controller.onChatScreenChange?.((screenId, how) => {
      if (how?.tutor && writing()) moveTo(screenId);
    });
  } catch {
    off = undefined;
  }
  return { moved: () => movedTo, moveTo, stop: () => off?.() };
}

/**
 * After an exchange's board actions: the tutor started a new screen (`screensAdded`) that was not
 * heard as it happened (a controller that does not tell): the exchange goes to the screen the board
 * is on now. The student moving elsewhere is never a reason: the board stops writing then.
 */
function followAfterRun(follow: ReturnType<typeof followTutorScreens>, report: ChatRunReport | null, controller: LiveController): void {
  if (follow.moved() || !report || report.screensAdded <= 0) return;
  const now = screenOf(controller).id;
  if (now) follow.moveTo(now);
}

/**
 * One ask on a board, start to end (the panel's send; exported for the tests): the kid's words and a
 * thinking tutor go in the thread of the screen it is sent from, read-aloud starts a new reply, the
 * screen (and its picture, when there is work on it and it comes in time) goes with that screen's
 * chat so far, the words paint as they stream (`reply` replaces them), the checked board actions
 * are written in the tutor's hand, and a failure is one calm line with Try again (reported as
 * `live.chat`). One at a time per board. A screen the tutor's actions start takes the exchange with
 * it (`followTutorScreens`), and its saved turns follow on the server (`moveSavedTurns`).
 */
export async function sendAsk(boardId: string, text: string, opts: AskSendOptions, deps: AskDeps): Promise<void> {
  const message = text.trim();
  if (!message || busyBoards.has(boardId)) return;
  setBusy(boardId, true);
  const ctrl = new AbortController();
  inflight.set(boardId, ctrl);
  const screen = opts.screen ?? screenOf(deps.controller);
  const from = threadKey(boardId, screen.id);
  // the thread the exchange is in: it moves with a screen the tutor's actions start
  const where = { key: from };
  const before = opts.prior ?? histories.get(from) ?? EMPTY;
  const userId = nextId();
  const tutorId = nextId();
  const clientId = opts.clientId ?? nextId();
  const voice = opts.voice === true;
  setHistory(from, [...before, { id: userId, role: "user", text: message, clientId, ...(voice ? { voice } : {}) }, { id: tutorId, role: "tutor", text: "", state: "thinking" }]);
  // a new reply: whatever is still being read aloud stops
  deps.speech()?.start(tutorId);

  // the reply so far, painted once a frame
  let written = "";
  let finished = false;
  /** the reply is final: read-aloud says what it has not said yet (once) */
  const finishSpeech = (final: string) => {
    if (finished || !final) return;
    finished = true;
    deps.speech()?.finish(tutorId, final);
  };
  // the saved turns' ids (`done`; none when saving failed: the chat goes on, unsaved)
  let turnId: string | undefined;
  let userTurnId: string | undefined;
  const painter = frameBatcher(() => patch(where.key, tutorId, (m) => ({ text: shownReply(written), state: m.state === "writing" ? "writing" : "streaming" })));
  // the board's writing, started on `actions` (a holder: the stream's handlers set it)
  const board: { run: Promise<ChatRunReport> | null } = { run: null };
  // the board's actions have started (set before they run: a screen can start at their first step)
  let acting = false;
  const follow = followTutorScreens(boardId, deps.controller, where, [userId, tutorId], () => acting);
  // the stream reached its end (`done`): a failure after it is the board's, not the connection's
  let streamEnded = false;
  /** the exchange went with a screen the tutor started: its saved turns follow (once both are known) */
  const moveSaved = () => {
    const to = follow.moved();
    if (to && turnId && userTurnId) void (deps.moveSaved ?? moveSavedTurns)(boardId, [userTurnId, turnId], to);
  };
  try {
    const { controller } = deps;
    if (!controller.chatScreen || !controller.runChatActions) throw new BoardNotReadyError();
    const shot = controller.chatScreen();
    // A picture of the screen for what the read maths cannot say (drawings, a photo, a PDF page),
    // and the screen's saved chat when it is still being read (an ask typed as the panel opens):
    // each a moment at most, side by side, never holding the ask up for long.
    const [image] = await Promise.all([
      shot.empty ? null : settleWithin(controller.chatImage?.(), ASK_IMAGE_WAIT_MS),
      settleWithin(historyLoads.get(from)?.then(() => true), ASK_HISTORY_WAIT_MS),
    ]);
    if (ctrl.signal.aborted) throw new DOMException("aborted", "AbortError");
    const picture = image && AskImageSchema.safeParse(image).success ? image : null;
    // the chat so far: everything before this ask in this screen's thread (the saved chat may have
    // come first). Another screen's chat is never sent: one screen, one context.
    const now = histories.get(from) ?? EMPTY;
    const at = now.findIndex((m) => m.role === "user" && m.clientId === clientId);
    const context = at >= 0 ? now.slice(0, at) : before;
    const history = historyFor(context);
    // the problem typed earlier, when the turns sent no longer hold it ("do the actual problem")
    const problem = problemFor(context, history);
    // what the tutor knows about this student (their record), once the board has loaded it
    const learner = learningBus.learner();
    const req: AskRequest = {
      boardId,
      message,
      history,
      screen: picture ? { ...shot, image: picture } : shot,
      ...(problem ? { problem } : {}),
      ...(learner ? { learner } : {}),
      ...(voice ? { voice } : {}),
      clientId,
      ...(screen.id ? { screenId: screen.id } : {}),
    };
    const runActions = controller.runChatActions;
    await (deps.stream ?? streamAsk)(
      req,
      {
        onDelta(delta) {
          written += delta;
          // the whole reply so far (never the board block): sentences are read as they complete
          deps.speech()?.feed(tutorId, shownReply(written));
          painter.schedule();
        },
        onReply(final) {
          // the reply as the route finally shows it (cleaned, capped): it replaces what streamed
          written = final;
          painter.flush();
          patch(where.key, tutorId, (m) => ({ text: shownReply(final), state: m.state === "writing" ? "writing" : "streaming" }));
          finishSpeech(shownReply(final).trim());
        },
        onActions(ev) {
          painter.flush();
          const writes = ev.actions.length > 0;
          patch(where.key, tutorId, () => ({ text: shownReply(written), notes: ev.notes, ...(writes ? { state: "writing" as const } : {}) }));
          // written as soon as the engine has passed them: the stream's end is not waited for
          if (writes) {
            acting = true;
            board.run = runActions(ev.actions);
          }
        },
        onDone(ev) {
          turnId = ev.turnId;
          userTurnId = ev.userTurnId;
        },
      },
      { signal: ctrl.signal },
    );
    streamEnded = true;
    painter.flush();
    const shown = shownReply(written).trim();
    finishSpeech(shown);
    const saved = turnId ? { turnId } : {};
    if (board.run) {
      // the words now; "Writing on your board…" under them until the hand is done
      patch(where.key, tutorId, () => ({ text: shown, ...saved }));
      const report = await board.run;
      followAfterRun(follow, report, controller);
      patch(where.key, tutorId, (m) => ({ notes: [...new Set([...(m.notes ?? []), ...runNotes(report)])], state: "done", ...(shown ? {} : { text: CHAT_COPY.done }) }));
      for (const note of chatNoteReports(report, boardId)) reportUserError(note);
      moveSaved();
    } else {
      patch(where.key, tutorId, () => ({ text: shown || CHAT_COPY.empty, state: "done", ...saved }));
    }
  } catch (err) {
    painter.flush();
    if (board.run) {
      // The board was already writing when the stream ended early (a dropped connection after
      // `actions`, before `done`): the words stay, the writing finishes, and the ask is done with a
      // short note. Never Try again: it would write the problems a second time (and cost again).
      const shown = shownReply(written).trim();
      finishSpeech(shown);
      patch(where.key, tutorId, () => ({ text: shown }));
      const report = await board.run.catch(() => null);
      followAfterRun(follow, report, deps.controller);
      const cut = isAbort(err) || streamEnded ? [] : [CHAT_COPY.cutOff];
      patch(where.key, tutorId, (m) => ({ notes: [...new Set([...(m.notes ?? []), ...runNotes(report), ...cut])], state: "done", ...(shown ? {} : { text: CHAT_COPY.done }) }));
      for (const note of chatNoteReports(report, boardId)) reportUserError(note);
      if (!isAbort(err)) reportUserError({ ...chatFailureReport(chatErrorFor(err), err, boardId), level: "warn" });
      moveSaved();
      return;
    }
    if (isAbort(err)) {
      // Stop: what came stays, and it is part of the chat from here on
      deps.speech()?.stop();
      patch(where.key, tutorId, () => ({ state: "done", stopped: true, text: shownReply(written).trim() || CHAT_COPY.stopped }));
      return;
    }
    deps.speech()?.stop();
    const error = err instanceof BoardNotReadyError ? { kind: "other" as const, message: CHAT_COPY.errors.board, retry: true } : chatErrorFor(err);
    patch(where.key, tutorId, () => ({ state: "error", error, text: error.message, retryText: message }));
    reportUserError(chatFailureReport(error, err, boardId));
  } finally {
    follow.stop();
    if (inflight.get(boardId) === ctrl) inflight.delete(boardId);
    setBusy(boardId, false);
  }
}

/** Stop: ends the board's ask in flight (what came stays). */
export function stopAsk(boardId: string): void {
  inflight.get(boardId)?.abort();
}

/** A thread's messages, outside React (tests): the board's one thread, or a screen's. */
export function boardChatMessages(boardId: string, screenId: string | null = null): ChatMessage[] {
  return histories.get(threadKey(boardId, screenId)) ?? EMPTY;
}

/** Forget every board's chat in this tab (tests). */
export function resetBoardChats(): void {
  for (const c of inflight.values()) c.abort();
  histories.clear();
  historyLoads.clear();
  inflight.clear();
  busyBoards.clear();
  hellos.clear();
  historyRead.clear();
  screens.clear();
  notify();
}

/**
 * The screen the board is on, as the chat follows it: read from the controller on the first render
 * (it may have moved while nothing listened) and kept fresh by its screen changes. The panel's, and
 * the guided board's (`BoardTour`), so `useChatMessages(boardId)` follows the screen.
 */
export function useChatScreen(boardId: string, controller: LiveController | null | undefined): ChatScreenRef {
  // the first render already shows the right screen's thread (never the board's, then the screen's)
  useState(() => {
    if (controller?.chatScreenId && setScreen(boardId, screenOf(controller), false)) queueMicrotask(notify);
    return null;
  });
  useEffect(() => followChatScreen(boardId, controller), [boardId, controller]);
  return useSyncExternalStore(
    subscribe,
    () => screens.get(boardId) ?? NO_SCREEN,
    () => NO_SCREEN,
  );
}

/**
 * Keeps the store's screen for a board in step with its controller (`useChatScreen`'s effect):
 * read now, then on every move the controller tells of. Answers the unsubscribe. A controller that
 * does not say which screen it is on leaves the board's one thread.
 */
export function followChatScreen(boardId: string, controller: LiveController | null | undefined): () => void {
  if (!controller?.chatScreenId) return () => {};
  setScreen(boardId, screenOf(controller));
  let off: (() => void) | undefined;
  try {
    // the index is the controller's (its pages' order), read as the move is heard
    off = controller.onChatScreenChange?.((id) => setScreen(boardId, { id, index: screenOf(controller).index }));
  } catch {
    off = undefined;
  }
  return () => off?.();
}

/**
 * The messages of a board's thread, outside React: a screen's, or without `screenId` the one of the
 * screen the board is on (as the chat last heard: `followChatScreen`); null is the board's one thread.
 */
export function chatMessagesFor(boardId: string, screenId?: string | null): ChatMessage[] {
  return histories.get(threadKey(boardId, screenId === undefined ? (screens.get(boardId)?.id ?? null) : screenId)) ?? EMPTY;
}

/**
 * A board's chat messages, read-only: the panel's own store, so the guided board's last coach mark
 * (`BoardTour`) can follow the student's first ask without a hook into the panel. Without a
 * `screenId` it follows the screen the board is on (`useChatScreen`); null is the board's one thread.
 */
export function useChatMessages(boardId: string, screenId?: string | null): ChatMessage[] {
  return useSyncExternalStore(
    subscribe,
    () => chatMessagesFor(boardId, screenId),
    () => EMPTY,
  );
}

function useBusy(boardId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => busyBoards.has(boardId),
    () => false,
  );
}

function useHello(key: string): AskHello | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => hellos.get(key),
    () => undefined,
  );
}

/** Each thread's saved chat being read (what an ask sent meanwhile waits for, a moment at most). */
const historyLoads = new Map<string, Promise<void>>();

/** How long an ask waits for the saved chat still being read: after this it goes without it. */
export const ASK_HISTORY_WAIT_MS = 1500;

/**
 * Reads a screen's saved chat once per session (the first view; again on a later view after a
 * failure worth retrying). Its turns go BEFORE anything asked in this tab meanwhile (a kid who types
 * at once, the topic picker's kickoff, an exchange that came along with a screen the tutor
 * started), so the chat reads in order and the next ask carries it; its hello is kept for the empty
 * panel. Never aborted: the store outlives the panel. Without a screen: the board's one thread.
 */
export function loadSavedChat(boardId: string, fetchImpl: typeof authedFetch = authedFetch, screen: ChatScreenRef | null = null): Promise<void> {
  const key = threadKey(boardId, screen?.id ?? null);
  const pending = historyLoads.get(key);
  if (pending) return pending;
  if (historyRead.get(key) === "done") return Promise.resolve();
  historyRead.set(key, "loading");
  const load = fetchAskHistory(boardId, new AbortController().signal, fetchImpl, historyScreenOf(screen))
    .then(({ history, retry }) => {
      if (retry) historyRead.delete(key);
      else historyRead.set(key, "done");
      const cur = histories.get(key) ?? EMPTY;
      // before what was asked in this tab meanwhile, never an exchange twice (a retried read holds this tab's)
      if (history && history.turns.length > 0 && !cur.some((m) => m.saved)) setHistory(key, mergeSavedChat(messagesFromHistory(history.turns), cur));
      hellos.set(key, history?.hello ?? null);
    })
    .catch(() => {
      historyRead.delete(key);
      hellos.set(key, null);
    })
    .finally(() => {
      historyLoads.delete(key);
      notify();
    });
  historyLoads.set(key, load);
  return load;
}

function useSavedChat(boardId: string, screen: ChatScreenRef): void {
  const { id, index } = screen;
  useEffect(() => {
    void loadSavedChat(boardId, authedFetch, { id, index });
  }, [boardId, id, index]);
}

export function useBoardChat(boardId: string, controller: LiveController, speech?: AskSpeechSink): BoardChat {
  const screen = useChatScreen(boardId, controller);
  const key = threadKey(boardId, screen.id);
  const messages = useChatMessages(boardId, screen.id);
  const busy = useBusy(boardId);
  const hello = useHello(key);
  useSavedChat(boardId, screen);

  // read-aloud as it is now (a closed panel's stream speaks no more)
  const speechRef = useRef<AskSpeechSink | null>(speech ?? null);
  useEffect(() => {
    speechRef.current = speech ?? null;
  });
  useEffect(
    () => () => {
      speechRef.current?.stop();
      speechRef.current = null;
    },
    [],
  );

  // an ask belongs to the screen it is sent from: the one whose chat the student is looking at
  const send = useCallback(
    (text: string, opts: AskSendOptions = {}) => sendAsk(boardId, text, { screen, ...opts }, { controller, speech: () => speechRef.current }),
    [boardId, controller, screen],
  );

  const stop = useCallback(() => stopAsk(boardId), [boardId]);

  /**
   * "Practice my weak spots": the problems are made here (`practice.ts`) and written by the chat's
   * executor, tagged `practice` for the learning record; the panel shows the chip's words and a
   * tutor reply as for any request, so the conversation (and "help me with 2") carries on from it.
   * Made on the device and never saved: a screen the board starts for them takes them along here only.
   */
  const practiceWeakSpots = useCallback(
    async (prior?: ChatMessage[]) => {
      if (busyBoards.has(boardId)) return;
      setBusy(boardId, true);
      const where = { key: threadKey(boardId, screen.id) };
      const before = prior ?? histories.get(where.key) ?? EMPTY;
      const userId = nextId();
      const tutorId = nextId();
      setHistory(where.key, [...before, { id: userId, role: "user", text: WEAK_SPOTS_COPY.chip }, { id: tutorId, role: "tutor", text: "", state: "thinking" }]);
      let writing = false;
      const follow = followTutorScreens(boardId, controller, where, [userId, tutorId], () => writing);
      const failed = (message: string, code: string) => {
        patch(where.key, tutorId, () => ({ state: "error", error: { kind: "other", message, retry: true }, text: message, retryText: WEAK_SPOTS_COPY.chip, local: "weak_spots" }));
        reportUserError({ kind: "live.chat", code, message, boardId });
      };
      try {
        if (!controller.runChatActions) throw new BoardNotReadyError();
        const plan = weakSpotPractice(learningBus.learner(), await loadPractice(), randomSeed());
        if (!plan) {
          patch(where.key, tutorId, () => ({ text: WEAK_SPOTS_COPY.none, state: "done" }));
          return;
        }
        patch(where.key, tutorId, () => ({ text: WEAK_SPOTS_COPY.reply(plan.problems.length, plan.skill.name), state: "writing" }));
        writing = true;
        const report = await controller.runChatActions([{ type: "write_problems", problems: plan.problems }], { origin: "practice" });
        followAfterRun(follow, report, controller);
        if (report.problemsWritten === 0) {
          failed(WEAK_SPOTS_COPY.failed, "weak_spots_none_written");
          return;
        }
        // the count the board wrote (one the engine refused is left out, with a note)
        patch(where.key, tutorId, () => ({ text: WEAK_SPOTS_COPY.reply(report.problemsWritten, plan.skill.name), notes: runNotes(report), state: "done" }));
      } catch (err) {
        if (err instanceof BoardNotReadyError) failed(CHAT_COPY.errors.board, "board_not_ready");
        else failed(WEAK_SPOTS_COPY.failed, "weak_spots_failed");
      } finally {
        follow.stop();
        setBusy(boardId, false);
      }
    },
    [boardId, controller, screen.id],
  );

  const retry = useCallback(
    (messageId: string) => {
      // the failed ask and its error go; the same words are sent again, with the same id (saved once)
      const again = retryOf(histories.get(key) ?? EMPTY, messageId);
      if (!again) return;
      // the chip ran on the device, and so does its retry (typed, the same words go to the model)
      if (again.local) void practiceWeakSpots(again.prior);
      else void send(again.text, { prior: again.prior, voice: again.voice, clientId: again.clientId });
    },
    [key, send, practiceWeakSpots],
  );

  // The chip shows among the first suggestions once the student's record names a skill with
  // practice problems: the generators load then (the chip waits for them), not with the board.
  // The record loads after the board, so a panel already open picks it up when it arrives.
  const [weakSpot, setWeakSpot] = useState<WeakSpot | null>(null);
  const [learner, setLearner] = useState(() => learningBus.learner());
  useEffect(() => learningBus.onLearner(setLearner), []);
  const fresh = messages.length === 0;
  useEffect(() => {
    if (!fresh || !learner?.weakSkills.length) return;
    let live = true;
    loadPractice()
      .then((practice) => {
        if (live) setWeakSpot(weakSpotSkill(learner, practice.hasPractice));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fresh, learner]);

  return {
    messages,
    busy,
    send: (text: string, opts?: SendOptions) => send(text, { voice: opts?.voice }),
    stop,
    retry,
    // only while the hint still names it: a skill mastered since, or another student, drops the chip
    weakSpot: fresh && weakSpot && learner?.weakSkills.some((s) => s.id === weakSpot.id) ? weakSpot : null,
    practiceWeakSpots: () => practiceWeakSpots(),
    hello: { loading: hello === undefined, hello: hello ?? null },
    screen,
  };
}
