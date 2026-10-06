import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {}, rpc: vi.fn() } }));

import { AdminContent } from "../AdminScreen";
import type { CheckState } from "../useAdminOverview";
import { buildAdminView } from "@/lib/admin/view";
import { BOARD_ID, CLOCK, NOW, overviewFixture } from "@/lib/admin/__tests__/fixtures";

/** the markup with its entities read back, and ICU's narrow spaces as spaces */
const render = (el: React.ReactElement) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const IDLE: CheckState = { running: false, error: null, results: null, at: null };
const props = { loading: false, error: null, check: IDLE, onRefresh: vi.fn(), onCheckNow: vi.fn(), now: NOW };

describe("the admin page body", () => {
  const html = render(<AdminContent {...props} view={buildAdminView(overviewFixture(), CLOCK)} />);

  it("shows the money: six tiles, the charges coming, and the funnel under the users", () => {
    expect(html).toContain("Monthly revenue");
    expect(html).toContain("$200");
    expect(html).toContain("In free trial");
    expect(html).toContain("Charges in the next 14 days");
    expect(html).toContain("Tomorrow");
    expect(html).toContain("412 accounts → 301 finished the welcome → 23 started a trial → 9 paying");
  });

  it("has its sections in order, each a labelled region", () => {
    const headings = [...html.matchAll(/<h2 id="([^"]+)"[^>]*>([^<]+)<\/h2>/g)].map((m) => [m[1], m[2]]);
    expect(headings).toEqual([
      ["status-title", "Status"],
      ["money-title", "Money"],
      ["errors-title", "Errors students saw"],
      ["ai-title", "AI"],
      ["users-title", "Users and learning"],
      ["bugs-title", "Bug reports"],
    ]);
    for (const [id] of headings) expect(html).toContain(`aria-labelledby="${id}"`);
    expect(html).toMatch(/<h1[^>]*>Admin<\/h1>/);
  });

  it("status: the big line, then each service's state in colour, icon and words", () => {
    expect(html).toMatch(/<div[^>]*data-tone="down"[^>]*role="status"[^>]*>[\s\S]*?Mathpix handwriting is down since 3:42 PM/);
    // each card runs from its <li data-state> to the next one (cards nest lists of their own)
    const starts = [...html.matchAll(/<li[^>]*data-state="(\w+)"[^>]*>/g)];
    const cards = starts.map((m, i) => [m[1], text(html.slice(m.index, starts[i + 1]?.index ?? html.indexOf("errors-title")))]);
    expect(cards.map(([s]) => s)).toEqual(["up", "up", "up", "down", "up", "unknown"]);
    // every state pill carries an icon (svg) beside its word
    for (const word of ["Up", "Down", "Not checked yet"]) expect(html).toMatch(new RegExp(`<svg[^>]*>[\\s\\S]*?</svg></span>${word}</span>`));
    const mathpix = cards[3][1];
    expect(mathpix).toContain("Mathpix handwriting");
    expect(mathpix).toContain("Down since 3:42 PM");
    expect(mathpix).toContain("6.0 s");
    expect(mathpix).toContain("94% up in 24 h");
    expect(mathpix).toContain("Checked 3 min ago");
    expect(mathpix).toContain("timeout after 6 s");
    expect(cards[2][1]).toContain("$12.40 credit left");
    expect(text(html)).toContain("Check now");
  });

  it("errors: totals, the chart with a legend and its sentence, the groups with their samples", () => {
    const t = text(html);
    expect(t).toContain("23 errors · 7 students");
    expect(t).toContain("Errors and warnings per hour, last 48 hours");
    expect(html).toMatch(/aria-label="Legend"[\s\S]*?Errors[\s\S]*?Warnings/);
    expect(t).toContain("17 errors and 7 warnings in 48 hours. The worst hour: 9 errors, today at 4 PM.");
    expect(t).toContain("Show the numbers");
    // 48 columns
    expect(html.match(/data-now|<div aria-hidden="true" class="[^"]*slot/g)?.length).toBeGreaterThanOrEqual(48);
    expect(t).toContain("Solve failed");
    expect(t).toContain("12 times");
    expect(t).toContain("5 students");
    expect(t).toContain("Last 4 min ago");
    expect(t).toContain("Couldn't read handwriting");
    expect(t).toContain("Ask (board chat): used the backup model");
    // the samples sit behind a toggle that says how many
    expect(html).toMatch(/<summary>See the latest 2<\/summary>/);
    expect(html).toMatch(/<summary>See the latest one<\/summary>/);
    // the board's id, not a link: a board is readable by its own student only (RLS), an admin included
    expect(html).toContain(`title="${BOARD_ID}"`);
    expect(html).not.toContain(`href="/board/${BOARD_ID}"`);
    expect(t).toContain("maya@example.com");
    expect(t).toContain("signed out");
    expect(t).toContain("req_7f3a9c");
  });

  it("AI: a row per busy route, the bad rate flagged in words for a screen reader", () => {
    expect(html).toMatch(/<th scope="col">Route<\/th><th scope="col">Calls<\/th><th scope="col">Failed<\/th><th scope="col">Failure %<\/th><th scope="col">Fallbacks<\/th>/);
    expect(html).toMatch(/<tr data-tone="bad">[\s\S]*?Solve[\s\S]*?22\.6%[\s\S]*?\(High\)/);
    expect(text(html)).toContain("No calls in 24 hours: Word-problem setup and Lecture drawings.");
  });

  it("users and learning tiles, and the bug reports", () => {
    const t = text(html);
    expect(t).toContain("412 Accounts");
    expect(t).toContain("166 solved alone (61.9%)");
    expect(t).toContain("Solve keeps spinning on my quadratic");
    expect(t).toContain("(no message)");
    expect(t).toContain("no email");
  });

  it("dims, rather than replaces, the page while refreshing", () => {
    const refreshing = render(<AdminContent {...props} loading view={buildAdminView(overviewFixture(), CLOCK)} />);
    expect(refreshing).toMatch(/data-refreshing="true"/);
    expect(text(refreshing)).toContain("Refreshing…");
    expect(text(refreshing)).toContain("Mathpix handwriting is down");
  });
});

