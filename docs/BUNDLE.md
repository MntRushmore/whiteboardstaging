# Client bundle: what ships, why, and the budget

Measured 2026-09-17 on `feat/production-hardening` with Next 16.2.4 (Turbopack), React 19.2, tldraw 4.2.0,
katex 0.18.7. Sizes are raw / gzip (Node `zlib.gzipSync` default level 6, roughly what a CDN does in the
worst case; Vercel serves Brotli, so real transfer is ~10-15 % smaller than the gzip column). KB = 1024 B.

## How to run the check

```sh
npm run build
node scripts/check-bundle.mjs            # table + exit 1 when a budget is exceeded
node scripts/check-bundle.mjs --json     # machine-readable
node scripts/check-bundle.mjs --budget "/board/[id]=1000000"   # try a different budget without editing the file

# Where do the bytes in the biggest chunks come from? Needs client source maps (opt-in, never on by default):
BUNDLE_SOURCEMAPS=1 npm run build && node scripts/check-bundle.mjs --by-package
```

Next 16 with Turbopack prints no "First Load JS" column and has no `app-build-manifest.json`. The script
rebuilds the number from what the server actually puts in the HTML:

| File | What it gives |
| --- | --- |
| `.next/build-manifest.json` | `rootMainFiles` (React + Next runtime on every page) and `polyfillFiles` (served with `noModule`, so modern browsers never download them; listed but not counted) |
| `.next/server/app/**/page_client-reference-manifest.js` | per route, `entryJSFiles` / `entryCSSFiles` keyed by every segment the route renders: layout, error, not-found, global-error and the page |

First-load JS for a route = `rootMainFiles` + every `entryJSFiles` list in that route's manifest, deduplicated.
This equals the `<script src>` set in `.next/server/app/train.html` and `login.html` (checked by hand).

Run it with `npm run bundle:check` (`node scripts/check-bundle.mjs`). Unit tests for the aggregation: `npx vitest run src/__tests__/checkBundle.test.ts`.

## Budget

| Route | Measured first-load JS (gzip) | Budget (gzip) |
| --- | --- | --- |
| `/board/[id]` | 918,532 B (897.0 KB) | **1,060,000 B (~1.01 MB)** = measured + 15 % (1,056,312), rounded up to 10 KB |

The budget lives in `BUDGETS` in `scripts/check-bundle.mjs`. Raising it needs a line in this file saying
what was added and why it could not be lazy-loaded. `/train` has no budget: trainer-only route, same
graph as the board minus the live-math hooks.

## Before / after

"Before" is the branch as handed over (commit `7b4a42d`); "after" is the same tree plus the changes in
this pass (measurement script, tests, this doc, the source-map switch in `next.config.ts`) plus whatever the
parallel hygiene/API/docs passes had in the working tree at build time (`src/lib/logger.ts`,
`src/lib/live/liveLoop.ts`, `src/hooks/useSnapshotSave.ts` edits; two dead files removed). No import was
moved, so the sizes are identical within noise; the differences below are a few hundred bytes of those
edits plus hash/ordering noise.

| Route | Before: first-load JS | gzip | After: first-load JS | gzip | CSS (after) | gzip |
| --- | --- | --- | --- | --- | --- | --- |
| `/board/[id]` | 2.95 MB | 896.9 KB | 2.95 MB (3,091,598 B) | 897.0 KB (918,532 B) | 237.8 KB | 43.8 KB |
| `/train` | 2.78 MB | 840.1 KB | 2.78 MB | 840.1 KB | 237.8 KB | 43.8 KB |
| `/` | 925.5 KB | 268.9 KB | 925.8 KB | 269.0 KB | 158.9 KB | 29.8 KB |
| `/login` | 820.9 KB | 236.0 KB | 821.2 KB | 236.1 KB | 158.9 KB | 29.8 KB |
| `/_not-found` | 793.3 KB | 226.7 KB | 793.5 KB | 226.8 KB | 158.9 KB | 29.8 KB |
| `/_global-error` | 509.6 KB | 146.3 KB | 509.6 KB | 146.3 KB | 0 | 0 |

