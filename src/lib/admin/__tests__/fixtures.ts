/**
 * A day on the admin page, for the view and component tests: now is 4:00 PM in New York on
 * Monday 2026-10-05; Mathpix has been down since 3:42 PM, OpenRouter has $12.40 left, Solve failed
 * for a few students this afternoon.
 */
import type { AdminOverview, ErrorGroup, ServiceStatus } from "../contracts";

export const NOW = Date.parse("2026-10-05T20:00:00Z");
export const TZ = "America/New_York";
export const CLOCK = { now: NOW, timeZone: TZ };

const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const HOUR_MS = 3_600_000;

export const BOARD_ID = "4f9c2a10-3b7d-4c55-9e21-8a6b0f1d2e33";

export function servicesFixture(): ServiceStatus[] {
  return [
    { service: "app", ok: true, lastCheckAt: minutesAgo(2), latencyMs: 142, detail: null, uptime24h: 1, downSince: null },
    { service: "database", ok: true, lastCheckAt: minutesAgo(2), latencyMs: 88, detail: null, uptime24h: 0.9965, downSince: null },
    { service: "openrouter", ok: true, lastCheckAt: minutesAgo(2), latencyMs: 412, detail: "$12.40 credit left", uptime24h: 1, downSince: null },
    { service: "mathpix", ok: false, lastCheckAt: minutesAgo(3), latencyMs: 6000, detail: "timeout after 6 s", uptime24h: 0.94, downSince: minutesAgo(18) },
    { service: "email", ok: true, lastCheckAt: minutesAgo(2), latencyMs: 1240, detail: null, uptime24h: 1, downSince: null },
    { service: "stripe", ok: null, lastCheckAt: null, latencyMs: null, detail: null, uptime24h: null, downSince: null },
  ];
}

export function groupsFixture(): ErrorGroup[] {
  return [
    {
      kind: "live.solve",
      code: "upstream",
      source: "live",
      level: "error",
      message: "The tutor couldn't work this one out. Try again.",
      count: 12,
      users: 5,
      firstAt: minutesAgo(190),
      lastAt: minutesAgo(4),
      samples: [
        { at: minutesAgo(4), userEmail: "maya@example.com", boardId: BOARD_ID, route: "/api/live/solve", requestId: "req_7f3a9c" },
        { at: minutesAgo(9), userEmail: null, boardId: null, route: "/api/live/solve", requestId: null },
      ],
    },
    {
      kind: "model.live.chat",
      code: "fallback",
      source: "server",
      level: "warn",
      message: "openai/gpt-5.4-mini timed out; deepseek answered",
      count: 7,
      users: 0,
      firstAt: minutesAgo(60 * 20),
      lastAt: minutesAgo(30),
      samples: [],
    },
    {
      kind: "live.recognize",
      code: "network",
      source: "live",
      level: "error",
      message: "Couldn't reach the handwriting reader.",
      count: 4,
      users: 2,
      firstAt: minutesAgo(25),
      lastAt: minutesAgo(5),
      samples: [{ at: minutesAgo(5), userEmail: "sam@example.com", boardId: BOARD_ID, route: "/api/live/recognize", requestId: "req_1" }],
    },
  ];
}

/** 48 hours ending with the current one: quiet, then this afternoon's trouble. */
export function perHourFixture(): AdminOverview["errors"]["perHour"] {
  const last = Math.floor(NOW / HOUR_MS) * HOUR_MS;
  return Array.from({ length: 48 }, (_, i) => {
    const hoursAgo = 47 - i;
    const errors = hoursAgo === 0 ? 9 : hoursAgo === 1 ? 5 : hoursAgo === 3 ? 2 : hoursAgo === 26 ? 1 : 0;
    const warnings = hoursAgo === 0 ? 2 : hoursAgo === 20 ? 4 : hoursAgo === 1 ? 1 : 0;
    return { hour: new Date(last - hoursAgo * HOUR_MS).toISOString(), errors, warnings };
  });
}

export function overviewFixture(overrides: Partial<AdminOverview> = {}): AdminOverview {
  return {
    generatedAt: new Date(NOW - 20_000).toISOString(),
    services: servicesFixture(),
    openrouter: { creditsLeftUsd: 12.4, usedUsd: null },
    errors: { total24h: 23, users24h: 7, perHour: perHourFixture(), groups: groupsFixture() },
    ai: {
      routes: [
        { route: "live/recognize", calls24h: 1840, failures24h: 4, fallbacks24h: 0 },
        { route: "live/check", calls24h: 620, failures24h: 2, fallbacks24h: 3 },
        { route: "live/chat", calls24h: 96, failures24h: 1, fallbacks24h: 7 },
        { route: "live/solve", calls24h: 41, failures24h: 12, fallbacks24h: 0 },
        { route: "live/setup", calls24h: 0, failures24h: 0, fallbacks24h: 0 },
        { route: "live/sketch", calls24h: 0, failures24h: 0, fallbacks24h: 0 },
        { route: "live/title", calls24h: 0, failures24h: 1, fallbacks24h: 0 },
      ],
    },
    users: { total: 412, signups24h: 3, signups7d: 19, active24h: 37, active7d: 121 },
    learning: { attempts24h: 268, solvedAlone24h: 166 },
    bugReports: [
      { at: minutesAgo(12), email: "maya@example.com", message: "Solve keeps spinning on my quadratic\nthen says try again", path: `/board/${BOARD_ID}` },
      { at: minutesAgo(60 * 30), email: null, message: "", path: "/" },
    ],
    ...overrides,
  };
}
