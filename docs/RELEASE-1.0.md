# Agathon 1.0 on the App Store: the release checklist

2026-11-19, branch `release/v1.0` (off `main` 875c5bd9). Owner decision 2026-11-19: **1.0 ships the
ink tutor; the picture tutor stays admin-only.** Feature freeze. This file is the live checklist for
the one submission; `docs/APP-STORE-LAUNCH.md` (2026-10-21) keeps the reasoning behind each answer
(privacy labels, age rating, Kids Category, rejection risks) and is still right except where this
file says otherwise.

App Store Connect: app **6761506513**, bundle `app.agathon.ios`, SKU `agathon`, team SG4YJW2K5Z.
Last TestFlight build 1.0 (1563) · ab012848. State read and (with the owner's go, 2026-11-19) written through the ASC API.

Legend: **DONE** · **AGENT** (the release lane can do it; ASC writes and prod accounts only after the
owner says yes) · **OWNER** (only the account holder can, click path given).

---

## 1. App Store Connect now (written through the API on 2026-11-19 with the owner's go; read back)

| Item | State |
|---|---|
| Version record | iOS **1.0**, `PREPARE_FOR_SUBMISSION`, release type **Manual** (DONE). **Not submitted.** |
| Build on the version | none yet: the 1.0 build from this branch after the lanes merge and QA |
| App name / subtitle | **Agathon: Math Tutor K-8** / **Write it by hand. It checks.** (DONE) |
| Description, keywords, promotional text | DONE (§6, the exact text) |
| Support / Marketing URL | `https://www.agathon.app/terms#contact` / `https://www.agathon.app` (DONE) |
| Privacy Policy URL | `https://www.agathon.app/privacy` (DONE; live, covers the iPad app) |
| Copyright | `2026 Ninth Street Labs` (DONE) |
| Content rights | "Does not use third-party content" (DONE) |
| Category | Education, no secondary (DONE) |
| Age rating | **4+**, questionnaire filled (DONE). Three newest questions read null; if ASC flags the questionnaire as incomplete, answer No/None |
| Kids Category | off (`isOrEverWasMadeForKids: false`) (DONE) |
| Price | Free (DONE) |
| Availability | **United States only** (DONE: 174 other territories off). **OWNER:** untick "make available in new countries or regions automatically" (the API refuses that switch: §5 step 3) |
| Mac (Apple silicon) / Vision Pro, App Store | not in the API: **OWNER** §5 step 3 (Mac on, Vision Pro off) |
| Screenshots | iPad 13-inch set: §4 |
| App Review information | **blocked on the contact phone** (ASC requires it): §3. Everything else is ready |
| Unlimited subscription | **created** (§2); attach to 1.0 at submission (§5 step 5) |
| App Store Server Notifications | Production + Sandbox `https://www.agathon.app/api/billing/apple/notifications`, Version 2 (DONE) |
| Billing grace period | off (DONE) |
| EULA | Apple's standard; the description links the Terms |
| Export compliance | every build `usesNonExemptEncryption: false`: no questions at submit |
| App Privacy (nutrition labels) | not in the API: **OWNER** §5 step 2 |
| Agreements, tax, banking | not in the API; the subscription's proceeds read $21.24 of $24.99 (15%: the Small Business Program rate), so the paid agreement looks active. **OWNER** confirms |

---

## 2. The subscription (created 2026-11-19)

| Field | Value |
|---|---|
| Subscription group | `Agathon Unlimited` (id 22597244), en-US display name `Agathon Unlimited` |
| Subscription | `Agathon Unlimited (monthly)`, id **6836946535**, product id **`app.agathon.unlimited.monthly`** (= `StorePlan.productID` in `ios/Packages/AgathonStore/Sources/AgathonStore/StorePlan.swift`) |
| Duration / level | 1 month / level 1 |
| Price | **$24.99**, United States (proceeds $21.24) |
| Availability | United States only, new territories off |
| Family Sharing | off |
| Localization (en-US) | `Agathon Unlimited` — "Help on every problem, for the whole family." |
| Introductory offer | Free trial, 1 week, United States, new subscribers |
| Review screenshot | `docs/app-store/iap-review-screenshot.png` (the plan screen: price, 7 days free, Start your free week, Restore purchases, Terms of Use, Privacy Policy, the auto-renewal words; the plan screen's code hasn't changed since it was made on 10-22) — uploaded, processed |
| Review notes | "Reached from the grown-up's side: Home › Grown-ups › Account › Plan, behind a parental gate (type the digits of the number shown in words). The demo account and its PIN are in the app's review notes. Kids never see prices." |
| State | `MISSING_METADATA` right after creation, with every field above filled and read back; ASC often takes a while to move it to **Ready to Submit**. If it still says Missing Metadata in the web page, open the subscription there: it names the missing field |

A first subscription is submitted **with** the app: on the 1.0 page, "In-App Purchases and
Subscriptions" › + › tick Agathon Unlimited (monthly) (§5 step 5). The API has no way to attach it
without submitting, so that tick is the owner's, at submission.

---

## 3. App Review information and the demo account

**Demo account, made 2026-11-19 in production** by the app's own first run on the simulator
(`ProdOnboardingUITests` with `AGATHON_APP_REVIEW=1`, kept): **`appreview@agathon.app`**, user
`8b348601-bf73-443d-bf22-1638eab49b48`, `terms_version` 2026-10-11 (the app's current), kid profile
**Maya, 3rd grade**, PIN **2468**, picture tomato, the first board with her try (6 × 7 = 42 ticked),
**no plan** ("Not now"), **not an admin**. Ink: `grant_ink(…, 2000, 'App Review 1.0')` → balance
2,100. Password: macOS Keychain, service **"Agathon App Review"** (account `appreview@agathon.app`);
never in git. Keep the account after approval (updates are reviewed with it). Note
`appreview@agathon.app` is not a real inbox unless the owner sets up forwarding; sign-in doesn't need it.

**App Review information** (ready; ASC refused to save it without a contact phone):

| Field | Value |
|---|---|
| Sign-in required | Yes |
| User name | `appreview@agathon.app` |
| Password | from the Keychain item above |
| Contact | Rushil Chopra, `rushil@youthforyoga.org`, **phone: OWNER** (`+1 …`) |
| Notes | below |

With the phone, the release lane saves all of it in one call
(`PHONE=+1… node asc-review.mjs`: reads the password from the Keychain, never prints it); or the owner
pastes it on the 1.0 page › App Review Information.

> Agathon is a math tutor for families, kindergarten to 8th grade. A child writes math by hand with Apple Pencil or a finger (a mouse on a Mac), and the tutor reads each line and marks it: a check mark for a right step, a gentle circle around a slip, and a hint instead of the answer.
>
> SIGN IN: on the first screen ("Who's holding the iPad?") tap "I have an account. Sign in" and use the demo account above. It is a grown-up with one kid profile, Maya (3rd grade), and a board.
>
> GROWN-UP PIN: 2468 (to go from Maya's profile back to the grown-up's side).
>
> PARENTAL GATE: the plan, purchases and grown-up settings are behind a gate that shows a three-digit number in words (for example "six hundred twenty-eight"); type its digits (628) on the number pad.
>
> TO SEE THE TUTOR: choose Maya, then tap Start on Today's practice: problems appear one per page, written by the tutor. Write a step under a problem; when the line looks finished the tutor checks it or circles it. Tap Help me for a hint; on the hint card, Show me has the tutor write the next step on the page in its own blue pen. Tap Ask (top right of the board) and type or hold the mic to ask, for example "Why is 3/4 bigger than 5/8? Can you show me?"; the tutor answers and draws fraction bars on the board. Home > Progress shows the work. SAT practice (on Home) works too, also without an account.
>
> SUBSCRIPTION: Agathon Unlimited (app.agathon.unlimited.monthly), monthly, $24.99, with a 1-week free trial, sold with StoreKit. From the grown-up's side: Home > Grown-ups > Account > Plan (or the ink meter on Home), pass the gate, then Start your free week. Restore purchases is on the same screen. Sandbox purchases are accepted by our production server. Kids never see prices. The demo account has no plan, so the purchase can be tried.
>
> ACCOUNT DELETION: Home > Grown-ups > Account > Delete my account removes the grown-up, every kid profile and every board.
>
> AI AND PRIVACY: to read handwriting and answer, what the child writes, says and asks is processed by AI service providers (handwriting recognition, language models, speech). The sign-up screen says so and asks for agreement first, and SAT practice says so on its first screen. The child's name and email are never sent to them. No ads, no tracking, no third-party analytics SDKs. The tutor's logic runs in JavaScript bundled inside the app (JavaScriptCore); no code is downloaded.
>
> The app needs a network connection. A new account can also be made from the first run on a fresh iPad (it begins with a short math problem the tutor checks).

---

## 4. Screenshots

SCREENSHOTS_PLACEHOLDER

---

## 5. The owner's click paths (only the account holder can)

| # | Where | What |
|---|---|---|
| 1 | appstoreconnect.apple.com › **Business** | Paid Apps Agreement **Active**, bank and tax forms complete. |
| 2 | Apps › Agathon › **App Privacy** | Check each data type against APP-STORE-LAUNCH §6 (it matches `PrivacyInfo.xcprivacy`); **Publish**. |
| 3 | Apps › Agathon › **Pricing and Availability** | Availability already reads United States only: **untick "Make available in new countries or regions automatically"**. Under **"iPhone and iPad Apps on Apple Silicon Macs"**: Make this app available (ticked). **Apple Vision Pro**: untick. Save. |
| 4 | Send the release lane the **contact phone** (or paste it: 1.0 page › App Review Information › Contact Information) | ASC won't save the review information without it. |
| 5 | When the build is approved by you: 1.0 page › **Build** › pick it; **In-App Purchases and Subscriptions** › + › tick Agathon Unlimited (monthly); **Add for Review** › Submit | Only on the owner's OK. "Advertising Identifier?" No. Release stays Manual. |
| 6 | (Recommended) Users and Access › **Sandbox** › Test Accounts › + | One sandbox Apple Account to buy the free week yourself on the TestFlight build first. |

---

## 6. Listing copy (FINAL: in App Store Connect as of 2026-11-19, not submitted)

**Name** (23/30): `Agathon: Math Tutor K-8`

**Subtitle** (28/30): `Write it by hand. It checks.`

**Promotional text** (157/170):
> Write math with Apple Pencil and the tutor checks every line: a check mark for a right step, a gentle circle around a slip, and a hint instead of the answer.

**Keywords** (100/100):
```
homework,apple pencil,fractions,algebra,multiplication,whiteboard,practice,school,grade,sat,geometry
```

**Description** (2610/4,000):

> Math practice kids actually do.
>
> Agathon is a math whiteboard with a tutor that reads handwriting. Your kid works problems by hand, with Apple Pencil, a finger or a mouse, and the tutor checks the work when they're done: a check mark for each right step, a gentle circle around a slip, and a nudge to look again. Never a red X.
>
> ONE PROBLEM, ONE PAGE
> • Pick their grade, kindergarten to 8th grade, or a high school course. Agathon lays out that grade's skills as a path.
> • Today's practice: five problems from their path, one per page, written by the tutor in its own handwriting, with room to work underneath.
> • Their own homework works too: write a problem at the top of a page and work it out below.
> • Stars as they go, and a streak for every day they keep it up.
>
> STUCK? ONE STEP AT A TIME.
> Tap Help me and choose how much: a hint that points at where to look, the next step, or the rest of the problem worked out. Tap Show me on a hint and the tutor writes the next step on the page in its own blue pen, right under theirs, then hands the pencil back.
>
> JUST ASK.
> Type a question, or hold the mic and say it. The tutor answers at their grade level, can read the answer out loud, and draws it on the board: fraction bars, number lines, area models, arrays, ten frames, base-ten blocks and clocks.
>
> SAT PRACTICE
> Real SAT-style math questions, one per page, with the same tutor beside your work.
>
> FOR GROWN-UPS
> • A profile for each kid, each with their own grade, picture and boards. Getting back to your side takes your PIN.
> • Progress shows their week: minutes, problems worked, and how many they solved on their own, with stars for each skill.
> • A weekly email report for each kid: what they practiced, what they mastered, and what to work on next.
> • Kids never see prices. The plan and your settings are behind a grown-ups-only check.
>
> YOUR FAMILY'S DATA
> We never sell it, show ads, or track you. To read handwriting and answer questions, what your kid writes and asks is sent to AI services that don't train on it; we never send their name or email. Delete your account, and everything in it, from the app at any time.
>
> AGATHON UNLIMITED
> Agathon Unlimited switches the tutor on for the whole family. New subscribers get the first week free, then $24.99 a month in the US, charged to your Apple Account. It renews automatically unless you cancel at least 24 hours before the end of the current period. Manage or cancel it in Settings › your name › Subscriptions.
>
> The tutor can make mistakes. Check what matters.
>
> Terms of Use: https://www.agathon.app/terms
> Privacy Policy: https://www.agathon.app/privacy

Notes on the copy: no "For Kids"/"For Children" (not in the Kids Category); "AI services that don't
train on it" (not "don't keep it": ElevenLabs keeps voice clips under its default retention, see the
Privacy Policy); the price line matches the subscription (§2); the weekly report claim holds only while
the report emails stay on (§8). Changing any of it later: promotional text any time; the rest with the
next version.

---

## 7. Release audit (Release configuration, this branch)

Method: source review of every launch argument, UserDefaults switch and admin check outside
`#if DEBUG` (a script that tracks `#if DEBUG`/`#else` nesting across `ios/Agathon` and every package's
`Sources`), the admin checks on the server routes, the Release binary's strings, and the live URLs.
The Release archive of 1.0 (1563) (same app code as this branch's base) has none of the Debug
markers (`-macDrive`, `macDriveCleanup`, `Board Lab`, `Brain Lab`, `Live Lab`, `Design Gallery`,
`AGATHON_TEST_EMAIL`, `-boardAutowrite`, `debugScreens`, `KidSessionPlayer`…; strings under 16 bytes
are inline in Swift and can't be checked this way), no `.debug.dylib`, and App Attest `production`.
It does contain `Training Center` and `Picture tutor (test)` (admin pages) and `agathon.app/share`
(Mac screen). Re-check on the final archive.

### Admin, debug and test surfaces

| Surface | Release build | Verdict |
|---|---|---|
| Labs button (Board/Brain/Live/Ask/Billing/Picture/TutorWrites labs, Design Gallery, old debug screens, plain board) | every file in `ios/Agathon/Debug` is `#if DEBUG`; `labsButton()` and `designGalleryOnLaunch()` are no-ops outside Debug | hidden |
| Training Center | Account › Training Center only when `is_admin()` (a grown-up; never a kid profile); the page re-checks | admins only |
| Admin console | Account › Admin console only when `is_admin()`; `/api/admin/*` require an admin server-side | admins only |
| Picture tutor (test) | Account page only for admins; a board uses it only when the switch (or `user_metadata.picture_tutor`) is on **and** `is_admin()`; `/api/board/draw` is `requireAdmin` (404 otherwise) | admin-only, as decided. Note: `user_metadata` is user-writable, but it only *suggests*; the admin check decides |
| Infinite board (`board.infinite`) | read in Release, but the only switch is on the admin Picture tutor page | admins only (it is per-iPad, so it stays on for the next person on that iPad; harmless) |
| `-macDrive`, `-macDriveNewBoard`, `-macDriveCleanup` | `Debug/MacDrive.swift`, `#if DEBUG` | Debug-only |
| `-demoRecording`, `-pictureDemo` | not on this branch (only on `origin/feat/demo-videos`, Debug files) | not shipped |
| `-boardAutowrite`, `-liveMisread`, `-practiceProblems`, `-onboardingFresh`/`-onboardingTrial`, `-boardLab`, `-debugScreens`, `-windowWidth`, `-noLabs`, `-trainingOpen`, SAT `-sat*`, `AGATHON_TEST_EMAIL`, `debug.live`, `pictureTutor.stub`, second-opinion switch | inside `#if DEBUG` | Debug-only |
| `-macScreen.stub`, `-macScreen.open`, `-onboardingMute` | read outside `#if DEBUG` | harmless (launch arguments can't be set on a user's device); could be wrapped for tidiness |
| Apple Intelligence hint words (`agathon.debug.onDeviceHints`) | read in Release; the only switch is the Live Lab (Debug) | off for everyone |
| Endpoints | `AgathonEnvironment.overridesAllowed` false in Release → production only; App Attest never sends the debug header to production | OK |
| **Flag a bug** (bug icon on the board's top bar) | **grown-ups only** since f253b635 (`BoardTopBarItems.showsFlagBug`: hidden on a kid profile and while who is here isn't known); Account › Bug reports stays for everyone | DONE (owner, 11-19) |
| **Mac screen** (laptop button on the board's top bar) | **off in 1.0** since f253b635 (`BoardTopBarItems.macScreenEnabled = false`); the panel code stays for later | DONE (owner, 11-19) |
| "Picture tutor (test)" / "Board (test)" titles | admin pages only | fine |
| Placeholder text, TODOs in shipped strings | none found (no Lorem/TBD/Coming soon in user-facing strings) | OK |

### Links

| Link | Live? |
|---|---|
| `https://www.agathon.app/privacy` (sign-up, first run, plan screen, ASC) | 200, covers the iPad app (Oct 21) |
| `https://www.agathon.app/terms` (+ `#unlimited`, `#app-store`, `#apple`, `#contact`) | 200, anchors present |
| `https://www.agathon.app/refunds` | 200 |
| `https://www.agathon.app/support` | **404**: use `/terms#contact` as the Support URL, or add a `/support` page before the web goes |

### Other checks

- AI permission (5.1.2(i)): the consent line and "including the AI services" box ship on sign-up and
  on the first run's account step; SAT's home (its first screen, account or not) now says "To check
  your work, Agathon sends what you write on the board to our AI tutor. Privacy Policy" with the
  policy linked (f253b635). The first run's pre-account try still sends pen strokes to Mathpix before
  the account step (no name, nothing kept), as in APP-STORE-LAUNCH §9.
- `TERMS_VERSION` is still 2026-10-11 although the Terms changed on Oct 21 (APP-STORE-LAUNCH §7: bump
  recommended, owner's call; app + web + script + test move together).
- Minimum iPadOS 17.0: only iPadOS 26.x and 27 have run it. Test a TestFlight build on 17/18 or raise
  the floor.
- The Terms summary still says "in beta"; some reviewers read that as unfinished (2.2). Owner's call.

---

## 8. What depends on the web (the web platform is being taken down)

The API (`www.agathon.app/api/*`) is the app's server and stays. These **pages** on the same Next.js
app are reached from the app or its emails; each breaks if the web pages go:

| # | Where | Depends on | Recommendation |
|---|---|---|---|
| 1 | **Password reset** (Sign in › Forgot your password?) | Supabase emails a link to `www.agathon.app/reset-password`; the new password is set **on the web page** | **Keep `/reset-password` live** when the web board goes (smallest). Later: an in-app reset (a 6-digit code: Supabase `verifyOTP` type `recovery` + an email-template change) or a universal link into the app |
| 2 | **Privacy Policy, Terms, Refund Policy** | `/privacy`, `/terms`, `/refunds` (app sheets, sign-up, plan screen, ASC, the description) | **Must stay live** (Apple requires them) |
| 3 | **Support URL** | `/terms#contact` today (`/support` is a 404) | Keep, or add a small `/support` page |
| 4 | **Mac screen** panel | `agathon.app/share` (a web page that streams a Mac window) | Hidden in 1.0 (done); `/share` can go with the web |
| 5 | **Stripe subscribers' plan** | Plan screen: "billed through agathon.app… sign in there"; past due: "Fix it at agathon.app"; delete sheet: "Open agathon.app" → `/account` (Stripe portal) | Keep `/account`'s billing part (or a bare portal redirect) until the last Stripe plan ends; reword if it moves. Don't link to Stripe checkout from the app (3.1.1) |
| 6 | **Old web boards** the iPad can't open | "Try again, or open it on agathon.app for now." (`BoardPreviewScreen`) | Reword to "Try again later" / "Tell us in Bug reports" once the web is gone |
| 7 | **Emails** (server) | welcome → `/`; trial reminder / nudges (Stripe) → `/account`; bug reply → `/reports#<id>` ("Read and reply"); weekly report unsubscribe → a signed web link | Point bug replies at the app (Account › Bug reports) and `/` at the App Store page; keep the unsubscribe route; Apple subscribers already get Apple's manage URL |
| 8 | Email confirmation | Off on the cloud project (sign-up returns a session), so no web link | none, while it stays off |
| 9 | Kid accounts | `kids.agathon.app` is only an internal email domain for kid logins | none |

Nothing in the app needs the web **board** itself; the dependencies are the pages above.

---

## 9. Done on this branch

- `WordProblem.plain` keeps a written dollar sign (`\$13.45` was read as `\13.45`, a leftover
  command, and the whole word problem dropped) — the non-Debug fix from `origin/feat/demo-videos`
  535f981b, with `WordProblemTests.aWrittenDollarSignStays`.
- QA scripts uninstalled/read the old bundle id `app.agathon.Agathon` (so "fresh install" runs were
  not fresh, and kid sessions couldn't read the app's container): now `app.agathon.ios` in
  `ios-appstore-shots.sh`, `ios-integration-qa.sh`, `ios-kid-sessions.sh`, `ios-prod-qa.sh`,
  `ios-device-onboarding.sh` (that last one uninstalls the app from the owner's iPad by design; run
  only with the owner's OK).

- 1.0's board and SAT home (f253b635, the owner 2026-11-19): no Mac screen button; Flag a bug only on
  a grown-up's board; SAT's first screen says where the writing goes, Privacy Policy linked.
  `BoardTopBarItemsTests`, `SATViewTests.theFirstScreenSaysWhereTheWritingGoes`.
- `ProdOnboardingUITests` may make exactly one other kept account, App Review's
  (`AGATHON_APP_REVIEW=1`, `PROD_QA_KEEP=1`, the email `appreview@agathon.app`), with the kid's name
  from `PROD_QA_KID`.
- `AppStoreScreenshotUITests`: four practice pages, a Show me shot (`test2cShowMe`).

## 10. Later (when the lead says go)

Merge the INK / PICTURE / SPEED lanes into `release/v1.0`; rebuild `brain.js` if the TS changed; full
QA (unit suites, `scripts/ios-integration-qa.sh`, UI suites, `scripts/ios-kid-sessions.sh` 12
sessions); bump `CURRENT_PROJECT_VERSION=$(git rev-list --count HEAD)`, `AGATHON_COMMIT=<sha>`;
`scripts/ios-release.sh --archive-only`, then `xcodebuild -exportArchive` with `ios/ExportOptions.plist`
(destination upload, `-allowProvisioningUpdates`); attach the build to 1.0. **No submission without
the owner's OK.**
