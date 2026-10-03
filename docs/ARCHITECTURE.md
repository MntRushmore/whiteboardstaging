# Architecture

Agathon Classroom is a single Next.js 16 App Router app. The browser talks to Supabase directly for auth and board persistence (protected by RLS), and to Next.js route handlers for anything that needs a provider API key. No key other than the Supabase anon key ever reaches the browser.

## Components

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Canvas | tldraw 4 (`src/app/board/[id]/page.tsx`) | Drawing, the Live Math layer (typeset echoes, the tutor's handwriting, marks and hand-sketched graphs), autosave |
| Platform pages | Arc (`src/registry`) in `src/app/(platform)` | Sign in / sign up / reset password, the boards home and first-run welcome, the account header (see "Platform UI") |
| Client API helper | `src/lib/api-client.ts` | `authedFetch` attaches the Supabase access token; `apiJson` parses the error contract into `ApiError` |
| Route handlers | `src/app/api/**` (Node runtime) | JWT verification, rate limiting, zod validation, provider calls, logging |
| Server helpers | `src/lib/server/**`, `src/lib/env.ts` | `requireUser`, rate limiter, env validation, provider clients |
| Data | Supabase Postgres + Auth + Storage | Boards, settings, bug reports, training samples, buckets |
| Providers | OpenRouter (text + vision models; never image generation), Mathpix (handwriting OCR) | Model inference |

## Request flows

### 1. Draw -> AI feedback (core loop)

The core loop is Live Math (see "Live Math flow" below): each finished line of ink is recognized to LaTeX, checked by the local engine, and answered with typeset echoes, hints and worked steps — or, for maths the engine can do itself, in the tutor's own handwriting. The rule is **read, never paint**: every model output is text or LaTeX the client renders. No route calls an image-generation model.

The old image pipeline (an idle timer that screenshotted the board and asked `google/gemini-3-pro-image-preview` to paint help as a 25-credit PNG overlay, with Accept/Reject and "Clear feedback") has been removed along with `/api/generate-solution`, `/api/generate-worksheet`, `/api/ocr` and `/api/check-help-needed`. Boards saved while it existed may still carry its overlays (`meta.aiOverlay`); on load an undecided suggest/answer overlay is dropped and the rest are unlocked so the student can delete them like any image (`dropPendingAiOverlays`, `src/hooks/useAiOverlayShapes.ts`).

### 2. Autosave

Every change schedules a save ~2 s later: the whole tldraw snapshot is written to `whiteboards.data` via Supabase JS. RLS restricts the write to the owner. A trigger bumps `version` and copies the snapshot into `whiteboard_snapshots` (last 20 kept). Each save also writes `preview`: the current screen, 16:9, exported once at 640 px and re-encoded (WebP, then JPEG, then smaller) until it fits the column's 20000-char cap; a board with nothing on any screen clears it (`src/lib/boards/thumbnail.ts`). A board still titled "Untitled Whiteboard" is named after the first line of maths Live read, as plain text, once it has saved in that session; the write is conditional on the title still being the default, so a name the student gave is never replaced (`useBoardAutoTitle`, `src/lib/boards/boardTitle.ts`). The snapshot contains only asset *URLs* (see flow 2b); a client refuses to autosave a snapshot above `SNAPSHOT_LIMITS.hardBytes` (4 MB) until its inline assets are offloaded, and the database rejects anything above 8 MB (`whiteboards_data_size`, `whiteboard_snapshots_data_size`, `training_samples_tldraw_snapshot_size` in `supabase/migrations/20260917010000_snapshot_size_cap.sql`).

### 2b. Assets (images) -> Storage, not the snapshot

Every image that lands on a board - pasted/dropped files, stickers, PDF pages - goes through one `TLAssetStore` passed to `<Tldraw assets={...}>` (tldraw calls `store.upload(asset, file)`; our own code calls `editor.uploadAsset(asset, file)` instead of `createAssets` with a data URL):

1. `upload()` writes the bytes to the public bucket `board-assets` at `<auth.uid()>/<boardId>/<assetId>.<ext>` (`assetObjectPath()` in `scripts/lib/snapshotAssets.mjs`; the `asset:` prefix is stripped and every segment is reduced to `[A-Za-z0-9_-]`, so no path traversal). Storage RLS only allows writes under the caller's own `uid` folder; reads are public because tldraw renders `<img src>` and the AI routes fetch the image server-side.
2. It registers the object in `public.board_assets` (`whiteboard_id`, `user_id`, `object_path` unique, `mime_type`, `bytes`, `width`/`height`, `source` in `user|ai|sticker|pdf|worksheet`) - the registry that makes garbage collection possible.
3. It returns `{ src: <public URL> }` = `<SUPABASE_URL>/storage/v1/object/public/board-assets/<path>`, which is what ends up in `props.src` of the asset record and therefore in `whiteboards.data`. Older clients read that snapshot unchanged: `src` is just a URL instead of a `data:` URL.

Boards saved before this shipped still carry `data:` URLs. They keep loading (tldraw renders data URLs fine) but stay multi-MB until `node scripts/offload-assets.mjs` (service role, see the runbook) uploads their inline assets with the same path convention and rewrites `src`. The shared pure helpers (`parseDataUrl`, `findInlineAssets`, `rewriteAssetSrcs`, `snapshotJsonBytes`, `SNAPSHOT_LIMITS`) live in `scripts/lib/snapshotAssets.mjs` and are used by both the client and the script so the two never disagree about paths or limits.

Garbage collection: deleting a board cascades `board_assets` rows but **not** storage objects (Storage has no FK to Postgres). Orphans are found by listing `storage.objects` in `board-assets` whose `name` is not in `board_assets.object_path`, or whose `<boardId>` folder no longer exists in `whiteboards`; today that is a manual query in the runbook, a scheduled job is a follow-up.

### 3. Voice tutor (removed)

The Realtime voice tutor (its button, `/api/voice/token`, `/api/voice/analyze-workspace` and the voice tools) was removed on 2026-09-28: the board chat covers asking the tutor for something. Past `voice/analyze-workspace` charges still read as "Voice tutor (retired)" on the account page.

### 4. Provider balance, training

- `/api/credits`: reads the operator's OpenRouter balance (operators and smoke tests; the student's own ink is `ink_summary()`, see "Billing").
- `/train`: trainer-only; before/after PNGs go to the `training-data` bucket and metadata to `training_samples`, both gated by `is_trainer()` in RLS.

### 5. First run (onboarding)

A new student lands on `/` after sign-up (no email confirmation). `useWelcome` (`src/components/onboarding/useWelcome.ts`) decides with `welcomeDecision` (`src/lib/onboarding/state.ts`): the welcome shows only when the student has **no boards** and `profiles.onboarded_at` is null; the profile is read only in that case, and a failed read, a missing row or a database without the migration hides it (nobody is held at a welcome by an error). The home keeps its skeleton while that is decided, so the empty state never flashes first.

1. **Welcome** (`Welcome.tsx`, a dynamic import): what the product does in two lines beside the sign-in page's pictures (`public/login/`), then the course (Algebra 1, Geometry, Algebra 2, Pre-calculus / Calculus, Something else), then Start. Start stores the course (`save_onboarding(p_course)`), creates the first board (named after its starter problem) and writes the device marker `agathon.onboarding.tour.<uid>` = `{ boardId, course, starter, step }`. Skip, at either step, calls `save_onboarding(p_complete: true)` and leaves the student on the empty state.
2. **The guided board** (`BoardTour.tsx`, a dynamic import the board page makes only when `isGuidedBoard` — a synchronous localStorage read in `src/lib/onboarding/marker.ts` — says this is the marked board, so the board's first load gains only that check). It sets Feedback and the pen, then writes one starter problem from the course through the board chat's executor: `LiveController.runChatActions([{ type: "write_problems", … }])` — the same verification (`verifyProblem`: the engine reads it, `localSolve` answers it, the hand can write it) and the same numbered problem cell, so the student's first line under it gets its tick or ring like under any chat problem. No model call and no ink; the starters are a curated list per course (`src/lib/onboarding/courses.ts`, picked by a hash of the user id, the rest of the course's list as fallbacks), each tested to verify, to be writable by the hand, and to have a first step the engine ticks in Feedback and a wrong one it rings.
3. **Three coach marks** (`CoachMark.tsx`), one at a time, each a small non-modal popover anchored to the real control with a highlight ring round it, placed by `placeCoachMark` (`placement.ts`) clear of the problem and the student's work: the pen (it waits for the tutor's mark — a new shape whose `meta.mark` is `check:`/`circle:` — then says what the tick or ring means; a question mark changes what it says by its `meta.markWhy`: `unread` asks for larger writing, `unjudged` — a lone `2` under the problem — says "That ? means the tutor couldn't tell what that line says. Write the whole next line." and the starter's hint), the help tabs (true on the starter problem: Suggest writes its first step under it, Solve works it out — "The tutor works the problems it wrote" below), and Ask (opening Ask finishes the tour). Tab reaches the buttons, Esc or the close button ends the tour. The step is kept in the device marker, so a reload resumes.
4. Finishing or closing stores completion (`save_onboarding(p_complete: true)`, plus `agathon.onboarding.done.<uid>` on the device so a failed write never brings the welcome back) and the tour never shows again. Each step is recorded with `clientMetric` (`onboarding.welcome.*`, `onboarding.tour.*`), which lands in the bug-report log buffer; there is no analytics vendor.

State: `profiles.course` (one of the five ids, a check constraint) and `profiles.onboarded_at`, added by `supabase/migrations/20260928100000_onboarding.sql`, which backfills `onboarded_at = created_at` for every profile that exists when it runs — accounts made before onboarding shipped never see the welcome. Both columns are readable by the owner (the existing select policy) and written only by the SECURITY DEFINER RPC `save_onboarding(p_course text default null, p_complete boolean default false)` → `{ course, onboarded_at }`, which acts on `auth.uid()` alone, rejects an unknown course with 22023 (HTTP 400), stamps `onboarded_at` once (a second completion keeps the first time) and creates a missing profile row first; `anon` cannot execute it and `authenticated` has no update grant on either column (a PATCH is 42501). `npm run db:verify` checks all of it (`checkOnboarding` in `scripts/lib/rlsChecks.mjs`).

The boards home with no boards (after Skip, or every board deleted) shows the welcome's picture and words and one next step, New Board (`src/components/boards/EmptyBoards.tsx`).

## Platform UI

