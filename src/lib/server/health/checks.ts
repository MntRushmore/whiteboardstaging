/**
 * The health checks behind GET /api/admin/health: one function per service in SERVICES
 * (src/lib/admin/contracts.ts), each asking the cheapest question that proves the service works
 * for Agathon. None of them costs money, writes anything a student sees, or sends a token to a
 * model: they run every 5 minutes, 288 times a day.
 *
 *   app         GET  <site>/api/health                      the site answers (and its own DB probe)
 *   database    GET  /rest/v1/profiles?select=user_id&limit=1  Postgres answers the service role
 *   openrouter  GET  openrouter.ai/api/v1/key (+ /credits)  the key works, credit left
 *   mathpix     POST api.mathpix.com/v3/app-tokens          the key works ("free of charge", per Mathpix)
 *   email       GET  api.resend.com/domains                 the key works, the sending domain is verified
 *   stripe      env + billing_events + app_events           the webhook can verify, no webhook failed lately
 *
 * Every check runs at once, each under its own CHECK_TIMEOUT_MS (a slow provider must not hold
 * the others, and pg_cron's request has a deadline too). A check never throws: whatever goes wrong
 * becomes `{ ok: false, code, detail }`, and `detail` never carries a key, a token or a student's
 * content (provider messages are cut to a sentence).
 */
import { SERVICES, type HealthResult, type Service } from "@/lib/admin/contracts";
import { restGet, RestError, type Rest } from "@/lib/server/health/store";

/** How long one check may take before it counts as down. */
export const CHECK_TIMEOUT_MS = 8_000;

export const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
/** Account credit (purchased - used). OpenRouter documents it as management-key only; a 401/403 just means "unknown". */
export const OPENROUTER_ACCOUNT_CREDITS_URL = "https://openrouter.ai/api/v1/credits";
export const MATHPIX_APP_TOKENS_URL = "https://api.mathpix.com/v3/app-tokens";
export const RESEND_DOMAINS_URL = "https://api.resend.com/domains?limit=100";

/** A Stripe webhook failure counts against the check for this long (Stripe retries for days; this is "lately"). */
export const STRIPE_FAILURE_WINDOW_MIN = 30;

/** Short machine codes for a failure (the `code` of the `health.<service>` event). */
export type CheckCode = "timeout" | "network" | "unauthorized" | "upstream" | "rate_limited" | "unconfigured" | "invalid" | "out_of_credit" | "unverified" | "failures";

export type CheckOutcome = {
  ok: boolean;
  /** why it failed, or a short note when it passed */
  detail: string;
  code?: CheckCode;
  /**
   * The failure may be nothing but the database being down (the app's own probe, the Stripe check's
   * reads). The alerts hold such a failure while the database check fails too, so one outage sends
   * one email, not three.
   */
  needsDatabase?: boolean;
  /** OpenRouter only: dollars left (the lower of the key's limit and the account's balance), null when unknown. */
  creditsLeftUsd?: number | null;
};

/** A HealthResult plus what the route needs and does not answer (stripped by `toHealthResult`). */
export type CheckResult = HealthResult & Pick<CheckOutcome, "code" | "needsDatabase" | "creditsLeftUsd">;

export type CheckEnv = {
  /** NEXT_PUBLIC_SUPABASE_URL */
  supabaseUrl: string;
  serviceKey: string;
  /** The site whose /api/health the app check asks: NEXT_PUBLIC_SITE_URL, else the request's own origin. */
  siteUrl: string;
  openrouterKey: string | undefined;
  mathpix: { appId: string; appKey: string } | null;
  resendKey: string | undefined;
  /** EMAIL_FROM (or the default): its domain must be verified in Resend. */
  emailFrom: string;
  /** STRIPE_WEBHOOK_SECRET is set (without it the webhook refuses every event). */
  stripeWebhookConfigured: boolean;
};

export type CheckDeps = { fetch: typeof fetch; now: () => Date; timeoutMs?: number };

type Check = (env: CheckEnv, deps: CheckDeps, signal: AbortSignal) => Promise<CheckOutcome>;

const UA = "agathon-health/1 (+https://www.agathon.app)";

// ------------------------------------------------------------------ helpers

/** A provider's error message (`message`, `error.message`, `error`), one line, never more than a sentence. */
export function providerMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const nested = b.error && typeof b.error === "object" ? (b.error as Record<string, unknown>).message : undefined;
  const raw = [b.message, nested, b.error, b.name].find((v) => typeof v === "string" && v.trim());
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 160) : null;
}

