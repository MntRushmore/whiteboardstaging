# Architecture

Agathon Classroom is a single Next.js 16 App Router app. The browser talks to Supabase directly for auth and board persistence (protected by RLS), and to Next.js route handlers for anything that needs a provider API key. No key other than the Supabase anon key ever reaches the browser.

## Components

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Canvas | tldraw 4 (`src/app/board/[id]/page.tsx`) | Drawing, viewport capture, overlay of AI images, autosave |
| Client API helper | `src/lib/api-client.ts` | `authedFetch` attaches the Supabase access token; `apiJson` parses the error contract into `ApiError` |
| Route handlers | `src/app/api/**` (Node runtime) | JWT verification, rate limiting, zod validation, provider calls, logging |
| Server helpers | `src/lib/server/**`, `src/lib/env.ts` | `requireUser`, rate limiter, env validation, provider clients |
| Data | Supabase Postgres + Auth + Storage | Boards, settings, bug reports, training samples, buckets |
| Providers | OpenRouter (image + vision models), Mathpix (handwriting OCR), OpenAI (Realtime voice) | Model inference |

## Request flows

### 1. Draw -> AI feedback (core loop)

1. `useDebounceActivity` watches the tldraw store for user-sourced changes; after ~2 s of idle it fires.
2. The client renders the current viewport to PNG (`editor.toImage`), excluding pending AI overlays and protected shapes, and downscales it per the AI performance settings.
3. `apiJson("/api/generate-solution", { image, mode, model, ... })` is sent with `Authorization: Bearer <access token>`.
4. The route verifies the JWT, applies the per-user rate limit, validates the body, optionally runs Mathpix on the image to obtain LaTeX for the prompt, then calls an OpenRouter image-output model.
5. The response image is inserted as a locked, semi-transparent image shape. In suggest/answer modes the student accepts or rejects it; in feedback mode it stays.

### 2. Autosave

Every change schedules a save ~2 s later: the whole tldraw snapshot is written to `whiteboards.data` via Supabase JS. RLS restricts the write to the owner. A trigger bumps `version` and copies the snapshot into `whiteboard_snapshots` (last 20 kept). A thumbnail is written to `preview` only when small enough. The snapshot contains only asset *URLs* (see flow 2b); a client refuses to autosave a snapshot above `SNAPSHOT_LIMITS.hardBytes` (4 MB) until its inline assets are offloaded, and the database rejects anything above 8 MB (`whiteboards_data_size`, `whiteboard_snapshots_data_size`, `training_samples_tldraw_snapshot_size` in `supabase/migrations/20260917010000_snapshot_size_cap.sql`).

### 2b. Assets (images) -> Storage, not the snapshot

Every image that lands on a board - pasted/dropped files, AI-generated solutions, stickers, PDF pages, worksheets - goes through one `TLAssetStore` passed to `<Tldraw assets={...}>` (tldraw calls `store.upload(asset, file)`; our own code calls `editor.uploadAsset(asset, file)` instead of `createAssets` with a data URL):

1. `upload()` writes the bytes to the public bucket `board-assets` at `<auth.uid()>/<boardId>/<assetId>.<ext>` (`assetObjectPath()` in `scripts/lib/snapshotAssets.mjs`; the `asset:` prefix is stripped and every segment is reduced to `[A-Za-z0-9_-]`, so no path traversal). Storage RLS only allows writes under the caller's own `uid` folder; reads are public because tldraw renders `<img src>` and the AI routes fetch the image server-side.
2. It registers the object in `public.board_assets` (`whiteboard_id`, `user_id`, `object_path` unique, `mime_type`, `bytes`, `width`/`height`, `source` in `user|ai|sticker|pdf|worksheet`) - the registry that makes garbage collection possible.
3. It returns `{ src: <public URL> }` = `<SUPABASE_URL>/storage/v1/object/public/board-assets/<path>`, which is what ends up in `props.src` of the asset record and therefore in `whiteboards.data`. Older clients read that snapshot unchanged: `src` is just a URL instead of a `data:` URL.

Boards saved before this shipped still carry `data:` URLs. They keep loading (tldraw renders data URLs fine) but stay multi-MB until `node scripts/offload-assets.mjs` (service role, see the runbook) uploads their inline assets with the same path convention and rewrites `src`. The shared pure helpers (`parseDataUrl`, `findInlineAssets`, `rewriteAssetSrcs`, `snapshotJsonBytes`, `SNAPSHOT_LIMITS`) live in `scripts/lib/snapshotAssets.mjs` and are used by both the client and the script so the two never disagree about paths or limits.

Garbage collection: deleting a board cascades `board_assets` rows but **not** storage objects (Storage has no FK to Postgres). Orphans are found by listing `storage.objects` in `board-assets` whose `name` is not in `board_assets.object_path`, or whose `<boardId>` folder no longer exists in `whiteboards`; today that is a manual query in the runbook, a scheduled job is a follow-up.

### 3. Voice tutor

