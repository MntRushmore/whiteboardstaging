import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { HandMath, handMathMs } from "@/components/landing/HandMath";
import { InkCheck, InkCircle } from "@/components/landing/InkMark";
import { INK_START_SCRIPT } from "@/components/landing/inkStart";
import landing from "@/components/landing/landing.module.css";
import { SKILLS } from "@/lib/learning/contracts";
import { GRADE_IDS, GRADE_PATHS, GRADES, type Grade } from "@/lib/learning/grades";
import { isTopicId, keepMathsTogether, TOPIC_PROBLEMS, type TopicId } from "@/lib/learning/topics";
import { LANDING_PATH, SIGN_UP_HREF, siteOrigin } from "@/lib/landing/links";
import { planWords } from "@/lib/landing/plan";
import { usEnglish } from "@/lib/landing/practice";
import { pathSkillName } from "@/lib/path/pathView";
import { levelName } from "@/lib/seo/levels";
import { COURSE_SLUGS, coursePath, gradePath, MATH_PATH, skillPath, type SeoCourseId } from "@/lib/seo/routes";
import { OPEN_GRAPH_DEFAULTS } from "@/lib/seo/site";
import { skillGuide, type SkillGuide } from "@/lib/seo/skillGuide";
import { PRACTICE_COUNT, skillContent, type MathLine, type SkillContent, type WorkedExample } from "@/lib/seo/skillContent";
import { JsonLd, type JsonLdThing } from "./JsonLd";
import { LibraryNav } from "./LevelPage";
import styles from "./skillPage.module.css";

/**
 * One skill's page in the math library (`/math/long-division`, docs/SEO.md): what the skill is, one
 * problem worked out by the tutor in its own hand, how to do it, where kids slip, ten practice
 * problems with an answer key (a clean worksheet when printed), what Agathon does with the skill,
 * the questions parents ask, and the skills next to it.
 *
 * The math is the app's own: the problems come from the skill's generators and are worked and
 * answered by the board's engine at build time (`skillContent`); the words are the skill's guide
 * (`skillGuide`, written by hand). Until a skill has a guide, the page shows the math alone, under
 * the app's own name for the skill, and leaves the guide's sections out.
 *
 * A static server component in the landing page's look (its tokens, HandMath, InkMark, flat fills).
 * Every line of math is real text beside its handwriting, which is aria-hidden.
 */

// ------------------------------------------------------------------ words

/** "four": the topic board's count in words. */
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"] as const;
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);

export const SKILL_PAGE_COPY = {
  breadcrumb: "Breadcrumb",
  home: "Agathon",
  math: "Math",
  jump: {
    example: "Worked example",
    practice: "Practice problems",
    answers: "Answer key",
  },
  exampleTitle: "Watch one worked out",
  exampleLede: "The tutor writes the problem, then works it under it, one line at a time, as it does on the board.",
  exampleLedeKid: "Worked one line at a time, the way kids write it on the board. The tutor checks each line as it's written, and every line here gets a check mark.",
  problemLabel: "Problem",
  answerLabel: "Answer",
  stepsTitle: "How to do it",
  slipsTitle: ["Where kids", "slip"] as const,
  slipsLede: "The tutor circles a slip like these on the board, then nudges them to try that step again.",
  fixLabel: "The fix:",
  practiceTitle: "Practice problems",
  practiceLede: (n: number) => `${countWord(n).replace(/^./, (c) => c.toUpperCase())} problems, from easy to harder. The answers are in the key below.`,
  printHint: "Printing this page gives a clean worksheet: the problems, then the answer key on its own page.",
  answersTitle: "Answer key",
  answersShow: "Show the answers",
  keyNumber: "#",
  keyProblem: "Problem",
  keyAnswer: "Answer",
  intervalNote: (interval: string) => `for ${interval}`,
  printName: "Name",
  printDate: "Date",
  agathonEyebrow: "On Agathon",
  agathonTitle: "Practice this on Agathon",
  agathonFacts: (skill: string, workedExample: boolean) =>
    [
      {
        title: "They write, it checks",
        body: "Kids work each problem by hand on the board, and every line is read as it's written. A right step gets a blue check mark. A slip gets a circle and a nudge to try again, never a red X.",
      },
      {
        title: "Hints, not answers",
        body: "Tap Help me and choose how much: a Hint, or the Next step written in the tutor's own handwriting beside theirs. The whole solution only appears if they choose Solve it.",
      },
      {
        title: "New problems every time",
        body: `Choose ${skill} under Pick a topic and the tutor ${workedExample ? "works one example, then writes" : "writes"} ${countWord(TOPIC_PROBLEMS)} new problems, each a bit harder than the last.`,
      },
    ] as const,
  onPath: (level: string) => `It's on Agathon's ${level} path, and any student can pick it as a topic.`,
  inCourses: (courses: readonly string[]) => `It's in Agathon's ${joinWords(courses)} ${courses.length > 1 ? "courses" : "course"}, and any student can pick it as a topic.`,
  anyTopic: "Any student can pick it as a topic.",
  join: "Join Agathon",
  faqTitle: "Questions parents ask",
  relatedTitle: "Related skills",
  allSkills: (level: string) => `Every ${level} skill`,
  library: "The math library",
  /** the lede when a skill has no guide yet */
  fallbackLede: `A worked example and ${PRACTICE_COUNT} practice problems with an answer key, made and worked by the same math engine that checks kids' work on Agathon.`,
} as const;

