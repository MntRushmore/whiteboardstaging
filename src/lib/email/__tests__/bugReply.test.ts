/**
 * The emails of a bug report's conversation (src/lib/email/bugReply.ts and the templates it words
 * them with): the reply to the reporter (or a kid's grown-up), with the reply escaped, their report
 * quoted as one line with no link in it, and the button to /reports#<id>; once per message in
 * email_log; and the operator's "they replied" to ALERT_EMAIL. Nothing unescaped, nothing to a kid,
 * and no failure that is not an answer.
 */
import { describe, expect, it } from "vitest";
import { reporterRepliedEmail } from "@/lib/email/alerts";
import { BUG_REPLY_KIND, bugReplyIdempotencyKey, reporterRepliedIdempotencyKey, sendBugReplyEmail, sendReporterReplied, type BugReplyEmailInput } from "@/lib/email/bugReply";
import { KID_ADDRESS_REFUSED, sendEmail } from "@/lib/email/resend";
import { bugReplyEmail, bugReportLink, quotableLine, QUOTE_MAX } from "@/lib/email/templates";
import { fakeDeps, silentLog, testEnv, SITE } from "./fakes";

const REPORT = "0f8fad5b-d9cb-469f-a165-70867728950e";
const MESSAGE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const REPORTER = "11111111-2222-4333-8444-555555555555";
const SENT_AT = new Date("2026-10-09T13:04:00.000Z"); // Friday, 9:04 AM EDT

/** The text a reader sees: the HTML without tags, the head and the preheader filler. */
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

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("quotableLine", () => {
  it("the first line with words, white space collapsed", () => {
    expect(quotableLine("\n\n  The pen   draws\tin the wrong place  \nwhen I zoom")).toBe("The pen draws in the wrong place");
    expect(quotableLine("   \n  ")).toBe("");
  });

  it("anything a mail app could make a link becomes [link]", () => {
    expect(quotableLine("Claim your prize at evil.example now")).toBe("Claim your prize at [link] now");
    expect(quotableLine("see https://evil.example/x?y=1 and www.evil.example")).toBe("see [link] and [link]");
    expect(quotableLine("write to someone@else.example")).toBe("write to [link]");
    // ordinary words with dots stay
    expect(quotableLine("e.g. 3.5 times, then x.y broke")).toBe("e.g. 3.5 times, then x.y broke");
  });

  it("at most QUOTE_MAX characters, with an ellipsis", () => {
    const q = quotableLine("a".repeat(500));
    expect(q).toHaveLength(QUOTE_MAX);
    expect(q.endsWith("…")).toBe(true);
  });
});

