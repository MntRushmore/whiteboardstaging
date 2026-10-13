# SEO and AI search (2026-10-13)

The owner: "work on SEO and AI SEO, we gotta be the best out there". The goal is that a parent who searches Google or Bing, or who asks ChatGPT, Claude, Perplexity, Gemini or Copilot, for K–8 math help finds Agathon, reads a page worth reading, and that the answer engines can quote what Agathon is, correctly.

This build sits on `feat/landing-v3` (the landing page at `/`), on the branch `feat/seo`. Agents work on `feat/seo-*` branches off `feat/seo`.

## Where we started (audit, 2026-10-13, production)

- No `robots.txt`, no `sitemap.xml`, no `llms.txt` (all 404).
- Cloudflare (in front of www.agathon.app) answers **403 to GPTBot, ClaudeBot and CCBot**, the crawlers that teach ChatGPT, Claude and the open models what Agathon is. OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-User, Googlebot and Bingbot get 200. Fixing this is a Cloudflare dashboard setting (Security → Bots / AI Crawl Control): the owner's action, not code.
- One indexable page in the whole site (`/parents`, canonical moved to `/` by landing v3). The root layout sets `noindex, nofollow` on everything else, including Privacy and Terms.
- No structured data (JSON-LD) anywhere.
- The landing page's title has none of the words parents search for ("AI math tutor", "math practice", a grade).
- Only `favicon.ico`: no `apple-icon`, no `icon.svg`, no web manifest.

## What we build

1. **Technical SEO** (`feat/seo-core`): `robots.txt` that welcomes search and AI crawlers to the public pages and keeps them out of the app; `sitemap.xml` from `publicPages()`; icons and manifest; site-wide metadata defaults (`metadataBase`, Open Graph, verification codes from env); the landing page's title and its JSON-LD (Organization, WebSite, the app and its offer, FAQPage); Privacy, Terms and Refunds indexable; footer links into the math library; IndexNow.
2. **The math library**: one page per grade and course (`feat/seo-levels`) and one per skill (`feat/seo-skills`, `feat/seo-guides-k8`). Real content from the app's own curriculum: each grade's skill path, each skill's worked example and practice set written by the app's generators and engine, and a hand-written guide per skill.
3. **AI search** (`feat/seo-ai`): `llms.txt` and `llms-full.txt`, the `/about` page (the facts an answer engine quotes about Agathon), and `scripts/seo-audit.mjs`, a crawler that checks every public page the way a search engine and an AI crawler see it.

## Addresses (src/lib/seo/routes.ts)

| Page | Address | Owner |
| --- | --- | --- |
| Landing | `/` (`/parents` canonical to `/`) | seo-core (metadata + JSON-LD only) |
| Math library hub | `/math` | seo-levels |
| Grade | `/math/kindergarten`, `/math/1st-grade` … `/math/8th-grade` | seo-levels |
| Course | `/math/algebra-1`, `/math/geometry`, `/math/algebra-2`, `/math/precalculus-and-calculus` | seo-levels |
| Skill | `/math/long-division` … (56, `SKILL_SLUGS`) | seo-skills |
| About | `/about` | seo-ai |
| llms.txt | `/llms.txt`, `/llms-full.txt` | seo-ai |
| Legal | `/privacy`, `/terms`, `/refunds` | seo-core (indexable) |

Levels and skills share `src/app/(platform)/math/[slug]/page.tsx`, which dispatches to `LevelPage` / `SkillPage` (src/components/seo). Slugs are addresses: never rename a live one without a permanent redirect.

## Rules for every page

