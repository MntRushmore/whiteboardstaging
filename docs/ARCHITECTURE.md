# Architecture

Agathon Classroom is a single Next.js 16 App Router app. The browser talks to Supabase directly for auth and board persistence (protected by RLS), and to Next.js route handlers for anything that needs a provider API key. No key other than the Supabase anon key ever reaches the browser.

## Components

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Canvas | tldraw 4 (`src/app/board/[id]/page.tsx`) | Drawing, the Live Math layer (typeset echoes, the tutor's handwriting, marks and hand-sketched graphs), autosave |
| Client API helper | `src/lib/api-client.ts` | `authedFetch` attaches the Supabase access token; `apiJson` parses the error contract into `ApiError` |
| Route handlers | `src/app/api/**` (Node runtime) | JWT verification, rate limiting, zod validation, provider calls, logging |
| Server helpers | `src/lib/server/**`, `src/lib/env.ts` | `requireUser`, rate limiter, env validation, provider clients |
| Data | Supabase Postgres + Auth + Storage | Boards, settings, bug reports, training samples, buckets |
| Providers | OpenRouter (text + vision models; never image generation), Mathpix (handwriting OCR), OpenAI (Realtime voice) | Model inference |

## Request flows

### 1. Draw -> AI feedback (core loop)

The core loop is Live Math (see "Live Math flow" below): each finished line of ink is recognized to LaTeX, checked by the local engine, and answered with typeset echoes, hints and worked steps — or, for maths the engine can do itself, in the tutor's own handwriting. The rule is **read, never paint**: every model output is text or LaTeX the client renders. No route calls an image-generation model.

The old image pipeline (an idle timer that screenshotted the board and asked `google/gemini-3-pro-image-preview` to paint help as a 25-credit PNG overlay, with Accept/Reject and "Clear feedback") has been removed along with `/api/generate-solution`, `/api/generate-worksheet`, `/api/ocr` and `/api/check-help-needed`. Boards saved while it existed may still carry its overlays (`meta.aiOverlay`); on load an undecided suggest/answer overlay is dropped and the rest are unlocked so the student can delete them like any image (`dropPendingAiOverlays`, `src/hooks/useAiOverlayShapes.ts`).

### 2. Autosave

Every change schedules a save ~2 s later: the whole tldraw snapshot is written to `whiteboards.data` via Supabase JS. RLS restricts the write to the owner. A trigger bumps `version` and copies the snapshot into `whiteboard_snapshots` (last 20 kept). A thumbnail is written to `preview` only when small enough. The snapshot contains only asset *URLs* (see flow 2b); a client refuses to autosave a snapshot above `SNAPSHOT_LIMITS.hardBytes` (4 MB) until its inline assets are offloaded, and the database rejects anything above 8 MB (`whiteboards_data_size`, `whiteboard_snapshots_data_size`, `training_samples_tldraw_snapshot_size` in `supabase/migrations/20260917010000_snapshot_size_cap.sql`).

### 2b. Assets (images) -> Storage, not the snapshot

Every image that lands on a board - pasted/dropped files, stickers, PDF pages - goes through one `TLAssetStore` passed to `<Tldraw assets={...}>` (tldraw calls `store.upload(asset, file)`; our own code calls `editor.uploadAsset(asset, file)` instead of `createAssets` with a data URL):

1. `upload()` writes the bytes to the public bucket `board-assets` at `<auth.uid()>/<boardId>/<assetId>.<ext>` (`assetObjectPath()` in `scripts/lib/snapshotAssets.mjs`; the `asset:` prefix is stripped and every segment is reduced to `[A-Za-z0-9_-]`, so no path traversal). Storage RLS only allows writes under the caller's own `uid` folder; reads are public because tldraw renders `<img src>` and the AI routes fetch the image server-side.
2. It registers the object in `public.board_assets` (`whiteboard_id`, `user_id`, `object_path` unique, `mime_type`, `bytes`, `width`/`height`, `source` in `user|ai|sticker|pdf|worksheet`) - the registry that makes garbage collection possible.
3. It returns `{ src: <public URL> }` = `<SUPABASE_URL>/storage/v1/object/public/board-assets/<path>`, which is what ends up in `props.src` of the asset record and therefore in `whiteboards.data`. Older clients read that snapshot unchanged: `src` is just a URL instead of a `data:` URL.

Boards saved before this shipped still carry `data:` URLs. They keep loading (tldraw renders data URLs fine) but stay multi-MB until `node scripts/offload-assets.mjs` (service role, see the runbook) uploads their inline assets with the same path convention and rewrites `src`. The shared pure helpers (`parseDataUrl`, `findInlineAssets`, `rewriteAssetSrcs`, `snapshotJsonBytes`, `SNAPSHOT_LIMITS`) live in `scripts/lib/snapshotAssets.mjs` and are used by both the client and the script so the two never disagree about paths or limits.

Garbage collection: deleting a board cascades `board_assets` rows but **not** storage objects (Storage has no FK to Postgres). Orphans are found by listing `storage.objects` in `board-assets` whose `name` is not in `board_assets.object_path`, or whose `<boardId>` folder no longer exists in `whiteboards`; today that is a manual query in the runbook, a scheduled job is a follow-up.

### 3. Voice tutor

`POST /api/voice/token` (JWT + rate limit) mints a short-lived OpenAI Realtime client secret and returns it; the browser opens a WebRTC session directly with OpenAI. The session registers `voiceSessionTools()` (`src/lib/live/voiceTools.ts`): `analyze_workspace` (a vision READ of the viewport via `/api/voice/analyze-workspace`, text back) plus the Live tools `read_live_math`, `place_math` and `plot_function`, which the browser runs through `runVoiceTool` against the Live controller — no network, typeset shapes only (`plot_function` still places the typeset graph card; the tutor's own graphs are sketched by hand, see "Graphs" under Live Math). An unknown tool name (e.g. `draw_on_canvas` from an older session) is answered with an error, never run. Without `OPENAI_API_KEY` the token route returns `503 voice_unavailable`.

### 4. Credits, training

- `/api/credits`: reads the OpenRouter balance for the low-credit banner.
- `/train`: trainer-only; before/after PNGs go to the `training-data` bucket and metadata to `training_samples`, both gated by `is_trainer()` in RLS.

## Data model

All tables live in `public`, have RLS enabled and no `anon` grants; `authenticated` gets exactly the privileges listed (the rest is revoked, so least privilege does not depend on RLS alone). Migrations: `supabase/migrations/*.sql` (idempotent, applied in order). Behavioural checks: `npm run db:verify` and the `RUN_DB_TESTS=1` integration tests.

| Table | Key | `authenticated` may | Written by | Notes |
| --- | --- | --- | --- | --- |
| `whiteboards` | `id` uuid, `user_id` -> `auth.users` | select/insert/update/delete own | client (autosave) | `version` bumped by trigger on `data` change; `deleted_at` soft delete; `data` capped at 8 MB |
| `whiteboard_snapshots` | `(whiteboard_id, version)` | select/insert own | trigger `whiteboards_record_snapshot` | last 20 versions per board |
| `board_assets` | `object_path` unique | select/insert/update/delete own (insert/update also require owning the board) | client asset store | registry of Storage objects for GC |
| `user_settings` | `user_id` | select/insert/update own | client (feature labs) | |
| `bug_reports` | `id` | insert own (or `user_id` null) | client | never readable back; `user_id` set null on account deletion |
| `trainers` | `user_id` | select own row | SQL only | drives `is_trainer()` |
| `training_samples` | `id` | select/insert own, trainers only | `/train` | objects in bucket `training-data` |
| `plans` | `id` text (`free`, `plus`, `pro`) | select | migration seed / SQL | `monthly_credits`, `price_cents`, `features`, `sort`, `active`; numbers are placeholders |
| `profiles` | `user_id` -> `auth.users` | select own; update own **`display_name` only** (column-level grant, `PATCH {plan_id}` -> `42501`) | trigger `on_auth_user_created` (row per sign-up, `plan_id='free'`), billing webhook (service role), SQL | `plan_id` -> `plans`, `billing_customer_id`, `billing_subscription_id`, `billing_status`, `current_period_end` |
| `usage_events` | `id` identity, `(user_id, created_at)` index | select own | `consume_credits()` only | one row per metered API call: `route`, `units` (> 0), `model`, `request_id` |
| `credit_grants` | `id` identity | select own | webhook / SQL | extra credits for the month of `created_at`; negative = correction |
| `billing_events` | `id` text (provider event id) | nothing | webhook (service role) | idempotency log: duplicate deliveries hit the PK |
| `rate_limit_counters` | `(user_id, bucket, window_start)` | nothing (function-only; RLS on, no policies) | `rate_limit_hit()` only | fixed-window hit counter shared by every server instance: `hits`, `expires_at` (= `window_start` + 2 windows; expired rows are removed by the next call). No FK to `auth.users` on purpose: rows age out within two windows |

Credits: the balance for the current UTC calendar month is `plans.monthly_credits + granted - used`, clamped at 0, computed on every call (no stored counter to drift). Five `security definer` RPCs are the only way a user token touches the ledger or the rate-limit table, each callable by `authenticated` only and each acting on `auth.uid()`:

| RPC | Returns | Behaviour |
| --- | --- | --- |
| `credit_summary()` | `{plan_id, plan_name, monthly_credits, used, granted, remaining, period_start, period_end}` | Read-only; falls back to plan `free` if the profile row is missing |
| `consume_credits(p_route, p_units, p_request_id?, p_model?)` | `{ok, remaining, reason}` | Locks the caller's `profiles` row `FOR UPDATE` (parallel calls serialize, never overspend); `p_units` 1..1000 else `400`; `ok:false, reason:'insufficient_credits'` writes nothing; otherwise inserts one `usage_events` row |
| `refund_credits(p_request_id)` | `{refunded, remaining}` | Deletes the caller's own `usage_events` rows with that `request_id` **created in the last 15 minutes** (same profile lock as `consume_credits`); `refunded` = credits (sum of `units`) removed, 0 for an unknown id, another user's id or an older row; idempotent; `p_request_id` 1..100 chars else `400`. Migration `20260917030000_refunds_ratelimit.sql` |
| `rate_limit_hit(p_bucket, p_limit, p_window_ms)` | `{allowed, remaining, retry_after_ms, backend:'db'}` | Fixed window aligned to the Unix epoch, keyed `(auth.uid(), p_bucket, window_start)`; one atomic `insert ... on conflict do update set hits = hits + 1`, so exactly `p_limit` parallel calls per window are allowed; `retry_after_ms` = ms until the window ends (0 when allowed); `p_limit` 1..1,000,000 and `p_window_ms` 1..86,400,000 else `400`. Cleans the caller's expired rows for the bucket on every call and, on ~2% of calls, everyone's |
| `delete_own_account()` | void | Deletes the caller's `auth.users` row; every table above cascades (`bug_reports` keeps anonymised rows). Storage objects are not touched - see the runbook, section 13, for why and for the GC path |

Storage: bucket `board-assets` (public read, owner-folder writes, `<uid>/<boardId>/<assetId>.<ext>`) and `training-data` (private, trainers, `<uid>/<sampleId>/...`). `storage.objects` has no FK to `auth.users`; ownership is the first path segment, and objects are only ever deleted through the Storage API.

## Routes

Every handler under `src/app/api/**` follows the same preamble: `requireUser` (JWT) -> `checkRateLimitDistributed` (per-user budget from `LIMITS` in `src/lib/server/rate-limit.ts`, counted in Postgres by the `rate_limit_hit` RPC so one budget holds across every server instance; see "Rate limiting" below) -> `parseJsonBody` (zod) -> `enforceCredits` (credit metering, see "Billing" below; only on routes with a non-zero cost) -> the paid work inside `runCharged` / `runChargedStream`, which refund the charge when the call fails (see "Refunds"). The Live routes get the same steps from `livePreamble` + `enforceCredits` and additionally echo a `X-Request-Id` header. The table is the source of truth mirrored by `scripts/lib/routes.mjs`; `src/__tests__/routeProtection.test.ts` fails when a route file is added, removed, or drops one of the helpers, `src/lib/server/__tests__/routes.refunds.test.ts` fails when a charged route stops refunding or a user route falls back to the per-instance limiter, and `scripts/live-smoke.mjs` probes every row over HTTP (401 without a token, 200 for the public route, a 429 on `/api/credits` carrying `backend: 'db'` when the RPC exists).

| Path | Methods | Auth | Limit (per min) | Credits | Body schema | Purpose | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/config/status` | GET | **public** (reason: booleans-only setup status) | `ip:<x-forwarded-for>:configStatus` 60 | 0 | none | Which provider keys are configured, booleans only; needed by the setup screen before sign-in | active |
| `/api/billing/webhook` | POST | **public** (reason: signature-verified provider webhook) | `ip:<x-forwarded-for>:billingWebhook` 120 | 0 | raw text, `Stripe-Signature` verified, then zod `{ id, type, data.object }` | Plan changes from the billing provider via the service role; `400 invalid_request "bad signature"` without a valid signature, `503 feature_unavailable` without `STRIPE_WEBHOOK_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` | active |
| `/api/admin/gc` | GET, POST | **public** (reason: Vercel cron; requires `Authorization: Bearer CRON_SECRET`, compared in constant time) | `ip:<x-forwarded-for>:adminGc` 10 | 0 | none (a Vercel cron invocation collects; a manual request reports unless `?dryRun=0`) | Storage garbage collection via the service role: orphaned `board-assets` / `training-data` objects older than 24 h (same planner as `scripts/gc-storage.mjs`); `401 unauthorized` without a matching bearer, `503 feature_unavailable` without `CRON_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` | active |
| `/api/credits` | GET | `requireUser` | `credits` 30 | 0 | none | OpenRouter balance for the low-credit banner (30 s shared cache) | active |
| `/api/live/recognize` | GET, POST | `requireUser` / `livePreamble` | `liveRecognize` 120 | GET 0; POST 1 | GET none; POST `RecognizeRequestSchema` | GET capabilities + warmup; POST strokes -> LaTeX (Mathpix, vision fallback) | active |
| `/api/live/check` | POST | `livePreamble` | `liveCheck` 30 | 3 | `CheckRequestSchema` (optional `crop` data:image ≤ 280 KB, only with `userAsked` + `focusLineId`) | SSE annotations for recognized lines; with `crop` ("Ask about this") the crop goes to the check model as an image part | active |
| `/api/live/solve` | POST | `livePreamble` | `liveSolve` 10 | 10 | `SolveRequestSchema` | SSE worked-solution steps | active |
| `/api/live/setup` | POST | `livePreamble` | `liveSetup` 10 | 2 | `SetupRequestSchema` (`lines` 0–40 strings; optional `crop` data:image ≤ 280 KB and `labels` ≤ 40, labels only with a crop; lines or a crop required) | A word problem → `{ lines, unknown?, model, ms }`: LaTeX assignments / equations only (no arithmetic, no words), which the client's engine then solves. `openai/gpt-5.4-mini`, fallback `deepseek/deepseek-v4.1-flash` (`LIVE_MODEL_SETUP`). With a `crop` it is a hand-drawn **figure** the student asked about: same reply, read by `google/gemini-3.1-flash-lite`, fallback `anthropic/claude-haiku-4.5` (`LIVE_MODEL_FIGURE`, prompt `prompts/figure.ts`). A reply with no lines is a 502 (refunded) | active |
| `/api/live/reread` | POST | `livePreamble` | `liveReread` 30 | 1 | `RereadRequestSchema` (`crop` data:image ≤ 280 KB, Mathpix's `latex`, the column's `above` / `below`) | The second reader: one suspicious line's ink crop → `{ latex, changed, model, ms }`. `google/gemini-3.1-flash-lite`, fallback `anthropic/claude-haiku-4.5` (`LIVE_MODEL_REREAD`). Only sent on a signal, at most once per ink | active |
| `/api/voice/token` | POST | `requireUser` | `voiceToken` 6 | 0 | none (empty body; model fixed server-side) | Mint an ephemeral OpenAI Realtime client secret; `503 voice_unavailable` without `OPENAI_API_KEY` | active |
| `/api/voice/analyze-workspace` | POST | `requireUser` | `analyzeWorkspace` 30 | 3 | `{ image, focus? }` | Voice tutor tool: describe the current canvas | active |

Notes:

- Non-Live routes mint a `requestId` for their log lines but do not return it as a header; only `/api/live/*` sets `X-Request-Id` (via `withRequestId`). Extending the header to the other routes is a follow-up, not a contract today.
- Rate limiting. User-keyed buckets go through `checkRateLimitDistributed({ token, userId, bucket })`: with `RATE_LIMIT_BACKEND=db` (the default) it calls `rate_limit_hit(p_bucket, p_limit, p_window_ms)` as the user — a fixed window keyed `(auth.uid(), bucket, window_start)` in `rate_limit_counters`, incremented with one atomic upsert, so exactly `limit` calls per window succeed no matter how many instances or parallel requests. When the RPC is missing or errors, the call degrades to the in-memory sliding window (`checkRateLimit`, key `${userId}:${bucket}`, logged once per process) — a weaker limiter, never an open gate; `RATE_LIMIT_BACKEND=memory` selects that limiter outright. The two public routes have no user, so they always key the in-memory limiter on the first hop of `x-forwarded-for` (falling back to `x-real-ip`, then `unknown`). A 429 keeps `{ error: 'rate_limited', message, retryAfterMs }` + `Retry-After` and additionally reports `backend: 'db' | 'memory'`.
- No route reads `process.env` directly; provider keys come from `getServerEnv()` (`src/lib/env.ts`) or `src/lib/aiConfig.ts`, which both reject `.env.example` placeholder values.
- Deprecated routes stay on their paths with the same contract until a documented removal; marking them deprecated here (and in `scripts/lib/routes.mjs`) is the only change. Removed (with the image pipeline): `/api/generate-solution`, `/api/generate-worksheet`, `/api/ocr`, `/api/check-help-needed` — their `usage_events` rows keep their route keys and read as "(retired)" on the account page.
- The "Credits" column is `ROUTE_COSTS` in `src/lib/server/billing.ts`; a route with a non-zero cost calls `enforceCredits` and can answer `402 credits_exhausted` or `503 feature_unavailable` before its provider call. The charge is refunded when the provider call then fails (non-streaming: any non-2xx; SSE: failure before the first annotation/step) — see "Refunds" under Billing.
- The two public routes are allow-listed in `PUBLIC_ROUTES` with a reason in `PUBLIC_ROUTE_REASONS` (`scripts/lib/routes.mjs`); `routeProtection.test.ts` additionally asserts that the webhook reads the raw body (`req.text()`, never `req.json()`) and calls `verifyStripeSignature` — the real invariant behind its public status.

## Billing

Credits are the unit; the schema is `supabase/migrations/20260917020000_accounts_billing.sql` (operator side: `docs/RUNBOOK-supabase.md`).

- **Balance.** Each `profiles` row has a `plan_id` (`plans.monthly_credits`; placeholder numbers today: free 300, plus 3000 at $9, pro 12000 at $29). For the current calendar month (UTC) `remaining = monthly_credits + credit_grants − usage_events`. The client reads it with the RPC `credit_summary()`.
- **Metering runs as the user.** `requireUser` now also returns the verified access token; `enforceCredits({ token, route, requestId, model })` (`src/lib/server/billing.ts`) builds a supabase-js client with the anon key + `Authorization: Bearer <token>` and calls the SECURITY DEFINER RPC `consume_credits(p_route, p_units, p_request_id, p_model)`. The function locks the caller's profile row, checks the balance and appends a `usage_events` row atomically, so parallel requests cannot overspend; it returns `{ ok: false, reason: 'insufficient_credits', remaining }` without writing when short. A user can only spend their own credits and no API exposed to `authenticated` can add credits or change a plan (column-level grants: a user may update `display_name` only).
- **Placement.** After auth + rate limit + body validation and **before** the upstream call, for every route — including the SSE routes (`check` / `solve`), where a refusal is a JSON `402` instead of a stream. Charging up-front keeps the balance check atomic (no window between "check" and "spend"); what the provider then fails to deliver is given back by a refund.
- **Refunds.** `refundCredits({ token, requestId })` calls the SECURITY DEFINER RPC `refund_credits(p_request_id)` as the user (migration `20260917030000_refunds_ratelimit.sql`): it deletes the caller's own `usage_events` rows carrying that `request_id` and younger than 15 minutes, and returns `{ refunded, remaining }`; it never throws (a refund that cannot happen is logged and reported as `{ refunded: 0, reason }`), and with `BILLING_ENFORCE=0` it does nothing because nothing was charged. The `requestId` refunded is the very one passed to `enforceCredits` (asserted per route by `routes.refunds.test.ts`). Two wrappers apply it: non-streaming routes (`voice/analyze-workspace`, `live/recognize` POST, `live/setup`, `live/reread`) run their provider call inside `runCharged`, which refunds whenever the Response handed to the client is not a 2xx — `UpstreamError` (502), the provider's own `CreditsExhaustedError` (402), `recognizer_failed` (502), timeouts/aborts (500). A 2xx is never refunded. The SSE routes (`live/check`, `live/solve`) run inside `runChargedStream`, which refunds only when the stream fails **before the first annotation / step was emitted**; a failure after partial output keeps the charge (the user has the partial result and the model was paid), and the `error` frame is still sent either way.
- **Prices** (`ROUTE_COSTS`, credits per call): recognize 1, check 3, solve 10, voice analysis 3; **setup 2** — a word problem's equations, or a drawn figure's (the same route with a crop), below solve because the engine does the solving (when the setup is unusable the board then calls solve as well, 12 in all; a setup call that returns nothing is refunded); **reread 1** — the second reader reads one line again, priced like recognize. It is never asked for by the student: it fires only on a signal (a read the engine cannot read, a symbol implausible in its column, or a confidence below 0.6), at most once per ink, which on the handwriting scoreboard is 17 of 20 misreads and none of 704 correct reads — so in practice a few percent of lines at most. At ~$0.00035 per call the credit is about the rate limit and abuse, not cost.
- **Responses.** `402 { error: 'credits_exhausted', message, remaining, upgradeUrl }` (`upgradeUrl` is `NEXT_PUBLIC_BILLING_LINKS.portal` or `/account`). When metering is enforced but the RPC is missing or the database errors, the route fails closed with `503 feature_unavailable` ("Billing is not set up on this deployment — run the migrations."). `BILLING_ENFORCE=0` skips consumption entirely (logged once per process) — a dev/staging escape hatch, never for production.
- **Plan changes** happen only through `POST /api/billing/webhook` (service role) or SQL. The webhook is Stripe-compatible without a payment SDK: `Stripe-Signature: t=…,v1=…` is HMAC-SHA256 over `${t}.${rawBody}` with `STRIPE_WEBHOOK_SECRET`, 5-minute tolerance, constant-time compare, Web Crypto only (`src/lib/server/webhookSignature.ts`). Every event id is inserted into `billing_events` first (duplicate -> `200 { received: true, duplicate: true }`), then `mapBillingEvent` (pure) turns the event into a `profiles` patch:
  `checkout.session.completed` -> `client_reference_id` (our user id) gets `plan_id` (from `metadata.plan_id`, else `BILLING_PRICE_MAP[price id]`), `billing_customer_id`, `billing_subscription_id`, `billing_status = 'active'`;
  `customer.subscription.updated` -> matched on `billing_subscription_id`: `billing_status`, `current_period_end`, and `plan_id` when the price is in `BILLING_PRICE_MAP`;
  `customer.subscription.deleted` -> `plan_id = 'free'`, `billing_status = 'canceled'`; anything else -> `200 { received: true, ignored: true }`. A failed profile update deletes the `billing_events` row again and answers `500` so the provider retries. The raw payload is only ever logged at `debug`.
- **Checkout links** come from `NEXT_PUBLIC_BILLING_LINKS` (`{"plus": url, "pro": url, "portal": url}`); without them the plans UI shows disabled "Coming soon" buttons.

## Error contract

Every route returns JSON `{ error: <code>, message: <text> }` on failure:

| Status | `error` |
| --- | --- |
| 400 | `invalid_request` |
| 401 | `unauthorized` |
| 402 | `credits_exhausted` (+ `remaining`, `upgradeUrl`) |
| 429 | `rate_limited` (+ `Retry-After` header) |
| 502 | `upstream_error` |
| 503 | `voice_unavailable`, `feature_unavailable` |
| 500 | `internal_error` |

The client maps `unauthorized` to a redirect to `/login`, `rate_limited` to a retry hint, and `credits_exhausted` to the credits banner / account page (`upgradeUrl`).

## Security model

- **Server-side JWT verification on every route.** `authedFetch` sends the Supabase access token; each handler calls `requireUser`, which verifies the token against the project's Supabase Auth (`auth.getUser(token)`) and rejects with `401 unauthorized` otherwise. Route handlers never trust user ids from the body.
- **Per-user rate limits.** Each user route has a per-user budget (`LIMITS`) counted in the database by `rate_limit_hit` and shared across instances, with the in-memory sliding window as fallback; exceeding it returns `429` with `Retry-After`. Together with up-front metering plus refunds this bounds provider spend per account.
- **Input validation.** Request bodies are parsed with zod; image payloads have size caps; unknown models are rejected.
- **Provider keys stay on the server.** Only `NEXT_PUBLIC_*` variables are exposed to the bundle. `SUPABASE_SERVICE_ROLE_KEY` is used by exactly two request paths, neither of them user-facing — `POST /api/billing/webhook`, after the provider signature has been verified, and `GET|POST /api/admin/gc`, after the `CRON_SECRET` bearer has matched — and by admin scripts (`scripts/offload-assets.mjs`, `scripts/gc-storage.mjs`); user-facing routes act as the user (their own JWT), never as the service role.
- **Row Level Security.** All tables have RLS enabled, `anon` has no grants, and policies compare `user_id` with `auth.uid()`. Storage policies restrict writes to the caller's own folder (`<uid>/...`). Trainer features are gated by the `trainers` table via `is_trainer()`, not by client-side checks.
- **Boundaries.** `error.tsx` / `global-error.tsx` catch render errors without leaking stack traces; `X-Powered-By` is disabled; the site is `noindex` while in staging.

## Known limitations

- **Rate-limit fallback is per instance.** User buckets are counted in Postgres (`rate_limit_hit`), but when that RPC is unavailable — or with `RATE_LIMIT_BACKEND=memory` — the limiter degrades to the in-process sliding window, where each Vercel function instance has its own counters (effective limit `limit x instances`, reset on cold start). The public IP-keyed buckets (`config/status`, `billing/webhook`) always use that in-memory limiter. Refunds add one extra RPC on every failed paid call; a refund older than 15 minutes is refused by design.
- **Legacy boards may still embed base64 assets.** New images go to the `board-assets` bucket (flow 2b), but boards saved before that shipped keep `data:` URLs in `whiteboards.data` until `scripts/offload-assets.mjs` has run. Until then those rows stay multi-MB and, if they exceed the 8 MB cap added in `20260917010000_snapshot_size_cap.sql`, cannot be saved at all. Storage objects are not garbage-collected automatically when a board is deleted (see runbook section 12).
- **Voice depends on `OPENAI_API_KEY`.** No key (or a revoked one) disables the voice tutor entirely; the rest of the app is unaffected.
- **Handwriting OCR is optional.** Without Mathpix the vision model reads the raw image, which is noticeably worse on dense handwriting.
- **Single-user boards.** There is no sharing or realtime collaboration; a board has exactly one owner and the last writer wins across tabs (the `version` column enables optimistic concurrency but the client does not use it yet).

## Live Math flow

```
pen-up (draw.isComplete false→true, source 'user')
  → quiet gate 600 ms (450 ms on rewrite)      src/lib/live/liveLoop.ts (a stroke plainly a drawing does not push it back)
  → splitInk → drawings (+ marks, labels) out   diagrams.ts: only handwriting goes on
  → clusterLines(writing) → InkLine[]           strokeClusters.ts (union-find, fraction bars, columns)
  → buildPayload → normalized ints + sha-1      strokePayload.ts (cache hit → skip network)
  → POST /api/live/recognize                    Mathpix v3/strokes ▸ vision fallback
  → engine.analyzeLine (mathjs, offline)        src/lib/live/engine/**
  → policy.decide(mode, verdict, voice, settled) policy.ts (silence rules, hint ladder)
  → placement → scheduleLiveWrite(createShapes) math shapes / the tutor's strokes, meta.live
  → syncGraph(column): engine.graphFor → the column's graph kept in step (Solve, settled; or asked)
  → (rereadTrigger fires) crop → POST /api/live/reread   readCheck.ts; once per ink hash
      → acceptReread ? replace the read (provider 'reread'), re-analyse, re-render
  → (ladder permits) POST /api/live/check|solve SSE: meta → annotation*/step* → done

Solve / Help on a column
  → localSolve (engine only)                    localSolve.ts → written by hand, no network
  → engine.graphFor(column + steps) → planGraph graphing/ → sketched beside the steps, after them
  → a drawing beside it? POST /api/live/setup + crop   "the tutor reads the figure" (below)
      → validateSetupLines → localSolve(setup) → setup + steps by hand under the work
  → word problem? POST /api/live/setup          wordProblem.ts: validateSetupLines
      → localSolve(setup) → setup + steps written as one hand block (no solve model)
  → otherwise, or setup unusable: POST /api/live/solve (SSE) → createSolveStepGuard → one block

Solve / Help on a drawing (the last thing drawn)
  → labels (one recognize call) + crop → POST /api/live/setup → validate → engine → by hand beside it

any student ink, anywhere (incl. pen-down, drag, erase)
  → settle gate 2.5 s (ANSWER_SETTLE_MS)        liveLoop.markUnsettled → renderSettled
  → re-render only → the held-back ANSWER lands  (no re-recognition, no model call)
  → each drawing's labels read, if they changed  one POST /api/live/recognize per drawing (label stack)
```

**Dev: the Mathpix panel (`LiveDebugPanel`).** In development (or with `LIVE_DEBUG=1` on the server plus `localStorage["agathon.liveDebug"] = "1"` in the browser) `/api/live/recognize` returns the recognizer's raw JSON as `debug`, and a "Mathpix" button on the board opens a per-line view: the strokes exactly as sent, the LaTeX (raw and rendered), confidence, Mathpix's own `is_handwritten`, the engine's kind, verdict, mathjs form and solutions, and — when the second reader was asked — both reads ("mathpix read", "second reader: <latex>"), why it was asked and whether its read was used. It separates "the pen / recognizer got it wrong" from "the maths engine could not check it". Below the lines, each drawing on the screen: what it was taken for (`triangle`, `numberLine`…), how many strokes and labels, the label stack exactly as sent and the labels as read (`liveStore.diagrams`).

**Screens, not an infinite canvas (`src/lib/screens/**`).** A board is a stack of fixed 16:9
screens, one tldraw page each, whose rect lives in `page.meta.screen` (1600×900 page units). The
camera is held inside it (`cameraOptions.constraints`, `behavior: 'contain'`, `fit-max`), the strip
in the NavigationPanel slot moves between screens and adds them (cap 50), and `OnTheCanvas` draws the
whiteboard. A page saved before screens gets a screen grown (16:9) around its existing ink the first
time it is shown (`ensureScreen`). One screen is one context: `LiveLoop` listens for
`instance.currentPageId` changes and `switchScreen` drops the lines, timers and in-flight calls of the
screen left behind, then rebuilds the new one from its echoes (no re-recognition, no model call).
Placement uses the screen's edges instead of the viewport, and a block that would run off the bottom
moves beside the work (`keepOnScreen`). Within a screen, a line separated from the column above by a
blank gap of more than max(120 px, 3 × line height) starts a new column (`assignColumns`), so a
second problem further down is never checked as the next step of the first.

**No words on the board.** Everything the tutor puts on the page is maths in its animated hand (`HandWriter`, blue), a hand-drawn mark (`src/lib/live/marks.ts`) or a graph sketched in the same hand (numbers, the axis letters and coordinates only; see "Graphs" below): a tick after a step the engine verified, a ring round a wrong one (the engine's `mismatch`, or a model annotation with `verdict: warn`, remembered on the echo as `meta.aiWarnLatex`), a question mark beside ink it cannot read. There are no hint cards and no prose notes. Not even "or": several answers are a list (`x = 2, \ x = 3`, an inequality's union `x < 2, \ x > 3`), no solution is `\varnothing`, every number is `x \in \mathbb{R}` for an equation (`0 = 0`) and `-\infty < x < \infty` for an inequality, an excluded value is `x \neq 1`, a failed check is `\sqrt{4} \neq -2`. In Suggest and Solve, once the student stops (the settle), the right next step is written by hand beside a ringed line, computed by the engine from the last good line above (`suggestNextStep`); Help does it at once in any mode, and only asks the model for one step when the engine has none. The model's Solve steps are written as one handwritten block when the stream ends (typeset only if the hand lacks a symbol). The grey echo (the readback of what Mathpix read) shows only on hover, or while its ink is hovered or selected, and always when the device has the hand switched off. The dev "Mathpix" panel still shows every read.

**Marks may be immediate; answers must wait.** Two clocks, because "this line is finished" and
"the student has stopped" are different questions. `LIVE_TIMING.quietMs` (600 ms, per line) gates
recognition and everything that comments on work already done — the green check, the amber dot,
the solved chip, the note and the Feedback/Suggest hint ladder all keep that cadence.
`ANSWER_SETTLE_MS` (2.5 s, whole canvas, `liveLoop.ts`) gates every "here is the result" output:
the handwritten calculator answer, the echo's `resultLatex` and an unasked graph. Any student ink restarts it — a
stroke in progress, a finished one, ink dragged elsewhere, ink rubbed out — so writing `36 + 2 =`
and carrying on down the page produces nothing until the pen stops, and a pending answer is
**cancelled, not queued** (the timer is re-armed, so nothing lands in a rush afterwards). Settling
re-runs `render` only: it can place an answer the local engine already had, never say something
new. A bare answer is also **Solve-only** — Feedback points at mistakes and Suggest nudges, so
neither ever finishes the student's line for them (`answerAllowedHere` in `policy.ts`, backed by
the engine only filling `resultLatex` for a trailing `=` in answer mode). An explicit request
skips the wait entirely: Solve steps (`requestSolve` → `answerLineNow`), Help, a badge tap
(`requestCheck`) and the voice tools all pass `userAsked`, which bypasses the settle but not the
mode gate.

**Help (Board options → Help, `LiveController.requestHelp`).** The board's one explicit ask, on the
line touched last: in Solve it is `requestSolve`; in Feedback / Suggest it is `escalate` (the next
hint for that line). Ink Live cannot read as maths — a failed or low-confidence read, a diagram
label, a lone symbol, or prose shorter than 4 words (a doodle Mathpix read as `\text{is}` is a
picture, not a question; `needsLook` in `liveLoop.ts`) — takes the **Ask about this** path instead: the
loop captures a small JPEG crop of that line (`captureCrop`, ≤ 200 KB, the same capture the vision
recognizer uses) and sends one ordinary `/api/live/check` with `crop` set; the route passes it to the
check model (`google/gemini-3.5-flash`) as an `image_url` part, and each annotation comes back as a
muted typeset note beside the ink (`\text{…}`, wrapped into a left-aligned block past 44
characters and kept inside the screen). Pressing Solve or Help again on a line the tutor has already
worked out by hand draws nothing new (the block carries `meta.solvedLatex`). Same price as any check (3 credits). It never fires by
itself: only `requestHelp` sets a crop, and the schema refuses one without `userAsked` + `focusLineId`.
When the ink touched last is a drawing or one of its labels (not a line), Help — and Solve steps —
read the figure instead ("Drawings", below); a drawing never gets a "?".

**Graphs, sketched by hand (`engine/graphIntent.ts`, `src/lib/live/graphing/**`).** A graph is an
ANSWER, drawn by the tutor's hand in its blue, stroke by stroke, like its writing — never a card.
*What* to graph is the engine's (`LiveEngine.graphFor(lines)`, optional on the contract): the
column's lines (the student's, then any solution written under them) give a plane graph when they
hold relations in x and y — `y = f(x)` / `f(x) = …` (polynomials, `|…|`, roots, exponentials, logs,
rational functions), a line in any form (`2x + 3y = 6`), a region (`y < 2x + 1`, `2x + 3y \ge 6`),
a circle (`(x-1)^2 + (y+2)^2 = 9`, also expanded) — else a number line when the column's last
one-variable inequality is an answer (`x > 3`, `-2 \le x < 3`, `x < 2, \ x \ge 3`, `x \neq 1`,
`-\infty < x < \infty`; a later inequality that is not an answer withdraws it). Rewrites of one
relation count once (each is fingerprinted by its values, which is also the graph's `key`); two or
three different ones are a system, drawn with the points where they cross. One relation with a
value substituted (`x + y = 18`, `y = 9`, `x = ?`) is substitution, not graphing. Key points are
found numerically (roots, vertex, corners, end points, crossings, a circle's centre) and their
coordinates written only when exact (`(0, 1)`, `(-\frac{1}{2}, 0)`); an irrational one is a dot
alone. Asymptotes — where the function blows up, where it levels off — are dashed (not when they
are an axis). *How it looks* is `graphing/`: `chooseWindow` keeps every key point and the origin in
view with a margin, at least 6 units across, the same unit on both axes for lines and circles (a
slope of 2 looks like 2) and each axis its own scale otherwise, ticks every 1-2-5 × 10ⁿ;
`planGraph` draws axes with arrowheads and their letters, tick marks, numbers written by
`layoutMath` (the tutor's digits), dashed asymptotes, the curves (sampled every 1.5 px, refined
where they move fast, broken at asymptotes, clipped to the box; a strict inequality's boundary
dashed), light 45° hatching on the shaded side (across the boundary, clear of every number), the
dots, then the coordinates placed where they collide with nothing. A number line has arrows both
ways, numbered ticks, and the answer above it: an open circle for an end point left out, a filled
one for one included, a segment or a ray with an arrow. The sketch is one `HandPlan` whose lines are
its parts in that order, paced to ~4–6 s (`graphPaceFor`); `placeGraphBlock` puts it beside the
work (right of the column, level with its top), else under the work and any solution, sliding past
whatever is there, inside the screen — and draws nothing rather than over ink (a smaller sketch is
tried first). *When*: in Solve, once the student has stopped (`renderSettled` → `drawWantedGraphs`,
one column at a time), or at once on Solve / Help, where Solve writes the steps under the work and
the graph beside them after the steps (`HandWriter` `delayMs`); `y = 2x + 1` has no steps and its
graph is the whole answer, so no model is asked. In Feedback / Suggest only Help draws it, and there
the graph is the help (a line the engine calls wrong gets its next step instead). Every stroke
carries `meta.graphFor` = the key: a graph already on the page is not drawn twice, a column whose
maths changed loses its graph at once (`syncGraph` on every render), a sketch cut short by the
student's pen is completed whole (`HandWriter` `whole`), and one the student rubs out is not drawn
again unasked (the key is kept on the echo as `meta.graphDismissed`, so a reload agrees); asking
brings it back. With the hand switched off, a function graph falls back to the typeset `graph` card
(a region, circle or number line has no typeset form). The card no longer appears by itself beside
every `y = …` line; its shape util stays registered so boards that have one still load, and those
cards stay where they are. What the sketches look like: `docs/graph/gallery.png`
(`GRAPH_GALLERY=1 npx vitest run src/lib/live/graphing/__tests__/gallery.test.ts`); on the real
board, `docs/qa-screenshots/graph-solve-system.png` (Solve on a system: steps under, graph beside)
and `graph-help-feedback.png` (Feedback: nothing unasked, Help sketches the parabola). Numbers are
written at 30–34 px and every glyph resampled to 2 px like the worked steps — tldraw's freehand
smoothing otherwise collapses a small `4` into a `1`.

**Word problems: the model sets up, the engine solves.** Mathpix returns prose as `\text{…}` and
the engine classifies it `kind: 'text'` (silent: no echo). A column down to the asked-for line that
has a line of prose reading like a sentence (≥ 4 words, `isProblemProse` in
`src/lib/live/wordProblem.ts`) is a word problem. When the local paths have nothing (`localSolve`
skips a prose target), `LiveLoop.startSetup` sends the column's lines to `POST /api/live/setup`
(2 credits), whose model — `openai/gpt-5.4-mini`, fallback `deepseek/deepseek-v4.1-flash`; prompt
`src/lib/server/prompts/setup.ts`, adapted from the model bench's job 1, where every model scored
24–25/25 — returns only the maths a student would write under it: `v = \frac{150}{2.5}`, or
`n + d = 25`, `5n + 10d = 185`; no arithmetic done, no words, one short letter per quantity. The
client trusts none of it: `validateSetupLines` requires every line to be maths the engine reads
(`x = ?` included), with no words, and every letter to be one the setup introduces (an assignment's
name, an equation's unknowns) or the problem already uses. Then `localSolve` solves the setup, and
the tutor writes the setup followed by the engine's steps as ONE block under the problem, by hand
(`drawStepsByHand`; typeset when the hand lacks a glyph or is off). The block's `meta.solvedLatex`
is the problem itself (`wordProblemKey`), so pressing Solve again draws nothing new and costs
nothing. More help in Feedback / Suggest writes the first setup line only. When the setup call
fails, the lines do not validate, or the engine cannot solve them, the board falls back to
`/api/live/solve` exactly as before: its prompt treats text lines as the question and asks for
assignment steps, which `createSolveStepGuard` accepts because an assignment defines its own
symbol. Signed out, out of credits or rate limited on the setup shows that error and stops (solve
would answer the same); offline defers the solve as before.

**The second reader (messy ink).** Mathpix misreads about 3 % of lines, and its confidence is no
guide (`a = 2` came back as `0=2` at 0.99). After a line's read has been rendered,
`rereadTrigger` (`src/lib/live/readCheck.ts`) decides whether it looks wrong: (a) the engine
cannot read a line that looks like maths (not a construct it reads and declines — an integral it
cannot do, a matrix, `\frac{dy}{dx}` without its definition — and not the board's own `x = ?`);
(b) `suspiciousRead(latex, column)` finds a confusion Mathpix is known to make — a Greek letter,
`\in` or `\ell` nowhere else in the column (θ is fine with trig, and any letter a trig function
takes), a case flip of a letter that looks the same in both cases (`U` in a column that writes
`u`), a letter from nowhere in a column that is one connected problem, `o` or a bare `e` glued to
digits or a letter written before a number (`2o`, `1 e`, `x 2`), `6^{x}`, a lone digit equated to
another number (`0=5`, unless a line above cancels its unknown), a zero denominator, a zero addend
(`(0+b)`); (c) Mathpix's confidence is below 0.6, so the board would otherwise show nothing. Only
Mathpix's reads are proofread, never offline, and at most once per ink version (payload hash). On
a signal the loop captures the line's crop (`captureCrop`) and sends it with the read and the
column's other lines to `POST /api/live/reread` (1 credit; `google/gemini-3.1-flash-lite`, fallback
`anthropic/claude-haiku-4.5`; prompt `src/lib/server/prompts/reread.ts`, adapted from the bench's
job 3). `acceptReread` takes the answer only when it differs, has no words, is a transcription of
the same line (half to double the length), does not itself look misread, and the engine can read
it; then the line's LaTeX is replaced (`provider: 'reread'`, confidence raised to at least 0.6),
re-analysed and re-rendered, and the same ink read again from the recognition cache gets the
accepted read without a second call. Otherwise Mathpix's read stands; a failed call is silent. The
dev Mathpix panel shows both reads, the signal and the outcome. Measured on the handwriting
scoreboard (`docs/eval/handwriting.json`): the trigger fires on 17 of its 20 misreads and on none of
its 704 correct reads (lines above only, as the loop sees them); end to end with the production
prompt, 13 of the 20 misreads are fixed, every accepted change is a fix, and none of the bench's 20
correct-read controls is sent or changed. The two misreads the trigger cannot see are plausible
lines in their own right (`b=20-3` for `b = 2a - 3`, `\int_{1}^{6}` for `\int_{1}^{e}`).

**Drawings: kept out of the lines, read only when asked (`src/lib/live/diagrams.ts`).** Students
draw — a triangle with its sides labelled, a circle and its radius, a number line, axes with a line,
an arrow. Every stroke used to be handwriting: a triangle beside `a^2 + b^2 = c^2` was clustered into
that line (Mathpix read garbage), a drawing on its own became a line with a "?", and every label on
it a one-character line. `LiveLoop.flush` now runs `splitInk` over the screen's ink first and gives
`clusterLines` only the handwriting. The rules, all measured in G, the screen's median stroke height
(about the x-height; re-measured without strokes plainly bigger than it, capped at 30 px so a
screen with only a drawing on it has a scale):

- *By its own shape.* Under 3.5 G both ways a stroke is a glyph (a `0` is closed and a `1` straight:
  size is what makes a drawing). A long diagonal, or a stroke big both ways (a circle, a triangle in
  one stroke, a parabola), is a drawing — unless writing fills its box or sits under a long level top
  (a radical over a fraction, a long-division bracket, a box or ring round an answer). A long level or
  upright line, a tall thin stroke and a wide flat one are ambiguous: fraction bars, long `=`,
  overbars, long division, `|…|`, integral signs and big brackets look exactly like that.
- *By what is around it.* Writing evidence: writing covers half of its span on one side (gaps of a
  glyph between glyphs bridged), or fills its box. Drawing evidence, which wins even over writing:
  two long lines crossing or cornering (axes), short strokes going right through it (a number line's
  ticks, which join it), an arrowhead at an end (its barbs join it), straight sides whose ends pair
  into a closed polygon (a rectangle in four strokes), an end joined to a drawing (a triangle's base,
  a right triangle's legs, a radius). With no writing evidence a line is also a drawing when it
  touches one, has nothing within 2.5 G (the first side of a triangle, flushed before the rest), or
  is 9 G long. Anything else stays writing.
- *Marks and labels.* Drawing strokes that touch or nest are one drawing. What is left is clustered as
  before; near a drawing, a small stroke ON it (crossing it, both ends on it, or a dot on it) is a
  mark (an angle arc, a right-angle square, an open circle), and a small cluster within 2 G is a label
  (a vertex letter, a side length, `40°`, the numbers under a number line, split at gaps wider than a
  glyph) — unless it holds a relation (`=`, `<`, `>`): `x = ?` beside a triangle is a question, a
  line of maths, and keeps every stroke. From such a line only labels the clusterer ran into it are
  taken back: those inside the drawing's span with the line outside it, or one at the line's end on
  the drawing's side cut off by a gap wider than any inside the line.

Behaviour: a drawing is never recognized, never marked (no tick, ring or "?"), never joined to a
line, and does not count as writing maths — a stroke plainly a drawing (a long diagonal, a big shape)
does not push back the quiet gate of lines waiting to be read, though it restarts the settle clock
like any ink. A label that was a line of its own (written before the drawing) stops being one: its
echo and marks go. Drawings get stable ids (`dg_…`, kept while half their strokes remain) and are
rebuilt from the ink on load. **Labels are read together, once the student stops** (the settle):
ONE `/api/live/recognize` call per drawing whose labels changed, with the labels stacked one per
row, left-aligned, 0.6 of their own height apart (`labelStack`) — side by side, Mathpix read `3` and
`4` as `34` and `A B C 3 4 x` as `\text{ABC34X}` (2 of 6 label sets right); stacked, 6 of 6, and all
7 generated drawings' stacks came back one row per label (24 of 25 labels right; `O` read as `0`).
`parseLabelRead` splits the rows (a lone `\times` is the letter x). Reads are cached per label ink.

**The tutor reads the figure (only on an explicit ask).** Solve or Help when the last ink was a
drawing, or Solve on a line the engine cannot answer that is within 120 px (or 10 G) of one (`x = ?`
beside a triangle), sends a crop of the drawing and its labels (≤ 768 px wide) with the labels as
read and the column's lines to `POST /api/live/setup` (2 credits; `google/gemini-3.1-flash-lite`,
fallback `anthropic/claude-haiku-4.5`; prompt `src/lib/server/prompts/figure.ts`: the figure's own
single letters, no `\angle`, angles as plain degrees because the engine does not solve `40^{\circ}`,
Pythagoras as the equation and then the unknown as a square root so a length comes out positive,
never the arithmetic). The reply is validated exactly like a word problem's (`validateSetupLines`),
solved by `localSolve`, and written by hand as one block — beside the figure when asked on the
drawing (right of it, under it when the screen has no room), under the work when asked from a line;
the setup alone when the engine cannot take it further (it is the reading of the figure). Help in
Feedback / Suggest writes the first line of the setup only, as for a word problem.
`meta.solvedLatex` is `figureKey` (the drawing, its labels, the work beside it), so asking again
costs nothing; rubbing the drawing out removes the answer. From a line, a figure that gives nothing
falls back to the word-problem and solve paths; on the drawing, the pill says "Couldn't work this
out", with Retry. Live, in the browser: a right triangle labelled 3, 4, x → labels read `x, 3, 4` →
`x^{2} = 3^{2} + 4^{2}`, `x = \sqrt{3^{2} + 4^{2}}` (1.2–1.9 s) → the engine writes `x = 5`; a
triangle with 40° and 65° marked and x asked → `x + 40 + 65 = 180`, `x = 180 - 40 - 65` → `x = 75`.

Measured offline by the drawings scoreboard (`npm run eval:drawings`, `docs/eval/drawings.md`): 8
generated drawings × 3 sizes × 5 placements × 6 lines × 4 hands = 2880 scenes. Before, the maths
line was intact (one line of exactly its strokes) in 1689, no drawing was kept out of the lines, and
1809 lines held no maths at all; after, 2847 intact, 2880 drawings out, 18 stray lines, 8951 of 9000
labels attached. The 33 left are a label written between the line and the drawing, nearer the line.
Every corpus line in every hand (1276, plus radicals, long division, integrals, brackets, matrices,
cases) keeps every stroke as writing — the scoreboard fails otherwise. Not handled: a drawing
sketched in many short strokes (each is a glyph), a small rectangle or circle under ~3.5 G, tldraw's
own shape tools (never read as ink anyway, but their labels still are lines).

**Deterministic maths never goes through a model.** `LiveLoop.startSolve` (`src/lib/live/liveLoop.ts`) asks the local engine before it will open `/api/live/solve`: `engine.solveLatex` for a relation with an unknown (`2x + 3 = 11` → `2x = 8`, `x = 4`; linear inequalities too; quadratics, absolute value, rational, radical, exponential and log equations through `engine/advanced.ts`), `engine.solveFromLines` for a line that needs the ones above it, `engine.simplifySteps` for an expression in an unknown (`3(x+2) - x` → `= 3x + 6 - x`, `= 2x + 6`) or a derivative, integral or limit (`\frac{d}{dx}(3x^2+2x)` → `= 3 \cdot 2x + 2`, `= 6x + 2`; see "Calculus steps" below), and then `localAnswerFor` (`src/lib/live/solveSteps.ts`) for a line the engine can simply evaluate — `analyzeLine(latex, { mode: 'answer' }).resultLatex` covers a trailing `=`, units, a conversion, a derivative, an integral, a limit, a finite sum and a percentage, and `engine.calculate` covers bare arithmetic whose result the echo's calculator rule suppresses. Either way the steps are written under the student's work in the tutor's hand (`planHandwriting` + `HandWriter`), with no model, no credits and no network. An answer the hand atlas cannot draw, or a device with the handwriting switch off, is typeset locally instead of being asked for: only a line the engine has nothing to say about (an equation the CAS declines, a word problem whose setup the engine cannot solve) reaches the stream. Regression: `36 + 2 =` used to fall through `solveLatex` and be answered `= r + 9\varepsilon` by the model.

**What the local engine can and cannot do (`src/lib/live/engine/**`).** The table is the contract the tests in `engine/__tests__` hold it to. The rule behind it: the engine either produces the answer a teacher would write, or it produces none — a line it cannot do comes back `kind: 'unknown'` with an empty `resultLatex`, never an approximation presented as an answer.

| Local, with an answer | Example in → answer out |
|---|---|
| Arithmetic, exact fractions, powers, roots; mixed numbers (a whole number straight before a proper numeric fraction is their sum: `2\frac{1}{2}` is 2½, while `2\frac{x}{3}`, `2\frac{5}{3}`, `2 \times \frac{1}{2}` stay products) | `\frac{3}{4} + \frac{1}{6}` → `\frac{11}{12}`, `\sqrt{144}` → `12`, `2 \frac{1}{2} + 1 \frac{3}{4} =` → `\frac{17}{4}` |
| Logs, exponentials | `\log_{2}(8)` → `3`, `\ln(e^2)` → `2` |
| Exact trig values (`engine/trig.ts`): sin, cos, tan, sec, csc, cot at the multiples of 30° and 45° (π/6, π/4), degrees or radians, any sign or size; outside the first quadrant through the reference angle with the quadrant's sign; reciprocal functions through 1/cos etc.; several values written in, then each term, then the total. A value that does not exist is the division by zero written out and no inline answer (mathjs said tan 90° = 1.633 × 10¹⁶). Inverse functions at the special values answer in the line's unit: degrees unless π is on it. Any other angle keeps the calculator's decimal | `\sin(60^{\circ})` → `\frac{\sqrt{3}}{2}`; `\sin(210^{\circ})` → `= -\sin 30^{\circ}`, `= -\frac{1}{2}`; `\sec 60^{\circ}` → `= \frac{1}{\cos 60^{\circ}}`, `= 2`; `\tan 90^{\circ}` → `= \frac{\sin 90^{\circ}}{\cos 90^{\circ}}`, `= \frac{1}{0}`; `\sin^{-1}(\frac{1}{2})` → `30^{\circ}`; `\sin^{2} 30^{\circ} + \cos^{2} 30^{\circ}` → `= \left(\frac{1}{2}\right)^{2} + \left(\frac{\sqrt{3}}{2}\right)^{2}`, `= \frac{1}{4} + \frac{3}{4}`, `= 1` |
| Trig equations (`engine/trigEquation.ts`, through `solveLatex`): linear or quadratic in one of sin / cos / tan (the quadratic through the engine's own factoring in a placeholder unknown, back as the function), `\sin x = \cos x` through tan, sin² beside cos through sin² + cos² = 1, multiple and shifted angles (`\sin 2x`, `\cos(x - 30^{\circ})`: the argument over its own range, then x). The interval is the one written on the line (`, \ 0 \le x < 2\pi`), else one turn from 0 — degrees unless π is on the line — written as the first line. Then the reference angle (`\sin^{-1}(\frac{1}{2}) = 30^{\circ}`), the quadrants the sign allows, the list; a value out of range shows `-1 \le \sin x \le 1`. Checked: every solution holds and a scan of the interval finds no other. Exact angles only | `2\cos x - 1 = 0` → `0^{\circ} \le x < 360^{\circ}`, `2\cos x = 1`, `\cos x = \frac{1}{2}`, `\cos^{-1}\left(\frac{1}{2}\right) = 60^{\circ}`, `x = 60^{\circ}, \ x = 360^{\circ} - 60^{\circ}`, `x = 60^{\circ}, \ x = 300^{\circ}`; `2\sin^{2} x - \sin x - 1 = 0` → … `(2\sin x + 1)(\sin x - 1) = 0`, `\sin x = -\frac{1}{2}, \ \sin x = 1`, … `x = 90^{\circ}, \ x = 210^{\circ}, \ x = 330^{\circ}`; `\sin x = \frac{1}{2}, \ 0 \le x < 2\pi` → … `x = \frac{\pi}{6}, \ x = \frac{5\pi}{6}` |
| Trig identities (`engine/trigIdentity.ts`, through `simplifySteps`): double angles (the form of cos 2x that cancels best), tan / sec / csc / cot as sin and cos and back to tan, the Pythagorean identities, then the canonical form cancels; written only when it is shorter than the line, every line checked by sampling. As checks: an identity the student writes is `ok`, and a `= …` line under an expression (a proof column) is compared with the line above — a wrong rewrite is a `mismatch` | `\frac{\sin 2x}{\sin x}` → `= \frac{2\sin x \cos x}{\sin x}`, `= 2\cos x`; `1 - \sin^{2} x` → `= \cos^{2} x`; `\frac{1 - \cos 2x}{\sin 2x}` → … `= \tan x`; column `\frac{\sin 2x}{1 + \cos 2x}`, `= \frac{2\sin x\cos x}{2\cos^{2} x}` ✓, `= \frac{\sin x}{2\cos x}` ring |
| Percentages and "of" | `15\% \text{ of } 80 =` → `12` (percent answers stay decimal: `12\%` of `3` → `0.36`) |
| Units, conversions, physical constants. A word that is a function and a unit (`\mathrm{min}`, `\mathrm{sec}`) is the unit after a number, a unit or `to`, or alone at the end of the line; with its argument it is the function | `5 km/h \text{ to } m/s` → `1.389\,\mathrm{m/s}`; `2.5 \mathrm{~h} \text{ to } \mathrm{min}` → `150\,\mathrm{min}`; `\mathrm{min}(3, 5)` → `3` |
| Derivatives with teacher-style steps (`engine/calculus.ts`): power (negative, fractional, `\sqrt`), constant multiple, sum, product, quotient, chain; sin/cos/tan/sec/csc/cot, `\sin^{-1}`, `\cos^{-1}`, `\tan^{-1}`, `e^{g}`, `a^{g}`, `\ln`, `\ln\|g\|`, `\log`; second (up to fourth) derivatives, each earlier stage written under the derivatives still to take (every line equals the question); `f(x)^{g(x)}` by logarithmic differentiation. A root or a reciprocal is rewritten as a power first; the rule line shows the rule, then it is simplified, then written with positive indices | `\frac{d}{dx}(3x^2+2x)` → `= 3 \cdot 2x + 2`, `= 6x + 2`; `\frac{d}{dx}\sqrt{x}` → `= \frac{d}{dx} x^{\frac{1}{2}}`, `= \frac{1}{2}x^{-\frac{1}{2}}`, `= \frac{1}{2\sqrt{x}}`; `\frac{d}{dx}\sin(3x)` → `= \cos(3x) \cdot 3`, `= 3\cos(3x)`; `\frac{d}{dx}\frac{x}{x+1}` → `= \frac{x + 1 - x}{(x + 1)^{2}}`, `= \frac{1}{(x + 1)^{2}}`; `\frac{d^2}{dx^2} x^4` → `= \frac{d}{dx}(4x^{3})`, `= 4 \cdot 3x^{2}`, `= 12x^{2}`; `\frac{d}{dx} x^{x}` → `y = x^{x}`, `\ln y = x\ln x`, `\frac{1}{y}\frac{dy}{dx} = \ln x + 1`, `\frac{dy}{dx} = y(\ln x + 1)`, `= x^{x}(\ln x + 1)` |
| `\frac{dy}{dx}`, `y'`, `f'(x)`, `f''(x)`, `f'(2)` under a definition on a line above (`solveFromLines`); under a relation in x and y with no `y = …`, implicit differentiation (H_x + H_y y' = 0, collected, then alone) | `y = 3x^2 + 2x`, `\frac{dy}{dx}` → `= 3 \cdot 2x + 2`, `= 6x + 2`; `f(x) = x^3`, `f'(2) =` → `f'(x) = 3x^{2}`, `f'(2) = 3 \cdot 2^{2}`, `= 12`; `x^{2} + y^{2} = 25`, `\frac{dy}{dx}` → `2x + 2y\frac{dy}{dx} = 0`, `2y\frac{dy}{dx} = -2x`, `\frac{dy}{dx} = -\frac{x}{y}` |
| Indefinite integrals, term by term, `+ C`: `x^n` (n ≠ -1, negative, fractional, `\sqrt`), `\frac{1}{x}` → `\ln\|x\|`, `e^{kx}`, `\sin(kx)`, `\cos(kx)`, `\sec^2(kx)`, `a^{kx}`, and `(ax+b)^n` / `\frac{1}{ax+b}` by the reverse chain rule; a product of polynomials is expanded first | `\int 3x^2 dx` → `= 3 \cdot \frac{x^{3}}{3} + C`, `= x^{3} + C`; `\int \sqrt{x} dx` → `= \int x^{\frac{1}{2}} \, dx`, `= \frac{x^{\frac{3}{2}}}{\frac{3}{2}} + C`, `= \frac{2}{3}x^{\frac{3}{2}} + C`; `\int \frac{1}{2x+1} dx` → `= \frac{1}{2}\ln\|2x + 1\| + C` |
| Integration techniques (`engine/integration.ts`, tried only when the term-by-term rules have nothing, checked the same way): substitution with u and du written (`u = x^{2} + 1`, `du = 2x \, dx` stand on their own lines), the integral in u, back to x; by parts with the formula, u and dv, du and v, then uv - ∫v du (logs and inverse trig are u, else a power of x beside e / sin / cos); sin², cos² by the double angle, tan² by sec², tan and cot through sin/cos and a substitution; `\frac{1}{x^{2} + a^{2}}` → tan⁻¹, `\frac{1}{\sqrt{a^{2} - x^{2}}}` → sin⁻¹; partial fractions over distinct rational linear factors (decomposition, cleared identity, cover-up values, logs). `\ln\|g\|` is `\ln(g)` where g is always positive | `\int 2x(x^{2}+1)^{5} dx` → `u = x^{2} + 1`, `du = 2x \, dx`, `= \int u^{5} \, du`, `= \frac{u^{6}}{6} + C`, `= \frac{(x^{2} + 1)^{6}}{6} + C`; `\int x e^{x} dx` → `\int u \, dv = uv - \int v \, du`, `u = x, \ dv = e^{x} \, dx`, `du = dx, \ v = e^{x}`, `= xe^{x} - \int e^{x} \, dx`, `= xe^{x} - e^{x} + C`; `\int \sin^{2} x \, dx` → `= \int \frac{1 - \cos(2x)}{2} \, dx`, … `= \frac{x}{2} - \frac{\sin(2x)}{4} + C`; `\int \frac{1}{x^{2}-1} dx` → `\frac{1}{(x - 1)(x + 1)} = \frac{A}{x - 1} + \frac{B}{x + 1}`, `1 = A(x + 1) + B(x - 1)`, `A = \frac{1}{2}, \ B = -\frac{1}{2}`, … `= \frac{1}{2}\ln\|x - 1\| - \frac{1}{2}\ln\|x + 1\| + C` |
| Definite integrals exactly through the antiderivative (values may be `\ln 2`, `e^{2} - 1`, `\pi`, `\frac{\sqrt{3}}{2}`), refused across a pole or a root of a negative; Simpson (1000 panels, 4 s.f.) only where no antiderivative is known | `\int_0^2 3x^2 dx` → `= \left[x^{3}\right]_{0}^{2}`, `= 8 - 0`, `= 8`; `\int_0^{\pi} \sin x \, dx` → `= \left[-\cos x\right]_{0}^{\pi}`, `= 1 - (-1)`, `= 2`; `\int_0^1 e^{x^2} dx =` → `1.463`. With a technique: a substitution changes the limits (`\int_{0}^{1} 2x(x^{2}+1)^{5} dx` → … `= \int_{1}^{2} u^{5} \, du`, `= \left[\frac{u^{6}}{6}\right]_{1}^{2}`, `= \frac{32}{3} - \frac{1}{6}`, `= \frac{21}{2}`); parts keeps `\left[uv\right]_a^b - \int_a^b v \, du`; `\int_{0}^{1} \frac{1}{1 + x^{2}} dx` → `= \left[\tan^{-1} x\right]_{0}^{1}`, `= \frac{\pi}{4} - 0`, `= \frac{\pi}{4}` |
| Limits: direct substitution where defined (exact, incl. roots, trig at multiples of π/6 and π/4, `e`, `\ln`); 0/0 in a rational function factored and cancelled; rational functions at ±∞ by dividing by the highest power of the denominator; `\frac{\sin kx}{x}`, `\frac{\tan kx}{x}`, `\frac{x}{\sin kx}`, `\frac{1 - \cos x}{x}` at 0; other 0/0 (`engine/limits.ts`): a square root beside a number by the conjugate (multiplied out, cancelled, substituted), anything else by L'Hôpital (top and bottom differentiated, at most three times) | `\lim_{x \to 2}\frac{x^2-4}{x-2}` → `= \lim_{x \to 2} \frac{(x - 2)(x + 2)}{x - 2}`, `= \lim_{x \to 2} (x + 2)`, `= 4`; `\lim_{x \to \infty}\frac{3x^2+1}{2x^2-x}` → `= \lim_{x \to \infty} \frac{3 + \frac{1}{x^{2}}}{2 - \frac{1}{x}}`, `= \frac{3 + 0}{2 - 0}`, `= \frac{3}{2}`; `\lim_{x \to 0}\frac{\sqrt{x+4}-2}{x}` → `= \lim_{x \to 0} \frac{(\sqrt{x + 4} - 2)(\sqrt{x + 4} + 2)}{x(\sqrt{x + 4} + 2)}`, `= \lim_{x \to 0} \frac{x + 4 - 4}{x(\sqrt{x + 4} + 2)}`, `= \lim_{x \to 0} \frac{1}{\sqrt{x + 4} + 2}`, `= \frac{1}{\sqrt{0 + 4} + 2}`, `= \frac{1}{4}`; `\lim_{x \to 0}\frac{1 - \cos x}{x^{2}}` → `= \lim_{x \to 0} \frac{\sin x}{2x}`, `= \lim_{x \to 0} \frac{\cos x}{2}`, `= \frac{\cos 0}{2}`, `= \frac{1}{2}` |
| Checking calculus the student wrote: a derivative, definite integral, limit or evaluation bracket `\left[F\right]_a^b` is compared by value; an antiderivative is differentiated back (so one the engine could not find itself is still checked) and must carry its constant | `\int 2x \, dx = x^2 + C` ✓, `= x^2` ring, `\int x e^{x} dx = x e^{x} - e^{x} + C` ✓, `\lim_{x \to 2}\frac{x^2-4}{x-2} = 2` ring |
| Finite sums `\sum_{i=a}^{b}` (integer limits, ≤ 10 000 terms) | `\sum_{i=1}^{10} i =` → `55`, `\sum_{i=1}^{3} \frac{1}{i} =` → `\frac{11}{6}` |
| Single-variable equations (exact where a method below applies, else numeric), step equivalence, chemistry balancing. Several answers are a list, never joined by a word: `x = 2, \ x = 3` (a comma and a space the hand draws); only real roots are answers, none is `\varnothing`. A numeric root that is a whole number or a simple fraction at which both sides agree to the last bit is written with `=`, never `\approx` | `x^3 + x - 1 = 0` → `x \approx 0.6823`; `x^x = 4` → `x = 2` |
| Linear equations in one unknown, teacher-style steps (`engine/algebra.ts`): brackets expanded, fractions cleared by the LCD (not when the unknown is already alone: `x = \frac{1}{2} + \frac{1}{3}` → `x = \frac{5}{6}`), like terms collected, unknowns moved left and numbers right, then `ax = b` and an exact `x = b/a`. A line identical to the one before (or to the input) is never written twice; decimals stay on the CAS path and are worked in decimals (`0.2x - 1 = 0.6` → `0.2x = 1.6`, `x = 8`). An unknown that cancels ends at the false or true statement and the set it means: `\varnothing`, or every number `x \in \mathbb{R}` | `3(x+2) = 21` → `3x + 6 = 21`, `3x = 15`, `x = 5`; `\frac{x}{2} + 3 = 7` → `x + 6 = 14`, `x = 8`; `5x - 3 = 2x + 9` → `5x - 2x = 9 + 3`, `3x = 12`, `x = 4`; `3x + 7 = 3x - 2` → `3x - 3x = -2 - 7`, `0 = -9`, `\varnothing`; `2(x + 3) = 2x + 6` → `2x + 6 = 2x + 6`, `2x - 2x = 6 - 6`, `0 = 0`, `x \in \mathbb{R}` |
| Linear inequalities (`<`, `>`, `\le`, `\ge`), the same steps; dividing by a negative flips the sign; an unknown that cancels ends at `\varnothing` or `-\infty < x < \infty` | `2x + 3 > 11` → `2x > 8`, `x > 4`; `-2x < 6` → `x > -3`; `2x + 1 < 2x + 5` → `2x - 2x < 5 - 1`, `0 < 4`, `-\infty < x < \infty` |
| Compound inequalities (`engine/inequality.ts`), a chain `a < px + q < b` in all three parts at once: fractions cleared, the number taken away, the coefficient divided out (a negative one turns the chain round); a descending chain is read ascending | `-3 < 2x + 1 < 7` → `-4 < 2x < 6`, `-2 < x < 3`; `1 \le 3 - 2x < 7` → `-2 \le -2x < 4`, `-2 < x \le 1`; `-2 \le \frac{3 - x}{2} \le 4` → `-4 \le 3 - x \le 8`, … `-5 \le x \le 7` |
| Polynomial inequalities, degree 2–4 (`engine/inequality.ts`): standard form with a positive leading coefficient (every term moved to that side, the sign turned), the content divided out, factored over the rationals — or, when it does not factor, the equation by the quadratic formula — then the critical values (`x = 2, \ x = 3`) and the sign between them. A product against 0 goes straight to its critical values. The answer: a chain, a union list, `x \neq a`, a single `x = a`, `\varnothing` or `-\infty < x < \infty` | `x^2 - 4 < 0` → `(x + 2)(x - 2) < 0`, `x = -2, \ x = 2`, `-2 < x < 2`; `x^2 - 5x + 6 > 0` → `(x - 2)(x - 3) > 0`, `x = 2, \ x = 3`, `x < 2, \ x > 3`; `x^2 - 2x - 1 < 0` → `x^{2} - 2x - 1 = 0`, … `x = 1 \pm \sqrt{2}`, `1 - \sqrt{2} < x < 1 + \sqrt{2}`; `(x - 1)^2 > 0` → `x = 1`, `x \neq 1` |
| Rational inequalities, one fraction with the unknown below (`engine/inequality.ts`): its zeros excluded first (`x \neq 3`), then both sides times the denominator squared (positive wherever the line is defined, so nothing flips), and the polynomial inequality above; an excluded value never joins the answer | `\frac{x - 1}{x + 2} > 0` → `x \neq -2`, `(x + 2)(x - 1) > 0`, `x = -2, \ x = 1`, `x < -2, \ x > 1`; `\frac{x + 1}{x - 3} \le 2` → `x \neq 3`, `(x + 1)(x - 3) \le 2(x - 3)^{2}`, … `(x - 3)(x - 7) \ge 0`, `x = 3, \ x = 7`, `x < 3, \ x \ge 7` |
| Simplifying an expression in unknowns (`engine.simplifySteps`, no relation or a trailing `=`): expand, then collect like terms. Solve writes it under the line as `= …` lines | `3(x+2) - x` → `= 3x + 6 - x`, `= 2x + 6`; `(x+1)(x+2)` → `= x^{2} + 2x + x + 2`, `= x^{2} + 3x + 2` |
| Factoring (`engine/polynomial.ts`), the rule: an expression with brackets to expand or like terms to collect is simplified (above); one already expanded and collected is factored when it factors over the integers, otherwise nothing is written. Common factor first (number and lowest powers), then difference of squares, trinomials (split the middle term and group when the leading coefficient is not 1), grouping, sum/difference of cubes, the factor theorem; in several unknowns the common factor and a difference of squares. One fraction of polynomials: the top and the bottom factored, the common factors cancelled (nothing written when none cancel) | `6x^2 + 9x` → `= 3x(2x + 3)`; `2x^2 + 7x + 3` → `= 2x^{2} + 6x + x + 3`, `= 2x(x + 3) + (x + 3)`, `= (x + 3)(2x + 1)`; `x^3 - 8` → `= (x - 2)(x^{2} + 2x + 4)`; `x^2 + 1` → nothing; `\frac{x^2 - 1}{x - 1}` → `= \frac{(x + 1)(x - 1)}{x - 1}`, `= x + 1`; `\frac{x^2 - 5x + 6}{x^2 - 4}` → `= \frac{(x - 2)(x - 3)}{(x + 2)(x - 2)}`, `= \frac{x - 3}{x + 2}` |
| Quadratics (`engine/quadratic.ts`, through `solveAdvanced` in `engine/advanced.ts`): brackets expanded and fractions cleared, standard form, the common factor divided out; then rational roots → factored → the roots (a double root once); a product already equal to 0 → each factor split; `a(px + q)^2 + c = d` → square roots (completing the square's last steps); `ax^2 + c = 0` → `x = \pm …`; otherwise the formula with the values in, the surd simplified and the fraction reduced. No real roots ends at the negative number under the root and `\varnothing` | `x(x + 1) = 12` → `x^{2} + x = 12`, `x^{2} + x - 12 = 0`, `(x + 4)(x - 3) = 0`, `x = -4, \ x = 3`; `x^2 - 2x - 1 = 0` → … `x = \frac{2 \pm \sqrt{8}}{2}`, `x = \frac{2 \pm 2\sqrt{2}}{2}`, `x = 1 \pm \sqrt{2}`; `(x + 3)^2 = 16` → `x + 3 = \pm 4`, `x = -3 \pm 4`, `x = -7, \ x = 1`; `x^2 + x + 1 = 0` → … `x = \frac{-1 \pm \sqrt{-3}}{2}`, `\varnothing` |
| Cubics and quartics that factor over the rationals: the first factor out, then the full product (`x^4 - 5x^2 + 4` via `(x^{2} - 1)(x^{2} - 4)`); `x^3 = 8` by the cube root | `x^3 - 6x^2 + 11x - 6 = 0` → `(x - 1)(x^{2} - 5x + 6) = 0`, `(x - 1)(x - 2)(x - 3) = 0`, `x = 1, \ x = 2, \ x = 3` |
| Absolute value (`engine/absolute.ts`; `\|x\|`, `\left\|x\right\|` and `\lvert x \rvert` all read): the bars isolated, then both branches on one line, solved side by side. Inequalities: `<` a chain, `>` a union. A negative on the other side is `\varnothing` (or every number, `-\infty < x < \infty`); against an expression in the unknown the branch root that makes it negative fails its check in maths | `\|2x - 3\| = 5` → `2x - 3 = 5, \ 2x - 3 = -5`, `2x = 8, \ 2x = -2`, `x = 4, \ x = -1`; `\|x - 1\| < 3` → `-3 < x - 1 < 3`, `-2 < x < 4`; `\|x - 1\| = 2x + 1` → … `\|-3\| \neq -3`, `x = 0` |
| Rational equations (`engine/rationalEquation.ts`, the unknown in a denominator): the excluded values first (`x \neq 0`), every term times the LCD (built from the factored denominators) shown, the equation left over solved by the steps above, an excluded root dropped | `\frac{1}{x} + \frac{1}{2} = \frac{3}{4}` → `x \neq 0`, `4x \cdot \frac{1}{x} + 4x \cdot \frac{1}{2} = 4x \cdot \frac{3}{4}`, `4 + 2x = 3x`, … `x = 4`; `\frac{x}{x-1} = \frac{1}{x-1}` → `x \neq 1`, …, `x = 1`, `\varnothing` |
| Radical equations (`engine/radical.ts`): the root isolated, both sides squared (cubed for `\sqrt[3]{}`), solved, and a root that fails the check shown failing before it is dropped | `\sqrt{x + 3} + 3 = x` → `\sqrt{x + 3} = x - 3`, `x + 3 = (x - 3)^{2}`, … `x = 1, \ x = 6`, `\sqrt{4} \neq -2`, `x = 6` |
| Exponential and log equations (`engine/explog.ts`), exact: powers over a common base, otherwise the logarithm itself (`\ln 5`, `\log_{5} 7`), never a decimal; a log alone → exponential form; several logs → the domain (`x > 3`), combined, exponential form, the root outside the domain dropped; `\log_b f = \log_b g` → `f = g`, a whole coefficient first taken inside by the power law (`2\ln x = \ln 9` → `\ln(x^{2}) = \ln 9`); a log of a number that is not a whole power (`\ln 2`) is moved across as one log of a number against logs, folded into the argument against a number | `4^x = 8` → `\left(2^{2}\right)^{x} = 2^{3}`, `2^{2x} = 2^{3}`, `2x = 3`, `x = \frac{3}{2}`; `5^x = 7` → `x = \log_{5} 7`; `\log_2 x = 5` → `x = 2^{5}`, `x = 32`; `\log x + \log(x - 3) = 1` → `x > 3`, `\log(x(x - 3)) = 1`, `x(x - 3) = 10^{1}`, … `x = -2, \ x = 5`, `x = 5`; `2\ln(x) = \ln(9)` → `x > 0`, `\ln(x^{2}) = \ln 9`, `x^{2} = 9`, `x = \pm 3`, `x = 3`; `\ln(x + 1) - \ln(x) = \ln(2)` → `x > 0`, `\ln \frac{x + 1}{x} = \ln 2`, `\frac{x + 1}{x} = 2`, … `x = 1` |
| Checking these steps (`engine/compound.ts`): a split line (`2x - 3 = 5, \ 2x - 3 = -5`) is the union of its branches, a chain (`-3 < x - 1 < 3`) both halves, a union of inequalities (`x \le -3, \ x \ge 2`) either; a squared / denominator-cleared line may gain a root the line above cannot take (still `ok`); a single branch under `\|…\|` is `ok`; an answer that is exactly the first line's solution set is `ok` whatever the line above (the extraneous root dropped) | `\sqrt{x+2} = x` → `x + 2 = x^2` ✓ → `x = -1, \ x = 2` ✓ → `x = 2` ✓ (solved); `\|2x-3\| = 5` → `2x - 3 = 5, \ 2x - 3 = 5` flagged |
| Steps in two or more unknowns (same solution set: pin all but one unknown, solve along it, check both ways; `compareMultiRelations`). Checks the step, does not solve the system | `x + y = 10` → `y = 10 - x` ✓, `y = 5 - x` flagged, `(x+y)^2 = 100` flagged |
| Solving from the lines above (`solveFromLines`, `engine/systems.ts`): a known value substituted in, or two linear equations by substitution; `x = ?` / `x =` names the unknown. Written by hand, no model; kept within the 8-line block with the answer last | `x + y = 18`, `y = 9`, `x = ?` → `x + 9 = 18`, `x = 9`; `x + y = 18`, `x - y = 4` → `y = 18 - x` … `x = 11`, `y = 7` |
| Two equations that are the same line, or parallel: substituted until the unknown cancels, in maths only | `x + y = 18`, `2x + 2y = 36` → … `0 = 0`, `y = 18 - x`; `x + y = 18`, `x + y = 20` → … `0 = 2`, `\varnothing` |
| One linear equation and one not, in the same two unknowns (`engine/systems.ts`): the unknown alone on a side of the linear one (else a ±1 coefficient; the one asked for, with `x = ?`) substituted into the other, that line solved by the exact steps above, every root put back; the partners listed in the same order as the roots (each pair reads down the page), no real root `\varnothing`. Refused when a root is a surd | `l = w + 3`, `l \cdot w = 40` → `(w + 3)w = 40`, `w^{2} + 3w = 40`, `w^{2} + 3w - 40 = 0`, `(w + 8)(w - 5) = 0`, `w = -8, \ w = 5`, `l = -8 + 3, \ l = 5 + 3`, `l = -5, \ l = 8`; `x + y = 7`, `xy = 12` → `y = 7 - x`, `x(7 - x) = 12`, … `x = 3, \ x = 4`, `y = 4, \ y = 3` |
| Two equations with no coefficient ±1 (substitution would write fractions): elimination (`engine/elimination.ts`) — the multiplied equations, the eliminated one, then back-substitution; the unknown asked for (`y = ?`) is solved first, otherwise the cheaper one to eliminate | `3x + 2y = 16`, `2x + 3y = 14` → `9x + 6y = 48`, `4x + 6y = 28`, `5x = 20`, `x = 4`, `3(4)+2y=16`, `12 + 2y = 16`, `2y = 4`, `y = 2` |
| Graphs (`engine/graphIntent.ts`, `graphFor`; see "Graphs" above): lines in any form, `y = f(x)`, regions, circles, systems with their crossing, a one-variable inequality answer as a number line; exact coordinates only | `y = 2x + 1` → points `(0, 1)`, `(-\frac{1}{2}, 0)`; `x + y = 18`, `x - y = 4` → crossing `(11, 7)`; `y = \frac{2x+1}{x-1}` → asymptotes `x = 1`, `y = 2`; `2x + 3 > 11` → `2x > 8`, `x > 4` → number line, open circle at 4, ray right |
| Three linear equations in three unknowns: one unknown eliminated from two pairs (the eliminated equations shown, divided by their common factor), the two-equation case, then back-substitution; the answer line is `x = 1, \ y = 2, \ z = 3`. Within the 8-line block the multiplied and back-substituted lines go first, never the values. No common point: eliminated down to a false `0 = c`, then `\varnothing` (the same plane twice is refused: no single answer) | `x + y + z = 6`, `2x - y + z = 3`, `x + 2y - z = 2` → `x - 2y = -3`, `2x + 3y = 8`, `2x - 4y = -6`, `7y = 14`, `y = 2`, `x - 2(2) = -3`, `x = 1`, `z = 3`; `x + y + z = 6`, `x + y + z = 7`, `x - y + z = 2` → `0 = 1`, `\varnothing` |

| Refused (`kind: 'unknown'`, no result) | Why |
|---|---|
| Limits outside the cases above: `\lim_{n \to \infty}(1 + \frac{1}{n})^n` (not a rational function at ∞), one-sided (`x \to 0^{+}`), a non-zero number over zero (`\frac{1}{x - 1}` at 1, `\frac{\cos x}{x}` at 0), 0/0 still 0/0 after three rounds of L'Hôpital | Sampling near the point would be a guess, not an answer. Refused limits are `unknown` |
| A trig equation at a non-special value (`\sin x = \frac{1}{3}`), with the unknown also outside the functions (`\sin x = x`), a non-linear argument (`\sin(x^{2})`), or a mix the identities above do not reduce (`\sin x + \tan x = 1`) | Refused outright (`solveLatex` → null) — the numeric root-finder used to list thirty values in radians, which is no answer to a school interval |
| Matrices, `\begin{array}`, `\begin{cases}` | No linear algebra. Classified `unknown` rather than `text`, so it reads as "cannot do this", not as a caption |
| Integrals with no elementary antiderivative (`\int e^{x^{2}} dx`, `\int \frac{\sin x}{x} dx`), parts that go round in a circle (`\int e^{x}\sin x \, dx`), partial fractions with a repeated or irreducible quadratic factor or a numerator of degree ≥ the denominator's, completing the square (`\frac{1}{x^{2} + x + 1}`); improper/divergent/singular definite ones; an integrand whose variable is not the `dx` | Every answer is checked by differentiating it back; what the engine cannot integrate exactly it does not write, and a Simpson sum over a singularity is meaningless |
| `\frac{d}{dx} f(x)`, `\frac{d}{dx} \Gamma(x)`, `\frac{dy}{dx}` with no definition in scope | An unknown function would otherwise be read as a constant factor and "differentiated" to `f` |
| `\sum_{i=1}^{3} i + 1` (ambiguous summand), infinite or symbolic limits | Two readings on paper; the engine refuses rather than picking one |

Bound variables are bound: the `dx` of a definite integral, the variable of a limit and the index of a sum are removed from a line's free variables, so `\int_0^1 x^2 dx =` is a closed expression the engine answers, not an expression in `x` (an indefinite integral's `x` stays free: its answer is a function of `x`). A trailing `=` on any of the above follows the same rule as `36 + 2 =` — the value is revealed in answer mode only.

**Calculus steps (`engine/calculus.ts`).** `latex.ts` reads `\frac{d}{dx}` (also `\frac{\mathrm{d}}{\mathrm{d} x}`, `\operatorname{d}`, `d x`), `\int … dx` (also `\mathrm{~d} x`), `\lim_{x \to a}` (also `\rightarrow`, `\infty`) and `\left[F\right]_a^b` into `derivative()`, `integral()`/`antiderivative()`, `limit()` and `bracketEval()`; `calculus.ts` registers the last three on the mathjs instance and answers all four with the lines a teacher writes. The board asks for them through the existing contract only: `simplifySteps` (a calculus expression, with or without a trailing `=`; drawn as `= …` lines), `solveFromLines` (`\frac{dy}{dx}` / `f'(2)` under a definition, and any calculus line under other work, so a system above never answers it) and `analyzeLine(…).resultLatex` (the last line, e.g. `6x + 2`, `\ln 2`, `\frac{x^{3}}{3} + C`). Every result is checked numerically before it is returned — a derivative against a central difference, an antiderivative by differentiating it back, a definite integral against Simpson, a limit against the function near the point — so a bug becomes no answer, never a wrong line. The techniques live beside it and hook in through `CalculusDeps` (`integrate`, `integrateDefinite`, `limit`: `integration.ts`, `limits.ts`), tried only when calculus.ts's own rules have nothing and checked by it the same way; they share its expression tree, printer and exact values. A step that is a relation of its own — `u = x^{2} + 1`, `du = 2x \, dx`, the parts, `A = \frac{1}{2}, \ B = -\frac{1}{2}`, `y = x^{x}` — is drawn as it stands; every other line continues the question with `=` (`continueLine` in `engine/solution.ts`, used by `localAnswerStep`).

**The model's steps are checked before they are drawn.** A solve step that does reach the client goes through `createSolveStepGuard` (`solveSteps.ts`) first: it must parse with the local engine (prose, an empty fragment and a broken `\frac` do not), and it must introduce no free variable that neither the student's own lines nor an earlier accepted step contain — unless the step is the assignment defining it (`v = 60/2` in a word problem is fine; `= r + 9\varepsilon` is not). Steps that fail are discarded, and if none survives the student sees the ordinary solve failure ("Couldn't work this out" plus Retry) rather than nonsense on their page. LLM steps are typeset `math` shapes, never handwriting: the tutor's hand is reserved for maths the engine derived.

All Live writes go through `editor.store.mergeRemoteChanges` (source `remote`): they are not in the undo stack and invisible to `source:'user'` listeners; the autosave listener uses `source:'all'` so they persist. Nothing runs on an idle timer outside Live any more: ink Live cannot read (non-maths, low confidence, a failed read) stays silent until the student asks with Help.

Live routes reuse the shared preamble (`requireUser` → `checkRateLimit` → zod) and add `X-Request-Id`. Streams are `text/event-stream` with `: ping` keepalives; model output is JSON Lines validated per line with zod before it is forwarded, and `expected` claims are re-verified by the local engine before an annotation is shown.
