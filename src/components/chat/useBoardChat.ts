"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { authedFetch, errorTrace, isApiError } from "@/lib/api-client";
import type { UserErrorInput } from "@/lib/clientErrors";
import type { LiveController } from "@/lib/live/contracts";
import type { ChatRunReport } from "@/lib/live/chat/contracts";
import { ASK_HISTORY_PATH, AskHistoryResponseSchema, AskImageSchema, type AskHello, type AskHistoryResponse, type AskRequest } from "@/lib/live/ask/contracts";
import { AskStreamError, streamAsk } from "@/lib/live/ask/client";
import { learningBus } from "@/lib/learning/bus";
import {
  chatErrorFor,
  CHAT_COPY,
  historyFor,
  isAbort,
  messagesFromHistory,
  problemFor,
  runNotes,
  shownReply,
  WEAK_SPOTS_COPY,
  weakSpotPractice,
  weakSpotSkill,
  type ChatError,
  type ChatMessage,
  type PracticeSource,
  type WeakSpot,
} from "./chatView";
import type { AskSpeech } from "./voice/useAskSpeech";
import { reportUserError } from "@/lib/reportAppError";

/**
 * The board chat's state (Ask, docs/ASK-V2.md): each board's messages in a store of the module's
 * own, so closing the panel or moving between boards keeps them, and the saved chat
 * (`GET /api/live/ask/history`) fills it on the first open after a reload. One ask at a time per
 * board, streamed: the tutor's words paint as they come (one render a frame), then its board
 * actions run in its hand.
 */

/** the saved chat (at most 60 turns) and this session's on top */
const MAX_MESSAGES = 100;
const EMPTY: ChatMessage[] = [];
const histories = new Map<string, ChatMessage[]>();
/** each board's ask in flight: what Stop aborts (also from a panel opened again since) */
const inflight = new Map<string, AbortController>();
/** boards with an ask or a weak-spots run going (the panel's busy) */
const busyBoards = new Set<string>();
/** the saved chat's hello per board: undefined while it loads, null for none */
const hellos = new Map<string, AskHello | null>();
/** boards whose saved chat was read (or is being read) this session */
const historyRead = new Map<string, "loading" | "done">();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  listeners.forEach((l) => l());
}

function setHistory(boardId: string, next: ChatMessage[]): void {
  histories.set(boardId, next.slice(-MAX_MESSAGES));
  notify();
}

