# Onboarding for the iPad app

**Owner's ask (2026-10-17):** "make sure to build a beautiful onboarding, just like
https://heyaristotle.com/".

**Status:** design only. Nothing here is built yet. It belongs to Phase 4 (Screens) in
`docs/IPAD-NATIVE.md`, with the StoreKit parts in Phase 5 (Money).

**Brand:** A · Blocks (`docs/DESIGN-SYSTEM.md`, `docs/brand/directions.html`). Flat colour only.
Every component named below is in `AgathonDesign`.

## Why it is shaped like this

- **Before any account, the kid writes one problem with the Pencil and the tutor ticks it.** The
  web's paywall era (2026-10-05 to 10-12) had 39 sign-ups, 27 opened the card form and 18 started
  a trial. The card came about a minute after sign-up. Of the 21 who never trialed, only 1 had
  written a line on the board. Families who left had never seen the tick.
- **Aristotle has the right order:** who you are, a few questions, a short "building your plan"
  beat, then the account. We keep that order and cut the asking. We have three questions where
  they have ten, and in place of their five claim screens we put the real tick.
- **The iPad changes two things.**
  - The Pencil is the product. The first thing a kid does is write, and the tutor answers in its
    own blue hand.
  - The payment is Apple's. A StoreKit trial is one Face ID tap with a card Apple already has, not
    the web's card form. The grown-up sees it once, while holding the iPad, behind a grown-up
    check.
- **Kids never see an account form or a price.** The kid's part ends with "Hand the iPad to a
  grown-up".

## What Aristotle does (walked 2026-10-17)

The full study is at
`/private/tmp/claude-501/-Users-rushilchopra-whiteboardstaging-whiteboardstaging/2722d199-975c-4bc3-bca5-134db27051b8/scratchpad/aristotle/compare.html`.
That folder is a session scratchpad, so copy it somewhere lasting if it is wanted later. The
earlier capture is in `~/whiteboardstaging/research/aristotle-onboarding-2026-10-13/`.

- **Parent path, 16 screens before the account:**
  - 10 questions: motivation, grade, subject, hours a week, homework habits, exams, what energises
    them, interests, heard about us, success in six months.
  - 5 claim screens: a testimonial, "100 subjects", "like a human tutor, but better", the team's
    schools, "You stay in the loop".
  - Then the beat and the email screen.
- **Student path:** "What's your name?" → "It's a pleasure to meet you, Sam." → 9 questions and
  one claim screen → the beat → "Your plan is ready." / "You're in" → email.
- **The account:** Google or a magic link. No password and no card. Nothing is paid inside
  onboarding: three free one-hour sessions come first, then $49 or $199 a month.
- **What makes it feel good:**
  1. One speaker. The apple types every question into a speech bubble. Its body, leaf and eyes
     each breathe on their own loop, and its eyes look at the card you hover.
  2. One question per screen. Big rows and chips, single choices that move on when tapped,
     Back/Skip and a thin progress bar. A claim screen comes every two or three questions as a
     breather.
  3. The name comes straight back ("It's a pleasure to meet you, Sam."), and every question is
     reworded for parent or student.
  4. A crafted look: cream graph paper, a serif headline face (Bogue), collage art made of
     old-master cut-outs, torn paper and maps, and dark-brown pill buttons.
  5. The account is framed as the reward ("Your plan is ready." / "You're in"). It remembers
     where you were, and it honours Reduce Motion.
- **What is weak, or doesn't fit K–8 on an iPad:**
  - Most answers change nothing you can see, and the plan is never shown.
  - "Finding your child's learner type…" is theatre built on an idea teachers distrust.
  - The words are adult, there's no read-aloud, and the grades start at "5th grade or lower".
  - A kid alone is asked for an email.
  - It's a narrow web column with emoji icons, so an iPad's width and its Pencil go unused.

## The flow at a glance

The usual case: a grown-up downloads the app and sets it up, and the kid writes.

| # | Screen | Holding the iPad | What happens | About |
|---|---|---|---|---|
| 0 | `splash` | – | The mark assembles: ring, then bar, then the dot drops in | 0.8 s |
| 1 | `hello` | grown-up or kid | "Hi. Who's holding the iPad?" | 3 s |
| 2 | `name` | same | The kid's first name, written with the Pencil or typed. The tutor writes back "Hi, Sam." | 6 s |
| 3 | `grade` | same | Kindergarten to 8th as big blocks, or a high-school class | 3 s |
| 4 | `tricky` | same | Up to 3 skills, or "Not sure" (optional) | 8 s |
| 5 | `handToKid` | grown-up | "Hand the iPad to Sam." (grown-up path only) | 4 s |
| 6 | **`tryIt`** | **kid** | **The tutor writes a problem. The kid writes the answer. A tick within seconds.** | 20–40 s |
| 7 | `building` | kid | "Making Sam's plan." Three real things, each ticked | 2.4 s |
| 8 | **`plan`** | **kid** | **"Sam's plan is ready." The path, today's practice, the first star** | 6 s |
| 9 | `handBack` | kid → grown-up | "Hand the iPad to a grown-up." | 3 s |
| 10 | `gate` | grown-up | Grown-ups only: the year you were born | 5 s |
| 11 | `account` | grown-up | Email, password (Keychain fills both), terms | 20 s |
| 12 | `trial` | grown-up | Apple's 7-day free trial, or "Not now" | 10 s |
| 13 | `pin` | grown-up | A 4-digit PIN | 8 s |
| 14 | `kidProfile` | grown-up → kid | "Pick your picture, Sam." | 6 s |
| 15 | **`firstBoard`** | **kid** | **Sam's first board, with the problem already ticked on it** | – |