`POST /api/voice/token` (JWT + rate limit) mints a short-lived OpenAI Realtime client secret and returns it; the browser opens a WebRTC session directly with OpenAI. Tool calls from the model (`analyze_workspace`, `draw_on_canvas`) are executed by the browser, which calls `/api/voice/analyze-workspace` and `/api/generate-solution` with the same auth. Without `OPENAI_API_KEY` the token route returns `503 voice_unavailable`.

### 4. Worksheets, credits, training

- `/api/generate-worksheet`: same pipeline as (1) with a text prompt instead of a canvas image.
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

Credits: the balance for the current UTC calendar month is `plans.monthly_credits + granted - used`, clamped at 0, computed on every call (no stored counter to drift). Three `security definer` RPCs are the only way a user token touches the ledger, each callable by `authenticated` only and each acting on `auth.uid()`:

| RPC | Returns | Behaviour |
| --- | --- | --- |
| `credit_summary()` | `{plan_id, plan_name, monthly_credits, used, granted, remaining, period_start, period_end}` | Read-only; falls back to plan `free` if the profile row is missing |
| `consume_credits(p_route, p_units, p_request_id?, p_model?)` | `{ok, remaining, reason}` | Locks the caller's `profiles` row `FOR UPDATE` (parallel calls serialize, never overspend); `p_units` 1..1000 else `400`; `ok:false, reason:'insufficient_credits'` writes nothing; otherwise inserts one `usage_events` row |
| `delete_own_account()` | void | Deletes the caller's `auth.users` row; every table above cascades (`bug_reports` keeps anonymised rows). Storage objects are not touched - see the runbook, section 13, for why and for the GC path |

Storage: bucket `board-assets` (public read, owner-folder writes, `<uid>/<boardId>/<assetId>.<ext>`) and `training-data` (private, trainers, `<uid>/<sampleId>/...`). `storage.objects` has no FK to `auth.users`; ownership is the first path segment, and objects are only ever deleted through the Storage API.

## Routes

Every handler under `src/app/api/**` follows the same preamble: `requireUser` (JWT) -> `checkRateLimit` (per-user sliding window, see `LIMITS` in `src/lib/server/rate-limit.ts`) -> `parseJsonBody` (zod) -> `enforceCredits` (credit metering, see "Billing" below; only on routes with a non-zero cost). The Live routes get the same steps from `livePreamble` + `enforceCredits` and additionally echo a `X-Request-Id` header. The table is the source of truth mirrored by `scripts/lib/routes.mjs`; `src/__tests__/routeProtection.test.ts` fails when a route file is added, removed, or drops one of the helpers, and `scripts/live-smoke.mjs` probes every row over HTTP (401 without a token, 200 for the public route, a 429 on `/api/credits`).

