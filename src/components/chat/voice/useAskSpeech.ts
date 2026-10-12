"use client";
/**
 * Ask's replies read aloud (docs/ASK-V2.md, part "voice"): a sentence is spoken as soon as the
 * stream finishes it, maths in words, a new ask stops the old one, and it follows the read-aloud
 * setting (the student's choice on this device, else on by default for K–2: `readAloudOn`) with
 * the panel's own speaker toggle, which stores that same choice (it is "Read hints aloud" too).
 *
 * The voice is read aloud's (`src/lib/speech`): Hope on ElevenLabs for a plan, the browser's voice
 * otherwise, exactly as the board's hints. The queue (`speechQueue.ts`) decides what is said when;
 * the read-aloud module (the speaker, the setting) is fetched with a dynamic import when the panel
 * opens, never with the board (docs/BUNDLE.md).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadReadAloud } from "@/lib/speech/say";
import { ASK_VOICE_COPY } from "./copy";
import { ASK_MIC_EVENT } from "./micLogic";
import { AskSpeechQueue, type PhraseSpeaker } from "./speechQueue";

export interface AskSpeech {
  /** read-aloud is on for this panel */
  on: boolean;
  toggle(): void;
  /** a new reply starts (stops anything still speaking) */
  start(messageId: string): void;
  /**
   * more of the reply's text, as streamed: whole sentences are spoken as they complete. Either the
   * new piece or the whole text so far (passing the whole text is the safer of the two).
   */
  feed(messageId: string, text: string): void;
  /** the reply is final: anything left is spoken */
  finish(messageId: string, finalText: string): void;
  /** speak one saved message again (its speaker button) */
  replay(text: string): void;
  stop(): void;
}

type ReadAloudModule = Awaited<ReturnType<typeof loadReadAloud>>;

/** The page's read-aloud speaker, as the queue's voice. */
async function readAloudVoice(): Promise<PhraseSpeaker> {
  const m = await loadReadAloud();
  const speaker = m.getSpeaker();
  return {
    speak: (words) => speaker.speak(words),
    prefetch: (words) => speaker.prefetch(words),
    stop: () => speaker.stop(),
  };
}

export function useAskSpeech(): AskSpeech {
  const [on, setOn] = useState(false);
  const onRef = useRef(on);
  const moduleRef = useRef<ReadAloudModule | null>(null);
  const [queue] = useState(() => {
    const q = new AskSpeechQueue({ speaker: readAloudVoice });
    q.setEnabled(false); // until the setting is known
    return q;
  });

  const apply = useCallback(
    (value: boolean) => {
      onRef.current = value;
      setOn(value);
      queue.setEnabled(value);
    },
    [queue],
  );

  useEffect(() => {
    let live = true;
    let off: () => void = () => undefined;
    loadReadAloud()
      .then((m) => {
        if (!live) return;
        moduleRef.current = m;
        const read = () => {
          void m
            .isReadAloudOn()
            .then((value) => {
              if (!live) return;
              apply(value);
              // made now, while on: its listeners unlock audio on the next tap (iOS), before a reply
              if (value) m.getSpeaker();
            })
            .catch(() => undefined);
        };
        read();
        off = m.onReadAloudChange(read);
      })
      .catch(() => undefined);
    // the kid starts talking: Ask stops (the mic would record its voice too)
    const silence = () => queue.stop();
    window.addEventListener(ASK_MIC_EVENT, silence);
    if (process.env.NODE_ENV !== "production") {
      // QA handle (like `__agathonReadAloud`): what is waiting to be said
      (window as unknown as { __agathonAskSpeech?: unknown }).__agathonAskSpeech = queue;
    }
    return () => {
      live = false;
      off();
      window.removeEventListener(ASK_MIC_EVENT, silence);
      queue.stop();
    };
  }, [apply, queue]);

  const toggle = useCallback(() => {
    const next = !onRef.current;
    apply(next);
    const store = (m: ReadAloudModule) => {
      if (next) {
        // inside the tap: unlocks audio on iOS, and the student hears the voice they will get
        const speaker = m.getSpeaker();
        speaker.unlock();
        void speaker.speak(ASK_VOICE_COPY.turnedOn);
      }
      m.setReadAloud(next);
    };
    if (moduleRef.current) store(moduleRef.current);
    else void loadReadAloud().then(store, () => undefined);
  }, [apply]);

  const replay = useCallback(
    (text: string) => {
      // a tap: audio may start now on iOS
      moduleRef.current?.getSpeaker().unlock();
      queue.replay(text);
    },
    [queue],
  );

  return useMemo<AskSpeech>(
    () => ({
      on,
      toggle,
      start: (id) => queue.start(id),
      feed: (id, text) => queue.feed(id, text),
      finish: (id, text) => queue.finish(id, text),
      replay,
      stop: () => queue.stop(),
    }),
    [on, toggle, replay, queue],
  );
}