// ------------------------------------------------------------------ levels

interface LevelRef {
  label: string;
  path: string;
}

function gradesOf(id: TopicId): Grade[] {
  return GRADE_IDS.filter((g) => (GRADE_PATHS[g] as readonly string[]).includes(id));
}

function coursesOf(id: TopicId): SeoCourseId[] {
  const courses = (SKILLS.find((s) => s.id === id)?.courses ?? []) as readonly string[];
  return courses.filter((c): c is SeoCourseId => c in COURSE_SLUGS);
}

const gradeName = (g: Grade) => GRADES.find((x) => x.id === g)!.label;
/** A course as the library's level pages name it ("Algebra 1", "Precalculus and calculus"). */
const courseName = (c: SeoCourseId) => levelName({ kind: "course", course: c, slug: COURSE_SLUGS[c] });

function joinWords(words: readonly string[]): string {
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : (words[0] ?? "");
}

/** The grade that first teaches it, else its first course; null for a skill on neither (unit conversions). */
export function skillLevel(id: TopicId): LevelRef | null {
  const [grade] = gradesOf(id);
  if (grade !== undefined) return { label: gradeName(grade), path: gradePath(grade) };
  const [course] = coursesOf(id);
  return course ? { label: courseName(course), path: coursePath(course) } : null;
}

/** "4th grade", "2nd and 3rd grade", "Algebra 1 and Algebra 2"; null when it is on no path. */
export function skillLevelText(id: TopicId): string | null {
  const grades = gradesOf(id);
  if (grades.length > 0) {
    const labels = grades.map(gradeName);
    // "2nd and 3rd grade", not "2nd grade and 3rd grade"
    return labels.length > 1 && labels.every((l) => / grade$/.test(l)) ? `${joinWords(labels.map((l) => l.replace(/ grade$/, "")))} grade` : joinWords(labels);
  }
  const courses = coursesOf(id).map(courseName);
  return courses.length > 0 ? joinWords(courses) : null;
}

// ------------------------------------------------------------------ names, titles, descriptions

/** The skill's name in a sentence's case: the guide's title, else the app's own name (US English). */
export function skillName(id: TopicId, guide: SkillGuide | null = skillGuide(id)): string {
  return guide?.title ?? usEnglish(pathSkillName(id));
}

/** The h1: "Long division practice", or "Practice adding fractions with unlike denominators" for a name that starts with a verb. */
export function practiceHeading(name: string): string {
  const [first, ...rest] = name.split(" ");
  if (rest.length > 0 && /^[A-Z][a-z]+ing$/.test(first)) return `Practice ${first.toLowerCase()} ${rest.join(" ")}`;
  return `${name} practice`;
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with", "vs"]);

/** "Adding Fractions with Unlike Denominators", "Two-Step Equations". */
export function titleCase(text: string): string {
  return text
    .split(" ")
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : word.replace(/(^|-)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())))
    .join(" ");
}

/** The root layout's suffix on every title. */
const TITLE_SUFFIX = " · Agathon";
export const TITLE_MAX = 60;

