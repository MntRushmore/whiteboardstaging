"use client";
/**
 * The panel's microphone (docs/ASK-V2.md, part "voice"). CONTRACT STUB: the voice part builds it —
 * hold (or tap) to talk, the words sent through POST /api/live/transcribe (ElevenLabs Scribe), the
 * browser's own recognizer when that is not there. A 44 px button; `onText` gets what was said.
 */
export interface AskMicProps {
  onText(text: string): void;
  disabled?: boolean;
  /** smaller beside the input on a phone */
  compact?: boolean;
}

export function AskMic(_props: AskMicProps) {
  return null;
}
