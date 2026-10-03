# Release QA — ink and board (2026-10-03)

Scope: the last pass before `release/ink-and-board` goes to paying students and parents. Part 1 was
four small fixes (sign-up consent, the /login footer, bug reports after account deletion, the
recognize route's "invalid request body"); part 2 drove the whole release end to end as brand-new
students, at desktop 1440×900 and as an iPad, and fixed what it found. A late request added 16 px
text fields on touch screens.

Environment: branch `fix/release-polish` from `release/ink-and-board` ce2b2f7, with
`release/ink-and-board` ea6d0fb (sync follow-ups, WebKit/iPad) merged in mid-pass (3ccb100), so the
second half and every number below are the integrated release. `next dev --webpack -p 3003` with
billing enforced, `STRIPE_WEBHOOK_SECRET=whsec_local_release_qa`, fake pack links
(`https://buy.stripe.com/test_<pack>`), `STRIPE_LIVEMODE=false`; the shared local Supabase stack;
real AI routes (Mathpix, OpenRouter). Headless Chromium through Playwright: desktop 1440×900 with a
mouse, `iPad Pro 11 landscape` with pen strokes (CDP `pointerType: pen`, varying pressure), `iPhone 13`
and `iPad Pro 11` for layouts. Ink was moved with `grant_ink` (the ledger), never by editing the
balance; purchases and refunds were signed `checkout.session.completed` / `charge.refunded` events
shaped like a Payment Link session. Scripts: the session scratchpad, `release/j1…j6-*.mjs`,
`s01…s05-*.mjs`. The machine's load average was 20–47 throughout (other agents, a film render):
the dev server's first compile of `/board/[id]` took 3.5–4 min, it restarted itself twice at its
memory threshold, and one recognize hit the client's 6 s timeout. Timings here are not product
timings.

## Findings

| # | Severity | What | Fixed |
| --- | --- | --- | --- |
| P1 | Required (legal) | Sign-up had no Terms / Privacy / age consent, and nothing recorded one | Yes (b45c3a6) |
| P2 | Polish | The legal footer sat one scroll below the fold on every platform page (/login: footer at 943 px on a 900 px window) | Yes (44cb14d) |
| P3 | Privacy | Deleting an account kept its bug reports: email, message, board screenshot, logs | Yes (795ca96) |
| P4 | Low (ops noise) | `/api/live/recognize` logged "invalid request body" for valid strokes | Logging fixed (2130722); not a client bug |
| F1 | Medium (money / broken flow) | After buying ink, the line written while out of ink stayed unread, and a refused Solve or Help never ran | Yes (2740e68) |
| F2 | Medium (confusing, stuck) | After a dropped connection the pill said "Offline" for good, while every line was read | Yes (a583158) |
| F3 | Low (copy) | A hand correction that takes ink away showed as "Added by us −281" on /account | Yes (9995bce) |
| F4 | Medium (iPhone) | Platform text fields are 14 px, so iPhone Safari zooms in on focus (coordinator request, from the WebKit pass) | Yes (4e0a8f2) |
| N1 | Low (copy) | Ask refused for ink with 2 left: the panel says "Get more ink — You have 2 ink left", not that the request needs 3 (only the footer says "Each request uses 3 ink") | No |
| N2 | Polish | Out of ink, the board bar says "Get ink" twice (the truncated red pill and the meter) | No |
| N3 | Polish (iPad) | iPad landscape with Ask open: the bar wraps "Report a bug" to a second row at the left | No (board-feel / WebKit lane) |
| N4 | Info | The two-step journey never calls `/api/live/check` (3 ink) or a server solve 402: the engine checks and solves those lines locally, for free | Checked directly |
| N5 | Env | Storage uploads fail on the shared stack (42P10, reliability N7): the storage half of one DB test fails locally | No (environment) |
| N6 | Ops | Migration order on the shared stack; the consent trigger and other branches' scripts | Resolved, notes below |

### P1 — Sign-up consent (required) — added

Sign-up (not sign-in) has one required box: "I agree to the Terms and Privacy Policy. I'm 13 or
older, or I'm a parent or guardian setting this up for my child." The links open a new tab so the
form keeps what was typed. An unticked submit says "Tick the box to agree before you create your
account." under the box and focuses it. The reliability fixes are intact (the form posts; submit is
disabled until hydration). Screenshots: `release-signup-consent-desktop.png`,
`release-signup-consent-phone.png`.

