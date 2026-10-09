# Kids come back (Phase 1, 2026-10-09)

**Goal: $1k MRR, which is 40 paying families at $25/mo.**

Prod on 2026-10-08:
- 66 sign-ups and 14 trials.
- Only 5 of the 14 trial users came back on a second day.
- The skills practised most are primary-school ones: adding, times tables, fractions. But the welcome offered Algebra 1 first, and half of users picked "Something else" or skipped it.
- Nobody knows where sign-ups come from.

Phase 1 makes a kid want to come back every day, and lets a parent run it for more than one kid.

| Part | Branch | What it is |
|---|---|---|
| Grades | `feat/kcb-onboarding` | The welcome asks for the grade (K–8) or a high-school course, and "How did you hear about us?". Each grade gets its own starter problems, and the grade can be changed later. |
| K–8 skills | `feat/kcb-catalog` | 23 finer arithmetic skills (`grades.ts`): their generators and the classifier that files problems under them. Topics follow the grade, and old rows are re-filed when read. |
| Today's practice | `feat/kcb-daily` | One big button on home opens a 5-problem daily set. The board shows stars and celebrates at the goal, and the home shows a streak with this week's days. |
| Skill path | `feat/kcb-path` | The grade's skills as a trail on home and Progress, showing mastery and the next skill. Tapping a skill opens its topic board. |
| Families | `feat/kcb-family` | A grown-up adds kid profiles (name, grade, picture). Kids switch by picture; getting back to the grown-up needs the grown-up's PIN. Kids share the plan, and a family page shows each kid's numbers. |
| Funnel | `feat/kcb-funnel` | Sign-up attribution, an admin Funnel page (cohorts, sources, MRR), trial nudge emails, and a guard that never emails a kid address. |
| Engine | `feat/kcb-engine` | Young kids' work judged right: side calculations, multiplication in columns, long division and fraction steps. Fixes outcome and ring counts that disagree. |

## The contract (commit on `feat/kids-come-back`)

- `src/lib/learning/grades.ts`: the grades, K–8 skill ids and names, `GRADE_PATHS`, `gradePath`.
- `src/lib/daily/contracts.ts` and `dailyMarker.ts`: the daily set's types, goal, streak and device marker.
- `src/lib/family/contracts.ts`: kid addresses (`isKidEmail`), avatars, PIN rule, the `/api/family` shapes.
- `src/lib/funnel/contracts.ts`: `HEARD_FROM`, `Attribution`, the funnel stages, `FunnelReport`.
- `src/lib/learning/profile.ts`: `readLearnerProfile` now also returns `grade` and `avatar`.
- `supabase/migrations/20261009000000_kids_come_back.sql`:
  - `profiles` gets `grade`, `heard_from`, `attribution` and `avatar`.
  - New RPCs: `save_onboarding` v2, `save_attribution` and `save_daily_practice`.
  - New tables: `daily_practice`, `families` and `family_members`.
- Slots, each loaded with a dynamic import and empty until its part fills it in:
  - `TodayCard` and `SkillPathCard` on the home.
  - `ProfileSwitcher` in the app bar.
  - `DailyBoard` on the board, mounted when `hasDailyMarker` finds the board's marker.

Each part's own migration gets its own timestamp:
- `20261009010000_family_plan.sql` (family)
- `20261009020000_funnel.sql` (funnel)
- `20261009030000_daily.sql` (daily, only if it needs one)

## Rules

- The board's first load has about 10 KB of budget left (`docs/BUNDLE.md`), so anything new on the board loads with a dynamic import. The home's first load stays lean too.
- Nothing ever emails a kid address, and kids never see billing.
- Never touch prod. That means no Management API, no Vercel env, no live Stripe and no real emails.

# Phases 2 and 3 (2026-10-09, overnight)

**Phase 2, parents recommend it:**

| Part | Branch | What it is |
|---|---|---|
| Weekly report | `feat/kcb2-report` | `/report` shows each child's week: problems, skills mastered, the next thing to work on, and a replay to watch. The Sunday email is built but OFF unless `WEEKLY_REPORT_EMAILS=on`, with one-tap opt-out. |
| Share | `feat/kcb2-share` | A progress card picture to share or save, and the replay saved as a video. |
| Referrals | `feat/kcb2-referral` | "Give a month, get a month": a code per grown-up, referrals recorded, a share link, and an admin list of rewards due. |
| Plan choice | `feat/kcb2-annual` | One monthly plan; the yearly plan was dropped on 2026-10-09 because the owner will raise the monthly price instead. A referred family is sent to the referral Payment Link, and the funnel's MRR leaves out admins. Every price on every screen comes from `UNLIMITED_PLAN`, so a price change is one edit. |
| Parent landing | `feat/kcb2-landing` | `/parents` for signed-out visitors: what it is, how it works, what kids practise, pricing, and an FAQ. No made-up testimonials or numbers. Signed-out `/` goes here. |

**Phase 3, the board for little kids:**

| Part | Branch | What it is |
|---|---|---|
| Read aloud | `feat/kcb3-voice` | Hints and questions spoken by ElevenLabs (`/api/live/speak`), falling back to the browser's voice. On by default for K–2. |
| Simple board | `feat/kcb3-kidmode` | A board with fewer, bigger buttons for young kids (K–3 by default, switchable). |

**Contract (Phases 2 and 3):**
- Types:
  - `src/lib/report/contracts.ts`
  - `src/lib/referral/contracts.ts`
  - `src/lib/billing/planChoice.ts`
  - `src/lib/speech/contracts.ts`
- `supabase/migrations/20261009100000_parents_recommend.sql`:
  - `profiles.referral_code` and `profiles.weekly_report_opt_out`
  - the `referrals` table

Each part's own migration:
- `20261009110000_referrals.sql`, then `20261009140000_referral_hardening.sql` (its review fixes)
- `20261009120000_weekly_report.sql`
- `20261009130000_billing_followups.sql` (if needed)

**Stripe objects the owner makes, optional:**
- The referral Payment Link (30-day trial) → `NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK`
