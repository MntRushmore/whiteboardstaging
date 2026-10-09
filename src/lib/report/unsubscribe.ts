/**
 * The Sunday email's one-tap "stop these emails" link: GET /api/report/unsubscribe?u=<user id>&t=<tag>.
 * The reader may not be signed in on the device that opens the email (a phone's mail app), so the
 * link itself is the proof: `t` is an HMAC-SHA256 of the user id under a server secret (CRON_SECRET,
 * which every deployment that sends this email already has, since the email goes out from the cron).
 * Nobody can stop someone else's email without the secret, and a link never expires: an old email's
 * link still works, as the law on unsubscribe links expects.
 *
 * What the link can do is narrow on purpose: it only TURNS OFF the email (profiles
 * weekly_report_opt_out = true). Turning it back on needs the grown-up signed in, on /report.
 *
 * Server-only (node:crypto, and the secret).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";

/** What is signed, so a tag made for this link can never be replayed as some other signature. */
const PURPOSE = "agathon:weekly-report:unsubscribe:v1";

export const UNSUBSCRIBE_API = "/api/report/unsubscribe";

const UserId = z.string().uuid();
const TAG_RE = /^[A-Za-z0-9_-]{43}$/;

/** The tag for `userId` (43 base64url characters). */
export function unsubscribeTag(userId: string, secret: string): string {
  if (!secret) throw new Error("no secret to sign the unsubscribe link with");
  return createHmac("sha256", secret).update(`${PURPOSE}:${userId.toLowerCase()}`).digest("base64url");
}

/** The link for `userId`, on `siteUrl` (an absolute origin). */
export function unsubscribeUrl(siteUrl: string, userId: string, secret: string): string {
  const url = new URL(UNSUBSCRIBE_API, siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`);
  url.searchParams.set("u", userId);
  url.searchParams.set("t", unsubscribeTag(userId, secret));
  return url.toString();
}

/** The user id a link was made for, when its tag is right (compared in constant time); else null. */
export function verifyUnsubscribe(u: unknown, t: unknown, secret: string | undefined): string | null {
  if (!secret) return null;
  const id = UserId.safeParse(u);
  if (!id.success || typeof t !== "string" || !TAG_RE.test(t)) return null;
  const expected = Buffer.from(unsubscribeTag(id.data, secret));
  const given = Buffer.from(t);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id.data.toLowerCase() : null;
}

/** The signing secret: CRON_SECRET (trimmed), or undefined where it is not set (the route answers 503). */
export function unsubscribeSecret(): string | undefined {
  return getServerEnv().CRON_SECRET?.trim() || undefined;
}
