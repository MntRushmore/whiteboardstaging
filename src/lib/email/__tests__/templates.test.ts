/**
 * The email templates (src/lib/email/templates.ts): what each one says, where its links go, that
 * everything interpolated is escaped, and that a bad link fails before anything is sent. No
 * snapshots: each assertion names the fact it protects, so a copy edit breaks only what it changes.
 */
import { describe, expect, it } from "vitest";
import {
  BRAND_BLUE,
  EMAIL_TIME_ZONE,
  WELCOME_SUBJECT,
  emailHref,
  escapeHtml,
  formatEmailDate,
  formatUsd,
  siteLink,
  trialReminderEmail,
  unlimitedStartedEmail,
  welcomeEmail,
  type TrialReminderInput,
  type UnlimitedStartedInput,
} from "@/lib/email/templates";

const SITE = "https://whiteboard.rushilchopra.com";
const PORTAL = "https://billing.stripe.com/p/login/test_abc";

/** Every href in the HTML, unescaped. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

/** The text a reader sees: the HTML without tags, comments, the head and the preheader filler. */
function visibleText(html: string): string {
  return html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#847;|&zwnj;|&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("escapeHtml / emailHref / siteLink", () => {
  it("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });

  it("accepts only absolute http(s) links, normalised by the URL parser", () => {
    expect(emailHref(" https://example.com/a b ")).toBe("https://example.com/a%20b");
    expect(emailHref("http://localhost:3000")).toBe("http://localhost:3000/");
    for (const bad of ["javascript:alert(1)", "/account", "", "data:text/html,<b>x</b>", "mailto:a@b.c"]) {
      expect(() => emailHref(bad), bad).toThrow(/email link/);
    }
  });

  it("joins a path onto the site, keeping a base path", () => {
    expect(siteLink("https://x.example", "/account")).toBe("https://x.example/account");
    expect(siteLink("https://x.example/app/", "/account")).toBe("https://x.example/app/account");
    expect(siteLink("https://x.example/app")).toBe("https://x.example/app/");
    expect(siteLink("https://x.example/?utm=1#top", "/account")).toBe("https://x.example/account");
  });
});

describe("formatEmailDate / formatUsd", () => {
  it("writes the day and time in Eastern time, with the zone named", () => {
    // 03:04 UTC on the 10th is still the evening of the 9th in New York (EDT, UTC-4).
    expect(EMAIL_TIME_ZONE).toBe("America/New_York");
    expect(formatEmailDate(new Date("2026-10-10T03:04:00Z"))).toEqual({ day: "Friday, October 9", time: "11:04 PM EDT" });
    // After the clocks change: EST.
    expect(formatEmailDate(new Date("2026-12-01T17:30:00Z"))).toEqual({ day: "Tuesday, December 1", time: "12:30 PM EST" });
    expect(formatEmailDate(new Date("2026-10-10T03:04:00Z"), "America/Los_Angeles").day).toBe("Friday, October 9");
    expect(() => formatEmailDate(new Date("nope"))).toThrow(/valid date/);
  });

  it("prices in whole dollars, or with cents", () => {
    expect(formatUsd(25)).toBe("$25");
    expect(formatUsd(12.5)).toBe("$12.50");
    expect(() => formatUsd(-1)).toThrow();
    expect(() => formatUsd(Number.NaN)).toThrow();
  });
});