describe("bugReplyEmail", () => {
  const base = { siteUrl: SITE, reportId: REPORT, reply: "Thanks! We fixed it.\nTry again <now>.", reported: "Solve keeps spinning\nIt worked yesterday", reportedAt: SENT_AT };

  it("to the reporter: what they sent (one line), our reply (escaped, its lines kept), Read and reply to /reports#<id>", () => {
    const e = bugReplyEmail(base);
    expect(e.subject).toBe("We replied to your bug report");
    expect(hrefs(e.html)).toContain(`${SITE}/reports#${REPORT}`);
    expect(e.html).toContain("Read and reply");
    const seen = visibleText(e.html);
    expect(seen).toContain("You sent us a bug report on Friday, October 9:");
    expect(seen).toContain("“Solve keeps spinning”");
    expect(seen).not.toContain("It worked yesterday");
    expect(seen).toContain("Here's our reply:");
    expect(e.html).toContain("Thanks! We fixed it.<br>Try again &lt;now&gt;.");
    expect(e.html).not.toContain("<now>");
    expect(e.text).toContain(`Read and reply: ${SITE}/reports#${REPORT}`);
    expect(e.text).toContain("Thanks! We fixed it.\nTry again <now>.");
  });

  it("whatever the reply or the report says, nothing becomes markup or a link", () => {
    const e = bugReplyEmail({ ...base, reply: `<a href="https://evil.example">x</a><script>alert(1)</script>`, reported: `<img src=x onerror=alert(1)> visit evil.example` });
    expect(e.html).not.toMatch(/<script|<img|<a href="https:\/\/evil/);
    expect(e.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(hrefs(e.html).every((h) => h.startsWith(SITE))).toBe(true);
    expect(visibleText(e.html)).toContain("visit [link]");
  });

  it("a report with no words: no quote, the sentence ends", () => {
    const seen = visibleText(bugReplyEmail({ ...base, reported: "" }).html);
    expect(seen).toContain("You sent us a bug report on Friday, October 9.");
    expect(seen).not.toContain("“");
  });

  it("to a kid's grown-up: the kid's name, where to answer, never 'your bug report'", () => {
    const e = bugReplyEmail({ ...base, kid: { name: "Maya" } });
    expect(e.subject).toBe("We replied to Maya's bug report");
    const seen = visibleText(e.html);
    expect(seen).toContain("Maya sent us a bug report on Friday, October 9:");
    expect(seen).toContain("switch to Maya's profile on Agathon");
    expect(seen).toContain("you're its grown-up");
    const nameless = bugReplyEmail({ ...base, kid: { name: null } });
    expect(nameless.subject).toBe("We replied to a bug report from your family");
    expect(visibleText(nameless.html)).toContain("switch to their profile");
  });

  it("calm: no exclamation mark of our own", () => {
    const e = bugReplyEmail({ ...base, reply: "Fixed." });
    expect(visibleText(e.html).replace("Fixed.", "")).not.toContain("!");
  });

  it("refuses a report id that is not a uuid or a site URL that is not http(s)", () => {
    expect(() => bugReportLink(SITE, "../admin")).toThrow(/not a report id/);
    expect(() => bugReplyEmail({ ...base, siteUrl: "javascript:alert(1)" })).toThrow();
  });
});

describe("reporterRepliedEmail (to ALERT_EMAIL)", () => {
  it("who replied in the subject, their words (escaped, a paragraph a line), the report in the inbox", () => {
    const e = reporterRepliedEmail({ who: "maya@example.com", reportId: REPORT, body: "still broken\n<b>help</b>" }, { siteUrl: SITE });
    expect(e.subject).toBe("maya@example.com replied to their bug report");
    expect(e.text).toContain("They wrote:\n\nstill broken\n\n<b>help</b>");
    expect(e.html).toContain("&lt;b&gt;help&lt;/b&gt;");
    expect(hrefs(e.html)).toEqual([`${SITE}/admin/bugs?id=${REPORT}`]);
  });

  it("a long reply is cut, and says so", () => {
    const e = reporterRepliedEmail({ who: null, reportId: REPORT, body: "x".repeat(2500) }, { siteUrl: SITE });
    expect(e.subject).toBe("Someone replied to their bug report");
    expect(e.text).toContain("(Cut short here: the rest is in the inbox.)");
  });
});

describe("sendBugReplyEmail", () => {
  const input = (over: Partial<BugReplyEmailInput> = {}): BugReplyEmailInput => ({
    reportId: REPORT,
    reporterId: REPORTER,
    messageId: MESSAGE,
    reply: "We fixed it.",
    reported: "Solve keeps spinning",
    reportedAt: SENT_AT.toISOString(),
    recipient: { email: "maya@example.com", to: "reporter", kidName: null },
    ...over,
  });

  it("sends once per message: email_log (bug_reply, the message's id, the reporter's account) and an Idempotency-Key", async () => {
    const deps = fakeDeps();
    expect(await sendBugReplyEmail(deps, testEnv(), input(), silentLog())).toEqual({ status: "sent", to: "reporter" });
    expect(deps.sent).toHaveLength(1);
    expect(deps.sent[0]).toMatchObject({ to: "maya@example.com", subject: "We replied to your bug report", idempotencyKey: bugReplyIdempotencyKey(MESSAGE), tags: { kind: BUG_REPLY_KIND } });
    expect(deps.log.rows).toEqual([expect.objectContaining({ user_id: REPORTER, kind: "bug_reply", ref: MESSAGE })]);
    // the same message again: not sent twice
    expect(await sendBugReplyEmail(deps, testEnv(), input(), silentLog())).toEqual({ status: "sent", to: "reporter" });
    expect(deps.sent).toHaveLength(1);
  });

  it("a kid's report goes to the grown-up, worded for them", async () => {
    const deps = fakeDeps();
    const r = await sendBugReplyEmail(deps, testEnv(), input({ recipient: { email: "parent@example.com", to: "grown_up", kidName: "Maya" } }), silentLog());
    expect(r).toEqual({ status: "sent", to: "grown_up" });
    expect(deps.sent[0]).toMatchObject({ to: "parent@example.com", subject: "We replied to Maya's bug report" });
  });

  it("Resend refusing: failed (the claim released for a retry), never a throw", async () => {
    const deps = fakeDeps();
    deps.sendReplies.push({ ok: false, error: "validation_error: bad", status: 422 });
    expect(await sendBugReplyEmail(deps, testEnv(), input(), silentLog())).toEqual({ status: "failed", to: "reporter" });
    expect(deps.log.rows).toEqual([]);
  });

  it("not set up (no RESEND_API_KEY, or no service role for the log): skipped, nothing sent", async () => {
    const deps = fakeDeps();
    expect(await sendBugReplyEmail(deps, testEnv({ resend: { apiKey: null } }), input(), silentLog())).toEqual({ status: "skipped", reason: "not_configured" });
    expect(await sendBugReplyEmail(deps, testEnv({ hasServiceRole: false }), input(), silentLog())).toEqual({ status: "skipped", reason: "not_configured" });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("a kid's address never reaches Resend, whoever passes it", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    const kid = "kid-3f2a9c1e-0000-4000-8000-000000000001@kids.agathon.app";
    const result = await sendEmail({ to: kid, subject: "We replied to your bug report", html: "<p>x</p>", text: "x" }, { apiKey: "re_test", fetchImpl });
    expect(result).toEqual({ ok: false, error: KID_ADDRESS_REFUSED });
  });
});

describe("sendReporterReplied", () => {
  const ask = { who: "maya@example.com", reportId: REPORT, messageId: MESSAGE, body: "still broken" };

  it("to ALERT_EMAIL, with an Idempotency-Key per message", async () => {
    const deps = fakeDeps();
    const r = await sendReporterReplied(deps, ask, silentLog());
    expect(r.status).toBe("sent");
    expect(deps.sent[0]).toMatchObject({ to: "owner@example.com", subject: "maya@example.com replied to their bug report", idempotencyKey: reporterRepliedIdempotencyKey(MESSAGE) });
  });

  it("no ALERT_EMAIL or no Resend: skipped and logged; Resend refusing: failed; never a throw", async () => {
    const log = silentLog();
    expect(await sendReporterReplied(fakeDeps({ env: testEnv({ alertEmail: null }) }), ask, log)).toEqual({ status: "skipped", reason: "no_alert_email" });
    expect(log.warn).toHaveBeenCalled();
    expect(await sendReporterReplied(fakeDeps({ env: testEnv({ resend: { apiKey: null } }) }), ask, silentLog())).toEqual({ status: "skipped", reason: "not_configured" });
    const failing = fakeDeps();
    failing.sendReplies.push({ ok: false, error: "timed out" });
    expect(await sendReporterReplied(failing, ask, silentLog())).toEqual({ status: "failed", error: "timed out" });
    const broken = fakeDeps();
    broken.getEnv = () => {
      throw new Error("env invalid");
    };
    expect(await sendReporterReplied(broken, ask, silentLog())).toEqual({ status: "failed", error: "env invalid" });
  });
});
