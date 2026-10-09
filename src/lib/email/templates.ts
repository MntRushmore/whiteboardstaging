/**
 * The transactional emails Agathon sends, as pure functions: input -> `{ subject, html, text }`.
 * No env, no network, no React: unit-tested in __tests__/templates.test.ts, rendered for review by
 * `renderPreviews` (the same functions the server sends with).
 *
 * Who reads these. The product is for students from about 5 up to high school, and the account is
 * often a parent's, so every email is written for a grown-up who may never have opened the app:
 * second person, calm, short, no exclamation marks, nothing that talks down. One idea per
 * paragraph, one button.
 *
 * What may be interpolated. Only values the server controls: the site's own URL, the billing
 * portal's URL, a date, the plan's price. Never anything a user typed (a display name, a board
 * title): sign-up does not confirm the address, so anyone can make an account with someone else's
 * email, and a name like "Claim your prize at evil.example" would then arrive in a stranger's inbox
 * from our domain. Everything interpolated is still HTML-escaped, and every link must be an
 * absolute http(s) URL (`emailHref`), so a bad env value can break an email loudly but never
 * inject markup or a `javascript:` link. One narrow exception (2026-10-09): the free trial's emails
 * to the grown-up name the student ("Maya's first practice is ready"), but only as a FIRST NAME
 * reduced by `safeFirstName` (src/lib/email/activity.ts) to a single word of letters, which cannot
 * carry a link or a sentence; anything else is no name, and the email reads without one.
 *
 * How the HTML is built (what email clients actually render): a table layout (Outlook ignores
 * flex/grid and most `max-width` on divs), every style inline (Gmail drops most <style> blocks),
 * system fonts, a fluid 560 px card that shrinks to the screen on phones, a "bulletproof" button
 * (a coloured table cell with a padded link, so it is still a button when images and CSS are
 * off), a hidden preheader (the grey line after the subject in the inbox), and light colours only
 * (`color-scheme: light`; clients that force dark mode invert it themselves). No images: they are
 * blocked by default in many clients, and the wordmark is text.
 */

/** A rendered email. `text` is the plain-text alternative sent beside the HTML. */
export type RenderedEmail = { subject: string; html: string; text: string };

/** The app's blue: the Help me button and every primary button (Tailwind blue-600). */
export const BRAND_BLUE = "#2563eb";

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = "#111827"; // body text (gray-900)
const MUTED = "#4b5563"; // secondary text (gray-600)
const FAINT = "#6b7280"; // footer (gray-500)
const PAGE_BG = "#f3f4f6"; // gray-100
const CARD_BORDER = "#e5e7eb"; // gray-200

/* ------------------------------------------------------------------------- */
/* Escaping and links                                                         */
/* ------------------------------------------------------------------------- */

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text for HTML element content and double- or single-quoted attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * A link target for an email: an absolute http(s) URL, normalised by the URL parser (which also
 * percent-encodes quotes, spaces and angle brackets). Throws for anything else (a relative path, a
 * `javascript:` URL, an empty value): an email with a broken button must fail before it is sent,
 * never go out with it. The caller still escapes the result for the attribute.
 */
export function emailHref(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`email link is not an absolute URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`email link must be http(s): ${JSON.stringify(url)}`);
  }
  return parsed.toString();
}

/** `base` + `path` as an email link (`/account` on the site, keeping any base path, dropping a query or hash). */
export function siteLink(base: string, path = "/"): string {
  const root = new URL(emailHref(base));
  root.search = "";
  root.hash = "";
  if (!root.pathname.endsWith("/")) root.pathname += "/";
  return emailHref(new URL(path.replace(/^\/+/, ""), root).toString());
}

/* ------------------------------------------------------------------------- */
/* Dates                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * The zone a date in an email is written in. The server does not know the reader's zone (the
 * account does not store one, and a cron has no browser), and Agathon's families are in the US.
 * Eastern time is named in the text, so a reader elsewhere can convert; the time is given too,
 * because the charge happens at that instant, not at midnight.
 */
export const EMAIL_TIME_ZONE = "America/New_York";

/** "Friday, October 9" and "11:04 PM EDT" for `date` in `timeZone`. */
export function formatEmailDate(date: Date, timeZone: string = EMAIL_TIME_ZONE): { day: string; time: string } {
  if (Number.isNaN(date.getTime())) throw new Error("email date is not a valid date");
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(date);
  return { day, time };
}

/* ------------------------------------------------------------------------- */
/* Layout                                                                     */
/* ------------------------------------------------------------------------- */

/** A paragraph of body text. `html` is trusted markup built here, never user input. */
function paragraph(html: string, opts: { muted?: boolean; size?: number; margin?: string } = {}): string {
  const size = opts.size ?? 16;
  return `<p style="margin:${opts.margin ?? "0 0 16px"};font-family:${FONT_STACK};font-size:${size}px;line-height:${Math.round(size * 1.55)}px;color:${opts.muted ? MUTED : INK};">${html}</p>`;
}

/** The main heading inside the card. */
function heading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:24px;line-height:32px;font-weight:700;color:${INK};">${escapeHtml(text)}</h1>`;
}

