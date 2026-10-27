import { z } from "zod";
import { LIVE_MODELS } from "@/lib/live/contracts";

// Server-only env accessor. `server-only` is not installed, so guard at runtime:
// importing this module in a browser bundle is a programming error.
if (typeof window !== "undefined") {
  throw new Error("src/lib/env.ts is server-only and must not be imported from client code.");
}

/**
 * Values copied straight out of .env.example (e.g. `sk-or-...`, `your-key`) are
 * treated as unset so a half-filled env fails loudly instead of at the first API call.
 * Shared with the BYOK provider registry in src/lib/aiConfig.ts.
 */
export const PLACEHOLDER_VALUE = /^(your|replace|changeme|xxx|sk-or-\.\.\.|sk-\.\.\.|\.\.\.)/i;

export function isPlaceholderValue(v: unknown): boolean {
  return typeof v === "string" && (v.trim() === "" || PLACEHOLDER_VALUE.test(v.trim()));
}

/** Treat empty / whitespace-only / placeholder values as unset so `FOO=` in .env does not pass. */
const optionalString = z.preprocess(
  (v) => (isPlaceholderValue(v) ? undefined : v),
  z.string().optional(),
);

const requiredString = z.preprocess(
  (v) => (isPlaceholderValue(v) ? undefined : v),
  z.string({ required_error: "missing" }).min(1, "missing"),
);

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: requiredString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredString,
  OPENROUTER_API_KEY: requiredString,

  MATHPIX_APP_ID: optionalString,
  MATHPIX_APP_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  NEXT_PUBLIC_SITE_URL: optionalString,
  LOG_LEVEL: optionalString,

  // Live Math model overrides (OpenRouter ids). Defaults come from LIVE_MODELS.
  LIVE_MODEL_CHECK: optionalString,
  LIVE_MODEL_SOLVE: optionalString,
  LIVE_MODEL_VISION: optionalString,
  LIVE_MODEL_SETUP: optionalString,
  LIVE_MODEL_REREAD: optionalString,
  LIVE_MODEL_TITLE: optionalString,
  LIVE_MODEL_FIGURE: optionalString,
  LIVE_MODEL_PROOF: optionalString,
  LIVE_MODEL_CHAT: optionalString,
  LIVE_MODEL_ASK: optionalString,
  LIVE_MODEL_LECTURE: optionalString,
  LIVE_MODEL_SKETCH: optionalString,
  // The crop reader of /api/live/recognize: unset (or "vision") is the vision model; "mathpix-text"
  // tries Mathpix v3/text first (a prototype, off by default: docs/eval/mpx-supernet.md).
  RECOGNIZE_CROP_READER: optionalString,
  // The recognize route's second opinion (docs/PROBLEM-PAGES.md): "mathpix-text" reads a line's crop
  // with Mathpix v3/text beside the strokes read when the board asks (`secondOpinion`), and says
  // whether the two agree. Off by default: one more Mathpix call per line.
  RECOGNIZE_SECOND_OPINION: optionalString,

  // ElevenLabs: lecture mode's realtime speech-to-text (Scribe) and read aloud's voice
  // (POST /api/live/speak). Unset: the browser's own recognizer and voice.
  ELEVENLABS_API_KEY: optionalString,
  // Read aloud's ElevenLabs voice id (src/lib/speech/tts.ts); unset: TTS.defaultVoiceId.
  LIVE_VOICE_ID: optionalString,

  // Billing: ink packs (all optional; see docs/ARCHITECTURE.md "Billing").
  BILLING_ENFORCE: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  // "true" / "false": which Stripe mode the webhook accepts events from (see the webhook route).
  STRIPE_LIVEMODE: optionalString,
  INK_PRICE_MAP: optionalString,
  NEXT_PUBLIC_BILLING_LINKS: optionalString,
  // Agathon Unlimited: its Payment Link and the customer portal's login page (src/lib/billing/unlimited.ts).
  NEXT_PUBLIC_UNLIMITED_LINK: optionalString,
  NEXT_PUBLIC_BILLING_PORTAL_URL: optionalString,
  // Agathon Unlimited through Apple in-app purchase, the iPad app (src/lib/server/apple/config.ts).
  // Unset APPLE_ENVIRONMENT: the two /api/billing/apple routes answer 503.
  APPLE_ENVIRONMENT: optionalString,
  APPLE_BUNDLE_ID: optionalString,
  APPLE_APP_APPLE_ID: optionalString,
  APPLE_XCODE_CERT: optionalString,

  // Rate limiting: 'db' (default; shared counters via rate_limit_hit RPC) or 'memory' (per instance).
  RATE_LIMIT_BACKEND: optionalString,

  // Storage GC cron (GET|POST /api/admin/gc): Vercel sends `Authorization: Bearer <CRON_SECRET>`.
  // Also the trial-reminder cron (GET /api/cron/trial-reminders).
  CRON_SECRET: optionalString,
  // Signs the weekly report email's unsubscribe link (src/lib/report/unsubscribe.ts); unset: CRON_SECRET.
  // A link signed with the _PREVIOUS value still works, so a rotation keeps it there for 30 days.
  REPORT_LINK_SECRET: optionalString,
  REPORT_LINK_SECRET_PREVIOUS: optionalString,
  // The bug agent's door (GET/PATCH /api/agent/bugs…, src/lib/server/bugAgent.ts): its bearer token,
  // and the admin account its replies to reporters are sent as. Unset: the routes answer 503.
  BUG_AGENT_TOKEN: optionalString,
  BUG_AGENT_ADMIN_ID: optionalString,

  // Transactional email through Resend (src/lib/email). Unset: nothing is sent, nothing breaks.
  RESEND_API_KEY: optionalString,
  // `Name <address>` on a domain verified in Resend; default `Agathon <hello@mail.agathon.app>`.
  EMAIL_FROM: optionalString,
  // Admin alerts (src/lib/server/health): where "a service is down" / "errors spiking" emails go.
  ALERT_EMAIL: optionalString,

  // "Try it free" (/try, src/lib/try/contracts.ts): `0` turns its checking off (503); and the reads
  // everyone together may make in a UTC day (default TRY_LIMITS.perDay).
  TRY_ENABLED: optionalString,
  TRY_DAILY_READS: optionalString,
  // The new onboarding's anonymous step counts (POST /api/start/step): how many steps everyone
  // together may record in a UTC day (default START_STEP_LIMITS.perDay).
  START_DAILY_STEPS: optionalString,
  // SAT mode (docs/SAT-MODE.md): free tutor questions a day without Agathon Unlimited, for a
  // signed-in account (default 20) and with no account (an anonymous session, default 5).
  SAT_FREE_TUTOR_PER_DAY: optionalString,
  SAT_ANON_TUTOR_PER_DAY: optionalString,
});

