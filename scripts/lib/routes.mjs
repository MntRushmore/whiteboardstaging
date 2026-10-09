/**
 * Static registry of every Next.js route handler under src/app/api.
 *
 * Shared by scripts/live-smoke.mjs (which probes each route over HTTP) and
 * src/__tests__/routeProtection.test.ts (which asserts this list matches the
 * filesystem and that every file honours the auth / rate-limit / zod invariants).
 *
 * Adding a route: create src/app/api/<path>/route.ts AND add an entry here, or the
 * unit test fails. Prefer marking a shipped path deprecated over renaming it; a route that is
 * removed on purpose (the image pipeline: generate-solution, generate-worksheet, ocr,
 * check-help-needed) leaves the filesystem and this list in the same change.
 *
 * Fields
 *   path        URL path
 *   file        repo-relative route file
 *   methods     exported HTTP handlers
 *   auth        "user"   -> requireUser (401 unauthorized without a bearer token)
 *               "public" -> no auth; response must carry no secrets (booleans only)
 *   limit       rate-limit bucket (LIMITS key) or an ip:* pseudo-bucket for public routes
 *   body        "zod"  -> JSON body validated with a zod schema
 *               "none" -> the handler never reads a body (GET, or POST with an empty body)
 *   status      "active" | "deprecated: <reason>" (deprecated routes keep working)
 */
export const PUBLIC_ROUTES = Object.freeze([
  // Boolean-only provider status for the setup screen; never returns key material.
  "src/app/api/config/status/route.ts",
  // Billing provider webhook: no user JWT exists; the Stripe-Signature HMAC is the auth.
  "src/app/api/billing/webhook/route.ts",
  // Storage GC cron: no user JWT exists; the shared CRON_SECRET bearer token is the auth.
  "src/app/api/admin/gc/route.ts",
  // Health checks: pg_cron has no user JWT, so the CRON_SECRET bearer (from Supabase Vault) is the
  // auth; anything else must be an admin's token (requireAdmin: 401 signed out, 404 not an admin).
  "src/app/api/admin/health/route.ts",
  // Browser crash reports: errors happen signed out too, and a beacon cannot carry a token. Per-IP
  // limit, 16 KB body cap, zod; a token, when sent, only names the user in the log line.
  "src/app/api/client-errors/route.ts",
  // Uptime monitor probe: answers { ok, db, release } only.
  "src/app/api/health/route.ts",
  // Trial-reminder cron: no user JWT exists; the shared CRON_SECRET bearer token is the auth.
  "src/app/api/cron/trial-reminders/route.ts",
]);

/** Why each public route may skip requireUser (enforced by routeProtection.test.ts). */
export const PUBLIC_ROUTE_REASONS = Object.freeze({
  "src/app/api/config/status/route.ts": "booleans-only setup status",
  "src/app/api/billing/webhook/route.ts": "signature-verified provider webhook",
  "src/app/api/admin/gc/route.ts": "Vercel cron; requires Authorization: Bearer CRON_SECRET",
  "src/app/api/admin/health/route.ts": "pg_cron health checks; requires Authorization: Bearer CRON_SECRET or an admin's token (requireAdmin)",
  "src/app/api/client-errors/route.ts": "browser error reports, sent signed out too; per-IP limit, 16 KB body cap, zod; logs only",
  "src/app/api/health/route.ts": "uptime monitor probe; answers { ok, db, release } only",
  "src/app/api/cron/trial-reminders/route.ts": "Vercel cron; requires Authorization: Bearer CRON_SECRET",
});

/** Routes whose handlers legitimately have no zod body schema. */
export const NO_BODY_ROUTES = Object.freeze([
  "src/app/api/credits/route.ts", // GET only
  "src/app/api/config/status/route.ts", // GET only
  "src/app/api/admin/gc/route.ts", // GET (Vercel cron) or POST with an empty body; options are query params
  "src/app/api/admin/health/route.ts", // GET only (pg_cron, or an admin's "check now")
  "src/app/api/live/lecture/token/route.ts", // POST with an empty body: mints a speech-to-text token for the caller
  "src/app/api/health/route.ts", // GET only
  "src/app/api/cron/trial-reminders/route.ts", // GET only (Vercel cron); ?dryRun=1 is a query param
  "src/app/api/email/welcome/route.ts", // POST with an empty body: the server decides who and whether
  "src/app/api/family/route.ts", // GET (?tz= is a query param) and DELETE (every kid of the caller's family), no body
  "src/app/api/admin/overview/route.ts", // GET only
  // The admin console's reads (GET only; ids in the path, filters in the query string, zod-checked).
  "src/app/api/admin/users/route.ts",
  "src/app/api/admin/users/[id]/route.ts",
  "src/app/api/admin/boards/route.ts",
  "src/app/api/admin/boards/[id]/route.ts",
  "src/app/api/admin/bugs/route.ts",
  "src/app/api/admin/bugs/[id]/screenshot/route.ts",
]);

