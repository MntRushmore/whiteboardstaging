/**
 * The operator's alert emails: subjects that say what broke on a phone's lock screen, a body that
 * says since when and what students notice, the /admin link, and nothing unescaped.
 */
import { describe, expect, it } from "vitest";
import { alertEmail, formatCredits, formatDuration, oneLine, SERVICE_LABELS, type AlertContext } from "@/lib/email/alerts";

const NOW = new Date("2026-10-05T14:20:00.000Z"); // 10:20 AM EDT
const CTX: AlertContext = { siteUrl: "https://whiteboard.example.com", now: NOW, repeatAfterMin: 60 };
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

describe("alertEmail", () => {
  it("down: '<service> is down: <detail>', since when, what students notice, the /admin link", () => {
    const e = alertEmail({ type: "down", service: "mathpix", detail: "keys rejected (401)", since: ago(10), repeat: false }, CTX);
    expect(e.subject).toBe("Mathpix is down: keys rejected (401)");
    expect(e.text).toBe(
      [
        "Mathpix has failed every health check since 10:10 AM EDT (10 min).",
        "Why: keys rejected (401)",
        "Handwriting is read by the vision model instead, which is slower and less accurate.",
        "You'll get a reminder every 60 minutes while it stays down, and one email when it is back up.",
        "Open /admin: https://whiteboard.example.com/admin",
      ].join("\n\n") + "\n",
    );
    expect(e.html).toContain('<a href="https://whiteboard.example.com/admin"');
  });

  it("still down says for how long", () => {
    const e = alertEmail({ type: "down", service: "database", detail: "profiles: 503 upstream connect error", since: ago(65), repeat: true }, CTX);
    expect(e.subject).toBe("The database is still down (1 h 5 min): profiles: 503 upstream connect error");
  });

  it("back up: how long it was down", () => {
    const e = alertEmail({ type: "up", service: "openrouter", downSince: ago(12) }, CTX);
    expect(e.subject).toBe("OpenRouter is back up (down 12 min)");
    expect(e.text).toContain("passed its health check again at 10:20 AM EDT, after 12 min down (since 10:08 AM EDT)");
  });

  it("spike: count, people, the top 3 groups", () => {
    const e = alertEmail(
      {
        type: "spike",
        errors: 42,
        users: 7,
        windowMin: 15,
        since: ago(0),
        repeat: false,
        capped: false,
        groups: [
          { kind: "live.recognize", code: "timeout", message: "Mathpix timed out", count: 18 },
          { kind: "client.boundary", code: null, message: "Cannot read properties of undefined", count: 9 },
          { kind: "live.solve", code: null, message: "", count: 6 },
          { kind: "live.chat", code: null, message: "never shown", count: 1 },
        ],
      },
      CTX,
    );
    expect(e.subject).toBe("Errors spiking: 42 in 15 min from 7 people");
    expect(e.text).toContain("- 18× live.recognize (timeout): Mathpix timed out\n- 9× client.boundary: Cannot read properties of undefined\n- 6× live.solve: no message");
    expect(e.text).not.toContain("never shown");
    expect(e.html).toContain("<ul");
  });

  it("spike that lasts, capped read, one person", () => {
    const e = alertEmail({ type: "spike", errors: 2000, users: 1, windowMin: 15, since: ago(60), repeat: true, capped: true, groups: [] }, CTX);
    expect(e.subject).toBe("Errors still spiking (1 h): 2000+ in 15 min from 1 person");
  });

  it("spike over", () => {
    expect(alertEmail({ type: "spike_over", since: ago(35) }, CTX).subject).toBe("Errors are back to normal (spike lasted 35 min)");
  });

  it("low credit: what is left, where to top up", () => {
    const e = alertEmail({ type: "low_credits", creditsLeftUsd: 4.2, thresholdUsd: 5 }, CTX);
    expect(e.subject).toBe("OpenRouter credit is low: $4.20 left");
    expect(e.text).toContain("https://openrouter.ai/settings/credits");
    expect(e.text).toContain("(the alert is at $5.00)");
  });

  it("escapes provider text in the HTML and keeps the subject on one short line", () => {
    const e = alertEmail({ type: "down", service: "email", detail: `<script>alert(1)</script>\nsecond line ${"x".repeat(300)}`, since: ago(5), repeat: false }, CTX);
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.subject).not.toMatch(/\n/);
    expect(e.subject.length).toBeLessThanOrEqual(120);
    expect(e.subject.startsWith(`${SERVICE_LABELS.email} is down: <script>`)).toBe(true);
  });

  it("throws for an unusable site URL (nothing goes out with a broken link)", () => {
    expect(() => alertEmail({ type: "spike_over", since: ago(1) }, { ...CTX, siteUrl: "javascript:alert(1)" })).toThrow();
  });
});

describe("helpers", () => {
  it("formatDuration", () => {
    expect(formatDuration(20_000)).toBe("under a minute");
    expect(formatDuration(12 * 60_000)).toBe("12 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 5 min");
    expect(formatDuration(180 * 60_000)).toBe("3 h");
    expect(formatDuration((52 * 60 + 30) * 60_000)).toBe("2 d 4 h");
    expect(formatDuration(-5)).toBe("under a minute");
  });

  it("formatCredits and oneLine", () => {
    expect(formatCredits(4.2)).toBe("$4.20");
    expect(formatCredits(Number.NaN)).toBe("$0.00");
    expect(oneLine("  a\n b  ", 10)).toBe("a b");
    expect(oneLine("abcdefghij", 5)).toBe("abcd…");
  });
});
