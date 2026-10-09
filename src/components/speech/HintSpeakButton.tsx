"use client";

import { hintSpeech } from "@/lib/speech/tutorWords";
import { SpeakButton } from "./SpeakButton";

/**
 * A hint card's speaker (`LiveHintLayer`): the hint, then its question. The layer loads it in idle
 * time once it is up, so neither the button nor the words it says are in the board's first load.
 */
export function HintSpeakButton({ hint, className }: { hint: { message?: string; question?: string }; className?: string }) {
  return <SpeakButton text={hintSpeech(hint)} className={className} />;
}
