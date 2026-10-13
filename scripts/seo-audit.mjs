#!/usr/bin/env node
/**
 * The SEO crawler (docs/SEO.md, "AI search"): reads a built site the way search engines and AI
 * crawlers do, and checks every public page.
 *
 *   node scripts/seo-audit.mjs [baseUrl=http://localhost:3000] [--json report.json]
 *
 * - Fetches /robots.txt and /sitemap.xml (a warning, not a stop, when either is missing). The URL list
 *   is the sitemap's (each URL's path, fetched from `baseUrl`, so a local build can be audited against
 *   a sitemap that names production), or else every public page from src/lib/seo/routes.ts; plus
 *   /llms.txt.
 * - Fetches each page as Googlebot and as GPTBot, with no cookies, and checks: status 200 (no
 *   redirect); not noindex (meta robots, the crawler's own meta, X-Robots-Tag); a <title> (warns over
 *   60 characters); a meta description (warns outside 70–160); a canonical whose path is the page's
 *   own; exactly one <h1>; every JSON-LD block parses, has @context and @type, and has no
 *   aggregateRating or review; og:title and og:image; an alt on every <img>; at least 250 words of
 *   visible text (a warning); every same-origin <a href> resolves (HEAD, else GET; cached); titles
 *   and descriptions unique across pages.
 * - Checks robots.txt lets search and AI crawlers read every sitemap URL, and that every link in
 *   llms.txt resolves.
 * - Prints a compact table and the issues grouped by kind, writes the whole report as JSON with
 *   `--json <file>`, and exits 1 when there is an error (2 when the site cannot be reached).
 *
 * Node built-ins plus the HTML parser Next already ships (next/dist/compiled/node-html-parser): no
 * dependency of its own. The pure parts are exported for the unit tests (src/lib/seo/__tests__);
 * the crawl runs only when this file is the entry script.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { parse: parseHtml } = require("next/dist/compiled/node-html-parser");

// ------------------------------------------------------------------ settings

/** The two crawlers every page is fetched as: the search index and the model trainer. */
export const AGENTS = {
  Googlebot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.6778.204 Safari/537.36",
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
};

/** Crawlers robots.txt must let read every sitemap page (an error otherwise): search, and the AI answer engines. */
export const ROBOTS_MUST_ALLOW = ["Googlebot", "Bingbot", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"];
/** Crawlers it should let in (a warning): AI training and assistants beyond the big ones. */
export const ROBOTS_SHOULD_ALLOW = ["Google-Extended", "Applebot", "Applebot-Extended", "CCBot", "DuckAssistBot", "meta-externalagent"];

export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 160;
export const MIN_WORDS = 250;
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;

/** The public pages when there is no sitemap: read from src/lib/seo/routes.ts, or this short list. */
const FALLBACK_PATHS = ["/", "/math", "/about", "/privacy", "/terms", "/refunds"];

// ------------------------------------------------------------------ arguments

export function parseArgs(argv) {
  const out = { base: "http://localhost:3000", json: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") {
      out.json = argv[++i];
      if (!out.json) throw new Error("--json needs a file path");
    } else if (a.startsWith("--json=")) out.json = a.slice("--json=".length);
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else out.base = a;
  }
  const url = new URL(out.base);
  out.base = url.origin;
  return out;
}

// ------------------------------------------------------------------ robots.txt (RFC 9309, Google's reading)

/** Groups of user agents with their Allow/Disallow rules, and the Sitemap lines. */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      // an empty Disallow allows everything
      if (current && value) current.rules.push({ allow: key === "allow", path: value });
    } else if (key === "sitemap") {
      sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

function ruleMatches(pattern, urlPath) {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  return new RegExp(`^${body.split("*").map(escapeRe).join(".*")}${anchored ? "$" : ""}`).test(urlPath);
}

/**
 * Whether robots.txt lets `agent` read `urlPath` (path and query): the group naming the agent (else
 * `*`), then the longest matching rule, Allow winning a tie. No rule: allowed.
 */
export function robotsAllows(robots, agent, urlPath) {
  const token = agent.toLowerCase();
  let groups = robots.groups.filter((g) => g.agents.includes(token));
  if (groups.length === 0) groups = robots.groups.filter((g) => g.agents.includes("*"));
  let best = null;
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (!ruleMatches(rule.path, urlPath)) continue;
    const longer = !best || rule.path.length > best.path.length;
    const tieAllow = best && rule.path.length === best.path.length && rule.allow && !best.allow;
    if (longer || tieAllow) best = rule;
  }
  return best ? best.allow : true;
}