/** `text` escaped, with the first `word` in it in bold (a button's name in a sentence). */
function withBold(text: string, word: string): string {
  const escaped = escapeHtml(text);
  const bold = escapeHtml(word);
  const at = escaped.indexOf(bold);
  return at < 0 ? escaped : `${escaped.slice(0, at)}<strong>${bold}</strong>${escaped.slice(at + bold.length)}`;
}

/** A small pill drawn like the app's own button, so the reader recognises it on the board. */
function pill(label: string, opts: { filled: boolean }): string {
  const colours = opts.filled
    ? `background-color:${BRAND_BLUE};color:#ffffff;border:1px solid ${BRAND_BLUE};`
    : `background-color:#ffffff;color:${INK};border:1px solid #d1d5db;`;
  return `<span style="display:inline-block;${colours}border-radius:999px;padding:2px 12px;font-family:${FONT_STACK};font-size:14px;line-height:22px;font-weight:600;white-space:nowrap;">${escapeHtml(label)}</span>`;
}

/** A row of the "two things worth knowing" list: the pill on top, then the sentence. */
function tip(pillHtml: string, bodyHtml: string): string {
  return `<tr><td style="padding:0 0 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border:1px solid ${CARD_BORDER};border-radius:10px;">
<tr><td style="padding:16px;">
<div style="margin:0 0 8px;">${pillHtml}</div>
${paragraph(bodyHtml, { margin: "0" })}
</td></tr>
</table>
</td></tr>`;
}

/** The bulletproof primary button. */
function button(label: string, href: string): string {
  const url = escapeHtml(emailHref(href));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;">
<tr><td align="center" bgcolor="${BRAND_BLUE}" style="border-radius:8px;background-color:${BRAND_BLUE};">
<a href="${url}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:${FONT_STACK};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
</td></tr>
</table>`;
}

/** A plain inline link in body text. */
function link(label: string, href: string): string {
  return `<a href="${escapeHtml(emailHref(href))}" target="_blank" style="color:${BRAND_BLUE};text-decoration:underline;">${escapeHtml(label)}</a>`;
}

/**
 * The page around a card: wordmark, white card, footer. `preheader` is the inbox preview line;
 * the zero-width filler after it stops clients from pulling body text into the preview.
 */
function layout({ title, preheader, card, footer }: { title: string; preheader: string; card: string; footer: string }): string {
  const filler = "&#847;&zwnj;&nbsp;".repeat(40);
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  @media (max-width: 480px) { .card-pad { padding: 24px 20px !important; } .outer-pad { padding: 16px 8px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE_BG};">${escapeHtml(preheader)}${filler}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">
<tr><td align="center" class="outer-pad" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
<tr><td style="padding:0 4px 16px;font-family:${FONT_STACK};font-size:20px;line-height:28px;font-weight:700;color:${INK};letter-spacing:-0.2px;">Agathon</td></tr>
<tr><td class="card-pad" style="background-color:#ffffff;border:1px solid ${CARD_BORDER};border-radius:12px;padding:32px;">
${card}
</td></tr>
<tr><td style="padding:20px 4px 0;font-family:${FONT_STACK};font-size:13px;line-height:20px;color:${FAINT};">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

/** Plain-text paragraphs, wrapped by the reader's client. */
function textBody(parts: string[]): string {
  return `${parts.map((p) => p.trim()).join("\n\n")}\n`;
}

/* ------------------------------------------------------------------------- */
/* Welcome                                                                    */
/* ------------------------------------------------------------------------- */

export type WelcomeEmailInput = {
  /** The site's origin (NEXT_PUBLIC_SITE_URL); the button opens the home with the student's boards. */
  siteUrl: string;
};

export const WELCOME_SUBJECT = "Welcome to Agathon";

/**
 * Sent once per account, after the student finishes the guided first board (POST
 * /api/email/welcome). What Agathon does in two lines, the two buttons a student needs (Help me
 * when stuck, Ask for more practice, as they look on the board), and a way back in.
 */
export function welcomeEmail({ siteUrl }: WelcomeEmailInput): RenderedEmail {
  const home = siteLink(siteUrl, "/");
  const subject = WELCOME_SUBJECT;
  const preheader = "Write your work by hand. Your tutor checks each step, and help is one tap away.";
  const intro1 = "Agathon is a whiteboard with a patient tutor built in.";
  const intro2 = "You write your work by hand, one step at a time, and the tutor checks each step as you go.";
  const twoThings = "Two things are worth knowing, whether you're the student or the grown-up who set this up.";
  const helpText = "When you're stuck, tap the big blue Help me button. Your tutor writes the next step, so you can keep going.";
  const askText = "For more practice, open Ask and type something like “3 more like this”. New problems appear on your board.";
  const footer = "You're getting this email because an Agathon account was just set up with this address. If that wasn't you, you can ignore it.";

  // The button names in bold, as they read on the board.
  const helpHtml = withBold(helpText, "Help me");
  const askHtml = withBold(askText, "Ask");

  const card = [
    heading("Welcome to Agathon"),
    paragraph(`${escapeHtml(intro1)} ${escapeHtml(intro2)}`),
    paragraph(escapeHtml(twoThings)),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${tip(pill("Help me", { filled: true }), helpHtml)}
${tip(pill("Ask", { filled: false }), askHtml)}
</table>`,
    button("Open Agathon", home),
  ].join("\n");

  const html = layout({ title: subject, preheader, card, footer: escapeHtml(footer) });
  const text = textBody([
    "Welcome to Agathon",
    `${intro1} ${intro2}`,
    twoThings,
    `- ${helpText}`,
    `- ${askText}`,
    `Open Agathon: ${home}`,
    "--",
    footer,
  ]);
  return { subject, html, text };
}

