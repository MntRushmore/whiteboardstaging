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
    // 2026-10-08 (the console): Live now joins, after Status and Money
    expect(headings).toEqual([
      ["status-title", "Status"],
      ["money-title", "Money"],
      ["live-title", "Live now"],
      ["errors-title", "Errors students saw"],
      ["ai-title", "AI"],
      ["users-title", "Users and learning"],
      ["bugs-title", "Bug reports"],
    ]);
    for (const [id] of headings) expect(html).toContain(`aria-labelledby="${id}"`);
    // the console's nav names the console; the page is its Overview
    expect(html).toMatch(/<h1[^>]*>Overview<\/h1>/);
    expect(html).toContain('href="/"');
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

  // The board viewer (/admin/boards/[id]) is the one admin route that draws a board: its page loads
  // the replay (tldraw) in a chunk of its own, so it is left out here and checked on its own below.
  const VIEWER_ROUTE = join(ROOT, "src/app/(platform)/admin/boards/[id]");

  /**
   * Every console file (the overview and, from 2026-10-08, Users, a user, Boards, Bugs, Issues, their
   * view modules and the dev fixtures). The board viewer at /admin/boards/[id] is the one page that
   * loads tldraw (its own bundle), so its folder is left out here; the console only links to it.
   */
  const consoleSources = () =>
    [...files(join(ROOT, "src/components/admin")), ...files(join(ROOT, "src/app/(platform)/admin")), ...files(join(ROOT, "src/lib/admin"))].filter(
      (f) => !f.includes(join("admin", "boards", "[id]")) && !f.includes(join("components", "replay")),
    );

  it("nothing on the admin pages imports tldraw or the board", () => {
    const sources = consoleSources();
    expect(sources.length).toBeGreaterThan(25);
    for (const name of ["UsersScreen.tsx", "UserScreen.tsx", "BoardsScreen.tsx", "BugsScreen.tsx", "IssuesScreen.tsx", "consoleView.ts", "usersView.ts", "userView.ts", "boardsView.ts", "bugsView.ts", "issuesView.ts", "consoleFixtures.ts"]) {
      expect(sources.some((f) => f.endsWith(name)), name).toBe(true);
    }
    for (const file of sources) {
      const imports = [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
      for (const spec of imports) {
        // the board's code (a /board folder, the board page), the live loop, shapes, the replay; the
        // one pure board module allowed is the title helper (LaTeX → readable text, no imports)
        expect(spec, file).not.toMatch(/tldraw|katex|(^|\/)board(\/|$)|@\/app\/board|@\/components\/board|@\/lib\/boards\/(?!boardTitle$)|@\/lib\/live|@\/lib\/replay|@\/components\/replay|@\/shapes|@\/hooks\/use(Snapshot|AiOverlay)/);
      }
    }
  });

  it("…nor anything they import, all the way down (type-only imports aside)", () => {
    const resolveSpec = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? join(from, "..", spec) : null;
      if (!base) return null;
      for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const p = base + ext;
        try {
          if (statSync(p).isFile()) return p;
        } catch {
          // next
        }
      }
      return null;
    };
    const seen = new Set<string>();
    const packages = new Map<string, string>();
    const queue = consoleSources();
    while (queue.length) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      // static imports and re-exports that are not type-only (erased); dynamic imports are their own chunks
      for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)) {
        const spec = m[1] ?? m[2];
        const next = resolveSpec(file, spec);
        if (next) queue.push(next);
        else if (!spec.startsWith(".") && !spec.startsWith("@/") && !packages.has(spec)) packages.set(spec, file);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
    for (const [pkg, from] of packages) expect(pkg, from).not.toMatch(/tldraw|katex|pdfjs|mathjs/);
  });

  it("only the board viewer's route reaches the replay, and it fetches it as a chunk of its own", () => {
    const others = [...files(join(ROOT, "src/components/admin")), ...files(join(ROOT, "src/app/(platform)/admin")).filter((f) => !f.startsWith(VIEWER_ROUTE))];
    for (const file of others) expect(readFileSync(file, "utf8"), file).not.toMatch(/components\/(replay|adminBoard)/);
    const screen = readFileSync(join(ROOT, "src/components/adminBoard/AdminBoardScreen.tsx"), "utf8");
    const staticImports = [...screen.matchAll(/^import[^;]*from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    for (const spec of staticImports) expect(spec).not.toMatch(/tldraw|@\/components\/replay|AdminBoardBody/);
    expect(screen).toMatch(/dynamic\(\(\) => import\("\.\/AdminBoardBody"\)/);
  });

  it("the header asks is_admin() through the small hint module only", () => {
    const header = readFileSync(join(ROOT, "src/components/app/AppHeader.tsx"), "utf8");
    const adminImports = [...header.matchAll(/from\s+["'](@\/components\/admin\/[^"']+)["']/g)].map((m) => m[1]);
    expect(adminImports).toEqual(["@/components/admin/useIsAdmin"]);
  });
});