`.next/static/chunks` total: 29 files, 6.51 MB raw / 1.89 MB gzip, before and after. `.next/static/media`:
1.3 MB, of which ~1.1 MB is the KaTeX font family (woff2 + woff + ttf for 20 faces); browsers fetch a
font file only when a glyph needs it, so this is not a first-load cost.

Raw `next build` output (identical route list in both runs; Turbopack prints no sizes):

```
before:  ▲ Next.js 16.2.4 (Turbopack)   ✓ Compiled successfully in 15.1s
after:   ▲ Next.js 16.2.4 (Turbopack)   ✓ Compiled successfully in 12.3s
Route (app)
┌ ○ /              ├ ○ /_not-found      ├ ƒ /api/check-help-needed  ├ ƒ /api/config/status
├ ƒ /api/credits   ├ ƒ /api/generate-solution  ├ ƒ /api/generate-worksheet  ├ ƒ /api/live/check
├ ƒ /api/live/recognize  ├ ƒ /api/live/solve  ├ ƒ /api/ocr  ├ ƒ /api/voice/analyze-workspace
├ ƒ /api/voice/token     ├ ƒ /board/[id]      ├ ○ /login    └ ○ /train
```

Compile time is noisy on this machine (12-19 s for the same tree); do not read anything into it.

## What each big chunk is

From `--by-package` on a `BUNDLE_SOURCEMAPS=1` build (top entries; bytes are raw, minified; chunk names
change with every build, the sizes do not):