/* ------------------------------------------------------------------------- */
/* Free trial ending                                                           */
/* ------------------------------------------------------------------------- */

export type TrialReminderInput = {
  /** When the free trial ends and the first charge is made (Stripe's `trial_end`). */
  trialEnd: Date;
  /** Where to manage or cancel (NEXT_PUBLIC_BILLING_PORTAL_URL, else the account page). */
  manageUrl: string;
  /** The site's origin, for the footer. */
  siteUrl: string;
  /** The plan as sold (UNLIMITED_PLAN in src/lib/billing/unlimited.ts). */
  planName: string;
  monthlyUsd: number;
  /** what the family did during the trial (src/lib/email/activity.ts, familyProgress); shown when not empty */
  progress?: readonly LearnerProgress[];
  timeZone?: string;
};

/** "$25", or "$12.50" for a price with cents. */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`not a price: ${amount}`);
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/**
 * Sent once per subscription, about two days before the free trial ends (GET
 * /api/cron/trial-reminders). It says when the card will be charged and how much, that nothing is
 * needed to keep the plan, and how to cancel: the email that prevents a surprise charge, and so a
 * chargeback. Plain facts first; the cancel link is in the body, not hidden in the footer.
 */
export function trialReminderEmail(input: TrialReminderInput): RenderedEmail {
  const { day, time } = formatEmailDate(input.trialEnd, input.timeZone);
  const price = formatUsd(input.monthlyUsd);
  const manage = emailHref(input.manageUrl);
  const site = siteLink(input.siteUrl, "/");
  const plan = input.planName;

  const subject = `Your free trial of ${plan} ends on ${day}`;
  const preheader = `On ${day}, your card will be charged ${price}. Nothing to do if you'd like to keep it.`;
  const ends = `Your free trial ends on ${day}, at ${time}.`;
  const charge = `On ${day}, your card will be charged ${price} for ${plan}. After that it's ${price} a month until you cancel.`;
  const keep = "Nothing to do if you'd like to keep it.";
  const cancelLead = "To cancel, use";
  const cancelTail = "Cancel before the free trial ends and you won't be charged.";
  const footer = `You're getting this email because ${plan} was started with a free trial on your Agathon account.`;
  const progress = (input.progress ?? []).filter((p) => progressLines(p).length > 0);
  const soFar = progress.length ? soFarLead(progress) : null;

  const card = [
    heading("Your free trial is almost over"),
    paragraph(escapeHtml(ends)),
    paragraph(escapeHtml(charge)),
    paragraph(escapeHtml(keep)),
    ...(soFar ? [paragraph(escapeHtml(soFar)), progressBlocks(progress)] : []),
    paragraph(`${escapeHtml(cancelLead)} ${link("Manage or cancel", manage)}. ${escapeHtml(cancelTail)}`),
    button("Manage or cancel", manage),
  ].join("\n");

  const html = layout({
    title: subject,
    preheader,
    card,
    footer: `${escapeHtml(footer)} ${link("Open Agathon", site)}`,
  });
  const text = textBody([
    "Your free trial is almost over",
    ends,
    charge,
    keep,
    ...(soFar ? [soFar, progressText(progress)] : []),
    `To cancel, use Manage or cancel: ${manage}`,
    cancelTail,
    "--",
    footer,
    `Agathon: ${site}`,
  ]);
  return { subject, html, text };
}

