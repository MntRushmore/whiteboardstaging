# Landing v3 (2026-10-12)

> **v4, "warm it up" (2026-10-13, feat/lp4-warm).** The owner liked heyaristotle.com and picked "keep our layout, real product shots and blue ink, add the warmth". Everything below still holds except where this box says otherwise.
>
> - **Type.** Headlines (`.display`, `.h2`, `.h3`, the bar's name, the price, card titles, the questions) are Fraunces, SOFT 100, WONK 0, `opsz` 72 for display (`fonts.ts`, next/font, loaded only where imported; `landingFontClass` on a wrapper gives any page the same face). Arc's body face stays for everything else. Comparison: `docs/qa-screenshots/landing-v4/font-compare.png`.
> - **Paper, not screen white.** Page `#fbf7ef`, deeper bands `#f4ecdd`, cards and boards `#fffdf9`, ink `#1f1a14`, muted `#6b5d4f` (≥4.87:1 on every paper and tint), hairlines `#e6dbc9`, tints sage `#e3e9d3` / peach `#f7dfcf` / lavender `#e7e0ee` / butter `#f6e8bd` / sky `#e2e9f6`, the two dark bands deep brown `#3b2a1f`. Buttons stay `#0562ef`; blue words on paper are `#0450c8`. Eyebrows are small spaced capitals in the muted brown (blue is for buttons and the tutor's ink). Every v3 `--lp-*` token is kept (values warmed); new ones: `--lp-paper`, `--lp-paper-deep`, `--lp-card`, `--lp-brown`, `--lp-join`, `--lp-serif`, `--lp-accent-ink`, `--lp-focus`, `--lp-eyebrow`, `--lp-board-table` (the app's own grey, for drawn UI), `--lp-tint-sage/peach/lavender/butter/sky`.
> - **Torn edges** (`TornEdge`, `src/lib/landing/torn.ts`): seeded, deterministic, 1:1 at every width up to 1920 px, flat fills only (a paler fibre on the dark and blue sheets). Placed in `parents/page.tsx` at every color change. Scraps and the painting's sheet use `tornOutline` (a clip-path).
> - **Page order** gains two parts: after the hero, the iPad replay in its own band (`HeroReplay`); after How it works, **"Not a cheat button."** (`Honest.tsx`, dark brown, a collage of torn scraps with HELP_SCENE's slip line, a check mark and the Help me button).
> - **The hero** is the words over a painting (`HeroScene`, art in `src/lib/landing/heroScene.ts`) on a torn sheet. Real ink is drawn onto the painted tablet: laid out on a flat screen and projected onto the painting by a homography on the server (`src/lib/landing/sceneInk.ts`), one static SVG. No CSS 3D: headless WebKit drops perspective.
> - Hard NOs unchanged: no gradients, glows or glass; no testimonials, counts or claims.

**Owner's ask:** "upgrade the landing page agathon.app, make it a lot cooler, updated everything … cta to join!" and "i wanted to update the main agathon.app website!"

The landing page is what a signed-out visitor to agathon.app sees. A signed-out `/` currently redirects to `/parents`, which is the page. v3 does three things:

- It shows the product as it is today:
  - the simple board (its top bar has Help me ▾, Today ☆☆☆☆☆ 0 of 5 and More; its dock has Select, Pen, Eraser, Shapes, Picture, Type, Undo/Redo, colors, pages and a big Ask button);
  - Help me's three levels: Hint, Next step, Solve it;
  - Ask, rebuilt: streamed, voice in and out, draws visual models, remembers the kid, and answers any subject in chat;
  - Type it on a laptop.
- It is a lot more alive.
- Its one button is **Join Agathon**.

The page is also served at `agathon.app/` itself (see "Root" below).

## Direction: the page is the board

The brand's own signature is its two pens: the kid's black marker and the tutor's blue pen (#4465e9), which checks and circles. v3 puts those pens on the page itself.

- **The tutor marks the page.**
  - The hero circles "actually" and checks the headline (`InkCircle`, `InkCheck`).
  - A section title may carry one underline (`InkUnderline`).
  - The Join band has a white arrow drawn to its button (`InkArrow`).
  - These marks are the real tutor's strokes (`boardInk.ts`) or the hand engine's teacher marks. Never invent a mark style.
  - At most one mark per section. Restraint is what makes it feel crafted.
- **Maths is handwritten.** `HandMath` writes LaTeX in the board's hand (the hand engine, the same one that writes typed lines on the board), in kid ink or tutor ink. It is used in:
  - the problem strip;
  - the big step numerals in How it works;
  - the laptop "Type it" demo.
- **Ink draws itself** when it comes into view (`draw="unique-key"`, held by `INK_START_SCRIPT`), at a child's writing pace. With reduced motion it is simply there.
- **Energy without slop.**
  - Use bigger type and larger product pictures, and give the pictures the wide measure (`--lp-wide`).
  - Add more motion: ink, the strip, Ask streaming, typing.
  - Use flat colour tints per idea (`--lp-tint-*`), the dark Grown-ups band, and a full-bleed flat-blue Join band.
- **Hard NOs.**
  - No decorative gradients of any kind: the owner hates them ("AI generated gradient thing").
  - No glows, glassmorphism, sparkle/AI icons or emoji.
  - No stock illustrations.
  - No fake UI states.
  - No testimonials, ratings, user counts, outcome claims or logos.
  - Functional patterns are OK: a dot-grid board texture (prefer an SVG `<pattern>`), scroll-edge fade masks, and neutral skeleton shimmers.
- **Keep:**
  - Geist;
  - the clean white/soft-grey rhythm;
  - real product pictures (screenshots of the real app) and real ink;
  - US English ("check mark", not "tick"; "practice", "math", "color");
  - every price and trial length read from `UNLIMITED_PLAN` through `planWords`.

## Page order

| # | Section | File | Owner branch |
|---|---|---|---|
| 1 | Nav: brand, section links (wide), Sign in, **Join Agathon** | `LandingNav.tsx` | lp3-page |
| 2 | Hero: headline with ink, lede, Join + See how it works, terms, the iPad replay | `Hero.tsx` (layout) + `BoardReplay.tsx` (iPad) | lp3-page / lp3-captures |
| 3 | Problem strip: one handwritten, checked problem per grade, moving | `ProblemStrip.tsx` | lp3-devices |
| 4 | How it works: 3 steps | `HowItWorks.tsx` | lp3-page |
| 5 | Ask: the panel demo plus 5 features | `AskDemo.tsx` | lp3-ask |
| 6 | Devices: tablet / laptop (Type it) / phone | `Devices.tsx` | lp3-devices |
| 7 | A path for every grade (picker) | `PracticePicker.tsx` | lp3-page |
| 8 | For grown-ups (dark band) | `GrownUps.tsx` | lp3-page |
| 9 | Pricing | `Pricing.tsx` | lp3-page |
| 10 | Questions | `Questions.tsx` | lp3-page |
| 11 | Join band (flat blue, huge, arrow to the button) | `Join.tsx` | lp3-page |
| 12 | Sticky Join bar (phones, after the hero) | `StickyJoin.tsx` | lp3-page |

Every word is in `copy.ts`, and the contract already holds them. A builder may tighten its own section's words, but only to things that are true today. The rest of `copy.ts` belongs to lp3-page.

## Shared pieces (contract)

- `src/lib/landing/handInk.ts`: LaTeX → strokes and timing. It is tested.
- `HandMath.tsx`: `<HandMath latex size ink seed draw startMs speed pen label />`. `handMathMs()` times what follows.
- `InkMark.tsx`: `InkCircle` and `InkUnderline` wrap words; `InkCheck` and `InkArrow` stand alone. Each takes `draw`, `atMs`, `forMs`, `ink` and `pen`.
  - Stretched marks draw through a mask, because a dashed non-scaling stroke draws wrongly in Chrome and Safari.
- `inkStart.ts`: `INK_START_SCRIPT` sits at the end of the page. It holds every `[data-lp-draw]` (and any `[data-lp-ink]` inside it) until 40% of it is in view. It never touches React's DOM.
- `ink.module.css`: the pens and the draw animation.
- Tokens on `.page` in `landing.module.css`: `--lp-pen-*`, `--lp-table`, `--lp-tint-*`, `--lp-star`, `--lp-wide`.
- `bands.ts` ids: `HOW_ID`, `ASK_ID`, `GROWN_UPS_ID`, `PRICING_ID`, `JOIN_ID`.

## File ownership (so branches merge cleanly)

- **lp3-page:** `landing.module.css` (not the token block), `practice.module.css`, `LandingNav`, `NavTone`, `Hero`, `HowItWorks`, `PracticePicker`, `GrownUps`, `Pricing`, `Questions`, `Join`, `StickyJoin`, `copy.ts`, `parents/page.tsx`, `parents/opengraph-image.tsx`, and `__tests__/landing.test.tsx` / `invitedPage.test.tsx`.
- **lp3-ask:** `AskDemo.tsx`, `ask.module.css`, and `__tests__/askDemo.test.tsx`. Any new pure helpers go under `src/lib/landing/ask*`.
- **lp3-devices:** `ProblemStrip.tsx`, `Devices.tsx`, `strip.module.css`, `devices.module.css`, and their tests. Any new device pictures go under `public/landing/v3/devices-*`.
- **lp3-captures:** `BoardReplay.tsx`, `device.module.css`, `replay*.ts`, `public/landing/*.webp` (board-ipad, path, progress), and `public/landing/v3/` shots that others ask for.
- **lp3-root:** `SessionHop.tsx` (already placed at the top of the page), `next.config.ts`, `src/lib/landing/links.ts`, `sessionCookie.ts` and `leaving.ts`, the auth cookie in `src/components/AuthProvider.tsx`, `src/app/(platform)/page.tsx` (the gate script and the signed-out check only), the full loads into `/` in `LoginForm`, `ResetPasswordForm` and `AppHeader`'s sign-out, and the links, session-cookie and root tests.
- Nobody else edits `ink.module.css`, `InkMark.tsx`, `HandMath.tsx`, `handInk.ts` or `inkStart.ts`. If one of them needs a change, make it small and additive, and say so in the commit.

## Root: the page at agathon.app/

- Before v3 a signed-out `/` was sent to `/parents`, so the address bar said `/parents`, and a search engine saw the app shell at `/`.
- v3 serves the landing page at `/` itself, through a `next.config.ts` `beforeFiles` rewrite of `/` to `/parents` (`ROOT_LANDING_REWRITE` in `src/lib/landing/links.ts`). It applies only when:
  - the request has no `agathon_session` cookie, and
  - the query has no auth parameters (`code`, `token_hash`, `access_token`, `refresh_token`, `error`, `error_code`, `error_description`).
  - Next applies a rewrite only when every `missing` item is absent; an empty value counts as absent. The tests run the rule through Next's own matcher.
- **The cookie** (`sessionCookie.ts`) is a flag, never a token: `agathon_session=1; Path=/; Max-Age=34560000; SameSite=Lax; Secure` (no `Secure` on plain http). AuthProvider sets it whenever supabase-js has a session, inside the auth callback, so it is there before sign-in navigates. It clears it on `SIGNED_OUT` and when `getSession` finds no session. An empty `INITIAL_SESSION` (it also arrives when Auth cannot be reached) leaves it alone. A profile switch's new session keeps it set.
- **The hop** (`SessionHop.tsx`, `SESSION_HOP_SCRIPT`): the landing page's first script. On `/` only (never `/parents`), a device with a stored session (`sb-*-auth-token`) or auth parameters in the hash sets the cookie and reloads. A reload, not `location.replace`: a replace to the same address with a hash only scrolls. It stays put when the cookie or the tab's sessionStorage cannot be written, and it hops at most once per 10 minutes per tab (`agathon.sessionHop`).
- **The signed-out boards home** (`SIGNED_OUT_GATE_SCRIPT` before paint, `leaveSignedOut` after auth): an email link's visitor goes to `/login`. Anyone else gets the cookie cleared and `/` reloaded, so the server serves the landing page there, query and hash kept. It goes to `/parents` instead when the cookie cannot be cleared, the tab cannot mark the reload, or the last reload came back to the app (`agathon.rootReload`, cleared by the landing page). `src/lib/landing/__tests__/root.test.ts` plays whole visits (blocked cookies, a cookie the page cannot see or clear, caches that ignore the rule) and shows that each one settles in a few loads.
- **Full loads into `/`.** The client router caches `/` as whichever page it saw first, and it would show the landing page after sign-in. So sign-in (`enterRoot`), reset-password and sign-out (`AppHeader`, now to the landing page at `/`) load `/` in full. A document that has started such a load is marked (`leaving.ts`), so nothing else navigates after it, and AuthProvider stops passing auth changes to React.
- `/parents` keeps working, and it never sends anyone anywhere.
- The canonical URL and `og:url` are `/` (`LANDING_PATH`). The rewritten `/` carries `/parents`' `index, follow`, and the app at `/` keeps the root layout's `noindex`. Crawlers send no cookie, so they get the landing page.
- **Caching.** Vercel applies the rewrite per request, before its cache, so each page is cached under its own route. Production sends `cache-control: public, max-age=0, must-revalidate` (seen: `x-vercel-cache: HIT`). Do not add `Vary: Cookie`: Vercel's CDN does not cache a response that varies on Cookie. Cloudflare (`cf-cache-status: DYNAMIC`) caches no HTML by default, and `max-age=0` keeps it out. `/` also sends `Cloudflare-CDN-Cache-Control: no-store`, in case a "cache everything" rule ever covers it. A Cache Rule with an Edge TTL override would still cache `/` for everyone, so never put one on `/`.

## Checks before a branch is done

- `npx vitest run src/components/landing src/lib/landing` (plus your own tests).
- `npx tsc --noEmit`.
- `npx eslint --ignore-pattern '.claude/**' <your files>`.
- Screenshots of your section(s):
  - Chromium AND WebKit;
  - 375, 820 and 1440 px;
  - motion mid-way and finished;
  - `prefers-reduced-motion: reduce`.
- No horizontal scroll at 320 px.
- Text contrast of at least 4.5:1.
- The page stays a static server render: keep client islands tiny and only where needed.
