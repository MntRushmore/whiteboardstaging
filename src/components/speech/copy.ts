/**
 * Read aloud's words on screen (and the one it says when switched on). Short, for young readers;
 * the board's tone: second person, calm.
 */
export const SPEECH_COPY = {
  /** the Board options checkbox */
  toggle: "Read hints aloud",
  toggleHint: "Your tutor says its hints and questions out loud",
  /** the small speaker button beside a hint or a coach mark (its accessible name and tooltip) */
  replay: "Say it again",
  /** said once, right after the checkbox is ticked: the student hears the voice they will get */
  turnedOn: "Okay. I'll read my hints out loud.",
} as const;
