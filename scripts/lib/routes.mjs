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
  // Browser crash reports: errors happen signed out too, and a beacon cannot carry a token. Per-IP
  // limit, 16 KB body cap, zod; a token, when sent, only names the user in the log line.
  "src/app/api/client-errors/route.ts",
  // Uptime monitor probe: answers { ok, db, release } only.
  "src/app/api/health/route.ts",
]);

/** Why each public route may skip requireUser (enforced by routeProtection.test.ts). */
export const PUBLIC_ROUTE_REASONS = Object.freeze({
  "src/app/api/config/status/route.ts": "booleans-only setup status",
  "src/app/api/billing/webhook/route.ts": "signature-verified provider webhook",
  "src/app/api/admin/gc/route.ts": "Vercel cron; requires Authorization: Bearer CRON_SECRET",
  "src/app/api/client-errors/route.ts": "browser error reports, sent signed out too; per-IP limit, 16 KB body cap, zod; logs only",
  "src/app/api/health/route.ts": "uptime monitor probe; answers { ok, db, release } only",
});

/** Routes whose handlers legitimately have no zod body schema. */
export const NO_BODY_ROUTES = Object.freeze([
  "src/app/api/credits/route.ts", // GET only
  "src/app/api/config/status/route.ts", // GET only
  "src/app/api/admin/gc/route.ts", // GET (Vercel cron) or POST with an empty body; options are query params
  "src/app/api/live/lecture/token/route.ts", // POST with an empty body: mints a speech-to-text token for the caller
  "src/app/api/health/route.ts", // GET only
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
    path: "/api/billing/webhook",
    file: "src/app/api/billing/webhook/route.ts",
    methods: ["POST"],
    auth: "public",
    limit: "ip:billingWebhook",
    body: "zod",
    // Reads the raw text (the signature covers the bytes), then zod-validates the parsed event.
    // Without a valid Stripe-Signature it answers 400; without the secrets, 503.
    withoutTokenStatus: [400, 503],
    purpose: "Stripe-compatible billing webhook: plan changes via the service role",
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
    path: "/api/credits",
    file: "src/app/api/credits/route.ts",
    methods: ["GET"],
    auth: "user",
    limit: "credits",
    body: "none",
    purpose: "OpenRouter balance for the low-credit banner",
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
