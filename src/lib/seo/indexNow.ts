/**
 * IndexNow (https://www.indexnow.org): one POST tells Bing, Yandex, Seznam, Naver and the others
 * which pages changed, instead of waiting for their crawlers to come round. Bing's index is what
 * ChatGPT search and Copilot read, so this is how a new page reaches them first.
 *
 * The key proves the site is ours: the same 32 hex characters are served as plain text at
 * `/<key>.txt` (public/), and every submission names that file. The key is not a secret: anyone can
 * read it there, and it only lets someone ask the engines to re-crawl our own pages.
 *
 * Submit after a deploy, once the pages are live: `node scripts/indexnow.mjs` (docs in the script).
 *
 * Pure: no network. Unit-tested in `__tests__/core.test.ts`.
 */
import { publicPages } from "./routes";
import { SITE_ORIGIN, absoluteUrl } from "./site";

/** The site's IndexNow key; public/<key>.txt holds the same characters. */
export const INDEXNOW_KEY = "1bd86224076d8423dc08b1dd44cc95c1";

/** The shared endpoint: it passes each submission on to every engine that takes part. */
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** At most this many addresses per POST (the protocol's limit). */
export const INDEXNOW_MAX_URLS = 10_000;

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/**
 * The submission for `paths` on `origin` (by default every public page on the canonical host). Every
 * address must be on `host`, or the engines refuse the whole list.
 */
export function indexNowPayload(
  paths: readonly string[] = publicPages().map((p) => p.path),
  origin: string = SITE_ORIGIN,
): IndexNowPayload {
  const host = new URL(origin).host;
  const urlList = [...new Set(paths.map((p) => absoluteUrl(p, origin)))];
  if (urlList.length > INDEXNOW_MAX_URLS) throw new Error(`IndexNow takes at most ${INDEXNOW_MAX_URLS} addresses per submission`);
  for (const url of urlList) if (new URL(url).host !== host) throw new Error(`${url} is not on ${host}`);
  return { host, key: INDEXNOW_KEY, keyLocation: absoluteUrl(`/${INDEXNOW_KEY}.txt`, origin), urlList };
}