/* ------------------------------------------------------------------------- */
/* Free trial started                                                          */
/* ------------------------------------------------------------------------- */

export type UnlimitedStartedInput = {
  /** When the free trial ends and the first charge is made (Stripe's `trial_end`). */
  trialEnd: Date;
  /** Where to manage or cancel (NEXT_PUBLIC_BILLING_PORTAL_URL, else the account page). */
  manageUrl: string;
  /** The site's origin: the plan's terms and the refund policy are linked from it. */
  siteUrl: string;
  /** The plan as sold (UNLIMITED_PLAN in src/lib/billing/unlimited.ts). */
  planName: string;
  monthlyUsd: number;
  /**
   * A second (or later) plan on the account: its trial runs in Stripe, but the free trial's help is
   * for a first plan only (has_unlimited() in 20261003040000_go_live_gaps.sql), so the email says
   * the plan starts with the first charge instead of welcoming a free trial.
   */
  repeat?: boolean;
  timeZone?: string;
};

/** The section of the Terms on how the plan renews and is cancelled (what the plan screens link to). */
export const UNLIMITED_TERMS_PATH = "/terms#unlimited";
/** The refund policy's section on the plan. */
export const UNLIMITED_REFUNDS_PATH = "/refunds#subscriptions";

/**
 * Sent once per subscription, to the person who paid, when the webhook first sees the plan in its
 * free trial and linked to an account (src/lib/email/unlimitedStarted.ts). Auto-renewal laws ask for
 * this acknowledgment: that the plan renews by itself, what it costs, when the card is first
 * charged and how to cancel, with the terms. Plain facts first; the cancel link is in the body.
 */
export function unlimitedStartedEmail(input: UnlimitedStartedInput): RenderedEmail {
  const { day, time } = formatEmailDate(input.trialEnd, input.timeZone);
  const price = formatUsd(input.monthlyUsd);
  const manage = emailHref(input.manageUrl);
  const site = siteLink(input.siteUrl, "/");
  const terms = siteLink(input.siteUrl, UNLIMITED_TERMS_PATH);
  const refunds = siteLink(input.siteUrl, UNLIMITED_REFUNDS_PATH);
  const plan = input.planName;

  const subject = input.repeat ? `Your ${plan} plan starts on ${day}` : `Your free trial of ${plan} has started`;
  const title = input.repeat ? "Your plan is set up" : "Your free trial has started";
  const preheader = `Nothing was charged today. Your card will be charged ${price} on ${day} unless you cancel before then.`;
  const started = input.repeat ? `Your ${plan} plan is set up. Nothing was charged today.` : `Your free trial of ${plan} has started. Nothing was charged today.`;
  const charge = `On ${day} at ${time}, your card will be charged ${price}, then ${price} every month until you cancel.`;
  const firstPlanOnly = "The free trial is for a first plan only, so until then help uses ink.";
  const cancelLead = "To cancel, use";
  const cancelTail = `Cancel before ${day} at ${time} and you won't be charged.`;
  const footer = `You're getting this email because ${plan} was started at checkout with this email address, for an Agathon account.`;

  const card = [
    heading(title),
    paragraph(escapeHtml(started)),
    paragraph(escapeHtml(charge)),
    ...(input.repeat ? [paragraph(escapeHtml(firstPlanOnly))] : []),
    paragraph(`${escapeHtml(cancelLead)} ${link("Manage or cancel", manage)}. ${escapeHtml(cancelTail)}`),
    button("Manage or cancel", manage),
    paragraph(`${escapeHtml("The plan's terms:")} ${link("How the plan works", terms)} ${escapeHtml("and our")} ${link("refund policy", refunds)}.`, { muted: true, size: 14 }),
  ].join("\n");

  const html = layout({ title: subject, preheader, card, footer: `${escapeHtml(footer)} ${link("Open Agathon", site)}` });
  const text = textBody([
    title,
    started,
    charge,
    ...(input.repeat ? [firstPlanOnly] : []),
    `To cancel, use Manage or cancel: ${manage}`,
    cancelTail,
    `How the plan works: ${terms}`,
    `Refund policy: ${refunds}`,
    "--",
    footer,
    `Agathon: ${site}`,
  ]);
  return { subject, html, text };
}