// ------------------------------------------------------------------ sitemap.xml

const decodeXml = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** The <loc> values of a sitemap or a sitemap index, and which it is. */
export function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decodeXml(m[1]));
  return { index: /<sitemapindex\b/.test(xml), locs };
}

/** The public pages from src/lib/seo/routes.ts (its slug tables), for a site with no sitemap yet. */
export function pathsFromRoutesSource(source) {
  const slugs = (name) => {
    const block = source.match(new RegExp(`export const ${name}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\};`))?.[1] ?? "";
    return [...block.matchAll(/:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  };
  const levels = [...slugs("GRADE_SLUGS"), ...slugs("COURSE_SLUGS")];
  const skills = slugs("SKILL_SLUGS");
  if (levels.length === 0) return FALLBACK_PATHS;
  return ["/", "/math", ...levels.map((s) => `/math/${s}`), ...skills.map((s) => `/math/${s}`), "/about", "/privacy", "/terms", "/refunds"];
}

// ------------------------------------------------------------------ one page

/** "noindex" or "none" for this crawler, from a robots meta content or an X-Robots-Tag header. */
export function robotsDirectivesBlock(value, agent) {
  if (!value) return false;
  const token = agent.toLowerCase();
  let scope = null; // null: every crawler
  for (const part of value.split(",")) {
    let directive = part.trim().toLowerCase();
    const m = directive.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/);
    if (m && !["max-snippet", "max-image-preview", "max-video-preview", "unavailable_after"].includes(m[1])) {
      scope = m[1];
      directive = m[2].trim();
    }
    if ((scope === null || scope === token) && (directive === "noindex" || directive === "none")) return true;
  }
  return false;
}

/** The words a reader sees: the body's text without scripts, styles, templates and drawings. */
export function visibleWords(root) {
  const body = root.querySelector("body") ?? root;
  const skip = new Set(["script", "style", "noscript", "template", "svg", "head"]);
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === 3) parts.push(node.text);
    else if (node.nodeType === 1 && !skip.has((node.rawTagName ?? "").toLowerCase())) for (const c of node.childNodes) walk(c);
  };
  walk(body);
  return parts.join(" ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Every "aggregateRating" or "review" key anywhere in the data. */
function forbiddenKeys(value, found = []) {
  if (Array.isArray(value)) for (const v of value) forbiddenKeys(v, found);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "aggregateRating" || k === "review" || k === "reviews") found.push(k);
      forbiddenKeys(v, found);
    }
  }
  return found;
}

/** Problems with one JSON-LD block's text. */
export function checkJsonLd(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return [`does not parse: ${e instanceof Error ? e.message : String(e)}`];
  }
  const problems = [];
  const tops = Array.isArray(data) ? data : [data];
  for (const top of tops) {
    if (!top || typeof top !== "object") {
      problems.push("is not an object");
      continue;
    }
    if (!top["@context"]) problems.push("has no @context");
    const nodes = Array.isArray(top["@graph"]) ? top["@graph"] : [top];
    for (const node of nodes) if (!node || typeof node !== "object" || !node["@type"]) problems.push("has a node with no @type");
  }
  const bad = forbiddenKeys(data);
  if (bad.length) problems.push(`has ${[...new Set(bad)].join(" and ")} (never on Agathon's pages)`);
  return problems;
}

