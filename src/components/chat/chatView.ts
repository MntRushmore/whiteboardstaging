/**
 * Pure view logic for the board chat panel (src/components/chat/BoardChatPanel.tsx): its words, the
 * messages it keeps, the first chips, what a failure looks like, and what goes back to the route as
 * "the chat so far". No React, no network: unit-tested in __tests__/chatView.test.ts.
 */
import { isApiError, isOutOfInk } from "@/lib/api-client";
import { waitPhrase } from "@/components/live/copy";
import { ASK_BOARD_OPEN, ASK_LIMITS, type AskHello, type AskStoredTurn, type AskTurn } from "@/lib/live/ask/contracts";
import { AskStreamError } from "@/lib/live/ask/client";
import { partialSuffix } from "@/lib/live/ask/splitter";
import type { ChatRunReport } from "@/lib/live/chat/contracts";
import type { PracticeProblem, SkillId } from "@/lib/learning/contracts";
import type { LearnerHint } from "@/lib/learning/hint";
import { CHAT_BUTTON_COPY } from "./askButton";
import { ASK_VOICE_COPY } from "./voice/copy";

/** Ink per request: ROUTE_COSTS["live/chat"] on the server (pinned equal in the tests). */
export const CHAT_INK = 3;

/** The panel's words. A 7-year-old reads them: short, kind, US English. */
export const CHAT_COPY = {
  ...CHAT_BUTTON_COPY,
  title: "Ask your tutor",
  close: "Close",
  /** the hello when the tutor has nothing of its own to say yet (no saved hello) */
  hello: "Hi! I'm your tutor. Ask me anything, and I can write on your board too.",
  placeholder: "Ask me anything…",
  send: "Send",
  stop: "Stop",
  stopped: "Stopped.",
  /** the board's writing finished and the reply had no words of its own */
  done: "Done! Take a look at your board.",
  /** the stream ended with no words and nothing to write */
  empty: "Hmm, I'm not sure. Can you ask me another way?",
  /** the connection dropped after the board had started writing: the writing finished, no Try again */
  cutOff: "The internet cut out at the end, but I kept what I wrote.",
  thinking: "Thinking…",
  writing: "Writing on your board…",
  retry: "Try again",
  cost: `Each question uses ${CHAT_INK} ink.`,
  /** the header's speaker toggle, named for what a tap does (the voice part's words) */
  speakerOn: ASK_VOICE_COPY.speakerOn,
  speakerOff: ASK_VOICE_COPY.speakerOff,
  replay: "Read it again",
  grow: "Make the chat bigger",
  shrink: "Make the chat smaller",
  you: "You",
  tutor: "Tutor",
  /** a failure's line sits beside a big Try again (when it can be), so the line never says it too */
  errors: {
    /**
     * OUT_OF_INK_COPY.title, the board dialog's words (pinned equal in the tests; a literal so
     * the panel does not pull the lazy dialog's module into the board's first load)
     */
    ink: "Help needs Agathon Unlimited",
    rateLimited: (seconds: number) => `That's a lot of questions. Try again in ${waitPhrase(seconds)}.`,
    unauthorized: "Please sign in again.",
    network: "Couldn't reach your tutor. Check the internet.",
    timeout: "Your tutor took too long to answer.",
    /** the tutor's model is out for a while (the provider's account, never the student's ink) */
    resting: "Your tutor is taking a break. Try again in a few minutes.",
    other: "Oops! Something went wrong.",
    board: "The board isn't ready yet. Try again in a moment.",
  },
} as const;

/**
 * "3 more like these": the first chip whenever the screen has work on it. The guided board's last
 * coach mark points at it by its words (`MORE_LIKE_THESE`, pinned equal in the tests).
 */
export const MORE_LIKE_THESE_CHIP = "3 more like these";

/** A grade band of first asks: K–2, 3–5, 6–8, and high school (or a grade not known). */
export type GradeBand = "k2" | "g35" | "g68" | "hs";

/**
 * First asks for a board with no chat and no hello of the tutor's own: something for the board at
 * the kid's level, a question to talk about, and one from another subject (the chat helps with any).
 */