export type ServerEnv = z.infer<typeof envSchema>;

export const REQUIRED_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "OPENROUTER_API_KEY",
] as const;

let cached: ServerEnv | null = null;

/**
 * Lazily validate and cache the server environment.
 * Throws an Error whose message lists exactly which required variables are missing,
 * e.g. "Missing required environment variables: OPENROUTER_API_KEY, NEXT_PUBLIC_SUPABASE_URL".
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = Array.from(
      new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    );
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Add them to .env.local (see .env.example) or your hosting provider's environment settings.",
    );
  }

  cached = result.data;
  return cached;
}

/** Drop the cached env (used by tests and after process.env is mutated). */
export function resetServerEnvCache(): void {
  cached = null;
}

export type RateLimitBackend = "db" | "memory";

/**
 * `RATE_LIMIT_BACKEND`: where per-user rate-limit counters live. `"memory"` selects the
 * per-instance limiter; anything else (including unset) selects the database-backed one
 * (`rate_limit_hit` RPC), which still falls back to memory when the RPC is unavailable.
 * Lenient on purpose: a typo must fail towards the stricter, shared backend.
 */
export function getRateLimitBackend(): RateLimitBackend {
  const raw = getServerEnv().RATE_LIMIT_BACKEND;
  return raw?.trim().toLowerCase() === "memory" ? "memory" : "db";
}

/**
 * `START_DAILY_STEPS`: how many steps /start may record in a UTC day, for everyone together
 * (POST /api/start/step). Unset, not a whole number or below 1: `fallback`. At most 1,000,000.
 */
export function startDailySteps(fallback: number): number {
  const raw = getServerEnv().START_DAILY_STEPS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return n >= 1 ? Math.min(n, 1_000_000) : fallback;
}

/** True when ElevenLabs is configured: lecture mode's realtime recognizer and read aloud's voice. */
export function hasElevenLabs(): boolean {
  return Boolean(getServerEnv().ELEVENLABS_API_KEY);
}

/** True when both Mathpix credentials are configured (handwritten math OCR). */
export function hasMathpix(): boolean {
  const env = getServerEnv();
  return Boolean(env.MATHPIX_APP_ID && env.MATHPIX_APP_KEY);
}

/** Which reader reads a line's crop in /api/live/recognize when the strokes read produced nothing. */
export type CropReader = "vision" | "mathpix-text";

