/**
 * The Sunday weekly report email (src/lib/email/weeklyReport.ts) and its sender
 * (src/lib/email/weeklyReportSend.ts): what it says, where it links, whom it goes to, and that it
 * stays off without WEEKLY_REPORT_EMAILS=on. No network, no database: EmailDeps from fakes.ts and a
 * WeeklyReportDeps of plain functions.
 */
import { describe, expect, it, vi } from "vitest";
import { weeklyReportEmail, childLines } from "@/lib/email/weeklyReport";
import { fairOrder, runWeeklyReports, weeklyEmailDue, weeklyEmailWeek, WEEKLY_REPORT_KIND, type PlanHolder, type WeeklyReportDeps } from "@/lib/email/weeklyReportSend";
import type { ChildWeek, WeeklyReport } from "@/lib/report/contracts";
import { verifyUnsubscribe } from "@/lib/report/unsubscribe";
import { fakeDeps, silentLog, SITE, testEnv } from "./fakes";

const PARENT = "10000000-0000-4000-8000-000000000001";
const KID = "10000000-0000-4000-8000-000000000002";
const KID2 = "10000000-0000-4000-8000-000000000003";
const SOLO = "30000000-0000-4000-8000-000000000001";
const UNSUB = "https://whiteboard.example.com/api/report/unsubscribe?u=x&t=y";

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const visible = (html: string) =>
  html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#847;|&zwnj;|&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&middot;/g, "·")
    .replace(/\s+/g, " ");

function child(over: Partial<ChildWeek> = {}): ChildWeek {
  return {
    userId: KID,
    displayName: "Maya",
    avatar: "fox",
    grade: 3,
    problems: 24,
    independent: 18,
    minutes: 46,
    activeDays: 4,
    dailySets: 3,
    streak: 4,
    newlyMastered: ["Times tables"],
    practised: [
      { skill: "times_tables", name: "Times tables", problems: 14, independent: 12 },
      { skill: "division_facts", name: "Division facts", problems: 6, independent: 3 },
    ],
    focus: { skill: "division_facts", name: "Division facts", tip: "Turn each division into a times question: 42 ÷ 6 is “6 times what makes 42?”" },
    highlightBoardId: null,
    ...over,
  };
}

const quiet = (over: Partial<ChildWeek> = {}) => child({ problems: 0, independent: 0, minutes: 0, activeDays: 0, dailySets: 0, streak: 0, newlyMastered: [], practised: [], focus: null, ...over });

function report(children: ChildWeek[], ownerId = PARENT): WeeklyReport {
  return { weekStart: "2026-10-05", timeZone: "America/New_York", ownerId, children, generatedAt: "2026-10-11T15:00:00.000Z" };
}

describe("weeklyReportEmail", () => {
  it("tells each child's week, names them, and links to the full report and the unsubscribe", () => {
    const email = weeklyReportEmail({ report: report([child(), child({ userId: KID2, displayName: "Leo Smith", grade: 1, newlyMastered: [], streak: 0, focus: null })]), siteUrl: SITE, unsubscribeUrl: UNSUB });
    expect(email.subject).toBe("Maya and Leo's week on Agathon");
    const text = visible(email.html);
    expect(text).toContain("How the week went");
    expect(text).toContain("Here's the week of Oct 5 – 11, Monday to Sunday.");
    expect(text).toContain("Maya · 3rd grade");
    expect(text).toContain("Leo · 1st grade");
    expect(text).toContain("New this week: mastered Times tables");
    expect(text).toContain("Practiced: Times tables (14), Division facts (6)");
    expect(text).toContain("Today's practice: 4 days in a row");
    expect(text).toContain("Next week, try: Division facts.");
    expect(hrefs(email.html)).toEqual([`${SITE}/report?week=2026-10-05`, UNSUB]);
    expect(email.text).toContain(`See the full report: ${SITE}/report?week=2026-10-05`);
    expect(email.text).toContain(`Stop these emails: ${UNSUB}`);
    expect(email.text).toContain("- New this week: mastered Times tables.");
  });

  it("leaves out a quiet child, and says 'Your week' for a solo student", () => {
    const email = weeklyReportEmail({ report: report([child(), quiet({ userId: KID2, displayName: "Leo" })]), siteUrl: SITE, unsubscribeUrl: UNSUB });
    expect(email.subject).toBe("Maya's week on Agathon");
    expect(visible(email.html)).not.toContain("Leo");
    const solo = weeklyReportEmail({ report: report([child({ userId: SOLO, displayName: "Sam" })], SOLO), siteUrl: SITE, unsubscribeUrl: UNSUB });
    expect(solo.subject).toBe("Your week on Agathon");
    expect(visible(solo.html)).toContain("You · 3rd grade");
  });

  it("never carries a typed name that could be a link or a sentence", () => {
    const email = weeklyReportEmail({ report: report([child({ displayName: "<b>Win</b> a prize at evil.example" })]), siteUrl: SITE, unsubscribeUrl: UNSUB });
    expect(email.subject).toBe("Your family's week on Agathon");
    expect(email.html).not.toContain("evil.example");
    expect(email.html).not.toContain("<b>Win");
    expect(email.text).not.toContain("evil.example");
    expect(visible(email.html)).toContain("Your kid · 3rd grade");
  });

  it("refuses an empty week, and a link that is not http(s)", () => {
    expect(() => weeklyReportEmail({ report: report([quiet()]), siteUrl: SITE, unsubscribeUrl: UNSUB })).toThrow(/without any activity/);
    expect(() => weeklyReportEmail({ report: report([child()]), siteUrl: SITE, unsubscribeUrl: "javascript:alert(1)" })).toThrow();
  });

  it("says a week with only Today's practice plainly", () => {
    expect(childLines(quiet({ dailySets: 2, streak: 2, activeDays: 2 }))[0]).toBe("2 Today's practice sets. 0 minutes, 2 of 7 days active.");
  });
});

