/**
 * The reporter's side, as markup: /reports (ReportsContent: loading, failed, none yet, the reports
 * with their status in plain words, the conversation and a reply box, the report the address points
 * at, and one this profile does not have), and the app header's Report a bug (its dot only when there
 * are unread replies, never signed out; the dialog's link to /reports).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = vi.hoisted(() => ({ email: "" as string, unread: 0, unreadAskedFor: [] as Array<string | null | undefined> }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {}, rpc: vi.fn() } }));
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: fixture.email ? { id: "u1", email: fixture.email, user_metadata: {} } : null, loading: false, authError: null }),
  AuthErrorBanner: () => null,
}));
vi.mock("@/lib/billing/useUnlimited", () => ({ useUnlimited: () => ({ state: null, loading: false, known: true, refresh: () => undefined }) }));
vi.mock("@/lib/billing/useInkSummary", () => ({ useInkSummary: () => ({ summary: null, loading: false, error: null, reload: () => undefined }) }));
vi.mock("@/components/admin/useIsAdmin", () => ({ useIsAdmin: () => false }));
vi.mock("@/components/FeatureLabsPanel", () => ({ FeatureLabsPanel: () => null }));
vi.mock("@/lib/bugReports/unread", () => ({
  useBugUnread: (userId: string | null | undefined) => {
    fixture.unreadAskedFor.push(userId);
    return userId ? fixture.unread : 0;
  },
  setBugUnread: () => undefined,
}));

const { ReportsContent } = await import("../ReportsScreen");
const { AppHeader } = await import("@/components/app/AppHeader");
const { BugReportButton, reportsLinkLabel } = await import("@/components/BugReportButton");
import type { MyBugReport } from "@/lib/bugReports/contracts";

const signedInHeader = () => {
  fixture.email = "maya@example.com";
  return renderToStaticMarkup(<AppHeader />);
};

/** Friday 2026-10-09, 3:00 PM in New York. */
const NOW = Date.parse("2026-10-09T19:00:00Z");
const CLOCK = { now: NOW, timeZone: "America/New_York" };
const HOUR = 3_600_000;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const R1 = "0f8fad5b-d9cb-469f-a165-70867728950e";
const R2 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const reports: MyBugReport[] = [
  {
    id: R1,
    created_at: at(26 * HOUR),
    message: "The pen draws in the wrong place <b>when I zoom</b>",
    status: "seen",
    resolved_at: null,
    seen_at: null,
    unread: 1,
    thread: [{ id: "a1", author: "admin", body: "Thanks! Which device is it?", at: at(2 * HOUR) }],
  },
  { id: R2, created_at: at(80 * HOUR), message: "", status: "fixed", resolved_at: at(10 * HOUR), seen_at: at(HOUR), unread: 0, thread: [] },
];
const base = { reports, loading: false, error: null, onRetry: () => undefined, target: null, clock: CLOCK, onReply: async () => ({ ok: true as const }) };

beforeEach(() => {
  fixture.email = "";
  fixture.unread = 0;
  fixture.unreadAskedFor.length = 0;
});

describe("/reports", () => {
  it("each report: its status in plain words, when, what they sent (escaped), the conversation, and a box to write back", () => {
    const html = render(<ReportsContent {...base} />);
    const t = text(html);
    expect(html).toMatch(new RegExp(`<article id="${R1}"[^>]*tabindex="-1"`, "i"));
    expect(t).toContain("Looking into it");
    expect(t).toContain("Sent yesterday at 1:00 PM");
    expect(t).toContain("1 new reply");
    expect(html).toContain("The pen draws in the wrong place &lt;b&gt;when I zoom&lt;/b&gt;");
    expect(html).toMatch(/data-author="admin" data-new="true"/);
    expect(t).toContain("Agathon today at 1:00 PM · New");
    expect(t).toContain("Thanks! Which device is it?");
    expect(html).toMatch(new RegExp(`<label for="report-${R1}-reply"[^>]*>Write back</label>`));
    expect(html).toMatch(new RegExp(`<textarea id="report-${R1}-reply"[^>]*maxLength="4000"`, "i"));
    // the second: Fixed, sent without words, no reply yet
    expect(t).toContain("Fixed Sent Oct 6 at 7:00 AM");
    expect(t).toContain("We fixed this. Thanks for telling us.");
    expect(t).toContain("You sent this one without a message.");
    expect(t).toContain("No reply yet. We read every report.");
  });

  it("the report the address points at is ringed; one this profile does not have says to switch profile", () => {
    const ringed = render(<ReportsContent {...base} target={{ id: R1, found: true }} />);
    expect(ringed).toMatch(new RegExp(`<article id="${R1}"[^>]*data-target="true"`));
    expect(ringed).not.toContain("report-not-here");
    const elsewhere = render(<ReportsContent {...base} target={{ id: "11111111-2222-4333-8444-555555555555", found: false }} />);
    expect(elsewhere).toContain('data-testid="report-not-here"');
    expect(text(elsewhere)).toContain("That report isn't on this profile");
    expect(text(elsewhere)).toContain("Switch profile");
    expect(elsewhere).not.toMatch(/data-target="true"/);
  });

  it("none yet; loading; a failed read with Try again", () => {
    const empty = text(render(<ReportsContent {...base} reports={[]} />));
    expect(empty).toContain("No bug reports yet");
    expect(empty).toContain("tap Report a bug at the top of the page");
    expect(render(<ReportsContent {...base} reports={null} loading />)).toContain("Loading your reports");
    const failed = text(render(<ReportsContent {...base} reports={null} error="Failed to fetch" />));
    expect(failed).toContain("Couldn't load your reports");
    expect(failed).toContain("Failed to fetch");
    expect(failed).toContain("Try again");
  });
});

describe("the app header's Report a bug", () => {
  it("signed out: no Report a bug, no dot, and the count is never asked for a user", () => {
    fixture.unread = 3;
    const html = render(<AppHeader />);
    expect(html).not.toContain('title="Report a bug"');
    expect(html).not.toContain("bug-unread-dot");
    expect(fixture.unreadAskedFor.every((id) => !id)).toBe(true);
  });

  it("signed in with unread replies: the dot, said in words too; none without", () => {
    fixture.email = "maya@example.com";
    fixture.unread = 2;
    const html = render(<AppHeader />);
    expect(fixture.unreadAskedFor).toContain("u1");
    expect(html).toContain('data-testid="bug-unread-dot"');
    expect(text(html)).toContain(", 2 new replies to your reports");
    fixture.unread = 0;
    expect(render(<AppHeader />)).not.toContain("bug-unread-dot");
  });

  it("the board's trigger never has a dot", () => {
    expect(render(<BugReportButton unread={2} />)).not.toContain("bug-unread-dot");
  });

  it("the dialog's link to /reports says how many replies are new (the dialog itself is a portal: checked in a browser)", () => {
    expect(reportsLinkLabel(0)).toBe("Your reports");
    expect(reportsLinkLabel(1)).toBe("Your reports (1 new reply)");
    expect(reportsLinkLabel(3)).toBe("Your reports (3 new replies)");
    expect(signedInHeader()).toContain('title="Report a bug"');
  });
});
