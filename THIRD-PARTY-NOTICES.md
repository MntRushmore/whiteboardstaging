# Third-Party Notices

The LICENSE at the root of this repository covers **only the original code in
this repository**. Dependencies are licensed by their own authors under their
own terms, and nothing in our LICENSE overrides, supersedes, or negates them.

## tldraw SDK — read this before deploying

This project renders its canvas with the [tldraw](https://tldraw.dev) SDK
(`tldraw@^4`). Since SDK 4.0, tldraw ships under the **tldraw license**, which
is not an OSI open-source license. What this means for anyone using this repo:

- **Production use requires your own tldraw license key.** A commercial license
  for commercial use, or a free (discretionary) hobby license for
  non-commercial use. Development on `localhost` works without a key.
- **Our license does not sublicense tldraw to you.** Including tldraw in an
  open/fair-source project is permitted, but the SDK stays under its original
  license, and each downstream user needs their own key.
- **Do not remove or interfere with the watermark or the key validation.** The
  hobby license requires the "made with tldraw" watermark to remain visible.
- **The tldraw name and logo are theirs.** See tldraw's trademark guidelines.

Set your key in `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` (see `.env.example`). Request
one at <https://tldraw.dev/community/license>.

## Other notable dependencies

| Package | License |
| --- | --- |
| `next`, `@next/*`, `eslint-config-next` | MIT |
| `react`, `react-dom` | MIT |
| `@supabase/supabase-js` | MIT |
| `@radix-ui/*` | MIT |
| `lucide-react` | ISC |
| `hugeicons-react` | MIT |
| `tailwindcss`, `tailwind-merge`, `tailwindcss-animate`, `tw-animate-css` | MIT |
| `class-variance-authority`, `clsx` | MIT / Apache-2.0 |
| `sonner` | MIT |
| `pdfjs-dist` | Apache-2.0 |
| `sharp` | Apache-2.0 |
| `potrace` | GPL-2.0 — see note below |
| `pino`, `pino-pretty` | MIT |
| `ai`, `@ai-sdk/openai` | Apache-2.0 |
| shadcn/ui components under `src/components/ui/` | MIT (copied into this repo) |

**`potrace` note:** the npm `potrace` package is a JS port of Peter
Selinger's Potrace, which is **GPL-2.0**. GPL obligations attach to code you
distribute that links it. Because this is a server-side Node dependency in a
web application (not shipped to end users), the practical exposure is limited,
but if you distribute this codebase or a derivative you should either (a)
confirm you are comfortable with GPL-2.0 terms, or (b) replace `potrace` with
a permissively licensed tracer. Worth resolving before this repo is shared
externally.

## The iPad app (`ios/`)

The iPad app has no third-party package dependencies. It contains one piece of ported code:

- **perfect-freehand** 1.2.3 by Steve Ruiz (MIT). Its stroke algorithm (`getStrokePoints`,
  `getStrokeOutlinePoints`) is rewritten in Swift in
  `ios/Packages/AgathonBoard/Sources/AgathonBoard/Geometry/Freehand.swift`; the changes are marked
  `Agathon:` there. Its licence:

  > MIT License
  >
  > Copyright (c) 2021 Stephen Ruiz Ltd
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy
  > of this software and associated documentation files (the "Software"), to deal
  > in the Software without restriction, including without limitation the rights
  > to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  > copies of the Software, and to permit persons to whom the Software is
  > furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all
  > copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  > IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  > FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  > AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  > LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  > OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  > SOFTWARE.

The fractional-index keys (`OrderKey.swift`) follow David Greenspan's algorithm as published in
Rocicorp's `fractional-indexing` (CC0), rewritten in Swift.

No tldraw code is in the app. The pen's option values match tldraw's draw shape, so converted boards
look as they did, but the code is perfect-freehand's.
`ios/Packages/AgathonBoard/Tools/fixtures/tldraw-reference.mjs` runs tldraw's own renderer from a
local `node_modules`, read-only, to make the test reference images. It is a development tool and is
not shipped.

Regenerate a full dependency license inventory at any time with:

    npx license-checker-rseidelsohn --summary

_This file is a good-faith summary compiled from package metadata, not legal
advice. Verify against the actual license files in `node_modules` before
relying on it in a commercial agreement._
