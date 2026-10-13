/**
 * The free board (owner, 2026-10-13: "create a account after onboarding and get 1 free board so they
 * try it then subscribe"; docs/START-FLOW.md, "The free board"). An account without a plan gets ONE
 * board with no card: its oldest live board, whoever made it (/start's finish, the old welcome's
 * guided board, or the student). It ends at whichever comes first:
 *  - FREE_BOARD_PROBLEMS (5) problems done on it (`countDone`), or
 *  - the starter ink gone: the balance at 0, or an AI call on it refused for ink (a Live 402). The AI
 *    routes enforce the ink on the server, so the cost is bounded whatever the page does.
 * Then the plan screen (`/welcome/plan`, unchanged). On the board itself the end is the moment of
 * the win: a calm sheet (`FreeBoardSheet`), not a redirect.
 *
 * The rule sits on top of `planGate` and keeps its principles: it only ever narrows a `locked`, so
 * whatever planGate leaves `open` or `checking` (a plan, an admin, no checkout link, just back from
 * checkout, the plan not read yet, a page that asked to be left alone such as the guided first
 * board) stays so. Anything it does not know yet is `checking` (the page shows as usual), and a read
 * that fails never locks anyone out: the hook passes 0 problems for a failed read.
 *
 * Pure and tiny: it is in the board's first load (`useFreeBoard`). No React, no network.
 */
import { gateNeedsAdmin, planGate, type PlanGateInput } from "@/lib/billing/planGate";
import type { StorageLike } from "@/lib/onboarding/marker";

/** Problems done on the free board before it ends. */
export const FREE_BOARD_PROBLEMS = 5;

/**
 * - `open`: the page shows; the free-board rule does not apply (a plan, an admin, no checkout…);
 * - `checking`: not known yet; the page shows as usual and nothing is held;
 * - `free`: no plan, and this is the free board (the board page) or the home while the free board
 *   has problems left; new boards go to the plan screen instead;
 * - `locked`: no plan, and another board, or the free board used up: the plan screen.
 */
export type FreeBoardGate = "checking" | "open" | "free" | "locked";

/** Why the free board is over: its problems are done, or its starter ink is gone. */
export type FreeBoardEnd = "problems" | "ink";

export interface FreeBoardInput extends PlanGateInput {
  /**
   * The account's oldest live board (`oldestBoard`): undefined while unknown (or its read failed),
   * null when the account has no board at all (the first one made will be the free board).
   */
  freeBoardId: string | null | undefined;
  /** the board this page shows; null on a page without one (the home) */
  boardId: string | null;
  /** problems done on the free board (`countDone`): null while being read, 0 when the read failed */
  done: number | null;
  /** the ink left (`ink_summary().balance`): null while unknown */
  ink: number | null;
  /** an AI call on this board was refused for ink during this visit (a Live 402) */
  inkRefused?: boolean;
  /** this device saw the account's free board end (`readFreeBoardEnd`) */
  endedOnDevice?: FreeBoardEnd | null;
  /**
   * The board page showed this board as the free board during this visit, with its problems read:
   * when it is used up now, that is the moment of the win (the sheet), not a redirect.
   */
  wasFree?: boolean;
}

export interface FreeBoardView {
  gate: FreeBoardGate;
  /** the free board's id while the rule applies (null with no board yet, or when it does not apply) */
  freeBoardId: string | null;
  /** problems done on the free board, while the rule applies and they are known */
  done: number | null;
  goal: number;
  /** why the free board is over, once it is (null while it has problems and ink left) */
  ended: FreeBoardEnd | null;
  /** the board page: this free board was used up during this visit — show the sheet, stay put */
  usedUp: boolean;
}

/** Why the free board is over, if it is. Problems first: "Nice work" beats "out of ink". */
export function freeBoardEnd({ done, ink, inkRefused, endedOnDevice }: Pick<FreeBoardInput, "done" | "ink" | "inkRefused" | "endedOnDevice">): FreeBoardEnd | null {
  if (typeof done === "number" && done >= FREE_BOARD_PROBLEMS) return "problems";
  if (endedOnDevice === "problems" || endedOnDevice === "ink") return endedOnDevice;
  if (inkRefused === true || (typeof ink === "number" && ink <= 0)) return "ink";
  return null;
}

const view = (gate: FreeBoardGate, rest: Partial<FreeBoardView> = {}): FreeBoardView => ({ gate, freeBoardId: null, done: null, goal: FREE_BOARD_PROBLEMS, ended: null, usedUp: false, ...rest });