/**
 * `RECOGNIZE_CROP_READER`: only the literal `mathpix-text` turns on Mathpix v3/text as the first crop
 * reader (the vision model stays the fallback); anything else, including unset, is `vision` (today's
 * behaviour). A prototype measured in docs/eval/mpx-supernet.md.
 */
export function getCropReader(): CropReader {
  return getServerEnv().RECOGNIZE_CROP_READER?.trim().toLowerCase() === "mathpix-text" ? "mathpix-text" : "vision";
}

/**
 * `RECOGNIZE_SECOND_OPINION`: only the literal `mathpix-text` turns on the recognize route's second
 * opinion (Mathpix v3/text on the line's crop, beside the strokes read, when the board sends
 * `secondOpinion: true`); anything else, including unset, is off. The second read is a reason for
 * the board to ask the kid "Is this right?", never the line's reading (docs/PROBLEM-PAGES.md).
 */
export function getSecondOpinion(): "mathpix-text" | null {
  return getServerEnv().RECOGNIZE_SECOND_OPINION?.trim().toLowerCase() === "mathpix-text" ? "mathpix-text" : null;
}

/**
 * `TRY_ENABLED`: the try board's kill switch (`/api/try/*`). Only the literal `0` turns it off;
 * anything else, including unset, leaves it on.
 */
export function tryEnabled(): boolean {
  return getServerEnv().TRY_ENABLED?.trim() !== "0";
}

/**
 * `TRY_DAILY_READS`: how many handwriting reads the try board may make in a UTC day, for everyone
 * together. Unset, not a whole number or below 1: `fallback` (TRY_LIMITS.perDay). At most 1,000,000.
 */
export function tryDailyReads(fallback: number): number {
  const raw = getServerEnv().TRY_DAILY_READS?.trim();
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n >= 1 ? Math.min(n, 1_000_000) : fallback;
}

function wholeOr(raw: string | undefined, fallback: number): number {
  const t = raw?.trim();
  const n = t && /^\d+$/.test(t) ? Number(t) : NaN;
  return Number.isSafeInteger(n) ? Math.min(n, 1000) : fallback;
}

/**
 * `SAT_FREE_TUTOR_PER_DAY`: how many SAT questions a day a signed-in student without Agathon
 * Unlimited may use the live tutor on (POST /api/sat/tutor). Unset or not a whole number: `fallback`
 * (SAT_LIMITS.freeTutorPerDay, 20). `0` turns the free tutor off; at most 1000.
 */
export function satFreeTutorPerDay(fallback: number): number {
  return wholeOr(getServerEnv().SAT_FREE_TUTOR_PER_DAY, fallback);
}

/**
 * `SAT_ANON_TUTOR_PER_DAY`: the same for a student with no account (an anonymous SAT session).
 * Unset or not a whole number: `fallback` (SAT_LIMITS.anonTutorPerDay, 5). `0` turns it off; at most 1000.
 */
export function satAnonTutorPerDay(fallback: number): number {
  return wholeOr(getServerEnv().SAT_ANON_TUTOR_PER_DAY, fallback);
}

export type LiveModels = {
  check: string;
  checkFallback: string;
  solve: string;
  solveFallback: string;
  vision: string;
  setup: string;
  setupFallback: string;
  reread: string;
  rereadFallback: string;
  /** a board's smart name (POST /api/live/title): text only */
  title: string;
  titleFallback: string;
  /** setup from a hand-drawn figure (POST /api/live/setup with a crop): a vision model */
  figure: string;
  figureFallback: string;
  /** two-column proofs (POST /api/live/proof): a proof's figure read, a next row the planner could not find */
  proof: string;
  proofFallback: string;
  /** the board chat (POST /api/live/chat): a typed request -> a reply and board actions */
  chat: string;
  chatFallback: string;
  /** lecture mode's director (POST /api/live/lecture): recent transcript -> what to sketch */
  lecture: string;
  lectureFallback: string;
  /** lecture mode's illustrator (POST /api/live/lecture/sketch): a panel in words -> vector strokes */
  sketch: string;
  sketchFallback: string;
  /** Ask, rebuilt (POST /api/live/ask): the streamed tutor chat */
  ask: string;
  askFallback: string;
  /** Ask's memory notes, written after a turn */
  askMemory: string;
  askMemoryFallback: string;
};

/** The fallback for `primary`: never the primary itself (an override equal to the fallback swaps the two). */
function fallbackFor(primary: string, defaultPrimary: string, defaultFallback: string): string {
  return primary === defaultFallback ? defaultPrimary : defaultFallback;
}

