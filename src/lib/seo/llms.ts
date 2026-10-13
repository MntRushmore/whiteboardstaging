/**
 * What Agathon is, for AI answer engines (ChatGPT, Claude, Perplexity, Gemini, Copilot) and for the
 * /about page (SEO build 2026-10-13, docs/SEO.md "AI search"): the one-sentence definition, the facts
 * at a glance, `/llms.txt` (the llmstxt.org index of the public site) and `/llms-full.txt` (the whole
 * public story as one plain markdown document).
 *
 * Every fact comes from the app's own sources, so nothing here can drift from the site:
 * - the landing page's words (LANDING_COPY, src/components/landing/copy.ts), questions included;
 * - the plan's name, price and free trial from `planWords` (src/lib/landing/plan.ts, which reads
 *   UNLIMITED_PLAN), the kid limit from MAX_KIDS and the day's set from the landing copy;
 * - each grade's skill path from `practiceTabs` and the courses' topics from `courseTopicIds`;
 * - each skill's address from routes.ts and its one line from TOPIC_INFO; its guide, where one is
 *   written, from SKILL_GUIDES;
 * - who runs Agathon and how to reach them from LEGAL (src/lib/legal.ts), the privacy promises from
 *   the Privacy Policy (src/app/(platform)/privacy/page.tsx; the tests hold each one to it).
 * Nothing here types a price, a trial length or a plan name. US English, plain sentences, no claims
 * the product cannot back (no ratings, counts or outcomes).
 *
 * Pure: no React, no network. The two routes and the /about page call these with the site's origin.
 */
import { landingCopy, type LandingCopy } from "@/components/landing/copy";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { DAILY_GOAL } from "@/lib/daily/contracts";
import { MAX_KIDS } from "@/lib/family/contracts";
import { GRADES } from "@/lib/learning/grades";
import { courseTopicIds, isTopicId, TOPIC_INFO, type TopicId } from "@/lib/learning/topics";
import { planWords, type LandingPlan } from "@/lib/landing/plan";
import { practiceTabs, usEnglish } from "@/lib/landing/practice";
import { LEGAL } from "@/lib/legal";
import { COURSES } from "@/lib/onboarding/courses";
import { pathSkillName } from "@/lib/path/pathView";
import {
  ABOUT_PATH,
  LEGAL_PATHS,
  LEVELS,
  MATH_PATH,
  SKILL_IDS,
  levelPath,
  publicPages,
  skillPath,
  type Level,
} from "./routes";
import { SKILL_GUIDES, type SkillGuide } from "./skillGuide";

/** The two plain-text addresses. */
export const LLMS_PATH = "/llms.txt";
export const LLMS_FULL_PATH = "/llms-full.txt";

/**
 * The sentence an answer engine quotes: what Agathon is, who it is for, and what makes it different
 * (handwriting, every line checked, a hint instead of the answer). The /about page opens with it and
 * both text files quote it.
 */
export const AGATHON_DEFINITION =
  "Agathon is an AI math tutor on a whiteboard for kindergarten to 8th grade and high school: kids work problems by hand, and the tutor checks every line, with a check mark for a right step, a circle around a slip, and a hint instead of the answer.";

// ------------------------------------------------------------------ small helpers

/** "a, b and c". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** A headline the copy breaks into lines ("Like paper.\nBut it writes back."), as one line. */
export function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/** The copy's bits of LaTeX as plain text a crawler reads: `$\frac{1}{2}$` is 1/2. */
export function plainMath(text: string): string {
  return text
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, top: string, bottom: string) => `${top}/${bottom}`)
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\$/g, "");
}

/** The skill path's courses (Algebra 1 …), without "Something else". */
function realCourses() {
  return COURSES.filter((c) => c.id !== "other");
}

/** A question from the landing page's Questions, found by its words; null if the copy changed (the tests say so). */
export function faqAnswer(copy: LandingCopy, question: RegExp): { q: string; a: string; link?: { href: string; label: string } } | null {
  const item = copy.faq.items.find((i) => question.test(i.q));
  if (!item) return null;
  return { q: item.q, a: item.a, ...("link" in item ? { link: item.link } : {}) };
}

/** The questions the facts lean on, by the words in them. */
export const FAQ = {
  ages: /what ages/i,
  needs: /what do we need/i,
  answers: /give them the answer/i,
  onlyMath: /only for math/i,
  data: /child's data/i,
  card: /need a card/i,
  cancel: /how do i cancel/i,
  siblings: /brothers and sisters/i,
} as const;

