/**
 * This page's link preview (Open Graph and X): the landing page's own card, so a shared link looks
 * like Agathon and crawlers find an og:image. Its own route, because the page's `openGraph` replaces
 * any image set above it.
 */
export { alt, contentType, default, size } from "../parents/opengraph-image";

export const runtime = "nodejs";
