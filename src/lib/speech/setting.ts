/**
 * Read aloud's switch: per user on each device ("Read hints aloud" under Board options), so a
 * family's iPad can talk to the five-year-old while her brother in 7th grade, on the same iPad, gets
 * quiet boards. With no choice made, the student's grade decides (`readAloudByDefault`: on for
 * Kindergarten to 2nd grade), read from their profile once, and only the first time it is needed.
 *
 * Pure apart from the storage and the profile reader it is given, so the rules are tested in node
 * (`__tests__/setting.test.ts`); `src/components/speech/readAloud.ts` wires the browser's.
 */
import { READ_ALOUD_EVENT, READ_ALOUD_KEY, readAloudByDefault, readAloudKey } from "./contracts";

export type ReadAloudChoice = "on" | "off";

/** The subset of localStorage the switch uses (throws in some private windows: callers catch). */
export interface ChoiceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** "on" / "off" as stored; anything else (nothing, junk) is no choice. */
export function parseChoice(raw: unknown): ReadAloudChoice | null {
  return raw === "on" || raw === "off" ? raw : null;
}

/** This user's choice on this device, or null (none made, or storage unreadable). */
export function storedChoice(storage: ChoiceStorage | null, userId: string): ReadAloudChoice | null {
  try {
    return parseChoice(storage?.getItem(readAloudKey(userId)));
  } catch {
    return null;
  }
}

/**
 * The one choice the whole device had before the setting was per user (`READ_ALOUD_KEY` alone)
 * becomes this user's, unless they have their own, and is removed, so it moves once: to whoever
 * reads the setting first, never to every sibling after them.
 */
export function adoptDeviceChoice(storage: ChoiceStorage | null, userId: string): void {
  try {
    const raw = storage?.getItem(READ_ALOUD_KEY);
    if (!storage || raw === null || raw === undefined) return;
    const device = parseChoice(raw);
    if (device && !storedChoice(storage, userId)) storage.setItem(readAloudKey(userId), device);
    storage.removeItem?.(READ_ALOUD_KEY);
  } catch {
    // storage that cannot be written: the old choice stays where it is, read by nobody
  }
}

/** On or off: the user's choice when there is one, else the grade's default. */
export function readAloudOn(choice: ReadAloudChoice | null, grade: number | null | undefined): boolean {
  return choice ? choice === "on" : readAloudByDefault(grade);
}

/** Stores this user's choice and tells this tab (`READ_ALOUD_EVENT`); other tabs hear the storage event. */
export function storeChoice(storage: ChoiceStorage | null, userId: string, on: boolean, target: Pick<EventTarget, "dispatchEvent"> | null): void {
  const choice: ReadAloudChoice = on ? "on" : "off";
  try {
    storage?.setItem(readAloudKey(userId), choice);
  } catch {
    // a private window without storage: the choice lasts for this page only (the event below)
  }
  try {
    target?.dispatchEvent(new CustomEvent(READ_ALOUD_EVENT, { detail: choice }));
  } catch {
    // no CustomEvent (an old browser): the next resolve reads the storage anyway
  }
}

export interface GradeSource {
  /** the signed-in student, or null */
  userId(): Promise<string | null>;
  /** their grade (0 = Kindergarten), or null for none / a high-school course */
  grade(userId: string): Promise<number | null>;
}

/**
 * Whether read aloud is on for the signed-in student: their stored choice, else their grade's
 * default (off when signed out). The grade is read once per student and remembered (a failed read
 * counts as no grade: off).
 */
export function createReadAloudResolver(storage: () => ChoiceStorage | null, source: GradeSource): () => Promise<boolean> {
  let remembered: { userId: string; grade: Promise<number | null> } | null = null;
  return async () => {
    let userId: string | null = null;
    try {
      userId = await source.userId();
    } catch {
      userId = null;
    }
    if (!userId) return false;
    const store = storage();
    adoptDeviceChoice(store, userId);
    const choice = storedChoice(store, userId);
    if (choice) return choice === "on";
    if (remembered?.userId !== userId) remembered = { userId, grade: source.grade(userId).catch(() => null) };
    return readAloudOn(null, await remembered.grade);
  };
}