/** "/math/" → "/math"; "/" stays. */
export function normalPath(p) {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/**
 * Everything one HTML response says about itself, and its problems. `pagePath` is the path that was
 * fetched; `siteOrigins` are the origins that count as this site (the base and the sitemap's);
 * `sitemapOrigins` the sitemap's own, where a canonical must point.
 * @param {{ pagePath: string, pageUrl: string, status: number, location: string | null, headers: Headers, body: string, agent: string, siteOrigins: Set<string>, sitemapOrigins?: string[] | null }} page
 */
export function checkHtml({ pagePath, pageUrl, status, location, headers, body, agent, siteOrigins, sitemapOrigins = null }) {
  const issues = [];
  const add = (level, check, message, detail) => issues.push({ level, check, message, ...(detail ? { detail } : {}) });
  const info = { status, title: null, description: null, canonical: null, h1: 0, jsonLd: 0, words: 0, links: [] };

  if (status >= 300 && status < 400) {
    add("error", "status", "redirects (a public page should answer 200 itself)", `${status} → ${location ?? "?"}`);
    return { info, issues };
  }
  if (status !== 200) {
    add("error", "status", `answers ${status}`, `${agent} gets ${status}`);
    return { info, issues };
  }

  const xRobots = headers.get("x-robots-tag");
  if (robotsDirectivesBlock(xRobots, agent)) add("error", "noindex", "X-Robots-Tag says noindex", xRobots);

  const root = parseHtml(body, { blockTextElements: { script: true, style: true, noscript: true, pre: true } });
  for (const meta of root.querySelectorAll("meta")) {
    const name = (meta.getAttribute("name") ?? "").toLowerCase();
    if (name === "robots" || name === agent.toLowerCase()) {
      const content = meta.getAttribute("content") ?? "";
      if (robotsDirectivesBlock(content, agent)) add("error", "noindex", `<meta name="${name}"> says noindex`, content);
    }
  }

  const title = root.querySelector("title")?.text.trim() ?? "";
  info.title = title || null;
  if (!title) add("error", "title", "no <title>");
  else if (title.length > TITLE_MAX) add("warn", "title", `title over ${TITLE_MAX} characters`, `${title.length}: ${title}`);

  const description = root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
  info.description = description || null;
  if (!description) add("error", "description", "no meta description");
  else if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    add("warn", "description", `description outside ${DESCRIPTION_MIN}–${DESCRIPTION_MAX} characters`, `${description.length}: ${description}`);
  }

  const canonical = root.querySelectorAll("link").find((l) => (l.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  const canonicalHref = canonical?.getAttribute("href") ?? "";
  info.canonical = canonicalHref || null;
  if (!canonicalHref) add("error", "canonical", "no canonical");
  else {
    const c = new URL(canonicalHref, pageUrl);
    if (normalPath(c.pathname) !== normalPath(pagePath.split("?")[0])) add("error", "canonical", "canonical points to another page", c.pathname);
    // the sitemap's host is the site's: a canonical on another (agathon.app against www.agathon.app) splits the page in two
    if (sitemapOrigins?.length && !sitemapOrigins.includes(c.origin)) add("error", "canonical", "canonical on another host than the sitemap", c.origin);
  }

  info.h1 = root.querySelectorAll("h1").length;
  if (info.h1 !== 1) add("error", "h1", info.h1 === 0 ? "no <h1>" : "more than one <h1>", `${info.h1}`);

  const blocks = root.querySelectorAll('script[type="application/ld+json"]');
  info.jsonLd = blocks.length;
  for (const block of blocks) for (const problem of checkJsonLd(block.text)) add("error", "json-ld", `a JSON-LD block ${problem}`);

  const og = (property) => root.querySelector(`meta[property="${property}"]`)?.getAttribute("content")?.trim();
  if (!og("og:title")) add("error", "og", "no og:title");
  if (!og("og:image")) add("error", "og", "no og:image");

  const missingAlt = root.querySelectorAll("img").filter((img) => img.getAttribute("alt") === undefined);
  if (missingAlt.length) add("error", "img-alt", "an <img> with no alt", missingAlt.map((i) => i.getAttribute("src") ?? "?").slice(0, 3).join(", "));

  info.words = visibleWords(root);
  if (info.words < MIN_WORDS) add("warn", "words", `fewer than ${MIN_WORDS} words of visible text`, `${info.words}`);

  // Cloudflare's Email Address Obfuscation swaps every address for a script-decoded link: a crawler
  // that runs no script (most AI crawlers) never reads the contact email
  if (body.includes("/cdn-cgi/l/email-protection") || body.includes("__cf_email__")) {
    add("warn", "email", "Cloudflare hides an email address from crawlers (Scrape Shield → Email Address Obfuscation)");
  }

  const links = new Set();
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("/cdn-cgi/") || /^(mailto|tel|javascript|data|sms):/i.test(href)) continue;
    let url;
    try {
      url = new URL(href, pageUrl);
    } catch {
      add("error", "links", "a link that is not a URL", href);
      continue;
    }
    if (!siteOrigins.has(url.origin)) continue;
    links.add(`${url.pathname}${url.search}`);
  }
  info.links = [...links];
  return { info, issues };
}

