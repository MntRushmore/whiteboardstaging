/**
 * The guards of POST /api/start/step (src/lib/start/contracts.ts `START_STEP_API`): a public route
 * a signed-out visitor's page calls, so what stands in for a session is the page being ours (the
 * same-origin check), a capped body, and limits per visitor (by IP, in memory) and per day (in the
 * database: `step.ts`). The same guards as the try board's routes (/api/try/*), which were built
 * alongside: once both have landed they can share one module.
 *
 * Errors are JSON `{ error, retryAfterMs? }`, like the try routes': `invalid_request`,
 * `rate_limited` (with `retryAfterMs`) and `unavailable`.
 */
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { clientIp } from "@/lib/server/rate-limit";

export const startLogger = logger.child({ module: "start" });

export type StartStepError = "invalid_request" | "rate_limited" | "unavailable";

/** The hosts /start is served from (next.config.ts: www is canonical; the old host still answers /api). */
export const START_HOSTS: readonly string[] = ["www.agathon.app", "agathon.app", "whiteboard.rushilchopra.com"];
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `{ error, retryAfterMs? }`, never cached; a 429 also says Retry-After. */
export function startError(status: number, error: StartStepError, retryAfterMs?: number): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterMs !== undefined) headers["Retry-After"] = String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
  return Response.json(retryAfterMs === undefined ? { error } : { error, retryAfterMs: Math.max(0, Math.round(retryAfterMs)) }, { status, headers });
}

function siteHost(): string | null {
  try {
    const url = getServerEnv().NEXT_PUBLIC_SITE_URL;
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

/**
 * The request comes from one of our own pages. A browser says so itself (`Sec-Fetch-Site:
 * same-origin`), and any other value it sends (`cross-site`, `same-site`, `none`) is refused. One
 * too old to send the header still sends `Origin` on a POST: it must be the request's own host, or
 * one of ours (`START_HOSTS`, NEXT_PUBLIC_SITE_URL's), over https — or localhost outside
 * production. Neither header (curl, a server) is refused.
 *
 * Not authentication — anything that is not a browser can send these headers — but it keeps other
 * sites from writing steps from their visitors' browsers; the limits are what hold a script back.
 */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const dev = process.env.NODE_ENV !== "production";
  if (LOCAL_HOSTS.has(url.hostname)) return dev;
  if (url.protocol !== "https:" && !dev) return false;
  const own = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return url.host === own || START_HOSTS.includes(url.hostname) || url.host === siteHost();
}

const IP = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * The visitor, for the per-visitor limit: `cf-connecting-ip` first (www.agathon.app sits behind
 * Cloudflare, so Vercel's x-forwarded-for is a Cloudflare edge shared by many visitors), else the
 * first hop of x-forwarded-for (`clientIp`). Only ever a key in this instance's memory: never
 * logged, never stored. A request that reaches Vercel without Cloudflare can choose its own
 * `cf-connecting-ip`, and so its own bucket: the day's cap (`step.ts`) is what bounds that.
 */
export function visitorIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  return cf && IP.test(cf) ? cf : clientIp(req);
}

/** The body as text, or null once it passes `max` bytes (Content-Length first, then while reading). */
export async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length")) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** JSON or undefined (which no schema accepts). */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
