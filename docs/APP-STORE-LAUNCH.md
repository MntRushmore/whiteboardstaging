# Agathon for iPad: the App Store launch checklist

2026-10-21, branch `feat/ipad-launch` (based on `main` 68b0c57). This is the one list for putting the
iPad app in the App Store for real families. It merges `docs/RUNBOOK-billing.md` §16 (the App Store
Connect checklist for the plan) with the release build, privacy, age rating, listing, screenshots
and review notes. **§12 is the owner's step-by-step for one sitting**; everything before it is the
reasoning and the exact words to paste.

Files that go with it:

| File | What |
|---|---|
| `scripts/ios-release.sh` | bump the build number, archive, export the .ipa, and (with `--upload`) validate and upload it |
| `scripts/ios-bump-build.sh` | the version and build number in `ios/project.yml` |
| `ios/ExportOptions.plist` | how the archive is exported for App Store Connect |
| `ios/Agathon/Resources/PrivacyInfo.xcprivacy` | the privacy manifest (required-reason APIs, collected data) |
| `scripts/ios-appstore-shots.sh`, `ios/AgathonUITests/AppStoreScreenshotUITests.swift`, `scripts/lib/appstore-demo-seed.sql` | the screenshots, made on the local stack |
| `docs/app-store/screenshots/` | the eight iPad screenshots to upload, numbered in order (13-inch, 2752 × 2064) |
| `docs/app-store/iap-review-screenshot.png` | the plan screen, for the subscription's review screenshot |
| `src/app/(platform)/privacy`, `terms`, `refunds` | the Privacy Policy, Terms and Refund Policy, now covering the iPad app (in this branch; live once merged) |

---

## 1. Where it stands

**Ready:** a Release archive that builds and passes the checks below; the privacy manifest; every
App Store Connect answer and every word of the listing (below); the screenshots; the review notes and
the demo account plan; the release script.

**Not done by this lane (not allowed to):** anything in App Store Connect, the Apple Developer
account, Vercel or production. The export of the .ipa stops at signing: Xcode on this Mac has no
Apple account signed in (`No Accounts`), and an App Store export needs one (or an API key). The
archive step is verified; the export runs the first time the owner signs in or sets the API key
(§5).

