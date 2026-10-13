import { isLeaving, LEAVING_FLAG, markLeaving } from "./leaving";
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE, writeSessionCookie } from "./sessionCookie";

export { isLeaving, LEAVING_FLAG, markLeaving };

/**
 * Where the parent landing page sits and where it sends people (2026-10-09, Phase 2 "parents
 * recommend it"; landing v3 2026-10-12, docs/LANDING-V3.md "Root"). Growth comes from parents
 * telling parents: a shared link (`agathon.app/?ref=…`, a post, a friend's text) used to drop a
 * signed-out visitor straight onto the sign-in form. Now the landing page answers at `agathon.app/`
 * itself, and its "Start" buttons open the sign-in page on its Sign up tab.
 *
 * How `/` is two pages:
 * - The server (next.config.ts, `ROOT_LANDING_REWRITE`) serves the landing page at `/` to a request
 *   with no `agathon_session` cookie and no email-link parameters in the query; anyone else gets the
 *   app (the boards home). The cookie is a flag the app keeps in step with supabase-js
 *   (sessionCookie.ts, AuthProvider).
 * - A device signed in from before the cookie existed lands on the landing page once: its
 *   `SESSION_HOP_SCRIPT` sets the cookie and reloads, and the server then serves the app.
 * - The boards home, finding nobody signed in, clears the cookie and reloads `/`
 *   (`SIGNED_OUT_GATE_SCRIPT` before paint, `leaveSignedOut` after auth loads), so the server serves
 *   the landing page; it falls back to /parents whenever that could come back to the app.
 *
 * Pure apart from the two `window` helpers at the end. Unit-tested in `__tests__/links.test.ts`,
 * the inline scripts against these same rules.
 */

/** Where links to the landing page point: the site root, which is the landing page for anyone signed out (and the app for anyone signed in). */
export const LANDING_PATH = "/";

/** The route that renders the landing page. `/` is rewritten to it; it also answers at its own address, the fallback when `/` cannot be the landing page. */
export const LANDING_ROUTE = "/parents";

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
export const AUTH_PARAMS = ["code", "token_hash", "access_token", "refresh_token", "error", "error_code", "error_description"] as const;

