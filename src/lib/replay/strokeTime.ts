/**
 * The meta keys the board stamps on shapes for the replay (numbers: ms since the epoch). Its own
 * import-free module so the board's first load (`stampTimes`) carries these two strings and not the
 * replay's timeline; `timeline.ts` re-exports them.
 *
 * Not `live`: LiveLoop tells the student's ink from the tutor's by `meta.live`'s absence.
 */
export const STROKE_TIME = { start: "t", end: "t1" } as const;
