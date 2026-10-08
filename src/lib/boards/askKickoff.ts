/**
 * "What do you want to work on?" in words (the home's topic picker): the home makes a board named
 * after the words, leaves `agathon.ask.<boardId>` = AskKickoff, and opens it; the board opens Ask
 * and sends the words as the student's first message, once, so the tutor starts the session there.
 * A device-side marker like the practice marker (`learning/practiceMarker.ts`): the board page
 * reads it synchronously in its first load, so this file stays tiny.
 */
import { clearMarker, deviceStorage, readMarker, writeMarker, type StorageLike } from "./deviceMarker";

/** `CHAT_LIMITS.message` (the chat's contracts import zod: not for the board's first load; a test holds them equal) */
export const ASK_KICKOFF_MAX = 500;

export interface AskKickoff {
  boardId: string;
  /** what the student typed: sent to Ask as it is */
  message: string;
  createdAt: number;
}

export function askKickoffKey(boardId: string): string {
  return `agathon.ask.${boardId}`;
}

export function writeAskKickoff(kickoff: AskKickoff, storage: StorageLike | null = deviceStorage()): boolean {
  const message = kickoff.message.trim().slice(0, ASK_KICKOFF_MAX);
  if (!message) return false;
  return writeMarker(askKickoffKey(kickoff.boardId), { ...kickoff, message }, storage);
}

/** The board's kickoff, when it has one (left in place: the board clears it as it sends it). */
export function readAskKickoff(boardId: string, now: number = Date.now(), storage: StorageLike | null = deviceStorage()): AskKickoff | null {
  const kickoff = readMarker<AskKickoff>(askKickoffKey(boardId), (v) => v.boardId === boardId && typeof v.message === "string" && v.message.trim().length > 0, now, storage);
  return kickoff ? { ...kickoff, message: kickoff.message.trim().slice(0, ASK_KICKOFF_MAX) } : null;
}

/** Cleared before the message is sent: a reload from then on finds none. */
export function clearAskKickoff(boardId: string, storage: StorageLike | null = deviceStorage()): void {
  clearMarker(askKickoffKey(boardId), storage);
}