Stored on the profile (`20261003010000_signup_consent.sql`): `terms_version` (`TERMS_VERSION` in
`src/lib/legal.ts`, `2026-10-03`) and `accepted_terms_at` (the account's `created_at`). Existing
accounts keep nulls and are never asked.

Why this way. The form sends the version in the sign-up request's user metadata, which GoTrue
writes in the same INSERT that creates the account; a `BEFORE INSERT` trigger on `auth.users`
refuses an account without a well-formed version, and `handle_new_user()` copies it to the profile.
So a client that ignores the box (an old cached page, a direct `POST /auth/v1/signup`) gets no
account at all, and every account made from now on has the record. The alternative, a second call
"right after sign-up", can be skipped or fail, and there is no session to make it with when email
confirmation is on. The cost: a trigger cannot tell GoTrue's admin API from a public sign-up (the
INSERT rows are identical; probed), so service-role accounts need the version too. The scripts
send it (`scripts/lib/supabaseHttp.mjs`), and the dashboard's *Add user* is refused
(RUNBOOK-supabase 13.3 has the admin API call). A refused sign-up reads "We couldn't create your
account. Reload this page and try again."; the local GoTrue passes the trigger's message through,
other versions say "Database error saving new user", and both map to it.

Verified: through the UI at desktop, iPad and phone (profile `2026-10-03`, 300 ink); against GoTrue:
no metadata, a non-date version, a number, and the admin API without metadata all refused with no
user created; a user cannot PATCH their acceptance (403). Tests: `loginForm.test.ts`,
`loginErrorMessage.test.ts`, `authForms.test.tsx`, a `verify-rls` check (`consent: …`), and two DB
tests in `db-billing.integration.test.ts`.

### P2 — The footer one scroll down — fixed

Every platform page took a full window height of its own (`min-height: 100dvh`) and the layout put
the footer after it. The platform layout is now a flex column of the window's height and each page
grows into it: a short page shows the footer at the bottom of the window, a long one (and /login on
a phone) puts it under the content. /login's picture stack is sized for the footer, with tighter
paddings on a short laptop. Measured: footer bottom at the window's bottom at 1440×900, 1280×720 and
iPad Pro 11 both ways; under the form on an iPhone 13; no horizontal overflow on any legal page at
phone, iPad or desktop width.

### P3 — Bug reports after account deletion — fixed

`bug_reports.user_id` was `ON DELETE SET NULL`. Now `ON DELETE CASCADE`
(`20261003010100_bug_reports_leave_with_account.sql`), and reports already orphaned by a deleted
account (user id null, an email still on them) are deleted by the migration. The privacy draft now
says reports go with the account. Verified in the browser: a report sent from the header, then
Delete account: `auth`, `profiles`, `boards`, `ink_grants`, `usage_events` and `bug_reports` (by id
and by email) all 0, and signing in again says the credentials don't match. DB test without
Storage, so it runs on the shared stack.

Still kept after deletion, by design and covered by the privacy draft ("Purchase records"):
`billing_events` payloads and `ink_checkout_reviews` rows (a refund may still be owed) carry the
payer's email.

### P4 — "invalid request body" from /api/live/recognize — not a client bug

