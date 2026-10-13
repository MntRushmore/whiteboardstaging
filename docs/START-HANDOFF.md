# Handoff: the try board, the new onboarding (/start) and the free board (2026-10-13)

The owner asked for this work to be handed to another session. Everything below was true at handoff time.

## Where the work is

- **Worktree:** `~/whiteboardstaging/try-board`, branch `feat/try-board` (HEAD `861cfe6` plus this file).
  - The main checkout `~/whiteboardstaging/whiteboardstaging` belongs to another session doing landing-v3 work. Don't use it.
- **Pushed:** nothing. **Merged to main:** nothing. **On prod:** nothing.
- **Migrations:** none applied to prod. Applied locally only: `20261013000000_try_board_step`, `20261013020000_start_steps`, and the free-board agent's `20261013030000_free_board_step` if it ran.
- **Specs** (read these first):
  - `docs/TRY-BOARD.md` and `docs/START-FLOW.md`. The free board is a section in START-FLOW.
  - Contracts: `src/lib/try/contracts.ts` and `src/lib/start/contracts.ts`.

## Done and merged into feat/try-board

| Piece | Branch, commit | What it does |
|---|---|---|
| Try board contract + problems | `f75cc21`, `a91f168` | `/try` problems by grade band. The `try_board` funnel step, plus its migration. |
| Try board server | `feat/try-server` `1f475fe` | `POST /api/try/check`: a Mathpix read, then the board's engine judges the line (`judgeColumn`).<br>`POST /api/try/help`: the next step, drawn in the tutor's hand.<br>Same-origin only. Limits: 40 reads an hour per visitor, and a cap of 3,000 reads a day (`global_budget_spend`, which exists on prod).<br>Status codes: a failed read returns **503** `upstream_error`, not 502, because Cloudflare eats 502 bodies. |
| /start contract | `7a13ec4` | Steps: who → name → grade → focus → proof (parent only) → try → building → plan → account. |
| /start account | `feat/start-account` `db3f9f3` | `StartAccount` signs up using LoginForm's own rules. `finishStart` saves the grade and source, sets the kid's name as `display_name`, and makes the first practice board on the plan's first skill. It also skips the old welcome and tour, then sends the user to `/welcome/plan`.<br>Kid alone: "Send it to my grown-up" link (answers in the `#a=` fragment, fixed in `d2eb411`).<br>A sign-in after the flow still finishes it (`StartResume` in `app/layout.tsx`). **Every Join Agathon button now goes to `/start`.** |
| /start step counting | `feat/start-measure` `2e42b72` | `start_steps` table, `POST /api/start/step`, `link_start_journey()`, admin_funnel v3.<br>Admin Funnel gets a **Before the account** section. 26 RLS checks pass locally. |

## In flight when handed off

These are background agents of session whiteboardstaging-fe. Their final reports will be forwarded to whoever takes this over.

- **Try board page** (`feat/try-page`, base `a91f168`):
  - `/try` page and `TryBoard` component: writing pad, the tutor's marks, help ink, Join card, OG image, a Hero link and a `/try` bundle budget.
  - It was told the server facts above: key errors on the code, a 503 can mean `upstream_error`, `solves` on help, and help ink at size 40.
  - On merge: make its Join card use `src/components/landing/JoinLink.tsx` from start-account.
- **Free board** (`feat/free-board`, base `1e90cbc`):
  - The owner's choice: a no-plan account gets ONE free board, with no card, until 5 problems are done on it or the 100 starter ink runs out. Then a "Nice work" sheet sends them to the trial screen (`/welcome/plan`).
  - It adds `src/lib/billing/freeBoard.ts`, gates in planGate, a home banner, a lazy sheet on the board, the funnel step `free_board_done` and migration `20261013030000`.

## Not started: the /start screens (the main piece left)

- Branch `feat/start-flow` exists at `861cfe6`, with no commits. The agent was stopped at handoff.
- **To build:** `src/app/(platform)/start/page.tsx`, a client `StartFlow`, and one component per screen.
- **Two pure modules:**
  - `src/lib/start/flow.ts`: the state machine, resume, the grown-up link via `answersFromHash`, and the copy for both roles.
  - `src/lib/start/plan.ts`: the first 3 skills plus "Today's practice". Make `finish.ts` use the same choice of first skill.
- **The `try` step:** wrap the try board's `TryBoard` (once `feat/try-page` merges) with `onVerdict` and `onSkip`. Record `start_try_shown` and `start_try_checked`, and set `answers.tried`.
- **Events:** every screen records its `START_EVENTS` event (`recordStartStep`).
- **Look:**
  - The owner: "use the app UI but make sure it looks good" and "warmer". The bar is Aristotle's onboarding: one question per screen, warm paper and grid, a friendly speaker, big soft answer cards, a progress bar with Back and Skip, auto-advance, "building your plan", then "your plan is ready".
  - Reference screenshots: `~/whiteboardstaging/research/aristotle-onboarding-2026-10-13/` (37 screens + `00-contact-sheet.png`).
  - Don't copy their mascot, art or emoji.
  - House rules in `docs/LANDING-V3.md`: no gradients (the owner hates them), no emoji, no testimonials or claims, real product pictures, the two pens, US English, and the price only from `UNLIMITED_PLAN`.
- **The owner's Figma (the app UI):**
  - `https://www.figma.com/design/CxiAWgs2gy9BkSsPQSumn0/Agathon--Copy-?node-id=3-5&p=f&t=RCX8aNQEomZekoaT-0` opens **in a browser without signing in** (view only).
  - It has Components, Home Page (student + teacher), Documents, Whiteboards, My Classes and Whiteboard, plus phone versions. It has no onboarding frames. Its Cover is the new lowercase `agathon` wordmark (the "o" has a dot) on #042930.
  - The Figma MCP can't read it: no edit access, and the owner's Figma Pro plan expired.
  - Session fe captured it with Playwright: a visible Chrome driven over http://127.0.0.1:9333 by `scratchpad/smoke/driver.mjs` (endpoints `/goto`, `/shot`, `/els`, `/click`, `/mclick?x&y`, `/wheel`, `/press`). Playwright is installed in session fe's scratchpad `smoke/node_modules`.
- **QA:** screenshot every screen at 390×844 and 1440×900 (and 320 px for the choice screens), critique hard, then fix.

## Owner decisions and preferences from today

- "It's not really an onboarding drop-off: make the product more sticky so people start the trial." Also creative marketing.
- The account comes AFTER onboarding (like Aristotle). Then one free board (5 problems or 100 ink). Then the trial with a card, then $25/mo. The plan screen itself stays unchanged (the owner rejected its redesign in #28).
- No win-back email to free-period users for now.
- Wants Agathon "at Aristotle's level". Later: look at Aristotle's real platform. The owner is logged into Aristotle with an Alpha School account in their own browser.

## Shipping order, later

1. Prod backup (see `project-infra-facts` memory).
2. Migrations in order: `20261013000000`, `20261013020000`, `20261013030000`.
3. verify-rls on prod.
4. Merge.
5. Prod smoke test on /try and /start.
6. Go-live steps need the owner's OK.
