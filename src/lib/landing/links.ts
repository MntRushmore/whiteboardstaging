/**
 * Where the parent landing page sits and where it sends people (2026-10-09, Phase 2 "parents
 * recommend it"). Growth comes from parents telling parents: a shared link (`agathon.app/?ref=…`, a
 * post, a friend's text) used to drop a signed-out visitor straight onto the sign-in form. Now a
 * signed-out `/` goes to `/parents`, which says what Agathon is, and its "Start" buttons open the
 * sign-in page on its Sign up tab.
 *
 * Pure: no React, no network. Unit-tested in `__tests__/links.test.ts`.
 */

/** The landing page for grown-ups. */
export const LANDING_PATH = "/parents";

/** `?mode=signup` on /login opens the form on Sign up (LoginForm reads it with `wantsSignUp`). */
export const SIGN_UP_PARAM = "mode";
export const SIGN_UP_VALUE = "signup";
export const SIGN_UP_HREF = `/login?${SIGN_UP_PARAM}=${SIGN_UP_VALUE}`;
export const SIGN_IN_HREF = "/login";

/** True when the sign-in page was opened to make an account (`/login?mode=signup`). */
export function wantsSignUp(search: string | null | undefined): boolean {
  if (!search) return false;
  return new URLSearchParams(search).get(SIGN_UP_PARAM) === SIGN_UP_VALUE;
}

/**
 * Parameters an email link brings back to the site root (a sign-up confirmation, a magic link, or
 * the error of an expired one), in the query or the hash. A visitor with one of these came to sign
 * in, not to read about Agathon.
 */
const AUTH_PARAMS = ["code", "token_hash", "access_token", "refresh_token", "error", "error_code", "error_description"] as const;

function hasAuthParams(params: URLSearchParams): boolean {
  return AUTH_PARAMS.some((key) => params.has(key));
}

/**
 * Where a signed-out visitor to `/` goes. The landing page, keeping the query (`?ref=`, `utm_*`), so
 * a shared link still credits whoever shared it. A visitor back from an email link (a confirmation,
 * an expired link's error) goes to /login as before: they came to sign in.
 */
export function signedOutDestination(search: string | null | undefined, hash: string | null | undefined): string {
  const query = new URLSearchParams(search ?? "");
  const fragment = new URLSearchParams((hash ?? "").replace(/^#/, ""));
  if (hasAuthParams(query) || hasAuthParams(fragment)) return SIGN_IN_HREF;
  const kept = query.toString();
  return kept ? `${LANDING_PATH}?${kept}` : LANDING_PATH;
}

/** Where the page says it lives, for its Open Graph URL: NEXT_PUBLIC_SITE_URL when it is a usable http(s) origin, else production. */
export const PRODUCTION_ORIGIN = "https://agathon.app";

export function siteOrigin(value: string | null | undefined): string {
  if (!value?.trim()) return PRODUCTION_ORIGIN;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : PRODUCTION_ORIGIN;
  } catch {
    return PRODUCTION_ORIGIN;
  }
}
