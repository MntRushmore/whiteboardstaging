# Architecture

Agathon Classroom is a single Next.js 16 App Router app. The browser talks to Supabase directly for auth and board persistence (protected by RLS), and to Next.js route handlers for anything that needs a provider API key. No key other than the Supabase anon key ever reaches the browser.

## Components

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Canvas | tldraw 4 (`src/app/board/[id]/page.tsx`) | Drawing, the Live Math layer (typeset echoes, graphs, the tutor's handwriting), autosave |
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

`POST /api/voice/token` (JWT + rate limit) mints a short-lived OpenAI Realtime client secret and returns it; the browser opens a WebRTC session directly with OpenAI. The session registers `voiceSessionTools()` (`src/lib/live/voiceTools.ts`): `analyze_workspace` (a vision READ of the viewport via `/api/voice/analyze-workspace`, text back) plus the Live tools `read_live_math`, `place_math` and `plot_function`, which the browser runs through `runVoiceTool` against the Live controller — no network, typeset shapes only. An unknown tool name (e.g. `draw_on_canvas` from an older session) is answered with an error, never run. Without `OPENAI_API_KEY` the token route returns `503 voice_unavailable`.

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
- **Refunds.** `refundCredits({ token, requestId })` calls the SECURITY DEFINER RPC `refund_credits(p_request_id)` as the user (migration `20260917030000_refunds_ratelimit.sql`): it deletes the caller's own `usage_events` rows carrying that `request_id` and younger than 15 minutes, and returns `{ refunded, remaining }`; it never throws (a refund that cannot happen is logged and reported as `{ refunded: 0, reason }`), and with `BILLING_ENFORCE=0` it does nothing because nothing was charged. The `requestId` refunded is the very one passed to `enforceCredits` (asserted per route by `routes.refunds.test.ts`). Two wrappers apply it: non-streaming routes (`voice/analyze-workspace`, `live/recognize` POST) run their provider call inside `runCharged`, which refunds whenever the Response handed to the client is not a 2xx — `UpstreamError` (502), the provider's own `CreditsExhaustedError` (402), `recognizer_failed` (502), timeouts/aborts (500). A 2xx is never refunded. The SSE routes (`live/check`, `live/solve`) run inside `runChargedStream`, which refunds only when the stream fails **before the first annotation / step was emitted**; a failure after partial output keeps the charge (the user has the partial result and the model was paid), and the `error` frame is still sent either way.
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
  → quiet gate 600 ms (450 ms on rewrite)      src/lib/live/liveLoop.ts
  → clusterLines → InkLine[]                    strokeClusters.ts (union-find, fraction bars, columns)
  → buildPayload → normalized ints + sha-1      strokePayload.ts (cache hit → skip network)
  → POST /api/live/recognize                    Mathpix v3/strokes ▸ vision fallback
  → engine.analyzeLine (mathjs, offline)        src/lib/live/engine/**
  → policy.decide(mode, verdict, voice, settled) policy.ts (silence rules, hint ladder)
  → placement → scheduleLiveWrite(createShapes) math / graph shapes with meta.live
  → (ladder permits) POST /api/live/check|solve SSE: meta → annotation*/step* → done

any student ink, anywhere (incl. pen-down, drag, erase)
  → settle gate 2.5 s (ANSWER_SETTLE_MS)        liveLoop.markUnsettled → renderSettled
  → re-render only → the held-back ANSWER lands  (no re-recognition, no model call)
```

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

**Marks may be immediate; answers must wait.** Two clocks, because "this line is finished" and
"the student has stopped" are different questions. `LIVE_TIMING.quietMs` (600 ms, per line) gates
recognition and everything that comments on work already done — the green check, the amber dot,
the solved chip, the note and the Feedback/Suggest hint ladder all keep that cadence.
`ANSWER_SETTLE_MS` (2.5 s, whole canvas, `liveLoop.ts`) gates every "here is the result" output:
the handwritten calculator answer and the echo's `resultLatex`. Any student ink restarts it — a
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

**Word problems.** Mathpix returns prose as `\text{…}` and the engine classifies it `kind: 'text'`
(silent: no echo). `buildCheckLines` still sends those lines, so Solve / Help on a word problem
skips both local answer paths (`startSolve`) and goes to `/api/live/solve`, whose prompt treats text
lines as the question and asks for assignment steps (`v = \frac{60}{2}`, then `v = 30`), which
`createSolveStepGuard` accepts because an assignment defines its own symbol.

**Deterministic maths never goes through a model.** `LiveLoop.startSolve` (`src/lib/live/liveLoop.ts`) asks the local engine twice before it will open `/api/live/solve`: `engine.solveLatex` for a relation with an unknown (`2x + 3 = 11` → `2x = 8`, `x = 4`), and then `localAnswerFor` (`src/lib/live/solveSteps.ts`) for a line the engine can simply evaluate — `analyzeLine(latex, { mode: 'answer' }).resultLatex` covers a trailing `=`, units, a conversion, a derivative, a definite integral, a finite sum and a percentage, and `engine.calculate` covers bare arithmetic whose result the echo's calculator rule suppresses. Either way the steps are written under the student's work in the tutor's hand (`planHandwriting` + `HandWriter`), with no model, no credits and no network. An answer the hand atlas cannot draw, or a device with the handwriting switch off, is typeset locally instead of being asked for: only a line the engine has nothing to say about (a word problem, an equation the CAS declines) reaches the stream. Regression: `36 + 2 =` used to fall through `solveLatex` and be answered `= r + 9\varepsilon` by the model.

**What the local engine can and cannot do (`src/lib/live/engine/**`).** The table is the contract the tests in `engine/__tests__` hold it to. The rule behind it: the engine either produces the answer a teacher would write, or it produces none — a line it cannot do comes back `kind: 'unknown'` with an empty `resultLatex`, never an approximation presented as an answer.

| Local, with an answer | Example in → answer out |
|---|---|
| Arithmetic, exact fractions, powers, roots | `\frac{3}{4} + \frac{1}{6}` → `\frac{11}{12}`, `\sqrt{144}` → `12` |
| Trig (degrees and radians), logs, exponentials | `\sin(30^\circ)` → `0.5`, `\log_{2}(8)` → `3`, `\ln(e^2)` → `2` |
| Percentages and "of" | `15\% \text{ of } 80 =` → `12` (percent answers stay decimal: `12\%` of `3` → `0.36`) |
| Units, conversions, physical constants | `5 km/h \text{ to } m/s` → `1.389\,\mathrm{m/s}` |
| Derivatives: `\frac{d}{dx}`, `\frac{d^2}{dx^2}`, and `\frac{dy}{dx}` / `f'(x)` when an earlier line defined `y`/`f` | `\frac{d}{dx}(3x^2 + 2x) =` → `6\cdot x+2`, `\frac{d}{dx} 7 =` → `0` |
| Definite integrals: exact for a polynomial over rational limits, otherwise Simpson (1000 panels) to 4 s.f. | `\int_0^1 x^2 dx =` → `\frac{1}{3}`, `\int_0^{\pi} \sin x \, dx =` → `2` |
| Finite sums `\sum_{i=a}^{b}` (integer limits, ≤ 10 000 terms) | `\sum_{i=1}^{10} i =` → `55`, `\sum_{i=1}^{3} \frac{1}{i} =` → `\frac{11}{6}` |
| Single-variable equations (linear/quadratic/cubic exact, else numeric), step equivalence, chemistry balancing | `x^2 - 5x + 6 = 0` → `x = 2 \text{ or } x = 3` |

| Refused (`kind: 'unknown'`, no result) | Why |
|---|---|
| `\lim_{x \to 0} \frac{\sin x}{x}` | A CAS this size cannot decide a limit; sampling near the point would be a guess, not an answer |
| Matrices, `\begin{array}`, `\begin{cases}` | No linear algebra. Classified `unknown` rather than `text`, so it reads as "cannot do this", not as a caption |
| Indefinite integrals, improper/divergent/singular definite ones, an integrand whose variable is not the `dx` | No symbolic integration; a Simpson sum over a singularity is meaningless |
| `\frac{d}{dx} f(x)`, `\frac{d}{dx} \Gamma(x)`, `\frac{dy}{dx}` with no definition in scope | An unknown function would otherwise be read as a constant factor and "differentiated" to `f` |
| `\sum_{i=1}^{3} i + 1` (ambiguous summand), infinite or symbolic limits | Two readings on paper; the engine refuses rather than picking one |

Bound variables are bound: the `dx` of an integral and the index of a sum are removed from a line's free variables, so `\int_0^1 x^2 dx =` is a closed expression the engine answers, not an expression in `x`. A trailing `=` on any of the above follows the same rule as `36 + 2 =` — the value is revealed in answer mode only.

**The model's steps are checked before they are drawn.** A solve step that does reach the client goes through `createSolveStepGuard` (`solveSteps.ts`) first: it must parse with the local engine (prose, an empty fragment and a broken `\frac` do not), and it must introduce no free variable that neither the student's own lines nor an earlier accepted step contain — unless the step is the assignment defining it (`v = 60/2` in a word problem is fine; `= r + 9\varepsilon` is not). Steps that fail are discarded, and if none survives the student sees the ordinary solve failure ("Couldn't work this out" plus Retry) rather than nonsense on their page. LLM steps are typeset `math` shapes, never handwriting: the tutor's hand is reserved for maths the engine derived.

All Live writes go through `editor.store.mergeRemoteChanges` (source `remote`): they are not in the undo stack and invisible to `source:'user'` listeners; the autosave listener uses `source:'all'` so they persist. Nothing runs on an idle timer outside Live any more: ink Live cannot read (non-maths, low confidence, a failed read) stays silent until the student asks with Help.

Live routes reuse the shared preamble (`requireUser` → `checkRateLimit` → zod) and add `X-Request-Id`. Streams are `text/event-stream` with `: ping` keepalives; model output is JSON Lines validated per line with zod before it is forwarded, and `expected` claims are re-verified by the local engine before an annotation is shown.
