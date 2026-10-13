import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_LANGUAGE, SITE_NAME, THEME_COLOR } from "@/lib/seo/site";

/**
 * The web manifest (/manifest.webmanifest): Agathon's name, what it is and its icons, for a browser
 * that installs it or adds it to a home screen. The colors are the landing page's background; the
 * icons are drawn by scripts/brand-icons.mjs from the brand's mark.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: SITE_LANGUAGE,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    categories: ["education", "kids"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