export const SUGGESTIONS: Record<GradeBand, readonly string[]> = {
  k2: ["5 adding problems", "What is half of 10?", "Why is the sky blue?"],
  g35: ["5 times-table problems", "How do I add fractions?", "How do plants eat?"],
  g68: ["5 two-step equations", "What is a ratio?", "What causes the seasons?"],
  hs: ["5 two-step equations", "Graph y = x² − 4x + 3", "Help me start an essay"],
};

/** Every chip the panel can offer when the tutor has none of its own (the tour finds its one here). */
export const CHAT_SUGGESTIONS: readonly string[] = [MORE_LIKE_THESE_CHIP, ...new Set(Object.values(SUGGESTIONS).flat())];

/** The band of a grade (0 = Kindergarten … 8); null (a high-school course, or not known) is "hs". */
export function gradeBand(grade: number | null | undefined): GradeBand {
  if (typeof grade !== "number" || !Number.isFinite(grade)) return "hs";
  if (grade <= 2) return "k2";
  if (grade <= 5) return "g35";
  if (grade <= 8) return "g68";
  return "hs";
}

/** At most this many chips under the hello (the weak-spots chip comes on top of them). */
export const MAX_CHIPS = 4;

/**
 * The hello a board with no chat opens on: the tutor's own (`GET /api/live/ask/history`, "Welcome
 * back, Maya!") with its chips, else a friendly default with the grade's suggestions. When the
 * screen has work on it, "3 more like these" comes first and takes the place of the tutor's "3 more
 * like last time" (the work in front of the kid beats last time's, and the guided board's last
 * coach mark taps it by its words).
 */
export function helloFor(opts: {
  hello: AskHello | null | undefined;
  grade: number | null | undefined;
  screenHasWork: boolean;
  /** the weak-spots chip shows on its own (made on the device): not again among these */
  weakSpot?: boolean;
}): { greeting: string; chips: string[] } {
  const own = opts.hello && opts.hello.greeting.trim() ? opts.hello : null;
  const base = own && own.chips.length > 0 ? own.chips : SUGGESTIONS[gradeBand(opts.grade)];
  const rest = opts.screenHasWork ? base.filter((c) => !/\bmore like\b/i.test(c)) : base;
  const more = opts.screenHasWork ? [MORE_LIKE_THESE_CHIP] : [];
  const chips = [...new Set([...more, ...rest].map((c) => c.trim()).filter((c) => c && !(opts.weakSpot && c === WEAK_SPOTS_COPY.chip)))].slice(0, MAX_CHIPS);
  return { greeting: own ? own.greeting : CHAT_COPY.hello, chips };
}

export type ChatErrorKind = "ink" | "rate_limited" | "unauthorized" | "network" | "timeout" | "other";

export interface ChatError {
  kind: ChatErrorKind;
  message: string;
  /** Retry is offered for everything but running out of ink and being signed out */
  retry: boolean;
}

/**
 * A tutor message's life: waiting for the first word (`thinking`), words arriving (`streaming`),
 * its board actions being written (`writing`), finished (`done`, also after a Stop), or failed.
 */
export type TutorState = "thinking" | "streaming" | "writing" | "done" | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "tutor";
  text: string;
  /** what was left out, in words ("The figure couldn't be drawn.") */
  notes?: string[];
  /** a tutor message's state (absent on a user message) */
  state?: TutorState;
  error?: ChatError;
  /** a failed tutor message: the request to send again */
  retryText?: string;
  /** a failed tutor message whose request ran on the device, not the model (Retry runs it there again) */
  local?: "weak_spots";
  /** a user message: its id for the route (a retry sends the same one, so it is not saved twice) */
  clientId?: string;
  /** a user message said into the mic (and so a failed one's retry is too) */
  voice?: boolean;
  /** a tutor message the student stopped: what came before the Stop stays */
  stopped?: boolean;
  /** loaded from the saved chat (`GET /api/live/ask/history`), not this session's */
  saved?: boolean;
  /** a finished tutor message: its saved turn's id (`done.turnId`); absent when it was not saved */
  turnId?: string;
}

