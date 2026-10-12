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
 * src/lib/server/rate-limit.ts). About 2,000 hints of 100 characters, 100,000 credits (v4 Turbo
 * costs half a credit a character); past it every student hears the browser's voice until the day
 * turns. Raise it with the ElevenLabs plan.
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

// ------------------------------------------------------------------ additions (feat/ask2-voice)

/**
 * POST /api/live/transcribe's answer when it will not use ElevenLabs Scribe for this request (503,
 * `{ error: "speech_unavailable" }`): no key on this deployment, a key ElevenLabs refuses, an
 * account without Agathon Unlimited past its guided first board (the same rule as the voice:
 * `speechEntitled`), or the day's seconds for everyone spent. The mic then uses the browser's own
 * recognizer instead (`webkitSpeechRecognition`).
 */
export const SPEECH_UNAVAILABLE = "speech_unavailable";

/**
 * Seconds of speech sent to ElevenLabs Scribe a day (UTC) for everyone together: the backstop on
 * the shared key's bill (`GLOBAL_BUDGETS.liveTranscribeSeconds` in src/lib/server/rate-limit.ts).
 * Three hours is ~2,000 spoken asks of 5 s; past it every student gets the browser's recognizer
 * until the day turns. Raise it with the ElevenLabs plan.
 */
export const TRANSCRIBE_GLOBAL_BUDGET = { limit: 10_800, windowMs: 86_400_000 } as const;

// ------------------------------------------------------------------ additions (fix/ask2-review-server)

/**
 * Seconds of speech ONE account may send to ElevenLabs Scribe a day (UTC), counted per user in the
 * database (`USER_BUDGETS.liveTranscribeDaySeconds` in src/lib/server/rate-limit.ts, migration
 * 20261012000000_transcribe_user_budget.sql), like read aloud's `liveSpeakDay`. Twenty minutes is
 * ~240 spoken asks of 5 s; past it that account's mic uses the browser's recognizer until the day
 * turns. Charged with the recording's estimated length before the call and trued up with the
 * length Scribe measured after it.
 */
export const TRANSCRIBE_USER_DAY_BUDGET = { limit: 1_200, windowMs: 86_400_000 } as const;
