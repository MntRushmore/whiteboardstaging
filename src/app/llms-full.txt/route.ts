import { siteOrigin } from "@/lib/landing/links";
import { llmsFullTxt } from "@/lib/seo/llms";

/**
 * agathon.app/llms-full.txt: the whole public story as one plain markdown document, for AI answer
 * engines (docs/SEO.md "AI search"). Built at build time from the site's own words
 * (src/lib/seo/llms.ts), so it cannot drift from the pages.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(llmsFullTxt(siteOrigin(process.env.NEXT_PUBLIC_SITE_URL)), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