/** A failure of the ask as the panel shows it. */
export function chatErrorFor(err: unknown): ChatError {
  if (isApiError(err)) {
    if (isOutOfInk(err)) return { kind: "ink", message: CHAT_COPY.errors.ink, retry: false };
    if (err.status === 429 || err.code === "rate_limited") return rateLimited(err.retryAfterMs);
    if (err.status === 401 || err.code === "unauthorized") return { kind: "unauthorized", message: CHAT_COPY.errors.unauthorized, retry: false };
    return { kind: "other", message: CHAT_COPY.errors.other, retry: true };
  }
  // An `error` event once the answer was streaming: the route's code says which. Never ink: the
  // ink was taken before the stream and is given back on a failure, so `credits_exhausted` here is
  // the tutor's model being out (the provider's account), not the student.
  if (err instanceof AskStreamError) {
    const { code, status } = err.event;
    if (code === "credits_exhausted") return { kind: "other", message: CHAT_COPY.errors.resting, retry: true };
    if (status === 429 || code === "rate_limited") return rateLimited(undefined);
    if (code === "timeout") return { kind: "timeout", message: CHAT_COPY.errors.timeout, retry: true };
    if (status === 401 || code === "unauthorized") return { kind: "unauthorized", message: CHAT_COPY.errors.unauthorized, retry: false };
    return { kind: "other", message: CHAT_COPY.errors.other, retry: true };
  }
  if (err instanceof TypeError) return { kind: "network", message: CHAT_COPY.errors.network, retry: true };
  // the stream went quiet (AskTimeoutError, CHAT_TIMEOUT_MS on the old route): never a "Thinking…" for ever
  if (err instanceof Error && err.name === "TimeoutError") return { kind: "timeout", message: CHAT_COPY.errors.timeout, retry: true };
  return { kind: "other", message: CHAT_COPY.errors.other, retry: true };
}

function rateLimited(retryAfterMs: number | undefined): ChatError {
  const seconds = Math.max(1, Math.ceil((retryAfterMs ?? 10_000) / 1000));
  return { kind: "rate_limited", message: CHAT_COPY.errors.rateLimited(seconds), retry: true };
}

/** A stopped or aborted ask (Stop, a closed board): not a failure to show or report. */
export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * The chat so far as the route wants it: finished turns only (a stopped reply counts, as far as
 * it got), each at most ASK_LIMITS.turnText, newest last, at most ASK_LIMITS.turns.
 */
export function historyFor(messages: readonly ChatMessage[]): AskTurn[] {
  const turns: AskTurn[] = [];
  for (const m of messages) {
    if (m.role === "tutor" && m.state !== "done" && m.state !== "writing") continue;
    // stopped before a word: nothing was said
    if (m.role === "tutor" && m.stopped && m.text === CHAT_COPY.stopped) continue;
    const text = m.text.trim().slice(0, ASK_LIMITS.turnText).trim();
    if (text) turns.push({ role: m.role, text });
  }
  // a user turn with no reply (it failed, or was stopped before a word) is not part of the
  // conversation: the next ask is the student's turn
  const out: AskTurn[] = [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role === "user" && turns[i + 1]?.role !== "tutor") continue;
    out.push(turns[i]);
  }
  return out.slice(-ASK_LIMITS.turns);
}

/** The most the request's `problem` may be (AskRequestSchema). */
const PROBLEM_MAX = 600;

/**
 * The last problem the student typed ("O is the center of the circle… What is RS²?", "solve 2x + 5
 * = 17"), for the request's `problem` when it is no longer among the turns sent (`sent`): after a
 * dozen turns of "explain", "now explain", "do the actual problem", the problem itself has left the
 * window. A problem reads like one: long enough, some maths in it, and a question or an equation —
 * not a request for problems ("5 two-step equations") or a short follow-up.
 */
export function problemFor(messages: readonly ChatMessage[], sent: readonly AskTurn[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const t = m.text.trim();
    if (m.role !== "user" || t.length < 24 || !/[\d=²√^+×÷∠°π]/.test(t) || !/[?=]|\b(what|find|solve|how (many|much|long|far)|calculate|compute|evaluate|simplify|determine|prove)\b/i.test(t)) continue;
    if (/^\s*(\d+|a few|some)\s+(more\s+)?[\w-]+(\s+[\w-]+)?\s+(problems?|equations?|questions?)\b/i.test(t)) continue;
    const text = t.slice(0, PROBLEM_MAX);
    return sent.some((s) => s.role === "user" && s.text === t.slice(0, ASK_LIMITS.turnText).trim()) ? undefined : text;
  }
  return undefined;
}

