/**
 * The Sunday email's "stop these emails" link: /api/report/unsubscribe?u=<user id>&t=<tag>.
 * The reader may not be signed in on the device that opens the email (a phone's mail app), so the
 * link itself is the proof: `t` is an HMAC-SHA256 of the user id under a server secret of its own,
 * REPORT_LINK_SECRET (else CRON_SECRET, which every deployment that sends this email already has).
 * Nobody can stop someone else's email without the secret.
 *
 * A link has no expiry, so an old email's link keeps working, as the law on unsubscribe links
 * expects (CAN-SPAM: at least 30 days). That holds across a change of secret only while the old one
 * is kept: tags signed with REPORT_LINK_SECRET_PREVIOUS are accepted too, so a rotation moves the old
 * value there for at least 30 days (docs/RUNBOOK-ops.md, "Rotating CRON_SECRET").
 *
 * What the link can do is narrow on purpose: it only TURNS OFF the email (profiles
 * weekly_report_opt_out = true), and only on a POST (the confirm page's button, or a mail app's
 * RFC 8058 one-click), never on the GET a link scanner makes. Turning it back on needs the grown-up
 * signed in, on /report.
 *
 * Server-only (node:crypto, and the secret).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getServerEnv, type ServerEnv } from "@/lib/env";

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

/** The link's path and query for `userId` and its tag (the confirm page's form posts to it). */
export function unsubscribePath(userId: string, tag: string): string {
  return `${UNSUBSCRIBE_API}?${new URLSearchParams({ u: userId, t: tag })}`;
}

/** The link for `userId`, on `siteUrl` (an absolute origin). */
export function unsubscribeUrl(siteUrl: string, userId: string, secret: string): string {
  return new URL(unsubscribePath(userId, unsubscribeTag(userId, secret)), siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`).toString();
}

/**
 * The user id a link was made for, when its tag is right under any of `secrets` (each compared in
 * constant time); else null.
 */
export function verifyUnsubscribe(u: unknown, t: unknown, secrets: string | readonly string[] | null | undefined): string | null {
  const keys = (typeof secrets === "string" ? [secrets] : (secrets ?? [])).filter(Boolean);
  if (keys.length === 0) return null;
  const id = UserId.safeParse(u);
  if (!id.success || typeof t !== "string" || !TAG_RE.test(t)) return null;
  const given = Buffer.from(t);
  let ok = false;
  for (const key of keys) {
    const expected = Buffer.from(unsubscribeTag(id.data, key));
    // every key is tried, so the time taken does not say which one matched
    if (expected.length === given.length && timingSafeEqual(expected, given)) ok = true;
  }
  return ok ? id.data.toLowerCase() : null;
}

/** The link's secrets: `sign` makes new links; `accept` (`sign` first) verifies them. */
export type ReportLinkSecrets = { sign: string; accept: readonly string[] };

type LinkSecretEnv = Pick<ServerEnv, "REPORT_LINK_SECRET" | "REPORT_LINK_SECRET_PREVIOUS" | "CRON_SECRET">;

/**
 * From the server env: REPORT_LINK_SECRET, else CRON_SECRET, signs (both trimmed); a link signed
 * with REPORT_LINK_SECRET_PREVIOUS still verifies. Null when neither secret is set (the route then
 * answers 503, and the email is not sent).
 */
export function reportLinkSecrets(env: LinkSecretEnv = getServerEnv()): ReportLinkSecrets | null {
  const sign = env.REPORT_LINK_SECRET?.trim() || env.CRON_SECRET?.trim();
  if (!sign) return null;
  const previous = env.REPORT_LINK_SECRET_PREVIOUS?.trim();
  return { sign, accept: previous && previous !== sign ? [sign, previous] : [sign] };
}
