import type { MetadataRoute } from "next";
import { publicPages } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/site";

/** When this build was made: every page in the sitemap is rebuilt with it. */
const BUILT = new Date();

/**
 * sitemap.xml (SEO build 2026-10-13, docs/SEO.md): every public page (`publicPages()`), as an
 * absolute address on the canonical host, most important first. Built once per deploy.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return publicPages().map((page) => ({
    url: absoluteUrl(page.path),
    lastModified: BUILT,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