// ------------------------------------------------------------------ the facts

export interface Fact {
  /** "Grades" */
  term: string;
  /** one or two plain sentences */
  detail: string;
}

/**
 * Agathon at a glance: what it is, who it is for, what it covers, the devices, the price and the free
 * trial, the website, the contact and who makes it. Only facts the repo can source: no founding date,
 * no place, no team size. The /about page's `<dl>` and both text files list these.
 */
export function agathonFacts(origin: string, plan: LandingPlan = UNLIMITED_PLAN): Fact[] {
  const p = planWords(plan);
  const host = new URL(origin).host;
  return [
    { term: "Type", detail: "An AI math tutor on a whiteboard: a web app that runs in the browser, in beta." },
    {
      term: "Grades",
      detail: `Kindergarten to 8th grade, about ages 5 to 14, with a path of skills for each grade. High school students pick a course: ${listWords(realCourses().map((c) => c.label))}.`,
    },
    {
      term: "Subjects",
      detail: "Math, on the board. In Ask, kids can also ask about reading, writing, science or history and get an answer in the chat.",
    },
    {
      term: "Devices",
      detail: "A web browser on an iPad or other tablet, a phone, or a computer. Kids write with a finger or a stylus like Apple Pencil, or type their math on a laptop. There's nothing to install.",
    },
    { term: "Price", detail: `One plan, ${p.name}: ${p.price} ${p.per} for up to ${MAX_KIDS} kids. Cancel anytime, online.` },
    { term: "Free trial", detail: `Free for ${p.days}. A grown-up adds a card to start it, and nothing is charged until the trial ends.` },
    { term: "Website", detail: host },
    { term: "Contact", detail: LEGAL.contactEmail },
    { term: "Made by", detail: LEGAL.operatorName },
  ];
}

/**
 * How it works, in one paragraph: the board, the check marks and circles, Help me's three levels, Ask,
 * Type it, and what grown-ups see. Every clause is on the landing page (How it works, Ask, Devices,
 * For grown-ups).
 */
export function howItWorks(): string {
  return [
    "Kids write math by hand on a whiteboard in the browser, and each line is read as it's written.",
    "A right step gets a blue check mark; a slip gets a circle and a nudge to try again, never a red X.",
    "When they're stuck, Help me offers a Hint, the Next step written in the tutor's handwriting beside theirs, or Solve it; the full solution only appears if they choose it.",
    "Ask answers their questions, typed or said out loud, at their grade level; it can read the answer out loud and draw pictures like fraction bars and number lines on the board.",
    "On a laptop they can type their math, and the board writes it in their own handwriting and checks it.",
    `Grown-ups see each kid's skill path, Today's practice (${DAILY_GOAL} problems a day), Progress and a weekly report.`,
  ].join(" ");
}

/**
 * The Privacy Policy’s promises, in a parent’s words. `policy` holds the policy’s own words that back
 * each one (the tests find every one in the rendered policy), so this can only say what it says.
 */
export const PRIVACY_POINTS: readonly { text: string; policy: readonly string[] }[] = [
  {
    text: "No ads. Agathon never sells a child's data or shares it for advertising, and sends no marketing emails.",
    policy: ["No ads. We never sell your data or share it for advertising. We send no marketing emails."],
  },
  { text: "Their boards are not used to train AI models.", policy: ["We do not use your boards to train AI models."] },
  {
    text: "The AI that reads their work never gets their email address or the name on their account.",
    policy: ["never the child’s email address or display name"],
  },
  { text: "Children under 13 need a parent's consent.", policy: ["Children under 13 need a parent’s consent"] },
  {
    text: "A few of Agathon's staff may look at a child's boards and progress to fix a problem or to make the tutor better; every look is logged, and what they see is never shared.",
    policy: ["We look to fix problems and to make the tutor better", "Each look is logged", "it is never shared"],
  },
  {
    text: "A child's boards are private to their account: no public profiles, sharing or messaging with other users.",
    policy: ["A child’s boards are private to their account; there are no public profiles, sharing or messaging with other users."],
  },
  {
    text: "No advertising or analytics cookies, and no third-party trackers.",
    policy: ["We do not use advertising or analytics cookies, and there are no third-party trackers."],
  },
  {
    text: "A parent can delete the account, and everything in it, from the Account page at any time (if the plan is on, cancel it first).",
    policy: ["You can delete your account, and everything in it, at any time from your Account page.", "cancel it first"],
  },
  { text: "Accounts and boards are stored in the United States.", policy: ["Your account and boards are stored in the United States."] },
];

