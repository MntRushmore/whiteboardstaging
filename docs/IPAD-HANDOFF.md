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

## Wired: one app (the integration, branch `feat/ipad-integrate`)

The pieces are connected; the old stand-ins stay only in Debug (Labs).

1. **The board** (`ios/Agathon/Screens/Board`): `BoardOpening.current` is `BoardScreen`.
   - `BoardEditorView` (Blocks), saved by AgathonSync (`BoardSession.make`: open / convert / autosave /
     backup / thumbnail, `SupabaseBoardAssetStore` with the board id). The save pill (`BoardSaveStatus`)
     says Saved, Saving… (only after 1.2 s, so a stroke never flickers it), Offline · kept on this
     iPad, Couldn't save + Try now, Board full, and **Not saved yet only for `localOnly`** (a server that
     can't hold the board). Its accessibility value carries the detail (`saved v4 converted written`).
   - `BoardTutor` (made when the canvas is up, stopped when the board closes): `LiveLoop` on
     `CanvasLiveBoard`, the editor's selection as the selection provider; `LiveHelpBar` in
     `helpButton`; save pill + `LiveStatusView` + `GrownUpLiveButton` + Ask in `topTrailing` (words
     drop in narrow windows); `LiveOverlay` in `overlay` (hint cards read aloud through
     `AskSpeech.speak`); `AskParts.live` + `LiveLoopAskHelper` in `AskPanelContainer`; Ask's
     `driver.handwriting` follows the Live setting. The keyboard never squeezes the board (Ask's panel
     keeps above it).
   - **Practice** (`OpenBoard.practice`: Today's practice, topics) is written on the board in the
     tutor's hand through Ask's `write_problems` (the brain's desk), once per board
     (`documentMeta.practiceWritten`). Problems written outside the loop (the desk's, the onboarding's
     first board) become `problem` records (`LiveLoop.problemsChanged`, new file
     `LiveLoop+Problems.swift`), so the kid's work under each is judged against it (the web's
     `judgeLine` through the brain: a bare answer beside a sum is checked, a step carried on from a
     slip is marked as carried). The set is written inside `loop.learning.writing(.practice)`, and
     Today's practice counts with `loop.learning.daily(day:goal:)` (the star pill in the top bar).
   - **Out of ink** (Live's `outOfInk` or Ask's `ink` failure): `OutOfInkView` over the board, kid
     words for a kid profile, the plan (behind the gate) for a grown-up; at most once a minute; the
     status pill keeps saying "Help is paused".
   - **Lifecycle:** background → backup + save at once (a background task); close → save, stop the
     loop, Ask's reply, its pen (lines begun finish whole), voice and mic, then everything is freed (`BoardIntegrationTests`
     `aClosedBoardLetsEverythingGo`). Home reads the boards again when a board closes (and 2 s later,
     for the last save's thumbnail).
2. **First launch:** `RootView` opens `OnboardingFlow` signed out on an iPad that never finished it
   (or signed in with a kept flow) and keeps it on screen through its own sign-up and family switch.
   Seams: `StoreTrialOffering` (AgathonStore's `PlanStore`: product, purchase with the checkout
   reference, Restore, `hasPlan` from the server), `AppParentalGate`, `PreAccountTryChecker` as built.
   `.firstBoard` opens straight into the real board (`HomeView(firstBoard:)`; the row is made, or its
   document saved, if the onboarding couldn't). The first board carries the try as a read `line` with
   its `mark`, so the tutor neither reads it again nor ticks it twice.
   - **App Attest:** `com.apple.developer.devicecheck.appattest-environment` — development for Debug
     (`ios/Support/Agathon-Debug.entitlements`), production for Release. The simulator's debug header
     is never sent to production (`AppAttestor(allowsDebugHeader:)`).
3. **One parental gate app-wide:** `AppParentalGate` (the billing lane's number in words, typed on the
   pad) — the onboarding's gate step (its `ParentalGate` seam now takes the gate's own question and
   prompt) and `ParentalGateView` (every path to money). `BirthYearGate` remains the package default
   for tests and previews only.
4. **Money in the screens:** `GrownUpPlanFlow` from Home's ink meter (grown-ups only) and Account's
   Plan card; `OutOfInkView` on the board; `DeletionAdvice` in the delete sheet (an Apple plan no
   longer blocks deletion, as `delete_own_account`; a web plan still does); `PlanStore.start()` at
   launch (unchanged).
5. **Debug only:** Labs, the old debug screens, the plain board (`Debug/PlainBoardScreen.swift`), the
   Brain Lab, `-boardAutowrite "a|b|newpage"` (a kid's hand through the canvas's touch path, a button
   under the top bar), `debug.live` (what the tutor made of the board, for UI tests),
   `-windowWidth 507` (a Split View-sized window for screenshots), `-onboardingFresh`,
   `-onboardingTrial`. A Release build has none of them.
6. **Brain golden / web suite:** green on the merged tree (see the integration report).

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

### The integration's QA

`scripts/ios-integration-qa.sh [build journey family ink resilience a11y design]` runs the integration's
UI tests through `sim-run.sh` against the local stack (a dev server on `PORT`, default 3901; it warms
the dev server's routes first, since a cold `next dev` compiles a route slower than the app waits):

- `journey`: `KidJourneyUITests/test1Journey` from a fresh install (it writes the new account's
  email to `JOURNEY_STATE`);
- `family`: the family switch and Today's practice (written once);
- `ink`: sets that grown-up's ink to 0 in the local database, runs out of ink for the kid and the
  grown-up, then puts it back;
- `resilience`: `BoardResilienceUITests` with `scripts/lib/netcut-proxy.mjs` cutting the network on
  cue (the app points at the proxy: 3902 → the API, 54329 → Supabase);
- `a11y`: `BoardAccessibilityUITests` (every control on the board named);
- `design`: `DesignPassUITests` in landscape, portrait, a Split View-sized window (`-windowWidth 507`)
  and the largest text.

Use your own `-derivedDataPath` (`DD=`): two worktrees building into one DerivedData mix products.

The dev server needs `APPLE_ENVIRONMENT=Xcode` (`AgathonTests/ServerFlowTests` posts Xcode-signed
Apple purchases). The UI tests launch with `-noLabs` (Debug's Labs button sat over Ask's Send).

**State (2026-10-19, `e091e085`, after merging `feat/ipad-app` with the LEARNING lane):** on one tree, through
`sim-run.sh`, own DerivedData, local stack only —

- every Swift unit suite in the scheme (11 bundles): 644 tests, 637 passed, 0 failed, 7 skipped by design
  (StoreKitFlowTests is Xcode-only; the billing screenshots, two benches and a snapshot look are opt-in);
- `KidJourneyUITests`: the whole journey (fresh install → the try ticked → the gate → the account and
  PIN → the first board with the try's tick carried, once → a tick, a ring, Help me's hint → Ask writes
  two problems → Home's thumbnail → Progress shows the work), the family switch, Today's practice
  (written once, its count on the board), out of ink for the kid (kid words, no price) and the
  grown-up (the plan behind the gate) — all pass;
- `BoardResilienceUITests` (network lost and found, killed before the save, background, turning while
  Ask streams), `BoardAccessibilityUITests` (every control named; `ipad-integrate-voiceover-labels.txt`),
  `BoardPopoverUITests`, `DesignPassUITests` in landscape, portrait, a Split View-sized window and the
  largest text, and the learning lane's `LearningProgressUITests` — all pass.

Shots: `docs/qa-screenshots/ipad-integrate-*.png`. The design pass found and fixed, over three rounds:
a tap closing a popover wrote a dot on the board (iPadOS passes it through); the help chooser opened
off screen; Ask with the keyboard up squeezed the board to nothing (portrait, Split View); the largest
text pushed the hint card and dock off screen, drew the grown-ups' settings rows over one another and
hid Ask's Send; the Split View dock overflowed and the grown-ups' button had no room; the pages sheet's
New page tile was cut off (and duplicated the button); every board was "Untitled Whiteboard" (now the
day's name, numbered); Progress read "0 minutes" after real work; VoiceOver read each settings row
twice; the account area cut its tab names at the largest text (and had no Sign out in a narrow
window). Left, cosmetic: a 16:9 page in portrait leaves wide empty bands; at the largest text the
docked Ask panel shows one chip before it scrolls; "Come back tomorrow for five more" names the
default goal (5); Debug's autowrite pill shows in Debug shots.

**The column rules, web vs iPad (2026-10-19, after the owner's rings).** The engine (`judgeLine`,
`primaryWork`, operation lines, chains, `=`-first lines) is shared through the brain; these are the
loop's own rules (web `liveLoop.ts`, iPad `AgathonLive/Loop`):

| Web rule | iPad |
|---|---|
| A kid's line belongs to the chat problem whose cell its middle is in (`cells.ts` `cellOf`) | Ported 2026-10-19 (was: the problem whose ink box ±40 px it overlapped — the owner's rings) |
| What `judgeLine` gets: problem, lines above, last right line, slip | Ported; `slipAbove` skipping non-steps ported 2026-10-19 |
| A young hand's read (`youngRead`: wobbly `=`, the ink's signs, her own tick) | Ported 2026-10-19 (brain `youngRead`) |
| The problem's end written again, then the answer (`answerBeside`) | Ported 2026-10-19 (`judgeLine` `beside`) |
| `=`-first lines, chains read link by link, operation lines | Engine, shared |
| Typeset problems (the hand off) head their columns | iPad fix 2026-10-19 |
| One line spanning two cells cut apart (`splitAtCells`, `splitBesideProblem`) | Missing (brain `clusterStrokes` takes no cells) |
| Column gaps kept together under a cell (`columnOptions` filled/together) | Partial: a gap can split a cell's work in two columns, both under the same problem |
| Stray ink (`withoutStrays`: signs-only lines, her tick, pen taps) | Missing |
| A bar with a number under it is `\div n` (`barDivisionLatex`) | Missing |
| Stacked sums, givens (`3x + 24 =` over `x = 3`) | Missing (known gaps) |
| Re-read both lines before a ring (`holdRing`), re-ring unchanged ink | Missing |
| iPad-only: `+3 = 767` under `… = 764` is `764 + 3 = 767` (`ContinuationLine`, the owner asked) | The web rings it: port to `primaryWork` |
| iPad-only: never ring a true line of plain numbers (`ArithmeticTruth`) | The web never rings a true relation either |

**A running total** (the owner's iPad, 2026-10-19): `+3 = 767` under `400 + 364 = 764` was ringed
(read alone it is `3 = 767`). `AgathonLive/Loop/ContinuationLine.swift` judges `op number = number`
under a line of arithmetic ending in a number as `764 + 3 = 767` through the column's judge; with
nothing above to go on from it stays quiet (`ChatProblemTests`).

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
  - not yet ported: graphs/figures/proofs from ink, stacked sums, "givens" (`learning_attempts`
    recording landed with the LEARNING lane; the board's Today's practice and topics use it)
  - slow writers' lines are read about 3 times
- **Ask:** "Practice my weak spots", the learner record, the topic kickoff, the account's "What Ask
  remembers" view, and real ElevenLabs voice (the QA user had no plan, so only the fallbacks ran).
- **Board:**
  - erase speed on a device is unmeasured
  - the highlighter has no dock button
  - no rotate handle
  - the Pages sheet's only UI test is the design pass's shot
- **Saving:** real Storage picture uploads are unverified locally (42P10), and so is the live admin
  viewer.
- **Billing:** the admin funnel counts sandbox rows, and Apple has no equivalent of the Stripe referral
  month.
- **Integration (2026-10-19):**
  - Offline was tested by cutting connections through a proxy (the simulator's network path stays
    "online"); real airplane mode (NWPathMonitor → "Offline · kept on this iPad") needs the iPad.
  - The Split View shots come from `-windowWidth 507` (the app laid out at that width in a full
    window): a popover can reach past that width there; in a real Split View iPadOS keeps it inside.
  - Needs the owner's iPad and Pencil: Pencil latency and hover, App Attest on a device, the real
    keyboard over Ask (the simulator's is software), ElevenLabs voice, real airplane mode.
- **Onboarding:**
  - no avatar art yet
  - App Attest on a real device: the entitlement is in; confirm on the owner's iPad (Debug = Apple's
    development environment)
  - the try page is small in portrait

## Branches

| Branch | State |
|---|---|
| `feat/ipad-app` | Everything merged here |
| `feat/ipad-reader` | Parked |
| `feat/ipad-kit`, `-brain`, `-board`, `-design`, `-tools`, `-sync`, `-live`, `-billing`, `-screens`, `-ask`, `-fast`, `-onboarding` | Merged lane branches (all merged into `feat/ipad-app`) |
