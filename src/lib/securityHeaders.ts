/**
 * Response headers on every page and API route (next.config.ts `headers()`), from the security
 * audit of 2026-10-03. Before them the app sent none of its own (Vercel adds HSTS), so any site
 * could load a board or the account page in an invisible frame and steer a child's clicks
 * (clickjacking: "Delete account", buying ink, starting a plan).
 *
 * Deliberately NOT a full Content-Security-Policy yet: a `script-src` / `connect-src` /
 * `img-src` allow-list has to be built and tested against tldraw, KaTeX, pdf.js (its worker comes
 * from unpkg), Supabase (REST, Storage, Realtime), ElevenLabs and Stripe before it can ship, and a
 * mistake there breaks the board. What is here cannot break any of them:
 *
 *  - frame-ancestors 'none' + X-Frame-Options DENY: nobody frames the app (nothing in the app or
 *    the launch films does; the board's own embeds are frames FROM the app, unaffected)
 *  - object-src 'none': no <object>/<embed> plugins (PDFs render to a canvas)
 *  - base-uri 'self': an injected <base> cannot re-point relative script URLs
 *  - nosniff: a response is only ever run as the type it is served with
 *  - Referrer-Policy: other sites see our origin, never a board's path (`/board/<id>`)
 *  - Permissions-Policy: the microphone for lecture mode on our own pages only; no camera,
 *    location, payment or USB for us or anything we embed
 */
export type SecurityHeader = { key: string; value: string };

export const SECURITY_HEADERS: readonly SecurityHeader[] = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
];
