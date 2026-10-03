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
 * inject markup or a `javascript:` link.
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
/* Free week ending                                                           */
/* ------------------------------------------------------------------------- */

export type TrialReminderInput = {
  /** When the free week ends and the first charge is made (Stripe's `trial_end`). */
  trialEnd: Date;
  /** Where to manage or cancel (NEXT_PUBLIC_BILLING_PORTAL_URL, else the account page). */
  manageUrl: string;
  /** The site's origin, for the footer. */
  siteUrl: string;
  /** The plan as sold (UNLIMITED_PLAN in src/lib/billing/unlimited.ts). */
  planName: string;
  monthlyUsd: number;
  timeZone?: string;
};

/** "$25", or "$12.50" for a price with cents. */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`not a price: ${amount}`);
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/**
 * Sent once per subscription, about two days before the free week ends (GET
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

  const subject = `Your free week of ${plan} ends on ${day}`;
  const preheader = `On ${day}, your card will be charged ${price}. Nothing to do if you'd like to keep it.`;
  const ends = `Your free week ends on ${day}, at ${time}.`;
  const charge = `On ${day}, your card will be charged ${price} for ${plan}. After that it's ${price} a month until you cancel.`;
  const keep = "Nothing to do if you'd like to keep it.";
  const cancelLead = "To cancel, use";
  const cancelTail = "Cancel before the free week ends and you won't be charged.";
  const footer = `You're getting this email because ${plan} was started with a free week on your Agathon account.`;

  const card = [
    heading("Your free week is almost over"),
    paragraph(escapeHtml(ends)),
    paragraph(escapeHtml(charge)),
    paragraph(escapeHtml(keep)),
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
    "Your free week is almost over",
    ends,
    charge,
    keep,
    `To cancel, use Manage or cancel: ${manage}`,
    cancelTail,
    "--",
    footer,
    `Agathon: ${site}`,
  ]);
  return { subject, html, text };
}

/* ------------------------------------------------------------------------- */
/* Free week started                                                          */
/* ------------------------------------------------------------------------- */

export type UnlimitedStartedInput = {
  /** When the free week ends and the first charge is made (Stripe's `trial_end`). */
  trialEnd: Date;
  /** Where to manage or cancel (NEXT_PUBLIC_BILLING_PORTAL_URL, else the account page). */
  manageUrl: string;
  /** The site's origin: the plan's terms and the refund policy are linked from it. */
  siteUrl: string;
  /** The plan as sold (UNLIMITED_PLAN in src/lib/billing/unlimited.ts). */
  planName: string;
  monthlyUsd: number;
  /**
   * A second (or later) plan on the account: its trial runs in Stripe, but the free week's help is
   * for a first plan only (has_unlimited() in 20261003040000_go_live_gaps.sql), so the email says
   * the plan starts with the first charge instead of welcoming a free week.
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
 * free week and linked to an account (src/lib/email/unlimitedStarted.ts). Auto-renewal laws ask for
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

  const subject = input.repeat ? `Your ${plan} plan starts on ${day}` : `Your free week of ${plan} has started`;
  const title = input.repeat ? "Your plan is set up" : "Your free week has started";
  const preheader = `Nothing was charged today. Your card will be charged ${price} on ${day} unless you cancel before then.`;
  const started = input.repeat ? `Your ${plan} plan is set up. Nothing was charged today.` : `Your free week of ${plan} has started. Nothing was charged today.`;
  const charge = `On ${day} at ${time}, your card will be charged ${price}, then ${price} every month until you cancel.`;
  const firstPlanOnly = "The free week is for a first plan only, so until then help uses ink.";
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
