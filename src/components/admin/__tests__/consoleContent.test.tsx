import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {}, rpc: vi.fn() } }));

import { ConsoleNav } from "../AdminFrame";
import { AdminContent } from "../AdminScreen";
import { BoardsContent } from "../BoardsScreen";
import { BugsContent } from "../BugsScreen";
import { IssuesContent } from "../IssuesScreen";
import { UserContent } from "../UserScreen";
import { UsersContent } from "../UsersScreen";
import type { CheckState } from "../useAdminOverview";
import { boardTileView, liveNowView } from "@/lib/admin/boardsView";
import { newBugsPreview } from "@/lib/admin/bugsView";
import { consoleNav } from "@/lib/admin/consoleView";
import { FIXTURE_USER_IDS, buildWorld, userDetailAt } from "@/lib/admin/fixtures/consoleFixtures";
import { topIssues } from "@/lib/admin/issuesView";
import { buildUserPageView } from "@/lib/admin/userView";
import { DEFAULT_USER_QUERY, buildUsersView } from "@/lib/admin/usersView";
import { buildAdminView } from "@/lib/admin/view";

/** Thursday 2026-10-08, 3:00 PM in New York. */
const NOW = Date.parse("2026-10-08T19:00:00Z");
const CLOCK = { now: NOW, timeZone: "America/New_York" };
const world = buildWorld(NOW);

/** the markup with its entities read back, and ICU's narrow spaces as spaces */
const render = (el: React.ReactElement) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const h2s = (html: string) => [...html.matchAll(/<h2 id="([^"]+)"[^>]*>([^<]+)<\/h2>/g)].map((m) => m[2]);
const noop = () => {};