describe("welcomeEmail", () => {
  const email = welcomeEmail({ siteUrl: SITE });

  it("says what Agathon is, and names Help me and Ask, in both parts", () => {
    expect(email.subject).toBe(WELCOME_SUBJECT);
    expect(email.subject).toBe("Welcome to Agathon");
    for (const part of [visibleText(email.html), email.text]) {
      expect(part).toContain("Agathon is a whiteboard with a patient tutor built in.");
      expect(part).toContain("the tutor checks each step as you go");
      expect(part).toMatch(/tap the big blue Help me button/);
      expect(part).toMatch(/open Ask and type something like “3 more like this”/);
      expect(part).toContain("whether you're the student or the grown-up who set this up");
      expect(part).toContain("If that wasn't you, you can ignore it.");
    }
  });

  it("has one button, back to the home, in the app's blue", () => {
    expect(hrefs(email.html)).toEqual([`${SITE}/`]);
    expect(email.html).toContain(`bgcolor="${BRAND_BLUE}"`);
    expect(email.html).toMatch(/>Open Agathon<\/a>/);
    expect(email.text).toContain(`Open Agathon: ${SITE}/`);
    // the Help me pill looks like the board's button: filled blue; the button names are in bold
    expect(email.html).toMatch(new RegExp(`background-color:${BRAND_BLUE};color:#ffffff;[^"]*">Help me</span>`));
    expect(email.html).toContain("tap the big blue <strong>Help me</strong> button");
    expect(email.html).toContain("open <strong>Ask</strong> and type");
  });

  it("is a complete, mobile-ready HTML document", () => {
    expect(email.html.startsWith("<!doctype html>")).toBe(true);
    expect(email.html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(email.html).toContain('<meta charset="utf-8">');
    expect(email.html).toContain("max-width:560px");
    expect(email.html).toContain('role="presentation"');
    expect(email.html).not.toMatch(/<img\b|<script\b/i);
  });

  it("escapes the site URL in the link and refuses a non-http one", () => {
    const odd = welcomeEmail({ siteUrl: `https://x.example/a"><script>alert(1)</script>&b` });
    expect(odd.html).not.toMatch(/<script/i);
    expect(odd.html).not.toContain('"><script');
    // the URL parser percent-encodes the quote and brackets; the ampersand is escaped for the attribute
    expect(hrefs(odd.html)).toEqual(["https://x.example/a%22%3E%3Cscript%3Ealert(1)%3C/script%3E&b/"]);
    expect(odd.html).toContain("%3C/script%3E&amp;b/");
    expect(() => welcomeEmail({ siteUrl: "javascript:alert(1)" })).toThrow(/email link/);
    expect(() => welcomeEmail({ siteUrl: "" })).toThrow(/email link/);
  });
});

describe("trialReminderEmail", () => {
  const input: TrialReminderInput = {
    trialEnd: new Date("2026-10-10T03:04:00Z"),
    manageUrl: PORTAL,
    siteUrl: SITE,
    planName: "Agathon Unlimited",
    monthlyUsd: 25,
  };
  const email = trialReminderEmail(input);

  it("says when the free trial ends, when the card is charged and how much, in both parts", () => {
    expect(email.subject).toBe("Your free trial of Agathon Unlimited ends on Friday, October 9");
    for (const part of [visibleText(email.html), email.text]) {
      expect(part).toContain("Your free trial ends on Friday, October 9, at 11:04 PM EDT.");
      expect(part).toContain("On Friday, October 9, your card will be charged $25 for Agathon Unlimited.");
      expect(part).toContain("After that it's $25 a month until you cancel.");
      expect(part).toContain("Nothing to do if you'd like to keep it.");
      expect(part).toContain("Cancel before the free trial ends and you won't be charged.");
    }
  });

  it("puts the cancel link in the body and on the button, plus the site in the footer", () => {
    expect(hrefs(email.html)).toEqual([PORTAL, PORTAL, `${SITE}/`]);
    expect(visibleText(email.html)).toContain("To cancel, use Manage or cancel .");
    expect(email.text).toContain(`To cancel, use Manage or cancel: ${PORTAL}`);
    expect(email.html).toMatch(/>Manage or cancel<\/a>\n<\/td>/);
  });

  it("follows the plan's name and price", () => {
    const other = trialReminderEmail({ ...input, planName: "Agathon Family", monthlyUsd: 12.5 });
    expect(other.subject).toBe("Your free trial of Agathon Family ends on Friday, October 9");
    expect(other.text).toContain("your card will be charged $12.50 for Agathon Family");
  });

  it("escapes what it interpolates and refuses a non-http cancel link", () => {
    const odd = trialReminderEmail({ ...input, planName: `<b>Plan</b> & "co"`, manageUrl: `${PORTAL}?a=1&b="><img src=x>` });
    expect(odd.html).not.toContain("<b>Plan</b>");
    expect(odd.html).toContain("&lt;b&gt;Plan&lt;/b&gt; &amp; &quot;co&quot;");
    expect(odd.html).not.toMatch(/<img\b/);
    expect(odd.html).toContain("?a=1&amp;b=");
    expect(() => trialReminderEmail({ ...input, manageUrl: "javascript:void(0)" })).toThrow(/email link/);
    expect(() => trialReminderEmail({ ...input, trialEnd: new Date(Number.NaN) })).toThrow(/valid date/);
  });
});

describe("unlimitedStartedEmail (the auto-renewal acknowledgment)", () => {
  const input: UnlimitedStartedInput = {
    trialEnd: new Date("2026-10-10T03:04:00Z"),
    manageUrl: PORTAL,
    siteUrl: SITE,
    planName: "Agathon Unlimited",
    monthlyUsd: 25,
  };
  const email = unlimitedStartedEmail(input);

  it("says nothing was charged, when and how much the card will be charged, that it renews monthly, and how to cancel free", () => {
    expect(email.subject).toBe("Your free trial of Agathon Unlimited has started");
    for (const part of [visibleText(email.html), email.text]) {
      expect(part).toContain("Your free trial of Agathon Unlimited has started. Nothing was charged today.");
      expect(part).toContain("On Friday, October 9 at 11:04 PM EDT, your card will be charged $25, then $25 every month until you cancel.");
      expect(part).toContain("Cancel before Friday, October 9 at 11:04 PM EDT and you won't be charged.");
    }
    expect(visibleText(email.html)).toContain("To cancel, use Manage or cancel .");
  });

  it("links how to cancel (body and button), the plan's terms, the refund policy and the site", () => {
    expect(hrefs(email.html)).toEqual([PORTAL, PORTAL, `${SITE}/terms#unlimited`, `${SITE}/refunds#subscriptions`, `${SITE}/`]);
    expect(email.text).toContain(`To cancel, use Manage or cancel: ${PORTAL}`);
    expect(email.text).toContain(`How the plan works: ${SITE}/terms#unlimited`);
    expect(email.text).toContain(`Refund policy: ${SITE}/refunds#subscriptions`);
  });

  it("a second plan says it starts with the first charge, not a free trial of help", () => {
    const repeat = unlimitedStartedEmail({ ...input, repeat: true });
    expect(repeat.subject).toBe("Your Agathon Unlimited plan starts on Friday, October 9");
    expect(repeat.text).toContain("Your Agathon Unlimited plan is set up. Nothing was charged today.");
    expect(repeat.text).toContain("The free trial is for a first plan only, so until then help uses ink.");
    expect(repeat.text).toContain("your card will be charged $25, then $25 every month until you cancel.");
  });

  it("escapes what it interpolates and refuses a bad link or date", () => {
    const odd = unlimitedStartedEmail({ ...input, planName: `<b>Plan</b>`, manageUrl: `${PORTAL}?a=1&b="><img src=x>` });
    expect(odd.html).not.toContain("<b>Plan</b>");
    expect(odd.html).not.toMatch(/<img\b/);
    expect(() => unlimitedStartedEmail({ ...input, manageUrl: "javascript:void(0)" })).toThrow(/email link/);
    expect(() => unlimitedStartedEmail({ ...input, siteUrl: "/relative" })).toThrow(/email link/);
    expect(() => unlimitedStartedEmail({ ...input, trialEnd: new Date(Number.NaN) })).toThrow(/valid date/);
  });
});

describe("the house style", () => {
  const all = [
    welcomeEmail({ siteUrl: SITE }),
    trialReminderEmail({ trialEnd: new Date("2026-10-10T03:04:00Z"), manageUrl: PORTAL, siteUrl: SITE, planName: "Agathon Unlimited", monthlyUsd: 25 }),
    unlimitedStartedEmail({ trialEnd: new Date("2026-10-10T03:04:00Z"), manageUrl: PORTAL, siteUrl: SITE, planName: "Agathon Unlimited", monthlyUsd: 25 }),
    unlimitedStartedEmail({ trialEnd: new Date("2026-10-10T03:04:00Z"), manageUrl: PORTAL, siteUrl: SITE, planName: "Agathon Unlimited", monthlyUsd: 25, repeat: true }),
  ];

  it("never uses an exclamation mark", () => {
    for (const email of all) {
      expect(email.subject).not.toContain("!");
      expect(email.text).not.toContain("!");
      expect(visibleText(email.html).replace(/<!doctype html>/i, "")).not.toContain("!");
    }
  });

  it("ends the plain text with a newline and keeps paragraphs apart", () => {
    for (const email of all) {
      expect(email.text.endsWith("\n")).toBe(true);
      expect(email.text).toContain("\n\n");
      expect(email.text).not.toMatch(/<[a-z]/i);
    }
  });
});
