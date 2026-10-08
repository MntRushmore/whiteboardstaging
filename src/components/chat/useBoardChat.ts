"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { errorTrace, isApiError } from "@/lib/api-client";
import type { UserErrorInput } from "@/lib/clientErrors";
import type { LiveController } from "@/lib/live/contracts";
import type { ChatRunReport } from "@/lib/live/chat/contracts";
import { requestChat } from "@/lib/live/chat/client";
import { learningBus } from "@/lib/learning/bus";
import {
  chatErrorFor,
  CHAT_COPY,
  historyFor,
  problemFor,
  runNotes,
  WEAK_SPOTS_COPY,
  weakSpotPractice,
  weakSpotSkill,
  type ChatError,
  type ChatMessage,
  type PracticeSource,
  type WeakSpot,
} from "./chatView";
import { reportUserError } from "@/lib/reportAppError";

/**
 * The board chat's state: the messages of each board, kept in memory for the session (closing the
 * panel or moving between boards keeps them; a reload starts afresh), and one request at a time —
 * sent with the chat so far and the current screen, then its actions run on the board.
 */

const MAX_MESSAGES = 40;
const EMPTY: ChatMessage[] = [];
const histories = new Map<string, ChatMessage[]>();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setHistory(boardId: string, next: ChatMessage[]): void {
  histories.set(boardId, next.slice(-MAX_MESSAGES));
  listeners.forEach((l) => l());
}

function patch(boardId: string, id: string, fn: (m: ChatMessage) => Partial<ChatMessage>): void {
  const cur = histories.get(boardId) ?? EMPTY;
  setHistory(
    boardId,
    cur.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)),
  );
}

let seq = 0;
const nextId = () => `cm_${Date.now().toString(36)}_${++seq}`;

class BoardNotReadyError extends Error {}

/**
 * A failed ask as the admin page hears of it (`live.chat`): the panel's own words and a code — the
 * chat error's kind, or for the rest the API's error code (a 5xx is `upstream`), `board_not_ready`
 * before the board is up. Never what the student asked.
 */
export function chatFailureReport(error: ChatError, err: unknown, boardId?: string): UserErrorInput {
  let code: string = error.kind;
  if (err instanceof BoardNotReadyError) code = "board_not_ready";
  else if (error.kind === "other") code = isApiError(err) ? (err.status >= 500 ? "upstream" : err.code || `http_${err.status}`) : "unknown";
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

export interface BoardChat {
  messages: ChatMessage[];
  /** a request is in flight or its actions are being written */
  busy: boolean;
  send: (text: string) => Promise<void>;
  /** sends a failed request again (its user message and the error are replaced) */
  retry: (messageId: string) => void;
  /** "Practice my weak spots": the skill a tap would practise, once known; null shows no chip */
  weakSpot: WeakSpot | null;
  /** the chip, tapped: problems on that skill, made and written on the device (no model, no ink) */
  practiceWeakSpots: () => Promise<void>;
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

export function useBoardChat(boardId: string, controller: LiveController): BoardChat {
  const messages = useChatMessages(boardId);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const send = useCallback(
    async (text: string, prior?: ChatMessage[]) => {
      const message = text.trim();
      if (!message || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const before = prior ?? histories.get(boardId) ?? EMPTY;
      const tutorId = nextId();
      setHistory(boardId, [...before, { id: nextId(), role: "user", text: message }, { id: tutorId, role: "tutor", text: "", state: "thinking" }]);
      try {
        if (!controller.chatScreen || !controller.runChatActions) throw new BoardNotReadyError();
        const history = historyFor(before);
        // the problem typed earlier, when the turns sent no longer hold it ("do the actual problem")
        const problem = problemFor(before, history);
        // what the tutor knows about this student (their record), once the board has loaded it
        const learner = learningBus.learner();
        const res = await requestChat({ boardId, message, history, screen: controller.chatScreen(), ...(problem ? { problem } : {}), ...(learner ? { learner } : {}) });
        patch(boardId, tutorId, () => ({ text: res.reply, notes: res.notes, state: res.actions.length > 0 ? "writing" : "done" }));
        if (res.actions.length > 0) {
          const report = await controller.runChatActions(res.actions);
          patch(boardId, tutorId, (m) => ({ notes: [...new Set([...(m.notes ?? []), ...runNotes(report)])], state: "done" }));
          for (const note of chatNoteReports(report, boardId)) reportUserError(note);
        }
      } catch (err) {
        const error = err instanceof BoardNotReadyError ? { kind: "other" as const, message: CHAT_COPY.errors.board, retry: true } : chatErrorFor(err);
        patch(boardId, tutorId, () => ({ state: "error", error, text: error.message, retryText: message }));
        reportUserError(chatFailureReport(error, err, boardId));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [boardId, controller],
  );

  /**
   * "Practice my weak spots": the problems are made here (`practice.ts`) and written by the chat's
   * executor, tagged `practice` for the learning record; the panel shows the chip's words and a
   * tutor reply as for any request, so the conversation (and "help me with 2") carries on from it.
   */
  const practiceWeakSpots = useCallback(
    async (prior?: ChatMessage[]) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
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
        busyRef.current = false;
        setBusy(false);
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
      // the failed ask and its error go; the same words are sent again
      const start = i > 0 && cur[i - 1].role === "user" ? i - 1 : i;
      const rest = [...cur.slice(0, start), ...cur.slice(i + 1)];
      // the chip ran on the device, and so does its retry (typed, the same words go to the model)
      if (failed.local === "weak_spots") void practiceWeakSpots(rest);
      else void send(failed.retryText, rest);
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
    send: (text: string) => send(text),
    retry,
    // only while the hint still names it: a skill mastered since, or another student, drops the chip
    weakSpot: fresh && weakSpot && learner?.weakSkills.some((s) => s.id === weakSpot.id) ? weakSpot : null,
    practiceWeakSpots: () => practiceWeakSpots(),
  };
}

// ------------------------------------------------------------------ open or closed, per device

const OPEN_KEY = "agathon.chat.open.v1";
const openListeners = new Set<() => void>();
let openCache: boolean | null = null;

function readOpen(): boolean {
  if (openCache !== null) return openCache;
  if (typeof window === "undefined") return false;
  try {
    openCache = window.localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    openCache = false;
  }
  return openCache;
}

/** The panel is off by default; opening or closing it is remembered on this device. */
export function useChatOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    (cb) => {
      openListeners.add(cb);
      return () => openListeners.delete(cb);
    },
    readOpen,
    () => false,
  );
  const setOpen = useCallback((next: boolean) => {
    openCache = next;
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* private mode: this session only */
    }
    openListeners.forEach((l) => l());
  }, []);
  return [open, setOpen];
}
