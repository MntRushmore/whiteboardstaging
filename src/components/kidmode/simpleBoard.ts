/**
 * The simple board: big buttons with one word each, and the grown-up controls behind More. Built for
 * young kids (2026-10-09, "kids come back" Phase 3), where the grown-up bar (the help dial, Auto, Ask,
 * menus, a dozen tldraw tools) was a wall of words to a 6-year-old; since 2026-10-12 the board every
 * student opens. Its dock (`kidDockView`) keeps what writing maths needs (select, pen, eraser, shapes,
 * a picture, Type, undo and redo, a few colours, pages, Ask), the bar a Help me with a choice of how
 * much help, and More the rest (`boardToolbarView`).
 *
 * Who gets it: every student, by default. Every grade, a high-school course, a grade not known: the
 * grade is no longer read for it, so a board opens simple at once instead of on the classic bar while
 * a profile loads. A grown-up can switch it off (the classic bar, tldraw's tools) in More or Board
 * options, and the choice is remembered on the device.
 *
 * Remembered per user ON the device, under one key (SIMPLE_BOARD_KEY): a family's kids share a tablet
 * and switch by picture (src/lib/family), and one kid's switch must not follow her brother onto it.
 *
 * The key is the second one. The first (`agathon.simpleBoard`, `LEGACY_SIMPLE_BOARD_KEYS`) also kept
 * each user's grade as last read, off from 4th grade, for a course and for an unknown grade, and an
 * older student's device would have kept the classic bar by it. It is ignored, and cleared on the
 * first write: everyone lands on the simple board once, and a choice made from then on is kept.
 *
 * Pure: no React, no storage, no network (the store is `useSimpleBoard.ts`).
 */

/** Device setting key (localStorage): a JSON `SimpleBoardStore`. */
export const SIMPLE_BOARD_KEY = "agathon.simpleBoard.v2";

/** Keys of earlier versions: never read, removed when the store is first written. */
export const LEGACY_SIMPLE_BOARD_KEYS = ["agathon.simpleBoard"] as const;

/** Users kept on one device: a family is at most a grown-up and six kids; more is just old entries. */
export const SIMPLE_BOARD_MAX_USERS = 8;

/**
 * On by default for every student, whatever their grade or course, and with neither known. Without
 * a switch of their own, a user's board is simple.
 */
export function simpleBoardByDefault(): boolean {
  return true;
}

/** What the device remembers for one user. */
export interface SimpleBoardMemory {
  /** their own choice (the switch); absent: the default (`simpleBoardByDefault`) */
  choice?: "on" | "off";
}

/** The whole key: user id -> memory, oldest first (insertion order), at most SIMPLE_BOARD_MAX_USERS. */
export type SimpleBoardStore = Record<string, SimpleBoardMemory>;

/** The stored value, read forgivingly: anything unreadable is an empty store, an entry without a choice nothing. */
export function parseSimpleBoardStore(raw: string | null | undefined): SimpleBoardStore {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SimpleBoardStore = {};
    for (const [id, mem] of Object.entries(parsed as Record<string, unknown>)) {
      if (!id || !mem || typeof mem !== "object" || Array.isArray(mem)) continue;
      const choice = (mem as Record<string, unknown>).choice;
      if (choice === "on" || choice === "off") out[id] = { choice };
    }
    return out;
  } catch {
    return {};
  }
}

/** Whether the board is simple for this user: their choice, else the default (on). */
export function simpleBoardOn(memory: SimpleBoardMemory | undefined): boolean {
  if (memory?.choice) return memory.choice === "on";
  return simpleBoardByDefault();
}

/** `store` with `userId`'s entry replaced by `memory`, moved to the newest end and capped. */
function put(store: SimpleBoardStore, userId: string, memory: SimpleBoardMemory): SimpleBoardStore {
  const rest = Object.entries(store).filter(([id]) => id !== userId);
  const kept = rest.slice(Math.max(0, rest.length - (SIMPLE_BOARD_MAX_USERS - 1)));
  return Object.fromEntries([...kept, [userId, memory]]);
}

/** The switch: the user's own choice, which wins from now on. */
export function rememberChoice(store: SimpleBoardStore, userId: string, on: boolean): SimpleBoardStore {
  return put(store, userId, { choice: on ? "on" : "off" });
}
