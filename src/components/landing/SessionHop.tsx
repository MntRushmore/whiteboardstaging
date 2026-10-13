import { SESSION_HOP_SCRIPT } from "@/lib/landing/links";

/**
 * The landing page's first script (v3, docs/LANDING-V3.md "Root"; rendered by parents/page.tsx before
 * everything else). On `/` only (never /parents, which would reload forever), a device that keeps a
 * Supabase session, or has an email link's tokens in the hash, gets the `agathon_session` cookie and
 * reloads the same address, where the server then serves the app. That covers a device signed in from
 * before the cookie existed, or whose cookie has expired. It runs while the page is being read, before
 * the first paint, and hides the page while it leaves. A client-side render never runs it (React does
 * not run a script it inserts), so it acts only on a real page load, where it belongs. The rules, and
 * why it can never loop, are in src/lib/landing/links.ts (`shouldHop`, `SESSION_HOP_SCRIPT`).
 */
export function SessionHop() {
  return <script dangerouslySetInnerHTML={{ __html: SESSION_HOP_SCRIPT }} />;
}
