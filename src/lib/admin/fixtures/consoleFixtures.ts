/**
 * A made-up week of Agathon for the admin console: ~24 accounts, their boards (with pictures),
 * bug reports, issues and an overview, all relative to `now`. Used by the console's tests (with a
 * pinned now) and, in development only, by `?fixtures=1` on any /admin page
 * (src/components/admin/devFixtures.ts), so the pages can be looked at before their API routes
 * exist. Never imported by production code: the dev switch is compiled out of a production build.
 *
 * Every response matches the contract's schema (the tests parse each one).
 */
import {
  ADMIN_API,
  ADMIN_LIMITS,
  ADMIN_ROUTES,
  issueFingerprint,
  type AdminAttempt,
  type AdminBoardRow,
  type AdminBug,
  type AdminEvent,
  type AdminIssue,
  type AdminOverview,
  type AdminUserDetail,
  type AdminUserRow,
  type PlanState,
} from "../contracts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A small seeded random, so every run draws the same week. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A stable uuid from a number (the fixture's ids). */
function uuid(n: number, salt = 0): string {
  const hex = (v: number, len: number) => (v >>> 0).toString(16).padStart(len, "0").slice(-len);
  const a = Math.imul(n + 1, 2654435761) ^ salt;
  const b = Math.imul(n + 7, 40503) ^ (salt << 3);
  return `${hex(a, 8)}-${hex(b, 4)}-4${hex(b >>> 4, 3)}-a${hex(a >>> 3, 3)}-${hex(a ^ b, 8)}${hex(n * 97 + salt, 4)}`;
}

interface Person {
  name: string | null;
  email: string | null;
  course: string | null;
  plan: PlanState;
  /** minutes since last active; null never */
  activeMin: number | null;
  /** days since sign-up */
  signedUpDays: number;
  onboarded: boolean;
  boards: number;
  attempts7d: number;
  alone7d: number;
  ai7d: number;
  errors7d: number;
  bugs: number;
  admin?: boolean;
  trialEndsInDays?: number;
}

const PEOPLE: Person[] = [
  { name: "Maya Chen", email: "maya.chen@example.com", course: "algebra1", plan: "trialing", activeMin: 2, signedUpDays: 5, onboarded: true, boards: 7, attempts7d: 18, alone7d: 11, ai7d: 142, errors7d: 4, bugs: 2, trialEndsInDays: 2 },
  { name: "Sam Okafor", email: "sam.okafor@example.com", course: "geometry", plan: "active", activeMin: 4, signedUpDays: 21, onboarded: true, boards: 12, attempts7d: 26, alone7d: 20, ai7d: 210, errors7d: 1, bugs: 0 },
  { name: "Priya Natarajan", email: "priya.n@example.com", course: "algebra2", plan: "trial_cancelling", activeMin: 3, signedUpDays: 4, onboarded: true, boards: 3, attempts7d: 9, alone7d: 4, ai7d: 61, errors7d: 0, bugs: 0, trialEndsInDays: 3 },
  { name: "Leo Martínez", email: "leo.martinez@example.com", course: "precalc_calc", plan: "failing", activeMin: 38, signedUpDays: 33, onboarded: true, boards: 9, attempts7d: 7, alone7d: 3, ai7d: 54, errors7d: 6, bugs: 1 },
  { name: "Ava Thompson", email: "ava.t@example.com", course: null, plan: "none", activeMin: 60 * 26, signedUpDays: 2, onboarded: false, boards: 0, attempts7d: 0, alone7d: 0, ai7d: 0, errors7d: 0, bugs: 0 },
  { name: "Noah Kim", email: "noah.kim@example.com", course: "algebra1", plan: "ended", activeMin: 60 * 24 * 9, signedUpDays: 40, onboarded: true, boards: 4, attempts7d: 0, alone7d: 0, ai7d: 0, errors7d: 0, bugs: 0 },
  { name: "Zara Ahmed", email: "zara.ahmed@example.com", course: "geometry", plan: "cancelling", activeMin: 60 * 5, signedUpDays: 28, onboarded: true, boards: 8, attempts7d: 12, alone7d: 9, ai7d: 77, errors7d: 0, bugs: 0 },
  { name: "Rushil Chopra", email: "rushil@example.com", course: "other", plan: "none", activeMin: 1, signedUpDays: 60, onboarded: true, boards: 31, attempts7d: 4, alone7d: 2, ai7d: 39, errors7d: 2, bugs: 0, admin: true },
  { name: "Ethan Brooks", email: "ethan.brooks@example.com", course: "algebra1", plan: "trialing", activeMin: 60 * 3, signedUpDays: 3, onboarded: true, boards: 2, attempts7d: 6, alone7d: 2, ai7d: 33, errors7d: 2, bugs: 1, trialEndsInDays: 4 },
  { name: null, email: "j.rivera.family@example.com", course: null, plan: "none", activeMin: 60 * 30, signedUpDays: 1, onboarded: false, boards: 1, attempts7d: 0, alone7d: 0, ai7d: 2, errors7d: 0, bugs: 0 },
  { name: "Isla Novak", email: "isla.novak@example.com", course: "algebra2", plan: "trialing", activeMin: 60 * 8, signedUpDays: 6, onboarded: true, boards: 4, attempts7d: 11, alone7d: 8, ai7d: 70, errors7d: 0, bugs: 0, trialEndsInDays: 1 },
  { name: "Mateo Rossi", email: "mateo.rossi@example.com", course: "precalc_calc", plan: "active", activeMin: 60 * 20, signedUpDays: 19, onboarded: true, boards: 10, attempts7d: 15, alone7d: 12, ai7d: 98, errors7d: 0, bugs: 0 },
  { name: "Hannah Lee", email: "hannah.lee@example.com", course: "algebra1", plan: "trialing", activeMin: 60 * 2, signedUpDays: 2, onboarded: true, boards: 2, attempts7d: 5, alone7d: 1, ai7d: 40, errors7d: 3, bugs: 1, trialEndsInDays: 5 },
  { name: "Omar Haddad", email: "omar.h@example.com", course: "geometry", plan: "none", activeMin: 60 * 24 * 3, signedUpDays: 6, onboarded: true, boards: 1, attempts7d: 1, alone7d: 0, ai7d: 6, errors7d: 0, bugs: 0 },
  { name: "Chloé Dubois", email: "chloe.dubois@example.com", course: "algebra2", plan: "trialing", activeMin: 60 * 11, signedUpDays: 4, onboarded: true, boards: 3, attempts7d: 8, alone7d: 6, ai7d: 47, errors7d: 0, bugs: 0, trialEndsInDays: 3 },
  { name: "Arjun Mehta", email: "arjun.mehta@example.com", course: "precalc_calc", plan: "none", activeMin: null, signedUpDays: 0, onboarded: false, boards: 0, attempts7d: 0, alone7d: 0, ai7d: 0, errors7d: 0, bugs: 0 },
  { name: "Grace Wilson", email: "grace.w@example.com", course: "algebra1", plan: "trialing", activeMin: 60 * 4, signedUpDays: 5, onboarded: true, boards: 5, attempts7d: 13, alone7d: 7, ai7d: 91, errors7d: 1, bugs: 0, trialEndsInDays: 2 },
  { name: "Kai Nakamura", email: "kai.nakamura@example.com", course: "geometry", plan: "trialing", activeMin: 60 * 27, signedUpDays: 6, onboarded: true, boards: 2, attempts7d: 3, alone7d: 3, ai7d: 18, errors7d: 0, bugs: 0, trialEndsInDays: 1 },
  { name: "Sofia Petrov", email: "sofia.petrov@example.com", course: "algebra1", plan: "none", activeMin: 60 * 24 * 2, signedUpDays: 3, onboarded: true, boards: 1, attempts7d: 2, alone7d: 1, ai7d: 9, errors7d: 0, bugs: 0 },
  { name: "Lucas Silva", email: "lucas.silva@example.com", course: "algebra2", plan: "trialing", activeMin: 60 * 6, signedUpDays: 4, onboarded: true, boards: 3, attempts7d: 7, alone7d: 5, ai7d: 52, errors7d: 0, bugs: 0, trialEndsInDays: 3 },
  { name: null, email: "parent.of.emma@example.com", course: null, plan: "none", activeMin: 60 * 48, signedUpDays: 2, onboarded: false, boards: 0, attempts7d: 0, alone7d: 0, ai7d: 0, errors7d: 1, bugs: 1 },
  { name: "Ben Carter", email: "ben.carter@example.com", course: "algebra1", plan: "trialing", activeMin: 60 * 9, signedUpDays: 6, onboarded: true, boards: 4, attempts7d: 10, alone7d: 4, ai7d: 66, errors7d: 2, bugs: 0, trialEndsInDays: 1 },
  { name: "Amara Osei", email: "amara.osei@example.com", course: "geometry", plan: "none", activeMin: 60 * 24 * 6, signedUpDays: 7, onboarded: true, boards: 2, attempts7d: 1, alone7d: 1, ai7d: 4, errors7d: 0, bugs: 0 },
  { name: "Felix Wagner", email: "felix.wagner@example.com", course: "precalc_calc", plan: "trialing", activeMin: 60 * 14, signedUpDays: 5, onboarded: true, boards: 3, attempts7d: 6, alone7d: 4, ai7d: 39, errors7d: 0, bugs: 0, trialEndsInDays: 2 },
];