/** "answered 503: Service Unavailable" for a non-OK response. */
function httpFailure(name: string, status: number, body: unknown): CheckOutcome {
  const message = providerMessage(body);
  const code: CheckCode = status === 401 || status === 403 ? "unauthorized" : status === 429 ? "rate_limited" : status >= 500 ? "upstream" : "invalid";
  return { ok: false, code, detail: `${name} answered ${status}${message ? `: ${message}` : ""}` };
}

/** A thrown fetch error as an outcome: a timeout (ours or the platform's) or a network failure. */
export function errorOutcome(err: unknown, timeoutMs: number): CheckOutcome {
  if (err instanceof RestError) return { ok: false, code: err.status && err.status >= 500 ? "upstream" : err.status === 401 || err.status === 403 ? "unauthorized" : "invalid", detail: err.message, needsDatabase: true };
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return { ok: false, code: "timeout", detail: `no answer in ${Math.round(timeoutMs / 1000)} s` };
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, code: "network", detail: `network error: ${message.slice(0, 160)}` };
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

function num(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** "$12.40 credit left": the contract's own example, and what the overview can parse back. */
export function creditsDetail(usd: number): string {
  return `$${Math.max(0, usd).toFixed(2)} credit left`;
}

/** The dollars in a `creditsDetail` string, or null. */
export function parseCreditsDetail(detail: string | null | undefined): number | null {
  const m = /^\$(\d+(?:\.\d+)?) credit left/.exec(detail ?? "");
  return m ? Number(m[1]) : null;
}

// ------------------------------------------------------------------ the checks

/**
 * app: the site's own GET /api/health, through the public URL (so DNS, Vercel and the function all
 * answer). A 503 with `db: "down"` means the site is up and its database probe failed: reported as
 * a failure, marked `needsDatabase` so the database alert speaks for both.
 */
export const checkApp: Check = async (env, deps, signal) => {
  const res = await deps.fetch(`${env.siteUrl.replace(/\/+$/, "")}/api/health`, { cache: "no-store", signal, headers: { "User-Agent": UA } });
  const body = (await readJson(res)) as { ok?: unknown; db?: unknown; release?: unknown } | null;
  if (res.ok && body?.ok === true) return { ok: true, detail: typeof body.release === "string" ? `release ${body.release}` : "answers" };
  if (res.status === 503 && body?.db === "down") return { ok: false, code: "upstream", detail: "the site answers, but its own database probe failed", needsDatabase: true };
  return httpFailure("/api/health", res.status, body);
};

/** database: one row of profiles with the service role (the same path every server read takes). */
export const checkDatabase: Check = async (env, deps, signal) => {
  await restGet<unknown[]>({ url: env.supabaseUrl, serviceKey: env.serviceKey, fetch: deps.fetch, signal }, "profiles?select=user_id&limit=1");
  return { ok: true, detail: "answers queries" };
};

/**
 * openrouter: GET /api/v1/key answers for any working key and costs nothing (no model is called).
 * It carries the key's own limit (`limit_remaining`, null for a key without one). The account's
 * balance comes from /api/v1/credits, which OpenRouter documents as management-key only: asked
 * beside it, used when it answers, ignored when it refuses. Credit left is the lower of the two
 * known values (whichever runs out first stops the calls); at $0 or below the check fails, since
 * every model call then answers 402.
 */
export const checkOpenRouter: Check = async (env, deps, signal) => {
  if (!env.openrouterKey) return { ok: false, code: "unconfigured", detail: "OPENROUTER_API_KEY is not set", creditsLeftUsd: null };
  const headers = { Authorization: `Bearer ${env.openrouterKey}`, "User-Agent": UA };
  const [keyRes, account] = await Promise.all([
    deps.fetch(OPENROUTER_KEY_URL, { headers, cache: "no-store", signal }),
    deps
      .fetch(OPENROUTER_ACCOUNT_CREDITS_URL, { headers, cache: "no-store", signal })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = ((await readJson(res)) as { data?: { total_credits?: unknown; total_usage?: unknown } } | null)?.data;
        const total = num(data?.total_credits);
        const used = num(data?.total_usage);
        return total !== null && used !== null ? total - used : null;
      })
      .catch(() => null),
  ]);
  const body = await readJson(keyRes);
  if (!keyRes.ok) {
    const failure = httpFailure("OpenRouter", keyRes.status, body);
    if (keyRes.status === 401) failure.detail = `key rejected (401)${providerMessage(body) ? `: ${providerMessage(body)}` : ""}`;
    return { ...failure, creditsLeftUsd: null };
  }
  const data = (body as { data?: Record<string, unknown> } | null)?.data ?? {};
  const known = [num(data.limit_remaining), account].filter((v): v is number => v !== null);
  const creditsLeftUsd = known.length ? Math.min(...known) : null;
  if (creditsLeftUsd === null) return { ok: true, detail: "key works; credit unknown (no key limit, and /credits needs a management key)", creditsLeftUsd };
  if (creditsLeftUsd <= 0) return { ok: false, code: "out_of_credit", detail: `out of credit (${creditsDetail(creditsLeftUsd)})`, creditsLeftUsd };
  return { ok: true, detail: creditsDetail(creditsLeftUsd), creditsLeftUsd };
};

