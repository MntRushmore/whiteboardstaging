/**
 * The admin board viewer's words: pure, so the side panel's copy is tested without a browser.
 * Times are formatted in the viewer's zone, or the one a test passes.
 */
import type { AdminAskTurn, AdminAttempt, AdminBoardDoc, AdminEvent } from "@/lib/admin/contracts";
import { formatWhen, kindLabel, relativeTime, type ViewClock } from "@/lib/admin/view";
import { formatSize } from "@/lib/replay/format";

export const ADMIN_BOARD_COPY = {
  back: "Back to boards",
  documentTitle: (title: string) => `${title} · Admin · Agathon`,
  untitled: "Untitled board",
  noEmail: "no email",
  created: (when: string) => `Created ${when}`,
  updated: (rel: string) => `updated ${rel}`,
  version: (v: number) => `version ${v}`,
  follow: "Follow live",
  followHint: "Checks for new strokes every few seconds while this page is open.",
  live: "Live",
  loadFailedTitle: "Couldn't load this board",
  loadFallback: "Something went wrong reading the board. Try again in a moment.",
  badShape: "The board came back in a shape this page doesn't know. The page and the server may be from different releases: reload the page.",
  retry: "Try again",
  followFailed: "Couldn't check for changes: retrying.",
  attemptsTitle: "Problems on this board",
  attemptsEmpty: "No problems recorded on this board.",
  errorsTitle: "Errors on this board",
  errorsEmpty: "No errors on this board.",
  errorsJumpHint: "Show the board at this moment",
  historyTitle: "Saved versions",
  historyHint: "Kept for restoring a board; shown for reference.",
  historyEmpty: "No saved versions.",
  fixture: "Dev fixture: made-up data",
  tabsLabel: "What to show",
  tabBoard: "Board",
  tabAsk: "Ask",
  askTitle: "Ask chat on this board",
  askHint: "What the student asked Ask here and what it answered, oldest first. Opening this is logged.",
  askEmpty: "No Ask chat on this board yet.",
  askFixture: "Dev fixture: no Ask chat.",
  askLoadFailedTitle: "Couldn't load the Ask chat",
  askLoadFallback: "Something went wrong reading the chat. Try again in a moment.",
  askStudent: "Student",
  askTutor: "Tutor",
  askWrote: (kinds: string) => `Wrote on the board: ${kinds}`,
  askCount: (n: number) => `${n} ${n === 1 ? "message" : "messages"}`,
} as const;

export const OUTCOME_VIEW: Record<AdminAttempt["outcome"], { label: string; tone: "good" | "ok" | "help" | "neutral" }> = {
  first_try: { label: "First try", tone: "good" },
  self_corrected: { label: "Fixed it", tone: "good" },
  with_help: { label: "With help", tone: "help" },
  tutor_solved: { label: "Tutor solved", tone: "help" },
  in_progress: { label: "Working on it", tone: "neutral" },
  unfinished: { label: "Unfinished", tone: "neutral" },
};

/**
 * A problem's LaTeX read as plain text: `\frac{3}{4}+\frac{1}{8}` → `3/4 + 1/8`, `12\times 13` →
 * `12 × 13`. Good enough to recognise a problem in a list; anything it does not know is kept.
 */
export function problemText(latex: string): string {
  let s = latex;
  for (let i = 0; i < 4; i++) s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a: string, b: string) => `${wrap(a)}/${wrap(b)}`);
  s = s
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
    .replace(/\\(left|right)\s*/g, "")
    .replace(/\\times/g, " × ")
    .replace(/\\cdot/g, " · ")
    .replace(/\\div/g, " ÷ ")
    .replace(/\\pm/g, " ± ")
    .replace(/\\le(q)?\b/g, " ≤ ")
    .replace(/\\ge(q)?\b/g, " ≥ ")
    .replace(/\\neq?\b/g, " ≠ ")
    .replace(/\\pi\b/g, "π")
    .replace(/\\theta\b/g, "θ")
    .replace(/\\(,|;|!|quad|qquad)\s*/g, " ")
    .replace(/\\text\s*\{([^{}]*)\}/g, "$1")
    .replace(/\^\{([^{}]*)\}/g, "^($1)")
    .replace(/_\{([^{}]*)\}/g, "_$1")
    .replace(/[{}]/g, "")
    .replace(/\s*([=+<>])\s*/g, " $1 ")
    .replace(/(\S)-(\S)/g, "$1 − $2")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

