# Agathon for iPad: where it stands (handoff, 2026-10-18)

Read this first, then `docs/IPAD-NATIVE.md` (the plan and decisions). It describes the branch
`feat/ipad-app` in `~/whiteboardstaging/ipad-app`.

## What it is

A native SwiftUI iPad app (iPadOS 17+, iPad only) that replaces the web frontend, which will be
retired. The backend stays: the Next.js API on Vercel and Supabase. Owner decisions:

- **Board:** our own whiteboard engine and our own board format. Old tldraw boards are converted
  and stay editable.
- **Brand:** "Blocks" (`docs/DESIGN-SYSTEM.md`, `docs/brand/directions.html`). Flat colour only;
  no gradients.
- **Payments:** Apple in-app purchase (StoreKit 2): $24.99 a month with a 7-day free trial.
  Existing Stripe subscribers keep their plan.
- **Onboarding:** in the style of Aristotle (`docs/ONBOARDING.md`). The trial is offered right after
  the account. "Not now" still gives the kid a profile and the free board.

## Packages (`ios/Packages`)

| Package | What it does | Docs |
|---|---|---|
| AgathonKit | Supabase auth and family profiles, the API client, SSE, repositories, error reports | — |
| AgathonBrain | The web's TypeScript board logic (maths engine, clustering, handwriting layout, planners) bundled as `brain.js` and run in JavaScriptCore | `npm run brain:build && npm run brain:golden` |
| AgathonBoard | The board engine: record store, compact ink, freehand, tiles, Pencil canvas, tools, the tldraw importer | `docs/BOARD-FORMAT.md` |
| AgathonBoardUI | `BoardEditorView` in Blocks (kid dock, top bar, pages, pictures, PDF), with slots `topTrailing` / `helpButton` / `overlay` | — |
| AgathonSync | Open, convert, autosave (the web's guarantees), backup, thumbnails, `SupabaseBoardAssetStore` | — |
| AgathonLive | The tutor on the board: Live loop, marks, hints, Solve, Now you try, early reading, Graph it, answer after "=" | `docs/IPAD-FAST.md` |
| AgathonAsk | The Ask chat panel, streaming, vision, board actions (the web's ChatDesk in the brain), hold-to-talk, read aloud | — |
| AgathonStore | StoreKit 2, the plan screen, the parental gate, out-of-ink, deletion advice | `docs/RUNBOOK-billing.md` §16 |
| AgathonDesign | Blocks tokens, bundled fonts, components, the mark, "the shapes" characters, stickers | — |
| SwiftMath | Vendored, MIT, typeset maths | — |

The app target (`ios/Agathon`) holds:

- **Screens** (`Screens/`): sign-in, Home, Progress, Account, Family, Report, Bug reports.
- **Debug labs** (`Debug/`): Board Lab, Board editor, Brain Lab, Design Gallery, Live Lab, Ask Lab,
  Billing Lab, Old debug screens. A Debug build shows a **Labs** button bottom-right on every screen.

## Not wired yet: the integration step

Every piece is built and tested on its own, but the real app doesn't connect them yet.

1. **Board opening.** `ios/Agathon/Screens/Board/BoardOpening.swift` is still `.readOnlyPreview`.
   Swap it to: `BoardEditorView` + AgathonSync (open, convert, autosave, `SupabaseBoardAssetStore`
   with the board id) + AgathonLive (`LiveLoop` with `CanvasLiveBoard`, its views in the editor's
   slots, the editor's selection as the loop's selection provider) + Ask
   (`AskParts.live(backend:boardId:board:helper:userId:grade:)`, `AskPanelContainer`, an Ask button,
   `LiveLoopAskHelper`). Pass `OpenBoard.practice` through. Hint-card `onSpeak` →
   `AskSpeech.speak(text:)`. Connect `driver.handwriting` to the Live setting.
2. **Onboarding.** RootView → `OnboardingFlow(onFinish:)` when `OnboardingState.needsOnboarding`.
   Swap its seams:
   - `TryItChecking` → AgathonLive
   - `TrialOffering` → AgathonStore
   - `ParentalGate` → the billing gate
3. **Money in the screens.** `GrownUpPlanFlow`, `OutOfInkView` and `DeletionAdvice` (AgathonStore)
   go into Home and Account. Today they're reachable only from Billing Lab.
4. **Brain golden check.** `npm test` fails until `npm run brain:build && npm run brain:golden` runs
   on the merged tree. Also check `BRAIN_GOLDEN_WRITE` in `.env.example`.
5. **Full QA.** Every test suite, plus end-to-end on the local stack, with screenshots.

## Build, run, test

- **Project:** `ios/project.yml` is the source; regenerate with `cd ios && xcodegen`. Sources are
  synced folders. The team is `SG4YJW2K5Z` (the owner's paid individual account).
- **Simulators (the owner is strict about this).** Never boot simulators or open the Simulator app
  directly. Run every simulator command through the one-at-a-time helper:
  `~/whiteboardstaging/sim-run.sh "iPad Pro 11-inch (M5)" -- bash -c '<cmds; $SIM_UDID is the booted
  device>'`. It holds a global lock, boots headless, then shuts everything down and runs
  `killall Simulator`.
  - Iterate with `xcodebuild build-for-testing -destination "generic/platform=iOS Simulator"`.
  - Pass `-parallel-testing-enabled NO`.
  - Unit tests: `xcodebuild -scheme Agathon test -skip-testing:AgathonUITests` (all packages are in
    the scheme).
- **Local backend.** Docker Supabase is shared by everyone, so never run `db:reset`, `supabase db reset`
  or `supabase stop`.
  - Start it with `npm run db:start` and `npm run dev -- -p <port>`.
  - Point the scheme's env vars at it: `AGATHON_API_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
  - QA users: `qa-student@example.com` / `password123`, and the family `ipad-kit-parent@example.com`
    / `password123` (PIN 2468, kid "Maya").
  - Production is never touched.
- **The owner's iPad** (iPad Air 11-inch M3, iPadOS 27):
  - Build with
    `xcodebuild … -destination 'platform=iOS,id=00008122-000E45D42298401C' -allowProvisioningUpdates -allowProvisioningDeviceRegistration`.
  - Then `xcrun devicectl device install app --device B734D02E-4AB7-5E09-89C4-7369EE3FB405 <.app>`.
  - Or just press Run in Xcode.
  - A Debug build talks to production, so sign-in is the real account. Boards open read-only
    ("Not saved yet") until the doc migration is applied.
- **StoreKit.** `AgathonTests/StoreKitFlowTests` runs only from Xcode (Product › Test with
  `AGATHON_STOREKIT=1`); `SKTestSession` fails from the command line.

## Production: waiting for the owner's OK (never apply without it)

1. **Migrations,** applied in this order, each after a backup (`docs/RUNBOOK-supabase.md`):
   - `supabase/migrations/20261017000000_agathon_doc.sql`: the iPad board document column. After
     this the web can only view iPad-edited boards.
   - `supabase/migrations/20261017200000_apple_subscriptions.sql`: Apple plans in
     `unlimited_subscriptions`.
   - `supabase/migrations/20261017210000_ipad_onboarding.sql`: App Attest tables; "Not now" (a kid
     without a plan spends the grown-up's ink); the new onboarding steps.
2. **Merging this branch into `main` deploys the web changes**:
   - read-only iPad boards and the server readers
   - the client-errors `ios` source
   - the Apple billing routes, which need `APPLE_ENVIRONMENT` / `APPLE_APP_APPLE_ID` in Vercel
   - the App Attest routes

   The web side works with or without the migrations, but apply them first.
3. **App Store Connect checklist:** `docs/RUNBOOK-billing.md` §16. It covers the Paid Apps agreement,
   the Small Business Program, the app record, the subscription `app.agathon.unlimited.monthly`, the
   1-week free intro offer, the Server Notifications V2 URL, the In-App Purchase key, sandbox
   testers, privacy labels and review notes.

## Open decisions for the owner

- **Returning subscribers.** When someone who already had a trial buys through Apple, Apple shows
  "1 week free", but the server gives no free help that week (the one-trial-per-account rule).
  Recommendation: honour Apple's free week.
- **On-device handwriting reader.** Not shipped. The best model read 62–71% of lines vs Mathpix's 97%,
  and there's a CROHME licence issue. Fine-tuning on our `/train` data needs the owner's OK. The
  prototype is parked on `feat/ipad-reader` and intentionally not merged (`docs/READER.md` there).
- **Apple Intelligence hint wording.** Behind a debug switch. To compare it on a supported iPad:
  Live Lab → "Hint words: iPad vs server". Ship it only if it's under ~0.8 s and the words are as
  good as the server's.
- **Kids category.** Recommendation: list under Education, not Apple's Kids category (kid data goes to
  AI providers), and keep the grown-up areas gated.

## Known gaps (from the lanes' reports)

- **Live:**
  - not yet ported: `learning_attempts` recording, graphs/figures/proofs from ink, stacked sums,
    "givens"
  - slow writers' lines are read about 3 times
- **Ask:** "Practice my weak spots", the learner record, the topic kickoff, the account's "What Ask
  remembers" view, and real ElevenLabs voice (the QA user had no plan, so only the fallbacks ran).
- **Board:**
  - erase speed on a device is unmeasured
  - the highlighter has no dock button
  - no rotate handle
  - the Pages sheet has no UI test
- **Saving:** real Storage picture uploads are unverified locally (42P10), and so is the live admin
  viewer.
- **Billing:** the admin funnel counts sandbox rows, and Apple has no equivalent of the Stripe referral
  month.
- **Screens:** Today's practice lists problems over the board instead of writing them in the tutor's
  hand.

## Branches

| Branch | State |
|---|---|
| `feat/ipad-app` | Everything merged here |
| `feat/ipad-reader` | Parked |
| `feat/ipad-kit`, `-brain`, `-board`, `-design`, `-tools`, `-sync`, `-live`, `-billing`, `-screens`, `-ask`, `-fast`, `-onboarding` | Merged lane branches |
