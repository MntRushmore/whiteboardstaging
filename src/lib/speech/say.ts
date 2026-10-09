/**
 * Read aloud's front door: the only part in the board's first load (docs/BUNDLE.md). Each call
 * fetches the rest with a dynamic import the first time it is needed (the speaker, spoken maths, the
 * setting and the board's watcher: `src/components/speech/readAloud.ts`), then hands it on.
 *
 *  - `say`: the tutor's words, said when read aloud is on and once the pen rests (a coach mark, Now
 *    you try, a Help me note, a cheer or a kind word beside a mark: `polite`, never over another).
 *  - `sayNow`: a speaker button's tap, whatever the setting; the tap also unlocks audio on iOS, so
 *    the module is loaded when the button appears (`loadReadAloud`), ready before the tap.
 *  - `watchReadAloud`: the board's hints and notes, from idle time after the board is up, and only
 *    while read aloud is on for this student (`watchBoardWhileOn`: their choice on this device, else
 *    their grade's default).
 */
import type { Editor } from "tldraw";

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

/** Says the tutor's words if read aloud is on, once the pen rests; `polite`: not over another phrase. */
export function say(text: string, opts?: { polite?: boolean }): void {
  if (text.trim()) withModule((m) => (opts ? m.sayAuto(text, opts) : m.sayAuto(text)));
}

/** Says it now, whatever the setting (a speaker button's tap). */
export function sayNow(text: string): void {
  if (text.trim()) withModule((m) => m.sayNow(text));
}

/** Idle time after the board is up: the watcher loads then, not with the board. */
const IDLE_TIMEOUT_MS = 4_000;
const FALLBACK_DELAY_MS = 1_500;

/**
 * Starts the board's read-aloud watcher in idle time (the tutor's notes and hint cards, the pen
 * for "wait for a pause", the first tap's unlock), which runs only while read aloud is on for this
 * student and follows the switch. Returns the stop function.
 */
export function watchReadAloud(editor: Editor): () => void {
  if (typeof window === "undefined") return () => undefined;
  type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  const w = window as IdleWindow;
  let done = false;
  let stop: (() => void) | null = null;
  let idle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const start = () => {
    withModule((m) => {
      if (!done && !stop) stop = m.watchBoardWhileOn(editor);
    });
  };

  if (typeof w.requestIdleCallback === "function") idle = w.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
  else timer = setTimeout(start, FALLBACK_DELAY_MS);

  return () => {
    done = true;
    if (idle !== null) w.cancelIdleCallback?.(idle);
    if (timer !== null) clearTimeout(timer);
    stop?.();
  };
}