function patch(boardId: string, id: string, fn: (m: ChatMessage) => Partial<ChatMessage>): void {
  const cur = histories.get(boardId) ?? EMPTY;
  setHistory(
    boardId,
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

/**
 * The saved chat of a board, or null for none. Until the memory part's route is merged it answers
 * 404 (or the contract's 501): that is "no history", quietly. `retry` says whether a later open may
 * try again (a dropped connection, a 5xx) rather than never on this board this session.
 */
export async function fetchAskHistory(boardId: string, signal: AbortSignal, fetchImpl: typeof authedFetch = authedFetch): Promise<{ history: AskHistoryResponse | null; retry: boolean }> {
  let res: Response;
  try {
    res = await fetchImpl(`${ASK_HISTORY_PATH}?boardId=${encodeURIComponent(boardId)}`, { signal });
  } catch (err) {
    if (isAbort(err)) throw err;
    return { history: null, retry: true };
  }
  // 404 / 501: no saved chat (yet); a 5xx may be better on the next open; any other 4xx will not
  if (!res.ok) return { history: null, retry: res.status >= 500 && res.status !== 501 };
  const parsed = AskHistoryResponseSchema.safeParse(await res.json().catch(() => null));
  return { history: parsed.success ? parsed.data : null, retry: false };
}

/** What the chat needs of read-aloud (`useAskSpeech`): told as each reply streams. */
export type AskSpeechSink = Pick<AskSpeech, "start" | "feed" | "finish" | "stop">;

export interface SendOptions {
  /** said into the mic: the reply will be read aloud (shorter sentences, maths that reads well) */
  voice?: boolean;
}

export interface BoardChat {
  messages: ChatMessage[];
  /** a request is in flight or its actions are being written */
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
  /** the saved chat's hello (null: none); `loading` while the saved chat is being read */
  hello: { loading: boolean; hello: AskHello | null };
}

/**
 * This board's chat messages, read-only: the panel's own store, so the guided board's last coach
 * mark (`BoardTour`) can follow the student's first ask without a hook into the panel.
 */
export function useChatMessages(boardId: string): ChatMessage[] {
  return useSyncExternalStore(
    subscribe,
    () => histories.get(boardId) ?? EMPTY,
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

function useHello(boardId: string): AskHello | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => hellos.get(boardId),
    () => undefined,
  );
}

/**
 * Reads the board's saved chat once per session (the first open): its turns fill a store that is
 * still empty (an ask sent meanwhile wins), and its hello is kept for the empty panel.
 */
function useSavedChat(boardId: string): void {
  useEffect(() => {
    if (historyRead.has(boardId)) return;
    historyRead.set(boardId, "loading");
    const ctrl = new AbortController();
    fetchAskHistory(boardId, ctrl.signal)
      .then(({ history, retry }) => {
        if (ctrl.signal.aborted) return;
        if (retry) historyRead.delete(boardId);
        else historyRead.set(boardId, "done");
        if (history && history.turns.length > 0 && (histories.get(boardId) ?? EMPTY).length === 0) setHistory(boardId, messagesFromHistory(history.turns));
        hellos.set(boardId, history?.hello ?? null);
        notify();
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        historyRead.delete(boardId);
        hellos.set(boardId, null);
        notify();
      });
    return () => {
      // React's development double effects (and a panel closed at once): the next open reads it
      ctrl.abort();
      if (historyRead.get(boardId) === "loading") historyRead.delete(boardId);
    };
  }, [boardId]);
}

export function useBoardChat(boardId: string, controller: LiveController, speech?: AskSpeechSink): BoardChat {
  const messages = useChatMessages(boardId);
  const busy = useBusy(boardId);
  const hello = useHello(boardId);
  useSavedChat(boardId);

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

  const send = useCallback(
    async (text: string, opts: SendOptions & { prior?: ChatMessage[]; clientId?: string } = {}) => {
      const message = text.trim();
      if (!message || busyBoards.has(boardId)) return;
      setBusy(boardId, true);
      const ctrl = new AbortController();
      inflight.set(boardId, ctrl);
      const before = opts.prior ?? histories.get(boardId) ?? EMPTY;
      const tutorId = nextId();
      const clientId = opts.clientId ?? nextId();
      const voice = opts.voice === true;
      setHistory(boardId, [...before, { id: nextId(), role: "user", text: message, clientId, ...(voice ? { voice } : {}) }, { id: tutorId, role: "tutor", text: "", state: "thinking" }]);

      // the reply so far, painted once a frame
      let written = "";
      let started = false;
      let finished = false;
      const speak = {
        start() {
          if (started) return;
          started = true;
          speechRef.current?.start(tutorId);
        },
        finish(final: string) {
          if (finished) return;
          finished = true;
          speak.start();
          speechRef.current?.finish(tutorId, final);
        },
      };
      const painter = frameBatcher(() => patch(boardId, tutorId, (m) => ({ text: shownReply(written), state: m.state === "writing" ? "writing" : "streaming" })));
      // the board's writing, started on `actions` (a holder: the stream's handlers set it)
      const board: { run: Promise<ChatRunReport> | null } = { run: null };
      try {
        if (!controller.chatScreen || !controller.runChatActions) throw new BoardNotReadyError();
        const history = historyFor(before);
        // the problem typed earlier, when the turns sent no longer hold it ("do the actual problem")
        const problem = problemFor(before, history);
        // what the tutor knows about this student (their record), once the board has loaded it
        const learner = learningBus.learner();
        const screen = controller.chatScreen();
        // a picture of the screen for what the read maths cannot say (drawings, a photo, a PDF page)
        const image = screen.empty ? null : await settleWithin(controller.chatImage?.(), ASK_IMAGE_WAIT_MS);
        if (ctrl.signal.aborted) throw new DOMException("aborted", "AbortError");
        const picture = image && AskImageSchema.safeParse(image).success ? image : null;
        const req: AskRequest = {
          boardId,
          message,
          history,
          screen: picture ? { ...screen, image: picture } : screen,
          ...(problem ? { problem } : {}),
          ...(learner ? { learner } : {}),
          ...(voice ? { voice } : {}),
          clientId,
        };
        const runActions = controller.runChatActions;
        await streamAsk(
          req,
          {
            onDelta(delta) {
              speak.start();
              written += delta;
              speechRef.current?.feed(tutorId, delta);
              painter.schedule();
            },
            onReply(final) {
              // the reply as the route finally shows it (cleaned, capped): it replaces what streamed
              written = final;
              painter.flush();
              patch(boardId, tutorId, (m) => ({ text: shownReply(final), state: m.state === "writing" ? "writing" : "streaming" }));
              speak.finish(shownReply(final));
            },
            onActions(ev) {
              painter.flush();
              const writes = ev.actions.length > 0;
              patch(boardId, tutorId, () => ({ text: shownReply(written), notes: ev.notes, ...(writes ? { state: "writing" as const } : {}) }));
              // written as soon as the engine has passed them: the stream's end is not waited for
              if (writes) board.run = runActions(ev.actions);
            },
          },
          { signal: ctrl.signal },
        );
        painter.flush();
        const shown = shownReply(written).trim();
        if (shown) speak.finish(shown);
        if (board.run) {
          // the words now; "Writing on your board…" under them until the hand is done
          patch(boardId, tutorId, () => ({ text: shown }));
          const report = await board.run;
          patch(boardId, tutorId, (m) => ({ notes: [...new Set([...(m.notes ?? []), ...runNotes(report)])], state: "done", ...(shown ? {} : { text: CHAT_COPY.done }) }));
          for (const note of chatNoteReports(report, boardId)) reportUserError(note);
        } else {
          patch(boardId, tutorId, () => ({ text: shown || CHAT_COPY.empty, state: "done" }));
        }
      } catch (err) {
        painter.flush();
        if (isAbort(err)) {
          // Stop: what came stays, and it is part of the chat from here on
          speechRef.current?.stop();
          patch(boardId, tutorId, () => ({ state: "done", stopped: true, text: shownReply(written).trim() || CHAT_COPY.stopped }));
          return;
        }
        speechRef.current?.stop();
        const error = err instanceof BoardNotReadyError ? { kind: "other" as const, message: CHAT_COPY.errors.board, retry: true } : chatErrorFor(err);
        patch(boardId, tutorId, () => ({ state: "error", error, text: error.message, retryText: message }));
        reportUserError(chatFailureReport(error, err, boardId));
      } finally {
        if (inflight.get(boardId) === ctrl) inflight.delete(boardId);
        setBusy(boardId, false);
      }
    },
    [boardId, controller],
  );

  const stop = useCallback(() => {
    inflight.get(boardId)?.abort();
  }, [boardId]);

  /**
   * "Practice my weak spots": the problems are made here (`practice.ts`) and written by the chat's
   * executor, tagged `practice` for the learning record; the panel shows the chip's words and a
   * tutor reply as for any request, so the conversation (and "help me with 2") carries on from it.
   */
  const practiceWeakSpots = useCallback(
    async (prior?: ChatMessage[]) => {
      if (busyBoards.has(boardId)) return;
      setBusy(boardId, true);
      const before = prior ?? histories.get(boardId) ?? EMPTY;
      const tutorId = nextId();
      setHistory(boardId, [...before, { id: nextId(), role: "user", text: WEAK_SPOTS_COPY.chip }, { id: tutorId, role: "tutor", text: "", state: "thinking" }]);
      const failed = (message: string, code: string) => {
        patch(boardId, tutorId, () => ({ state: "error", error: { kind: "other", message, retry: true }, text: message, retryText: WEAK_SPOTS_COPY.chip, local: "weak_spots" }));
        reportUserError({ kind: "live.chat", code, message, boardId });
      };
      try {
        if (!controller.runChatActions) throw new BoardNotReadyError();
        const plan = weakSpotPractice(learningBus.learner(), await loadPractice(), randomSeed());
        if (!plan) {
          patch(boardId, tutorId, () => ({ text: WEAK_SPOTS_COPY.none, state: "done" }));
          return;
        }
        patch(boardId, tutorId, () => ({ text: WEAK_SPOTS_COPY.reply(plan.problems.length, plan.skill.name), state: "writing" }));
        const report = await controller.runChatActions([{ type: "write_problems", problems: plan.problems }], { origin: "practice" });
        if (report.problemsWritten === 0) {
          failed(WEAK_SPOTS_COPY.failed, "weak_spots_none_written");
          return;
        }
        // the count the board wrote (one the engine refused is left out, with a note)
        patch(boardId, tutorId, () => ({ text: WEAK_SPOTS_COPY.reply(report.problemsWritten, plan.skill.name), notes: runNotes(report), state: "done" }));
      } catch (err) {
        if (err instanceof BoardNotReadyError) failed(CHAT_COPY.errors.board, "board_not_ready");
        else failed(WEAK_SPOTS_COPY.failed, "weak_spots_failed");
      } finally {
        setBusy(boardId, false);
      }
    },
    [boardId, controller],
  );

  const retry = useCallback(
    (messageId: string) => {
      const cur = histories.get(boardId) ?? EMPTY;
      const i = cur.findIndex((m) => m.id === messageId);
      const failed = cur[i];
      if (!failed?.retryText) return;
      // the failed ask and its error go; the same words are sent again, with the same id (saved once)
      const asked = i > 0 && cur[i - 1].role === "user" ? cur[i - 1] : null;
      const start = asked ? i - 1 : i;
      const rest = [...cur.slice(0, start), ...cur.slice(i + 1)];
      // the chip ran on the device, and so does its retry (typed, the same words go to the model)
      if (failed.local === "weak_spots") void practiceWeakSpots(rest);
      else void send(failed.retryText, { prior: rest, voice: asked?.voice, clientId: asked?.clientId });
    },
    [boardId, send, practiceWeakSpots],
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
  };
}