// ------------------------------------------------------------------ the math library

export interface SkillEntry {
  id: TopicId;
  path: string;
  /** the guide's title when it is written, else the skill's name in the app */
  name: string;
  /** one line with an example ("Like 864 ÷ 4") */
  blurb: string;
  /** the grades and courses it is on: "4th grade", "Algebra 1" */
  levels: string[];
}

export interface LevelEntry {
  level: Level;
  path: string;
  /** "3rd grade", "Algebra 1" */
  label: string;
  /** a course's line ("Equations, functions and graphs"); null for a grade */
  blurb: string | null;
  skills: TopicId[];
}

/** A grade or a course with its skills, in teaching order (the skill path, as the landing page shows it). */
export function levelEntries(): LevelEntry[] {
  const tabs = practiceTabs();
  return LEVELS.map((level): LevelEntry => {
    if (level.kind === "grade") {
      const tab = tabs.find((t) => t.kind === "grade" && t.grade === level.grade);
      const skills = tab?.kind === "grade" ? tab.skills.map((s) => s.id).filter(isTopicId) : [];
      return { level, path: levelPath(level), label: GRADES.find((g) => g.id === level.grade)?.label ?? level.slug, blurb: null, skills };
    }
    const course = COURSES.find((c) => c.id === level.course);
    return {
      level,
      path: levelPath(level),
      label: course?.label ?? level.slug,
      blurb: course ? usEnglish(course.blurb) : null,
      skills: courseTopicIds(level.course).filter(isTopicId),
    };
  });
}

/** Every skill page, with its one line and the grades and courses it is on. */
export function skillEntries(guides: Readonly<Partial<Record<TopicId, SkillGuide>>> = SKILL_GUIDES): SkillEntry[] {
  const levels = levelEntries();
  return SKILL_IDS.map((id) => ({
    id,
    path: skillPath(id),
    name: guides[id]?.title ?? usEnglish(pathSkillName(id)),
    blurb: usEnglish(TOPIC_INFO[id].blurb),
    levels: levels.filter((l) => l.skills.includes(id)).map((l) => l.label),
  }));
}

/** A level's name as a link: "3rd grade math", "Kindergarten math", "Algebra 1". */
function levelLinkName(entry: LevelEntry): string {
  return entry.level.kind === "grade" ? `${entry.label} math` : entry.label;
}

/** "Adding to 10, then Taking away to 10" for a grade; "Equations, functions and graphs: …" for a course. */
function levelNote(entry: LevelEntry, names: ReadonlyMap<TopicId, string>): string {
  const skills = entry.skills.map((id) => names.get(id) ?? id);
  if (entry.level.kind === "grade") return `The ${entry.label.toLowerCase()} skill path, in order: ${skills.join(", ")}.`;
  return `${entry.blurb ?? ""}${entry.blurb ? ". " : ""}Skills: ${skills.join(", ")}.`;
}

// ------------------------------------------------------------------ llms.txt

/** "4th grade. Like 864 ÷ 4." — where it is taught, then its one line. */
function skillNote(s: SkillEntry): string {
  const blurb = /[.!?]$/.test(s.blurb) ? s.blurb : `${s.blurb}.`;
  return s.levels.length ? `${listWords(s.levels)}. ${blurb}` : blurb;
}

/** A markdown link line: "- [name](url): note". */
function linkLine(origin: string, path: string, name: string, note: string): string {
  return `- [${name}](${origin}${path}): ${note}`;
}

/** The plan's name for the policy notes. */
function policyNotes(plan: LandingPlan): Record<(typeof LEGAL_PATHS)[number], { name: string; note: string }> {
  const p = planWords(plan);
  return {
    "/privacy": {
      name: "Privacy Policy",
      note: "What Agathon collects and why, the AI services it uses, who sees a child's boards, children under 13 (COPPA), and how a parent deletes a child's data.",
    },
    "/terms": { name: "Terms of Service", note: `The terms for using Agathon and ${p.name}: the free trial, renewal, how to cancel, and fair use.` },
    "/refunds": { name: "Refund Policy", note: `How refunds work for ${p.name}.` },
  };
}

/**
 * `/llms.txt` (llmstxt.org): the name, the definition as a quote, the key facts, then every public
 * page as a markdown link with a one-line note, under Product, Math library, Policies and Optional.
 * Absolute URLs on `origin`, every one a page from `publicPages()` (or llms-full.txt), every public
 * page linked once.
 */