/* ------------------------------------------------------------------------- */
/* What the family did (the free trial's emails)                              */
/* ------------------------------------------------------------------------- */

/**
 * One learner's trial so far, as the emails say it (built by src/lib/email/activity.ts). `name` is
 * already a safe first name (`safeFirstName`) or null; everything else is a count or a skill name
 * from the app's own list.
 */
export type LearnerProgress = {
  name: string | null;
  /** problems started in the period */
  tried: number;
  solved: number;
  alone: number;
  /** skill names, most practiced first */
  skills: readonly string[];
  /** days of Today's practice completed in a row */
  streak: number;
  /** days Today's practice was completed in the period */
  practiceDays: number;
};

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
export function listOf(items: readonly string[], max = 3): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** "Maya's", "Maya and Leo's"; null for no name or three and more (the email then reads without names). */
export function whose(names: readonly string[]): string | null {
  if (names.length === 1) return `${names[0]}'s`;
  if (names.length === 2) return `${names[0]} and ${names[1]}'s`;
  return null;
}

/** A learner's trial in short lines: problems, skills, Today's practice. Empty when there is nothing to say. */
export function progressLines(p: LearnerProgress): string[] {
  const lines: string[] = [];
  if (p.solved > 0) {
    const alone = p.alone <= 0 ? "" : p.alone >= p.solved ? (p.solved === 1 ? ", without help" : ", all without help") : `, ${p.alone} without help`;
    lines.push(`${p.solved} ${p.solved === 1 ? "problem" : "problems"} solved${alone}`);
  }
  else if (p.tried > 0) lines.push(`${p.tried} ${p.tried === 1 ? "problem" : "problems"} started`);
  if (p.skills.length > 0) lines.push(`Practiced: ${listOf(p.skills)}`);
  if (p.streak >= 2) lines.push(`Today's practice: ${p.streak} days in a row`);
  else if (p.practiceDays > 0) lines.push(`Today's practice: done on ${p.practiceDays} ${p.practiceDays === 1 ? "day" : "days"}`);
  return lines;
}

/** The sentence before the blocks: "Here's what Maya has done so far:" (or without a name). */
function soFarLead(progress: readonly LearnerProgress[]): string {
  const names = progress.map((p) => p.name).filter((n): n is string => n !== null);
  if (progress.length === 1 && names.length === 1) return `Here's what ${names[0]} has done so far:`;
  if (progress.length === 2 && names.length === 2) return `Here's what ${names[0]} and ${names[1]} have done so far:`;
  return "Here's what's been done so far:";
}

