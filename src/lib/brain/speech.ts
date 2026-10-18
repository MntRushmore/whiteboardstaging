/**
 * Ask's read-aloud chunking for the native iPad app: the web panel's own sentence splitter and
 * spoken-words cleaner (`src/components/chat/voice/speechChunks.ts`, `src/lib/speech/spoken.ts`)
 * behind plain JSON, so the app's speech queue cuts a streaming reply exactly where the web's does
 * and says its maths in the same words ("3/4" → "three quarters").
 */
import { fitWords, sentenceKey, sentenceWords, splitLong, takeSentences } from "@/components/chat/voice/speechChunks";
import { spokenText } from "@/lib/speech/spoken";

export interface SpeechTakeArgs {
  /** the reply so far (or whole, with `final`) */
  text: string;
  /** where the next sentence starts (the last call's `next`) */
  from?: number;
  final?: boolean;
}

export interface SpeechSentence {
  /** as written */
  text: string;
  /** the words to say: layout, markup and emoji gone, `$…$` maths in words */
  words: string;
  /** what two versions of the sentence share (streamed and final): never said twice */
  key: string;
}

/** The whole sentences of `text` from `from` (`takeSentences`), each with its words and key. */
export function speechTake(args: SpeechTakeArgs): { sentences: SpeechSentence[]; next: number } {
  const { sentences, next } = takeSentences(String(args.text ?? ""), Math.max(0, args.from ?? 0), args.final === true);
  return { sentences: sentences.map((s) => ({ text: s, words: sentenceWords(s), key: sentenceKey(s) })), next };
}

/** Words longer than a phrase cut where a voice can breathe (`splitLong`). */
export function speechSplit(args: { words: string; max?: number }): string[] {
  return splitLong(String(args.words ?? ""), args.max);
}

/** Words cut to what is left of a reply's characters (`fitWords`): "" when too little is left. */
export function speechFit(args: { words: string; left: number }): string {
  return fitWords(String(args.words ?? ""), args.left);
}

/** Any text the tutor shows (a hint card's words, LaTeX and all) as words to say (`spokenText`). */
export function spoken(args: { text: string; max?: number }): string {
  return spokenText(String(args.text ?? ""), args.max);
}
