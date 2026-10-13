/**
 * The `agathon_session` cookie (landing v3, docs/LANDING-V3.md "Root"): a flag that tells the server
 * this browser has someone signed in, so `/` serves the app instead of the landing page.
 *
 * Sign-in lives in localStorage (supabase-js), which the server never sees. next.config.ts rewrites
 * `/` to the landing page unless this cookie is there (or an email link's parameters are in the
 * query), so the app keeps it in step with supabase-js: set whenever there is a session, cleared on
 * sign-out (src/components/AuthProvider.tsx). It is a flag and nothing more: never a token, never
 * read for anything but which page `/` is. A forged one only gets the app's signed-out bounce.
 *
 * Pure strings and a tiny writer over a `{ cookie }` object, so the rules are unit-tested
 * (`__tests__/sessionCookie.test.ts`); links.ts has the same writer in ES5 for its inline scripts.
 * Kept small: AuthProvider, on every page, imports it.
 */

export const SESSION_COOKIE = "agathon_session";

/** 400 days: the longest a browser keeps a cookie (Chrome caps there; Safari keeps a script's for 7, renewed on every visit). */
export const SESSION_COOKIE_MAX_AGE = 34_560_000;

/** The cookie as `document.cookie` takes it: set (`on`) or cleared. `Secure` everywhere but plain http (localhost). */
export function sessionCookieString(on: boolean, secure: boolean): string {
  return `${SESSION_COOKIE}=${on ? "1" : ""}; Path=/; Max-Age=${on ? SESSION_COOKIE_MAX_AGE : 0}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/**
 * True when a `Cookie` header (or `document.cookie`) carries the flag with a value, which is what the
 * rewrite's `missing` cookie test sees too (Next counts an empty value as absent).
 */
export function hasSessionCookie(cookies: string | null | undefined): boolean {
  return new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=[^;\\s]`).test(cookies ?? "");
}

/**
 * Writes the flag (`on`) or clears it, and says whether `document.cookie` now agrees: false when
 * cookies are blocked, or when a copy the page cannot remove (another Domain) is still there. Never
 * throws: a sandboxed frame's `document.cookie` can.
 */
export function writeSessionCookie(doc: { cookie: string }, on: boolean, protocol: string): boolean {
  try {
    doc.cookie = sessionCookieString(on, protocol === "https:");
    return hasSessionCookie(doc.cookie) === on;
  } catch {
    return false;
  }
}

/** In the browser: the flag follows whether supabase-js has a session. No-op on the server. */
export function syncSessionCookie(on: boolean): boolean {
  if (typeof document === "undefined") return false;
  return writeSessionCookie(document, on, window.location.protocol);
}
