/**
 * The board chat's limits and its one shared note, apart from the request and action schemas
 * (`contracts.ts`): the desk is in the board's first load (`LiveLoop` builds it), and reading two
 * constants from `contracts.ts` brought every zod schema in it along (docs/BUNDLE.md). Re-exported
 * from `contracts.ts`, so every other import is unchanged.
 */

export const CHAT_LIMITS = {
  /** the typed request */
  message: 500,
  /** recent turns sent with it (both sides) */
  turns: 6,
  turnText: 400,
  /** lines of the screen picture, each side */
  screenLines: 24,
  lineLatex: 300,
  /** actions per reply (more are dropped) */
  actions: 6,
  /** problems in one `write_problems` */
  problems: 12,
  /** lines of one problem (a system of equations is one problem of 2–3 lines) */
  problemLines: 3,
  /** lines of one `write_lines` */
  lines: 8,
  /** relations of one `graph` (a system is two or three) */
  relations: 3,
  reply: 280,
  /** a `write_proof`'s Given statements, and one statement's length */
  proofGivens: 4,
  proofStatement: 200,
  /** the end of a screen's lecture transcript sent with a request */
  lecture: 3000,
  /** a worked solution (`teach`): its steps, a step's sentence (asked for in ~90), a step's maths lines */
  teachSteps: 8,
  teachSay: 140,
  teachLines: 6,
  /** the problem the student typed earlier, sent when it has left the recent turns */
  problem: 600,
} as const;

/** The note for help asked about a problem that is not on this screen (the route's, and the board's). */
export function noProblemNote(n: number): string {
  return `There's no problem ${n} on this screen.`;
}
