/**
 * The operator's alert emails (to ALERT_EMAIL, never to a user), as pure functions: input ->
 * `{ subject, html, text }`. The health route decides when one goes out
 * (src/lib/server/health/alerts.ts); this module only words it.
 *
 * Who reads these. Rushil, on a phone, often away from a laptop. So the subject alone says what
 * broke and why ("Mathpix is down: keys rejected (401)"), the first line says since when, the
 * second what students notice, and the last is the one link worth opening (/admin). No layout
 * card, no button, no images: a few short paragraphs any mail app renders the same, light or dark.
 *
 * What may be interpolated: a check's `detail` and an error group's kind and message come from a
 * provider's answer or from app_events, so they are escaped like anything else, cut short, and
 * stripped of line breaks in the subject (a header must be one line). Links go through
 * `siteLink`, so a bad NEXT_PUBLIC_SITE_URL throws before anything is sent.
 */
import type { Service } from "@/lib/admin/contracts";
import { escapeHtml, formatEmailDate, siteLink, type RenderedEmail } from "@/lib/email/templates";

/** How each service is named in an alert, as the owner thinks of it. */
export const SERVICE_LABELS: Record<Service, string> = {
  app: "The site",
  database: "The database",
  openrouter: "OpenRouter",
  mathpix: "Mathpix",
  email: "Email (Resend)",
  stripe: "Stripe webhooks",
};

/** What students (or the owner) notice while a service is down: the line that says how urgent it is. */
export const SERVICE_IMPACT: Record<Service, string> = {
  app: "Students can't open the site.",
  database: "Boards can't load or save, and signing in may fail.",
  openrouter: "Every AI call fails: checking steps, hints, solving and the chat.",
  mathpix: "Handwriting is read by the vision model instead, which is slower and less accurate.",
  email: "Welcome and trial emails don't go out (and these alerts may not either).",
  stripe: "A purchase may not add ink or start Unlimited until Stripe retries the webhook.",
};

/** Where the owner tops up OpenRouter by hand. */
export const OPENROUTER_CREDITS_PAGE = "https://openrouter.ai/settings/credits";

/** One error group in a spike email (the most frequent first). */
export type AlertErrorGroup = { kind: string; code: string | null; message: string; count: number };

/** What an alert email is about. `since` values are ISO times. */
export type AlertEmailInput =
  /** A service failed `downAfterFailures` checks in a row; `repeat` while it stays down. */
  | { type: "down"; service: Service; detail: string; since: string; repeat: boolean }
  /** A service that was reported down passes again. */
  | { type: "up"; service: Service; downSince: string }
  /** Errors students saw crossed the spike thresholds in the window. */
  | { type: "spike"; errors: number; users: number; windowMin: number; groups: AlertErrorGroup[]; since: string; repeat: boolean; capped: boolean }
  /** A reported spike fell back under the thresholds. */
  | { type: "spike_over"; since: string }
  /** OpenRouter credit fell under the threshold (once until it is topped up again). */
  | { type: "low_credits"; creditsLeftUsd: number; thresholdUsd: number };

export type AlertContext = {
  /** The site's origin, for the /admin link. */
  siteUrl: string;
  /** When the email is written (durations are measured to it). */
  now: Date;
  /** How often a lasting alert repeats, for the footer line. */
  repeatAfterMin: number;
};

/** The longest a subject gets: phones show about 40-60 characters, the rest is for the inbox list. */
const MAX_SUBJECT = 120;
/** How much of a provider's detail or an error message an email quotes. */
const MAX_QUOTE = 200;

