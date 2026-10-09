/**
 * The Sunday email (2026-10-09, Phase 2 "parents recommend it"): each child's week in a few numbers,
 * what they mastered, what they practiced, and the one thing to try next week, with a button to the
 * full report. A parent keeps paying when they can see it working, and this is the email they
 * forward to another parent. Built but OFF unless WEEKLY_REPORT_EMAILS=on (sent by
 * src/lib/email/weeklyReportSend.ts from the daily cron).
 *
 * The same rules as every Agathon email (src/lib/email/templates.ts, whose layout this reuses): pure,
 * a table layout with inline styles only, second person, calm, no exclamation marks, one button.
 * What is interpolated: counts, skill names and tips from the app's own lists, the week's dates, and
 * each child's FIRST NAME reduced by `safeFirstName` (src/lib/email/activity.ts) to one word of
 * letters, the one narrow exception the trial emails already make; a name that does not pass reads
 * "Your kid". Everything is escaped, and every link is an absolute http(s) URL (`emailHref`).
 */
import { safeFirstName } from "@/lib/email/activity";
import {
  BRAND_BLUE,
  CARD_BORDER,
  FONT_STACK,
  INK,
  MUTED,
  button,
  emailHref,
  escapeHtml,
  heading,
  layout,
  link,
  listOf,
  paragraph,
  siteLink,
  textBody,
  whose,
  type RenderedEmail,
} from "@/lib/email/templates";
import { gradeLabel, isGrade } from "@/lib/learning/grades";
import { hasActivity } from "@/lib/report/build";
import { REPORT_PATH, type ChildWeek, type WeeklyReport } from "@/lib/report/contracts";
import { weekLabel } from "@/lib/report/view";

export type WeeklyReportEmailInput = {
  report: WeeklyReport;
  /** the site's origin (NEXT_PUBLIC_SITE_URL); the button opens /report on this week */
  siteUrl: string;
  /** the signed unsubscribe link (src/lib/report/unsubscribe.ts): it asks, then turns the email off */
  unsubscribeUrl: string;
};

/** What a section is called: the child's safe first name, "You" for the grown-up's own week, else "Your kid". */
function sectionName(child: ChildWeek, ownerId: string): { title: string; name: string | null } {
  if (child.userId === ownerId) return { title: "You", name: null };
  const name = safeFirstName(child.displayName);
  return { title: name ?? "Your kid", name };
}

/** "24 problems, 18 on their own" for one week. */
function problemsLine(c: ChildWeek): string {
  if (c.problems === 0) return c.dailySets > 0 ? `${c.dailySets} Today's practice ${c.dailySets === 1 ? "set" : "sets"}` : "Some work started";
  return `${c.problems} ${c.problems === 1 ? "problem" : "problems"}, ${c.independent} on their own`;
}

/** One child's lines as plain text (the text part, and the tests' reading of the HTML). */
export function childLines(c: ChildWeek): string[] {
  const lines = [`${problemsLine(c)}. ${c.minutes} ${c.minutes === 1 ? "minute" : "minutes"}, ${c.activeDays} of 7 days active.`];
  if (c.newlyMastered.length > 0) lines.push(`New this week: mastered ${listOf(c.newlyMastered, 4)}.`);
  if (c.practised.length > 0) lines.push(`Practiced: ${c.practised.map((p) => `${p.name} (${p.problems})`).join(", ")}.`);
  if (c.streak >= 2) lines.push(`Today's practice: ${c.streak} days in a row.`);
  if (c.focus) lines.push(`Next week, try: ${c.focus.name}. ${c.focus.tip}`);
  return lines;
}

/** A big number over its label, one cell of the numbers row. */
function stat(value: number, label: string): string {
  return `<td width="25%" valign="top" style="padding:0 4px 0 0;">
<div style="font-family:${FONT_STACK};font-size:26px;line-height:32px;font-weight:700;color:${INK};">${value}</div>
<div style="font-family:${FONT_STACK};font-size:13px;line-height:18px;color:${MUTED};">${escapeHtml(label)}</div>
</td>`;
}

