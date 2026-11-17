# Overnight QA report — branch `overnight-qa`

Started from `feat/landing-v4` @ a1e1f3ec.

## Items 1–2 (npm ci, typecheck)
These were already marked done in ~/TASKS.md before this run, but there was no report and no commit.
On 2026-11-17 I re-ran `npm run typecheck` and it passed with no errors. No install problems were recorded.

> Branch note: local `overnight-qa` tracks `origin/feat/landing-v4`. Push with an explicit refspec
> (`git push origin overnight-qa:overnight-qa`) so nothing lands on feat/landing-v4.

## Item 3 — `npm run lint`
Before: 0 errors and 4 warnings, all `@next/next/no-img-element`.

- `src/components/board/ModeInfoDialog.tsx:30,42,54`: three static 1222×876 PNGs from `/public/modes`.
  These now use `next/image` with intrinsic width/height and `sizes` (about 268px wide at `h-48`), as the
  landing and ProductPictures components already do. They still render at h-48/w-auto.
- `src/components/PdfUpload.tsx:370`: the page thumbnail is a canvas `data:` URL (`src/lib/pdf.ts:64`), which
  `next/image` cannot optimize. I kept `<img>` and added a scoped `eslint-disable-next-line` with the reason.

After: lint has 0 errors and 0 warnings, and typecheck still passes.

**Push status:** `git push origin overnight-qa:overnight-qa` was refused with HTTP 403 ("Permission to MntRushmore/whiteboardstaging.git denied").
The configured credential cannot write to the repo, so every QA commit is **local only** on `overnight-qa` until someone with
write access pushes it. I did not try any other credential or remote.

## Item 4 — `npm test`
Before: 1 failure out of 10,363 tests (513 files run, 14 skipped). It failed every time, alone or in the full suite.

- `src/lib/server/__tests__/routes.transcribe.test.ts:364`, "a Scribe that never answers is a timeout, not a hang", timed out at 5s.
  **Cause: a race in the test, not a bug in the route.** The test called `vi.advanceTimersByTimeAsync(20_010)` straight after starting the
  request. The route (`src/app/api/live/transcribe/route.ts:173-174`) only arms its 20s `setTimeout` after several awaits: multipart
  parsing, auth, entitlement, and the user and global budget spends. The fake clock had already been advanced by then, so the
  timer never fired and the hung fetch mock never rejected. **Fix:** `await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())`
  before advancing. The timer is armed right before `fetch`, so it is now armed in time. The assertions (502, `code: "timeout"`) are unchanged.
  I confirmed the route's timeout logic works: the test passes once the clock moves after the timer is armed.

After: 513 test files passed, 14 skipped; 10,258 tests passed, 105 skipped, 0 failed. The skipped ones are env-gated (DB, live evals).

## Item 5 — `npm run build`
Command: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key NEXT_TELEMETRY_DISABLED=1 npm run build`
(the URL is a local placeholder so nothing can reach a real backend). The build **passed** with no errors on Next 16.2.4 (Turbopack),
covering 27 static pages and all API routes as dynamic. I made no changes.

- One warning: `metadataBase property ... not set ... using "http://localhost:3000"`, printed while static pages were generated.
  **Checked and harmless:** the built `.next/server/app/parents.html` has `og:image`, `twitter:image` and canonical all at
  `https://agathon.app/...`, because `src/app/(platform)/parents/page.tsx:42` sets `metadataBase`. No built HTML contains `localhost:3000`.
  To silence it, the same `metadataBase` could go in the root `src/app/layout.tsx`. I left that alone because it would also make
  relative metadata URLs absolute on every other page. That's for the owner to decide, not a bug.

## Item 6 — offline evals (`eval:offline`, `eval:drawings`, `eval:proofs`)
I ran them with `OPENROUTER_API_KEY` blank (they make no network calls). All three pass their own thresholds.

