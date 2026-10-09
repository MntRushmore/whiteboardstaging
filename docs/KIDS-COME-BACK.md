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
