/**
 * Read aloud's front door: the only part in the board's first load (docs/BUNDLE.md). Each call
 * fetches the rest with a dynamic import the first time it is needed (the speaker, spoken maths, the
 * setting and the board's watcher: `src/components/speech/readAloud.ts`), then hands it on.
 *
 *  - `say`: the tutor's words, said when read aloud is on and once the pen rests (a coach mark, Now
 *    you try, a Help me note).
 *  - `sayNow`: a speaker button's tap, whatever the setting; the tap also unlocks audio on iOS, so
 *    the module is loaded when the button appears (`loadReadAloud`), ready before the tap.
 *  - `watchReadAloud`: the board's hints and notes, from idle time after the board is up; not at all
 *    while the device's choice is "off", until it is switched on.
 */
import type { Editor } from "tldraw";
import { whenIdle } from "@/lib/whenIdle";
import { READ_ALOUD_EVENT, READ_ALOUD_KEY } from "./contracts";

type ReadAloudModule = typeof import("@/components/speech/readAloud");

let loaded: ReadAloudModule | null = null;
let loading: Promise<ReadAloudModule> | null = null;

/** Loads the read-aloud module once; resolves to it. */
export function loadReadAloud(): Promise<ReadAloudModule> {
  loading ??= import("@/components/speech/readAloud").then((m) => (loaded = m));
  return loading;
}

function withModule(fn: (m: ReadAloudModule) => void): void {
  if (typeof window === "undefined") return; // the server, a node test: nobody to hear it
  if (loaded) {
    fn(loaded);
    return;
  }
  loadReadAloud()
    .then(fn)
    .catch(() => {
      loading = null; // a chunk that failed to load (offline): the next call tries again
    });
}

/** Says the tutor's words if read aloud is on, once the pen rests. */
export function say(text: string): void {
  if (text.trim()) withModule((m) => m.sayAuto(text));
}

/** Says it now, whatever the setting (a speaker button's tap). */
export function sayNow(text: string): void {
  if (text.trim()) withModule((m) => m.sayNow(text));
}

function switchedOff(): boolean {
  try {
    return window.localStorage.getItem(READ_ALOUD_KEY) === "off";
  } catch {
    return false;
  }
}

/**
 * Starts the board's read-aloud watcher in idle time (the tutor's notes and hint cards, the pen
 * for "wait for a pause", the first tap's unlock). With read aloud switched off on this device it
 * waits for the switch instead. Returns the stop function.
 */
export function watchReadAloud(editor: Editor): () => void {
  if (typeof window === "undefined") return () => undefined;
  let done = false;
  let stop: (() => void) | null = null;
  let cancelIdle: (() => void) | null = null;

  const start = () => {
    window.removeEventListener(READ_ALOUD_EVENT, onSwitch);
    withModule((m) => {
      if (!done && !stop) stop = m.watchBoard(editor);
    });
  };
  const onSwitch = (e: Event) => {
    if ((e as CustomEvent<unknown>).detail === "on") start();
  };

  // idle time after the board is up: the watcher loads then, not with the board
  if (switchedOff()) window.addEventListener(READ_ALOUD_EVENT, onSwitch);
  else cancelIdle = whenIdle(start);

  return () => {
    done = true;
    window.removeEventListener(READ_ALOUD_EVENT, onSwitch);
    cancelIdle?.();
    stop?.();
  };
}
