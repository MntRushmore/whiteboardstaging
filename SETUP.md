# Setup

This app is **bring-your-own-key (BYOK)**. No AI credentials ship with the
source code. Whoever runs an instance supplies their own keys and pays for
their own usage.

## 1. Install

    git clone https://github.com/MntRushmore/whiteboardstaging.git
    cd whiteboardstaging
    npm install

## 2. Add your keys

    cp .env.example .env.local

Then fill in `.env.local`:

| Variable | Required? | Get it from | Powers |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | **Yes** | <https://openrouter.ai/keys> | Hints/solutions, worksheets, help detection, voice analysis, credit display |
| `OPENAI_API_KEY` | No | <https://platform.openai.com/api-keys> | Realtime voice tutor |
| `MISTRAL_API_KEY` | No | <https://console.mistral.ai/api-keys> | Handwriting / PDF OCR (not on the live board loop) |
| `MATHPIX_APP_ID` + `MATHPIX_APP_KEY` | No | <https://mathpix.com/ocr> | Optional fast LaTeX recognition for the tutor |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | your own Supabase project | Boards, auth, storage |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | your own Supabase project | Boards, auth, storage |
| `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` | Production only | <https://tldraw.dev/community/license> | Canvas SDK (see below) |
| `NEXT_PUBLIC_SITE_URL` | No | — | Referer sent to OpenRouter |

`.env*` is gitignored. Do not commit a filled-in copy.

## 3. Run

    npm run dev

Open <http://localhost:3000>.

## How key handling works

- Keys are read **server-side only**, inside `src/app/api/**/route.ts`, via
  `src/lib/aiConfig.ts`. They are never bundled into client JS and never sent
  to the browser.
- Every AI route calls `requireKey(provider)`. If the key is absent, the route
  returns `503` with a `MISSING_API_KEY` code plus the variable name and a
  signup link, instead of an opaque `500`.
- Placeholder values (anything starting with `your`, `replace`, `changeme`,
  `xxx`) are treated as unset, so a half-copied `.env.example` fails loudly.
- `GET /api/config/status` returns which providers are configured — **booleans
  and setup metadata only**, no key values, prefixes, or lengths.
- `<SetupRequiredBanner />` renders a clear "add your keys" message for missing
  providers. Drop it into a layout or the board page to surface it.

### Adding a provider

1. Add an entry to `PROVIDERS` in `src/lib/aiConfig.ts`.
2. Document the variable in `.env.example` and in the table above.
3. In your route: `const k = requireKey('yourprovider'); if (!k.ok) return k.response;`

## tldraw license (important)

The canvas uses the tldraw SDK, which is licensed separately from this project
and is **not** open source. Localhost development works without a key, but any
production deployment needs its own tldraw license key — commercial for
commercial use, or a free hobby license for non-commercial use. See
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

## License

This repository is licensed under FSL-1.1-ALv2 — see [LICENSE](./LICENSE),
[NOTICE](./NOTICE), and [CONTRIBUTING.md](./CONTRIBUTING.md).
