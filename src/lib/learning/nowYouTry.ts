/**
 * "Now you try" (2026-10-04): after the tutor solves a problem, or helps the student finish one,
 * the board offers ONE similar problem, so a worked answer turns into practice; the student's own
 * attempt at it is the evidence that they learned it (an attempt with origin `now_you_try`, its
 * `parentId` the attempt it follows). One that again needed help gets an offer of its own, so the
 * loop goes on until they get one alone.
 *
 * This is the offer's pure logic: what the attempt tracker publishes (`learningBus.onAttempt`)
 * goes in as events, and out comes at most one offer to show (`NowYouTry.tsx` draws it, works out
 * the problem with `variantOf` and writes it). No React, no engine, no clock: unit-tested.
 *
 * The rules:
 *  - an attempt whose outcome becomes `tutor_solved` or `with_help` (any origin: a student's own
 *    problem, a chat problem, a taught one, a Now-you-try one) is offered once, and only once;
 *  - not when the student has already started new work after it: another attempt started, or
 *    written on, after this one finished (the tracker's timestamps and its updates of the others);
 *  - not during the onboarding tour, and not for an outcome that is old news when it arrives (a
 *    record published again after a reload);
 *  - at most one offer at a time: a newer one replaces it;
 *  - gone on a screen change, when a new problem attempt starts, on Not now and once taken.
 */
import type { AttemptRecord, Outcome, PracticeProblem } from "./contracts";

export const NOW_YOU_TRY = {
  /** the outcomes after which the tutor offers one more like it */
  outcomes: ["tutor_solved", "with_help"] as readonly Outcome[],
  /** an outcome that finished longer ago than this when it arrives is not offered */
  freshMs: 2 * 60_000,
  /** attempts remembered for the session (once per attempt; the oldest are forgotten first) */
  remember: 300,
} as const;

export const NOW_YOU_TRY_COPY = {
  /** the big button */
  go: "Now you try one!",
  goLabel: "Now you try one: the tutor writes a new problem like this one for you",
  notNow: "Not now",
  notNowLabel: "Not now, close this",
  /** the offer's group, for a screen reader */
  region: "Try one yourself",
  /** read out when it appears */
  announce: "Want to try one like it yourself? Tap Now you try one.",
  /** the problem could not be written (quietly, in a toast) */
  failed: "Couldn't write a new problem just now. Try again in a moment.",
} as const;

/** What the offer remembers of an attempt it has seen. */
export interface SeenAttempt {
  /** ms */
  startedAt: number;
  /** ms: when the student last started or wrote on it (its start, else its latest update that added a line) */
  workAt: number;
  linesWritten: number;
}

/** An attempt to offer, while its similar problem is being worked out. */
export interface PendingOffer {
  attemptId: string;
  /** the attempt's problem, as its LaTeX lines */
  problem: PracticeProblem;
  /** ms: when it finished; work on another attempt after this cancels the offer */
  since: number;
  /** for `variantOf`: the same attempt always gets the same problem */
  seed: number;
}

/** The offer on screen. */
export interface Offer {
  attemptId: string;
  /** the new problem, as its LaTeX lines */
  problem: PracticeProblem;
  since: number;
}

export interface NowYouTryState {
  seen: Readonly<Record<string, SeenAttempt>>;
  /** attempts already offered, or passed over: once per attempt */
  decided: readonly string[];
  pending: PendingOffer | null;
  offer: Offer | null;
}

export type NowYouTryEvent =
  /** the tracker published an attempt's latest state; `tour`: the onboarding tour is on */
  | { type: "attempt"; record: AttemptRecord; now: number; tour: boolean }
  /** the similar problem for a pending offer, or null when there is none */
  | { type: "variant"; attemptId: string; problem: PracticeProblem | null }
  /** the student moved to another screen */
  | { type: "screen" }
  /** Not now */
  | { type: "dismiss" }
  /** Now you try one! (the problem is being written) */
  | { type: "take" };

export function initialNowYouTry(): NowYouTryState {
  return { seen: {}, decided: [], pending: null, offer: null };
}

