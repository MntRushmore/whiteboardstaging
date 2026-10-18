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
2. **Onboarding** (merged; `docs/ONBOARDING.md` "As built"). RootView → `OnboardingFlow(onFinish:)` when
   `OnboardingState.needsOnboarding`; open the board editor on `.firstBoard`.
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

## Production

- **Supabase migrations: APPLIED 2026-10-18 18:33 ET with the owner's OK** ("yes u can do everything to
  prod supabase").
  - All six are applied and recorded in `supabase_migrations.schema_migrations` (44 in total):
    - `20261013000000_try_board_step`, `20261013020000_start_steps`, `20261013030000_free_board_step`.
      These were on `main` but had never been applied, so `/start` and the try board on the live web
      lacked their database pieces until now.
    - `20261017000000_agathon_doc`, `20261017200000_apple_subscriptions`,
      `20261017210000_ipad_onboarding`.
  - Backup taken first:
    `~/.config/agathon-classroom/backups/prod-public-20261018-1833-before-ipad-migrations.dump`
    (pg_dump of the public schema, 17 MB, checked with `pg_restore -l`).
  - Verified:
    - the doc columns exist on `whiteboards` (180 boards, none with a doc yet)
    - all 23 subscriptions are `provider = 'stripe'`
    - the App Attest and `start_steps` tables have RLS on, with no policies and no grants (service
      role only)
    - `apply_apple_subscription` and `refund_ink_for` are service-only
    - `consume_credits`, `ink_summary` and `delete_own_account` are callable by signed-in users, as
      before
  - Effect: the app's saving (AgathonSync) now writes iPad documents in production. Once a board is
    saved from the iPad, the web can only view it.
- **Not done (needs its own OK): merging this branch into `main`**, which deploys the web changes.
  These are:
  - read-only iPad boards and the server readers
  - the client-errors `ios` source
  - the Apple billing routes (they need `APPLE_ENVIRONMENT` / `APPLE_APP_APPLE_ID` in Vercel)
  - the App Attest routes
- **App Store Connect checklist:** `docs/RUNBOOK-billing.md` §16. It covers the Paid Apps agreement,
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
- **Onboarding:**
  - the largest-text run fails at the first board
  - no avatar art yet
  - App Attest on a real device may need the App Attest capability
  - the try page is small in portrait

## Branches

| Branch | State |
|---|---|
| `feat/ipad-app` | Everything merged here |
| `feat/ipad-reader` | Parked |
| `feat/ipad-kit`, `-brain`, `-board`, `-design`, `-tools`, `-sync`, `-live`, `-billing`, `-screens`, `-ask`, `-fast`, `-onboarding` | Merged lane branches (all merged into `feat/ipad-app`) |