/** Pages sharing one title or one description: an error on each. */
export function duplicateIssues(pages) {
  const issues = [];
  for (const field of ["title", "description"]) {
    const by = new Map();
    for (const p of pages) {
      const value = p.info?.[field];
      if (!value) continue;
      by.set(value, [...(by.get(value) ?? []), p.path]);
    }
    for (const [value, paths] of by) {
      if (paths.length < 2) continue;
      for (const p of paths) {
        issues.push({ path: p, level: "error", check: "unique", message: `the same ${field} as another page`, detail: `"${value.slice(0, 60)}" also on ${paths.filter((x) => x !== p).slice(0, 3).join(", ")}${paths.length > 4 ? "…" : ""}` });
      }
    }
  }
  return issues;
}

/** Absolute links in a text file (markdown and bare). */
export function textLinks(text) {
  return [...text.matchAll(/https?:\/\/[^\s)<>"”]+/g)].map((m) => m[0].replace(/[.,;:]+$/, ""));
}

// ------------------------------------------------------------------ the crawl

async function get(url, { agent = "Googlebot", method = "GET", redirect = "manual" } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      redirect,
      headers: { "user-agent": AGENTS[agent] ?? agent, accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = method === "HEAD" ? "" : await res.text();
    return { status: res.status, headers: res.headers, body, location: res.headers.get("location"), ms: Date.now() - started };
  } catch (e) {
    return { status: 0, headers: new Headers(), body: "", location: null, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started };
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** A link's status, HEAD first (GET when HEAD is not allowed), following redirects; cached per path. */
function linkChecker(base) {
  const cache = new Map();
  return (p) => {
    if (!cache.has(p)) {
      cache.set(
        p,
        (async () => {
          let res = await get(`${base}${p}`, { method: "HEAD", redirect: "follow" });
          if (res.status === 405 || res.status === 501 || res.status === 0) res = await get(`${base}${p}`, { redirect: "follow" });
          return res.status;
        })(),
      );
    }
    return cache.get(p);
  };
}

function linkIssue(status, from, p) {
  if (status === 404 || status === 410) return { level: "error", check: "links", message: "a link to a page that is not there", detail: `${p} (${status})`, from };
  if (status === 0 || status >= 500) return { level: "error", check: "links", message: "a link to a page that fails", detail: `${p} (${status || "no answer"})`, from };
  if (status >= 400) return { level: "warn", check: "links", message: "a link to a page crawlers cannot read", detail: `${p} (${status})`, from };
  return null;
}

export async function audit(base, { log = () => {} } = {}) {
  const issues = [];
  const add = (issue) => issues.push(issue);
  const report = { base, startedAt: new Date().toISOString(), robots: null, sitemap: null, pages: [], textFiles: [], issues, summary: null };

  const ping = await get(`${base}/`);
  if (ping.status === 0) throw new Error(`cannot reach ${base}: ${ping.error}`);

  // robots.txt
  const robotsRes = await get(`${base}/robots.txt`);
  let robots = null;
  if (robotsRes.status !== 200) add({ path: "/robots.txt", level: "warn", check: "robots", message: "no robots.txt", detail: `${robotsRes.status}` });
  else {
    robots = parseRobots(robotsRes.body);
    if (robots.sitemaps.length === 0) add({ path: "/robots.txt", level: "warn", check: "robots", message: "robots.txt names no Sitemap" });
  }
  report.robots = robots ? { status: robotsRes.status, groups: robots.groups, sitemaps: robots.sitemaps } : { status: robotsRes.status };

  // sitemap.xml (and the children of a sitemap index)
  const siteOrigins = new Set([base]);
  let sitemapPaths = null;
  const sitemapRes = await get(`${base}/sitemap.xml`);
  if (sitemapRes.status !== 200) add({ path: "/sitemap.xml", level: "warn", check: "sitemap", message: "no sitemap.xml: auditing the public pages from routes.ts", detail: `${sitemapRes.status}` });
  else {
    let { index, locs } = parseSitemap(sitemapRes.body);
    if (index) {
      const children = await mapLimit(locs, CONCURRENCY, async (loc) => parseSitemap((await get(`${base}${new URL(loc).pathname}`)).body).locs);
      locs = children.flat();
    }
    const origins = new Set(locs.map((l) => new URL(l).origin));
    for (const o of origins) siteOrigins.add(o);
    if (origins.size > 1) add({ path: "/sitemap.xml", level: "error", check: "sitemap", message: "the sitemap mixes hosts", detail: [...origins].join(", ") });
    sitemapPaths = [...new Set(locs.map((l) => `${new URL(l).pathname}${new URL(l).search}`))];
    report.sitemap = { status: 200, origins: [...origins], urls: locs.length };
    if (locs.length === 0) add({ path: "/sitemap.xml", level: "error", check: "sitemap", message: "the sitemap lists no pages" });
  }

  let routesPaths = FALLBACK_PATHS;
  try {
    routesPaths = pathsFromRoutesSource(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/seo/routes.ts"), "utf8"));
  } catch {
    // auditing from outside the repo: the short list
  }
  if (sitemapPaths) for (const p of routesPaths) if (!sitemapPaths.includes(p)) add({ path: p, level: "warn", check: "sitemap", message: "a public page missing from the sitemap" });
  const pagePaths = sitemapPaths ?? routesPaths;

  // robots.txt lets the crawlers read every sitemap page
  if (robots) {
    for (const p of pagePaths) {
      for (const agent of ROBOTS_MUST_ALLOW) if (!robotsAllows(robots, agent, p)) add({ path: p, level: "error", check: "robots", message: "robots.txt keeps a search or AI crawler out", detail: agent });
      for (const agent of ROBOTS_SHOULD_ALLOW) if (!robotsAllows(robots, agent, p)) add({ path: p, level: "warn", check: "robots", message: "robots.txt keeps an AI crawler out", detail: agent });
    }
  }

  // every page, as each crawler
  const checkLink = linkChecker(base);
  log(`auditing ${pagePaths.length} pages on ${base} as ${Object.keys(AGENTS).join(" and ")}…`);
  report.pages = await mapLimit(pagePaths, CONCURRENCY, async (p) => {
    const pageUrl = `${base}${p}`;
    const page = { path: p, agents: {}, info: null };
    const seen = new Map();
    for (const agent of Object.keys(AGENTS)) {
      const res = await get(pageUrl, { agent });
      const isHtml = (res.headers.get("content-type") ?? "").includes("text/html");
      const checked =
        res.status === 200 && !isHtml
          ? { info: { status: 200 }, issues: [{ level: "error", check: "status", message: "answers something that is not HTML", detail: res.headers.get("content-type") }] }
          : checkHtml({ pagePath: p, pageUrl, status: res.status, location: res.location, headers: res.headers, body: res.body, agent, siteOrigins, sitemapOrigins: report.sitemap?.origins ?? null });
      page.agents[agent] = { status: res.status, ms: res.ms, words: checked.info.words ?? 0 };
      if (!page.info && res.status === 200) page.info = checked.info;
      for (const issue of checked.issues) {
        const key = `${issue.check}|${issue.message}|${issue.detail ?? ""}`;
        if (seen.has(key)) seen.get(key).agents.push(agent);
        else seen.set(key, { path: p, ...issue, agents: [agent] });
      }
    }
    for (const issue of seen.values()) add(issue);
    for (const link of page.info?.links ?? []) {
      const issue = linkIssue(await checkLink(link), p, link);
      if (issue) add({ path: p, ...issue });
    }
    return page;
  });
  for (const issue of duplicateIssues(report.pages)) add(issue);

  // llms.txt, and every link in it
  for (const file of ["/llms.txt"]) {
    const res = await get(`${base}${file}`, { agent: "GPTBot" });
    const entry = { path: file, status: res.status, contentType: res.headers.get("content-type"), links: 0 };
    report.textFiles.push(entry);
    if (res.status !== 200) {
      add({ path: file, level: "error", check: "llms", message: `${file} is not there`, detail: `${res.status}` });
      continue;
    }
    if (!(entry.contentType ?? "").startsWith("text/plain")) add({ path: file, level: "warn", check: "llms", message: "not served as text/plain", detail: entry.contentType });
    if (!res.body.startsWith("# ")) add({ path: file, level: "error", check: "llms", message: "does not start with a # title (llmstxt.org)" });
    const links = [...new Set(textLinks(res.body))];
    entry.links = links.length;
    // its links name the production site (a local build too): each one's path is checked here
    const origins = new Set(links.map((l) => new URL(l).origin));
    if (origins.size > 1) add({ path: file, level: "error", check: "llms", message: "llms.txt mixes hosts", detail: [...origins].join(", ") });
    if (report.sitemap) {
      for (const o of origins) if (!report.sitemap.origins.includes(o)) add({ path: file, level: "error", check: "llms", message: "llms.txt names another host than the sitemap", detail: o });
    }
    const ownLinks = [...new Set(links.map((l) => `${new URL(l).pathname}${new URL(l).search}`))];
    await mapLimit(ownLinks, CONCURRENCY, async (p) => {
      const issue = linkIssue(await checkLink(p), file, p);
      if (issue) add({ path: file, ...issue, check: "llms", message: issue.message.replace("a link", "an llms.txt link") });
    });
  }

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warn").length;
  report.summary = { pages: report.pages.length, errors, warnings, finishedAt: new Date().toISOString() };
  return report;
}

// ------------------------------------------------------------------ the report

const pad = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s).padEnd(n));

export function formatTable(report) {
  const counts = new Map();
  for (const i of report.issues) {
    const c = counts.get(i.path) ?? { e: 0, w: 0 };
    c[i.level === "error" ? "e" : "w"]++;
    counts.set(i.path, c);
  }
  const head = `${pad("page", 44)} ${pad("Gbot", 4)} ${pad("GPT", 4)} ${pad("title", 5)} ${pad("desc", 4)} ${pad("canon", 5)} ${pad("h1", 2)} ${pad("ld", 2)} ${pad("words", 5)} ${pad("err", 3)} ${pad("warn", 4)}`;
  const rows = report.pages.map((p) => {
    const i = p.info ?? {};
    const c = counts.get(p.path) ?? { e: 0, w: 0 };
    const canon = !i.canonical ? "-" : normalPath(new URL(i.canonical, report.base).pathname) === normalPath(p.path.split("?")[0]) ? "ok" : "x";
    return `${pad(p.path, 44)} ${pad(p.agents.Googlebot?.status ?? "", 4)} ${pad(p.agents.GPTBot?.status ?? "", 4)} ${pad(i.title?.length ?? "-", 5)} ${pad(i.description?.length ?? "-", 4)} ${pad(canon, 5)} ${pad(i.h1 ?? "-", 2)} ${pad(i.jsonLd ?? "-", 2)} ${pad(i.words ?? "-", 5)} ${pad(c.e || "", 3)} ${pad(c.w || "", 4)}`;
  });
  return [head, "-".repeat(head.length), ...rows].join("\n");
}

/** The issues grouped by kind: one line per kind, with the pages it is on. */
export function formatIssues(issues) {
  const groups = new Map();
  for (const i of issues) {
    const key = `${i.level}|${i.check}|${i.message}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const lines = [];
  for (const level of ["error", "warn"]) {
    for (const [key, list] of groups) {
      if (!key.startsWith(`${level}|`)) continue;
      const [, check, message] = key.split("|");
      const pages = [...new Set(list.map((i) => i.path))];
      const agents = [...new Set(list.flatMap((i) => i.agents ?? []))];
      const sample = list.slice(0, 3).map((i) => `${i.path}${i.detail ? ` (${i.detail})` : ""}`);
      lines.push(
        `${level === "error" ? "ERROR" : "warn "} [${check}] ${message}: ${pages.length} ${pages.length === 1 ? "page" : "pages"}${agents.length === 1 ? `, ${agents[0]} only` : ""}`,
        ...sample.map((s) => `        ${s.length > 150 ? `${s.slice(0, 149)}…` : s}`),
        ...(list.length > 3 ? [`        … and ${list.length - 3} more`] : []),
      );
    }
  }
  return lines.join("\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  if (args.help) {
    console.log("usage: node scripts/seo-audit.mjs [baseUrl=http://localhost:3000] [--json report.json]");
    process.exit(0);
  }
  try {
    const report = await audit(args.base, { log: (m) => console.log(m) });
    console.log("");
    console.log(formatTable(report));
    console.log("");
    if (report.robots) console.log(`robots.txt: ${report.robots.status}${report.robots.sitemaps ? `, ${report.robots.groups.length} groups, sitemaps: ${report.robots.sitemaps.join(", ") || "none"}` : ""}`);
    console.log(`sitemap.xml: ${report.sitemap ? `${report.sitemap.urls} URLs on ${report.sitemap.origins.join(", ")}` : "missing"}`);
    for (const t of report.textFiles) console.log(`${t.path}: ${t.status} ${t.contentType ?? ""}, ${t.links} links`);
    console.log("");
    const text = formatIssues(report.issues);
    if (text) console.log(text, "\n");
    console.log(`${report.summary.pages} pages, ${report.summary.errors} errors, ${report.summary.warnings} warnings`);
    if (args.json) {
      fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
      console.log(`report: ${args.json}`);
    }
    process.exit(report.summary.errors > 0 ? 1 : 0);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