- **Time to the first tick:** about 45 to 65 seconds from opening the app. Aristotle's flow takes
  2 to 3 minutes and never reaches the product.
- **Kid alone:** the same screens minus `handToKid`. "Not now" at `handBack` keeps everything on
  the iPad and shows the waiting screen (below).
- **Signed out with an account:** "I have an account. Sign in" on `hello` (see Sign in, below).

## Rules for every screen

- **Layout:**
  - Chalk ground with 40 pt margins and a content column up to 960 pt wide.
  - The title is top-left in Bricolage. Display 64 is used only for "Hi." and the hand-off
    screens; questions use Title (32 pt at default size).
  - Answers sit below the title. A bottom bar is 88 pt tall.
  - The same layout works in portrait, where grids get taller rather than wider. In a compact
    width (Split View, Slide Over) grids drop to two columns and cards stack.
- **The bar:**
  - Back is a `RoundButton` on the left.
  - The progress trail is in the middle (next item).
  - The right side shows Skip (quiet) on the screens that allow it, or Continue (`PillButton`
    sunny, large) when a screen needs one.
- **The progress trail, not a bar.** The kid's part shows five nodes: who, name, grade, tricky,
  try. It is the skill path's own style:
  - a done node is an ink dot;
  - the current node is a tomato ring;
  - after the try, the trail turns into the plan's path.

  The grown-up's part has its own three-node trail (Account · Free trial · Sam's profile). The
  hand-off screens, the beat and the board show none.
- **A single choice moves on by itself.** The card fills ink, the tutor's tick draws on it in
  cobalt (`DS.Motion.draw`), and a marimba tap plays. The next screen follows after 360 ms.
  Multi-choice screens have Continue.
- **Motion, "snap":** about 220 ms with one small overshoot. Each title rises 12 pt and fades in.
  Answer cards follow with a 40 ms stagger. A press shrinks to 96 % and darkens. The way out is a
  120 ms fade, never a slide across the screen. Under Reduce Motion everything is a cross-fade
  (`withDSAnimation`).
- **No typewriter.** Aristotle types its questions. Ours appear at once, and the one thing that
  writes is the tutor's hand: "Hi, Sam.", the problem, a hint. That is the product's own motion,
  and it teaches the kid what cobalt means before the try.
- **The shapes get eyes only three times:** `hello` (screen 1), the first `plan`, and the first
  board's welcome. Never next to a slip.
- **Sound:** wood and bells.
  - a marimba tap for a choice;
  - two notes stepping up for a tick;
  - a short xylophone run for the plan;
  - one soft woodblock for "Look again".

  `AVAudioSession` uses `.ambient`, so the mute setting and the kid's music are respected.
- **Read aloud:** every screen a kid reads has a speaker `RoundButton`, top right. It reads the
  title and the answers with `AVSpeechSynthesizer` (on the device, en-US). After the account it
  uses the tutor's voice (`/live/speak`). Once the grade is Kindergarten to 1st, the try's
  instruction is read automatically.
- **Copy:** a coach. Short, sure, full stops, few exclamation marks, US English. A kid never
  reads "wrong", a price or "free trial".
- **Resume:**
  - The flow is kept on the device for 7 days: the step, the answers, the journey id and the
    try's strokes.
  - Closing the app reopens on the same screen. The beat and the account reopen on the plan, as
    on the web (`resumeStep` in `src/lib/start/flow.ts`).
  - Back never goes into the beat.

## Screen by screen

The words are in two voices where they differ: **G** for the grown-up, **K** for the kid alone.
"Sam" stands for the name typed; with no name, the grown-up reads "your kid", and the kid's own
screens read with no name.

### 0 · `splash`

- **Purpose:** the brand, while the app warms up. Load `brain.js` into its `JSContext`, prefetch
  the StoreKit product, and open a connection to the API host.
- **Motion:** the mark assembles: the ring scales in, the bar drops beside it, and the dot falls
  into the ring with a small bounce. Three marimba notes play. Reduce Motion shows the finished
  mark.