**Words** (the landing page's rules, enforced by its tests; apply them to every new page and test them):
- Say what the product does today and nothing it does not. No testimonials, ratings, stars, user counts, outcome numbers ("raise grades"), "best", "#1", "proven", "guarantee", "trusted by", school logos or press.
- Never type a price, a trial length or a plan name: take them from `planWords(UNLIMITED_PLAN)` (src/lib/landing/plan.ts), as the landing copy does.
- US English: math, practice, check mark, circle, color, center, parentheses. Never "maths", "practise", "tick", "ring", "colour", "brackets".
- Kids' math terms the way US teachers say them (denominator, regroup, "times tables").
- Written for a parent who has never heard of Agathon; short, plain sentences.
- The math on a page is real text a crawler can read: plain Unicode (`3/4 + 1/6`, `46 × 7`, `x²`) in the HTML. The hand-drawn `HandMath` is a picture of it: give it the same words as its label, or mark it `aria-hidden` next to the text.

**Rendering**:
- Static server components, built at build time (`generateStaticParams`, `dynamicParams = false`). No client island unless the page cannot work without it; no auth wait; nothing depends on who is looking.
- In the `(platform)` group, so the page gets Arc's faces and the legal footer. Look like the landing page: its tokens on `.page` (landing.module.css), `HandMath`, `InkMark`, flat fills, **no decorative gradients** (the owner hates them).
- Works at 320 px with no horizontal scroll, contrast at least 4.5:1, keyboard focus visible.

**Metadata** (every public page):
- `title`: the search words first, at most 60 characters with the root layout's ` · Agathon` suffix (or `{ absolute }` when the brand leads).
- `description`: 120–160 characters, says what the reader gets on this page.
- `alternates.canonical`: the page's own path (relative; `metadataBase` comes from the root layout).
- `openGraph` and `twitter` with the title and description. One `h1` per page. Headings in order.
- `robots: { index: true, follow: true }` (the root layout's default is `noindex`).
- JSON-LD through `<JsonLd data={…} />` (src/components/seo/JsonLd.tsx). Only facts the page shows. Never `aggregateRating` or `review`.

| Page | JSON-LD |
| --- | --- |
| Landing | `Organization`, `WebSite`, `SoftwareApplication` (`applicationCategory: EducationalApplication`, `offers` from the plan), `FAQPage` from the Questions band |
| Hub | `CollectionPage` + `ItemList` of the levels, `BreadcrumbList` |
| Grade, course | `CollectionPage` + `ItemList` of its skills, `BreadcrumbList`, `FAQPage` when the page shows questions |
| Skill | `LearningResource` (`educationalLevel`, `teaches`, `learningResourceType: "Worked example, practice problems"`), `BreadcrumbList`, `FAQPage` from the guide |
| About | `AboutPage` with the `Organization` |

**Links**: every page links up (breadcrumb), across (related skills, the next grade) and to the one action, Join Agathon (`SIGN_UP_HREF`). The landing page's practice picker links each grade and skill into the library.

## File ownership (so branches merge cleanly)

- **seo-core**: `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/manifest.ts`, `src/app/icon.*`, `src/app/apple-icon.*`, `src/app/layout.tsx` (metadata only), `src/app/(platform)/parents/page.tsx` (metadata + JSON-LD only), `copy.ts` (`meta` only), `src/app/(platform)/{privacy,terms,refunds}/page.tsx` (metadata only), `src/components/legal/LegalFooter.tsx`, `src/lib/seo/site.ts`, `src/lib/seo/indexNow.ts`, `scripts/indexnow.mjs`, `public/<indexnow key>.txt`.
- **seo-levels**: `src/components/seo/LevelPage.tsx` (+ its CSS module), `src/app/(platform)/math/page.tsx`, `src/app/(platform)/math/[slug]/opengraph-image.tsx` (for levels and skills), `src/lib/seo/levels.ts`, `src/components/landing/PracticePicker.tsx` (links only).
- **seo-skills**: `src/components/seo/SkillPage.tsx` (+ CSS), `src/lib/seo/skillContent.ts` (worked example, practice set, answers), `src/lib/seo/guides/hs.ts`.
- **seo-guides-k8**: `src/lib/seo/guides/k8.ts` only.
- **seo-ai**: `src/app/llms.txt/route.ts`, `src/app/llms-full.txt/route.ts`, `src/lib/seo/llms.ts`, `src/app/(platform)/about/page.tsx` (+ CSS), `scripts/seo-audit.mjs`.
- Contract (feat/seo, change only by agreement): `src/lib/seo/routes.ts`, `src/lib/seo/skillGuide.ts`, `src/components/seo/JsonLd.tsx`, `src/app/(platform)/math/[slug]/page.tsx`, this file.
- Tests go beside the code in `__tests__/`, one file per owner.

## Checks before a branch is done

- `npx vitest run src/lib/seo src/components/seo src/components/landing src/lib/landing` (plus your own tests), all green.
- `npx tsc --noEmit`.
- `npx eslint --ignore-pattern '.claude/**' <your files>`.
- For pages: `next build` succeeds and your pages are listed as static (○ or ●); then `next start` and `curl` each page with a Googlebot and a GPTBot user agent: 200, the words in the HTML, one `h1`, the JSON-LD parses. Delete `.next` afterwards (disk).
- Screenshots at 375, 820 and 1440 px in Chromium and WebKit, written to the scratchpad, never into the repo.
- Commit on your branch with a clear message. Do not push, do not open a PR, do not merge.

## Status (2026-10-13)

All five branches are merged into `feat/seo`. After `next build`, `next start` and `node scripts/seo-audit.mjs <base>`, the audit reads 75 pages, 0 errors and 0 warnings, as Googlebot and as GPTBot. The build prerenders 179 static pages.

**The owner's steps after the deploy (code can't do these):**
1. **Cloudflare: Security → Bots / AI Crawl Control.** Allow GPTBot, ClaudeBot and CCBot, which get a 403 today. Turn off "Block AI bots" and Cloudflare's managed robots.txt, then check the live `/robots.txt`. Also turn off Email Address Obfuscation, which hides the contact email from crawlers.
2. **Google Search Console.** Verify www.agathon.app: a DNS TXT record in Cloudflare, or `GOOGLE_SITE_VERIFICATION` in Vercel. Then submit `/sitemap.xml`.
3. **Bing Webmaster Tools.** Import from Search Console, or set `BING_SITE_VERIFICATION`. Then submit the sitemap. Bing feeds ChatGPT search and Copilot.
4. **IndexNow.** Run `node scripts/indexnow.mjs` once the pages are live, and again after big content changes.

**Next ideas (not built):**
- Comparison pages that name other products. These need the owner's OK.
- A worksheet PDF per skill.
- More skills as the app learns them: add a slug to `SKILL_SLUGS`; the test fails until there is one.