describe("weeklyEmailWeek", () => {
  it("is this week on Sunday, and last week on Monday and Tuesday (the catch-up), in New York", () => {
    expect(weeklyEmailWeek(new Date("2026-10-11T15:00:00Z"))).toBe("2026-10-05"); // Sunday 11:00 EDT
    expect(weeklyEmailWeek(new Date("2026-10-12T15:00:00Z"))).toBe("2026-10-05"); // Monday 11:00 EDT
    expect(weeklyEmailWeek(new Date("2026-10-12T17:00:00Z"))).toBe("2026-10-05"); // Monday 13:00
    expect(weeklyEmailWeek(new Date("2026-10-13T15:00:00Z"))).toBe("2026-10-05"); // Tuesday 11:00
    expect(weeklyEmailWeek(new Date("2026-10-14T15:00:00Z"))).toBeNull(); // Wednesday
    expect(weeklyEmailWeek(new Date("2026-10-08T15:00:00Z"))).toBeNull(); // Thursday
    expect(weeklyEmailWeek(new Date("2026-10-10T15:00:00Z"))).toBeNull(); // Saturday
    // 01:00 UTC Monday is still Sunday evening in New York
    expect(weeklyEmailWeek(new Date("2026-10-12T01:00:00Z"))).toBe("2026-10-05");
    // 02:00 UTC Wednesday is still Tuesday evening
    expect(weeklyEmailWeek(new Date("2026-10-14T02:00:00Z"))).toBe("2026-10-05");
  });

  it("knows Tuesday is the week's last day", () => {
    expect(weeklyEmailDue(new Date("2026-10-11T15:00:00Z"))).toEqual({ weekStart: "2026-10-05", lastDay: false });
    expect(weeklyEmailDue(new Date("2026-10-12T15:00:00Z"))).toEqual({ weekStart: "2026-10-05", lastDay: false });
    expect(weeklyEmailDue(new Date("2026-10-13T15:00:00Z"))).toEqual({ weekStart: "2026-10-05", lastDay: true });
  });
});

describe("fairOrder", () => {
  it("puts the families whose last weekly email is oldest first, never sent first of all, then by id", () => {
    const h = (userId: string): PlanHolder => ({ userId, payerEmail: null });
    const last = new Map([
      ["a", "2026-09-28"],
      ["b", "2026-09-21"],
      ["d", "2026-09-28"],
    ]);
    expect(fairOrder([h("d"), h("a"), h("b"), h("c"), h("e")], last).map((x) => x.userId)).toEqual(["c", "e", "b", "a", "d"]);
  });
});

