/**
 * What a page hands the share button, and how it becomes the card's data. Pages know their own
 * shapes — an avatar id ("fox"), a grade number, skill ids from the learning summary — and should
 * not each turn them into words. `ShareCardInput` takes them as they are; `shareCardData` (run in
 * the share sheet's own chunk, after the tap) makes the card's `ShareCardData` from them.
 *
 * The button's props are this type only (erased at build time), so mounting the button adds no
 * learning code to a page's first load.
 */
import { AVATARS, isAvatarId } from "@/lib/family/contracts";
import { skillDef } from "@/lib/learning/contracts";
import { gradeLabel, isGrade } from "@/lib/learning/grades";
import { cardCount, type ShareCardData } from "./card";

export interface ShareCardInput {
  /** the student's display name (only its first word is ever drawn) */
  name?: string | null;
  /** an AVATARS id ("fox") or an emoji; absent, the share sheet reads the profile's */
  avatar?: string | null;
  /** 0..8 (Kindergarten to 8th grade) */
  grade?: number | null;
  /** a course's name ("Algebra 1"), shown when there is no grade */
  course?: string | null;
  /** problems worked on this week */
  problems: number;
  /** of those, solved without help */
  independent?: number;
  /** days in a row with practice */
  streak?: number;
  /** skills mastered, newest first: skill ids (`strongSkills`) or names */
  mastered?: readonly string[];
  /** the card's foot line and the link Copy link copies (a referral link); absent, the share sheet looks for one */
  link?: string | null;
}

/** An avatar id as its emoji; an emoji (or any short picture) as itself; anything else, null. */
export function avatarEmoji(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isAvatarId(value)) return AVATARS[value];
  const text = value.trim();
  // a picture, not a word: no letters or digits, a few code points at most
  return text && Array.from(text).length <= 4 && !/[\p{L}\p{N}]/u.test(text) ? text : null;
}

/** A skill id as its name; a name as itself. Empty and duplicate entries go. */
export function skillNames(skills: readonly string[] | undefined): string[] {
  const names: string[] = [];
  for (const skill of skills ?? []) {
    const name = (skillDef(skill)?.name ?? skill).trim();
    if (name && skill !== "other" && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The card's data from a page's input. */
export function shareCardData(input: ShareCardInput): ShareCardData {
  const grade = isGrade(input.grade) ? gradeLabel(input.grade) : null;
  return {
    name: input.name ?? null,
    avatar: avatarEmoji(input.avatar),
    gradeLabel: grade ?? (input.course?.trim() || null),
    problems: cardCount(input.problems),
    independent: cardCount(input.independent ?? 0),
    streak: cardCount(input.streak ?? 0),
    mastered: skillNames(input.mastered).slice(0, 3),
    link: input.link?.trim() || null,
  };
}