Reproduced with the reliability smoke's zig-zags: the first request logged "invalid request body"
while the dev server was compiling the route. Replayed whole, the same body answers 200 ("WW WW WW
WW WW"); replayed cut short and aborted, it logs exactly that line. The client's 6 s recognize
timeout had aborted the request before the server read its body. A real client does the same on a
cold or slow server, or when a newer request for the same line replaces one in flight: harmless
(nothing is charged; the client already shows its timeout and Retry), but the warning pointed at a
schema bug that does not exist. The schema itself was checked against what the client can send: a
seeded fuzz test (dense 4,000-point strokes, 80 strokes, a 1 px tall line, a dot, a 12,000 px
scribble far from the origin) either passes it or is not sent ("Too much ink for one line").
`parseJsonBody` now reports `unreadable` / `malformed` / `invalid` (with issue paths), and an
abandoned request is logged at info.

### F1 — Ink bought, but the refused line is never read — fixed

Repro (`j2-ink.mjs`, `j2b-inkback.mjs`): at 0 ink, write a line: 402, the out-of-ink dialog and the
red pill. Buy (webhook): the meter reads 5,000 on focus and the dialog says "Ink added", but the
line written at 0 stays without an echo or a mark until it is written out again; a refused Solve
or Help does not run either. The board only dropped the error. Now, when the meter sees a balance
that covers the refused call, it runs the loop's retry for it once (the same path as Retry).
Verified: 402, webhook, focus, then one recognize (1 ink) and the line's echo.

### F2 — "Offline" for good after a dropped connection — fixed

Repro (`j3-errors.mjs`): a recognize fails with a connection reset while the browser says online.
The loop queues the line and sets the status to "offline" (by design: `navigator.onLine` can lag),
but only an `online` event cleared it, and none comes. The pill said "Offline" while every later
line was read and checked. A successful read, check or solve now ends a leftover "offline" and
replays what it queued or deferred, as a reconnect does. New test `(f''')` in
`liveLoop.offline.test.ts` (fails without the change). Verified: reset → "Couldn't reach the tutor
service · Retry"; network back → the line is read and the pill says Live.

### F3 — "Added by us −281" — fixed

Hand grants were summed under "Added by us" whatever their sign; a negative correction (a lost
chargeback, RUNBOOK-billing 5) now reads "Adjusted by us".

### F4 — iPhone zooms in on the platform's text fields — fixed

Under `(pointer: coarse)` every text field on a platform page is `max(16px, 1em)`; a mouse keeps
14 px. Measured with iPhone 13 and iPad Pro 11 emulation (16 px) and at 1440×900 (14 px): /login
both tabs, /reset-password, the boards search, the bug report box, /account's display name and the
delete confirmation. Not checked on a real iPhone.

### N1–N3 — not changed

- N1: the Ask panel's 402 at 2 ink reads as a sales prompt rather than "this needs 3 ink". The
  footer states the price; a sentence would fix it.
- N2: when empty, "Get ink" shows in the pill and in the meter; the pill's message is truncated
  at 1440 px ("You're out of ink. Grab an ink pack to keep …").
- N3: `release-ipad-ask.png` (the dev-only Mathpix badge overlaps it there; production has no
  badge).

### N6 — Migrations and scripts on the shared stack

This branch's migrations were applied first, so `supabase migration up` refused the sync
follow-ups' older `20261003000000_snapshot_retention.sql` in its worktree; that pass applied it by
psql without recording it. After merging, `npx supabase migration up --local --include-all`
recorded it (idempotent). Production: `db push --include-all` applies all three in order. The
consent trigger also refused accounts that other branches' scripts made without the version until
those branches had this `supabaseHttp.mjs`; after the merge they do.

## The journey

Desktop 1440×900, mouse (`qa-release-desk-…`):

| Step | Ink | Result |
| --- | --- | --- |
| Sign up with consent | 300 | Header meter "300 ink"; welcome with the footer in view |
| Welcome → Algebra 1 → Start | 300 | Guided first board, the starter problem written by the tutor (free), tip 1 of 3, pen in hand |
| Boards home → New board, `2x+3=11` | 299 | recognize 1 |
| `2x=8` | 298 | recognize 1, tick |
| `x=5` (wrong) | 297 | recognize 1, ring |
| Suggest | 297 | "x = 4" written beside the ring by the engine (free) |
| Solve → Solve steps | 287 | solve 10; "x = 8/2", "x = 4" under the work |
| Ask "Give me 2 two-step equations" | 284 | chat 3; two problems on a new screen |
| New screen, sign out (user menu), sign in, reopen | 284 | 3 screens, 41 / 24 / 0 shapes before and after |

iPad Pro 11 landscape, pen with pressure (`qa-release-ipad-…`): the same sign-up and first board;
three lines 300 → 297 with the tick and the ring; Help in Feedback on the wrong line answered by
the engine (free); Ask 3 → 294; second screen; sign out and in, 33 / 25 / 0 shapes kept. Then a bug
report and Delete account (P3).

Ink lifecycle (desktop student): 60 → amber meter "60 ink Get ink" and the Get more ink dialog;
`/api/live/check` as the user → 3 ink (57), the meter on focus; 0 → the next line 402s → "You're
out of ink" dialog (`release-out-of-ink-dialog.png`) and the red pill; Medium's buy opens a new tab
at `https://buy.stripe.com/test_medium?client_reference_id=<user id>&prefilled_email=<email>`;
`checkout.session.completed` (payment, paid, 2000 USD cents, `app=agathon-classroom`,
`pack_id=medium`) → 200, 5,000 ink, one purchase; the redelivery → `duplicate: true`; back on the
board tab the meter reads 5,000 without a reload, the pill is gone, the dialog says "Ink added"
(`release-ink-added-on-board.png`); `/account?ink=medium` says "Ink added — 5,000 ink is yours";
`charge.refunded` (full) → 200, balance 0, history "Medium pack · Refunded · 5,000 ink taken back"
(`release-account-refunded.png`); a Fuime checkout and refund → `200 ignored`, `billing_events`
count unchanged, no row mentioning Fuime. Account page: balance card, packs grid, purchases, usage
by kind and by day (19 ink: solve 10, reads 3, chat 3, check 3), profile, danger zone.

Errors (`j3-errors.mjs`): offline mid-Live → "Offline — 1 line waiting", back online → read;
connection reset → "Couldn't reach the tutor service · Retry · Dismiss", then read once the network
works (F2); recognize 500 → "The tutor service had a hiccup · Retry" → Retry reads it; Ask 500 →
"Something went wrong. Try again. · Retry"; a real Ask 402 (2 ink) → the packs inline (N1); a thrown
error and an unhandled rejection on the board → `POST /api/client-errors` 204 and a server line
`module: "client-error"` with the user id, board id and release.

Console and server log: no React warnings and no unexpected errors. Browser: only the expected
402 / 500 / reset lines from the cases above and the dev server's font-preload notices. Server:
the deliberate 402s ("out of ink"), the unsigned warm-up POSTs to the webhook ("bad webhook
signature"), the pre-fix "invalid request body" lines (P4), and the dev-only workspace-root notice.

## Verification (the integrated branch, after merging ea6d0fb)

- `npm run typecheck`: clean. `npm run lint`: 0 errors (4 old `<img>` warnings).
- `npx vitest run --maxWorkers=4`: 235 files passed, 8 skipped; 4,972 tests passed, 66 skipped.
- `RUN_DB_TESTS=1` (`db-billing`, `db-rls`, `db-history`, `billing.integration`,
  `refunds.integration`): 56 passed, 2 failed, both Storage only (42P10 on the shared stack, N5):
  `db-rls` "storage bucket policies" and `db-billing` "delete_own_account … storage rows". The new
  consent and bug-report tests pass.
- `node scripts/verify-rls.mjs`: 213/217; the 4 failures are Storage only (`storage: A uploads into
  board-assets/<A>/...`, `… publicly readable`, `B cannot delete A's …`, `A deletes own …`). The
  three new `consent:` checks pass.
- `npx next build`: exit 0. `npm run bundle:check`: all budgets ok; `/board/[id]` first-load JS
  **1,057,270 B gzip** (2,730 B under the 1,060,000 budget; CSS 48,694 B), `/login` 304,163 B,
  `/` 386,800 B. `.next` deleted afterwards.

## Not tested

- A real Stripe checkout (the links are fakes) and real Stripe event deliveries; Small and Large
  webhooks end to end (Medium in the browser, Small in `j2b`); partial refunds (DB tests cover them).
- Safari / WebKit and real iPads or iPhones: Chromium emulation only (the WebKit pass covered
  Safari).
- Production build in the browser: the build was measured (bundle), the journeys ran on `next dev`.
- Lecture mode, image and PDF upload (Storage is broken on the shared stack), email confirmation
  and password-reset emails (local auth autoconfirms), two tabs, the phone board layout, onboarding's
  Skip.
