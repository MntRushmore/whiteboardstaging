/**
 * Read aloud (2026-10-09, Phase 3): the tutor says its hints and questions out loud, for children
 * who can't read well yet. A friendly ElevenLabs voice through POST /api/live/speak (the server
 * holds ELEVENLABS_API_KEY), and the browser's own speech when that route is unavailable.
 *
 * Shared contract for Phase 3 (docs/KIDS-COME-BACK.md).
 */

/** POST /api/live/speak: the text to say. Plain words only (no LaTeX), at most SPEAK_MAX_CHARS. */
export interface SpeakRequest {
  text: string;
}

/** Longer text is refused: hints and questions are a sentence or two. */
export const SPEAK_MAX_CHARS = 280;

/** On by default for the youngest (Kindergarten to 2nd grade); anyone can switch it on or off. */
export function readAloudByDefault(grade: number | null | undefined): boolean {
  return typeof grade === "number" && grade <= 2;
}

/**
 * The setting's key on the device, one per user (`readAloudKey`): "on" | "off" (absent: the grade's
 * default). A family's kids share a tablet and switch by picture (src/lib/family), so one kid's
 * choice must not follow another onto it. Until 2026-10-09 this key alone held one choice for the
 * whole device; the first user to read the setting after that takes it over, once.
 */
export const READ_ALOUD_KEY = "agathon.readAloud";

/** `agathon.readAloud.<userId>`: this user's choice on this device. */
export function readAloudKey(userId: string): string {
  return `${READ_ALOUD_KEY}.${userId}`;
}

// ------------------------------------------------------------------ additions (feat/kcb3-voice)

/**
 * Per-user budgets for POST /api/live/speak (`LIMITS.liveSpeak` and `LIMITS.liveSpeakDay` in
 * src/lib/server/rate-limit.ts). A board says a phrase every few seconds at the most (a hint, a
 * coach mark, a replay tap), so 30 a minute is ample; the day's cap bounds what one account can
 * cost on the ElevenLabs bill (~300 short phrases), since the route spends no ink.
 */
export const SPEAK_RATE_LIMITS = {
  perMinute: { limit: 30, windowMs: 60_000 },
  perDay: { limit: 300, windowMs: 86_400_000 },
} as const;

/**
 * The ElevenLabs voice for everyone together, in characters a day (UTC): the backstop on the shared
 * key's bill however many accounts there are (`GLOBAL_BUDGETS.liveSpeakChars` in
 * src/lib/server/rate-limit.ts). About 2,000 hints of 100 characters, 100,000 Flash credits; past it
 * every student hears the browser's voice until the day turns. Raise it with the ElevenLabs plan.
 */
export const SPEAK_GLOBAL_BUDGET = { limit: 200_000, windowMs: 86_400_000 } as const;

/**
 * Who hears the ElevenLabs voice (POST /api/live/speak): an account with Agathon Unlimited (a kid
 * through their grown-up's plan), or one on its guided first board: starter ink left, granted at
 * most this long ago. Starter ink is never spent by the voice, so without the window an account
 * that never starts a plan would keep it for good. Everyone else hears the browser's voice.
 */
export const SPEAK_STARTER_WINDOW_MS = 2 * 86_400_000;

/**
 * Window event when the device setting changes (`detail`: "on" | "off"), so the board's watcher
 * starts or stops without polling and the menu's checkbox follows a change made elsewhere.
 */
export const READ_ALOUD_EVENT = "agathon:read-aloud";
