/**
 * The browser helper (src/lib/email/client.ts): one body-less POST, and never an error for the
 * caller, whatever happens to it.
 */
import { describe, expect, it, vi } from "vitest";
import { WELCOME_EMAIL_PATH, sendWelcomeEmail } from "@/lib/email/client";

describe("sendWelcomeEmail", () => {
  it("POSTs to the welcome route with no body, kept alive across a navigation", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "sent" })));
    await expect(sendWelcomeEmail(fetcher)).resolves.toBeUndefined();
    expect(WELCOME_EMAIL_PATH).toBe("/api/email/welcome");
    expect(fetcher).toHaveBeenCalledWith("/api/email/welcome", { method: "POST", keepalive: true });
  });

  it("swallows a refusal, a network error and a signed-out session", async () => {
    await expect(sendWelcomeEmail(async () => new Response("{}", { status: 503 }))).resolves.toBeUndefined();
    await expect(sendWelcomeEmail(async () => Promise.reject(new TypeError("Failed to fetch")))).resolves.toBeUndefined();
    await expect(
      sendWelcomeEmail(() => {
        throw new Error("You need to be signed in.");
      }),
    ).resolves.toBeUndefined();
  });
});