- **Stores:** a journey id (UUID) on first launch.

### 1 · `hello`

- **Purpose:** who is holding the iPad, and a warm first look.
- **Copy:**
  - Title: "Hi." (Display), then "Who's holding the iPad?" (Title).
  - Lede: "A few taps, then a problem to try."
  - Card 1, `Card(.ink, deco: true)`, 360 × 260: "I'm a grown-up" / "Setting it up for a kid".
  - Card 2, `Card(.sunny, deco: true)`: "I'm a kid" / "Here to practice".
  - Quiet pill: "I have an account. Sign in".
- **Character:** `TheShapes(.hello)` at 160 pt, above the title. They blink and bob.
- **Input:** tap a card.
- **Stores:** `role` (`parent` | `kid`; the web contract's names).
- **Calls:** `start_shown`, `start_who { role }` to `/api/start/step` (app path, see Server work).

### 2 · `name`

- **Purpose:** the name the whole flow uses, and the first time the Pencil touches the glass.
- **Copy:**
  - Title: G "What's your kid's first name?" · K "What's your first name?"
  - Lede: "Write it with your Pencil, or type it."
  - Field placeholder: G "Their first name" · K "Your first name".
  - Error: "Use letters only, like Sam or Mary-Kate."
  - Button: "Continue".
- **Input:** one `PillField`, 72 pt tall with text at 40 pt. Scribble turns Pencil writing into
  text. Autocorrect is off and words are capitalised. No `textContentType`, so autofill never
  offers the grown-up's own name. Return submits. Skip is in the bar.
- **Check:** `KID_NAME` (letters, spaces, hyphens, apostrophes; at most 24).
- **Payoff:** the field lifts 24 pt and the tutor writes **"Hi, Sam."** under it in cobalt Kalam
  at handwriting pace (about 0.7 s), with a marimba tap. It holds for 0.6 s, then the next screen.
  With no name it writes "Hi there."
- **Stores:** `name`, **on the device only** until the account exists.
- **Calls:** `start_name` (no name in it).

### 3 · `grade`

- **Copy:**
  - Title: G "What grade is Sam in?" · K "What grade are you in?"
  - Lede: G "The tutor picks problems for that grade." · K "So every problem is just right."
- **Input:**
  - A 3 × 3 grid of 120 pt square blocks, paper on chalk: K, 1st, 2nd / 3rd, 4th, 5th / 6th,
    7th, 8th. Numerals are Bricolage, 46 pt.
  - Under the grid, a wide pill: "High school" / "Algebra, geometry and up". It opens a second
    list: Algebra 1, Geometry, Algebra 2, Pre-calculus / Calculus (`HIGH_SCHOOL_COURSES`), and
    Something else (`SOMETHING_ELSE`).
- **Motion:** the tapped block fills ink, its numeral turns white, and a cobalt tick draws in its
  corner.
- **Stores:** `choice` (`WelcomeChoice`: grade 0–8 or a course).
- **Calls:** `start_grade { grade }` or `{ course }`.

### 4 · `tricky` (optional)

- **Shown:**
  - For a grown-up, whenever the grade or course offers skills (`focusOptions`).
  - For a kid alone, from 3rd grade up. Younger kids go straight to the try, because these cards
    are a lot to read.
- **Copy:**
  - Title: G "What's tricky for Sam right now?" · K "What feels tricky right now?"
  - Lede: G "Pick up to 3. Sam's plan starts there." · K "Pick up to 3. Your plan starts there."
  - Counter: "2 of 3 picked".
  - Full: "That's 3. Tap one to swap it."
  - Wide pill: "Not sure" / "Start at the beginning". It moves on at once.
  - Button: "Continue".
- **Input:** a 2 × 3 grid of cards (paper on chalk). Each card has the skill name (Heading) and
  one example in the tutor's hand (`SKILL_EXAMPLES`). A picked card fills ink.
- **Stores:** `focus` (up to 3 `PathSkillId`, in the order picked).
- **Calls:** `start_focus { count }`.

### 5 · `handToKid` (grown-up path only)

- **Purpose:** put the Pencil in the kid's hand while the grown-up watches. This is the turn the
  whole flow is built for.
- **Look:** full-bleed sunny. A Pencil icon in an ink circle, 96 pt.
- **Copy:**
  - Title (Display): "Hand the iPad to Sam."
  - Lede: "Sam writes one answer. The tutor checks it in a few seconds."
  - Small line: "No Pencil? A finger works too."
  - Buttons: "Sam has it" (`PillButton` primary, large) · "I'll try it first" (quiet).
- **Behind it:** the problem's ink is fetched and the reader's connection is warmed, so the first
  check doesn't pay for a cold start.
- **Calls:** `start_handoff_kid`.

### 6 · `tryIt`: the magic moment

- **Purpose:** the kid writes a real answer and the tutor reads it and ticks it, before any
  account, form or price.
- **Look:**
  - A real `AgathonBoard` page: white paper with an 18 pt corner radius on the chalk ground,
    nearly full screen.
  - Top left: "Your turn, Sam." (Headline). Top right: Skip, which reads "Skip for now".
  - The dock is cut down to the black pen, the eraser and undo.
  - `HelpMeButton` (sunny, 72 pt) sits bottom right, as on every board.
- **The problem:**
  - The tutor writes it in cobalt at handwriting pace (1 to 1.5 s).
  - It is the easiest starter of the plan's first skill at Sam's grade: the web `/start`'s
    choice, with the try board's problems by band (`src/lib/try`).
  - Beside it is a chalk answer zone (radius 24) with a quiet "Write here" label. After 3 s
    without writing, a pencil glyph nods toward it; under Reduce Motion it stays still.
- **Writing:**
  - Pencil first. A finger draws until a Pencil has been seen, then fingers pan, as on every
    board.
  - Coalesced and predicted touches, so the line keeps up with the Pencil.
  - The zone is in the middle so a left-handed kid's palm rests on the glass too.
- **Reading:**
  1. The pen lifts and the board waits 650 ms; more writing restarts the wait.
  2. `StatusPill` shows "Checking…" with a cobalt dot that pulses (a still dot under Reduce
     Motion).
  3. The strokes go to the reader.
- **Right:**
  1. The tutor's tick draws in one stroke beside the answer (`DS.Motion.draw`, about 280 ms),
     with two marimba notes stepping up. On an Apple Pencil Pro the Pencil also taps once
     (`UICanvasFeedbackGenerator`).
  2. `Banner(.success)`: **"You got it."**
  3. 400 ms later the first star sticker lands on the page's corner with a spin and an
     overshoot, captioned "Your first star."
  4. Then two buttons: "One more" (secondary) and "Next" (sunny).
- **A slip:**
  - The tutor rings the slip in cobalt and writes one hint in its hand, for example "Add the ones
    first. 8 + 7 = ?"
  - `Banner(.tryAgain)`: **"Look again."** One soft woodblock plays. Never red, never "wrong".
- **Unreadable:** "Write it a little bigger."
- **Help me:** the tutor writes the next step on the page (`/api/try/help`).
- **Can't check:** offline, rate-limited or a reader error all show "The tutor can't check right
  now. Tap Next to keep going." The flow never stops here.
- **Limit:** three problems before the account. After the third, Next only.
- **Stores:**
  - On the device: each problem, the kid's strokes and the verdicts, so the first board can show
    them.
  - `tried { checked, solved }`, merged upward as on the web (`chooseTried`).
- **Calls:** `POST /api/try/check` and `POST /api/try/help` (app path), `start_try_shown`, and
  `start_try_checked { solved, ms }` (`ms` from pen lift to the tick).
- **Targets:** the tick within 2.5 s of the pen lifting (median) and 4 s (p90). The first tick
  within 60 s of opening the app (median).

### 7 · `building` (a beat, not a place)

- **Purpose:** make the plan, honestly. `planSkills` runs here (the web's `plan.ts`, ported or run
  in the brain).
- **Copy:** "Making Sam's plan." (K: "Making your plan."), then three lines, each getting a
  cobalt tick 0.6 s apart:
  - "3rd grade problems"
  - "Starting with Adding within 100"
  - "A first board, ready to write on"
- **Motion:** a 120 pt mark assembles in the middle while the lines tick in. Three marimba notes
  rise. Reduce Motion shows everything at once for 1.2 s.
- Back from the plan goes past it.

### 8 · `plan`: the second payoff

- **Look:**
  - `TheShapes(.celebrate)` at 96 pt and a xylophone run, the first time only.
  - Left: a cobalt card for today's practice, the brand's Today card: "Today's practice" /
    "5 problems · About 10 minutes", with a `StarRow` showing 1 of 5 filled, because the try
    counts.
  - Right: a vertical `SkillTrail`. The tomato ring is "Adding within 100 · Start here"; the dots
    are "Subtracting within 100 · Next" and "Word problems · Then".
  - Below: a thumbnail of the first board, with the problem in the tutor's hand: "Sam's first
    board".
  - A sticker chip: "1 star".
- **Copy:**
  - Title: "Sam's plan is ready." (K: "Your plan is ready.")
  - Lede: "Built from Sam's answers." (K: "Built from your answers.")
  - Button (sunny, large): "Save my plan" (G path: "Save Sam's plan").
  - With a solved try: "Solved one already".
- **No price, no trial, no "free".** This screen is the kid's.
- **Calls:** `start_plan`.

### 9 · `handBack`

- **Look:** full-bleed ink. This is the grown-up zone: from here on, ink grounds mean
  "grown-ups". A lock icon in a sunny circle.
- **Copy:**
  - Title (Display, white): K "Hand the iPad to a grown-up." · G path "Hand it back to your
    grown-up."
  - Lede: "They save your plan. It takes a minute."
  - Buttons: "I'm a grown-up" (sunny) · "No grown-up right now" (quiet, kid alone only; it leads
    to the waiting screen).
- **Calls:** `start_handoff_grownup`.

### 10 · `gate`: grown-ups only

- **Copy:** `SheetHeader` "Grown-ups only", then "What year were you born?"
- **Input:** four `PinDots` and the `PinPad`.
- **Rule:**
  - It opens when the year makes them 18 or older. It never says what the rule is.
  - A miss reads "This part is for grown-ups."
  - After two misses it pauses for a minute: "Try again in a minute."
  - The year is never stored or sent.
- **Why this gate:**
  - Agathon is maths, so a sum is no gate. A neutral birth-year question is also what an age
    screen should look like.
  - Every gate is a speed bump. The real guards come later:
    - the grown-up's PIN, which replaces this gate everywhere once it is set;
    - Apple's own purchase sheet, which needs the Apple ID owner's Face ID or password;
    - Ask to Buy, when the iPad is signed in with a child's Apple ID.

### 11 · `account`

- **Trail:** grown-up step 1 of 3.
- **Copy:**
  - Title: "Save Sam's plan."
  - Lede: "Make your grown-up account. Sam gets a profile next."
  - Email (`PillField`, `.emailAddress`, `.username`).
  - Password (secure, `.newPassword`, so iCloud Keychain offers a strong password in one tap;
    the minimum is LoginForm's).
  - Consent, required: "I agree to the Terms and Privacy Policy. I'm 13 or older, or I'm a parent
    or guardian setting this up for my child." This is LoginForm's wording; the two links open in
    `SFSafariViewController`.
  - Optional `Menu`: "How did you hear about Agathon?" (`HEARD_FROM`).
  - Button (sunny, large): "Save Sam's plan". Quiet: "I have an account. Sign in".
- **Errors:**
  - "That email has an account already." with a "Sign in instead" button.
  - "Check your connection and try again."
- **Calls, in order:**
  1. `supabase.auth.signUp(email, password, data: { terms_version: TERMS_VERSION })`. The
     `require_signup_terms` trigger refuses a sign-up without it. It must come back with a
     session; see Open decisions.
  2. `save_onboarding(p_complete: true, p_heard_from)` as the grown-up. The grade belongs to
     Sam's profile, not the grown-up's.
  3. `link_start_journey`, then `start_account`. The welcome email goes out once, as on the web.
- **Stores:** the session in the Keychain.

### 12 · `trial`: the paywall, grown-up only

- **Skipped** when the account already has the plan (`has_unlimited`: a Stripe subscriber who
  signed in).
- **Copy.** Every number is read from StoreKit; none is typed into the code.
  - Title: "Try Agathon free for 7 days." The 7 is the offer's period.
  - Lede: "Everything Sam just did, every day."
  - Five rows, each an `IconCircle` and a line:
    - "The tutor checks every line Sam writes."
    - "Help me gives the next step, not the answer."
    - "Practice that follows Sam's path, with stars and a sticker book."
    - "A report for you every week."
    - "Up to 6 kids on one plan."
  - A three-node timeline in the trail's style:
    - "Today": "Sam starts".
    - "Day 5": "We remind you".
    - "Day 7": "Your plan starts. Cancel before then and you pay nothing."
  - Toggle, on by default: "Remind me 2 days before it ends".
  - Price line (caption): "Free for 7 days, then {displayPrice} a month. It renews until you
    cancel in Settings."
  - Button (sunny, large): "Start free trial". Without an introductory offer
    (`isEligibleForIntroOffer` false): "Subscribe for {displayPrice} a month".
  - Quiet: "Not now".
  - Footer: "Restore purchase · Terms · Privacy". App Review wants all three.
- **StoreKit 2:**
  - The product is fetched at launch.
  - Purchase: `product.purchase(options: [.appAccountToken(checkoutRef)])`. `checkoutRef` is
    `profiles.checkout_ref`, already a UUID.
  - `.success(.verified)`: send the signed transaction to the server, then `transaction.finish()`.
  - `.pending` (Ask to Buy): "Waiting for approval. Sam can start now." Sam gets the free board
    until Apple says yes.
  - `.userCancelled`: stay on the screen.
  - An error: "Couldn't reach the App Store. Try again."
- **The reminder:** when the toggle is on, the notification permission is asked at the tap on
  Start, which is the only notification ask in onboarding. A local notification is set for day 5.
- **Calls:** `start_trial_shown`, `start_trial_started`, `start_trial_pending`,
  `start_trial_declined`.

### 13 · `pin`

- **Trail:** grown-up step 3 of 3, first half.
- **Copy:**
  - Title: "Pick a 4-digit PIN."
  - Lede: "Sam switches profiles with a tap. Getting back to yours takes this PIN."
  - Second entry: "Once more to be sure."
  - Mismatch: "Those didn't match. Try again."
- **Calls:** `POST /api/family/pin`. Kid profiles need the PIN first (`pin_required`).

### 14 · `kidProfile`

- **The hand-back:** a short ink screen reads "All set. Hand it back to Sam." with a "Sam has it"
  button.
- **Copy (Sam's):** "Pick your picture, Sam."
- **Input:** the 12 `AVATARS`, drawn in Blocks shapes. Until that art exists, `Avatar` (Sam's
  initial) on a choice of five colours. Cobalt is never one of them.
- **Calls, in order:**
  1. `POST /api/family/kids { displayName: "Sam", grade, avatar }` → the new member.
  2. `POST /api/family/switch { to }` → `setSession`.
  3. As Sam: `save_onboarding(p_grade | p_course, p_complete: true)`.
  4. Make the first board (below).
  5. `start_pin_set`, `start_kid_added`, `start_first_board`.
- **Stores:** after this the flow is forgotten on the device, but the journey id is kept, as with
  `forgetFlow`.

### 15 · `firstBoard`

- **Screen 1** holds the problem Sam already solved, with Sam's own strokes and the tutor's tick,
  carried from the device. Under it, the tutor is writing the next problem on the plan's first
  skill.
- **The rest:** the plan's practice problems, 4 as on the web (`START_PROBLEMS`). They come from
  the brain's practice set.
- **Welcome:** a one-time line in the tutor's colours, "Your board, Sam. Write under each
  problem.", with `TheShapes(.hello)` small beside it for 2 s.
- **No tour.** The try already taught the loop: write, wait, tick. Ask and Talk explain
  themselves the first time they're tapped.
- **The try counts:** the solved try is recorded as Sam's first learning attempt, so the star is
  real and today's practice reads 1 of 5.

### The waiting screen (kid alone, "No grown-up right now")

- **Copy:** "Sam's plan is waiting." / "A grown-up saves it. Then Sam's board opens."
- **Buttons:** "I'm a grown-up" (to the gate) and "Try another problem", until the three tries
  are used.
- Opening the app lands here until the plan is saved.

### Sign in

- **Copy:** "Welcome back." Email and password, filled by the Keychain. "Forgot password?" sends
  the reset email, which opens the app through a universal link.
- **After:**
  - A family with kids gets "Who's practicing?" (the switcher's picker).
  - If this iPad holds an unsaved plan and the family has no kid by that name: "Add Sam to your
    family?" → PIN if needed → `kidProfile`.
  - A Stripe subscriber never sees `trial`.

### "Not now" on the trial

- **Recommended (needs a small server change, Open decisions 2):**
  - Sam still gets a profile and the **free board**, as on the web: 5 problems or the starter
    ink, whichever ends first (`src/lib/billing/freeBoard.ts`).
  - At the end Sam sees "Nice work, Sam. 5 done." and "Ask a grown-up to keep going." That leads
    to `handBack`, then the grown-up's PIN (now the gate), then `trial`.
- **Without that change:** the grown-up's own account plays Sam, as the web's solo accounts do.
  Its `display_name` is Sam and it has the free board. The PIN and kid profiles wait for the
  plan. This works today, but Sam's first boards then live on the grown-up's profile.

## The payoffs

1. **"Hi, Sam."** About 6 seconds in. The tutor writes the kid's name in its own blue hand. It
   plays the part of Aristotle's "It's a pleasure to meet you, Sam.", and it introduces the
   colour that will soon tick.
2. **The tick.** Under a minute in, on the kid's own handwriting, before any form. This is the
   moment the web funnel showed was missing for everyone who left.
3. **The plan, shown.** It is real: the path, today's practice with one star already, and the
   first board. Aristotle says "Your plan is ready." and then shows an email box.
4. **Sam's first board** opens with Sam's solved problem on it. The answers turned into the
   product with nothing lost on the way.

## The hand-off, the gate and the paywall: placement and why

- **The kid's part ends at the plan.** Everything a kid touches has no price, no form and no
  "trial". The switch to the grown-up is a full-screen ink card with a gate behind it, and it
  isn't hidden in a corner.
- **The account comes after the payoff.** Aristotle and the web's `/start` both do this. The
  account is "Save Sam's plan": a reason, not a toll.
- **The trial is offered once, right after the account, while the grown-up holds the iPad.**
  - The grown-up is present now, and may not be again soon. A paywall at the end of the free
    board would need a second hand-off and often finds no grown-up there.
  - On the web the card form was the cliff: 9 of 27 opened checkout and left. Apple's sheet is
    one Face ID with a card already on file.
  - The grown-up has just watched the tick. The trial is for something seen, not promised.
  - "Not now" is honest and leads somewhere: the free board. The reminder toggle answers the
    usual fear about trials, and Day 7 says plainly when the charge comes.
- **Kid profiles come after the trial.** The server only adds a kid on the plan and after a PIN
  (`plan_required`, `pin_required`). The PIN then becomes the gate for everything grown-up.
- **The web differs.** There the order is account, free board, then the card, the owner's
  2026-10-13 order. That order was made for the Stripe card form. Open decisions 1 asks the
  owner to confirm the iPad order.

## Accessibility

- **VoiceOver:**
  - Each choice card is one button with its two lines as label and hint: "I'm a grown-up.
    Setting it up for a kid." The selected trait is set.
  - The trail reads "Step 3 of 5". Each new screen posts `.screenChanged` with focus on its
    title.
  - The tutor's ink has a spoken label: "48 plus 27 equals, blank."
  - The try offers **"Type it instead"**: a number pad whose answer goes to the same judge
    (engine only, no read). Writing by hand under VoiceOver is not a fair test.
  - Results are announced: "You got it." / "Look again. Add the ones first."
  - The shapes and stickers are decorative, apart from "Your first star."
- **Dynamic Type:**
  - Every style is a `DS.Font` that scales.
  - At accessibility sizes the grade grid becomes a 2-column list and the who cards stack.
  - Titles may wrap but never truncate. The bottom bar grows, and Skip moves into the title area.
  - Check every screen at AX3 (the design system's large-type shots).
- **Reduce Motion:** cross-fades only.
  - The mark appears whole and the shapes hold still.
  - The tutor's ink appears whole instead of being written.
  - Stickers land without a spin, there's no confetti, and the pencil glyph doesn't nod.
  - The beat lasts 1.2 s.
- **Not by colour alone:** a tick, a ring and the words always come together. "Look again" is
  yellow with words, never red.
- **Targets:** 56 pt at least; main buttons 64; Help me 72; grade blocks 120.
- **Reading:** the speaker button on every kid screen. The try's instruction is read
  automatically for Kindergarten to 1st grade.
- **Keyboard and Switch Control:** everything is reachable, Return submits, and Escape is Back.
  The focus ring is cobalt.
- **Contrast:** every pairing is in `DS.ContrastPair.all` (WCAG AA). White on ink is used on the
  grown-up screens; ink on sunny is used for the hand-off.

## Permissions

- **Microphone:** never in onboarding. It is asked the first time a kid holds Talk or the Ask
  mic, after one line: "Hold to talk. Your tutor listens while you hold." If it's turned off,
  Talk says "Ask a grown-up to turn on the microphone in Settings."
- **Notifications:** only through the trial's reminder toggle, at the tap on Start. Streak
  reminders can ask later, in context.
- **Camera / photos:** the first time the Picture tool is used.

## What is stored and sent

| When | On the iPad | To the server |
|---|---|---|
| Before the account | the role, name, grade, picks, the try's strokes and verdicts, the step and the journey id (7 days) | anonymous steps (`start_steps`: role, grade or course, how many picks, solved, ms; **never the name**); the try's strokes go to the reader and are dropped |
| The account | the session (Keychain) | the email, password and `terms_version`; `heard_from`; the journey linked |
| The trial | – | the signed transaction (its `appAccountToken` is `checkout_ref`) |
| The profile | – | the PIN (hashed by the server); Sam's name, grade and picture; the first board; the try as Sam's first attempt |

- The kid's name leaves the iPad only once a grown-up has made the account.
- The birth year asked at the gate is never stored or sent.
- These are cheap privacy wins; the COPPA decision itself stays deferred.

## Server work this needs

1. **An app path for the routes used before the account.** `/api/try/check`, `/api/try/help` and
   `/api/start/step` refuse anything but our own web page (the `sec-fetch-site` check).
   - Accept the app with an App Attest assertion instead (`DCAppAttestService`).
   - Rate-limit by the attested key, with the same limits: 40 reads an hour, and the
     3,000-a-day cap through `global_budget_spend`.
   - AI keys stay on the server.
2. **Apple purchases.** This is IPAD-NATIVE's plan:
   - a route that verifies a signed transaction;
   - a receiver for App Store Server Notifications V2;
   - a service-role RPC that writes `unlimited_subscriptions`, so `has_unlimited` works
     unchanged.
3. **The first kid without the plan** (Open decisions 2). `addKid` would allow one kid before the
   plan, and that kid's free board would spend the family's starter ink.
4. **New steps in `START_EVENTS`:** `start_handoff_kid`, `start_handoff_grownup`, `start_gate`,
   `start_trial_shown`, `start_trial_started`, `start_trial_pending`, `start_trial_declined`,
   `start_pin_set`, `start_kid_added`, `start_first_board`. Add them to the admin Funnel's
   "Before the account" bars and an iPad column.

## Measuring it

- **The chain:** opened → who → name → grade → saw the try → **first tick** → plan → hand-back →
  gate → account → trial started (or declined → free board) → PIN → Sam's profile → first board
  → a second day.
- **Targets to watch:**
  - the share of installs that reach the first tick (the number that matters);
  - the median time from opening to the first tick (aim under 60 s) and from pen lift to tick
    (aim under 2.5 s);
  - the account rate after the plan;
  - the trial rate after the account;
  - trials that come back on day 2.
- **The comparison:** the paywall-era web cohort (27 opened checkout, 18 trials). The iPad's
  claim is that more families reach the tick and more grown-ups say yes, because they watched it.

## From Aristotle: what we take, what we do differently

| Aristotle | Agathon iPad | Why |
|---|---|---|
| One friendly speaker asks every question | The tutor's own hand writes the replies ("Hi, Sam."); the shapes get eyes only at hello, the plan and the first board | Blocks has no mascot, and the tutor's ink is the product |
| One question per screen, big answers, single choices move on, Back/Skip, a progress bar | The same, with a trail of dots and a ring (the skill path's look) | It works; the trail ties the flow to the path |
| The name comes straight back | "Hi, Sam." is written by the tutor, and Sam's name is on every later screen | Aristotle uses the name once |
| 10 questions | 3, plus 1 optional | Every answer changes something visible: the problem, the plan, the board |
| 5 claim screens: a testimonial, logos, "10,000 hours" | None. The tick is the proof | House rules: no testimonials or claims |
| "Finding your child's learner type…" | "Making Sam's plan." with the three real things it made | Honest, and still a beat |
| "Your plan is ready." with no plan shown | The plan on screen, and the board that opens is that plan | The answers turn into the product |
| A kid alone types an email | Kids never see a form or a price; an ink hand-off and a grown-up check come first | Families on one iPad; Apple's rules for kids |
| Google or a magic link | Email and password, with Keychain's one-tap strong password | The brief, and no email round trip on an iPad |
| No paywall; free sessions first | Apple's 7-day trial offered once, to the grown-up, after the tick, with "Not now" and the free board | One Face ID, not a card form |
| Keyboard; a narrow column | The Pencil from screen 2; layouts made for 1194 × 834 and portrait | It's an iPad |
| Starts at 5th grade; adult wording | Kindergarten to 8th; K–2 words; read-aloud | Our kids |
| Collage art, a serif, cream paper | Blocks: flat primaries, Bricolage and Lexend, the logo's shapes | Our brand; no gradients |
| Remembers where you were; honours Reduce Motion | The same (7 days; cross-fades) | Good manners |

## Open decisions for the owner

1. **Trial placement.**
   - Recommended: offer Apple's trial right after the account, with "Not now" leading to the free
     board.
   - The alternative is the web's order: the free board first, then the trial at its end, which
     needs a second hand-off.
2. **The first kid without the plan** (server). If yes, "Not now" still gives Sam a profile. If
   no, use the solo fallback above.
3. **The gate.** The year you were born (recommended), until the PIN exists.
4. **Avatar art.** Kid pictures in Blocks shapes, or initials and colours for the first version.
5. **Sign in with Apple.** Not needed for email and password (App Review 4.8 applies only once
   another social sign-in is added). Worth adding later for one-tap accounts.
6. **The sign-up must return a session.** This is a check rather than a choice. If "Confirm
   email" is ever turned on in Supabase, `account` would stall on an email round trip in the
   middle of the hand-off.

## For the screens lane

- **One `OnboardingFlow` model** ported from `src/lib/start/flow.ts`: the steps, Back, resume,
  the reducers and every word in `flowCopy`. Add the iPad's own steps: `handToKid`, `handBack`,
  `gate`, `trial`, `pin`, `kidProfile`. Keep the wording for both roles in one place, as the web
  does.
- **Components:** `PillButton`, `RoundButton`, `Card`, `Chip`, `FlowStack`, `PillField`,
  `PinPad` / `PinDots`, `SheetHeader`, `Banner`, `CheerPill`, `StatusPill`, `SkillTrail`,
  `StarRow`, `Sticker`, `TheShapes`, `AgathonMark`, `HelpMeButton`, `Avatar`, `IconCircle`.
- **The try:** a real `AgathonBoard` page with the dock cut down. The tutor's ink uses the hand
  engine's paths (`GET /api/start/ink` has every starter already in the tutor's hand).
- **Screens to check in the simulator:**
  - every screen at 1194 × 834 and 834 × 1194;
  - a compact width;
  - AX3 text;
  - Reduce Motion;
  - VoiceOver on the try.

## Owner decisions (2026-10-17)

- **Trial placement:** offered once, right after the grown-up makes the account (step 12), with
  "Not now" and Restore. Not before the account; not deferred to the end of the free board.
- **"Not now":** the kid still gets their own profile and the free board (5 problems), like the
  web. This needs the server change described above: the first kid profile without a plan, and AI
  calls for that kid covered on the free board.
