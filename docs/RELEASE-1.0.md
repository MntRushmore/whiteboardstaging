# Agathon 1.0 on the App Store: the release checklist

2026-11-19, branch `release/v1.0` (off `main` 875c5bd9). Owner decision 2026-11-19: **1.0 ships the
ink tutor; the picture tutor stays admin-only.** Feature freeze. This file is the live checklist for
the one submission; `docs/APP-STORE-LAUNCH.md` (2026-10-21) keeps the reasoning behind each answer
(privacy labels, age rating, Kids Category, rejection risks) and is still right except where this
file says otherwise.

App Store Connect: app **6761506513**, bundle `app.agathon.ios`, SKU `agathon`, team SG4YJW2K5Z.
Last TestFlight build 1.0 (1563) · ab012848. State read through the ASC API on 2026-11-19 (read-only).

Legend: **DONE** · **AGENT** (the release lane can do it; ASC writes and prod accounts only after the
owner says yes) · **OWNER** (only the account holder can, click path given).

---

## 1. What App Store Connect says today (API, 2026-11-19)

| Item | State | Needed |
|---|---|---|
| Version record | iOS **1.0**, `PREPARE_FOR_SUBMISSION`, release type `AFTER_APPROVAL` | Set **Manually release** (AGENT) so the owner picks the day |
| Build on the version | **none** | Pick the 1.0 build from this branch (after QA) |
| App name | **"Agathon - AI Education"** | Owner decides (§6): recommended `Agathon: Math Tutor K-8` |
| Subtitle | empty | §6 |
| Description, keywords, promo text | empty | §6 |
| Support URL / Marketing URL | empty | `https://www.agathon.app/terms#contact` / `https://www.agathon.app` |
| Privacy Policy URL | **empty** (required) | `https://www.agathon.app/privacy` (live, covers the iPad app, last updated Oct 21) |
| Copyright | empty | `2026 Ninth Street Labs` |
| Content rights declaration | **not set** (required) | "Does not use third-party content" |
| Category | Primary **Education**, no secondary | DONE |
| Age rating | Questionnaire filled, **4+** (`FOUR_PLUS`); parental controls yes; no UGC, chat, web, ads | DONE. The three newest questions (`datingAndRelationships`, `sharedLocation`, `socialMediaAgeRestricted`) read null: if ASC flags the questionnaire as incomplete, answer No/None (AGENT) |
| Kids Category | `isOrEverWasMadeForKids: false` | Keep it off (APP-STORE-LAUNCH §8). DONE |
| Price | Free (base USA) | DONE |
| Availability | **all 175 territories**, new territories auto-added | Owner decides: US only (recommended in APP-STORE-LAUNCH §3) or worldwide |
| Mac (Apple silicon) / Vision Pro, App Store | not readable through the API | OWNER checks (§5, step 5): Mac **on** (the owner wants "Designed for iPad"; tested at the 11-13 demo); Vision Pro **off** (never tested) |
| TestFlight groups | Staff + Agathon Build 14, both internal, Mac and Vision on | fine for testing |
| Screenshots | **none** uploaded | iPad 13-inch set (§4) |
| App Review information | **none** (no contact, no demo account, no notes) | §3 |
| **Unlimited subscription** | **does not exist**: no subscription group, no IAP at all | Must be created and attached to 1.0 (§2). Blocks submission. |
| App Store Server Notifications | **not set** (`subscriptionStatusUrl` null, prod and sandbox) | `https://www.agathon.app/api/billing/apple/notifications`, Version 2 (the route is live: GET → 405) |
| Billing grace period | off | DONE (keep off) |
| EULA | Apple's standard | fine; the description links the Terms |
| Export compliance | every build `usesNonExemptEncryption: false` (Info.plist `ITSAppUsesNonExemptEncryption` NO) | DONE: no questions at submit |
| App Privacy (nutrition labels) | **not readable through the API** | OWNER verifies/publishes (§5, step 4) |
| Agreements, tax, banking | not readable; memory: Paid Apps agreement signed 2026-10-27 | OWNER confirms Active |
| Review submissions | none ever | — |

---

## 2. The subscription (blocks submission)

The app and server expect exactly **`app.agathon.unlimited.monthly`** (`StorePlan.productID`).
Nothing exists in ASC, so a purchase today returns no product and the plan screen can't sell.
A first subscription must be submitted **with** the app version.

