# Overnight QA report — branch `overnight-qa`

Started from `feat/landing-v4` @ a1e1f3ec.

## Summary (item 12, 2026-11-17)

All 12 items are done. On the final code, **typecheck, lint, `npm test` (10,332 passed / 105 skipped / 0 failed), the placeholder-env build and `bundle:check` all pass.**
The run found and fixed 1 real logic bug, 3 security issues (2 critical-advisory dependency upgrades and 1 byte-cap bug), 1 flaky test, and 4 accessibility/UX bugs. It added 72 tests.
Nothing needing real secrets was run: DB tests, live evals, `smoke:live`.

> **⚠ The branch is NOT on GitHub.** Every `git push origin overnight-qa` this run failed with **HTTP 403** (*Permission to MntRushmore/whiteboardstaging.git denied*).
> The token in `origin` can read but not write. All the QA commits below are local only, in `~/repo` on `overnight-qa`, 10 commits ahead of `feat/landing-v4`.
> To publish: with a token that has `contents: write`, run `git push origin overnight-qa:overnight-qa` (explicit refspec, because the local branch tracks `origin/feat/landing-v4`).
> Nothing was pushed to `main` or `feat/landing-v4`, and nothing was force-pushed.

### Bugs found, and the fix for each
| # | Where | Bug | Fixed in |
|---|---|---|---|
| 1 | `src/lib/live/stackedSums.ts` (`stackAt`) | An arrow drawn under an inequality (head crossing the shaft) was read as a stacked sum, so **the student's inequality was never checked**. Introduced by 571a86ce. Found by the drift in `eval:drawings`. | 11b61c28 (+ regression test; drawings back to 2847/2880) |
| 2 | `package.json`: `next` 16.2.4 | Critical advisories: unauthenticated RCE (Image Optimization, `next/og`, `use cache`), plus a middleware bypass, SSRF and DoS | cf450226 (→ 16.4.6) |
| 3 | `package.json`: `pdfjs-dist` 5.7.284, used by `src/lib/pdf.ts` | GHSA-hq66-cqwq-w95j: arbitrary JS when a malicious PDF is opened | cf450226 (→ 6.5.438) |
| 4 | `src/app/api/billing/webhook/route.ts:115` | The "1 MB" cap counted UTF-16 units after buffering the whole body, so up to about 3× the cap was accepted | cf450226 (Content-Length pre-check + `Buffer.byteLength`; 3 tests, 2 of them fail on the old code) |
| 5 | `src/lib/server/__tests__/routes.transcribe.test.ts:364` | The test advanced the fake clock before the route armed its timer, so it failed 100% of runs (the route itself was fine) | cd7b7cc2 |
| 6 | `src/components/PdfUpload.tsx:290` | PDF drop zone was mouse-only (`div onClick`, hidden input), so **keyboard and screen-reader users could not import a worksheet** | 291bd915 |
| 7 | `src/registry/components/password-field/password-field.module.css` (also `search-field`) | The input was 20px tall in a 44px shell, so taps near the edge did not focus it | 291bd915 |
| 8 | `src/registry/components/{input,password-field,search-field}/*.module.css` | 14px fields made iOS Safari zoom the page on focus | 291bd915 (16px on `pointer: coarse` only) |
| 9 | `src/app/not-found.tsx`, `src/app/error.tsx` | No `<main>` and no `<h1>` (axe: landmark-one-main, page-has-heading-one, region) | 291bd915 |

Housekeeping, not bugs:
- 79fd5ec2: lint warnings to 0 (`next/image` for the mode pictures).
- f77d4627: `dead-code` exit 0 by allowlisting 2 files that ARCHITECTURE.md keeps on purpose.
- a48e469a: +69 edge-case tests on chat gate, auth, admin Ask, webhook, tab locks and deepEqual.
- 5e796fcc: build checked; the metadataBase warning is harmless.
- `docs/eval/drawings.*` regenerated.