- **eval:offline**: passes, and `docs/eval/offline.*` matches the committed result exactly.
- **eval:proofs**: passes. The only diff is the `ms` timing column in `docs/eval/proofs.md`, which is run-to-run noise. I didn't commit it.
- **eval:drawings**: passes, but it is **deterministic and had drifted** from `docs/eval/drawings.json` (last written 2026-09-28, ed5af771):
  - "after" maths-intact fell from 2847 to **2846**. **I bisected it (between ed5af771 and HEAD, over the files the eval uses) to 571a86ce**,
    "feat(live): a stacked sum is one block on the board, never a fraction". That commit message says the drawings scoreboard was "unchanged".
    **Bug** (`src/lib/live/stackedSums.ts`, `stackAt`): the new scene failure is `arrow/below, close/x1/clean/2x + 3 > 11`. The arrowhead stroke crosses the shaft
    with its centre 0.24 px *above* the shaft's centre, so it counted as a "row over the rule". With the inequality above it, that gave the two rows
    a sum needs, and the inequality plus the arrow became a stacked-sum block. In the app, that line goes to column arithmetic, which "stays quiet on any read
    that does not parse": **a student's inequality with an arrow drawn under it would never be checked.** The "nothing tall through the rule"
    guard only caught strokes at least 1.5 digit-heights tall.
    **Fix:** a stroke that crosses the rule by at least 0.3 digit-heights past *both* its edges also means it is no sum's rule. Digits rest on a rule
    and don't go through it. **Tests:** `src/lib/live/__tests__/stackedSums.test.ts`, "a drawing under a line is no sum". It failed before the fix and passes after,
    and a guard test checks a real sum still forms. All stacked-sum unit and loop tests still pass, and drawings is back to **2847 / 2880**.
  - The "before" column (raw `clusterLines` with no drawing split: 1770 → 1750 maths-intact) and the corpus line count (3724 → 3768) moved because of
    deliberate later changes to `strokeClusters.ts` (young-child handwriting, wobbly `=`) and 11 new corpus lines. That is expected, not a regression.
    I committed the regenerated `docs/eval/drawings.{json,md}` so the scoreboard is current again.

After: typecheck and lint are clean, and `npm test` gives 513 files passed and 14 skipped; 10,260 tests passed, 105 skipped, 0 failed.

## Item 7 — `bundle:check` and `dead-code`
**bundle:check** (after a fresh placeholder-env build): **all budgets OK.** `/board/[id]` first-load JS is 3.37 MB raw / **1.03 MB gzip, against a 1.05 MB budget,
so only about 20 KB gzip of headroom is left.** The next feature on the board page will probably break the budget. It is the only route with a budget.
`/train` is 834 KB gzip and every other page is 360–390 KB gzip. The largest chunk is 1.51 MB raw / 462 KB gzip (board + train).
The script flags one "likely duplicated" 58.7 KB chunk emitted 7 times under different route graphs. That's worth a look with `BUNDLE_SOURCEMAPS=1`.

**dead-code**: before, it **failed (exit 1)** on 2 "unused files":
- `src/lib/motion-tokens.ts` and `src/registry/components/card/card.tsx`. **Both are documented as kept on purpose** (`docs/ARCHITECTURE.md:106`):
  the first is Arc's documented import path, re-exporting `src/registry/motion-tokens.ts` for components `scripts/arc-add.mjs` installs, and
  "card (not used: ...)" is installed deliberately. I did not delete them. I added them to the script's existing `KEEP_FILES` allowlist
  (`scripts/find-dead-code.mjs:70`) with those reasons. `dead-code` now exits 0, and `src/__tests__/deadCode.test.ts` (39 tests) passes.
- Warnings, unchanged: 9 test-only files (notably `src/lib/billing/{links,purchases,usage}.ts` and `src/hooks/useApiErrorHandler.ts`.
  **Billing modules that only tests import are worth checking against what checkout really uses**), 1,311 unused exports, and 1,128 test-only exports.
- 60 exports are dead symbols (0 local uses). Most are API surface I'd keep: shadcn/Arc UI primitives (`DialogClose`, `DropdownMenu*`, `TabsContent`),
  vendored `src/registry/**` default exports, and tldraw migration `graphShapeVersions`/`mathShapeVersions`. **Left for the owner, not deleted:** these
  appear nowhere in src/scripts/docs/supabase except their own definition: `aiConfig.getSiteUrl`, `useIsAdmin.resetIsAdminCache`,
  `micEngines.resetMicRoute`, `dailyMarker.clearDailyMarker`, `progress.clearDailyNote`, `blanks.hasBlank`/`withoutBlanks`, `classify.isIncomplete`,
  `constants.findConstant`, `learning/contracts.MISTAKE_DEFS`. They are tree-shaken, so deleting them saves no bundle bytes. Some look like deliberate
  seams (reset/clear), so removing them unattended wasn't worth the risk.

## Item 8: coverage of the core flows (whiteboard, tutoring chat, auth, billing)
**Method:** I mapped every API route and every `src/lib`/`src/hooks` module to the tests that import it. Coverage was already broad: 595 test files,
and every route except one has a route-level test. So I aimed at the specific edges with no direct test, not at line counts.
**No source bugs found in this item.** All new tests passed against the existing code, except where my own test assumed the wrong thing (notes below).

