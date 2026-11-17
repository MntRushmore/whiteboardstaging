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
