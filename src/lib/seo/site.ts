/**
 * The site as search engines and AI crawlers see it (SEO build 2026-10-13, docs/SEO.md): where it
 * lives, what it is called, which crawlers we name in robots.txt and which paths they stay out of.
 * robots.ts, sitemap.ts, manifest.ts, the root layout's metadata and IndexNow all read this file.
 *
 * Pure data and helpers: no React, no network.
 */
import { siteOrigin } from "@/lib/landing/links";
import { ABOUT_PATH, LEGAL_PATHS, MATH_PATH } from "./routes";

/**
 * Where every page lives: NEXT_PUBLIC_SITE_URL (https://www.agathon.app in production, the
 * canonical host since 2026-10-09), else production. Inlined at build time.
 */
export const SITE_ORIGIN = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL);

/** `path` on the site, absolute ("/" is the origin with its slash). */
export function absoluteUrl(path: string, origin: string = SITE_ORIGIN): string {
  return new URL(path, `${origin}/`).toString();
}

export const SITE_NAME = "Agathon";

/**
 * What Agathon is, for any page that does not say more (the root layout's description, the web
 * manifest). The landing page's own facts (copy.ts): a whiteboard, kids write by hand, the tutor
 * checks every line and answers questions; kindergarten to 8th grade, then high school courses.
 * No price or trial here: those come from the plan on the pages that say them.
 */
export const SITE_DESCRIPTION =
  "Agathon is an AI math tutor on a whiteboard for kindergarten to 8th grade and high school. Kids write by hand, and the tutor checks every line.";

/** The site's language, as Open Graph and schema.org write it. */
export const SITE_LOCALE = "en_US";
export const SITE_LANGUAGE = "en-US";

/** Open Graph defaults for every page (a page that sets `openGraph` replaces the whole object, so it spreads these first). */
export const OPEN_GRAPH_DEFAULTS = { siteName: SITE_NAME, locale: SITE_LOCALE, type: "website" } as const;

/**
 * The brand's colors. The mark is drawn in the logo's green (scripts/brand-icons.mjs); the browser
 * chrome and the installed app's splash take the landing page's own background (Arc's
 * `--background`, white), as the root layout's `viewport.themeColor` does.
 */
export const BRAND_GREEN = "#13403B";
export const THEME_COLOR = "#ffffff";

/** The logo answer engines and search show for Agathon: a stable address (no build hash), 512 px PNG. */
export const LOGO_PATH = "/icons/icon-512.png";

// ------------------------------------------------------------------ robots.txt

/**
 * The crawlers we name and welcome, search and AI alike (a named group is what a site owner writes
 * to say "yes, you"; the `*` group covers everyone else with the same rules):
 * - search: Googlebot, Bingbot (Bing also feeds ChatGPT search and Copilot), Applebot, Amazonbot
 * - AI search and answers: OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User,
 *   PerplexityBot, Perplexity-User, DuckAssistBot, MistralAI-User
 * - AI training and grounding: GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot
 *   (Common Crawl, which open models learn from), meta-externalagent
 */
export const CRAWLERS = [
  "Googlebot",
  "Bingbot",
  "Google-Extended",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot",
  "Applebot-Extended",
  "CCBot",
  "Amazonbot",
  "DuckAssistBot",
  "meta-externalagent",
  "MistralAI-User",
] as const;

/**
 * The public pages and what they load, said out loud (everything is allowed unless disallowed; these
 * keep the public parts open should a broader Disallow ever be added). `/login` is not listed but
 * stays crawlable: it is `noindex, follow`, so its links are followed.
 */
export const PUBLIC_PATHS = [
  "/",
  "/parents",
  MATH_PATH,
  ABOUT_PATH,
  ...LEGAL_PATHS,
  "/llms.txt",
  "/llms-full.txt",
  "/_next/",
] as const;

/**
 * The app: every route under src/app and src/app/(platform) that is someone's own (boards, progress,
 * reports, the account, the family, the admin console), the API, and the internal training page.
 * Prefixes: `/report` also covers `/report/replay/…`; `/reports` is listed on its own anyway.
 * A test lists src/app's routes and fails when a new one is neither here nor public.
 */
export const PRIVATE_PATHS = [
  "/account",
  "/admin",
  "/api",
  "/board",
  "/family",
  "/progress",
  "/report",
  "/reports",
  "/reset-password",
  "/train",
  "/welcome",
] as const;

export interface RobotsGroup {
  userAgent: string;
  allow: string[];
  disallow: string[];
}

/**
 * One group per crawler, then `*`, all with the same lines: a crawler that finds a group naming it
 * reads only that group and ignores `*`, so every group must carry every Disallow.
 */
export function robotsGroups(): RobotsGroup[] {
  const rules = { allow: [...PUBLIC_PATHS], disallow: [...PRIVATE_PATHS] };
  return [{ userAgent: "*", ...rules }, ...CRAWLERS.map((userAgent) => ({ userAgent, ...rules }))];
}

// ------------------------------------------------------------------ search console verification

/**
 * The verification meta tags for Google Search Console and Bing Webmaster Tools, from the
 * environment (GOOGLE_SITE_VERIFICATION, BING_SITE_VERIFICATION), each only when it is set. Read at
 * build time: set them in Vercel, then redeploy.
 */
export function verificationCodes(env: Record<string, string | undefined>): { google?: string; other?: Record<string, string> } {
  const google = env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = env.BING_SITE_VERIFICATION?.trim();
  return {
    ...(google ? { google } : {}),
    ...(bing ? { other: { "msvalidate.01": bing } } : {}),
  };
}