export function llmsTxt(origin: string, plan: LandingPlan = UNLIMITED_PLAN, guides: Readonly<Partial<Record<TopicId, SkillGuide>>> = SKILL_GUIDES): string {
  const facts = agathonFacts(origin, plan);
  const skills = skillEntries(guides);
  const names = new Map(skills.map((s) => [s.id, s.name]));
  const levels = levelEntries();
  const policies = policyNotes(plan);
  const lines: string[] = [
    "# Agathon",
    "",
    `> ${AGATHON_DEFINITION}`,
    "",
    howItWorks(),
    "",
    "Key facts:",
    "",
    ...facts.map((f) => `- ${f.term}: ${f.detail}`),
    `- Privacy: ${PRIVACY_POINTS.map((point) => point.text).join(" ")}`,
    "",
    "## Product",
    "",
    linkLine(origin, "/", "Agathon", "The home page: how it works, Ask, what kids practice, what grown-ups see, the price, and the questions parents ask."),
    linkLine(origin, ABOUT_PATH, "What is Agathon?", "Agathon in plain facts: how it works, who it's for, what it covers, what it costs, devices, privacy, and who makes it."),
    "",
    "## Math library",
    "",
    linkLine(
      origin,
      MATH_PATH,
      "Math library",
      "Every grade from kindergarten to 8th grade and every high school course, each with its skill path. Each skill's page has a worked example, the usual slips, and practice problems with answers.",
    ),
    ...levels.map((l) => linkLine(origin, l.path, levelLinkName(l), levelNote(l, names))),
    ...skills.map((s) => linkLine(origin, s.path, s.name, skillNote(s))),
    "",
    "## Policies",
    "",
    ...LEGAL_PATHS.map((path) => linkLine(origin, path, policies[path].name, policies[path].note)),
    "",
    "## Optional",
    "",
    linkLine(origin, LLMS_FULL_PATH, "llms-full.txt", "The whole public story in one plain document: the home page's words, every question parents ask with its answer, each grade's skill path, and every skill guide."),
    "",
  ];
  return lines.join("\n");
}

// ------------------------------------------------------------------ llms-full.txt

function guideText(origin: string, entry: SkillEntry, guide: SkillGuide, names: ReadonlyMap<TopicId, string>): string[] {
  const out = [`### ${guide.title}`, "", `${origin}${entry.path}${entry.levels.length ? ` (${listWords(entry.levels)})` : ""}`, "", guide.what, "", "How to do it:", ""];
  guide.steps.forEach((step, i) => out.push(`${i + 1}. ${step}`));
  out.push("", "Slips kids make:", "");
  for (const s of guide.slips) out.push(`- ${s.slip} ${s.fix}`);
  out.push("", "Questions parents ask:", "");
  for (const f of guide.faq) out.push(`- ${f.q} ${f.a}`);
  const related = guide.related.filter((id) => names.has(id));
  if (related.length) out.push("", `Related skills: ${related.map((id) => `${names.get(id)} (${origin}${skillPath(id)})`).join(", ")}.`);
  out.push("");
  return out;
}

/**
 * `/llms-full.txt`: the whole public story as one markdown document. The definition and the facts,
 * the home page section by section (every question with its answer), each grade's skill path, every
 * skill guide written so far, the privacy promises and who to contact. Built from the same sources as
 * the pages, so it cannot drift from the site.
 */
