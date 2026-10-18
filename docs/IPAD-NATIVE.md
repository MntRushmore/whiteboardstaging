# Agathon for iPad: the native app

Started 2026-10-17. The owner's brief, in their words:

- "i need it to be a full ipad version of the app, we will deprecate the web app in the future"
- "a new custom whiteboard just built for agathon … Agathon specific so we are fully independent
  and can build the best version"
- "We are also redoing UI and everything! Fresh, modern, fun, kiddish brand!"

Decisions:

- **Payments:** Apple in-app purchase (StoreKit 2). Existing Stripe subscribers keep their plan.
- **Old boards:** converted to the new format and fully editable.
- **Flat colour only:** the owner hates decorative gradients. Masks and shimmers that do a job are fine.

## What we are building

A SwiftUI iPad app (iPadOS 17+, iPad only for now) with its own whiteboard engine and a new kid
brand. The backend stays where it is: the Next.js API routes on Vercel and Supabase. The app calls
them the way the web app does, with `Authorization: Bearer <Supabase access token>`. Every route
already works that way: no cookies, no CSRF, no origin checks on the routes the app needs. AI keys
never ship inside the app.

Not ported:

- the landing pages, `/try`, the `/start` funnel and the SEO pages (the App Store page does their job)
- `/train` and Feature Labs stickers
- Lecture mode, hidden since 2026-10-03 (port it if it comes back)
- the legacy `/api/live/chat`
- the admin console, which stays a small owner-only web app

## Architecture

```
ios/
  project.yml                 XcodeGen spec (run `xcodegen` in ios/). Settings live here, not in Xcode.
  Agathon/                    the app target: screens, navigation, wiring (synced folder)
  AgathonTests/
  Packages/
    AgathonKit/               backend: Supabase auth + family profiles, API client, SSE, models, telemetry
    AgathonBoard/             the whiteboard engine: document model, Pencil input, renderer, tools, undo
    AgathonBrain/             the shared TypeScript board logic, bundled and run in JavaScriptCore
    AgathonDesign/            the new brand's design system (after the owner picks a direction)
    AgathonStore/             Agathon Unlimited through StoreKit 2 (product, purchase, listener, restore, gate)
```

### The board: AgathonBoard (our own engine)

- **Document:** a typed record store, the same idea as tldraw's but our own schema built around
  Agathon:
  - screens (16:9 pages), strokes (the kid's ink and the tutor's ink)
  - marks (tick, ring, question)
  - lines and problems (what the recognizer read)
  - math, graph, image and shape objects

  Records have stable ids, fractional ordering and an undo log. Changes are diffs, so saving, undo
  and a later live sync (phone as pen, a parent watching) all use one mechanism.
- **Input:** Apple Pencil first: coalesced and predicted touches, pressure, tilt. A finger never
  draws once a Pencil has been seen (palm rejection); fingers pan and pinch. There is a setting to
  draw with a finger.
- **Rendering:** variable-width freehand outlines, the same family of algorithm as perfect-freehand.
  Live ink sits on its own layer. Settled ink sits in tiles. The tutor's ink is written at handwriting
  pace.
- **Storage:** a new `whiteboards` column for the Agathon document, next to the tldraw `data`.
  - A converter turns a tldraw snapshot into an Agathon document the first time a board opens on
    the iPad. The original stays untouched.
  - The server's board readers move to the new format: the report replay, the admin viewer, the gc
    job and `report/server.ts`.
  - Saving keeps today's guarantees: a version-checked update, a merge on conflict, a local backup
    of anything unsaved, and waiting for the pen to lift.

### The brain: AgathonBrain (shared TypeScript in JavaScriptCore)

About 75k lines of board logic run in the browser today and are pure TypeScript:

- `src/lib/live/engine`: the mathjs engine (29k lines)
- stroke clustering and the recognizer payload
- diagrams, the help policy, placement and marks
- the tutor's handwriting layout (`src/lib/hand`, `mathLayout.ts`)
- the chat and Ask action planners, figures, graphs, models and proofs
- the learning generators and progress summaries

Rewriting the maths engine in Swift is the biggest risk in the project, so we don't.

- **Bundle:** esbuild bundles these modules into one `brain.js` behind a small API that takes
  Agathon's own plain data (strokes as arrays, records as JSON), not tldraw types.
- **Host:** the app runs `brain.js` in a `JSContext`. Calls are synchronous, and the bundle ships
  inside the app.
- **Orchestration:** the Live loop is rewritten in Swift against AgathonBoard, calling the brain for
  the maths.
- **Speed:** measure it. JavaScriptCore in an app has no JIT. Hot paths move to Swift if they are
  too slow.

### AgathonKit (backend)

- **Auth:** supabase-swift, email and password. Sign-up sends `terms_version` (the
  `require_signup_terms` trigger refuses a sign-up without it). Password reset arrives through a
  universal link.
- **Family:** `POST /api/family/switch` → `setSession`. The grown-up's side needs the PIN.
- **API client:**
  - Bearer token on every call.
  - Error decoding: `rate_limited` with `retryAfterMs`, `ink_empty` 402.
  - One retry after a 401 `PGRST303`.
  - A 30 s stall timeout.
