/**
 * A tiny Resend client over `fetch` (no SDK dependency): POST https://api.resend.com/emails.
 *
 * Contract. `sendEmail` never throws for anything that can go wrong on the way out: a missing key,
 * a network error, a timeout, a 4xx/5xx from Resend all come back as `{ ok: false, error }` (with
 * the HTTP status and, for a 429, how long to wait), and the caller decides what that means. A
 * missing RESEND_API_KEY answers `{ ok: false, error: "not configured" }` and logs one line, so
 * local development and preview deployments without the key keep working and simply send nothing.
 *
 * Idempotency. Every send can carry an `Idempotency-Key` (Resend keeps it 24 hours): the same key
 * again within that time returns the first email's id instead of sending a second one, so a retry
 * after a timeout cannot double-send. The once-per-account guarantee itself is the email_log table
 * (src/lib/email/log.ts); the key covers the gap between "Resend accepted it" and "we wrote that
 * down". Resend answers 409 when the same key arrives with a different body, or while the first
 * request with it is still in flight.
 *
 * Kid profiles. Every email Agathon sends passes through `sendEmail`, so the rule "nothing ever
 * emails a kid address" (src/lib/family/contracts.ts) is kept here, first: an address on the kid
 * domain answers `{ ok: false, error: KID_ADDRESS_REFUSED }` and nothing reaches Resend, whatever the
 * caller (welcome, reminders, nudges, alerts). The callers also skip such an address themselves
 * (billingRecipient, runWelcome), so this is the net under them, not the only check.
 *
 * Server-only (it reads the server env); the browser side is src/lib/email/client.ts.
 */
import { isKidEmail } from "@/lib/family/contracts";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export const RESEND_API_URL = "https://api.resend.com/emails";

/** The verified sending domain is mail.agathon.app; EMAIL_FROM overrides this. */
export const DEFAULT_EMAIL_FROM = "Agathon <hello@mail.agathon.app>";

/** Resend's limit on an Idempotency-Key. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

/** How long one send may take before it is abandoned (the Idempotency-Key makes a retry safe). */
export const SEND_TIMEOUT_MS = 10_000;

export const NOT_CONFIGURED = "not configured";

/** What `sendEmail` answers for a kid profile's address (src/lib/family/contracts.ts, isKidEmail). */
export const KID_ADDRESS_REFUSED = "refused: a kid profile's address is never sent to";

export const emailLogger = logger.child({ module: "email" });

export type EmailTag = { name: string; value: string };

export type SendEmailInput = {
  /** One recipient: these are personal emails, never a list. */
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Same key within 24 h -> the first email's id, nothing sent again. At most 256 characters. */
  idempotencyKey?: string;
  /** For filtering in Resend's dashboard; names and values are reduced to [A-Za-z0-9_-]. */
  tags?: Record<string, string> | EmailTag[];
};

export type SendEmailResult =
  | { ok: true; id: string }
  | {
      ok: false;
      /** `not configured`, `invalid request: ...`, Resend's `<name>: <message>`, or what went wrong on the way. */
      error: string;
      /** Resend's HTTP status, when it answered. */
      status?: number;
      /** 429 only: how long Resend asked us to wait. */
      retryAfterMs?: number;
    };

export type ResendConfig = {
  apiKey?: string | null;
  /** `Name <address>`; DEFAULT_EMAIL_FROM when unset. */
  from?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** RESEND_API_KEY and EMAIL_FROM from the server env (placeholders count as unset, src/lib/env.ts). */
export function resendConfigFromEnv(): ResendConfig {
  const env = getServerEnv();
  return { apiKey: env.RESEND_API_KEY ?? null, from: env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM };
}

/** True when this deployment can send email at all. */
export function emailConfigured(config: ResendConfig = resendConfigFromEnv()): boolean {
  return Boolean(config.apiKey?.trim());
}

/** Resend allows only ASCII letters, digits, `_` and `-` in tag names and values (256 max). */
export function sanitizeTag(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
  return cleaned || "_";
}

function tagList(tags: SendEmailInput["tags"]): EmailTag[] | undefined {
  if (!tags) return undefined;
  const list = Array.isArray(tags) ? tags : Object.entries(tags).map(([name, value]) => ({ name, value }));
  return list.length ? list.map((t) => ({ name: sanitizeTag(t.name), value: sanitizeTag(t.value) })) : undefined;
}

/** A single plain address (`a@b.c`), no display name, no list: what `to` must be. */
const ADDRESS_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

export function isSendableAddress(value: string): boolean {
  return value.length <= 320 && ADDRESS_RE.test(value);
}

/** Resend's `Retry-After` (seconds) or `ratelimit-reset` (seconds), in ms. */
function retryAfterMsOf(headers: Headers): number | undefined {
  for (const name of ["retry-after", "ratelimit-reset"]) {
    const raw = headers.get(name);
    const seconds = raw === null ? NaN : Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  }
  return undefined;
}

/** `<name>: <message>` from Resend's error body `{ statusCode, name, message }`, else the status. */
function describeError(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const name = typeof b.name === "string" ? b.name : null;
    const message = typeof b.message === "string" ? b.message : null;
    if (name || message) return [name, message].filter(Boolean).join(": ").slice(0, 300);
  }
  return `HTTP ${status}`;
}

/**
 * Send one email through Resend. Never throws on a send failure (see the module comment); the
 * result says what happened. `config` defaults to the server env; tests pass `fetchImpl`.
 */
export async function sendEmail(input: SendEmailInput, config: ResendConfig = resendConfigFromEnv()): Promise<SendEmailResult> {
  // First, before anything else: a kid profile's address is never sent to, whoever asks.
  if (isKidEmail(input.to)) {
    emailLogger.warn({ subject: input.subject, tags: input.tags }, "refused to email a kid profile's address");
    return { ok: false, error: KID_ADDRESS_REFUSED };
  }
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    emailLogger.warn({ subject: input.subject }, "RESEND_API_KEY is not set: email not sent");
    return { ok: false, error: NOT_CONFIGURED };
  }

  const to = input.to.trim();
  if (!isSendableAddress(to)) return { ok: false, error: "invalid request: `to` is not a single email address" };
  if (!input.subject.trim()) return { ok: false, error: "invalid request: empty subject" };
  const key = input.idempotencyKey;
  if (key !== undefined && (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH)) {
    return { ok: false, error: `invalid request: the idempotency key must be 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters` };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": "agathon-whiteboard/1 (+https://whiteboard.rushilchopra.com)",
  };
  if (key) headers["Idempotency-Key"] = key;

  const body = JSON.stringify({
    from: config.from?.trim() || DEFAULT_EMAIL_FROM,
    to: [to],
    subject: input.subject,
    html: input.html,
    text: input.text,
    tags: tagList(input.tags),
  });

  const doFetch = config.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(RESEND_API_URL, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs ?? SEND_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, error: timedOut ? "timed out" : `network error: ${err instanceof Error ? err.message : String(err)}` };
  }

  const parsed: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const failure: SendEmailResult = { ok: false, error: describeError(res.status, parsed), status: res.status };
    if (res.status === 429) {
      const wait = retryAfterMsOf(res.headers);
      if (wait !== undefined) failure.retryAfterMs = wait;
    }
    return failure;
  }
  const id = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).id : undefined;
  if (typeof id !== "string" || !id) return { ok: false, error: "Resend accepted the email but returned no id", status: res.status };
  return { ok: true, id };
}