| Chunk (raw / gzip) | Loaded by | Contents |
| --- | --- | --- |
| 1.90 MB / 579 KB | `/board/[id]` first load | tldraw 522 KB, @tldraw/editor 331 KB, **katex 255 KB**, @tiptap/core 161 KB + prosemirror-{view,model,transform} 165 KB (tldraw's rich-text editor), `src/lib` 62 KB, zod 60 KB, @tldraw/tlschema 48 KB, @tldraw/store 35 KB, core-js 26 KB, @tldraw/utils 20 KB, @use-gesture 19 KB, linkifyjs 17 KB |
| 1.90 MB / 579 KB | `/train` first load | the same module set byte for byte (module order differs, hence a different hash) |
| 755 KB / 196 KB | lazy: `import("mathjs")` in `src/lib/live/engine/index.ts` | mathjs 680 KB, decimal.js 32 KB, typed-function 16 KB, complex.js, fraction.js, seedrandom |
| 402 KB / 118 KB | lazy: `import("pdfjs-dist")` in `src/lib/pdf.ts` | pdf.js display layer (its worker is fetched from unpkg at runtime, not bundled) |
| 215 KB / 56 KB | every route (layout) | @supabase/supabase-js + auth, sonner, next-themes, AuthProvider/CreditsBanner tree, `pino/browser.js` (~6 KB minified, ~2.5 KB gzip) |
| 199 KB / 63 KB | every route | react-dom 19 |
| 134 KB / 37 KB | every route | Next app-router runtime |
| 156 KB / 51 KB | `/board/[id]` only | the board page itself, hooks (`useSnapshotSave`, live loop, sync), 15 hugeicons + 7 lucide icons |
| 76 KB / 25 KB (x2) | board+train, and home | radix-ui primitives (dialog, popover, dropdown, tabs, tooltip) + `components/ui`; duplicated between the two route groups for the reason below |
| 159 KB / 29 KB CSS | every route (layout) | Tailwind output **+ `katex/dist/katex.min.css`** (imported from `src/app/globals.css`) |
| 75 KB / 14 KB CSS | board, train | `tldraw/tldraw.css` |
| 110 KB / 39 KB | `noModule` polyfill | not downloaded by modern browsers |

### Why the 1.9 MB chunk exists twice

Turbopack (Next 16) builds one chunk graph per route entry. Modules shared with the *parent* segment
(the root layout) are deduplicated into the layout's chunks, but modules shared between *sibling* routes
(`/board/[id]` and `/train` both import `tldraw`) are emitted once per route, so the same 1.9 MB of
tldraw + katex lands in two differently-named files. The same mechanism duplicates the 76 KB radix chunk
between `/` and board/train.

What it costs: nothing on the first load of either route (a visitor downloads one copy). A trainer who
opens `/train` after a board downloads the second copy (579 KB gzip) once; it is then cached. It inflates
`.next/static` by 1.9 MB.

What was tried (scratch build, not committed): putting the whole page body of both routes behind
`next/dynamic(() => import(...), { ssr: false })`. Result: both copies survive as *lazy* chunks (still
2 x 1.90 MB, Turbopack keys async chunk groups by importing module, not by content), the first-load column
drops to 228 KB only because the metric no longer sees them, and the page gains a blank frame before the
editor mounts. That is gaming the number, not a saving, so it was not applied. Moving `<Tldraw>` alone into
a shared `BoardCanvas` component cannot help either: the pages themselves call `useEditor`,
`createShapeId`, `loadSnapshot`, ... from `tldraw`, so the library stays in each page's graph. Real
deduplication would need webpack-style `splitChunks` (not available under Turbopack) or hoisting tldraw
into the root layout, which would load it on `/` and `/login` - a regression for the common path.
`src/components/BoardCanvas.tsx` was therefore not created.

### Tree-shaking check

- **lucide-react**: on Next's built-in `optimizePackageImports` list. Only the icons in use appear in the
  chunks (5 on `/train`, 19 on `/`, 7 on the board page, `sigma` in the tldraw chunk).
- **hugeicons-react**: the package's ESM entry re-exports 4,126 icons through a barrel (`import * as o from
  "./icons/index.js"`, 17 MB of source). Turbopack tree-shakes it: exactly the 15 icons the board imports
  (`Loading03Icon` is shared with `StatusIndicator`) appear in the board chunk, none anywhere else.
  `experimental.optimizePackageImports: ["hugeicons-react"]` was tried: size unchanged (+58 B), compile
  time 14.7 s / 19.3 s without vs 18.1 s / 14.4 s with (two clean runs each) - pure noise, so it was not
  kept.
- **pino**: the client resolves `pino` to `pino/browser.js` via the package's `browser` field (15.8 KB
  source, ~6 KB minified, ~2.5 KB gzip inside the layout chunk). It is on every route because
  `AuthProvider` installs the console capture from `src/lib/logger.ts`. Not material; no change
  recommended.
- **katex** (255 KB raw / ~70 KB gzip of JS, plus 160 KB of CSS, on both editor routes): imported
  statically by `src/shapes/math/katex.ts`, which the shape utils need at mount, so it is genuinely
  first-load on the board. Its CSS, however, is imported from `src/app/globals.css` and therefore ships to
  `/` and `/login` too (~15 KB gzip of the 29 KB layout CSS). See recommendations.
- **mathjs** and **pdfjs-dist** stay lazy (`(lazy)` in the chunk table; both are behind `await import()`).

## Recommendations not done here (files owned elsewhere)

1. `src/app/globals.css`: drop `@import "katex/dist/katex.min.css"` and import it from
   `src/shapes/math/MathShapeUtil.tsx` (or `src/shapes/index.ts`) instead, so it becomes part of the
   board/train CSS chunk. Saves ~15 KB gzip on `/`, `/login`, `/_not-found`.
2. `src/lib/logger.ts` (HYGIENE agent): `pino/browser.js` costs ~2.5 KB gzip; replacing it with a console
   logger is not worth a second logging API. Leave as is.
3. The one remaining lever on `/board/[id]` is katex: `renderLatex` could `await import("katex")` and
   render a placeholder until it resolves (~70 KB gzip off first load), at the cost of a flash on boards
   that already contain math shapes and of making `MathShapeUtil`'s `toSvg` path async. Not done.

## Environment note

`productionBrowserSourceMaps` in `next.config.ts` is gated on `BUNDLE_SOURCEMAPS=1` and defaults to off:
source maps would otherwise be published with the site and they make `next build` slower. Nothing else in
the build depends on the variable; it is not a Vercel env var and must not become one.
