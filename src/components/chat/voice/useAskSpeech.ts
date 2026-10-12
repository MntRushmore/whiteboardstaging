"use client";
/**
 * Ask's replies read aloud (docs/ASK-V2.md, part "voice"). CONTRACT STUB: the voice part builds it
 * on `src/lib/speech` (Hope on ElevenLabs for a plan, the browser's voice otherwise): a sentence is
 * spoken as soon as the stream finishes it, maths in words, a new ask stops the old one, and it
 * follows the read-aloud setting (on by default for K–2) with the panel's own speaker toggle.
 */
export interface AskSpeech {
  /** read-aloud is on for this panel */
  on: boolean;
  toggle(): void;
  /** a new reply starts (stops anything still speaking) */
  start(messageId: string): void;
  /** more of the reply's text, as streamed: whole sentences are spoken as they complete */
  feed(messageId: string, text: string): void;
  /** the reply is final: anything left is spoken */
  finish(messageId: string, finalText: string): void;
  /** speak one saved message again (its speaker button) */
  replay(text: string): void;
  stop(): void;
}

export function useAskSpeech(): AskSpeech {
  return { on: false, toggle() {}, start() {}, feed() {}, finish() {}, replay() {}, stop() {} };
}
