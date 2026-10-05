import { describe, expect, it } from "vitest";
import { AdminOverviewSchema, type ServiceStatus } from "../contracts";
import {
  ADMIN_COPY,
  buildAdminView,
  buildAiTable,
  buildErrorChart,
  bugReportViews,
  errorGroupView,
  errorTotalsLine,
  failureRate,
  formatLatency,
  formatPercent,
  formatUsd,
  formatWhen,
  kindLabel,
  listWords,
  niceMax,
  normalizeRoute,
  parseHealthResults,
  rateTone,
  relativeTime,
  serviceCard,
  serviceCards,
  serviceState,
  statTiles,
  statusSummary,
  statusesFromResults,
} from "../view";
import { BOARD_ID, CLOCK, NOW, TZ, groupsFixture, overviewFixture, perHourFixture, servicesFixture } from "./fixtures";

/** ICU puts a narrow no-break space before AM/PM; the tests read it as a space. */
const n = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("the fixture", () => {
  it("is a valid overview (the contract's schema)", () => {
    expect(AdminOverviewSchema.safeParse(overviewFixture()).success).toBe(true);
  });
});

describe("numbers and times", () => {
  it("latency in ms under a second, then seconds", () => {
    expect(formatLatency(142)).toBe("142 ms");
    expect(formatLatency(999.6)).toBe("1.0 s");
    expect(formatLatency(1240)).toBe("1.2 s");
    expect(formatLatency(6000)).toBe("6.0 s");
    expect(formatLatency(12_400)).toBe("12 s");
    expect(formatLatency(null)).toBeNull();
    expect(formatLatency(-1)).toBeNull();
  });

  it("percent: one decimal at most, rounded down, never 100% when not perfect, never 0% when not none", () => {
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.9999)).toBe("99.9%");
    expect(formatPercent(0.9965)).toBe("99.6%");
    expect(formatPercent(0.94)).toBe("94%");
    expect(formatPercent(0.05)).toBe("5%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.0002)).toBe("<0.1%");
    expect(formatPercent(null)).toBeNull();
  });

  it("money", () => {
    expect(formatUsd(12.4)).toBe("$12.40");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });

  it("relative time", () => {
    expect(relativeTime(ago(30_000), NOW)).toBe("just now");
    expect(relativeTime(ago(4 * MIN), NOW)).toBe("4 min ago");
    expect(relativeTime(ago(59 * MIN), NOW)).toBe("59 min ago");
    expect(relativeTime(ago(2 * HOUR + 10 * MIN), NOW)).toBe("2 h ago");
    expect(relativeTime(ago(25 * HOUR), NOW)).toBe("1 day ago");
    expect(relativeTime(ago(3 * 24 * HOUR), NOW)).toBe("3 days ago");
    // a clock a little ahead of ours is "just now", not the future
    expect(relativeTime(new Date(NOW + 5_000).toISOString(), NOW)).toBe("just now");
    expect(relativeTime(null, NOW)).toBeNull();
    expect(relativeTime("not a date", NOW)).toBeNull();
  });

  it("when: the time today, yesterday with the time, then the date (in the viewer's zone)", () => {
    expect(n(formatWhen("2026-10-05T19:42:00Z", CLOCK))).toBe("3:42 PM");
    expect(n(formatWhen("2026-10-05T04:30:00Z", CLOCK))).toBe("12:30 AM");
    // 11:30 PM in New York on the 4th is yesterday there, though it is the 5th in UTC
    expect(n(formatWhen("2026-10-05T03:30:00Z", CLOCK))).toBe("yesterday, 11:30 PM");
    expect(n(formatWhen("2026-10-03T13:05:00Z", CLOCK))).toBe("Oct 3, 9:05 AM");
    expect(n(formatWhen("2026-10-05T19:42:00Z", { now: NOW, timeZone: "UTC" }))).toBe("7:42 PM");
  });

  it("lists words", () => {
    expect(listWords([])).toBe("");
    expect(listWords(["A"])).toBe("A");
    expect(listWords(["A", "B"])).toBe("A and B");
    expect(listWords(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("services", () => {
  const status = (s: Partial<ServiceStatus>): ServiceStatus => ({
    service: "app",
    ok: true,
    lastCheckAt: ago(2 * MIN),
    latencyMs: 100,
    detail: null,
    uptime24h: 1,
    downSince: null,
    ...s,
  });

  it("up, down, not checked lately (15 minutes), never checked; a failing check stays down however old", () => {
    expect(serviceState(status({}), NOW)).toBe("up");
    expect(serviceState(status({ ok: false }), NOW)).toBe("down");
    expect(serviceState(status({ lastCheckAt: ago(16 * MIN) }), NOW)).toBe("stale");
    expect(serviceState(status({ lastCheckAt: ago(14 * MIN) }), NOW)).toBe("up");
    expect(serviceState(status({ ok: false, lastCheckAt: ago(3 * HOUR) }), NOW)).toBe("down");
    expect(serviceState(status({ ok: null, lastCheckAt: null }), NOW)).toBe("unknown");
  });

  it("a card per service in the contract's order, each state in words", () => {
    const cards = serviceCards(overviewFixture(), CLOCK);
    expect(cards.map((c) => c.service)).toEqual(["app", "database", "openrouter", "mathpix", "email", "stripe"]);
    expect(cards.map((c) => c.stateLabel)).toEqual(["Up", "Up", "Up", "Down", "Up", "Not checked yet"]);

    const app = cards[0];
    expect(app).toMatchObject({ name: "App", headline: null, latency: "142 ms", uptime: "100% up in 24 h", lastCheck: "Checked 2 min ago", detail: null });
    expect(cards[1].uptime).toBe("99.6% up in 24 h");

    const mathpix = cards[3];
    expect(mathpix.name).toBe("Mathpix handwriting");
    expect(n(mathpix.headline)).toBe("Down since 3:42 PM");
    expect(mathpix.latency).toBe("6.0 s");
    expect(mathpix.uptime).toBe("94% up in 24 h");
    expect(mathpix.detail).toBe("timeout after 6 s");

    const stripe = cards[5];
    expect(stripe).toMatchObject({ state: "unknown", headline: "No check yet", latency: null, uptime: null, lastCheck: null });
  });

  it("OpenRouter's detail carries its credit; under the alert line it is flagged", () => {
    const or = servicesFixture()[2];
    expect(serviceCard(or, CLOCK, { creditsLeftUsd: 12.4, usedUsd: null })).toMatchObject({ detail: "$12.40 credit left", lowCredit: false });
    expect(serviceCard({ ...or, detail: "$3.10 credit left" }, CLOCK, { creditsLeftUsd: 3.1, usedUsd: null }).lowCredit).toBe(true);
    // only OpenRouter's card is about credit
    expect(serviceCard(servicesFixture()[0], CLOCK, { creditsLeftUsd: 1, usedUsd: null }).lowCredit).toBe(false);
  });

  it("a service missing from the overview reads as never checked", () => {
    const cards = serviceCards({ services: [], openrouter: null }, CLOCK);
    expect(cards).toHaveLength(6);
    expect(cards.every((c) => c.state === "unknown")).toBe(true);
  });

  it("a passing service not checked lately says when it was", () => {
    const card = serviceCard(status({ lastCheckAt: ago(2 * HOUR) }), CLOCK);
    expect(card).toMatchObject({ state: "stale", stateLabel: "Not checked lately", headline: "Last check 2 h ago" });
  });
});

describe("the status line", () => {
  const summarize = (services: ServiceStatus[]) => statusSummary(serviceCards({ services, openrouter: null }, CLOCK), services, CLOCK);
  const up = servicesFixture().map((s) => ({ ...s, ok: true, lastCheckAt: ago(2 * MIN), downSince: null }));

  it("all systems normal", () => {
    expect(summarize(up)).toEqual({ tone: "ok", text: "All systems normal" });
  });

  it("one service down, since when", () => {
    const s = summarize(servicesFixture().map((x) => (x.service === "stripe" ? { ...x, ok: true, lastCheckAt: ago(2 * MIN) } : x)));
    expect(s.tone).toBe("down");
    expect(n(s.text)).toBe("Mathpix handwriting is down since 3:42 PM");
  });

  it("two down: named together, since the first went down", () => {
    const services = up.map((x) =>
      x.service === "mathpix" ? { ...x, ok: false, downSince: ago(18 * MIN) } : x.service === "stripe" ? { ...x, ok: false, downSince: ago(2 * MIN) } : x,
    );
    expect(n(summarize(services).text)).toBe("Mathpix handwriting and Stripe are down since 3:42 PM");
  });

  it("an outage that began yesterday says so", () => {
    const services = up.map((x) => (x.service === "database" ? { ...x, ok: false, downSince: ago(20 * HOUR) } : x));
    expect(n(summarize(services).text)).toBe("Database is down since yesterday, 8:00 PM");
  });

  it("many down: counted and named", () => {
    const services = up.map((x) => (["app", "database", "mathpix", "stripe"].includes(x.service) ? { ...x, ok: false, downSince: null } : x));
    expect(summarize(services)).toEqual({ tone: "down", text: "4 services are down: App, Database, Mathpix handwriting and Stripe" });
  });

  it("checks that stopped are not 'all normal'", () => {
    const services = up.map((x) => ({ ...x, lastCheckAt: ago(2 * HOUR + 5 * MIN) }));
    expect(summarize(services)).toEqual({ tone: "warn", text: "Checks have stopped: the last one was 2 h ago" });
    const one = up.map((x) => (x.service === "email" ? { ...x, lastCheckAt: ago(40 * MIN) } : x));
    expect(summarize(one)).toEqual({ tone: "warn", text: "Email hasn't been checked lately" });
  });

  it("no checks at all, and some not checked yet", () => {
    expect(summarize([])).toEqual({ tone: "unknown", text: "No health checks yet" });
    const someUnknown = up.map((x) => (x.service === "stripe" ? { ...x, ok: null, lastCheckAt: null } : x));
    expect(summarize(someUnknown)).toEqual({ tone: "ok", text: "All checked systems normal · Stripe not checked yet" });
  });
});

describe("Check now's answer", () => {
  const result = { service: "mathpix", ok: false, latencyMs: 6000, detail: "timeout", at: ago(0) };

  it("reads an array, or one under results or checks", () => {
    expect(parseHealthResults([result])).toEqual([result]);
    expect(parseHealthResults({ results: [result] })).toEqual([result]);
    expect(parseHealthResults({ checks: [result], ok: true })).toEqual([result]);
  });

  it("drops what it does not know, and answers null for nothing usable", () => {
    expect(parseHealthResults([{ service: "pagerduty", ok: true }, { service: "app" }, null, result])).toEqual([result]);
    expect(parseHealthResults({ ok: true })).toBeNull();
    expect(parseHealthResults("ok")).toBeNull();
    expect(parseHealthResults(null)).toBeNull();
    expect(parseHealthResults([])).toBeNull();
  });

  it("becomes statuses: a failing one down since its check", () => {
    expect(statusesFromResults([result as never])).toEqual([
      { service: "mathpix", ok: false, lastCheckAt: result.at, latencyMs: 6000, detail: "timeout", uptime24h: null, downSince: result.at },
    ]);
  });
});

describe("errors", () => {
  it("names each kind in words", () => {
    expect(kindLabel("live.solve")).toBe("Solve failed");
    expect(kindLabel("live.recognize")).toBe("Couldn't read handwriting");
    expect(kindLabel("live.check")).toBe("Checking work failed");
    expect(kindLabel("live.chat")).toBe("Ask failed");
    expect(kindLabel("live.save")).toBe("Board didn't save");
    expect(kindLabel("live.ink")).toBe("Out of ink");
    expect(kindLabel("live.capabilities")).toBe("Live couldn't start");
    expect(kindLabel("client.boundary")).toBe("Page crashed");
    expect(kindLabel("client.rejection")).toBe("Browser error (promise)");
    expect(kindLabel("mathpix")).toBe("Mathpix failed");
    expect(kindLabel("route.live.solve")).toBe("Solve: server error");
    expect(kindLabel("model.live.chat", "timeout")).toBe("Ask (board chat): model timed out");
    expect(kindLabel("model.live.chat", "fallback")).toBe("Ask (board chat): used the backup model");
    expect(kindLabel("model.live.lecture.sketch")).toBe("Lecture drawings: model failed");
    expect(kindLabel("health.mathpix")).toBe("Mathpix handwriting check failed");
    // kinds nobody has named yet still read
    expect(kindLabel("live.graph_paper")).toBe("Graph paper failed");
    expect(kindLabel("client.resize")).toBe("Browser error");
    expect(kindLabel("cron.gc")).toBe("cron.gc");
  });

  it("routes: dotted, slashed and /api/ forms are one route", () => {
    expect(normalizeRoute("live.solve")).toBe("live/solve");
    expect(normalizeRoute("/api/live/solve")).toBe("live/solve");
    expect(normalizeRoute("live/solve/")).toBe("live/solve");
    expect(normalizeRoute("live.lecture.sketch")).toBe("live/sketch");
    expect(normalizeRoute("/api/live/lecture/token")).toBe("live/listen");
  });

  it("the totals line", () => {
    expect(errorTotalsLine(23, 7)).toBe("23 errors · 7 students");
    expect(errorTotalsLine(1, 1)).toBe("1 error · 1 student");
    expect(errorTotalsLine(1_204, 0)).toBe("1,204 errors · no signed-in students");
    expect(errorTotalsLine(0, 0)).toBe("No errors in the last 24 hours");
  });

  it("a group: label, counts, when, and samples with an email and a board link", () => {
    const [solve, fallback] = groupsFixture().map((g, i) => errorGroupView(g, CLOCK, i));
    expect(solve).toMatchObject({
      label: "Solve failed",
      kind: "live.solve",
      code: "upstream",
      levelLabel: "Error",
      sourceLabel: "Board",
      count: "12 times",
      users: "5 students",
      lastSeen: "Last 4 min ago",
    });
    expect(n(solve.firstSeen)).toBe("First 12:50 PM");
    expect(solve.samples).toHaveLength(2);
    expect(n(solve.samples[0].when)).toBe("3:56 PM");
    expect(solve.samples[0]).toMatchObject({ who: "maya@example.com", boardHref: `/board/${BOARD_ID}`, boardShort: "4f9c2a10", requestId: "req_7f3a9c" });
    expect(solve.samples[1]).toMatchObject({ who: ADMIN_COPY.signedOut, boardHref: null, requestId: null });

    expect(fallback).toMatchObject({ levelLabel: "Warning", label: "Ask (board chat): used the backup model", users: "no signed-in student", count: "7 times" });
    expect(n(fallback.firstSeen)).toBe("First yesterday, 8:00 PM");
  });

  it("a board id that is not a uuid gets no link", () => {
    const g = { ...groupsFixture()[0], samples: [{ at: ago(MIN), userEmail: null, boardId: "../../etc", route: null, requestId: null }] };
    expect(errorGroupView(g, CLOCK).samples[0].boardHref).toBeNull();
  });
});

describe("the 48-hour chart", () => {
  const chart = buildErrorChart(perHourFixture(), CLOCK);

  it("a nice scale, two labelled gridlines", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(11)).toBe(20);
    expect(niceMax(20)).toBe(20);
    expect(niceMax(130)).toBe(200);
    expect(chart.ticks.map((t) => t.label)).toEqual(["10", "20"]);
    expect(chart.ticks.map((t) => t.ratio)).toEqual([0.5, 1]);
  });

  it("every hour a bar, stacked as shares of the scale, the last one this hour", () => {
    expect(chart.bars).toHaveLength(48);
    const last = chart.bars[47];
    expect(last).toMatchObject({ errors: 9, warnings: 2, errorRatio: 0.45, warningRatio: 0.1, isNow: true, axisLabel: "Now", day: "Today" });
    expect(n(last.label)).toBe("Today, 4 PM (this hour): 9 errors, 2 warnings");
    expect(n(chart.bars[21].label)).toBe("Yesterday, 2 PM: 1 error, 0 warnings");
    expect(n(chart.bars[0].label)).toBe("Sat, 5 PM: nothing");
  });

  it("axis labels at midnight (the weekday) and noon, none crowding the ends", () => {
    const labelled = chart.bars.map((b, i) => [i, b.axisLabel] as const).filter(([, l]) => l !== null);
    expect(labelled.map(([i, l]) => `${i}:${n(l)}`)).toEqual(["7:Sun", "19:12 PM", "31:Mon", "47:Now"]);
  });

  it("says it in words", () => {
    expect(n(chart.summary)).toBe("17 errors and 7 warnings in 48 hours. The worst hour: 9 errors, today at 4 PM.");
    expect(chart.hasData).toBe(true);
    const quiet = buildErrorChart(perHourFixture().map((h) => ({ ...h, errors: 0, warnings: 0 })), CLOCK);
    expect(quiet).toMatchObject({ hasData: false, summary: "No errors or warnings in the last 48 hours." });
    expect(quiet.ticks.map((t) => t.label)).toEqual(["1"]);
    const warningsOnly = buildErrorChart(perHourFixture().map((h) => ({ ...h, errors: 0 })), CLOCK);
    expect(warningsOnly.summary).toBe("0 errors and 7 warnings in 48 hours.");
  });

  it("in another zone the hours move with it", () => {
    const utc = buildErrorChart(perHourFixture(), { now: NOW, timeZone: "UTC" });
    expect(n(utc.bars[47].time)).toBe("8 PM");
    expect(utc.bars.map((b) => b.axisLabel).filter(Boolean)).toEqual(["Sun", "12 PM", "Mon", "12 PM", "Now"]);
  });
});

describe("AI", () => {
  it("failure rate is failures out of calls plus failures (a failed call is refunded)", () => {
    expect(failureRate(41, 12)).toBeCloseTo(12 / 53);
    expect(failureRate(0, 0)).toBeNull();
    expect(failureRate(0, 3)).toBe(1);
  });

  it("tones: 5% is worth a look, 20% with at least 3 failures is bad", () => {
    expect(rateTone(1000, 0)).toBe("ok");
    expect(rateTone(1000, 10)).toBe("ok");
    expect(rateTone(100, 6)).toBe("warn");
    expect(rateTone(41, 12)).toBe("bad");
    expect(rateTone(2, 1)).toBe("warn");
  });

  it("a row per active route, busiest first; idle routes named in one line", () => {
    const table = buildAiTable(overviewFixture().ai.routes);
    expect(table.rows.map((r) => r.route)).toEqual(["live/recognize", "live/check", "live/chat", "live/solve", "live/title"]);
    expect(table.rows[0]).toMatchObject({ label: "Handwriting reading", calls: "1,840", failures: "4", rate: "0.2%", fallbacks: "0", tone: "ok", toneLabel: null });
    expect(table.rows[2]).toMatchObject({ label: "Ask (board chat)", rate: "1%", fallbacks: "7" });
    expect(table.rows[3]).toMatchObject({ label: "Solve", calls: "41", failures: "12", rate: "22.6%", tone: "bad", toneLabel: "High" });
    // an unmetered route has no calls to count: no rate to judge, but its failures still show
    expect(table.rows[4]).toMatchObject({ label: "Board naming", calls: "—", failures: "1", rate: "—", tone: "ok", toneLabel: null });
    expect(table.idle).toBe("No calls in 24 hours: Word-problem setup and Lecture drawings.");
    expect(table.empty).toBe(false);
  });

  it("nothing at all", () => {
    const table = buildAiTable([{ route: "live/solve", calls24h: 0, failures24h: 0, fallbacks24h: 0 }]);
    expect(table).toMatchObject({ rows: [], empty: true, idle: "No calls in 24 hours: Solve." });
  });
});

describe("users, learning and bug reports", () => {
  it("four tiles", () => {
    const o = overviewFixture();
    expect(statTiles(o.users, o.learning)).toEqual([
      { key: "accounts", value: "412", label: "Accounts", hint: "3 new today" },
      { key: "signups", value: "19", label: "New this week", hint: "Sign-ups, last 7 days" },
      { key: "active", value: "37", label: "Active today", hint: "121 this week" },
      { key: "problems", value: "268", label: "Problems today", hint: "166 solved alone (61.9%)" },
    ]);
    expect(statTiles(o.users, { attempts24h: 0, solvedAlone24h: 0 })[3].hint).toBe("None worked yet");
  });

  it("bug reports: when, who, what, where", () => {
    const [first, second] = bugReportViews(overviewFixture().bugReports, CLOCK);
    expect(n(first.when)).toBe("3:48 PM");
    expect(first).toMatchObject({ ago: "12 min ago", email: "maya@example.com", path: `/board/${BOARD_ID}` });
    expect(first.message).toBe("Solve keeps spinning on my quadratic\nthen says try again");
    expect(n(second.when)).toBe("yesterday, 10:00 AM");
    expect(second).toMatchObject({ ago: "1 day ago", email: ADMIN_COPY.noEmail, message: ADMIN_COPY.noMessage, path: "/" });
  });
});

describe("the whole page", () => {
  it("builds every section from one overview", () => {
    const view = buildAdminView(overviewFixture(), CLOCK);
    expect(view.summary.tone).toBe("down");
    expect(view.services).toHaveLength(6);
    expect(view.credit).toBe("$12.40 OpenRouter credit left");
    expect(view.errors.totals).toBe("23 errors · 7 students");
    expect(view.errors.groups.map((g) => g.label)).toEqual(["Solve failed", "Ask (board chat): used the backup model", "Couldn't read handwriting"]);
    expect(view.ai.rows).toHaveLength(5);
    expect(view.tiles).toHaveLength(4);
    expect(view.bugs).toHaveLength(2);
    expect(view.updated).toBe("Updated just now");
  });

  it("an empty day reads calmly", () => {
    const view = buildAdminView(
      overviewFixture({
        errors: { total24h: 0, users24h: 0, perHour: perHourFixture().map((h) => ({ ...h, errors: 0, warnings: 0 })), groups: [] },
        ai: { routes: [] },
        bugReports: [],
        openrouter: null,
      }),
      { now: NOW, timeZone: TZ },
    );
    expect(view.errors.totals).toBe("No errors in the last 24 hours");
    expect(view.errors.groups).toEqual([]);
    expect(view.ai.empty).toBe(true);
    expect(view.bugs).toEqual([]);
    expect(view.credit).toBeNull();
  });
});
