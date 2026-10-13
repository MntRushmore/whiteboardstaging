# The new onboarding: /start (2026-10-13)

**Owner's ask:**
- "focus on rebuilding our onboarding", after studying Aristotle's (`~/whiteboardstaging/research/aristotle-onboarding-2026-10-13/`).
- "I wanna make it warmer", with reference to the owner's Figma (the "Agathon" application UI file).

## Why

- **The order is wrong.** Today it goes account first, then a short welcome and tour, then the plan screen's card about a minute after sign-up.
- **Leavers never see the tutor work.** Most families who leave have never seen the tutor check a line (funnel steps, PR #41).
- **Aristotle has the order we want.** It asks who you are and a few questions, builds "your plan", and only then asks for the account.
- **We keep the asking short.** Ours does the same, with fewer questions and one real moment: the try board (`docs/TRY-BOARD.md`).

## The flow (signed out, `/start`)

| # | Screen | Parent path | Kid path |
|---|---|---|---|
| 1 | `who` | "Who's getting started?" Parent / Kid | same |
| 2 | `name` | "What's your kid's first name?" (Skip) | "What's your first name?" (Skip) |
| 3 | `grade` | "What grade is Sam in?" K–8 + high-school courses | "What grade are you in?" |
| 4 | `focus` | "What's tricky for Sam right now?" Up to 3 skills from the grade's path, or "Not sure" | "What's tricky right now?" |
| 5 | `proof` | "You'll see every line Sam writes": real product pictures, no testimonials | (none) |
| 6 | `try` | The try board with a problem from Sam's grade: "Try one, or hand it to Sam" | "Write the answer" |
| 7 | `building` | "Making Sam's plan…" (a short beat; the plan is computed here) | same |
| 8 | `plan` | "Sam's plan is ready": today's practice and the first skills on the path | same |
| 9 | `account` | Save Sam's plan: email, password, terms, "How did you hear about Agathon?" (optional) | "Ask a grown-up to save it": "My grown-up is here" (the form, worded for the grown-up) or "Send it to my grown-up" (share / copy a link that reopens /start with the answers in its `#` fragment, so the name never reaches a server log) |

**Every screen:**
- One question per screen.
- Back, Skip where it makes sense, and a progress bar.
- A tap on a single-choice answer moves on.

**After the account:**
1. The answers are saved: grade or course, heard from, and the kid's name as the profile's display name.
2. Onboarding is marked done.
3. The first board is made on the plan's first skill (`planSkills`, the same choice the plan screen showed).
4. The visitor goes straight to that board. It is the account's **free board** (below): open with no card until 5 problems or the starter ink, then its "Nice work" sheet offers the trial at the win. This follows the owner's order (account, then one free board, then the trial). The plan screen itself is unchanged (the owner rejected its redesign in #28); it comes at the free board's end.
5. If the board could not be made, the visitor goes to `/welcome/plan` as before, and the home sends them there too (the plan marker is set to "pending" only then).

The old in-app welcome and the three-tip tour are skipped for anyone who came through `/start`.

**Entry points:**
- Every **Join Agathon** button on the landing pages goes to `/start`, keeping `?ref` and `utm_*`.
- **Sign in** stays `/login`.
- `/login?mode=signup` still works for old links.

## As built (`feat/start-flow-ui`, 2026-10-13)

**Files:**
- `src/app/(platform)/start/page.tsx`: the route. The first screen is in the server's HTML; its two cards' ink is written there.
- `src/components/start/StartFlow.tsx`: the flow on the client (history entries, keeping it on the device, the counts, the transitions). One component per screen in `src/components/start/screens/`. Shared pieces (the tutor's check, the board's hand, the ink set) in `parts.tsx`. Styles in `start.module.css`.
- `src/lib/start/flow.ts`: the screens in order, Back, the progress bar, resume, the answers' reducers, and every word for the grown-up and the kid.
- `src/lib/start/plan.ts`: what can be picked (a grade's path; six topics for each high-school course, `COURSE_FOCUS`), the plan's skills and their words. `finish.ts` uses the same `planSkills`.
- `GET /api/start/ink` (static, `src/lib/start/inkSet.ts`): each skill's example (`SKILL_EXAMPLES`, picked by hand to match its line) and every try problem in the tutor's hand. About 28 KB gzip, fetched after the first answer, so the browser never loads the hand engine.

**How it behaves:**
- A tapped single answer gets the tutor's check (the board's own mark, `markStrokes`) and the next screen follows after 460 ms. "What's tricky" takes up to three, each card with its example in the tutor's hand; "Not sure yet" moves on at once.
- Each screen is a history entry, so a phone's back swipe goes back a question. The beat ("Making Sam's plan…") is replaced by the plan, never kept.
- The flow is kept on the device for a week (`START_STORAGE_KEY`, the `flow` field beside the journey id) and reopens where it was (the beat and the account reopen on the plan).
- A grown-up's link (`#a=`) opens on the plan ("Maya made a math plan"), worded for the grown-up, with no Back; the account screen opens on the form (`StartAccount startIn="form"`). The answers leave the address bar.
- The try screen is the real try board (`TryBoard join={false} onProgress`), with the band for the grade and the starter for the plan's first skill at the kid's grade. "Maybe later" stays quiet until the tutor has checked a line; then it is a blue Continue, and the plan shows "Solved one already".
- A signed-in visitor goes home (a grown-up's link stays).
- Proof (parent only) shows the landing page's real Progress picture, captioned as a 3rd grader's.

**Look:** warm paper (#fbfaf6) with the board's dot grid, Geist titles, white cards with hairlines, the landing page's blue pill for the one button, the tutor's blue (#4465e9) for checks, the progress bar and chosen answers. No gradients, emoji, mascot or claims.

## Measuring it

- **Before the account:** the steps are counted anonymously by journey (`START_EVENTS`, `POST /api/start/step`, `recordStartStep` in `src/lib/start/record.ts`), one row per journey and step in `start_steps` (`20261013020000_start_steps.sql`). No IP, no name; of the answers only the role, the grade or course, how many skills and whether the try was solved.
- **Linking:** once the account exists, `linkStartJourney(userId)` ties the journey to it and records `start_account` (`link_start_journey`, as the new account; never a journey already linked to someone else). Call it before the flow forgets the journey id.
- **Admin Funnel:** it gains a **Before the account** section above "From sign-up to paying", for the same cohorts: started → chose who → picked a grade → saw the try board → the tutor checked a line → saw the plan → saw the account screen → made the account. A later step stands for the earlier ones, except the checked line (the try can be skipped): it is a part of the try board, and the plan counts from the try board. A journey opened from a grown-up's link is counted in the line under the bars (kids who sent their plan, links opened, accounts made from them), not in the bars.

## Look

- **Warmer than the app today**, per the owner and the owner's Figma.
- **Within the house rules (docs/LANDING-V3.md):**
  - No decorative gradients, glows, sparkle/AI icons or emoji.
  - No testimonials, user counts or outcome claims.
  - Real product pictures and the two pens (the kid's black marker, the tutor's blue).
  - US English.
  - Prices and trial length only from `UNLIMITED_PLAN`.
- **Mobile first.** A kid of 5 to 10 should be able to read every screen and hit every button.

## Contract

`src/lib/start/contracts.ts`.

## The free board (owner, 2026-10-13: "create a account after onboarding and get 1 free board so they try it then subscribe")

**What a new account gets:** one free board, with no card.
- It is the board `/start` makes at the end: Sam's first skill.
- It ends at whichever comes first:
  - **5 problems done** on it;
  - **the starter ink runs out.** That is the 100 ink every new account gets (`ink_starter_amount()`), and the AI routes already enforce it on the server, so the cost is bounded whatever the page does.

**When it ends:** at the moment of the win, a calm sheet says "Nice work, Sam finished 5 problems. Start your free trial to keep going". Its one button goes to `/welcome/plan`. The plan screen is unchanged: the trial with a card, then the monthly price, all from `UNLIMITED_PLAN`.

**The paywall (`planGate`) for an account with no plan:**
- **The free board** stays open while it is not used up.
- **Any other board, or a new one,** goes to `/welcome/plan`.
- **Home** shows the free board (with its progress, for example "2 of 5") and a **Start your free trial** button. It does not bounce the account to the plan screen while the free board has problems left. Once the board is used up, the home goes to the plan screen as today.
- **Progress** is gated as today.
- **What counts as the free board:** the account's oldest live board. Problems done on it come from its learning attempts, and "used up" also reads the ink summary every page already loads (balance 0).

**Old accounts:** accounts from before this, and the old `/login?mode=signup` path, get the same rule. Their first board is the guided board, and the guided-tour exemption stays as it is.

**As built (`feat/free-board`):**
- **The rule:** `src/lib/billing/freeBoard.ts` (pure). It only narrows `planGate`'s `locked`, so a plan, an admin, no checkout link, just back from checkout and an unread plan stay as they were.
- **A problem done:** a learning attempt on the free board whose outcome left `in_progress` for anything but `unfinished` (`first_try`, `self_corrected`, `with_help`, `tutor_solved`), any origin but the chat's worked examples (`teach`). Each problem counts once (by its LaTeX), and each attempt once.
- **The ink:** the balance at 0, or a Live 402 on the free board.
- **The pages:** `useFreeBoard` (`src/components/billing`). The home shows `FreeBoardBanner` and holds new boards (`src/lib/billing/newBoards.ts`: New Board, topics, Today's practice, Practice more and Ask go to the plan screen). With no board yet, the first one made is the free one.
- **The moment:** the board shows `FreeBoardSheet` (lazy). Under it the tutor finishes its pen and rests; from then on Help me, Ask and New topic go to the plan screen.
- **Remembered:** the device keeps the end (`agathon.freeBoard.end.<userId>`), and `free_board_done` is recorded once (`20261013030000_free_board_step.sql`).