describe("runWeeklyReports", () => {
  const SUNDAY = new Date("2026-10-11T15:00:00Z");

  function reportDeps(
    over: { holders?: PlanHolder[]; weeks?: Record<string, WeeklyReport | { kid: true } | { error: string }>; optedOut?: string[]; enabled?: boolean; sentTo?: () => Set<string>; lastSent?: Map<string, string> } = {},
  ): WeeklyReportDeps {
    return {
      enabled: () => over.enabled ?? true,
      planHolders: vi.fn(async () => over.holders ?? [{ userId: PARENT, payerEmail: "payer@example.com" }]),
      sentTo: vi.fn(async () => over.sentTo?.() ?? new Set<string>()),
      lastSent: vi.fn(async () => over.lastSent ?? new Map<string, string>()),
      optedOut: vi.fn(async () => new Set(over.optedOut ?? [])),
      familyWeek: vi.fn(async (userId: string) => {
        const w = over.weeks?.[userId] ?? report([child()], userId);
        if ("error" in w) return w;
        if ("kid" in w) return { report: report([], userId), kid: true };
        return { report: w, kid: false };
      }),
    };
  }

  it("is off without the flag: nothing read, nothing sent", async () => {
    const d = fakeDeps({ now: SUNDAY });
    const r = reportDeps({ enabled: false });
    expect(await runWeeklyReports(d, testEnv(), { dryRun: false }, silentLog(), r)).toEqual({ enabled: false });
    expect(r.planHolders).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it("reads nothing on a day with no email due", async () => {
    const r = reportDeps();
    const s = await runWeeklyReports(fakeDeps({ now: new Date("2026-10-08T15:00:00Z") }), testEnv(), { dryRun: false }, silentLog(), r);
    expect(s).toMatchObject({ enabled: true, weekStart: null, sent: 0 });
    expect(r.planHolders).not.toHaveBeenCalled();
  });

  it("sends each active family's week once, to the payer, with a signed unsubscribe link and one-click headers", async () => {
    const d = fakeDeps({ now: SUNDAY });
    const r = reportDeps({ sentTo: () => new Set(d.log.rows.filter((x) => x.kind === WEEKLY_REPORT_KIND && x.ref === "2026-10-05").map((x) => x.user_id)) });
    const s = await runWeeklyReports(d, testEnv(), { dryRun: false }, silentLog(), r);
    expect(s).toMatchObject({ enabled: true, weekStart: "2026-10-05", found: 1, sent: 1, failed: 0 });
    expect(d.sent).toHaveLength(1);
    const [msg] = d.sent;
    expect(msg.to).toBe("payer@example.com");
    expect(msg.subject).toBe("Maya's week on Agathon");
    expect(msg.tags).toEqual({ kind: "weekly_report" });
    expect(msg.idempotencyKey).toBe(`weekly-report/${PARENT}/2026-10-05`);
    const link = hrefs(msg.html).find((h) => h.includes("unsubscribe"))!;
    const stop = new URL(link);
    // signed with the link's own secret, not the cron's
    expect(verifyUnsubscribe(stop.searchParams.get("u"), stop.searchParams.get("t"), testEnv().reportLinkSecret)).toBe(PARENT);
    expect(verifyUnsubscribe(stop.searchParams.get("u"), stop.searchParams.get("t"), testEnv().cronSecret)).toBeNull();
    // the mail app's own Unsubscribe: RFC 8058 one-click, a POST to the same signed link
    expect(msg.headers).toEqual({ "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(d.log.rows).toMatchObject([{ user_id: PARENT, kind: "weekly_report", ref: "2026-10-05" }]);

    // Monday morning's run finds it sent
    const again = await runWeeklyReports(fakeDeps({ now: new Date("2026-10-12T15:00:00Z") }), testEnv(), { dryRun: false }, silentLog(), r);
    expect(again).toMatchObject({ sent: 0, alreadySent: 1 });
  });

  it("skips an opted-out account, a quiet week, a kid profile, and a kid address", async () => {
    const holders: PlanHolder[] = [
      { userId: "u-optout", payerEmail: null },
      { userId: "u-quiet", payerEmail: null },
      { userId: "u-kid", payerEmail: null },
      { userId: "u-kidmail", payerEmail: null },
    ];
    const d = fakeDeps({ now: SUNDAY, emails: { "u-kidmail": "kid-1@kids.agathon.app" } });
    const r = reportDeps({ holders, optedOut: ["u-optout"], weeks: { "u-quiet": report([quiet()], "u-quiet"), "u-kid": { kid: true } } });
    const s = await runWeeklyReports(d, testEnv(), { dryRun: false }, silentLog(), r);
    expect(s).toMatchObject({ sent: 0, skipped: { optedOut: 1, quiet: 1, kid: 1, noEmail: 1 } });
    expect(d.send).not.toHaveBeenCalled();
    expect(r.familyWeek).not.toHaveBeenCalledWith("u-optout", expect.anything(), expect.anything(), expect.anything());
  });

  it("lists without sending on a dry run, keeps to a manual cap, and counts a failed read", async () => {
    const holders: PlanHolder[] = [
      { userId: "a", payerEmail: null },
      { userId: "b", payerEmail: null },
      { userId: "c", payerEmail: null },
    ];
    const dry = fakeDeps({ now: SUNDAY });
    expect(await runWeeklyReports(dry, testEnv(), { dryRun: true }, silentLog(), reportDeps({ holders }))).toMatchObject({ wouldSend: ["a", "b", "c"], sent: 0 });
    expect(dry.send).not.toHaveBeenCalled();

    const capped = fakeDeps({ now: SUNDAY });
    expect(await runWeeklyReports(capped, testEnv(), { dryRun: false, maxSends: 2 }, silentLog(), reportDeps({ holders }))).toMatchObject({ sent: 2, deferred: 1 });
    expect(capped.slept).toEqual([600]);

    const broken = fakeDeps({ now: SUNDAY });
    expect(await runWeeklyReports(broken, testEnv(), { dryRun: false }, silentLog(), reportDeps({ holders, weeks: { b: { error: "down" } } }))).toMatchObject({ sent: 2, failed: 1 });
  });

  it("has no fixed count: every due family goes in one run while there is time", async () => {
    const holders: PlanHolder[] = Array.from({ length: 70 }, (_, i) => ({ userId: `u-${String(i).padStart(2, "0")}`, payerEmail: null }));
    const d = fakeDeps({ now: SUNDAY });
    const s = await runWeeklyReports(d, testEnv(), { dryRun: false, deadline: SUNDAY.getTime() + 40_000 }, silentLog(), reportDeps({ holders }));
    expect(s).toMatchObject({ found: 70, sent: 70, deferred: 0, failed: 0 });
  });

  it("stops starting families when the run's time is up; the oldest last email goes first, and the next run picks up the rest", async () => {
    const holders: PlanHolder[] = ["a", "b", "c", "d", "e"].map((userId) => ({ userId, payerEmail: null }));
    // a and b got last week's email, c two weeks ago, d and e never (or not lately)
    const lastSent = new Map([
      ["a", "2026-09-28"],
      ["b", "2026-09-28"],
      ["c", "2026-09-21"],
    ]);
    // each send takes 15 s on this clock: the run has 40 s
    const clocked = (start: Date) => {
      let t = start.getTime();
      const d = fakeDeps({ now: start });
      d.now = () => new Date(t);
      const send = d.send;
      d.send = vi.fn(async (...args: Parameters<typeof send>) => {
        t += 15_000;
        return send(...args);
      });
      return d;
    };
    const sunday = clocked(SUNDAY);
    const log = silentLog();
    const r = reportDeps({ holders, lastSent, sentTo: () => new Set(sunday.log.rows.filter((x) => x.ref === "2026-10-05").map((x) => x.user_id)) });
    const first = await runWeeklyReports(sunday, testEnv(), { dryRun: false, deadline: SUNDAY.getTime() + 40_000 }, log, r);
    expect(first).toMatchObject({ sent: 3, deferred: 2 });
    expect(sunday.sent.map((m) => m.to)).toEqual(["d@example.com", "e@example.com", "c@example.com"]);
    // not the week's last day: no warning yet
    expect(log.warn).not.toHaveBeenCalled();

    // Tuesday, the last day: a and b get theirs, and nobody twice
    const tuesday = clocked(new Date("2026-10-13T15:00:00Z"));
    tuesday.log.rows.push(...sunday.log.rows);
    const tlog = silentLog();
    const second = await runWeeklyReports(tuesday, testEnv(), { dryRun: false, deadline: Date.parse("2026-10-13T15:00:40Z") }, tlog, r);
    expect(second).toMatchObject({ weekStart: "2026-10-05", sent: 2, alreadySent: 3, deferred: 0 });
    expect(tuesday.sent.map((m) => m.to)).toEqual(["a@example.com", "b@example.com"]);
    expect(tlog.warn).not.toHaveBeenCalled();
  });

  it("warns when families are left on the week's last day", async () => {
    const holders: PlanHolder[] = ["a", "b"].map((userId) => ({ userId, payerEmail: null }));
    const tuesday = new Date("2026-10-13T15:00:00Z");
    const log = silentLog();
    // the deadline has already passed: nobody is started
    const s = await runWeeklyReports(fakeDeps({ now: tuesday }), testEnv(), { dryRun: false, deadline: tuesday.getTime() }, log, reportDeps({ holders }));
    expect(s).toMatchObject({ sent: 0, deferred: 2 });
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ weekStart: "2026-10-05", deferred: 2 }), expect.stringMatching(/without this week's email/));
  });

  it("throws when the plans cannot be read, or nothing can sign the unsubscribe link", async () => {
    const r = reportDeps();
    r.planHolders = async () => ({ error: "down" });
    await expect(runWeeklyReports(fakeDeps({ now: SUNDAY }), testEnv(), { dryRun: false }, silentLog(), r)).rejects.toThrow(/could not read the plans/);
    const d = fakeDeps({ now: SUNDAY });
    await expect(runWeeklyReports(d, testEnv({ reportLinkSecret: undefined }), { dryRun: false }, silentLog(), reportDeps())).rejects.toThrow(/cannot be signed/);
    expect(d.send).not.toHaveBeenCalled();
  });
});