**Blocks launch until done (in §12's order):**

1. **The Privacy Policy and Terms must be live on production** (Apple requires the policy to describe
   the app's collection, and the Terms link in the app points at `/terms#unlimited`). Done in this
   branch (commit 736451c6); it goes live when `feat/ipad-launch` is merged and deployed (§7).
2. **Explicit permission before sending a kid's work to third-party AI** (App Review Guideline
   5.1.2(i), as updated in November 2025: "clearly disclose where personal data will be shared with
   third parties, including with third-party AI, and obtain explicit permission"). See §9, risk 1.
   This is the most likely rejection.
3. **Production settings for Apple billing:** Vercel `APPLE_ENVIRONMENT=Production` and
   `APPLE_APP_APPLE_ID=<the app's Apple ID>`, then the App Store Server Notifications URL (§12, steps
   4 and 7). Without them a purchase can't be recorded and the reviewer's sandbox purchase fails.
4. **The App Store Connect agreements, the app record, the subscription, the demo account** (§12).
5. **Two decisions that go into the binary, so before the first upload:** the AI line (`docs/app-store/ai-consent-ios.patch`)
   and whether `TERMS_VERSION` moves with the new Terms (§7).

---

## 2. Release build audit

Built with `xcodebuild archive -scheme Agathon -configuration Release -destination
'generic/platform=iOS' -allowProvisioningUpdates` (Xcode 26.6, iPadOS 26.5 SDK), team SG4YJW2K5Z,
automatic signing: **ARCHIVE SUCCEEDED**, 16 MB app.

| Check | Result |
|---|---|
| Labs and debug screens | **Compiled out.** Every file in `ios/Agathon/Debug` is `#if DEBUG`, and so is every launch argument and test hook the app reads (`-boardAutowrite`, `-liveMisread`, `-practiceProblems`, `-onboardingFresh`/`-onboardingTrial` in `RootView`, `-windowWidth`, `-noLabs`, `-trainingOpen`, `debug.live`, `AGATHON_TEST_EMAIL`), from a source review; the Release binary has none of the longer ones (`AGATHON_TEST_EMAIL`, `-pagesFirstPartOnly`, `-practiceProblems`…; Swift keeps strings under 16 bytes inline, so `strings` can't show the short ones either way). Two reads outside `#if DEBUG` are harmless: `-onboardingMute` (mutes the first run's sounds) and `OnboardingLab` (a view only Labs presents). `ProblemPagesRollout.secondPart` is `true` in Release. |
| Endpoints | **Production only.** `AgathonEnvironment.overridesAllowed` is false in Release, so `AGATHON_API_URL` / `SUPABASE_URL` are never read: `https://www.agathon.app` and `https://sgolkponjdkphndosrea.supabase.co` with the public anon key. App Attest never sends the debug header to production (`allowsDebugHeader: !production`). |
| App Attest | `ios/Support/Agathon.entitlements` = `production` for Release (the archived app's entitlements checked); `development` stays in `Agathon-Debug.entitlements`. The App ID already has the capability (the development profile lists both environments). |
| StoreKit test file | Not bundled (`Agathon.storekit` is excluded from the target; it is only the scheme's). |
| Version / build | `MARKETING_VERSION` 1.0, `CURRENT_PROJECT_VERSION` 1, from `ios/project.yml`. `scripts/ios-bump-build.sh` bumps it (§4). |
| Icon | One 1024 × 1024 PNG, no alpha (the Blocks mark on ink). The archive has the 76/83.5 pt iPad icons and the marketing icon in `Assets.car`. |
| Launch screen | `UILaunchScreen` with the `LaunchBackground` colour. |
| Device family | iPad only (`UIDeviceFamily` [2]), all four orientations, `UIRequiresFullScreen` NO (Split View and Slide Over work). One scene. |
| Minimum iPadOS | 17.0. **Only iPadOS 26.5 (simulator) and the owner's iPad have run it.** Either test a TestFlight build on an iPad with iPadOS 17 or 18, or raise the floor to the oldest version tested before submitting (one line in `project.yml`, `deploymentTarget`). |
| Export compliance | `ITSAppUsesNonExemptEncryption` = NO is **right**: the app's only cryptography is HTTPS through Apple's URLSession, SHA-256 hashes (App Attest client data, picture names) and the crypto supabase-swift links for auth. All exempt (standard encryption in the OS, authentication, hashing). No custom or proprietary encryption. App Store Connect then asks no export questions. |
| Usage strings | **Fixed.** The microphone and speech strings named Lecture mode (not in the iPad app); the "save to Photos" key described a web feature the app does not have (nothing writes to the photo library; pictures come from the Photos picker or Files, which need no permission). Now: Microphone: "Agathon listens only while you hold the mic, so you can ask your question out loud." Speech recognition: "Agathon turns what you say into words while you hold the mic to ask a question." Camera (the board's Take Photo, `CameraPicker`): "Take a photo of a worksheet or a drawing to put it on your board." (kept: without it the camera crashes the app). Photo Library Add: removed. Notifications (the trial reminder) are local and need no key. `scripts/ios-release.sh` now refuses an archive whose binary uses the camera, recorder, speech recognizer, saving to Photos or location without the matching string. |
| ATS | `NSAllowsLocalNetworking` only (for a Debug run against `localhost`). It needs no justification in review and loosens nothing on the internet. |
| Privacy manifest | **Fixed**: it declared no required-reason APIs. Now UserDefaults (`CA92.1`) and system boot time (`35F9.1`, `CACurrentMediaTime` for elapsed time inside the app), from a scan of the app, its packages and supabase-swift, checked against the Release binary's imports (no file-timestamp, disk-space or keyboard APIs; `sysctl` comes from a test-support package and is not on Apple's list). swift-crypto brings its own manifest. Collected data types: §6. |
| Background modes, push | None. The board's save on going to the background is a background task, which needs no mode. |
| Training Center | **Ships in Release, admins only** (Account › Training Center shows only when `is_admin()` says so, never on a kid's profile). App Review's demo account is not an admin and never sees it. Leave it, or wrap `TrainingCenterPage` in `#if DEBUG` if the owner prefers it out of the store build. |
| Mac and Vision Pro | An iPad app is offered on Apple silicon Macs and Vision Pro unless unticked. Neither was tested, Pencil-first ink makes little sense there, and the first run's try needs App Attest (not available to iPad apps on a Mac): **untick both** (§12, step 5). |
| Warnings | 8 compiler warnings, none about signing, entitlements or the plist. |

### What changed in this lane (iOS only)

- `ios/project.yml` / `ios/Support/Info.plist`: the usage strings above (mic and speech reworded, Photo Library Add removed, camera kept).
- `ios/Agathon/Resources/PrivacyInfo.xcprivacy`: required-reason APIs and collected data types.
- `ios/ExportOptions.plist`, `scripts/ios-release.sh`, `scripts/ios-bump-build.sh`: new.
- `ios/AgathonUITests/AppStoreScreenshotUITests.swift`, `scripts/ios-appstore-shots.sh`,
  `scripts/lib/appstore-demo-seed.sql`: the screenshots (skipped unless asked for).

---

## 3. App Store Connect: the app record

| Field | Value |
|---|---|
| Platform | iOS |
| Name | **Agathon: Math Tutor K-8** (23 of 30). App names are unique in the store: if "Agathon" is held by one of the owner's older records, see §11. |
| Primary language | English (U.S.) |
| Bundle ID | `app.agathon.Agathon` (team SG4YJW2K5Z; the server's App Attest and Apple billing both expect it) |
| SKU | `agathon-ipad` |
| User access | Full access |
| Primary category | **Education** |
| Secondary category | none (leave empty) |
| Content rights | "No, it does not contain, show, or access third-party content" (everything on screen is the family's own work or Agathon's tutor) |
| Age rating | 4+ (questionnaire in §8) |
| Price | Free (the plan is an in-app purchase) |
| Availability | **United States only for launch** (recommended: US grades and US English, the US price; the EU/UK children's-data rules are a separate review). Untick "iPhone and iPad apps on Apple silicon Macs" and "Apple Vision Pro". |

---

## 4. Version and build numbers

- `ios/project.yml` is the one source: `MARKETING_VERSION` (what people see, `1.0`) and
  `CURRENT_PROJECT_VERSION` (the build number; App Store Connect refuses one it has seen for that
  version).
- `scripts/ios-bump-build.sh` (build + 1), `scripts/ios-bump-build.sh 7` (a number),
  `scripts/ios-bump-build.sh --version 1.0.1` (a new version, build 1), `--show`. It edits
  `project.yml` and regenerates the Xcode project; commit both after a successful upload.
- `scripts/ios-release.sh` bumps first unless `--no-bump`. The first upload can be `1.0 (1)`:
  `scripts/ios-release.sh --upload --no-bump`.

## 5. Uploading a build

```bash
# once: the upload key (App Store Connect › Users and Access › Integrations › App Store Connect API ›
# Team Keys › +, role Admin, so it can also make the App Store signing profile). Download the .p8 once.
mkdir -p ~/.appstoreconnect/private_keys && mv ~/Downloads/AuthKey_ABC123XYZ9.p8 ~/.appstoreconnect/private_keys/
chmod 600 ~/.appstoreconnect/private_keys/AuthKey_*.p8

export ASC_KEY_ID=ABC123XYZ9                              # the key's id
export ASC_ISSUER_ID=00000000-0000-0000-0000-000000000000  # the issuer id at the top of the Keys page
export ASC_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_ABC123XYZ9.p8

scripts/ios-release.sh                  # dry run: archive + export Agathon.ipa, no upload
scripts/ios-release.sh --upload         # bump, archive, export, validate, upload
```

What it does, and stops on:

1. Bumps the build number (`--no-bump` keeps it, `--build N` sets it), regenerates the project.
2. Archives Release for any iPad (`build/ios-release/<version>-<build>/`, gitignored), then checks the
   archive: bundle id, version and build, iPad only, `ITSAppUsesNonExemptEncryption` NO, the privacy
   manifest inside, no StoreKit test file, App Attest `production`.
3. Exports with `ios/ExportOptions.plist` (`app-store-connect`, automatic signing, symbols uploaded,
   our build numbers), then checks the .ipa: signed by Apple Distribution, no `get-task-allow`, App
   Attest `production`.
4. With `--upload`: `altool --validate-app`, then `altool --upload-package` with the key. The build
   shows in App Store Connect › TestFlight after Apple processes it (5–30 minutes).
   `UPLOAD_WITH=xcodebuild` uploads from the export step instead (destination `upload`).

Signing needs Apple once per Mac: either the key above (Admin) or Xcode › Settings › Accounts signed
in as the account holder. **Dry run on 2026-10-22** (`scripts/ios-release.sh --no-bump`, after the policy
and screenshot commits): the archive and its checks pass (16 MB, iPadOS 17.0); the export stopped at
`No Accounts` / `No profiles for 'app.agathon.Agathon'`. This Mac has the Apple Distribution certificate
for SG4YJW2K5Z but no App Store profile for this bundle id, and `xcodebuild` sees no signed-in account,
so the API key (above) is the fix: with it, the export makes the profile itself.
Never commit the .p8; the script refuses a key inside the repo.

---

## 6. App Privacy (App Store Connect › App Privacy)

From a code audit of the app and of the server it talks to (2026-10-21). The app talks only to
`www.agathon.app` (our server, through Cloudflare to Vercel), the Supabase project, and Apple
(StoreKit, App Attest, the speech recognizer). Its only third-party library is supabase-swift. No
analytics, crash or ad SDK anywhere (app or server), no IDFA, no `identifierForVendor`, no App
Tracking Transparency prompt (none is needed).

**Do you or your third-party partners collect data from this app?** Yes.
**Is any of it used to track?** No, for every type (no data broker, no ads, no linking with other
companies' data). Under Apple's definitions our server-side processors (OpenRouter's model
providers, Mathpix, ElevenLabs, Resend, Vercel, Cloudflare, Supabase) process data on our behalf;
that is collection by us, not tracking.

| Data type | Collected | Linked to the user | Purposes | What and where |
|---|---|---|---|---|
| Contact Info › Name | Yes | Yes | App Functionality | The grown-up's optional display name; each kid profile's first name (`profiles.display_name`, `/api/family/kids`). Never sent to the AI (Ask scrubs it). |
| Contact Info › Email Address | Yes | Yes | App Functionality | Sign-in, password resets, the trial reminder, the trial's tips and the weekly report, bug-report replies (Resend). Kid profiles have no email. |
| Contact Info › Phone, Physical Address, Other | No | | | |
| Health & Fitness, Financial Info, Location, Sensitive Info, Contacts, Browsing History, Search History | No | | | Apple takes payment; IP addresses in logs are never turned into a location. |
| User Content › Photos or Videos | Yes | Yes | App Functionality | Pictures added to a board (Photos picker, camera, Files), kept in `board-assets`. |
| User Content › Audio Data | Yes | **No** | App Functionality | Ask's hold-to-talk clip goes through our server to ElevenLabs speech-to-text with no name or email; we never store it. Declared because ElevenLabs keeps it under its default retention (we don't send zero-retention, an enterprise feature). If that is switched on, this becomes **No** (processed in real time only). The on-device fallback (Apple's recognizer) is Apple's. |
| User Content › Emails or Text Messages, Gameplay Content | No | | | Ask's chat is "Other User Content". |
| User Content › Customer Support | Yes | Yes | App Functionality | Bug reports (message, board, app and iPadOS version, locale) and our replies. |
| User Content › Other User Content | Yes | Yes | App Functionality, Analytics, Product Personalization | Boards (handwriting strokes, drawings, PDFs, the tutor's marks), Ask's chat and its notes about how the kid learns. Handwriting crops and a picture of the screen go to the AI models through OpenRouter (zero-retention providers only) and strokes to Mathpix (not kept); staff may look at boards to fix problems and improve the tutor (logged). |
| Identifiers › User ID | Yes | Yes | App Functionality, Analytics | The Supabase account id on everything the server keeps. |
| Identifiers › Device ID | Yes | Yes | App Functionality, Analytics | The App Attest key id (proves the request comes from the real app; not tied to a person) and the first run's random journey id (step counts, joined to the account at sign-up). Conservative: either could be read as a device-level id. |
| Purchases › Purchase History | Yes | Yes | App Functionality, Analytics | Agathon Unlimited bought through Apple (ids, product, status, dates, price, storefront); revenue in the admin console. |
| Usage Data › Product Interaction | Yes | Yes | App Functionality, Analytics, Product Personalization | Problems worked and how (the learning record), Today's practice, AI actions used (ink and fair use), the first run's steps. |
| Usage Data › Advertising Data, Other Usage Data | No | | | |
| Diagnostics › Crash Data, Performance Data | No | | | No crash reporter; timings are measured on the server. |
| Diagnostics › Other Diagnostic Data | Yes | Yes | App Functionality | Error reports (`/api/client-errors`: the screen, the error, the app and iPadOS version), kept 30 days. |
| Other Data › Other Data Types | Yes | Yes | App Functionality, Analytics, Product Personalization | Grade or course (sets problems and Ask's level, also sent to Ask's model), the chosen picture, how they heard about Agathon. |

The same list is in `ios/Agathon/Resources/PrivacyInfo.xcprivacy` (`NSPrivacyCollectedDataTypes`);
change both together.

Two things to settle (owner), neither blocks the answers above:

- **ElevenLabs and the Privacy Policy's AI sentence.** _Done 2026-10-22: the sentence now names ElevenLabs' own retention (`LEGAL.aiProviderTraining`); use "AI services that don't train on it" in any listing copy unless ElevenLabs zero retention is switched on._ Original note: The policy says "We ask every AI service we use
  not to keep or train on what we send, and we only use providers that agree" (`LEGAL.aiProviderTraining`).
  True for OpenRouter (`zdr: true`, `data_collection: "deny"`) and Mathpix (`improve_mathpix: false`);
  **not** backed for ElevenLabs, where kids' voice clips and the tutor's phrases go with default
  retention. Either turn on ElevenLabs zero retention (`enable_logging=false`, enterprise plans) or
  reword the sentence to name the exception. The listing's description says "AI services that
  don't keep it or train on it": keep it only if one of the two is done; otherwise use "AI services
  that don't train on it".
- **OpenRouter's own prompt logging** must stay off in its account settings (the policy relies on it;
  not checkable from code), and `npm run eval:privacy` should be re-run: Ask's fallback models (Claude
  Haiku 5.5, GPT-5.4 nano) came after the last zero-retention check.

---

## 7. The Privacy Policy and Terms

Apple requires the privacy policy to cover **the app**: what it collects, how, every use, that
third parties protect it as well, retention and deletion, and how to withdraw consent. The Terms
link on the plan screen opens `/terms#unlimited`. Today both pages cover only the website (`agathon.app`)
and Stripe billing.

**Applied in this branch** (2026-10-22, commit 736451c6; 4 files: privacy, terms, refunds, `LegalPage.tsx`).
`legalPages.test.tsx`, `legal.test.ts` and `landing.test.tsx` pass (44 tests), eslint and tsc clean. It is a live
page: it must be on production **before** submitting.

- **Privacy Policy:** covers the iPad app throughout; adds Cloudflare and Apple to the recipients (in-app
  purchase, App Attest, the iPad's speech recognizer); family and kid profiles (name, grade, picture,
  PIN hash, removing a kid); the kid's grade and a picture of the screen going to Ask's model; App
  Attest data; the first run's step counts and "how you heard"; the trial's tips emails (a kid's first
  name) and the weekly report; Apple-plan emails going to the account's address; the iPad mic, camera,
  photos and Apple's speech fallback; the iPad's bug and error report fields; retention for error
  events (30 days), Apple's notices (90 days), step counts and App Attest keys; deleting a grown-up
  deletes the kids; an Apple plan is cancelled in Settings; the providers' equal-protection sentence
  (5.1.1(i); confirm it against the providers' data terms); the pre-account try read by Mathpix.
- **Terms:** cover the iPad app; family profiles (up to `MAX_KIDS`) and the sharing rule fixed for
  them; a new `#app-store` section (the App Store's price, Apple's 7-day trial, the 24-hour renewal
  rule, cancel in Settings, refunds through reportaproblem.apple.com, Apple's retry and price-change
  rules, Ask to Buy, deletion doesn't cancel, Apple's Media Services Terms); a new `#apple` section with
  Apple's minimum terms for an app's own EULA (so the Terms can serve as the custom EULA).
- **Refund Policy:** purchases through Apple are refunded by Apple.
- **Date:** `LEGAL_LAST_UPDATED` becomes October 21, 2026 (all three pages).
- **`TERMS_VERSION` is not changed** (still 2026-10-11). This change is one sign-up should record
  (Apple billing, family rules, new recipients), so bumping it is recommended. If bumped: change it
  together in `src/lib/legal.ts`, `ios/Packages/AgathonKit/Sources/AgathonKit/Auth/TermsVersion.swift`,
  `scripts/lib/supabaseHttp.mjs` and `legalPages.test.tsx`; use the deploy date or earlier (the
  database refuses a version dated after tomorrow, which would stop every sign-up); **decide before
  uploading build 1.0 (1)**, so the iPad sends the same version (older builds sending 2026-10-11 still
  work). There is no re-consent flow: tell existing users by email, as the Changes section promises.
- **Not in this change (owner's call):** the ElevenLabs sentence (§6), and the Terms' "in beta" wording
  (fine for review, but some reviewers read "beta" as unfinished under 2.2; consider dropping it from
  the summary for the App Store launch).

---

## 8. Age rating, category, and the Kids Category

### The age-rating questionnaire (App Store Connect › App Information › Age Rating)

Apple's 2025 questionnaire (ratings 4+, 9+, 13+, 16+, 18+). Answers, truthfully from the app:

| Section | Question | Answer | Why |
|---|---|---|---|
| In-app controls | Parental controls | **Yes** | A grown-up's PIN guards the grown-ups' side; a parental gate (a number in words) guards the plan, purchases and settings; grown-ups set each kid's help level. |
| | Age assurance | **No** | The app does not verify ages (sign-up asks the grown-up to confirm they are 13+ or a parent; that is not age assurance). |
| Capabilities | Unrestricted web access | **No** | No browser. The only web pages are Agathon's own Terms and Privacy Policy, in a Safari sheet. |
| | User-generated content | **No** | A kid's boards, pictures and questions are private to the family; nothing is published or shown to other users. |
| | Messaging and chat | **No** | Kids cannot talk to other people. Ask is a conversation with Agathon's own tutor about their work (say so in the review notes). |
| | Advertising | **No** | No ads of any kind. |
| Mature themes | Profanity or crude humor; horror or fear; alcohol, tobacco or drugs | **None** | |
| Medical or wellness | Medical or treatment information; health or wellness topics | **None** | |
| Sexuality or nudity | all | **None** | |
| Violence | cartoon or fantasy; realistic; prolonged or graphic; guns or weapons | **None** | |
| Chance-based activities | simulated gambling; gambling; contests; loot boxes | **None** / **No** | The stickers and stars are earned, never bought or random. |

Expected rating: **4+**. Leave "Made for Kids" (the Kids Category) **off**. Do not raise the rating
by hand.

### Category

**Education** (primary), no secondary. It is where parents look for a math tutor, it has no
category-specific rules beyond the general ones, and Agathon's grade range (K–8 and high school
courses) does not fit one Kids age band.

### Not the Kids Category (recommended), and why

- **Third-party AI.** To read handwriting and answer questions, a kid's board pictures, strokes,
  questions and voice clips go to Mathpix, OpenRouter's model providers and ElevenLabs (§6). The
  Kids Category (Guideline 1.3 and 5.1.4) does not allow sending personally identifiable information
  or device information to third parties, and Apple reads kids' content strictly. Our processors are
  bound not to keep or train on it, but that is not the bar there.
- **No way back.** Once an app is approved in the Kids Category, every later update must keep meeting
  its rules even if the category is deselected.
- **Age bands.** The category asks for one band (5 and under, 6–8, 9–11); Agathon is 5 to 14 and up.
- **COPPA was deferred** by the owner (2026-10-03). The Kids Category assumes it is done.
- **What we keep anyway:** the parental gate on every path to money and to the grown-ups' settings,
  the PIN, no prices shown to kids, no ads, no tracking, no analytics SDKs, deletion in the app.
- **Metadata rule that follows:** outside the Kids Category, the listing must not say "For Kids" or
  "For Children". The name and words below avoid both.

### If the owner wants the Kids Category later

1. Pick one age band and narrow the app (or its default content) to it.
2. Stop sending personal data to third parties, or get Apple comfortable that none of it is
   personal: an on-device handwriting reader (`feat/ipad-reader`, parked: 62–71% of lines vs
   Mathpix's 97%), no names or emails in any AI request (already true), voice on the device only,
   and a written basis for each processor.
3. A parental gate in front of **every** link out of the app (today the Terms and Privacy links in the
   first run and on sign-in open without one) and in front of Settings links.
4. COPPA done: verifiable parental consent before any kid data is collected (today the try board
   reads a kid's writing before the grown-up's account and consent; §9, risk 1), the direct notice,
   a phone number in the notice, and the review of retention.
5. No third-party analytics or ads in the app (already true), and keep it true in every update.
6. A kids-specific privacy policy section and Apple's extra review time.

---

## 9. App Review: notes, the demo account, and the risks

### Notes for the reviewer (App Review Information › Notes)

> Agathon is a math tutor for families, kindergarten to 8th grade. A child writes math by hand with
> Apple Pencil or a finger, and the tutor reads each line and marks it: a check mark for a right step,
> a circle around a slip, and a hint instead of the answer. Ask answers questions about the board,
> typed or spoken, and can draw a picture on it.
>
> SIGN IN: on the first screen ("Who's holding the iPad?") tap "I have an account. Sign in" and use the
> demo account below. It is a grown-up with one kid profile, Maya (3rd grade), and a board.
>
> GROWN-UP PIN: 2468 (going from Maya's profile back to the grown-up's side).
>
> PARENTAL GATE: the plan, purchases and grown-up settings are behind a gate that shows a three-digit
> number in words (for example "six hundred twenty-eight"); type its digits (628) on the number pad.
>
> TO SEE THE TUTOR: tap the profile button at the top of Home and choose Maya. Tap Start on Today's
> practice: five problems appear, one per page. Write the answer under a problem; within a few seconds
> the tutor checks it or circles it. Tap Help me for a hint, the next step, or the solution. Tap Ask
> (top right of the board) and type or hold the mic to ask, for example "Why is 3/4 bigger than 5/8?
> Can you show me?"; the tutor answers and draws fraction bars on the board. Home › Progress shows the
> work.
>
> SUBSCRIPTION: Agathon Unlimited (app.agathon.unlimited.monthly), monthly, with a 1-week free
> introductory offer, sold with StoreKit. From the grown-up's side: Home › Grown-ups › Account › Plan
> (or the ink meter on Home), pass the gate, then Start your free week. Restore purchases is on the same
> screen. Sandbox purchases are accepted by our production server. Kids never see prices.
>
> ACCOUNT DELETION: Home › Grown-ups › Account › Delete my account removes the grown-up, every kid
> profile and every board.
>
> AI AND PRIVACY: to read handwriting and answer, what the child writes and asks is processed by AI
> service providers (handwriting recognition, language models, speech); the child's name and email are
> never sent to them; see the privacy policy. No ads, no tracking, no third-party analytics SDKs. The tutor's
> logic runs in JavaScript bundled inside the app (JavaScriptCore); no code is downloaded.
>
> The app needs a network connection. A new account can also be made from the first run on a fresh
> iPad (it begins with a short math problem the tutor checks).

### The demo account (the owner makes it in production, ~10 minutes)

1. An inbox the owner can read, e.g. `review@agathon.app` (a forwarding alias). Not a personal address.
2. On the owner's iPad with the **TestFlight** build: sign out (or delete and reinstall), go through
   the first run as a grown-up: kid **Maya**, **3rd grade**, **Times tables**; let her try be ticked;
   on the plan, tap **Not now** (the reviewer must be able to buy the plan in the Sandbox, so the
   account must not have one); make the account with the inbox above and a strong password; PIN
   **2468**; pick a picture.
3. On Maya's first board, write two or three lines so the board has ticks; open Today's practice once.
4. In the production SQL editor (owner), give the grown-up enough ink for a long review without the
   plan: `select public.grant_ink((select id from auth.users where email = 'review@agathon.app'), 2000, 'App Review demo account');`
5. Sign out on the iPad. Put the email, password and PIN in App Review Information (Sign-in required:
   yes) and the notes above.
6. After approval keep the account (updates are reviewed with it). Never give it the admin role.

### Contact information

First name, last name, phone and email of the person App Review should call (the owner).

### Common rejection risks, answered

| Risk | Answer |
|---|---|
| **1. 5.1.2(i) data shared with third-party AI** | **Open: the most likely rejection.** Since November 2025 Apple requires the app to *clearly disclose where personal data will be shared with third parties, including third-party AI, and obtain explicit permission before doing so.* Today the sign-up box says only "I agree to the Terms and Privacy Policy"; the AI services are named only inside the Privacy Policy. (Before the account, the first run's try sends only the pen strokes of a math answer to Mathpix: no name, no account, nothing kept.) **Ready to apply:** `docs/app-store/ai-consent-ios.patch` (iOS only, 3 files: `git apply docs/app-store/ai-consent-ios.patch`) puts one plain line above the box on the first run's account step and on sign-up — *"To check work and answer questions, Agathon sends what your kid writes, says and asks to AI services that read it and answer (our Privacy Policy lists them). Never their name or email."* — and the box now reads *"I agree to the Terms and Privacy Policy, including the AI services."* The owner approves the words; then it ships in build 1.0 (1). Say so in the review notes (§9). |
| 4.2 Minimum functionality | A native SwiftUI app with its own Pencil whiteboard engine, not a web wrapper. |
| 3.1.1 In-app purchase | The plan is sold only through StoreKit in the app. The app never links to the web's Stripe checkout; a Stripe subscriber's plan card says it is billed through agathon.app and offers no purchase (allowed: it is a plan bought elsewhere, and nothing in the app pushes to buy it there). |
| 3.1.2 Subscriptions | The plan screen shows the name, price, period, the free week, the auto-renewal disclosure, Restore purchases, and links to the Terms of Use and Privacy Policy; the description has both links too (§10). The Terms' `#unlimited` section must describe Apple billing (§7). |
| 5.1.1(v) Account deletion | In the app: Account › Delete my account (an Apple plan never blocks it; the sheet tells the grown-up to cancel the plan in Settings). |
| 5.1.1(i) Privacy policy | Linked in App Store Connect, in the first run, on sign-up and on the plan screen. Must cover the app (§7). |
| 1.3 Kids | Not in the Kids Category (§8); the grown-ups' areas, purchases and settings are behind the PIN and the parental gate; kids never see prices; no ads or tracking; no "For Kids" in the metadata. |
| 4.8 Sign in with Apple | Not required: the app has only its own email-and-password accounts, no third-party or social sign-in. |
| 2.5.2 Code | `brain.js` is bundled in the app and run in JavaScriptCore; nothing is downloaded and executed. |
| 2.1 Completeness | The reviewer's device attests with App Attest in the production environment (new accounts' try board needs it); the demo account has ink; the Apple billing env and notification URL are set before submitting (§12). |
| 2.3 Accurate metadata | Screenshots are the app itself on the 13-inch simulator, with a demo family's real work. |
| 5.1.1(ii) Permissions | Mic and speech recognition are asked only when someone holds the mic, the camera only on Take Photo; the strings say why. |

---

## 10. The listing (App Store Connect › the version page)

**Name** (30): `Agathon: Math Tutor K-8` (23)
Alternates: `Agathon – Math Practice` (23), `Agathon: Handwriting Math` (25).

**Subtitle** (30): `Write it by hand. It checks.` (28)
Alternate: `Math practice kids actually do` (30, the landing page's headline).

**Promotional text** (170; changes without review):

> Write math with Apple Pencil and the tutor checks every line: a check mark for a right step, a circle around a slip, and a hint instead of the answer.

**Keywords** (100; no spaces after commas; words already in the name or subtitle are not repeated):

```
homework,handwriting,apple pencil,fractions,algebra,multiplication,whiteboard,practice,school,grade
```
(99)

**Description** (4,000):

> Math practice kids actually do.
>
> Agathon is a math whiteboard with a tutor that reads handwriting. Your kid works problems by hand, with Apple Pencil or a finger, and the tutor checks every line as it's written: a check mark for a right step, a circle around a slip, and a nudge to try again. Never a red X.
>
> LIKE PAPER. BUT IT WRITES BACK.
> • Pick their grade, kindergarten to 8th grade, or a high school course. Agathon lays out that grade's skills as a path.
> • Today's practice: five problems from their path, one per page, written by the tutor in its own handwriting. Stars as they go, and a streak for every day they keep it up.
> • Their own problems work too: write one at the top of a page, then work it underneath.
>
> STUCK? ONE STEP AT A TIME.
> Tap Help me and choose how much: a hint, the next step written beside theirs, or the rest of the problem worked out. The full solution only appears if they choose it.
>
> JUST ASK.
> Type a question, or hold the mic and say it. The tutor answers at their grade level and can read the answer out loud. It draws it out too: fraction bars, number lines, area models, arrays, ten frames, base-ten blocks and clocks, right beside the problem.
>
> FOR GROWN-UPS
> • A profile for each kid, up to six, each with their own grade, picture and boards. Getting back to your side takes your PIN.
> • Progress shows their week: minutes, problems worked on, and how many they solved on their own. Stars show how strong each skill is.
> • A weekly report for each kid: what they practiced, what they mastered, and what to work on next.
> • Kids never see prices. The plan and your settings are behind a grown-ups-only check.
>
> YOUR FAMILY'S DATA
> We never sell it, show ads, or track you. To read handwriting and answer questions, what your kid writes and asks is sent to AI services that read it and answer; we never send their name or email. Delete your account, and everything in it, from the app at any time.
>
> AGATHON UNLIMITED
> Agathon Unlimited switches the tutor on for the whole family. New subscribers get the first week free, then $24.99 a month in the US, charged to your Apple Account. It renews automatically unless you cancel at least 24 hours before the end of the current period. Manage or cancel it in Settings › your name › Subscriptions.
>
> The tutor is AI and can make mistakes. Check what matters.
>
> Terms of Use: https://www.agathon.app/terms
> Privacy Policy: https://www.agathon.app/privacy

**What's New** (1.0): leave empty (not shown for a first version).

| Field | Value |
|---|---|
| Support URL | `https://www.agathon.app/terms#contact` (operator, postal address and email). A `/support` page would be better later. |
| Marketing URL | `https://www.agathon.app` |
| Privacy Policy URL | `https://www.agathon.app/privacy` (App Information) |
| Terms of Use (EULA) | Linked in the description; or App Information › License Agreement › custom, pasting the Terms. Apple's standard EULA plus our Terms link is enough. |
| Copyright | `2026 Ninth Street Labs` (the operator named in the Terms). The seller shown will be "Rushil Chopra" (individual account) until an organization account. |
| Routing app coverage | none |
| Sign-in required | Yes (§9) |

### The subscription (App Store Connect › Monetization › Subscriptions)

| Field | Value |
|---|---|
| Subscription group | Reference name `Agathon Unlimited`; group display name (localization) `Agathon Unlimited` |
| Reference name | `Agathon Unlimited (monthly)` |
| Product ID | `app.agathon.unlimited.monthly` (the app and server expect exactly this) |
| Duration | 1 month |
| Price | $24.99 (United States); let Apple equalize other storefronts if more are added |
| Family Sharing | **Off** |
| Display name (35) | `Agathon Unlimited` |
| Description (55) | `Help on every problem, for the whole family.` (44) |
| Introductory offer | Free, 1 week, United States (all territories if more are added), new subscribers |
| Review screenshot | `docs/app-store/iap-review-screenshot.png` (the plan screen: price, free week, Restore, Terms, Privacy) |
| Review notes | "The plan screen is reached from the grown-up's side: Home › Grown-ups › Account › Plan, behind a parental gate (type the digits of the number shown in words). Demo account and PIN in the app's review notes." |
| Billing grace period | **Off** (the server treats grace as a failed payment) |
| Server notifications (App Information) | Production and Sandbox URL `https://www.agathon.app/api/billing/apple/notifications`, Version 2 |

The subscription is submitted with the first version (it appears on the version page under
"In-App Purchases and Subscriptions": tick it).

---

## 11. Screenshots

App Store Connect needs one iPad set; the 13-inch size (2752 × 2064 landscape or 2064 × 2752
portrait) covers every iPad. Made on "iPad Pro 13-inch (M5)" against the **local stack** by
`scripts/ios-appstore-shots.sh` (a demo family made by the real first run: grown-up, Maya in 7th grade;
four weeks of practice seeded into the local database; status bar 9:41, full battery and Wi-Fi). Each
PNG is upright, 2752 × 2064, sRGB, no alpha; the simulator's iPadOS 26 window-resize grabber (system
chrome in windowed-apps mode) is painted out of the bottom-right corner.

**In `docs/app-store/screenshots/` (all eight from one run on 2026-10-22, demo family `demo-family-be2b5a@example.com` on the local stack; upload in this order):**

| # | File | Shows |
|---|---|---|
| 1 | `01-hint-on-a-slip.png` | A problem page, "Problem 1 of 3": 2x + 3 = 11 in the tutor's blue, 2x = 8 ticked, the slip x = 5 circled, the hint card open |
| 2 | `02-problem-page-ticked.png` | "Problem 2 of 3": 3x = 15 and x = 5 ticked, Next problem |
| 3 | `03-ask-draws.png` | Ask beside the board: "Why is 3/4 bigger than 5/8? Can you show me?", the answer, and the fraction bars it drew |
| 4 | `04-first-run-try.png` | The first run's try: "Your turn, Maya." 2x + 5 = 17, 2x = 12 and x = 6 ticked, "You got it.", her first star |
| 5 | `05-home.png` | Maya's Home: Today's practice, a 12-day streak, her 7th grade path, boards with thumbnails |
| 6 | `06-progress.png` | Progress: this week (72 minutes, 25 problems), the last four weeks, skills |
| 7 | `07-progress-skills.png` | Progress, scrolled: skills with stars and Practice (optional) |
| 8 | `08-all-done.png` | Today's practice finished (optional: it shows two "Not yet", fine but not a hero shot) |

Each is 2752 × 2064 landscape (the 13-inch size, which covers every iPad), sRGB, no alpha. The hint
text is the model's own words: re-run `scripts/ios-appstore-shots.sh` if a later run reads better.
The "I READ" chips are the app's own read-back, not Debug chrome.

---

## 12. The owner's step-by-step (one sitting, about 3½ hours; less if the agreements are already active)

Before you start: `feat/ipad-launch` (with the Privacy Policy and Terms, §7) is merged and deployed, and
decided on the AI-permission line (§9, risk 1); if that line ships, the build you upload in step 8
must contain it.

| # | Where | What | Time |
|---|---|---|---|
| 1 | appstoreconnect.apple.com › Business (Agreements, Tax, and Banking) | Paid Apps Agreement accepted; bank account; W-9 tax form. Nothing sells until it is **Active** (may already be, from the owner's other apps: check first). | 20–30 min (0 if active) |
| 2 | developer.apple.com › App Store Small Business Program | Enroll (15% commission instead of 30%). Approval takes days; it doesn't block launch. | 5 min |
| 3 | App Store Connect › Apps › + New App | §3: iOS, name, English (U.S.), bundle id `app.agathon.Agathon`, SKU `agathon-ipad`. If the name is taken by one of your older records (there are App Store profiles for `com.agathon.app` and `app.agathon.ios` on this Mac), rename or remove that record first, or use an alternate name from §10. Copy the app's **Apple ID** (App Information) for step 4. | 10 min |
| 4 | Vercel › agathon › Settings › Environment Variables (Production) | `APPLE_ENVIRONMENT=Production`, `APPLE_APP_APPLE_ID=<the Apple ID from step 3>`; redeploy production. (Confirm the Apple routes from `feat/ipad-app` are live: `POST https://www.agathon.app/api/billing/apple/notifications` with `{}` answers 400, not 404.) | 10 min |
| 5 | App Information; Pricing and Availability | Category Education; content rights No; age rating questionnaire (§8, 4+); Privacy Policy URL; price Free; availability United States; untick Mac (Apple silicon) and Apple Vision Pro. | 15 min |
| 6 | Monetization › Subscriptions | §10 "The subscription": the group, the product, the price, Family Sharing off, the localization, the free week, the review screenshot and note; Billing Grace Period off. | 20 min |
| 7 | App Information › App Store Server Notifications | Production and Sandbox URL `https://www.agathon.app/api/billing/apple/notifications`, Version 2. "Send test notification", then in the production SQL editor `select id, type from billing_events where type = 'apple.TEST' order by id desc limit 1;` shows it. | 10 min |
| 8 | Your Mac, the repo | Make the API key (§5, role Admin), then `scripts/ios-release.sh --upload --no-bump` (1.0 (1)). Wait for "processed" in TestFlight (5–30 min; do steps 9–11 meanwhile). Commit `ios/project.yml` if the number changed. | 15 min + wait |
| 9 | App Privacy | §6, data type by data type; publish. | 15 min |
| 10 | Users and Access › Sandbox › Testers | One sandbox Apple Account (a fresh email) for your own test. | 5 min |
| 11 | The version page (1.0) | Screenshots (§11: drag `01`–`06`, and `07`–`08` if you like, from `docs/app-store/screenshots/` in order), promotional text, description, keywords, support and marketing URLs, copyright (§10). | 20 min |
| 12 | TestFlight, on your iPad | Install the build; sign in to the sandbox account in Settings › App Store › Sandbox Account; run the first run, start the free week (Sandbox), check the plan shows as on (Account › Plan) and `select provider, status from unlimited_subscriptions order by updated_at desc limit 1;` says `apple`, `trialing`. Then delete that test account in the app (Account › Delete my account). | 20 min |
| 13 | Your iPad (TestFlight) + production SQL | The demo account for App Review (§9): the first run as a grown-up with Maya, Not now on the plan, PIN 2468, a few ticked lines; `grant_ink` 2,000. Sign out. | 15 min |
| 14 | The version page › App Review Information | Sign-in required: the demo email and password; contact details; the notes (§9). Build: pick 1.0 (1). Tick the subscription under In-App Purchases and Subscriptions. Release: "Manually release this version" (so you choose the day). | 10 min |
| 15 | Submit for Review | Answer export compliance if asked (No: `ITSAppUsesNonExemptEncryption` is in the plist, so it shouldn't ask), "Does this app use the Advertising Identifier?" No. Submit. Review takes about 1–2 days. | 5 min |

After approval: Release this version; then `select count(*) from unlimited_subscriptions where provider = 'apple' and livemode;` over the first days, and the admin console's Issues tab for `ios` errors.

---

## 13. Open decisions (owner)

1. **The AI-permission line** (§9, risk 1): ship it in 1.0 (recommended) or submit without and
   answer a rejection.
2. **Minimum iPadOS:** test on 17/18 via TestFlight, or raise to the oldest tested.
3. **Availability:** United States only (recommended) or more storefronts.
4. **Training Center** in the store build (admins only) or Debug only.
5. **Returning subscribers' free week** (from the handoff): Apple shows "1 week free" to a lapsed
   web subscriber; recommendation: honour it.