export const API_ROUTES = Object.freeze([
  {
    path: "/api/admin/gc",
    file: "src/app/api/admin/gc/route.ts",
    methods: ["GET", "POST"],
    auth: "public",
    limit: "ip:adminGc",
    body: "none",
    // 401 without `Authorization: Bearer <CRON_SECRET>`; 503 when CRON_SECRET / the service role key are unset.
    withoutTokenStatus: [401, 503],
    purpose: "Storage garbage collection (Vercel cron): orphaned board-assets / training-data objects; ?dryRun=1 default",
    status: "active",
  },
  {
    path: "/api/admin/health",
    file: "src/app/api/admin/health/route.ts",
    methods: ["GET"],
    auth: "public",
    limit: "ip:adminHealth",
    body: "none",
    // Without the cron secret it is requireAdmin's answer: 401 with no token, 404 for a non-admin.
    withoutTokenStatus: [401, 404],
    purpose: "Health checks (pg_cron every 5 min, or an admin's check now): app, database, OpenRouter, Mathpix, Resend, Stripe; rows, events, alert emails",
    status: "active",
  },
  {
    path: "/api/admin/overview",
    file: "src/app/api/admin/overview/route.ts",
    methods: ["GET"],
    // requireAdmin = requireUser (401 without a token) + is_admin() (404 for a non-admin).
    auth: "user",
    limit: "credits",
    body: "none",
    purpose: "The /admin page's overview (admins only): service health, errors students saw, AI failures, users, bug reports",
    status: "active",
  },
  // The admin console (admins only; src/lib/admin/contracts.ts, ADMIN_API). requireAdmin =
  // requireUser (401 without a token) + the admins table (404 for a non-admin), then the
  // `adminConsole` bucket (screenshots: `adminScreenshot`). Looks at student content are written to
  // admin_audit before they are answered.
  {
    path: "/api/admin/boards",
    file: "src/app/api/admin/boards/route.ts",
    methods: ["GET"],
    auth: "user",
    limit: "adminConsole",
    body: "none",
    purpose: "Admin console: a page of boards, newest first (?userId= one user's, ?live=1 saved in the last minutes, ?before= next page); logged as boards.list",
    status: "active",
  },
  {
    path: "/api/admin/boards/[id]",
    file: "src/app/api/admin/boards/[id]/route.ts",
    methods: ["GET"],
    auth: "user",
    limit: "adminConsole",
    body: "none",
    purpose: "Admin console: one board for the viewer and replay (snapshot streamed as stored, events, attempts, history); ?since=<version> answers { unchanged } when it is; logged as board.view",
    status: "active",
  },
  {
    path: "/api/admin/bugs",
    file: "src/app/api/admin/bugs/route.ts",
    methods: ["GET"],
    auth: "user",
    limit: "adminConsole",
    body: "none",
    purpose: "Admin console: the bug inbox, newest first (status, note, logs without noise; no screenshots)",
    status: "active",
  },
  {
    path: "/api/admin/bugs/[id]",
    file: "src/app/api/admin/bugs/[id]/route.ts",
    methods: ["PATCH"],
    auth: "user",
    limit: "adminConsole",
    body: "zod",
    purpose: "Admin console: triage a bug report (status new/seen/fixed/wontfix, note); logged as bug.update",
    status: "active",
  },
  {
    path: "/api/admin/bugs/[id]/screenshot",
    file: "src/app/api/admin/bugs/[id]/screenshot/route.ts",
    methods: ["GET"],
    auth: "user",
    limit: "adminScreenshot",
    body: "none",
    purpose: "Admin console: a bug report's screenshot as image bytes (private, 5 min cache); logged as bug.screenshot",
    status: "active",
  },
  {
    path: "/api/admin/issues",
    file: "src/app/api/admin/issues/route.ts",
    methods: ["GET", "PATCH"],
    auth: "user",
    limit: "adminConsole",
    body: "zod",
    purpose: "Admin console: app_events grouped into issues (?days=1|7|30), and their state (open, muted, fixed, note); PATCH logged as issue.update",
    status: "active",
  },
  {
    path: "/api/admin/users",
    file: "src/app/api/admin/users/route.ts",
    methods: ["GET"],
    auth: "user",
    limit: "adminConsole",
    body: "none",
    purpose: "Admin console: every account, most recently active first (plan, boards, learning, AI calls, errors, bug reports)",
    status: "active",
  },
  {
    path: "/api/admin/users/[id]",
    file: "src/app/api/admin/users/[id]/route.ts",
    methods: ["GET"],
    auth: "user",
    limit: "adminConsole",
    body: "none",
    purpose: "Admin console: one account (subscription, boards, learning record, activity, events, bug reports, emails); logged as user.view",
    status: "active",
  },
  {
    path: "/api/billing/webhook",
    file: "src/app/api/billing/webhook/route.ts",
    methods: ["POST"],
    auth: "public",
    limit: "ip:billingWebhook",
    body: "zod",
    // Reads the raw text (the signature covers the bytes), then zod-validates the parsed event.
    // Without a valid Stripe-Signature it answers 400; without the secrets, 503.
    withoutTokenStatus: [400, 503],
    purpose: "Stripe-compatible billing webhook: ink pack purchases and refunds via the service role (other apps' events on the shared account are ignored)",
    status: "active",
  },
  {
    path: "/api/client-errors",
    file: "src/app/api/client-errors/route.ts",
    methods: ["POST"],
    auth: "public",
    limit: "ip:clientErrors",
    body: "zod",
    // A valid report answers 204; the smoke probe's empty body is malformed JSON.
    withoutTokenStatus: [400],
    purpose: "Client error reports (window errors, unhandled rejections, error boundaries) -> one structured log line",
    status: "active",
  },
  {
    path: "/api/config/status",
    file: "src/app/api/config/status/route.ts",
    methods: ["GET"],
    auth: "public",
    limit: "ip:configStatus",
    body: "none",
    withoutTokenStatus: [200],
    purpose: "Which provider keys are configured (booleans only)",
    status: "active",
  },
  {
    path: "/api/cron/trial-reminders",
    file: "src/app/api/cron/trial-reminders/route.ts",
    methods: ["GET"],
    auth: "public",
    limit: "ip:trialReminders",
    body: "none",
    // 401 without `Authorization: Bearer <CRON_SECRET>`; 503 when CRON_SECRET / the service role key / RESEND_API_KEY are unset.
    withoutTokenStatus: [401, 503],
    purpose: "Agathon Unlimited trial reminders (Vercel cron, daily): one email per subscription whose free trial ends 24-72 h from now; ?dryRun=1 lists them",
    status: "active",
  },
  {
    path: "/api/credits",
    file: "src/app/api/credits/route.ts",
    methods: ["GET"],
    auth: "user",
    limit: "credits",
    body: "none",
    purpose: "The operator's OpenRouter balance (operators, smoke tests)",
    status: "active",
  },
  {
    path: "/api/email/welcome",
    file: "src/app/api/email/welcome/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "emailWelcome",
    body: "none",
    purpose: "The caller's welcome email, once per account, after onboarding (address from the verified account, never the client)",
    status: "active",
  },
  // Families (src/lib/family): a grown-up's kid profiles. Service role behind requireUser; every id
  // is checked against the caller's own family (src/lib/family/members.ts).
  {
    path: "/api/family",
    file: "src/app/api/family/route.ts",
    methods: ["DELETE", "GET"],
    auth: "user",
    limit: "family",
    body: "none",
    purpose: "The caller's family (members, the grown-up's view of each kid's numbers); DELETE removes every kid before the grown-up's account is deleted",
    status: "active",
  },
  {
    path: "/api/family/kids",
    file: "src/app/api/family/kids/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "family",
    body: "zod",
    purpose: "A grown-up adds a kid profile (a server-made account with no email or password of its own)",
    status: "active",
  },
  {
    path: "/api/family/kids/[id]",
    file: "src/app/api/family/kids/[id]/route.ts",
    methods: ["DELETE", "PATCH"],
    auth: "user",
    limit: "family",
    body: "zod",
    purpose: "A grown-up edits (PATCH) or removes (DELETE: the account and its data) one of their own kids",
    status: "active",
  },
  {
    path: "/api/family/pin",
    file: "src/app/api/family/pin/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "family",
    body: "zod",
    purpose: "The grown-up sets or changes their 4-digit PIN (stored as a scrypt hash)",
    status: "active",
  },
  {
    path: "/api/family/switch",
    file: "src/app/api/family/switch/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "familySwitch",
    body: "zod",
    purpose: "Switch to another profile of the caller's family: a server-minted session; to the grown-up only with their PIN (5 wrong tries per 15 min per family)",
    status: "active",
  },
  {
    path: "/api/health",
    file: "src/app/api/health/route.ts",
    methods: ["GET"],
    auth: "public",
    limit: "ip:health",
    body: "none",
    // 503 when the database does not answer (the free Supabase project paused).
    withoutTokenStatus: [200, 503],
    purpose: "Uptime probe: { ok, db, release }; db up when Postgres answers a trivial query within 3 s",
    status: "active",
  },
  {
    path: "/api/live/check",
    file: "src/app/api/live/check/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "liveCheck",
    body: "zod",
    purpose: "Live Math: SSE annotations for recognized lines",
    status: "active",
  },
  {
    path: "/api/live/chat",
    file: "src/app/api/live/chat/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "liveChat",
    body: "zod",
    purpose: "Live Math: the board chat — a typed request -> a short reply and board actions (problems the engine checks, lines, a graph, a figure spec, a new screen, clear)",
    status: "active",
  },
  {
    path: "/api/live/lecture",
    file: "src/app/api/live/lecture/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "liveLecture",
    body: "zod",
    purpose: "Lecture mode: the director — recent lecture transcript + what is drawn -> what to sketch (charts, diagrams, headings, graphs, figures), usually nothing",
    status: "active",
  },
  {
    path: "/api/live/lecture/sketch",
    file: "src/app/api/live/lecture/sketch/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "liveSketch",
    body: "zod",
    purpose: "Lecture mode: free drawing — one panel described in words -> the illustrator's SVG, parsed and sampled into ink strokes",
    status: "active",
  },
  {
    path: "/api/live/lecture/token",
    file: "src/app/api/live/lecture/token/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "liveListen",
    body: "none",
    purpose: "Lecture mode: a single-use ElevenLabs realtime speech-to-text token for the browser's microphone session",
    status: "active",
  },
  {
    path: "/api/live/proof",
    file: "src/app/api/live/proof/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "liveProof",
    body: "zod",
    purpose: "Live Math: two-column proofs — a proof's figure read (crop -> points and lines), or one next row the engine's planner could not find (checked on the client)",
    status: "active",
  },
  {
    path: "/api/live/recognize",
    file: "src/app/api/live/recognize/route.ts",
    methods: ["GET", "POST"],
    auth: "user",
    limit: "liveRecognize",
    body: "zod",
    purpose: "Live Math: GET capabilities; POST strokes -> LaTeX",
    status: "active",
  },
  {
    path: "/api/live/title",
    file: "src/app/api/live/title/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "liveTitle",
    body: "zod",
    purpose: "Live Math: a board's smart name from the maths on it (uncharged)",
    status: "active",
  },
  {
    path: "/api/live/reread",
    file: "src/app/api/live/reread/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "liveReread",
    body: "zod",
    purpose: "Live Math: the second reader re-reads one suspicious line from its ink crop",
    status: "active",
  },
  {
    path: "/api/live/setup",
    file: "src/app/api/live/setup/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "liveSetup",
    body: "zod",
    purpose: "Live Math: word problem, or a hand-drawn figure (crop), -> equations (LaTeX only); the client's engine solves them",
    status: "active",
  },
  {
    path: "/api/live/solve",
    file: "src/app/api/live/solve/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "liveSolve",
    body: "zod",
    purpose: "Live Math: SSE worked solution steps",
    status: "active",
  },
]);

/** Routes that must answer 401 unauthorized without a bearer token. */
export function protectedRoutes(routes = API_ROUTES) {
  return routes.filter((r) => r.auth === "user");
}

/** One (method, path) probe per exported handler. */
export function routeProbes(routes = API_ROUTES) {
  return routes.flatMap((r) => r.methods.map((method) => ({ method, path: r.path, route: r })));
}

/** Convert a repo-relative route file into its URL path. */
export function routeFileToPath(file) {
  const normalized = file.replace(/\\/g, "/");
  const match = /^src\/app(\/api(?:\/[^/]+)*)\/route\.ts$/.exec(normalized);
  if (!match) throw new Error(`not an API route file: ${file}`);
  return match[1];
}
