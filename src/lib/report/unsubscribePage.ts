/**
 * The small page the unsubscribe link answers with (/api/report/unsubscribe). It is opened from a
 * mail app, often on a phone where nobody is signed in, so it is a whole page of its own: plain
 * HTML, inline styles, no script, nothing loaded from anywhere (the route also sends a
 * Content-Security-Policy that forbids it). Opening the link only asks ("confirm"): its one button
 * posts back to the same link, so a mail scanner that opens every link turns nothing off. Pure: the
 * outcome in, the HTML out.
 */
import { REPORT_PATH } from "./contracts";

export type UnsubscribeOutcome = "confirm" | "done" | "invalid" | "unavailable";

export const UNSUBSCRIBE_COPY = {
  confirm: {
    title: "Stop the weekly email?",
    body: "You'll stop getting the weekly report email for this account. The report stays in Agathon whenever you'd like to see it, and you can turn the email back on there.",
    action: "Stop the weekly email",
    secondary: "Keep getting it",
  },
  done: {
    title: "You're unsubscribed",
    body: "You won't get the weekly report email any more. The report is still in Agathon whenever you'd like to see it, and you can turn the email back on there.",
    action: "See this week's report",
  },
  invalid: {
    title: "This link didn't work",
    body: "It may have been cut short by your mail app. Sign in to Agathon and turn the weekly email off on the report page instead.",
    action: "Open the report",
  },
  unavailable: {
    title: "Something went wrong on our side",
    body: "Your email setting wasn't changed. Try the link again in a minute, or turn the weekly email off on the report page.",
    action: "Open the report",
  },
} as const;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const BUTTON = "display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;line-height:20px;padding:13px 22px;border-radius:10px;border:0;cursor:pointer;font-family:inherit;";

/** For an attribute value: the confirm form's action is the only thing on the page from the request. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
}

/**
 * The whole page for an outcome. "confirm" needs `action`, the path the form posts to (the link's own
 * path and its verified `u` and `t`, src/lib/report/unsubscribe.ts `unsubscribePath`); nothing else in
 * the page comes from the request.
 */
export function unsubscribePage(outcome: UnsubscribeOutcome, action?: string): string {
  const copy = UNSUBSCRIBE_COPY[outcome];
  const asking = outcome === "confirm";
  if (asking && !action) throw new Error("the confirm page needs the link to post to");
  const mark = outcome === "done" ? "&#10003;" : asking ? "?" : "!";
  const markBg = outcome === "done" ? "#dcfce7" : asking ? "#dbeafe" : "#fef3c7";
  const markInk = outcome === "done" ? "#166534" : asking ? "#1e40af" : "#92400e";
  const controls = asking
    ? `<form method="post" action="${escapeAttr(action!)}" style="margin:0;">
<button type="submit" style="${BUTTON}">${copy.action}</button>
<a href="${REPORT_PATH}" style="display:inline-block;margin:0 0 0 12px;color:#2563eb;font-weight:600;font-size:16px;line-height:20px;padding:13px 4px;text-decoration:none;">${UNSUBSCRIBE_COPY.confirm.secondary}</a>
</form>`
    : `<a href="${REPORT_PATH}" style="${BUTTON}">${copy.action}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light">
<title>${copy.title} · Agathon</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:${FONT};color:#111827;">
<main style="max-width:28rem;margin:0 auto;padding:48px 16px;">
<p style="margin:0 0 16px 4px;font-size:20px;font-weight:700;letter-spacing:-0.2px;">Agathon</p>
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:32px 24px;">
<div aria-hidden="true" style="width:44px;height:44px;border-radius:999px;background:${markBg};color:${markInk};font-size:22px;font-weight:700;line-height:44px;text-align:center;margin:0 0 16px;">${mark}</div>
<h1 style="margin:0 0 12px;font-size:22px;line-height:30px;">${copy.title}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:25px;color:#4b5563;">${copy.body}</p>
${controls}
</div>
</main>
</body>
</html>
`;
}
