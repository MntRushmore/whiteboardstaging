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
