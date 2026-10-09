/**
 * The site a link a family sends on points at: the referral card's invite (summary.ts) and the share
 * card's footer (src/components/share/readShareExtras.ts), so the two always agree. No zod and no
 * React: the share sheet loads it on the tap. Pure (no browser API at module scope).
 */

/** A page on this machine (a dev server): its links should open on the same dev server. */
function isLocalOrigin(origin: string | null | undefined): boolean {
  try {
    return typeof origin === "string" && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * A template's stand-in address left in an env file ("https://your-app.up.railway.app"): never a
 * real site, so never baked into a link a family sends on.
 */
export function isPlaceholderHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return /^your[-_]?(app|site|domain|project)\b/.test(host) || /(^|[.-])(placeholder|changeme)([.-]|$)/.test(host);
}

/**
 * Where links point: NEXT_PUBLIC_SITE_URL when it is an absolute http(s) address (the canonical
 * site, whichever alias the grown-up is on) and not a template's placeholder, else the page's
 * origin. A page on localhost uses its own origin first, so a link made on a dev server can be
 * tried there. Trailing slashes are dropped. Null when neither is usable (no link is better than a
 * broken one).
 */
export function siteBase(siteUrl: string | null | undefined, origin: string | null | undefined): string | null {
  const order = isLocalOrigin(origin) ? [origin, siteUrl] : [siteUrl, origin];
  for (const candidate of order) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      const url = new URL(candidate.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (isPlaceholderHost(url.hostname)) continue;
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
      // not a URL: try the next
    }
  }
  return null;
}