describe("loading and failing", () => {
  it("skeletons on the first read, no sections", () => {
    const html = render(<AdminContent {...props} loading view={null} />);
    expect(html).not.toContain("<h2");
    expect(html).toMatch(/aria-hidden="true"/);
  });

  it("a failed first read says what failed, with Try again and Check now", () => {
    const html = render(<AdminContent {...props} error="Couldn't read app_events: status 500" view={null} />);
    expect(html).toMatch(/role="alert"/);
    const t = text(html);
    expect(t).toContain("Couldn't load the overview");
    expect(t).toContain("Couldn't read app_events: status 500");
    expect(t).toContain("Try again");
    expect(t).toContain("Check now");
  });

  it("…and shows what Check now found while the overview cannot load", () => {
    const check: CheckState = {
      running: false,
      error: null,
      at: NOW,
      results: [
        { service: "database", ok: false, latencyMs: 3000, detail: "status 503", at: new Date(NOW).toISOString() },
        { service: "app", ok: true, latencyMs: 120, at: new Date(NOW).toISOString() },
      ],
    };
    const t = text(render(<AdminContent {...props} check={check} error="Couldn't read profiles: status 503" view={null} />));
    expect(t).toContain("Live check (just now)");
    expect(t).toContain("Database is down since");
    expect(t).toContain("status 503");
    expect(t).toContain("Checked just now.");
  });

  it("a failed check says so", () => {
    const t = text(render(<AdminContent {...props} check={{ ...IDLE, error: "the server answered 503" }} view={buildAdminView(overviewFixture(), CLOCK)} />));
    expect(t).toContain("The check didn't run: the server answered 503");
  });
});

describe("what the page loads", () => {
  const ROOT = join(__dirname, "..", "..", "..", "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const full = join(dir, f);
      if (statSync(full).isDirectory()) return f === "__tests__" ? [] : files(full);
      return /\.(ts|tsx)$/.test(f) ? [full] : [];
    });

  it("nothing on the admin page imports tldraw or the board", () => {
    const sources = [...files(join(ROOT, "src/components/admin")), ...files(join(ROOT, "src/app/(platform)/admin")), join(ROOT, "src/lib/admin/view.ts"), join(ROOT, "src/lib/admin/contracts.ts")];
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const imports = [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, file).not.toMatch(/tldraw|\/board|@\/lib\/live|@\/shapes|@\/hooks\/use(Snapshot|AiOverlay)/);
      }
    }
  });

  it("the header asks is_admin() through the small hint module only", () => {
    const header = readFileSync(join(ROOT, "src/components/app/AppHeader.tsx"), "utf8");
    const adminImports = [...header.matchAll(/from\s+["'](@\/components\/admin\/[^"']+)["']/g)].map((m) => m[1]);
    expect(adminImports).toEqual(["@/components/admin/useIsAdmin"]);
  });
});