### What remains (not changed, with reasons in the item sections)
- **Push the branch** (see the box above). Also, the GitHub token sits in plain text in `.git/config`'s remote URL. Move it to a credential helper.
- **`npm audit --omit=dev`:** `zod` <4.6.6 (memory exhaustion, direct; the fix is a major bump), `ai`/`@ai-sdk/*` (major), and non-major fixes for `markdown-it`/`linkify-it` (ReDoS), `prosemirror-view`, `@tiptap/core`, `tldraw`, `ws`, `sharp` and `postcss` via `npm audit fix`.
- **`eslint-config-next` is still 16.2.4.** At 16.4.6 its stricter `react-hooks` rules report 11 errors (`set-state-in-effect`/`refs`) in 10 components.
- **`parseJsonBody`** (`src/lib/server/request.ts:70`) has no body cap of its own and relies on the platform's 4.5 MB limit.
- **The pdf.js worker loads from unpkg** (`src/lib/pdf.ts:17`) with no SRI check.
- `requireUser` echoes the env-error message in its 500 (`src/lib/server/auth.ts:110-118`).
- `renderLatex` (`src/shapes/math/katex.ts`) sets no `maxSize`/`maxExpand`.
- `/board/[id]` is at 1.03 of 1.05 MB gzip (about 20 KB headroom). A 58.7 KB chunk is duplicated across 7 route graphs.
- Dead exports with 0 uses (item 7 list) and billing modules imported only by tests (`src/lib/billing/{links,purchases,usage}.ts`).
- `deepEqual` treats `{a: undefined}` and `{}` as different, which costs a redundant write and loses no data.
- **Not verified in a browser:** the pdfjs 6 upgrade on older iPads (iPadOS 16.4–18) and the PDF drop zone's keyboard path. Both need a signed-in board.