/** True when the query or the hash carries an email link's parameters. */
export function hasAuthParams(search: string | null | undefined, hash: string | null | undefined): boolean {
  const query = new URLSearchParams(search ?? "");
  const fragment = new URLSearchParams((hash ?? "").replace(/^#/, ""));
  return AUTH_PARAMS.some((key) => query.has(key) || fragment.has(key));
}

/**
 * next.config.ts's `beforeFiles` rewrite: `/` is the landing page when the request has no session
 * flag and no email-link parameter in its query (Next and Vercel apply a rewrite only when every
 * `missing` item is absent; an empty value counts as absent). The query rides along, so `?ref=` and
 * `utm_*` reach the page. The hash never reaches a server: `SESSION_HOP_SCRIPT` handles it.
 */
export const ROOT_LANDING_REWRITE = {
  source: "/",
  destination: LANDING_ROUTE,
  missing: [
    { type: "cookie" as const, key: SESSION_COOKIE },
    ...AUTH_PARAMS.map((key) => ({ type: "query" as const, key })),
  ],
};

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
 * sessionStorage (this tab only) marks for the trips between the two pages at `/`, so no trip can
 * repeat itself:
 * - `ROOT_RELOAD_KEY`: the boards home reloaded `/` to show the landing page. The landing page clears
 *   it; if the app comes back instead (a cookie the page cannot see, a cache that ignores it), the
 *   next signed-out exit goes to /parents.
 * - `HOP_KEY`: when the landing page last reloaded `/` to reach the app. It hops again only
 *   `HOP_PAUSE_MS` later, so a device whose stored session does not get it in hops once, not forever.
 */
export const ROOT_RELOAD_KEY = "agathon.rootReload";
export const HOP_KEY = "agathon.sessionHop";
export const HOP_PAUSE_MS = 10 * 60 * 1000;

/**
 * `writeSessionCookie(document, on, location.protocol)` (sessionCookie.ts) in ES5, as `function(on){…}`,
 * for the inline scripts below. Tested against the TS writer in `__tests__/sessionCookie.test.ts`.
 */
export const WRITE_SESSION_COOKIE_ES5 =
  `function(on){try{document.cookie=${JSON.stringify(`${SESSION_COOKIE}=`)}+(on?"1":"")+"; Path=/; Max-Age="+(on?${SESSION_COOKIE_MAX_AGE}:0)+` +
  `"; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"");` +
  `return /(?:^|;\\s*)${SESSION_COOKIE}=[^;\\s]/.test(document.cookie)===on}catch(e){return false}}`;

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Whether a signed-out boards home may reload `/` to get the landing page there: the session flag is
 * cleared (and the page can see that it is), the reload can be marked, and no earlier reload from this
 * tab came back to the app. Otherwise the visitor goes to /parents, which never sends anyone back.
 */
export function prepareRootReload(doc: { cookie: string }, protocol: string, session: SessionStore | null): boolean {
  try {
    if (!session) return false;
    if (session.getItem(ROOT_RELOAD_KEY)) {
      session.removeItem(ROOT_RELOAD_KEY);
      return false;
    }
    if (!writeSessionCookie(doc, false, protocol)) return false;
    session.setItem(ROOT_RELOAD_KEY, "1");
    return session.getItem(ROOT_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

/** `prepareRootReload(document, location.protocol, sessionStorage)` in ES5, as `function(){…}`, for the gate. */
const PREPARE_ROOT_RELOAD_ES5 =
  `function(){try{var s=window.sessionStorage;if(!s)return false;var k=${JSON.stringify(ROOT_RELOAD_KEY)};` +
  `if(s.getItem(k)){s.removeItem(k);return false}if(!(${WRITE_SESSION_COOKIE_ES5})(false))return false;` +
  `s.setItem(k,"1");return s.getItem(k)==="1"}catch(e){return false}}`;

/**
 * Where a signed-out visitor to `/` goes. An email link's visitor (a confirmation, an expired link's
 * error) goes to /login: they came to sign in. Anyone else gets the landing page with the query and
 * hash kept (`?ref=` still credits whoever shared the link): at `/` itself when `rootReload()` says
 * the reload is safe, else at /parents.
 */
export function signedOutDestination(search: string | null | undefined, hash: string | null | undefined, rootReload: () => boolean): string {
  if (hasAuthParams(search, hash)) return SIGN_IN_HREF;
  return `${rootReload() ? LANDING_PATH : LANDING_ROUTE}${search ?? ""}${hash ?? ""}`;
}

/**
 * Where a visitor to the boards home goes before anything paints, or null to let the page decide once
 * auth has loaded. A device with no stored session is signed out for certain, so a shared link
 * (`/?ref=…`) goes straight to the landing page with its query and hash, instead of showing the
 * boards home's skeleton while the app's script loads (0.5 s on wifi, 4 s on a slow phone). A device
 * with a session, or an email link's tokens in the address (supabase-js signs them in), waits.
 */
export function earlySignedOutDestination(keys: Iterable<string | null>, search: string, hash: string, rootReload: () => boolean): string | null {
  if (hasStoredSession(keys)) return null;
  if (hasAuthParams(search, hash)) return null;
  return signedOutDestination(search, hash, rootReload);
}

/**
 * `earlySignedOutDestination` as an inline script, for the boards home's server HTML: it runs while
 * the page is still being read, before the first paint, and leaves with the page hidden so no frame
 * of the app shows. The landing page at `/` is the same address, so it reloads (a `location.replace`
 * to the same address with a hash would only scroll). Self-contained ES5; the same rules as above
 * (tested against each other in `__tests__/links.test.ts`). Storage that cannot be read: it does
 * nothing, and the page's own check after auth loads (`leaveSignedOut`) still sends the visitor on.
 */
export const SIGNED_OUT_GATE_SCRIPT =
  `(function(){try{if(window.${LEAVING_FLAG})return;var s=window.localStorage;for(var i=0;i<s.length;i++){if(${STORED_SESSION_KEY}.test(s.key(i)||""))return}` +
  `var a=${JSON.stringify(AUTH_PARAMS)},q=new URLSearchParams(location.search),h=new URLSearchParams(location.hash.slice(1));` +
  `for(var j=0;j<a.length;j++){if(q.has(a[j])||h.has(a[j]))return}` +
  `var to=((${PREPARE_ROOT_RELOAD_ES5})()?${JSON.stringify(LANDING_PATH)}:${JSON.stringify(LANDING_ROUTE)})+location.search+location.hash;` +
  `window.${LEAVING_FLAG}=1;document.documentElement.style.visibility="hidden";` +
  `if(to===location.pathname+location.search+location.hash)location.reload();else location.replace(to)}catch(e){}})();`;

/**
 * Whether the landing page, served at `/`, should go round once more to reach the app: this device
 * keeps a Supabase session (or an email link's tokens are in the hash, which no server sees), and it
 * has not done so in the last `HOP_PAUSE_MS`. Never on /parents, which is the landing page whatever
 * the cookie says (it would reload forever).
 */
export function shouldHop(pathname: string, keys: Iterable<string | null>, hash: string, lastHop: number, now: number): boolean {
  if (pathname !== LANDING_PATH) return false;
  if (!hasStoredSession(keys) && !hasAuthParams("", hash)) return false;
  return !(lastHop && Math.abs(now - lastHop) < HOP_PAUSE_MS);
}

/**
 * The landing page's first script (SessionHop.tsx): `shouldHop`, then the cookie and a reload, so the
 * server serves the app at the same address. It stays put when the cookie or the tab's storage cannot
 * be written (the reload would bring the landing page back). Wherever the landing page shows, it
 * clears `ROOT_RELOAD_KEY`: a signed-out reload arrived. Self-contained ES5.
 */
export const SESSION_HOP_SCRIPT =
  `(function(){try{var ss=window.sessionStorage;ss.removeItem(${JSON.stringify(ROOT_RELOAD_KEY)});` +
  `if(location.pathname!==${JSON.stringify(LANDING_PATH)})return;var on=false,s=window.localStorage;` +
  `for(var i=0;i<s.length;i++){if(${STORED_SESSION_KEY}.test(s.key(i)||"")){on=true;break}}` +
  `if(!on){var a=${JSON.stringify(AUTH_PARAMS)},h=new URLSearchParams(location.hash.slice(1));for(var j=0;j<a.length;j++){if(h.has(a[j])){on=true;break}}}` +
  `if(!on)return;var k=${JSON.stringify(HOP_KEY)},t=Number(ss.getItem(k))||0,n=Date.now();if(t&&Math.abs(n-t)<${HOP_PAUSE_MS})return;` +
  `ss.setItem(k,String(n));if(ss.getItem(k)!==String(n))return;if(!(${WRITE_SESSION_COOKIE_ES5})(true))return;` +
  `document.documentElement.style.visibility="hidden";location.reload()}catch(e){}})();`;

/**
 * The boards home once auth has loaded with nobody signed in (and no error reaching the sign-in
 * service): leaves for `signedOutDestination`, the landing page at `/` by a reload (the server decides
 * what `/` is), anything else by `navigate` (the router). Never after the gate has left; the page
 * calls it once per mount.
 */
export function leaveSignedOut(navigate: (to: string) => void): void {
  if (isLeaving()) return;
  const { location } = window;
  const to = signedOutDestination(location.search, location.hash, () => {
    let session: SessionStore | null = null;
    try {
      session = window.sessionStorage;
    } catch {
      session = null;
    }
    return prepareRootReload(document, location.protocol, session);
  });
  if (to === `${location.pathname}${location.search}${location.hash}`) {
    markLeaving(true);
    location.reload();
  } else {
    navigate(to);
  }
}

/**
 * Into the app at `path` once someone has just signed in: `/` by a full page load, anything else by
 * `navigate` (the router). `/` is two pages and the server picks one by the
 * cookie, but the router picks from its own cache: having shown or prefetched `/` as the landing page
 * while signed out, it would show the landing page again after sign-in (seen in Chromium: the cookie
 * set, the landing page on screen). A full load asks the server.
 */
export function enterRoot(path: string, navigate: (to: string) => void): void {
  if (new URL(path, window.location.href).pathname !== LANDING_PATH) {
    navigate(path);
    return;
  }
  if (isLeaving()) return;
  markLeaving(true);
  window.location.replace(path);
}

/** Where the page says it lives, for its Open Graph URL: NEXT_PUBLIC_SITE_URL when it is a usable http(s) origin, else production. */
export const PRODUCTION_ORIGIN = "https://www.agathon.app";

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