/** The page's title, the search words first: the longest of these that fits in 60 characters with the suffix. */
export function skillTitle(name: string): string {
  const n = titleCase(name);
  const room = TITLE_MAX - TITLE_SUFFIX.length;
  const options = [`${n} Practice: Worked Example & Problems`, `${n} Practice Problems with Answers`, `${n} Practice with Answers`, `${n} Practice`, n];
  return options.find((t) => t.length <= room) ?? `${n.slice(0, room - 1).trimEnd()}…`;
}

export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 160;

/** What the page gives, 120–160 characters: the first of these that fits. */
export function skillDescription(name: string, level: string | null, hasGuide: boolean): string {
  const n = PRACTICE_COUNT;
  const who = level ? `${name} for ${level}` : name;
  const options = hasGuide
    ? [
        `${who}: a worked example, step by step, the slips kids make and how to fix them, and ${n} practice problems with an answer key.`,
        `${who}: a worked example, the slips kids make, and ${n} practice problems with an answer key you can print.`,
        `${name}: a worked example, the slips kids make, and ${n} practice problems with an answer key you can print.`,
        `${name}: a worked example, the slips kids make and how to fix them, and ${n} practice problems with an answer key you can print, free.`,
      ]
    : [
        `${who}: a worked example, step by step, and ${n} practice problems with an answer key you can print. Free, with no sign-up.`,
        `${name}: a worked example, step by step, and ${n} practice problems with an answer key you can print. Free, with no sign-up.`,
        `${who}: a worked example, step by step, and ${n} practice problems with an answer key you can print as a worksheet. Free, with no sign-up.`,
      ];
  const fits = options.find((d) => d.length >= DESCRIPTION_MIN && d.length <= DESCRIPTION_MAX);
  if (fits) return fits;
  // a very long name: the shortest option, cut at a word
  const short = options.reduce((a, b) => (a.length <= b.length ? a : b));
  return short.length <= DESCRIPTION_MAX ? short : `${short.slice(0, DESCRIPTION_MAX - 1).replace(/\s+\S*$/, "")}…`;
}

export interface SkillWords {
  id: TopicId;
  guide: SkillGuide | null;
  name: string;
  h1: string;
  title: string;
  description: string;
  lede: string;
  level: LevelRef | null;
  levelText: string | null;
  path: string;
}

export function skillWords(id: TopicId, guide: SkillGuide | null = skillGuide(id)): SkillWords {
  const name = skillName(id, guide);
  const levelText = skillLevelText(id);
  return {
    id,
    guide,
    name,
    h1: practiceHeading(name),
    title: skillTitle(name),
    description: skillDescription(name, skillLevel(id) ? (skillLevel(id)!.label) : null, Boolean(guide)),
    lede: guide?.what ?? SKILL_PAGE_COPY.fallbackLede,
    level: skillLevel(id),
    levelText,
    path: skillPath(id),
  };
}

/** A guide's words with their bits of math held on one line (`6 × 7 = 42` never breaks at its `=`). */
function prose(text: string): string {
  return keepMathsTogether(text);
}

/** A skill as a link elsewhere on the page: its guide's title, else the app's name. */
function linkName(id: TopicId): string {
  return skillName(id);
}

/**
 * The skills to link: the guide's, else the ones beside it on its path (the one before and the
 * one after on its grade's path, or its course's list), never itself.
 */
export function relatedSkills(id: TopicId, guide: SkillGuide | null = skillGuide(id)): TopicId[] {
  const own = (guide?.related ?? []).filter((r) => isTopicId(r) && r !== id);
  if (own.length > 0) return [...new Set(own)];
  const [grade] = gradesOf(id);
  const list: readonly string[] =
    grade !== undefined
      ? [...(GRADE_PATHS[(grade - 1) as Grade] ?? []).slice(-1), ...GRADE_PATHS[grade], ...(GRADE_PATHS[(grade + 1) as Grade] ?? []).slice(0, 1)]
      : SKILLS.filter((s) => (s.courses as readonly string[]).some((c) => coursesOf(id).includes(c as SeoCourseId))).map((s) => s.id);
  const ids = [...new Set(list)].filter((x): x is TopicId => isTopicId(x));
  const at = ids.indexOf(id);
  if (at === -1) return ids.filter((x) => x !== id).slice(0, 3);
  return [ids[at - 1], ids[at + 1], ids[at + 2]].filter((x): x is TopicId => Boolean(x) && x !== id).slice(0, 3);
}

// ------------------------------------------------------------------ metadata and structured data

function origin(): string {
  return siteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
}

