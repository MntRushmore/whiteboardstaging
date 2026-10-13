# Landing v3 (2026-10-12)

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
- **lp3-root:** `SessionHop.tsx` (already placed at the top of the page), `next.config.ts`, `src/lib/landing/links.ts`, the auth cookie in `src/components/AuthProvider.tsx` (or a small new `src/lib/landing/signedInCookie.ts`), `src/app/(platform)/page.tsx` (the gate script only), and the links tests.
- Nobody else edits `ink.module.css`, `InkMark.tsx`, `HandMath.tsx`, `handInk.ts` or `inkStart.ts`. If one of them needs a change, make it small and additive, and say so in the commit.

## Root: the page at agathon.app/

- Today a signed-out `/` is sent to `/parents`, so the address bar says `/parents`, and a search engine sees the app shell at `/`.
- v3 serves the landing page at `/` itself, through a `next.config.ts` `beforeFiles` rewrite of `/` to `/parents`. It applies only when:
  - the request has no `agathon_session` cookie, and
  - the query has no auth parameters (`code`, `token_hash`, `error`, `error_code`, `error_description`).
- The app sets that cookie (a flag only, not a token: `agathon_session=1; Path=/; SameSite=Lax; Secure; Max-Age=400 days`) whenever supabase-js has a session, and clears it on sign-out.
- The landing page's head carries a tiny inline script. If this device has a stored Supabase session (`sb-*-auth-token`) or auth parameters in the hash, it sets the cookie and does `location.replace` to the same URL. That one-time hop covers a signed-in device from before the cookie existed.
- The boards home's signed-out gate goes to `/` (keeping the query and hash) after clearing a stale cookie. It falls back to `/parents` when cookies cannot be written, so it can never loop.
- `/parents` keeps working.
- The canonical URL becomes `/`.

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
