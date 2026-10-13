import type { MetadataRoute } from "next";
import { SITE_ORIGIN, absoluteUrl, robotsGroups } from "@/lib/seo/site";

/**
 * robots.txt (SEO build 2026-10-13, docs/SEO.md): search and AI crawlers are welcome on the public
 * pages (the landing page, the math library, About, the legal pages, llms.txt) and kept out of the
 * app. Each named crawler gets its own group with the same lines as `*` (src/lib/seo/site.ts).
 * Cloudflare can put its own lines in front of these (its managed robots.txt): check the live file.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: robotsGroups(),
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_ORIGIN,
  };
}