function wrap(part: string): string {
  return /^[\w.]+$/.test(part.trim()) ? part.trim() : `(${part.trim()})`;
}

export interface AttemptRowView {
  id: string;
  problem: string;
  outcome: { label: string; tone: "good" | "ok" | "help" | "neutral" };
  /** "2 hints · 1 ring · 4 min" */
  detail: string;
  when: string;
}

export function attemptRows(attempts: readonly AdminAttempt[], clock: ViewClock): AttemptRowView[] {
  return attempts.map((a) => {
    const bits: string[] = [];
    if (a.hints > 0) bits.push(`${a.hints} ${a.hints === 1 ? "hint" : "hints"}`);
    if (a.solves > 0) bits.push(`${a.solves} ${a.solves === 1 ? "solve" : "solves"}`);
    if (a.linesRinged > 0) bits.push(`${a.linesRinged} ${a.linesRinged === 1 ? "ring" : "rings"}`);
    const min = Math.round(a.activeMs / 60_000);
    bits.push(min >= 1 ? `${min} min` : "under a minute");
    return { id: a.id, problem: problemText(a.problemLatex) || a.problemLatex, outcome: OUTCOME_VIEW[a.outcome], detail: bits.join(" · "), when: formatWhen(a.startedAt, clock) };
  });
}

export interface EventRowView {
  id: number;
  /** ms since the epoch */
  at: number;
  when: string;
  title: string;
  message: string;
  level: AdminEvent["level"];
}

export function eventRows(events: readonly AdminEvent[], clock: ViewClock): EventRowView[] {
  return events
    .filter((e) => !e.noise)
    .map((e) => ({ id: e.id, at: Date.parse(e.at), when: formatWhen(e.at, clock), title: kindLabel(e.kind, e.code), message: e.message, level: e.level }))
    .filter((e) => Number.isFinite(e.at))
    .sort((a, b) => a.at - b.at);
}

const REASONS: Record<string, string> = {
  before_restore: "Before a restore",
  daily: "Daily copy",
  manual: "Saved by hand",
  conflict: "Before a merge",
};

export function historyRows(history: AdminBoardDoc["history"], clock: ViewClock): { id: number; when: string; label: string }[] {
  return history.map((h) => ({ id: h.id, when: formatWhen(h.at, clock), label: `${REASONS[h.reason] ?? h.reason.replace(/[_-]+/g, " ")} · version ${h.version}` }));
}

export interface AskTurnView {
  id: string;
  role: AdminAskTurn["role"];
  who: string;
  text: string;
  /** the notes the student was shown with a tutor turn ("1 problem couldn't be checked.") */
  notes: string[];
  /** "Wrote on the board: write problems, graph", or null */
  wrote: string | null;
  when: string;
}

/** The Ask tab's rows, in the order the chat happened. */
export function askTurnRows(turns: readonly AdminAskTurn[], clock: ViewClock): AskTurnView[] {
  return turns.map((t) => ({
    id: t.id,
    role: t.role,
    who: t.role === "tutor" ? ADMIN_BOARD_COPY.askTutor : ADMIN_BOARD_COPY.askStudent,
    text: t.text,
    notes: t.notes,
    wrote: t.wrote.length ? ADMIN_BOARD_COPY.askWrote(t.wrote.map((k) => k.replace(/_+/g, " ")).join(", ")) : null,
    when: formatWhen(t.at, clock),
  }));
}

/** "student@example.com · Created Oct 3, 4:12 PM · updated 3 min ago · 840 KB · version 42" (owner first, linked by the page) */
export function boardMetaParts(board: AdminBoardDoc["board"], clock: ViewClock): string[] {
  return [
    ADMIN_BOARD_COPY.created(formatWhen(board.createdAt, clock)),
    ADMIN_BOARD_COPY.updated(relativeTime(board.updatedAt, clock.now) ?? formatWhen(board.updatedAt, clock)),
    formatSize(board.sizeKb),
    ADMIN_BOARD_COPY.version(board.version),
  ];
}

/** Following is switched on by itself when the board was saved this recently. */
export const AUTO_FOLLOW_MS = 2 * 60_000;

export function shouldAutoFollow(updatedAt: string, now: number): boolean {
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) && now - t < AUTO_FOLLOW_MS;
}

/** "updated 3 s ago" while following: seconds under a minute. */
export function liveAgo(updatedAt: string, now: number): string {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `updated ${s} s ago`;
  return ADMIN_BOARD_COPY.updated(relativeTime(updatedAt, now) ?? "");
}