describe("the console's nav", () => {
  const html = render(<ConsoleNav items={consoleNav("issues", { newBugs: 4, openIssues: 6, regressed: 1 })} />);

  it("is a labelled nav of six links, the current one marked", () => {
    expect(html).toMatch(/<nav aria-label="Admin sections"/);
    expect([...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/admin", "/admin/users", "/admin/funnel", "/admin/boards", "/admin/bugs", "/admin/issues"]);
    const current = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]).filter((a) => a.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/admin/issues"');
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it("shows the counts, with words for a screen reader, the regressed one urgent", () => {
    const t = text(html);
    expect(t).toContain("Bugs 4 , 4 new bug reports");
    expect(t).toContain("Issues 6 , 6 open issues");
    expect(html).toMatch(/data-urgent="true"[^>]*><span aria-hidden="true">6<\/span>/);
  });
});

describe("Users", () => {
  const view = buildUsersView(world.users, DEFAULT_USER_QUERY, CLOCK);
  const props = { query: DEFAULT_USER_QUERY, onQuery: noop, loading: false, error: null, updated: "Updated just now", onRefresh: noop };

  it("a table: search, chips, sort, a row per account linking to its page, numbers right-aligned", () => {
    const html = render(<UsersContent {...props} view={view} layout="table" />);
    const t = text(html);
    expect(html).toMatch(/<h1[^>]*>Users<\/h1>/);
    expect(html).toContain('aria-keyshortcuts="/"');
    expect(t).toContain("Search users");
    expect(html).toMatch(/role="group" aria-label="Plan"/);
    expect(html).toMatch(/role="group" aria-label="Show only"/);
    expect(html).toMatch(/role="group" aria-label="Sort by"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*><span>Last active<\/span>/);
    expect(t).toContain("24 accounts");
    expect(html.match(/<tr /g)).toHaveLength(24);
    expect(html).toContain(`href="/admin/users/${FIXTURE_USER_IDS[0]}"`);
    expect([...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1])).toEqual(["Account", "Plan", "Signed up", "Last active", "Boards", "Problems", "AI calls", "Errors", "Bugs"]);
    // the admin is marked; a plan in words; the trial's end
    expect(t).toMatch(/Rushil Chopra Admin/);
    expect(t).toContain("Payment failing");
    expect(t).toContain("Trial ends Sat, Oct 10");
  });

  it("cards on a phone, each a link, the facts in words", () => {
    const html = render(<UsersContent {...props} view={view} layout="list" />);
    expect(html).not.toContain("<table");
    expect(html.match(/<li><a /g)).toHaveLength(24);
    expect(text(html)).toContain("Active 2 min ago 7 boards 18 problems (61% alone) 142 AI calls 4 errors 2 bug reports");
  });

  it("filtered to nobody: says so, with a way back", () => {
    const html = render(<UsersContent {...props} query={{ ...DEFAULT_USER_QUERY, search: "zzz" }} view={buildUsersView(world.users, { ...DEFAULT_USER_QUERY, search: "zzz" }, CLOCK)} layout="table" />);
    expect(text(html)).toContain("Nobody matches");
    expect(text(html)).toContain("Clear search and filters");
    expect(text(html)).toContain("0 of 24 accounts");
  });

  it("loading, failing, empty", () => {
    expect(render(<UsersContent {...props} view={null} loading layout="table" />)).not.toContain("<table");
    const failed = render(<UsersContent {...props} view={null} error="the server answered 500" layout="table" />);
    expect(failed).toMatch(/role="alert"/);
    expect(text(failed)).toContain("Couldn't load the users");
    expect(text(failed)).toContain("Try again");
    expect(text(render(<UsersContent {...props} view={buildUsersView([], DEFAULT_USER_QUERY, CLOCK)} layout="table" />))).toContain("No accounts yet");
  });
});

describe("a user", () => {
  const detail = userDetailAt(world, FIXTURE_USER_IDS[0], NOW)!;
  const html = render(<UserContent view={buildUserPageView(detail, CLOCK)} loading={false} error={null} updated="Updated just now" onRefresh={noop} />);
  const t = text(html);

  it("names them, the way back, and the sections in order", () => {
    expect(html).toMatch(/<h1[^>]*>Maya Chen<\/h1>/);
    expect(html).toContain('href="/admin/users"');
    expect(h2s(html)).toEqual(["Last 30 days", "Boards (6)", "Learning", "What went wrong", "Subscription", "Bug reports (2)", "Emails"]);
    expect(t).toContain("maya.chen@example.com");
    expect(t).toContain("Trial ends Sat, Oct 10");
  });

  it("their boards open the viewer; their problems are text, not KaTeX", () => {
    for (const b of detail.boards) expect(html).toContain(`href="/admin/boards/${b.id}"`);
    expect(html).not.toContain("katex");
    expect(html).toMatch(/<code[^>]*title="x\^\{2\}-5 x\+6=0"[^>]*>x² − 5x \+ 6 = 0<\/code>/);
    expect(t).toContain("Alone, first try");
  });

  it("the chart says its numbers; noise sits behind its toggle; bug reports open in the inbox", () => {
    expect(html).toMatch(/role="img" aria-label="Active \d+ of the last 30 days/);
    expect(html).toMatch(/<summary>Show browser noise \(1\)<\/summary>/);
    expect(html).toContain('href="/admin/bugs?id=bug_001&tab=new"');
    expect(t).toContain("trialing (in the free trial)");
  });

  it("loading and failing", () => {
    expect(render(<UserContent view={null} loading error={null} updated={null} onRefresh={noop} />)).toContain('aria-hidden="true"');
    expect(text(render(<UserContent view={null} loading={false} error="status 500" updated={null} onRefresh={noop} />))).toContain("Couldn't load this account");
  });
});

describe("Boards", () => {
  const live = liveNowView(world.boards.filter((b) => NOW - Date.parse(b.updatedAt) <= 5 * 60_000), CLOCK);
  const tiles = world.boards.slice(0, 24).map((b) => boardTileView(b, CLOCK));
  const props = { live, liveError: null, tiles, loading: false, error: null, updated: "Updated just now", onRefresh: noop, more: { has: true, loading: false, error: null, onMore: noop } };

  it("Live now first, then every board, each opening the viewer; Load more", () => {
    const html = render(<BoardsContent {...props} />);
    expect(h2s(html)).toEqual(["Live now", "All boards"]);
    expect(text(html)).toContain("4 students on a board right now");
    expect(html).toMatch(/<ul class="[^"]*boardStrip[^"]*" aria-label="Live now"/);
    for (const tile of tiles.slice(0, 5)) expect(html).toContain(`href="/admin/boards/${tile.id}"`);
    expect(text(html)).toContain("Load more");
    // never tldraw: a picture is an <img> of the stored preview
    expect(html).toMatch(/<img src="data:image\/svg\+xml/);
  });

  it("the end, and nothing yet", () => {
    expect(text(render(<BoardsContent {...props} more={{ ...props.more, has: false }} />))).toContain("That's all 24 boards.");
    const empty = render(<BoardsContent {...props} tiles={[]} live={liveNowView([], CLOCK)} />);
    expect(text(empty)).toContain("No boards yet");
    expect(text(empty)).toContain("Nobody on a board right now");
  });
});

describe("Bugs", () => {
  const props = { bugs: world.bugs, clock: CLOCK, tab: "new" as const, onTab: noop, onSelect: noop, onStatus: noop, onNote: noop, loading: false, error: null, updated: "Updated just now", onRefresh: noop };

  it("side by side: the tabs with counts, the list, and the open report in full", () => {
    const html = render(<BugsContent {...props} selectedId="bug_001" layout="split" />);
    const t = text(html);
    expect(html).toMatch(/role="group" aria-label="Show"/);
    expect(t).toContain("New 4 Seen 3 Fixed 3 Won't fix 2");
    expect(html).toMatch(/<ul class="[^"]*" aria-label="New bug reports"/);
    expect(html).toMatch(/id="bug-row-bug_001"[^>]*aria-current="true"/);
    // the report: its words, the actions (not "seen" yet), who, device, board, screenshot, logs, note
    expect(html).toMatch(/<h2 id="bug-bug_001-title"[^>]*>Solve keeps spinning/);
    expect(t).toContain("Mark seen Fixed Won't fix");
    expect(html).toContain('aria-keyshortcuts="f"');
    expect(html).toMatch(/href="\/admin\/users\/[^"]+"[^>]*>maya.chen@example.com/);
    expect(t).toContain("Safari on iPad · 1024 × 768");
    expect(html).toMatch(/href="\/admin\/boards\/[^"]+"/);
    expect(html).toMatch(/aria-label="Loading the screenshot…"/);
    expect(t).toContain("Logs (5)");
    expect(html).toMatch(/<li data-level="error">/);
    expect(t).toContain("j / k to move · s seen · f fixed · w won't fix");
  });

  it("on a phone: the list alone, or the report alone with a way back", () => {
    const list = render(<BugsContent {...props} selectedId={null} layout="stack" />);
    expect(list).toContain('id="bug-row-bug_004"');
    expect(list).not.toContain("bug-bug_001-title");
    const one = render(<BugsContent {...props} selectedId="bug_003" layout="stack" />);
    expect(one).not.toContain('id="bug-row-bug_001"');
    expect(text(one)).toContain("All reports");
    expect(text(one)).toContain("No screenshot with this one.");
  });

  it("an empty tab, no reports at all, a failed read", () => {
    expect(text(render(<BugsContent {...props} bugs={world.bugs.filter((b) => b.status !== "new")} selectedId={null} layout="split" />))).toContain("Inbox zero");
    expect(text(render(<BugsContent {...props} bugs={[]} selectedId={null} layout="split" />))).toContain("No bug reports yet");
    expect(text(render(<BugsContent {...props} bugs={null} error="status 503" selectedId={null} layout="split" />))).toContain("Couldn't load the bug reports");
  });
});

describe("Issues", () => {
  const props = { issues: world.issues, clock: CLOCK, days: 7 as const, onDays: noop, tab: "open" as const, onTab: noop, showNoise: false, onShowNoise: noop, onAction: noop, loading: false, error: null, updated: "Updated just now", onRefresh: noop };

  it("the tabs and the window; Regressed floats to the top; each issue's actions and samples", () => {
    const html = render(<IssuesContent {...props} />);
    const t = text(html);
    expect(t).toContain("Open 6 Muted 1 Fixed 1");
    expect(t).toContain("24 hours 7 days 30 days");
    const titles = [...html.matchAll(/<h3 class="[^"]*issueTitle[^"]*">([^<]+)<\/h3>/g)].map((m) => m[1]);
    expect(titles[0]).toBe("Board didn't save");
    expect(titles).toHaveLength(6);
    expect(html).toMatch(/data-regressed="true"/);
    expect(t).toContain("Regressed");
    expect(t).toContain("Mark fixed Mute Reopen");
    expect(html).toMatch(/<summary>See the latest 3<\/summary>/);
    expect(html).toMatch(/role="img" aria-label="Each day: 23 events in 7 days/);
    expect(t).toContain("Show browser noise (2)");
  });

  it("noise when asked; an empty tab", () => {
    expect(text(render(<IssuesContent {...props} showNoise />))).toContain("Browser noise");
    expect(text(render(<IssuesContent {...props} issues={[]} />))).toContain("Nothing open");
  });
});

describe("the overview with the console's sections", () => {
  const IDLE: CheckState = { running: false, error: null, results: null, at: null };
  const base = { loading: false, error: null, check: IDLE, onRefresh: noop, onCheckNow: noop, now: NOW, view: buildAdminView(world.overview, CLOCK) };

  it("Live now, the top open issues (all issues →) and the newest new bugs (open the inbox →)", () => {
    const live = liveNowView(world.boards.filter((b) => NOW - Date.parse(b.updatedAt) <= 5 * 60_000), CLOCK);
    const html = render(<AdminContent {...base} live={live} issues={topIssues(world.issues, CLOCK)} bugs={newBugsPreview(world.bugs, CLOCK)} />);
    const t = text(html);
    expect(t).toContain("4 students on a board right now");
    expect(t).toContain("Top open issues, last 7 days");
    expect(t).toContain("All issues (6 open)");
    expect(html).toContain('href="/admin/issues"');
    expect(t).toContain("Open the inbox (4 new)");
    expect(html).toContain('href="/admin/bugs?id=bug_001&tab=new"');
    expect(html.match(/href="\/admin\/bugs\?id=/g)).toHaveLength(3);
    expect(t).not.toContain("Grouped, last 24 hours");
  });

  it("while those routes can't answer, the overview's own groups and bug reports stand in", () => {
    const t = text(render(<AdminContent {...base} />));
    expect(t).toContain("Checking who's on a board…");
    expect(t).toContain("Grouped, last 24 hours");
    expect(t).toContain("The latest 20.");
  });
});