/** One grey box per learner: the name (when there is one), then the lines. */
function progressBlocks(progress: readonly LearnerProgress[]): string {
  const rows = progress.map((p) => {
    const lines = progressLines(p);
    const title = p.name ? paragraph(`<strong>${escapeHtml(p.name)}</strong>`, { margin: "0 0 6px" }) : "";
    const body = lines.map((line, i) => paragraph(escapeHtml(line), { margin: i === lines.length - 1 ? "0" : "0 0 4px", size: 15 })).join("\n");
    return `<tr><td style="padding:0 0 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border:1px solid ${CARD_BORDER};border-radius:10px;">
<tr><td style="padding:16px;">
${title}
${body}
</td></tr>
</table>
</td></tr>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px;">
${rows.join("\n")}
</table>`;
}

/** The blocks as plain text: "Maya: 12 problems solved, 9 without help. Practiced: Times tables." */
function progressText(progress: readonly LearnerProgress[]): string {
  return progress
    .map((p) => {
      const lines = progressLines(p).join(". ");
      return p.name ? `- ${p.name}: ${lines}.` : `- ${lines}.`;
    })
    .join("\n");
}

/* ------------------------------------------------------------------------- */
/* Free trial nudge: the first practice                                       */
/* ------------------------------------------------------------------------- */

export type FirstPracticeInput = {
  /** the students' safe first names (activity.ts, learnerNames); none or several read without them */
  names: readonly string[];
  /** problems in a day's set (DAILY_GOAL) and about how long it takes */
  problems: number;
  minutes: number;
  /** the home, where Today's practice is */
  siteUrl: string;
  /** "Manage or cancel" in the footer */
  manageUrl: string;
  planName: string;
};

/**
 * Sent once per trial, about a day after it started, when nobody in the family has practiced since
 * the welcome (src/lib/email/nudges.ts). The plan is paid for by a grown-up who may never have seen
 * the app: what is waiting, how long it takes, and the one tap that starts it.
 */
export function firstPracticeEmail(input: FirstPracticeInput): RenderedEmail {
  const home = siteLink(input.siteUrl, "/");
  const manage = emailHref(input.manageUrl);
  const who = whose(input.names);
  const size = `${input.problems} problems, about ${input.minutes} minutes`;

  const title = who ? `${who} first practice is ready` : "Today's practice is ready";
  const subject = `${title}: ${size}`;
  const preheader = `${size}. Tap Today's practice on the Agathon home screen.`;
  const waiting = `A short set is waiting on Agathon: ${size}.`;
  const how =
    input.names.length === 1
      ? `Open Agathon and tap Today's practice on the home screen. ${input.names[0]} writes each step by hand, and the tutor checks it along the way.`
      : input.names.length > 1
        ? "Open Agathon and tap Today's practice on the home screen. Each child has a set of their own, and the tutor checks each step along the way."
        : "Open Agathon and tap Today's practice on the home screen. Each step is written by hand, and the tutor checks it along the way.";
  const habit = "A few minutes on most days is what makes it stick.";
  const footer = `You're getting this email because ${input.planName}'s free trial was started on your Agathon account.`;

  const card = [heading(title), paragraph(escapeHtml(waiting)), paragraph(escapeHtml(how)), paragraph(escapeHtml(habit)), button("Open Today's practice", home)].join("\n");
  const html = layout({ title: subject, preheader, card, footer: `${escapeHtml(footer)} ${link("Manage or cancel", manage)}` });
  const text = textBody([title, waiting, how, habit, `Open Today's practice: ${home}`, "--", footer, `Manage or cancel: ${manage}`]);
  return { subject, html, text };
}

/* ------------------------------------------------------------------------- */
/* Free trial nudge: how it's going                                           */
/* ------------------------------------------------------------------------- */

export type TrialProgressInput = {
  /** who did what (only learners with something to say); the email is not sent without any */
  progress: readonly LearnerProgress[];
  /** when the free trial ends and the first charge is made */
  trialEnd: Date;
  siteUrl: string;
  manageUrl: string;
  planName: string;
  timeZone?: string;
};

/**
 * Sent once per trial, around its fourth day, when the family has done something
 * (src/lib/email/nudges.ts): what each child did, so the grown-up sees what they are paying for
 * before the card is charged, and when the trial ends.
 */
export function trialProgressEmail(input: TrialProgressInput): RenderedEmail {
  const progress = input.progress.filter((p) => progressLines(p).length > 0);
  if (progress.length === 0) throw new Error("trial progress email without any progress");
  const { day } = formatEmailDate(input.trialEnd, input.timeZone);
  const home = siteLink(input.siteUrl, "/");
  const manage = emailHref(input.manageUrl);
  const names = progress.map((p) => p.name).filter((n): n is string => n !== null);
  const who = names.length === progress.length ? whose(names) : null;

  const subject = who ? `${who} first days on Agathon` : "Your first days on Agathon";
  const title = "Here's how it's going";
  const preheader = `${progressLines(progress[0])[0]}. The free trial runs until ${day}.`;
  const lead = soFarLead(progress);
  const trial = `The free trial runs until ${day}. Nothing to do if you'd like to keep going.`;
  const footer = `You're getting this email because ${input.planName}'s free trial was started on your Agathon account.`;

  const card = [
    heading(title),
    paragraph(escapeHtml(lead)),
    progressBlocks(progress),
    paragraph(`${escapeHtml(trial)} ${escapeHtml("To stop, use")} ${link("Manage or cancel", manage)}.`),
    button("Open Agathon", home),
  ].join("\n");
  const html = layout({ title: subject, preheader, card, footer: escapeHtml(footer) });
  const text = textBody([title, lead, progressText(progress), trial, `To stop, use Manage or cancel: ${manage}`, `Open Agathon: ${home}`, "--", footer]);
  return { subject, html, text };
}
