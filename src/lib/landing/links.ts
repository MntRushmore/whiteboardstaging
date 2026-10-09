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

/**
 * The key supabase-js keeps a signed-in session under in localStorage: `sb-<project ref>-auth-token`
 * (its default storage key; src/lib/supabase.ts does not change it).
 */
export const STORED_SESSION_KEY = /^sb-.+-auth-token$/;

/** True when this device keeps a Supabase session: someone may be signed in, so `/` waits for auth. */
export function hasStoredSession(keys: Iterable<string | null>): boolean {
  for (const key of keys) if (key && STORED_SESSION_KEY.test(key)) return true;
  return false;
}

/**
 * Where a visitor to `/` goes before anything paints, or null to let the page decide once auth has
 * loaded. A device with no stored session is signed out for certain, so a shared link
 * (`/?ref=…`) goes straight to the landing page with its query and hash, instead of showing the
 * boards home's skeleton while the app's script loads (0.5 s on wifi, 4 s on a slow phone). A device
 * with a session, or an email link's tokens in the address (supabase-js signs them in), waits.
 */
export function earlySignedOutDestination(keys: Iterable<string | null>, search: string, hash: string): string | null {
  if (hasStoredSession(keys)) return null;
  if (hasAuthParams(new URLSearchParams(search)) || hasAuthParams(new URLSearchParams(hash.replace(/^#/, "")))) return null;
  return `${LANDING_PATH}${search}${hash}`;
}

/**
 * `earlySignedOutDestination` as an inline script, for `/`'s server HTML: it runs while the page is
 * still being read, before the first paint, and leaves (`location.replace`) with the page hidden so
 * no frame of the app shows. Self-contained ES5; the same rules as above (tested against each other in
 * `__tests__/links.test.ts`). Storage that cannot be read: it does nothing, and the page's own check
 * after auth loads still sends the visitor on.
 */
export const SIGNED_OUT_GATE_SCRIPT =
  `(function(){try{var s=window.localStorage;for(var i=0;i<s.length;i++){if(${STORED_SESSION_KEY}.test(s.key(i)||""))return}` +
  `var a=${JSON.stringify(AUTH_PARAMS)},q=new URLSearchParams(location.search),h=new URLSearchParams(location.hash.slice(1));` +
  `for(var j=0;j<a.length;j++){if(q.has(a[j])||h.has(a[j]))return}` +
  `document.documentElement.style.visibility="hidden";location.replace(${JSON.stringify(LANDING_PATH)}+location.search+location.hash)}catch(e){}})();`;

/** Where the page says it lives, for its Open Graph URL: NEXT_PUBLIC_SITE_URL when it is a usable http(s) origin, else production. */
export const PRODUCTION_ORIGIN = "https://agathon.app";

/** Hosts .env.example ships as placeholders: a build that kept one must not put it in a link preview. */
const PLACEHOLDER_HOST = /(^|\.)(your-app\.up\.railway\.app|example\.(com|org|net)|your-domain\.[a-z]+)$/i;

export function siteOrigin(value: string | null | undefined): string {
  if (!value?.trim()) return PRODUCTION_ORIGIN;
  try {
    const url = new URL(value.trim());
    if (PLACEHOLDER_HOST.test(url.hostname) || url.hostname.startsWith("your-")) return PRODUCTION_ORIGIN;
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : PRODUCTION_ORIGIN;
  } catch {
    return PRODUCTION_ORIGIN;
  }
}