/**
 * Model ids used by the Live Math routes. `LIVE_MODEL_CHECK/SOLVE/VISION/SETUP/REREAD/TITLE/FIGURE/PROOF/CHAT/LECTURE/SKETCH/ASK`
 * override the primaries; the fallbacks always come from LIVE_MODELS (a fallback equal to the
 * primary would be pointless, so an override that matches a fallback swaps the two).
 */
export function getLiveModels(): LiveModels {
  const env = getServerEnv();
  const check = env.LIVE_MODEL_CHECK || LIVE_MODELS.check;
  const solve = env.LIVE_MODEL_SOLVE || LIVE_MODELS.solve;
  const setup = env.LIVE_MODEL_SETUP || LIVE_MODELS.setup;
  const reread = env.LIVE_MODEL_REREAD || LIVE_MODELS.reread;
  const title = env.LIVE_MODEL_TITLE || LIVE_MODELS.title;
  const figure = env.LIVE_MODEL_FIGURE || LIVE_MODELS.figure;
  const proof = env.LIVE_MODEL_PROOF || LIVE_MODELS.proof;
  const chat = env.LIVE_MODEL_CHAT || LIVE_MODELS.chat;
  const lecture = env.LIVE_MODEL_LECTURE || LIVE_MODELS.lecture;
  const sketch = env.LIVE_MODEL_SKETCH || LIVE_MODELS.sketch;
  const ask = env.LIVE_MODEL_ASK || LIVE_MODELS.ask;
  return {
    check,
    checkFallback: fallbackFor(check, LIVE_MODELS.check, LIVE_MODELS.checkFallback),
    solve,
    solveFallback: fallbackFor(solve, LIVE_MODELS.solve, LIVE_MODELS.solveFallback),
    vision: env.LIVE_MODEL_VISION || LIVE_MODELS.vision,
    setup,
    setupFallback: fallbackFor(setup, LIVE_MODELS.setup, LIVE_MODELS.setupFallback),
    reread,
    rereadFallback: fallbackFor(reread, LIVE_MODELS.reread, LIVE_MODELS.rereadFallback),
    title,
    titleFallback: fallbackFor(title, LIVE_MODELS.title, LIVE_MODELS.titleFallback),
    figure,
    figureFallback: fallbackFor(figure, LIVE_MODELS.figure, LIVE_MODELS.figureFallback),
    proof,
    proofFallback: fallbackFor(proof, LIVE_MODELS.proof, LIVE_MODELS.proofFallback),
    chat,
    chatFallback: fallbackFor(chat, LIVE_MODELS.chat, LIVE_MODELS.chatFallback),
    lecture,
    lectureFallback: fallbackFor(lecture, LIVE_MODELS.lecture, LIVE_MODELS.lectureFallback),
    sketch,
    sketchFallback: fallbackFor(sketch, LIVE_MODELS.sketch, LIVE_MODELS.sketchFallback),
    ask,
    askFallback: fallbackFor(ask, LIVE_MODELS.ask, LIVE_MODELS.askFallback),
    askMemory: LIVE_MODELS.askMemory,
    askMemoryFallback: LIVE_MODELS.askMemoryFallback,
  };
}

/* ------------------------------------------------------------------------- */
/* Billing                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Ink metering is on unless `BILLING_ENFORCE=0` (dev/staging escape hatch).
 * Anything other than the literal string "0" (including unset) enforces.
 */
export function billingEnforced(): boolean {
  return getServerEnv().BILLING_ENFORCE !== "0";
}

/** `INK_PRICE_MAP`: Stripe price id -> ink pack id, e.g. `{"price_123":"medium"}`. */
const priceMapSchema = z.record(z.string().min(1), z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/));

export type InkPriceMap = Record<string, string>;

/**
 * Parse an `INK_PRICE_MAP` value (printed by scripts/stripe-setup.mjs). The webhook's fallback
 * when a Checkout Session carries no `metadata.pack_id`. Returns `{ map }` (empty when unset) or
 * `{ error }` describing why the JSON is unusable. Pure; no env access.
 */
export function parseInkPriceMap(raw: string | undefined): { map: InkPriceMap } | { error: string } {
  if (!raw || raw.trim() === "") return { map: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "INK_PRICE_MAP is not valid JSON." };
  }
  const result = priceMapSchema.safeParse(parsed);
  if (!result.success) {
    return { error: 'INK_PRICE_MAP must be a JSON object of {"<price id>": "<pack id>"} strings.' };
  }
  return { map: result.data };
}