/** The saved chat as the panel's messages (oldest first): finished turns, their notes kept. */
export function messagesFromHistory(turns: readonly AskStoredTurn[]): ChatMessage[] {
  return turns
    .filter((t) => t.text.trim())
    .map((t) => (t.role === "user" ? { id: `saved_${t.id}`, role: "user" as const, text: t.text, saved: true } : { id: `saved_${t.id}`, role: "tutor" as const, text: t.text, notes: t.notes, state: "done" as const, saved: true }));
}

/** An exchange by its words (the student's, then the tutor's), as both the tab and the saved chat hold them. */
const exchangeKey = (asked: string, answered: string) => `${asked.trim()}\u0000${answered.trim()}`;

/**
 * The saved chat (`messagesFromHistory`) merged with what this tab already holds: the saved turns
 * go first, but never an exchange twice. A read retried after a failure comes back with this tab's
 * finished exchanges in it (the route saved them meanwhile): they are found by the tutor turn's id
 * from `done` (`turnId`), or — a `done` that never came — by both their words (the newest saved
 * exchange with them: this tab's are the newest), and the saved turns from the first of them on are
 * left out, as this tab has them. A tab that already holds the saved chat keeps what it has.
 */
export function mergeSavedChat(saved: readonly ChatMessage[], cur: readonly ChatMessage[]): ChatMessage[] {
  if (saved.length === 0 || cur.some((m) => m.saved)) return [...cur];
  if (cur.length === 0) return [...saved];
  const ids = new Set(cur.flatMap((m) => (m.role === "tutor" && m.turnId ? [`saved_${m.turnId}`] : [])));
  const unsaved = new Set<string>();
  for (let i = 1; i < cur.length; i++) {
    const [asked, answer] = [cur[i - 1], cur[i]];
    if (asked.role === "user" && answer.role === "tutor" && !answer.turnId && !answer.stopped && (answer.state === "done" || answer.state === "writing")) unsaved.add(exchangeKey(asked.text, answer.text));
  }
  // where a saved exchange starts: its student turn, or the tutor turn when that has none before it
  const startOf = (i: number) => (saved[i - 1]?.role === "user" ? i - 1 : i);
  let cut = saved.length;
  for (let i = 0; i < saved.length; i++) if (saved[i].role === "tutor" && ids.has(saved[i].id)) cut = Math.min(cut, startOf(i));
  for (const key of unsaved) {
    for (let i = saved.length - 1; i > 0; i--) {
      if (saved[i].role === "tutor" && saved[i - 1].role === "user" && exchangeKey(saved[i - 1].text, saved[i].text) === key) {
        cut = Math.min(cut, i - 1);
        break;
      }
    }
  }
  return [...saved.slice(0, cut), ...cur];
}

/**
 * The reply as the panel shows it while it streams: never the board block, nor the start of its
 * tag held back at the end (the route strips both; this is the panel's own guard).
 */
export function shownReply(text: string): string {
  const at = text.indexOf(ASK_BOARD_OPEN);
  const cut = at === -1 ? text : text.slice(0, at);
  return cut.slice(0, cut.length - partialSuffix(cut, ASK_BOARD_OPEN));
}

/** The board's notes on a run, for the panel (each once). */
export function runNotes(report: ChatRunReport | null): string[] {
  if (!report) return [];
  return [...new Set(report.outcomes.map((o) => o.note).filter((n): n is string => Boolean(n)))];
}

/**
 * What Try again sends: the failed ask's words, the chat without it and its error, and its user
 * message's id (`clientId`: the route saves the turn once) and whether it was said. Null for a
 * message that cannot be tried again. `local`: the ask ran on the device (the weak-spots chip).
 */