/** Agathon › Math › 4th grade › Long division, as the library's level pages start theirs; the last step is this page. */
export function skillCrumbs(w: Pick<SkillWords, "level" | "name" | "path">): { name: string; path: string }[] {
  return [
    { name: SKILL_PAGE_COPY.home, path: LANDING_PATH },
    { name: SKILL_PAGE_COPY.math, path: MATH_PATH },
    ...(w.level ? [{ name: w.level.label, path: w.level.path }] : []),
    { name: w.name, path: w.path },
  ];
}

export function skillMetadata(id: TopicId): Metadata {
  const w = skillWords(id);
  return {
    title: w.title,
    description: w.description,
    alternates: { canonical: w.path },
    robots: { index: true, follow: true },
    openGraph: {
      ...OPEN_GRAPH_DEFAULTS,
      url: w.path,
      title: `${w.title}${TITLE_SUFFIX}`,
      description: w.description,
    },
    twitter: {
      card: "summary_large_image",
      title: `${w.title}${TITLE_SUFFIX}`,
      description: w.description,
    },
  };
}

/** The page's JSON-LD: the resource itself, where it sits, and the guide's questions (only what the page shows). */
export function skillJsonLd(w: SkillWords): JsonLdThing[] {
  const base = origin();
  const absolute = (path: string) => new URL(path, `${base}/`).toString();
  const url = absolute(w.path);
  const crumbs = skillCrumbs(w).map((c) => ({ name: c.name, url: absolute(c.path) }));
  const things: JsonLdThing[] = [
    {
      "@context": "https://schema.org",
      "@type": "LearningResource",
      name: w.h1,
      description: w.description,
      url,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      learningResourceType: "Worked example, practice problems",
      ...(w.levelText ? { educationalLevel: w.levelText } : {}),
      teaches: w.name,
      provider: { "@type": "Organization", name: "Agathon", url: base },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
    },
  ];
  if (w.guide && w.guide.faq.length > 0) {
    things.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: w.guide.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    });
  }
  return things;
}

// ------------------------------------------------------------------ the page

const IDS = {
  example: "worked-example",
  steps: "how-to",
  slips: "slips",
  practice: "practice",
  answers: "answer-key",
  agathon: "on-agathon",
  faq: "questions",
  related: "related",
} as const;

/** Opens the answer key for printing, and closes it again after (the page prints problems, then answers). */
const PRINT_SCRIPT =
  `(function(){var opened=[];addEventListener("beforeprint",function(){var d=document.querySelectorAll("details[data-print-open]");` +
  `for(var i=0;i<d.length;i++)if(!d[i].open){d[i].open=true;opened.push(d[i])}});` +
  `addEventListener("afterprint",function(){for(var i=0;i<opened.length;i++)opened[i].open=false;opened=[]})})();`;

export function SkillPage({ id }: { id: TopicId }) {
  const w = skillWords(id);
  const content = skillContent(id);
  const guide = w.guide;
  const related = relatedSkills(id, guide);
  const copy = SKILL_PAGE_COPY;
  return (
    <div className={`${landing.page} ${styles.page}`} data-skill-page="">
      {skillJsonLd(w).map((data) => (
        <JsonLd key={String(data["@type"])} data={data} />
      ))}
      {/* the library's bar, as on the hub and the level pages */}
      <LibraryNav />
      <main>
        <header className={`${styles.hero} ${styles.noPrint}`}>
          <BoardDots id="sp-hero-dots" />
          <div className={`${landing.inner} ${styles.heroInner}`}>
            <Breadcrumbs w={w} />
            {w.levelText && <p className={`${landing.eyebrow} ${styles.eyebrow}`}>{w.levelText}</p>}
            <h1 className={styles.title}>
              <TitleWithCheck text={w.h1} />
            </h1>
            <p className={styles.lede}>{prose(w.lede)}</p>
            <nav aria-label="On this page" className={styles.jump}>
              {content.example && (
                <a href={`#${IDS.example}`} className={styles.jumpLink}>
                  {copy.jump.example}
                </a>
              )}
              <a href={`#${IDS.practice}`} className={styles.jumpLink}>
                {copy.jump.practice}
              </a>
              <a href={`#${IDS.answers}`} className={styles.jumpLink}>
                {copy.jump.answers}
              </a>
            </nav>
          </div>
        </header>

        {/* printed only: the worksheet's own head */}
        <div className={styles.printHead} aria-hidden>
          <p className={styles.printTitle}>{w.h1}</p>
          <p className={styles.printLines}>
            <span>{copy.printName}</span>
            <span>{copy.printDate}</span>
          </p>
        </div>

        {content.example && <ExampleSection example={content.example} />}
        {guide && guide.steps.length > 0 && <StepsSection steps={guide.steps} />}
        {guide && guide.slips.length > 0 && <SlipsSection slips={guide.slips} />}
        <PracticeSection content={content} />
        <AgathonSection id={id} content={content} />
        {guide && guide.faq.length > 0 && <FaqSection faq={guide.faq} />}
        <RelatedSection related={related} level={w.level} />

        <p className={styles.printSource} aria-hidden>
          agathon.app{w.path}
        </p>
      </main>
      {/* After every drawing on the page: holds each until it is in view (no hydration needed). */}
      <script dangerouslySetInnerHTML={{ __html: INK_START_SCRIPT }} />
      <script dangerouslySetInnerHTML={{ __html: PRINT_SCRIPT }} />
    </div>
  );
}

