/**
 * Every word on the parent landing page (/parents), in one place. Written for a parent who was sent
 * a link and has never heard of Agathon: short, plain sentences that say what the product does
 * today, and nothing it does not. No testimonials, ratings, user counts, outcome numbers, school
 * logos or press.
 *
 * Every price, trial length and plan name comes from the plan (`planWords`, from UNLIMITED_PLAN), the
 * kid limit from MAX_KIDS, the day's set from DAILY_GOAL and the courses from COURSES, so the page
 * cannot drift from the app. `landingCopy(plan)` lets the tests check that with another price.
 */
import { DAILY_GOAL } from "@/lib/daily/contracts";
import { MAX_KIDS } from "@/lib/family/contracts";
import { planWords, type LandingPlan } from "@/lib/landing/plan";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { COURSES } from "@/lib/onboarding/courses";

/** "Algebra 1, Geometry, Algebra 2 and Pre-calculus / Calculus": the courses a high-schooler picks from. */
function courseList(): string {
  const labels = COURSES.filter((c) => c.id !== "other").map((c) => c.label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : (labels[0] ?? "");
}

/** The page's words for a plan (UNLIMITED_PLAN unless a test passes another). */
export function landingCopy(plan: LandingPlan = UNLIMITED_PLAN) {
  const p = planWords(plan);
  return {
    meta: {
      title: "Math practice kids actually do",
      ogTitle: "Agathon: math practice kids actually do",
      description: `A math whiteboard for kindergarten to 8th grade. Kids work problems by hand, and a tutor ticks each right step, rings a slip and gives a hint instead of the answer. Free for ${p.days}.`,
      ogAlt: "Agathon: math practice kids actually do. Sums written by hand on a whiteboard, ticked and ringed in blue by the tutor.",
    },
    nav: {
      signIn: "Sign in",
      cta: "Try it free",
    },
    hero: {
      eyebrow: "Kindergarten to 8th grade",
      title: "Math practice kids actually do.",
      lede: "Kids work problems by hand on a whiteboard, with a finger or a pen. A tutor checks each line as they write: a tick for a right step, a ring round a slip, a hint instead of the answer.",
      start: p.start,
      signIn: "Sign in",
      terms: p.terms,
    },
    replay: {
      /** the picture's description, for a screen reader */
      label:
        "An Agathon board on an iPad. Five sums are written by hand, one after another. The tutor ticks 7 + 5 = 12, rings 9 − 3 = 5 and says “So close! Try that step again.”, then ticks 6 × 4 = 24, a half plus a quarter is three quarters, and 12 − 4 = 8.",
      tick: "A right step",
      ring: "Take another look",
      again: "Watch again",
    },
    how: {
      eyebrow: "How it works",
      title: "Like paper.\nBut it writes back.",
      steps: [
        {
          label: "Step 1",
          title: "Pick their grade.",
          body: "Kindergarten to 8th grade, or a high school course. Agathon lays out that grade's skills as a path, and the first problems are waiting on the board.",
          alt: "A 3rd grader's home in Agathon: their path, with 3-digit adding and subtracting done (three stars), Times tables next up (two stars), then Division facts and Multiplying by tens; under it, Up next: Times tables, with a Start button.",
        },
        {
          label: "Step 2",
          title: "They write. It checks.",
          body: "Each line is read as it's written. A right step gets a blue tick and a cheer. A slip gets a ring and a nudge to try again, never a red cross.",
          alt: "An Agathon board: 7 + 5 = 12 and 12 − 4 = 8 ticked in blue, and 9 − 3 = 5 ringed, with the note “So close! Try that step again.”",
        },
        {
          label: "Step 3",
          title: "Stuck?\nOne step at a time.",
          /** the body around the Help me button: "Tap [Help me] and the tutor…" */
          bodyBefore: "Tap",
          helpButton: "Help me",
          bodyAfter: "and the tutor writes just the next step, in its own handwriting, under theirs. The whole worked solution only appears if they ask for it.",
          alt: "The ringed line 9 − 3 = 5 on an Agathon board, with the tutor's step 9 − 3 = 6 written underneath in blue handwriting.",
        },
      ],
    },
    practice: {
      eyebrow: "What they'll practise",
      title: "A path for every grade.",
      lede: "Each grade's skills, in the order schools teach them. Pick a grade to see its path.",
      legend: "Choose a grade",
    },
    grownUps: {
      eyebrow: "For grown-ups",
      title: "Their progress,\nat a glance.",
      lede: "You don't have to sit beside them to know how it's going.",
      alt: "Agathon's Progress page: a 3rd grade path with 1 of 4 skills mastered, and this week's 8 minutes of practice, 7 problems worked on, 6 solved on their own and 2 days in a row.",
      features: [
        {
          title: "Today's practice",
          body: `One button opens the day's ${DAILY_GOAL} problems, picked from their path. Stars as they go, and a streak for every day they keep it up.`,
        },
        {
          title: "The path and Progress",
          body: "Stars show how strong each skill is. Progress shows their week: time spent, problems worked, and how many they solved on their own.",
        },
        {
          title: "A profile for each kid",
          body: `Up to ${MAX_KIDS} kids, each with their own name, grade, picture and boards. They switch by tapping their picture; getting back to yours takes your PIN.`,
        },
        {
          title: "A weekly report",
          body: "Each child's week on one page: what they practised, the skills they mastered, what to work on next, and a replay to watch.",
        },
      ],
    },
    pricing: {
      eyebrow: "Pricing",
      title: "One plan.\nEvery kid in the family.",
      plan: p.name,
      price: p.price,
      per: p.per,
      trial: `Free for the first ${p.days}.`,
      includes: [
        "Every kid in the family included",
        "Help from the tutor on every board",
        "Today's practice, the skill path and Progress",
        "A weekly report for you",
      ],
      start: p.start,
      fine: `Nothing is charged for ${p.days}. We email you before the trial ends, and you can cancel online in a few clicks.`,
    },
    faq: {
      eyebrow: "Questions",
      title: "Questions parents ask.",
      items: [
        {
          q: "What ages is it for?",
          a: `Kindergarten to 8th grade, about ages 5 to 14, with a path of skills for each grade. Older students can pick a course instead: ${courseList()}.`,
        },
        {
          q: "What do we need?",
          a: "A web browser on an iPad or other tablet, a phone, or a computer. Kids write with a finger, a stylus like Apple Pencil, or a mouse. There's nothing to install.",
        },
        {
          q: "Does it just give them the answer?",
          a: "No. It marks their work first: a tick for a right step, a ring round a slip, and a nudge to try again. When they're stuck, Help me writes one step at a time. The whole worked solution only appears if they choose Solve.",
        },
        {
          q: "What happens to my child's data?",
          a: "We never sell it, show ads, or share it for advertising. Their boards aren't used to train AI models, and the AI that reads their work never gets their email address or the name on their account. Our staff may look at a board to fix a problem, and every look is logged. Children under 13 need a parent's consent, and you can delete the account, and everything in it, at any time.",
          link: { href: "/privacy", label: "Read the Privacy Policy" },
        },
        {
          q: `Do I need a card for the free ${p.trial}?`,
          a: `Yes. A grown-up adds a card to start the trial, and nothing is charged for ${p.days}. We email you a reminder a few days before it ends.`,
        },
        {
          q: "How do I cancel?",
          a: "Online, in a few clicks: on your Account page, choose Manage or cancel. Cancel before the trial ends and you pay nothing.",
        },
        {
          q: "Can brothers and sisters share it?",
          a: `Yes. One plan covers up to ${MAX_KIDS} kids. Each gets their own profile, boards, path and progress, and they switch by tapping their picture.`,
        },
      ],
    },
    closing: {
      title: `Try it free for ${p.days}.`,
      body: "Sign up with an email and a password, pick their grade, and the first problems are waiting on the board.",
      start: p.start,
      signIn: "Sign in",
    },
  } as const;
}

export type LandingCopy = ReturnType<typeof landingCopy>;

export const LANDING_COPY: LandingCopy = landingCopy();