### Recommended next steps
1. Push `overnight-qa` with a write token, open the PR into `feat/landing-v4`, and let CI run `test:db`/`db:verify` and the live evals, which need secrets.
2. Before merging: on a real device, import a PDF on an older iPad (pdfjs 6) and sign in on an iPhone (no zoom on focus, password field taps).
3. Separate PRs: `npm audit fix` (non-major) with the full checks; `zod` 4.6.6+; `eslint-config-next` 16.4.6 with the 11 effect rewrites.
4. Small hardening: a shared byte cap in `parseJsonBody`, bundle the pdf.js worker, `maxSize`/`maxExpand` in `renderLatex`, and a generic 500 in `requireUser`.
5. Re-run the a11y pass (item 10's Playwright + axe script approach) with a seeded local-Supabase session, to cover the board, chat, family, progress and admin screens.
6. Find bundle headroom on `/board/[id]` before the next feature lands there.

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

## 9. Security pass

**Fixed:**
- **Next.js 16.2.4 → 16.4.6** (`package.json`, lockfile). `npm audit` listed 16.2.4 under several **critical** advisories: unauthenticated RCE in the Image Optimization API (AVIF and SVG), RCE in `next/og` `ImageResponse` (the app has `src/app/(platform)/parents/opengraph-image.tsx`), and RCE in `use cache`. It also listed high advisories for middleware/proxy bypass, SSRF and DoS. 16.4.6 is a minor bump within 16.x.
  `eslint-config-next` stays at 16.2.4 on purpose. 16.4.6 brings a stricter `react-hooks` plugin that reports 11 new `set-state-in-effect`/`refs` errors across 10 components. Rewriting those effects unattended is not a security fix. Bump it in its own PR.
- **pdfjs-dist 5.7.284 → 6.5.438** (GHSA-hq66-cqwq-w95j, *arbitrary JavaScript execution upon opening a malicious PDF*, `>=5.6.83 <6.2.108`). `src/lib/pdf.ts` opens any PDF a student picks.
  The legacy build path and its `pdf.worker.min.mjs` are present in 6.x. The code typechecks unchanged and the tests pass. **Not verified in a real browser:** check a PDF import on an older iPad (iPadOS 16.4–18), because `pdf.ts` says the legacy build was picked for that floor.
  I did not add pdf.js "hardening" options. `isEvalSupported` no longer exists in pdf.js 5+, and `enableScripting` is not a `getDocument` option, so those would only have looked like protection.
- **Webhook body cap is now in bytes** (`src/app/api/billing/webhook/route.ts:115-121`, observed in item 8). It used to compare `rawBody.length` (UTF-16 units) after buffering the whole body. Now a declared `Content-Length` over 1 MB is refused before the body is read, and the body is measured with `Buffer.byteLength(…, "utf8")`.
  +3 tests in `billingWebhook.test.ts`: 400k `李` (1.2 MB) is refused; 600 KB of `é` still grants; a 5 MB `Content-Length` is refused without pulling a byte. The first and third **fail on the old code**.

After the fixes: typecheck clean, lint clean, `npm test` 10,329 passed / 105 skipped / 0 failed (before the 3 new webhook tests; item 11 re-runs everything), and the placeholder-env build passes. `bundle:check` passes all budgets.

**Checked, no problem found:**
- **API auth.** Every route under `/api/live/*` goes through `livePreamble` → `requireUser`, which verifies the bearer JWT against Supabase Auth and then applies the rate limit. Every `/api/admin/*` route uses `requireAdmin` (a non-admin gets a 404).
  `admin/gc`, `cron/trial-reminders` and `admin/health` use a constant-time `bearerMatches` against `CRON_SECRET`, and answer 503 when it is unset rather than running open. `report/unsubscribe` checks an HMAC with `timingSafeEqual`, and its GET changes nothing.
  The billing webhook verifies the Stripe signature over the raw bytes. `health`, `config/status` and `client-errors` are public by design. `client-errors` caps its body by bytes while streaming and is rate limited per IP and per user.
- **Family PIN.** It is stored as a scrypt hash, and tries are counted in the database: 5 per 15 minutes, and the day's last wrong PIN locks switching to the grown-up until a password sign-in. A kid session cannot set the PIN (403).
- **RLS.** Every table created in the 38 migrations has RLS enabled. The only `using (true)` policies are read-only catalogues (`plans` and `ink_packs`, `to authenticated`), with `revoke all` from `anon`. All 62 `security definer` functions pin `search_path`.
  Not run against a live database (no secrets): `npm run test:db` / `db:verify` still need running.
- **Secrets in the client bundle.** I grepped `.next/static` for the service-role key, the OpenRouter/OpenAI/Stripe/Resend keys, `CRON_SECRET`, `REPORT_LINK_SECRET`, `whsec_`, `sk_live` and `sk-or-`. None appear. The only `NEXT_PUBLIC_*` values are the Supabase URL and anon key, billing/portal links, the site URL, the tldraw licence key, the log level and the release.
- **XSS.** All three KaTeX entry points (`src/shapes/math/katex.ts`, `src/components/chat/askMath.ts`, `AskDemo.tsx`) use `trust: false`, so no `\href`, `\url` or `\html*` gets through, and KaTeX is 0.18.7.
  The other `dangerouslySetInnerHTML` sites are static inline scripts and styles, and the sticker SVGs are built from constants (`src/lib/stickers.ts`). No `href` takes user text, and no redirect follows a user-supplied `next`/`returnTo`. The emails escape every interpolation (`src/lib/email/templates.ts`).

**Risky, not changed:**
- **`npm audit --omit=dev` still lists other advisories**, and every remaining fix is a major bump:
  - `zod` (direct) <4.6.6: memory exhaustion validating oversized constrained collections. It is reachable from every route's `parseJsonBody`, bounded by the platform's body limit.
  - `ai`/`@ai-sdk/*` (direct, major).
  - Non-major fixes are available for `markdown-it`/`linkify-it` (ReDoS), `prosemirror-view`, `@tiptap/core`, `tldraw`, `ws`, `sharp`, `postcss` and `source-map-js` via `npm audit fix`. I didn't run it unattended; give it its own PR and run the full checks after it.
- **`parseJsonBody` (`src/lib/server/request.ts:70`) has no body cap of its own.** It relies on the platform limit (4.5 MB on Vercel functions). Self-hosted, a signed-in user could send a much larger body to any route that uses it. A shared byte cap like `client-errors`' `readCapped` would close this.
- **The pdf.js worker loads from `unpkg.com`** (`src/lib/pdf.ts:17`) with no integrity check. A compromised or hijacked CDN response would run in the worker. Bundling the worker, or serving it from `/public`, avoids the third party.
- **`requireUser` echoes `getServerEnv()`'s error message** in its 500 (`src/lib/server/auth.ts:110-118`) when the server env is misconfigured. That can name missing env vars to the caller. It is only reachable on a broken deployment, so the impact is low.
- **`renderLatex` (`src/shapes/math/katex.ts`) sets no `maxSize`/`maxExpand`**, unlike `askMath.ts`, which uses 10 and 200. A board formula like `\rule{500em}{500em}` can draw a huge box over the board UI. Boards are only shown to their owner and to admins, so this is cosmetic.

## 10. Accessibility/UX pass

**How:** Playwright with headless Chromium (installed in `/tmp`, not added to the repo) and `@axe-core/playwright`, against `next start` on the placeholder-env build. The axe rule sets were WCAG 2.0/2.1 A+AA plus best practice.
Widths were 375×812, 820×1000 and 1440×1000. Pages: `/`, `/parents`, `/login`, `/privacy`, `/terms`, `/refunds`, `/reset-password`, a 404, and the signed-in routes (`/report`, `/welcome/plan`, `/family`, `/progress`, `/account`, `/board/[id]`, `/train`). Without a session every signed-in route redirects to `/login`, so I could not render those pages.
Each run checked horizontal overflow, targets under 24px at 375, uncaught page errors, axe, and a keyboard Tab walk. The landing pages were also run after scrolling to the bottom so lazy and animated sections were mounted, in light and in dark color schemes.
The board, chat and admin components need a signed-in user, so I reviewed them statically instead. I ran `eslint-plugin-jsx-a11y` recommended rules ad hoc over `src/**/*.tsx` and read every hit.

**Result:** no horizontal overflow at any width, no page errors, and **0 axe violations** on every page except the 404, in light and dark.

**Fixed:**
- **The 404 and the error boundary had no `<main>` landmark and no `<h1>`** (`src/app/not-found.tsx`, `src/app/error.tsx`). axe reported `landmark-one-main`, `page-has-heading-one` and `region`. The wrapper is now `<main>` and the title is an `<h1>` with the same classes. axe now reports 0 on the 404.
- **The password input was 20px tall inside its 44px shell** (`src/registry/components/password-field/password-field.module.css`). A tap on the top or bottom ~12px of the visible box hit the shell `<div>` and did not focus the field. On the login page at 375, a tap 4px inside the shell's top border focused nothing before the fix and focuses the password after it.
  The input now uses `align-self: stretch`. `search-field` has the same shell layout and got the same fix.
- **Every form field was 14px, so iOS Safari zoomed the page on focus** (`input`, `password-field`, `search-field` registry CSS). Under `@media (pointer: coarse)` the field text is now `max(16px, var(--text-sm))`. Desktop still computes 14px, which I checked at 1440. The viewport meta correctly does not block zoom, so the font size was the fix to make.
- **The PDF import drop zone was mouse-only** (`src/components/PdfUpload.tsx:290`). It was a `<div onClick>`, and the file `<input>` inside it is `display:none`. A keyboard or screen-reader user could not import a worksheet at all.
  It is now `role="button" tabIndex={0}`, opens the picker on Enter or Space, and has the same `focus-visible` ring as `Button`. **Not verified in a browser:** it needs a signed-in board, so it is only typechecked and linted.

**Checked, no change:**
- **Footer links (Terms/Privacy/Refunds) are 17px tall.** They pass WCAG 2.5.8 (AA) under the spacing exception, because their 24px circles do not overlap. Taller hit areas would be nicer on phones but are optional.
- **The Tab walk** on `/`, `/parents` and `/login` reached every control in a sensible order, each with a visible ring. Two elements had no ring of their own, and both are drawn elsewhere on purpose: the ProblemStrip `<section tabIndex=0>` puts its ring on the parent `.band`, and the password field puts its ring on the shell through `:focus-within`.
- **The other jsx-a11y hits are false positives:** `onKeyDown` on `role="dialog"`/`role="group"` containers (DailyBoard, NowYouTry, CoachMark, TourFinish, stepper), `tabIndex` on the chart figures (ErrorChart, ActivityChart) and ProblemStrip (deliberate keyboard stops), the consent checkbox nested in its label, and `CardTitle`'s spread children.

**Remaining:**
- **Re-run this pass with a seeded session** (local Supabase) to cover the board toolbar, chat panel, family and progress pages, and the admin pages at the three widths.
- Things that are hard to check headlessly: tldraw canvas controls with a screen reader, and VoiceOver on iPad.

Typecheck clean, lint clean on the changed files, `npm test` **10,332 passed / 105 skipped / 0 failed**, and the placeholder-env build passes.

## 11. Final re-run (on 291bd915, the last code change)
- `npm run typecheck`: **pass**, 0 errors.
- `npm run lint`: **pass**, 0 errors, 0 warnings.
- `npm test`: **pass**, 517 files passed / 14 skipped; **10,332 tests passed / 105 skipped / 0 failed**. The skips are env-gated: DB, live evals, smoke.
- `npm run build` (placeholder env, as in item 5): **pass**. `bundle:check`: **all budgets ok**.