export const FIXTURE_USER_IDS = PEOPLE.map((_, i) => uuid(i, 11));

// ------------------------------------------------------------------ board pictures

const PROBLEMS = [
  ["x² − 5x + 6 = 0", "(x − 2)(x − 3) = 0", "x = 2, x = 3"],
  ["2x + 7 = 19", "2x = 12", "x = 6"],
  ["a² + b² = c²", "6² + 8² = c²", "c = 10"],
  ["3(x − 4) = 2x + 1", "3x − 12 = 2x + 1", "x = 13"],
  ["d/dx (x³ + 2x)", "= 3x² + 2"],
  ["∠A + ∠B + ∠C = 180°", "∠C = 180° − 65° − 70°", "∠C = 45°"],
  ["log₂ 32 = ?", "2⁵ = 32", "= 5"],
  ["y = 2x − 3", "m = 2, b = −3"],
  ["√50 = √(25·2)", "= 5√2"],
  ["4/9 + 1/3", "= 4/9 + 3/9", "= 7/9"],
];

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A student's board, drawn: lines of handwriting, the tutor's ring or tick. An inline SVG data URL. */
export function boardPicture(seed: number): string {
  const lines = PROBLEMS[seed % PROBLEMS.length];
  const r = rng(seed + 3);
  const ink = ["#1f2a44", "#173b6c", "#2b2b2b"][seed % 3];
  const rows = lines
    .map((line, i) => {
      const x = 28 + Math.round(r() * 18);
      const y = 52 + i * 46;
      const rot = (r() * 2.4 - 1.2).toFixed(2);
      return `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" font-family="Bradley Hand, Segoe Print, Comic Sans MS, cursive" font-size="26" fill="${ink}">${escapeXml(line)}</text>`;
    })
    .join("");
  const lastY = 52 + (lines.length - 1) * 46;
  const tick =
    seed % 4 === 1
      ? `<ellipse cx="120" cy="${lastY - 9}" rx="104" ry="24" fill="none" stroke="#d9534f" stroke-width="2.5" opacity=".8"/>`
      : `<path d="M ${236 + (seed % 3) * 6} ${lastY - 8} l 9 10 l 18 -24" fill="none" stroke="#2e9e5b" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200"><rect width="320" height="200" fill="#ffffff"/><g opacity=".5">${Array.from({ length: 9 }, (_, i) => `<circle cx="${20 + i * 35}" cy="186" r="1" fill="#c9ccd3"/>`).join("")}</g>${rows}${tick}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The screenshot a bug report carries: a board with the error card the student saw. */
export function bugScreenshotSvg(seed: number): string {
  const lines = PROBLEMS[seed % PROBLEMS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800" width="1280" height="800">
<rect width="1280" height="800" fill="#ffffff"/>
<rect x="0" y="0" width="1280" height="56" fill="#f6f6f7"/><text x="24" y="36" font-family="Helvetica, Arial" font-size="20" fill="#333">Agathon</text>
${lines.map((l, i) => `<text x="${160 + i * 6}" y="${220 + i * 92}" font-family="Bradley Hand, Comic Sans MS, cursive" font-size="58" fill="#1f2a44">${escapeXml(l)}</text>`).join("")}
<rect x="760" y="560" width="470" height="150" rx="22" fill="#fff4f2" stroke="#e6a19a" stroke-width="2"/>
<text x="792" y="612" font-family="Helvetica, Arial" font-size="24" font-weight="600" fill="#a3312a">Something went wrong</text>
<text x="792" y="652" font-family="Helvetica, Arial" font-size="20" fill="#5b2a26">The tutor couldn't work this one out.</text>
<text x="792" y="684" font-family="Helvetica, Arial" font-size="20" fill="#5b2a26">Try again.</text>
</svg>`;
}