- **SSE:** `event:` / `data:` lines with `: ping` comments, for `/live/ask`, `/live/check` and
  `/live/solve`.
- **Data the app reads and writes directly, as the user, under RLS:**
  - tables `whiteboards`, `board_assets` and storage `board-assets`
  - `profiles`, `learning_attempts`, `daily_practice`
  - RPCs `ink_summary`, `save_onboarding`, `save_daily_practice`, `delete_own_account`
- **Errors:** sent to `/api/client-errors` (`path` starts with `/`, `release` = app version+build).

### Money (StoreKit 2)

- **Plan:** one auto-renewing subscription in the App Store Connect record, with a 7-day free trial
  (Apple's introductory offer). `appAccountToken` = `profiles.checkout_ref`.
- **Server:**
  - a route that verifies a signed transaction from the app
  - a receiver for App Store Server Notifications V2
  - both write `unlimited_subscriptions` through a new service-role RPC, so `has_unlimited`, ink,
    fair use, kids and reports all keep working unchanged
- **Accounts:** account deletion must not be blocked by an Apple subscription; tell the grown-up to
  cancel it in Settings instead.
- **Kids:** never see prices; a parental gate guards the grown-up areas.
- **Built (billing lane, 2026-10-17):** `supabase/migrations/20261017200000_apple_subscriptions.sql`,
  `src/app/api/billing/apple/{transaction,notifications}`, `ios/Packages/AgathonStore`,
  `ios/Agathon/Billing` (gate, plan screen, out of ink), Labs > Billing Lab, `ios/Agathon/Agathon.storekit`
  (the scheme's StoreKit configuration). How it works, testing it, and the owner's App Store Connect
  checklist: docs/RUNBOOK-billing.md section 16.

## Phases

| Phase | What ships | Lanes |
|---|---|---|
| 0 Foundations | Packages and project wiring; AgathonKit (sign-in, boards list, API, SSE) with plain debug screens; the board engine spike (Pencil latency, document model, render old boards); the brain spike (bundle, host, speed); **3 brand directions for the owner** | kit, board, brain, brand |
| 1 Board | Every tool (pen, eraser, select/move, shapes, picture, PDF via PDFKit, undo/redo, colours, screens); the converter; autosave; thumbnails; math (native LaTeX) and graph objects; the design system from the chosen brand | board, convert, design |
| 2 Tutor on the board | The Live loop in Swift with the brain; recognize/check/solve/reread/setup; marks, hint cards, tutor handwriting, celebrations, Now you try; help dial, Auto, Help me | live |
| 3 Ask | Chat panel (docked or sheet), streaming, maths in messages, board picture for vision, actions drawn on the board, hold-to-talk (`/live/transcribe`), read aloud (`/live/speak`), memory | ask |
| 4 Screens | Sign-in, sign-up and reset; onboarding and the guided first board; home (boards, today's practice, skill path, topics); progress; account; family and PIN; weekly report and replay; bug reports; ink and out-of-ink | screens |
| 5 Money | StoreKit, server routes, migration, restore, parental gate, deletion rules | billing |
| 6 Ship | Developer account, App Store Connect, privacy labels, age rating, TestFlight, review notes and demo account, universal links for email links | ship |

## Conventions for every lane

- **Branches:** one per lane off `feat/ipad-app`, each in its own worktree under
  `~/whiteboardstaging/`. Commit as you go; never push. The lead merges.
- **Simulators:** one per lane, so lanes don't fight over a device:
  - kit → iPad Pro 11-inch (M5)
  - board → iPad Pro 13-inch (M5)
  - brain → iPad Air 11-inch (M4)
- **Build and test:** `xcodebuild … -derivedDataPath <your scratch dir>`. Delete DerivedData and
  `.next` folders when done; the disk filled up once before.
- **Local backend:** `npm run db:start` (Docker Supabase) + `npm run db:seed` + `npm run dev`. Point the
  app at it with `AGATHON_API_URL` / `SUPABASE_URL` / `SUPABASE_ANON_KEY`. Never write test data to
  production.
- **Kid copy:** short, kind, US English. The tutor never says "wrong". Kids never see prices.
- **Tutor ink:** keeps its own colour, which the kid's palette never uses.
- **Flat colour,** no decorative gradients.
- **Swift:** Swift 5 language mode with `@MainActor` UI, Swift Testing for tests, no force-unwraps
  on data from the network.

## Owner to-dos

1. ~~Enrol in the Apple Developer Program~~ — already done: individual team `SG4YJW2K5Z` ("Rushil Chopra") is signed in to Xcode. An organization account (seller shown as the company, not a person) can come later.
2. ~~Pick a brand direction~~ — **A · Blocks**, with C's sticker book for practice rewards
   (2026-10-17; docs/brand/directions.html on the design branch).
3. **Kids category:** recommend *not* listing in Apple's Kids category, because kid data goes to
   third-party AI providers. List under Education and gate the grown-up areas instead. Decide
   before submission.
