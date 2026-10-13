/**
 * CONTRACT STUB (v3, owner: feat/lp3-root; docs/LANDING-V3.md "Root"). An inline script at the top
 * of the landing page: on `/` only (never /parents, which would loop), a device that keeps a Supabase
 * session (or has auth tokens in the hash) gets the `agathon_session` cookie and goes to the same
 * address again, where the rewrite then serves the app. Rendered by parents/page.tsx before
 * everything else.
 */
export function SessionHop() {
  return null;
}