/** The paywall with the free board: see the module comment. */
export function freeBoardGate(input: FreeBoardInput): FreeBoardView {
  const base = planGate(input);
  if (base !== "locked") return view(base);
  const { freeBoardId, boardId } = input;
  if (freeBoardId === undefined) return view("checking");
  const ended = freeBoardEnd(input);
  if (freeBoardId === null) {
    // No live board: a board page here shows nobody's board of theirs (gone, or never theirs);
    // the home lets the first board be made, and that board is the free one, unless this account
    // already used its free board up (the ink, or this device saw it end).
    if (boardId !== null) return view("locked", { ended });
    return view(ended ? "locked" : "free", { ended });
  }
  const done = input.done;
  if (boardId !== null && boardId !== freeBoardId) return view("locked", { freeBoardId, done, ended });
  if (!ended) return view("free", { freeBoardId, done });
  // used up: on the free board itself, during the visit that used it up, the sheet; else the plan screen
  if (boardId !== null && input.wasFree === true) return view("free", { freeBoardId, done, ended, usedUp: true });
  return view("locked", { freeBoardId, done, ended });
}

/** Whether the rule needs `is_admin()` (and the free board's reads): only for an account it may hold. */
export function freeBoardApplies(input: Omit<PlanGateInput, "admin">): boolean {
  return gateNeedsAdmin(input);
}

/* ------------------------------------------------------------------------- */
/* Which board, and how many problems                                          */
/* ------------------------------------------------------------------------- */

/** The free board: the oldest of these boards (by `created_at`, then id), or null for none. */
export function oldestBoard(boards: readonly { id: string; created_at: string | null }[]): string | null {
  let best: { id: string; at: number } | null = null;
  for (const b of boards) {
    if (!b || typeof b.id !== "string" || !b.id) continue;
    const parsed = b.created_at ? Date.parse(b.created_at) : Number.NaN;
    const at = Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    if (!best || at < best.at || (at === best.at && b.id < best.id)) best = { id: b.id, at };
  }
  return best?.id ?? null;
}

/**
 * An attempt that counts as a problem done: it left `in_progress` for anything but `unfinished`
 * (the student solved it, with or without help, or the tutor finished it), as Today's practice
 * counts its `done` (src/lib/daily/progress.ts). The chat's worked examples (`teach`: the tutor wrote
 * the whole solution of a problem the student never worked) are not the student's problems.
 */
export const DONE_OUTCOMES = ["first_try", "self_corrected", "with_help", "tutor_solved"] as const;

/** One learning attempt as the count reads it (`learning_attempts` or the board's bus). */
export interface DoneRow {
  id: string;
  problemLatex?: string | null;
  outcome: string;
  origin: string;
}

export function isDone(row: Pick<DoneRow, "outcome" | "origin">): boolean {
  return (DONE_OUTCOMES as readonly string[]).includes(row.outcome) && row.origin !== "teach";
}

/** A problem as the count knows it: its LaTeX without spaces (as Today's practice keys it). */
export function problemKey(latex: string | null | undefined): string {
  const flat = typeof latex === "string" ? latex.replace(/\s+/g, "") : "";
  return flat ? `p:${flat}` : "";
}

/**
 * Problems done: each problem once (by its LaTeX; an attempt with none by its id), and each attempt
 * once (an attempt whose problem the tracker renamed is still one problem). The board's own
 * attempts and the saved ones may be the same attempt: counted once.
 */
export function countDone(rows: Iterable<DoneRow>): number {
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !isDone(row) || ids.has(row.id)) continue;
    ids.add(row.id);
    keys.add(problemKey(row.problemLatex) || `id:${row.id}`);
  }
  return keys.size;
}

/* ------------------------------------------------------------------------- */
/* The end, as this device remembers it                                        */
/* ------------------------------------------------------------------------- */

export const freeBoardEndKey = (userId: string) => `agathon.freeBoard.end.${userId}`;

/**
 * This device saw the account's free board end (localStorage, per account): the home goes to the
 * plan screen at once, before the problems are saved or read, and deleting the used-up board does
 * not make the next one free on this device. Also how `free_board_done` is recorded once.
 */
export function readFreeBoardEnd(storage: StorageLike | null | undefined, userId: string | null | undefined): FreeBoardEnd | null {
  if (!storage || !userId) return null;
  try {
    const v = storage.getItem(freeBoardEndKey(userId));
    return v === "problems" || v === "ink" ? v : null;
  } catch {
    return null;
  }
}

export function writeFreeBoardEnd(storage: StorageLike | null | undefined, userId: string, end: FreeBoardEnd): void {
  try {
    storage?.setItem(freeBoardEndKey(userId), end);
  } catch {
    /* private mode: the server's ink and problems still say so */
  }
}