| Field | Value |
|---|---|
| Subscription group | reference name `Agathon Unlimited`; group localization (en-US) display name `Agathon Unlimited` |
| Subscription reference name | `Agathon Unlimited (monthly)` |
| Product ID | `app.agathon.unlimited.monthly` |
| Duration | 1 month |
| Price | **$24.99** US (owner: or the $25 tier nearest the web's $25); other storefronts: Apple's equalization |
| Family Sharing | **off** |
| Localization (en-US) | display name `Agathon Unlimited`; description `Help on every problem, for the whole family.` |
| Introductory offer | Free trial, **1 week**, all available territories, new subscribers |
| Availability | same territories as the app |
| Review screenshot | the plan screen (`docs/app-store/iap-review-screenshot.png`, re-shot in §4 with the current build) |
| Review notes | "Reached from the grown-up's side: Home › Grown-ups › Account › Plan, behind a parental gate (type the digits of the number shown in words). Demo account and PIN are in the app's review notes." |

**AGENT can do all of it through the API** (subscriptionGroups, subscriptions, localizations, the
price point, the intro offer, availability, the review screenshot upload), once the owner says yes
and confirms the price. **OWNER alternative:** App Store Connect › Apps › Agathon › Monetization ›
Subscriptions › Create (group) › Create (subscription) › fill the table › Save; then on the 1.0
version page, "In-App Purchases and Subscriptions" › + › tick it.

Also (AGENT with a yes, or OWNER: App Information › App Store Server Notifications › Set up URL):
Production and Sandbox URL `https://www.agathon.app/api/billing/apple/notifications`, Version 2,
then "Send test notification" and in the prod SQL editor
`select id, type from billing_events where type = 'apple.TEST' order by id desc limit 1;`.

---

## 3. App Review information and the demo account

- **Sign-in required: yes.** Apple needs a working account with ink and **no** plan (so the
  reviewer can buy in the Sandbox), a kid profile, and a PIN.
- **Proposed demo account (not created; needs the owner's yes, it is a prod account):**
  - email: a forwarding alias the owner can read, e.g. `appreview@agathon.app` (not a personal
    inbox, not the QA bench).
  - made through the real first run on the TestFlight build (grown-up; kid **Maya**, 3rd grade; her
    try ticked; **Not now** on the plan; PIN **2468**), a couple of ticked lines on her board, then
    `select public.grant_ink((select id from auth.users where email = 'appreview@agathon.app'), 2000, 'App Review demo account');`
  - never an admin (so the reviewer sees no Training Center, Admin console or picture tutor), keep it
    after approval (updates are reviewed with it).
  - AGENT can make it from the simulator against production on a yes (the account, kid, PIN, grant),
    with the password kept in Keychain "Agathon App Review".
- **Contact:** the owner's first and last name, phone and email (OWNER).
- **Notes for the reviewer:** APP-STORE-LAUNCH §9 text, with two edits for 1.0: Help me offers
  **Hint / Next step / Solve it**, and **Show me** on a hint card has the tutor write the next step in
  its own (blue) handwriting under the kid's work; and mention **SAT practice** on Home works without
  an account (5 tutor helps a day). AGENT pastes it with the demo account on a yes.

---

## 4. Screenshots

Required: one **iPad 13-inch** set (2064 × 2752 portrait or 2752 × 2064 landscape; covers every
iPad and the Mac's "Designed for iPad" page; no separate Mac set is needed for an iPad app on Apple
silicon). Up to 10; recommended 6.

The set in `docs/app-store/screenshots/` is from 2026-10-22 (build ~1.0 (1)) and predates Show me,
check when done, the "I read" readback and the newer problem pages. **Re-shoot on this branch** with
`scripts/ios-appstore-shots.sh` (local stack, synthetic family "Maya", no real kids' data), adding a
Show me shot:

| # | Shot | Status |
|---|---|---|
| 1 | Problem page: right steps ticked, Next problem | to re-shoot |
| 2 | A slip gently ringed + the hint card | to re-shoot |
| 3 | Show me: the tutor's blue next step written under the kid's work | **new** (test to add) |
| 4 | Ask: a question, the answer, and the fraction bars it drew | to re-shoot |
| 5 | Today's practice / Home (streak, path) | to re-shoot |
| 6 | Progress (week, skills) | to re-shoot |
| (IAP) | Plan screen for the subscription's review screenshot | to re-shoot |

Rules: flat Blocks look, no gradients, no "AI" labels, no captions baked in unless the owner wants
them; the 9:41 status bar; synthetic handwriting only (the Debug `-demoRecording` idea from
`origin/feat/demo-videos` of hiding Flag a bug and the save chip can be reused **Debug-only**).

---

## 5. The owner's click paths (only the account holder can)

| # | Where | What |
|---|---|---|
| 1 | appstoreconnect.apple.com › **Business** | Paid Apps Agreement **Active**, bank + tax forms complete. Nothing sells otherwise. |
| 2 | developer.apple.com › Account › **App Store Small Business Program** | Enroll (15% instead of 30%), if not yet. Doesn't block. |
| 3 | Decide, then tell the release lane | (a) app name; (b) subtitle/description/keywords (§6); (c) availability US-only or worldwide; (d) subscription price $24.99 vs $25; (e) the demo account email; (f) the open items in §7. |
| 4 | Apps › Agathon › **App Privacy** | Check each data type against APP-STORE-LAUNCH §6 (it matches `PrivacyInfo.xcprivacy`); **Publish**. The privacy policy URL also lives here (App Privacy › Privacy Policy › Edit) if not set by the lane. |
| 5 | Apps › Agathon › **Pricing and Availability** | Availability per 3(c). Scroll to **"iPhone and iPad Apps on Apple Silicon Macs"**: **Make this app available** (ticked) — the owner wants the Mac; **Apple Vision Pro**: untick (untested). Save. |
| 6 | Users and Access › **Sandbox** › Test Accounts › + | One sandbox Apple Account for the owner's own purchase test on the TestFlight build (iPad: Settings › App Store › Sandbox Account). Start the free week; `select provider, status from unlimited_subscriptions order by updated_at desc limit 1;` → `apple`, `trialing`. Delete that test account in the app after. |
| 7 | 1.0 version page › **App Review Information** | Contact phone (the rest the lane can fill). |
| 8 | 1.0 version page › **Add for Review** › **Submit** | Only after the owner OKs the build. "Advertising Identifier?" No. Release: Manually. |

Everything else (listing text, URLs, copyright, content rights, the subscription, notifications URL,
screenshots, review notes, the build pick) the release lane can do through the API on a yes.

---

## 6. Listing copy (DRAFT for the owner to approve)

**Name** (30): current `Agathon - AI Education`. Recommended **`Agathon: Math Tutor K-8`** (23):
says what it is, no "AI" label (the owner's no-AI-chrome rule), and "math tutor" is what parents
search. Alternates: `Agathon – Math Practice` (23), `Agathon: Handwriting Math` (25).

**Subtitle** (30): **`Write it by hand. It checks.`** (28). Alternate: `Math practice kids actually do` (30).

**Promotional text** (170, editable any time):
> Write math with Apple Pencil and the tutor checks every line: a check mark for a right step, a gentle circle around a slip, and a hint instead of the answer.

**Keywords** (100, no spaces, nothing from the name/subtitle):
```
homework,apple pencil,fractions,algebra,multiplication,whiteboard,practice,school,grade,sat,worksheet
```
(98)

**Description** (≤ 4,000):

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
Privacy Policy); the price line must match the subscription's price in §2; the weekly report claim
holds only while the report emails stay on (§8).

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
| **Flag a bug** (bug icon on every board's top bar) | shown to **everyone, kids included**; sends a picture of the board and its context to `bug_reports` | **Owner decision.** Not admin-only. Recommend for 1.0: keep it for grown-ups, hide on a kid profile (Account › Bug reports stays for everyone), or make it admin-only; a bug icon on a kid's page reads as unfinished and sends board pictures without a grown-up |
| **Mac screen** (laptop button on every board's top bar, iPad only) | shown to everyone on an iPad; the panel says "On your Mac, open agathon.app/share…" | **Depends on the web** (see §8). Recommend hiding it for 1.0 (admin-only, one line) |
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
  on the first run's account step. **Gap:** SAT practice works before any account (anonymous session)
  and sends a student's handwriting to the readers and the tutor with no disclosure first; the first
  run's pre-account try sends pen strokes to Mathpix. Recommend one sentence on SAT's first screen
  ("To check your work, Agathon sends what you write to services that read it; see the Privacy
  Policy.") — copy only, owner's call.
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
| 4 | **Mac screen** panel | `agathon.app/share` (a web page that streams a Mac window) | **Hide in 1.0** (admin-only) or keep `/share` up |
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

## 10. Later (when the lead says go)

Merge the INK / PICTURE / SPEED lanes into `release/v1.0`; rebuild `brain.js` if the TS changed; full
QA (unit suites, `scripts/ios-integration-qa.sh`, UI suites, `scripts/ios-kid-sessions.sh` 12
sessions); bump `CURRENT_PROJECT_VERSION=$(git rev-list --count HEAD)`, `AGATHON_COMMIT=<sha>`;
`scripts/ios-release.sh --archive-only`, then `xcodebuild -exportArchive` with `ios/ExportOptions.plist`
(destination upload, `-allowProvisioningUpdates`); attach the build to 1.0. **No submission without
the owner's OK.**
