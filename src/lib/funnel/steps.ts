/**
 * The onboarding steps the app records for the admin Funnel (2026-10-12), between signing up and
 * the free trial: the welcome, the guided first board, the plan screen and Stripe's checkout. Each
 * account keeps one row per step in `funnel_steps` (when it first and last happened, how often),
 * written only by `record_funnel_step()` (supabase/migrations/20261012020000_funnel_steps.sql) and
 * read only by `admin_funnel()`. Before this the onboarding's metrics never left the browser, and
 * the Funnel could not say who saw the plan screen or the tutor check a line.
 *
 * Pure: no React, no network. The browser's sender is `record.ts`.
 */

/** Every step, in the order a new account meets them. The table's check lists the same names. */
export const FUNNEL_STEPS = [
  /**
   * the visitor tried the free board at /try before making the account (recorded once signed in,
   * from the device's try marker: src/lib/try/contracts.ts); meta: { checked, solved }
   */
  "try_board",
  /** the welcome showed (a new account with no boards) */
  "welcome_shown",
  /** Skip for now on the welcome; meta: { step: 1 | 2 } */
  "welcome_skipped",
  /** Start on the welcome: the first board was made and the guided board opens */
  "welcome_started",
  /** the tutor wrote the starter problem on the guided board */
  "tour_problem",
  /** the tutor ticked or ringed the student's line on the guided board; meta: { mark: "check" | "ring" } */
  "tour_checked",
  /** the tutor could not read the student's line on the guided board (a question mark) */
  "tour_unread",
  /** Help me wrote a step on the guided board */
  "tour_helped",
  /** the tutor answered the student's ask in the panel on the guided board */
  "tour_asked",
  /** Skip tour (or Esc); meta: { at: the tour step it was skipped on } */
  "tour_skipped",
  /** the tour's finish card was reached */
  "tour_done",
  /** the plan screen showed its offer; meta: { view: "offer" | "restart" | "soon", kid?: true } */
  "plan_shown",
  /** Start the free trial: Stripe's checkout is opening; meta: { view, referred } */
  "checkout_opened",
  /** back on the home from checkout (`?unlimited=started`) */
  "checkout_returned",
  /**
   * the free board was used up (src/lib/billing/freeBoard.ts): its 5 problems done, or its starter
   * ink gone; recorded once per account (the device remembers it); meta: { reason: "problems" | "ink" }
   */
  "free_board_done",
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export function isFunnelStep(value: unknown): value is FunnelStep {
  return typeof value === "string" && (FUNNEL_STEPS as readonly string[]).includes(value);
}

/** The RPC that records a step as the signed-in user. */
export const RECORD_FUNNEL_STEP = "record_funnel_step";

/** A step's small details: a few flat values, never anything about the student's work. */
export type FunnelStepMeta = Record<string, string | number | boolean | null>;

const META_KEY = /^[a-z][a-zA-Z0-9_]{0,31}$/;
const MAX_META_KEYS = 8;
const MAX_META_TEXT = 80;
/** the table's limit on `meta` (`funnel_steps_meta_shape`): octet_length of the jsonb's text */
const MAX_META_BYTES = 1000;

/** The jsonb's text in UTF-8 bytes: JSON's, plus the space Postgres writes after each ':' and ','. */
function metaBytes(meta: FunnelStepMeta): number {
  const n = Object.keys(meta).length;
  return new TextEncoder().encode(JSON.stringify(meta)).length + Math.max(0, 2 * n - 1);
}

/**
 * `meta` as the database takes it (a flat object under 1,000 bytes), or null when nothing is
 * left: at most 8 keys named like identifiers, finite numbers, booleans, null, and strings cut to
 * 80 characters. Anything else (nested values, undefined) is dropped, not refused, and so are the
 * last keys while the whole is still over 1,000 bytes (long non-ASCII text could be).
 */
export function cleanMeta(meta: Record<string, unknown> | null | undefined): FunnelStepMeta | null {
  if (!meta || typeof meta !== "object") return null;
  const out: FunnelStepMeta = {};
  let n = 0;
  for (const [key, value] of Object.entries(meta)) {
    if (n >= MAX_META_KEYS) break;
    if (!META_KEY.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, MAX_META_TEXT);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean" || value === null) out[key] = value;
    else continue;
    n += 1;
  }
  const keys = Object.keys(out);
  while (keys.length > 0 && metaBytes(out) > MAX_META_BYTES) delete out[keys.pop() as string];
  return keys.length > 0 ? out : null;
}
