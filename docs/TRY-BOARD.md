# Try it free (/try), 2026-10-13

**Owner's ask (2026-10-13):** "make the product more sticky so ppl want to start the trial", plus creative marketing. The owner picked the "Try it free" board as the first build.

## Why

The funnel steps (PR #41) and the prod data of 2026-10-12 show the problem:

- Most sign-ups reach the plan screen's card within about a minute.
- The ones who leave have almost never written a line or seen the tutor check one.
- The first night of tracking showed it again: an 8th grader tapped Next through all three tips, never wrote, saw the plan and left.

So the "aha" has to come before the card. It also has to be one link that every post, reply and ad can point at.

## What it is

- `/try`: a public page that works without an account. It is mobile first, because most links will open on phones.
- **The visitor's steps:**
  1. Pick a grade band: K–2nd, 3rd–5th, 6th–8th or High school (`TRY_BANDS`).
  2. The tutor's problem is already on the page in its blue hand.
  3. Write a line with a finger, pen or mouse.
  4. After a short pause the tutor checks it. A right line gets a check mark. A slip gets a circle and a nudge in words. Unreadable writing gets "write it a little bigger".
- **More lines:** they can write further lines down to the answer. "Show me a step" writes the next step in the tutor's hand.
- **Join card:** after the first checked line, a card says this is what Agathon does on every line, free for the trial, with **Join Agathon**. The join link keeps `?ref` and `utm_*`.
- **No account, nothing stored:** strokes go to the reader and are dropped.

## How it works

- **Contract:** `src/lib/try/contracts.ts`.
- **`POST /api/try/check`:**
  1. Looks the problem up by id and never trusts lines sent by the page.
  2. Reads the strokes with Mathpix (`recognizeStrokes`), with no vision fallback.
  3. Judges the line with the board's engine on the server: `analyzeColumn` + `badgeFor`, with a bare number under a sum read as its answer, as the board does.
  4. A read costs one Mathpix call. No model is called.
- **`POST /api/try/help`:** the next step from the engine's local solve (`localSolve` + `problemSteps`), drawn by the hand engine (`handInk`) and returned as SVG paths. It makes no read and calls no model.
- **Limits (`TRY_LIMITS`):**
  - Per visitor, by IP (`cf-connecting-ip` first, since www sits behind Cloudflare).
  - A global daily cap on reads (`TRY_DAILY_READS`, default 3,000).
  - `TRY_ENABLED=0` turns the page's checking off (503).
- **Measuring it:**
  - The device keeps a try marker (`agathon.try`).
  - Once the visitor has an account, the app records the funnel step `try_board` with meta `{ checked, solved }` (migration `20261013000000_try_board_step.sql`).
  - The admin Funnel shows how many tried the board first and how many of them started a trial.
- **Weight:** the page loads no tldraw, no engine and no hand engine in the browser. The marks are the tutor's real mark strokes (`markStrokes`), and the problem is server-rendered `HandMath`.
