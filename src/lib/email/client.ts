"use client";

/**
 * The browser's side of the welcome email: one fire-and-forget request to POST /api/email/welcome.
 * The server decides everything (the address, whether onboarding is done, whether it already went
 * out), so this sends no body and ignores the answer.
 *
 * Call it AFTER save_onboarding has stamped profiles.onboarded_at, i.e. in the `.then` of
 * `saveOnboarding(..., { complete: true })` when it resolved ok: the route reads that column, and
 * a request that races ahead of the save is answered "not onboarded" and sends nothing.
 *
 * `keepalive` lets the request finish when the page navigates away right after the tour.
 */
import { authedFetch } from "@/lib/api-client";

export const WELCOME_EMAIL_PATH = "/api/email/welcome";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Ask the server to send this account's welcome email. Never throws, never rejects. */
export async function sendWelcomeEmail(fetcher: Fetcher = authedFetch): Promise<void> {
  try {
    await fetcher(WELCOME_EMAIL_PATH, { method: "POST", keepalive: true });
  } catch {
    // Signed out, offline, or the server refused: a welcome email is not worth an error.
  }
}
