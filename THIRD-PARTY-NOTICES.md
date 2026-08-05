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

Regenerate a full dependency license inventory at any time with:

    npx license-checker-rseidelsohn --summary

_This file is a good-faith summary compiled from package metadata, not legal
advice. Verify against the actual license files in `node_modules` before
relying on it in a commercial agreement._
