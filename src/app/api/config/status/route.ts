import { NextResponse } from 'next/server';
import { getConfigStatus } from '@/lib/aiConfig';
import { checkRateLimit, rateLimitedResponse } from '@/lib/server/rate-limit';

/**
 * Per-IP limit for this public endpoint (there is no user to key on). Generous:
 * the setup screen polls it a handful of times, and it only reflects env state.
 */
const CONFIG_STATUS_LIMIT = { limit: 60, windowMs: 60_000 } as const;

/** First hop of `x-forwarded-for` (Vercel sets it), else `x-real-ip`, else "unknown". */
function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Reports which AI providers this deployment has keys for.
 *
 * PUBLIC BY DESIGN (the only unauthenticated route; allow-listed in
 * scripts/lib/routes.mjs and enforced by src/__tests__/routeProtection.test.ts):
 * the setup screen needs it before anyone can sign in. Returns booleans and
 * setup metadata only — never key values, key prefixes, or key lengths.
 * Safe to call from the browser.
 */
export async function GET(req: Request) {
  const rl = checkRateLimit(`ip:${clientIp(req)}:configStatus`, CONFIG_STATUS_LIMIT);
  if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

  return NextResponse.json(getConfigStatus(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