The pages around the board (`/`, `/login`, `/reset-password`, `/account`, and the draft legal pages `/terms`, `/privacy`, `/refunds` with their facts in `src/lib/legal.ts`) live in the route group `src/app/(platform)` (URLs unchanged; every one ends with the legal footer, `src/components/legal/LegalFooter.tsx`) and are built with [Arc](https://uiarc.dev), a shadcn-style registry of React components styled with CSS modules and animated with `motion`. The board (`/board/[id]`) and `/train` stay on shadcn/ui + Tailwind + tldraw and never load Arc.

**Where it lives.** Components are vendored source: `src/registry/components/<name>/<name>.tsx` + `.module.css`, tokens in `src/registry/foundation.css`, motion timings in `src/registry/motion-tokens.ts` (`src/lib/motion-tokens.ts` re-exports it under Arc's documented path). Add one with `node scripts/arc-add.mjs <id> [...]` (`components.json` registers `@uiarc`); the script runs the shadcn CLI and moves the files under `src/`, since Arc targets the project root and our `@/*` points at `src/`. Installed: alert, badge, button, card (not used: it is a quick-look surface with no link, and board cards are links), dialog, dropdown-menu, empty-state, input, password-field, radio-cards, search-field, segmented-control, select, skeleton, stepper, tabs, user-menu.

**Loading, and keeping it off the board.** `src/app/(platform)/layout.tsx` is the only importer of `foundation.css` and `platform.css` (our Arc theming), and the only place Inter is loaded; it sets Arc's `--font-geist` / `--font-inter` (Geist is shared with the root layout through `src/app/fonts.ts`). Two rules follow from Next keeping a page's CSS in the document after a client-side navigation (home → board):

- Arc defines `--background`, `--foreground`, `--border`, `--accent`, `--accent-foreground`, `--text-xs` … `--text-5xl` and `--ease-in-out` on `:root` with other meanings than shadcn/Tailwind (Arc's `--accent` is near-black; shadcn's is the light hover grey behind `bg-accent`). So Arc keeps the bare names and shadcn's values live under `--ui-*` in `src/app/globals.css`, with `@theme inline` pointing Tailwind's colours at them and Tailwind's font sizes and `ease-in-out` declared inline. Never define a bare shadcn token name on `:root` again; a new shadcn token goes under `--ui-*`.
- Page-wide rules in `platform.css` are scoped to `body:has([data-platform])` (the layout's wrapper), which stops matching once the platform layout unmounts, and its token values only touch Arc's own names.

The board screenshots before and after this (including after navigating from the Arc home) are pixel-identical, and the production build's `/board/[id]` first load contains no Arc component, `motion` or Arc token (`node scripts/check-bundle.mjs` plus a scan of the route's files).

**Our theming (`platform.css`).** Arc ships no focus rings (`--focus-ring` transparent and a global `outline: none !important` in `foundation.css`, removed there). Keyboard focus gets a quiet ring instead: near-black at 55 % (3.8:1 on white) on every control, and a faint 12 % halo on text fields, whose border already turns black. `--text-muted` (59 % → 54 %) and `--warning` are deepened to clear 4.5:1, since they carry real text here (hints, inactive tabs, the low-ink badge).

**Local changes to Arc sources**, each marked `Agathon:` in the file. `arc-add.mjs` never overwrites a file that differs from the registry's; it writes the registry's version beside it as `<file>.upstream`, so a re-install is a diff and a re-apply:

- `password-field`: an `error` prop tied to the field like Input's, and optional controlled `visible` / `onVisibleChange` (the sign-in form hides the password again on submit, so password managers save a `type=password` field).
- `dropdown-menu`: an optional `trigger` element (rendered `asChild`, for the icon-only ⋯ on a board card) and `modal` (false when an item opens a dialog, so the menu closing under it cannot leave the page inert).
- `foundation.css`: the global `outline: none !important` removed (above).

**Our pieces on top.** Styling is CSS modules with Arc tokens only: `src/components/login/auth.module.css` (sign-in, sign-up, reset), `src/components/app/appShell.module.css` (the header and the shared content width, `APP_CONTENT_CLASS`), `src/components/boards/boards.module.css` (home, board cards with Arc Card's border, radius, hover shadow and focus ring), `src/components/onboarding/welcome.module.css`. Shared components: `AppHeader` (Arc UserMenu with Account, Feature Labs and Sign out; the ink meter as an Arc Badge, its icon the `InkBottle` glyph, linking to `/account`, with a "Get ink" link to the packs when ink is low or out; nothing it imports may reach `tldraw`, which would pull ProseMirror into the prerendered pages and break `next build` on `/account`), `ProductPictures` (the two product pictures, used by the sign-in panel and the welcome), `ButtonLink` (a `next/link` wearing Arc Button's stylesheet: Arc's Button is a `<button>`, and links go places). Components also rendered on the board or outside this pass stay on shadcn/Tailwind: `AuthErrorBanner`, the board's `InkMeter` and ink dialog, `FeatureLabsPanel`, and the `/account` page body below the header.

**Cost.** First-load gzip, this change against `origin/main` (2026-09-28, Next 16.2.4): `/` 301.3 → 375.0 KB JS and 33.2 → 47.8 KB CSS; `/login` 244.8 → 296.1 KB JS; `/reset-password` 239.7 → 289.0 KB; `/account` 297.3 → 327.7 KB (all + about 12 KB CSS); `/board/[id]` 1,050,446 → 1,049,619 B JS and 47.2 → 45.8 KB CSS (Tailwind no longer generates the classes the platform pages dropped). The platform increase is `motion`, Radix (dialog, dropdown, select, tabs) and the components themselves.

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
| `plans` | `id` text (`free`, `plus`, `pro`) | select | migration seed / SQL | retired with the monthly credits: only `free` is active, kept because `profiles.plan_id` references it |
| `profiles` | `user_id` -> `auth.users` | select own; update own **`display_name` only** (column-level grant, `PATCH {plan_id}` or `{ink_balance}` -> `42501`) | trigger `on_auth_user_created` (row per sign-up, `plan_id='free'`, then the 300 starter ink), the ledger triggers (a ledger row for a user without one creates it), SQL | `ink_balance` (CHECK `>= 0`, kept by the ledger triggers); `plan_id` (always `free`) and the `billing_*` columns stay for older code; deleted only with the account (a delete guard refuses anything else) |
| `ink_packs` | `id` text (`small`, `medium`, `large`) | select | migration seed / SQL | `ink`, `price_cents`, `sort`, `active`; equal to `PACKS` in `scripts/stripe-setup.mjs` (pinned by a test) |
| `ink_grants` | `id` identity | select own | sign-up trigger, `grant_ink_purchase()` / `reverse_ink_purchase()` / `resolve_ink_checkout_review()` / `grant_ink()` (service role), SQL | all ink that came in: `kind` starter / purchase / refund (negative) / manual; one starter per user; append-only (no updates of `units`/`user_id`, no deletes except the account's cascade) |
| `ink_purchases` | `id` identity, unique `checkout_session_id` | select own | `grant_ink_purchase()` (webhook), `resolve_ink_checkout_review()` (operator) | one row per paid Checkout Session: pack, ink, amount, `payment_intent_id`, `status` paid / partially_refunded / refunded, `refunded_ink`, `refund_unrecovered_ink`; never deleted except with the account |
| `ink_checkout_reviews` | `id` identity, unique `checkout_session_id` | nothing (service role only) | the webhook (`record_ink_checkout_review()`, `grant_ink_purchase()`) | Agathon checkouts that did not become ink: no or a bad `client_reference_id`, an unknown pack, an account gone, or an amount that does not cover the pack (underpaid, free, unpriced, not USD); `status` open / resolved / refunded; carries the payer's email, so no user can read it. `user_id` is set null when the account is deleted |
| `usage_events` | `id` identity, `(user_id, created_at)` index | select own | `consume_credits()` only | one row per metered API call: `route`, `units` (> 0), `model`, `request_id`; the ink spent. Deleted only by `refund_ink_for()` (a failed call) or with the account |
| `credit_grants` | `id` identity | select own | nothing since ink | the monthly-credit era's extra grants; history only |
| `billing_events` | `id` text (provider event id) | nothing | webhook (service role) | idempotency log of the events the webhook acted on (never another app's events on the shared Stripe account) |
| `rate_limit_counters` | `(user_id, bucket, window_start)` | nothing (function-only; RLS on, no policies) | `rate_limit_hit()` only | fixed-window hit counter shared by every server instance: `hits`, `expires_at` (= `window_start` + 2 windows; expired rows are removed by the next call). No FK to `auth.users` on purpose: rows age out within two windows |

Ink (migration `20261002000000_ink.sql`): the balance is all ink granted minus all ink used, all-time, stored in `profiles.ink_balance` and kept by triggers on `ink_grants` (insert) and `usage_events` (insert, delete) in the same transaction as each ledger row; the CHECK makes a negative balance impossible. Delete guards on `usage_events`, `ink_grants`, `ink_purchases` and `profiles` refuse every delete (`42501`, even for the service role and `postgres`) except an account deletion's cascade and `refund_ink_for()`, so no delete can mint ink or leave the stored balance wrong; corrections are new rows. Five `security definer` RPCs are the only way a user token touches the ledgers or the rate-limit table, each callable by `authenticated` only and each acting on `auth.uid()`:

| RPC | Returns | Behaviour |
| --- | --- | --- |
| `ink_summary()` | `{balance, granted, purchased, refunded, used, starter, starter_at, purchases, last_purchase}` | `used` = granted - balance; grants a missing profile or starter first (the sign-up trigger never blocks sign-up) |
| `credit_summary()` | the pre-ink keys `{plan_id, plan_name, monthly_credits: 0, used, granted, remaining, period_start, period_end, billing_status, current_period_end}` + `balance` | kept for older callers; consistent for ink (`remaining` = balance = `monthly_credits + granted - used`) |
| `consume_credits(p_route, p_units, p_request_id?, p_model?)` | `{ok, remaining, reason}` | Locks the caller's `profiles` row `FOR UPDATE` before reading the balance (parallel calls serialize, never overspend); `p_units` 1..1000 else `400`; short: `ok:false, reason:'insufficient_credits'`, nothing written; otherwise inserts one `usage_events` row (the trigger takes the ink) |
| `rate_limit_hit(p_bucket, p_limit, p_window_ms)` | `{allowed, remaining, retry_after_ms, backend:'db'}` | Fixed window aligned to the Unix epoch, keyed `(auth.uid(), p_bucket, window_start)`; one atomic `insert ... on conflict do update set hits = hits + 1`, so exactly `p_limit` parallel calls per window are allowed; `retry_after_ms` = ms until the window ends (0 when allowed); `p_limit` 1..1,000,000 and `p_window_ms` 1..86,400,000 else `400`. Cleans the caller's expired rows for the bucket on every call and, on ~2% of calls, everyone's |
| `delete_own_account()` | void | Deletes the caller's `auth.users` row; every table above cascades (`bug_reports` keeps anonymised rows). Storage objects are not touched - see the runbook, section 13, for why and for the GC path |

One read-only RPC is `security invoker` instead, so the `usage_events` owner policy decides what it sees: `usage_by_day(p_time_zone, p_days?)` -> rows `{day, route, events, credits}` (credits = ink), the caller's spend grouped by calendar day in `p_time_zone` (the browser's IANA zone; unknown -> `400`) and route, newest day first; `p_days` 1..366 = the last that many days (`/account` asks for 30), null = the current UTC month as before. `/account` reads it instead of downloading thousands of ledger rows. Migrations `20260927000000_usage_by_day.sql`, `20261002000000_ink.sql`.

The rest are `security definer` functions for the service role only (the API's refunds, the billing webhook and the operator):

| Function | Called by | Behaviour |
| --- | --- | --- |
| `refund_ink_for(p_user_id, p_request_id)` -> `{refunded, remaining}` | `refundInk` in the paid routes | Deletes that user's `usage_events` rows with that `request_id` **created in the last 15 minutes** (same profile lock as `consume_credits`; the delete trigger gives the ink back); 0 for an unknown id, another user's id or an older row; idempotent; `p_request_id` 1..100 chars else `400`. `refund_credits(p_request_id)`, the user-callable version from `20260917030000_refunds_ratelimit.sql`, still exists with its signature but no user can execute it: every 2xx hands the user its request id, so a self-refund would have made ink free |
| `grant_ink_purchase(user, pack, checkout_session_id, payment_intent?, customer?, amount_cents?, currency?, email?, event_id?)` | the webhook | One purchase and grant per Checkout Session (a replay answers `duplicate`), and only when `amount_cents` in `currency` is USD and at least the pack's price; otherwise (or for an unknown pack or a missing account) records the session in `ink_checkout_reviews` with no ink and answers `review: true` |
| `record_ink_checkout_review(session, reason, …)` | the webhook | A checkout it cannot map at all (no user, no pack), idempotent per session |
| `resolve_ink_checkout_review(review_id, user?, pack?, note?)` | the operator | Turns an open review into a real purchase (so a later refund reverses it like any other), once |
| `reverse_ink_purchase(payment_intent_id, cumulative_refunded_cents, charge_cents?, fully_refunded?)` | the webhook | Takes the refunded share of the pack's ink back, at most the balance, acting only on the growth of the refunded amount; a refund of a reviewed checkout marks the review `refunded` and takes nothing; `found: false` when neither exists |
| `grant_ink(user, units, reason)` | the operator | Manual grants; a negative one stops at zero |

Storage: bucket `board-assets` (public read, owner-folder writes, `<uid>/<boardId>/<assetId>.<ext>`) and `training-data` (private, trainers, `<uid>/<sampleId>/...`). `storage.objects` has no FK to `auth.users`; ownership is the first path segment, and objects are only ever deleted through the Storage API.

## Routes

Every handler under `src/app/api/**` follows the same preamble: `requireUser` (JWT) -> `checkRateLimitDistributed` (per-user budget from `LIMITS` in `src/lib/server/rate-limit.ts`, counted in Postgres by the `rate_limit_hit` RPC so one budget holds across every server instance; see "Rate limiting" below) -> `parseJsonBody` (zod) -> `enforceInk` (ink metering, see "Billing" below; only on routes with a non-zero cost) -> the paid work inside `runCharged` / `runChargedStream`, which refund the charge when the call fails (see "Refunds"). The Live routes get the same steps from `livePreamble` + `enforceInk` and additionally echo a `X-Request-Id` header. The table is the source of truth mirrored by `scripts/lib/routes.mjs`; `src/__tests__/routeProtection.test.ts` fails when a route file is added, removed, or drops one of the helpers, `src/lib/server/__tests__/routes.refunds.test.ts` fails when a charged route stops refunding or a user route falls back to the per-instance limiter, and `scripts/live-smoke.mjs` probes every row over HTTP (401 without a token, 200 for the public route, a 429 on `/api/credits` carrying `backend: 'db'` when the RPC exists).

| Path | Methods | Auth | Limit (per min) | Ink | Body schema | Purpose | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/config/status` | GET | **public** (reason: booleans-only setup status) | `ip:<x-forwarded-for>:configStatus` 60 | 0 | none | Which provider keys are configured, booleans only; needed by the setup screen before sign-in | active |
| `/api/billing/webhook` | POST | **public** (reason: signature-verified provider webhook) | `ip:<x-forwarded-for>:billingWebhook` 120 | 0 | raw text, `Stripe-Signature` verified, then zod `{ id, type, data.object }` | Ink pack purchases and refunds via service-role RPCs (`grant_ink_purchase`, `reverse_ink_purchase`, `record_ink_checkout_review`); events that are not Agathon's (the shared account's other app) are ignored and stored nowhere; `400 invalid_request "bad signature"` without a valid signature, `400 "livemode mismatch"` for an event from the other Stripe mode (`STRIPE_LIVEMODE`), `503 feature_unavailable` without `STRIPE_WEBHOOK_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` or with a malformed `INK_PRICE_MAP`, `500` for a failure a retry could fix (including a refund that arrives before its purchase) | active |
| `/api/admin/gc` | GET, POST | **public** (reason: Vercel cron; requires `Authorization: Bearer CRON_SECRET`, compared in constant time) | `ip:<x-forwarded-for>:adminGc` 10 | 0 | none (a Vercel cron invocation collects; a manual request reports unless `?dryRun=0`) | Storage garbage collection via the service role: orphaned `board-assets` / `training-data` objects older than 24 h (same planner as `scripts/gc-storage.mjs`); `401 unauthorized` without a matching bearer, `503 feature_unavailable` without `CRON_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` | active |
| `/api/credits` | GET | `requireUser` | `credits` 30 | 0 | none | The operator's OpenRouter balance (operators, smoke tests; 30 s shared cache) | active |
| `/api/live/recognize` | GET, POST | `requireUser` / `livePreamble` | `liveRecognize` 120 | GET 0; POST 1 | GET none; POST `RecognizeRequestSchema` | GET capabilities + warmup; POST strokes -> LaTeX (Mathpix, vision fallback) | active |
| `/api/live/check` | POST | `livePreamble` | `liveCheck` 30 | 3 | `CheckRequestSchema` (optional `crop` data:image ≤ 280 KB, only with `userAsked` + `focusLineId`) | SSE annotations for recognized lines; with `crop` ("Ask about this") the crop goes to the check model as an image part | active |
| `/api/live/solve` | POST | `livePreamble` | `liveSolve` 10 | 10 | `SolveRequestSchema` | SSE worked-solution steps | active |
| `/api/live/setup` | POST | `livePreamble` | `liveSetup` 10 | 2 | `SetupRequestSchema` (`lines` 0–40 strings; optional `crop` data:image ≤ 280 KB and `labels` ≤ 40, labels only with a crop; lines or a crop required) | A word problem → `{ lines, unknown?, model, ms }`: LaTeX assignments / equations only (no arithmetic, no words), which the client's engine then solves. `openai/gpt-5.4-mini`, fallback `deepseek/deepseek-v4.1-flash` (`LIVE_MODEL_SETUP`). With a `crop` it is a hand-drawn **figure** (asked about, or in Solve left labelled with an unknown): the model describes what the figure shows and `planFigure` (`src/lib/live/figure`) writes the equations — `{ lines, unknown, figure: { source: "facts", stages: [{ letter, lines, value, kind }] } }` — or, when that read does not hold up, its own lines (`figure: { source: "lines", reason, kind? }`); read by `google/gemini-3.1-flash-lite`, fallback `google/gemini-3.5-flash-lite` (`LIVE_MODEL_FIGURE`, prompt `prompts/figure.ts`; chosen on `npm run eval:figures`). A reply with no lines is a 502 (refunded) | active |
| `/api/live/reread` | POST | `livePreamble` | `liveReread` 30 | 1 | `RereadRequestSchema` (`crop` data:image ≤ 280 KB, Mathpix's `latex`, the column's `above` / `below`) | The second reader: one suspicious line's ink crop → `{ latex, changed, model, ms }`. `google/gemini-3.1-flash-lite`, fallback `anthropic/claude-haiku-4.5` (`LIVE_MODEL_REREAD`). Only sent on a signal, at most once per ink | active |
| `/api/live/chat` | POST | `livePreamble` | `liveChat` 12 | 3 | `ChatRequestSchema` (`message` 1–500 chars, `history` ≤ 6 turns, `screen`: `empty`, the student's lines, the tutor's lines, the problems written there and their `numbers` on the board; optional `problem` ≤ 600 chars: the problem the student typed earlier, when it has left `history`) | The board chat: a typed request → `{ reply, actions, notes, refunded?, model, ms }` (`src/lib/live/chat/contracts.ts`); actions validated one by one with zod, an invalid one dropped; a `help_problem` for a number not on the screen dropped with a note. `openai/gpt-5.4-mini`, fallback `deepseek/deepseek-v4.1-flash` (`LIVE_MODEL_CHAT`; chosen on `npm run eval:chat`). A `draw_figure` that `checkFigure` finds problems with gets one repair call per request; still wrong, it is dropped with a note. A `write_proof` goes on only when the engine's proof planner proves it (`gateChatProof` → `checkProofProposal`); one it cannot gets one repair call with the engine's problems, else it is dropped with a note. A `teach` (a worked solution) goes on only when the engine has checked every line of its maths (`gateChatTeach` → `checkTeach`, on the maths engine loaded in the route on the first one); one it cannot check gets one repair call with the engine's findings, else it is dropped with a note (its figure, still wrong after the repair, is left out and the working goes on). When every proposed action was dropped the reply says so and the charge is refunded (200, `refunded: true`) | active |
| `/api/live/lecture` | POST | `livePreamble` | `liveLecture` 12 | 2 per started minute of a session | `LectureRequestSchema` (`session` id, `context` + `fresh` transcript ≤ 2,400 chars each, `screen`: `empty`, `topic`, what is `drawn`, `room`, the ≤ 2 `active` live visuals with their specs; `recent`; `force` for "Draw that") | Lecture mode's director: recent transcript → `{ actions, notes, charged?, model, ms }` (`src/lib/live/lecture/contracts.ts`), usually no actions; `heading`, `note`, `chart`, `diagram`, `update_chart` / `update_diagram` (the whole new spec of a live visual), and the chat's `graph`, `draw_figure`, `write_lines`, `new_screen`; each validated with zod and dropped when invalid (`cleanLectureActions`). `deepseek/deepseek-v4.1-flash`, fallback `openai/gpt-5.4-mini` (`LIVE_MODEL_LECTURE`; `npm run eval:lecture`). Billed per minute: the first request of each wall-clock minute of a session charges under `lec:<session>:<minute>`, the rest of that minute find the charge and are free (`lectureMinuteId`) | active |
| `/api/live/lecture/sketch` | POST | `livePreamble` | `liveSketch` 12 | 4 | `SketchRequestSchema` (`session`, a panel's `prompt` ≤ 240 chars, the sketch's shared `cast`, `panel` index/of, the frame's `aspect`) | Free drawing: one panel (a picture, or one panel of a comic) → `{ drawing, model, ms }`: the illustrator's SVG (`google/gemini-3.8-flash`, fallback `anthropic/claude-sonnet-5.5`, `LIVE_MODEL_SKETCH`; `npm run eval:sketch`) parsed as a safe subset and sampled into strokes (`src/lib/server/sketch/**`, `SketchDrawingSchema`); nothing usable → 502, refunded | active |
| `/api/live/lecture/token` | POST | `requireUser` | `liveListen` 6 | 1 | none | A single-use ElevenLabs realtime speech-to-text token (`realtime_scribe`, 15 min) and the websocket URL for the browser's microphone session (`ListenTokenResponseSchema`); `503 listen_not_configured` without `ELEVENLABS_API_KEY` (no charge) or when ElevenLabs rejects the key (refunded), and the client falls back to the browser's recognizer | active |
| `/api/client-errors` | POST | **public** (reason: browser error reports, sent signed out too; per-IP limit, 16 KB body cap, zod; logs only) | `ip:<x-forwarded-for>:clientErrors` 20 | 0 | read as a stream, 413 over 16 KB, then JSON + zod (`source`, `message` ≤ 1,000, `stack` ≤ 4,000, `path` starting `/`, optional `boardId`, `userAgent`, `release`, `digest`; unknown keys dropped) | Client error reporting (`src/lib/clientErrors.ts`, loaded lazily by `src/lib/reportAppError.ts` from `src/instrumentation-client.ts` and the error boundaries): one `client-error` log line, 204. A bearer token, when sent, only adds the user id (`identifyUser`, never a 401, never logged). Query strings and hashes are stripped from the path and from every URL in the message and stack, in the browser and again here. See `docs/RUNBOOK-ops.md` | active |
| `/api/health` | GET | **public** (reason: uptime monitor probe; answers `{ ok, db, release }` only) | `ip:<x-forwarded-for>:health` 30 | 0 | none | Uptime probe: 200 `{ ok: true, db: "up", release }` when Postgres answers one PostgREST read with the anon key within 3 s (anon's `42501 permission denied` counts: Postgres ran the query), else 503 `{ ok: false, db: "down", release }` and a `health` warn line with the reason; `Cache-Control: no-store` (`src/lib/server/health.ts`) | active |

Notes:

- Non-Live routes mint a `requestId` for their log lines but do not return it as a header; only `/api/live/*` sets `X-Request-Id` (via `withRequestId`). Extending the header to the other routes is a follow-up, not a contract today.
- Rate limiting. User-keyed buckets go through `checkRateLimitDistributed({ token, userId, bucket })`: with `RATE_LIMIT_BACKEND=db` (the default) it calls `rate_limit_hit(p_bucket, p_limit, p_window_ms)` as the user — a fixed window keyed `(auth.uid(), bucket, window_start)` in `rate_limit_counters`, incremented with one atomic upsert, so exactly `limit` calls per window succeed no matter how many instances or parallel requests. When the RPC is missing or errors, the call degrades to the in-memory sliding window (`checkRateLimit`, key `${userId}:${bucket}`, logged once per process) — a weaker limiter, never an open gate; `RATE_LIMIT_BACKEND=memory` selects that limiter outright. The two public routes have no user, so they always key the in-memory limiter on the first hop of `x-forwarded-for` (falling back to `x-real-ip`, then `unknown`). A 429 keeps `{ error: 'rate_limited', message, retryAfterMs }` + `Retry-After` and additionally reports `backend: 'db' | 'memory'`.
- No route reads `process.env` directly; provider keys come from `getServerEnv()` (`src/lib/env.ts`) or `src/lib/aiConfig.ts`, which both reject `.env.example` placeholder values.
- Deprecated routes stay on their paths with the same contract until a documented removal; marking them deprecated here (and in `scripts/lib/routes.mjs`) is the only change. Removed (with the image pipeline): `/api/generate-solution`, `/api/generate-worksheet`, `/api/ocr`, `/api/check-help-needed` — their `usage_events` rows keep their route keys and read as "(retired)" on the account page.
- The "Ink" column is `ROUTE_COSTS` in `src/lib/server/billing.ts`; a route with a non-zero cost calls `enforceInk` and can answer `402 ink_empty` or `503 feature_unavailable` before its provider call. The charge is refunded when the provider call then fails (non-streaming: any non-2xx; SSE: failure before the first annotation/step) — see "Refunds" under Billing.
- The two public routes are allow-listed in `PUBLIC_ROUTES` with a reason in `PUBLIC_ROUTE_REASONS` (`scripts/lib/routes.mjs`); `routeProtection.test.ts` additionally asserts that the webhook reads the raw body (`req.text()`, never `req.json()`) and calls `verifyStripeSignature` — the real invariant behind its public status.

## Billing

Ink is the unit (1 ink = 1 of the monthly credits it replaced); the schema is `supabase/migrations/20261002000000_ink.sql` (operator side, packs, prices, manual grants, refunds and going live: `docs/RUNBOOK-billing.md`). There are no plans or subscriptions any more: `plus`/`pro` are inactive rows and nothing sells them.

- **Balance.** All ink granted minus all ink used, all-time, never expiring: a new account gets 300 starter ink once (the sign-up trigger; the beta's accounts got `max(300, what they had left that month)`), packs add more, every AI action spends some, drawing is free. Stored in `profiles.ink_balance` (CHECK `>= 0`) and kept by triggers on `ink_grants` / `usage_events` in the same transaction as each ledger row, so it is one row to read however long the history grows; see the migration header for why it is stored rather than summed. The client reads `ink_summary()` (`useInkSummary`, `src/lib/billing/inkSummary.ts`).
- **Metering runs as the user.** `requireUser` also returns the verified access token; `enforceInk({ token, route, requestId, model })` (`src/lib/server/billing.ts`) builds a supabase-js client with the anon key + `Authorization: Bearer <token>` and calls the SECURITY DEFINER RPC `consume_credits(p_route, p_units, p_request_id, p_model)` (its name predates ink). The function locks the caller's profile row before it reads the balance and inserts a `usage_events` row (the trigger takes the ink), so parallel requests cannot overspend; it returns `{ ok: false, reason: 'insufficient_credits', remaining }` without writing when short. A user can only spend their own ink and nothing exposed to `authenticated` can add any (column-level grants: a user may update `display_name` only).
- **Placement.** After auth + rate limit + body validation and **before** the upstream call, for every route — including the SSE routes (`check` / `solve`), where a refusal is a JSON `402` instead of a stream. Charging up-front keeps the balance check atomic (no window between "check" and "spend"); what the provider then fails to deliver is given back by a refund.
- **Refunds of failed calls.** `refundInk({ userId, requestId })` calls the SECURITY DEFINER RPC `refund_ink_for(p_user_id, p_request_id)` with the **service role** (`serviceClient()` in `src/lib/server/billing.ts`, the one thing the user-facing routes use it for), with the user id `requireUser` verified from the JWT: it deletes that user's `usage_events` rows carrying that `request_id` and younger than 15 minutes (the delete trigger gives the ink back), and returns `{ refunded, remaining }`. A user cannot refund anything themselves: `refund_credits`, the user-callable RPC this replaced, is no longer executable by `authenticated`, because every 2xx hands the user its request id and a self-refund within 15 minutes would have made every call free (`verify-rls` asserts the denial). `refundInk` never throws (a refund that cannot happen is logged and reported as `{ refunded: 0, reason }`); without `SUPABASE_SERVICE_ROLE_KEY` no failed call is refunded (logged), so any deployment that enforces billing needs the key; with `BILLING_ENFORCE=0` it does nothing because nothing was charged. The `requestId` refunded is the very one passed to `enforceInk` (asserted per route by `routes.refunds.test.ts`). Two wrappers apply it: non-streaming routes (`live/recognize` POST, `live/setup`, `live/reread`, `live/chat`, …) run their provider call inside `runCharged`, which refunds whenever the Response handed to the client is not a 2xx — `UpstreamError` (502), the provider account running dry (503), `recognizer_failed` (502), timeouts/aborts (500). A 2xx is never refunded. The SSE routes (`live/check`, `live/solve`) run inside `runChargedStream`, which refunds only when the stream fails **before the first annotation / step was emitted**; a failure after partial output keeps the charge (the user has the partial result and the model was paid), and the `error` frame is still sent either way.
- **Prices** (`ROUTE_COSTS`, ink per call): recognize 1, check 3, solve 10; **setup 2** — a word problem's equations, or a drawn figure's (the same route with a crop), below solve because the engine does the solving (when the setup is unusable the board then calls solve as well, 12 in all; a setup call that returns nothing is refunded); **chat 3** — one board-chat request: one planning call (problems, lines, a graph, a figure spec, a proof, a worked solution) and at most one repair each for a figure, a proof and a worked solution; the engine checks every problem and every line of a worked solution, so no solve model is involved; refunded when nothing it proposed could be used; **lecture 2 a minute** — lecture mode's director, charged once per started wall-clock minute of a session however often it is asked (every ~8 s while numbers or steps are coming), which covers the director and the realtime recognizer (~$0.39 an hour); **listen 1** — one realtime speech-to-text session opened (a single-use ElevenLabs token); **sketch 4** — one panel drawn by lecture mode's illustrator (a comic of four is 16; ~$0.009 a panel on Gemini 3.8 Flash); **reread 1** — the second reader reads one line again, priced like recognize. It is never asked for by the student: it fires only on a signal (a read the engine cannot read, a symbol implausible in its column, or a confidence below 0.6), at most once per ink stroke group, which on the handwriting scoreboard is 17 of 20 misreads and none of 704 correct reads — so in practice a few percent of lines at most. At pack prices 1 ink is $0.0036-$0.005.
- **Responses.** `402 { error: 'ink_empty', message: "You're out of ink. Grab an ink pack to keep going.", remaining, cost, buyUrl: '/account' }` (`cost` = the refused action's price, so the board knows how much ink clears the error). It is the only 402 the API sends: the operator's OpenRouter account running dry (`CreditsExhaustedError`) is a `503 upstream_error` ("The tutor is unavailable right now…"), because buying ink could not fix it. When metering is enforced but the RPC is missing or the database errors, the route fails closed with `503 feature_unavailable` ("Billing is not set up on this deployment — run the migrations."). `BILLING_ENFORCE=0` skips consumption entirely (logged once per process) — a dev/staging escape hatch, never for production.
- **Ink comes in** only through `POST /api/billing/webhook` (service role) or SQL. The webhook is Stripe-compatible without a payment SDK: `Stripe-Signature: t=…,v1=…` is HMAC-SHA256 over `${t}.${rawBody}` with `STRIPE_WEBHOOK_SECRET`, 5-minute tolerance, constant-time compare, Web Crypto only (`src/lib/server/webhookSignature.ts`). `mapBillingEvent` (pure) first decides whether the event is Agathon's at all — the Stripe account is shared with Fuime, whose checkouts and refunds arrive here too: a Checkout Session is ours only with `metadata.app = "agathon-classroom"`, a refund only when its charge carries that tag or its payment intent is a recorded `ink_purchases` row (a read). Anything else answers `200 { received: true, ignored: true }` and writes nothing, not even to `billing_events`. Before that, an event from the wrong Stripe mode is refused (`400 "livemode mismatch"`): `STRIPE_LIVEMODE=true|false` names the mode; unset, a deployment takes live events only and a localhost dev server either. Ours: the event id goes into `billing_events` (the log of Agathon events received), then
  `checkout.session.completed` / `checkout.session.async_payment_succeeded` with `mode: 'payment'` and `payment_status: 'paid'` -> `grant_ink_purchase` for `client_reference_id` (our user id) with the pack from `metadata.pack_id`, else `INK_PRICE_MAP[price id]`, and the amount actually paid (`amount_total` in the session's currency, or under Adaptive Pricing the `currency_conversion` source amount in USD): one `ink_purchases` row per Checkout Session id (unique) and its `purchase` grant, so a replay or both events for one session grant once. A session that is ours but cannot become ink — not `paid` (`no_payment_required` counts as not paid), no or a bad `client_reference_id`, no pack, an amount below the pack's price or not in USD, a deleted account — goes to `ink_checkout_reviews` with no ink and a loud `warn` log ("Agathon checkout NOT granted"), for the owner (runbook). The Payment Links refuse promotion codes (`allow_promotion_codes: false`), so an underpaid session should never happen;
  `charge.refunded` -> `reverse_ink_purchase` with the charge's cumulative `amount_refunded`: the refunded share of the pack's ink comes off, at most the current balance (spent ink stays spent; `refunded_ink` and `refund_unrecovered_ink` record which), and only the growth of the refunded amount counts, so replays reverse nothing. A refund that is ours but whose purchase is not recorded yet (it overtook its checkout) answers `500`, so Stripe retries until the grant has landed; a refund of a reviewed checkout closes the review.
  Every step is idempotent, so a redelivered event is applied again rather than skipped: a first attempt that failed half-way still ends with the ink. A failure a retry could fix answers `500` (and deletes the `billing_events` row again, loudly logged if that fails too). The raw payload is only ever logged at `debug`.
- **Checkout (Stripe Payment Links, no server secret).** `NEXT_PUBLIC_BILLING_LINKS` (`{"small": url, "medium": url, "large": url}`, printed by `scripts/stripe-setup.mjs`) holds one Payment Link per pack (one-time price, payment mode, `metadata { app, pack_id, price_id }`, `payment_intent_data { metadata { app, pack_id }, statement_descriptor_suffix: 'AGATHON' }`); without it every buy button shows a disabled "Coming soon" and everything else works. `src/lib/billing/checkout.ts` (`payerLinks`) appends `client_reference_id=<user id>` and `prefilled_email=<email>` (a link without a user id is not offered). From the board the link opens in a **new tab**; from `/account` in the same tab. It redirects to `/account?ink=<pack>`; there `InkReturnNotice` shows "Adding your Medium pack…", re-reads `ink_summary()` every 2 s until `last_purchase` is that pack and **newer than the purchase the student had when they left for checkout** (the buy button stores `{at, lastPurchaseId}` under `agathon:ink-checkout` in localStorage, so the board's new tab can read it; without the mark only a purchase from the last two minutes counts), then "Ink added" and every ink surface, in this tab and others, re-reads via `notifyInkChanged`; after 60 s it says the confirmation has not arrived yet, with Check again (`inkReturnState`). `useInkSummary` re-reads on focus, on returning to the tab, every 3 s for up to 10 minutes after a buy button (`watchInkCheckout`, stopping once the balance grows) and on the storage ping from another tab, so bought ink appears without a reload.
- **The ink meter** (`InkBottle` filled to the balance, square-root scaled and full at 1,000, plus the number): in `AppHeader` (links to `/account`) and the board bar (`InkMeter`, opens the ink dialog). Under 100 ink (`LOW_INK`) it turns a calm amber with "Get ink"; at 0, red. It follows spending without polling: `authedFetch` reports every `POST /api/live/*` (`noteInkSpend` -> `INK_SPENT_EVENT`); a `402` carries the server's `remaining`, which the meters show at once, and any other paid call triggers one debounced re-read (1.5 s). On the board, the Live "out of ink" pill stays until the balance covers the action that was refused (`clearInkErrorIfAffordable`, with the 402's `cost`), not merely until it is above zero.
- **Running out on the board.** A Live route's `402 ink_empty` becomes a LiveError with code `ink` (`classifyLiveFailure`, via `isOutOfInk` in `src/lib/api-client.ts`); `OutOfInkWatcher` (first load: the watcher and `src/lib/billing/inkDialog.ts`) opens `OutOfInkDialog` (lazy: `React.lazy`) once per visit to the board, only after the pen has rested (no pointer down, 1.5 s since the last pointer event), so it never lands mid-stroke. The meter's and the status pill's "Get ink" open it on demand (`openInkDialog`, a window event). `OutOfInkPanel` says what happened ("You're out of ink" / "Get more ink"), that the board is saved and drawing is free, and lists the three packs with prices and ink per dollar, each a buy button to its Payment Link in a new tab; when the purchase lands while it is open it says "Ink added". The Ask and lecture panels render the same panel inline (lazy). The amber state is a polite `role="status"`; only "out of ink" is `role="alert"`.
- **`/account`**: the Ink card (a large `InkBottle`, the balance, and where the ink came from and went: starter, packs, refunds, manual grants, used), the packs grid (price, ink, ink per $1, the bonus over Small, "Best value"), purchase history (`ink_purchases`: date, pack, ink, amount, paid / refunded with what the refund took back), and usage over the last 30 days (`usage_by_day(zone, 30)`).
- **Bundle.** `/board/[id]` first load 1,058,632 B gzip (budget 1,060,000; the last figure recorded above, before ink, was 1,059,093 B): the meter replaced `CreditsBanner`, and the board no longer imports the plan view model, so no budget change was needed.

## Error contract

Every route returns JSON `{ error: <code>, message: <text> }` on failure:

| Status | `error` |
| --- | --- |
| 400 | `invalid_request` |
| 401 | `unauthorized` |
| 402 | `ink_empty` (+ `remaining`, `cost`, `buyUrl`) |
| 429 | `rate_limited` (+ `Retry-After` header) |
| 502 | `upstream_error` |
| 503 | `voice_unavailable`, `feature_unavailable`, `upstream_error` (the provider's own account ran dry) |
| 500 | `internal_error` |

The client maps `unauthorized` to a redirect to `/login`, `rate_limited` to a retry hint, and `ink_empty` (any 402; `isOutOfInk`) to "You're out of ink" with a way to the packs; on the board, to the ink dialog and the Ask and lecture panels' inline panel (Billing, "Running out on the board").

## Security model

- **Server-side JWT verification on every route.** `authedFetch` sends the Supabase access token; each handler calls `requireUser`, which verifies the token against the project's Supabase Auth (`auth.getUser(token)`) and rejects with `401 unauthorized` otherwise. Route handlers never trust user ids from the body.
- **Per-user rate limits.** Each user route has a per-user budget (`LIMITS`) counted in the database by `rate_limit_hit` and shared across instances, with the in-memory sliding window as fallback; exceeding it returns `429` with `Retry-After`. Together with up-front metering plus refunds this bounds provider spend per account.
- **Input validation.** Request bodies are parsed with zod; image payloads have size caps; unknown models are rejected.
- **Provider keys stay on the server.** Only `NEXT_PUBLIC_*` variables are exposed to the bundle. `SUPABASE_SERVICE_ROLE_KEY` is used by two non-user-facing request paths — `POST /api/billing/webhook`, after the provider signature has been verified, and `GET|POST /api/admin/gc`, after the `CRON_SECRET` bearer has matched — by the paid routes for one call only, `refund_ink_for(user id from the verified JWT, the request's own id)` after a failed provider call (`refundInk`), and by admin scripts (`scripts/offload-assets.mjs`, `scripts/gc-storage.mjs`). Everything else a user-facing route does acts as the user (their own JWT): metering, rate limits, reads.
- **Row Level Security.** All tables have RLS enabled, `anon` has no grants, and policies compare `user_id` with `auth.uid()`. Storage policies restrict writes to the caller's own folder (`<uid>/...`). Trainer features are gated by the `trainers` table via `is_trainer()`, not by client-side checks.
- **Boundaries.** `error.tsx` / `global-error.tsx` catch render errors without leaking stack traces; `X-Powered-By` is disabled; the site is `noindex` while in staging. What they catch, uncaught browser errors and unhandled rejections are reported to `POST /api/client-errors` (module `client-error`), and errors the Next server captures are logged by `onRequestError` in `src/instrumentation.ts` (module `server-error`), all tagged with the build's `release` (`NEXT_PUBLIC_RELEASE`, the 7-character commit). Where to find them, the uptime check on `GET /api/health`, and release tagging: `docs/RUNBOOK-ops.md`.

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
  → splitInk → drawings (+ marks, labels) out   diagrams.ts: only handwriting goes on (+ division bars, a line each)
  → clusterLines(writing) → InkLine[]           strokeClusters.ts (union-find, fraction bars, operation rows, columns)
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

Solve steps / Help / the dial moved into Solve or Suggest, nothing of the student's to act on under a chat problem
  → the current problem (chat/work.ts)          the cell last written in, else the first open one
  → its lines as the column → localSolve        the rest worked out, or the next step (problemSteps)
  → by hand under it, in its cell (placeInCell), meta.problemWork; model only when the engine has nothing

Solve / Help on a drawing (the last thing drawn)
  → labels (one recognize call) + crop → POST /api/live/setup   the model describes the figure (facts)
      → planFigure: facts → equations (server)                 src/lib/live/figure/plan.ts
      → figureAnswer: engine solves, answer checked → by hand beside it (else nothing)

Solve, the student has stopped, a drawing labelled with an unknown and nothing written beside it
  → solveWantedFigures (after any graph) → the same path, unasked: once per figure-and-labels version

any student ink, anywhere (incl. pen-down, drag, erase)
  → settle gate 2.5 s (ANSWER_SETTLE_MS)        liveLoop.markUnsettled → renderSettled
  → re-render only → the held-back ANSWER lands  (no re-recognition, no model call)
  → each drawing's labels read, if they changed  one POST /api/live/recognize per drawing (label stack)
  → Solve: a labelled figure left alone           solveWantedFigures → POST /api/live/setup (once per version)
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

**No words on the board — except where a teacher writes them.** Everything the tutor puts on the page unasked is maths in its animated hand (`HandWriter`, blue), a hand-drawn mark (`src/lib/live/marks.ts`) or a graph sketched in the same hand (numbers, the axis letters and coordinates only; see "Graphs" below). Words appear in three places only, all asked for: lecture mode's headings, notes and labels; a proof's Given / Prove and reasons (the proof reader's own vocabulary); and a worked solution's sentences, one per step, when the student asks Ask to teach a problem (`teach`, "Board chat" below). The marks: a tick after a step the engine verified, a ring round a wrong one (the engine's `mismatch`, or a model annotation with `verdict: warn`, remembered on the echo as `meta.aiWarnLatex`), a question mark beside ink it cannot read — and, under a problem the tutor wrote, beside a line it read but cannot judge (see "No silent lines under a problem" below). There are no hint cards and no prose notes. Not even "or": several answers are a list (`x = 2, \ x = 3`, an inequality's union `x < 2, \ x > 3`), no solution is `\varnothing`, every number is `x \in \mathbb{R}` for an equation (`0 = 0`) and `-\infty < x < \infty` for an inequality, an excluded value is `x \neq 1`, a failed check is `\sqrt{4} \neq -2`. In Suggest and Solve, once the student stops (the settle), the right next step is written by hand beside a ringed line, computed by the engine from the last good line above (`suggestNextStep`); Help does it at once in any mode, and only asks the model for one step when the engine has none. The model's Solve steps are written as one handwritten block when the stream ends (typeset only if the hand lacks a symbol). The grey echo (the readback of what Mathpix read) shows only on hover, or while its ink is hovered or selected, and always when the device has the hand switched off. The dev "Mathpix" panel still shows every read.

**Marks may be immediate; answers must wait.** Two clocks, because "this line is finished" and
"the student has stopped" are different questions. `LIVE_TIMING.quietMs` (600 ms, per line) gates
recognition and everything that comments on work already done — the green check, the amber dot,
the solved chip, the note and the Feedback/Suggest hint ladder all keep that cadence.
`ANSWER_SETTLE_MS` (2.5 s, whole canvas, `liveLoop.ts`) gates every "here is the result" output:
the handwritten calculator answer, the echo's `resultLatex`, an unasked graph and an unasked figure answer. Any student ink restarts it — a
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
worked out by hand draws nothing new (the block carries `meta.solvedLatex`). Same price as any check (3 ink). It never fires by
itself: only `requestHelp` sets a crop, and the schema refuses one without `userAsked` + `focusLineId`.
When the ink touched last is a drawing or one of its labels (not a line), Help — and Solve steps —
read the figure instead ("Drawings", below); a drawing never gets a "?".

**The tutor works the problems it wrote (`src/lib/live/chat/work.ts`, `LiveLoop.workProblem`).** On a
screen of the chat's problems (or the onboarding's starter), a student with no line to act on — none at
all, or only ink the tutor cannot judge, like a lone `2` — is asking about "the current problem": the
one whose cell they last wrote in, else the first in reading order with no work of theirs and no
solution of the tutor's under it (a screen holds one set: the chat writes a set only on an empty
screen). One problem at a time, never every problem on the screen. Solve steps, Help in Solve and the
dial moved **into** Solve write the rest of it worked out under it; the dial moved into Suggest and Help
in Feedback / Suggest write its next step where the student would write (the first is the first step
the engine would tick under it — `\sin x = \frac{1}{2}` under `2\sin x = 1`, not the `0^{\circ} \le x <
360^{\circ}` Solve opens a trig equation with; each further Help the next). The work is Solve's own
path with the problem's lines as the column (`solveBuilt`: `localSolve`, a graph for an answer that
graphs, the model's `/api/live/solve` only when the engine has nothing), continued after whatever the
tutor already wrote there (`problemSteps`; a line that only restates the problem is left out), in the
problem's hand, under the problem in its cell (`placeInCell`: moved down past anything in the way,
smaller when the cell is tight, else clear space on the screen). Every block carries `meta.problemWork`
(`step` / `solution`, a solution also `meta.solvedLatex`) and `meta.lineId = problem:<the problem's
hand block>`, so nothing is written twice — a reload, the dial moved again, Solve steps pressed again (it
moves on to the next open problem, then does nothing). The dial acts only on an explicit switch, never
on load, and not when the current problem has the student's work under it; with work, Solve steps and
Help continue from the student's last good line as they always have. A student line under the tutor's
step is checked against the problem as before (the problem still heads the column).

**No silent lines under a problem.** Lone symbols, labels, half lines, prose, LaTeX the engine cannot
read and failed or unsure reads are silent by design — students write labels and scratch numbers. Under
a problem the tutor wrote, though, the student is answering it, and silence reads as a broken tutor. In
Feedback, Suggest and Solve such a line (`unjudgedReason` in `policy.ts`) gets the tutor's "?" once the
student has stopped writing (`renderSettled`, never mid-stroke), and loses it when rewritten into
something the engine judges (the tick or ring replaces it). Not on a line still being read (the
recognizer or the second reader), whose check is in flight or queued offline, a proof row, at the shape
cap, or when the read was refused for a reason writing again would not fix (signed out, out of ink).
Readable maths with nothing to compare (`x = 6` under a system) keeps today's silence. The mark carries
why (`meta.markWhy`: `unread` or `unjudged`); a "?" left under a stale line id after a reload is
replaced, not doubled.

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
alone. Asymptotes — where the function blows up, where it levels off, a slant line it runs along —
are dashed (not when they are an axis) with their equation at a clear end (`x = -1`, `y = 1`,
`y = x + 1`), and a window keeps a stretch of each branch beside a vertical one; a hole (a zero of
a bottom where both sides meet) is an open circle, the curve broken round it. The equation of an
asymptote written under the function (Solve's `x = -1`, `y = 1`) is that line, not a value put in.
A function written from one above (`g(x) = f(x - 3) + 1`, Solve's `y = 2f(x - 1) + 3` under
`f(x) = x^{2}`) is a transformation: parent and image together, the parent dotted, each named
(`f`, `g`), with the parent's key point, where it lands, and an arrow. *How it looks* is `graphing/`: `chooseWindow` keeps every key point and the origin in
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

**Figures drawn by the tutor (`src/lib/live/figureDraw/**`).** A geometry figure asked for (the board
chat's `draw_figure`) is data — `FigureSpec` (`contracts.ts`, zod): named points in figure units, y
up, and the segments, polygons, lines and rays, circles and angles that join and mark them — drawn
by the same hand as the graphs. `checkFigure` (`check.ts`, pure, ~2 ms: mostly laying out each label in the hand) returns
what is wrong in sentences a model can act on: a point used but not defined (a circle's `through`
included), a zero-length side, a 0° or 180° angle, a right-angle mark more than 3° off 90°, numeric
side labels that disagree with the drawn lengths by more than 10 % (each side against the most typical
one: "AB is labelled 3 and BC 4, but BC is drawn 2.1 times AB"), a degree label more than 5° off, equal
ticks / equal arcs / parallel arrows the drawing does not bear out, a label the hand cannot write
(`planHandwriting`'s `unsupported`) or that is a word, and more than 20 points, 48 marks or 28 labels.
`planFigure` (`plan.ts`) fits the figure to a box true to scale (one scale, y flipped, the ink with its
labels centred; a line runs on a third of its span past its outermost points with an arrowhead each
way, a ray past `to` only, a tangent as far either side of where it touches) and returns one `HandPlan`
in a teacher's order — sides a polygon at a time, lines, circles, angle marks (arcs, two or three for
equal angles, nested angles on separate radii, a small angle's arc longer; right-angle squares), ticks
and parallel chevrons, dots (where asked, on a point on nothing, and where a named point would not
otherwise show: a segment's end, a point along a line), then the writing — paced to ~4–5 s
(`graphPaceFor`), with each named point's px for placing work beside it. Every label tries a list of
spots, best first, and takes the first that touches no stroke (4 px clear of its centre line) and no
other label: a name along the middle of the widest gap between the strokes and marked angles meeting at
its point (a vertex's external bisector); a side's label beside its middle, away from its polygon's (or
closed triangle's, or the figure's) centre; an angle's label inside, on the bisector, just past the arc,
far enough out to clear both arms. A label with no clear spot shrinks the figure a little and it is laid
out again; a figure whose labels leave room grows back to fill the box. Side-by-side marks step ≥ 7 px
apart, because the board's pen is ~4 px wide. What they look like: `docs/figure/gallery.png`
(`FIGURE_GALLERY=1 npx vitest run src/lib/live/figureDraw/__tests__/gallery.test.ts`). Every stroke
carries the Live meta (`live: true`, `source: "ai"`), so the reader never takes a figure for the
student's ink (`isStudentInk`; `figureDraw/__tests__/liveReader.test.ts`). In development
`window.__agathonDrawFigure(spec)` draws one in free space on the current screen (`figureDraw/board.ts`).

**Board chat (`src/lib/live/chat/**`, `POST /api/live/chat`, `src/components/chat/**`).** An "Ask"
button beside the help tabs opens a panel (docked on the right on a desktop, a bottom sheet on a
phone; off by default, open/closed remembered per device, Esc closes it; the board refits so the whole
16:9 screen stays in view — `useScreenCamera` refits on any change of the board's size). The student or
teacher types a request ("5 two-step equations", "graph y = sin x from -2π to 2π", "draw a right triangle
with legs 3 and 4", "3 more like these", "a new screen", "clear your writing", a problem to be explained);
the panel shows the model's one-line reply and notes on anything left out, and the tutor carries it out on
the board in its hand — maths, and words only in a worked solution's sentences and a proof's reasons.
History is kept in memory per board for the session.
- **The request** carries the message, the last six turns and a picture of the current screen
  (`LiveController.chatScreen`: the student's lines as read, the tutor's lines, the problems the chat
  wrote there, empty or not), so "more like these" and "graph that" have something to refer to. Six
  turns is three asks: the owner's conversation (the problem, "now explain", "explain it step by step",
  "explain it by drawing", "but like the #'s", "do the actual problem") had lost the problem by its sixth
  ask, so the panel remembers the last problem the student typed (`problemFor` in
  `src/components/chat/chatView.ts`: a message long enough, with some maths and a question or an
  equation in it — not "5 two-step equations") and sends it as `problem` when the turns no longer hold
  it; the prompt shows it as "THE PROBLEM THE STUDENT GAVE".
- **The reply** is `{ reply, actions }`, at most six actions: `write_problems` (1–12 problems; a system
  is one problem of 2–3 lines), `write_lines` (maths as given, e.g. a formula), `graph` (relations in
  LaTeX, an optional window), `draw_figure` (a `FigureSpec`), `new_screen`, `clear_tutor`, `help_problem`
  (`{ problem, depth: "step" | "solve" }`: help with a problem on this screen, by its number there),
  `write_proof` (a two-column proof, below), `teach` (a worked solution, below). The
  prompt (`src/lib/server/prompts/chat.ts`) keeps words to where a teacher writes them, asks for problems
  a student at the level can solve with clean answers, gives the figure format true to scale, adds a
  new screen only when asked, and declines anything that is not maths help. Answers and working never
  go in the panel's reply; on the board only three ways: `help_problem`, `write_proof` (or `write_lines`
  for an algebra proof) and `teach`. "help me with 3", "I'm stuck
  on 2", "how do I start 3", "help me solve it" are `help_problem` depth `step`; "solve 3", "solve it",
  "show me how to solve it", "what's the answer to 1" depth `solve`; "it" is the problem the recent turns
  were about, else the only one, and a help request whose problem is clear never gets a question back.
  The route validates each action with zod and drops what does not parse (within a problem set, the
  invalid problems), never guessing; a `help_problem` about a number the screen does not have is dropped
  with the note "There's no problem 7 on this screen." (the reply, refunded, when nothing else is left).
  The request's `screen.numbers` gives each problem's number as on the board (5–8 on a spill screen).
- **On the board** (`LiveController.runChatActions` → `ChatDesk`, `chat/desk.ts`, hosted by the loop
  like `ProofDesk`): the actions run in order, each one whole `HandWriter` block, after any writing
  of the loop's own; a switch to another screen stops the rest. Problems are verified first
  (`chat/verify.ts`: every line reads as maths, none is false on its face, `localSolve` answers it,
  the hand can write it) and the rest reported ("2 of 5 problems couldn't be checked…"); they are
  numbered `1.`, `2.`… in a grid at hand size 48 (1–3 across, 4 as 2×2, 5–6 as 3×2, at most six a
  screen, more spread evenly over more screens) with ~400 px under each to work in — on this screen
  when it is empty, else on a new one, and the desk waits for the loop to take a new screen in before
  writing (tldraw's store listeners run a frame later). Lines, a graph (the engine's `graphFor` and the
  same `planGraph` sketch as the unasked graphs, with the asked window — `GraphWindowHint` — and its
  equation above it) and a figure (`planFigure`) go in the first free space in reading order, a
  problem's whole cell counting as taken; no room means a new screen. `clear_tutor` is Clear marks.
- **Checking work under a problem the chat wrote.** Every stroke of a problem carries
  `meta.chatProblem = { n, lines, cell }`. After clustering (and after a reload) the columns are split
  at the problems — work in two cells is never one column — and each column under a problem has it as
  its head (`chat/cells.ts`): `columnContext` starts from it, so the student's first line gets its tick
  or ring exactly as under their own problem; `rightNextStep` corrects a wrong first line from it; and
  `buildCheckLines` sends it to the check model as the column's first line. A bar the student draws
  under a one-line problem with a number under it is "divide both sides" (`problemEquations` →
  `splitInk`'s `equations`; "Drawings" below). Writing problems, or rubbing one out, re-reads the columns.
  A line there the tutor cannot judge gets its "?" once the student stops, and with nothing of the
  student's to act on the tutor works the problem itself (both above, under Help).
- **A problem with its interval on the line** (`2\cos x = 1, 0^{\circ} \le x < 360^{\circ}`, `0 \le x <
  2\pi`, `x \in [0, 360^{\circ})`; `src/lib/live/engine/domain.ts`) is an equation and a DOMAIN, not one
  inequality: `analyzeLine` analyses the equation as any line and puts the domain on it
  (`LineAnalysis.domain`, in radians for an angle, with the equation's solutions there, exactly as
  Solve lists them), and every line under it carries it down the column. The student's steps get their
  tick or ring as under any equation (`\cos x = \frac{1}{2}`, the reference angle
  `\cos^{-1}(\frac{1}{2}) = 60^{\circ}` — an inverse trig value is radians beside an angle); an answer
  outside the interval is ringed though it solves the equation (`x = 420^{\circ}`, note "Outside the
  interval"); the problem's solutions there are ticked even under a ringed line; one of two solutions
  (`x = 60^{\circ}` of 60°, 300°) is ticked but not `solved`, so Solve and Help carry on to the other;
  all of them is solved. Plain numbers are degrees under a degree interval (`x = 210` under `0 \le x <
  360`). The interval written again on a line of its own is a tick (another interval a ring); under a
  trig equation with none, naming the one turn Solve writes is a tick, and the answer is then held to
  it. Solve from the student's step under such a problem solves in its interval and unit
  (`localSolve`'s `domain`: the chat problem's, passed by the loop) — scoreboard t2-52–57.
- **Proofs (`write_proof`: `{ figure: FigureSpec, given: [...], prove, worked }`).** Asked for a proof
  ("write a proof", "the hardest proof ever", "prove that the base angles of an isosceles triangle are
  congruent") the model chooses one — never a question back — and `worked: true` has the tutor write
  every row; "give me a proof to do" is `worked: false`. The prompt names the reasons the planner knows
  and shows four examples, each proved by the engine in a test. Nothing is written unproved:
  `checkProofProposal` (`chat/proof.ts`, pure, a few ms; the route runs it, and the board again) wants
  a figure the drawer draws true to what it says, points A–Z, statements the proof reader reads, a
  drawing that bears every statement out, and the planner's proof of the Prove statement with the
  figure's own geometry (`figureReadOf`: the spec as the desk reads a figure) — never citing the theorem
  being proved (`theoremsBeingProved`) — in at most 12 rows the hand can write. A proof it cannot prove
  gets one repair call told what the engine did reach (`whyNot`: the congruences it proved, the parts
  it lacks); still unproved, it is dropped with a note. A hard proof asked for ("the hardest proof
  ever") prefers at least 8 rows: a shorter one earns the repair, and if that is still short the
  longest proved one goes on. The model's words never reach the board: the
  statements are printed back from their facts in the reader's forms. On the board (`proofWrite.ts`,
  loaded on first use with the layout and the check — 8.9 KB gzip; the board's first load grew 5.3 KB
  for the rest, 1,036,984 → 1,042,239 B; `proofLayout.ts`): on an empty screen, else a new one — the figure top right,
  `Given:` / `Prove:` top left, a Statements | Reasons T-table under them, laid out exactly as the
  reader reads a student's proof, every row of a worked proof in it (the planner's rows, unmarked: they
  are the tutor's), or the table left empty to the bottom of the screen. The strokes carry what the
  proof desk needs to know the proof again, also after a reload (`proof/tutorFigure.ts`: the figure's
  read, the table's rules, the rows), so a student's rows in the table get their ticks and rings and
  Help / Solve continue it. An algebra proof ("prove the sum of two odd numbers is even") is
  `write_lines`: a chain of `=` lines, every step shown equal to the line above (`verifyLines` →
  `stepHolds`: the engine judges each step with the letters given whole numbers, three times over).
  Screenshots: `docs/qa-screenshots/chat-proof-*.png`.
- **Measured** by `npm run eval:chat` (`docs/eval/chat.md`; 38 requests, gated by `RUN_CHAT_EVAL=1`,
  under a $0.60 cap): gpt-5.4-mini did all 38 as asked, every one of its 70 problems verified, 5 of 5
  figures clean (2 after the repair), 2.3 s p50, ~$0.0011 a request; the DeepSeek fallback matched it
  at 0.8 s. With `help_problem` the corpus is 48 requests (ten help cases, judged on the problem and the
  depth); on 2026-09-28, for the production pair only (`docs/eval/chat.md` not regenerated): DeepSeek
  48/48, gpt-5.4-mini 46/48 — help 9/10 (it reads "help me solve it" right after a step as `solve`) and
  the parallel-lines figure still wrong after its repair.
- **Help with a problem on the board** (`help_problem`, `ChatDesk.helpProblem` → `LiveLoop.chatHelp`):
  with the student's work under that problem, their work gets the help Help and Solve steps give it (the
  next step after their last line — the right one beside it when that line is wrong — or the rest worked
  out from their last good line); else the tutor works the problem itself ("The tutor works the
  problems it wrote", above). A typed ask is answered whatever the dial says, Off included. The panel
  notes a problem already worked out, or one not on the screen. The chat request stays 3 ink; the
  local writing is free, and the model fallback is metered by `/api/live/solve` as before.
- **Measured, proofs** by `npm run eval:chat` (`docs/eval/chat.md`; on the proofs branch 49 requests, 11 of them proofs, gated by
  `RUN_CHAT_EVAL=1`, under a $0.60 cap): on the proofs prompt gpt-5.4-mini did 49 of 49 as asked
  (all 9 geometry proofs proved, 5 at once and 4 after the repair; the 12-row "hardest" at once), all
  70 problems verified, 2.2 s p50, ~$0.0017 a request; the DeepSeek fallback did 49 of 49, every
  proof proved at once, 1.2 s p50.
  With both, the corpus is 59 requests (38 + 10 help + 11 proofs).
- **Worked solutions — Ask teaches on the board (`teach`: `{ figure?, steps: [{ say, math }], answer? }`).**
  Asked to be taught or shown — "explain", "explain it step by step", "explain it by drawing", "how did we
  find that?", "do the actual problem", "show your work", "but like the #'s", a problem typed with its
  question — with a problem in context (the remembered `problem`, the recent turns, the screen), the reply
  is ONE teach with the whole worked solution: never a question back, never a figure alone, never the
  working in the panel, and asked again it is taught again (on a fresh screen). "explain problem 3" and
  "why" about a listed problem are teach; "help me with 3", "solve 3", "show me how to solve it" stay
  `help_problem`. A step is a sentence (`say`: plain words under lecture mode's text rule, `plainWords`,
  ≤ 140 characters, asked for in ~90; LaTeX a model slips in becomes the hand's symbols, `plainSay`:
  `\sqrt{31}` → `√31`, `RS^2` → `RS²`) and its maths (`math`, ≤ 6 LaTeX lines: a chain — a line, then
  lines starting with `=` that continue it — or equations solved line by line); ≤ 8 steps; `answer` the
  result. The prompt shows three worked examples, each checked by the engine in a test.
  - *Checked before anything is written* (`checkTeach`, `chat/teach.ts`, pure, ~5–600 ms; the route runs
    it on the maths engine, loaded there on the first teach, and the board again before writing). Every
    link of a chain must be EQUAL: the engine judges `left = right` with every quantity given the same
    numbers, four positive sets (`linkHolds`) — a segment `OR` is one quantity, `x_2` one letter, `a` and
    `b` free letters — so an identity holds and a slip (`\sqrt{6 + 25} = \sqrt{30}`) is caught; calculus
    the engine judges itself. A chain's first computed link may put the problem's numbers into a formula:
    the letters that vanish (`x_1`, `x_2`, `y_1`, `y_2`) are matched to balanced pieces of the next line
    (`matchTemplate`) and the formula with those values put in must equal it — which numbers belong there
    is the reading of the problem, the one thing no engine can check. A chain headed by a name (`OR = …`,
    `RS^{2} = …`, `m\angle B = …`) states its value; later maths is checked with it put in (`2 \cdot OR^{2}`),
    a restated value must agree, a segment's square gives the segment. Equation lines follow as the engine
    ticks a student's column, or by what the column's setup solves to (a system's elimination); an
    equation whose right side a chain works out (`2^{x+3} = 32`, `= 2^{5}`) goes in the column as worked
    out. At the end every relation taken as given (a definition, a setup) is checked with every value
    found, and the answer against the working (`RS^{2} = 64` after it found 62 is caught). What fails comes
    back as sentences the model can act on ("Step 2, line 5: "\sqrt{6 + 25}" is not equal to
    "\sqrt{30}"."): ONE repair round-trip (`gateChatTeach`, `buildTeachRepairMessages`: the request with
    its context, the solution, the findings), then dropped with a note and, alone, refunded — never
    written unchecked. The figure goes through `checkFigure` in the same repair; still wrong, the working
    goes on without it. The sentences are words and are not checked; the prompt keeps them to what the
    maths shows.
  - *On the board* (`teachWrite.ts`, loaded on first use with the check, the layout and lecture's words
    planner; `teachLayout.ts`, pure): on this screen when it is empty, or in clear room beside what is
    there (right of it, under it, left of it; in a hand ≥ 34 and never beside another worked solution),
    else on a new screen. The figure (the figure drawer, true to scale, the given numbers labelled) top
    right; the steps down the left, each sentence in the tutor's hand at 0.8 of the maths size, wrapped
    to even lines, its maths under it; every `=` of the solution in one column (a chain's `= …` lines
    under its first line's `=`, equations line by line aligned on theirs, `= …` under an expression
    indented); the answer last in a hand-drawn box. Two columns on a whole screen (the second starts under
    the figure), one beside other work; the maths at 40 px, smaller as needed (28 at the least; a hand up
    to 6 px smaller is taken to keep the answer right under the last step); a second screen only when
    even the smallest hand does not fit. Written as a teacher writes it: the figure, then each step as one
    `HandWriter` block (sped up past 3 s, at most 4.5 s a step, the whole within ~24 s), 550 ms between
    steps, then the boxed answer. The strokes carry `chatBlock: "teach"` (the figure's `"figure"`) and the
    tutor's live meta, so the reader never reads or marks them; a sentence's plan lines carry no LaTeX, so
    the screen's picture lists the tutor's maths (what "how did we find that?" refers to), not its words.
    The words planner gained `≠`, `≅`, `△`. A worked solution is ~250–320 strokes (~300 KB in the saved
    board). Screenshots: `docs/qa-screenshots/chat-teach-*.png` (the owner's conversation; a listed linear
    equation explained).
  - *Cost*: the board's first load grew 1.3 KB gzip for the contract, the desk's case and the panel's
    problem memory (1,057,746 → 1,059,093 B of the 1,060,000 budget); the check, the layout, the writer,
    the words planner and the prompt are not in it.
  - *Measured* by `npm run eval:chat` for the production pair only (`docs/eval/chat.md` not regenerated;
    2026-09-29, $0.56 on the eval ledger; `CHAT_EVAL_KINDS=teach` runs the teach cases alone). The corpus
    is 70 requests: the 59, `m-solve-for-me` now a teach, and 12 teach cases — the owner's circle problem
    as typed, "do the actual problem" (with the problem sent as `problem`, and again right after it was
    taught), "explain it step by step", "but like the #'s", "how did we find that?", a ticket word problem,
    a ladder (Pythagorean), `2^{x+3} = 32`, `\log_{3}(x - 1) = 2`, a listed `2x + 3 = 11` explained — each
    judged on a `teach`, every chain checked after the route's repair, and the right answer. The teach
    cases: both models 12/12, every solution checked (gpt-5.4-mini one after the repair), every answer
    right (RS² = 62 in all six of the owner's). The whole corpus on the prompt before its last two wording
    changes: DeepSeek 70/70; gpt-5.4-mini 66/70 — "help me solve it" after a step read as `solve` (as
    before), "show me how to solve it" about a listed problem taught instead of `help_problem` (the rule
    now says a listed problem's help and solve words stay `help_problem`: 9/10 help after it, the old
    miss only), `help_problem` asked with no problem listed (dropped by the route), and "write a proof for
    me" set up for the student. On the final prompt gpt-5.4-mini's proofs are 9/11 ("write a proof for
    me" still set up for the student; "a proof I can try" not proved after its repair) — on this
    prompt's first version they were 11/11: variance on that phrase or the longer prompt, not settled
    within the eval budget. Latency p50 2.3 s (gpt-5.4-mini) / 1.1 s (DeepSeek); a teach ~3–4 s.

**Lecture mode (`src/lib/live/lecture/**`, `POST /api/live/lecture`, `src/components/lecture/**`).**
A "Lecture" button beside Ask turns on the microphone; the tutor then sketches what is said, live, on
the board's screens: a chart of the numbers, a flow of the steps, a cycle, a timeline, a concept map, a
tree, a Venn comparison, a table, a heading per topic, a short note, and the chat's graphs, figures and
formulas. Any subject. The model only says what to draw; the planners lay it out and the HandWriter
draws it in ink, as it does the worked steps. Words are written here (headings, notes, labels), short
and plain; elsewhere the board writes words only in a worked solution's sentences and a proof's reasons
(the same text rule, `plainWords`, and the same words planner for the sentences). The contract is
`src/lib/live/lecture/contracts.ts`; a first-use note says the words are kept and the audio never is.
- **Listening** (`speech/*`). ElevenLabs Scribe v2 Realtime over a websocket opened with a single-use
  token from `POST /api/live/lecture/token` (16 kHz PCM from an AudioWorklet, the recognizer's own
  voice-activity commits, reconnect with a fresh token when a session ends). Without `ELEVENLABS_API_KEY`
  the browser's own recognizer (Web Speech: Chrome, Edge, Safari); a scripted source for tests and
  demos (`window.__agathonLectureDemo()` in development plays `lecture/demo.ts`).
- **When to ask** (`session.ts`, `salience.ts`, `transcript.ts`). Each committed sentence is checked at
  once: while it is salient (numbers, amounts, years, change and sequence words, "there are three
  types of…") or a live visual was drawn or updated in the last 150 s, the director is asked every ~8 s
  once 4 new words are in; otherwise every ~20 s after 25 words. One request in flight; sentences
  heard meanwhile make one follow-up. "Draw that" asks now, about the last minute. The recognizer
  ends a sentence after half a second of quiet, and while the speaker has gone on during a drawing
  the hand draws 2.2× faster (`LectureRunOptions.behind`), so a fast talker does not leave the board
  behind.
- **The director** (`src/lib/server/lectureDirector.ts`, `prompts/lecture.ts`). Most ticks return no
  actions. A chart starts at the first number of a data story, with every category announced and
  `null` for the numbers still to come; later numbers, corrections and new categories are an
  `update_chart` of the SAME chart (the whole new spec, checked against the live one: same kind and
  title, nothing dropped); a diagram starts at two steps and grows. The transcript is data, fenced and
  flattened, never instructions. Measured by `npm run eval:lecture` (`docs/eval/lecture.md`): live
  sequences 66/66 and single ticks 90/90 on DeepSeek v4.1 Flash, 0.6 s p50.
- **The desk** (`desk.ts`, run by `LiveLoop` through the chat's host). A heading goes top-left, on a new
  screen when this one has anything on it; notes stack in a left column; charts and diagrams take the
  largest box that is free (520×380, then smaller), never under the lecture bar; a full screen goes on to
  a new one headed "<topic> (cont.)". A live update re-plans the visual in its own box with its own seed,
  compares the old and new plans part by part (`HandLinePlan.part`) and rubs out and writes only the
  parts whose ink changed — a new quarter's bar and its value in under a second; past the axis top it
  redraws, faster. Topics, the transcript and the live visuals' specs are kept on the screen's page meta
  (`LECTURE_PAGE_META`), which Ask reads so "what did she say about X?" is answered in the panel.
- **The ink** (`chart/`, `diagram/`, `text.ts`, `words.ts`). Plans are part-keyed and seed-stable, so a
  part that did not change comes out stroke for stroke the same; data is coloured from
  `LECTURE_PALETTE` with pale fills (never red), words in the tutor's blue with a pen as fine as their
  size (`wordsWeight`: a draw shape's `scale`). Galleries: `docs/lecture/*.png`
  (`LECTURE_GALLERY=1 npx vitest run src/lib/live/lecture/__tests__/gallery.test.ts`).
- **Free drawing** (`sketch`: one picture, or a comic of 2–4 panels with captions and a shared `cast`).
  Drawn when the speaker asks to see something ("draw…", "I want to see that on the whiteboard", "a
  comic…"), when a lecture describes a thing whose look matters and no chart carries it, and on "Draw
  that" when nothing else fits (then a chart, a sketch or at least a note: never nothing). The desk
  writes the frames and captions at once (`sketch/panels.ts`), asks the illustrator for every panel in
  parallel (`POST /api/live/lecture/sketch`), and writes each drawing into its frame in reading order
  as it arrives (`sketch/ink.ts`: the vectors as hand-drawn ink with pale fills), without holding up
  the rest of the lecture; a panel that fails gets a small note in its frame. Gallery:
  `docs/lecture/sketch.png`; the illustrator's eval: `docs/eval/sketch.md`.
- **Limits.** A sketch is ~100–250 KB of ink even at 1/100 px, and the autosave refuses a snapshot over
  4 MB, so the desk stops sketching past ~3.3 MB (about 20 sketches) with a note; lecture blocks do not
  count against the live shape cap, and a screen moves on at 3,200 strokes (tldraw's page limit is
  4,000).

**Word problems: the model sets up, the engine solves.** Mathpix returns prose as `\text{…}` and
the engine classifies it `kind: 'text'` (silent: no echo). A column down to the asked-for line that
has a line of prose reading like a sentence (≥ 4 words, `isProblemProse` in
`src/lib/live/wordProblem.ts`) is a word problem. When the local paths have nothing (`localSolve`
skips a prose target), `LiveLoop.startSetup` sends the column's lines to `POST /api/live/setup`
(2 ink), whose model — `openai/gpt-5.4-mini`, fallback `deepseek/deepseek-v4.1-flash`; prompt
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
symbol. Signed out, out of ink or rate limited on the setup shows that error and stops (solve
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
column's other lines to `POST /api/live/reread` (1 ink; `google/gemini-3.1-flash-lite`, fallback
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

**Drawings: kept out of the lines, read when asked — or, in Solve, when left labelled with an unknown (`src/lib/live/diagrams.ts`).** Students
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
- *Division bars ("divide both sides", `divisionBars`).* Before any of that, a long level rule under
  a WHOLE equation with a short piece of writing just under it and nothing else on it is set aside:
  under the student's own line (writing above it holding a free-standing relation, spanned by the
  rule, nothing level with the rule past its ends — a fraction bar inside a line has the rest of
  the line level with it), or under a problem the tutor wrote (`splitInk`'s `equations`: the loop
  passes the box of each one-line problem that is an equation or inequality, `problemEquations`;
  the problem's ink is not among the strokes, so the rule used to be a drawing and the `2` its
  label). The bar and the divisor are one line of their own (`InkSplit.bars`, `clusterLines`'
  `fixed` groups). Mathpix drops the bar and reads the divisor (`2`, `-3`: measured), and the loop
  writes the line as `\div 2` (`barDivisionLatex`) — an operation line (below, "Operation lines").
  Not one: an underline with nothing under it, a rule with a line of maths under it (the sum under
  a system), a number line (ticks), a T-table (`tableRules` first), a fraction bar, long division.
  `npm run eval:drawings` scores it: 320/320 bars found (2, -3, 4, ½ under five equations, the
  student's or the tutor's, with and without the next line under them, four hands), 0/136
  look-alikes taken, no drawing beside maths taken for one.

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

**The tutor reads the figure: the model perceives, the engine reasons (`src/lib/live/figure/**`).**
Solve or Help when the last ink was a drawing, Solve on a line the engine cannot answer that is
within 120 px (or 10 G) of one (`x = ?` beside a triangle), or — in Solve — a figure left labelled
with an unknown (below) sends a crop of the drawing and its labels (≤ 768 px wide) with the labels as
read and the column's lines to `POST /api/live/setup` (2 ink; `google/gemini-3.1-flash-lite`,
fallback `google/gemini-3.5-flash-lite`; prompt `src/lib/server/prompts/figure.ts`). The model does
not write the equation. It describes what it SEES (`FigureReplySchema`, zod, `figure/schema.ts`):
every labelled angle and side with its label as written and where it is, and the relationships the
drawing shows — `triangle`, `exterior_angle`, `straight_line`, `around_point`, `right_angle_parts`,
`vertical`, `transversal` (two angles at the crossings of a transversal with lines marked parallel),
`isosceles`, `equal`, `equilateral`, `right_angle`, `right_triangle`, `polygon`, `regular_polygon`,
`exterior_angles`, `inscribed_central`, `same_arc`, `tangent_radius`, `semicircle`,
`cyclic_opposite`, `similar`, `midsegment` (synonyms mapped; a fact that does not validate is
dropped). `planFigure` (`figure/plan.ts`, pure) turns the facts into the lines a student writes, one
stage per unknown: `x + 40 + 65 = 180`, `2x + 10 = 70` (vertical), `x + 70 = 180` (co-interior),
`2x + 40 = 180` (isosceles, base asked), `x + 2(50) = 180` (apex asked), `x^{2} = 3^{2} + 4^{2}`,
`\frac{x}{6} = \frac{8}{12}`, `(6 - 2) \cdot 180 = 720` then `6x = 720`, `x = 2(35)` (central
angle); an unlabelled angle it has to go through is found first on a line of its own
(`180 - 70 = 110`, then `x + 110 + 50 = 180`). Equal-marked quantities are merged (union–find),
labels are linear expressions in one letter (`2x + 10`, `(3x - 5)°`, `\frac{x}{2}`, `θ`, `?` → `x`),
and a line beside that asks (`x = ?`, `m\angle A = ?`) narrows what is solved for. At a transversal
the relation comes from where each angle is — `first/second crossing, between/outside the parallel
lines, left/right of the transversal` — not from the name the model gives it: on the eval the models
placed the angles right more often than they named the relation. The read is refused (and the
model's own setup lines, which it also returns, are used instead) when a fact names a quantity that
is not there or of the wrong kind, a value label read on the figure is missing from the read or the
read has one the figure does not, a label is in no fact, or — once the unknowns are solved — a fact
does not hold or an angle or side is not a sensible size (not positive, an angle of a triangle or a
straight line at 180° or more, a base angle of an isosceles triangle at 90° or more, a leg longer
than the hypotenuse). The board then keeps only what it can check (`figureAnswer`,
`figure/answer.ts`, the same function the eval scores): the planner's stages are validated like a
word problem's setup and solved by `localSolve`, and the engine's answer must equal the planner's
own value (a Greek unknown is solved as a Latin stand-in and renamed back — the engine reads
`\theta + 50 = 180` as `theta = 130`); the model's own lines must solve to a positive size, an angle
under 360°. Otherwise nothing is written — no longer the bare setup when the engine cannot finish
it. The block is written by hand beside the figure (right of it, level with its top; under it when
the screen has no room), under the work when asked from a line; Help in Feedback / Suggest writes
the first line only. From a line, a figure that gives nothing falls back to the word-problem and
solve paths; asked on the drawing, the pill says "Couldn't work this out", with Retry.
`meta.solvedLatex` is `figureKey` — a hash of ALL the figure's ink (drawing, marks and labels
together, so a degree sign that moves between label and mark as the glyph scale shifts is not a new
figure), its labels compared loosely, and the work beside it — and the route's reply is kept per key
(`figureReplies`), so asking again costs nothing; rubbing the drawing out removes the answer.

**…and, in Solve, without being asked (`solveWantedFigures`).** Once the student has stopped (the
settle, as for graphs, and after any graph the settle draws), a drawing with an unknown among its
labels (`looksLikeUnknown`: `?`, a lone letter that is not a line's name like `l`, `m`, `t`, an
expression in a letter) and no line of writing within the figure reach is worked out beside it.
Guards: Solve only — Feedback and Suggest stay quiet unless asked (Help); not axes or a number line
(graphs); no line on the screen reading `Given` / `Prove` (a proof's figure is the proof's); not
while the tutor's hand is writing or sketching (it follows, from the writer's `onDone`); once per
figure-and-labels version (`figureKey`) — one model call, the reply kept; a version whose call failed
is not tried again unasked; a reply that arrives after the student started writing again waits for
the next stop instead of landing mid-work; an answer the student rubs out (any stroke of it) is not
written again unasked, also after a reload (the keys in the page's `meta.liveFiguresDismissed`, last
20), while asking brings it back. A figure whose strokes or labels changed loses its old answer and
is read again. Unasked failures — a refused read, a failed call, no ink — are silent.

Measured (`npm run eval:figures`, `docs/eval/figures.md`; real calls, gated by `RUN_FIGURE_EVAL=1`,
cached, under a $0.90 cap): 47 figures drawn as strokes by the corpus pen across 19 configurations
(`src/__eval__/figures/corpus.ts`), rendered as the board's crop (SVG → PNG with `rsvg-convert`) and
sent with their labels. Gemini 3.1 Flash Lite 47/47 right and none wrong (1.1 s p50, ~$0.0009 a
figure); 3.5 Flash Lite 45/47 (2 wrong); Haiku 4.5 42/47 (4 wrong); GPT-5.4 nano 37/47. The old
free-form prompt on the same model: 44/47, 1 wrong, 2 with nothing. Offline in every run: each
figure's gold read plans (and the engine solves) to its answer, and each is a drawing to `splitInk`.
Live, in the browser, in Solve with nothing asked: parallel lines with 70° and x → `x = 70`; a straight
line with 130° and x → `x + 130 = 180`, `x = 50`; an isosceles triangle with tick marks, 40° at the
apex, x at the base → `2x + 40 = 180`, `2x = 140`, `x = 70`; crossing lines with `2x + 10` and 70° →
`2x + 10 = 70`, `2x = 60`, `x = 30` — each beside the figure 4–5 s after the last stroke (the settle,
the label read, ~1.1–2 s of model). There, two label stacks came back from Mathpix as one row
(`\underbrace{2 x+10}_{70^{\circ}}`, `70^{\circ} \) x`); `parseLabelRead` now splits both.

Measured offline by the drawings scoreboard (`npm run eval:drawings`, `docs/eval/drawings.md`): 8
generated drawings × 3 sizes × 5 placements × 6 lines × 4 hands = 2880 scenes. Before, the maths
line was intact (one line of exactly its strokes) in 1689, no drawing was kept out of the lines, and
1809 lines held no maths at all; after, 2847 intact, 2880 drawings out, 18 stray lines, 8951 of 9000
labels attached. The 33 left are a label written between the line and the drawing, nearer the line.
Every corpus line in every hand (1276, plus radicals, long division, integrals, brackets, matrices,
cases) keeps every stroke as writing — the scoreboard fails otherwise. Not handled: a drawing
sketched in many short strokes (each is a glyph), a small rectangle or circle under ~3.5 G, tldraw's
own shape tools (never read as ink anyway, but their labels still are lines).

**Two-column proofs (`src/lib/live/proof/**`).** A proof on the board is a `Given:` and a
`Prove:` line, then rows of statement | reason in two columns, with or without a `Statements |
Reasons` header or a drawn T-table.
- **Reading (`read.ts`, `table.ts`, `facts.ts`, `vocab.ts`).** `readProofs` pairs each reason with
  the statement level with it. The T-table's rules are set aside by `splitInk` (role `table`), so
  the rows stay lines; a rule counts only with a row under its bar or the header over it, so a
  figure's sides never do. Statements are parsed into facts: congruent segments, angles and
  triangles, midpoints, bisectors, ∥, ⊥, right angles. Reasons are normalised from what Mathpix
  returns (`\text{Vert. } \angle s`, `def of midpt`, `SAS \cong`, …) to one short vocabulary. That
  vocabulary is the one place words are written on the board, and only in a proof's reason column.
- **Checking (`checker.ts`).** Deterministic, row by row, against the rows above: Given against the
  Given line; SSS / SAS / ASA / AAS / HL with the parts and their correspondence (SSA is wrong);
  CPCTC after a congruence and on parts that correspond; reflexive, transitive, substitution; the
  definitions. Vertical angles, linear pairs and angles at parallel lines need the figure: they are
  checked against the figure read, and left unmarked without one. A row that is verified is ticked;
  one that is provably wrong is ringed; a row it cannot verify gets no mark.
- **The figure (`figureInk.ts`, then `/api/live/proof`).** Read first from its own ink: strokes cut
  into straight pieces and joined into lines, the labelled points named, and each line is the
  points on it. A letter written on a crossing touches the lines and stays a mark, so when exactly
  one point the proof names is on no label and exactly one crossing is unlabelled, that crossing is
  it. Only when the ink gives nothing does the model read the crop (points and lines), once per
  drawing.
- **The next row (`planner.ts`, `desk.ts`, `place.ts`).** On Help in Suggest (one row) or in Solve
  (the rest), the engine's planner searches forward from the givens for the shortest proof,
  bounded. When it cannot finish, one model row (`LIVE_MODELS.proof`, gpt-5.4-mini, deepseek
  fallback; 2 ink, refunded on failure) is written only if the checker ticks it. Rows are
  written in the tutor's hand, statement then reason, one row pitch under the last row. Their
  reasons go in the student's reason column, or with none yet, one column just past the widest
  statement. Sizes come from the Prove line when there are no rows yet: a Given can be two lines
  read as one; a Statements | Reasons header just under the Prove line is the proof's, so a table set
  up and not begun gets its first row under the header, the reason under `Reasons`.
- **A proof the tutor wrote (the board chat's `write_proof`).** Its figure's strokes carry the
  figure's read (`meta.proofFigure`), which the desk prefers to reading any ink (`figureFrom:
  "tutor"`); its rows come back as the tutor's lines; its table's rules are written across. Help with
  nothing of the student's on the screen asks the one proof there; Help on it plans without the
  theorem it proves, as the proof was checked.
- **Scoreboard.** `npm run eval:proofs` (`docs/eval/proofs.md`, 28 textbook proofs): every row of
  every correct proof ticked, every seeded error ringed, and the planner finishing each proof from
  every prefix.

**Deterministic maths never goes through a model.** `LiveLoop.startSolve` (`src/lib/live/liveLoop.ts`) asks the local engine before it will open `/api/live/solve`: `engine.solveLatex` for a relation with an unknown (`2x + 3 = 11` → `2x = 8`, `x = 4`; linear inequalities too; quadratics, absolute value, rational, radical, exponential and log equations through `engine/advanced.ts`), `engine.solveFromLines` for a line that needs the ones above it, `engine.simplifySteps` for an expression in an unknown (`3(x+2) - x` → `= 3x + 6 - x`, `= 2x + 6`) or a derivative, integral or limit (`\frac{d}{dx}(3x^2+2x)` → `= 3 \cdot 2x + 2`, `= 6x + 2`; see "Calculus steps" below), and then `localAnswerFor` (`src/lib/live/solveSteps.ts`) for a line the engine can simply evaluate — `analyzeLine(latex, { mode: 'answer' }).resultLatex` covers a trailing `=`, units, a conversion, a derivative, an integral, a limit, a finite sum and a percentage, and `engine.calculate` covers bare arithmetic whose result the echo's calculator rule suppresses. Either way the steps are written under the student's work in the tutor's hand (`planHandwriting` + `HandWriter`), with no model, no ink and no network. An answer the hand atlas cannot draw, or a device with the handwriting switch off, is typeset locally instead of being asked for: only a line the engine has nothing to say about (an equation the CAS declines, a word problem whose setup the engine cannot solve) reaches the stream. Regression: `36 + 2 =` used to fall through `solveLatex` and be answered `= r + 9\varepsilon` by the model.

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
| Function notation (`engine/functionNotation.ts`, through `solveFromLines` with the definition above): a call replaced by the definition with the argument in, bracketed as a student brackets it, innermost first (`f(g(2))` → `f(2^{2})` → `f(4)`), then the arithmetic or the algebra; `(f \circ g)(x)`, `(f + g)(x)`, `(fg)(x)`; a rate of change; `f(x) = 7` and `f(x) = g(x)` solved; `P(3)` (the remainder theorem); a piecewise definition (`\begin{cases}`, Mathpix's `\left\{\begin{array}`) by the case whose condition holds, written as a true statement. An inverse by swapping x and y and solving for y. Checked against the definitions evaluated independently. A claim `f(4) = 11` right under the definition is checked | `f(x) = 2x + 3`, `f(4) =` → `= 2(4) + 3`, `= 8 + 3`, `= 11`; `f(a + 1) =` → `= 2(a + 1) + 3`, `= 2a + 2 + 3`, `= 2a + 5`; `g(x) = x^{2}`, `f(g(x)) =` → `= f(x^{2})`, `= 2(x^{2}) + 3`, `= 2x^{2} + 3`; `f^{-1}(x) =` → `y = 2x + 3`, `x = 2y + 3`, `x - 3 = 2y`, `y = \frac{x - 3}{2}`, `f^{-1}(x) = \frac{x - 3}{2}`; piecewise `f(3) =` → `3 \ge 0`, `= 2(3) + 1`, `= 7` |
| Lines (`engine/linearFunctions.ts`): the slope from two points (a column of points, `m = ?` for the slope alone), the line through them or through a point with a slope (point-slope, expanded, slope-intercept), vertical (`\frac{4}{0}` → `x = 2`) and horizontal lines; a line already in y (`y - 3 = 2(x - 1)`) or any linear equation under `y = ?` to `y = mx + b`. A bare `2x + 3y = 6` is left to the model (it may be one equation of a word problem) | `(2, 3), (5, 9)` → `m = \frac{9 - 3}{5 - 2}`, `m = \frac{6}{3}`, `m = 2`, `y - 3 = 2(x - 2)`, `y - 3 = 2x - 4`, `y = 2x - 1`; `2x + 3y = 6`, `y = ?` → `3y = -2x + 6`, `y = -\frac{2}{3}x + 2` |
| Standard form of a line (`engine/linearFunctions.ts`), asked under the line by the template `Ax + By = C` or the student's `\text{standard form}` (or above the line Solve is pressed on): brackets expanded, fractions and decimals cleared by the LCD, x and y collected left, the common factor and a negative A divided out — whole numbers, A > 0, gcd 1. From slope-intercept, point-slope, any linear equation, two points or a point and a slope (then from the point-slope line). `y = mx + b` / `\text{slope-intercept form}` asks the other way. A line already in the form asked is refused (not solved as a system of the lines above). The template is not a step: the next line is checked against the line above it | `y = -\frac{2}{3}x + 2`, `Ax + By = C` → `3y = -2x + 6`, `2x + 3y = 6`; `y = 2x - 1` → `-2x + y = -1`, `2x - y = 1`; `(2, 3), (5, 9)` → … `y - 3 = 2x - 4`, `-2x + y = -1`, `2x - y = 1` |
| A formula for one letter (`engine/literalEquations.ts`, `x = ?` under it, after the systems have nothing): the denominators cleared by the LCD (shown unexpanded), brackets expanded, the letter's terms on one side, factored out when there are several, divided out; or the letter once under a power, a root, an exponential or a log — the rest moved, the coefficient divided, the operation undone (the principal root for an even power: a formula's lengths). Checked in the original formula. A formula with every value known in decimals (`engine/formulas.ts`) is worked in those decimals, brackets then powers then products; a value with no short decimal is written to the cent with `\approx` | `A = \frac{1}{2}bh`, `h = ?` → `2A = bh`, `h = \frac{2A}{b}`; `x = \frac{y + 1}{y - 2}` for y → `x(y - 2) = y + 1`, `xy - 2x = y + 1`, `xy - y = 2x + 1`, `y(x - 1) = 2x + 1`, `y = \frac{2x + 1}{x - 1}`; `A = \pi r^{2}`, `r = ?` → `r^{2} = \frac{A}{\pi}`, `r = \sqrt{\frac{A}{\pi}}`; `A = P(1 + r)^{t}`, `P = 1000`, `r = 0.05`, `t = 3`, `A = ?` → `A = 1000(1 + 0.05)^{3}`, `A = 1000(1.05)^{3}`, `A = 1000 \cdot 1.157625`, `A = 1157.625` |
| Laws of exponents (`engine/exponentRules.ts`, a product / quotient / power of numbers and letters): the power of a product, quotient or power first (exponents multiplied, written `3 \cdot 2`), like bases combined (added, or subtracted across the bar), then negative exponents below the bar and zero exponents gone; number bases worked out last | `x^{3} \cdot x^{4}` → `= x^{3 + 4}`, `= x^{7}`; `(2x^{3}y)^{2}` → `= 2^{2}x^{3 \cdot 2}y^{2}`, `= 4x^{6}y^{2}`; `\frac{12x^{5}y^{2}}{4x^{2}y^{5}}` → `= 3x^{5 - 2}y^{2 - 5}`, `= 3x^{3}y^{-3}`, `= \frac{3x^{3}}{y^{3}}`; `2^{-3}` → `= \frac{1}{2^{3}}`, `= \frac{1}{8}` |
| Radicals and rational exponents, exact (`engine/radicalExpr.ts`, numbers only): the radicand split (`\sqrt{25 \cdot 2}`), the square taken out, like roots collected; products under one root; a root below the bar rationalized (times itself, or the conjugate, written in the order the bottom was); cube and fourth roots; `b^{\frac{m}{n}}` as `(\sqrt[n]{b})^{m}` | `\sqrt{50}` → `= \sqrt{25 \cdot 2}`, `= 5\sqrt{2}`; `\sqrt{12} + \sqrt{27}` → `= \sqrt{4 \cdot 3} + \sqrt{9 \cdot 3}`, `= 2\sqrt{3} + 3\sqrt{3}`, `= 5\sqrt{3}`; `\frac{3}{2 + \sqrt{3}}` → `= \frac{3(2 - \sqrt{3})}{(2 + \sqrt{3})(2 - \sqrt{3})}`, `= \frac{6 - 3\sqrt{3}}{4 - 3}`, `= 6 - 3\sqrt{3}`; `8^{\frac{2}{3}}` → `= (\sqrt[3]{8})^{2}`, `= 2^{2}`, `= 4` |
| Sequences and series (`engine/sequences.ts`): arithmetic or geometric from a list of terms (at least three), from `a_{1}` with `d` / `r`, or from a recursive rule; the nth term, the explicit formula, a finite sum `S_{k}`, an infinite geometric sum (\|r\| < 1); sigma notation by the same formulas; `\bar{x} = ?` under a list is its mean. Each answer checked against the terms | `3, 7, 11, 15, \ldots`, `a_{10} = ?` → `d = 7 - 3`, `d = 4`, `a_{10} = 3 + (10 - 1) \cdot 4`, `a_{10} = 3 + 36`, `a_{10} = 39`; `a_{1} = 2`, `a_{n} = a_{n - 1} + 5`, `a_{n} = ?` → `d = 5`, …, `a_{n} = 5n - 3`; `\sum_{n=1}^{\infty} 3\left(\frac{1}{2}\right)^{n - 1}` → `= \frac{3}{1 - \frac{1}{2}}`, `= \frac{3}{\frac{1}{2}}`, `= 6` |
| Statistics of a data list (`engine/statistics.ts`; 3–30 numbers, braces allowed, never `\ldots` — a sequence's): the mean, median, mode, range, `Q_{1}`, `Q_{3}`, `IQR`, the five-number summary and the standard deviation, asked by symbol (`\bar{x}`, `Q_{2}`, `\sigma`, `s`) or by the student's own word (`\text{median}`, `\operatorname{med}`, `IQR`, `\text{SD}`, `\text{five number summary}`), which the answer line repeats — the tutor adds only standard symbols. Quartiles: the medians of the halves, the median in neither half for odd n (TI-84); `\sigma` population, `s` sample, an unnamed SD the population's; no repeated value → `\varnothing` mode, every value equally repeated → not answered. Each answer recomputed in floating point first. Checking: the data sorted ✓; a claim ✓ or ringed, lines further down too (a statistic line carries the list in its `math`); a value right by another common convention (a hinge quartile, a sample SD under `\text{SD}`) unmarked | `12, 3, 15, 7, 8`, `\text{median} = ?` → `3, 7, 8, 12, 15`, `\text{median} = 8`; `3, 7, 8, 12, 15, 20`, `IQR = ?` → `Q_{1} = 7`, `Q_{3} = 15`, `IQR = Q_{3} - Q_{1}`, `IQR = 15 - 7`, `IQR = 8`; `\sigma = ?` → `\bar{x} = \frac{3 + 7 + 8 + 12 + 15}{5}`, `\bar{x} = 9`, `\sigma = \sqrt{\frac{(3 - 9)^{2} + … + (15 - 9)^{2}}{5}}`, `\sigma = \sqrt{\frac{36 + 4 + 1 + 9 + 36}{5}}`, `\sigma = \sqrt{\frac{86}{5}}`, `\sigma \approx 4.15` |
| A quadratic's vertex form and vertex (`engine/quadraticForms.ts`), asked under `y = ax^{2} + bx + c` (or `f(x) = …`) by `y = a(x - h)^{2} + k` / `\text{vertex form}`, `(h, k) = ?` / `\text{vertex}`, `y = ax^{2} + bx + c` / `\text{standard form}`: completing the square round by round (a out of the x terms, half the x coefficient squared beside the working, added and subtracted, brought out times a, collected); the vertex by h = -\frac{b}{2a} and k = f(h) in the student's own right side, or read off a vertex form; a vertex form expanded back. Exact fractions. Checking: a vertex claim ✓ or ringed; a rewrite that slips in the constant or the sign of h while changing form is ringed, any other different quadratic unmarked (a translation, the next exercise) | `y = 2x^{2} - 12x + 7`, `y = a(x - h)^{2} + k` → `y = 2(x^{2} - 6x) + 7`, `\left(\frac{-6}{2}\right)^{2} = 9`, `y = 2(x^{2} - 6x + 9 - 9) + 7`, `y = 2(x^{2} - 6x + 9) - 18 + 7`, `y = 2(x - 3)^{2} - 11`; `y = x^{2} + 6x + 5`, `(h, k) = ?` → `h = -\frac{6}{2(1)}`, `h = -3`, `k = (-3)^{2} + 6(-3) + 5`, `k = 9 - 18 + 5`, `k = -4`, `(h, k) = (-3, -4)` |
| Complex numbers (`engine/complexNumbers.ts`, a line with `i`): sums (real parts, then imaginary), products by FOIL with `i^{2}` written and then replaced, quotients by the conjugate (a pure imaginary bottom by `i`), powers of `i` by fours, `\sqrt{-16}` as `\sqrt{16} \cdot i`, the modulus. A quadratic's complex roots only when `solveLatex` is told so (`SolveOptions.complexRoots`): `localSolve` allows them by `engine/complexSetting.ts` — `"when-column-uses-i"` by default (another line of the column already has `i`), `"never"` and `"always"` for a future per-class switch; otherwise no real roots stays `\varnothing` | `(2 + 3i)(1 - i)` → `= 2 - 2i + 3i - 3i^{2}`, `= 2 - 2i + 3i + 3`, `= 5 + i`; `i^{23}` → `= (i^{4})^{5} \cdot i^{3}`, `= i^{3}`, `= -i`; `\frac{2 + 3i}{1 - i}` → … `= -\frac{1}{2} + \frac{5}{2}i`; `i^{2} = -1`, `x^{2} + 2x + 5 = 0` → … `x = \frac{-2 \pm 4i}{2}`, `x = -1 \pm 2i` |
| Long division (`engine/polynomialDivision.ts`, a top of higher degree with nothing to cancel): the dividend rewritten one quotient term at a time — every line equals the question — ending quotient + remainder over the divisor. Over the block's budget the rewritten-dividend lines go first | `\frac{x^{3} - 2x^{2} + 4}{x - 3}` → `= \frac{x^{2}(x - 3) + x^{2} + 4}{x - 3}`, `= x^{2} + \frac{x^{2} + 4}{x - 3}`, …, `= x^{2} + x + 3 + \frac{13}{x - 3}` |
| Logarithms (`engine/logProperties.ts`): one log of a product / quotient / power / root expanded (product and quotient rules, then the power rule, logs of numbers worked out); several logs of one base condensed (the power rule inwards, then one log, then its value); a log of a number as a power of its base, else by the change of base; exponential equations over bases with no common one by the logs of both sides; an exact `x = \log_{b} c` answer followed by its change of base | `\log(x^{2}y)` → `= \log x^{2} + \log y`, `= 2\log x + \log y`; `\log_{2} 8 + \log_{2} 4` → `= \log_{2}(8 \cdot 4)`, `= \log_{2} 32`, `= \log_{2} 2^{5}`, `= 5`; `\log_{3} 7 =` → `= \frac{\ln 7}{\ln 3}`; `3^{x} = 2^{x + 1}` → `\ln 3^{x} = \ln 2^{x + 1}`, `x\ln 3 = (x + 1)\ln 2`, …, `x(\ln 3 - \ln 2) = \ln 2`, `x = \frac{\ln 2}{\ln 3 - \ln 2}`; `5^{x} = 7` → `x = \log_{5} 7`, `x = \frac{\ln 7}{\ln 5}` |
| Rational expressions and the binomial theorem (`engine/rationalExpressions.ts`): a sum / difference of fractions over the LCD built from the factored denominators — the excluded values first, each fraction brought over, one fraction, the top expanded and collected, a shared factor cancelled; a product or quotient (times the reciprocal) factored and cancelled. `(a + b)^{n}` (n = 3–6) from Pascal's row, then multiplied out | `\frac{2}{x} + \frac{3}{x + 1}` → `x \neq -1, \ x \neq 0`, `= \frac{2(x + 1)}{x(x + 1)} + \frac{3x}{x(x + 1)}`, `= \frac{2(x + 1) + 3x}{x(x + 1)}`, `= \frac{2x + 2 + 3x}{x(x + 1)}`, `= \frac{5x + 2}{x(x + 1)}`; `(x + 2)^{4}` → `= x^{4} + 4x^{3}(2) + 6x^{2}(2)^{2} + 4x(2)^{3} + 2^{4}`, `= x^{4} + 8x^{3} + 24x^{2} + 32x + 16` |
| Rational functions (`engine/rationalFunctions.ts`, Solve on `f(x) = \frac{P}{Q}` / `y = …` alone): top and bottom factored, the domain (`x \neq` the bottom's zeros), a common factor cancelled with `x \neq a` beside the simplified function, each hole `(a, value)` (its height from the simplified function), the vertical asymptotes (zeros left below), the level at ±∞ from the degrees (`y = 0`, the leading coefficients' ratio, or the division's quotient as a slant asymptote). Asks under the function (`courses.fromLines`): `\text{VA} = ?` / `x = ?`, `\text{HA} = ?`, `\text{holes}`, `\text{domain}` / `D = ?` (a question word under a function is analysed as an ask, not prose: `courses.askLine`); `\lim_{x \to a} f(x) =` under the definition gets the definition put in, then the limit (`courses.calculusOfDefined`). Every line checked numerically against the function as written; a bottom with an irrational zero is refused | `f(x) = \frac{x^{2} - 4}{x^{2} - x - 2}` → `f(x) = \frac{(x + 2)(x - 2)}{(x + 1)(x - 2)}`, `x \neq -1, \ x \neq 2`, `f(x) = \frac{x + 2}{x + 1}, \ x \neq 2`, `\frac{2 + 2}{2 + 1} = \frac{4}{3}`, `(2, \frac{4}{3})`, `x = -1`, `y = 1` |
| Transformations (`engine/transformations.ts`): `g(x) = a·f(bx + c) + k` under the definition of f (`courses.fromLines`) — g written out (a pure stretch of a polynomial multiplied out), the mapping rule `(x, y) \to ((x - c)/b, a·y + k)` (the whole move at once, so the order never goes wrong), the parent's key point carried across (its vertex for any quadratic; `(1, 1)` when the key point does not move); a school parent moved (`y = 2(x - 1)^{2} + 3`: x², x³, \|x\|, √x, 1/x, bˣ, read structurally by `familyOf`) read against it (`courses.solve`). The student's rewrite of `g(x) = f(…)` right under it is checked (`LineAnalysis.derived`, `courses.analyzeFunction`): same function ✓, another ringed | `f(x) = x^{2}`, `g(x) = f(2x)` → `g(x) = (2x)^{2}`, `g(x) = 4x^{2}`, `(x, y) \to (\frac{1}{2}x, y)`, `(1, 1) \to (\frac{1}{2}, 1)`; `y = 2(x - 1)^{2} + 3` → `f(x) = x^{2}`, `y = 2f(x - 1) + 3`, `(x, y) \to (x + 1, 2y + 3)`, `(0, 0) \to (1, 3)` |
| Checking a `= …` line under an expression: compared with the line above by value; a closed value that differs is a `mismatch` (a decimal is the calculator's rounding and stays unmarked), and a lone number or letter after `=` is a value, not a label | `\sqrt{50}` → `= 5\sqrt{2}` ✓, `= 5\sqrt{5}` ringed; `36 + 2` → `= 39` ringed; `(2 + 3i)(1 - i)` → `= 5 - i` ringed |
| **Geometry** — notation (`engine/geometryNotation.ts`, through `preprocessLatex`): `\angle A`, `m\angle ABC`, `\measuredangle`, `\angle 1` are one angle each; `\overline{AB}`, and two capitals together in a geometry line, one length; `\widehat{AB}` / `\overparen{AB}` one arc; `\triangle ABC` (`\Delta ABC`) a figure. A line decides (sides alone never do): `AB = 5`, `AB + BC = AC`, `\frac{AD}{DB} = \frac{AE}{EC}`, `PA \cdot PB = PC \cdot PD`, `\sin A = \frac{BC}{AB}` are lengths; `V = IR`, `PV = nRT`, `CO_{2}`, lowercase `ab` stay products. A subscript is part of a name (`m_{AB}`, `m_{\perp}`), never unknowns. `\stackrel{?}{=}` is `=` | written back as the student wrote it (`m\angle ABC`, `AB`, `\widehat{AC}`); statements about figures (`\triangle ABC \cong \triangle DEF`, `\sim`, `AB \parallel CD`, `\perp`, `\odot O`) are read as a `label`, `\overline{AB} \cong \overline{CD}` is an equation of lengths |
| Angle equations in degrees (`engine/geometry.ts`, `geometryEquation.ts`): a degree sign on the numbers makes x an angle (answered in degrees); on a bracket, `(2x + 10)^{\circ}`, the signs go and x is a number; named angles solve like any unknown; polygon sums and regular polygons worked round by round | `x + 35^{\circ} + 75^{\circ} = 180^{\circ}` → `x + 110^{\circ} = 180^{\circ}`, `x = 180^{\circ} - 110^{\circ}`, `x = 70^{\circ}`; `(2x + 10)^{\circ} + (3x - 5)^{\circ} = 180^{\circ}` → `2x + 10 + 3x - 5 = 180`, … `x = 35`; `2x + 30^{\circ} = x + 70^{\circ}` → `2x - x = 70^{\circ} - 30^{\circ}`, `x = 40^{\circ}`; `\frac{(8 - 2) \cdot 180^{\circ}}{8} =` → `= \frac{6 \cdot 180^{\circ}}{8}`, `= \frac{1080^{\circ}}{8}`, `= 135^{\circ}` |
| Right triangles: the Pythagorean theorem (every term a written square, or a named side, or a trig value or π on the line: the unknown is a LENGTH, its positive root, the root simplified); the converse worked side by side (`=` or `\neq`); a trig ratio for a side (isolated first, then the special value, else `\approx` to 2 d.p.) or for an angle (the inverse ratio's principal value — for a capital, a named angle or a Greek letter; `x` stays a trig equation's); the laws of sines and cosines (a ratio beside the unknown stays written until the unknown is alone); Heron's formula | `5^{2} + 12^{2} = c^{2}` → `25 + 144 = c^{2}`, `169 = c^{2}`, `c = \sqrt{169}`, `c = 13`; `6^{2} + 7^{2} = 9^{2}` → `36 + 49 \neq 81`, `85 \neq 81`; `x\sqrt{2} = 10` → `x = \frac{10}{\sqrt{2}}`, `x = \frac{10\sqrt{2}}{2}`, `x = 5\sqrt{2}`; `\sin 30^{\circ} = \frac{x}{10}` → `x = 10\sin 30^{\circ}`, `x = 10 \cdot \frac{1}{2}`, `x = 5`; `\tan 40^{\circ} = \frac{x}{12}` → `x = 12\tan 40^{\circ}`, `x \approx 10.07`; `\tan \theta = \frac{3}{4}` → `\theta = \tan^{-1}\left(\frac{3}{4}\right)`, `\theta \approx 36.87^{\circ}`; `\frac{a}{\sin 30^{\circ}} = \frac{10}{\sin 45^{\circ}}` → `a\sin 45^{\circ} = 10\sin 30^{\circ}`, `a = \frac{10\sin 30^{\circ}}{\sin 45^{\circ}}`, `a = 5\sqrt{2}`; `7^{2} = 5^{2} + 8^{2} - 2(5)(8)\cos C` → … `80\cos C = 40`, `\cos C = \frac{1}{2}`, `C = \cos^{-1}\left(\frac{1}{2}\right)`, `C = 60^{\circ}` |
| Measurement: a formula with its values in, worked round by round (brackets, then powers and roots and trig values, then products, then sums) with exact values (`geometryValue.ts`: rationals, `\pi`, square roots, degrees, one length unit) — `\approx` only when the column works in decimals or π sits under a root; a formula under its known values (`r = 5`, `A = \pi r^{2}`, `A = ?`), solved back for a length (positive, `\sqrt[3]{}` for a volume); parts defined in x (`AB = 2x + 3`, `AB + BC = AC`) substituted, solved, and the part asked for evaluated | `A = \pi (5)^{2}` → `A = \pi(25)`, `A = 25\pi`; `SA = 2\pi r^{2} + 2\pi rh` (r = 3, h = 5) → `SA = 2\pi(3)^{2} + 2\pi(3)(5)`, `SA = 2\pi(9) + 2\pi(3)(5)`, `SA = 18\pi + 30\pi`, `SA = 48\pi`; `A = \pi (2.5)^{2}` → … `A = 6.25\pi`, `A \approx 19.63`; `A = \pi r^{2}`, `A = 50`, `r = ?` → `50 = \pi r^{2}`, `r^{2} = \frac{50}{\pi}`, `r = \sqrt{\frac{50}{\pi}}`, `r \approx 3.99`; `r = 5 \mathrm{~cm}` … → `A = 25\pi\,\mathrm{cm}^{2}`; `s = \frac{60^{\circ}}{360^{\circ}} \cdot 2\pi (6)` → `s = \frac{1}{6} \cdot 2\pi(6)`, `s = 2\pi` |
| Proportions (similar figures): two fractions, the unknown in one slot, cross-multiplied (a power of a fraction worked out first); the unknown in both means is its square (the geometric mean, a length) | `\frac{x}{6} = \frac{8}{12}` → `12x = 6(8)`, `12x = 48`, `x = 4`; `\frac{A}{20} = \left(\frac{3}{2}\right)^{2}` → `\frac{A}{20} = \frac{9}{4}`, `4A = 20(9)`, `4A = 180`, `A = 45`; `\frac{4}{CD} = \frac{CD}{9}` → `CD^{2} = 4(9)`, `CD^{2} = 36`, `CD = \sqrt{36}`, `CD = 6` |
| Coordinates (`engine/coordinates.ts`): points `A(1, 2)`, `(1, 2)`; the distance, midpoint and slope asked by name (`AB = ?`, `d = ?`, `M = ?`, `m_{AB} = ?`) or by the formula in `x_{1}`, `y_{2}`, …; the perpendicular / parallel slope (`m_{\perp} = ?`); a segment in a ratio (`AP : PB = 2 : 3`); a triangle's area from its vertices; a point worked out coordinate by coordinate | `A(-2, 3), \ B(4, -5)`, `AB =` → `AB = \sqrt{(4 - (-2))^{2} + (-5 - 3)^{2}}`, `AB = \sqrt{6^{2} + (-8)^{2}}`, `AB = \sqrt{36 + 64}`, `AB = \sqrt{100}`, `AB = 10`; `M = ?` → `M = \left(\frac{1 + 4}{2}, \frac{2 + 6}{2}\right)`, `M = \left(\frac{5}{2}, 4\right)`; `m_{\perp} = ?` → `m = \frac{3}{4}`, `m_{\perp} = -\frac{4}{3}`; `AP : PB = 2 : 3` → … `P = (1 + 4, 2 + 4)`, `P = (5, 6)` |
| Transformations about the origin, as maths (no "x-axis" in words): `R_{90^{\circ}}` (anticlockwise), `r_{y = x}`, `r_{y = 0}`, `r_{x = 2}`, `T_{\langle a, b \rangle}`, `D_{k}`, or a mapping rule `(x, y) \to (…)` beside a point; the rule, then the image | `R_{90^{\circ}}(2, 3)` → `(x, y) \to (-y, x)`, `(2, 3) \to (-3, 2)`; `T_{\langle 3, -2 \rangle}(1, 4)` → `(x, y) \to (x + 3, y - 2)`, `(1, 4) \to (1 + 3, 4 - 2)`, `(1, 4) \to (4, 2)` |
| Circles: the general form by completing the square, the standard form read when asked (`r = ?`, `(h, k) = ?` — alone it may be half of a system with a line), the equation from h, k, r | `x^{2} + y^{2} - 6x + 4y - 12 = 0` → `x^{2} - 6x + y^{2} + 4y = 12`, `x^{2} - 6x + 9 + y^{2} + 4y + 4 = 12 + 9 + 4`, `(x - 3)^{2} + (y + 2)^{2} = 25`, `(h, k) = (3, -2), \ r = 5`; `h = 2`, `k = -3`, `r = 5`, `(x - h)^{2} + (y - k)^{2} = r^{2}` → `(x - 2)^{2} + (y + 3)^{2} = 5^{2}`, `(x - 2)^{2} + (y + 3)^{2} = 25` |
| Checking geometry the student wrote: an angle equation in degrees is compared as numbers of degrees (not inside a trig ratio, not under a trig equation); a length's positive root is right (`c = 13` under `5^{2} + 12^{2} = c^{2}`, `c = -13` ringed); one angle of a trig equation is right (`\theta = \tan^{-1}\left(\frac{3}{4}\right)`, `x = 30^{\circ}` under `\sin x = \frac{1}{2}`); a named point worked out is compared by value; another fact about the figure (`BC = 3x - 1` under `AB = 2x + 3`) is `none`, and a check written `\stackrel{?}{=}` is a question, never ringed | `x + 35^{\circ} + 75^{\circ} = 180^{\circ}` → `x = 70^{\circ}` ✓, `x = 80^{\circ}` ring; `M = \left(\frac{1 + 4}{2}, \frac{2 + 6}{2}\right)` → `M = \left(\frac{5}{2}, 4\right)` ✓ |

| Refused (`kind: 'unknown'`, no result) | Why |
|---|---|
| Limits outside the cases above: `\lim_{n \to \infty}(1 + \frac{1}{n})^n` (not a rational function at ∞), one-sided (`x \to 0^{+}`), a non-zero number over zero (`\frac{1}{x - 1}` at 1, `\frac{\cos x}{x}` at 0), 0/0 still 0/0 after three rounds of L'Hôpital | Sampling near the point would be a guess, not an answer. Refused limits are `unknown` |
| A trig equation at a non-special value (`\sin x = \frac{1}{3}`), with the unknown also outside the functions (`\sin x = x`), a non-linear argument (`\sin(x^{2})`), or a mix the identities above do not reduce (`\sin x + \tan x = 1`) | Refused outright (`solveLatex` → null) — the numeric root-finder used to list thirty values in radians, which is no answer to a school interval |
| Matrices, `\begin{array}`, `\begin{cases}` (a piecewise definition is used only as the definition above a call, `f(3) =`) | No linear algebra. Classified `unknown` rather than `text`, so it reads as "cannot do this", not as a caption |
| Integrals with no elementary antiderivative (`\int e^{x^{2}} dx`, `\int \frac{\sin x}{x} dx`), parts that go round in a circle (`\int e^{x}\sin x \, dx`), partial fractions with a repeated or irreducible quadratic factor or a numerator of degree ≥ the denominator's, completing the square (`\frac{1}{x^{2} + x + 1}`); improper/divergent/singular definite ones; an integrand whose variable is not the `dx` | Every answer is checked by differentiating it back; what the engine cannot integrate exactly it does not write, and a Simpson sum over a singularity is meaningless |
| `\frac{d}{dx} f(x)`, `\frac{d}{dx} \Gamma(x)`, `\frac{dy}{dx}` with no definition in scope | An unknown function would otherwise be read as a constant factor and "differentiated" to `f` |
| `\sum_{i=1}^{3} i + 1` (ambiguous summand), symbolic limits, an infinite sum that is not a geometric series with \|r\| < 1 | Two readings on paper; the engine refuses rather than picking one |
| `f(4)`, `f(3) = 9` with no definition of f above; `f^{-1}(x)` of an even power | A call is not a product (it used to be answered `= 4f`, `3f = 9`, `f = 3`); an even power has no inverse without a restricted domain |
| A lone `2x + 3y = 6` (no `y = ?` under it) | It may be one equation of a word problem's setup in two unknowns: the model has the context |
| A letter under a root (`\sqrt{18x^{2}}`), synthetic division's tableau, an infinite geometric series with \|r\| ≥ 1, a frequency table, the mode when every value repeats equally | \|x\| would be needed; long division's lines are written instead of the tableau; no sum exists; a table is not read; texts disagree on that mode |
| Geometry that needs the figure beyond what `planFigure` knows (areas, perimeters, arc lengths, trig in a triangle, several unknowns tied together), similarity proofs, and proofs by segment or angle addition (read, their reasons never marked, not planned), constructions | The figure path reads angles and sides and the relationships listed under "The tutor reads the figure"; anything else is the model's own lines, kept only when they solve to a sensible size |
| The ambiguous case of the law of sines (a second triangle with the obtuse angle), an obtuse angle from a sine, a negative ratio for a triangle's angle, a vertical line's slope, a circle whose r² ≤ 0, a named angle or segment the steps cannot take | One principal value or nothing, never a list that may not fit the figure; a named quantity is refused outright (`solveLatex` / `solveFromLines` → null), so no other method writes its internal name (`angle_A = 50`) |
| A trig equation in `x` at a non-special value (`\tan x = \frac{3}{4}`) | `x` is a trig equation's unknown (every angle in a turn); a capital, a named angle or a Greek letter (`\tan\theta = \frac{3}{4}`) is an angle of a triangle and gets its principal value |

Bound variables are bound: the `dx` of a definite integral, the variable of a limit and the index of a sum are removed from a line's free variables, so `\int_0^1 x^2 dx =` is a closed expression the engine answers, not an expression in `x` (an indefinite integral's `x` stays free: its answer is a function of `x`). A trailing `=` on any of the above follows the same rule as `36 + 2 =` — the value is revealed in answer mode only.

**Operation lines (`engine/operationLine.ts`, line kind `operation`).** What a class writes under an equation to say what it does to both sides next: the same operation and operand under each side (`-3 \quad -3`, `+5+5`, `-2x - 2x`, `\div 2 \div 2`, `/2 \quad /2`, `\times 3 \times 3`, `\cdot 3 \cdot 3`, three under a chain), or a divisor or factor once (`\div 2`, `/2`, `\frac{}{2}`, `\overline{2}`, `\times 3`, and a division bar's read, above). Mathpix's reads, measured on the tutor's hand writing as the student (39 calls): `-3` under each side → `\begin{array}{ll} -3 & -3 \end{array}`, `-3 \quad-3` or `\text { -3 -3 }`; `÷2 ÷2` → `\div 2 \div 2`; `×3 ×3` → `\times 3 \times 3`; `+5 +5` → `+5+5`; a bar with `2` under it → `2`; `/2 /2` → `1212` (the hand's slash is a 1; one leaning well over reads `/ 2 \quad / 2`); `·3 ·3` → `3.3` (never taken for one). `analyzeLine` asks it first; a sum or difference counts only under an equation or inequality (`-3 - 3` alone is -6). Against the relation above (the tutor's problem counts): `ok` for the same valid operation on every side, `mismatch` for two different operands (`-3 \quad -4`) under a LINEAR relation or × / ÷ by 0, `none` for two different operands under anything else (a quadratic, trig, a log, a root, a rational: `-2 \quad -5` under `x^2 - 7x + 10 = 0` is a factor pair, scratch — still an operation line, so the next line keeps the equation above as its context; `linearRelation`), `none` by a letter (it may be 0) or with the wrong number of operands; dividing an inequality by a negative is fine — the next line must turn the sign, and its own check says whether it did. The line after it is checked against the equation ABOVE it (`columnContext`, `localSolve`'s `contextAbove` skip operation lines), so an equivalent next line is ticked whether or not it is what the operation gives; `lastGoodLineAbove`, `buildCheckLines` (the model never sees one), Solve's column and target skip them too, and `localSolve` takes them out. `operationResult` works out the relation the operation leads to (`2x + 3 = 11`, `-3 \quad -3` → `2x = 8`; `2\sin x = 1`, `\div 2` → `\sin x = \frac{1}{2}`; `-2x < 6` ÷ −2 → `x > -3`): in Suggest and Solve, once the student stops, the tutor writes it under a right operation line with nothing under it (`writeOperationResults`, `meta.operationResult`; gone when the operation changes). The pieces of an operation row are one line however far apart the sides are (`mergeOperationRows` in `strokeClusters.ts`: short pieces starting with a `-`, `+` or `÷` bar, level, under one line). Scoreboard: `op-01`…`op-10` in `src/__eval__/corpus.ts`.

**Calculus steps (`engine/calculus.ts`).** `latex.ts` reads `\frac{d}{dx}` (also `\frac{\mathrm{d}}{\mathrm{d} x}`, `\operatorname{d}`, `d x`), `\int … dx` (also `\mathrm{~d} x`), `\lim_{x \to a}` (also `\rightarrow`, `\infty`) and `\left[F\right]_a^b` into `derivative()`, `integral()`/`antiderivative()`, `limit()` and `bracketEval()`; `calculus.ts` registers the last three on the mathjs instance and answers all four with the lines a teacher writes. The board asks for them through the existing contract only: `simplifySteps` (a calculus expression, with or without a trailing `=`; drawn as `= …` lines), `solveFromLines` (`\frac{dy}{dx}` / `f'(2)` under a definition, and any calculus line under other work, so a system above never answers it) and `analyzeLine(…).resultLatex` (the last line, e.g. `6x + 2`, `\ln 2`, `\frac{x^{3}}{3} + C`). Every result is checked numerically before it is returned — a derivative against a central difference, an antiderivative by differentiating it back, a definite integral against Simpson, a limit against the function near the point — so a bug becomes no answer, never a wrong line. The techniques live beside it and hook in through `CalculusDeps` (`integrate`, `integrateDefinite`, `limit`: `integration.ts`, `limits.ts`), tried only when calculus.ts's own rules have nothing and checked by it the same way; they share its expression tree, printer and exact values. A step that is a relation of its own — `u = x^{2} + 1`, `du = 2x \, dx`, the parts, `A = \frac{1}{2}, \ B = -\frac{1}{2}`, `y = x^{x}` — is drawn as it stands; every other line continues the question with `=` (`continueLine` in `engine/solution.ts`, used by `localAnswerStep`).

**Algebra 1 and Algebra 2 (`engine/courses.ts`).** The course methods sit behind the same contract, asked first at fixed hooks in `index.ts` and never instead of a path they do not own: `simplify` (in `simplifySteps`, after calculus and trig: exponent laws, radicals, complex numbers, log properties, the binomial theorem, rational expressions, series), `simplifyLate` (after the polynomial paths: long division), `solve` (at the top of `solveLatex`: complex roots when allowed, exponentials over two bases, a line through two points, a line already in y), `fromLines` (in `solveFromLines`, before the systems: function notation, lines, sequences, a mean, a formula in decimals), `fromLinesLate` (after the systems: a formula for one letter), `analyze` (a claim `f(4) = 11` under its definition) and `polish` (an exact `x = \log_{5} 7` gets its change of base). `"refuse"` from a hook means the older paths would misread the line (`f(4)` as `4f`) and nothing is written. They share `engine/courseKit.ts`: reading a line, printing a tree as a student writes it, and the numeric self-check each runs before answering — a bug is no answer, never a wrong line. `solveLatex` takes an optional `SolveOptions` (`contracts.ts`): the column down to the line (a function defined above is not a product) and `complexRoots`. The scoreboard reports by course (`docs/eval/offline.md`, "By course"); `docs/eval/courses.md` lists the Algebra 1 and Algebra 2 skills and what is done.

Algebra 2's function hooks (`courses.ts`): `analyzeFunction` (at the top of `analyzeLine`'s function case: a function written from the one above, and a rewrite of it), `askLine` (before `preClassify`: `\text{holes}` under a function is an ask), and `calculusOfDefined` (in `solveFromLines`, when the calculus reading claims a line and has nothing: `\lim_{x \to \infty} f(x) =` with f's definition put in). Their scoreboard shapes, `expect.rational` and `expect.transform`, are judged by `src/__eval__/functionFeatures.ts`, written apart from the engine.

**Asked by name or by template (`courses.analyzeFirst`, `statistics.ts`, `quadraticForms.ts`, `linearFunctions.ts`).** With no words on the board, a student asks for a form or a statistic by writing its template (`Ax + By = C`, `y = a(x - h)^{2} + k`, `(h, k) = ?`) or their own label (`\text{median} = ?`, `\text{vertex form}`) under the data, line or quadratic it is about. `analyzeLine` asks `courses.analyzeFirst` before geometry: such an ask is kind `unknown` — not a step, not prose (`needsLook` would put a "?" on it instead of solving), not geometry's `(h, k)` label — and a line about a data list carries the list in its `math` so a claim several lines down is still checked. `fromLines` answers the ask first; `solve` converts the line Solve is pressed on when the form is asked above it. The student's own label may be repeated on the answer line (`\text{median} = 8`); the scoreboard's "no words" stage allows exactly that and nothing else.

**Geometry (`engine/geometry.ts` and its modules).** The maths a student writes beside a figure, through the same contract: `analyzeLine` asks `geometry.analyze` first (figure statements, points, transformation notation, angle equations in degrees compared as numbers of degrees), `solveLatex` asks `geometry.solveLine` first, `solveFromLines` asks `geometry.fromLines` after the calculus, and `simplifySteps` asks `geometry.simplify` after the trig values. A line is claimed only when it carries geometry — a degree sign, π, a root or a trig value among the numbers, a named angle or segment, a Pythagorean shape, a proportion, a formula with a bracket to work out — so a linear equation in plain numbers, a quadratic and a trig equation in `x` keep their own modules and steps; a line about a named quantity that geometry cannot take is refused outright (`"refuse"`), never passed on to a method that would write its internal name. The pieces: `geometryNotation.ts` (the names), `geometryValue.ts` (exact values: rationals × π^k × √m, with a degree and a length-unit dimension, the special-angle trig table; anything else throws `NotExact` and the answer is a decimal with `\approx`), `geometryExpr.ts` (the student's expression as a small tree, worked round by round in the school order and printed back in the student's notation — `\pi(5)^{2}`, `2(5)(7)`, `(4 - (-2))`), `geometryEquation.ts` (one equation: cross-multiplied, linear in the unknown, its power or its trig ratio; the power's positive root or the ratio's principal angle), `coordinates.ts` (points, transformations, circles). Every answer is substituted back numerically before it is returned: a bug is no answer, never a wrong line. The scoreboard's course is `src/__eval__/courses/geometry.ts` (153 problems, topics `geometry-*`); the judge reads a named unknown by its translation (`\angle C` is `angle_C`), a length through `interval: (0, ∞)`, a point answer (`point`: every numeric point on the way must be it), a check worked out side by side (`169 = 169`, `85 \neq 81`), and a curve in x and y rewritten (completing the square) by comparing y at several x.

**The model's steps are checked before they are drawn.** A solve step that does reach the client goes through `createSolveStepGuard` (`solveSteps.ts`) first: it must parse with the local engine (prose, an empty fragment and a broken `\frac` do not), and it must introduce no free variable that neither the student's own lines nor an earlier accepted step contain — unless the step is the assignment defining it (`v = 60/2` in a word problem is fine; `= r + 9\varepsilon` is not). Steps that fail are discarded, and if none survives the student sees the ordinary solve failure ("Couldn't work this out" plus Retry) rather than nonsense on their page. LLM steps are typeset `math` shapes, never handwriting: the tutor's hand is reserved for maths the engine derived.

All Live writes go through `editor.store.mergeRemoteChanges` (source `remote`): they are not in the undo stack and invisible to `source:'user'` listeners; the autosave listener uses `source:'all'` so they persist. Nothing runs on an idle timer outside Live any more: ink Live cannot read (non-maths, low confidence, a failed read) stays silent until the student asks with Help.

Live routes reuse the shared preamble (`requireUser` → `checkRateLimit` → zod) and add `X-Request-Id`. Streams are `text/event-stream` with `: ping` keepalives; model output is JSON Lines validated per line with zod before it is forwarded, and `expected` claims are re-verified by the local engine before an annotation is shown.
