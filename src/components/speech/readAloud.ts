/**
 * Read aloud in the browser: the module `src/lib/speech/say.ts` loads with a dynamic import the
 * first time the board has something to say, a speaker button appears or the setting is opened.
 * Never part of the board's first load (docs/BUNDLE.md).
 *
 *  - one shared Speaker (`src/lib/speech/speaker.ts`) with the browser's parts: one <audio>
 *    element, speechSynthesis, the speak route; unlocked by the first tap or key anywhere on the
 *    page (iOS plays sound only after one);
 *  - the setting: the device's choice, else the grade's default (`src/lib/speech/setting.ts`);
 *  - `watchBoard`: what the tutor writes on the board is said (a model's note on a ringed line, a
 *    hint card and its question), never the student's own work, and never while the pen moves.
 */
import { react, type Editor, type TLEventInfo } from "tldraw";
import { penIsResting } from "@/lib/billing/inkDialog";
import { readLearnerProfile } from "@/lib/learning/profile";
import { liveStore } from "@/lib/live/liveStore";
import { clientMetric } from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { READ_ALOUD_EVENT, READ_ALOUD_KEY } from "@/lib/speech/contracts";
import { createReadAloudResolver, storeChoice, type ChoiceStorage } from "@/lib/speech/setting";
import { fetchSpeech } from "@/lib/speech/speakClient";
import { Speaker, type AudioLike, type SynthLike, type UtteranceLike } from "@/lib/speech/speaker";
import { hintSpeech, newTutorNote } from "@/lib/speech/tutorWords";

function storage(): ChoiceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** On or off for this student on this device (the grade is read once, the first time it matters). */
export const isReadAloudOn = createReadAloudResolver(storage, {
  userId: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
  grade: async (userId) => (await readLearnerProfile(userId)).grade,
});

/** The Board options checkbox: stores the choice; switched off, whatever is being said stops. */
export function setReadAloud(on: boolean): void {
  storeChoice(storage(), on, window);
  if (!on) shared?.stop();
}

/** Calls `fn` whenever the choice changes, here or in another tab. */
export function onReadAloudChange(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === READ_ALOUD_KEY) fn();
  };
  window.addEventListener(READ_ALOUD_EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(READ_ALOUD_EVENT, fn);
    window.removeEventListener("storage", onStorage);
  };
}

// ------------------------------------------------------------------ the speaker

let shared: Speaker | null = null;
let sharedAudio: HTMLAudioElement | null = null;

/** Gestures that count as a user's (iOS: touchend and pointerup; a desktop: pointerdown, keys). */
const GESTURES = ["pointerdown", "pointerup", "touchend", "keydown", "click"] as const;

/** Tries the unlock on every gesture until the shared element has played once. */
function unlockOnGestures(speaker: Speaker): void {
  const onGesture = () => {
    speaker.unlock();
    if (!speaker.unlocked) return;
    for (const g of GESTURES) window.removeEventListener(g, onGesture, true);
  };
  for (const g of GESTURES) window.addEventListener(g, onGesture, { capture: true, passive: true });
}

/** The page's one speaker, made on first use. */
export function getSpeaker(): Speaker {
  if (shared) return shared;
  sharedAudio = typeof Audio === "undefined" ? null : new Audio();
  if (sharedAudio) sharedAudio.preload = "auto";
  const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
  shared = new Speaker({
    fetchSpeech: (text, signal) => fetchSpeech(text, signal),
    audio: sharedAudio as AudioLike | null,
    synth: synth as unknown as SynthLike | null,
    makeUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
    toUrl: (blob) => URL.createObjectURL(blob),
    revokeUrl: (url) => URL.revokeObjectURL(url),
    metric: clientMetric,
  });
  unlockOnGestures(shared);
  if (process.env.NODE_ENV !== "production") {
    // QA handle (like `__agathonLecture`): the speaker and its element, to watch `playing`/`ended`
    (window as unknown as { __agathonReadAloud?: unknown }).__agathonReadAloud = { speaker: shared, audio: sharedAudio, sayAuto, sayNow };
  }
  return shared;
}

/** The tutor's words, said if read aloud is on and once the pen rests. */
export function sayAuto(text: string): void {
  const speaker = getSpeaker();
  void isReadAloudOn().then((on) => {
    if (on) void speaker.speak(text, { waitForPause: true });
  });
}

/** A speaker button's tap: said now, whatever the setting (the tap unlocks audio on iOS too). */
export function sayNow(text: string): void {
  const speaker = getSpeaker();
  speaker.unlock();
  void speaker.speak(text);
}

// ------------------------------------------------------------------ the board

/**
 * Watches one board while it is open: the pen (a phrase waits for it to rest, `penIsResting`), a
 * model's note appearing on a ringed line, and a hint card opening. Returns the stop function,
 * which also stops whatever is being said.
 */
export function watchBoard(editor: Editor): () => void {
  const speaker = getSpeaker();

  let lastPenAt = 0;
  const penDown = () => editor.inputs.isPointing || editor.inputs.isDragging || editor.inputs.buttons.size > 0;
  const onEvent = (info: TLEventInfo) => {
    if (info.type !== "pointer") return;
    // a mouse resting over the board is not writing; a pen down or lifted, or dragged, is
    if (info.name === "pointer_move" && !penDown()) return;
    lastPenAt = Date.now();
  };
  editor.on("event", onEvent);
  const removeProbe = speaker.setBusyProbe(() => !penIsResting({ pointerDown: penDown(), lastPenAt, now: Date.now() }));

  // the live loop writes the tutor's notes as remote changes (liveWrite.ts): the student's own
  // edits, undo and redo are "user" and never read out
  const offNotes = editor.store.listen(
    ({ changes }) => {
      for (const [from, to] of Object.values(changes.updated)) {
        const note = newTutorNote(from, to);
        if (note) sayAuto(note);
      }
      for (const rec of Object.values(changes.added)) {
        const note = newTutorNote(null, rec);
        if (note) sayAuto(note);
      }
    },
    { scope: "document", source: "remote" },
  );

  // hint cards (LiveHintLayer): each new one, its hint and then its question; the open ones at the
  // start were there before (a remount), not new
  const seen = new Set(liveStore.openHints.get().map((h) => h.id));
  const offHints = react("read aloud: hint cards", () => {
    for (const hint of liveStore.openHints.get()) {
      if (seen.has(hint.id)) continue;
      seen.add(hint.id);
      const words = hintSpeech(hint);
      if (words) sayAuto(words);
    }
  });

  const offSwitch = onReadAloudChange(() => {
    void isReadAloudOn().then((on) => {
      if (!on) speaker.stop();
    });
  });

  return () => {
    editor.off("event", onEvent);
    removeProbe();
    offNotes();
    offHints();
    offSwitch();
    speaker.stop();
  };
}
