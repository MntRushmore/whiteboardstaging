/**
 * Static registry of every Next.js route handler under src/app/api.
 *
 * Shared by scripts/live-smoke.mjs (which probes each route over HTTP) and
 * src/__tests__/routeProtection.test.ts (which asserts this list matches the
 * filesystem and that every file honours the auth / rate-limit / zod invariants).
 *
 * Adding a route: create src/app/api/<path>/route.ts AND add an entry here, or the
 * unit test fails. Never delete or rename a path that shipped: mark it deprecated.
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
]);

/** Why each public route may skip requireUser (enforced by routeProtection.test.ts). */
export const PUBLIC_ROUTE_REASONS = Object.freeze({
  "src/app/api/config/status/route.ts": "booleans-only setup status",
  "src/app/api/billing/webhook/route.ts": "signature-verified provider webhook",
  "src/app/api/admin/gc/route.ts": "Vercel cron; requires Authorization: Bearer CRON_SECRET",
});

/** Routes whose handlers legitimately have no zod body schema. */
export const NO_BODY_ROUTES = Object.freeze([
  "src/app/api/credits/route.ts", // GET only
  "src/app/api/config/status/route.ts", // GET only
  "src/app/api/voice/token/route.ts", // POST with an empty body; the model is fixed server-side
  "src/app/api/admin/gc/route.ts", // GET (Vercel cron) or POST with an empty body; options are query params
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
    path: "/api/check-help-needed",
    file: "src/app/api/check-help-needed/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "checkHelp",
    body: "zod",
    purpose: "Text/image heuristic: does the student look stuck?",
    status: "deprecated: unused by the client",
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
    path: "/api/generate-solution",
    file: "src/app/api/generate-solution/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "generateSolution",
    body: "zod",
    purpose: "Canvas PNG -> AI overlay image (feedback/suggest/answer)",
    status: "active",
  },
  {
    path: "/api/generate-worksheet",
    file: "src/app/api/generate-worksheet/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "generateWorksheet",
    body: "zod",
    purpose: "Topic -> worksheet image",
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
    path: "/api/live/solve",
    file: "src/app/api/live/solve/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "liveSolve",
    body: "zod",
    purpose: "Live Math: SSE worked solution steps",
    status: "active",
  },
  {
    path: "/api/ocr",
    file: "src/app/api/ocr/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "ocr",
    body: "zod",
    purpose: "Image -> plain text via a vision model",
    status: "deprecated: unused by the client",
  },
  {
    path: "/api/voice/analyze-workspace",
    file: "src/app/api/voice/analyze-workspace/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "analyzeWorkspace",
    body: "zod",
    purpose: "Voice tutor tool: describe the current canvas",
    status: "active",
  },
  {
    path: "/api/voice/token",
    file: "src/app/api/voice/token/route.ts",
    methods: ["POST"],
    auth: "user",
    limit: "voiceToken",
    body: "none",
    purpose: "Mint an ephemeral OpenAI Realtime client secret",
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