/** Agathon › Math › 4th grade › Long division: every step a link but the last, which is this page. */
function Breadcrumbs({ w }: { w: SkillWords }) {
  const steps = skillCrumbs(w);
  return (
    <nav aria-label={SKILL_PAGE_COPY.breadcrumb} className={styles.crumbs}>
      <ol>
        {steps.map((step, i) =>
          i < steps.length - 1 ? (
            <li key={step.path}>
              <Link href={step.path}>{step.name}</Link>
            </li>
          ) : (
            <li key={step.path} aria-current="page">
              {step.name}
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}

/** The h1, with the tutor's check after its last word (the two never part at a line's end). */
function TitleWithCheck({ text }: { text: string }) {
  const at = text.lastIndexOf(" ");
  return (
    <>
      {text.slice(0, at + 1)}
      <span className={landing.nowrap}>
        {text.slice(at + 1)}
        <InkCheck className={styles.titleCheck} draw="sp-title-check" atMs={500} forMs={300} />
      </span>
    </>
  );
}

/** The board's dot grid, 24 px apart (as on the landing page's hero). Decorative. */
function BoardDots({ id }: { id: string }) {
  return (
    <svg className={styles.dots} aria-hidden focusable="false">
      <defs>
        <pattern id={id} width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="1.15" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

// ---- Watch one worked out

/** The hand's cap height for a worked line, and the pause between lines. */
const EXAMPLE_SIZE = 40;
const LINE_GAP_MS = 280;
const SPEED = 1.3;
const CHECK_MS = 260;

function ExampleSection({ example }: { example: WorkedExample }) {
  const copy = SKILL_PAGE_COPY;
  const kid = example.by === "kid";
  const lines: { line: MathLine; ink: "kid" | "tutor"; label: string | null; checked: boolean }[] = [
    ...example.problem.map((line, i) => ({ line, ink: "kid" as const, label: i === 0 ? copy.problemLabel : null, checked: false })),
    ...example.steps.map((line) => ({ line, ink: kid ? ("kid" as const) : ("tutor" as const), label: null, checked: kid })),
  ];
  let at = 0;
  const timed = lines.map((l, i) => {
    const startMs = at;
    const writeMs = handMathMs(l.line.latex, { size: EXAMPLE_SIZE, seed: i + 1, speed: SPEED });
    // a checked line: the tutor's check mark lands once the line is written
    at += writeMs + LINE_GAP_MS + (l.checked ? CHECK_MS : 0);
    return { ...l, startMs, checkMs: startMs + writeMs + 120 };
  });
  return (
    <section id={IDS.example} className={`${styles.band} ${styles.noPrint}`} aria-labelledby="sp-example-title">
      <div className={landing.inner}>
        <div className={styles.sectionHead}>
          <h2 id="sp-example-title" className={styles.h2}>
            {copy.exampleTitle}
          </h2>
          <p className={styles.sectionLede}>{kid ? copy.exampleLedeKid : copy.exampleLede}</p>
        </div>
        <figure className={styles.board}>
          <BoardDots id="sp-board-dots" />
          <ol className={styles.work}>
            {timed.map(({ line, ink, label, startMs, checked, checkMs }, i) => (
              <li key={i} className={`${styles.workLine} ${i >= example.problem.length ? styles.workStep : styles.workProblem}`}>
                <div className={styles.workHand}>
                  <HandMath latex={line.latex} size={EXAMPLE_SIZE} ink={ink} seed={i + 1} speed={SPEED} draw={`sp-ex-${i}`} startMs={startMs} />
                  {checked && <InkCheck className={styles.workCheck} draw={`sp-ex-check-${i}`} atMs={checkMs} forMs={CHECK_MS} />}
                </div>
                <p className={styles.workText}>
                  {label && <span className={styles.workLabel}>{label}</span>}
                  <span className={styles.math}>{line.text}</span>
                </p>
              </li>
            ))}
          </ol>
          <figcaption className={styles.workAnswer}>
            <span className={styles.workLabel}>{copy.answerLabel}</span> <strong className={styles.math}>{example.answer.text}</strong>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

// ---- How to do it

function StepsSection({ steps }: { steps: readonly string[] }) {
  return (
    <section id={IDS.steps} className={`${styles.band} ${styles.soft} ${styles.noPrint}`} aria-labelledby="sp-steps-title">
      <div className={`${landing.inner} ${styles.narrow}`}>
        <h2 id="sp-steps-title" className={styles.h2}>
          {SKILL_PAGE_COPY.stepsTitle}
        </h2>
        <ol className={styles.steps}>
          {steps.map((step, i) => (
            <li key={i} className={styles.step}>
              <span className={styles.stepNumber} aria-hidden>
                {i + 1}
              </span>
              <p>{prose(step)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---- Where kids slip

function SlipsSection({ slips }: { slips: SkillGuide["slips"] }) {
  const copy = SKILL_PAGE_COPY;
  return (
    <section id={IDS.slips} className={`${styles.band} ${styles.noPrint}`} aria-labelledby="sp-slips-title">
      <div className={`${landing.inner} ${styles.narrow}`}>
        <h2 id="sp-slips-title" className={styles.h2}>
          {copy.slipsTitle[0]}{" "}
          <InkCircle className={styles.slipCircle} draw="sp-slip-circle" atMs={200} forMs={620} pen={2.5}>
            {copy.slipsTitle[1]}
          </InkCircle>
        </h2>
        <p className={styles.sectionLedeLeft}>{copy.slipsLede}</p>
        <ul className={styles.slips}>
          {slips.map((s, i) => (
            <li key={i} className={styles.slip}>
              <h3 className={styles.h3}>{prose(s.slip)}</h3>
              <p>
                <strong>{copy.fixLabel}</strong> {prose(s.fix)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---- Practice problems and the answer key

function PracticeSection({ content }: { content: SkillContent }) {
  const copy = SKILL_PAGE_COPY;
  const n = content.problems.length;
  return (
    <section id={IDS.practice} className={`${styles.band} ${styles.soft} ${styles.practiceBand}`} aria-labelledby="sp-practice-title">
      <div className={landing.inner}>
        <div className={`${styles.sectionHead} ${styles.practiceHead}`}>
          <h2 id="sp-practice-title" className={styles.h2}>
            {copy.practiceTitle}
          </h2>
          <p className={`${styles.sectionLede} ${styles.noPrint}`}>{copy.practiceLede(n)}</p>
          <p className={`${styles.printHint} ${styles.noPrint}`}>{copy.printHint}</p>
        </div>
        <ol className={`${styles.problems} ${content.handwritten ? "" : styles.problemsTyped}`}>
          {content.problems.map((p, i) => (
            <li key={i} className={styles.problem}>
              <span className={styles.problemNumber} aria-hidden>
                {i + 1}
              </span>
              <div className={styles.problemBody}>
                {content.handwritten ? (
                  <>
                    <div className={styles.problemHand}>
                      {p.problem.map((line, k) => (
                        <HandMath key={k} latex={line.latex} size={32} ink="kid" seed={i * 7 + k + 3} className={styles.problemSvg} />
                      ))}
                    </div>
                    <p className={styles.problemText}>
                      {p.problem.map((line, k) => (
                        <span key={k} className={styles.math}>
                          {line.text}
                        </span>
                      ))}
                    </p>
                  </>
                ) : (
                  <p className={styles.problemTyped}>
                    {p.problem.map((line, k) => (
                      <span key={k} className={styles.math}>
                        {line.text}
                      </span>
                    ))}
                  </p>
                )}
                {p.interval && <p className={styles.interval}>{copy.intervalNote(p.interval.text)}</p>}
              </div>
            </li>
          ))}
        </ol>

        <details id={IDS.answers} className={`${landing.qa} ${styles.answerKey}`} data-print-open="">
          <summary className={styles.answerSummary}>
            <h3 className={styles.answerTitle}>{copy.answersTitle}</h3>
            <span className={`${styles.answerShow} ${styles.noPrint}`}>{copy.answersShow}</span>
            <span className={`${landing.toggle} ${styles.noPrint}`} aria-hidden />
          </summary>
          <table className={styles.keyTable}>
            <thead>
              <tr>
                <th scope="col">{copy.keyNumber}</th>
                <th scope="col">{copy.keyProblem}</th>
                <th scope="col">{copy.keyAnswer}</th>
              </tr>
            </thead>
            <tbody>
              {content.problems.map((p, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className={styles.math}>{p.problem.map((l) => l.text).join("; ")}</td>
                  <td className={`${styles.math} ${styles.keyAnswer}`}>
                    {p.answer.text}
                    {p.interval && <span className={styles.keyInterval}> ({p.interval.text})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}

// ---- Practice this on Agathon

function AgathonSection({ id, content }: { id: TopicId; content: SkillContent }) {
  const copy = SKILL_PAGE_COPY;
  const grades = gradesOf(id);
  const courses = coursesOf(id).map(courseName);
  const where = grades.length > 0 ? copy.onPath(skillLevelText(id)!) : courses.length > 0 ? copy.inCourses(courses) : copy.anyTopic;
  const facts = copy.agathonFacts(`“${usEnglish(pathSkillName(id))}”`, Boolean(content.example));
  const terms = planWords().terms;
  return (
    <section id={IDS.agathon} className={`${styles.band} ${styles.agathon} ${styles.noPrint}`} aria-labelledby="sp-agathon-title">
      <div className={landing.inner}>
        <div className={styles.agathonCard}>
          <p className={landing.eyebrow}>{copy.agathonEyebrow}</p>
          <h2 id="sp-agathon-title" className={styles.h2}>
            {copy.agathonTitle}
          </h2>
          <p className={styles.sectionLedeLeft}>{where}</p>
          <ul className={styles.facts}>
            {facts.map((f) => (
              <li key={f.title} className={styles.fact}>
                <h3 className={styles.h3}>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
          </ul>
          <div className={styles.joinRow}>
            <Link href={SIGN_UP_HREF} className={`${landing.pill} ${landing.pillLarge}`}>
              {copy.join}
            </Link>
            <p className={styles.terms}>{terms}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Questions

function FaqSection({ faq }: { faq: SkillGuide["faq"] }) {
  return (
    <section id={IDS.faq} className={`${styles.band} ${styles.noPrint}`} aria-labelledby="sp-faq-title">
      <div className={`${landing.inner} ${styles.narrow}`}>
        <h2 id="sp-faq-title" className={styles.h2}>
          {SKILL_PAGE_COPY.faqTitle}
        </h2>
        <div className={styles.faq}>
          {faq.map((f, i) => (
            <div key={i} className={styles.faqItem}>
              <h3 className={styles.h3}>{prose(f.q)}</h3>
              <p>{prose(f.a)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- Related skills

function RelatedSection({ related, level }: { related: readonly TopicId[]; level: LevelRef | null }) {
  const copy = SKILL_PAGE_COPY;
  return (
    <section id={IDS.related} className={`${styles.band} ${styles.soft} ${styles.noPrint}`} aria-labelledby="sp-related-title">
      <div className={landing.inner}>
        <h2 id="sp-related-title" className={styles.h2}>
          {copy.relatedTitle}
        </h2>
        <ul className={styles.related}>
          {related.map((r) => (
            <li key={r}>
              <Link href={skillPath(r)} className={styles.relatedLink}>
                <span>{linkName(r)}</span>
                <ChevronRight size={18} strokeWidth={2} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <p className={styles.levelLinks}>
          {level && (
            <Link href={level.path} className={landing.textLink}>
              {copy.allSkills(level.label)}
              <ChevronRight size={18} strokeWidth={2} aria-hidden />
            </Link>
          )}
          <Link href={MATH_PATH} className={landing.textLink}>
            {copy.library}
            <ChevronRight size={18} strokeWidth={2} aria-hidden />
          </Link>
        </p>
      </div>
    </section>
  );
}