**Added (69 tests, all passing):**
- **Tutoring chat:** `src/lib/server/__tests__/chatGate.test.ts` (16). This is new and covers `chatGate` (466 lines, shared by `/api/live/chat` and `/api/live/ask`),
  which until now was only reached through the two routes. The tests cover:
  - nothing proposed (no refund)
  - nothing readable (`null`, arrays, strings, unknown types): one refund, a generic line
  - an unreadable board block counted as proposed, then refunded
  - `refundWhen` declining the refund
  - a refund the database doesn't make, which is not reported as made
  - a 200-action reply: only `CHAT_LIMITS.actions` kept, the rest dropped as "too many", the charge kept
  - unicode maths passing untouched
  - `\text{…}` in any script dropping the whole action
  - **a repair skipped when the deadline is near or already past**, with the `budget` route event
  - a repair failing on the network, or returning junk, dropping the figure without crashing
  - the repair using the route's models, title and deadline
  - a `new_screen` kept when asked for alone but dropped when it was only for a failed figure
  - `help_problem` for a missing number
  - 5 concurrent gates keeping their own repair budget and refund
- **Auth:** `src/lib/server/__tests__/auth.test.ts` (26). This is new; before it only the Auth-outage path had tests. It covers:
  - the `Bearer` scheme in any case and with extra spaces
  - 13 malformed headers refused with a 401 **before any network call**: none, empty, Basic, no scheme, 2 or 4 segments, an empty segment, two tokens, non-base64url, Latin-1, quotes and SQL
  - a 150 KB token, a user-less success, and a user without an email
  - 20 concurrent mixed good and bad tokens, each judged on its own
  - a missing Supabase URL giving **500, not a 401 that blames the student**
  - `identifyUser`: `null` when Auth throws, `null` at exactly 3 s when Auth hangs, and no timer left behind
- **Admin auth:** `GET /api/admin/boards/[id]/ask` was the **only API route with no test.** I added it to the console's per-route table in
  `routes.adminConsole.test.ts`, so it now gets the non-admin 404 with nothing read, the signed-out 401, the 503 without a key, and the 200 with a request id.
  I also added its own tests: the contract shape, no-store, and the `board.ask` audit row; 400 for bad or path-trick ids before any read; 404 for a missing board;
  503 with no chat leaving when the audit fails; and 429 past the shared console bucket (+8).
- **Billing:** `billingWebhook.test.ts` (+3):
  - The **1 MB body cap was untested**. A signed 1 MB+ body now gives 400 with nothing stored.
  - The signature is checked over the raw UTF-8 bytes. A payer's name with ë/李/🎉 verifies and grants, and the same JSON re-encoded with `\u` escapes is refused.
  - **5 simultaneous deliveries** of `completed` and `async_payment_succeeded` for one session all answer 200 and grant the pack once.
- **Whiteboard sync:** `src/lib/sync/__tests__/tabLock.test.ts` (8) and `deepEqual.test.ts` (8). Both modules are new to the tests.
  - `openTabIds` decides whose backups a board replays. The tests check that "can't tell" (no Web Locks, a query that throws or rejects, no `held`) is
    **`null` and never an empty set**, because an empty set would replay a live tab's work. They also cover the prefix filtering, 50 holders across 25 ids
    releasing independently, a double release, and a refused lock request that never becomes an unhandled rejection.
  - `deepEqual` (which drives what the merge writes) is tested on: key order, a JSON round-trip, one moved point deep in a stroke, an array vs an object with the same keys,
    inherited keys, unicode with no normalisation, and a 100k-point stroke.
  - The save queue (`saveQueue.test.ts`, 30 cases) already covers rapid edits, offline, timeouts, conflicts and backoff, so I added nothing there.

**Observations (not changed):**
- `src/app/api/billing/webhook/route.ts:115-116`: the cap compares `rawBody.length` (UTF-16 code units) with `MAX_BODY_BYTES`, and only after
  `req.text()` has buffered the whole body. A multibyte body can be up to about 3× the cap in bytes before it is refused. The risk is low because Stripe's payloads are small,
  the route is rate limited per IP, and the platform caps request bodies, but the name says bytes. A `content-length` pre-check plus `new TextEncoder().encode(rawBody).length` would make it exact.
- `src/lib/sync/deepEqual.ts`: `{ a: undefined }` vs `{}` counts as different, so a record whose local copy keeps an `undefined` key that the server's JSON dropped
  is re-written. That costs a redundant write and loses no data.
- A non-Latin-1 character in an `Authorization` header is refused by the runtime's `Headers` before any route code runs. This is expected and noted only so nobody writes a test for it.

After item 8: typecheck is clean, the new files lint clean, and `npm test` gives 10,329 passed and 105 skipped, 0 failed (10,260 before, plus 69).

**Push blocked (2026-11-17):** `git push origin overnight-qa` fails with **403 "Permission to MntRushmore/whiteboardstaging.git denied"**.
The token in the `origin` URL can read (`ls-remote` works) but not write. `overnight-qa` has never reached the remote, so items 3–8 are 6 local commits on
`~/repo` (branch `overnight-qa`). They need a token with `contents: write` on this repo, then a plain `git push origin overnight-qa`.
Note also that the token is stored in plain text in the remote URL in `.git/config`. A credential helper would be safer.
