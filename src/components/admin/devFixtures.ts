"use client";

/**
 * DEVELOPMENT ONLY: the admin console from made-up data, before (or without) its API routes.
 *
 *   /admin?fixtures=1        every console page reads src/lib/admin/fixtures/consoleFixtures.ts
 *   /admin?fixtures=empty    …with nothing in it (the empty states)
 *   /admin?fixtures=error    …with every read failing (the error states)
 *   &theme=dark              Arc's dark tokens, to check the pages in dark mode
 *   /admin?fixtures=0        back to the real routes
 *
 * The choice is remembered for the tab (sessionStorage), so links between pages keep it. No
 * session is needed and nothing real is read or written: a PATCH changes the fixtures in memory
 * (a note containing the word "fail" makes it fail, to see the rollback).
 *
 * In a production build `process.env.NODE_ENV` is "production": `fixtureMode()` is false before it
 * reads anything, every caller checks NODE_ENV itself first, and the fixtures module is only ever
 * reached through the dynamic import below, so none of it ships.
 */
import type { FixtureMode, FixtureServer } from "@/lib/admin/fixtures/consoleFixtures";

const KEY = "agathon.adminFixtures";
const THEME_KEY = "agathon.adminFixturesTheme";

/** The fixture mode asked for by the address or earlier in this tab; null (the real routes) otherwise and always in production. */
export function fixtureMode(): FixtureMode | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const asked = params.get("fixtures");
    if (asked !== null) {
      if (asked === "0" || asked === "off") window.sessionStorage.removeItem(KEY);
      else window.sessionStorage.setItem(KEY, asked === "empty" || asked === "error" ? asked : "1");
    }
    const theme = params.get("theme");
    if (theme !== null) window.sessionStorage.setItem(THEME_KEY, theme);
    const stored = window.sessionStorage.getItem(KEY);
    if (stored && window.sessionStorage.getItem(THEME_KEY) === "dark") document.documentElement.dataset.theme = "dark";
    else if (document.documentElement.dataset.theme === "dark" && window.sessionStorage.getItem(THEME_KEY) !== "dark") delete document.documentElement.dataset.theme;
    return stored === "1" || stored === "empty" || stored === "error" ? stored : null;
  } catch {
    return null;
  }
}

let server: Promise<FixtureServer> | null = null;

/** A fetch answered by the fixtures (after a short pause, so loading states show). */
export async function fixtureFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // The import sits inside a NODE_ENV branch the bundler folds away: in a production build the
  // fixtures are not even emitted as a chunk.
  if (process.env.NODE_ENV !== "production") {
    server ??= import("@/lib/admin/fixtures/consoleFixtures").then((m) => new m.FixtureServer(() => Date.now()));
  }
  if (!server) throw new Error("The admin fixtures are for development only.");
  const mode = fixtureMode() ?? "1";
  const fake = await server;
  await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
  const method = (init.method ?? "GET").toUpperCase();
  let body: unknown = null;
  try {
    body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  } catch {
    body = null;
  }
  const answer = fake.answer(url, method, body, mode);
  if (answer.svg) return new Response(new Blob([answer.svg], { type: "image/svg+xml" }), { status: answer.status });
  return new Response(answer.json === undefined ? null : JSON.stringify(answer.json), { status: answer.status, headers: { "Content-Type": "application/json" } });
}