// ------------------------------------------------------------------ the world

export interface ConsoleWorld {
  users: AdminUserRow[];
  boards: AdminBoardRow[];
  bugs: AdminBug[];
  /** the 7-day window's issues */
  issues: AdminIssue[];
  /** the issues over another window (1, 7 or 30 days): their per-day series that long */
  issuesFor: (days: number) => AdminIssue[];
  overview: AdminOverview;
}

export function buildWorld(now: number): ConsoleWorld {
  const iso = (t: number) => new Date(t).toISOString();
  const users: AdminUserRow[] = PEOPLE.map((p, i) => ({
    id: FIXTURE_USER_IDS[i],
    email: p.email,
    name: p.name,
    course: p.course,
    createdAt: iso(now - p.signedUpDays * DAY - (i * 37 + 11) * MIN),
    onboardedAt: p.onboarded ? iso(now - p.signedUpDays * DAY + 20 * MIN) : null,
    lastActiveAt: p.activeMin === null ? null : iso(now - p.activeMin * MIN),
    plan: p.plan,
    trialEndsAt: p.trialEndsInDays !== undefined ? iso(now + p.trialEndsInDays * DAY + 3 * HOUR) : null,
    boards: p.boards,
    attempts7d: p.attempts7d,
    solvedAlone7d: p.alone7d,
    aiCalls7d: p.ai7d,
    errors7d: p.errors7d,
    bugReports: p.bugs,
    isAdmin: Boolean(p.admin),
  }));

  // boards: each user's, the newest saved around their last activity
  const boards: AdminBoardRow[] = [];
  const titles = ["Quadratics homework", "Untitled Whiteboard", "Two-step equations", "Pythagoras practice", "Unit 3 review", "Derivatives", "Triangle angles", "Logs warm-up", "Slope-intercept", "Radicals", "Fractions", "Practice: Factoring"];
  users.forEach((u, ui) => {
    const p = PEOPLE[ui];
    const n = Math.min(p.boards, 6);
    for (let k = 0; k < n; k++) {
      const seed = ui * 7 + k;
      const r = rng(seed + 101);
      const last = p.activeMin === null ? 3 * DAY : p.activeMin * MIN;
      const updated = now - last - k * (5 + Math.round(r() * 40)) * HOUR;
      boards.push({
        id: uuid(seed, 23),
        userId: u.id,
        ownerEmail: u.email,
        ownerName: u.name,
        title: k === 0 && ui % 5 === 1 ? "Untitled Whiteboard" : titles[seed % titles.length],
        createdAt: iso(updated - (1 + k) * DAY),
        updatedAt: iso(updated),
        preview: seed % 9 === 4 ? null : boardPicture(seed),
        version: 10 + Math.round(r() * 300),
        sizeKb: 40 + Math.round(r() * 900),
        attempts: Math.round(r() * 6),
        errors7d: k === 0 ? Math.min(p.errors7d, 3) : 0,
      });
    }
  });
  boards.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const ua = {
    ipad: "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    chromebook: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  };
  const diag = (agent: string, w: number, h: number, platform: string, boardId?: string) => ({
    boardId,
    url: boardId ? `https://agathon.app/board/${boardId}` : "https://agathon.app/",
    userAgent: agent,
    viewport: { width: w, height: h },
    screen: { width: w, height: h, pixelRatio: 2 },
    language: "en-US",
    platform,
    online: true,
    timestamp: iso(now),
  });
  const logs = (items: [string, string, number][]) => items.map(([level, text, minAgo]) => ({ level, text, time: iso(now - minAgo * MIN) }));
  const boardOf = (ui: number) => boards.find((b) => b.userId === users[ui].id)?.id ?? null;
  const bug = (i: number, ui: number | null, b: Partial<AdminBug> & Pick<AdminBug, "message" | "status">, minAgo: number): AdminBug => {
    const made: AdminBug = {
      id: `bug_${String(i).padStart(3, "0")}`,
      at: iso(now - minAgo * MIN),
      userId: ui === null ? null : users[ui].id,
      email: ui === null ? null : users[ui].email,
      boardId: null,
      path: "/",
      note: null,
      resolvedAt: null,
      hasScreenshot: false,
      diagnostics: null,
      logs: [],
      thread: [],
      waiting: false,
      reporterSeenAt: null,
      ...b,
    };
    return { ...made, waiting: made.thread.at(-1)?.author === "reporter" };
  };
  /** A message in a report's thread, `minAgo` minutes ago. */
  const said = (id: string, author: "admin" | "reporter", body: string, minAgo: number) => ({ id, author, body, at: iso(now - minAgo * MIN) });
  const bugs: AdminBug[] = [
    bug(
      1,
      0,
      {
        status: "new",
        message: "Solve keeps spinning on my quadratic and then it says try again. I tried 3 times.\nIt worked yesterday!",
        boardId: boardOf(0),
        path: `/board/${boardOf(0)}`,
        hasScreenshot: true,
        diagnostics: diag(ua.ipad, 1024, 768, "MacIntel", boardOf(0) ?? undefined),
        logs: logs([
          ["info", "[live] capabilities ok (mathpix, solve, check)", 9],
          ["info", "[live] recognize 412 ms · 2 lines", 8],
          ["warn", "[live] solve stream stalled after 20 s, retrying", 6],
          ["error", "[live] solve failed: upstream 502 (request req_7f3a9c)", 5],
          ["info", "[ui] error card shown: The tutor couldn't work this one out. Try again.", 5],
        ]),
      },
      12,
    ),
    bug(
      2,
      8,
      {
        status: "new",
        message: "the pen draws in the wrong place when I zoom in",
        boardId: boardOf(8),
        path: `/board/${boardOf(8)}`,
        hasScreenshot: true,
        diagnostics: diag(ua.chromebook, 1366, 657, "Linux x86_64", boardOf(8) ?? undefined),
        logs: logs([
          ["info", "[board] zoom 1.8", 40],
          ["debug", "[ink] pointer offset 14,22", 39],
        ]),
      },
      41,
    ),
    bug(3, 12, { status: "new", message: "Can't find where my old board went??", path: "/", diagnostics: diag(ua.iphone, 390, 664, "iPhone") }, 60 * 3),
    bug(
      4,
      20,
      {
        status: "new",
        message: "",
        path: "/account",
        diagnostics: diag(ua.windows, 1536, 730, "Win32"),
        logs: logs([["error", "TypeError: Cannot read properties of undefined (reading 'plan')", 60 * 20]]),
      },
      60 * 20,
    ),
    bug(
      5,
      3,
      {
        status: "seen",
        message: "Payment didn't go through but my card is fine",
        path: "/account",
        diagnostics: diag(ua.mac, 1440, 789, "MacIntel"),
        note: "Stripe says card_declined (insufficient funds). Emailed the parent.",
        // answered, then they wrote back: waiting on us
        thread: [
          said("msg_005_1", "admin", "Thanks for telling us. Stripe says the bank declined the charge. Could you try again, or with another card?", 60 * 29),
          said("msg_005_2", "reporter", "ok my mom tried another card and it worked.\nthanks!", 60 * 2),
        ],
        reporterSeenAt: iso(now - 2 * HOUR),
      },
      60 * 30,
    ),
    bug(
      6,
      1,
      {
        status: "seen",
        message: "Ask answered in Spanish once, weird",
        boardId: boardOf(1),
        path: `/board/${boardOf(1)}`,
        diagnostics: diag(ua.ipad, 1180, 820, "MacIntel"),
        // answered and read
        thread: [said("msg_006_1", "admin", "Sorry about that. We found why, and the tutor now always answers in English. Tell us if you see it again.", 60 * 47)],
        reporterSeenAt: iso(now - 40 * HOUR),
      },
      60 * 50,
    ),
    bug(7, null, { status: "seen", message: "The sign up page is blank on my school laptop", path: "/login", diagnostics: diag(ua.chromebook, 1280, 609, "Linux x86_64") }, 60 * 70),
    bug(
      8,
      0,
      { status: "fixed", message: "Handwriting reader said it couldn't read my 7s", boardId: boardOf(0), path: `/board/${boardOf(0)}`, hasScreenshot: true, diagnostics: diag(ua.ipad, 1024, 768, "MacIntel"), note: "Fixed by the re-read pass (PR #21).", resolvedAt: iso(now - 3 * DAY) },
      60 * 24 * 4,
    ),
    bug(9, 6, { status: "fixed", message: "Board didn't save when wifi dropped", path: "/", diagnostics: diag(ua.mac, 1440, 789, "MacIntel"), resolvedAt: iso(now - 2 * DAY), note: "Offline queue now retries." }, 60 * 24 * 5),
    bug(10, 11, { status: "fixed", message: "Progress page shows 0 minutes", path: "/progress", diagnostics: diag(ua.windows, 1920, 961, "Win32"), resolvedAt: iso(now - 1 * DAY) }, 60 * 24 * 3),
    bug(11, 13, { status: "wontfix", message: "can you add dark mode pls", path: "/", diagnostics: diag(ua.iphone, 390, 664, "iPhone"), resolvedAt: iso(now - 5 * DAY), note: "Later." }, 60 * 24 * 6),
    bug(12, 4, { status: "wontfix", message: "test", path: "/", diagnostics: diag(ua.mac, 1440, 789, "MacIntel"), resolvedAt: iso(now - 1 * DAY) }, 60 * 24 * 2),
  ];

  const event = (id: number, minAgo: number, e: Partial<AdminEvent> & Pick<AdminEvent, "kind" | "source" | "level" | "message">): AdminEvent => ({
    id,
    at: iso(now - minAgo * MIN),
    code: null,
    route: null,
    userId: null,
    userEmail: null,
    boardId: null,
    requestId: null,
    meta: null,
    release: "e90311e",
    noise: false,
    ...e,
  });
  const who = (ui: number) => ({ userId: users[ui].id, userEmail: users[ui].email, boardId: boardOf(ui) });
  const perDay = (days: number, pattern: (dayAgo: number) => number) => Array.from({ length: days }, (_, i) => pattern(days - 1 - i));

  const issue = (base: Omit<AdminIssue, "fingerprint" | "perDay" | "samples"> & { pattern: (dayAgo: number) => number; samples: AdminEvent[] }): ((days: number) => AdminIssue) => {
    const { pattern, ...rest } = base;
    return (days: number) => ({ ...rest, fingerprint: issueFingerprint(rest.kind, rest.code, rest.message), perDay: perDay(days, pattern) });
  };
  const issueMakers = [
    issue({
      kind: "live.solve",
      code: "upstream",
      source: "live",
      level: "error",
      message: "The tutor couldn't work this one out. Try again.",
      count: 23,
      users: 6,
      boards: 8,
      firstAt: iso(now - 3 * DAY),
      lastAt: iso(now - 4 * MIN),
      status: "open",
      note: null,
      fixedAt: null,
      regressed: false,
      noise: false,
      pattern: (d) => [9, 5, 0, 2, 4, 3, 0][d] ?? 0,
      samples: [
        event(9001, 4, { kind: "live.solve", code: "upstream", source: "live", level: "error", message: "The tutor couldn't work this one out. Try again.", route: "/api/live/solve", requestId: "req_7f3a9c", meta: { model: "openai/gpt-5.4", fallback: "deepseek/deepseek-v3.2", ms: 20412, status: 502, error: "upstream 502 Bad Gateway" }, ...who(0) }),
        event(9002, 9, { kind: "live.solve", code: "upstream", source: "live", level: "error", message: "The tutor couldn't work this one out. Try again.", route: "/api/live/solve", requestId: "req_51be02", meta: { model: "openai/gpt-5.4", ms: 18120, status: 502 }, ...who(12) }),
        event(9003, 60 * 5, { kind: "live.solve", code: "upstream", source: "live", level: "error", message: "The tutor couldn't work this one out. Try again.", route: "/api/live/solve", requestId: null, release: "2342d69" }),
      ],
    }),
    issue({
      kind: "live.save",
      code: "network",
      source: "live",
      level: "error",
      message: "Your board didn't save. We'll keep trying.",
      count: 5,
      users: 2,
      boards: 2,
      firstAt: iso(now - 6 * HOUR),
      lastAt: iso(now - 52 * MIN),
      status: "fixed",
      note: "Offline queue retries now.",
      fixedAt: iso(now - 2 * DAY),
      regressed: true,
      noise: false,
      pattern: (d) => (d === 0 ? 5 : 0),
      samples: [event(9011, 52, { kind: "live.save", code: "network", source: "live", level: "error", message: "Your board didn't save. We'll keep trying.", ...who(3), route: "/board", meta: { attempt: 3, error: "TypeError: Failed to fetch" } })],
    }),
    issue({
      kind: "live.recognize",
      code: "network",
      source: "live",
      level: "error",
      message: "Couldn't reach the handwriting reader.",
      count: 9,
      users: 3,
      boards: 4,
      firstAt: iso(now - 2 * DAY),
      lastAt: iso(now - 25 * MIN),
      status: "open",
      note: null,
      fixedAt: null,
      regressed: false,
      noise: false,
      pattern: (d) => [3, 4, 2, 0, 0, 0, 0][d] ?? 0,
      samples: [event(9021, 25, { kind: "live.recognize", code: "network", source: "live", level: "error", message: "Couldn't reach the handwriting reader.", route: "/api/live/recognize", requestId: "req_1c0d", ...who(8) })],
    }),
    issue({
      kind: "model.live.chat",
      code: "fallback",
      source: "server",
      level: "warn",
      message: "openai/gpt-5.4-mini timed out; deepseek answered",
      count: 31,
      users: 0,
      boards: 0,
      firstAt: iso(now - 6 * DAY),
      lastAt: iso(now - 30 * MIN),
      status: "open",
      note: null,
      fixedAt: null,
      regressed: false,
      noise: false,
      pattern: (d) => [6, 4, 5, 3, 7, 4, 2][d] ?? 0,
      samples: [event(9031, 30, { kind: "model.live.chat", code: "fallback", source: "server", level: "warn", message: "openai/gpt-5.4-mini timed out; deepseek answered", route: "/api/live/chat", requestId: "req_99a1", meta: { primary: "openai/gpt-5.4-mini", fallback: "deepseek/deepseek-v3.2", ms: 12004 } })],
    }),
    issue({
      kind: "route.live.check",
      code: "timeout",
      source: "server",
      level: "error",
      message: "check timed out after # s",
      count: 4,
      users: 3,
      boards: 3,
      firstAt: iso(now - 4 * DAY),
      lastAt: iso(now - 3 * HOUR),
      status: "open",
      note: null,
      fixedAt: null,
      regressed: false,
      noise: false,
      pattern: (d) => [1, 0, 2, 0, 1, 0, 0][d] ?? 0,
      samples: [event(9041, 180, { kind: "route.live.check", code: "timeout", source: "server", level: "error", message: "check timed out after 25 s", route: "/api/live/check", requestId: "req_c4c4", ...who(1), meta: { ms: 25000, stream: true, delivered: false } })],
    }),
    issue({
      kind: "client.boundary",
      code: null,
      source: "client",
      level: "error",
      message: "Cannot read properties of undefined (reading 'plan')",
      count: 2,
      users: 2,
      boards: 0,
      firstAt: iso(now - 22 * HOUR),
      lastAt: iso(now - 20 * HOUR),
      status: "open",
      note: null,
      fixedAt: null,
      regressed: false,
      noise: false,
      pattern: (d) => (d === 1 ? 2 : 0),
      samples: [event(9051, 60 * 20, { kind: "client.boundary", source: "client", level: "error", message: "Cannot read properties of undefined (reading 'plan')", route: "/account", ...who(20), boardId: null })],
    }),
    issue({
      kind: "mathpix",
      code: "rate_limited",
      source: "server",
      level: "error",
      message: "Mathpix answered 429",
      count: 12,
      users: 4,
      boards: 5,
      firstAt: iso(now - 9 * DAY),
      lastAt: iso(now - 8 * DAY),
      status: "muted",
      note: "Their burst limit; retries cover it.",
      fixedAt: null,
      regressed: false,
      noise: false,
      pattern: () => 0,
      samples: [],
    }),
    issue({
      kind: "live.chat",
      code: "timeout",
      source: "live",
      level: "error",
      message: "Ask took too long to answer.",
      count: 6,
      users: 3,
      boards: 3,
      firstAt: iso(now - 12 * DAY),
      lastAt: iso(now - 5 * DAY),
      status: "fixed",
      note: "Raised the stream timeout.",
      fixedAt: iso(now - 4 * DAY),
      regressed: false,
      noise: false,
      pattern: (d) => (d === 5 ? 2 : d === 6 ? 4 : 0),
      samples: [],
    }),
    issue({
      kind: "client.error",
      code: null,
      source: "client",
      level: "error",
      message: "ResizeObserver loop completed with undelivered notifications.",
      count: 140,
      users: 19,
      boards: 0,
      firstAt: iso(now - 7 * DAY),
      lastAt: iso(now - 2 * MIN),
      status: "open",
      note: null,
      fixedAt: null,
      regressed: false,
      noise: true,
      pattern: (d) => [30, 22, 18, 25, 20, 15, 10][d] ?? 0,
      samples: [],
    }),
    issue({
      kind: "client.rejection",
      code: null,
      source: "client",
      level: "error",
      message: "chrome-extension://#/content.js: Extension context invalidated.",
      count: 8,
      users: 2,
      boards: 0,
      firstAt: iso(now - 3 * DAY),
      lastAt: iso(now - 7 * HOUR),
      status: "open",
      note: null,
      fixedAt: null,
      regressed: false,
      noise: true,
      pattern: (d) => [2, 3, 3, 0, 0, 0, 0][d] ?? 0,
      samples: [],
    }),
  ];

  const overview = overviewAt(now, users, bugs);
  const issuesFor = (days: number) => issueMakers.map((m) => m(days));
  return { users, boards, bugs, issues: issuesFor(7), issuesFor, overview };
}

function overviewAt(now: number, users: AdminUserRow[], bugs: AdminBug[]): AdminOverview {
  const iso = (t: number) => new Date(t).toISOString();
  const last = Math.floor(now / HOUR) * HOUR;
  return {
    generatedAt: iso(now - 20_000),
    services: [
      { service: "app", ok: true, lastCheckAt: iso(now - 2 * MIN), latencyMs: 142, detail: null, uptime24h: 1, downSince: null },
      { service: "database", ok: true, lastCheckAt: iso(now - 2 * MIN), latencyMs: 88, detail: null, uptime24h: 0.9965, downSince: null },
      { service: "openrouter", ok: true, lastCheckAt: iso(now - 2 * MIN), latencyMs: 412, detail: "$41.20 credit left", uptime24h: 1, downSince: null },
      { service: "mathpix", ok: true, lastCheckAt: iso(now - 2 * MIN), latencyMs: 640, detail: null, uptime24h: 0.993, downSince: null },
      { service: "email", ok: true, lastCheckAt: iso(now - 2 * MIN), latencyMs: 1240, detail: null, uptime24h: 1, downSince: null },
      { service: "stripe", ok: true, lastCheckAt: iso(now - 2 * MIN), latencyMs: 310, detail: "Last webhook 14 min ago", uptime24h: 1, downSince: null },
    ],
    openrouter: { creditsLeftUsd: 41.2, usedUsd: null },
    errors: {
      total24h: 19,
      users24h: 7,
      perHour: Array.from({ length: 48 }, (_, i) => {
        const h = 47 - i;
        return { hour: iso(last - h * HOUR), errors: h === 0 ? 6 : h === 1 ? 3 : h === 5 ? 2 : h === 20 ? 2 : h === 28 ? 1 : 0, warnings: h === 0 ? 1 : h === 3 ? 2 : h === 20 ? 3 : 0 };
      }),
      groups: [],
    },
    ai: {
      routes: [
        { route: "live/recognize", calls24h: 1840, failures24h: 4, fallbacks24h: 0 },
        { route: "live/check", calls24h: 620, failures24h: 2, fallbacks24h: 3 },
        { route: "live/chat", calls24h: 96, failures24h: 1, fallbacks24h: 7 },
        { route: "live/solve", calls24h: 41, failures24h: 9, fallbacks24h: 0 },
        { route: "live/setup", calls24h: 0, failures24h: 0, fallbacks24h: 0 },
      ],
    },
    users: { total: users.length + 46, signups24h: 6, signups7d: 62, active24h: 23, active7d: 51 },
    money: {
      priceUsd: 25,
      paying: 2,
      payingCancelling: 1,
      mrrUsd: 25,
      trialing: 14,
      trialsCancelling: 1,
      pipelineUsd: 325,
      failing: 1,
      ended: 1,
      trialsOver: 3,
      trialsConverted: 2,
      started7d: 12,
      upcoming: [
        { at: iso(now + 1 * DAY), kind: "first", usd: 25 },
        { at: iso(now + 1.02 * DAY), kind: "first", usd: 25 },
        { at: iso(now + 1.04 * DAY), kind: "first", usd: 25 },
        { at: iso(now + 2 * DAY), kind: "first", usd: 25 },
        { at: iso(now + 3 * DAY), kind: "first", usd: 25 },
        { at: iso(now + 9 * DAY), kind: "renewal", usd: 25 },
      ],
    },
    funnel: { accounts: users.length + 46, onboarded: 58, trials: 17, paying: 2 },
    learning: { attempts24h: 96, solvedAlone24h: 58 },
    bugReports: bugs.slice(0, 20).map((b) => ({ at: b.at, email: b.email, message: b.message, path: b.path })),
  };
}

// ------------------------------------------------------------------ one user

export function userDetailAt(world: ConsoleWorld, id: string, now: number): AdminUserDetail | null {
  const index = world.users.findIndex((u) => u.id === id);
  if (index < 0) return null;
  const user = world.users[index];
  const p = PEOPLE[index];
  const r = rng(index + 500);
  const iso = (t: number) => new Date(t).toISOString();
  const boards = world.boards.filter((b) => b.userId === id);
  const activity = Array.from({ length: 30 }, (_, i) => {
    const dayAgo = 29 - i;
    const day = new Date(now - dayAgo * DAY).toISOString().slice(0, 10);
    const signedUp = dayAgo <= p.signedUpDays;
    const quiet = !signedUp || p.activeMin === null || dayAgo * DAY < (p.activeMin ?? 0) * MIN - DAY || r() < 0.3;
    const attempts = quiet ? 0 : Math.round(r() * (p.attempts7d / 3 + 1));
    return { day, attempts, aiCalls: quiet ? 0 : attempts * 5 + Math.round(r() * 12), boards: quiet ? 0 : Math.round(r() * 2) };
  });
  const outcomes: AdminAttempt["outcome"][] = ["first_try", "self_corrected", "with_help", "first_try", "tutor_solved", "unfinished", "first_try", "in_progress"];
  const latex = ["x^{2}-5 x+6=0", "2 x+7=19", "a^{2}+b^{2}=c^{2}", "3(x-4)=2 x+1", "\\frac{d}{d x}\\left(x^{3}+2 x\\right)", "\\log _{2} 32", "\\sqrt{50}", "\\frac{4}{9}+\\frac{1}{3}"];
  const skills = ["quadratic_equations", "two_step_equations", "pythagorean", "multi_step_equations", "derivatives", "logarithms", "radicals", "fractions"];
  const total = p.attempts7d + Math.round(p.attempts7d * 1.6);
  const recent: AdminAttempt[] = Array.from({ length: Math.min(total, 12) }, (_, k) => {
    const started = now - (p.activeMin ?? 0) * MIN - k * (3 + Math.round(r() * 20)) * HOUR;
    const outcome = k === 0 && p.activeMin !== null && p.activeMin < 10 ? "in_progress" : outcomes[(index + k) % outcomes.length];
    return {
      id: `att_${index}_${k}`,
      boardId: boards[k % Math.max(1, boards.length)]?.id ?? null,
      problemLatex: latex[(index + k) % latex.length],
      skill: skills[(index + k) % skills.length],
      outcome,
      hints: outcome === "with_help" ? 2 : outcome === "tutor_solved" ? 3 : 0,
      solves: outcome === "tutor_solved" ? 1 : 0,
      linesRinged: outcome === "self_corrected" ? 1 : 0,
      activeMs: Math.round((2 + r() * 9) * MIN),
      startedAt: iso(started),
      finishedAt: outcome === "in_progress" ? null : iso(started + 6 * MIN),
    };
  });
  const alone = recent.filter((a) => a.outcome === "first_try" || a.outcome === "self_corrected").length;
  const bySkill = new Map<string, { attempts: number; solvedAlone: number }>();
  for (const a of recent) {
    const s = bySkill.get(a.skill) ?? { attempts: 0, solvedAlone: 0 };
    s.attempts += 1;
    if (a.outcome === "first_try" || a.outcome === "self_corrected") s.solvedAlone += 1;
    bySkill.set(a.skill, s);
  }
  const issues = world.issues.flatMap((i) => i.samples).filter((e) => e.userId === id);
  const events: AdminEvent[] = [
    ...issues,
    ...(index % 2 === 0
      ? [
          {
            id: 7000 + index,
            at: iso(now - 70 * MIN),
            source: "client" as const,
            level: "error" as const,
            kind: "client.error",
            code: null,
            message: "ResizeObserver loop completed with undelivered notifications.",
            route: "/board",
            userId: id,
            userEmail: user.email,
            boardId: boards[0]?.id ?? null,
            requestId: null,
            meta: null,
            release: "e90311e",
            noise: true,
          },
        ]
      : []),
  ];
  const sub =
    user.plan === "none"
      ? null
      : {
          status: { trialing: "trialing", trial_cancelling: "trialing", active: "active", cancelling: "active", failing: "past_due", ended: "canceled", none: "" }[user.plan],
          trialEnd: user.trialEndsAt,
          currentPeriodEnd: user.plan === "active" || user.plan === "cancelling" || user.plan === "failing" ? iso(now + 18 * DAY) : user.trialEndsAt,
          cancelAtPeriodEnd: user.plan === "trial_cancelling" || user.plan === "cancelling",
          cancelAt: user.plan === "cancelling" ? iso(now + 18 * DAY) : null,
          payerEmail: user.email ? `parent.${user.email}` : null,
          createdAt: iso(now - Math.max(1, p.signedUpDays - 1) * DAY),
        };
  return {
    generatedAt: iso(now - 5_000),
    user,
    subscription: sub,
    inkBalance: user.plan === "none" ? 120 : user.plan === "failing" ? 0 : null,
    boards,
    learning: {
      attempts: total,
      solvedAlone: Math.round(total * (alone / Math.max(1, recent.length))),
      withHelp: Math.round(total * 0.2),
      tutorSolved: Math.round(total * 0.12),
      activeMinutes: total * 6,
      skills: [...bySkill.entries()].map(([skill, s]) => ({ skill, ...s })).sort((a, b) => b.attempts - a.attempts),
      recent,
    },
    activity,
    events,
    bugs: world.bugs.filter((b) => b.userId === id),
    emails: [
      { kind: "welcome", sentAt: iso(Date.parse(user.createdAt) + 2 * MIN) },
      ...(user.plan === "trialing" || user.plan === "trial_cancelling" ? [{ kind: "trial_reminder", sentAt: user.trialEndsAt && Date.parse(user.trialEndsAt) - now < 2 * DAY ? iso(now - 3 * HOUR) : null }] : []),
    ],
  };
}

// ------------------------------------------------------------------ the fake server

export type FixtureMode = "1" | "empty" | "error";

export interface FixtureAnswer {
  status: number;
  json?: unknown;
  /** image bytes (the screenshot), as SVG text */
  svg?: string;
}

/** What each console route answers, from one world, kept between calls (so a PATCH sticks). */
export class FixtureServer {
  private world: ConsoleWorld;
  constructor(private readonly now: () => number) {
    this.world = buildWorld(now());
  }

  answer(url: string, method: string, body: unknown, mode: FixtureMode): FixtureAnswer {
    const u = new URL(url, "http://fixtures.local");
    const path = u.pathname;
    const now = this.now();
    const generatedAt = new Date(now).toISOString();
    if (mode === "error" && method === "GET") return { status: 500, json: { error: "internal", message: "Couldn't read app_events: status 500 (a dev fixture)" } };
    const empty = mode === "empty";

    if (path === ADMIN_ROUTES.overview) return { status: 200, json: { ...this.world.overview, bugReports: empty ? [] : this.world.overview.bugReports } };
    if (path === ADMIN_ROUTES.health) return { status: 200, json: { results: [] } };
    if (path === ADMIN_API.users) return { status: 200, json: { generatedAt, total: empty ? 0 : this.world.users.length, users: empty ? [] : this.world.users } };
    if (path.startsWith(`${ADMIN_API.users}/`)) {
      const detail = userDetailAt(this.world, decodeURIComponent(path.slice(ADMIN_API.users.length + 1)), now);
      return detail ? { status: 200, json: detail } : { status: 404 };
    }
    if (path === ADMIN_API.boards) {
      if (empty) return { status: 200, json: { generatedAt, boards: [], nextBefore: null } };
      let list = this.world.boards;
      if (u.searchParams.get("userId")) list = list.filter((b) => b.userId === u.searchParams.get("userId"));
      if (u.searchParams.get("live") === "1") list = list.filter((b) => now - Date.parse(b.updatedAt) <= ADMIN_LIMITS.liveWindowMin * MIN);
      const before = u.searchParams.get("before");
      if (before) list = list.filter((b) => Date.parse(b.updatedAt) < Date.parse(before));
      const page = list.slice(0, 24);
      return { status: 200, json: { generatedAt, boards: page, nextBefore: list.length > page.length ? page[page.length - 1].updatedAt : null } };
    }
    const shot = /^\/api\/admin\/bugs\/([^/]+)\/screenshot$/.exec(path);
    if (shot) {
      const i = this.world.bugs.findIndex((b) => b.id === shot[1]);
      return i >= 0 && this.world.bugs[i].hasScreenshot ? { status: 200, svg: bugScreenshotSvg(i) } : { status: 404 };
    }
    // a reply: kept in the thread, new moves to seen; "fail" in it makes it fail (to see the error)
    const reply = /^\/api\/admin\/bugs\/([^/]+)\/messages$/.exec(path);
    if (reply && method === "POST") {
      const text = typeof (body as { body?: unknown } | null)?.body === "string" ? (body as { body: string }).body.trim() : "";
      if (!text) return { status: 400, json: { error: "invalid_request", message: "Invalid request: body: Write a reply first." } };
      if (/\bfail\b/i.test(text)) return { status: 500, json: { error: "internal", message: "the fixture server said no" } };
      const i = this.world.bugs.findIndex((b) => b.id === reply[1]);
      if (i < 0) return { status: 404 };
      const was = this.world.bugs[i];
      const thread = [...was.thread, { id: `msg_${now}`, author: "admin" as const, body: text, at: generatedAt }];
      const next: AdminBug = { ...was, status: was.status === "new" ? "seen" : was.status, thread, waiting: false };
      this.world.bugs[i] = next;
      return { status: 200, json: { bug: next, email: next.userId ? { status: "skipped", reason: "not_configured" } : { status: "skipped", reason: "no_reporter" } } };
    }
    const one = /^\/api\/admin\/bugs\/([^/]+)$/.exec(path);
    if (one && method === "PATCH") {
      const patch = (body ?? {}) as { status?: AdminBug["status"]; note?: string | null };
      if (typeof patch.note === "string" && /\bfail\b/i.test(patch.note)) return { status: 500, json: { error: "internal", message: "the fixture server said no" } };
      const i = this.world.bugs.findIndex((b) => b.id === one[1]);
      if (i < 0) return { status: 404 };
      const closed = patch.status === "fixed" || patch.status === "wontfix";
      const next = { ...this.world.bugs[i], ...(patch.status ? { status: patch.status, resolvedAt: closed ? generatedAt : null } : {}), ...(patch.note !== undefined ? { note: patch.note } : {}) };
      this.world.bugs[i] = next;
      return { status: 200, json: { bug: next } };
    }
    if (path === ADMIN_API.bugs) return { status: 200, json: { generatedAt, bugs: empty ? [] : this.world.bugs } };
    if (path === ADMIN_API.issues && method === "PATCH") {
      const patch = (body ?? {}) as { fingerprint: string; status: AdminIssue["status"]; note?: string | null };
      if (typeof patch.note === "string" && /\bfail\b/i.test(patch.note)) return { status: 500, json: { error: "internal", message: "the fixture server said no" } };
      this.world.issues = this.world.issues.map((i) =>
        i.fingerprint === patch.fingerprint
          ? { ...i, status: patch.status, note: patch.note !== undefined ? patch.note : i.note, fixedAt: patch.status === "fixed" ? generatedAt : patch.status === "open" ? null : i.fixedAt, regressed: patch.status === "muted" ? i.regressed : false }
          : i,
      );
      return { status: 200, json: { ok: true } };
    }
    if (path === ADMIN_API.issues) {
      const days = Number(u.searchParams.get("days") ?? 7);
      const span = days === 1 || days === 30 ? days : 7;
      const fresh = this.world.issuesFor(span);
      // the window's own counts and per-day series; the triage state is the server's (this.world)
      const issues = fresh
        .map((i) => ({ ...i, ...pickState(this.world.issues.find((w) => w.fingerprint === i.fingerprint)) }))
        .filter((i) => now - Date.parse(i.lastAt) <= span * DAY || i.status !== "open");
      return { status: 200, json: { generatedAt, days: span, issues: empty ? [] : issues } };
    }
    return { status: 404 };
  }
}

function pickState(i: AdminIssue | undefined): Partial<AdminIssue> {
  return i ? { status: i.status, note: i.note, fixedAt: i.fixedAt, regressed: i.regressed } : {};
}