export function retryOf(
  messages: readonly ChatMessage[],
  messageId: string,
): { text: string; prior: ChatMessage[]; local: boolean; voice?: boolean; clientId?: string } | null {
  const i = messages.findIndex((m) => m.id === messageId);
  const failed = messages[i];
  if (!failed?.retryText) return null;
  const asked = i > 0 && messages[i - 1].role === "user" ? messages[i - 1] : null;
  const start = asked ? i - 1 : i;
  return {
    text: failed.retryText,
    prior: [...messages.slice(0, start), ...messages.slice(i + 1)],
    local: failed.local === "weak_spots",
    ...(asked?.voice ? { voice: true } : {}),
    ...(asked?.clientId ? { clientId: asked.clientId } : {}),
  };
}

/**
 * Where the list scrolls to as the chat grows (while the kid is at the bottom): the end, but for a
 * tutor's reply never past its question at the top (12 px under it), streaming or done, so a long
 * answer is read from its start and never jumps to its last lines when it finishes.
 */
export function followTarget(o: { scrollHeight: number; clientHeight: number; lastIsTutor: boolean; questionTop: number | null }): number {
  const end = o.scrollHeight - o.clientHeight;
  return o.lastIsTutor && o.questionTop !== null ? Math.min(end, o.questionTop - 12) : end;
}

/** Enter sends; Shift+Enter (or composing an IME character) makes a new line. */
export function sendsOnKey(e: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.isComposing;
}

/** What the tutor message shows under its words: the Stop-able wait, the writing line, or nothing. */
export function tutorStatus(m: Pick<ChatMessage, "role" | "state">): "thinking" | "streaming" | "writing" | null {
  if (m.role !== "tutor") return null;
  return m.state === "thinking" || m.state === "streaming" || m.state === "writing" ? m.state : null;
}

/** Stop is offered while words can still come (not while the board is being written: that finishes). */
export function canStop(messages: readonly ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last?.role === "tutor" && (last.state === "thinking" || last.state === "streaming");
}

// ------------------------------------------------------------------ "Practice my weak spots"

/**
 * The first suggestion when the student's record has a skill to practice: tapped, the board writes
 * problems on their weakest skill that has practice problems, made on the device (`practice.ts`) —
 * no model, no ink. The chip is the student's own words; the reply is about the skill, and never
 * says "weak". Typed instead, the same words go to the model as any request does.
 */
export const WEAK_SPOTS_COPY = {
  chip: "Practice my weak spots",
  chipHint: "Problems on what you're learning, free (no ink)",
  /** how many problems one tap writes */
  count: 4,
  reply: (n: number, skill: string) => (n === 1 ? `Here is 1 problem on ${skill} to practice.` : `Here are ${n} problems on ${skill} to practice.`),
  /** the record changed under the chip (nothing left to practice) */
  none: "Let's practice! Ask me for some problems on anything you like.",
  failed: "I couldn't write those problems just now.",
} as const;

/** What the chip needs of `practice.ts` (loaded on demand: the board's first load never has it). */
export interface PracticeSource {
  hasPractice: (skill: string) => boolean;
  practiceProblems: (skill: SkillId, count: number, seed: number) => PracticeProblem[];
}

export type WeakSpot = LearnerHint["weakSkills"][number];

/** The skill the chip practices: the weakest one with practice problems; null shows no chip. */
export function weakSpotSkill(hint: LearnerHint | undefined, hasPractice: PracticeSource["hasPractice"]): WeakSpot | null {
  for (const s of hint?.weakSkills ?? []) if (hasPractice(s.id)) return s;
  return null;
}

/** The problems one tap writes: `count` on the weakest practicable skill (the next one if it makes none). */
export function weakSpotPractice(
  hint: LearnerHint | undefined,
  practice: PracticeSource,
  seed: number,
  count: number = WEAK_SPOTS_COPY.count,
): { skill: WeakSpot; problems: PracticeProblem[] } | null {
  for (const s of hint?.weakSkills ?? []) {
    // a skill with practice is one of SKILLS (only those have generators)
    if (!practice.hasPractice(s.id)) continue;
    const problems = practice.practiceProblems(s.id as SkillId, count, seed).filter((p) => p.length > 0);
    if (problems.length > 0) return { skill: s, problems: problems.map((p) => [...p]) };
  }
  return null;
}
