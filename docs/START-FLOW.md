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
| 9 | `account` | Save Sam's plan: email, password, terms, "How did you hear about Agathon?" (optional) | "Ask a grown-up to save it": "My grown-up is here" (the form, worded for the grown-up) or "Send it to my grown-up" (share / copy a link that reopens /start with the answers) |

**Every screen:**
- One question per screen.
- Back, Skip where it makes sense, and a progress bar.
- A tap on a single-choice answer moves on.

**After the account:**
1. The answers are saved: grade or course, heard from, and the kid's name as the profile's display name.
2. Onboarding is marked done.
3. The first board is made on the plan's first skill.
4. The visitor goes to `/welcome/plan`. The plan screen is unchanged (the owner rejected its redesign in #28).
5. Then the board.

The old in-app welcome and the three-tip tour are skipped for anyone who came through `/start`.

**Entry points:**
- Every **Join Agathon** button on the landing pages goes to `/start`, keeping `?ref` and `utm_*`.
- **Sign in** stays `/login`.
- `/login?mode=signup` still works for old links.

## Measuring it

- **Before the account:** the steps are counted anonymously by journey (`START_EVENTS`, `POST /api/start/step`). The journey is linked to the account when it is made.
- **Admin Funnel:** it gains a **Before the account** section: started → who → grade → tried → plan ready → account.

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