export function llmsFullTxt(origin: string, plan: LandingPlan = UNLIMITED_PLAN, guides: Readonly<Partial<Record<TopicId, SkillGuide>>> = SKILL_GUIDES): string {
  const copy = landingCopy(plan);
  const p = planWords(plan);
  const skills = skillEntries(guides);
  const names = new Map(skills.map((s) => [s.id, s.name]));
  const byId = new Map(skills.map((s) => [s.id, s]));
  const levels = levelEntries();
  const [pick, write, stuck] = copy.how.steps;
  const out: string[] = [
    "# Agathon",
    "",
    `> ${AGATHON_DEFINITION}`,
    "",
    `This is everything on Agathon's public pages in one plain document, from the same words as the site. The short index is ${origin}${LLMS_PATH}; the home page is ${origin}/.`,
    "",
    "## Agathon at a glance",
    "",
    ...agathonFacts(origin, plan).map((f) => `- ${f.term}: ${f.detail}`),
    "",
    howItWorks(),
    "",
    "## The home page",
    "",
    `${origin}/`,
    "",
    `### ${oneLine(copy.hero.title)}`,
    "",
    `${copy.hero.eyebrow}. ${copy.hero.lede}`,
    "",
    copy.hero.terms,
    "",
    `### ${copy.how.eyebrow}: ${oneLine(copy.how.title)}`,
    "",
    `1. ${oneLine(pick.title)} ${pick.body}`,
    `2. ${oneLine(write.title)} ${write.body}`,
    `3. ${oneLine(stuck.title)} ${"bodyBefore" in stuck ? `${stuck.bodyBefore} ${stuck.helpButton} ${stuck.bodyAfter}` : ""}`,
    "",
    `### ${copy.ask.eyebrow}: ${oneLine(copy.ask.title)}`,
    "",
    copy.ask.lede,
    "",
    ...copy.ask.features.map((f) => `- ${f.title}: ${f.body}`),
    "",
    `For example, a kid asks: “${copy.ask.question}” The tutor answers: “${plainMath(copy.ask.answer)}”`,
    "",
    `### ${copy.devices.eyebrow}: ${oneLine(copy.devices.title)}`,
    "",
    copy.devices.lede,
    "",
    ...copy.devices.items.map((d) => `- ${d.name}. ${d.title} ${d.body}`),
    "",
    `### ${copy.practice.eyebrow}: ${copy.practice.title}`,
    "",
    `${copy.practice.lede} Each grade's path is listed below, under "Skill paths".`,
    "",
    `### ${copy.grownUps.eyebrow}: ${oneLine(copy.grownUps.title)}`,
    "",
    copy.grownUps.lede,
    "",
    ...copy.grownUps.features.map((f) => `- ${f.title}: ${f.body}`),
    "",
    `### ${copy.pricing.eyebrow}: ${oneLine(copy.pricing.title)}`,
    "",
    `${copy.pricing.plan}: ${copy.pricing.price} ${copy.pricing.per}. ${copy.pricing.trial}`,
    "",
    `${copy.pricing.includesLabel}:`,
    "",
    ...copy.pricing.includes.map((i) => `- ${i}`),
    "",
    copy.pricing.fine,
    "",
    `### ${copy.faq.title}`,
    "",
  ];
  for (const item of copy.faq.items) {
    out.push(`**${item.q}**`, "", item.a, "");
  }
  out.push(`### ${oneLine(copy.join.title)}`, "", `${copy.join.body} ${copy.join.terms}`, "");

  out.push("## Skill paths", "", `Each grade's skills, in the order schools teach them, and the skills of each high school course. Every grade, course and skill has its own page in the math library at ${origin}${MATH_PATH}.`, "");
  for (const level of levels) {
    out.push(`### ${level.label}`, "", `${origin}${level.path}`, "");
    if (level.blurb) out.push(`${level.blurb}.`, "");
    level.skills.forEach((id, i) => {
      const s = byId.get(id);
      // a grade's path is an order; a course's skills are a list
      if (s) out.push(`${level.level.kind === "grade" ? `${i + 1}.` : "-"} ${s.name}: ${s.blurb} (${origin}${s.path})`);
    });
    out.push("");
  }

  const written = skills.filter((s) => guides[s.id]);
  if (written.length) {
    out.push("## Skill guides", "", "What each skill is, how to do it, the slips kids make, and the questions parents ask.", "");
    for (const s of written) out.push(...guideText(origin, s, guides[s.id]!, names));
  }

  out.push("## Privacy and kids' data", "", ...PRIVACY_POINTS.map((point) => `- ${point.text}`), "", `The Privacy Policy: ${origin}/privacy`, "");
  out.push(
    "## Who makes Agathon",
    "",
    `Agathon is made and run by ${LEGAL.operatorName}. Questions, refunds and anything about a child's account: ${LEGAL.contactEmail}.`,
    "",
    `The Terms of Service (${origin}/terms) and the Refund Policy (${origin}/refunds) cover ${p.name}, its free trial and how to cancel.`,
    "",
  );
  return out.join("\n");
}

/** Every absolute link in a text file (markdown `](url)` and bare `https://…`), for the tests and the audit. */
export function linksIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s)<>"”]+/g)].map((m) => m[0].replace(/[.,;:]+$/, ""));
}

/** The paths the text files may link: every public page and the two text files. */
export function linkablePaths(): Set<string> {
  return new Set([...publicPages().map((page) => page.path), LLMS_PATH, LLMS_FULL_PATH]);
}