/** A problem's LaTeX lines from the record's `problemLatex` (a system's lines are joined by "; "). */
export function problemLines(problemLatex: string): string[] {
  return problemLatex
    .split("; ")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** A stable seed from an attempt id (FNV-1a, 31 bits): the same attempt, the same new problem. */
export function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** When an attempt's outcome was settled (ms): its finish, else its latest update. */
export function finishedAtOf(record: AttemptRecord): number | null {
  return ms(record.finishedAt) ?? ms(record.updatedAt);
}

/** The student started or wrote on an attempt other than `exceptId` after `since`. */
export function newWorkSince(seen: Readonly<Record<string, SeenAttempt>>, exceptId: string, since: number): boolean {
  for (const [id, s] of Object.entries(seen)) {
    if (id !== exceptId && s.workAt > since) return true;
  }
  return false;
}

/** The attempts seen, with this record's latest state (its work time moves only when it gains a line). */
export function noteAttempt(seen: Readonly<Record<string, SeenAttempt>>, record: AttemptRecord): Record<string, SeenAttempt> {
  const prev = seen[record.id];
  const startedAt = ms(record.startedAt) ?? 0;
  const updatedAt = ms(record.updatedAt) ?? startedAt;
  const lines = record.linesWritten;
  const workAt = !prev ? (lines > 0 ? updatedAt : startedAt) : lines > prev.linesWritten ? updatedAt : prev.workAt;
  const next: Record<string, SeenAttempt> = { ...seen };
  delete next[record.id];
  next[record.id] = { startedAt: prev?.startedAt ?? startedAt, workAt, linesWritten: Math.max(lines, prev?.linesWritten ?? 0) };
  const ids = Object.keys(next);
  for (let i = 0; i < ids.length - NOW_YOU_TRY.remember; i++) delete next[ids[i]];
  return next;
}

/**
 * Whether this record (already noted in `state.seen`) is an attempt to offer one more like now.
 * Decided once per attempt: the first record with an offer outcome settles it either way.
 */
export function wantsOffer(state: NowYouTryState, record: AttemptRecord, now: number, tour: boolean): boolean {
  if (tour) return false;
  if (!NOW_YOU_TRY.outcomes.includes(record.outcome)) return false;
  if (state.decided.includes(record.id)) return false;
  const since = finishedAtOf(record);
  if (since === null || now - since > NOW_YOU_TRY.freshMs) return false;
  if (problemLines(record.problemLatex).length === 0) return false;
  return !newWorkSince(state.seen, record.id, since);
}

function decide(decided: readonly string[], id: string): string[] {
  const next = [...decided, id];
  return next.length > NOW_YOU_TRY.remember ? next.slice(next.length - NOW_YOU_TRY.remember) : next;
}

export function nowYouTryReducer(state: NowYouTryState, event: NowYouTryEvent): NowYouTryState {
  switch (event.type) {
    case "attempt": {
      const { record, now, tour } = event;
      const seen = noteAttempt(state.seen, record);
      // a new problem started, or another one written on, since the offer's problem finished: it goes
      let pending = state.pending && newWorkSince(seen, state.pending.attemptId, state.pending.since) ? null : state.pending;
      let offer = state.offer && newWorkSince(seen, state.offer.attemptId, state.offer.since) ? null : state.offer;
      let decided = state.decided;
      const settled = NOW_YOU_TRY.outcomes.includes(record.outcome) && !decided.includes(record.id);
      if (settled) {
        const want = wantsOffer({ ...state, seen }, record, now, tour);
        decided = decide(decided, record.id);
        if (want) {
          // at most one offer: the newest replaces whatever was showing
          pending = { attemptId: record.id, problem: problemLines(record.problemLatex), since: finishedAtOf(record) ?? now, seed: seedOf(record.id) };
          offer = null;
        }
      }
      return { seen, decided, pending, offer };
    }
    case "variant": {
      const p = state.pending;
      if (!p || p.attemptId !== event.attemptId) return state;
      const problem = event.problem && event.problem.length > 0 ? [...event.problem] : null;
      return { ...state, pending: null, offer: problem ? { attemptId: p.attemptId, problem, since: p.since } : null };
    }
    case "screen":
    case "dismiss":
    case "take":
      return state.pending || state.offer ? { ...state, pending: null, offer: null } : state;
  }
}
