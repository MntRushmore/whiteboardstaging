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