/** One child's section: name and grade, the numbers, then what's new, practiced, and next. */
function childBlock(c: ChildWeek, ownerId: string): string {
  const { title } = sectionName(c, ownerId);
  const grade = isGrade(c.grade) ? gradeLabel(c.grade) : null;
  const rows: string[] = [];
  rows.push(`<p style="margin:0 0 14px;font-family:${FONT_STACK};font-size:18px;line-height:24px;font-weight:700;color:${INK};">${escapeHtml(title)}${grade ? ` <span style="font-weight:400;font-size:14px;color:${MUTED};">&middot; ${escapeHtml(grade)}</span>` : ""}</p>`);
  rows.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr>
${stat(c.problems, "Problems")}
${stat(c.independent, "On their own")}
${stat(c.minutes, "Minutes")}
${stat(c.activeDays, "Days active")}
</tr></table>`);
  if (c.newlyMastered.length > 0) {
    rows.push(
      `<p style="margin:0 0 10px;font-family:${FONT_STACK};font-size:15px;line-height:22px;color:#166534;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 12px;"><strong>New this week:</strong> mastered ${escapeHtml(listOf(c.newlyMastered, 4))}</p>`,
    );
  }
  if (c.practised.length > 0) {
    rows.push(paragraph(`<strong>Practiced:</strong> ${escapeHtml(c.practised.map((p) => `${p.name} (${p.problems})`).join(", "))}`, { size: 15, margin: "0 0 8px" }));
  }
  if (c.streak >= 2) rows.push(paragraph(`<strong>Today's practice:</strong> ${c.streak} days in a row`, { size: 15, margin: "0 0 8px" }));
  if (c.focus) {
    rows.push(
      `<p style="margin:6px 0 0;font-family:${FONT_STACK};font-size:15px;line-height:22px;color:${INK};background-color:#eff6ff;border-left:3px solid ${BRAND_BLUE};border-radius:4px;padding:8px 12px;"><strong>Next week, try: ${escapeHtml(c.focus.name)}.</strong> ${escapeHtml(c.focus.tip)}</p>`,
    );
  }
  return `<tr><td style="padding:0 0 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border:1px solid ${CARD_BORDER};border-radius:10px;">
<tr><td style="padding:18px 16px;">
${rows.join("\n")}
</td></tr>
</table>
</td></tr>`;
}

/** The children an email talks about: those who did something this week. */
export function emailChildren(report: WeeklyReport): ChildWeek[] {
  return report.children.filter(hasActivity);
}

/**
 * The Sunday email for a report. Throws when nobody did anything (the sender skips such a family
 * and never asks for it): an empty week is not an email.
 */
export function weeklyReportEmail(input: WeeklyReportEmailInput): RenderedEmail {
  const children = emailChildren(input.report);
  if (children.length === 0) throw new Error("weekly report email without any activity");
  const range = weekLabel(input.report.weekStart);
  const full = siteLink(input.siteUrl, `${REPORT_PATH}?week=${input.report.weekStart}`);
  const stop = emailHref(input.unsubscribeUrl);
  const ownerId = input.report.ownerId;

  const sections = children.map((c) => sectionName(c, ownerId));
  const onlyOwner = children.length === 1 && children[0].userId === ownerId;
  const names = sections.map((s) => s.name).filter((n): n is string => n !== null);
  const who = onlyOwner ? "Your" : names.length === children.length ? whose(names) : null;
  const subject = `${who ?? "Your family's"} week on Agathon`;
  const total = children.reduce((sum, c) => sum + c.problems, 0);
  const alone = children.reduce((sum, c) => sum + c.independent, 0);
  const mastered = children.flatMap((c) => c.newlyMastered);
  const preheader = `${total} ${total === 1 ? "problem" : "problems"}, ${alone} on their own${mastered.length ? `. New: ${listOf(mastered, 2)}` : ""}. ${range}.`;
  const lead = `Here's the week of ${range}, Monday to Sunday.`;
  const footer = "You're getting this because the weekly report email is on for your Agathon account.";

  const card = [
    heading("How the week went"),
    paragraph(escapeHtml(lead), { muted: true }),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px;">
${children.map((c) => childBlock(c, ownerId)).join("\n")}
</table>`,
    button("See the full report", full),
    paragraph(escapeHtml("The full report has a replay of the board with the most work this week."), { muted: true, size: 14, margin: "8px 0 0" }),
  ].join("\n");

  const html = layout({ title: subject, preheader, card, footer: `${escapeHtml(footer)} ${link("Stop these emails", stop)}` });
  const text = textBody([
    "How the week went",
    lead,
    ...children.map((c, i) => [sections[i].title, ...childLines(c).map((l) => `- ${l}`)].join("\n")),
    `See the full report: ${full}`,
    "--",
    footer,
    `Stop these emails: ${stop}`,
  ]);
  return { subject, html, text };
}