| Path | Methods | Auth | Limit (per min) | Credits | Body schema | Purpose | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/config/status` | GET | **public** (reason: booleans-only setup status) | `ip:<x-forwarded-for>:configStatus` 60 | 0 | none | Which provider keys are configured, booleans only; needed by the setup screen before sign-in | active |
| `/api/billing/webhook` | POST | **public** (reason: signature-verified provider webhook) | `ip:<x-forwarded-for>:billingWebhook` 120 | 0 | raw text, `Stripe-Signature` verified, then zod `{ id, type, data.object }` | Plan changes from the billing provider via the service role; `400 invalid_request "bad signature"` without a valid signature, `503 feature_unavailable` without `STRIPE_WEBHOOK_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` | active |
| `/api/credits` | GET | `requireUser` | `credits` 30 | 0 | none | OpenRouter balance for the low-credit banner (30 s shared cache) | active |
| `/api/generate-solution` | POST | `requireUser` | `generateSolution` 12 | 25 | `{ image, prompt?, mode, source, model, hasWorksheet }` | Canvas PNG -> AI overlay image | active |
| `/api/generate-worksheet` | POST | `requireUser` | `generateWorksheet` 4 | 20 | `{ topic, model }` | Topic -> worksheet image | active |
| `/api/live/recognize` | GET, POST | `requireUser` / `livePreamble` | `liveRecognize` 120 | GET 0; POST 1 | GET none; POST `RecognizeRequestSchema` | GET capabilities + warmup; POST strokes -> LaTeX (Mathpix, vision fallback) | active |
| `/api/live/check` | POST | `livePreamble` | `liveCheck` 30 | 3 | `CheckRequestSchema` | SSE annotations for recognized lines | active |
| `/api/live/solve` | POST | `livePreamble` | `liveSolve` 10 | 10 | `SolveRequestSchema` | SSE worked-solution steps | active |
| `/api/voice/token` | POST | `requireUser` | `voiceToken` 6 | 0 | none (empty body; model fixed server-side) | Mint an ephemeral OpenAI Realtime client secret; `503 voice_unavailable` without `OPENAI_API_KEY` | active |
| `/api/voice/analyze-workspace` | POST | `requireUser` | `analyzeWorkspace` 30 | 3 | `{ image, focus? }` | Voice tutor tool: describe the current canvas | active |
| `/api/check-help-needed` | POST | `requireUser` | `checkHelp` 30 | 2 | `{ text?, image? }` (at least one) | Text/image heuristic: does the student look stuck? | **deprecated: unused by the client** (kept working; do not remove) |
| `/api/ocr` | POST | `requireUser` | `ocr` 30 | 2 | `{ image }` | Image -> plain text via a vision model | **deprecated: unused by the client** (kept working; do not remove) |

Notes:

- Non-Live routes mint a `requestId` for their log lines but do not return it as a header; only `/api/live/*` sets `X-Request-Id` (via `withRequestId`). Extending the header to the other routes is a follow-up, not a contract today.
- Rate-limit keys are `${userId}:${bucket}`; the public route has no user, so it keys on the first hop of `x-forwarded-for` (falling back to `x-real-ip`, then `unknown`).
- No route reads `process.env` directly; provider keys come from `getServerEnv()` (`src/lib/env.ts`) or `src/lib/aiConfig.ts`, which both reject `.env.example` placeholder values.
- Deprecated routes stay on their paths with the same contract until a documented removal; marking them deprecated here (and in `scripts/lib/routes.mjs`) is the only change.
- The "Credits" column is `ROUTE_COSTS` in `src/lib/server/billing.ts`; a route with a non-zero cost calls `enforceCredits` and can answer `402 credits_exhausted` or `503 feature_unavailable` before its provider call.
- The two public routes are allow-listed in `PUBLIC_ROUTES` with a reason in `PUBLIC_ROUTE_REASONS` (`scripts/lib/routes.mjs`); `routeProtection.test.ts` additionally asserts that the webhook reads the raw body (`req.text()`, never `req.json()`) and calls `verifyStripeSignature` — the real invariant behind its public status.

## Billing

Credits are the unit; the schema is `supabase/migrations/20260917020000_accounts_billing.sql` (operator side: `docs/RUNBOOK-supabase.md`).

- **Balance.** Each `profiles` row has a `plan_id` (`plans.monthly_credits`; placeholder numbers today: free 300, plus 3000 at $9, pro 12000 at $29). For the current calendar month (UTC) `remaining = monthly_credits + credit_grants − usage_events`. The client reads it with the RPC `credit_summary()`.
- **Metering runs as the user.** `requireUser` now also returns the verified access token; `enforceCredits({ token, route, requestId, model })` (`src/lib/server/billing.ts`) builds a supabase-js client with the anon key + `Authorization: Bearer <token>` and calls the SECURITY DEFINER RPC `consume_credits(p_route, p_units, p_request_id, p_model)`. The function locks the caller's profile row, checks the balance and appends a `usage_events` row atomically, so parallel requests cannot overspend; it returns `{ ok: false, reason: 'insufficient_credits', remaining }` without writing when short. A user can only spend their own credits and no API exposed to `authenticated` can add credits or change a plan (column-level grants: a user may update `display_name` only).
- **Placement.** After auth + rate limit + body validation and **before** the upstream call, for every route — including the SSE routes (`check` / `solve`), where a refusal is a JSON `402` instead of a stream. Charging up-front is the documented choice for now; refunding a failed upstream call is a follow-up.
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
- **Per-user rate limits.** Each route has a sliding-window limit keyed by user id; exceeding it returns `429` with `Retry-After`. This bounds provider spend per account.
- **Input validation.** Request bodies are parsed with zod; image payloads have size caps; unknown models are rejected.
- **Provider keys stay on the server.** Only `NEXT_PUBLIC_*` variables are exposed to the bundle. `SUPABASE_SERVICE_ROLE_KEY` is used by exactly one request path — `POST /api/billing/webhook`, after the provider signature has been verified — and by admin scripts; user-facing routes act as the user (their own JWT), never as the service role.
- **Row Level Security.** All tables have RLS enabled, `anon` has no grants, and policies compare `user_id` with `auth.uid()`. Storage policies restrict writes to the caller's own folder (`<uid>/...`). Trainer features are gated by the `trainers` table via `is_trainer()`, not by client-side checks.
- **Boundaries.** `error.tsx` / `global-error.tsx` catch render errors without leaking stack traces; `X-Powered-By` is disabled; the site is `noindex` while in staging.

## Known limitations

- **In-memory rate limiter per instance.** Limits live in the Node process. On Vercel each function instance has its own counters, so the effective limit is `limit x instances` and resets on cold start. Move to Upstash/Redis or Supabase before relying on it for cost control.
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
  → policy.decide(mode, verdict, voice, idle)   policy.ts (silence rules, hint ladder)
  → placement → scheduleLiveWrite(createShapes) math / graph shapes with meta.live
  → (ladder permits) POST /api/live/check|solve SSE: meta → annotation*/step* → done
```

All Live writes go through `editor.store.mergeRemoteChanges` (source `remote`): they are not in the undo stack and invisible to the legacy `source:'user'` listeners; the autosave listener uses `source:'all'` so they persist. The legacy image pipeline skips bursts that Live handled (`legacyShouldSkip`) and excludes `meta.live` shapes from its capture.

Live routes reuse the shared preamble (`requireUser` → `checkRateLimit` → zod) and add `X-Request-Id`. Streams are `text/event-stream` with `: ping` keepalives; model output is JSON Lines validated per line with zod before it is forwarded, and `expected` claims are re-verified by the local engine before an annotation is shown.