/** One line, trimmed and cut to `max` characters (with an ellipsis). */
export function oneLine(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** "under a minute", "12 min", "1 h 5 min", "3 h", "2 d 4 h". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

/** "$4.20". */
export function formatCredits(usd: number): string {
  return `$${(Number.isFinite(usd) ? usd : 0).toFixed(2)}`;
}

function since(iso: string, now: Date): { time: string; elapsed: string } {
  const at = new Date(iso);
  const valid = !Number.isNaN(at.getTime());
  return { time: valid ? formatEmailDate(at).time : "an unknown time", elapsed: formatDuration(valid ? now.getTime() - at.getTime() : 0) };
}

/** The HTML: plain paragraphs (and one list), escaped, at a size a phone reads without zooming. */
function html(subject: string, blocks: Array<string | string[]>, link: { label: string; href: string }): string {
  const p = (body: string) => `<p style="margin:0 0 14px;font-size:16px;line-height:24px;">${body}</p>`;
  const parts = blocks.map((b) =>
    Array.isArray(b)
      ? `<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:22px;">${b.map((li) => `<li style="margin:0 0 6px;">${escapeHtml(li)}</li>`).join("")}</ul>`
      : p(escapeHtml(b)),
  );
  parts.push(p(`<a href="${escapeHtml(link.href)}" style="color:#2563eb;">${escapeHtml(link.label)}</a>`));
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:16px;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;color:#111827;">
${parts.join("\n")}
</body>
</html>
`;
}

function text(blocks: Array<string | string[]>, link: { label: string; href: string }): string {
  const parts = blocks.map((b) => (Array.isArray(b) ? b.map((li) => `- ${li}`).join("\n") : b));
  parts.push(`${link.label}: ${link.href}`);
  return `${parts.join("\n\n")}\n`;
}

function render(subject: string, blocks: Array<string | string[]>, link: { label: string; href: string }): RenderedEmail {
  const s = oneLine(subject, MAX_SUBJECT);
  return { subject: s, html: html(s, blocks, link), text: text(blocks, link) };
}

/** The alert email for `input`. Throws only for an unusable site URL (nothing is sent then). */
export function alertEmail(input: AlertEmailInput, ctx: AlertContext): RenderedEmail {
  const admin = { label: "Open /admin", href: siteLink(ctx.siteUrl, "/admin") };
  const every = `${ctx.repeatAfterMin} minutes`;

  switch (input.type) {
    case "down": {
      const name = SERVICE_LABELS[input.service];
      const detail = oneLine(input.detail || "no detail", MAX_QUOTE);
      const s = since(input.since, ctx.now);
      const subject = input.repeat ? `${name} is still down (${s.elapsed}): ${detail}` : `${name} is down: ${detail}`;
      return render(
        subject,
        [
          `${name} has failed every health check since ${s.time} (${s.elapsed}).`,
          `Why: ${detail}`,
          SERVICE_IMPACT[input.service],
          `You'll get a reminder every ${every} while it stays down, and one email when it is back up.`,
        ],
        admin,
      );
    }
    case "up": {
      const name = SERVICE_LABELS[input.service];
      const s = since(input.downSince, ctx.now);
      return render(`${name} is back up (down ${s.elapsed})`, [`${name} passed its health check again at ${formatEmailDate(ctx.now).time}, after ${s.elapsed} down (since ${s.time}).`], admin);
    }
    case "spike": {
      const count = `${input.errors}${input.capped ? "+" : ""}`;
      const people = `${input.users} ${input.users === 1 ? "person" : "people"}`;
      const s = since(input.since, ctx.now);
      const subject = input.repeat
        ? `Errors still spiking (${s.elapsed}): ${count} in ${input.windowMin} min from ${people}`
        : `Errors spiking: ${count} in ${input.windowMin} min from ${people}`;
      const top = input.groups.slice(0, 3).map((g) => `${g.count}× ${g.kind}${g.code ? ` (${g.code})` : ""}: ${oneLine(g.message || "no message", MAX_QUOTE)}`);
      return render(
        subject,
        [
          `${count} errors in the last ${input.windowMin} minutes, seen by ${people}.`,
          ...(top.length ? ["Most frequent:", top] : []),
          `You'll get a reminder every ${every} while it lasts, and one email when it is over.`,
        ],
        admin,
      );
    }
    case "spike_over": {
      const s = since(input.since, ctx.now);
      return render(`Errors are back to normal (spike lasted ${s.elapsed})`, [`Errors students see are under the alert threshold again, ${s.elapsed} after the spike started at ${s.time}.`], admin);
    }
    case "low_credits": {
      const left = formatCredits(input.creditsLeftUsd);
      return render(
        `OpenRouter credit is low: ${left} left`,
        [
          `OpenRouter has ${left} of credit left (the alert is at ${formatCredits(input.thresholdUsd)}).`,
          `Every AI call stops when it reaches $0. Top up: ${OPENROUTER_CREDITS_PAGE}`,
          "You'll get this once; it re-arms after a top-up.",
        ],
        admin,
      );
    }
  }
}
