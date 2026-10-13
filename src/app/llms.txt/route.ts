import { siteOrigin } from "@/lib/landing/links";
import { llmsTxt } from "@/lib/seo/llms";

/**
 * agathon.app/llms.txt (llmstxt.org): what Agathon is and every public page, for AI answer engines
 * (docs/SEO.md "AI search"). Built at build time from the site's own words (src/lib/seo/llms.ts).
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(llmsTxt(siteOrigin(process.env.NEXT_PUBLIC_SITE_URL)), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
