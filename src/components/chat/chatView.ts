/**
 * Pure view logic for the board chat panel (src/components/chat/BoardChatPanel.tsx): its words, the
 * messages it keeps, what a failure looks like, and what goes back to the route as "the chat so
 * far". No React, no network: unit-tested in __tests__/chatView.test.ts.
 */
import { isApiError } from "@/lib/api-client";
import { OUT_OF_CREDITS_COPY } from "@/lib/billing/outOfCredits";
import { CHAT_LIMITS, type ChatRunReport, type ChatTurn } from "@/lib/live/chat/contracts";

/** Credits per request: ROUTE_COSTS["live/chat"] on the server (pinned equal in the tests). */
export const CHAT_CREDITS = 3;

export const CHAT_COPY = {
  button: "Ask",
  buttonHint: "Ask the tutor for problems, a graph or a figure",
  title: "Ask the tutor",
  close: "Close",
  intro: "Ask for practice problems, a graph or a figure. The tutor writes it on your board.",
  placeholder: "Ask for problems, a graph, a figure…",
  send: "Send",
  thinking: "Thinking…",
  writing: "Writing on the board…",
  retry: "Retry",
  cost: `Each request uses ${CHAT_CREDITS} credits.`,
  errors: {
    /** the same words as the board's out-of-credits dialog (OutOfCreditsPanel shows the rest) */
    credits: OUT_OF_CREDITS_COPY.title,
    rateLimited: (seconds: number) => `That's a lot of requests. Try again in ${seconds} s.`,
    unauthorized: "Please sign in again.",
    network: "Couldn't reach the tutor. Check your connection and try again.",
    other: "Something went wrong. Try again.",
    board: "The board isn't ready yet. Try again in a moment.",
  },
} as const;

/** Four first asks: a problem set, a graph, a figure, "more like these". */
export const CHAT_SUGGESTIONS = [
  "5 two-step equations",
  "Graph y = x² − 4x + 3",
  "A right triangle with legs 3 and 4, hypotenuse x",
  "3 more like these",
] as const;

export type ChatErrorKind = "credits" | "rate_limited" | "unauthorized" | "network" | "other";

export interface ChatError {
  kind: ChatErrorKind;
  message: string;
  /** Retry is offered for everything but running out of credits and being signed out */
  retry: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "tutor";
  text: string;
  /** what was left out, in words ("The figure couldn't be drawn.") */
  notes?: string[];
  /** a tutor message: waiting for the reply, writing its actions, done, failed */
  state?: "thinking" | "writing" | "done" | "error";
  error?: ChatError;
  /** a failed tutor message: the request to send again */
  retryText?: string;
}

/** A failure of the chat call as the panel shows it. */
export function chatErrorFor(err: unknown): ChatError {
  if (isApiError(err)) {
    if (err.status === 402 || err.code === "credits_exhausted") return { kind: "credits", message: CHAT_COPY.errors.credits, retry: false };
    if (err.status === 429 || err.code === "rate_limited") {
      const seconds = Math.max(1, Math.ceil((err.retryAfterMs ?? 10_000) / 1000));
      return { kind: "rate_limited", message: CHAT_COPY.errors.rateLimited(seconds), retry: true };
    }
    if (err.status === 401 || err.code === "unauthorized") return { kind: "unauthorized", message: CHAT_COPY.errors.unauthorized, retry: false };
    return { kind: "other", message: CHAT_COPY.errors.other, retry: true };
  }
  if (err instanceof TypeError) return { kind: "network", message: CHAT_COPY.errors.network, retry: true };
  return { kind: "other", message: CHAT_COPY.errors.other, retry: true };
}

/** The chat so far as the route wants it: finished turns only, newest last, at most `turns`. */
export function historyFor(messages: readonly ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of messages) {
    if (m.role === "tutor" && m.state !== "done" && m.state !== "writing") continue;
    const text = m.text.trim().slice(0, CHAT_LIMITS.turnText);
    if (text) turns.push({ role: m.role, text });
  }
  // a user turn whose reply failed is not part of the conversation
  const out: ChatTurn[] = [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role === "user" && turns[i + 1] && turns[i + 1].role === "user") continue;
    out.push(turns[i]);
  }
  return out.slice(-CHAT_LIMITS.turns);
}

/** The board's notes on a run, for the panel (each once). */
export function runNotes(report: ChatRunReport | null): string[] {
  if (!report) return [];
  return [...new Set(report.outcomes.map((o) => o.note).filter((n): n is string => Boolean(n)))];
}

/** Enter sends; Shift+Enter (or composing an IME character) makes a new line. */
export function sendsOnKey(e: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.isComposing;
}