/**
 * mathpix: POST /v3/app-tokens mints a short-lived client token. Mathpix's docs: "Requests to
 * create app tokens are free of charge." It proves the API answers and the app_key works, without
 * reading any ink (the strokes call is billed per request). The token is thrown away unread and
 * lives 30 s, the shortest Mathpix allows; no strokes session is asked for (those are billed).
 */
export const checkMathpix: Check = async (env, deps, signal) => {
  if (!env.mathpix) return { ok: false, code: "unconfigured", detail: "MATHPIX_APP_ID / MATHPIX_APP_KEY are not set" };
  const res = await deps.fetch(MATHPIX_APP_TOKENS_URL, {
    method: "POST",
    headers: { app_id: env.mathpix.appId, app_key: env.mathpix.appKey, "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ expires: 30 }),
    cache: "no-store",
    signal,
  });
  const body = await readJson(res);
  if (res.ok && typeof (body as { app_token?: unknown } | null)?.app_token === "string") return { ok: true, detail: "key works" };
  if (res.status === 401 || res.status === 403) return { ok: false, code: "unauthorized", detail: `keys rejected (${res.status})` };
  if (res.ok) return { ok: false, code: "invalid", detail: `Mathpix answered ${res.status} without a token${providerMessage(body) ? `: ${providerMessage(body)}` : ""}` };
  return httpFailure("Mathpix", res.status, body);
};

/** The domain of `Name <user@domain>` or `user@domain`, lower case. */
export function senderDomain(from: string): string | null {
  const m = /@([^\s<>@]+?)>?\s*$/.exec(from.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * email: GET /domains with RESEND_API_KEY. The key works, and the domain we send from is verified
 * (an unverified domain makes Resend refuse every email). A sending-only key may not list domains:
 * Resend answers 401 `restricted_api_key`, which still proves the key is valid, so that passes
 * with a note (the domain is then not checked).
 */
export const checkEmail: Check = async (env, deps, signal) => {
  if (!env.resendKey) return { ok: false, code: "unconfigured", detail: "RESEND_API_KEY is not set" };
  const res = await deps.fetch(RESEND_DOMAINS_URL, { headers: { Authorization: `Bearer ${env.resendKey}`, "User-Agent": UA }, cache: "no-store", signal });
  const body = await readJson(res);
  const name = (body as { name?: unknown } | null)?.name;
  if (res.status === 401 && name === "restricted_api_key") return { ok: true, detail: "key works (sending only, so the domain is not checked)" };
  if (!res.ok) {
    const failure = httpFailure("Resend", res.status, body);
    if (res.status === 401 || res.status === 403) failure.detail = `key rejected (${res.status})${providerMessage(body) ? `: ${providerMessage(body)}` : ""}`;
    return failure;
  }
  const domain = senderDomain(env.emailFrom);
  if (!domain) return { ok: false, code: "invalid", detail: `EMAIL_FROM has no domain: ${env.emailFrom.slice(0, 80)}` };
  const list = (body as { data?: unknown } | null)?.data;
  const found = Array.isArray(list) ? (list as Array<{ name?: unknown; status?: unknown }>).find((d) => typeof d.name === "string" && d.name.toLowerCase() === domain) : undefined;
  if (!found) return { ok: false, code: "unverified", detail: `${domain} is not in this Resend account` };
  if (found.status !== "verified") return { ok: false, code: "unverified", detail: `${domain} is ${typeof found.status === "string" ? found.status : "not verified"}` };
  return { ok: true, detail: `${domain} verified` };
};

function ago(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 120) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

/**
 * stripe: there is no Stripe API key on the server (sales are Payment Links), so this is judged
 * from our side. Fails when STRIPE_WEBHOOK_SECRET is unset (the webhook then refuses every event)
 * or when a webhook failure was recorded in the last STRIPE_FAILURE_WINDOW_MIN minutes (app_events
 * at level error whose kind or route names the webhook). No events at all is NOT a failure: a quiet
 * day has no purchases, so the time of the last one is only reported. Stripe itself emails the
 * account when an endpoint keeps failing, which covers a webhook we never hear from.
 */
export const checkStripe: Check = async (env, deps, signal) => {
  if (!env.stripeWebhookConfigured) return { ok: false, code: "unconfigured", detail: "STRIPE_WEBHOOK_SECRET is not set: every webhook is refused" };
  const rest: Rest = { url: env.supabaseUrl, serviceKey: env.serviceKey, fetch: deps.fetch, signal };
  const now = deps.now();
  const since = new Date(now.getTime() - STRIPE_FAILURE_WINDOW_MIN * 60_000).toISOString();
  const failuresQuery = new URLSearchParams({
    select: "at,kind,code,message",
    level: "eq.error",
    at: `gte.${since}`,
    or: "(kind.like.*webhook*,route.like.*webhook*)",
    order: "at.desc",
    limit: "50",
  });
  const [last, failures] = await Promise.all([
    restGet<Array<{ type: string | null; received_at: string }>>(rest, "billing_events?select=type,received_at&order=received_at.desc&limit=1"),
    restGet<Array<{ at: string; kind: string; code: string | null; message: string | null }>>(rest, `app_events?${failuresQuery}`),
  ]);
  const lastNote = last[0] ? `last event ${ago(now.getTime() - Date.parse(last[0].received_at))}${last[0].type ? ` (${last[0].type})` : ""}` : "no webhook events yet";
  if (failures.length) {
    const latest = failures[0];
    const what = (latest.message || latest.code || latest.kind).replace(/\s+/g, " ").slice(0, 120);
    return { ok: false, code: "failures", detail: `${failures.length}${failures.length >= 50 ? "+" : ""} webhook failure${failures.length === 1 ? "" : "s"} in the last ${STRIPE_FAILURE_WINDOW_MIN} min (latest: ${what}); ${lastNote}` };
  }
  return { ok: true, detail: lastNote };
};

export const CHECKS: Record<Service, Check> = {
  app: checkApp,
  database: checkDatabase,
  openrouter: checkOpenRouter,
  mathpix: checkMathpix,
  email: checkEmail,
  stripe: checkStripe,
};

// ------------------------------------------------------------------ running them

/**
 * One check under its own deadline. The abort reaches the fetch, and the race answers even when a
 * fetch ignores it (a test double, a stuck stream), so no check ever holds the run past its time.
 */
export async function runCheck(service: Service, check: Check, env: CheckEnv, deps: CheckDeps, at: string): Promise<CheckResult> {
  const timeoutMs = deps.timeoutMs ?? CHECK_TIMEOUT_MS;
  const controller = new AbortController();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<CheckOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, code: "timeout", detail: `no answer in ${Math.round(timeoutMs / 1000)} s` });
    }, timeoutMs);
  });
  let outcome: CheckOutcome;
  try {
    outcome = await Promise.race([check(env, deps, controller.signal).catch((err: unknown) => errorOutcome(err, timeoutMs)), deadline]);
  } finally {
    clearTimeout(timer);
  }
  const result: CheckResult = { service, ok: outcome.ok, latencyMs: Math.max(0, Date.now() - startedAt), detail: outcome.detail, at };
  if (outcome.code && !outcome.ok) result.code = outcome.code;
  if (outcome.needsDatabase && !outcome.ok) result.needsDatabase = true;
  if (outcome.creditsLeftUsd !== undefined) result.creditsLeftUsd = outcome.creditsLeftUsd;
  return result;
}

/** Every check at once, in SERVICES order. */
export async function runChecks(env: CheckEnv, deps: CheckDeps, checks: Record<Service, Check> = CHECKS): Promise<CheckResult[]> {
  const at = deps.now().toISOString();
  return Promise.all(SERVICES.map((service) => runCheck(service, checks[service], env, deps, at)));
}

/** What the route answers: exactly the contract's HealthResult. */
export function toHealthResult(result: CheckResult): HealthResult {
  const out: HealthResult = { service: result.service, ok: result.ok, latencyMs: result.latencyMs, at: result.at };
  if (result.detail !== undefined) out.detail = result.detail;
  return out;
}
