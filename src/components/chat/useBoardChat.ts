"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { LiveController } from "@/lib/live/contracts";
import { requestChat } from "@/lib/live/chat/client";
import { chatErrorFor, CHAT_COPY, historyFor, problemFor, runNotes, type ChatMessage } from "./chatView";

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

export interface BoardChat {
  messages: ChatMessage[];
  /** a request is in flight or its actions are being written */
  busy: boolean;
  send: (text: string) => Promise<void>;
  /** sends a failed request again (its user message and the error are replaced) */
  retry: (messageId: string) => void;
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
        const res = await requestChat({ boardId, message, history, screen: controller.chatScreen(), ...(problem ? { problem } : {}) });
        patch(boardId, tutorId, () => ({ text: res.reply, notes: res.notes, state: res.actions.length > 0 ? "writing" : "done" }));
        if (res.actions.length > 0) {
          const report = await controller.runChatActions(res.actions);
          patch(boardId, tutorId, (m) => ({ notes: [...new Set([...(m.notes ?? []), ...runNotes(report)])], state: "done" }));
        }
      } catch (err) {
        const error = err instanceof BoardNotReadyError ? { kind: "other" as const, message: CHAT_COPY.errors.board, retry: true } : chatErrorFor(err);
        patch(boardId, tutorId, () => ({ state: "error", error, text: error.message, retryText: message }));
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
      void send(failed.retryText, [...cur.slice(0, start), ...cur.slice(i + 1)]);
    },
    [boardId, send],
  );

  return { messages, busy, send: (text: string) => send(text), retry };
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
