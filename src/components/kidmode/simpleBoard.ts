/**
 * The simple board (2026-10-09, "kids come back" Phase 3): fewer, bigger buttons for young kids. Most
 * of prod's students are 5 to 10, and the grown-up bar (the help dial, Auto, Ask, menus, a dozen
 * tldraw tools) is a wall of words to a 6-year-old. The simple board keeps what a kid writing a sum
 * needs (pen, eraser, undo, a few colours, pages, Help me) and puts the rest behind a grown-up
 * "More" button (`boardToolbarView`, `kidDockView`).
 *
 * Who gets it: Kindergarten to 3rd grade by default (`profiles.grade`), never a high-school course or a
 * student whose grade is not known. Anyone can switch it, in Board options or in More, and the choice
 * is remembered on the device.
 *
 * Remembered per user ON the device, under one key (SIMPLE_BOARD_KEY): a family's kids share a tablet
 * and switch by picture (src/lib/family), and a 1st grader's simple board must not follow her brother
 * in 7th grade onto it. Each user's entry also keeps the grade's answer as last read, so a kid's next
 * board opens simple straight away instead of flashing the grown-up bar while the profile is read.
 *
 * Pure: no React, no storage, no network (the store is `useSimpleBoard.ts`).
 */

/** Device setting key (localStorage): a JSON `SimpleBoardStore`. */
export const SIMPLE_BOARD_KEY = "agathon.simpleBoard";

/** The oldest grade the simple board is on for by default: 3rd grade (Kindergarten is 0). */
export const SIMPLE_BOARD_MAX_GRADE = 3;

/** Users kept on one device: a family is at most a grown-up and six kids; more is just old entries. */
export const SIMPLE_BOARD_MAX_USERS = 8;

/**
 * On by default from Kindergarten to 3rd grade. A high-school student has no grade (only a course),
 * and an unknown grade is not a young kid's either: neither ever gets it by default.
 */
export function simpleBoardByDefault(grade: number | null | undefined): boolean {
  return typeof grade === "number" && Number.isInteger(grade) && grade >= 0 && grade <= SIMPLE_BOARD_MAX_GRADE;
}

/** What the device remembers for one user. */
export interface SimpleBoardMemory {
  /** their own choice (the switch); absent: the grade decides */
  choice?: "on" | "off";
  /** `simpleBoardByDefault` of their grade as last read; absent: not read on this device yet */
  byGrade?: boolean;
}

/** The whole key: user id -> memory, oldest first (insertion order), at most SIMPLE_BOARD_MAX_USERS. */
export type SimpleBoardStore = Record<string, SimpleBoardMemory>;

function isMemory(value: unknown): value is SimpleBoardMemory {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (v.choice === undefined || v.choice === "on" || v.choice === "off") && (v.byGrade === undefined || typeof v.byGrade === "boolean");
}

/** The stored value, read forgivingly: anything unreadable (or another shape) is an empty store. */
export function parseSimpleBoardStore(raw: string | null | undefined): SimpleBoardStore {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SimpleBoardStore = {};
    for (const [id, mem] of Object.entries(parsed as Record<string, unknown>)) {
      if (id && isMemory(mem)) out[id] = { ...(mem.choice ? { choice: mem.choice } : {}), ...(mem.byGrade === undefined ? {} : { byGrade: mem.byGrade }) };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Whether the board is simple for this user: their choice, else their grade's default as last read.
 * `null` while neither is known (a first board on this device, before the profile is read): the board
 * shows the grown-up bar meanwhile, the bar every older student keeps.
 */
export function simpleBoardOn(memory: SimpleBoardMemory | undefined): boolean | null {
  if (memory?.choice) return memory.choice === "on";
  return memory?.byGrade ?? null;
}

/** Does the profile still need reading? Only while no choice was made: a choice wins over any grade. */
export function needsGrade(memory: SimpleBoardMemory | undefined): boolean {
  return !memory?.choice;
}

/**
 * The grade a profile read says, or "unknown" when the read says nothing at all.
 * `readLearnerProfile` never throws: offline, or refused, it answers a profile of nothing but nulls —
 * the same as a student who skipped the welcome. Remembered, that would turn a 1st grader's simple
 * board off on the next board too; so a profile with no course, grade, name or picture changes nothing
 * (the grown-up bar meanwhile, as for any unknown grade). A high-school student has a course.
 */
export function gradeFromProfile(profile: { grade: number | null; course: string | null; displayName: string | null; avatar: string | null }): number | null | "unknown" {
  if (profile.grade === null && profile.course === null && profile.displayName === null && profile.avatar === null) return "unknown";
  return profile.grade;
}

/** `store` with `userId`'s entry replaced by `memory`, moved to the newest end and capped. */
function put(store: SimpleBoardStore, userId: string, memory: SimpleBoardMemory): SimpleBoardStore {
  const rest = Object.entries(store).filter(([id]) => id !== userId);
  const kept = rest.slice(Math.max(0, rest.length - (SIMPLE_BOARD_MAX_USERS - 1)));
  return Object.fromEntries([...kept, [userId, memory]]);
}

/** The switch: the user's own choice, which wins from now on. */
export function rememberChoice(store: SimpleBoardStore, userId: string, on: boolean): SimpleBoardStore {
  return put(store, userId, { ...store[userId], choice: on ? "on" : "off" });
}

/** The profile was read: the grade's default, kept for the next board (a choice still wins). */
export function rememberGrade(store: SimpleBoardStore, userId: string, grade: number | null | undefined): SimpleBoardStore {
  const byGrade = simpleBoardByDefault(grade);
  if (store[userId]?.byGrade === byGrade) return store;
  return put(store, userId, { ...store[userId], byGrade });
}
