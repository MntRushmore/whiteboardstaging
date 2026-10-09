/**
 * The simple board's words that ship with every board (the bar, Board options). Kept to the few the
 * first load needs: the dock's are in `dockView.ts` (DOCK_COPY) and More's in `GrownUpMore.tsx`,
 * both loaded only on a simple board (docs/BUNDLE.md).
 */
export const KID_COPY = {
  /** the switch in Board options and at the top of More */
  simpleBoard: "Simple board",
  simpleBoardHint: "Fewer, bigger buttons for young kids",
  /** the bar's Back */
  back: "Back to my boards",
  /** the screen strip's New topic, in More on the simple board */
  newTopic: "New topic",
} as const;
