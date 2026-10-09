/**
 * Read aloud's switch: per device ("Read hints aloud" under Board options), so a family's iPad can
 * talk to the five-year-old while a sibling's laptop stays quiet. With no choice made on this
 * device, the student's grade decides (`readAloudByDefault`: on for Kindergarten to 2nd grade),
 * read from their profile once, and only the first time it is needed.
 *
 * Pure apart from the storage and the profile reader it is given, so the rules are tested in node
 * (`__tests__/setting.test.ts`); `src/components/speech/readAloud.ts` wires the browser's.
 */
import { READ_ALOUD_EVENT, READ_ALOUD_KEY, readAloudByDefault } from "./contracts";

export type ReadAloudChoice = "on" | "off";

/** The subset of localStorage the switch uses (throws in some private windows: callers catch). */
export interface ChoiceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** "on" / "off" as stored; anything else (nothing, junk) is no choice. */
export function parseChoice(raw: unknown): ReadAloudChoice | null {
  return raw === "on" || raw === "off" ? raw : null;
}

/** The choice on this device, or null (none made, or storage unreadable). */
export function storedChoice(storage: ChoiceStorage | null): ReadAloudChoice | null {
  try {
    return parseChoice(storage?.getItem(READ_ALOUD_KEY));
  } catch {
    return null;
  }
}

/** On or off: the device's choice when there is one, else the grade's default. */
export function readAloudOn(choice: ReadAloudChoice | null, grade: number | null | undefined): boolean {
  return choice ? choice === "on" : readAloudByDefault(grade);
}

/** Stores the choice and tells this tab (`READ_ALOUD_EVENT`); other tabs hear the storage event. */
export function storeChoice(storage: ChoiceStorage | null, on: boolean, target: Pick<EventTarget, "dispatchEvent"> | null): void {
  const choice: ReadAloudChoice = on ? "on" : "off";
  try {
    storage?.setItem(READ_ALOUD_KEY, choice);
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
 * Whether read aloud is on: the stored choice right away, else the grade's default. The grade is
 * read once per student and remembered (a failed read counts as no grade: off).
 */
export function createReadAloudResolver(storage: () => ChoiceStorage | null, source: GradeSource): () => Promise<boolean> {
  let remembered: { userId: string; grade: Promise<number | null> } | null = null;
  return async () => {
    const choice = storedChoice(storage());
    if (choice) return choice === "on";
    let userId: string | null = null;
    try {
      userId = await source.userId();
    } catch {
      userId = null;
    }
    if (!userId) return false;
    if (remembered?.userId !== userId) remembered = { userId, grade: source.grade(userId).catch(() => null) };
    return readAloudOn(null, await remembered.grade);
  };
}
