/**
 * Ask's saved chat and memory, on the server (docs/ASK-V2.md, part "memory"). CONTRACT STUBS: the
 * memory part fills these in (migration `20261011000000_ask_v2.sql`: `ask_messages`,
 * `learner_memory`). Until then nothing is saved and nothing is remembered, and every caller must
 * carry on without them: these never throw.
 */
import type { LearnerMemory } from "@/lib/live/ask/contracts";

/** Who is asking, as the route knows them: the signed-in user's access token and id. */
export interface AskStoreCaller {
  token: string;
  userId: string;
}

/** One turn to save on a board. A tutor turn carries the notes and the kinds of action it wrote. */
export interface AskSaveTurn {
  role: "user" | "tutor";
  text: string;
  notes?: string[];
  /** the action kinds written on the board (`write_problems`, `graph`…), never their content */
  wrote?: string[];
  /** the client's id for a student turn: the same id is not saved twice (a retry) */
  clientId?: string;
}

/** Saves a finished exchange on a board. Answers the saved rows' ids in order, or null when saving failed. */
export async function saveAskTurns(_caller: AskStoreCaller, _boardId: string, _turns: readonly AskSaveTurn[]): Promise<string[] | null> {
  return null;
}

/**
 * What the tutor knows about the student when it answers, read on the server (never trusted from
 * the client): their name and grade (`profiles`), what it remembers (`learner_memory`), and what
 * they worked on lately (`learning_attempts`: up to 5 recent skill names, newest first).
 */
export interface AskLearnerContext {
  name: string | null;
  /** 0..8 (K–8), null for a high-school course or not chosen */
  grade: number | null;
  /** a high-school course id when chosen (`algebra1`…) */
  course: string | null;
  memory: string[];
  recent: string[];
}

export const EMPTY_ASK_CONTEXT: AskLearnerContext = { name: null, grade: null, course: null, memory: [], recent: [] };

export async function loadAskContext(_caller: AskStoreCaller): Promise<AskLearnerContext> {
  return EMPTY_ASK_CONTEXT;
}

/**
 * After a turn (run with `after()`, never delaying the reply): the memory model reads the notes so
 * far and this exchange, and keeps, adds or drops notes (`prompts/askMemory.ts`). Never throws.
 */
export async function rememberFromTurn(_caller: AskStoreCaller, _exchange: { message: string; reply: string; memory: readonly string[] }): Promise<void> {}

export async function readLearnerMemory(_caller: AskStoreCaller): Promise<LearnerMemory> {
  return { notes: [], updatedAt: null };
}

export async function clearLearnerMemory(_caller: AskStoreCaller): Promise<void> {}
